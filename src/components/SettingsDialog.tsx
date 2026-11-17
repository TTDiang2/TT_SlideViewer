import { Database, FolderOpen, Gauge, Monitor, Moon, Sun } from "lucide-react";
import { MorphingDialog } from "@/components/ui/MorphingDialog";
import { Button } from "@/components/ui/Button";
import { SpringSelect } from "@/components/ui/SpringSelect";
import { Switch } from "@/components/ui/Form";
import type { ThemeChoice } from "@/lib/theme";

interface Props {
  open: boolean;
  onClose: () => void;
  root: string;
  onPickRoot: () => void;
  cacheMb: number;
  setCacheMb: (v: number) => void;
  showStatus: boolean;
  setShowStatus: (v: boolean) => void;
  defaultZoom: string;
  setDefaultZoom: (v: string) => void;
  theme: ThemeChoice;
  setTheme: (v: ThemeChoice) => void;
  annotated: number;
}

const CACHE_OPTIONS = [128, 256, 400, 640, 1024, 2048].map((v) => ({
  value: String(v),
  label: `${v} MB`,
}));

const ZOOM_OPTIONS = [
  { value: "fit", label: "适应窗口" },
  { value: "actual", label: "100% 实际像素" },
  { value: "last", label: "上次位置" },
];

function Row({
  title,
  desc,
  children,
}: {
  title: string;
  desc: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-4 border-b border-border py-3.5 last:border-0">
      <div className="w-[132px] shrink-0 pt-0.5">
        <div className="text-xs text-foreground">{title}</div>
        <div className="mt-0.5 text-[11px] leading-snug text-tertiary">{desc}</div>
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** Segmented appearance-picker rendered as easyui-style icon cards. */
function ThemePicker({
  value,
  onChange,
}: {
  value: ThemeChoice;
  onChange: (v: ThemeChoice) => void;
}) {
  const items: { v: ThemeChoice; label: string; icon: React.ReactNode }[] = [
    { v: "light", label: "浅色", icon: <Sun size={15} strokeWidth={1.5} /> },
    { v: "dark", label: "深色", icon: <Moon size={15} strokeWidth={1.5} /> },
    { v: "system", label: "跟随系统", icon: <Monitor size={15} strokeWidth={1.5} /> },
  ];
  return (
    <div className="flex gap-2">
      {items.map((it) => (
        <button
          key={it.v}
          onClick={() => onChange(it.v)}
          aria-pressed={value === it.v}
          className={
            "flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs transition-colors focus-ring cursor-pointer " +
            (value === it.v
              ? "border-primary bg-accent-dim text-primary"
              : "border-border bg-background text-muted-foreground hover:border-border-hover hover:text-foreground")
          }
        >
          {it.icon}
          {it.label}
        </button>
      ))}
    </div>
  );
}

export function SettingsDialog({
  open,
  onClose,
  root,
  onPickRoot,
  cacheMb,
  setCacheMb,
  showStatus,
  setShowStatus,
  defaultZoom,
  setDefaultZoom,
  theme,
  setTheme,
  annotated,
}: Props) {
  return (
    <MorphingDialog
      open={open}
      onClose={onClose}
      title="设置"
      subtitle="数据目录只读，偏好保存在本机"
      icon={<Gauge size={16} strokeWidth={1.5} />}
      widthClass="max-w-[560px]"
      bodyClassName="max-h-[64vh] overflow-y-auto px-5 py-2"
    >
      <Row title="外观" desc="浅色 / 深色 / 跟随系统">
        <ThemePicker value={theme} onChange={setTheme} />
      </Row>

      <Row title="数据目录" desc="MIRAX 病例库，只读挂载">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1 truncate rounded-lg border border-border bg-background px-2.5 py-1.5 text-[11px] text-muted-foreground">
            {root || "未选择"}
          </div>
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<FolderOpen size={14} strokeWidth={1.5} />}
            onClick={onPickRoot}
          >
            选择
          </Button>
        </div>
      </Row>

      <Row title="瓦片缓存" desc="LRU 位图预算，超出即释放">
        <div className="w-[160px]">
          <SpringSelect
            options={CACHE_OPTIONS}
            value={String(cacheMb)}
            onChange={(v) => setCacheMb(Number(v))}
            label=""
          />
        </div>
      </Row>

      <Row title="默认缩放" desc="打开切片时的初始视图">
        <div className="w-[190px]">
          <SpringSelect
            options={ZOOM_OPTIONS}
            value={defaultZoom}
            onChange={setDefaultZoom}
            label=""
          />
        </div>
      </Row>

      <Row title="状态栏" desc="级别 / 坐标 / 缓存命中">
        <Switch checked={showStatus} onChange={setShowStatus} label="显示底部状态栏" />
      </Row>

      <Row title="标注存储" desc="保存在系统应用数据目录">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Database size={14} strokeWidth={1.5} className="text-tertiary" />
          当前切片共 {annotated} 条标注
        </div>
      </Row>

      <Row title="关于" desc="MIRAX 切片查看器">
        <div className="text-[11px] leading-relaxed text-tertiary">
          TT SlideViewer 1.0.0 · Tauri 2 + Canvas 2D
          <br />
          支持 9 级金字塔、µm 级测量与批注，数据目录只读。
        </div>
      </Row>

      <div className="flex items-center justify-end gap-2 pt-4">
        <Button variant="primary" size="sm" onClick={onClose}>
          完成
        </Button>
      </div>
    </MorphingDialog>
  );
}
