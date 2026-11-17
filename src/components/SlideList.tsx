import { useEffect, useMemo, useRef, useState } from "react";
import { FolderOpen, SlidersHorizontal } from "lucide-react";
import { slideThumb, type SlideMeta } from "@/lib/ipc";
import { cn } from "@/lib/utils";
import { SpringSelect } from "@/components/ui/SpringSelect";
import { AnimatedTabs } from "@/components/ui/AnimatedTabs";
import { CompactSearchBar } from "@/components/ui/CompactSearchBar";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Skeleton";
import { DirectionalTooltip } from "@/components/ui/DirectionalTooltip";

interface Props {
  slides: SlideMeta[];
  activeId: string | null;
  root: string;
  loading: boolean;
  onSelect: (id: string) => void;
  onPickRoot: () => void;
  onOpenSettings: () => void;
}

function Thumb({ id }: { id: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let alive = true;
    slideThumb(id, "list")
      .then((t) => {
        if (!alive || !t || !ref.current) return;
        const cv = ref.current;
        const ctx = cv.getContext("2d");
        if (!ctx) return;
        const src = document.createElement("canvas");
        src.width = t.w;
        src.height = t.h;
        src.getContext("2d")!.putImageData(new ImageData(t.px, t.w, t.h), 0, 0);
        const s = Math.min(56 / t.w, 40 / t.h);
        cv.width = Math.max(1, Math.round(t.w * s));
        cv.height = Math.max(1, Math.round(t.h * s));
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(src, 0, 0, cv.width, cv.height);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [id]);
  return (
    <div className="flex h-10 w-14 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-background">
      <canvas ref={ref} className="block" />
    </div>
  );
}

export function SlideList({
  slides,
  activeId,
  root,
  loading,
  onSelect,
  onPickRoot,
  onOpenSettings,
}: Props) {
  const [q, setQ] = useState("");
  const [site, setSite] = useState("all");
  const [tooth, setTooth] = useState("all");

  const sites = useMemo(() => {
    const s = new Set<string>();
    slides.forEach((x) => x.site && s.add(x.site));
    return [...s];
  }, [slides]);
  const teeth = useMemo(() => {
    const s = new Set<string>();
    slides.forEach((x) => x.tooth && s.add(x.tooth));
    return [...s].sort();
  }, [slides]);

  const shown = slides.filter((s) => {
    if (site !== "all" && s.site !== site) return false;
    if (tooth !== "all" && s.tooth !== tooth) return false;
    if (q && !s.name.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });

  return (
    <aside className="flex w-[268px] shrink-0 flex-col border-r border-border bg-surface-raised">
      <div className="flex items-center gap-2 px-3 pb-2 pt-3">
        <div className="flex h-6 w-6 items-center justify-center rounded border border-border text-tertiary">
          <SlidersHorizontal size={13} strokeWidth={1.5} />
        </div>
        <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-tertiary">
          切片库
        </div>
        <span className="ml-auto text-[11px] tabnum text-tertiary">
          {shown.length}/{slides.length}
        </span>
      </div>

      <div className="px-3">
        <CompactSearchBar value={q} onChange={setQ} placeholder="搜索病例 / 编号" />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <AnimatedTabs
            className="min-w-0 flex-1 basis-[150px]"
            tabsContainerClassName="w-full self-stretch bg-background"
            tabs={[
              { id: "all", label: "全部" },
              ...sites.map((s) => ({ id: s, label: s })),
            ]}
            activeTab={site}
            onChange={setSite}
            renderContent={false}
            layoutId="site-tab-indicator"
          />
          {teeth.length > 1 && (
            <div className="w-[86px] shrink-0">
              <SpringSelect
                options={[{ value: "all", label: "牙位" }, ...teeth.map((t) => ({ value: t, label: t }))]}
                value={tooth}
                onChange={setTooth}
                label=""
              />
            </div>
          )}
        </div>
      </div>

      <div className="mt-2 flex-1 overflow-y-auto px-2 pb-2">
        {loading &&
          Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="mb-1 flex gap-2 rounded-lg p-2">
              <Skeleton className="h-10 w-14 rounded-md" />
              <div className="flex-1 space-y-1.5 py-0.5">
                <Skeleton className="h-3 w-4/5 rounded" />
                <Skeleton className="h-2.5 w-3/5 rounded" />
              </div>
            </div>
          ))}
        {!loading && shown.length === 0 && (
          <div className="px-3 py-8 text-center text-xs leading-relaxed text-tertiary">
            没有匹配的切片
          </div>
        )}
        {shown.map((s) => (
          <button
            key={s.id}
            onClick={() => onSelect(s.id)}
            className={cn(
              "slide-row mb-1 flex w-full items-center gap-2.5 rounded-lg border border-transparent p-2 text-left",
              activeId === s.id && "active",
            )}
          >
            <Thumb id={s.id} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-xs font-medium text-foreground">
                  {s.case_no} · {s.tooth}
                </span>
                {s.site && (
                  <Badge tone="neutral" className="h-5 shrink-0 px-2 text-[10px]">
                    {s.site}
                  </Badge>
                )}
              </div>
              <div className="mt-0.5 truncate text-[11px] tabnum text-tertiary">
                {s.levels} 级 · {s.tiles.toLocaleString()} 块 · {s.size_mb} MB
              </div>
            </div>
          </button>
        ))}
      </div>

      <div className="border-t border-border p-2">
        <div className="truncate px-1 pb-1 text-[10px] text-tertiary" title={root}>
          {root || "未选择数据目录"}
        </div>
        <div className="flex gap-1">
          <Button
            variant="outline"
            size="sm"
            className="h-7 flex-1 text-[11px]"
            leftIcon={<FolderOpen size={13} strokeWidth={1.5} />}
            onClick={onPickRoot}
          >
            更换目录
          </Button>
          <DirectionalTooltip content="设置" side="top" delayDuration={260}>
            <Button
              variant="outline"
              size="sm"
              className="h-7 w-8 px-0"
              aria-label="设置"
              onClick={onOpenSettings}
            >
              <SlidersHorizontal size={13} strokeWidth={1.5} />
            </Button>
          </DirectionalTooltip>
        </div>
      </div>
    </aside>
  );
}
