import type { CaptureMode } from "./liveCapture";

export const CAPTURE_PREFERENCES_KEY = "voicesubsep-capture-preferences-v1";
const MAX_BYTES = 4096;
export type CapturePreferences = { mode: CaptureMode; deviceId: string; deviceLabel: string };
export type CapturePreferencesStatus = "default" | "saved" | "invalid" | "unavailable";
type PreferencesStorage = Pick<Storage, "getItem" | "setItem">;

export function defaultCapturePreferences(): CapturePreferences {
  return { mode: "microphone", deviceId: "", deviceLabel: "" };
}
function checked(value: unknown): CapturePreferences {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid capture preferences");
  const row = value as Record<string, unknown>;
  if (Object.keys(row).sort().join(",") !== "deviceId,deviceLabel,mode" ||
      !["microphone", "system", "both"].includes(row.mode as string) ||
      typeof row.deviceId !== "string" || row.deviceId.length > 1024 || row.deviceId.trim() !== row.deviceId ||
      ["default", "communications"].includes(row.deviceId) ||
      typeof row.deviceLabel !== "string" || row.deviceLabel.length > 512 ||
      /[\u0000-\u001f\u007f]/u.test(row.deviceId + row.deviceLabel) ||
      (!row.deviceId && row.deviceLabel !== "")) throw new Error("Invalid capture preferences");
  return { mode: row.mode as CaptureMode, deviceId: row.deviceId, deviceLabel: row.deviceLabel };
}

/** Reading preferences never opens a device, writes defaults or discards a corrupt value. */
export function loadCapturePreferences(storage?: PreferencesStorage): { settings: CapturePreferences; status: CapturePreferencesStatus } {
  const fallback = defaultCapturePreferences();
  let raw: string | null;
  try { raw = (storage ?? localStorage).getItem(CAPTURE_PREFERENCES_KEY); }
  catch { return { settings: fallback, status: "unavailable" }; }
  if (raw === null) return { settings: fallback, status: "default" };
  try {
    if (raw.length > MAX_BYTES || new TextEncoder().encode(raw).byteLength > MAX_BYTES) throw new Error("Too large");
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value) || !Object.hasOwn(value, "version")) throw new Error("Invalid version");
    const { version, ...settings } = value as Record<string, unknown>;
    if (version !== 1) throw new Error("Invalid version");
    return { settings: checked(settings), status: "saved" };
  } catch { return { settings: fallback, status: "invalid" }; }
}

/** Call only when the user changes a source/device; enumeration must not pick a substitute. */
export function saveCapturePreferences(settings: CapturePreferences, storage?: PreferencesStorage): { ok: boolean } {
  try {
    const raw = JSON.stringify({ version: 1, ...checked(settings) });
    if (new TextEncoder().encode(raw).byteLength > MAX_BYTES) return { ok: false };
    (storage ?? localStorage).setItem(CAPTURE_PREFERENCES_KEY, raw);
    return { ok: true };
  } catch { return { ok: false }; }
}
