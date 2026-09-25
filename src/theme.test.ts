import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  THEME_PALETTES, THEME_STORAGE_KEY, applyTheme, getTheme, initializeTheme,
  parseTheme, readTheme, setTheme, subscribeTheme, type ThemeRoot, type ThemeStorage,
} from "./theme";
import { themeMessages } from "./i18n-theme";

function environment(initial: string | null = null) {
  const values = new Map<string, string>(initial === null ? [] : [[THEME_STORAGE_KEY, initial]]);
  const attributes = new Map<string, string>();
  const storage: ThemeStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } };
  const root: ThemeRoot = { setAttribute: (key, value) => { attributes.set(key, value); }, style: { colorScheme: "" } };
  return { storage, root, values, attributes };
}

beforeEach(() => initializeTheme({ storage: null, root: null }));

describe("explicit appearance preference", () => {
  it("defaults to light and accepts only explicit saved values", () => {
    for (const invalid of [null, undefined, "system", "DARK", "{}", 1, { value: "dark" }]) expect(parseTheme(invalid)).toBe("light");
    expect(parseTheme("dark")).toBe("dark");
    expect(parseTheme("light")).toBe("light");
    const e = environment("dark");
    expect(initializeTheme(e)).toBe("dark");
    expect(getTheme()).toBe("dark");
    expect(e.attributes.get("data-theme")).toBe("dark");
    expect(e.root.style.colorScheme).toBe("dark");
    expect(e.values.size).toBe(1);
  });

  it("persists only the theme and restores native controls before rendering", () => {
    const e = environment(); e.values.set("unrelated-project", "preserved");
    expect(setTheme("dark", e)).toBe(true);
    expect(readTheme(e.storage)).toBe("dark");
    expect(e.values.get("unrelated-project")).toBe("preserved");
    expect(initializeTheme({ storage: e.storage, root: e.root })).toBe("dark");
    setTheme("light", e);
    expect(e.root.style.colorScheme).toBe("light");
    expect(e.attributes.get("data-theme")).toBe("light");
  });

  it("applies appearance even if storage is blocked and does not overwrite unreadable settings", () => {
    let writes = 0;
    const e = environment();
    const unavailable: ThemeStorage = { getItem: () => { throw new Error("blocked"); }, setItem: () => { writes++; throw new Error("quota"); } };
    expect(initializeTheme({ storage: unavailable, root: e.root })).toBe("light");
    expect(writes).toBe(0);
    expect(setTheme("dark", { storage: unavailable, root: e.root })).toBe(false);
    expect(e.root.style.colorScheme).toBe("dark");
    expect(getTheme()).toBe("dark");
    expect(setTheme("light", { storage: null, root: e.root })).toBe(false);
  });

  it("updates all mounted selectors and unsubscribes cleanly", () => {
    const e = environment(); const seen: string[] = [];
    const remove = subscribeTheme(() => seen.push(getTheme()));
    setTheme("dark", e); setTheme("dark", e); setTheme("light", e);
    expect(seen).toEqual(["dark", "light"]);
    remove(); setTheme("dark", e);
    expect(seen).toEqual(["dark", "light"]);
    expect(() => applyTheme("dark", null)).not.toThrow();
  });
});

function luminance(hex: string): number {
  const rgb = hex.slice(1).match(/../g)!.map(value => parseInt(value, 16) / 255)
    .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2];
}
function contrast(a: string, b: string): number {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + .05) / (values[1] + .05);
}

describe("shared appearance palette", () => {
  it("keeps CSS surfaces in sync with speaker contrast helpers and readable text", () => {
    const css = readFileSync(new URL("./theme.css", import.meta.url), "utf8");
    const properties = { background: "app-bg", surface: "surface", surfaceAlt: "surface-alt", text: "ink", muted: "muted", accent: "purple" } as const;
    for (const theme of ["light", "dark"] as const) {
      const rule = css.match(new RegExp(`:root\\[data-theme="${theme}"\\]\\s*\\{([^}]+)\\}`))![1];
      const palette = THEME_PALETTES[theme];
      for (const [key, property] of Object.entries(properties)) expect(rule).toContain(`--${property}: ${palette[key as keyof typeof properties]};`);
      for (const background of [palette.background, palette.surface, palette.surfaceAlt]) {
        expect(contrast(palette.text, background)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(palette.muted, background)).toBeGreaterThanOrEqual(4.5);
      }
      expect(contrast(palette.onAccent, palette.accent)).toBeGreaterThanOrEqual(4.5);
      expect(rule).toContain(`color-scheme: ${theme};`);
    }
  });

  it("provides all selector labels in the four translated locales", () => {
    const source = readFileSync(new URL("./components/ThemeSelector.tsx", import.meta.url), "utf8");
    const keys = [...source.matchAll(/\bt\("([^"]+)"\)/g)].map(match => match[1]);
    for (const key of keys) {
      expect(themeMessages[key]).toHaveLength(4);
      expect(themeMessages[key].every(value => value.trim().length > 0)).toBe(true);
    }
  });
});
