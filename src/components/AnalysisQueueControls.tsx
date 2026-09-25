import { useEffect, useRef, useState } from "react";
import type { Job } from "../api";
import { useI18n } from "../i18n";
import { prioritizeAnalysis, queueError, stopAnalysis } from "../jobQueue";
import { jobStageLabel } from "../jobStage";
import "./analysis-queue.css";

type Confirmation={id:string;name:string;force:boolean;own:boolean};
export function AnalysisQueueControls({job,onUpdated,showCancel=false}:{job:Job;onUpdated:(job:Job)=>void;showCancel?:boolean}){
  const {t}=useI18n();const [busy,setBusy]=useState(false),[error,setError]=useState("");
  const [confirming,setConfirming]=useState<Confirmation|null>(null);
  const generation=useRef(0);
  useEffect(()=>{generation.current++;setBusy(false);setError("");setConfirming(null);return()=>{generation.current++;};},[job.id]);
  const queue=job.queue,blocker=queue?.blockingJob;
  const blockerName=blocker?[blocker.projectName,blocker.mediaName].filter(Boolean).join(" · ")||blocker.id:"";
  async function execute(confirmation?:Confirmation){
    const revision=generation.current;setBusy(true);setError("");
    try{
      const next=confirmation?.own?await stopAnalysis(job,confirmation.force):await prioritizeAnalysis(job,confirmation?.id,confirmation?.force);
      if(revision===generation.current){setConfirming(null);onUpdated(next);}
    }catch(error){if(revision===generation.current){setError(t(queueError(error)));setConfirming(null);}}
    finally{if(revision===generation.current)setBusy(false);}
  }
  if(job.status!=="queued"&&job.status!=="running")return null;
  const stopping=(force:boolean|undefined)=>t(force?
    "분석 전용 프로세스를 종료하고 있습니다. 종료 확인 후 다음 작업을 시작합니다.":
    "중단 처리 중입니다. 현재 계산이 반환될 때까지 기다린 뒤 다음 작업을 시작합니다. 즉시 중단되지 않을 수 있습니다.");
  const canPrioritize=!!queue?.workerAvailable&&!busy;
  const target=confirming?.own?job:blocker;
  const validConfirmation=!!(confirming&&target?.id===confirming.id&&!busy&&
    (confirming.own?job.status==="running":job.status==="queued"&&canPrioritize)&&
    (confirming.force?target.canForceCancel&&!target.forceCancelRequested:!target.cancelRequested));
  return <section className="analysis-queue" aria-label={t("분석 대기열")}>
    {job.status==="running"?<>
      {job.cancelRequested&&<p className="info-box" role="status">{stopping(job.forceCancelRequested)}</p>}
      <div className="analysis-queue-actions">
        {showCancel&&!job.cancelRequested&&<button disabled={busy} onClick={()=>setConfirming({id:job.id,name:t("현재 분석"),force:false,own:true})}>{t("작업 취소")}</button>}
        {job.canForceCancel&&<button disabled={busy||job.forceCancelRequested} onClick={()=>setConfirming({id:job.id,name:t("현재 분석"),force:true,own:true})}>{t("분석 강제 종료")}</button>}
      </div>
    </>:!queue?<p className="inline-status">{t("대기 순서를 확인하고 있습니다.")}</p>:<>
      <strong>{t("대기 순서 {position} / {count}",{position:queue.position,count:queue.waitingCount})}</strong>
      {!queue.workerAvailable?<p role="alert">{t("분석 실행기가 준비되지 않아 대기 중입니다.")}</p>:blocker?<>
        <p>{t("앞선 작업이 끝나기를 기다리고 있습니다.")}</p>
        <p className="analysis-queue-blocker"><strong>{blockerName}</strong><span>{Math.round(Math.max(0,Math.min(1,blocker.progress))*100)}% · {t(jobStageLabel(blocker.stage))}</span></p>
        {blocker.cancelRequested&&<p role="status">{stopping(blocker.forceCancelRequested)}</p>}
      </>:<p>{t("앞선 작업은 없습니다. 실행기가 이 작업을 시작하기를 기다리고 있습니다.")}</p>}
      <div className="analysis-queue-actions">
        <button disabled={!canPrioritize||queue.position<=1} onClick={()=>void execute()}>{t("이 작업을 다음으로")}</button>
        {blocker&&<button disabled={!canPrioritize||blocker.cancelRequested} onClick={()=>setConfirming({id:blocker.id,name:blockerName,force:false,own:false})}>{t("현재 작업 중단 후 우선 실행")}</button>}
        {blocker?.canForceCancel&&<button disabled={!canPrioritize||blocker.forceCancelRequested} onClick={()=>setConfirming({id:blocker.id,name:blockerName,force:true,own:false})}>{t("현재 작업 강제 종료 후 우선 실행")}</button>}
      </div>
    </>}
    {confirming&&<div className="analysis-queue-confirm" role="alert">
      <strong>{t(confirming.force?"'{name}' 작업을 강제 종료할까요?":"'{name}' 작업을 중단할까요?",{name:confirming.name})}</strong>
      <p>{t("중단한 작업의 미완료 인식 내용은 최종 결과로 저장되지 않습니다. 원본과 기존에 적용한 자막은 유지됩니다.")}</p>
      <p>{t(confirming.force?
        "이 분석의 전용 실행 프로세스를 종료합니다. 앱과 다른 작업은 유지하며 종료가 확인된 뒤 다음 분석을 시작합니다.":
        "중단을 요청해도 현재 계산이 반환될 때까지 기다려야 합니다. 다음 작업이 즉시 시작되지는 않을 수 있습니다.")}</p>
      {!validConfirmation&&!busy&&<p>{t("대기열이 변경되었습니다. 최신 상태를 확인한 뒤 다시 선택하세요.")}</p>}
      <div className="analysis-queue-actions"><button disabled={busy} onClick={()=>setConfirming(null)}>{t("취소")}</button><button disabled={!validConfirmation} onClick={()=>void execute(confirming)}>{t(confirming.own?(confirming.force?"강제 종료 확인":"작업 취소 확인"):confirming.force?"강제 종료하고 이 작업 우선 실행":"중단하고 이 작업 우선 실행")}</button></div>
    </div>}
    {busy&&<p role="status">{t("작업 변경을 요청하고 있습니다.")}</p>}
    {error&&<p className="error-box" role="alert">{error}</p>}
  </section>;
}
