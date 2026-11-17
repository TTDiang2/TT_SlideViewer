import type { SlideInfo } from "@/lib/ipc";
import type { ViewerStatus } from "@/components/ViewerCanvas";
import { formatUm } from "@/lib/coords";

interface Props {
  info: SlideInfo | null;
  status: ViewerStatus;
  cacheRate: number;
  cacheBytes: number;
  visible: boolean;
  hoverUm?: number;
}

function Item({ k, v, mono = true }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex items-center gap-1.5 whitespace-nowrap">
      <span className="text-[var(--text-tertiary)]">{k}</span>
      <span className={mono ? "tabnum text-[var(--text-secondary)]" : "text-[var(--text-secondary)]"}>
        {v}
      </span>
    </div>
  );
}

export function StatusBar({ info, status, cacheRate, cacheBytes, visible, hoverUm }: Props) {
  if (!visible) return null;
  const zoom = status.scale * 100;
  const mpp = info ? info.mpp * Math.pow(2, status.level) : 0;
  return (
    <div className="flex h-[26px] shrink-0 items-center gap-4 border-t border-[var(--border-subtle)] bg-[var(--bg-panel)] px-3 text-[11px]">
      <Item k="级别" v={info ? `L${status.level}` : "—"} />
      <Item k="缩放" v={info ? `${zoom < 10 ? zoom.toFixed(2) : zoom.toFixed(0)}%` : "—"} />
      <Item k="分辨率" v={info ? `${mpp.toFixed(3)} µm/px` : "—"} />
      <Item
        k="坐标"
        v={info ? `${status.x.toLocaleString()} , ${status.y.toLocaleString()}` : "—"}
      />
      {hoverUm !== undefined && <Item k="标尺" v={formatUm(hoverUm)} />}
      <div className="ml-auto flex items-center gap-4">
        <Item k="缓存命中" v={`${(cacheRate * 100).toFixed(0)}%`} />
        <Item k="缓存" v={`${(cacheBytes / 1024 / 1024).toFixed(0)} MB`} />
        <div className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
          <span className="text-[var(--text-tertiary)]">本地只读</span>
        </div>
      </div>
    </div>
  );
}
