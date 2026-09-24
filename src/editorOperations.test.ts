import { describe, expect, it } from "vitest";
import { createProject, MAX_CAPTIONS, parseProject, type Caption, type Project } from "./domain";
import { addCaption, bulkEditCaptions, captionPage, mergeCaptions, nextCaptionToReview,
  replaceCaptionText, replacementCount, splitCaption } from "./editorOperations";
import { createProjectSession, editProjectSession, undoProjectSession } from "./projectSession";

function fixture(): Project {
  const project = createProject();
  const caption = (id: string, start: number, text: string): Caption => ({ id, start, end: start + 2,
    text, speakerId: project.speakers[0]!.id, reasons: ["overlap"], reviewed: false });
  return { ...project, duration: 12, captions: [caption("a", 0, "hello world"), caption("b", 2, "hello again"), caption("c", 4, "third caption")] };
}

describe("safe subtitle operations", () => {
  it("adds the first caption to an empty project without ASR or SRT", () => {
    const project = createProject();
    const next = addCaption(project, 0, "new caption", "first");
    expect(next.captions).toMatchObject([{ id: "first", start: 0, end: 2, text: "new caption", speakerId: null }]);
    expect(project.captions).toEqual([]);
    expect(parseProject(JSON.stringify(next)).captions).toHaveLength(1);
  });
  it("bounds newly added captions to linked media, rejects the end, but permits media-free work", () => {
    const project = { ...createProject(), duration: 12, mediaName: "recording.wav" };
    expect(addCaption(project, 11.5, "last").captions[0]?.end).toBe(12);
    expect(() => addCaption(project, 12, "unplayable")).toThrow(/미디어 끝/);
    expect(addCaption({ ...project, mediaName: null }, 20, "manual").captions[0]?.end).toBe(22);
  });
  it("rejects overlong merge without changing either source and retains valid saved format", () => {
    const project = fixture();
    project.captions[0]!.text = "a".repeat(6_000);
    project.captions[1]!.text = "b".repeat(6_000);
    const before = structuredClone(project);
    expect(() => mergeCaptions(project, "a", "b")).toThrow(/10,000/);
    expect(project).toEqual(before);
    expect(parseProject(JSON.stringify(project)).captions).toHaveLength(3);
  });
  it("accepts a merge exactly at the 10,000 character boundary", () => {
    const project = fixture(); project.captions[0]!.text = "a".repeat(5_000); project.captions[1]!.text = "b".repeat(4_999);
    const result = mergeCaptions(project, "a", "b");
    expect(result.captions[0]!.text).toHaveLength(10_000);
    expect(result.captions[0]!.end).toBe(4);
    expect(parseProject(JSON.stringify(result)).captions).toHaveLength(2);
  });
  it("guards both add and split at the project caption limit", () => {
    const project = fixture();
    project.captions = Array.from({ length: MAX_CAPTIONS }, (_, index) => ({ ...project.captions[0]!, id: `c-${index}` }));
    expect(() => addCaption(project, 5, "new")).toThrow(/20,000/);
    expect(() => splitCaption(project, "c-0", 1)).toThrow(/20,000/);
    expect(project.captions).toHaveLength(MAX_CAPTIONS);
  });
  it("keeps normal split and merge undoable as single edits", () => {
    const original = fixture();
    const split = editProjectSession(createProjectSession(original), (project) => splitCaption(project, "a", 1, "second-half"));
    expect(split.current.captions.slice(0, 2).map((caption) => caption.text)).toEqual(["hello", "world"]);
    expect(undoProjectSession(split).current).toBe(original);
    expect(mergeCaptions(split.current, "a", "second-half").captions[0]!.text).toBe("hello world");
  });
});

