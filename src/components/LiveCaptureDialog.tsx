import { useEffect, useRef, useState } from "react";
import { Dialog } from "./Dialog";
import { LiveCapture, type CaptureMode } from "../liveCapture";
import { recordingStore, saveBlob, type Recording, type RecordingSource } from "../recordingStore";
import { useI18n } from "../i18n";
import "./live-capture.css";

const sourceNames: Record<RecordingSource, string> = { mix: "합친 소리", microphone: "마이크", system: "시스템 소리" };
export function LiveCaptureDialog({ onClose, onUse }: { onClose: () => void; onUse: (file: File) => void }) {
  const { t } = useI18n();
  const [mode,setMode] = useState<CaptureMode>("microphone"), [device,setDevice] = useState("");
  const [devices,setDevices] = useState<MediaDeviceInfo[]>([]), [sessions,setSessions] = useState<Recording[]>([]);
  const [busy,setBusy] = useState(false), [active,setActive] = useState(false), [elapsed,setElapsed] = useState(0);
  const [error,setError] = useState("");
  const [visibleSessions,setVisibleSessions] = useState(25);
  const capture = useRef<LiveCapture | null>(null), alive = useRef(true);
  const errorText = (value: unknown) => {
    const message = value instanceof Error ? value.message : String(value);
    const prefix = "녹음 저장 실패: ";
    return message.startsWith(prefix) ? t("녹음 저장 실패: {error}", { error: t(message.slice(prefix.length)) }) : t(message);
  };
  const reportError = (value: unknown) => { if (alive.current) setError(errorText(value)); };
  const refresh = () => recordingStore.list().then(rows => { if(alive.current)setSessions(rows); });
  useEffect(() => {
    alive.current=true;
    void refresh().catch(reportError);
    const list=()=>navigator.mediaDevices?.enumerateDevices().then(rows=>{if(alive.current)setDevices(rows.filter(d=>d.kind==="audioinput"));}).catch(()=>{});
    void list(); navigator.mediaDevices?.addEventListener("devicechange",list);
    return ()=>{alive.current=false;navigator.mediaDevices?.removeEventListener("devicechange",list);void capture.current?.stop("창이 닫혀 녹음을 종료했습니다.").catch(()=>{});};
  },[]);
  useEffect(()=>{
    if(!active)return;
    const epoch=Date.now(); const timer=setInterval(()=>setElapsed(Math.floor((Date.now()-epoch)/1000)),500);
    const unload=(e:BeforeUnloadEvent)=>{e.preventDefault(); e.returnValue="";}; window.addEventListener("beforeunload",unload);
    return()=>{clearInterval(timer);window.removeEventListener("beforeunload",unload);};
  },[active]);
  async function stop() {
    setBusy(true);
    try { await capture.current?.stop(); }
    catch(e){reportError(e);}
    finally { if(alive.current){setActive(false);setBusy(false);void refresh().catch(reportError);} }
  }
  async function start() {
    setError("");setBusy(true);setElapsed(0);
    const session=new LiveCapture(message=>{
      if(alive.current){reportError(message);void session.stop(message).catch(reportError).finally(()=>{if(alive.current){setActive(false);setBusy(false);void refresh().catch(reportError);}});}
    });capture.current=session;
    try { await session.start(mode,device); if(alive.current){setActive(true);void refresh().catch(reportError);} }
    catch(e){reportError(e);if(alive.current)void refresh().catch(reportError);}
    finally {if(alive.current)setBusy(false);}
  }
  async function fileAction(row:Recording, source:RecordingSource, use:boolean) {
    setBusy(true);setError("");
    try {const file=await recordingStore.file(row,source);if(alive.current){if(use)onUse(file);else saveBlob(file,file.name);}}
    catch(e){reportError(e);}
    finally {if(alive.current)setBusy(false);}
  }
  return <Dialog title={t("라이브 녹음·복구")} onClose={onClose} closeDisabled={active||busy}>
    <p>{t("마이크와 컴퓨터 소리를 녹음하고, 종료 후 자막 분석에 연결합니다. 원본 트랙도 따로 보관합니다.")}</p>
    <p>{t("녹음은 이 앱에 1초 단위로 저장됩니다. 창이 비정상 종료되면 마지막 조각 일부는 빠질 수 있습니다.")}</p>
    <div className="capture-options"><label>{t("녹음 소스")}<select value={mode} disabled={active||busy} onChange={e=>setMode(e.target.value as CaptureMode)}><option value="microphone">{t("마이크")}</option><option value="system">{t("시스템 소리")}</option><option value="both">{t("마이크 + 시스템 소리")}</option></select></label>
      {mode!=="system"&&<label>{t("입력 장치")}<select value={device} disabled={active||busy} onChange={e=>setDevice(e.target.value)}><option value="">{t("기본 입력 장치")}</option>{devices.map((d,i)=><option key={d.deviceId||i} value={d.deviceId}>{d.label||`${t("입력 장치")} ${i+1}`}</option>)}</select></label>}
    </div>
    {mode!=="microphone"&&<p>{t("공유 창에서 소리 공유를 켜세요. Windows 설치 앱은 컴퓨터 전체 출력 소리를 캡처합니다.")}</p>}
    <p>{t("자동 재생 모니터링은 꺼져 있습니다. 양쪽 소스의 합친 소리는 각각 절반 크기로 섞습니다. 세션당 저장 한도는 2 GiB입니다.")}</p>
    <div className="dialog-actions"><span role="status">{active?`${t("녹음 중")} ${Math.floor(elapsed/60)}:${String(elapsed%60).padStart(2,"0")}`:t("대기")}</span>{active?<button className="primary" disabled={busy} onClick={()=>void stop()}>{t("녹음 종료·저장")}</button>:<button className="primary" disabled={busy||!navigator.mediaDevices||typeof MediaRecorder==="undefined"} onClick={()=>void start()}>{t("녹음 시작")}</button>}</div>
    {error&&<p role="alert">{error}</p>}
    <h3>{t("저장된 녹음")}</h3><p>{t("중단된 녹음도 저장된 조각을 내려받을 수 있습니다. 분석 연결은 새 프로젝트를 시작합니다.")}</p>
    <div className="capture-sessions">{sessions.slice(0,visibleSessions).map(row=><article key={row.id}>
      <strong>{new Date(row.startedAt).toLocaleString()}</strong><span>{(row.bytes/1024/1024).toFixed(1)} MiB · {t(row.status==="stopped"?"저장 완료":capture.current?.recording?.id===row.id&&active?"녹음 중":"복구 가능")}</span>
      {row.error&&<p>{errorText(row.error)}</p>}<div className="capture-files">{row.sources.map(source=><button key={source} disabled={active||busy||row.bytes===0} onClick={()=>void fileAction(row,source,false)}>{t(sourceNames[source])} ↓</button>)}
      <button disabled={active||busy} onClick={()=>saveBlob(new Blob([JSON.stringify(row,null,2)],{type:"application/json"}),`recording-${row.id}.json`)}>{t("녹음 정보 저장")}</button>
      <button disabled={active||busy||row.bytes===0||!row.sources.includes("mix")} onClick={()=>void fileAction(row,"mix",true)}>{t("새 프로젝트로 분석")}</button>
      <button disabled={active||busy} onClick={()=>{if(window.confirm(t("저장된 녹음을 삭제할까요? 내려받은 파일은 유지됩니다."))){setBusy(true);void recordingStore.remove(row.id).then(refresh).catch(reportError).finally(()=>{if(alive.current)setBusy(false);});}}}>{t("삭제")}</button></div>
    </article>)}</div>
    {sessions.length>visibleSessions&&<button onClick={()=>setVisibleSessions(value=>value+25)}>{t("이전 녹음 더 보기")}</button>}
    <div className="dialog-actions"><button disabled={active||busy} onClick={onClose}>{t("닫기")}</button></div>
  </Dialog>;
}
