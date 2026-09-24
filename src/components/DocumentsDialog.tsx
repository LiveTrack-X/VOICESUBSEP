import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog } from "./Dialog";
import { download, request } from "../api";
import { formatTime, safeFilename, type Project } from "../domain";
import { acceptMinutesResponse, documentBatches, documentSourceOptions, emptyDocuments, evidenceFor, evidenceIsCurrent, exportDocument, interviewTag, parseDocuments, type InterviewRole, type InterviewTag, type MinutesItem, type MinutesKind, type ProjectDocuments } from "../documents";
import { useI18n } from "../i18n";
import type { TranslationStatus } from "../translation";
import "./documents.css";

const kinds: Record<MinutesKind, string> = { summary: "요약", discussion: "논의", decision: "결정", action: "할 일" };
export function DocumentsDialog({ project, update, onClose, onSource }: {
  project: Project; update: (change: (p: Project) => Project) => void;
  onClose: () => void; onSource: (time: number, captionId: string) => void;
}) {
  const { t, locale } = useI18n();
  const [mode, setMode] = useState<"interview" | "minutes">("interview");
  const [page, setPage] = useState(0);
  const [status, setStatus] = useState<TranslationStatus | null>(null);
  const [model, setModel] = useState("");
  const [device, setDevice] = useState<"auto" | "cpu">("auto");
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState("");
  const [pending, setPending] = useState<MinutesItem[]>([]);
  const [sourceId, setSourceId] = useState(project.captions[0]?.id ?? "");
  const [sourceSearch, setSourceSearch] = useState("");
  const stop = useRef(false), alive = useRef(true);
  const docs = project.documents ?? emptyDocuments();
  const captions = useMemo(() => [...project.captions].sort((a,b) => a.start-b.start), [project.captions]);
  const sourceOptions = useMemo(() => documentSourceOptions(captions, sourceSearch, sourceId), [captions, sourceSearch, sourceId]);
  const pages = Math.max(1, Math.ceil(captions.length / 50));
  function edit(change: (d: ProjectDocuments) => ProjectDocuments) {
    try {
      update(p => ({ ...p, documents: parseDocuments(change(p.documents ?? emptyDocuments())) }));
      setError(""); return true;
    } catch (cause) { setError((cause as Error).message); return false; }
  }
  function close(position?:number,captionId?:string) {
    if((running||pending.length)&&!window.confirm(t("추가하지 않은 초안이 있습니다. 닫으면 생성 작업 연결과 이 초안을 버립니다.")))return;
    if(position!==undefined&&captionId)onSource(position,captionId);
    onClose();
  }
  useEffect(() => {
    alive.current = true;
    void request<TranslationStatus>("/api/translation/status").then(result => {
      if (alive.current) { setStatus(result); setModel(result.models[0] ?? ""); }
    }).catch(e => { if (alive.current) setError(String(e.message)); });
    return () => { alive.current = false; stop.current = true; };
  }, []);
  async function generate() {
    if (running || pending.length) return;
    setError(""); setPending([]); setRunning(true); stop.current = false;
    try {
      const batches = documentBatches(captions); const items: MinutesItem[] = [];
      for (const [index, batch] of batches.entries()) {
        if (stop.current || !alive.current) break;
        setProgress(`${index + 1} / ${batches.length}`);
        const response = await request<unknown>("/api/documents/generate", {
          method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(195000),
          body: JSON.stringify({ model, language: locale, device, captions: batch.map(c => ({ id: c.id, text: c.text, speaker: project.speakers.find(s=>s.id===c.speakerId)?.name ?? "" })) }),
        });
        if (!alive.current) return;
        const next = acceptMinutesResponse(response, batch);
        if (items.length + next.length + docs.items.length > 1000) throw new Error(t("문서 항목은 최대 1000개입니다."));
        items.push(...next); setPending([...items]);
      }
    } catch(e) { if(alive.current) setError((e as Error).message); }
    finally { if(alive.current) { setRunning(false); setProgress(""); } }
  }
  function addManual() {
    if (docs.items.length >= 1000) { setError(t("문서 항목은 최대 1000개입니다.")); return; }
    const source = captions.find(c=>c.id===sourceId);
    edit(d => ({ ...d, items: [...d.items, { id: crypto.randomUUID(), kind:"discussion", text:"", owner:"", due:"", evidence:source?[evidenceFor(source)]:[], status:"draft" }] }));
  }
  function changeItem(itemId: string, change: Partial<MinutesItem>) {
    edit(d=>({...d, items:d.items.map(item=>item.id===itemId?{...item,...change}:item)}));
  }
  return <Dialog title={t("인터뷰·회의록")} onClose={()=>close()}>
    <div className="document-tabs"><button aria-pressed={mode==="interview"} onClick={()=>setMode("interview")}>{t("인터뷰")}</button><button aria-pressed={mode==="minutes"} onClick={()=>setMode("minutes")}>{t("회의록")}</button></div>
    <p>{t("원본 시간과 근거 자막을 유지합니다. 생성 문서는 확인 전까지 초안입니다.")}</p>
    {mode==="interview" ? <>
      <div className="interview-roles">{project.speakers.map(s=><label key={s.id}>{s.name}<select aria-label={`${s.name} ${t("인터뷰 역할")}`} value={docs.roles[s.id]??"participant"} onChange={e=>edit(d=>({...d,roles:{...d.roles,[s.id]:e.target.value as InterviewRole}}))}><option value="participant">{t("참가자")}</option><option value="questioner">{t("질문자")}</option><option value="respondent">{t("답변자")}</option></select></label>)}</div>
      <p>{t("인물 역할로 질문과 답변을 구분하며, 각 자막의 분류를 직접 바꿀 수 있습니다.")}</p>
      <div className="document-transcript">{captions.slice(page*50,(page+1)*50).map(c=><article key={c.id} className={`interview-${interviewTag(c,docs)}`}>
        <button onClick={()=>close(c.start,c.id)}>{formatTime(c.start)}</button>
        <strong>{project.speakers.find(s=>s.id===c.speakerId)?.name??t("미배정")}</strong>
        <select aria-label={`${t("문답 분류")} ${c.id}`} value={interviewTag(c,docs)} onChange={e=>edit(d=>({...d,tags:{...d.tags,[c.id]:e.target.value as InterviewTag}}))}><option value="question">{t("질문")}</option><option value="answer">{t("답변")}</option><option value="other">{t("기타")}</option></select>
        <p>{c.text}</p>
      </article>)}</div>
      <div className="document-pagination"><button disabled={page===0} onClick={()=>setPage(p=>p-1)}>{t("이전")}</button><span>{page+1} / {pages}</span><button disabled={page+1>=pages} onClick={()=>setPage(p=>p+1)}>{t("다음")}</button></div>
    </> : <>
      <details className="document-generation"><summary>{t("로컬 AI로 회의록 초안 생성")}</summary>
        <p>{t("이 기기의 Ollama 모델만 사용합니다. 모델을 자동 다운로드하지 않습니다.")}</p>
        <label>{t("모델")}<select aria-label={t("회의록 모델")} disabled={running} value={model} onChange={e=>setModel(e.target.value)}>{status?.models.map(name=><option key={name}>{name}</option>)}</select></label>
        <label>{t("실행 장치")}<select value={device} disabled={running} onChange={e=>setDevice(e.target.value as typeof device)}><option value="auto">{t("자동")}</option><option value="cpu">CPU</option></select></label>
        {!status?.ready&&<p>{t("로컬 모델이 준비되지 않았습니다. 수동 회의록은 작성할 수 있습니다.")}</p>}
        <button disabled={running||!!pending.length||!model||!captions.length} onClick={()=>void generate()}>{t("구간별 초안 생성")}</button>
        {running&&<><span role="status">{progress}</span><button onClick={()=>{stop.current=true;setProgress(t("현재 구간 완료 후 중지합니다."));}}>{t("중지")}</button></>}
        {!!pending.length&&<>
          <button disabled={running} onClick={()=>{if(docs.items.length+pending.length>1000){setError(t("문서 항목은 최대 1000개입니다."));return;}if(edit(d=>({...d,items:[...d.items,...pending]})))setPending([]);}}>{t("생성한 초안 추가")} ({pending.length})</button>
          <button disabled={running} onClick={()=>{if(window.confirm(t("추가하지 않은 생성 초안을 버릴까요? 프로젝트에 추가한 항목은 유지됩니다.")))setPending([]);}}>{t("생성 초안 버리기")}</button>
        </>}
        <p>{t("새 초안은 기존 내용을 덮어쓰지 않습니다. 담당자·기한은 원문에 없으면 미정입니다.")}</p>
      </details>
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
          <div className="document-evidence">{item.evidence.map(e=><button key={e.id} disabled={!project.captions.some(c=>c.id===e.id)} title={e.text} onClick={()=>{const current=project.captions.find(c=>c.id===e.id);if(current)close(current.start,current.id);}}>{t("근거")} {formatTime(e.start)}</button>)}
          {!fresh&&<button onClick={()=>changeItem(item.id,{evidence:item.evidence.flatMap(e=>{const c=project.captions.find(c=>c.id===e.id);return c?[evidenceFor(c)]:[];}),status:"draft"})}>{t("현재 근거로 갱신")}</button>}
          <button disabled={!sourceId} onClick={()=>{const c=project.captions.find(c=>c.id===sourceId);if(c)changeItem(item.id,{evidence:[evidenceFor(c)],status:"draft"});}}>{t("선택한 자막으로 근거 교체")}</button>
          <button disabled={!fresh||!item.text.trim()} aria-pressed={item.status==="reviewed"&&fresh} onClick={()=>changeItem(item.id,{status:item.status==="reviewed"?"draft":"reviewed"})}>{t("확인 완료")}</button></div>
        </article>;
      })}</div>
    </>}
    {error&&<p role="alert">{error}</p>}
    <div className="dialog-actions"><button onClick={()=>download(`${safeFilename(project.name)}-${mode}.md`,exportDocument(project,mode,t),"text/markdown;charset=utf-8")}>{t("문서 Markdown 저장")}</button><button onClick={()=>close()}>{t("닫기")}</button></div>
  </Dialog>;
}
