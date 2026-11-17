import {
  ArrowUpRight,
  Camera,
  Columns2,
  Hand,
  Maximize,
  Minus,
  MousePointerSquareDashed,
  Pencil,
  Plus,
  Ruler,
  Scan,
  Square,
  Type,
} from "lucide-react";
import { DirectionalTooltip } from "@/components/ui/DirectionalTooltip";
import { PressButton } from "@/components/ui/PressButton";
import { OriginDropdown } from "@/components/ui/OriginDropdown";
import { cn } from "@/lib/utils";
import type { Tool } from "@/lib/types";

interface Props {
  tool: Tool;
  measuring: boolean;
  onTool: (t: Tool) => void;
  onZoom: (f: number) => void;
  onFit: () => void;
  onActual: () => void;
  onShot: (mode: "view" | "rect") => void;
  dual: boolean;
  onDual: () => void;
  busy: boolean;
}

/** easyui PressButton squeezed into a compact toolbar toggle. */
function TB({
  label,
  active,
  onClick,
  children,
  disabled,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <DirectionalTooltip content={label} side="top" delayDuration={260}>
      <PressButton
        variant="ghost"
        aria-label={label}
        onClick={onClick}
        disabled={disabled}
        className={cn(
          "h-8 w-8 rounded-[7px] p-0 justify-center",
          active
            ? "bg-accent-dim text-primary hover:bg-accent-dim hover:text-primary"
            : "hover:bg-surface-hover",
          disabled && "opacity-35",
        )}
      >
        {children}
      </PressButton>
    </DirectionalTooltip>
  );
}

const Sep = () => <div className="mx-1 h-5 w-px bg-border" />;

export function ToolBar(props: Props) {
  const { tool, onTool, onZoom, onFit, onActual, onShot, dual, onDual, busy, measuring } = props;

  return (
    <div className="toolbar-float pointer-events-auto absolute bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-0.5 px-1.5 py-1">
      <TB label="缩小 (−)" onClick={() => onZoom(1 / 1.35)}>
        <Minus size={16} strokeWidth={1.5} />
      </TB>
      <TB label="放大 (+)" onClick={() => onZoom(1.35)}>
        <Plus size={16} strokeWidth={1.5} />
      </TB>
      <TB label="适应窗口 (0)" onClick={onFit}>
        <Scan size={16} strokeWidth={1.5} />
      </TB>
      <TB label="100% 实际像素" onClick={onActual}>
        <Maximize size={15} strokeWidth={1.5} />
      </TB>
      <Sep />
      <TB label="平移 (空格)" active={tool === "pan"} onClick={() => onTool("pan")}>
        <Hand size={16} strokeWidth={1.5} />
      </TB>
      <TB
        label="测量距离 (M)"
        active={tool === "measure" || measuring}
        onClick={() => onTool(tool === "measure" ? "pan" : "measure")}
      >
        <Ruler size={16} strokeWidth={1.5} />
      </TB>
      <Sep />
      <TB label="矩形标注" active={tool === "rect"} onClick={() => onTool("rect")}>
        <Square size={15} strokeWidth={1.5} />
      </TB>
      <TB label="箭头标注" active={tool === "arrow"} onClick={() => onTool("arrow")}>
        <ArrowUpRight size={16} strokeWidth={1.5} />
      </TB>
      <TB label="自由绘制" active={tool === "freehand"} onClick={() => onTool("freehand")}>
        <Pencil size={15} strokeWidth={1.5} />
      </TB>
      <TB label="文字标注" active={tool === "text"} onClick={() => onTool("text")}>
        <Type size={15} strokeWidth={1.5} />
      </TB>
      <Sep />
      <DirectionalTooltip content="导出截图" side="top" delayDuration={260}>
        <OriginDropdown
          side="top"
          hideChevron
          triggerClassName={cn(
            "inline-flex h-8 w-8 items-center justify-center rounded-[7px] border border-transparent cursor-pointer",
            "text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground focus-ring",
            busy && "pointer-events-none opacity-35",
          )}
          trigger={<Camera size={16} strokeWidth={1.5} />}
          items={[
            {
              id: "view",
              label: "当前视图 1:1",
              icon: <Camera size={14} strokeWidth={1.5} />,
              onSelect: () => onShot("view"),
            },
            {
              id: "rect",
              label: "框选区域导出",
              icon: <MousePointerSquareDashed size={14} strokeWidth={1.5} />,
              onSelect: () => onShot("rect"),
            },
          ]}
        />
      </DirectionalTooltip>
      <TB label="双联对比" active={dual} onClick={onDual}>
        <Columns2 size={16} strokeWidth={1.5} />
      </TB>
    </div>
  );
}
