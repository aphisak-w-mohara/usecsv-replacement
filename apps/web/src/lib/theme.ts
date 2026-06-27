import { useCallback, useEffect, useState } from "react";

export type Theme = "system" | "light" | "dark";

const STORAGE_KEY = "evo-theme";

function systemPrefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function readStored(): Theme {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    /* ignore */
  }
  return "system";
}

/** Toggle the <html>.dark class for the resolved theme. */
function apply(theme: Theme) {
  const dark = theme === "dark" || (theme === "system" && systemPrefersDark());
  document.documentElement.classList.toggle("dark", dark);
}

/**
 * Theme state hook. Persists the user's choice (system/light/dark) and keeps the
 * <html>.dark class in sync — including live OS changes while on "system".
 */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(readStored);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
    apply(next);
  }, []);

  useEffect(() => {
    apply(theme);
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => apply("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  return { theme, setTheme };
}
