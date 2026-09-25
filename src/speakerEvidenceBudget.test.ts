import { describe, expect, it } from "vitest";
import { fitSpeakerEvidence } from "./speakerEvidenceBudget";
import { speakerReviewProject } from "./testFixtures/speakerReviewProject";
import { parseProject, type Project } from "./domain";

const bytes = (value: Project) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
const originals = (project: Project) => project.captions.map(caption => { const { speakerEvidence: _evidence, ...data } = caption; return data; });
describe("optional evidence budget preserves original work", () => {
  it("does not alter a project that already fits", () => {
    const project = speakerReviewProject(); expect(fitSpeakerEvidence(project, bytes(project))).toEqual({ project, reduced: false });
    expect(fitSpeakerEvidence(project, bytes(project)).project).toBe(project);
  });
  it("omits unrelated word detail first while preserving proposals and supporting evidence", () => {
    const project = speakerReviewProject(), extra = project.captions.at(-1)!;
    extra.speakerEvidence = structuredClone(project.captions[1]!.speakerEvidence!);
    extra.speakerEvidence.words = Array.from({ length: 70 }, () => structuredClone(extra.speakerEvidence!.words[0]!));
    const expected = structuredClone(project);
    for (const caption of expected.captions) {
      if (!caption.speakerEvidence || caption.speakerEvidence.recommendation || ["anchor-1", "anchor-2", "anchor-3"].includes(caption.id)) continue;
      caption.speakerEvidence.words = []; caption.speakerEvidence.wordsTruncated = true;
    }
    const before = JSON.stringify(project), result = fitSpeakerEvidence(project, bytes(expected));
    expect(result.reduced).toBe(true);
    expect(result.project.captions[0]!.speakerEvidence).toEqual(project.captions[0]!.speakerEvidence);
    expect(result.project.captions[1]!.speakerEvidence).toEqual(project.captions[1]!.speakerEvidence);
    expect(result.project.captions.at(-1)!.speakerEvidence?.words).toEqual([]);
    expect(bytes(result.project)).toBeLessThanOrEqual(bytes(expected));
    expect(originals(result.project)).toEqual(originals(project));
    expect(JSON.stringify(project)).toBe(before);
    expect(parseProject(JSON.stringify(result.project))).toEqual(result.project);
  });
  it("discards only optional diagnostics at the tightest limit, retaining notes, words, styles and edits", () => {
    const project = speakerReviewProject(); project.notes = [{ id: "note", start: 2, end: null, text: "보존할 합성 메모", tag: "edit", done: false }];
    project.captions[0]!.style = { bold: true };
    const plain = { ...project, captions: originals(project) };
    const result = fitSpeakerEvidence(project, bytes(plain));
    expect(result.reduced).toBe(true); expect(result.project).toEqual(plain);
    expect(parseProject(JSON.stringify(result.project))).toEqual(plain);
    expect(fitSpeakerEvidence(project, 1).project).toEqual(plain); // The caller still rejects oversized primary data.
    expect(fitSpeakerEvidence(plain, 1)).toEqual({ project: plain, reduced: false });
  });
});
