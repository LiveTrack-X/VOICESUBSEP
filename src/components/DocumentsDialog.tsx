import { useMemo, useState } from "react";
import { Pause, Play } from "lucide-react";
import { Dialog } from "./Dialog";
import { download } from "../api";
import { formatTime, safeFilename, type Project } from "../domain";
import { documentSourceOptions, emptyDocuments, evidenceFor, evidenceIsCurrent, exportDocument, interviewTag, parseDocuments, type InterviewRole, type InterviewTag, type MinutesItem, type MinutesKind, type ProjectDocuments } from "../documents";
import { useI18n } from "../i18n";
import { documentParticipants, downloadDocumentBytes, downloadDocumentXlsx, exportDocumentDocx, exportDocumentHtml, exportDocumentTxt, exportDocumentXlsx } from "../documentExports";
import { saveDocumentPdf, supportsDirectPdf } from "../documentPdf";
import { WORD_MIME } from "../wordDocument";
import { TranscriptDocumentPanel } from "./TranscriptDocumentPanel";
import "./documents.css";

const kinds: Record<MinutesKind, string> = { summary: "요약", discussion: "논의", decision: "결정", action: "할 일" };
export function DocumentsDialog({ project, update, onClose, onSource, time = 0, playing = false, mediaAvailable = false, onTogglePlayback }: {
  project: Project; update: (change: (p: Project) => Project) => void;
  onClose: () => void; onSource: (time: number, captionId: string) => void;
  time?: number; playing?: boolean; mediaAvailable?: boolean; onTogglePlayback?: () => void;
}) {
  const { t, locale } = useI18n();
  const [mode, setMode] = useState<"transcript" | "interview" | "minutes">("transcript");
  const [page, setPage] = useState(0);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportNotice, setExportNotice] = useState("");
  const [sourceId, setSourceId] = useState(project.captions[0]?.id ?? "");
  const [sourceSearch, setSourceSearch] = useState("");
  const docs = project.documents ?? emptyDocuments();
  const captions = useMemo(() => [...project.captions].sort((a,b) => a.start-b.start), [project.captions]);
  const sourceOptions = useMemo(() => documentSourceOptions(captions, sourceSearch, sourceId), [captions, sourceSearch, sourceId]);
  const pages = Math.max(1, Math.ceil(captions.length / 50));
  const participants = useMemo(() => documentParticipants(project), [project]);
  function edit(change: (d: ProjectDocuments) => ProjectDocuments) {
    try {
      update(p => ({ ...p, documents: parseDocuments(change(p.documents ?? emptyDocuments())) }));
      setError(""); return true;
    } catch (cause) { setError((cause as Error).message); return false; }
  }
  function close() {
    if (exporting) return;
    onClose();
  }
  function playSource(position: number, captionId: string) {
    if (!exporting && mediaAvailable) onSource(position, captionId);
  }
  function addManual() {
    if (docs.items.length >= 1000) { setError(t("문서 항목은 최대 1000개입니다.")); return; }
    const source = captions.find(c=>c.id===sourceId);
    edit(d => ({ ...d, items: [...d.items, { id: crypto.randomUUID(), kind:"discussion", text:"", owner:"", due:"", evidence:source?[evidenceFor(source)]:[], status:"draft" }] }));
  }
  function changeItem(itemId: string, change: Partial<MinutesItem>) {
    edit(d=>({...d, items:d.items.map(item=>item.id===itemId?{...item,...change}:item)}));
  }
  async function exportReport(format: "html" | "pdf" | "xlsx" | "md" | "docx" | "txt") {
    if (mode === "transcript" || exporting) return;
    setExporting(true); setExportNotice(""); setError("");
    try {
      const base = `${safeFilename(project.name)}-${mode}`;
      if (format === "md") download(`${base}.md`, exportDocument(project, mode, t), "text/markdown;charset=utf-8");
      else if (format === "txt") download(`${base}.txt`, exportDocumentTxt(project, mode, t, { locale }));
      else if (format === "docx") downloadDocumentBytes(exportDocumentDocx(project, mode, t, { locale }), `${base}.docx`, WORD_MIME);
      else if (format === "xlsx") downloadDocumentXlsx(exportDocumentXlsx(project, mode, t, { locale }), `${base}.xlsx`);
      else {
        const html = exportDocumentHtml(project, mode, t, { locale });
        if (format === "pdf") {
          const outcome = await saveDocumentPdf(html, base, t);
          if (outcome === "saved") setExportNotice(t("PDF 파일을 저장했습니다."));
        }
        else download(`${base}.html`, html, "text/html;charset=utf-8");
      }
      setError("");
    } catch (cause) { setError((cause as Error).message); }
    finally { setExporting(false); }
  }
  return <Dialog title={t("인터뷰·회의록")} onClose={()=>close()} closeDisabled={exporting}>
    <div className="document-tabs"><button disabled={exporting} aria-pressed={mode==="transcript"} onClick={()=>setMode("transcript")}>{t("발언록")}</button><button disabled={exporting} aria-pressed={mode==="interview"} onClick={()=>setMode("interview")}>{t("인터뷰 문답")}</button><button disabled={exporting} aria-pressed={mode==="minutes"} onClick={()=>setMode("minutes")}>{t("회의 메모")}</button></div>
    <div className="document-playback" aria-label={t("문서에서 원음 재생")}>
      <button type="button" disabled={!mediaAvailable || !onTogglePlayback || exporting} onClick={onTogglePlayback} aria-label={t(playing ? "일시 정지" : "재생")}>
        {playing ? <Pause size={15}/> : <Play size={15}/>} {t(playing ? "일시 정지" : "재생")}
      </button>
      <span className="document-playback-time">{formatTime(time)} / {formatTime(project.duration)}</span>
      <small>{t(mediaAvailable ? "발언을 재생해도 문서는 열린 상태로 유지됩니다." : "재생하려면 원본 미디어를 연결하세요.")}</small>
    </div>
    {mode !== "transcript" && <p>{t("원본 시간과 근거 자막을 유지합니다. 생성 문서는 확인 전까지 초안입니다.")}</p>}
    {mode === "transcript" ? <TranscriptDocumentPanel project={project} onExportingChange={setExporting} onSeek={mediaAvailable ? playSource : undefined}/> : mode==="interview" ? <>
      <div className="interview-roles">{participants.map(s=><label key={s.id}>{s.name}<select aria-label={`${s.name} ${t("인터뷰 역할")}`} value={docs.roles[s.id]??"participant"} onChange={e=>edit(d=>({...d,roles:{...d.roles,[s.id]:e.target.value as InterviewRole}}))}><option value="participant">{t("참가자")}</option><option value="questioner">{t("질문자")}</option><option value="respondent">{t("답변자")}</option></select></label>)}</div>
      <p>{t("인물 역할로 질문과 답변을 구분하며, 각 자막의 분류를 직접 바꿀 수 있습니다.")}</p>
      <div className="document-transcript">{captions.slice(page*50,(page+1)*50).map(c=><article key={c.id} className={`interview-${interviewTag(c,docs)}`}>
        <button disabled={!mediaAvailable || exporting} aria-label={`${t("이 발언 재생")} ${formatTime(c.start)}`} onClick={()=>playSource(c.start,c.id)}><Play size={12}/> {formatTime(c.start)}</button>
        <strong>{project.speakers.find(s=>s.id===c.speakerId)?.name??t("미배정")}</strong>
        <select aria-label={`${t("문답 분류")} ${c.id}`} value={interviewTag(c,docs)} onChange={e=>edit(d=>({...d,tags:{...d.tags,[c.id]:e.target.value as InterviewTag}}))}><option value="question">{t("질문")}</option><option value="answer">{t("답변")}</option><option value="other">{t("기타")}</option></select>
        <p>{c.text}</p>
      </article>)}</div>
      <div className="document-pagination"><button disabled={page===0} onClick={()=>setPage(p=>p-1)}>{t("이전")}</button><span>{page+1} / {pages}</span><button disabled={page+1>=pages} onClick={()=>setPage(p=>p+1)}>{t("다음")}</button></div>
    </> : <>
      <p>{t("회의 내용을 직접 정리하고 근거 발언·담당자·기한을 기록하세요. AI 요약은 수행하지 않습니다.")}</p>
      <div className="document-manual">
        <input aria-label={t("근거 자막 검색")} placeholder={t("내용이나 시간으로 근거 검색")} value={sourceSearch} onChange={event=>setSourceSearch(event.target.value)} />
        <select aria-label={t("새 회의록 항목 근거")} value={sourceId} onChange={e=>setSourceId(e.target.value)}><option value="">{t("근거 미지정")}</option>{sourceOptions.captions.map(c=><option key={c.id} value={c.id}>{formatTime(c.start)} {c.text.slice(0,70)}</option>)}</select><button onClick={addManual}>{t("회의록 항목 추가")}</button>
        <span>{t("검색 결과 {count}개 · 최대 100개와 현재 선택을 표시", {count:sourceOptions.total})}</span>
      </div>
      <div className="minutes-list">{docs.items.map(item=>{
        const fresh=evidenceIsCurrent(item,project.captions);
        return <article key={item.id}>
          <div className="minutes-heading"><select aria-label={`${t("항목 분류")} ${item.id}`} value={item.kind} onChange={e=>changeItem(item.id,{kind:e.target.value as MinutesKind,status:"draft"})}>{Object.entries(kinds).map(([key,label])=><option key={key} value={key}>{t(label)}</option>)}</select><span>{t(!fresh?"근거 재확인 필요":item.status==="reviewed"?"확인 완료":"초안")}</span><button onClick={()=>edit(d=>({...d,items:d.items.filter(i=>i.id!==item.id)}))}>{t("삭제")}</button></div>
          <textarea aria-label={`${t("회의록 내용")} ${item.id}`} value={item.text} maxLength={8000} onChange={e=>changeItem(item.id,{text:e.target.value,status:"draft"})}/>
          <div className="minutes-fields"><label>{t("담당자")}<input placeholder={t("미정")} value={item.owner} maxLength={160} onChange={e=>changeItem(item.id,{owner:e.target.value,status:"draft"})}/></label><label>{t("기한")}<input placeholder={t("미정")} value={item.due} maxLength={160} onChange={e=>changeItem(item.id,{due:e.target.value,status:"draft"})}/></label></div>
          <div className="document-evidence">{item.evidence.map(e=><button key={e.id} disabled={!mediaAvailable || exporting || !project.captions.some(c=>c.id===e.id)} title={e.text} onClick={()=>{const current=project.captions.find(c=>c.id===e.id);if(current)playSource(current.start,current.id);}}><Play size={12}/> {t("근거")} {formatTime(e.start)}</button>)}
          {!fresh&&<button onClick={()=>changeItem(item.id,{evidence:item.evidence.flatMap(e=>{const c=project.captions.find(c=>c.id===e.id);return c?[evidenceFor(c)]:[];}),status:"draft"})}>{t("현재 근거로 갱신")}</button>}
          <button disabled={!sourceId} onClick={()=>{const c=project.captions.find(c=>c.id===sourceId);if(c)changeItem(item.id,{evidence:[evidenceFor(c)],status:"draft"});}}>{t("선택한 자막으로 근거 교체")}</button>
          <button disabled={!fresh||!item.text.trim()} aria-pressed={item.status==="reviewed"&&fresh} onClick={()=>changeItem(item.id,{status:item.status==="reviewed"?"draft":"reviewed"})}>{t("확인 완료")}</button></div>
        </article>;
      })}</div>
    </>}
    {mode !== "transcript" && <>
    {error&&<p role="alert">{error}</p>}
    <p>{t("HTML은 브라우저에서 열 수 있는 보고서이며, Excel은 대사·할 일·근거를 시트로 정리합니다.")}</p>
    {exportNotice&&<p role="status">{exportNotice}</p>}
    {!captions.length&&<p>{t("분석한 대사가 없습니다. 녹음 또는 미디어를 먼저 분석하세요.")}</p>}
    <div className="dialog-actions">
      <button disabled={exporting} onClick={()=>void exportReport("docx")}>{t("Word 문서 (.docx)")}</button>
      <button disabled={exporting} onClick={()=>void exportReport("txt")}>{t("텍스트 (.txt)")}</button>
      <button disabled={exporting} onClick={()=>void exportReport("pdf")}>{t(supportsDirectPdf()?"PDF 파일 저장":"PDF 저장(인쇄)")}</button>
      <button disabled={exporting} onClick={()=>void exportReport("html")}>{t("보고서 HTML 저장")}</button>
      <button disabled={exporting} onClick={()=>void exportReport("xlsx")}>{t("Excel 통합문서 저장")}</button>
      <button disabled={exporting} onClick={()=>void exportReport("md")}>{t("문서 Markdown 저장")}</button>
      <button disabled={exporting} onClick={()=>close()}>{t("닫기")}</button>
    </div>
    </>}
    {mode === "transcript" && <div className="dialog-actions"><button disabled={exporting} onClick={()=>close()}>{t("닫기")}</button></div>}
  </Dialog>;
}
