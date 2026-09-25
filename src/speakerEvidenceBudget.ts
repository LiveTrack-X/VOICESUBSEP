import type { Caption, Project } from "./domain";

export const SPEAKER_EVIDENCE_BUDGET_NOTICE = "저장 용량을 위해 일부 화자 근거 상세를 생략했습니다. 원문·시간·편집 내용은 유지했습니다.";

/** Optional diagnostics must not prevent otherwise valid user work from being
 * saved. Prefer proposals and their anchors, and never discard original words. */
export function fitSpeakerEvidence(project: Project, maxBytes: number): { project: Project; reduced: boolean } {
  const bytes = (value: Project) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
  if (bytes(project) <= maxBytes || !project.captions.some(caption => caption.speakerEvidence)) return { project, reduced: false };
  const preserve = new Set<string>();
  for (const caption of project.captions) if (caption.speakerEvidence?.recommendation) {
    preserve.add(caption.id); caption.speakerEvidence.recommendation.anchorCaptionIds.forEach(id => preserve.add(id));
  }
  function shrink(caption: Caption, keepProposal: boolean): Caption {
    const evidence = caption.speakerEvidence;
    if (!evidence || keepProposal && preserve.has(caption.id)) return caption;
    const { recommendation: _recommendation, ...details } = evidence;
    return { ...caption, speakerEvidence: { ...details, words: [], wordsTruncated: true } };
  }
  let fitted = { ...project, captions: project.captions.map(caption => shrink(caption, true)) };
  if (bytes(fitted) <= maxBytes) return { project: fitted, reduced: true };
  fitted = { ...project, captions: project.captions.map(caption => shrink(caption, false)) };
  if (bytes(fitted) <= maxBytes) return { project: fitted, reduced: true };
  fitted = { ...fitted, captions: fitted.captions.map(caption => caption.speakerEvidence ? { ...caption,
    speakerEvidence: { ...caption.speakerEvidence, activity: [], activityTruncated: true } } : caption) };
  if (bytes(fitted) <= maxBytes) return { project: fitted, reduced: true };
  return { project: { ...project, captions: project.captions.map(caption => {
    if (!caption.speakerEvidence) return caption;
    const { speakerEvidence: _evidence, ...original } = caption;
    return original;
  }) }, reduced: true };
}
