import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open, save } from "@tauri-apps/plugin-dialog";
import { FolderSearch, Loader2, Trash2 } from "lucide-react";
import { TitleBar } from "@/components/TitleBar";
import { ResizeHandles } from "@/components/ResizeHandles";
import { SlideList } from "@/components/SlideList";
import { ViewerCanvas, type ViewerHandle, type ViewerStatus } from "@/components/ViewerCanvas";
import { Minimap } from "@/components/Minimap";
import { ToolBar } from "@/components/ToolBar";
import { StatusBar } from "@/components/StatusBar";
import { SettingsDialog } from "@/components/SettingsDialog";
import { SplitPane } from "@/components/SplitPane";
import { VelocityToast } from "@/components/ui/VelocityToast";
import { SpringSelect } from "@/components/ui/SpringSelect";
import { MorphingDialog } from "@/components/ui/MorphingDialog";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Form";
import { useAnnotations, useSlideInfo, useSlides } from "@/hooks/useSlide";
import { tileCache } from "@/lib/tileCache";
import { useTheme } from "@/lib/theme";
import {
  defaultRoot,
  loadSettings,
  saveExport,
  saveSettings,
  type SlideInfo,
} from "@/lib/ipc";
import { formatUm, niceScaleBar, screenToLayer0, type Viewport } from "@/lib/coords";
import type { Pt, Tool } from "@/lib/types";

interface ToastState {
  title: string;
  desc?: string;
  variant?: "default" | "success" | "error" | "info";
}

/** Annotation ink that stays readable on the current theme's canvas. */
const ACCENT_INK = { light: "#a8861b", dark: "#c9a227" } as const;

