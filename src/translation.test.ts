import { afterEach, describe, expect, it, vi } from "vitest";
import { createProject, parseProject, type Caption, type Project, type SubtitleLanguage } from "./domain";
import { translationMessages } from "./i18n-translation";
import {
  applyTranslations, buildTranslationBatches, captionTranslatedText, hasFreshTranslation,
  isValidTranslationText, MAX_TRANSLATION_BATCH_CAPTIONS, MAX_TRANSLATION_BATCH_CHARACTERS,
  MissingTranslationError, translateBatch, translatedProject, translationStatus,
} from "./translation";

function caption(id = "caption-1", text = "Original source"): Caption {
  return { id, text, start: 1, end: 2, speakerId: "speaker-1", reasons: [], reviewed: true,
    words: [{ start: 1, end: 2, text }], style: { bold: true } };
}
function project(...captions: Caption[]): Project {
  return { ...createProject(), duration: 10, captions };
}
afterEach(() => { vi.unstubAllGlobals(); });

describe("translation batches", () => {
  it("limits sequential request batches to eight captions without losing source order", () => {
    const captions = Array.from({ length: 19 }, (_, index) => caption(`caption-${index}`, `Text ${index}`));
    const batches = buildTranslationBatches(captions, "es");
    expect(batches.map((batch) => batch.length)).toEqual([8, 8, 3]);
    expect(batches.flat()).toEqual(captions.map(({ id, text }) => ({ id, text })));
    expect(batches.every((batch) => batch.length <= MAX_TRANSLATION_BATCH_CAPTIONS)).toBe(true);
  });

  it("respects the character limit at exact boundaries and never splits a caption", () => {
    const captions = [caption("a", "a".repeat(8_000)), caption("b", "b".repeat(4_000)), caption("c", "c"), caption("d", "d".repeat(10_000))];
    const batches = buildTranslationBatches(captions, "en");
    expect(batches.map((batch) => batch.map((item) => item.id))).toEqual([["a", "b"], ["c", "d"]]);
    expect(batches.every((batch) => batch.reduce((size, item) => size + item.text.length, 0) <= MAX_TRANSLATION_BATCH_CHARACTERS)).toBe(true);
    expect(() => buildTranslationBatches([caption("oversize", "x".repeat(12_001))], "en")).toThrow();
  });

  it("skips fresh target translations and empty captions while retaining stale or missing targets", () => {
    const fresh = { ...caption("fresh"), translation: { sourceText: "Original source", texts: { en: "Fresh translation" } } };
    const stale = { ...caption("stale", "Updated source"), translation: { sourceText: "Old source", texts: { en: "Old translation" } } };
    const otherLanguage = { ...caption("other"), translation: { sourceText: "Original source", texts: { es: "Hola" } } };
    const captions = [fresh, stale, otherLanguage, caption("empty", " \n "), caption("missing")];
    expect(buildTranslationBatches(captions, "en").flat().map((item) => item.id)).toEqual(["stale", "other", "missing"]);
    expect(buildTranslationBatches(captions, "en", true).flat().map((item) => item.id)).toEqual(["fresh", "stale", "other", "missing"]);
  });
});

describe("source-preserving translation edits", () => {
  it("applies one target without modifying original text, words, style, or other fresh languages", () => {
    const source = project({ ...caption(), translation: { sourceText: "Original source", texts: { en: "English translation" } } });
    const before = structuredClone(source);
    const result = applyTranslations(source, [{ id: "caption-1", sourceText: "Original source", text: "한국어 번역" }], "ko");
    expect(source).toEqual(before);
    expect(result).not.toBe(source);
    expect(result.captions[0]).toEqual({ ...source.captions[0], translation: { sourceText: "Original source", texts: { en: "English translation", ko: "한국어 번역" } } });
    expect(result.captions[0]!.words).toBe(source.captions[0]!.words);
    expect(parseProject(JSON.stringify(result))).toEqual(result);
  });

  it("skips deleted captions, changed source text, and invalid results", () => {
    const source = project(caption("a", "Changed source"), caption("b"), caption("c"));
    const result = applyTranslations(source, [
      { id: "missing", sourceText: "Original source", text: "No caption" },
      { id: "a", sourceText: "Original source", text: "Stale result" },
      { id: "b", sourceText: "Original source", text: "  " },
      { id: "c", sourceText: "Original source", text: "x".repeat(8_001) },
    ], "en");
    expect(result).toBe(source);
  });

  it("does not falsely refresh other languages after the canonical text changes", () => {
    const source = project({ ...caption("a", "New source"), translation: { sourceText: "Old source", texts: { en: "Old English", ja: "古い訳" } } });
    const result = applyTranslations(source, [{ id: "a", sourceText: "New source", text: "New English" }], "en");
    expect(result.captions[0]!.translation).toEqual({ sourceText: "New source", texts: { en: "New English" } });
    expect(captionTranslatedText(result.captions[0]!, "ja")).toBe("New source");
    expect(source.captions[0]!.translation!.texts.ja).toBe("古い訳");
  });

  it("does not create a no-op undo entry for identical results", () => {
    const source = project({ ...caption(), translation: { sourceText: "Original source", texts: { en: "English" } } });
    expect(applyTranslations(source, [{ id: "caption-1", sourceText: "Original source", text: "English" }], "en")).toBe(source);
  });

  it("falls back to canonical text as soon as an edit invalidates translation evidence", () => {
    const item = { ...caption(), translation: { sourceText: "Original source", texts: { es: "Hola" } } };
    expect(hasFreshTranslation(item, "es")).toBe(true);
    expect(captionTranslatedText(item, "es")).toBe("Hola");
    expect(captionTranslatedText(item, "ja")).toBe("Original source");
    item.text = "Changed source";
    expect(hasFreshTranslation(item, "es")).toBe(false);
    expect(captionTranslatedText(item, "es")).toBe("Changed source");
  });

  it.each(["", "  ", "a".repeat(8_001), "not\u0000valid", null, 1])("rejects unusable translation text %#", (value) => {
    expect(isValidTranslationText(value)).toBe(false);
  });

  it("accepts Unicode and intentional line breaks within the stored text limit", () => {
    expect(isValidTranslationText("안녕 👋\nこんにちは 你好 Hola")).toBe(true);
    expect(isValidTranslationText("a".repeat(8_000))).toBe(true);
  });
});

