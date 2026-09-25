import { useMemo, useState, type CSSProperties } from "react";
import { Download, Play, Search } from "lucide-react";
import { download } from "../api";
import { safeFilename, type Project } from "../domain";
import { useI18n } from "../i18n";
import { downloadDocumentBytes, downloadDocumentXlsx, reportTime } from "../documentExports";
import { saveDocumentPdf, supportsDirectPdf } from "../documentPdf";
import { buildTranscriptDocument, DOCX_MIME, exportTranscriptDocx, exportTranscriptHtml, exportTranscriptTxt, exportTranscriptXlsx, type TranscriptTurn } from "../transcriptDocument";
import { readableSpeakerColor } from "../speakerColor";
import { useTranscriptScroll } from "../useTranscriptScroll";
import { filterTranscript, transcriptTimeTarget } from "../transcriptSearch";
import "./transcript-document.css";

export type TranscriptDocumentPanelProps = {
  project: Project;
  onSeek?: (seconds: number, captionId: string) => void;
  onPrint?: (html: string) => void;
  onExportingChange?: (exporting: boolean) => void;
};
/** A timestamp is not a unique cue identity when people speak simultaneously. */
export function TranscriptSeekButton({turn,onSeek,label}:{turn:TranscriptTurn;onSeek:NonNullable<TranscriptDocumentPanelProps["onSeek"]>;label:string}) {
  const captionId=turn.ids[0];
  return <button className="transcript-seek" disabled={!captionId} onClick={()=>{if(captionId)onSeek(turn.start,captionId);}} aria-label={label} title={reportTime(turn.start)}><Play size={12}/></button>;
}
const speakerStyle = (color: string | null): CSSProperties => ({
  "--speaker-marker": color ?? "#667085",
  "--speaker-name-light": readableSpeakerColor(color),
  "--speaker-name-dark": readableSpeakerColor(color, "#181e2a"),
} as CSSProperties);

