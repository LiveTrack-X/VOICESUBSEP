import type { Caption, Project } from "./domain";
import { editCaption } from "./editorOperations";
import { SPEAKER_EVIDENCE_REASONS, type SpeakerEvidenceReason } from "./speakerEvidence";

export const SPEAKER_REVIEW_STALE = "검토 중 프로젝트가 변경되었습니다. 다시 확인한 뒤 후보를 선택하세요.";
export const SPEAKER_REVIEW_PROTECTED = "수동 수정·검수 완료·이미 배정된 자막은 보완 적용에서 보호합니다.";
export const SPEAKER_REVIEW_INVALID = "후보의 원문·시간·근거가 달라졌거나 불확실합니다. 원음을 직접 확인하세요.";
export const SPEAKER_CAUSE_LABELS: Record<SpeakerEvidenceReason | "unknown", string> = {
  no_activity: "화자 활동 없음", insufficient_activity: "활동 중첩 부족", speaker_transition: "화자 전환 경계",
  overlap: "화자 활동 겹침", speech_uncertain: "음성 확인 필요", timing_uncertain: "단어 시간 확인 필요",
  diarization_disabled: "화자 구분 미실행", unknown: "원인 상세 없음",
};
export const SPEAKER_CAUSES = [...SPEAKER_EVIDENCE_REASONS, "unknown"] as const;
export type SpeakerCause = typeof SPEAKER_CAUSES[number];
export type RecommendationCheck = { eligible: true; speakerId: string } | { eligible: false; reason: string };
export type SpeakerReviewSnapshot = { project: Project; session: number };

export function speakerCauses(caption: Caption): SpeakerCause[] {
  return caption.speakerEvidence?.reasons.length ? caption.speakerEvidence.reasons : ["unknown"];
}
export function speakerCauseCounts(captions: readonly Caption[]): Record<SpeakerCause, number> {
  const counts = Object.fromEntries(SPEAKER_CAUSES.map(cause => [cause, 0])) as Record<SpeakerCause, number>;
  for (const caption of captions) if (caption.speakerId === null) for (const cause of speakerCauses(caption)) counts[cause]++;
  return counts;
}
const blocking = new Set(["edited", "timing", "speech_uncertain", "overlap", "speaker_boundary"]);
function protectedTarget(caption: Caption): boolean {
  return caption.speakerId !== null || caption.reviewed || caption.reasons.includes("edited");
}
/** Recheck stored model proposals against the current original timeline. This
 * is deliberately stricter than the existing initial boundary repair policy. */
