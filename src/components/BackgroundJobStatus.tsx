import { useState } from "react";
import { Activity, X } from "lucide-react";
import { download, uploadMedia, type AnalysisResult } from "../api";
import { backgroundJobRunning, sameBackgroundSource, type BackgroundJobSnapshot } from "../backgroundJob";
import type { Project } from "../domain";
import { useI18n } from "../i18n";
import { Dialog } from "./Dialog";
import { RecognitionPreview } from "./RecognitionPreview";
import { AnalysisQueueControls } from "./AnalysisQueueControls";
import { jobStageLabel } from "../jobStage";
import "./background-job.css";

const labels={queued:"분석 대기",running:"분석 중",completed:"분석 완료",failed:"분석 실패",cancelled:"분석 취소됨"};
export function BackgroundJobStatus({snapshot,onOpen,onDismiss}:{snapshot:BackgroundJobSnapshot;onOpen:()=>void;onDismiss:()=>void}){
  const {t}=useI18n();const {pointer,job,paused}=snapshot;if(!pointer)return null;
  const progress=job?Math.round(Math.max(0,Math.min(1,job.progress))*100):0;
  return <span className="background-job-status">
    <button className="background-job-pill" onClick={onOpen} title={`${pointer.projectName||pointer.mediaName} · ${job?.stage??""}`} aria-label={t("분석 작업 다시 열기")}>
      <Activity size={14} aria-hidden="true"/><strong>{paused?t("상태 확인 멈춤"):job?t(labels[job.status]):t("분석 상태 확인 중")}</strong>
      {job&&backgroundJobRunning(job)&&<span>{progress}% · {t(jobStageLabel(job.stage))}</span>}
      {!backgroundJobRunning(job)&&job&&<span>{t("결과 확인")}</span>}
    </button>
    {(job&&!backgroundJobRunning(job)||snapshot.missing)&&<button className="background-job-dismiss" aria-label={t("분석 상태 표시 닫기")} title={t("작업 기록은 유지됩니다.")} onClick={onDismiss}><X size={12}/></button>}
  </span>;
}
export function BackgroundJobDialog({snapshot,project,file,onClose,onApply,onRetry}:{snapshot:BackgroundJobSnapshot;project:Project;file:File|null;onClose:()=>void;onApply:(result:AnalysisResult)=>void;onRetry:()=>void}){
  const {t}=useI18n();const [verifying,setVerifying]=useState(false),[error,setError]=useState("");
  const [verified,setVerified]=useState<{file:File;mediaId:string;projectId:string;jobId:string}|null>(null);
  const {pointer,job}=snapshot;if(!pointer)return null;
  const canApply=!!(job?.status==="completed"&&job.result&&file&&verified?.file===file&&verified.jobId===pointer.id&&verified.projectId===project.id&&sameBackgroundSource(pointer,project.id,verified.mediaId));
  async function verify(){
    if(!file||!pointer)return;setVerifying(true);setError("");setVerified(null);
    try {const media=await uploadMedia(file);if(!sameBackgroundSource(pointer,project.id,media.id))throw new Error("현재 연결된 원본이 이 분석 작업의 원본과 다릅니다.");setVerified({file,mediaId:media.id,projectId:project.id,jobId:pointer.id});}
    catch(error){setError(error instanceof Error?error.message:String(error));}
    finally{setVerifying(false);}
  }
  return <Dialog title={t("분석 작업 상태")} onClose={onClose} closeDisabled={verifying}>
    <p>{pointer.projectName} · {pointer.mediaName}</p>
    <p>{t("창을 닫아도 작업과 결과는 유지됩니다. 하단 분석 상태를 눌러 다시 열 수 있습니다.")}</p>
    {snapshot.paused&&<p role="alert">{snapshot.missing?t("이 작업을 서버에서 찾을 수 없습니다. 작업 이력을 확인하세요."):t("서버 연결을 확인하지 못해 자동 조회를 멈췄습니다. 연결 후 다시 확인하세요.")}</p>}
    {snapshot.paused&&<button onClick={onRetry}>{t("상태 다시 확인")}</button>}
    {job&&<section className="analysis-job">
      <strong>{t(labels[job.status])} · {Math.round(job.progress*100)}%</strong><progress value={job.progress} max={1}/><p>{t(jobStageLabel(job.stage))}</p>
      <RecognitionPreview job={job}/>{job.error&&<p className="error-box">{job.error}</p>}
      <AnalysisQueueControls key={job.id} job={job} onUpdated={onRetry}/>
      {job.result?.warnings.map((warning,index)=><p key={index} className="info-box">{warning}</p>)}
      {job.result&&<>
        <p>{t("자막 {captions}개 · 감지된 인물 {speakers}명",{captions:job.result.captions.length,speakers:job.result.speakers.length})}</p>
        <button onClick={()=>download(`analysis-${job.id}.json`,JSON.stringify(job.result,null,2),"application/json;charset=utf-8")}>{t("분석 결과 JSON 저장")}</button>
        <p>{t("같은 프로젝트와 원본 파일이 연결된 경우에만 결과를 적용할 수 있습니다.")}</p>
        {(!file||pointer.projectId!==project.id)&&<p>{t("이 작업의 프로젝트와 원본 미디어를 먼저 다시 연결하세요. 파일 없이도 진행 상태와 결과 JSON은 확인할 수 있습니다.")}</p>}
        <button disabled={verifying||!file||pointer.projectId!==project.id||canApply} onClick={()=>void verify()}>{verifying?t("원본 확인 중…"):canApply?t("원본 확인 완료"):t("연결된 원본 확인")}</button>
        <p>{t("적용하면 기존 자막이 교체됩니다. 노트는 유지됩니다.")}</p>
        <button className="primary" disabled={!canApply||verifying} onClick={()=>{if(canApply&&job.result)onApply(job.result);}}>{t("결과 적용")}</button>
      </>}
    </section>}
    {error&&<p role="alert" className="error-box">{t(error)}</p>}
    <div className="dialog-actions"><button disabled={verifying} onClick={onClose}>{t("창 닫고 계속 작업")}</button></div>
  </Dialog>;
}
