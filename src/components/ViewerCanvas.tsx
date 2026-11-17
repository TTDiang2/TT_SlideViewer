import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import { getTiles } from "@/lib/ipc";
import { TileCache, tileCache } from "@/lib/tileCache";
import {
  clamp,
  fitScale,
  layer0ToScreen,
  pickLevel,
  screenToLayer0,
  TILE_H,
  TILE_W,
  visibleLayer0,
  zoomAt,
  type Rect,
  type Viewport,
} from "@/lib/coords";
import type { Annotation, Tool } from "@/lib/types";

export interface ViewerStatus {
  level: number;
  scale: number;
  x: number;
  y: number;
}

export interface ViewerHandle {
  fit: () => void;
  actualSize: () => void;
  zoomBy: (factor: number) => void;
  setViewport: (vp: Viewport) => void;
  getViewport: () => Viewport;
  getSize: () => { w: number; h: number };
  cancel: () => void;
  exportImage: (rect: Rect | null, targetLevel?: number) => Promise<Blob | null>;
}

interface Props {
  slideId: string;
  levels: number[];
  mpp: number;
  bbox: [number, number, number, number];
  canvasW: number;
  canvasH: number;
  tool: Tool;
  measureMode: boolean;
  annotations: Annotation[];
  color: string;
  onStatus: (s: ViewerStatus) => void;
  onView: (vp: Viewport, size: { w: number; h: number }) => void;
  onAddAnnotation: (a: Omit<Annotation, "id">) => void;
  onTextRequest: (p: { x: number; y: number }) => void;
  onReady?: () => void;
}

