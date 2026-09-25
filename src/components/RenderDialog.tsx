import { useEffect, useRef, useState } from "react";
import { Dialog } from "./Dialog";
import { useI18n } from "../i18n";
import { buildKeepSpans } from "../cuts";
import { exportSrt, exportNotesCsv, safeFilename, parseProject, type Project } from "../domain";
import { ApiError, download, request, uploadMedia, type MediaInfo } from "../api";
import { renderedProject, type RenderJob } from "../render";
import { assertProjectMedia } from "../mediaIdentity";

export function RenderDialog({project,file,onClose,resumeId}: {project:Project;file:File|null;onClose:()=>void;resumeId?:string}) {
  const {t}=useI18n();
  // An immutable snapshot keeps async render and sidecars on the same revision.
  const [snapshot,setSnapshot]=useState<Project|null>(()=>resumeId ? null : structuredClone(project));
  const [media,setMedia]=useState<(MediaInfo & {hasVideo?:boolean})|null>(null);
  const [loading,setLoading]=useState(false);
  const [track,setTrack]=useState(0);
  const [format,setFormat]=useState("mp4");
  const [frameRate,setFrameRate]=useState("original");
  const [job,setJob]=useState<RenderJob|null>(null);
  const [starting,setStarting]=useState(false);
  const [error,setError]=useState("");
  const mounted=useRef(true);
  const running=starting||job?.status==="queued"||job?.status==="running";
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(()=>{
    if(!resumeId)return;
    let alive=true;setLoading(true);
    void (async()=>{
      try {
        const [restored, saved] = await Promise.all([request<RenderJob>(`/api/renders/${resumeId}`), request<{project:unknown}>(`/api/renders/${resumeId}/snapshot`)]);
        if(!alive)return;
        setJob(restored);
        if(saved.project) setSnapshot(parseProject(JSON.stringify(saved.project)));
        else setError(t("이전 작업에 자막 스냅샷이 없습니다. 미디어만 저장할 수 있습니다."));
      }catch(e){if(alive)setError((e as Error).message);}
      finally{if(alive)setLoading(false);}
    })();
    return()=>{alive=false;};
  },[resumeId]);
  useEffect(()=>{
    if(!file||resumeId)return;
    let alive=true;setLoading(true);
    uploadMedia(file).then(info=>{if(alive){assertProjectMedia(project,info);setMedia(info);setTrack(info.audioTracks[0]?.index??0);setFormat((info as {hasVideo?:boolean}).hasVideo?"mp4":"wav");}})
      .catch(e=>{if(alive)setError((e as Error).message);}).finally(()=>{if(alive)setLoading(false);});
    return()=>{alive=false;};
  },[file,resumeId]);
  useEffect(()=>{
    if(!job?.id||!running||starting)return;
    let alive=true;let timer:number;
    const poll=async()=>{
      try{const next=await request<RenderJob>(`/api/renders/${job.id}`);if(alive){setJob(next);setError("");}}
      catch(e){if(alive){setError((e as Error).message);if(e instanceof ApiError&&e.status===404)setJob(current=>current?{...current,status:"failed",stage:"interrupted",error:t("이전 작업을 찾을 수 없습니다. 새 내보내기를 시작하세요.")}:current);}}
      finally{if(alive)timer=window.setTimeout(poll,1000);}
    };
    timer=window.setTimeout(poll,300);
    return()=>{alive=false;clearTimeout(timer);};
  },[job?.id,running,starting]);
  async function start(){
    if(!media||running||!snapshot)return;
    if(Math.abs(media.duration-snapshot.duration)>0.15){setError(t("원본 길이가 프로젝트와 다릅니다. 같은 원본 파일을 연결하세요."));return;}
    setStarting(true);setError("");
    try{
      assertProjectMedia(snapshot,media);
      const {id}=await request<{id:string}>("/api/renders",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({mediaId:media.id,audioTrack:track,format,frameRate,projectId:snapshot.id,projectName:snapshot.name,projectSnapshot:snapshot,keepRanges:buildKeepSpans(snapshot.cuts??[],snapshot.duration).map(s=>({start:s.sourceStart,end:s.sourceEnd}))})});
      if(mounted.current)setJob({id,status:"queued",stage:"queued",progress:0});
    }catch(e){setError((e as Error).message);}finally{setStarting(false);}
  }
  async function cancel(){if(!job)return;try{setJob(await request<RenderJob>(`/api/renders/${job.id}`,{method:"DELETE"}));}catch(e){setError((e as Error).message);if(e instanceof ApiError&&e.status===404)setJob(current=>current?{...current,status:"failed",stage:"interrupted"}:current);}}
  const result=job?.status==="completed"?job.result:undefined;
  const statusNames={queued:"렌더 대기 중",running:"렌더링 중",completed:"렌더 완료",failed:"렌더 실패",cancelled:"렌더 취소"};
  let derived:ReturnType<typeof renderedProject>|null=null;
  let mappingError="";
  if(result&&snapshot){try{derived=renderedProject(snapshot,result.keepRanges);}catch(e){mappingError=(e as Error).message;}}
  function sidecar(kind:"srt"|"csv"){
    if(!derived||!snapshot)return;
    try{
      const p=derived.project;
      if(kind==="srt"){
        if(derived.issues.length)throw new Error(t("컷 경계에 걸린 자막을 먼저 수정하세요."));
        download(`${safeFilename(snapshot.name)}-edited.srt`,exportSrt(p),"application/x-subrip;charset=utf-8");
      }else download(`${safeFilename(snapshot.name)}-edited-notes.csv`,exportNotesCsv(p),"text/csv;charset=utf-8");
      setError("");
    }catch(e){setError((e as Error).message);}
  }
  return <Dialog title={t("편집본 내보내기")} onClose={onClose} closeDisabled={starting}>
    <p className="dialog-intro">{t("제외 구간을 제거한 새 미디어를 만듭니다. 원본은 보존됩니다.")}</p>
    {!file&&!resumeId&&<p role="alert">{t("먼저 원본 미디어를 다시 연결하세요.")}</p>}
    {loading&&<p role="status">{t("로컬 미디어 준비 중…")}</p>}
    {!resumeId&&<div className="form-grid">
      <label>{t("오디오 트랙")}<select value={track} disabled={!media||running} onChange={e=>setTrack(Number(e.target.value))}>{media?.audioTracks.map(s=><option key={s.index} value={s.index}>{s.label}</option>)}</select></label>
      <label>{t("파일 형식")}<select value={format} disabled={running} onChange={e=>setFormat(e.target.value)}>
        {media?.hasVideo&&<option value="mp4">MP4 · H.264</option>}
        <option value="wav">WAV</option><option value="mp3">MP3</option><option value="m4a">M4A</option>
      </select></label>
      {format==="mp4"&&<label>{t("출력 프레임률")}<select value={frameRate} disabled={running} onChange={e=>setFrameRate(e.target.value)}>
        <option value="original">{t("원본 프레임률")}{media?.frameRate ? ` (${media.frameRate.toFixed(3)} fps)` : ""}</option><option value="30">30 fps</option><option value="60">60 fps</option>
      </select></label>}
    </div>}
    {format==="mp4"&&!resumeId&&<p className="muted">{t("원본 프레임률도 일정한 프레임률로 변환합니다. 가변 프레임 간격은 보존하지 않습니다.")}</p>}
    <p className="muted">{t("선택한 오디오 트랙 하나를 내보냅니다. 브라우저 미리보기와 다른 트랙일 수 있습니다.")}</p>
    {job&&<div role="status"><progress value={job.progress} max={1}/><span>{t(statusNames[job.status])} · {Math.round(job.progress*100)}%</span></div>}
    {running&&<p className="info-box">{t("창을 닫아도 작업은 계속됩니다. 작업 이력에서 다시 열 수 있습니다.")}</p>}
    {(error||job?.error||mappingError)&&<p className="inline-error" role="alert">{error||job?.error||mappingError}</p>}
    {result&&<div className="export-section">
      <a className="button primary" href={result.url} download={result.filename}>{t("편집한 미디어 저장")}</a>
      <p>{t("아래 자막·메모는 실제 출력 파일의 컷 경계에 맞춘 시간입니다.")}</p>
      <div className="dialog-actions"><button disabled={!derived||!!derived.issues.length} onClick={()=>sidecar("srt")}>{t("편집본 SRT 저장")}</button><button disabled={!derived} onClick={()=>sidecar("csv")}>{t("편집본 메모 CSV 저장")}</button></div>
      {!!derived?.issues.length&&<p role="alert">{t("자막 {count}개가 컷 경계에 걸립니다. 원문·시간을 조정해야 편집본 SRT를 내보낼 수 있습니다.",{count:derived.issues.length})} ({derived.issues.map(i=>(snapshot?.captions.findIndex(c=>c.id===i.captionId)??-1)+1).join(", ")})</p>}
      {!!derived?.omittedNoteIds.length&&<p>{t("삭제 구간의 메모 {count}개가 편집본에서 제외됩니다.",{count:derived.omittedNoteIds.length})}</p>}
      {result.warnings.map((w,i)=><p key={i} className="muted">{w}</p>)}
    </div>}
    <div className="dialog-actions">
      {running&&job&&<button onClick={cancel}>{t("작업 취소")}</button>}
      <button onClick={onClose} disabled={starting}>{t("닫기")}</button>
      {!resumeId&&<button className="primary" disabled={!media||loading||running} onClick={start}>{t("편집본 만들기")}</button>}
    </div>
  </Dialog>;
}
