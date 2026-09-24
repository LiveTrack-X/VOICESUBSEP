import { describe, expect, it } from "vitest";
import { buildKeepSpans, normalizeCuts, outputToSource, projectForEditedExport, sourceToOutput } from "./cuts";
import { createProject, parseProject, type Caption, type CutRange, type Note, type Project } from "./domain";

const cut = (start: number, end: number, id = "cut-1"): CutRange => ({ id, start, end });
const caption = (id: string, start: number, end: number, text = "Hello world"): Caption => ({
  id, start, end, text, speakerId: "speaker-1", reasons: ["speaker_boundary"], reviewed: true,
  style: { textColor: "#ffffff", bold: true },
});
const note = (id: string, start: number, end: number | null): Note => ({ id, start, end, text: "Keep this note", tag: "edit", done: true });
function fixture(cuts: CutRange[] = [cut(3, 5)]): Project {
  return { ...createProject(), schemaVersion: 2, duration: 10, cuts, captions: [], notes: [] };
}

describe("source-time cuts", () => {
  it("unions overlap and touching exclusions without changing saved ranges", () => {
    const cuts = [cut(6, 9, "c"), cut(2, 4, "a"), cut(3, 6, "b"), cut(-3, 1, "d"), cut(11, 12, "e")];
    const before = structuredClone(cuts);
    expect(normalizeCuts(cuts, 10)).toEqual([cut(0, 1, "d"), cut(2, 9, "a")]);
    expect(cuts).toEqual(before);
  });

  it("builds a gap-free output with exact microsecond joins", () => {
    const spans = buildKeepSpans([cut(0.1, 0.2), cut(0.3, 0.4, "b")], 0.6);
    expect(spans).toEqual([
      { sourceStart: 0, sourceEnd: 0.1, outputStart: 0, outputEnd: 0.1 },
      { sourceStart: 0.2, sourceEnd: 0.3, outputStart: 0.1, outputEnd: 0.2 },
      { sourceStart: 0.4, sourceEnd: 0.6, outputStart: 0.2, outputEnd: 0.4 },
    ]);
    expect(outputToSource(0.1 + 0.1, spans)).toBe(0.4);
  });

  it("selects the right side of joins and rejects deleted source time", () => {
    const spans = buildKeepSpans([cut(0, 1), cut(3, 5, "b"), cut(9, 10, "c")], 10);
    expect(outputToSource(0, spans)).toBe(1);
    expect(outputToSource(2, spans)).toBe(5);
    expect(outputToSource(-1, spans)).toBe(1);
    expect(outputToSource(99, spans)).toBe(9);
    expect(sourceToOutput(0.5, spans)).toBeNull();
    expect(sourceToOutput(3, spans)).toBeNull();
    expect(sourceToOutput(4.999, spans)).toBeNull();
    expect(sourceToOutput(5, spans)).toBe(2);
    expect(sourceToOutput(9, spans)).toBe(6);
    expect(sourceToOutput(10, spans)).toBeNull();
    for (const time of [0, 0.25, 1.5, 2, 3.333333, 6]) {
      expect(sourceToOutput(outputToSource(time, spans), spans)).toBe(time);
    }
  });

  it("represents all-deleted and zero-duration sources without negative spans", () => {
    expect(buildKeepSpans([cut(0, 10)], 10)).toEqual([]);
    expect(buildKeepSpans([], 0)).toEqual([]);
    expect(sourceToOutput(0, [])).toBeNull();
    expect(outputToSource(4, [])).toBe(0);
    expect(() => normalizeCuts([], -1)).toThrow();
    expect(() => normalizeCuts([cut(Number.NaN, 1)], 10)).toThrow();
    expect(() => outputToSource(Number.POSITIVE_INFINITY, [])).toThrow();
  });
});

