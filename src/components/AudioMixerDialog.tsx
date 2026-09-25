import { useEffect, useRef, useState } from "react";
import { Dialog } from "./Dialog";
import { ApiError, download, request, uploadMedia, type MediaInfo } from "../api";
import { emptyAudioMix, MAX_MIX_TRACKS, mixRequest, parseAudioMix, relinkMix, type AudioMixPlan, type AudioMixTrack } from "../audioMixer";
import { buildKeepSpans } from "../cuts";
import { exportSrt, exportNotesCsv, safeFilename, type Project } from "../domain";
import { renderedProject, type RenderJob } from "../render";
import { useI18n } from "../i18n";
import "./audio-mixer.css";

type MixJob=RenderJob & {request?:ReturnType<typeof mixRequest>};
type MixHistory={id:string;status:RenderJob["status"];createdAt:string;format:string;tracks:number};
export function AudioMixerDialog({project,file,onSave,onClose}:{project:Project;file:File|null;onSave:(plan:AudioMixPlan)=>void;onClose:()=>void}) {
  const {t}=useI18n();
  const [plan,setPlan]=useState<AudioMixPlan>(()=>structuredClone(project.audioMix??emptyAudioMix()));
  const [sources,setSources]=useState<Record<string,MediaInfo>>({});
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [saved,setSaved]=useState(false);
  const [job,setJob]=useState<MixJob|null>(null);
  const [snapshot,setSnapshot]=useState<Project|null>(null);
  const [history,setHistory]=useState<MixHistory[]>([]);
  const alive=useRef(true);
  const input=useRef<HTMLInputElement>(null),relinkInput=useRef<HTMLInputElement>(null),relinkId=useRef<string|null>(null);
  const running=job?.status==="queued"||job?.status==="running";
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  async function refreshHistory(){try{const result=await request<{jobs:MixHistory[]}>("/api/audio-mixes");if(alive.current)setHistory(result.jobs);}catch(e){if(alive.current)setError((e as Error).message);}}
  useEffect(()=>{
    void refreshHistory();
    let active=true;
    for(const id of new Set(plan.tracks.map(track=>track.mediaId))) {
      void request<MediaInfo>(`/api/media/${id}`).then(info=>{if(active)setSources(current=>({...current,[id]:info}));}).catch(()=>{});
    }
    return()=>{active=false;};
  },[]);
  useEffect(()=>{
    if(!job||!running)return;
    let active=true;let timer:number;
    const poll=async()=>{
      try{const next=await request<MixJob>(`/api/audio-mixes/${job.id}`);if(active){setJob(next);setError("");if(!["queued","running"].includes(next.status))void refreshHistory();}}
      catch(e){if(active){setError((e as Error).message);if(e instanceof ApiError&&e.status===404)setJob(current=>current?{...current,status:"failed",error:t("이전 작업을 찾을 수 없습니다. 새 내보내기를 시작하세요.")}:current);}}
      finally{if(active)timer=window.setTimeout(poll,1000);}
    };timer=window.setTimeout(poll,250);
    return()=>{active=false;window.clearTimeout(timer);};
  },[job?.id,running]);
  function change(next:AudioMixPlan){setPlan(next);setSaved(false);}
  function trackChange(id:string,changes:Partial<AudioMixTrack>){change({...plan,tracks:plan.tracks.map(track=>track.id===id?{...track,...changes}:track)});}
  async function addFiles(files:File[]){
    if(!files.length||busy)return;setBusy(true);setError("");
    let next=structuredClone(plan);
    try{
      for(const item of files){
        if(next.tracks.length>=MAX_MIX_TRACKS)throw new Error(t("최대 16개 트랙을 사용할 수 있습니다."));
        const info=await uploadMedia(item);
        if(!alive.current)return;
        if(!info.sha256)throw new Error(t("원본 해시가 없습니다. 파일을 다시 추가하세요."));
        setSources(current=>({...current,[info.id]:info}));
        next={...next,tracks:[...next.tracks,{id:crypto.randomUUID(),mediaId:info.id,name:info.name,sha256:info.sha256,audioTrack:info.audioTracks[0].index,gainDb:0,offsetSeconds:0,muted:false}]};
        change(next);
      }
    }catch(e){if(alive.current)setError((e as Error).message);}finally{if(alive.current)setBusy(false);}
  }
  async function reconnect(file:File){
    const id=relinkId.current;if(!id)return;setBusy(true);setError("");
    try{const media=await uploadMedia(file);if(alive.current){change(relinkMix(plan,id,media));setSources(current=>({...current,[media.id]:media}));}}
    catch(e){if(alive.current)setError((e as Error).message);}finally{if(alive.current)setBusy(false);relinkId.current=null;}
  }
  async function start(){
    if(busy||running)return;setBusy(true);setError("");
    try{
      // Recheck cache identity before starting; never omit a missing/muted source.
      for(const track of plan.tracks){
        const media=await request<MediaInfo>(`/api/media/${track.mediaId}`);
        if(media.sha256!==track.sha256)throw new Error(t("같은 원본 파일을 다시 연결하세요."));
      }
      const source=structuredClone(project);
      const payload=mixRequest(plan,source.duration,buildKeepSpans(source.cuts??[],source.duration).map(s=>({start:s.sourceStart,end:s.sourceEnd})));
      const result=await request<{id:string}>("/api/audio-mixes",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
      if(alive.current){onSave(structuredClone(plan));setSaved(true);setSnapshot(plan.applyCuts?source:null);setJob({id:result.id,status:"queued",stage:"queued",progress:0});void refreshHistory();}
    }catch(e){if(alive.current)setError((e as Error).message);}finally{if(alive.current)setBusy(false);}
  }
  async function cancel(){if(!job)return;try{setJob(await request<MixJob>(`/api/audio-mixes/${job.id}`,{method:"DELETE"}));}catch(e){setError((e as Error).message);}}
  async function openHistory(id:string){try{setJob(await request<MixJob>(`/api/audio-mixes/${id}`));setSnapshot(null);setError("");}catch(e){setError((e as Error).message);}}
  async function removeHistory(id:string){try{await request(`/api/audio-mixes/${id}/history`,{method:"DELETE"});if(job?.id===id){setJob(null);setSnapshot(null);}void refreshHistory();}catch(e){setError((e as Error).message);}}
  const result=job?.status==="completed"?job.result:undefined;
  let derived:ReturnType<typeof renderedProject>|null=null;
  if(result&&snapshot){try{derived=renderedProject(snapshot,result.keepRanges);}catch{/* no misleading sidecars when mapping cannot be verified */}}
  function sidecar(kind:"srt"|"csv"){
    if(!derived||!snapshot)return;
    try{download(`${safeFilename(snapshot.name)}-mixed.${kind}`,kind==="srt"?exportSrt(derived.project):exportNotesCsv(derived.project),kind==="srt"?"application/x-subrip;charset=utf-8":"text/csv;charset=utf-8");}
    catch(e){setError((e as Error).message);}
  }
  const status={queued:"렌더 대기 중",running:"렌더링 중",completed:"렌더 완료",failed:"렌더 실패",cancelled:"렌더 취소"};
  return <Dialog title={t("오디오 믹서")} onClose={onClose} closeDisabled={busy}>
    <p className="dialog-intro">{t("여러 파일 또는 OBS 트랙을 합쳐 새 파일로 저장합니다. 원본과 자막은 바뀌지 않습니다.")}</p>
    <input ref={input} type="file" hidden multiple accept="audio/*,video/*,.mkv,.m4a,.flac,.opus" onChange={e=>{void addFiles(Array.from(e.target.files??[]));e.target.value="";}}/>
    <input ref={relinkInput} type="file" hidden accept="audio/*,video/*,.mkv,.m4a,.flac,.opus" onChange={e=>{const f=e.target.files?.[0];if(f)void reconnect(f);e.target.value="";}}/>
    <div className="dialog-actions"><button disabled={busy||running||plan.tracks.length>=MAX_MIX_TRACKS} onClick={()=>input.current?.click()}>{t("파일 추가")}</button><button disabled={busy||running||!file||plan.tracks.length>=MAX_MIX_TRACKS} onClick={()=>file&&void addFiles([file])}>{t("현재 원본 추가")}</button></div>
    <div className="audio-mix-tracks">
      {plan.tracks.map((track,i)=>{
        const media=sources[track.mediaId],present=media?.sha256===track.sha256;
        return <fieldset key={track.id} disabled={busy||running} className="audio-mix-track">
          <legend>{i+1}. {track.name}</legend>
          {!present&&<div role="status" className="audio-mix-reconnect"><span>{t("원본 확인 또는 재연결이 필요합니다.")}</span><button onClick={()=>{relinkId.current=track.mediaId;relinkInput.current?.click();}}>{t("원본 다시 연결")}</button></div>}
          <div className="audio-mix-controls">
            <label>{t("오디오 트랙")}<select value={track.audioTrack} onChange={e=>trackChange(track.id,{audioTrack:Number(e.target.value)})}>{media?media.audioTracks.map(s=><option key={s.index} value={s.index}>{s.label}</option>):<option value={track.audioTrack}>#{track.audioTrack}</option>}</select></label>
            <label>{t("음량 (dB)")}<input type="number" min={-60} max={12} step={1} value={track.gainDb} onChange={e=>trackChange(track.id,{gainDb:e.target.valueAsNumber})}/></label>
            <label>{t("시간 이동 (초)")}<input type="number" min={-604800} max={604800} step={.01} value={track.offsetSeconds} onChange={e=>trackChange(track.id,{offsetSeconds:e.target.valueAsNumber})}/></label>
          </div>
          <div className="audio-mix-row"><label><input type="checkbox" checked={track.muted} onChange={e=>trackChange(track.id,{muted:e.target.checked})}/>{t("음소거")}</label><button disabled={plan.tracks.length>=MAX_MIX_TRACKS} onClick={()=>change({...plan,tracks:[...plan.tracks,{...track,id:crypto.randomUUID()}]})}>{t("같은 파일의 트랙 추가")}</button><button onClick={()=>{const tracks=plan.tracks.filter(item=>item.id!==track.id);change({...plan,tracks,videoMediaId:tracks.some(item=>item.mediaId===plan.videoMediaId)?plan.videoMediaId:null});}}>{t("삭제")}</button></div>
        </fieldset>;
      })}
    </div>
    <p className="muted">{t("양수는 늦게 시작하고 음수는 앞부분을 잘라냅니다. 시간 이동은 자막을 자동으로 옮기지 않습니다.")}</p>
    <fieldset className="audio-mix-options" disabled={busy||running}>
      <label><input type="checkbox" checked={plan.limiter} onChange={e=>change({...plan,limiter:e.target.checked})}/>{t("피크 리미터로 클리핑 방지")}</label>
      <label><input type="checkbox" checked={plan.applyCuts} onChange={e=>change({...plan,applyCuts:e.target.checked})}/>{t("현재 프로젝트 길이와 컷 구간 적용")}</label>
      <p className="muted">{t("프로젝트 컷을 적용하면 프로젝트 길이 밖의 소리는 제외됩니다. 끄면 가장 늦게 끝나는 트랙까지 저장합니다.")}</p>
      <div className="form-grid"><label>{t("파일 형식")}<select value={plan.format} onChange={e=>change({...plan,format:e.target.value as AudioMixPlan["format"]})}><option value="wav">WAV</option><option value="mp3">MP3</option><option value="m4a">M4A</option><option value="mp4">MP4 · H.264</option></select></label>
        {plan.format==="mp4"&&<><label>{t("영상 원본")}<select value={plan.videoMediaId??""} onChange={e=>change({...plan,videoMediaId:e.target.value||null})}><option value="">{t("선택")}</option>{Object.values(sources).filter(s=>s.hasVideo&&plan.tracks.some(track=>track.mediaId===s.id)).map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label><label>{t("출력 프레임률")}<select value={plan.frameRate} onChange={e=>change({...plan,frameRate:e.target.value as AudioMixPlan["frameRate"]})}><option value="original">{t("원본 프레임률")}</option><option value="30">30 fps</option><option value="60">60 fps</option></select></label></>}
      </div>
    </fieldset>
    {job&&<div role="status"><progress max={1} value={job.progress}/>{t(status[job.status])} · {Math.round(job.progress*100)}%</div>}
    {running&&<p className="info-box">{t("창을 닫아도 믹싱은 계속됩니다. 믹서 작업 이력에서 다시 열 수 있습니다.")}</p>}
    {(error||job?.error)&&<p role="alert" className="inline-error">{error||job?.error}</p>}
    {result&&<div className="export-section"><a className="button primary" href={result.url} download={result.filename}>{t("믹싱한 파일 저장")}</a><audio controls preload="none" src={result.url}/>
      {derived&&<div className="dialog-actions"><button disabled={!!derived.issues.length} onClick={()=>sidecar("srt")}>{t("편집본 SRT 저장")}</button><button onClick={()=>sidecar("csv")}>{t("편집본 메모 CSV 저장")}</button></div>}
      {!!derived?.issues.length&&<p>{t("컷 경계에 걸린 자막을 먼저 수정하세요.")}</p>}
      {result.warnings.map((warning,i)=><p key={i} className="muted">{warning}</p>)}
    </div>}
    <details><summary>{t("믹서 작업 이력")} ({history.length})</summary><div className="audio-mix-history">{history.map(item=><div key={item.id}><span>{new Date(item.createdAt).toLocaleString()} · {item.format.toUpperCase()} · {t(status[item.status])}</span><button disabled={busy||!!running} onClick={()=>void openHistory(item.id)}>{t("열기")}</button><button disabled={busy||["queued","running"].includes(item.status)} onClick={()=>void removeHistory(item.id)}>{t("이력 및 출력 삭제")}</button></div>)}</div></details>
    {saved&&<p role="status">{t("믹서 설정을 프로젝트에 저장했습니다.")}</p>}
    <div className="dialog-actions">{running&&<button onClick={()=>void cancel()}>{t("작업 취소")}</button>}<button disabled={busy||!!running} onClick={()=>{try{onSave(parseAudioMix(plan));setSaved(true);}catch(e){setError((e as Error).message);}}}>{t("설정 저장")}</button><button disabled={busy} onClick={onClose}>{t("닫기")}</button><button className="primary" disabled={busy||!!running||!plan.tracks.length} onClick={()=>void start()}>{t("믹싱 시작")}</button></div>
  </Dialog>;
}
