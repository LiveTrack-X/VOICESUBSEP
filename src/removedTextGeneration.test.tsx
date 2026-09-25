import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { createProject, exportSrt, parseProject } from "./domain";
import { I18nProvider, LOCALES } from "./i18n";
import { emptyDocuments } from "./documents";
afterEach(() => vi.unstubAllGlobals());

describe("removed automatic text generation", () => {
  it("has no subtitle translation entry or subtitle language preview while retaining interface languages", () => {
    vi.stubGlobal("window", {matchMedia: () => ({matches:false})});
    const html = renderToStaticMarkup(<I18nProvider><App /></I18nProvider>);
    expect(html).not.toContain("자막 번역");
    expect(html).not.toContain("미리보기·SRT 언어");
    expect(html).not.toContain("subtitle-language-bar");
    expect(LOCALES).toEqual(["ko", "en", "ja", "zh", "es"]);
  });

  it("round-trips legacy translations and saved document drafts without generating or exporting translations", () => {
    const project = createProject();
    project.captions = [{id:"c1",start:0,end:1,text:"원문 발언",speakerId:project.speakers[0].id,reasons:[],reviewed:false,
      translation:{sourceText:"원문 발언",texts:{en:"Legacy translated text",ja:"以前の訳"}}}];
    project.documents = {...emptyDocuments(),items:[{id:"note1",kind:"summary",text:"기존 문서 초안",owner:"",due:"",status:"draft",evidence:[]}]};
    const restored = parseProject(JSON.stringify(project));
    expect(restored).toEqual(project);
    expect(parseProject(JSON.stringify(restored))).toEqual(project);
    expect(exportSrt(restored)).toContain("원문 발언");
    expect(exportSrt(restored)).not.toContain("Legacy translated text");
  });
});
