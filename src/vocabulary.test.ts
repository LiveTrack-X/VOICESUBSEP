import { describe, expect, it } from "vitest";
import { createProject, parseProject, serializeProject } from "./domain";
import { parseVocabulary, parseVocabularyText, vocabularyBlockReason, vocabularySupportNotice } from "./vocabulary";
import { editProjectSession, createProjectSession, undoProjectSession } from "./projectSession";

describe("project vocabulary", () => {
  it("roundtrips project terms without changing manual captions", () => {
    const project = createProject(1);
    project.duration = 2;
    project.captions = [{ id: "manual", start: 0, end: 1, text: "직접 고친 문구", speakerId: "speaker-1", reasons: ["edited"], reviewed: true }];
    const value = { ...project, vocabulary: ["젠야타", "Dragon's Dogma"] };
    const restored = parseProject(serializeProject(value));
    expect(restored).toEqual(value);
    expect(restored.captions).toEqual(project.captions);
    expect(parseProject(serializeProject(project))).not.toHaveProperty("vocabulary");
  });
  it("normalizes NFC and edge spaces, preserving case and punctuation", () => {
    expect(parseVocabularyText("  젠야타 \r\n\ncafe\u0301\ncafé\nD.Va\nD.va")).toEqual(["젠야타", "café", "D.Va", "D.va"]);
  });
  it.each([null, "one", [1], [""], ["  "], ["a\tb"], ["a\nb"], ["a\rb"], ["a\0b"], ["a\x85b"], ["a\u2028b"], ["x".repeat(51)], Array.from({ length: 51 }, (_, i) => `${i}`), Array.from({ length: 40 }, (_, i) => `${i}`.padStart(50, "x"))])("rejects invalid/unbounded portable terms %#", value => {
    expect(() => parseVocabulary(value)).toThrow();
    expect(() => parseProject(JSON.stringify({ ...createProject(), vocabulary: value }))).toThrow();
  });
  it("counts Unicode characters consistently with the backend", () => {
    expect(parseVocabulary(["😀".repeat(50)])).toEqual(["😀".repeat(50)]);
    expect(() => parseVocabulary(["😀".repeat(51)])).toThrow();
  });
  it("limits Groq by UTF-8 bytes without silently dropping terms", () => {
    const selection = { provider: "groq", model: "whisper-large-v3" } as const;
    expect(vocabularyBlockReason(["x".repeat(50), "y".repeat(50)], selection)).toBeNull();
    const terms = ["한".repeat(50), "글".repeat(50)], before = terms.slice();
    expect(vocabularyBlockReason(terms, selection)).toContain("224");
    expect(vocabularyBlockReason(terms, { provider: "local" })).toBeNull();
    expect(terms).toEqual(before);
  });
  it("discloses unsupported timestamp/legacy paths without blocking analysis", () => {
    for (const selection of [{ provider: "gemini", model: "gemini-3.5-transcribe" }, { provider: "xai", model: "grok-voice-transcribe-1.0" }] as const) {
      expect(vocabularySupportNotice(["젠야타"], selection)).toContain("전송하지");
      expect(vocabularyBlockReason(["젠야타"], selection)).toBeNull();
      expect(vocabularySupportNotice([], selection)).toBeNull();
    }
    expect(vocabularySupportNotice(["젠야타"], { provider: "xai", model: "grok-voice-transcribe-2.0" })).toBeNull();
  });
  it("saves and undoes only project terms while preserving manual work", () => {
    const project = createProject(1);
    project.captions = [{ id: "manual", start: 0, end: 1, text: "수동 편집", speakerId: null, reasons: ["edited"], reviewed: true }];
    const edited = editProjectSession(createProjectSession(project), previous => ({ ...previous, vocabulary: ["D.Va"] }));
    expect(edited.current.captions).toEqual(project.captions);
    expect(undoProjectSession(edited).current).toEqual(project);
  });
});
