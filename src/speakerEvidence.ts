/** Analysis evidence describes model activity, never a verified voice identity. */
export const SPEAKER_EVIDENCE_REASONS = ["no_activity", "insufficient_activity", "speaker_transition", "overlap", "speech_uncertain", "timing_uncertain", "diarization_disabled"] as const;
export type SpeakerEvidenceReason = typeof SPEAKER_EVIDENCE_REASONS[number];
export type SpeakerEvidenceMethod = "activity" | "boundary" | "unassigned";
export type SpeakerActivity = { speakerId: string; overlapSeconds: number; coverage: number };
export type SpeakerWordEvidence = {
  start: number; end: number; sourceRecord: number; method: SpeakerEvidenceMethod;
  reasons: SpeakerEvidenceReason[]; activity: SpeakerActivity[]; asrProbability?: number; activityTruncated?: boolean;
};
export type SpeakerSourceSnapshot = { captionId: string; start: number; end: number; text: string; speakerId: string | null };
export type SpeakerRecommendation = {
  speakerId: string; method: "boundary_context"; anchorCaptionIds: string[]; targetWordCount: number;
  sourceSnapshots: SpeakerSourceSnapshot[];
};
export type SpeakerEvidence = {
  version: 1; method: SpeakerEvidenceMethod; reasons: SpeakerEvidenceReason[]; activity: SpeakerActivity[];
  words: SpeakerWordEvidence[]; wordsTruncated?: boolean; activityTruncated?: boolean;
  recommendation?: SpeakerRecommendation;
};

const MAX_TIME = 7 * 24 * 60 * 60;
function bad(path: string): never { throw new Error(`${path}: 화자 배정 근거 형식이 올바르지 않습니다.`); }
function object(value: unknown, path: string, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return bad(path);
  const result = value as Record<string, unknown>;
  if (Object.keys(result).some(key => !keys.includes(key))) return bad(path);
  return result;
}
function list(value: unknown, path: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) return bad(path);
  return value;
}
function number(value: unknown, path: string, max = MAX_TIME): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > max) return bad(path);
  return value;
}
function identifier(value: unknown, path: string): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_.-]{1,128}$/.test(value)) return bad(path);
  return value;
}
function method(value: unknown, path: string): SpeakerEvidenceMethod {
  if (value !== "activity" && value !== "boundary" && value !== "unassigned") return bad(path);
  return value;
}
function reasons(value: unknown, path: string): SpeakerEvidenceReason[] {
  const result = list(value, path, SPEAKER_EVIDENCE_REASONS.length).map(reason => {
    if (!SPEAKER_EVIDENCE_REASONS.includes(reason as SpeakerEvidenceReason)) return bad(path);
    return reason as SpeakerEvidenceReason;
  });
  if (new Set(result).size !== result.length) return bad(path);
  return result;
}
function activity(value: unknown, path: string): SpeakerActivity[] {
  const result = list(value, path, 32).map((entry, index) => {
    const at = `${path}[${index}]`, item = object(entry, at, ["speakerId", "overlapSeconds", "coverage"]);
    return { speakerId: identifier(item.speakerId, at), overlapSeconds: number(item.overlapSeconds, at), coverage: number(item.coverage, at, 1) };
  });
  if (new Set(result.map(item => item.speakerId)).size !== result.length) return bad(path);
  return result;
}
export function parseSpeakerEvidence(value: unknown, path: string): SpeakerEvidence {
  const item = object(value, path, ["version", "method", "reasons", "activity", "words", "wordsTruncated", "activityTruncated", "recommendation"]);
  if (item.version !== 1) return bad(path);
  const result: SpeakerEvidence = {
    version: 1, method: method(item.method, path), reasons: reasons(item.reasons, path), activity: activity(item.activity, path),
    words: list(item.words, path, 70).map((entry, index) => {
      const at = `${path}.words[${index}]`, word = object(entry, at, ["start", "end", "sourceRecord", "method", "reasons", "activity", "asrProbability", "activityTruncated"]);
      const start = number(word.start, at), end = number(word.end, at), sourceRecord = number(word.sourceRecord, at, 1_000_000);
      if (end <= start || !Number.isInteger(sourceRecord) || word.activityTruncated !== undefined && typeof word.activityTruncated !== "boolean") return bad(at);
      return { start, end, sourceRecord, method: method(word.method, at), reasons: reasons(word.reasons, at), activity: activity(word.activity, at),
        ...(word.asrProbability !== undefined ? { asrProbability: number(word.asrProbability, at, 1) } : {}),
        ...(word.activityTruncated !== undefined ? { activityTruncated: word.activityTruncated as boolean } : {}) };
    }),
  };
  for (const key of ["wordsTruncated", "activityTruncated"] as const) {
    if (item[key] !== undefined) {
      if (typeof item[key] !== "boolean") return bad(path);
      result[key] = item[key];
    }
  }
  if (item.recommendation !== undefined) {
    const at = `${path}.recommendation`, recommendation = object(item.recommendation, at,
      ["speakerId", "method", "anchorCaptionIds", "targetWordCount", "sourceSnapshots"]);
    if (recommendation.method !== "boundary_context") return bad(at);
    const anchorCaptionIds = list(recommendation.anchorCaptionIds, at, 2).map(value => identifier(value, at));
    const targetWordCount = number(recommendation.targetWordCount, at, 2);
    if (!anchorCaptionIds.length || new Set(anchorCaptionIds).size !== anchorCaptionIds.length || !Number.isInteger(targetWordCount) || targetWordCount < 1) return bad(at);
    const sourceSnapshots = list(recommendation.sourceSnapshots, at, 3).map(entry => {
      const snapshot = object(entry, at, ["captionId", "start", "end", "text", "speakerId"]);
      const start = number(snapshot.start, at), end = number(snapshot.end, at);
      if (end <= start || typeof snapshot.text !== "string" || snapshot.text.length > 500 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(snapshot.text)) return bad(at);
      return { captionId: identifier(snapshot.captionId, at), start, end, text: snapshot.text,
        speakerId: snapshot.speakerId === null ? null : identifier(snapshot.speakerId, at) };
    });
    const snapshotIds = new Set(sourceSnapshots.map(snapshot => snapshot.captionId));
    if (snapshotIds.size !== sourceSnapshots.length || sourceSnapshots.length !== anchorCaptionIds.length + 1 || anchorCaptionIds.some(id => !snapshotIds.has(id))) return bad(at);
    result.recommendation = { speakerId: identifier(recommendation.speakerId, at), method: "boundary_context", anchorCaptionIds, targetWordCount, sourceSnapshots };
  }
  return result;
}
