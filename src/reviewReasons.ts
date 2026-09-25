import type { Caption, ReviewReason } from "./domain";

export const reviewReasonLabels: Record<ReviewReason, string> = {
  overlap: "동시 발화", unassigned: "화자 미배정", speaker_count: "인원 확인",
  timing: "시간 확인", speaker_boundary: "경계 보정", edited: "수동 수정",
  speech_uncertain: "음성 확인 필요",
};
export const SPEECH_REVIEW_HINT = "음성인지 확실하지 않아 원문을 남겼습니다. 작은 목소리도 표시될 수 있으니 원음을 듣고 확인하세요.";
export function needsSpeechReview(caption: Pick<Caption, "reviewed" | "reasons"> | undefined): boolean {
  return !!caption && !caption.reviewed && caption.reasons.includes("speech_uncertain");
}
export function captionReviewLabel(caption: Pick<Caption, "reviewed" | "reasons"> | undefined, label: (key: string) => string): string {
  if (caption?.reviewed) return label("확인 완료");
  return `${label("검수 필요")}${needsSpeechReview(caption) ? ` · ${label("음성 확인 필요")}` : ""}`;
}
