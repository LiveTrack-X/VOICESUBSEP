import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createProject, type Caption } from "./domain";
import { buildTranscriptDocument, DOCX_MIME, exportTranscriptDocx, exportTranscriptHtml, exportTranscriptTxt, exportTranscriptXlsx } from "./transcriptDocument";
import { TranscriptDocumentPanel } from "./components/TranscriptDocumentPanel";
import { I18nProvider, translate, LOCALES } from "./i18n";

const t = (key: string) => key;
function fixture() {
  const project = createProject(2);
  project.name = '회의 <초안> & "검토"'; project.duration = 90;
  project.speakers[0]!.name = "화자 A"; project.speakers[1]!.name = "화자 B";
  const caption = (id: string, start: number, end: number, speaker: number | null, text: string): Caption => ({
    id, start, end, text, speakerId: speaker === null ? null : project.speakers[speaker]!.id, reviewed: false, reasons: [],
  });
  project.captions = [caption("a", 0, 2, 0, "  안녕하세요. "), caption("b", 2.5, 4, 0, "반갑습니다!"),
    caption("c", 5, 7, 1, "네, 잘 부탁드려요."), caption("d", 20, 21, 1, "다음 주에 만나요.")];
  return { project, caption };
}
function unzip(bytes: Uint8Array): Map<string, string> {
  const files = new Map<string, string>(), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), decoder = new TextDecoder();
  const end = bytes.length - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  let offset = view.getUint32(end + 16, true);
  for (let index = 0; index < view.getUint16(end + 10, true); index++) {
    expect(view.getUint32(offset, true)).toBe(0x02014b50);
    const size = view.getUint16(offset + 28, true), local = view.getUint32(offset + 42, true);
    expect(view.getUint32(local, true)).toBe(0x04034b50);
    expect(view.getUint16(local + 8, true)).toBe(0);
    const start = local + 30 + view.getUint16(local + 26, true);
    files.set(decoder.decode(bytes.slice(offset + 46, offset + 46 + size)), decoder.decode(bytes.slice(start, start + view.getUint32(local + 18, true))));
    offset += 46 + size;
  }
  expect(offset).toBe(end); return files;
}

