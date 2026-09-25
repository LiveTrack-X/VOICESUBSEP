import type { Caption, Speaker } from "./domain";
import { clientDiagnostics } from "./diagnostics";

export type MediaInfo = {
  id: string;
  name: string;
  duration: number;
  audioTracks: { index: number; label: string; channels: number }[];
  url: string;
  hasVideo?: boolean;
  frameRate?: number | null;
  frameRateFraction?: string | null;
  bytes?: number;
  sha256?: string;
};
export type Health = {
  status: string;
  ffmpeg: boolean;
  ffprobe: boolean;
  engines: { whisper: boolean; nemotron: boolean; qwen?: boolean };
  engineIssues?: { nemotron: string | null; qwen?: string | null };
  gpu?: { available: boolean; name: string | null; deviceCount: number; computeTypes: string[]; reason: string | null };
  defaults?: { device: 'cuda' | 'cpu'; whisperModel: string; computeType: string };
  detail?: string;
};
export function analysisBlockReason(
  health: Health | null,
  diarization = true,
  asrProvider: "local" | "groq" | "xai" | "gemini" = "local",
  localAsrEngine: "whisper" | "qwen" = "whisper",
): string | null {
  if (!health) return "분석 서버의 준비 상태를 확인하지 못했습니다.";
  if (!health.ffmpeg || !health.ffprobe)
    return "미디어 처리에 필요한 FFmpeg와 FFprobe가 준비되지 않았습니다.";
  if (asrProvider === "local" && localAsrEngine === "qwen" && !health.engines.qwen)
    return health.engineIssues?.qwen?.trim() || "Qwen 음성 인식·시간 정렬 실행환경이 준비되지 않았습니다.";
  if (asrProvider === "local" && localAsrEngine === "whisper" && !health.engines.whisper)
    return "음성 인식에 필요한 Whisper 실행환경이 준비되지 않았습니다.";
  if (diarization && !health.engines.nemotron)
    return health.engineIssues?.nemotron?.trim() ||
      "현재 앱 또는 서버에 Nemotron 화자 구분 실행환경이 준비되지 않았습니다. 필수 구성요소의 설치 상태를 확인해야 합니다.";
  return null;
}
export type AnalysisResult = {
  captions: Caption[];
  speakers: Speaker[];
  duration: number;
  warnings: string[];
};
export type Job = {
  id: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  stage: string;
  progress: number;
  createdAt?: string;
  updatedAt?: string;
  recognitionPreview?: { lines: string[]; updatedAt: string };
  error?: string;
  result?: AnalysisResult;
  cancelRequested?: boolean;
  queue?: {
    position: number;
    waitingCount: number;
    workerAvailable: boolean;
    blockingJob: { id: string; projectName: string; mediaName: string; stage: string; progress: number; cancelRequested: boolean } | null;
  };
};
export class ApiError extends Error {
  constructor(message: string, public readonly status: number) { super(message); this.name = "ApiError"; }
}
export async function request<T>(
  url: string,
  options?: RequestInit,
): Promise<T> {
  let response: Response;
  // Record the operation, never request bodies, query strings or reflected validation input.
  const operation = `${options?.method ?? "GET"} ${url.split("?")[0]!.replace(/\/[a-f0-9]{32}(?=\/|$)/gu, "/:id")}`;
  try {
    response = await fetch(url, { ...options, signal: options?.signal ?? AbortSignal.timeout(15_000) });
  } catch (error) {
    if (!(error instanceof Error && error.name === "AbortError")) clientDiagnostics.record("api", "connection-failed", operation);
    throw error;
  }
  if (!response.ok) {
    if (response.status !== 404) clientDiagnostics.record("api", "request-failed", `${operation} (${response.status})`);
    let message = `요청 실패 (${response.status})`;
    try {
      const body = await response.json();
      message =
        typeof body.detail === "string"
          ? body.detail
          : JSON.stringify(body.detail ?? body);
    } catch {
      /* not JSON */
    }
    throw new ApiError(message, response.status);
  }
  try { return await response.json() as T; }
  catch (error) { clientDiagnostics.record("api", "invalid-response", operation); throw error; }
}
// Each editor keeps the same File object. Concurrent dialog mounts share a
// single upload; later mounts validate the saved ID after server restarts or
// manual cleanup. Filenames never establish identity.
const mediaUploads = new WeakMap<File, { info?: MediaInfo; pending?: Promise<MediaInfo> }>();
export function uploadMedia(file: File): Promise<MediaInfo> {
  const entry = mediaUploads.get(file) ?? {};
  mediaUploads.set(file, entry);
  if (entry.pending) return entry.pending;
  const operation = async () => {
    if (entry.info) {
      try { return entry.info = await request<MediaInfo>(`/api/media/${entry.info.id}`); }
      catch (error) { if (!(error instanceof ApiError) || error.status !== 404) throw error; entry.info = undefined; }
    }
    const capacity = await request<{maxUploadBytes:number}>("/api/cache");
    if (file.size > capacity.maxUploadBytes) throw new Error(`파일이 업로드 한도 (${(capacity.maxUploadBytes / 1024 ** 3).toFixed(1)} GB)를 초과합니다.`);
    const form = new FormData();
    form.append("file", file);
    entry.info = await request<MediaInfo>("/api/media", {method:"POST", body:form, signal:AbortSignal.timeout(30 * 60_000)});
    return entry.info;
  };
  entry.pending = operation().finally(() => { entry.pending = undefined; });
  return entry.pending;
}
export function download(
  name: string,
  text: string,
  mime = "text/plain;charset=utf-8",
) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_");
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
