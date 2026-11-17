import { useEffect, useRef, useState } from "react";
import { slideThumb } from "@/lib/ipc";
import type { Viewport } from "@/lib/coords";

interface Props {
  slideId: string;
  canvasW: number;
  canvasH: number;
  /** tissue bbox [x, y, w, h] in layer-0 px — the thumb covers exactly this */
  bbox: [number, number, number, number];
  viewport: Viewport;
  viewSize: { w: number; h: number };
  onJump: (x: number, y: number) => void;
}

const MAX = 168;

export function Minimap({ slideId, canvasW, canvasH, bbox, viewport, viewSize, onJump }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [thumb, setThumb] = useState<{ w: number; h: number; px: Uint8ClampedArray } | null>(null);
  const [hover, setHover] = useState(false);

  useEffect(() => {
    let alive = true;
    setThumb(null);
    slideThumb(slideId, "minimap")
      .then((t) => {
        if (alive && t) setThumb(t);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [slideId]);

  const scale = thumb ? Math.min(MAX / thumb.w, MAX / thumb.h) : 0.2;
  const w = thumb ? Math.round(thumb.w * scale) : Math.round(canvasW * scale);
  const h = thumb ? Math.round(thumb.h * scale) : Math.round(canvasH * scale);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !thumb) return;
    cv.width = w;
    cv.height = h;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const img = new ImageData(thumb.px as unknown as Uint8ClampedArray<ArrayBuffer>, thumb.w, thumb.h);
    const off = document.createElement("canvas");
    off.width = thumb.w;
    off.height = thumb.h;
    off.getContext("2d")!.putImageData(img, 0, 0);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(off, 0, 0, w, h);

    // viewport rectangle in thumbnail space (thumb spans the tissue bbox);
    // vx/vy/vw/vh are already in thumb pixels — do not scale again
    const k = thumb.w / bbox[2];
    const vx = ((0 - viewport.tx) / viewport.scale - bbox[0]) * k;
    const vy = ((0 - viewport.ty) / viewport.scale - bbox[1]) * k;
    const vw = (viewSize.w / viewport.scale) * k;
    const vh = (viewSize.h / viewport.scale) * k;
    const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#c9a227";
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.5;
    ctx.fillStyle = "rgba(201,162,39,0.18)";
    const rx = vx;
    const ry = vy;
    const rw = Math.max(2, vw);
    const rh = Math.max(2, vh);
    // clamp to the thumb with a 1px inset so the stroke stays visible even
    // when the viewport engulfs the whole bbox (full zoom-out)
    const cx0 = Math.max(0.5, rx);
    const cy0 = Math.max(0.5, ry);
    const cx1 = Math.min(w - 0.5, rx + rw);
    const cy1 = Math.min(h - 0.5, ry + rh);
    ctx.fillRect(cx0, cy0, cx1 - cx0, cy1 - cy0);
    ctx.strokeRect(cx0 + 0.5, cy0 + 0.5, cx1 - cx0 - 1, cy1 - cy0 - 1);
  }, [thumb, w, h, viewport, viewSize, bbox]);

  const handle = (e: React.MouseEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    const fx = (e.clientX - r.left) / r.width;
    const fy = (e.clientY - r.top) / r.height;
    onJump(bbox[0] + fx * bbox[2], bbox[1] + fy * bbox[3]);
  };

  return (
    <div
      className="absolute bottom-3 right-3 z-20 overflow-hidden rounded-lg border border-border bg-[color-mix(in_srgb,var(--bg-panel)_86%,transparent)] p-1.5 backdrop-blur-[12px] transition-colors duration-[120ms]"
      style={{ borderColor: hover ? "var(--border-strong)" : undefined }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <canvas
        ref={canvasRef}
        width={w}
        height={h}
        style={{ width: w, height: h, display: "block", cursor: "crosshair" }}
        onClick={handle}
      />
    </div>
  );
}

