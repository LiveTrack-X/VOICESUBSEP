import type { Caption, Project } from "./domain";
import { parseMediaIdentity, sameMediaIdentity, type MediaIdentity } from "./mediaIdentity";

export type VoiceReference = {
  id: string; captionId: string; speakerId: string; start: number; end: number; text: string;
  audioTrack: number; sourceIdentity: MediaIdentity;
};
export const VOICE_REFERENCE_LIMIT = 16;
export const VOICE_STALE = "목소리 기준의 원본·트랙·자막이 달라졌습니다. 다시 듣고 등록하세요.";
export const VOICE_REFERENCE_REQUIRED = "검수 완료한 단독 화자 자막 3~15초를 선택하고, 선택 트랙의 목소리를 확인하세요.";
export const VOICE_TARGET_REQUIRED = "수동 수정·검수 완료·겹침·시간 불확실 자막은 보호합니다. 단독 발화 1.5~15초를 선택하세요.";
const blockedReference = new Set(["overlap", "timing", "speech_uncertain"]);

export function parseVoiceReferences(value: unknown): VoiceReference[] {
  const bad = (): never => { throw new Error("기준 목소리 정보가 올바르지 않습니다."); };
  if (!Array.isArray(value) || value.length > VOICE_REFERENCE_LIMIT) return bad();
  const ids = new Set<string>();
  return value.map(raw => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return bad();
    const r = raw as Record<string, unknown>;
    if (Object.keys(r).some(k => !["id", "captionId", "speakerId", "start", "end", "text", "audioTrack", "sourceIdentity"].includes(k))) return bad();
    for (const key of ["id", "captionId", "speakerId"] as const) if (typeof r[key] !== "string" || !/^[a-zA-Z0-9_.-]{1,128}$/u.test(r[key])) return bad();
    if (ids.has(r.id as string)) return bad();
    ids.add(r.id as string);
    if (typeof r.start !== "number" || typeof r.end !== "number" || !Number.isFinite(r.start) || !Number.isFinite(r.end)
      || r.start < 0 || r.end > 7 * 86400 || r.end - r.start < 3 || r.end - r.start > 15
      || !Number.isInteger(r.audioTrack) || (r.audioTrack as number) < 0 || (r.audioTrack as number) > 4096
      || typeof r.text !== "string" || !r.text.trim() || r.text.length > 10000 || /[\u0000-\u001f\u007f]/u.test(r.text.replace(/[\r\n\t]/gu, ""))) return bad();
    return { id: r.id as string, captionId: r.captionId as string, speakerId: r.speakerId as string,
      start: r.start, end: r.end, text: r.text, audioTrack: r.audioTrack as number, sourceIdentity: parseMediaIdentity(r.sourceIdentity) };
  });
}

function cleanReference(project: Project, caption: Caption): boolean {
  return !!caption.speakerId && caption.reviewed && !!caption.text.trim() && caption.start >= 0 && caption.end <= project.duration
    && caption.end - caption.start >= 3 && caption.end - caption.start <= 15
    && !caption.reasons.some(r => blockedReference.has(r))
    && !project.captions.some(other => other.id !== caption.id && other.start < caption.end && other.end > caption.start);
}

export function voiceReferenceIssue(project: Project, reference: VoiceReference, audioTrack: number): string | null {
  if (!sameMediaIdentity(project.mediaIdentity, reference.sourceIdentity) || reference.audioTrack !== audioTrack) return VOICE_STALE;
  const caption = project.captions.find(c => c.id === reference.captionId);
  if (!caption || !cleanReference(project, caption) || !project.speakers.some(s => s.id === reference.speakerId)
    || caption.start !== reference.start || caption.end !== reference.end || caption.text !== reference.text || caption.speakerId !== reference.speakerId) return VOICE_STALE;
  return null;
}

export function enrollVoiceReference(project: Project, captionId: string, audioTrack: number): Project {
  const caption = project.captions.find(c => c.id === captionId);
  if (!project.mediaIdentity || !Number.isInteger(audioTrack) || audioTrack < 0 || audioTrack > 4096 || !caption || !cleanReference(project, caption)) throw new Error(VOICE_REFERENCE_REQUIRED);
  const previous = project.voiceReferences ?? [];
  if (previous.some(r => r.captionId === captionId && r.audioTrack === audioTrack && voiceReferenceIssue(project, r, audioTrack) === null)) return project;
  if (previous.length >= VOICE_REFERENCE_LIMIT) throw new Error("기준 목소리는 프로젝트당 최대 16개입니다. 오래된 기준을 삭제하세요.");
  const reference: VoiceReference = { id: `voice-${crypto.randomUUID()}`, captionId, speakerId: caption.speakerId!,
    start: caption.start, end: caption.end, text: caption.text, audioTrack, sourceIdentity: { ...project.mediaIdentity } };
  return { ...project, voiceReferences: [...previous, reference] };
}

export function voiceTargetIssue(project: Project, caption: Caption): string | null {
  if (caption.speakerId !== null || caption.reviewed || !caption.text.trim() || caption.end - caption.start < 1.5 || caption.end - caption.start > 15
    || caption.start < 0 || caption.end > project.duration || caption.reasons.some(r => blockedReference.has(r) || r === "edited")
    || project.captions.some(other => other.id !== caption.id && other.start < caption.end && other.end > caption.start)) return VOICE_TARGET_REQUIRED;
  return null;
}

export function voiceMatchRequest(project: Project, audioTrack: number, captionId: string, confirmedSingleSpeaker: boolean) {
  const caption = project.captions.find(c => c.id === captionId);
  if (!confirmedSingleSpeaker || !caption || voiceTargetIssue(project, caption)) throw new Error(VOICE_TARGET_REQUIRED);
  const references = (project.voiceReferences ?? []).filter(r => voiceReferenceIssue(project, r, audioTrack) === null);
  if (new Set(references.map(r => r.speakerId)).size < 2) throw new Error("비교를 위해 두 인물 이상의 확인한 목소리를 등록하세요.");
  return { references: references.map(({ id, speakerId, start, end }) => ({ id, speakerId, start, end })),
    targets: [{ captionId, start: caption.start, end: caption.end }] };
}
