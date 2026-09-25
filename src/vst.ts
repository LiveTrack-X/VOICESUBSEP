import { request } from "./api";

export const VST_STORAGE_KEY = "voicesubsep-vst-chain-v1";
export const MAX_VST_SLOTS = 4;
export const MAX_VST_SETTINGS_BYTES = 2 * 1024 * 1024;
export const MAX_VST_STATE_BYTES = 256 * 1024;
export const VST_SETTINGS_FORMAT = "voicesubsep-vst-settings";
export type VstValue = string | number | boolean;
export type VstSlotRequest = {
  path: string;
  pluginName?: string;
  enabled: boolean;
  parameters: Record<string, VstValue>;
  state?: string;
};
export type VstSlot = VstSlotRequest & { id: string; name: string };
export type NoiseReduction = { engine: "rnnoise"; mix: number };
export type VstSettings = { enabled: boolean; applyTo: "asr" | "both"; chain: VstSlot[]; noiseReduction?: NoiseReduction };
export type VstPreprocessing = { chain: VstSlotRequest[]; applyTo: "asr" | "both"; noiseReduction?: NoiseReduction };
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
  state?: string;
};
export type VstEditor = {
  id: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  stage?: "starting" | "loading" | "opening" | "open";
  closeRequested?: boolean;
  cancelRequested?: boolean;
  result?: VstInspection;
  error?: string;
};
export type VstStatus = { available: boolean; version: string | null; issue: string | null; noiseReduction?: { engine: "rnnoise"; available: boolean; issue?: string | null } };
export type VstPlugins = { plugins: { path: string; name: string }[]; roots: string[] };
export type VstResidualMeasurement = {
  status: "verified" | "corrected" | "uncertain";
  reason: string; measuredSamples: number | null; appliedSamples: number; confidence: number;
  matchedWindows: number; examinedWindows: number; maxSearchSamples: number;
};
export type VstPluginReport = { pluginName: string; reportedLatencySamples?: number; residualMeasurement?: VstResidualMeasurement; [key: string]: unknown };
export type VstReport = {
  warnings?: string[];
  sampleRate?: number;
  plugins?: VstPluginReport[];
  totalReportedLatencySamples?: number;
  totalMeasuredResidualSamples?: number;
  totalCompensatedLatencySamples?: number;
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

/** Bounded opaque state is restored only by the isolated native worker. */
export function validVstState(value: unknown): value is string {
  if (typeof value !== "string" || value.length > Math.ceil(MAX_VST_STATE_BYTES / 3) * 4) return false;
  try {
    const decoded = atob(value);
    return decoded.length <= MAX_VST_STATE_BYTES && btoa(decoded) === value;
  } catch { return false; }
}

export function defaultVstSettings(): VstSettings {
  return { enabled: false, applyTo: "asr", chain: [] };
}

const settingsFailure = (): never => { throw new Error("VST 설정 파일이 올바르지 않거나 지원하지 않는 버전입니다."); };
const onlyKeys = (data: Record<string, unknown>, keys: string[]) => Object.keys(data).every((key) => keys.includes(key));

function checkedSettings(data: unknown): VstSettings {
  if (!record(data) || !onlyKeys(data, ["enabled", "applyTo", "chain", "noiseReduction"]) || typeof data.enabled !== "boolean" || typeof data.applyTo !== "string" || !["asr", "both"].includes(data.applyTo) || !Array.isArray(data.chain) || data.chain.length > MAX_VST_SLOTS) return settingsFailure();
  if (data.noiseReduction !== undefined && (!record(data.noiseReduction) || !onlyKeys(data.noiseReduction, ["engine", "mix"]) || data.noiseReduction.engine !== "rnnoise" || typeof data.noiseReduction.mix !== "number" || !Number.isFinite(data.noiseReduction.mix) || data.noiseReduction.mix < 0 || data.noiseReduction.mix > 1)) return settingsFailure();
  const ids = new Set<string>();
  const chain = data.chain.map((item): VstSlot => {
    if (!record(item) || !onlyKeys(item, ["id", "name", "path", "pluginName", "enabled", "parameters", "state"]) || !safeText(item.id, 128) || !keyValid(item.id) || Object.hasOwn(Object.prototype, item.id) || ids.has(item.id) || !safeText(item.name, 512) || !safeText(item.path, 2048) || !/^[a-z]:[\\/].*\.vst3$/iu.test(item.path) || item.path.split(/[\\/]/u).includes("..") || typeof item.enabled !== "boolean" || (item.pluginName !== undefined && !safeText(item.pluginName, 512)) || !record(item.parameters) || Object.keys(item.parameters).length > 256) return settingsFailure();
    if (item.state !== undefined && !validVstState(item.state)) return settingsFailure();
    const parameters: Record<string, VstValue> = {};
    for (const [key, value] of Object.entries(item.parameters)) {
      if (!keyValid(key) || !valueValid(value)) return settingsFailure();
      parameters[key] = value;
    }
    ids.add(item.id);
    return { id: item.id, name: item.name, path: item.path, enabled: item.enabled, parameters, ...(item.state === undefined ? {} : { state: item.state as string }), ...(item.pluginName === undefined ? {} : { pluginName: item.pluginName as string }) };
  });
  return { enabled: data.enabled, applyTo: data.applyTo as VstSettings["applyTo"], chain, ...(data.noiseReduction === undefined ? {} : { noiseReduction: { ...(data.noiseReduction as NoiseReduction) } }) };
}

function boundedSettingsJson(raw: string): unknown {
  if (typeof raw !== "string" || raw.length > MAX_VST_SETTINGS_BYTES || new TextEncoder().encode(raw).byteLength > MAX_VST_SETTINGS_BYTES) throw new Error("VST 설정 파일은 2MB 이하여야 합니다.");
  try { return JSON.parse(raw.replace(/^\uFEFF/u, "")); } catch { return settingsFailure(); }
}

/** Versioned application presets contain values and optional native state; parsing never loads a native plugin. */
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
    if (!record(data) || data.version !== 1 || !onlyKeys(data, ["version", "enabled", "applyTo", "chain", "noiseReduction"])) return defaultVstSettings();
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

/** Native execution receives settings and optional state, never presentation metadata. */
export function vstRequest(settings: VstSettings): VstPreprocessing | undefined {
  if (!settings.enabled || (!settings.noiseReduction && !settings.chain.some((slot) => slot.enabled))) return undefined;
  return { applyTo: settings.applyTo, ...(settings.noiseReduction ? { noiseReduction: { ...settings.noiseReduction } } : {}), chain: settings.chain.map(({ path, pluginName, enabled, parameters, state }) => ({
    path, ...(pluginName === undefined ? {} : { pluginName }), enabled, parameters: { ...parameters }, ...(state === undefined ? {} : { state }),
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

export function checkedEditor(value: unknown, slot: VstSlotRequest, expectedId?: string): VstEditor {
  if (!record(value) || typeof value.id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/u.test(value.id) ||
      (expectedId !== undefined && value.id !== expectedId) ||
      typeof value.status !== "string" || !["queued", "running", "completed", "failed", "cancelled"].includes(value.status) ||
      (value.error !== undefined && (typeof value.error !== "string" || value.error.length > 8000)) ||
      (value.stage !== undefined && (typeof value.stage !== "string" || !["starting", "loading", "opening", "open"].includes(value.stage))) ||
      (value.closeRequested !== undefined && typeof value.closeRequested !== "boolean") ||
      (value.cancelRequested !== undefined && typeof value.cancelRequested !== "boolean")) return fail();
  const next = { id: value.id, status: value.status, stage: value.stage, error: value.error, closeRequested: value.closeRequested, cancelRequested: value.cancelRequested } as VstEditor;
  if (value.status === "completed") {
    const result = checkedInspection(value.result, slot.path, slot.pluginName);
    if (!result.parameters || !record(value.result) || (value.result.state !== undefined && !validVstState(value.result.state))) return fail();
    next.result = { ...result, ...(value.result.state === undefined ? {} : { state: value.result.state as string }) };
  } else if (value.result !== undefined) return fail();
  return next;
}

/** Preserve a newer slot if an old editor response arrives after a project/settings change. */
export function applyVstEditorResult(settings: VstSettings, original: VstSlot, result: VstInspection): VstSettings {
  const current = settings.chain.find((slot) => slot.id === original.id);
  if (!current || current.path !== original.path || current.pluginName !== original.pluginName ||
      current.state !== original.state || JSON.stringify(current.parameters) !== JSON.stringify(original.parameters) || !result.parameters) return settings;
  const updated: VstSlot = { ...current, name: result.name ?? current.name, pluginName: result.pluginName ?? current.pluginName,
    parameters: Object.fromEntries(result.parameters.map((parameter) => [parameter.key, parameter.value])) };
  if (result.state === undefined) delete updated.state;
  else updated.state = result.state;
  return { ...settings, chain: settings.chain.map((slot) => slot.id === original.id ? updated : slot) };
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
        if (plugin.residualMeasurement !== undefined) {
          const m=plugin.residualMeasurement;
          if (!record(m) || !["verified","corrected","uncertain"].includes(String(m.status)) || !safeText(m.reason,128) ||
              !validSamples(m.appliedSamples,11_999) || typeof m.confidence!=="number" || !Number.isFinite(m.confidence) || m.confidence<0 || m.confidence>1 ||
              !validSamples(m.matchedWindows,7) || !validSamples(m.examinedWindows,7) || (m.matchedWindows as number)>(m.examinedWindows as number) || m.maxSearchSamples!==12_000) return fail();
          if (m.status==="uncertain") {if(m.appliedSamples!==0||m.measuredSamples!==null)return fail();}
          else if(m.measuredSamples!==m.appliedSamples || m.confidence<.9 || (m.matchedWindows as number)<3 ||
                  (m.status==="verified"?m.appliedSamples!==0:m.appliedSamples===0))return fail();
        }
      }
      if (report.totalReportedLatencySamples !== undefined && report.plugins.every((plugin) => plugin.reportedLatencySamples !== undefined) &&
        report.plugins.reduce((sum, plugin) => sum + plugin.reportedLatencySamples, 0) !== report.totalReportedLatencySamples) return fail();
    }
    if(report.latencyCompensation==="plugin-reported+verified-residual") {
      if(report.sampleRate!==48000 || !Array.isArray(report.plugins) || !report.plugins.length ||
          report.plugins.some(plugin=>!plugin.residualMeasurement||plugin.reportedLatencySamples===undefined) ||
          !validSamples(report.totalReportedLatencySamples,480_000) || !validSamples(report.totalMeasuredResidualSamples,47_996) || !validSamples(report.totalCompensatedLatencySamples,527_996) ||
          report.compensatedLatencySamples!==report.totalReportedLatencySamples ||
          report.plugins.reduce((sum,plugin)=>sum+plugin.residualMeasurement.appliedSamples,0)!==report.totalMeasuredResidualSamples ||
          (report.totalReportedLatencySamples as number)+(report.totalMeasuredResidualSamples as number)!==report.totalCompensatedLatencySamples) return fail();
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
  plugins: { name: string; samples: number; milliseconds: number; residual?: VstResidualMeasurement }[];
  totalSamples: number;
  totalMilliseconds: number;
  residualChecked?: boolean;
} | null {
  const report = preview?.report;
  if (preview?.status !== "completed" || !["plugin-reported","plugin-reported+verified-residual"].includes(report?.latencyCompensation??"") || report?.sampleRate !== 48000 ||
    !report.plugins?.length || report.totalReportedLatencySamples === undefined || report.plugins.some((plugin) => plugin.reportedLatencySamples === undefined)) return null;
  const measured=report.latencyCompensation==="plugin-reported+verified-residual";
  const totalSamples=measured?report.totalCompensatedLatencySamples!:report.totalReportedLatencySamples;
  return {
    plugins: report.plugins.map((plugin) => ({ name: plugin.pluginName, samples: plugin.reportedLatencySamples!, milliseconds: plugin.reportedLatencySamples! / report.sampleRate! * 1000,
      ...(measured?{residual:plugin.residualMeasurement}:{}) })),
    totalSamples,
    totalMilliseconds: totalSamples / report.sampleRate * 1000,
    ...(measured?{residualChecked:true}:{}),
  };
}
