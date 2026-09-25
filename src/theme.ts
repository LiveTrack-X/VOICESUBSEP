import { useSyncExternalStore } from "react";

export const THEMES = ["light", "dark"] as const;
export type Theme = typeof THEMES[number];
export const THEME_STORAGE_KEY = "voicesubsep-ui-theme";

// These surfaces also let speaker labels choose accessible text colors while
// preserving the user's original speaker color in their marker/export style.
export const THEME_PALETTES = {
  light: { background: "#f7f8fb", surface: "#ffffff", surfaceAlt: "#f0f3f8", text: "#293244", muted: "#626d80", accent: "#7558ee", onAccent: "#ffffff" },
  dark: { background: "#10141d", surface: "#181e2a", surfaceAlt: "#202838", text: "#e9edf5", muted: "#a9b5c9", accent: "#7558ee", onAccent: "#ffffff" },
} as const;

export type ThemeStorage = Pick<Storage, "getItem" | "setItem">;
export type ThemeRoot = {
  setAttribute(name: string, value: string): void;
  style: Pick<CSSStyleDeclaration, "colorScheme">;
};
type ThemeEnvironment = { storage?: ThemeStorage | null; root?: ThemeRoot | null };

export function parseTheme(value: unknown): Theme {
  return value === "dark" ? "dark" : "light";
}

function storageOrDefault(storage?: ThemeStorage | null): ThemeStorage | null {
  if (storage !== undefined) return storage;
  try { return typeof localStorage === "undefined" ? null : localStorage; }
  catch { return null; }
}

export function readTheme(storage?: ThemeStorage | null): Theme {
  try { return parseTheme(storageOrDefault(storage)?.getItem(THEME_STORAGE_KEY)); }
  catch { return "light"; }
}

export function applyTheme(theme: Theme, root?: ThemeRoot | null): void {
  const target = root === undefined ? (typeof document === "undefined" ? null : document.documentElement) : root;
  if (!target) return;
  const valid = parseTheme(theme);
  target.setAttribute("data-theme", valid);
  // Explicitly match Chromium's native selects, scrollbars and other controls
  // to the app instead of leaving their appearance to the operating system.
  target.style.colorScheme = valid;
}

let currentTheme: Theme = "light";
const listeners = new Set<() => void>();
function publish(theme: Theme) {
  if (currentTheme === theme) return;
  currentTheme = theme;
  listeners.forEach(listener => listener());
}

/** Call once before React rendering; no preference is written during startup. */
export function initializeTheme(environment: ThemeEnvironment = {}): Theme {
  const theme = readTheme(environment.storage);
  applyTheme(theme, environment.root);
  publish(theme);
  return theme;
}

/** Storage failure does not prevent changing the current window's appearance. */
export function setTheme(theme: Theme, environment: ThemeEnvironment = {}): boolean {
  const valid = parseTheme(theme);
  applyTheme(valid, environment.root);
  publish(valid);
  try {
    const storage = storageOrDefault(environment.storage);
    if (!storage) return false;
    storage.setItem(THEME_STORAGE_KEY, valid);
    return true;
  } catch { return false; }
}

export function getTheme(): Theme { return currentTheme; }
export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function useTheme() {
  const theme = useSyncExternalStore(subscribeTheme, getTheme, () => "light" as Theme);
  return { theme, setTheme };
}
