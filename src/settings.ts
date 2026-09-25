import type { Locale } from "./i18n";
import { ASR_LANGUAGES, ASR_LANGUAGE_STORAGE_KEY } from "./languages";
import { defaultVstSettings, importVstSettings, VST_SETTINGS_FORMAT, VST_STORAGE_KEY, type VstSettings } from "./vst";

export const ANALYSIS_STORAGE_KEY = "voicesubsep-analysis-settings-v1";
export const MAX_SETTINGS_BYTES = 2 * 1024 * 1024;
const LOCALE_STORAGE_KEY = "voicesubsep-ui-locale";
const whisperModels = ["large-v3", "large-v3-turbo", "medium", "small", "base", "tiny"] as const;
const localeValues = ["ko", "en", "ja", "zh", "es"] as const;

export type AnalysisPreferences = {
  whisperModel: typeof whisperModels[number];
  device: "cuda" | "cpu";
  language: string;
  diarization: boolean;
  speakerBoundaryMs: 0 | 200 | 500 | 800;
  localAsrEngine?: "whisper" | "qwen";
  qwenModel?: "0.6b" | "1.7b";
  diarizationProvider?: "nemotron" | "deepgram";
};
export type AppSettings = {
  format: "voicesubsep-settings";
  version: 1;
  locale: Locale;
  analysis: AnalysisPreferences;
  vst: VstSettings;
};
export type SettingsStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type SettingsSaveResult = { ok: boolean; error?: string };
export type AnalysisLoadResult = {
  settings: AnalysisPreferences;
  status: "saved" | "default" | "migrated" | "invalid" | "unavailable";
};
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const invalid = (): never => { throw new Error("설정 파일 형식이 올바르지 않습니다."); };
const validLanguage = (value: unknown): value is string => value === "auto" || (typeof value === "string" && (ASR_LANGUAGES as readonly string[]).includes(value));

export function defaultAnalysisPreferences(): AnalysisPreferences {
  return { whisperModel: "large-v3", device: "cuda", language: "auto", diarization: true, speakerBoundaryMs: 500 };
}

/** Validate the complete value before returning an independently owned preference. */
export function checkedAnalysisPreferences(value: unknown): AnalysisPreferences {
  const optional = ["localAsrEngine", "qwenModel", "diarizationProvider"];
  if (!record(value) || !exactKeys(value, ["whisperModel", "device", "language", "diarization", "speakerBoundaryMs", ...optional.filter(key => Object.hasOwn(value, key))]) ||
    !(whisperModels as readonly unknown[]).includes(value.whisperModel) || (value.device !== "cuda" && value.device !== "cpu") ||
    !validLanguage(value.language) || typeof value.diarization !== "boolean" || ![0, 200, 500, 800].includes(value.speakerBoundaryMs as number)) return invalid();
  if ((value.localAsrEngine !== undefined && (typeof value.localAsrEngine !== "string" || !["whisper", "qwen"].includes(value.localAsrEngine))) ||
      (value.qwenModel !== undefined && (typeof value.qwenModel !== "string" || !["0.6b", "1.7b"].includes(value.qwenModel))) ||
      (value.diarizationProvider !== undefined && (typeof value.diarizationProvider !== "string" || !["nemotron", "deepgram"].includes(value.diarizationProvider)))) return invalid();
  return { whisperModel: value.whisperModel as AnalysisPreferences["whisperModel"], device: value.device as AnalysisPreferences["device"],
    language: value.language, diarization: value.diarization, speakerBoundaryMs: value.speakerBoundaryMs as AnalysisPreferences["speakerBoundaryMs"],
    ...(value.localAsrEngine !== undefined ? { localAsrEngine: value.localAsrEngine as "whisper" | "qwen" } : {}),
    ...(value.qwenModel !== undefined ? { qwenModel: value.qwenModel as "0.6b" | "1.7b" } : {}),
    ...(value.diarizationProvider !== undefined ? { diarizationProvider: value.diarizationProvider as "nemotron" | "deepgram" } : {}) };
}

function analysisJson(settings: AnalysisPreferences): string {
  return JSON.stringify({ version: 1, ...checkedAnalysisPreferences(settings) });
}

function parseSavedAnalysis(raw: string): AnalysisPreferences {
  if (raw.length > 4096) return invalid();
  const value: unknown = JSON.parse(raw);
  if (!record(value) || value.version !== 1) return invalid();
  const { version: _version, ...settings } = value;
  return checkedAnalysisPreferences(settings);
}

export function loadAnalysisPreferences(storage?: SettingsStorage): AnalysisLoadResult {
  const fallback = defaultAnalysisPreferences();
  try {
    const target = storage ?? localStorage;
    const raw = target.getItem(ANALYSIS_STORAGE_KEY);
    if (raw !== null) {
      try { return { settings: parseSavedAnalysis(raw), status: "saved" }; }
      catch { return { settings: fallback, status: "invalid" }; }
    }
    const legacyLanguage = target.getItem(ASR_LANGUAGE_STORAGE_KEY);
    if (legacyLanguage !== null && validLanguage(legacyLanguage)) return { settings: { ...fallback, language: legacyLanguage }, status: "migrated" };
    return { settings: fallback, status: "default" };
  } catch { return { settings: fallback, status: "unavailable" }; }
}

