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
  detail?: string;
};
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
