import { request } from "./api";

export const VST_STORAGE_KEY = "voicesubsep-vst-chain-v1";
export const MAX_VST_SLOTS = 4;
export const MAX_VST_SETTINGS_BYTES = 2 * 1024 * 1024;
export const VST_SETTINGS_FORMAT = "voicesubsep-vst-settings";
export type VstValue = string | number | boolean;
export type VstSlotRequest = {
  path: string;
  pluginName?: string;
  enabled: boolean;
  parameters: Record<string, VstValue>;
};
export type VstSlot = VstSlotRequest & { id: string; name: string };
export type VstSettings = { enabled: boolean; applyTo: "asr" | "both"; chain: VstSlot[] };
export type VstPreprocessing = { chain: VstSlotRequest[]; applyTo: "asr" | "both" };
export type VstParameter = {
  key: string;
  label: string;
  type: "number" | "boolean" | "string";
  value: VstValue;
  min?: number;
  max?: number;
  step?: number;
  choices?: string[];
};
export type VstInspection = {
  path: string;
  plugins?: string[];
  pluginName?: string;
  name?: string;
  parameters?: VstParameter[];
};
export type VstStatus = { available: boolean; version: string | null; issue: string | null };
export type VstPlugins = { plugins: { path: string; name: string }[]; roots: string[] };
export type VstPluginReport = { pluginName: string; reportedLatencySamples?: number; [key: string]: unknown };
export type VstReport = {
  warnings?: string[];
  sampleRate?: number;
  plugins?: VstPluginReport[];
  totalReportedLatencySamples?: number;
  latencyCompensation?: string;
  [key: string]: unknown;
};
export type VstPreview = {
  id: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  progress?: number;
  error?: string;
  originalUrl?: string;
  processedUrl?: string;
  report?: VstReport | null;
};
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const safeText = (value: unknown, max = 4096): value is string => typeof value === "string" && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/u.test(value);
const valueValid = (value: unknown): value is VstValue => typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value)) || (typeof value === "string" && value.length <= 1024 && !/[\u0000-\u001f\u007f]/u.test(value));
const keyValid = (value: unknown): value is string => safeText(value, 256) && !value.startsWith("_") && !["constructor", "prototype"].includes(value);
const fail = (): never => { throw new Error("VST 응답 형식이 올바르지 않습니다."); };

export function defaultVstSettings(): VstSettings {
  return { enabled: false, applyTo: "asr", chain: [] };
}

const settingsFailure = (): never => { throw new Error("VST 설정 파일이 올바르지 않거나 지원하지 않는 버전입니다."); };
const onlyKeys = (data: Record<string, unknown>, keys: string[]) => Object.keys(data).every((key) => keys.includes(key));

function checkedSettings(data: unknown): VstSettings {
  if (!record(data) || !onlyKeys(data, ["enabled", "applyTo", "chain"]) || typeof data.enabled !== "boolean" || !["asr", "both"].includes(String(data.applyTo)) || !Array.isArray(data.chain) || data.chain.length > MAX_VST_SLOTS) return settingsFailure();
  const ids = new Set<string>();
  const chain = data.chain.map((item): VstSlot => {
    if (!record(item) || !onlyKeys(item, ["id", "name", "path", "pluginName", "enabled", "parameters"]) || !safeText(item.id, 128) || !keyValid(item.id) || Object.hasOwn(Object.prototype, item.id) || ids.has(item.id) || !safeText(item.name, 512) || !safeText(item.path, 2048) || !/^[a-z]:[\\/].*\.vst3$/iu.test(item.path) || item.path.split(/[\\/]/u).includes("..") || typeof item.enabled !== "boolean" || (item.pluginName !== undefined && !safeText(item.pluginName, 512)) || !record(item.parameters) || Object.keys(item.parameters).length > 256) return settingsFailure();
    const parameters: Record<string, VstValue> = {};
    for (const [key, value] of Object.entries(item.parameters)) {
      if (!keyValid(key) || !valueValid(value)) return settingsFailure();
      parameters[key] = value;
    }
    ids.add(item.id);
    return { id: item.id, name: item.name, path: item.path, enabled: item.enabled, parameters, ...(item.pluginName === undefined ? {} : { pluginName: item.pluginName as string }) };
  });
  return { enabled: data.enabled, applyTo: data.applyTo as VstSettings["applyTo"], chain };
}

