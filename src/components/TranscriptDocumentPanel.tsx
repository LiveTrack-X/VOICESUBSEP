import { useEffect, useMemo, useState } from "react";
import { Download, Play } from "lucide-react";
import { download } from "../api";
import { safeFilename, type Project } from "../domain";
import { localeNames, LOCALES, useI18n } from "../i18n";
import { openDocumentPrintView, reportTime } from "../documentExports";
import { buildTranscriptDocument, DOCX_MIME, exportTranscriptDocx, exportTranscriptHtml, exportTranscriptTxt, type TranscriptLanguage } from "../transcriptDocument";
import "./transcript-document.css";

export type TranscriptDocumentPanelProps = {
  project: Project;
  language?: TranscriptLanguage;
  onSeek?: (seconds: number) => void;
  onPrint?: (html: string) => void;
};
const PAGE_SIZE = 100;

export function TranscriptDocumentPanel({ project, language = "original", onSeek, onPrint }: TranscriptDocumentPanelProps) {
  const { t, locale } = useI18n();
  const [selectedLanguage, setSelectedLanguage] = useState(language);
  const [timestamps, setTimestamps] = useState(false);
  const [page, setPage] = useState(0);
  const [error, setError] = useState("");
  useEffect(() => { setSelectedLanguage(language); }, [language]);
  const transcript = useMemo(() => buildTranscriptDocument(project, t, { language: selectedLanguage }), [project, selectedLanguage, t]);
  const pages = Math.max(1, Math.ceil(transcript.turns.length / PAGE_SIZE)), currentPage = Math.min(page, pages - 1);
  const turns = transcript.turns.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  function save(format: "docx" | "txt" | "html" | "pdf") {
    try {
      const options = { language: selectedLanguage, timestamps, locale }, base = `${safeFilename(project.name)}-transcript`;
      if (format === "docx") {
        const url = URL.createObjectURL(new Blob([new Uint8Array(exportTranscriptDocx(project, t, options))], { type: DOCX_MIME }));
        const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${base}.docx`;
        document.body.append(anchor); anchor.click(); anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      } else if (format === "txt") download(`${base}.txt`, exportTranscriptTxt(project, t, options));
      else {
        const html = exportTranscriptHtml(project, t, options);
        if (format === "html") download(`${base}.html`, html, "text/html;charset=utf-8");
        else if (onPrint) onPrint(html); else openDocumentPrintView(html, t);
      }
      setError("");
    } catch (cause) { setError(cause instanceof Error ? t(cause.message) : t("보고서를 만들지 못했습니다.")); }
  }

  return <section className="transcript-document-panel" aria-label={t("발언록")}>
    <p className="muted">{t("자막 원문을 시간순으로 정리한 발언록입니다. 자동 요약이나 문장 재작성은 하지 않습니다.")}</p>
    <div className="transcript-controls">
      <label>{t("문서 언어")}<select value={selectedLanguage} onChange={event => { setSelectedLanguage(event.target.value as TranscriptLanguage); setPage(0); }}>
        <option value="original">{t("원문")}</option>{LOCALES.map(item => <option key={item} value={item}>{localeNames[item]}</option>)}
      </select></label>
      <label><input type="checkbox" checked={timestamps} onChange={event => setTimestamps(event.target.checked)}/>{t("시간 표시")}</label>
    </div>
    <p className="muted">{t("인접한 같은 인물의 자막만 줄바꿈으로 묶습니다. 겹친 발화와 긴 침묵은 분리합니다.")}</p>
    {selectedLanguage !== "original" && <p className="muted">{t("선택한 언어의 저장된 번역을 사용하며 이 화면에서 번역을 생성하지 않습니다.")}</p>}
    {transcript.fallbackCount > 0 && <p role="status" className="transcript-notice">{t("번역이 없거나 원문이 수정된 대사는 원문으로 포함됩니다.")}</p>}
    <div className="transcript-export-actions">
      <button disabled={!transcript.turns.length} onClick={() => save("docx")}><Download size={14}/>{t("Word 문서 (.docx)")}</button>
      <button disabled={!transcript.turns.length} onClick={() => save("txt")}>{t("텍스트 (.txt)")}</button>
      <button disabled={!transcript.turns.length} onClick={() => save("html")}>{t("HTML 보고서")}</button>
      <button disabled={!transcript.turns.length} onClick={() => save("pdf")}>{t("PDF 저장(인쇄)")}</button>
    </div>
    {error && <p className="inline-error" role="alert">{error}</p>}
    <div className="transcript-page" aria-label={t("발언 내용")}>
      <h3>{transcript.title}</h3>
      <p className="transcript-people">{t("참가자")}: {transcript.participants.join(", ") || "—"}</p>
      {!turns.length && <p>{t("분석한 대사가 없습니다. 녹음 또는 미디어를 먼저 분석하세요.")}</p>}
      {turns.map(turn => <p key={turn.ids[0]} className="transcript-turn">
        {onSeek && <button className="transcript-seek" onClick={() => onSeek(turn.start)} aria-label={t("이 발언으로 이동")} title={reportTime(turn.start)}><Play size={12}/></button>}
        {timestamps && <span className="transcript-time">[{reportTime(turn.start)} – {reportTime(turn.end)}] </span>}
        <strong>{turn.speaker}: </strong><span>{turn.text}</span>
      </p>)}
    </div>
    {pages > 1 && <div className="transcript-pagination"><button disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>{t("이전")}</button><span>{currentPage + 1} / {pages}</span><button disabled={currentPage + 1 === pages} onClick={() => setPage(currentPage + 1)}>{t("다음")}</button></div>}
    <p className="muted">{t("화면은 100개 발언씩 표시하며, 내보내기는 전체 발언을 포함합니다.")}</p>
  </section>;
}
