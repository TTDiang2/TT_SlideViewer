import { useCallback, useRef, useState } from "react";

/** Minimal splitter used by the dual-view mode. */
export function SplitPane({
  left,
  right,
  initial = 50,
  min = 26,
}: {
  left: React.ReactNode;
  right: React.ReactNode;
  initial?: number;
  min?: number;
}) {
  const [pct, setPct] = useState(initial);
  const hostRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const onMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging.current || !hostRef.current) return;
      const r = hostRef.current.getBoundingClientRect();
      const p = ((e.clientX - r.left) / r.width) * 100;
      setPct(Math.max(min, Math.min(100 - min, p)));
    },
    [min],
  );

  return (
    <div
      ref={hostRef}
      className="flex h-full min-h-0 min-w-0 flex-1"
      onPointerMove={onMove}
      onPointerUp={() => (dragging.current = false)}
      onPointerLeave={() => (dragging.current = false)}
    >
      <div className="relative min-w-0 overflow-hidden" style={{ width: `${pct}%` }}>
        {left}
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        className="group relative z-30 w-[5px] shrink-0 cursor-col-resize bg-[var(--bg-panel)]"
        onPointerDown={(e) => {
          dragging.current = true;
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
        }}
      >
        <div className="absolute inset-y-0 left-[2px] w-px bg-[var(--border-subtle)] transition-colors duration-[120ms] group-hover:bg-[var(--border-strong)]" />
      </div>
      <div className="relative min-w-0 flex-1 overflow-hidden">{right}</div>
    </div>
  );
}
