import { describe, expect, it, vi } from "vitest";
import { vstMessages } from "./i18n-vst";
import { checkedInspection, checkedPreview, defaultVstSettings, importVstSettings, loadVstSettings, MAX_VST_SETTINGS_BYTES, moveVstSlot, parseVstSettings, saveVstSettings, serializeVstSettings, validParameterValue, vstLatencySummary, vstRequest, VST_SETTINGS_FORMAT, VST_STORAGE_KEY, type VstParameter, type VstSettings } from "./vst";

const path = "C:\\Program Files\\Common Files\\VST3\\Clear.vst3";
function settings(): VstSettings {
  return { enabled: true, applyTo: "asr", chain: [
    { id: "clear", name: "Clear", path, pluginName: "Clear", enabled: true, parameters: { ambience_gain: -12, voice_solo: false, program: "Studio" } },
    { id: "rx", name: "RX", path: "C:\\Plugins\\RX.vst3", enabled: false, parameters: {} },
  ] };
}
const stored = (value: unknown) => JSON.stringify({ version: 1, ...(value as object) });
const parameter: VstParameter = { key: "reduction", label: "Reduction", type: "number", value: 12, min: 0, max: 24 };

describe("VST application settings files", () => {
  const envelope = (value: unknown) => JSON.stringify({ format: VST_SETTINGS_FORMAT, version: 1, settings: value });
  it("round trips order, bypass, scope, disabled state and typed overrides", () => {
    const original = moveVstSlot({ ...settings(), enabled: false, applyTo: "both" }, "rx", -1);
    const serialized = serializeVstSettings(original);
    expect(JSON.parse(serialized)).toEqual({ format: VST_SETTINGS_FORMAT, version: 1, settings: original });
    const restored = importVstSettings(serialized);
    expect(restored).toEqual(original);
    expect(restored).not.toBe(original);
    expect(restored.chain[1]!.parameters).not.toBe(original.chain[1]!.parameters);
    expect(vstRequest(restored)).toBeUndefined();
    expect(importVstSettings(`\uFEFF${serialized}`)).toEqual(original);
  });
  it("restores an empty disabled chain and missing local plugin without running native code", () => {
    expect(importVstSettings(serializeVstSettings(defaultVstSettings()))).toEqual(defaultVstSettings());
    const config = { ...settings(), chain: [{ ...settings().chain[0]!, path: "D:\\Missing Plugins\\Effect.vst3" }] };
    const fetch = vi.fn(() => { throw new Error("Import must not execute a request"); });
    vi.stubGlobal("fetch", fetch);
    try {
      expect(importVstSettings(envelope(config))).toEqual(config);
      expect(fetch).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
  it.each([
    "broken", "null", "[]", stored(settings()),
    JSON.stringify({ format: "vendor-preset", version: 1, settings: settings() }),
    JSON.stringify({ format: VST_SETTINGS_FORMAT, version: 2, settings: settings() }),
    JSON.stringify({ format: VST_SETTINGS_FORMAT, version: 1, settings: settings(), script: "execute" }),
    envelope({ ...settings(), unexpected: true }),
    envelope({ ...settings(), enabled: "yes" }),
    envelope({ ...settings(), applyTo: "export" }),
    envelope({ ...settings(), chain: [...settings().chain, settings().chain[0]] }),
    envelope({ ...settings(), chain: [{ ...settings().chain[0], id: "constructor" }] }),
    envelope({ ...settings(), chain: [{ ...settings().chain[0], id: "hasOwnProperty" }] }),
    envelope({ ...settings(), chain: [{ ...settings().chain[0], script: "execute" }] }),
    envelope({ ...settings(), chain: [{ ...settings().chain[0], path: "relative.vst3" }] }),
    envelope({ ...settings(), chain: [{ ...settings().chain[0], path: "\\\\server\\share\\Effect.vst3" }] }),
    envelope({ ...settings(), chain: [{ ...settings().chain[0], path: "C:\\Plugins\\..\\Effect.vst3" }] }),
    envelope({ ...settings(), chain: [{ ...settings().chain[0], parameters: { bad: { value: 1 } } }] }),
    envelope({ ...settings(), chain: [{ ...settings().chain[0], parameters: { constructor: "bad" } }] }),
    envelope({ ...settings(), chain: [{ ...settings().chain[0], parameters: { bad: null } }] }),
  ])("rejects malformed imports without falling back or changing the current values: %s", (raw) => {
    const current = settings();
    const before = structuredClone(current);
    expect(() => { const next = importVstSettings(raw); Object.assign(current, next); }).toThrow();
    expect(current).toEqual(before);
  });
  it("enforces a byte limit before parsing including multibyte content", () => {
    expect(() => importVstSettings(" ".repeat(MAX_VST_SETTINGS_BYTES + 1))).toThrow("2MB");
    const unicode = "가".repeat(Math.floor(MAX_VST_SETTINGS_BYTES / 3) + 1);
    expect(unicode.length).toBeLessThan(MAX_VST_SETTINGS_BYTES);
    expect(() => importVstSettings(unicode)).toThrow("2MB");
  });
  it("rejects invalid values during serialization rather than silently coercing them", () => {
    expect(() => serializeVstSettings({ ...settings(), chain: [{ ...settings().chain[0]!, parameters: { bad: Infinity } }] })).toThrow();
    expect(() => serializeVstSettings({ ...settings(), chain: [{ ...settings().chain[0]!, parameters: { bad: NaN } }] })).toThrow();
  });
  it("keeps the existing autosave format and reports write failure explicitly", () => {
    const values = new Map<string, string>();
    const setItem = vi.fn((key: string, value: string) => { values.set(key, value); });
    vi.stubGlobal("localStorage", { setItem, getItem: (key: string) => values.get(key) ?? null });
    try {
      expect(saveVstSettings(settings())).toBe(true);
      expect(JSON.parse(values.get(VST_STORAGE_KEY)!)).toEqual({ version: 1, ...settings() });
      expect(loadVstSettings()).toEqual(settings());
      setItem.mockImplementation(() => { throw new Error("quota exceeded"); });
      expect(saveVstSettings(defaultVstSettings())).toBe(false);
      expect(loadVstSettings()).toEqual(settings());
    } finally { vi.unstubAllGlobals(); }
  });
});

describe("VST preference and execution boundary", () => {
  it("defaults to disabled and ASR-only processing", () => {
    expect(defaultVstSettings()).toEqual({ enabled: false, applyTo: "asr", chain: [] });
    expect(parseVstSettings(null)).toEqual(defaultVstSettings());
    expect(vstRequest(defaultVstSettings())).toBeUndefined();
  });
  it("round trips explicit overrides and bypassed slots without exposing UI metadata", () => {
    const original = settings();
    const restored = parseVstSettings(stored(original));
    expect(restored).toEqual(original);
    const result = vstRequest(restored)!;
    expect(result).toEqual({ applyTo: "asr", chain: original.chain.map(({ id: _id, name: _name, ...slot }) => slot) });
    result.chain[0]!.parameters.ambience_gain = -30;
    expect(original.chain[0]!.parameters.ambience_gain).toBe(-12);
    expect(restored.chain[0]!.parameters.ambience_gain).toBe(-12);
  });
  it("omits processing when globally disabled or every slot is bypassed", () => {
    expect(vstRequest({ ...settings(), enabled: false })).toBeUndefined();
    expect(vstRequest({ ...settings(), chain: settings().chain.map((slot) => ({ ...slot, enabled: false })) })).toBeUndefined();
  });
  it.each([
    "not json", "null", "[]", JSON.stringify({ version: 2, ...settings() }),
    stored({ ...settings(), enabled: "yes" }), stored({ ...settings(), applyTo: "export" }),
    stored({ ...settings(), chain: [{ ...settings().chain[0], path: "effect.dll" }] }),
    stored({ ...settings(), chain: [{ ...settings().chain[0], parameters: { bad: null } }] }),
    stored({ ...settings(), chain: [{ ...settings().chain[0], parameters: { bad: { value: 1 } } }] }),
    stored({ ...settings(), chain: [{ ...settings().chain[0], parameters: { bad: "x".repeat(1025) } }] }),
    stored({ ...settings(), chain: [{ ...settings().chain[0], parameters: { ["k".repeat(257)]: 2 } }] }),
    stored({ ...settings(), chain: Array.from({ length: 5 }, (_, index) => ({ ...settings().chain[0], id: String(index) })) }),
    stored({ ...settings(), chain: [settings().chain[0], settings().chain[0]] }),
    '{"version":1,"enabled":true,"applyTo":"asr","chain":[{"id":"p","name":"P","path":"P.vst3","enabled":true,"parameters":{"__proto__":3}}]}',
  ])("invalid saved configuration never partially activates a chain: %s", (raw) => {
    expect(parseVstSettings(raw)).toEqual(defaultVstSettings());
  });
  it("keeps order stable for no-op moves and reorders immutably", () => {
    const original = settings();
    expect(moveVstSlot(original, "clear", -1)).toBe(original);
    expect(moveVstSlot(original, "missing", 1)).toBe(original);
    expect(moveVstSlot(original, "rx", 1)).toBe(original);
    expect(moveVstSlot(original, "rx", -1).chain.map((slot) => slot.id)).toEqual(["rx", "clear"]);
    expect(original.chain.map((slot) => slot.id)).toEqual(["clear", "rx"]);
  });
});

describe("VST plugin metadata", () => {
  it("keeps multiple-plugin discovery separate from successful parameter inspection", () => {
    expect(checkedInspection({ path, plugins: ["Voice", "Music"] }, path)).toEqual({ path, plugins: ["Voice", "Music"] });
    const result = checkedInspection({ path, pluginName: "Voice", name: "Voice", parameters: [parameter] }, path, "Voice");
    expect(result.parameters?.[0]).toEqual(parameter);
    expect(checkedInspection({ path: path.replace(/\\/g, "/").toLowerCase(), parameters: [] }, path).parameters).toEqual([]);
    expect(() => checkedInspection({ path, pluginName: "Music", parameters: [] }, path, "Voice")).toThrow();
    expect(() => checkedInspection({ path: "other.vst3", parameters: [] }, path)).toThrow();
  });
  it("accepts number, boolean and enum values but rejects out-of-range or type mismatch", () => {
    expect(validParameterValue(parameter, 0)).toBe(true);
    expect(validParameterValue(parameter, 24)).toBe(true);
    for (const value of [-1, 25, NaN, Infinity, true, "12"]) expect(validParameterValue(parameter, value)).toBe(false);
    expect(validParameterValue({ key: "bypass", label: "Bypass", type: "boolean", value: false }, true)).toBe(true);
    const program: VstParameter = { key: "program", label: "Program", type: "string", value: "Default", choices: ["Default", "Voice"] };
    expect(validParameterValue(program, "Voice")).toBe(true);
    expect(validParameterValue(program, "Unknown")).toBe(false);
  });
  it.each([
    [{ ...parameter, value: 100 }], [{ ...parameter, min: 30, max: 2 }], [{ ...parameter, step: 0 }],
    [{ ...parameter, key: "__proto__" }], [parameter, parameter], [{ ...parameter, type: "array" }],
    [{ key: "program", label: "Program", type: "string", value: "Missing", choices: ["Default"] }],
  ])("rejects unusable or ambiguous controls: %j", (...parameters) => {
    expect(() => checkedInspection({ path, parameters }, path)).toThrow();
  });
  it("rejects empty or duplicate bundle choices", () => {
    expect(() => checkedInspection({ path, plugins: [] }, path)).toThrow();
    expect(() => checkedInspection({ path, plugins: ["Same", "Same"] }, path)).toThrow();
  });
});

describe("VST preview result safety", () => {
  const base = { id: "preview-1", status: "completed", originalUrl: "/api/vst/previews/preview-1/original", processedUrl: "/api/vst/previews/preview-1/processed" };
  it("accepts only local preview assets and completed results with both A/B files", () => {
    expect(checkedPreview(base)).toEqual(base);
    expect(checkedPreview({ id: "p", status: "queued", progress: 0 })).toEqual({ id: "p", status: "queued", progress: 0 });
    expect(() => checkedPreview({ ...base, originalUrl: undefined })).toThrow();
    expect(() => checkedPreview({ ...base, progress: 2 })).toThrow();
    expect(() => checkedPreview({ ...base, progress: NaN })).toThrow();
    expect(() => checkedPreview({ ...base, status: "unknown" })).toThrow();
    expect(() => checkedPreview({ ...base, id: ".." })).toThrow();
    expect(checkedPreview({ ...base, report: { warnings: ["Latency could not be verified."] } }).report?.warnings).toEqual(["Latency could not be verified."]);
    expect(() => checkedPreview({ ...base, report: { warnings: [1] } })).toThrow();
    expect(() => checkedPreview({ ...base, report: { warnings: "not an array" } })).toThrow();
  });
  it.each(["https://remote.test/file.wav", "//remote.test/file.wav", "file:///secret.wav", "/api/vst/previews/../media.wav", "/api/vst/previews/\\remote.wav"]) ("rejects remote or escaping preview URL %s", (url) => {
    expect(() => checkedPreview({ ...base, processedUrl: url })).toThrow();
  });
});

describe("VST translations", () => {
  it("provides every locale and preserves interpolated parameter names", () => {
    for (const [key, translations] of Object.entries(vstMessages)) {
      expect(translations).toHaveLength(4);
      const tokens = [...key.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
      for (const text of translations) {
        expect(text.trim()).not.toBe("");
        expect([...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()).toEqual(tokens);
      }
    }
  });
});

describe("per-plugin automatic latency compensation evidence", () => {
  const result = { id: "latency", status: "completed", originalUrl: "/api/vst/previews/latency/original", processedUrl: "/api/vst/previews/latency/processed" };
  const report = { sampleRate: 48000, latencyCompensation: "plugin-reported", plugins: [
    { pluginName: "Clear", reportedLatencySamples: 2238 },
    { pluginName: "RX", reportedLatencySamples: 480 },
  ], totalReportedLatencySamples: 2718 };
  it("converts each plugin and total from 48 kHz samples to milliseconds", () => {
    expect(vstLatencySummary(checkedPreview({ ...result, report }))).toEqual({
      plugins: [{ name: "Clear", samples: 2238, milliseconds: 46.625 }, { name: "RX", samples: 480, milliseconds: 10 }],
      totalSamples: 2718, totalMilliseconds: 56.625,
    });
  });
  it("retains zero latency and accepts the exact per-plugin and chain limits", () => {
    expect(vstLatencySummary(checkedPreview({ ...result, report: { ...report, plugins: [{ pluginName: "Zero", reportedLatencySamples: 0 }], totalReportedLatencySamples: 0 } }))?.totalMilliseconds).toBe(0);
    const maximum = { ...report, plugins: Array.from({ length: 4 }, (_, index) => ({ pluginName: `Plugin ${index}`, reportedLatencySamples: 480_000 })), totalReportedLatencySamples: 1_920_000 };
    expect(vstLatencySummary(checkedPreview({ ...result, report: maximum }))?.totalMilliseconds).toBe(40_000);
  });
  it("does not claim compensation for incomplete, legacy, unknown-mode or unfinished reports", () => {
    const reports = [undefined, null, {}, { warnings: [] }, { sampleRate: 48000, plugins: [{ pluginName: "Old plugin", parameters: {} }] },
      { ...report, totalReportedLatencySamples: undefined }, { ...report, sampleRate: undefined },
      { ...report, latencyCompensation: "unknown" }, { ...report, plugins: [{ pluginName: "Old plugin" }] }];
    for (const previous of reports) expect(vstLatencySummary(checkedPreview({ ...result, report: previous }))).toBeNull();
    expect(vstLatencySummary(checkedPreview({ ...result, status: "running", report }))).toBeNull();
    expect(vstLatencySummary(checkedPreview({ ...result, status: "failed", report }))).toBeNull();
    expect(vstLatencySummary(null)).toBeNull();
  });
  it.each([-1, 0.5, 480001, Infinity, NaN, "1", true])("rejects invalid per-plugin sample count %s", (samples) => {
    expect(() => checkedPreview({ ...result, report: { ...report, plugins: [{ pluginName: "Bad", reportedLatencySamples: samples }], totalReportedLatencySamples: undefined } })).toThrow();
  });
  it.each([-1, 0.5, 1920001, Infinity, NaN, "1", true])("rejects invalid total sample count %s", (samples) => {
    expect(() => checkedPreview({ ...result, report: { ...report, totalReportedLatencySamples: samples } })).toThrow();
  });
  it("rejects contradictory totals, wrong sample rates, excess plugins and missing names", () => {
    expect(() => checkedPreview({ ...result, report: { ...report, totalReportedLatencySamples: 999 } })).toThrow();
    expect(() => checkedPreview({ ...result, report: { ...report, sampleRate: 44100 } })).toThrow();
    expect(() => checkedPreview({ ...result, report: { ...report, plugins: Array.from({ length: 5 }, () => report.plugins[0]) } })).toThrow();
    expect(() => checkedPreview({ ...result, report: { ...report, plugins: [{ reportedLatencySamples: 2718 }] } })).toThrow();
  });
});
