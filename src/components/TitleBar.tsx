import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { AnimatePresence, motion } from "framer-motion";
import { Minus, Moon, Square, Copy, Sun, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { motionTransitions } from "@/lib/motion-tokens";
import type { ResolvedTheme } from "@/lib/theme";

interface Props {
  title: string;
  subtitle?: string;
  maximized: boolean;
  theme: ResolvedTheme;
  onToggleTheme: () => void;
}

export function TitleBar({ title, subtitle, maximized, theme, onToggleTheme }: Props) {
  const win = getCurrentWindow();
  const [hover, setHover] = useState<string | null>(null);

  const btn = (
    id: string,
    icon: React.ReactNode,
    onClick: () => void,
    danger = false,
  ) => (
    <button
      key={id}
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground",
        "transition-colors duration-[120ms] cursor-pointer",
        hover === id &&
          (danger
            ? "bg-danger text-white"
            : "bg-surface-hover text-foreground"),
      )}
      onMouseEnter={() => setHover(id)}
      onMouseLeave={() => setHover(null)}
      onClick={onClick}
      aria-label={id}
    >
      {icon}
    </button>
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F11") {
        e.preventDefault();
        void win.isFullscreen().then((f) => win.setFullscreen(!f));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [win]);

  return (
    <div
      data-tauri-drag-region
      className="relative flex h-9 shrink-0 items-center gap-2 border-b border-border bg-surface-raised pl-3 pr-1 select-none"
    >
      <div
        data-tauri-drag-region
        className="flex h-4 w-4 items-center justify-center rounded-[4px] border border-[color-mix(in_srgb,var(--accent)_55%,transparent)]"
      >
        <div className="h-1.5 w-1.5 rounded-[1px] bg-primary" />
      </div>
      <div data-tauri-drag-region className="flex min-w-0 items-baseline gap-2">
        <span className="text-xs font-medium tracking-[0.02em] text-foreground">
          {title}
        </span>
        {subtitle && (
          <span className="truncate text-[11px] text-tertiary">{subtitle}</span>
        )}
      </div>
      <div className="ml-auto flex items-center gap-0.5">
        <button
          onClick={onToggleTheme}
          aria-label="切换浅色 / 深色主题"
          title="切换浅色 / 深色主题"
          className={cn(
            "mr-1 flex h-8 w-8 cursor-pointer items-center justify-center rounded-md",
            "text-muted-foreground transition-colors duration-[120ms]",
            "hover:bg-surface-hover hover:text-foreground",
            hover === "theme" && "bg-surface-hover text-foreground",
          )}
          onMouseEnter={() => setHover("theme")}
          onMouseLeave={() => setHover(null)}
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={theme}
              initial={{ opacity: 0, rotate: -60, scale: 0.7 }}
              animate={{ opacity: 1, rotate: 0, scale: 1 }}
              exit={{ opacity: 0, rotate: 60, scale: 0.7 }}
              transition={motionTransitions.springSnappy}
              className="flex"
            >
              {theme === "light" ? (
                <Sun size={15} strokeWidth={1.5} />
              ) : (
                <Moon size={15} strokeWidth={1.5} />
              )}
            </motion.span>
          </AnimatePresence>
        </button>
        {btn("minimize", <Minus size={16} strokeWidth={1.5} />, () => void win.minimize())}
        {btn(
          "maximize",
          maximized ? <Copy size={13} strokeWidth={1.5} /> : <Square size={12} strokeWidth={1.5} />,
          () => void win.toggleMaximize(),
        )}
        {btn("close", <X size={16} strokeWidth={1.5} />, () => void win.close(), true)}
      </div>
    </div>
  );
}
