import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { parseProject, serializeProject, type Project } from "./domain";
import { applySpeakerRecommendations, checkSpeakerRecommendation, speakerCauseCounts, speakerReviewRange, SPEAKER_REVIEW_STALE } from "./speakerReview";
import { editCaption } from "./editorOperations";
import { speakerReviewProject } from "./testFixtures/speakerReviewProject";
import { createProjectSession, editProjectSession, undoProjectSession, redoProjectSession } from "./projectSession";
import { SpeakerReviewDialog } from "./components/SpeakerReviewDialog";
import { I18nProvider, dictionaries, LOCALES } from "./i18n";
import { speakerReviewMessages } from "./i18n-speaker-review";

const target = (project: Project) => project.captions[0]!;
const anchor = (project: Project) => project.captions[1]!;
describe("speaker evidence compatibility and bounds", () => {
  it("roundtrips optional evidence and supports old projects without inferred causes", () => {
    const project = speakerReviewProject(), restored = parseProject(serializeProject(project));
    expect(restored).toEqual(project);
    expect(restored.captions.at(-1)!.speakerEvidence).toBeUndefined();
    expect(speakerCauseCounts(restored.captions)).toMatchObject({ unknown: 1, insufficient_activity: 3, overlap: 1 });
    for (const caption of project.captions) delete caption.speakerEvidence;
    expect(speakerCauseCounts(parseProject(JSON.stringify(project)).captions).unknown).toBe(5);
  });
  it.each(["version", "unknown-reason", "NaN", "probability", "extra-field", "too-many-words", "too-many-anchors", "duplicate-snapshot", "oversized-snapshot"])("rejects malformed evidence: %s", kind => {
    const project = speakerReviewProject(), evidence = target(project).speakerEvidence!;
    if (kind === "version") Object.assign(evidence, { version: 2 });
    if (kind === "unknown-reason") Object.assign(evidence, { reasons: ["definitely-person-one"] });
    if (kind === "NaN") evidence.activity[0]!.coverage = NaN;
    if (kind === "probability") evidence.words[0]!.asrProbability = 1.5;
    if (kind === "extra-field") Object.assign(evidence, { rawMedia: "not allowed" });
    if (kind === "too-many-words") evidence.words = Array(71).fill(evidence.words[0]);
    if (kind === "too-many-anchors") evidence.recommendation!.anchorCaptionIds = ["a", "b", "c"];
    if (kind === "duplicate-snapshot") evidence.recommendation!.sourceSnapshots[1] = evidence.recommendation!.sourceSnapshots[0]!;
    if (kind === "oversized-snapshot") evidence.recommendation!.sourceSnapshots[0]!.text = "x".repeat(501);
    expect(() => parseProject(JSON.stringify(project))).toThrow("화자 배정 근거");
  });
  it("accepts explicit budget truncation but never applies a proposal missing details", () => {
    const project = speakerReviewProject();
    target(project).speakerEvidence!.words = [];
    target(project).speakerEvidence!.wordsTruncated = true;
    expect(parseProject(JSON.stringify(project)).captions[0]!.speakerEvidence!.wordsTruncated).toBe(true);
    expect(checkSpeakerRecommendation(project, target(project)).eligible).toBe(false);
  });
});

