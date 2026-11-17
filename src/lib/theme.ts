import { useCallback, useEffect, useState } from "react";

export type ThemeChoice = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const KEY = "tt.theme";

function systemTheme(): ResolvedTheme {
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function apply(t: ResolvedTheme) {
  document.documentElement.setAttribute("data-theme", t);
}

export function useTheme() {
  const [choice, setChoice] = useState<ThemeChoice>(() => {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  });
  const [resolved, setResolved] = useState<ResolvedTheme>(() => {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : systemTheme();
  });

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const sync = () => {
      const r = choice === "system" ? systemTheme() : choice;
      apply(r);
      setResolved(r);
    };
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, [choice]);

  const setTheme = useCallback((c: ThemeChoice) => {
    localStorage.setItem(KEY, c);
    setChoice(c);
  }, []);

  const toggle = useCallback(() => {
    const cur = document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
    setTheme(cur === "light" ? "dark" : "light");
  }, [setTheme]);

  return { choice, resolved, setTheme, toggle };
}