/** Read a theme token as a canvas-usable color; falls back if missing. */
function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export const ViewerCanvas = forwardRef<ViewerHandle, Props>(function ViewerCanvas(
  props,
  ref,
) {
  const {
    slideId,
    levels,
    mpp,
    bbox,
    canvasW,
    canvasH,
    tool,
    measureMode,
    annotations,
    color,
    onStatus,
    onView,
    onAddAnnotation,
    onTextRequest,
    onReady,
  } = props;

  const wrapRef = useRef<HTMLDivElement>(null);
  const tileRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const vpRef = useRef<Viewport>({ scale: 0.01, tx: 0, ty: 0 });
  const sizeRef = useRef({ w: 0, h: 0 });
  const dirtyRef = useRef(true);
  const initRef = useRef(false);
  const rafRef = useRef(0);
  const dragRef = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const inflight = useRef(new Map<string, number>());
  const lastFetch = useRef(0);
  const hoverRef = useRef({ x: 0, y: 0 });
  const levelRef = useRef(0);
  const measureRef = useRef<{ x: number; y: number }[]>([]);
  const drawingRef = useRef<{ x: number; y: number }[] | null>(null);
  const lastEmit = useRef(0);
  const propsRef = useRef(props);
  propsRef.current = props;

  const markDirty = useCallback(() => {
    dirtyRef.current = true;
  }, []);

  useEffect(() => {
    dirtyRef.current = true;
  }, []);

  /* ---------------------------------------------------------------- render */

  const draw = useCallback(() => {
    const tile = tileRef.current;
    const overlay = overlayRef.current;
    const { w, h } = sizeRef.current;
    if (!tile || !overlay || w === 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    for (const c of [tile, overlay]) {
      const bw = Math.round(w * dpr);
      const bh = Math.round(h * dpr);
      if (c.width !== bw || c.height !== bh) {
        c.width = bw;
        c.height = bh;
      }
      const cx = c.getContext("2d");
      if (!cx) return;
      cx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cx.clearRect(0, 0, w, h);
    }
    // canvas void shows the CSS background of .viewer-surface (--viewer-bg)
    const ctx = tile.getContext("2d")!;
    const oc = overlay.getContext("2d")!;
    const vp = vpRef.current;

    const missingColor = cssVar("--viewer-missing", "#1f1f23");
    const accent = cssVar("--accent", "#c9a227");
    const labelBg = cssVar("--viewer-label-bg", "rgba(14,14,16,.86)");
    const labelBorder = cssVar("--viewer-label-border", "rgba(255,255,255,.12)");
    const labelInk = cssVar("--viewer-label-ink", "#ededef");

    const k = pickLevel(levels, vp.scale);
    levelRef.current = k;
    const step = 1 << k;
    const s = vp.scale * step; // screen px per level-k px
    const tw = TILE_W * s;
    const th = TILE_H * s;
    ctx.imageSmoothingEnabled = s * dpr < 1;
    ctx.imageSmoothingQuality = "high";

    const gx0 = Math.floor((0 - vp.tx) / tw) - 1;
    const gy0 = Math.floor((0 - vp.ty) / th) - 1;
    const gx1 = Math.ceil((w - vp.tx) / tw) + 1;
    const gy1 = Math.ceil((h - vp.ty) / th) + 1;

    for (let gy = gy0; gy <= gy1; gy++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        if (gx < 0 || gy < 0) continue;
        const sx = vp.tx + gx * tw;
        const sy = vp.ty + gy * th;
        // snap shared edges so neighbouring tiles never show a seam
        const ex = vp.tx + (gx + 1) * tw;
        const ey = vp.ty + (gy + 1) * th;
        const dx = Math.round(sx);
        const dy = Math.round(sy);
        const dw = Math.round(ex) - dx;
        const dh = Math.round(ey) - dy;
        const bmp = tileCache.get(TileCache.key(slideId, k, gx, gy));
        if (bmp) {
          ctx.drawImage(bmp, dx, dy, dw, dh);
          continue;
        }
        // fall back to a coarser cached ancestor so nothing flashes
        let drawn = false;
        for (let d = 1; d <= 5 && k + d <= 8; d++) {
          const parent = levels[levels.length - 1];
          if (k + d > (parent ?? 8)) break;
          const pk = k + d;
          const px = gx >> d;
          const py = gy >> d;
          const pb = tileCache.peek(TileCache.key(slideId, pk, px, py));
          if (pb) {
            // source quadrant: width and height subdivide independently —
            // tiles are 303x253, not square. Using the width step for y made
            // the source rect overhang the bitmap bottom on odd rows, and the
            // browser's proportional clip then left an unpainted strip at the
            // bottom of every such cell (the "hole" artifact).
            const qw = TILE_W / (1 << d);
            const qh = TILE_H / (1 << d);
            ctx.imageSmoothingEnabled = true;
            ctx.drawImage(
              pb,
              (gx & ((1 << d) - 1)) * qw,
              (gy & ((1 << d) - 1)) * qh,
              qw,
              qh,
              dx,
              dy,
              dw,
              dh,
            );
            drawn = true;
            break;
          }
        }
        if (!drawn) {
          ctx.fillStyle = missingColor;
          ctx.fillRect(dx, dy, dw + 1, dh + 1);
        }
      }
    }

    /* ----------------------------- overlays (layer-0 coordinates) */
    const toScreen = (p: { x: number; y: number }) => layer0ToScreen(vp, p.x, p.y);
    oc.save();
    oc.lineCap = "round";
    oc.lineJoin = "round";

    for (const a of annotations) {
      oc.strokeStyle = a.color || accent;
      oc.fillStyle = a.color || accent;
      oc.lineWidth = 1.5;
      const pts = a.points.map(toScreen);
      if (a.type === "rect" && pts.length >= 2) {
        const [p, q] = pts;
        oc.strokeRect(
          Math.min(p.x, q.x),
          Math.min(p.y, q.y),
          Math.abs(q.x - p.x),
          Math.abs(q.y - p.y),
        );
        oc.font = "11px Inter, system-ui, sans-serif";
        if (a.text) oc.fillText(a.text, Math.min(p.x, q.x), Math.min(p.y, q.y) - 5);
      } else if (a.type === "arrow" && pts.length >= 2) {
        const [p, q] = pts;
        oc.beginPath();
        oc.moveTo(p.x, p.y);
        oc.lineTo(q.x, q.y);
        oc.stroke();
        const ang = Math.atan2(q.y - p.y, q.x - p.x);
        const hl = 9;
        oc.beginPath();
        oc.moveTo(q.x, q.y);
        oc.lineTo(q.x - hl * Math.cos(ang - 0.4), q.y - hl * Math.sin(ang - 0.4));
        oc.moveTo(q.x, q.y);
        oc.lineTo(q.x - hl * Math.cos(ang + 0.4), q.y - hl * Math.sin(ang + 0.4));
        oc.stroke();
        oc.font = "11px Inter, system-ui, sans-serif";
        if (a.text) oc.fillText(a.text, q.x + 6, q.y - 6);
      } else if (a.type === "freehand" && pts.length > 1) {
        oc.beginPath();
        oc.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) oc.lineTo(pts[i].x, pts[i].y);
        oc.stroke();
      } else if (a.type === "text" && pts.length >= 1) {
        oc.font = "12px Inter, system-ui, sans-serif";
        oc.fillText(a.text || "", pts[0].x, pts[0].y);
      }
    }

    // live measurement
    const mpts = [...measureRef.current, ...(drawingRef.current ?? [])];
    if (mpts.length > 1) {
      oc.strokeStyle = accent;
      oc.lineWidth = 1.5;
      oc.beginPath();
      const s0 = toScreen(mpts[0]);
      oc.moveTo(s0.x, s0.y);
      for (let i = 1; i < mpts.length; i++) {
        const p = toScreen(mpts[i]);
        oc.lineTo(p.x, p.y);
      }
      oc.stroke();
      let dist0 = 0;
      for (let i = 1; i < mpts.length; i++) {
        const a = mpts[i - 1];
        const b = mpts[i];
        dist0 += Math.hypot(b.x - a.x, b.y - a.y);
      }
      const um = dist0 * mpp;
      const label = um >= 1000 ? `${(um / 1000).toFixed(3)} mm` : `${um.toFixed(1)} µm`;
      const last = toScreen(mpts[mpts.length - 1]);
      oc.font = "11px Inter, system-ui, sans-serif";
      const tw2 = oc.measureText(label).width;
      oc.fillStyle = labelBg;
      oc.fillRect(last.x + 8, last.y - 20, tw2 + 10, 18);
      oc.strokeStyle = labelBorder;
      oc.lineWidth = 1;
      oc.strokeRect(last.x + 8.5, last.y - 19.5, tw2 + 9, 17);
      oc.fillStyle = labelInk;
      oc.fillText(label, last.x + 13, last.y - 7);
      for (const p of mpts) {
        const q = toScreen(p);
        oc.fillStyle = accent;
        oc.beginPath();
        oc.arc(q.x, q.y, 2.6, 0, Math.PI * 2);
        oc.fill();
      }
    }
    oc.restore();
  }, [annotations, canvasH, canvasW, levels, mpp, slideId]);

  /* --------------------------------------------------------------- fetching */

  const ensure = useCallback(
    (k: number, gx0: number, gy0: number, gx1: number, gy1: number): Promise<void> => {
      if (!levels.includes(k)) return Promise.resolve();
      // Coarse overview levels legitimately extend past the level-0 canvas
      // (they carry the slide background), so only clamp to the grid and to
      // non-negative coordinates.
      const a = Math.max(0, Math.min(gx0, 295));
      const b = Math.max(0, Math.min(gy0, 791));
      const c = Math.max(0, Math.min(gx1, 295));
      const d = Math.max(0, Math.min(gy1, 791));
      if (c < a || d < b) return Promise.resolve();
      let missing = 0;
      for (let y = b; y <= d; y++) {
        for (let x = a; x <= c; x++) {
          if (!tileCache.peek(TileCache.key(slideId, k, x, y))) missing++;
        }
      }
      if (missing === 0) return Promise.resolve();
      const tag = `${slideId}|${k}|${a},${b},${c},${d}`;
      const now = performance.now();
      const prev = inflight.current.get(tag);
      if (prev && now - prev < 4000) return Promise.resolve();
      inflight.current.set(tag, now);
      return getTiles(slideId, k, a, b, c, d)
        .then(async (list) => {
          await Promise.all(
            list.map((t) => tileCache.put(TileCache.key(slideId, k, t.x, t.y), t.data)),
          );
          if (list.length) markDirty();
        })
        .catch(() => undefined)
        .finally(() => inflight.current.delete(tag));
    },
    [levels, markDirty, slideId],
  );

  const scheduleFetch = useCallback(() => {
    const now = performance.now();
    if (now - lastFetch.current < 40) return;
    lastFetch.current = now;
    const { w, h } = sizeRef.current;
    const vp = vpRef.current;
    const k = pickLevel(levels, vp.scale);
    const step = 1 << k;
    const s = vp.scale * step;
    const gx0 = Math.floor((0 - vp.tx) / (TILE_W * s)) - 2;
    const gy0 = Math.floor((0 - vp.ty) / (TILE_H * s)) - 2;
    const gx1 = Math.ceil((w - vp.tx) / (TILE_W * s)) + 2;
    const gy1 = Math.ceil((h - vp.ty) / (TILE_H * s)) + 2;
    ensure(k, gx0, gy0, gx1, gy1);
    // keep a coarser level hot: it is the fallback while zooming
    if (k < 8) ensure(Math.min(k + 2, 8), gx0 >> 2, gy0 >> 2, gx1 >> 2, gy1 >> 2);
  }, [ensure, levels]);

  /* ---------------------------------------------------------------- loop */

  useEffect(() => {
    let stopped = false;
    let drawErrors = 0;
    const tick = () => {
      if (stopped) return;
      const el = wrapRef.current;
      if (el) {
        const r = el.getBoundingClientRect();
        if (
          r.width > 0 &&
          r.height > 0 &&
          (sizeRef.current.w !== r.width || sizeRef.current.h !== r.height)
        ) {
          sizeRef.current = { w: r.width, h: r.height };
        }
      }
      if (dirtyRef.current) {
        if (!initRef.current && sizeRef.current.w > 0) {
          initRef.current = true;
          fitNow();
        }
        dirtyRef.current = false;
        try {
          draw();
        } catch (e) {
          // A single bad bitmap must never kill the render loop.
          if (drawErrors++ < 5) console.error("draw failed", e);
        }
        const now = performance.now();
        if (now - lastEmit.current > 90) {
          lastEmit.current = now;
          onStatus({
            level: levelRef.current,
            scale: vpRef.current.scale,
            x: hoverRef.current.x,
            y: hoverRef.current.y,
          });
          onView(vpRef.current, sizeRef.current);
        }
        scheduleFetch();
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      stopped = true;
      cancelAnimationFrame(rafRef.current);
    };
  }, [draw, onStatus, onView, scheduleFetch]);

  /* ------------------------------------------------------------- resizing */

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      sizeRef.current = { w: r.width, h: r.height };
      if (!initRef.current) {
        initRef.current = true;
        fitNow();
        // coarse pass first: whole slide at the lowest resolution
        ensure(8, 0, 0, Math.ceil(canvasW / (TILE_W << 8)), Math.ceil(canvasH / (TILE_H << 8)));
        onReady?.();
      }
      markDirty();
    });
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasW, canvasH, ensure]);

  const fitNow = useCallback(() => {
    const { w, h } = sizeRef.current;
    if (!w || !h) return;
    const r: Rect = { x: bbox[0], y: bbox[1], w: bbox[2], h: bbox[3] };
    const sc = fitScale(w, h, r, 24);
    vpRef.current = {
      scale: sc,
      tx: w / 2 - (r.x + r.w / 2) * sc,
      ty: h / 2 - (r.y + r.h / 2) * sc,
    };
    markDirty();
  }, [bbox, markDirty]);

  const minScale = useCallback(() => {
    const { w, h } = sizeRef.current;
    return fitScale(w, h, { x: bbox[0], y: bbox[1], w: bbox[2], h: bbox[3] }, 24) * 0.35;
  }, [bbox]);

  useImperativeHandle(
    ref,
    () => ({
      fit: () => {
        fitNow();
        scheduleFetch();
      },
      actualSize: () => {
        const { w, h } = sizeRef.current;
        const cx = (w / 2 - vpRef.current.tx) / vpRef.current.scale;
        const cy = (h / 2 - vpRef.current.ty) / vpRef.current.scale;
        const sc = 1;
        vpRef.current = { scale: sc, tx: w / 2 - cx * sc, ty: h / 2 - cy * sc };
        markDirty();
      },
      zoomBy: (factor: number) => {
        const { w, h } = sizeRef.current;
        vpRef.current = zoomAt(vpRef.current, w / 2, h / 2, factor, minScale(), 8);
        markDirty();
      },
      setViewport: (vp: Viewport) => {
        vpRef.current = vp;
        markDirty();
      },
      getViewport: () => ({ ...vpRef.current }),
      getSize: () => ({ ...sizeRef.current }),
      cancel: () => {
        measureRef.current = [];
        drawingRef.current = null;
        markDirty();
      },
      exportImage: async (rect, targetLevel) => {
        const vp = vpRef.current;
        const size = sizeRef.current;
        const k = targetLevel ?? pickLevel(levels, vp.scale);
        const r = rect ?? visibleLayer0(vp, size.w, size.h);
        const step = 1 << k;
        const w = Math.max(1, Math.round(r.w / step));
        const h = Math.max(1, Math.round(r.h / step));
        const gx0 = Math.max(0, Math.floor(r.x / (TILE_W * step)));
        const gy0 = Math.max(0, Math.floor(r.y / (TILE_H * step)));
        const gx1 = Math.ceil((r.x + r.w) / (TILE_W * step));
        const gy1 = Math.ceil((r.y + r.h) / (TILE_H * step));
        // get_tiles caps a batch at 600 tiles, so sweep the region in chunks
        // that stay under it; ensure() resolves once its batch has landed.
        const CHUNK_ROWS = 400;
        for (let by = gy0; by <= gy1; by += CHUNK_ROWS) {
          const yEnd = Math.min(by + CHUNK_ROWS - 1, gy1);
          const rows = yEnd - by + 1;
          const perBatch = Math.max(1, Math.floor(580 / rows));
          for (let bx = gx0; bx <= gx1; bx += perBatch) {
            await ensure(k, bx, by, Math.min(bx + perBatch - 1, gx1), yEnd);
          }
        }
        // Wait until every tile is cached (or give up after 8 s) so the
        // export never ships white gaps.
        const deadline = performance.now() + 8000;
        for (;;) {
          let missing = 0;
          for (let gy = gy0; gy <= gy1 && missing === 0; gy++) {
            for (let gx = gx0; gx <= gx1; gx++) {
              if (!tileCache.peek(TileCache.key(slideId, k, gx, gy))) {
                missing++;
                break;
              }
            }
          }
          if (missing === 0 || performance.now() > deadline) break;
          await new Promise((res) => setTimeout(res, 120));
        }
        const cv = document.createElement("canvas");
        cv.width = w;
        cv.height = h;
        const cx = cv.getContext("2d")!;
        cx.fillStyle = "#ffffff";
        cx.fillRect(0, 0, w, h);
        cx.imageSmoothingEnabled = false;
        for (let gy = gy0; gy <= gy1; gy++) {
          for (let gx = gx0; gx <= gx1; gx++) {
            const bmp = tileCache.peek(TileCache.key(slideId, k, gx, gy));
            if (!bmp) continue;
            const dx = (gx * TILE_W * step - r.x) / step;
            const dy = (gy * TILE_H * step - r.y) / step;
            cx.drawImage(bmp, dx, dy, TILE_W, TILE_H);
          }
        }
        return new Promise((res) => cv.toBlob((b) => res(b), "image/png"));
      },
    }),
    [ensure, fitNow, levels, markDirty, minScale, scheduleFetch, slideId],
  );

  /* --------------------------------------------------------------- pointer */

  const localPos = (e: React.PointerEvent | React.MouseEvent | React.WheelEvent) => {
    const r = wrapRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  // Wheel zoom must be attached natively with { passive: false }: React
  // registers wheel listeners passively at the root, so preventDefault in
  // JSX onWheel is a silent no-op (console warning + page zoom on Ctrl+wheel).
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const p = { x: e.clientX - r.left, y: e.clientY - r.top };
      const factor = Math.exp(-e.deltaY * 0.0016);
      vpRef.current = zoomAt(vpRef.current, p.x, p.y, factor, minScale(), 8);
      measureRef.current = [];
      markDirty();
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [markDirty, minScale]);

  const onPointerDown = (e: React.PointerEvent) => {
    const p = localPos(e);
    if (tool === "pan" || e.button === 1 || e.button === 2) {
      dragRef.current = { x: p.x, y: p.y, vx: vpRef.current.tx, vy: vpRef.current.ty };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      return;
    }
    const w0 = screenToLayer0(vpRef.current, p.x, p.y);
    if (measureMode || tool === "measure") {
      measureRef.current.push(w0);
      markDirty();
      return;
    }
    if (tool === "text") {
      onTextRequest(w0);
      return;
    }
    drawingRef.current = [w0];
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const p = localPos(e);
    const w0 = screenToLayer0(vpRef.current, p.x, p.y);
    hoverRef.current = { x: Math.round(w0.x), y: Math.round(w0.y) };
    if (dragRef.current) {
      const d = dragRef.current;
      vpRef.current = {
        ...vpRef.current,
        tx: d.vx + (p.x - d.x),
        ty: d.vy + (p.y - d.y),
      };
      markDirty();
      return;
    }
    if (drawingRef.current) {
      const pts = drawingRef.current;
      if (tool === "freehand") {
        pts.push(w0);
      } else {
        drawingRef.current = [pts[0], w0];
      }
      markDirty();
    }
  };

  const onPointerUp = () => {
    if (dragRef.current) {
      dragRef.current = null;
      return;
    }
    const pts = drawingRef.current;
    drawingRef.current = null;
    if (pts && pts.length >= 2 && tool !== "pan" && tool !== "measure") {
      const type = tool === "rect" ? "rect" : tool === "arrow" ? "arrow" : "freehand";
      onAddAnnotation({
        type,
        points: pts,
        color,
        level: levelRef.current,
        slide: props.slideId,
      } as Omit<Annotation, "id">);
    }
    markDirty();
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const p = localPos(e);
    vpRef.current = zoomAt(vpRef.current, p.x, p.y, 1.6, minScale(), 8);
    markDirty();
  };

  const bg = tool === "pan" ? (dragRef.current ? "grabbing" : "grab") : "crosshair";

  return (
    <div
      ref={wrapRef}
      className="viewer-surface absolute inset-0"
      style={{ cursor: bg }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      onContextMenu={(e) => e.preventDefault()}
    >
      <canvas ref={tileRef} />
      <canvas ref={overlayRef} style={{ pointerEvents: "none" }} />
    </div>
  );
});
