import { useEffect, useRef, useState } from "react";
import type { Job } from "../api";
import { useI18n } from "../i18n";
import { prioritizeAnalysis, queueError } from "../jobQueue";
import { jobStageLabel } from "../jobStage";
import "./analysis-queue.css";

export function AnalysisQueueControls({job,onUpdated}:{job:Job;onUpdated:(job:Job)=>void}){
  const {t}=useI18n();const [busy,setBusy]=useState(false),[error,setError]=useState("");
  const [confirming,setConfirming]=useState<{id:string;name:string}|null>(null);
  const generation=useRef(0);
  useEffect(()=>{generation.current++;setBusy(false);setError("");setConfirming(null);return()=>{generation.current++;};},[job.id]);
  const queue=job.queue,blocker=queue?.blockingJob;
  const blockerName=blocker?[blocker.projectName,blocker.mediaName].filter(Boolean).join(" · ")||blocker.id:"";
  async function prioritize(expected?:string){
    const revision=generation.current;setBusy(true);setError("");
    try{const next=await prioritizeAnalysis(job,expected);if(revision===generation.current){setConfirming(null);onUpdated(next);}}
    catch(error){if(revision===generation.current){setError(t(queueError(error)));setConfirming(null);}}
    finally{if(revision===generation.current)setBusy(false);}
  }
  if(job.cancelRequested)return <p className="info-box" role="status">{t("중단 처리 중입니다. 현재 계산이 반환될 때까지 기다린 뒤 다음 작업을 시작합니다. 즉시 중단되지 않을 수 있습니다.")}</p>;
  if(job.status!=="queued")return null;
  if(!queue)return <p className="inline-status">{t("대기 순서를 확인하고 있습니다.")}</p>;
  const canPrioritize=queue.workerAvailable&&!busy;
  const validConfirmation=!!(confirming&&blocker?.id===confirming.id&&!blocker.cancelRequested&&canPrioritize);
  return <section className="analysis-queue" aria-label={t("분석 대기열")}>
    <strong>{t("대기 순서 {position} / {count}",{position:queue.position,count:queue.waitingCount})}</strong>
    {!queue.workerAvailable?<p role="alert">{t("분석 실행기가 준비되지 않아 대기 중입니다.")}</p>:blocker?<>
      <p>{t("앞선 작업이 끝나기를 기다리고 있습니다.")}</p>
      <p className="analysis-queue-blocker"><strong>{blockerName}</strong><span>{Math.round(Math.max(0,Math.min(1,blocker.progress))*100)}% · {t(jobStageLabel(blocker.stage))}</span></p>
      {blocker.cancelRequested&&<p role="status">{t("중단 처리 중입니다. 현재 계산이 반환될 때까지 기다린 뒤 다음 작업을 시작합니다. 즉시 중단되지 않을 수 있습니다.")}</p>}
    </>:<p>{t("앞선 작업은 없습니다. 실행기가 이 작업을 시작하기를 기다리고 있습니다.")}</p>}
    <div className="analysis-queue-actions">
      <button disabled={!canPrioritize||queue.position<=1} onClick={()=>void prioritize()}>{t("이 작업을 다음으로")}</button>
      {blocker&&<button disabled={!canPrioritize||blocker.cancelRequested} onClick={()=>setConfirming({id:blocker.id,name:blockerName})}>{t("현재 작업 중단 후 우선 실행")}</button>}
    </div>
    {confirming&&<div className="analysis-queue-confirm" role="alert">
      <strong>{t("'{name}' 작업을 중단할까요?",{name:confirming.name})}</strong>
      <p>{t("중단한 작업의 미완료 인식 내용은 최종 결과로 저장되지 않습니다. 원본과 기존에 적용한 자막은 유지됩니다.")}</p>
      <p>{t("중단을 요청해도 현재 계산이 반환될 때까지 기다려야 합니다. 다음 작업이 즉시 시작되지는 않을 수 있습니다.")}</p>
      {!validConfirmation&&!busy&&<p>{t("대기열이 변경되었습니다. 최신 상태를 확인한 뒤 다시 선택하세요.")}</p>}
      <div className="analysis-queue-actions"><button disabled={busy} onClick={()=>setConfirming(null)}>{t("취소")}</button><button disabled={!validConfirmation} onClick={()=>void prioritize(confirming.id)}>{t("중단하고 이 작업 우선 실행")}</button></div>
    </div>}
    {busy&&<p role="status">{t("실행 순서를 변경하고 있습니다.")}</p>}
    {error&&<p className="error-box" role="alert">{error}</p>}
  </section>;
}