describe("bulk subtitle editing and literal replacement", () => {
  it("assigns only selected IDs, removes unassigned reason, and preserves other reasons and words", () => {
    const project = fixture(); project.captions[0]!.speakerId = null; project.captions[0]!.reasons = ["unassigned", "overlap"];
    project.captions[0]!.words = [{ start: 0, end: 1, text: "hello" }];
    const next = bulkEditCaptions(project, new Set(["a", "missing"]), { kind: "speaker", speakerId: project.speakers[1]!.id });
    expect(next.captions[0]).toMatchObject({ speakerId: project.speakers[1]!.id, reasons: ["overlap"], words: project.captions[0]!.words });
    expect(next.captions[1]).toBe(project.captions[1]);
    expect(() => bulkEditCaptions(project, new Set(["a"]), { kind: "speaker", speakerId: "missing" })).toThrow(/존재하지/);
  });
  it("marks and deletes selected captions in one undo step without touching notes", () => {
    const original = fixture(); const ids = new Set(["a", "c"]);
    const marked = bulkEditCaptions(original, ids, { kind: "review", reviewed: true });
    expect(marked.captions.map((caption) => caption.reviewed)).toEqual([true, false, true]);
    const session = editProjectSession(createProjectSession(original), (project) => bulkEditCaptions(project, ids, { kind: "delete" }));
    expect(session.current.captions.map((caption) => caption.id)).toEqual(["b"]);
    expect(session.current.notes).toBe(original.notes);
    expect(undoProjectSession(session).current).toBe(original);
  });
  it("does not create no-op history entries", () => {
    const session = createProjectSession(fixture());
    expect(editProjectSession(session, (project) => bulkEditCaptions(project, new Set(), { kind: "delete" }))).toBe(session);
  });
  it("replaces literal regex symbols and dollar values only in scope, preserving stale-translation evidence", () => {
    const project = fixture();
    project.captions[0]!.text = "Hello .* hello .*";
    project.captions[0]!.translation = { sourceText: project.captions[0]!.text, texts: { ko: "기존 번역" } };
    project.captions[0]!.reviewed = true;
    project.captions[0]!.words = [{ start: 0, end: 1, text: "old" }];
    const result = replaceCaptionText(project, new Set(["a"]), ".*", "$&");
    expect(result.captions[0]!.text).toBe("Hello $& hello $&");
    expect(result.captions[0]!.words).toBeUndefined();
    expect(result.captions[0]!.reviewed).toBe(false);
    expect(result.captions[0]!.translation?.sourceText).toBe("Hello .* hello .*");
    expect(result.captions[1]).toBe(project.captions[1]);
    expect(replacementCount(result.captions, new Set(["a", "b"]), "hello")).toBe(2);
  });
  it("rejects all replacements atomically if any resulting caption exceeds the limit", () => {
    const project = fixture(); project.captions[0]!.text = "a"; project.captions[1]!.text = "aa";
    const before = structuredClone(project);
    expect(() => replaceCaptionText(project, new Set(["a", "b"]), "a", "x".repeat(6_000))).toThrow(/10,000/);
    expect(project).toEqual(before);
    expect(() => replaceCaptionText(project, new Set(["a"]), "", "x")).toThrow(/찾을 내용/);
  });
  it("supports deletion replacements and exact-case matching", () => {
    const project = fixture(); project.captions[0]!.text = "Hello hello";
    expect(replaceCaptionText(project, new Set(["a"]), "hello", "").captions[0]!.text).toBe("Hello ");
  });
});

describe("bounded page and review navigation", () => {
  it("computes stable 100-row pages for a 2,404-caption project", () => {
    expect([0, 99, 100, 2399, 2400, 2403].map(captionPage)).toEqual([0, 0, 1, 23, 24, 24]);
  });
  it("wraps through the current filtered list and treats unassigned inventory independently of reviewed", () => {
    const project = fixture(); project.captions[1]!.reviewed = true; project.captions[1]!.speakerId = null;
    expect(nextCaptionToReview(project.captions, "a", "review")?.id).toBe("c");
    expect(nextCaptionToReview(project.captions, "c", "review")?.id).toBe("a");
    expect(nextCaptionToReview(project.captions, "a", "unassigned")?.id).toBe("b");
    expect(nextCaptionToReview([project.captions[0]!], "a", "unassigned")).toBeUndefined();
    expect(nextCaptionToReview([], null, "review")).toBeUndefined();
  });
});