export function checkSpeakerRecommendation(project: Project, caption: Caption, captionById?: ReadonlyMap<string, Caption>): RecommendationCheck {
  if (protectedTarget(caption)) return { eligible: false, reason: SPEAKER_REVIEW_PROTECTED };
  const evidence = caption.speakerEvidence, candidate = evidence?.recommendation;
  if (!evidence || !candidate) return { eligible: false, reason: "검증 가능한 추천 인물이 없습니다." };
  const reject = (): RecommendationCheck => ({ eligible: false, reason: SPEAKER_REVIEW_INVALID });
  if (caption.reasons.some(reason => blocking.has(reason)) || evidence.method !== "unassigned" || evidence.wordsTruncated || evidence.activityTruncated
    || !project.speakers.some(speaker => speaker.id === candidate.speakerId)) return reject();
  if (candidate.targetWordCount !== evidence.words.length || !evidence.words.length || !caption.words || caption.words.length !== evidence.words.length) return reject();
  for (let index = 0; index < evidence.words.length; index++) {
    const word = evidence.words[index]!, original = caption.words[index]!;
    if (word.start !== original.start || word.end !== original.end || word.start < caption.start || word.end > caption.end
      || word.method !== "unassigned" || word.activityTruncated || word.end - word.start > .800001 || word.asrProbability === undefined || word.asrProbability < .8
      || original.probability === undefined || original.probability < .8
      || word.reasons.some(reason => reason !== "insufficient_activity") || word.activity.length !== 1
      || word.activity[0]!.speakerId !== candidate.speakerId || word.activity[0]!.overlapSeconds <= 0) return reject();
  }
  const expectedIds = new Set([caption.id, ...candidate.anchorCaptionIds]);
  if (expectedIds.size !== candidate.anchorCaptionIds.length + 1 || candidate.sourceSnapshots.length !== expectedIds.size) return reject();
  for (const snapshot of candidate.sourceSnapshots) {
    const current = captionById ? captionById.get(snapshot.captionId) : project.captions.find(item => item.id === snapshot.captionId);
    if (!expectedIds.delete(snapshot.captionId) || !current || current.start !== snapshot.start || current.end !== snapshot.end
      || current.text !== snapshot.text || current.speakerId !== snapshot.speakerId) return reject();
    if (current.id !== caption.id) {
      if (current.speakerId !== candidate.speakerId || current.reasons.some(reason => blocking.has(reason) || reason === "unassigned")
        || current.speakerEvidence?.method !== "activity" || current.speakerEvidence.wordsTruncated || current.speakerEvidence.activityTruncated) return reject();
      const nearest = current.end <= caption.start ? current.speakerEvidence.words.at(-1)
        : current.start >= caption.end ? current.speakerEvidence.words[0] : undefined;
      const gap = current.end <= caption.start ? caption.start - current.end : current.start - caption.end;
      if (!nearest || nearest.activityTruncated || gap < 0 || gap > .200001 || nearest.method !== "activity" || nearest.reasons.length
        || nearest.asrProbability === undefined || nearest.asrProbability < .8) return reject();
      const original = current.words?.find(word => word.start === nearest.start && word.end === nearest.end);
      if (!original || original.probability === undefined || original.probability < .8) return reject();
      const bridgeStart = Math.min(caption.start, nearest.start), bridgeEnd = Math.max(caption.end, nearest.end);
      if (project.captions.some(other => other.id !== caption.id && other.id !== current.id
        && other.end > bridgeStart && other.start < bridgeEnd)) return reject();
    }
  }
  if (expectedIds.size) return reject();
  return { eligible: true, speakerId: candidate.speakerId };
}

/** Atomic, user-selected edits only. A changed snapshot never partially applies. */
export function applySpeakerRecommendations(project: Project, snapshot: SpeakerReviewSnapshot, session: number, ids: ReadonlySet<string>): Project {
  if (session !== snapshot.session || project !== snapshot.project || project.id !== snapshot.project.id) throw new Error(SPEAKER_REVIEW_STALE);
  if (!ids.size) return project;
  const assignments = new Map<string, string>();
  const captionById = new Map(project.captions.map(caption => [caption.id, caption]));
  for (const id of ids) {
    const caption = captionById.get(id);
    if (!caption) throw new Error(SPEAKER_REVIEW_STALE);
    const check = checkSpeakerRecommendation(project, caption, captionById);
    if (!check.eligible) throw new Error(check.reason);
    assignments.set(id, check.speakerId);
  }
  return { ...project, captions: project.captions.map(caption => {
    const speakerId = assignments.get(caption.id);
    if (!speakerId) return caption;
    // Preserve the inspected activity, but consume the proposal. Acceptance is
    // a manual edit requiring review, never a newly inferred confidence claim.
    const { recommendation: _recommendation, ...evidence } = caption.speakerEvidence!;
    return { ...editCaption(caption, { speakerId }), speakerEvidence: evidence };
  }) };
}

export function speakerReviewRange(caption: Pick<Caption, "start" | "end">, duration: number): { start: number; end: number } {
  const limit = Number.isFinite(duration) && duration > 0 ? duration : caption.end + 1.5;
  return { start: Math.max(0, caption.start - 1.5), end: Math.min(limit, caption.end + 1.5) };
}