describe("explicit bounded speaker proposal application", () => {
  it("only changes selected identity, preserves words/source/evidence, requires review and supports undo/redo", () => {
    const project = speakerReviewProject(), serialized = JSON.stringify(project);
    const snapshot = { project, session: 4 };
    expect(checkSpeakerRecommendation(project, target(project))).toEqual({ eligible: true, speakerId: "speaker-1" });
    const changed = applySpeakerRecommendations(project, snapshot, 4, new Set([target(project).id]));
    expect(target(changed)).toMatchObject({ start: target(project).start, end: target(project).end, text: target(project).text,
      words: target(project).words, speakerId: "speaker-1", reviewed: false, reasons: ["edited"] });
    expect(target(changed).speakerEvidence!.recommendation).toBeUndefined();
    expect(target(changed).speakerEvidence!.activity).toEqual(target(project).speakerEvidence!.activity);
    expect(changed.captions.slice(1)).toEqual(project.captions.slice(1));
    expect(JSON.stringify(project)).toBe(serialized);
    const saved = editProjectSession(createProjectSession(project), changed);
    expect(undoProjectSession(saved).current).toEqual(project);
    expect(redoProjectSession(undoProjectSession(saved)).current.captions).toEqual(changed.captions);
    expect(parseProject(serializeProject(saved.current)).captions).toEqual(changed.captions);
  });
  it.each(["edited", "reviewed", "assigned", "speech_uncertain", "timing", "overlap"])("protects target %s even when evidence includes a candidate", condition => {
    const project = speakerReviewProject(), cue = target(project);
    if (condition === "reviewed") cue.reviewed = true;
    else if (condition === "assigned") cue.speakerId = "speaker-2";
    else cue.reasons.push(condition as "edited" | "speech_uncertain" | "timing" | "overlap");
    expect(checkSpeakerRecommendation(project, cue).eligible).toBe(false);
    expect(() => applySpeakerRecommendations(project, { project, session: 1 }, 1, new Set([cue.id]))).toThrow();
  });
  it.each(["target-text", "target-time", "anchor-text", "anchor-time", "anchor-speaker", "anchor-edited", "anchor-uncertain", "anchor-low", "target-low", "missing-probability", "missing-anchor", "inserted-conflict"])("refuses stale or uncertain source evidence: %s", condition => {
    const project = speakerReviewProject(), cue = target(project), evidence = cue.speakerEvidence!;
    if (condition === "target-text") cue.text += " modified";
    if (condition === "target-time") cue.start += .02;
    if (condition === "anchor-text") anchor(project).text += " modified";
    if (condition === "anchor-time") anchor(project).end += .01;
    if (condition === "anchor-speaker") anchor(project).speakerId = "speaker-2";
    if (condition === "anchor-edited") anchor(project).reasons.push("edited");
    if (condition === "anchor-uncertain") anchor(project).reasons.push("speech_uncertain");
    if (condition === "anchor-low") anchor(project).words![0]!.probability = .1;
    if (condition === "target-low") evidence.words[0]!.asrProbability = .1;
    if (condition === "missing-probability") delete evidence.words[0]!.asrProbability;
    if (condition === "missing-anchor") project.captions.splice(1, 1);
    if (condition === "inserted-conflict") project.captions.push({ ...anchor(project), id: "conflict", start: 1.3, end: 1.5, speakerId: "speaker-2" });
    expect(checkSpeakerRecommendation(project, cue).eligible).toBe(false);
  });
  it("rejects different sessions, same-ID reopened projects, edits after selection and mixed invalid selections atomically", () => {
    const project = speakerReviewProject(), snapshot = { project, session: 1 }, ids = new Set([target(project).id]);
    expect(() => applySpeakerRecommendations(project, snapshot, 2, ids)).toThrow(SPEAKER_REVIEW_STALE);
    expect(() => applySpeakerRecommendations(structuredClone(project), snapshot, 1, ids)).toThrow(SPEAKER_REVIEW_STALE);
    expect(() => applySpeakerRecommendations({ ...project, name: "new name" }, snapshot, 1, ids)).toThrow(SPEAKER_REVIEW_STALE);
    expect(() => applySpeakerRecommendations(project, snapshot, 1, new Set([target(project).id, "target-2"]))).toThrow();
    expect(target(project).speakerId).toBeNull();
    expect(applySpeakerRecommendations(project, snapshot, 1, new Set())).toBe(project);
  });
  it("invalidates evidence on meaningful direct edits, but not styles, no-op or review toggles", () => {
    const cue = target(speakerReviewProject());
    expect(editCaption(cue, { text: cue.text })).toBe(cue);
    expect(editCaption(cue, { style: { bold: true } }).speakerEvidence).toBe(cue.speakerEvidence);
    expect(editCaption(cue, { reviewed: true }).speakerEvidence).toBe(cue.speakerEvidence);
    for (const change of [{ text: "edited" }, { start: .9 }, { speakerId: "speaker-1" }]) expect(editCaption(cue, change).speakerEvidence).toBeUndefined();
  });
  it("clamps original-audio listening context without changing timestamps", () => {
    expect(speakerReviewRange({ start: .4, end: .8 }, 1)).toEqual({ start: 0, end: 1 });
    expect(speakerReviewRange({ start: 10, end: 10.4 }, 20)).toEqual({ start: 8.5, end: 11.9 });
  });
});

describe("review dialog contract", () => {
  it("does not analyze, listen, or apply on mount and explains old results honestly", () => {
    const project = speakerReviewProject(); project.captions.forEach(caption => delete caption.speakerEvidence);
    const apply = vi.fn(), listen = vi.fn();
    const html = renderToStaticMarkup(<I18nProvider><SpeakerReviewDialog project={project} session={1} mediaAvailable={false} playing={false}
      onListen={listen} onStop={vi.fn()} onApply={apply} onClose={vi.fn()}/></I18nProvider>);
    expect(html).toContain("새 분석부터 후보가 생성됩니다.");
    expect(html).toContain("원인 상세 없음");
    expect(apply).not.toHaveBeenCalled(); expect(listen).not.toHaveBeenCalled();
  });
  it("does not mislabel omitted activity as evidence of silence", () => {
    const project = speakerReviewProject();
    target(project).speakerEvidence!.activity = []; target(project).speakerEvidence!.activityTruncated = true;
    const html = renderToStaticMarkup(<I18nProvider><SpeakerReviewDialog project={project} session={1} mediaAvailable={false} playing={false}
      onListen={vi.fn()} onStop={vi.fn()} onApply={vi.fn()} onClose={vi.fn()}/></I18nProvider>);
    expect(html).toContain("<p>활동 상세 생략</p>");
    expect(html).not.toContain("<p>화자 활동 없음</p>");
  });
  it("has complete five-language messages with matching placeholders", () => {
    for (const key of Object.keys(speakerReviewMessages)) for (const locale of LOCALES) {
      const value = dictionaries[locale][key]; expect(value).toBeTruthy();
      expect(value!.match(/\{\w+\}/g)?.sort() ?? []).toEqual(key.match(/\{\w+\}/g)?.sort() ?? []);
    }
  });
});
