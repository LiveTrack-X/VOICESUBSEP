import { createProject, type Caption } from "../domain";
import type { SpeakerEvidence, SpeakerSourceSnapshot } from "../speakerEvidence";

/** Synthetic original-timeline cues only; no recorded speech or user data. */
export function speakerReviewProject() {
  const project = createProject(2);
  project.id = "synthetic-speaker-review"; project.name = "Synthetic speaker review";
  project.mediaName = "synthetic-review.wav"; project.duration = 20;
  function pair(index: number, start: number): [Caption, Caption] {
    const make = (id: string, start: number, end: number, text: string, speakerId: string | null): Caption => ({
      id, start, end, text, speakerId, reasons: speakerId ? [] : ["unassigned"], reviewed: false,
      words: [{ start, end, text, probability: .95 }],
    });
    const target = make(`target-${index}`, start, start + .4, `합성 확인 대사 ${index}`, null);
    const anchor = make(`anchor-${index}`, start + .4, start + 1.4, `합성 근거 대사 ${index}`, "speaker-1");
    function evidence(caption: Caption, sourceRecord: number): SpeakerEvidence {
      const assigned = caption.speakerId !== null;
      const activity = [{ speakerId: "speaker-1", overlapSeconds: assigned ? 1 : .1, coverage: assigned ? 1 : .25 }];
      return { version: 1, method: assigned ? "activity" : "unassigned", reasons: assigned ? [] : ["insufficient_activity"], activity,
        words: [{ start: caption.start, end: caption.end, sourceRecord, method: assigned ? "activity" : "unassigned",
          reasons: assigned ? [] : ["insufficient_activity"], activity, asrProbability: .95 }] };
    }
    target.speakerEvidence = evidence(target, index * 2); anchor.speakerEvidence = evidence(anchor, index * 2 + 1);
    const snapshot = (caption: Caption): SpeakerSourceSnapshot => ({ captionId: caption.id, start: caption.start, end: caption.end, text: caption.text, speakerId: caption.speakerId });
    target.speakerEvidence.recommendation = { speakerId: "speaker-1", method: "boundary_context", anchorCaptionIds: [anchor.id], targetWordCount: 1,
      sourceSnapshots: [snapshot(target), snapshot(anchor)] };
    return [target, anchor];
  }
  const first = pair(1, 1), manual = pair(2, 4), reviewed = pair(3, 7), overlap = pair(4, 10);
  manual[0].reasons.push("edited"); reviewed[0].reviewed = true;
  overlap[0].reasons.push("overlap"); overlap[0].speakerEvidence!.reasons = ["overlap"];
  delete overlap[0].speakerEvidence!.recommendation;
  const legacy: Caption = { id: "legacy", start: 14, end: 15, text: "이전 형식의 합성 미배정 대사", speakerId: null, reasons: ["unassigned"], reviewed: false };
  project.captions = [...first, ...manual, ...reviewed, ...overlap, legacy];
  return project;
}
