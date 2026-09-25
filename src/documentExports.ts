import { parseProject, type Caption, type Project } from "./domain";
import { emptyDocuments, interviewTag, type MinutesItem } from "./documents";
import { zipStore } from "./subtitle-export";

export type DocumentMode = "interview" | "minutes";
type Label = (key: string) => string;
type ExportOptions = { generatedAt?: Date; locale?: string };
type Cell = string | number;
export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const kinds = { summary: "요약", discussion: "논의", decision: "결정", action: "할 일" } as const;
const tags = { question: "질문", answer: "답변", other: "기타" } as const;
const roles = { questioner: "질문자", respondent: "답변자", participant: "참가자" } as const;
const xml = (value: string) => value.replace(/[^\u0009\u000a\u000d\u0020-\ud7ff\ue000-\ufffd\u{10000}-\u{10ffff}]/gu, "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
export function reportTime(seconds: number): string {
  const ms = Math.round(seconds * 1000);
  return `${String(Math.floor(ms / 3600000)).padStart(2, "0")}:${String(Math.floor(ms / 60000) % 60).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`;
}
function snapshot(project: Project, options: ExportOptions, mode: DocumentMode) {
  const valid = parseProject(JSON.stringify(project));
  const generatedAt = (options.generatedAt ?? new Date()).toISOString();
  const captions = [...valid.captions].sort((a, b) => a.start - b.start || a.end - b.end);
  const sources = new Map(captions.map(caption => [caption.id, caption]));
  const speakers = new Map(valid.speakers.map(speaker => [speaker.id, speaker]));
  const docs = valid.documents ?? emptyDocuments();
  const activeIds = new Set(captions.flatMap(caption => caption.speakerId ? [caption.speakerId] : []));
  if (mode === "minutes") for (const item of docs.items) for (const evidence of item.evidence) {
    if (evidence.speakerId) activeIds.add(evidence.speakerId);
  }
  const participants = valid.speakers.filter(speaker => activeIds.has(speaker.id));
  const fresh = (item: MinutesItem) => item.evidence.length > 0 && item.evidence.every(e => {
    const c = sources.get(e.id);
    return c?.text === e.text && c.start === e.start && c.end === e.end && c.speakerId === e.speakerId;
  });
  return { project: valid, docs, generatedAt, captions, speakers, participants, fresh };
}
function captionState(caption: Caption, label: Label): string {
  return label(caption.reviewed ? "확인 완료" : "검수 필요");
}
function itemState(item: MinutesItem, fresh: boolean, label: Label): string {
  return label(!fresh ? "근거 재확인 필요" : item.status === "reviewed" ? "확인 완료" : "초안");
}

// Scope screen styles to the report so the same content can be printed inside
// the desktop window without changing its restrictive frame/popup policy.
const REPORT_CSS = `
.vs-report{box-sizing:border-box;max-width:1040px;margin:0 auto;padding:42px 44px;color:#202c3d;background:#fff;font:14px/1.65 system-ui,-apple-system,"Segoe UI","Malgun Gothic",sans-serif}
.vs-report *{box-sizing:border-box}.vs-report h1{font-size:30px;line-height:1.25;margin:8px 0 20px;overflow-wrap:anywhere}.vs-report h2{font-size:20px;color:#352a69;margin:32px 0 12px;border-bottom:2px solid #e5e0f1;padding-bottom:8px}.vs-report h3{font-size:15px;margin:0 0 8px}
.vs-report .eyebrow{color:#6d54ad;letter-spacing:.09em;font-size:11px;font-weight:750}.vs-report .meta{display:flex;flex-wrap:wrap;gap:10px 26px;color:#586578;font-size:12px}.vs-report .notice{border-left:3px solid #b68327;padding:10px 14px;background:#fff9ed;margin:18px 0;font-size:12px}.vs-report .people{padding:0;display:flex;flex-wrap:wrap;gap:8px;list-style:none}.vs-report .people li{border:1px solid #ddd5ef;padding:5px 11px;border-radius:5px}
.vs-report article{margin:14px 0;padding:15px 17px;border:1px solid #e2e6ee;border-radius:7px;break-inside:avoid}.vs-report article.question{border-left:4px solid #7151b9}.vs-report article.answer{margin-left:22px}.vs-report p{white-space:pre-wrap;overflow-wrap:anywhere;margin:8px 0}.vs-report .stamp{font-size:11px;color:#586578;font-variant-numeric:tabular-nums}.vs-report .state{display:inline-block;font-size:11px;font-weight:500;color:#815e1f;background:#fff7e8;border-radius:3px;padding:2px 7px;margin-left:7px}.vs-report blockquote{margin:10px 0 0;padding:8px 12px;border-left:2px solid #cbc3dc;background:#f7f6fa;white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}
.vs-report table{width:100%;border-collapse:collapse;font-size:12px;table-layout:fixed}.vs-report th,.vs-report td{border-bottom:1px solid #e1e5ec;vertical-align:top;text-align:left;padding:9px 8px;overflow-wrap:anywhere;white-space:pre-wrap}.vs-report th{background:#f1edf8;font-weight:650}.vs-report thead{display:table-header-group}.vs-report tr{break-inside:avoid}.vs-report footer{border-top:1px solid #ddd;margin-top:30px;padding-top:12px;color:#6d7682;font-size:10px}
@page{size:A4;margin:16mm 14mm}@media print{.vs-report{max-width:none;padding:0;font-size:10pt}.vs-report h1{font-size:22pt}.vs-report h2{font-size:15pt;break-after:avoid}.vs-report article{box-shadow:none}.vs-report article.answer{margin-left:8mm}.vs-report .notice{background:none}.vs-report table{font-size:9pt}}
`;

/** Standalone, offline HTML report. No scripts, media URLs, or external assets. */
export function exportDocumentHtml(project: Project, mode: DocumentMode, label: Label, options: ExportOptions = {}): string {
  const s = snapshot(project, options, mode), esc = xml;
  const who = (id: string | null) => s.speakers.get(id ?? "")?.name ?? label("미배정");
  const kind = label(mode === "interview" ? "인터뷰 보고서" : "회의 보고서");
  const pending = mode === "interview" ? s.captions.filter(c => !c.reviewed).length : s.docs.items.filter(item => item.status !== "reviewed" || !s.fresh(item)).length;
  let content = "";
  if (mode === "interview") {
    content = `<h2>${esc(label("질문·답변 기록"))}</h2>` + s.captions.map(c => {
      const tag = interviewTag(c, s.docs);
      return `<article class="${tag}"><h3>${esc(label(tags[tag]))} · ${esc(who(c.speakerId))}<span class="state">${esc(captionState(c, label))}</span></h3><div class="stamp">${reportTime(c.start)} – ${reportTime(c.end)}</div><p>${esc(c.text)}</p></article>`;
    }).join("");
    if (!s.captions.length) content += `<p>${esc(label("분석한 대사가 없습니다. 녹음 또는 미디어를 먼저 분석하세요."))}</p>`;
  } else {
    if (!s.docs.items.length) content = `<p class="notice">${esc(label("회의록 항목이 없습니다. 아래에는 분석한 대사만 포함됩니다."))}</p>`;
    for (const [key, title] of Object.entries(kinds)) {
      const items = s.docs.items.filter(item => item.kind === key);
      if (!items.length) continue;
      content += `<h2>${esc(label(title))}</h2>` + items.map(item => `<article><h3>${esc(label(title))}<span class="state">${esc(itemState(item, s.fresh(item), label))}</span></h3><p>${esc(item.text)}</p>${item.kind === "action" || item.owner || item.due ? `<div class="meta">${esc(label("담당자"))}: ${esc(item.owner || label("미정"))} · ${esc(label("기한"))}: ${esc(item.due || label("미정"))}</div>` : ""}${item.evidence.map(e => `<blockquote><span class="stamp">${esc(label("근거"))} · ${reportTime(e.start)} – ${reportTime(e.end)} · ${esc(who(e.speakerId))}</span><br>${esc(e.text)}</blockquote>`).join("")}</article>`).join("");
    }
    content += `<h2>${esc(label("전체 대사"))}</h2><table><colgroup><col style="width:22%"><col style="width:17%"><col style="width:46%"><col style="width:15%"></colgroup><thead><tr>${["원본 시간", "인물", "대사", "검수"].map(key => `<th>${esc(label(key))}</th>`).join("")}</tr></thead><tbody>${s.captions.map(c => `<tr><td>${reportTime(c.start)}<br>${reportTime(c.end)}</td><td>${esc(who(c.speakerId))}</td><td>${esc(c.text)}</td><td>${esc(captionState(c, label))}</td></tr>`).join("")}</tbody></table>`;
  }
  const locale = ["ko", "en", "ja", "zh", "es"].includes(options.locale ?? "") ? options.locale! : "ko";
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${esc(project.name)} · ${esc(kind)}</title><style>${REPORT_CSS}</style></head><body><main class="vs-report"><div class="eyebrow">VOICESUBSEP · ${esc(kind)}</div><h1>${esc(project.name)}</h1><div class="meta"><span>${esc(label("내보낸 시각"))}: ${esc(s.generatedAt)}</span><span>${esc(label("원본 길이"))}: ${reportTime(s.project.duration)}</span><span>${esc(label("대사 수"))}: ${s.captions.length}</span><span>${esc(label("검토할 항목"))}: ${pending}</span></div><p class="notice">${esc(label("초안과 미확인 근거를 포함할 수 있습니다. 공유하기 전에 원문과 대조하세요."))} ${esc(label("시간은 원본 미디어 기준입니다. 내보낸 시각은 회의 일시가 아닙니다."))}</p><h2>${esc(label("참가자"))}</h2><ul class="people">${s.participants.map(person => `<li>${esc(person.name)}${mode === "interview" ? ` · ${esc(label(roles[s.docs.roles[person.id] ?? "participant"]))}` : ""}</li>`).join("")}</ul>${content}<footer>VOICESUBSEP · ${esc(label("원본 시간과 근거 자막을 유지합니다. 생성 문서는 확인 전까지 초안입니다."))}</footer></main></body></html>`;
}

/** Print inside the current desktop window: its CSP deliberately forbids frames/popups. */
export function openDocumentPrintView(html: string, label: Label): void {
  const existing = document.getElementById("voicesubsep-report-preview");
  if (existing) { existing.querySelector<HTMLButtonElement>("button")?.focus(); return; }
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const report = parsed.querySelector("main.vs-report");
  if (!report) throw new Error(label("보고서를 만들지 못했습니다."));
  const previousFocus = document.activeElement;
  const previousOverflow = document.body.style.overflow;
  const host = document.createElement("section"); host.id = "voicesubsep-report-preview";
  host.setAttribute("role", "dialog"); host.setAttribute("aria-modal", "true"); host.setAttribute("aria-label", label("보고서 인쇄 미리보기"));
  const style = document.createElement("style");
  style.textContent = REPORT_CSS + `
#voicesubsep-report-preview{position:fixed;inset:0;z-index:10000;overflow:auto;background:#eaeaf0}#voicesubsep-report-preview .report-toolbar{position:sticky;top:0;display:flex;gap:12px;align-items:center;justify-content:center;flex-wrap:wrap;background:#fff;padding:12px;border-bottom:1px solid #ddd;color:#202c3d;font:14px system-ui}#voicesubsep-report-preview .report-toolbar button{padding:9px 15px;cursor:pointer}#voicesubsep-report-preview .report-toolbar p{margin:0}
@media print{body{overflow:visible!important}body>:not(#voicesubsep-report-preview){display:none!important}#voicesubsep-report-preview{position:static!important;overflow:visible!important;background:#fff!important}#voicesubsep-report-preview .report-toolbar{display:none!important}}
`;
  const toolbar = document.createElement("div"); toolbar.className = "report-toolbar";
  const description = document.createElement("p"); description.textContent = label("인쇄 창에서 PDF로 저장을 선택하세요. PDF 파일은 자동으로 저장되지 않습니다.");
  const print = document.createElement("button"); print.textContent = label("PDF 저장(인쇄)"); print.type = "button"; print.onclick = () => window.print();
  const close = document.createElement("button"); close.textContent = label("닫기"); close.type = "button";
  const siblings = [...document.body.children].filter((node): node is HTMLElement => node instanceof HTMLElement).map(node => ({ node, inert: node.inert }));
  const cleanup = () => {
    host.remove(); document.body.style.overflow = previousOverflow;
    for (const { node, inert } of siblings) node.inert = inert;
    document.removeEventListener("keydown", onKey, true);
    if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); cleanup(); }
    else if (event.key === "Tab") { event.preventDefault(); (document.activeElement === print ? close : print).focus(); }
  };
  close.onclick = cleanup;
  for (const { node } of siblings) node.inert = true;
  toolbar.append(description, print, close); host.append(style, toolbar, document.importNode(report, true));
  document.body.append(host); document.body.style.overflow = "hidden"; document.addEventListener("keydown", onKey, true); print.focus();
}

export function sanitizeWorksheetNames(names: readonly string[]): string[] {
  const used = new Set<string>();
  return names.map(name => {
    const cleaned = name.replace(/[\u0000-\u001f\u007f\\/?*\[\]:]/g, " ").trim().replace(/^'+|'+$/g, "") || "Sheet";
    // Slice by UTF-16 units, avoiding an unpaired high surrogate at the end.
    const truncate = (value: string, length: number) => value.slice(0, length).replace(/[\ud800-\udbff]$/u, "");
    const base = truncate(cleaned, 31); let candidate = base, suffix = 1;
    while (used.has(candidate.toLowerCase()) || candidate.toLowerCase() === "history") {
      const end = ` (${++suffix})`; candidate = truncate(base, 31 - end.length) + end;
    }
    used.add(candidate.toLowerCase()); return candidate;
  });
}

const columnName = (index: number): string => index < 26 ? String.fromCharCode(65 + index) : columnName(Math.floor(index / 26) - 1) + columnName(index % 26);
function worksheet(rows: Cell[][], widths: number[], filter: boolean): string {
  const last = `${columnName(Math.max(0, ...rows.map(row => row.length)) - 1)}${rows.length}`;
  const content = rows.map((row, index) => `<row r="${index + 1}">${row.map((value, column) => {
    const attributes = `r="${columnName(column)}${index + 1}" s="${index === 0 ? 1 : 0}"`;
    if (typeof value === "number") return `<c ${attributes}><v>${value}</v></c>`;
    // inlineStr prevents formula evaluation, including leading = + - @; protect
    // literal Excel escape sequences such as _x000A_ from being decoded as controls.
    const text = value.replace(/_x[0-9a-f]{4}_/gi, match => `_x005F_${match.slice(1)}`);
    if (text.length > 32767) throw new Error("Excel cell text exceeds 32,767 characters.");
    return `<c ${attributes} t="inlineStr"><is><t xml:space="preserve">${xml(text)}</t></is></c>`;
  }).join("")}</row>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${last}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols>${widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join("")}</cols><sheetData>${content}</sheetData>${filter ? `<autoFilter ref="A1:${last}"/>` : ""}<pageMargins left="0.4" right="0.4" top="0.6" bottom="0.6" header="0.2" footer="0.2"/></worksheet>`;
}

/** Actual OpenXML workbook, with text cells rather than formulas or external links. */
export function exportDocumentXlsx(project: Project, mode: DocumentMode, label: Label, options: ExportOptions = {}): Uint8Array {
  const s = snapshot(project, options, mode), who = (id: string | null) => s.speakers.get(id ?? "")?.name ?? label("미배정");
  const report: Cell[][] = [[label("항목"), label("내용"), label("상태")],
    [label("프로젝트"), s.project.name, ""], [label("문서"), label(mode === "interview" ? "인터뷰 보고서" : "회의 보고서"), ""],
    [label("내보낸 시각"), s.generatedAt, ""], [label("원본 길이"), reportTime(s.project.duration), ""],
    [label("대사 수"), s.captions.length, ""],
    [label("안내"), label("초안과 미확인 근거를 포함할 수 있습니다. 공유하기 전에 원문과 대조하세요."), ""],
    [label("안내"), label("시간은 원본 미디어 기준입니다. 내보낸 시각은 회의 일시가 아닙니다."), ""],
    ...s.participants.map(person => [label("참가자"), person.name, label(roles[s.docs.roles[person.id] ?? "participant"])])];
  const transcript: Cell[][] = [[label("자막 ID"), label("시작"), label("끝"), label("시작(초)"), label("끝(초)"), label("인물"), label("문답 분류"), label("대사"), label("검수")],
    ...s.captions.map(c => [c.id, reportTime(c.start), reportTime(c.end), c.start, c.end, who(c.speakerId), label(tags[interviewTag(c, s.docs)]), c.text, captionState(c, label)])];
  const sheets = [{ name: label("보고서"), rows: report, widths: [22, 85, 27], filter: false },
    { name: label("전체 대사"), rows: transcript, widths: [22, 19, 19, 14, 14, 22, 18, 90, 24], filter: true }];
  if (mode === "minutes") {
    if (!s.docs.items.length) report.push([label("안내"), label("회의록 항목이 없습니다. 아래에는 분석한 대사만 포함됩니다."), label("초안")]);
    const actions: Cell[][] = [[label("항목 ID"), label("할 일"), label("담당자"), label("기한"), label("상태"), label("근거 자막 ID")]];
    const evidence: Cell[][] = [[label("항목 ID"), label("항목 분류"), label("자막 ID"), label("시작"), label("끝"), label("인물"), label("근거 대사"), label("상태")]];
    for (const item of s.docs.items) {
      const state = itemState(item, s.fresh(item), label);
      report.push([label(kinds[item.kind]), item.text, state]);
      if (item.kind === "action") actions.push([item.id, item.text, item.owner || label("미정"), item.due || label("미정"), state, item.evidence.map(e => e.id).join(", ")]);
      for (const e of item.evidence) evidence.push([item.id, label(kinds[item.kind]), e.id, reportTime(e.start), reportTime(e.end), who(e.speakerId), e.text, state]);
    }
    sheets.push({ name: label("할 일"), rows: actions, widths: [22, 85, 24, 24, 28, 45], filter: true },
      { name: label("근거"), rows: evidence, widths: [22, 20, 22, 19, 19, 22, 90, 28], filter: true });
  }
  const names = sanitizeWorksheetNames(sheets.map(sheet => sheet.name));
  const files = [
    { name: "[Content_Types].xml", text: `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>` },
    { name: "_rels/.rels", text: '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: "xl/workbook.xml", text: `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${names.map((name, index) => `<sheet name="${xml(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("")}</sheets></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", text: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("")}<Relationship Id="styles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: "xl/styles.xml", text: '<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF6544A0"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>' },
    ...sheets.map((sheet, index) => ({ name: `xl/worksheets/sheet${index + 1}.xml`, text: worksheet(sheet.rows, sheet.widths, sheet.filter) })),
  ];
  return zipStore(files);
}

export function downloadDocumentXlsx(bytes: Uint8Array, name: string): void {
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: XLSX_MIME }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = name;
  document.body.append(anchor); anchor.click(); anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
