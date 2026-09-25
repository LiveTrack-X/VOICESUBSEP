import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dictionaries, LOCALES, parseLocale, translate } from "./i18n";
import { ASR_LANGUAGES, languageName, parseAsrLanguage } from "./languages";

const placeholders = (value: string) => [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

describe("interface translations", () => {
  it("covers all five locales with the same complete keys and placeholders", () => {
    const sourceKeys = Object.keys(dictionaries.ko).sort();
    expect(sourceKeys.length).toBeGreaterThan(200);
    for (const locale of LOCALES) {
      expect(Object.keys(dictionaries[locale]).sort()).toEqual(sourceKeys);
      for (const key of sourceKeys) {
        const value = dictionaries[locale][key];
        expect(value, `${locale}: ${key}`).toBeTruthy();
        expect(placeholders(value), `${locale}: ${key}`).toEqual(placeholders(key));
        if (locale !== "ko") expect(value, `${locale}: ${key}`).not.toMatch(/[가-힣]/);
      }
    }
  });

  it("covers static controls and help in localized editor components", () => {
    const missing:string[]=[];
    for (const name of ["Sidebar", "CaptionEditor", "NotesPanel", "MediaPlayer", "EditorWorkspace", "NoteTimelineLane", "CaptionStyleDialog", "AnalysisDialog", "RecognitionPreview", "WorkspaceModeSwitcher", "CloudAsrSettings", "DiarizationSettings", "AudioMixerDialog", "ProviderCredentialPanel", "TranscriptDocumentPanel", "UpdateDialog", "Dialog", "SettingsDialog", "VstChainPanel", "DocumentsDialog", "LiveCaptureDialog", "JobHistoryDialog", "ProjectRecoveryDialog", "Timeline", "CaptionTimelineLane"]) {
      const source = readFileSync(new URL(`./components/${name}.tsx`, import.meta.url), "utf8");
      for (const match of source.matchAll(/\bt\((["'])(.*?)\1/g)) {
        if (/[가-힣]/.test(match[2])&&!dictionaries.en[match[2]]) missing.push(`${name}: ${match[2]}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("interpolates named values without interpreting user text as another template", () => {
    expect(translate("en", "인물 {name}", { name: "민수 {id} <script>" })).toBe("Speaker 민수 {id} <script>");
    expect(translate("es", "참가자 {count}명", { count: 4 })).toBe("4 participantes");
    expect(translate("en", "{unknown} {toString}")).toBe("{unknown} {toString}");
    expect(translate("ja", "인물 {name}")).toBe("話者{name}");
  });

  it("preserves unknown diagnostics and supplied content", () => {
    expect(translate("en", "CUDA error 123")).toBe("CUDA error 123");
    expect(translate("ja", "Speaker Minji")).toBe("Speaker Minji");
  });

  it("accepts only supported persisted interface locales", () => {
    for (const locale of LOCALES) expect(parseLocale(locale)).toBe(locale);
    for (const value of [null, undefined, "auto", "fr", "__proto__", {}, 1]) expect(parseLocale(value)).toBe("ko");
  });
});

describe("speech language preferences", () => {
  it("provides all 100 bundled Whisper language codes with a common first group", () => {
    expect(ASR_LANGUAGES).toHaveLength(100);
    expect(new Set(ASR_LANGUAGES).size).toBe(100);
    expect(ASR_LANGUAGES.slice(0, 5)).toEqual(["ko", "en", "ja", "zh", "es"]);
    for (const code of ASR_LANGUAGES) {
      expect(parseAsrLanguage(code)).toBe(code);
      expect(languageName(code, "en")).toBeTruthy();
    }
  });

  it("uses automatic recognition independently of the interface locale", () => {
    expect(parseAsrLanguage(null)).toBe("auto");
    expect(parseAsrLanguage("auto")).toBe("auto");
    expect(parseAsrLanguage("invalid")).toBe("auto");
    expect(parseAsrLanguage("fr")).toBe("fr");
    expect(parseLocale("fr")).toBe("ko");
    expect(languageName("jw", "en")).toBe("Javanese");
    expect(languageName("ja", "en")).toBe("Japanese");
  });
});
