import { parseProject, type Project } from "./domain";
import { zipStore } from "./subtitle-export";
import { exportWorkbook, reportTime } from "./documentExports";
import { normalizeSpeakerColor, readableSpeakerColor } from "./speakerColor";
import { captionReviewLabel, needsSpeechReview } from "./reviewReasons";

export type TranscriptTurn = { ids: string[]; speakerId: string | null; speaker: string; color: string | null; start: number; end: number; text: string; overlap: boolean; speechUncertain?: boolean };
export type TranscriptDocument = { title: string; participants: string[]; people: {id: string | null; name: string; color: string | null}[]; turns: TranscriptTurn[]; captionCount: number };
type Label = (key: string) => string;
export type TranscriptOptions = { timestamps?: boolean; locale?: string; coalesce?: boolean };
export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const xml = (value: string) => value.replace(/[^\u0009\u000a\u000d\u0020-\ud7ff\ue000-\ufffd\u{10000}-\u{10ffff}]/gu, "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

/** Literal transcript: no network, summarization, role inference, or source mutations. */
export function buildTranscriptDocument(project: Project, label: Label, options: TranscriptOptions = {}): TranscriptDocument {
  const valid = parseProject(JSON.stringify(project));
  const speakers = new Map(valid.speakers.map(speaker => [speaker.id, speaker]));
  // Equal start times retain their source order, including simultaneous speech.
  const captions = valid.captions.map((caption, index) => ({ caption, index })).sort((a, b) => a.caption.start - b.caption.start || a.index - b.index);
  const turns: TranscriptTurn[] = [];
  let latestEnd = -1, captionCount = 0;
  for (let index = 0; index < captions.length; index++) {
    const { caption } = captions[index]!;
    const overlap = caption.start < latestEnd || caption.end > (captions[index + 1]?.caption.start ?? Infinity);
    latestEnd = Math.max(latestEnd, caption.end);
    if (!caption.text.trim()) continue;
    captionCount++;
    const text = caption.text;
    const previous = turns.at(-1);
    if (options.coalesce !== false && previous && previous.ids.at(-1) === captions[index - 1]?.caption.id && caption.speakerId !== null && previous.speakerId === caption.speakerId &&
        !previous.overlap && !overlap && caption.start >= previous.end && caption.start - previous.end <= 1.2) {
      previous.ids.push(caption.id); previous.end = caption.end; previous.text += `\n${text}`;
      if (needsSpeechReview(caption)) previous.speechUncertain = true;
    } else {
      const person = speakers.get(caption.speakerId ?? "");
      turns.push({ ids: [caption.id], speakerId: caption.speakerId, speaker: person?.name ?? label("미배정"), color: normalizeSpeakerColor(person?.color),
        start: caption.start, end: caption.end, text, overlap, ...(needsSpeechReview(caption) ? { speechUncertain: true } : {}) });
    }
  }
  const active = new Set(turns.map(turn => turn.speakerId));
  const people: TranscriptDocument["people"] = valid.speakers.filter(speaker => active.has(speaker.id)).map(speaker => ({id: speaker.id, name: speaker.name, color: normalizeSpeakerColor(speaker.color)}));
  if (active.has(null)) people.push({id: null, name: label("미배정"), color: null});
  return { title: valid.name, participants: people.map(person => person.name), people, turns, captionCount };
}

function metadata(document: TranscriptDocument, label: Label): string[] {
  return [document.title, label("발언록"), `${label("참가자")}: ${document.participants.join(", ") || "—"}`,
    label("자막 원문을 시간순으로 정리한 발언록입니다. 자동 요약이나 문장 재작성은 하지 않습니다.")];
}
const prefix = (turn: TranscriptTurn, timestamps = false) => `${timestamps ? `[${reportTime(turn.start)} – ${reportTime(turn.end)}] ` : ""}${turn.speaker}: `;

export function exportTranscriptTxt(project: Project, label: Label, options: TranscriptOptions = {}): string {
  const document = buildTranscriptDocument(project, label, options);
  return [...metadata(document, label), "", ...document.turns.map(turn => `${turn.speechUncertain ? `[${label("음성 확인 필요")}]\n` : ""}${prefix(turn, options.timestamps)}${turn.text}\n`)].join("\n");
}

/** Dedicated original-language transcript workbook, retaining cue IDs and review states. */
export function exportTranscriptXlsx(project: Project, label: Label): Uint8Array {
  const document = buildTranscriptDocument(project, label, { coalesce: false });
  const captions = new Map(project.captions.map(caption => [caption.id, caption]));
  return exportWorkbook([
    { name: label("발언록"), filter: true, widths: [26, 22, 18, 18, 14, 14, 90, 24], rows: [
      [label("자막 ID"), label("인물"), label("시작"), label("끝"), label("시작(초)"), label("끝(초)"), label("대사"), label("검수")],
      ...document.turns.map(turn => [turn.ids[0]!, {text: turn.speaker, color: readableSpeakerColor(turn.color), markerColor: turn.color ?? undefined}, reportTime(turn.start), reportTime(turn.end), turn.start, turn.end, turn.text, captionReviewLabel(captions.get(turn.ids[0]!), label)]),
    ] },
    { name: label("안내"), filter: false, widths: [25, 90], rows: [
      [label("항목"), label("내용")], [label("프로젝트"), document.title],
      ...document.people.map(person => [label("참가자"), {text: person.name, color: readableSpeakerColor(person.color), markerColor: person.color ?? undefined}]),
      [label("대사 수"), document.captionCount],
      [label("안내"), label("자막 원문을 시간순으로 정리한 발언록입니다. 자동 요약이나 문장 재작성은 하지 않습니다.")],
    ] },
  ]);
}

/** Standalone offline report. The shared print view accepts its main.vs-report. */
export function exportTranscriptHtml(project: Project, label: Label, options: TranscriptOptions = {}): string {
  const document = buildTranscriptDocument(project, label, options);
  const locale = ["ko", "en", "ja", "zh", "es"].includes(options.locale ?? "") ? options.locale! : "ko";
  const name = (text: string, color: string | null) => `<strong class="speaker" style="color:${readableSpeakerColor(color)};border-left-color:${color ?? "#667085"}">${xml(text)}</strong>`;
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${xml(document.title)} · ${xml(label("발언록"))}</title><style>.vs-report{max-width:900px;margin:0 auto;padding:32px;font:15px/1.7 system-ui,"Malgun Gothic",sans-serif;color:#263246;background:#fff}.vs-report h1{overflow-wrap:anywhere}.vs-report p{white-space:pre-wrap;overflow-wrap:anywhere;margin:0 0 16px}.vs-report .meta,.vs-report .notice{font-size:12px;color:#637084}.vs-report .stamp{color:#637084;font-size:12px}.vs-report .speaker{border-left:3px solid;padding-left:5px;box-decoration-break:clone;-webkit-box-decoration-break:clone;print-color-adjust:exact;-webkit-print-color-adjust:exact}@page{size:A4;margin:18mm}@media print{.vs-report{padding:0;font-size:11pt}}</style></head><body><main class="vs-report"><h1>${xml(document.title)}</h1><h2>${xml(label("발언록"))}</h2><p class="meta">${xml(label("참가자"))}: ${document.people.map(person => name(person.name, person.color)).join(", ") || "—"}</p><p class="meta">${xml(metadata(document, label)[3])}</p><h2>${xml(label("발언 내용"))}</h2>${document.turns.map(turn => `<p>${options.timestamps ? `<span class="stamp">[${reportTime(turn.start)} – ${reportTime(turn.end)}]</span> ` : ""}${turn.speechUncertain ? `<small class="notice">[${xml(label("음성 확인 필요"))}]</small><br>` : ""}${name(`${turn.speaker}: `, turn.color)}${xml(turn.text)}</p>`).join("")}</main></body></html>`;
}

function wordText(text: string): string {
  // Word needs explicit break/tab elements; literal newlines in w:t collapse.
  return text.split(/(\r\n|\r|\n|\t)/).map(part => part === "\t" ? "<w:tab/>" : /^(\r\n|\r|\n)$/.test(part) ? "<w:br/>" : `<w:t xml:space="preserve">${xml(part)}</w:t>`).join("");
}
const run = (text: string, bold = false, color?: string) => `<w:r>${bold || color ? `<w:rPr>${bold ? "<w:b/>" : ""}${color ? `<w:color w:val="${normalizeSpeakerColor(color)!.slice(1).toUpperCase()}"/>` : ""}</w:rPr>` : ""}${wordText(text)}</w:r>`;
const speakerRun = (text: string, color: string | null) => run("▌ ", false, color ?? "#667085") + run(text, true, readableSpeakerColor(color));
const paragraph = (content: string, style?: string) => `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ""}<w:spacing w:after="160"/></w:pPr>${content}</w:p>`;

/** A real WordprocessingML ZIP, with no macros, links, or external assets. */
export function exportTranscriptDocx(project: Project, label: Label, options: TranscriptOptions = {}): Uint8Array {
  const document = buildTranscriptDocument(project, label, options), meta = metadata(document, label);
  const body = paragraph(run(document.title), "Title") + paragraph(run(label("발언록")), "Heading1") +
    paragraph(run(`${label("참가자")}: `) + (document.people.map((person, index) => run(index ? ", " : "") + speakerRun(person.name, person.color)).join("") || run("—"))) +
    paragraph(run(meta[3])) + paragraph(run(label("발언 내용")), "Heading1") +
    document.turns.map(turn => (turn.speechUncertain ? paragraph(run(`[${label("음성 확인 필요")}]`)) : "") + paragraph((options.timestamps ? run(`[${reportTime(turn.start)} – ${reportTime(turn.end)}] `) : "") + speakerRun(`${turn.speaker}: `, turn.color) + run(turn.text))).join("");
  return zipStore([
    { name: "[Content_Types].xml", text: `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>` },
    { name: "_rels/.rels", text: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="document" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="core" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>` },
    { name: "word/document.xml", text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1020" w:right="1020" w:bottom="1020" w:left="1020" w:header="480" w:footer="480" w:gutter="0"/></w:sectPr></w:body></w:document>` },
    { name: "word/_rels/document.xml.rels", text: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="styles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: "word/styles.xml", text: `<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Malgun Gothic"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/></w:rPr></w:style></w:styles>` },
    { name: "docProps/core.xml", text: `<?xml version="1.0" encoding="UTF-8"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${xml(document.title)}</dc:title><dc:creator>VOICESUBSEP</dc:creator></cp:coreProperties>` },
  ]);
}
