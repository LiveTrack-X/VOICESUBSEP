import { useEffect, useRef, useState } from "react";
import { ApiError, download, request, uploadMedia, type AnalysisResult, type Job } from "../api";
import type { Project } from "../domain";
import { cacheCleanupSelection, cleanupMediaCache, jobUrl, readHistory, sameAnalysisSource, type CacheInfo, type HistoryItem } from "../jobHistory";
import { useI18n } from "../i18n";
import { Dialog } from "./Dialog";
import { RenderDialog } from "./RenderDialog";
import { AnalysisJobDetails } from "./AnalysisJobDetails";
import { AnalysisQueueControls } from "./AnalysisQueueControls";
import { jobStageLabel } from "../jobStage";

export function JobHistoryDialog({project,file,onClose,onApplyAnalysis}: {
  project:Project; file:File|null; onClose:()=>void; onApplyAnalysis:(result:AnalysisResult)=>void;
}) {
  const {t}=useI18n();
  const [items,setItems]=useState<HistoryItem[]>([]);
  const [cache,setCache]=useState<CacheInfo|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  const [renderId,setRenderId]=useState<string|null>(null);
  const [analysis,setAnalysis]=useState<{item:HistoryItem;job:Job}|null>(null);
  const inspected=useRef<string|null>(null);
  const [mediaId,setMediaId]=useState<string|null>(null);
  const [verifiedFile,setVerifiedFile]=useState<File|null>(null);
  const [confirm,setConfirm]=useState<string|null>(null);
  const [cleanup,setCleanup]=useState<{ids:string[];bytes:number}|null>(null);
  const [cleanupNotice,setCleanupNotice]=useState("");
  const [count,setCount]=useState(30);
  const alive=useRef(true);
  const sequence=useRef(0);
  const bytes=(value:number)=>value<1024?`${value} B`:value<1024**2?`${(value/1024).toFixed(1)} KiB`:value<1024**3?`${(value/1024**2).toFixed(1)} MiB`:`${(value/1024**3).toFixed(2)} GiB`;
  const statusLabel={queued:"분석 대기",running:"분석 중",completed:"분석 완료",failed:"분석 실패",cancelled:"분석 취소됨"};
  const renderStatusLabel={queued:"렌더 대기 중",running:"렌더링 중",completed:"렌더 완료",failed:"렌더 실패",cancelled:"렌더 취소"};
  async function refresh(){
    const current=++sequence.current;
    try {
      const [history,storage]=await Promise.all([readHistory(),request<CacheInfo>("/api/cache")]);
      if(alive.current&&current===sequence.current){setItems(history.items);setCache(storage);setError("");}
      const id=inspected.current;
      if(id){
        const job=await request<Job>(`/api/jobs/${id}`);
        if(alive.current&&current===sequence.current&&inspected.current===id&&job.id===id)setAnalysis(value=>value?.job.id===id?{...value,job}:value);
      }
    }catch(e){if(alive.current&&current===sequence.current)setError((e as Error).message);}
    finally{if(alive.current&&current===sequence.current)setLoading(false);}
  }
  useEffect(()=>{alive.current=true;void refresh();const timer=window.setInterval(()=>void refresh(),5000);return()=>{alive.current=false;sequence.current++;clearInterval(timer);};},[]);
  async function inspectAnalysis(item:HistoryItem){
    setBusy(true);setError("");setMediaId(null);setVerifiedFile(null);
    try{
      const job=await request<Job>(jobUrl(item));
      if(!alive.current)return;
      inspected.current=job.id;
      setAnalysis({item,job});
      if(file&&item.projectId===project.id){
        const linked=await uploadMedia(file);
        if(alive.current){setMediaId(linked.id);setVerifiedFile(file);}
      }
    }catch(e){if(alive.current)setError((e as Error).message);}
    finally{if(alive.current)setBusy(false);}
  }
  async function remove(url:string){
    setBusy(true);setError("");
    try{await request(url,{method:"DELETE"});if(alive.current){setConfirm(null);setAnalysis(null);inspected.current=null;await refresh();}}
    catch(e){if(alive.current)setError((e as Error).message);}
    finally{if(alive.current)setBusy(false);}
  }
  async function cancel(item:HistoryItem){
    setBusy(true);
    try{await request(jobUrl(item),{method:"DELETE"});await refresh();}
    catch(e){if(alive.current){setError((e as Error).message);if(e instanceof ApiError&&e.status===404)void refresh();}}
    finally{if(alive.current)setBusy(false);}
  }
  async function cleanCache(){
    if(!cleanup||busy)return;
    setBusy(true);setError("");setCleanupNotice("");
    try{
      const result=await cleanupMediaCache(cleanup.ids);
      if(alive.current){
        setCleanup(null);
        setCleanupNotice(t("캐시 {count}개 · {bytes} 정리 완료. 보호되었거나 없는 항목 {skipped}개, 정리 실패 {failed}개.",{count:result.removedCount,bytes:bytes(result.removedBytes),skipped:result.skippedCount,failed:result.failedCount}));
        await refresh();
      }
    }catch{if(alive.current)setError(t("캐시를 정리하지 못했습니다. 새로고침 후 다시 시도하세요."));}
    finally{if(alive.current)setBusy(false);}
  }
  if(renderId)return <RenderDialog project={project} file={null} resumeId={renderId} onClose={()=>setRenderId(null)}/>;
  const availableCleanup=cache?cacheCleanupSelection(cache):null;
  const canApply=analysis&&file&&verifiedFile===file&&mediaId&&sameAnalysisSource(analysis.item,project.id,mediaId)&&analysis.job.status==="completed"&&analysis.job.result;
  return <Dialog title={t("작업 이력 및 저장 공간")} onClose={onClose} closeDisabled={busy}>
    <p>{t("분석과 내보내기는 창을 닫아도 계속됩니다. 완료된 결과를 여기서 다시 열 수 있습니다.")}</p>
    {loading&&<p role="status">{t("불러오는 중…")}</p>}
    {error&&<p className="error-box" role="alert">{error}</p>}
    <button disabled={busy} onClick={()=>void refresh()}>{t("새로고침")}</button>
    {!loading&&!items.length&&<p>{t("저장된 작업이 없습니다.")}</p>}
    <div className="history-list">{items.slice(0,count).map(item=>{
      const running=item.status==="queued"||item.status==="running";
      return <section key={`${item.kind}-${item.id}`} style={{borderBottom:"1px solid var(--border, #dce1eb)",padding:"12px 0"}}>
        <strong>{item.kind==="analysis"?t("음성 분석"):t("편집본 내보내기")} · {item.projectName||item.mediaName}</strong>
        <p>{item.mediaName} · {item.createdAt?new Date(item.createdAt).toLocaleString():""} · {t(item.kind==="analysis"?statusLabel[item.status]:renderStatusLabel[item.status])} {running?`${Math.round(item.progress*100)}%`:""}</p>
        <div className="dialog-actions">
          <button disabled={busy} onClick={()=>item.kind==="render"?setRenderId(item.id):void inspectAnalysis(item)}>{t("결과 및 진행 확인")}</button>
          {running?<button disabled={busy} onClick={()=>void cancel(item)}>{t("작업 취소")}</button>:
            confirm===item.id?<><span>{t("이 작업의 결과 파일도 삭제합니다.")}</span><button disabled={busy} onClick={()=>void remove(`/api/history/${item.kind}/${item.id}`)}>{t("삭제 확인")}</button><button onClick={()=>setConfirm(null)}>{t("취소")}</button></>:
            <button disabled={busy} onClick={()=>setConfirm(item.id)}>{t("작업 기록 삭제")}</button>}
        </div>
      </section>;
    })}</div>
    {items.length>count&&<button onClick={()=>setCount(value=>value+30)}>{t("더 보기")}</button>}
    {analysis&&<section className="export-section">
      <h3>{t("분석 결과 확인")}</h3><p>{analysis.item.mediaName} · {t(statusLabel[analysis.job.status])}</p>
      {(analysis.job.status==="running"||analysis.job.status==="queued")&&<><progress value={analysis.job.progress} max={1}/><p>{Math.round(analysis.job.progress*100)}% · {t(jobStageLabel(analysis.job.stage))}</p></>}
      <AnalysisQueueControls key={analysis.job.id} job={analysis.job} showCancel onUpdated={job=>{setAnalysis(value=>value?.job.id===job.id?{...value,job}:value);void refresh();}}/>
      {analysis.job.error&&<p className="error-box">{analysis.job.error}</p>}
      {analysis.job.result&&<p>{t("자막 {captions}개 · 감지된 인물 {speakers}명",{captions:analysis.job.result.captions.length,speakers:analysis.job.result.speakers.length})}</p>}
      <AnalysisJobDetails key={analysis.job.id} job={analysis.job}/>
      {analysis.job.result&&<>
        <p>{t("같은 프로젝트와 원본 파일이 연결된 경우에만 결과를 적용할 수 있습니다.")}</p>
        <p>{t("적용하면 기존 자막이 교체됩니다. 노트는 유지됩니다.")}</p>
        <div className="dialog-actions"><button onClick={()=>download(`analysis-${analysis.item.id}.json`,JSON.stringify(analysis.job.result,null,2),"application/json;charset=utf-8")}>{t("분석 결과 JSON 저장")}</button>
          <button className="primary" disabled={busy||!canApply} onClick={()=>{if(canApply)onApplyAnalysis(analysis.job.result!);}}>{t("결과 적용")}</button></div></>}
    </section>}
    {cache&&<section className="export-section"><h3>{t("미디어 캐시")}</h3>
      <p>{t("사용 중 {used} · 정리 가능 {free} · 디스크 여유 {disk}",{used:bytes(cache.bytes),free:bytes(cache.reclaimableBytes),disk:bytes(cache.freeBytes)})}</p>
      <p>{t("앱이 복사한 원본만 정리합니다. 분석·내보내기·미리듣기에서 사용하는 파일은 보호됩니다. 사용자의 원본 파일은 삭제하지 않습니다.")}</p>
      <p className="muted">{t("자동 삭제 없이 사용하지 않는 복사본만 직접 정리합니다. 저장된 작업 결과와 모델·녹음은 유지합니다.")}</p>
      {cleanupNotice&&<p role="status">{cleanupNotice}</p>}
      {cleanup?<div className="export-section" role="group" aria-label={t("캐시 정리 확인")}>
        <p>{t("표시한 복사본 {count}개 · {bytes}를 정리할까요? 삭제 직전에 사용 여부를 다시 확인합니다.",{count:cleanup.ids.length,bytes:bytes(cleanup.bytes)})}</p>
        <div className="dialog-actions"><button disabled={busy} onClick={()=>void cleanCache()}>{t("정리 확인")}</button><button disabled={busy} onClick={()=>setCleanup(null)}>{t("취소")}</button></div>
      </div>:<button disabled={busy||!availableCleanup?.ids.length} onClick={()=>{setConfirm(null);setCleanupNotice("");setCleanup(availableCleanup);}}>{t("정리 가능한 캐시 정리")} · {availableCleanup?.ids.length} · {bytes(availableCleanup?.bytes??0)}</button>}
      <p>{t("작업 결과를 더 이상 보관하지 않을 때 작업 기록을 먼저 삭제하세요.")}</p>
      {cache.items.map(item=><div key={item.id} className="dialog-actions" style={{justifyContent:"space-between"}}>
        <span>{item.name} · {bytes(item.bytes)} {item.protected?`· ${t("작업에서 사용 중")}`:""}</span>
        {confirm===item.id?<><button disabled={busy} onClick={()=>void remove(`/api/media/${item.id}`)}>{t("삭제 확인")}</button><button onClick={()=>setConfirm(null)}>{t("취소")}</button></>:
          <button disabled={busy||item.protected} onClick={()=>setConfirm(item.id)}>{t("복사본 삭제")}</button>}
      </div>)}
    </section>}
    <div className="dialog-actions"><button disabled={busy} onClick={onClose}>{t("닫기")}</button></div>
  </Dialog>;
}