export function TranscriptDocumentPanel({ project, onSeek, onPrint, onExportingChange }: TranscriptDocumentPanelProps) {
  const { t, locale } = useI18n();
  const [timestamps, setTimestamps] = useState(false);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false), [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [timeQuery, setTimeQuery] = useState("");
  const [searchError, setSearchError] = useState("");
  const [reveal, setReveal] = useState<{ id: string; nonce: number } | null>(null);
  const [searchRevision, setSearchRevision] = useState(0);
  const transcript = useMemo(() => buildTranscriptDocument(project, t), [project, t]);
  const filtered = useMemo(() => filterTranscript(transcript.turns, query), [transcript.turns, query]);
  const { scrollRef, range, onScroll } = useTranscriptScroll(filtered, timestamps, `${project.id}\0${query}\0${searchRevision}`, reveal);
  const turns = filtered.slice(range.start, range.end);
  const highlightedId = reveal?.id ?? (query.trim() ? filtered[0]?.ids[0] : undefined);
  function changeQuery(value: string) { setQuery(value); setReveal(null); setSearchError(""); setSearchRevision(value => value + 1); }
  function findTime() {
    try {
      const turn = transcriptTimeTarget(filtered, timeQuery);
      if (!turn) { setSearchError(t("해당 시간 이후의 발언이 현재 검색 결과에 없습니다.")); return; }
      setReveal(previous => ({ id: turn.ids[0]!, nonce: (previous?.nonce ?? 0) + 1 }));
      setSearchError("");
    } catch { setSearchError(t("초, 분:초 또는 시:분:초 형식으로 입력하세요.")); }
  }

  async function save(format: "docx" | "txt" | "html" | "pdf" | "xlsx") {
    if (exporting) return;
    setExporting(true); onExportingChange?.(true); setNotice(""); setError("");
    try {
      const options = { timestamps, locale }, base = `${safeFilename(project.name)}-transcript`;
      if (format === "docx") {
        downloadDocumentBytes(exportTranscriptDocx(project, t, options), `${base}.docx`, DOCX_MIME);
      } else if (format === "txt") download(`${base}.txt`, exportTranscriptTxt(project, t, options));
      else if (format === "xlsx") downloadDocumentXlsx(exportTranscriptXlsx(project, t), `${base}.xlsx`);
      else {
        const html = exportTranscriptHtml(project, t, options);
        if (format === "html") download(`${base}.html`, html, "text/html;charset=utf-8");
        else if (onPrint) onPrint(html);
        else if (await saveDocumentPdf(html, base, t) === "saved") setNotice(t("PDF 파일을 저장했습니다."));
      }
      setError("");
    } catch (cause) { setError(cause instanceof Error ? t(cause.message) : t("보고서를 만들지 못했습니다.")); }
    finally { setExporting(false); onExportingChange?.(false); }
  }

  return <section className="transcript-document-panel" aria-label={t("발언록")}>
    <p className="muted">{t("자막 원문을 시간순으로 정리한 발언록입니다. 자동 요약이나 문장 재작성은 하지 않습니다.")}</p>
    <div className="transcript-controls">
      <label><input type="checkbox" checked={timestamps} onChange={event => setTimestamps(event.target.checked)}/>{t("시간 표시")}</label>
    </div>
    <p className="muted">{t("인접한 같은 인물의 자막만 줄바꿈으로 묶습니다. 겹친 발화와 긴 침묵은 분리합니다.")}</p>
    <div className="transcript-export-actions">
      <button disabled={!transcript.turns.length||exporting} onClick={() => void save("docx")}><Download size={14}/>{t("Word 문서 (.docx)")}</button>
      <button disabled={!transcript.turns.length||exporting} onClick={() => void save("txt")}>{t("텍스트 (.txt)")}</button>
      <button disabled={!transcript.turns.length||exporting} onClick={() => void save("xlsx")}>{t("Excel 통합문서 저장")}</button>
      <button disabled={!transcript.turns.length||exporting} onClick={() => void save("html")}>{t("HTML 보고서")}</button>
      <button disabled={!transcript.turns.length||exporting} onClick={() => void save("pdf")}>{t(supportsDirectPdf()?"PDF 파일 저장":"PDF 저장(인쇄)")}</button>
    </div>
    {error && <p className="inline-error" role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    <div className="transcript-search-tools">
      <label className="transcript-text-search"><Search size={14} aria-hidden="true"/>
        <input type="search" aria-label={t("발언 내용·인물 검색")} placeholder={t("발언 내용·인물 검색")} maxLength={200} value={query} onChange={event => changeQuery(event.target.value)}/>
      </label>
      <div className="transcript-time-search">
        <input type="text" aria-label={t("찾을 시간")} placeholder="00:00:00.000" maxLength={24} value={timeQuery}
          onChange={event => { setTimeQuery(event.target.value); setSearchError(""); }}
          onKeyDown={event => { if (event.key === "Enter" && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) { event.preventDefault(); findTime(); } }}/>
        <button type="button" disabled={!timeQuery.trim()} onClick={findTime}>{t("시간 찾기")}</button>
      </div>
      <button type="button" disabled={!query && !timeQuery && !reveal} onClick={() => { changeQuery(""); setTimeQuery(""); }}>{t("검색 초기화")}</button>
    </div>
    <p className="transcript-search-summary" role="status">{t("검색 결과 {count}개 / 전체 {total}개 · 내보내기는 전체 발언", { count: filtered.length, total: transcript.turns.length })}</p>
    {searchError && <p className="inline-error" role="alert">{searchError}</p>}
    <div className="transcript-page">
      <h3>{transcript.title}</h3>
      <p className="transcript-people">{t("참가자")}: {transcript.people.length ? transcript.people.map((person, index) => <span key={person.id ?? "unassigned"}>{index > 0 && ", "}<strong className="transcript-speaker" style={speakerStyle(person.color)}>{person.name}</strong></span>) : "—"}</p>
      <div ref={scrollRef} className="transcript-scroll" role="list" tabIndex={0} aria-label={t("발언 내용")} onScroll={onScroll}>
      {!filtered.length && <p>{t(transcript.turns.length ? "일치하는 발언이 없습니다." : "분석한 대사가 없습니다. 녹음 또는 미디어를 먼저 분석하세요.")}</p>}
      {range.before > 0 && <div aria-hidden="true" style={{ height: range.before }}/>}
      {turns.map((turn, index) => <p key={turn.ids[0]} className={`transcript-turn${turn.ids[0] === highlightedId ? " transcript-turn-found" : ""}`} data-transcript-index={range.start + index} role="listitem" aria-posinset={range.start + index + 1} aria-setsize={filtered.length}>
        {onSeek && <TranscriptSeekButton turn={turn} onSeek={onSeek} label={t("이 발언 재생")}/>}
        {timestamps && <span className="transcript-time">[{reportTime(turn.start)} – {reportTime(turn.end)}] </span>}
        {turn.speechUncertain && <small className="transcript-time">[{t("음성 확인 필요")}] </small>}
        <strong className="transcript-speaker" style={speakerStyle(turn.color)}>{turn.speaker}: </strong><span>{turn.text}</span>
      </p>)}
      {range.after > 0 && <div aria-hidden="true" style={{ height: range.after }}/>}</div>
    </div>
    <p className="muted">{t("대사 수")}: {transcript.captionCount}</p>
  </section>;
}
