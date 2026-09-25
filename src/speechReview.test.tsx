import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createProject, exportSrt, parseProject, type Caption } from "./domain";
import type { AnalysisResult } from "./api";
import { bulkEditCaptions, nextCaptionToReview } from "./editorOperations";
import { PROJECT_BACKUP_KEY, PROJECT_STORAGE_KEY, readRecoveryProject, saveRecoverableProject } from "./projectRecovery";
import { captionReviewLabel, needsSpeechReview, SPEECH_REVIEW_HINT } from "./reviewReasons";
import { CaptionEditor } from "./components/CaptionEditor";
import { TranscriptDocumentPanel } from "./components/TranscriptDocumentPanel";
import { I18nProvider, LOCALES, translate } from "./i18n";
import { exportDocument } from "./documents";
import { exportDocumentDocx, exportDocumentHtml, exportDocumentTxt, exportDocumentXlsx } from "./documentExports";
import { buildTranscriptDocument, exportTranscriptDocx, exportTranscriptHtml, exportTranscriptTxt, exportTranscriptXlsx } from "./transcriptDocument";

function fixture() {
  const project = createProject(1);
  project.duration = 10;
  project.captions = [{ id: "cue", start: 1, end: 2, text: "작은 말과 漢字 <literal>", speakerId: project.speakers[0]!.id,
    reasons: ["speech_uncertain"], reviewed: false, words: [{ start: 1, end: 2, text: "작은 말과 漢字 <literal>", probability: .3 }] }];
  return project;
}
const identity = (key: string) => key;
function zipText(bytes: Uint8Array, path: string): string {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), decoder = new TextDecoder();
  let offset = 0;
  while (view.getUint32(offset, true) === 0x04034b50) {
    expect(view.getUint16(offset + 8, true)).toBe(0);
    const size = view.getUint32(offset + 18, true), length = view.getUint16(offset + 26, true), extra = view.getUint16(offset + 28, true);
    const name = decoder.decode(bytes.slice(offset + 30, offset + 30 + length));
    const start = offset + 30 + length + extra;
    if (name === path) return decoder.decode(bytes.slice(start, start + size));
    offset = start + size;
  }
  throw new Error(`Missing ZIP member ${path}`);
}

describe("uncertain speech remains editable and recoverable", () => {
  it("accepts the shared API/project reason without accepting unknown reasons", () => {
    const project = fixture();
    const result: AnalysisResult = { captions: project.captions, speakers: project.speakers, duration: project.duration, warnings: [] };
    const restored = parseProject(JSON.stringify({ ...project, ...result, warnings: undefined }));
    expect(restored.captions).toEqual(project.captions);
    const all: Caption["reasons"] = ["overlap", "unassigned", "speaker_count", "timing", "speaker_boundary", "edited", "speech_uncertain"];
    expect(parseProject(JSON.stringify({ ...project, captions: [{ ...project.captions[0], reasons: all }] })).captions[0]?.reasons).toEqual(all);
    expect(() => parseProject(JSON.stringify({ ...project, captions: [{ ...project.captions[0], reasons: ["unknown"] }] }))).toThrow();
  });

  it("preserves the reason in primary autosave and its previous recoverable snapshot", () => {
    const values = new Map<string, string>();
    const store = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    const project = fixture();
    expect(saveRecoverableProject(project, store)).toBe("saved");
    expect(saveRecoverableProject({ ...project, name: "Second", updatedAt: new Date(Date.parse(project.updatedAt) + 1000).toISOString() }, store)).toBe("saved");
    expect(readRecoveryProject(PROJECT_STORAGE_KEY, store).captions).toEqual(project.captions);
    expect(readRecoveryProject(PROJECT_BACKUP_KEY, store).captions).toEqual(project.captions);
  });

  it("uses the existing needs-review navigation and clears only the pending warning after explicit review", () => {
    const project = fixture(), caption = project.captions[0]!;
    expect(nextCaptionToReview(project.captions, null, "review")).toBe(caption);
    expect(needsSpeechReview(caption)).toBe(true);
    const approved = bulkEditCaptions(project, new Set([caption.id]), { kind: "review", reviewed: true });
    expect(approved.captions[0]?.reasons).toEqual(["speech_uncertain"]);
    expect(needsSpeechReview(approved.captions[0])).toBe(false);
    expect(nextCaptionToReview(approved.captions, null, "review")).toBeUndefined();
    expect(captionReviewLabel(approved.captions[0], identity)).toBe("확인 완료");
  });

  it("renders the review badge and source-check explanation without mutating captions", () => {
    const project = fixture(), before = JSON.stringify(project);
    const html = renderToStaticMarkup(<I18nProvider><CaptionEditor project={project} update={()=>{}} preview={()=>{}} reveal={null}
      selected={null} setSelected={()=>{}} onImport={()=>{}} onError={()=>{}} time={0}/></I18nProvider>);
    expect(html).toContain("음성 확인 필요");
    expect(html).toContain(SPEECH_REVIEW_HINT);
    expect(html).not.toContain(">speech_uncertain<");
    expect(renderToStaticMarkup(<I18nProvider><TranscriptDocumentPanel project={project}/></I18nProvider>)).toContain("[음성 확인 필요]");
    expect(JSON.stringify(project)).toBe(before);
  });
});