export function saveAnalysisPreferences(settings: AnalysisPreferences, storage?: SettingsStorage): SettingsSaveResult {
  try {
    const raw = analysisJson(settings);
    (storage ?? localStorage).setItem(ANALYSIS_STORAGE_KEY, raw);
    return { ok: true };
  } catch { return { ok: false, error: "분석 설정을 저장하지 못했습니다." }; }
}

/** A runtime fallback must never overwrite the user's preferred device. */
export function effectiveAnalysisDevice(preferred: AnalysisPreferences["device"], gpuAvailable: boolean | undefined): AnalysisPreferences["device"] {
  return preferred === "cuda" && gpuAvailable === false ? "cpu" : preferred;
}

/** Import is read-only: no storage writes, plug-in loading, or model execution. */
export function importAppSettings(raw: string): AppSettings {
  if (typeof raw !== "string" || raw.length > MAX_SETTINGS_BYTES || new TextEncoder().encode(raw).length > MAX_SETTINGS_BYTES) return invalid();
  let value: unknown;
  try { value = JSON.parse(raw.replace(/^\uFEFF/u, "")); } catch { return invalid(); }
  if (!record(value) || !exactKeys(value, ["format", "version", "locale", "analysis", "vst"]) || value.format !== "voicesubsep-settings" || value.version !== 1 ||
    !(localeValues as readonly unknown[]).includes(value.locale)) return invalid();
  const analysis = checkedAnalysisPreferences(value.analysis);
  if (!record(value.vst)) return invalid();
  const vst = importVstSettings(JSON.stringify({ format: VST_SETTINGS_FORMAT, version: 1, settings: value.vst }));
  return { format: "voicesubsep-settings", version: 1, locale: value.locale as Locale, analysis, vst };
}

export function serializeAppSettings(settings: AppSettings): string {
  const raw = JSON.stringify(importAppSettings(JSON.stringify(settings)), null, 2);
  if (new TextEncoder().encode(raw).length > MAX_SETTINGS_BYTES) return invalid();
  return raw;
}

export function loadAppSettings(locale: Locale, storage?: SettingsStorage): AppSettings {
  // A backup must preserve readable preferences, never silently substitute defaults
  // for corrupt or inaccessible data. Missing preferences still use first-run defaults.
  const target = storage ?? localStorage;
  const analysisRaw = target.getItem(ANALYSIS_STORAGE_KEY);
  let analysis = defaultAnalysisPreferences();
  if (analysisRaw !== null) analysis = parseSavedAnalysis(analysisRaw);
  else {
    const legacyLanguage = target.getItem(ASR_LANGUAGE_STORAGE_KEY);
    if (legacyLanguage !== null) {
      if (!validLanguage(legacyLanguage)) return invalid();
      analysis.language = legacyLanguage;
    }
  }
  const vstRaw = target.getItem(VST_STORAGE_KEY);
  let vst = defaultVstSettings();
  if (vstRaw !== null) {
    if (vstRaw.length > MAX_SETTINGS_BYTES || new TextEncoder().encode(vstRaw).length > MAX_SETTINGS_BYTES) return invalid();
    const stored: unknown = JSON.parse(vstRaw.replace(/^\uFEFF/u, ""));
    if (!record(stored) || !exactKeys(stored, ["version", "enabled", "applyTo", "chain"]) || stored.version !== 1) return invalid();
    const { version: _version, ...settings } = stored;
    vst = importVstSettings(JSON.stringify({ format: VST_SETTINGS_FORMAT, version: 1, settings }));
  }
  return importAppSettings(JSON.stringify({ format: "voicesubsep-settings", version: 1, locale, analysis, vst }));
}

/** Validate and serialize every entry first, then restore prior bytes on a failed write. */
export function saveAppSettings(settings: AppSettings, storage?: SettingsStorage): SettingsSaveResult {
  let target: SettingsStorage;
  let entries: [string, string][];
  let previous: [string, string | null][];
  try {
    const checked = importAppSettings(JSON.stringify(settings));
    entries = [
      [LOCALE_STORAGE_KEY, checked.locale],
      [ANALYSIS_STORAGE_KEY, analysisJson(checked.analysis)],
      [VST_STORAGE_KEY, JSON.stringify({ version: 1, ...checked.vst })],
      [ASR_LANGUAGE_STORAGE_KEY, checked.analysis.language],
    ];
    target = storage ?? localStorage;
    previous = entries.map(([key]) => [key, target.getItem(key)]);
  } catch { return { ok: false, error: "설정을 저장하지 못했습니다. 기존 설정을 유지합니다." }; }
  let written = 0;
  try {
    for (const [key, value] of entries) { target.setItem(key, value); written += 1; }
    return { ok: true };
  } catch {
    let restored = true;
    for (let index = written - 1; index >= 0; index -= 1) {
      const [key, value] = previous[index]!;
      try { if (value === null) target.removeItem(key); else target.setItem(key, value); }
      catch { restored = false; }
    }
    return { ok: false, error: restored ? "설정을 저장하지 못했습니다. 기존 설정을 유지합니다." : "설정 저장과 복원에 실패했습니다. 저장 공간을 확인한 뒤 설정을 다시 불러오세요." };
  }
}
