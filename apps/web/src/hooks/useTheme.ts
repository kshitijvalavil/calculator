import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";
const KEY = "calc.theme";
const query = "(prefers-color-scheme: dark)";

function systemTheme(): Theme {
  return typeof window !== "undefined" && window.matchMedia?.(query).matches ? "dark" : "light";
}

function storedTheme(): Theme | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : null;
  } catch {
    return null;
  }
}

/** Follows the system preference until the user picks a theme, then remembers it. */
export function useTheme() {
  const [override, setOverride] = useState<Theme | null>(storedTheme);
  const [system, setSystem] = useState<Theme>(systemTheme);

  useEffect(() => {
    const mql = window.matchMedia?.(query);
    if (!mql) return;
    const onChange = () => setSystem(mql.matches ? "dark" : "light");
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (override) root.dataset.theme = override;
    else delete root.dataset.theme;
  }, [override]);

  const theme = override ?? system;
  const toggle = useCallback(() => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setOverride(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* not persisted */
    }
  }, [theme]);

  return { theme, toggle };
}
