import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { VocabularyEditor } from "./components/VocabularyEditor";
import { CloudAsrSettings } from "./components/CloudAsrSettings";
import { I18nProvider } from "./i18n";
import { defaultAnalysisPreferences } from "./settings";

describe("project vocabulary editor", () => {
  it("offers a labelled plain-term editor and an explicit project save action", () => {
    const terms = ["젠야타", "<D.Va>"], before = terms.slice();
    const html = renderToStaticMarkup(<I18nProvider><VocabularyEditor terms={terms} selection={{ provider: "local" }} onSave={() => {}} /></I18nProvider>);
    expect(html).toContain("프로젝트 용어 사전");
    expect(html).toContain("<textarea");
    expect(html).toMatch(/<label for="[^"]+">/);
    expect(html).toContain("젠야타\n&lt;D.Va&gt;");
    expect(html).toContain("프로젝트에 저장");
    expect(html).toContain("이미 편집한 자막은 그대로 유지합니다.");
    expect(terms).toEqual(before);
  });
  it("discloses unsupported engines and conservative Groq limits beside stored terms", () => {
    const render = (provider: "gemini" | "groq", model: string) => renderToStaticMarkup(<I18nProvider><VocabularyEditor terms={["한".repeat(50), "글".repeat(50)]} selection={{ provider, model }} onSave={() => {}} /></I18nProvider>);
    expect(render("gemini", "gemini-3.5-transcribe")).toContain("이번 외부 요청에는 전송하지 않습니다.");
    expect(render("groq", "whisper-large-v3")).toContain("UTF-8 224바이트");
  });
  it("discloses saved vocabulary in the same per-analysis cloud consent", () => {
    const html = renderToStaticMarkup(<I18nProvider><CloudAsrSettings selection={{ provider: "xai", model: "grok-voice-transcribe-2.0" }} onChange={() => {}} consent={false} onConsent={() => {}} disabled={false} credentialBusy={false} onCredentialState={() => {}} preferences={defaultAnalysisPreferences()} onPreferences={() => {}} /></I18nProvider>);
    expect(html).toContain("음성과 지원되는 저장 용어");
    expect(html).toMatch(/<input type="checkbox"\/>/);
  });
});