describe("translated exports", () => {
  it("uses translated text with source caption times and removes original-token evidence", () => {
    const source = project({ ...caption(), translation: { sourceText: "Original source", texts: { en: "Translated text" } } });
    const before = structuredClone(source);
    const result = translatedProject(source, "en");
    expect(result.captions[0]).toEqual({ id: "caption-1", text: "Translated text", start: 1, end: 2, speakerId: "speaker-1", reasons: [], reviewed: true, style: { bold: true } });
    expect(source).toEqual(before);
    result.speakers[0]!.name = "Detached";
    expect(source).toEqual(before);
  });

  it("blocks partial and stale target exports with exact missing source IDs", () => {
    const source = project(
      { ...caption("fresh"), translation: { sourceText: "Original source", texts: { en: "Fresh" } } },
      caption("missing"),
      { ...caption("stale", "Updated"), translation: { sourceText: "Original source", texts: { en: "Old" } } },
    );
    try { translatedProject(source, "en"); throw new Error("Expected rejection"); }
    catch (error) {
      expect(error).toBeInstanceOf(MissingTranslationError);
      expect((error as MissingTranslationError).captionIds).toEqual(["missing", "stale"]);
    }
  });

  it("rejects unsupported target languages at all mutation/export entry points", () => {
    const invalid = "fr" as SubtitleLanguage;
    expect(() => translatedProject(project(), invalid)).toThrow();
    expect(() => applyTranslations(project(), [], invalid)).toThrow();
    expect(() => buildTranslationBatches([], invalid)).toThrow();
  });
});

describe("local translation API", () => {
  function mockResponse(value: unknown) {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }
  const input = [{ id: "a", text: "One" }, { id: "b", text: "Two" }];
  const result = { target: "es", model: "local-model", captions: [{ id: "b", sourceText: "Two", text: "Dos" }, { id: "a", sourceText: "One", text: "Uno" }] };

  it("validates local-only runtime status", async () => {
    mockResponse({ ready: true, models: ["local-model"], engine: "ollama", localOnly: true });
    expect(await translationStatus()).toMatchObject({ ready: true, localOnly: true });
    mockResponse({ ready: true, models: ["remote-model"], engine: "ollama", localOnly: false });
    await expect(translationStatus()).rejects.toThrow();
  });

  it("sends an explicit device and restores caption order after ID-validated responses", async () => {
    const fetchMock = mockResponse(result);
    const rows = await translateBatch(input, "es", "local-model", "cpu");
    expect(rows.map((row) => row.id)).toEqual(["a", "b"]);
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/translation/batch");
    const options = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(JSON.parse(options.body as string)).toEqual({ model: "local-model", target: "es", device: "cpu", captions: input });
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    ["wrong language", { ...result, target: "ja" }],
    ["wrong model", { ...result, model: "other-model" }],
    ["missing result", { ...result, captions: [result.captions[0]] }],
    ["duplicate ID", { ...result, captions: [result.captions[0], result.captions[0]] }],
    ["wrong source", { ...result, captions: [result.captions[0], { id: "a", sourceText: "Changed", text: "Uno" }] }],
    ["empty text", { ...result, captions: [result.captions[0], { id: "a", sourceText: "One", text: "" }] }],
    ["unknown ID", { ...result, captions: [result.captions[0], { id: "unknown", sourceText: "One", text: "Uno" }] }],
  ])("rejects unsafe server mapping: %s", async (_label, response) => {
    mockResponse(response);
    await expect(translateBatch(input, "es", "local-model", "auto")).rejects.toThrow();
  });
});

describe("translation UI messages", () => {
  it("supplies all four target UI locales with the same interpolation placeholders", () => {
    const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
    for (const [source, languages] of Object.entries(translationMessages)) {
      expect(languages).toHaveLength(4);
      for (const text of languages) {
        expect(text.trim()).not.toBe("");
        expect(placeholders(text)).toEqual(placeholders(source));
      }
    }
  });
});