export default function App() {
  const [root, setRoot] = useState(() => localStorage.getItem("tt.root") || "");
  const { slides, loading, error, reload } = useSlides(root);
  const [activeId, setActiveId] = useState<string | null>(null);
  const { info } = useSlideInfo(activeId);
  const [rightId, setRightId] = useState<string | null>(null);
  const { info: rightInfo } = useSlideInfo(rightId);
  const annotations = useAnnotations(activeId);
  const { choice, resolved, setTheme, toggle } = useTheme();

  const [maximized, setMaximized] = useState(false);
  const [tool, setTool] = useState<Tool>("pan");
  const [dual, setDual] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showStatus, setShowStatus] = useState(true);
  const [cacheMb, setCacheMb] = useState(400);
  const [defaultZoom, setDefaultZoom] = useState("fit");
  const [status, setStatus] = useState<ViewerStatus>({ level: 0, scale: 1, x: 0, y: 0 });
  const [view, setView] = useState<{ vp: Viewport; size: { w: number; h: number } }>({
    vp: { scale: 0.01, tx: 0, ty: 0 },
    size: { w: 0, h: 0 },
  });
  const [cacheStats, setCacheStats] = useState({ rate: 0, bytes: 0 });
  const [toast, setToast] = useState<ToastState | null>(null);
  const [busy, setBusy] = useState(false);
  const [textAt, setTextAt] = useState<Pt | null>(null);
  const [textVal, setTextVal] = useState("");
  const [marqueeMode, setMarqueeMode] = useState(false);
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  const leftRef = useRef<ViewerHandle>(null);
  const rightRef = useRef<ViewerHandle>(null);
  const infoRef = useRef<SlideInfo | null>(null);
  const rightInfoRef = useRef<SlideInfo | null>(null);
  infoRef.current = info;
  rightInfoRef.current = rightInfo;

  const toastMsg = (t: ToastState) => setToast(t);
  const accentInk = ACCENT_INK[resolved];

  /* ------------------------------------------------------------- window */

  useEffect(() => {
    const win = getCurrentWindow();
    const sync = () => void win.isMaximized().then(setMaximized);
    sync();
    let un: (() => void) | undefined;
    void win.onResized(sync).then((f) => (un = f));
    return () => un?.();
  }, []);

  /* ----------------------------------------------------------- settings */

  useEffect(() => {
    void loadSettings()
      .then(async (s) => {
        if (s.root) setRoot(s.root);
        else if (!localStorage.getItem("tt.root")) {
          const d = await defaultRoot();
          if (d) setRoot(d);
        }
        if (s.cache_mb) setCacheMb(s.cache_mb);
        if (s.default_zoom) setDefaultZoom(s.default_zoom);
        if (s.theme === "light" || s.theme === "dark" || s.theme === "system") {
          setTheme(s.theme);
        }
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (root) localStorage.setItem("tt.root", root);
    tileCache.clear();
  }, [root]);

  useEffect(() => {
    tileCache.setBudget(cacheMb * 1024 * 1024);
  }, [cacheMb]);

  useEffect(() => {
    if (!root) return;
    const t = window.setTimeout(() => {
      void saveSettings({
        root,
        cache_mb: cacheMb,
        default_zoom: defaultZoom,
        theme: choice,
      });
    }, 500);
    return () => window.clearTimeout(t);
  }, [root, cacheMb, defaultZoom, choice]);

  useEffect(() => {
    const t = window.setInterval(() => {
      const s = tileCache.stats();
      setCacheStats({ rate: s.rate, bytes: s.bytes });
    }, 1000);
    return () => window.clearInterval(t);
  }, []);

  /* ------------------------------------------------------------ loading */

  useEffect(() => {
    if (slides.length === 0) {
      setActiveId(null);
      return;
    }
    if (!activeId || !slides.some((s) => s.id === activeId)) {
      setActiveId(slides[0].id);
      setRightId(slides[1]?.id ?? slides[0].id);
    }
  }, [slides, activeId]);

  useEffect(() => {
    setTool("pan");
    if (!info) return;
    const t = window.setTimeout(() => {
      if (defaultZoom === "actual") leftRef.current?.actualSize();
      else leftRef.current?.fit();
    }, 40);
    return () => window.clearTimeout(t);
  }, [info?.id, defaultZoom]);

  /* --------------------------------------------------------------- view */

  const handleView = useCallback(
    (vp: Viewport, size: { w: number; h: number }) => {
      setView({ vp, size });
      if (dual && rightRef.current && rightInfoRef.current && infoRef.current) {
        const cx = (size.w / 2 - vp.tx) / vp.scale;
        const cy = (size.h / 2 - vp.ty) / vp.scale;
        const nx = cx / infoRef.current.width;
        const ny = cy / infoRef.current.height;
        const rs = rightRef.current.getSize();
        const ri = rightInfoRef.current;
        rightRef.current.setViewport({
          scale: vp.scale,
          tx: rs.w / 2 - nx * ri.width * vp.scale,
          ty: rs.h / 2 - ny * ri.height * vp.scale,
        });
      }
    },
    [dual],
  );

  const jumpTo = (x: number, y: number) => {
    const v = leftRef.current;
    if (!v) return;
    const vp = v.getViewport();
    const s = v.getSize();
    v.setViewport({ scale: vp.scale, tx: s.w / 2 - x * vp.scale, ty: s.h / 2 - y * vp.scale });
  };

  /* ------------------------------------------------------------- export */

  const doExport = useCallback(
    async (rect: { x: number; y: number; w: number; h: number } | null) => {
      const v = leftRef.current;
      if (!v || !info) return;
      setBusy(true);
      try {
        // Marquee rects are screen pixels; exports work in layer-0 pixels.
        const r = rect
          ? (() => {
              const vp = v.getViewport();
              const a = screenToLayer0(vp, rect.x, rect.y);
              const b = screenToLayer0(vp, rect.x + rect.w, rect.y + rect.h);
              return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
            })()
          : null;
        const blob = await v.exportImage(r);
        if (!blob) return;
        const lvl = status.level;
        const cx = r ? Math.round(r.x) : Math.max(0, Math.round(status.x));
        const cy = r ? Math.round(r.y) : Math.max(0, Math.round(status.y));
        const base = `${info.case_no}-${info.tooth}-${info.site || "slide"}_L${lvl}_${cx}_${cy}`;
        const path = await save({
          defaultPath: `${base}.png`,
          filters: [{ name: "PNG 图像", extensions: ["png"] }],
        });
        if (!path) return;
        // Ship the PNG as base64: a JSON number array for a multi-MB PNG
        // would stall the IPC for seconds.
        const dataUrl = await new Promise<string>((res, rej) => {
          const fr = new FileReader();
          fr.onload = () => res(fr.result as string);
          fr.onerror = () => rej(fr.error);
          fr.readAsDataURL(blob);
        });
        const saved = await saveExport(path, dataUrl.slice(dataUrl.indexOf(",") + 1));
        toastMsg({ title: "截图已导出", desc: saved, variant: "success" });
      } catch (e) {
        toastMsg({ title: "导出失败", desc: String(e), variant: "error" });
      } finally {
        setBusy(false);
      }
    },
    [info, status.level, status.x, status.y],
  );

  const onShot = (mode: "view" | "rect") => {
    if (mode === "view") void doExport(null);
    else {
      setMarqueeMode(true);
      setMarquee(null);
    }
  };

  /* ---------------------------------------------------------- annotate */

  const submitText = () => {
    if (textAt && textVal.trim()) {
      annotations.add({
        type: "text",
        points: [textAt],
        text: textVal.trim(),
        color: accentInk,
        slide: activeId || "",
        level: status.level,
      });
    }
    setTextAt(null);
    setTextVal("");
    setTool("pan");
  };

  /* ------------------------------------------------------------ hotkeys */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (e.ctrlKey || e.metaKey) return;
      switch (e.key) {
        case "+":
        case "=":
          leftRef.current?.zoomBy(1.35);
          break;
        case "-":
        case "_":
          leftRef.current?.zoomBy(1 / 1.35);
          break;
        case "0":
          leftRef.current?.fit();
          break;
        case "f":
        case "F": {
          const win = getCurrentWindow();
          void win.isFullscreen().then((v) => win.setFullscreen(!v));
          break;
        }
        case "m":
        case "M":
          setTool((cur) => (cur === "measure" ? "pan" : "measure"));
          break;
        case "t":
        case "T":
          toggle();
          break;
        case "Escape":
          setMarqueeMode(false);
          setMarquee(null);
          setTextAt(null);
          setSettingsOpen(false);
          setTool("pan");
          leftRef.current?.cancel();
          break;
        case "Delete":
        case "Backspace":
          annotations.removeLast();
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [annotations, toggle]);

  /* ------------------------------------------------------------- render */

  const pickRoot = async () => {
    const dir = await open({ directory: true, multiple: false, title: "选择 MIRAX 数据目录" });
    if (typeof dir === "string") {
      setRoot(dir);
      setActiveId(null);
    }
  };

  const bar = useMemo(
    () => (info && view.size.w > 0 ? niceScaleBar(view.vp.scale, info.mpp) : null),
    [info, view],
  );

  const leftLevels = useMemo(() => info?.levels.map((l) => l.level) ?? [], [info]);
  const rightLevels = useMemo(() => rightInfo?.levels.map((l) => l.level) ?? [], [rightInfo]);

  const rightOptions = slides.map((s) => ({
    value: s.id,
    label: `${s.case_no} · ${s.tooth} · ${s.site}`,
  }));

  return (
    <div className={`win-shell${maximized ? " maximized" : ""}`}>
      <div className="win-card">
        <TitleBar
          title="TT SlideViewer"
          subtitle={info?.name}
          maximized={maximized}
          theme={resolved}
          onToggleTheme={toggle}
        />

        <div className="flex min-h-0 flex-1">
          <SlideList
            slides={slides}
            activeId={activeId}
            root={root}
            loading={loading}
            onSelect={setActiveId}
            onPickRoot={pickRoot}
            onOpenSettings={() => setSettingsOpen(true)}
          />

          <main className="relative flex min-w-0 flex-1 flex-col">
            <div className="relative min-h-0 flex-1 overflow-hidden bg-background">
              {dual ? (
                <SplitPane
                  left={
                    <div className="relative h-full w-full">
                      {info && (
                        <ViewerCanvas
                          key={`L-${info.id}`}
                          ref={leftRef}
                          slideId={info.id}
                          levels={leftLevels}
                          mpp={info.mpp}
                          bbox={info.bbox}
                          canvasW={info.width}
                          canvasH={info.height}
                          tool={tool}
                          measureMode={tool === "measure"}
                          annotations={annotations.list}
                          color={accentInk}
                          onStatus={setStatus}
                          onView={handleView}
                          onAddAnnotation={annotations.add}
                          onTextRequest={(p) => {
                            setTextAt(p);
                            setTextVal("");
                          }}
                        />
                      )}
                    </div>
                  }
                  right={
                    <div className="relative h-full w-full border-l border-border">
                      {rightInfo && (
                        <ViewerCanvas
                          key={`R-${rightInfo.id}`}
                          ref={rightRef}
                          slideId={rightInfo.id}
                          levels={rightLevels}
                          mpp={rightInfo.mpp}
                          bbox={rightInfo.bbox}
                          canvasW={rightInfo.width}
                          canvasH={rightInfo.height}
                          tool={tool}
                          measureMode={false}
                          annotations={[]}
                          color={accentInk}
                          onStatus={() => undefined}
                          onView={() => undefined}
                          onAddAnnotation={() => undefined}
                          onTextRequest={() => undefined}
                        />
                      )}
                      <div className="absolute left-2 top-2 z-20 w-[190px]">
                        <SpringSelect
                          options={rightOptions}
                          value={rightId ?? undefined}
                          onChange={setRightId}
                          label=""
                        />
                      </div>
                    </div>
                  }
                />
              ) : (
                <div className="relative h-full w-full">
                  {info ? (
                    <ViewerCanvas
                      key={info.id}
                      ref={leftRef}
                      slideId={info.id}
                      levels={leftLevels}
                      mpp={info.mpp}
                      bbox={info.bbox}
                      canvasW={info.width}
                      canvasH={info.height}
                      tool={tool}
                      measureMode={tool === "measure"}
                      annotations={annotations.list}
                      color={accentInk}
                      onStatus={setStatus}
                      onView={handleView}
                      onAddAnnotation={annotations.add}
                      onTextRequest={(p) => {
                        setTextAt(p);
                        setTextVal("");
                      }}
                    />
                  ) : (
                    <Welcome
                      loading={loading}
                      error={error}
                      onPickRoot={pickRoot}
                      onRetry={() => void reload()}
                      hasRoot={!!root}
                    />
                  )}
                </div>
              )}

              {marqueeMode && (
                <MarqueeOverlay
                  onDone={(r) => {
                    setMarqueeMode(false);
                    setMarquee(null);
                    if (r && info) void doExport(r);
                  }}
                  onRect={setMarquee}
                  rect={marquee}
                />
              )}

              {info && (
                <>
                  <ToolBar
                    tool={tool}
                    measuring={tool === "measure"}
                    onTool={setTool}
                    onZoom={(f) => leftRef.current?.zoomBy(f)}
                    onFit={() => leftRef.current?.fit()}
                    onActual={() => leftRef.current?.actualSize()}
                    onShot={onShot}
                    dual={dual}
                    onDual={() => setDual((v) => !v)}
                    busy={busy}
                  />
                  {!dual && (
                    <Minimap
                      slideId={info.id}
                      canvasW={info.width}
                      canvasH={info.height}
                      bbox={info.bbox}
                      viewport={view.vp}
                      viewSize={view.size}
                      onJump={jumpTo}
                    />
                  )}
                  {bar && (
                    <div className="pointer-events-none absolute bottom-4 left-4 z-20 flex flex-col gap-1">
                      <div
                        className="h-[2px] bg-muted-foreground"
                        style={{ width: Math.round(bar.px) }}
                      />
                      <div className="text-[11px] tabnum text-muted-foreground">
                        {formatUm(bar.um)}
                      </div>
                    </div>
                  )}
                  {annotations.list.length > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="absolute right-3 top-3 z-20 h-7 gap-1.5 px-2 text-[11px] backdrop-blur-[12px]"
                      leftIcon={<Trash2 size={12} strokeWidth={1.5} />}
                      onClick={annotations.clear}
                    >
                      清除标注 ({annotations.list.length})
                    </Button>
                  )}
                </>
              )}
            </div>

            <StatusBar
              info={info}
              status={status}
              cacheRate={cacheStats.rate}
              cacheBytes={cacheStats.bytes}
              visible={showStatus}
            />
          </main>
        </div>
      </div>

      <ResizeHandles disabled={maximized} />

      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        root={root}
        onPickRoot={pickRoot}
        cacheMb={cacheMb}
        setCacheMb={setCacheMb}
        showStatus={showStatus}
        setShowStatus={setShowStatus}
        defaultZoom={defaultZoom}
        setDefaultZoom={setDefaultZoom}
        theme={choice}
        setTheme={setTheme}
        annotated={annotations.list.length}
      />

      <MorphingDialog
        open={!!textAt}
        onClose={() => setTextAt(null)}
        title="添加文字标注"
        subtitle="标注随切片保存在本机"
        widthClass="max-w-[360px]"
      >
        <Input
          autoFocus
          value={textVal}
          onChange={(e) => setTextVal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submitText();
            if (e.key === "Escape") setTextAt(null);
          }}
          placeholder="备注内容…"
        />
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => setTextAt(null)}>
            取消
          </Button>
          <Button variant="primary" size="sm" onClick={submitText}>
            添加
          </Button>
        </div>
      </MorphingDialog>

      <VelocityToast
        open={!!toast}
        onDismiss={() => setToast(null)}
        title={toast?.title ?? ""}
        description={toast?.desc}
        variant={toast?.variant ?? "default"}
        position="bottom-center"
        duration={4200}
      />
    </div>
  );
}

