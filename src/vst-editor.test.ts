import { describe, expect, it } from "vitest";
import { applyVstEditorResult, checkedEditor, defaultVstSettings, importVstSettings, MAX_VST_STATE_BYTES, parseVstSettings, serializeVstSettings, validVstState, vstRequest, type VstSlot } from "./vst";

const slot: VstSlot = { id: "clear", name: "Clear", path: "C:\\Plugins\\Clear.vst3", pluginName: "Clear", enabled: true, parameters: { gain: 2 }, state: btoa("preset-with-hidden-data") };
const result = { path: slot.path, name: slot.name, pluginName: slot.pluginName, state: btoa("changed-hidden-data"), parameters: [{ key: "gain", label: "Gain", type: "number", value: 5, min: 0, max: 10 }] };

describe("native VST state preservation", () => {
  it("supports optional RNNoise-only chains without requiring a VST plugin", () => {
    const settings = { enabled: true, applyTo: "asr" as const, chain: [], noiseReduction: { engine: "rnnoise" as const, mix: 0.7 } };
    const restored = importVstSettings(serializeVstSettings(settings));
    expect(restored).toEqual(settings);
    expect(vstRequest(restored)).toEqual({ applyTo: "asr", chain: [], noiseReduction: settings.noiseReduction });
    expect(vstRequest({ ...settings, enabled: false })).toBeUndefined();
    for (const noiseReduction of [{ engine: "other", mix: 0.7 }, {engine:"rnnoise",mix:-1}, {engine:"rnnoise",mix:2}, {engine:"rnnoise",mix:"1"}]) {
      expect(parseVstSettings(JSON.stringify({version:1,...settings,noiseReduction}))).toEqual(defaultVstSettings());
    }
  });
  it("round trips hidden state through autosave, portable preset and processing request", () => {
    const settings = { enabled: true, applyTo: "asr" as const, chain: [slot] };
    const restored = importVstSettings(serializeVstSettings(settings));
    expect(restored).toEqual(settings);
    expect(parseVstSettings(JSON.stringify({ version: 1, ...settings }))).toEqual(settings);
    expect(vstRequest(restored)?.chain[0]).toEqual({ path: slot.path, pluginName: slot.pluginName, enabled: true, state: slot.state, parameters: { gain: 2 } });
  });
  it("accepts bounded canonical base64, rejects bad padding, whitespace and decoded overflow", () => {
    expect(validVstState("")).toBe(true);
    expect(validVstState(btoa("a".repeat(MAX_VST_STATE_BYTES)))).toBe(true);
    for (const value of [null, 2, "YQ", "YQ==\n", "YR==", "!!!", btoa("a".repeat(MAX_VST_STATE_BYTES + 1))]) expect(validVstState(value)).toBe(false);
  });
  it("never partially restores invalid saved state", () => {
    const settings = { enabled: true, applyTo: "asr", chain: [{ ...slot, state: "broken" }] };
    expect(parseVstSettings(JSON.stringify({ version: 1, ...settings }))).toEqual(defaultVstSettings());
    expect(() => importVstSettings(JSON.stringify({ format: "voicesubsep-vst-settings", version: 1, settings }))).toThrow();
  });
  it("rejects coerced processing scopes before replacing current settings", () => {
    for (const applyTo of [["asr"], ["both"], null, 1, {}]) {
      const settings = { enabled: true, applyTo, chain: [slot] };
      expect(parseVstSettings(JSON.stringify({ version: 1, ...settings }))).toEqual(defaultVstSettings());
      expect(() => importVstSettings(JSON.stringify({ format: "voicesubsep-vst-settings", version: 1, settings }))).toThrow();
    }
  });
});

describe("native editor response ownership", () => {
  it("accepts completed settings bound to the requested plugin and session", () => {
    const next = checkedEditor({ id: "session", status: "completed", result }, slot, "session");
    expect(next.result?.state).toBe(result.state);
    const original = { enabled: true, applyTo: "asr" as const, chain: [slot] };
    const updated = applyVstEditorResult(original, slot, next.result!);
    expect(updated.chain[0]?.parameters.gain).toBe(5);
    expect(updated.chain[0]?.state).toBe(result.state);
    expect(original.chain[0]?.parameters.gain).toBe(2);
  });
  it("rejects stale or wrong-plugin responses and malformed state", () => {
    for (const data of [
      { id: "other", status: "completed", result },
      { id: "session", status: "completed", result: { ...result, path: "C:\\Wrong.vst3" } },
      { id: "session", status: "completed", result: { ...result, pluginName: "Other" } },
      { id: "session", status: "completed", result: { ...result, state: "YQ" } },
      { id: "session", status: "cancelled", result },
      { id: "session", status: "completed" },
    ]) expect(() => checkedEditor(data, slot, "session")).toThrow();
  });
  it("rejects coerced statuses so a running editor cannot be mistaken for terminal", () => {
    for (const status of [["queued"], ["running"], ["completed"], ["failed"], ["cancelled"], null, 1]) {
      expect(() => checkedEditor({ id: "session", status }, slot, "session")).toThrow();
    }
  });
  it("keeps newer settings or a replaced project instead of applying a late native result", () => {
    const settings = { enabled: true, applyTo: "asr" as const, chain: [slot] };
    const next = checkedEditor({ id: "s", status: "completed", result }, slot).result!;
    for (const modified of [
      { ...settings, chain: [] },
      { ...settings, chain: [{ ...slot, parameters: { gain: 7 } }] },
      { ...settings, chain: [{ ...slot, state: btoa("newer") }] },
      { ...settings, chain: [{ ...slot, path: "C:\\Another.vst3" }] },
    ]) expect(applyVstEditorResult(modified, slot, next)).toBe(modified);
  });
});
