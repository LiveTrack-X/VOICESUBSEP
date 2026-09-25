import { describe, expect, it } from "vitest";
import { createProject, type Project } from "./domain";
import { evidenceFor, type MinutesItem } from "./documents";
import { exportDocumentHtml, exportDocumentXlsx, reportTime, sanitizeWorksheetNames } from "./documentExports";
import { dictionaries, LOCALES, translate } from "./i18n";
import { readFileSync } from "node:fs";

const label = (key: string) => key;
const options = { generatedAt: new Date("2026-09-25T01:02:03.000Z"), locale: "ko" };
function fixture(): Project {
  const p = createProject(2); p.name = "회의 <검토> & 인터뷰"; p.duration = 20;
  p.speakers[0]!.name = "진행자 & <host>"; p.speakers[1]!.name = "참가자";
  p.captions = [
    { id: "question", start: 2.125, end: 4.75, text: "어떤 계획인가요?", speakerId: p.speakers[0]!.id, reviewed: true, reasons: [] },
    { id: "answer", start: 4.5, end: 7.875, text: "=HYPERLINK(\"https://example.invalid\")\n금요일까지 확인합니다.", speakerId: p.speakers[1]!.id, reviewed: false, reasons: ["overlap"] },
    { id: "tail", start: 12, end: 13, text: "추가 논의", speakerId: null, reviewed: false, reasons: ["unassigned"] },
  ];
  const item: MinutesItem = { id: "action", kind: "action", text: "확인해서 전달", owner: "=1+1", due: "금요일", status: "reviewed", evidence: [evidenceFor(p.captions[1]!)] };
  p.documents = { roles: { [p.speakers[0]!.id]: "questioner", [p.speakers[1]!.id]: "respondent" }, tags: {}, items: [
    { ...item, id: "summary", kind: "summary", text: "일정 검토", status: "draft", owner: "", due: "" },
    { ...item, id: "decision", kind: "decision", text: "금요일 결정", evidence: [{ ...evidenceFor(p.captions[1]!), text: "이전 원문" }] },
    item,
  ] };
  return p;
}

function unzip(bytes: Uint8Array): Map<string, string> {
  const files = new Map<string, string>(), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), decoder = new TextDecoder();
  const end = bytes.length - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  let offset = view.getUint32(end + 16, true);
  for (let i = 0; i < view.getUint16(end + 10, true); i++) {
    expect(view.getUint32(offset, true)).toBe(0x02014b50);
    const count = view.getUint16(offset + 28, true), local = view.getUint32(offset + 42, true);
    const name = decoder.decode(bytes.slice(offset + 46, offset + 46 + count));
    expect(view.getUint32(local, true)).toBe(0x04034b50);
    expect(view.getUint16(local + 8, true)).toBe(0); // Existing dependency-free ZIP STORE.
    const start = local + 30 + view.getUint16(local + 26, true), size = view.getUint32(local + 18, true);
    files.set(name, decoder.decode(bytes.slice(start, start + size)));
    offset += 46 + count;
  }
  expect(offset).toBe(end); return files;
}