function Welcome({
  loading,
  error,
  hasRoot,
  onPickRoot,
  onRetry,
}: {
  loading: boolean;
  error: string | null;
  hasRoot: boolean;
  onPickRoot: () => void;
  onRetry: () => void;
}) {
  return (
    <div className="flex h-full items-center justify-center p-10">
      <div className="w-[420px] rounded-xl border border-border bg-surface-raised p-6">
        <div className="mb-1 text-lg font-medium">TT SlideViewer</div>
        <div className="text-xs leading-relaxed text-muted-foreground">
          选择一个包含 MIRAX 病例文件夹的数据目录。目录将只读挂载，逐级读取 JPEG 瓦片。
        </div>
        {loading && (
          <div className="mt-4 flex items-center gap-2 text-xs text-tertiary">
            <Loader2 size={14} className="animate-spin" strokeWidth={1.5} /> 正在解析切片索引…
          </div>
        )}
        {error && <div className="mt-4 text-xs text-danger">{error}</div>}
        {!loading && hasRoot && !error && (
          <div className="mt-4 text-xs text-tertiary">
            该目录下没有找到可用的切片（需要 Index.dat）。
          </div>
        )}
        <div className="mt-5 flex gap-2">
          <Button
            variant="primary"
            size="md"
            leftIcon={<FolderSearch size={16} strokeWidth={1.5} />}
            onClick={onPickRoot}
          >
            选择数据目录
          </Button>
          {hasRoot && (
            <Button variant="secondary" size="md" onClick={onRetry}>
              重新扫描
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function MarqueeOverlay({
  onDone,
  onRect,
  rect,
}: {
  onDone: (r: { x: number; y: number; w: number; h: number } | null) => void;
  onRect: (r: { x: number; y: number; w: number; h: number } | null) => void;
  rect: { x: number; y: number; w: number; h: number } | null;
}) {
  const start = useRef<{ x: number; y: number } | null>(null);
  return (
    <div
      className="absolute inset-0 z-40 cursor-crosshair bg-black/10"
      onPointerDown={(e) => {
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        start.current = { x: e.clientX - r.left, y: e.clientY - r.top };
      }}
      onPointerMove={(e) => {
        if (!start.current) return;
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const x = e.clientX - r.left;
        const y = e.clientY - r.top;
        onRect({
          x: Math.min(start.current.x, x),
          y: Math.min(start.current.y, y),
          w: Math.abs(x - start.current.x),
          h: Math.abs(y - start.current.y),
        });
      }}
      onPointerUp={() => {
        if (rect && rect.w > 8 && rect.h > 8) onDone(rect);
        else onDone(null);
        start.current = null;
      }}
      onPointerCancel={() => onDone(null)}
    >
      {rect && (
        <div
          className="absolute border border-primary bg-accent-dim"
          style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
        />
      )}
      <div className="absolute left-1/2 top-3 -translate-x-1/2 rounded-md border border-border bg-[color-mix(in_srgb,var(--bg-panel)_88%,transparent)] px-2 py-1 text-[11px] text-muted-foreground backdrop-blur-[12px]">
        拖动框选导出区域 · Esc 取消
      </div>
    </div>
  );
}
