import type { Caption, Speaker } from "./domain";

export type MediaInfo = {
  id: string;
  name: string;
  duration: number;
  audioTracks: { index: number; label: string; channels: number }[];
  url: string;
};
export type Health = {
  status: string;
  ffmpeg: boolean;
  ffprobe: boolean;
  engines: { whisper: boolean; nemotron: boolean };
  engineIssues?: { nemotron: string | null };
  gpu?: { available: boolean; name: string | null; deviceCount: number; computeTypes: string[]; reason: string | null };
  defaults?: { device: 'cuda' | 'cpu'; whisperModel: string; computeType: string };
  detail?: string;
};
export function analysisBlockReason(
  health: Health | null,
  diarization = true,
): string | null {
  if (!health) return "분석 서버의 준비 상태를 확인하지 못했습니다.";
  if (!health.ffmpeg || !health.ffprobe)
    return "미디어 처리에 필요한 FFmpeg와 FFprobe가 준비되지 않았습니다.";
  if (!health.engines.whisper)
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
  error?: string;
  result?: AnalysisResult;
};
export async function request<T>(
  url: string,
  options?: RequestInit,
): Promise<T> {
  const response = await fetch(url, {
    ...options,
    signal: options?.signal ?? AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
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
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}
export async function uploadMedia(file: File): Promise<MediaInfo> {
  const form = new FormData();
  form.append("file", file);
  return request<MediaInfo>("/api/media", {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(30 * 60_000),
  });
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