function boundedSettingsJson(raw: string): unknown {
  if (typeof raw !== "string" || raw.length > MAX_VST_SETTINGS_BYTES || new TextEncoder().encode(raw).byteLength > MAX_VST_SETTINGS_BYTES) throw new Error("VST 설정 파일은 2MB 이하여야 합니다.");
  try { return JSON.parse(raw.replace(/^\uFEFF/u, "")); } catch { return settingsFailure(); }
}

/** Versioned application presets contain values only; parsing never loads a native plugin. */
export function serializeVstSettings(settings: VstSettings): string {
  const raw = `${JSON.stringify({ format: VST_SETTINGS_FORMAT, version: 1, settings: checkedSettings(settings) }, null, 2)}\n`;
  boundedSettingsJson(raw);
  return raw;
}

/** Invalid imports throw before the caller replaces any current settings. */
export function importVstSettings(raw: string): VstSettings {
  const data = boundedSettingsJson(raw);
  if (!record(data) || !onlyKeys(data, ["format", "version", "settings"]) || data.format !== VST_SETTINGS_FORMAT || data.version !== 1) return settingsFailure();
  return checkedSettings(data.settings);
}

/** A corrupt preference never enables native plug-in execution or partially restores a chain. */
export function parseVstSettings(raw: string | null): VstSettings {
  if (!raw) return defaultVstSettings();
  try {
    const data = boundedSettingsJson(raw);
    if (!record(data) || data.version !== 1 || !onlyKeys(data, ["version", "enabled", "applyTo", "chain"])) return defaultVstSettings();
    const { version: _version, ...settings } = data;
    return checkedSettings(settings);
  } catch { return defaultVstSettings(); }
}

export function loadVstSettings(): VstSettings {
  try { return parseVstSettings(localStorage.getItem(VST_STORAGE_KEY)); } catch { return defaultVstSettings(); }
}
export function saveVstSettings(settings: VstSettings): boolean {
  try {
    const raw = JSON.stringify({ version: 1, ...checkedSettings(settings) });
    boundedSettingsJson(raw);
    localStorage.setItem(VST_STORAGE_KEY, raw);
    return true;
  } catch { return false; }
}

/** Native execution receives only values, never presentation or inspection metadata. */
export function vstRequest(settings: VstSettings): VstPreprocessing | undefined {
  if (!settings.enabled || !settings.chain.some((slot) => slot.enabled)) return undefined;
  return { applyTo: settings.applyTo, chain: settings.chain.map(({ path, pluginName, enabled, parameters }) => ({
    path, ...(pluginName === undefined ? {} : { pluginName }), enabled, parameters: { ...parameters },
  })) };
}

export function moveVstSlot(settings: VstSettings, id: string, direction: -1 | 1): VstSettings {
  const index = settings.chain.findIndex((slot) => slot.id === id);
  const next = index + direction;
  if (index < 0 || next < 0 || next >= settings.chain.length) return settings;
  const chain = [...settings.chain];
  [chain[index], chain[next]] = [chain[next]!, chain[index]!];
  return { ...settings, chain };
}

export function validParameterValue(parameter: VstParameter, value: VstValue): boolean {
  if (!valueValid(value) || typeof value !== parameter.type) return false;
  if (typeof value === "number" && ((parameter.min !== undefined && value < parameter.min) || (parameter.max !== undefined && value > parameter.max))) return false;
  return !parameter.choices?.length || (typeof value === "string" && parameter.choices.includes(value));
}

export function checkedInspection(value: unknown, path: string, pluginName?: string): VstInspection {
  const comparablePath = (input: string) => input.replace(/\//gu, "\\").toLocaleLowerCase("en-US");
  if (!record(value) || !safeText(value.path) || comparablePath(value.path) !== comparablePath(path)) return fail();
  if (value.parameters === undefined) {
    if (!Array.isArray(value.plugins) || !value.plugins.length || value.plugins.length > 256 || !value.plugins.every((item) => safeText(item, 512)) || new Set(value.plugins).size !== value.plugins.length) return fail();
    return { path, plugins: value.plugins as string[] };
  }
  if (!Array.isArray(value.parameters) || value.parameters.length > 256 || (value.pluginName !== undefined && !safeText(value.pluginName, 512)) || (pluginName !== undefined && value.pluginName !== pluginName) || (value.name !== undefined && !safeText(value.name, 512))) return fail();
  const keys = new Set<string>();
  const parameters = value.parameters.map((raw): VstParameter => {
    if (!record(raw) || !keyValid(raw.key) || keys.has(raw.key) || !safeText(raw.label, 512) || !["number", "boolean", "string"].includes(String(raw.type))) return fail();
    for (const key of ["min", "max", "step"]) if (raw[key] !== undefined && (typeof raw[key] !== "number" || !Number.isFinite(raw[key]))) return fail();
    if (typeof raw.step === "number" && raw.step <= 0) return fail();
    if (typeof raw.min === "number" && typeof raw.max === "number" && raw.min > raw.max) return fail();
    if (raw.choices !== undefined && (!Array.isArray(raw.choices) || raw.choices.length > 2048 || !raw.choices.every((item) => typeof item === "string" && valueValid(item)))) return fail();
    const parameter = { key: raw.key, label: raw.label, type: raw.type, value: raw.value, min: raw.min, max: raw.max, step: raw.step, choices: raw.choices } as VstParameter;
    if (!validParameterValue(parameter, parameter.value)) return fail();
    keys.add(parameter.key);
    return parameter;
  });
  return { path, pluginName: value.pluginName as string | undefined, name: value.name as string | undefined, parameters };
}

export async function inspectVst(path: string, pluginName?: string): Promise<VstInspection> {
  const result: unknown = await request("/api/vst/inspect", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path, ...(pluginName ? { pluginName } : {}) }),
    signal: AbortSignal.timeout(90_000),
  });
  return checkedInspection(result, path, pluginName);
}

