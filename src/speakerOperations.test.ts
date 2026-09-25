import { describe, expect, it } from "vitest";
import { createProject, parseProject, type Caption, type Project } from "./domain";
import { evidenceFor, evidenceIsCurrent, type MinutesItem } from "./documents";
import { createProjectSession, editProjectSession, undoProjectSession } from "./projectSession";
import { assignAllCaptionsToSpeaker, editableSpeakers } from "./speakerOperations";

function fixture(): Project {
  const project = createProject(2);
  const captions: Caption[] = project.speakers.map((speaker, index) => ({
    id: `caption-${index}`, start: index * 2, end: index * 2 + 2,
    text: `Caption ${index}`, speakerId: speaker.id, reasons: ["speaker_count"], reviewed: false,
    words: [{ start: index * 2, end: index * 2 + 1, text: "Caption" }],
    style: { bold: true }, translation: { sourceText: `Caption ${index}`, texts: { ko: "자막" } },
  }));
  const unassigned: Caption = { id: "unassigned", start: 4, end: 5, text: "Hello", speakerId: null, reasons: ["unassigned", "overlap"], reviewed: false };
  const item: MinutesItem = { id: "meeting-item", kind: "summary", text: "Summary", owner: "", due: "", evidence: [evidenceFor(captions[0]!)], status: "reviewed" };
  return { ...project, duration: 6, captions: [...captions, unassigned], notes: [
    { id: "note", start: 1, end: null, text: "Keep this", tag: "edit", done: false },
  ], documents: { roles: {}, tags: {}, items: [item] } };
}

describe("analysis count and current subtitle identities", () => {
  it("shows only the requested preparation identities for an empty project without deleting saved names", () => {
    const project = createProject(4);
    const onePerson = { ...project, speakerCount: 1 };
    expect(editableSpeakers(onePerson)).toEqual([project.speakers[0]]);
    expect(onePerson.speakers).toHaveLength(4);
  });

  it("never hides or merges assigned identities when only the next-analysis count changes", () => {
    const project = fixture();
    const before = structuredClone(project);
    expect(editableSpeakers({ ...project, speakerCount: 1 })).toEqual(project.speakers);
    expect(project).toEqual(before);
  });

  it("does not add preparation identities to a caption project or unassigned-only timeline", () => {
    const project = fixture();
    expect(editableSpeakers({ ...project, speakerCount: 4, captions: [project.captions[1]!] })).toEqual([project.speakers[1]]);
    expect(editableSpeakers({ ...project, captions: [project.captions[2]!] })).toEqual([]);
  });

  it("explicitly reassigns every caption, including unassigned, preserving text, times, styles and original identities", () => {
    const project = fixture();
    const before = structuredClone(project);
    const target = project.speakers[1]!;
    const next = assignAllCaptionsToSpeaker(project, target.id);
    expect(next.speakerCount).toBe(1);
    expect(editableSpeakers(next)).toEqual([target]);
    expect(next.speakers).toBe(project.speakers);
    expect(next.notes).toBe(project.notes);
    expect(next.documents).toBe(project.documents);
    expect(next.captions.map(caption => caption.speakerId)).toEqual([target.id, target.id, target.id]);
    next.captions.forEach((caption, index) => {
      const original = project.captions[index]!;
      expect(caption).toEqual({ ...original, speakerId: target.id, reasons: original.reasons.filter(reason => !["unassigned", "speaker_count"].includes(reason)) });
    });
    expect(next.captions[2]!.reasons).toEqual(["overlap"]);
    expect(parseProject(JSON.stringify(next)).captions).toEqual(next.captions);
    expect(project).toEqual(before);
  });

  it("keeps the merge as one undo step and marks old speaker evidence stale until undone", () => {
    const project = fixture();
    const item = project.documents!.items[0]!;
    const merged = editProjectSession(createProjectSession(project), current => assignAllCaptionsToSpeaker(current, current.speakers[1]!.id));
    expect(evidenceIsCurrent(item, merged.current.captions)).toBe(false);
    const undone = undoProjectSession(merged);
    expect(undone.current).toBe(project);
    expect(evidenceIsCurrent(item, undone.current.captions)).toBe(true);
  });

  it("rejects a missing destination without changing any data", () => {
    const project = fixture();
    const before = structuredClone(project);
    expect(() => assignAllCaptionsToSpeaker(project, "missing")).toThrow(/존재하지/);
    expect(project).toEqual(before);
  });
});
