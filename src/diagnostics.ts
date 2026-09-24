export const DIAGNOSTICS_STORAGE_KEY = "voicesubsep-client-errors-v1";
const MAX_ENTRIES = 100;
const MAX_STORAGE_CHARS = 200_000;
type LogStorage = Pick<Storage, "getItem" | "setItem">;
export type DiagnosticEntry = { timestamp: string; level: "error" | "warning"; source: string; event: string; message: string; count?: number };
export type ServerDiagnostics = { entries: DiagnosticEntry[]; persistence: { available: boolean }; appVersion: string };

/** Exports deliberately omit requests, media, captions, settings and stack traces. */
export function sanitizeDiagnostic(value: string): string {
  return value.slice(0, 8000).split(/[\r\n]/u)[0]!
    .replace(/\b(?:https?|file):\/\/[^\s<>]+/giu, "[url]")
    .replace(/\b[A-Za-z]:[\\/][^\r\n]*/gu, "[path]")
    .replace(/\\\\[^\r\n]*/gu, "[path]")
    .replace(/\/(?:home|Users|tmp|private|var|opt|mnt)\/[^\r\n]*/gu, "[path]")
    .replace(/\b(?:Bearer|Basic)\s+[^\s,;]+/giu, "[credential]")
    .replace(/["']?\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|secret|authorization)["']?\s*[=:]\s*(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;}]+)/giu, "[credential]")
    .replace(/\b(?:hf_|sk-)[A-Za-z0-9_-]{8,}/gu, "[credential]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/gu, "[credential]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, "[email]")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "")
    .slice(0, 1000);
}

function checkedEntry(value: unknown): DiagnosticEntry | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.timestamp !== "string" || row.timestamp.length > 40 || !Number.isFinite(Date.parse(row.timestamp)) ||
      !["error", "warning"].includes(String(row.level)) || typeof row.source !== "string" || typeof row.event !== "string" || typeof row.message !== "string") return null;
  return { timestamp: row.timestamp, level: row.level as DiagnosticEntry["level"], source: sanitizeDiagnostic(row.source).slice(0, 80), event: sanitizeDiagnostic(row.event).slice(0, 80), message: sanitizeDiagnostic(row.message),
    ...(typeof row.count === "number" && Number.isSafeInteger(row.count) && row.count > 0 ? { count: Math.min(row.count, 1_000_000) } : {}) };
}

export class ClientDiagnostics {
  private entries: DiagnosticEntry[] | null = null;
  persistenceAvailable = true;
  constructor(private storage: () => LogStorage = () => localStorage) {}
  read(): DiagnosticEntry[] {
    if (!this.entries) {
      this.entries = [];
      try {
        const raw = this.storage().getItem(DIAGNOSTICS_STORAGE_KEY);
        if (raw && raw.length <= MAX_STORAGE_CHARS) {
          const value: unknown = JSON.parse(raw);
          if (Array.isArray(value)) this.entries = value.slice(-MAX_ENTRIES).map(checkedEntry).filter((item): item is DiagnosticEntry => item !== null);
        }
      } catch { this.persistenceAvailable = false; }
    }
    return this.entries.map((entry) => ({ ...entry }));
  }
  record(source: string, event: string, message: string, level: DiagnosticEntry["level"] = "error") {
    const rows = this.read();
    const entry = checkedEntry({ timestamp: new Date().toISOString(), level, source, event, message })!;
    const last = rows.at(-1);
    if (last && last.source === entry.source && last.event === entry.event && last.message === entry.message && last.level === level && Date.parse(entry.timestamp) - Date.parse(last.timestamp) < 60_000) {
      last.count = Math.min((last.count ?? 1) + 1, 1_000_000);
      last.timestamp = entry.timestamp;
    } else rows.push(entry);
    this.entries = rows.slice(-MAX_ENTRIES);
    try { this.storage().setItem(DIAGNOSTICS_STORAGE_KEY, JSON.stringify(this.entries)); this.persistenceAvailable = true; }
    catch { this.persistenceAvailable = false; }
  }
}

export const clientDiagnostics = new ClientDiagnostics();
export function recordClientError(source: string, event: string, error: unknown) {
  clientDiagnostics.record(source, event, error instanceof Error ? error.message : typeof error === "string" ? error : "Unknown error");
}
export function installDiagnosticHandlers(): () => void {
  const onError = (event: ErrorEvent) => recordClientError("ui", "unhandled-error", event.error ?? event.message);
  const onRejection = (event: PromiseRejectionEvent) => recordClientError("ui", "unhandled-rejection", event.reason);
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => { window.removeEventListener("error", onError); window.removeEventListener("unhandledrejection", onRejection); };
}

export async function readServerDiagnostics(): Promise<ServerDiagnostics> {
  const response = await fetch("/api/diagnostics", { signal: AbortSignal.timeout(8000), cache: "no-store" });
  if (!response.ok) throw new Error(`Diagnostics unavailable (${response.status})`);
  const raw = await response.text();
  if (raw.length > 2_000_000) throw new Error("Diagnostics response is too large");
  const data = JSON.parse(raw) as Record<string, unknown>;
  if (!data || data.version !== 1 || !Array.isArray(data.entries) || data.entries.length > 500) throw new Error("Invalid diagnostics response");
  const entries = data.entries.map(checkedEntry);
  if (entries.some((entry) => !entry)) throw new Error("Invalid diagnostic entry");
  return { entries: entries as DiagnosticEntry[], appVersion: typeof data.appVersion === "string" ? data.appVersion.slice(0, 40) : "unknown",
    persistence: { available: !!data.persistence && (data.persistence as { available?: boolean }).available === true } };
}

export function serializeDiagnostics(appVersion: string, server: ServerDiagnostics | null, client = clientDiagnostics): string {
  return JSON.stringify({ format: "voicesubsep-diagnostics", version: 1, appVersion, generatedAt: new Date().toISOString(),
    server: { available: server !== null, ...(server ?? { entries: [] }) },
    client: { entries: client.read(), persistence: { available: client.persistenceAvailable } },
  }, null, 2);
}