describe("speech-review metadata in documents", () => {
  it.each(LOCALES)("localizes review metadata in every report format (%s)", locale => {
    const project = fixture(), label = (key: string) => translate(locale, key), marker = label("음성 확인 필요");
    expect(marker).not.toBe("speech_uncertain");
    expect(label(SPEECH_REVIEW_HINT)).toBeTruthy();
    const reports = [exportDocument(project, "interview", label), exportDocumentTxt(project, "interview", label),
      exportDocumentHtml(project, "interview", label), zipText(exportDocumentDocx(project, "interview", label), "word/document.xml"),
      zipText(exportDocumentXlsx(project, "interview", label), "xl/worksheets/sheet2.xml")];
    for (const report of reports) expect(report).toContain(marker);
  });

  it("keeps verbatim text and word times while flagging a merged turn if either caption still needs speech review", () => {
    const project = fixture(), caption = project.captions[0]!;
    project.captions.unshift({ ...caption, id: "before", start: 0, end: .8, text: "첫 말", reasons: [], words: undefined });
    const before = JSON.stringify(project), turn = buildTranscriptDocument(project, identity).turns[0]!;
    expect(turn.ids).toEqual(["before", "cue"]);
    expect(turn.speechUncertain).toBe(true);
    expect(turn.text).toBe(`첫 말\n${caption.text}`);
    const exports = [exportTranscriptTxt(project, identity), exportTranscriptHtml(project, identity),
      zipText(exportTranscriptDocx(project, identity), "word/document.xml"), zipText(exportTranscriptXlsx(project, identity), "xl/worksheets/sheet1.xml")];
    for (const output of exports) expect(output).toContain("음성 확인 필요");
    expect(exportTranscriptTxt(project, identity)).toContain(`[음성 확인 필요]\n${project.speakers[0]!.name}: 첫 말\n${caption.text}`);
    expect(exportTranscriptHtml(project, identity)).toContain("漢字 &lt;literal&gt;");
    expect(JSON.stringify(project)).toBe(before);
    for (const c of project.captions) c.reviewed = true;
    expect(buildTranscriptDocument(project, identity).turns[0]?.speechUncertain).toBeUndefined();
    expect(exportTranscriptTxt(project, identity)).not.toContain("음성 확인 필요");
  });

  it("never injects the review warning into SRT subtitle dialogue", () => {
    const project = fixture(), before = JSON.stringify(project);
    const output = exportSrt(project);
    expect(output).toContain(project.captions[0]!.text);
    expect(output).not.toContain("음성 확인 필요");
    expect(JSON.stringify(project)).toBe(before);
  });
});