export function checkedPreview(value: unknown): VstPreview {
  if (!record(value) || typeof value.id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/u.test(value.id) || !["queued", "running", "completed", "failed", "cancelled"].includes(String(value.status)) || (value.progress !== undefined && (typeof value.progress !== "number" || !Number.isFinite(value.progress) || value.progress < 0 || value.progress > 1))) return fail();
  if (value.error !== undefined && typeof value.error !== "string") return fail();
  if (value.report != null && (!record(value.report) || (value.report.warnings !== undefined && (!Array.isArray(value.report.warnings) || value.report.warnings.length > 1024 || value.report.warnings.some((warning) => typeof warning !== "string" || warning.length > 8000))))) return fail();
  if (record(value.report)) {
    const report = value.report;
    const validSamples = (samples: unknown, maximum: number) => typeof samples === "number" && Number.isInteger(samples) && samples >= 0 && samples <= maximum;
    if (report.sampleRate !== undefined && report.sampleRate !== 48000) return fail();
    if (report.latencyCompensation !== undefined && !safeText(report.latencyCompensation, 512)) return fail();
    if (report.totalReportedLatencySamples !== undefined && !validSamples(report.totalReportedLatencySamples, 1_920_000)) return fail();
    if (report.plugins !== undefined) {
      if (!Array.isArray(report.plugins) || report.plugins.length > MAX_VST_SLOTS) return fail();
      for (const plugin of report.plugins) {
        if (!record(plugin) || !safeText(plugin.pluginName, 512) || (plugin.reportedLatencySamples !== undefined && !validSamples(plugin.reportedLatencySamples, 480_000))) return fail();
      }
      if (report.totalReportedLatencySamples !== undefined && report.plugins.every((plugin) => plugin.reportedLatencySamples !== undefined) &&
        report.plugins.reduce((sum, plugin) => sum + plugin.reportedLatencySamples, 0) !== report.totalReportedLatencySamples) return fail();
    }
  }
  for (const key of ["originalUrl", "processedUrl"]) {
    const url = value[key];
    if (url !== undefined && (typeof url !== "string" || !url.startsWith("/api/vst/previews/") || /[\\\u0000-\u0020]/u.test(url) || url.includes(".."))) return fail();
  }
  if (value.status === "completed" && (!value.originalUrl || !value.processedUrl)) return fail();
  return value as VstPreview;
}

/** Display a compensation claim only when a completed report supplies consistent per-plugin evidence. */
export function vstLatencySummary(preview: VstPreview | null): {
  plugins: { name: string; samples: number; milliseconds: number }[];
  totalSamples: number;
  totalMilliseconds: number;
} | null {
  const report = preview?.report;
  if (preview?.status !== "completed" || report?.latencyCompensation !== "plugin-reported" || report.sampleRate !== 48000 ||
    !report.plugins?.length || report.totalReportedLatencySamples === undefined || report.plugins.some((plugin) => plugin.reportedLatencySamples === undefined)) return null;
  return {
    plugins: report.plugins.map((plugin) => ({ name: plugin.pluginName, samples: plugin.reportedLatencySamples!, milliseconds: plugin.reportedLatencySamples! / report.sampleRate! * 1000 })),
    totalSamples: report.totalReportedLatencySamples,
    totalMilliseconds: report.totalReportedLatencySamples / report.sampleRate * 1000,
  };
}