describe("derived edited project", () => {
  it("preserves full captions, speaker styles, translations, and source data", () => {
    const source = fixture();
    source.speakers[0]!.subtitleStyle = { fontFamily: "serif" };
    source.captions = [caption("before", 1, 3), caption("after", 5, 8)];
    source.captions[1]!.words = [{ start: 5, end: 6, text: "Hello " }, { start: 7, end: 8, text: "world" }];
    source.captions[1]!.translation = { sourceText: "Hello world", texts: { ko: "안녕 세상" } };
    const before = structuredClone(source);
    const { project, issues } = projectForEditedExport(source);
    expect(source).toEqual(before);
    expect(project.schemaVersion).toBe(1);
    expect(project).not.toHaveProperty("cuts");
    expect(project.duration).toBe(8);
    expect(project.captions[0]).toEqual(source.captions[0]);
    expect(project.captions[1]).toEqual({ ...source.captions[1], start: 3, end: 6, words: [
      { start: 3, end: 4, text: "Hello " }, { start: 5, end: 6, text: "world" },
    ] });
    expect(issues).toEqual([]);
    project.captions[0]!.style!.bold = false;
    project.speakers[0]!.name = "Changed clone";
    expect(source).toEqual(before);
    expect(parseProject(JSON.stringify(project))).toEqual(project);
  });

  it("splits a crossing caption only at intact word groups, discarding deleted words", () => {
    const source = fixture();
    source.captions = [{ ...caption("words", 1, 8, "Hello hidden world"),
      words: [{ start: 1, end: 2, text: "Hello" }, { start: 3, end: 5, text: " hidden" }, { start: 6, end: 7, text: " world" }],
      translation: { sourceText: "Hello hidden world", texts: { es: "Hola mundo oculto" } },
    }];
    const { project, issues } = projectForEditedExport(source);
    expect(issues).toEqual([]);
    expect(project.captions.map(({ id, start, end, text }) => ({ id, start, end, text }))).toEqual([
      { id: "words", start: 1, end: 3, text: "Hello" },
      { id: "words.cut-2", start: 3, end: 6, text: "world" },
    ]);
    expect(project.captions[1]!.words).toEqual([{ start: 4, end: 5, text: " world" }]);
    expect(project.captions.every((item) => item.translation === undefined)).toBe(true);
    expect(project.captions[1]!.style).toEqual(source.captions[0]!.style);
  });

  it.each([
    ["spaced tokens", "Hello world", ["Hello", "world"]],
    ["unspaced tokens", "你好世界", ["你好", "世界"]],
    ["punctuation", "Hello, world", ["Hello,", " world"]],
    ["line break", "Hello\nworld", ["Hello", "world"]],
  ])("uses reconstructable %s text", (_label, text, texts) => {
    const source = fixture();
    source.captions = [{ ...caption("words", 1, 8, text), words: [
      { start: 1, end: 2, text: texts[0]! }, { start: 6, end: 7, text: texts[1]! },
    ] }];
    const result = projectForEditedExport(source);
    expect(result.issues).toEqual([]);
    expect(result.project.captions).toHaveLength(2);
  });

  it.each([
    ["missing_word_timing", undefined],
    ["missing_word_timing", []],
    ["stale_word_text", [{ start: 1, end: 2, text: "Previous text" }]],
    ["invalid_word_timing", [{ start: 0, end: 2, text: "Hello world" }]],
    ["invalid_word_timing", [{ start: 6, end: 7, text: "Hello" }, { start: 1, end: 2, text: " world" }]],
    ["cut_through_word", [{ start: 2, end: 4, text: "Hello" }, { start: 6, end: 7, text: " world" }]],
  ] as const)("blocks ambiguous crossing text: %s", (reason, words) => {
    const source = fixture();
    source.captions = [{ ...caption("ambiguous", 1, 8), ...(words ? { words: [...words] } : {}) }];
    const before = structuredClone(source);
    const result = projectForEditedExport(source);
    expect(result.issues).toEqual([{ captionId: "ambiguous", reason }]);
    expect(result.project.captions).toHaveLength(1);
    expect(result.project.captions[0]).toMatchObject({ text: "Hello world", start: 1, end: 6, reasons: ["speaker_boundary", "timing"], reviewed: false });
    expect(result.project.captions[0]).not.toHaveProperty("words");
    expect(source).toEqual(before);
  });

  it("does not demand word evidence for captions deleted in their entirety", () => {
    const source = fixture();
    source.captions = [caption("gone", 3, 5)];
    const result = projectForEditedExport(source);
    expect(result.project.captions).toEqual([]);
    expect(result.issues).toEqual([]);
  });

  it("splits range notes and applies half-open deletion boundaries to point notes", () => {
    const source = fixture([cut(3, 5), cut(9, 10, "tail")]);
    source.notes = [note("range", 1, 8), note("at-start", 3, null), note("at-end", 5, null), note("zero-kept", 2, 2), note("zero-gone", 4, 4), note("tail-start", 9, null), note("deleted-range", 3, 5)];
    const result = projectForEditedExport(source);
    expect(result.project.notes.map(({ id, start, end }) => ({ id, start, end }))).toEqual([
      { id: "range", start: 1, end: 3 }, { id: "range.cut-2", start: 3, end: 6 },
      { id: "at-end", start: 3, end: null }, { id: "zero-kept", start: 2, end: 2 },
    ]);
    expect(result.omittedNoteIds).toEqual(["at-start", "zero-gone", "tail-start", "deleted-range"]);
    expect(result.project.notes.every((item) => item.text === "Keep this note" && item.done)).toBe(true);
  });

  it("avoids collisions and length overflow in fragment IDs", () => {
    const source = fixture();
    const long = "a".repeat(128);
    source.notes = [note("note", 1, 8), note("note.cut-2", 6, null), note(long, 1, 8)];
    const result = projectForEditedExport(source);
    expect(result.project.notes.map((item) => item.id)).toContain("note.cut-3");
    expect(new Set(result.project.notes.map((item) => item.id)).size).toBe(5);
    expect(parseProject(JSON.stringify(result.project))).toEqual(result.project);
  });

  it("returns empty output for full deletion and a detached identity when all cuts are restored", () => {
    const source = fixture([cut(0, 10)]);
    source.captions = [caption("caption", 1, 8)];
    source.notes = [note("note", 4, null)];
    const removed = projectForEditedExport(source);
    expect(removed.project.duration).toBe(0);
    expect(removed.project.captions).toEqual([]);
    expect(removed.omittedNoteIds).toEqual(["note"]);
    source.cuts = [];
    const restored = projectForEditedExport(source);
    expect(restored.project.captions).toEqual(source.captions);
    expect(restored.project.captions).not.toBe(source.captions);
    expect(restored.project.notes).toEqual(source.notes);
    expect(restored.project.duration).toBe(10);
  });
});
