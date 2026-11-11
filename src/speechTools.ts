import { createProject, parseProject, MAX_CAPTIONS, type Caption, type Project } from "./domain";
import { editCaption } from "./editorOperations";
import { assertProjectMedia, parseMediaIdentity, sameMediaIdentity, type MediaIdentity } from "./mediaIdentity";
import type { MediaInfo } from "./api";
import { voiceMatchRequest, voiceTargetIssue } from "./voiceReferences";
export { enrollVoiceReference, voiceReferenceIssue, voiceTargetIssue, voiceMatchRequest, type VoiceReference } from "./voiceReferences";

export type SpeechToolSnapshot = { project: Project; session: number; mediaId: string; audioTrack: number; sourceIdentity: MediaIdentity };
export type VoiceCandidate = { captionId: string; scores: { speakerId: string; similarity: number }[]; recommendedSpeakerId: string | null; reason: string };
type BoundResult = { mediaId: string; audioTrack: number; sourceIdentity: MediaIdentity; model: string; revision: string; warnings: string[] };
export type VoiceMatchResult = BoundResult & { candidates: VoiceCandidate[] };
export type OverlapResult = BoundResult & { start: number; end: number; originalUrl: string; streams: { index: 0 | 1; audioUrl: string; captions: Caption[] }[] };
export type OverlapSelection = { streamIndex: number; captionId: string; speakerId: string | null };
export type SpeechToolKind = "prepare-voice" | "prepare-overlap" | "voice-preview" | "voice-match" | "overlap-recovery";
export type SpeechToolJob = { id: string; kind: SpeechToolKind; status: "queued" | "running" | "completed" | "failed" | "cancelled";
  stage: string; progress: number; error?: string; result?: unknown; cancelRequested?: boolean };
const STALE = "검토 중 프로젝트·원본·트랙이 변경되었습니다. 다시 실행하세요.";
const INVALID = "음성 도구 결과를 확인할 수 없습니다. 다시 실행하세요.";
const VOICE_MODEL = "Wespeaker/wespeaker-voxceleb-resnet34-LM";
const VOICE_REVISION = "f0c48c298fd835726c27956a5d617bad7115627e";
const OVERLAP_MODEL = "speechbrain/sepformer-wsj02mix";
const OVERLAP_REVISION = "3a2826343a10e2d2e8a75f79aeab5ff3a2473531";
function bad(): never { throw new Error(INVALID); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return bad();
  return value as Record<string, unknown>;
}
function text(value: unknown, limit = 10000): string {
  if (typeof value !== "string" || value.length > limit || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) return bad();
  return value;
}
function id(value: unknown): string { const t = text(value, 128); if (!/^[a-zA-Z0-9_.-]+$/u.test(t)) return bad(); return t; }
function finite(value: unknown, min = 0, max = 7 * 86400): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) return bad();
  return value;
}
function list(value: unknown, max: number): unknown[] { if (!Array.isArray(value) || value.length > max) return bad(); return value; }
function bound(value: unknown, model: string, revision: string): BoundResult {
  const v = object(value), mediaId = id(v.mediaId), audioTrack = finite(v.audioTrack, 0, 4096);
  if (!/^[a-f0-9]{32}$/u.test(mediaId) || !Number.isInteger(audioTrack) || v.model !== model || v.revision !== revision) return bad();
  return { mediaId, audioTrack, sourceIdentity: parseMediaIdentity(v.sourceIdentity), model, revision,
    warnings: list(v.warnings, 100).map(w => text(w, 3000)) };
}

export function makeSpeechToolSnapshot(project: Project, session: number, media: MediaInfo, audioTrack: number): SpeechToolSnapshot {
  assertProjectMedia(project, media);
  if (!media.audioTracks.some(t => t.index === audioTrack) || !/^[a-f0-9]{32}$/u.test(media.id)) throw new Error("원본에 존재하는 오디오 트랙을 선택하세요.");
  return { project, session, mediaId: media.id, audioTrack, sourceIdentity: { ...project.mediaIdentity! } };
}

export function parseSpeechToolJob(value: unknown, expectedKind?: SpeechToolKind): SpeechToolJob {
  const v = object(value);
  if (!/^[a-f0-9]{32}$/u.test(text(v.id, 32)) || !["prepare-voice", "prepare-overlap", "voice-preview", "voice-match", "overlap-recovery"].includes(v.kind as string)
    || expectedKind !== undefined && v.kind !== expectedKind || !["queued", "running", "completed", "failed", "cancelled"].includes(v.status as string)) return bad();
  return { id: v.id as string, kind: v.kind as SpeechToolKind, status: v.status as SpeechToolJob["status"], stage: text(v.stage, 512),
    progress: finite(v.progress, 0, 1), ...(v.error === undefined ? {} : { error: text(v.error, 3000) }),
    ...(v.result === undefined ? {} : { result: v.result }), ...(v.cancelRequested === true ? { cancelRequested: true } : {}) };
}