describe("printable document reports", () => {
  it("escapes all supplied titles, people, document content and evidence without active HTML", () => {
    const p = fixture(); p.name = '<script>alert("title")</script>';
    p.speakers[0]!.name = '<img src=x onerror="attack()">';
    p.captions[0]!.text = '</p><svg onload="attack()">';
    p.documents!.items[0]!.text = '<iframe src="https://example.invalid"></iframe>';
    p.documents!.items[0]!.evidence[0]!.text = '<script>alert("evidence")</script>';
    for (const mode of ["interview", "minutes"] as const) {
      const html = exportDocumentHtml(p, mode, label, options);
      expect(html).not.toMatch(/<(?:script|iframe|img|svg)\b/i);
      expect(html).toContain('&lt;script&gt;alert(&quot;title&quot;)&lt;/script&gt;');
      expect(html).toContain('&lt;img src=x onerror=&quot;attack()&quot;&gt;');
      expect(html).toContain("default-src 'none'");
      expect(html).not.toMatch(/<[^>]+\s(?:src|href)=/i);
      expect(html).toContain("@media print");
    }
  });
  it("preserves source timing and overlapping speech, roles and explicit per-caption tags", () => {
    const p = fixture(); p.documents!.tags.answer = "other"; p.captions.reverse();
    const html = exportDocumentHtml(p, "interview", label, options);
    expect(html).toContain('class="question"'); expect(html).toContain('class="other"');
    expect(html).not.toContain('class="answer"'); expect(html).toContain("질문자");
    expect(html).toContain("00:00:02.125 – 00:00:04.750");
    expect(html).toContain("00:00:04.500 – 00:00:07.875");
    expect(html.indexOf("어떤 계획인가요?")).toBeLessThan(html.indexOf("HYPERLINK"));
    expect(html).toContain("2026-09-25T01:02:03.000Z");
    expect(html).toContain("내보낸 시각은 회의 일시가 아닙니다.");
    expect(html).toContain("검토할 항목: 2");
  });
  it("separates meeting decisions/actions, includes original evidence and labels stale reviewed items", () => {
    const html = exportDocumentHtml(fixture(), "minutes", label, options);
    expect(html).toContain("<h2>요약</h2>"); expect(html).toContain("<h2>결정</h2>"); expect(html).toContain("<h2>할 일</h2>");
    expect(html).toContain("담당자: =1+1 · 기한: 금요일");
    expect(html).toContain("이전 원문"); expect(html).toContain("근거 재확인 필요");
    expect(html).toContain("검토할 항목: 2"); expect(html).toContain("<h2>전체 대사</h2>");
  });
  it("does not invent minutes or recording dates when only a transcript or an empty project exists", () => {
    const p = fixture(); delete p.documents;
    expect(exportDocumentHtml(p, "minutes", label, options)).toContain("회의록 항목이 없습니다.");
    expect(exportDocumentHtml(createProject(), "interview", label, options)).toContain("녹음 또는 미디어를 먼저 분석하세요.");
  });
  it("validates project data instead of exporting invalid source times", () => {
    const p = fixture(); p.captions[0]!.end = -1;
    expect(() => exportDocumentHtml(p, "interview", label, options)).toThrow();
    expect(() => exportDocumentXlsx(p, "minutes", label, options)).toThrow();
  });
  it("rounds source time without producing a 60-second component", () => {
    expect(reportTime(59.9996)).toBe("00:01:00.000");
    expect(reportTime(3600.125)).toBe("01:00:00.125");
  });
  it("lists only participants referenced by transcript or meeting evidence, not prepared/unused people", () => {
    const p = fixture(); p.speakers.push({ id: "unused", name: "Unused prepared person", color: "#2563eb" });
    p.speakers[1]!.name = "Evidence-only person";
    p.captions = [p.captions[0]!];
    for (const mode of ["interview", "minutes"] as const) {
      const html = exportDocumentHtml(p, mode, label, options);
      const report = unzip(exportDocumentXlsx(p, mode, label, options)).get("xl/worksheets/sheet1.xml")!;
      expect(html).not.toContain("Unused prepared person"); expect(report).not.toContain("Unused prepared person");
      expect(html.includes("Evidence-only person")).toBe(mode === "minutes");
      expect(report.includes("Evidence-only person")).toBe(mode === "minutes");
    }
    const empty = createProject(4); empty.speakers.forEach(speaker => { speaker.name = `Unused-${speaker.id}`; });
    expect(exportDocumentHtml(empty, "interview", label, options)).not.toContain("Unused-");
    expect(unzip(exportDocumentXlsx(empty, "minutes", label, options)).get("xl/worksheets/sheet1.xml")).not.toContain("Unused-");
  });
});