describe("literal transcript documents", () => {
  it("coalesces only adjacent non-overlapping turns, preserving source whitespace, punctuation and project data", () => {
    const { project } = fixture(), original = structuredClone(project);
    const document = buildTranscriptDocument(project, t);
    expect(document.turns.map(turn => turn.ids)).toEqual([["a", "b"], ["c"], ["d"]]);
    expect(document.turns[0]).toMatchObject({ start: 0, end: 4, speaker: "화자 A", text: "  안녕하세요. \n반갑습니다!" });
    expect(document.participants).toEqual(["화자 A", "화자 B"]);
    expect(project).toEqual(original);
    expect(buildTranscriptDocument(project, t, { coalesce: false }).turns).toHaveLength(4);
  });
  it("keeps overlapping and equal-start turns in stable original order without merging through another live speaker", () => {
    const { project, caption } = fixture();
    project.captions = [caption("later", 3, 4, 1, "세 번째"), caption("long", 0, 10, 0, "긴 발언"), caption("same", 0, 1, 1, "동시 발언"), caption("middle", 1.5, 2, 1, "두 번째")];
    const turns = buildTranscriptDocument(project, t).turns;
    expect(turns.map(turn => turn.ids)).toEqual([["long"], ["same"], ["middle"], ["later"]]);
    expect(turns.every(turn => turn.overlap)).toBe(true);
  });
  it("omits blank captions but does not bridge their speaker boundary or merge unrelated unassigned speech", () => {
    const { project, caption } = fixture();
    project.captions = [caption("a", 0, 1, 0, "앞"), caption("blank", 1, 1.2, 1, " \n"), caption("b", 1.3, 2, 0, "뒤"), caption("u1", 3, 3.5, null, "누구"), caption("u2", 3.6, 4, null, "누구지")];
    const document = buildTranscriptDocument(project, t);
    expect(document.turns.map(turn => turn.ids)).toEqual([["a"], ["b"], ["u1"], ["u2"]]);
    expect(document.participants).toEqual(["화자 A", "미배정"]);
    expect(document.captionCount).toBe(4);
  });
  it("uses only original text while preserving existing legacy translations in project data", () => {
    const { project } = fixture();
    project.captions[0]!.translation = { sourceText: project.captions[0]!.text, texts: { en: "Hello!" } };
    project.captions[1]!.translation = { sourceText: "outdated", texts: { en: "Do not use this" } };
    expect(buildTranscriptDocument(project, t).turns[0]!.text).toContain("안녕하세요.");
    const before = JSON.stringify(project), txt = exportTranscriptTxt(project, t);
    expect(txt).toContain("안녕하세요."); expect(txt).not.toContain("Hello!"); expect(txt).not.toContain("Do not use this");
    expect(JSON.stringify(project)).toBe(before);
  });
  it("exports readable speaker-colon paragraphs, optional times, and no invented meeting date", () => {
    const { project } = fixture();
    const txt = exportTranscriptTxt(project, t);
    expect(txt).toContain("화자 A:   안녕하세요. \n반갑습니다!");
    expect(txt).not.toMatch(/00:00:|회의 일시|\d{4}-\d{2}-\d{2}/);
    expect(exportTranscriptTxt(project, t, { timestamps: true })).toContain("[00:00:00.000 – 00:00:04.000] 화자 A:");
  });
  it("escapes standalone HTML without treating any caption or speaker as markup", () => {
    const { project } = fixture();
    project.speakers[0]!.name = '<img src=x onerror="alert(1)">';
    project.captions[0]!.text = '<script>alert("x")</script> & literal';
    const html = exportTranscriptHtml(project, t);
    expect(html).toContain('class="vs-report"');
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; literal");
    expect(html).not.toContain("<script>"); expect(html).not.toContain("<img");
    expect(html).not.toContain("00:00:");
    expect(html).toContain("default-src 'none'");
  });
  it("writes a DOCX ZIP with valid internal OpenXML relationships, literal XML text and line/tab elements", () => {
    const { project } = fixture();
    project.captions[0]!.text = '한글 <>& "따옴표" 😀\r\n둘째\t항목';
    const files = unzip(exportTranscriptDocx(project, t));
    expect([...files.keys()]).toEqual(["[Content_Types].xml", "_rels/.rels", "word/document.xml", "word/_rels/document.xml.rels", "word/styles.xml", "docProps/core.xml"]);
    expect(DOCX_MIME).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(files.get("[Content_Types].xml")).toContain('PartName="/word/document.xml"');
    expect(files.get("_rels/.rels")).toContain('Target="word/document.xml"');
    expect(files.get("word/_rels/document.xml.rels")).toContain('Target="styles.xml"');
    const word = files.get("word/document.xml")!;
    expect(word).toContain("한글 &lt;&gt;&amp; &quot;따옴표&quot; 😀");
    expect(word).toContain("<w:br/>"); expect(word).toContain("<w:tab/>");
    expect(word).toContain('<w:t xml:space="preserve">화자 A: </w:t>');
    expect(word).not.toContain("00:00:");
    expect([...files.values()].join("\n")).not.toMatch(/TargetMode="External"|w:hyperlink|w:altChunk|vbaProject|dcterms:created/);
    expect(files.get("docProps/core.xml")).toContain("회의 &lt;초안&gt; &amp; &quot;검토&quot;");
  });
  it.each(LOCALES)("supports document headings in %s without changing the spoken words", locale => {
    const { project } = fixture();
    const label = (key: string) => translate(locale, key);
    expect(exportTranscriptTxt(project, label)).toContain(translate(locale, "발언록"));
    expect(exportTranscriptTxt(project, label)).toContain("안녕하세요.");
    expect(exportTranscriptHtml(project, label, { locale })).toContain(`lang="${locale}"`);
  });
  it("renders a standalone original-text panel with timestamps off and Word/TXT/print export controls", () => {
    const { project } = fixture();
    const html = renderToStaticMarkup(<I18nProvider><TranscriptDocumentPanel project={project}/></I18nProvider>);
    expect(html).toContain("Word 문서 (.docx)"); expect(html).toContain("텍스트 (.txt)");
    expect(html).toContain("PDF 저장(인쇄)"); expect(html).toContain("안녕하세요.");
    expect(html).not.toContain('checked=""'); expect(html).not.toContain("00:00:");
    expect(html).toContain("Excel 통합문서 저장");
    expect(html).not.toContain("<select"); expect(html).not.toContain("번역");
  });
  it("exports a dedicated transcript XLSX with all original cues, numeric timestamps and safe text cells", () => {
    const { project } = fixture(); project.captions[0]!.text = '=SUM(1,2) <literal> _x000A_';
    const before = JSON.stringify(project), files = unzip(exportTranscriptXlsx(project, t));
    expect(files.get("xl/workbook.xml")).toContain('sheet name="발언록"');
    const sheet = files.get("xl/worksheets/sheet1.xml")!;
    expect(sheet).toContain('<autoFilter ref="A1:H5"/>');
    expect(sheet).toContain('t="inlineStr"><is><t xml:space="preserve">=SUM(1,2) &lt;literal&gt; _x005F_x000A_');
    expect(sheet).toContain('<c r="E3" s="0"><v>2.5</v></c>');
    expect(sheet).toContain("검수 필요");
    expect([...files.values()].join("")).not.toMatch(/<f>|TargetMode="External"/);
    expect(JSON.stringify(project)).toBe(before);
  });
});
