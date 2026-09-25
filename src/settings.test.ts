import { describe, expect, it } from "vitest";
import { ASR_LANGUAGE_STORAGE_KEY } from "./languages";
import {
  ANALYSIS_STORAGE_KEY, MAX_SETTINGS_BYTES, checkedAnalysisPreferences, defaultAnalysisPreferences,
  effectiveAnalysisDevice, importAppSettings, loadAnalysisPreferences, loadAppSettings, saveAnalysisPreferences,
  saveAppSettings, serializeAppSettings, type AppSettings, type SettingsStorage,
} from "./settings";
import { parseVstSettings, VST_STORAGE_KEY } from "./vst";

class MemoryStorage implements SettingsStorage {
  values = new Map<string, string>();
  writes = 0;
  failAtWrite = -1;
  failReads = false;
  failPermanentlyAfter = -1;
  getItem(key: string) {
    if (this.failReads) throw new Error("Storage unavailable");
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.writes += 1;
    if (this.writes === this.failAtWrite || (this.failPermanentlyAfter >= 0 && this.writes >= this.failPermanentlyAfter)) throw new Error("Quota exceeded");
    this.values.set(key, value);
  }
  removeItem(key: string) { this.values.delete(key); }
}

function appSettings(): AppSettings {
  return {
    format: "voicesubsep-settings", version: 1, locale: "ja",
    analysis: { whisperModel: "large-v3-turbo", device: "cpu", language: "ko", diarization: false, speakerBoundaryMs: 200 },
    vst: { enabled: true, applyTo: "asr", chain: [
      { id: "clear", name: "CLEAR", path: "C:\\Program Files\\Common Files\\VST3\\Clear.vst3", pluginName: "CLEAR", enabled: true, parameters: { ambience_gain: -12, eco_mode: true } },
      { id: "rx", name: "RX", path: "C:\\Plugins\\RX.vst3", enabled: false, parameters: {} },
    ] },
  };
}

describe("analysis preferences", () => {
  it("preserves optional advanced choices while old settings keep local default engines", () => {
    const storage = new MemoryStorage();
    const legacy = defaultAnalysisPreferences();
    expect(legacy.localAsrEngine ?? "whisper").toBe("whisper");
    expect(legacy.diarizationProvider ?? "nemotron").toBe("nemotron");
    expect(legacy.diarization).toBe(true);
    const advanced = { ...legacy, localAsrEngine: "qwen" as const, qwenModel: "0.6b" as const, diarizationProvider: "deepgram" as const };
    expect(saveAnalysisPreferences(advanced, storage).ok).toBe(true);
    expect(loadAnalysisPreferences(storage).settings).toEqual(advanced);
    const backup = { ...appSettings(), analysis: advanced };
    expect(importAppSettings(serializeAppSettings(backup)).analysis).toEqual(advanced);
    expect(() => checkedAnalysisPreferences({ ...advanced, cloudConsent: true })).toThrow();
    expect(() => checkedAnalysisPreferences({ ...advanced, apiKey: "secret" })).toThrow();
    expect(() => checkedAnalysisPreferences({ ...advanced, localAsrEngine: ["qwen"] })).toThrow();
  });
  it("has stable defaults, migrates the former language choice, and then uses canonical settings", () => {
    const storage = new MemoryStorage();
    expect(loadAnalysisPreferences(storage)).toEqual({ settings: defaultAnalysisPreferences(), status: "default" });
    storage.values.set(ASR_LANGUAGE_STORAGE_KEY, "ko");
    expect(loadAnalysisPreferences(storage)).toEqual({ settings: { ...defaultAnalysisPreferences(), language: "ko" }, status: "migrated" });
    const wanted = appSettings().analysis;
    expect(saveAnalysisPreferences(wanted, storage)).toEqual({ ok: true });
    storage.values.set(ASR_LANGUAGE_STORAGE_KEY, "fr");
    expect(loadAnalysisPreferences(storage)).toEqual({ settings: wanted, status: "saved" });
  });

  it.each(["auto", "en", "ja", "zh", "es", "yue"])("migrates supported old language %s without writing during load", (language) => {
    const storage = new MemoryStorage();
    storage.values.set(ASR_LANGUAGE_STORAGE_KEY, language);
    expect(loadAnalysisPreferences(storage).settings.language).toBe(language);
    expect(storage.writes).toBe(0);
  });

  it("keeps invalid stored settings distinct from unavailable storage and does not mutate either", () => {
    const storage = new MemoryStorage();
    storage.values.set(ANALYSIS_STORAGE_KEY, "broken-json");
    storage.values.set(ASR_LANGUAGE_STORAGE_KEY, "ja");
    expect(loadAnalysisPreferences(storage)).toEqual({ settings: defaultAnalysisPreferences(), status: "invalid" });
    expect(storage.values.get(ANALYSIS_STORAGE_KEY)).toBe("broken-json");
    storage.failReads = true;
    expect(loadAnalysisPreferences(storage)).toEqual({ settings: defaultAnalysisPreferences(), status: "unavailable" });
  });

  it("reports failed autosave and preserves earlier preferences", () => {
    const storage = new MemoryStorage();
    expect(saveAnalysisPreferences(defaultAnalysisPreferences(), storage).ok).toBe(true);
    const before = storage.values.get(ANALYSIS_STORAGE_KEY);
    storage.failAtWrite = 2;
    expect(saveAnalysisPreferences(appSettings().analysis, storage)).toEqual({ ok: false, error: "분석 설정을 저장하지 못했습니다." });
    expect(storage.values.get(ANALYSIS_STORAGE_KEY)).toBe(before);
  });

  it("keeps CPU preferences when a GPU exists and computes unavailable GPU fallback without saving it", () => {
    const preference = defaultAnalysisPreferences();
    expect(effectiveAnalysisDevice(preference.device, undefined)).toBe("cuda");
    expect(effectiveAnalysisDevice(preference.device, false)).toBe("cpu");
    expect(effectiveAnalysisDevice(preference.device, true)).toBe("cuda");
    expect(preference.device).toBe("cuda");
    expect(effectiveAnalysisDevice("cpu", true)).toBe("cpu");
  });

  it.each([
    { whisperModel: "unknown" }, { device: "auto" }, { language: "invalid-code" }, { diarization: 1 },
    { speakerBoundaryMs: 201 }, { speakerBoundaryMs: "500" }, { audioTrack: 2 }, { modelPath: "C:\\private" },
  ])("rejects invalid or media-specific data %j", (patch) => {
    const settings = { ...defaultAnalysisPreferences(), ...patch };
    expect(() => checkedAnalysisPreferences(settings)).toThrow();
    const storage = new MemoryStorage();
    expect(saveAnalysisPreferences(settings as ReturnType<typeof defaultAnalysisPreferences>, storage).ok).toBe(false);
    expect(storage.writes).toBe(0);
  });
});

