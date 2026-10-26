import { useSyncExternalStore } from "react";

export type Theme = "light" | "dark" | "system";
export const themes: Theme[] = ["light", "dark", "system"];

const STORAGE_KEY = "theme";
const query = window.matchMedia("(prefers-color-scheme: dark)");

function read(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
}

let current: Theme = read();
const listeners = new Set<() => void>();

// index.html applies the same rule before first paint, so the page never flashes light
const apply = () =>
  document.documentElement.classList.toggle("dark", current === "dark" || (current === "system" && query.matches));

apply();
query.addEventListener("change", apply);

export function setTheme(next: Theme) {
  current = next;
  try {
    if (next === "system") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // private window: the choice lasts until reload
  }
  apply();
  listeners.forEach((listener) => listener());
}

export function useTheme() {
  const theme = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
  );
  return { theme, setTheme };
}
