import { describe, expect, it } from "vitest";
import { defaultShortcuts, loadShortcuts, SHORTCUT_STORAGE_KEY } from "./shortcuts";
import { defaultAnalysisPreferences, importAppSettings, loadAppSettings, saveAppSettings, serializeAppSettings, type AppSettings } from "./settings";

function storage() {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}
const legacy: AppSettings = { format: "voicesubsep-settings", version: 1, locale: "ko", analysis: defaultAnalysisPreferences(), vst: { enabled: false, applyTo: "asr", chain: [] } };

describe("custom shortcut backup compatibility", () => {
  it("includes saved shortcuts in settings export and restores them independently", () => {
    const target = storage();
    const wanted = { ...legacy, shortcuts: { ...defaultShortcuts(), play: "KeyP", open: null } };
    expect(saveAppSettings(importAppSettings(serializeAppSettings(wanted)), target).ok).toBe(true);
    expect(loadShortcuts(target).bindings).toEqual(wanted.shortcuts);
    expect(loadAppSettings("ko", target)).toEqual(wanted);
  });
  it("imports old backups without clearing the user's current custom shortcuts", () => {
    const target = storage();
    const raw = JSON.stringify({ version: 1, bindings: { ...defaultShortcuts(), play: "KeyP" } });
    target.values.set(SHORTCUT_STORAGE_KEY, raw);
    expect(saveAppSettings(importAppSettings(JSON.stringify(legacy)), target).ok).toBe(true);
    expect(target.getItem(SHORTCUT_STORAGE_KEY)).toBe(raw);
  });
  it("rejects a conflicting imported key before changing any settings", () => {
    const target = storage(); target.values.set("unrelated-project", "preserved");
    const before = [...target.values];
    expect(saveAppSettings({ ...legacy, shortcuts: { ...defaultShortcuts(), open: "Mod+KeyS" } }, target).ok).toBe(false);
    expect([...target.values]).toEqual(before);
  });
  it("rolls back earlier preference writes when the shortcut write fails", () => {
    const target = storage(); target.values.set("voicesubsep-ui-locale", "en");
    const before = [...target.values];
    const failing = { ...target, setItem(key: string, value: string) { if (key === SHORTCUT_STORAGE_KEY) throw new Error("quota"); target.setItem(key, value); } };
    expect(saveAppSettings({ ...legacy, shortcuts: defaultShortcuts() }, failing).ok).toBe(false);
    expect([...target.values]).toEqual(before);
  });
  it("refuses to export damaged shortcut storage as supposedly saved defaults", () => {
    const target = storage(); target.values.set(SHORTCUT_STORAGE_KEY, "broken");
    expect(() => loadAppSettings("ko", target)).toThrow();
    expect(target.getItem(SHORTCUT_STORAGE_KEY)).toBe("broken");
  });
});