describe("application settings backup", () => {
  it("round trips locale, analysis, chain order, bypass, and parameter values without including project data", () => {
    const original = appSettings();
    const restored = importAppSettings(serializeAppSettings(original));
    expect(restored).toEqual(original);
    restored.vst.chain[0]!.parameters.ambience_gain = -30;
    expect(original.vst.chain[0]!.parameters.ambience_gain).toBe(-12);
    expect(Object.keys(restored).sort()).toEqual(["analysis", "format", "locale", "version", "vst"]);
    expect(importAppSettings(`\uFEFF${serializeAppSettings(original)}`)).toEqual(original);
  });

  it("restores storage in existing component formats and can export those settings again", () => {
    const storage = new MemoryStorage();
    const wanted = appSettings();
    expect(saveAppSettings(wanted, storage)).toEqual({ ok: true });
    expect(loadAnalysisPreferences(storage).settings).toEqual(wanted.analysis);
    expect(parseVstSettings(storage.getItem(VST_STORAGE_KEY))).toEqual(wanted.vst);
    expect(storage.getItem("voicesubsep-ui-locale")).toBe("ja");
    expect(storage.getItem(ASR_LANGUAGE_STORAGE_KEY)).toBe("ko");
    expect(loadAppSettings("ja", storage)).toEqual(wanted);
  });

  it("backs up first-run defaults or a valid legacy language without writing storage", () => {
    const storage = new MemoryStorage();
    expect(loadAppSettings("ko", storage).analysis).toEqual(defaultAnalysisPreferences());
    expect(loadAppSettings("ko", storage).vst).toEqual({ enabled: false, applyTo: "asr", chain: [] });
    storage.values.set(ASR_LANGUAGE_STORAGE_KEY, "ja");
    expect(loadAppSettings("en", storage).analysis.language).toBe("ja");
    expect(storage.writes).toBe(0);
  });

  it.each([
    [ANALYSIS_STORAGE_KEY, "broken-json"], [ANALYSIS_STORAGE_KEY, ""], [ASR_LANGUAGE_STORAGE_KEY, "unknown"],
    [VST_STORAGE_KEY, "broken-json"], [VST_STORAGE_KEY, ""],
    [VST_STORAGE_KEY, JSON.stringify({ version: 2, ...appSettings().vst })],
    [VST_STORAGE_KEY, JSON.stringify({ version: 1, ...appSettings().vst, secret: "unexpected" })],
    [VST_STORAGE_KEY, JSON.stringify({ version: 1, ...appSettings().vst, chain: [{ ...appSettings().vst.chain[0], parameters: { bad: null } }] })],
  ])("refuses to replace corrupt stored preferences with defaults when exporting %s", (key, raw) => {
    const storage = new MemoryStorage();
    storage.values.set(key, raw);
    expect(() => loadAppSettings("ko", storage)).toThrow();
    expect(storage.getItem(key)).toBe(raw);
    expect(storage.writes).toBe(0);
  });

  it("refuses a backup when storage is inaccessible instead of claiming to export the preferences", () => {
    const storage = new MemoryStorage();
    storage.failReads = true;
    expect(() => loadAppSettings("ko", storage)).toThrow();
    expect(storage.writes).toBe(0);
  });

  it("rejects an export whose formatting exceeds the UTF-8 limit even though its compact value fits", () => {
    const original = appSettings();
    original.vst.chain = Array.from({ length: 4 }, (_, index) => ({
      id: `slot-${index}`, name: `Plugin ${index}`, path: `C:\\Plugins\\${index}.vst3`, enabled: true,
      parameters: Object.fromEntries(Array.from({ length: 256 }, (_, parameter) => [`key-${parameter}`, "가".repeat(501) + "x".repeat(523)])),
    }));
    const encoder = new TextEncoder();
    expect(encoder.encode(JSON.stringify(original)).length).toBeLessThanOrEqual(MAX_SETTINGS_BYTES);
    expect(encoder.encode(JSON.stringify(original, null, 2)).length).toBeGreaterThan(MAX_SETTINGS_BYTES);
    expect(() => serializeAppSettings(original)).toThrow();
  });

  it.each([
    { format: "other" }, { version: 2 }, { locale: "fr" }, { analysis: null }, { vst: null },
    { project: { captions: ["private"] } }, { mediaPath: "C:\\recording.wav" },
    { analysis: { ...defaultAnalysisPreferences(), speakerBoundaryMs: 999 } },
    { vst: { enabled: true, applyTo: "asr", chain: [{ id: "unsafe", name: "Effect", path: "https://host/effect.vst3", enabled: true, parameters: {} }] } },
    { vst: { ...appSettings().vst, unknown: true } },
  ])("rejects an entire invalid backup before any writes %j", (patch) => {
    const storage = new MemoryStorage();
    saveAppSettings(appSettings(), storage);
    const before = [...storage.values];
    const writes = storage.writes;
    const bad = { ...appSettings(), ...patch };
    expect(() => importAppSettings(JSON.stringify(bad))).toThrow();
    expect(saveAppSettings(bad as AppSettings, storage).ok).toBe(false);
    expect([...storage.values]).toEqual(before);
    expect(storage.writes).toBe(writes);
  });

  it.each(["not-json", "null", "[]", "{}", " ".repeat(MAX_SETTINGS_BYTES + 1)])("rejects malformed or oversized input", (raw) => {
    expect(() => importAppSettings(raw)).toThrow();
  });

  it("checks the UTF-8 byte limit before interpreting a file", () => {
    const raw = JSON.stringify({ ...appSettings(), padding: "한".repeat(Math.floor(MAX_SETTINGS_BYTES / 2)) });
    expect(raw.length).toBeLessThan(MAX_SETTINGS_BYTES);
    expect(new TextEncoder().encode(raw).length).toBeGreaterThan(MAX_SETTINGS_BYTES);
    expect(() => importAppSettings(raw)).toThrow();
  });

  it("rolls back both overwritten and newly created keys if a later write fails", () => {
    const storage = new MemoryStorage();
    storage.values.set("voicesubsep-ui-locale", "en");
    storage.values.set(VST_STORAGE_KEY, "original-plugin-settings");
    const before = [...storage.values];
    storage.failAtWrite = 3;
    expect(saveAppSettings(appSettings(), storage)).toEqual({ ok: false, error: "설정을 저장하지 못했습니다. 기존 설정을 유지합니다." });
    expect([...storage.values]).toEqual(before);
  });

  it("reports when the storage itself prevents rollback instead of claiming the old settings were kept", () => {
    const storage = new MemoryStorage();
    storage.values.set("voicesubsep-ui-locale", "en");
    storage.failPermanentlyAfter = 2;
    const result = saveAppSettings(appSettings(), storage);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("설정 저장과 복원에 실패했습니다. 저장 공간을 확인한 뒤 설정을 다시 불러오세요.");
  });

  it("does not write anything when original values cannot be read for rollback", () => {
    const storage = new MemoryStorage();
    storage.failReads = true;
    expect(saveAppSettings(appSettings(), storage).ok).toBe(false);
    expect(storage.writes).toBe(0);
  });
});