describe("Excel OpenXML reports", () => {
  it("writes genuine XLSX package relationships, styles and four meeting sheets", () => {
    const files = unzip(exportDocumentXlsx(fixture(), "minutes", label, options));
    expect([...files.keys()].sort()).toEqual(["[Content_Types].xml", "_rels/.rels", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/workbook.xml", ...[1, 2, 3, 4].map(i => `xl/worksheets/sheet${i}.xml`)].sort());
    expect(files.get("[Content_Types].xml")).toContain("spreadsheetml.sheet.main+xml");
    expect(files.get("_rels/.rels")).toContain('Target="xl/workbook.xml"');
    expect(files.get("xl/workbook.xml")).toContain('sheet name="전체 대사"');
    expect(files.get("xl/workbook.xml")).toContain('sheet name="근거"');
    for (const i of [1, 2, 3, 4]) {
      expect(files.get("xl/_rels/workbook.xml.rels")).toContain(`Target="worksheets/sheet${i}.xml"`);
      expect(files.get(`xl/worksheets/sheet${i}.xml`)).toContain('state="frozen"');
    }
    expect(files.get("xl/styles.xml")).toContain('wrapText="1"');
    expect(files.get("xl/styles.xml")).toContain('cellStyle name="Normal"');
    expect(files.get("xl/worksheets/sheet2.xml")).toContain('<autoFilter ref="A1:I4"/>');
  });
  it("stores user strings as inline text rather than executable formulas and retains numeric seconds", () => {
    const p = fixture(); p.captions[2]!.text = '+cmd _x000A_ <tag> & "line"';
    const files = unzip(exportDocumentXlsx(p, "minutes", label, options));
    const transcript = files.get("xl/worksheets/sheet2.xml")!;
    expect(transcript).toContain('t="inlineStr"><is><t xml:space="preserve">=HYPERLINK');
    expect(transcript).toContain('+cmd _x005F_x000A_ &lt;tag&gt; &amp; &quot;line&quot;');
    expect(transcript).toContain('<c r="D2" s="0"><v>2.125</v></c>');
    expect(files.get("xl/worksheets/sheet3.xml")).toContain('t="inlineStr"><is><t xml:space="preserve">=1+1');
    for (const content of files.values()) expect(content).not.toMatch(/<(?:f|hyperlink|externalLink)\b|TargetMode="External"/);
  });
  it("exports stale evidence text, unassigned identities and true review state without mutating the project", () => {
    const p = fixture(), before = JSON.stringify(p), files = unzip(exportDocumentXlsx(p, "minutes", label, options));
    expect(files.get("xl/worksheets/sheet4.xml")).toContain("이전 원문");
    expect(files.get("xl/worksheets/sheet4.xml")).toContain("근거 재확인 필요");
    expect(files.get("xl/worksheets/sheet2.xml")).toContain("미배정");
    expect(JSON.stringify(p)).toBe(before);
  });
  it("uses only report/transcript sheets for interviews while preserving question and answer classification", () => {
    const files = unzip(exportDocumentXlsx(fixture(), "interview", label, options));
    expect(files.has("xl/worksheets/sheet3.xml")).toBe(false);
    expect(files.get("xl/worksheets/sheet2.xml")).toContain("질문");
    expect(files.get("xl/worksheets/sheet2.xml")).toContain("답변");
    expect(files.get("xl/worksheets/sheet1.xml")).toContain("2026-09-25T01:02:03.000Z");
  });
  it("sanitizes forbidden/reserved/duplicate worksheet names with Excel's 31-character limit", () => {
    const names = sanitizeWorksheetNames(["a/b:*?[c]\\d", "'quoted'", "History", "history", "", "A".repeat(45), "a".repeat(45), "😀".repeat(20)]);
    expect(names.every(name => name.length <= 31 && name.length > 0 && !/[\\/?*\[\]:]/.test(name))).toBe(true);
    expect(new Set(names.map(name => name.toLowerCase())).size).toBe(names.length);
    expect(names).toContain("quoted"); expect(names).not.toContain("History");
    expect(names.at(-1)).not.toMatch(/[\ud800-\udbff]$/u);
  });
  it("covers every new static report label in all five languages", () => {
    const source = readFileSync(new URL("./documentExports.ts", import.meta.url), "utf8");
    for (const match of source.matchAll(/\blabel\("([^"]+)"\)/g)) {
      if (/[가-힣]/.test(match[1])) expect(dictionaries.en[match[1]], match[1]).toBeTruthy();
    }
    for (const locale of LOCALES) {
      const files = unzip(exportDocumentXlsx(fixture(), "minutes", key => translate(locale, key), { ...options, locale }));
      expect(files.get("xl/workbook.xml")).toContain(translate(locale, "보고서"));
    }
  });
});