export function parseVoiceMatchResult(value: unknown): VoiceMatchResult {
  const base = bound(value, VOICE_MODEL, VOICE_REVISION), v = object(value);
  const seen = new Set<string>();
  const candidates = list(v.candidates, 50).map(raw => {
    const c = object(raw), captionId = id(c.captionId);
    if (seen.has(captionId)) return bad(); seen.add(captionId);
    const speakerIds = new Set<string>();
    const scores = list(c.scores, 16).map(rawScore => {
      const s = object(rawScore), speakerId = id(s.speakerId);
      if (speakerIds.has(speakerId)) return bad(); speakerIds.add(speakerId);
      return { speakerId, similarity: finite(s.similarity, -1, 1) };
    });
    return { captionId, scores, recommendedSpeakerId: c.recommendedSpeakerId === null ? null : id(c.recommendedSpeakerId), reason: text(c.reason, 100) };
  });
  return { ...base, candidates };
}

export function parseOverlapResult(value: unknown): OverlapResult {
  const base = bound(value, OVERLAP_MODEL, OVERLAP_REVISION), v = object(value);
  const start = finite(v.start), end = finite(v.end), originalUrl = text(v.originalUrl, 160);
  const match = /^\/api\/speech-tools\/jobs\/([a-f0-9]{32})\/audio\/original\.wav$/u.exec(originalUrl);
  if (!match || end - start < 1.99975 || end - start > 20.00025) return bad();
  const indexes = new Set<number>();
  const streams = list(v.streams, 2).map(raw => {
    const s = object(raw), index = finite(s.index, 0, 1);
    if (!Number.isInteger(index) || indexes.has(index)) return bad(); indexes.add(index);
    const audioUrl = text(s.audioUrl, 160);
    if (audioUrl !== `/api/speech-tools/jobs/${match[1]}/audio/stream-${index + 1}.wav`) return bad();
    const captions = list(s.captions, 500).map(rawCaption => {
      const input = object(rawCaption);
      const safe = parseProject(JSON.stringify({ ...createProject(), captions: [input] })).captions[0]!;
      if (safe.speakerId !== null || safe.reviewed || safe.start < start || safe.end > end || !safe.text.trim()
        || safe.words?.some(w => w.start < safe.start || w.end > safe.end)) return bad();
      return safe;
    });
    if (new Set(captions.map(c => c.id)).size !== captions.length) return bad();
    return { index: index as 0 | 1, audioUrl, captions };
  });
  if (streams.length !== 2) return bad();
  return { ...base, start, end, originalUrl, streams };
}

function assertCurrent(project: Project, snapshot: SpeechToolSnapshot, session: number, result: BoundResult) {
  if (project !== snapshot.project || session !== snapshot.session || project.id !== snapshot.project.id
    || result.mediaId !== snapshot.mediaId || result.audioTrack !== snapshot.audioTrack
    || !sameMediaIdentity(result.sourceIdentity, snapshot.sourceIdentity) || !sameMediaIdentity(project.mediaIdentity, snapshot.sourceIdentity)) throw new Error(STALE);
}

export function applyVoiceCandidate(project: Project, snapshot: SpeechToolSnapshot, session: number, value: VoiceMatchResult, captionId: string): Project {
  const result = parseVoiceMatchResult(value);
  assertCurrent(project, snapshot, session, result);
  const caption = project.captions.find(c => c.id === captionId);
  if (!caption || voiceTargetIssue(project, caption)) throw new Error(INVALID);
  const request = voiceMatchRequest(project, snapshot.audioTrack, captionId, true);
  const enrolled = new Set(request.references.map(r => r.speakerId));
  const candidate = result.candidates.find(c => c.captionId === captionId), scores = candidate?.scores.slice().sort((a, b) => b.similarity - a.similarity);
  if (!candidate || candidate.reason !== "candidate" || !scores || scores.length < 2 || scores.length !== enrolled.size || scores.some(s => !enrolled.has(s.speakerId))
    || scores[0]!.similarity < .75 || scores[0]!.similarity - scores[1]!.similarity < .15
    || candidate.recommendedSpeakerId !== scores[0]!.speakerId) throw new Error(INVALID);
  return { ...project, captions: project.captions.map(c => c.id === captionId ? editCaption(c, { speakerId: candidate.recommendedSpeakerId }) : c) };
}

export function appendOverlapCandidates(project: Project, snapshot: SpeechToolSnapshot, session: number, value: OverlapResult, selected: OverlapSelection[]): Project {
  const result = parseOverlapResult(value);
  assertCurrent(project, snapshot, session, result);
  if (result.end > project.duration || project.captions.length + selected.length > MAX_CAPTIONS) throw new Error(INVALID);
  const keys = new Set<string>();
  const additions = selected.map(choice => {
    const key = `${choice.streamIndex}:${choice.captionId}`;
    if (keys.has(key) || choice.speakerId !== null && !project.speakers.some(s => s.id === choice.speakerId)) throw new Error(INVALID);
    keys.add(key);
    const caption = result.streams.find(s => s.index === choice.streamIndex)?.captions.find(c => c.id === choice.captionId);
    if (!caption) throw new Error(INVALID);
    return { ...caption, id: `overlap-${crypto.randomUUID()}`, speakerId: choice.speakerId, reviewed: false,
      reasons: [...new Set([...caption.reasons.filter(reason => reason !== "unassigned"), "overlap", "edited",
        ...(choice.speakerId === null ? ["unassigned" as const] : [])])] as Caption["reasons"] };
  });
  if (!additions.length) return project;
  return { ...project, captions: [...project.captions, ...additions].sort((a, b) => a.start - b.start || a.end - b.end) };
}
