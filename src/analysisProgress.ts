import type { Job } from "./api";

/** Korean decoding does not forbid Han characters; flag them without altering the transcript. */
export function hasKoreanHanDraft(text: string, language?: string): boolean {
  return language === "ko" && /\p{Script=Han}/u.test(text);
}

/** Preview text is display-only: never turn it into project captions or speakers. */
export function recognitionPreviewLines(job: Job): string[] {
  const lines = job.recognitionPreview?.lines;
  if (!Array.isArray(lines)) return [];
  return lines.slice(-2).filter((line): line is string => typeof line === "string")
    .map(line => Array.from(line.replace(/[\u0000-\u001f\u007f-\u009f]/gu, " ").replace(/\s+/gu, " ").trim()).slice(0, 500).join(""))
    .filter(Boolean);
}

export function validJobTime(value: unknown): number | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Includes queue time. A wall-clock duration is not an inference heartbeat. */
export function jobElapsedSeconds(job: Job, now: number): number | undefined {
  const start = validJobTime(job.createdAt);
  const active = job.status === "queued" || job.status === "running";
  const end = active ? now : validJobTime(job.updatedAt);
  if (start === undefined || end === undefined || !Number.isFinite(end)) return undefined;
  return Math.max(0, Math.floor((end - start) / 1000));
}

export function elapsedClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total / 60) % 60;
  return `${hours ? `${hours}:` : ""}${String(hours ? minutes : Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
