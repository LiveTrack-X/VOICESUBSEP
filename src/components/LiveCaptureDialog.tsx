import { useEffect, useRef, useState } from "react";
import { Dialog } from "./Dialog";
import { LiveCapture, type CaptureMode } from "../liveCapture";
import { recordingStore, saveBlob, type Recording, type RecordingSource } from "../recordingStore";
import { useI18n } from "../i18n";
import { emptyMicrophones, MicrophoneDiscovery, selectedMicrophoneMissing } from "../microphoneDevices";
import "./live-capture.css";

const sourceNames: Record<RecordingSource, string> = { mix: "합친 소리", microphone: "마이크", system: "시스템 소리" };
export function LiveCaptureDialog({ onClose, onUse }: { onClose: () => void; onUse: (file: File) => void }) {
  const { t } = useI18n();
  const [mode,setMode] = useState<CaptureMode>("microphone"), [device,setDevice] = useState("");
  const [microphones,setMicrophones] = useState(emptyMicrophones), [sessions,setSessions] = useState<Recording[]>([]);
  const [deviceBusy,setDeviceBusy] = useState(false), [selectedLabel,setSelectedLabel] = useState("");
  const [busy,setBusy] = useState(false), [active,setActive] = useState(false), [elapsed,setElapsed] = useState(0);
  const [error,setError] = useState("");
  const [visibleSessions,setVisibleSessions] = useState(25);
  const capture = useRef<LiveCapture | null>(null), alive = useRef(true);
  const discovery = useRef<MicrophoneDiscovery | null>(null);
  const missingDevice = mode !== "system" && selectedMicrophoneMissing(microphones, device);
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
    const instance=new MicrophoneDiscovery(navigator.mediaDevices, rows=>{if(alive.current)setMicrophones(rows);}); discovery.current=instance;
    const list=()=>instance.refresh().catch(reportError);
    void list(); navigator.mediaDevices?.addEventListener("devicechange",list);
    return ()=>{alive.current=false;instance.dispose();navigator.mediaDevices?.removeEventListener("devicechange",list);void capture.current?.stop("창이 닫혀 녹음을 종료했습니다.").catch(()=>{});};
  },[]);
  useEffect(()=>{
    if(!active)return;
    const epoch=Date.now(); const timer=setInterval(()=>setElapsed(Math.floor((Date.now()-epoch)/1000)),500);
    const unload=(e:BeforeUnloadEvent)=>{e.preventDefault(); e.returnValue="";}; window.addEventListener("beforeunload",unload);
    return()=>{clearInterval(timer);window.removeEventListener("beforeunload",unload);};
  },[active]);
  useEffect(()=>{
    if(active&&missingDevice&&!busy){const message="선택한 마이크가 연결 해제되어 녹음을 중지합니다. 다른 장치로 자동 전환하지 않습니다.";setError(t(message));void stop(message);}
  },[active,missingDevice,busy]);
  async function refreshDevices() {
    if(active||busy||deviceBusy)return;
    setDeviceBusy(true);setError("");
    try {await discovery.current?.refresh(true);}
    catch(error){reportError(error);}
    finally {if(alive.current)setDeviceBusy(false);}
  }
  async function stop(reason="") {
    setBusy(true);
    try { await capture.current?.stop(reason); }
    catch(e){reportError(e);}
    finally { if(alive.current){setActive(false);setBusy(false);void refresh().catch(reportError);} }
  }
  async function start() {
    if(active||busy||deviceBusy||missingDevice)return;
    setError("");setBusy(true);setElapsed(0);
    const session=new LiveCapture(message=>{
      if(alive.current){reportError(message);void session.stop(message).catch(reportError).finally(()=>{if(alive.current){setActive(false);setBusy(false);void refresh().catch(reportError);}});}
    });capture.current=session;
    try { await session.start(mode,device); if(alive.current){setActive(true);void discovery.current?.refresh().catch(reportError);void refresh().catch(reportError);} }
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
    <div className="capture-options"><label>{t("녹음 소스")}<select value={mode} disabled={active||busy||deviceBusy} onChange={e=>setMode(e.target.value as CaptureMode)}><option value="microphone">{t("마이크")}</option><option value="system">{t("시스템 소리")}</option><option value="both">{t("마이크 + 시스템 소리")}</option></select></label>
      {mode!=="system"&&<label>{t("입력 장치")}<select aria-label={t("입력 장치")} value={device} disabled={active||busy||deviceBusy} onChange={e=>{setDevice(e.target.value);setSelectedLabel(microphones.devices.find(d=>d.deviceId===e.target.value)?.label??"");}}><option value="">{t("기본 입력 · 녹음 시작 시 시스템 설정 사용")}{microphones.defaultLabel?` — ${microphones.defaultLabel}`:""}</option>{microphones.devices.map(d=><option key={d.deviceId} value={d.deviceId}>{d.label}</option>)}{device&&!microphones.devices.some(d=>d.deviceId===device)&&<option value={device}>{t("연결 해제된 선택 장치")}: {selectedLabel}</option>}</select></label>}
    </div>
    {mode!=="system"&&<>
      <button type="button" disabled={active||busy||deviceBusy||!navigator.mediaDevices?.getUserMedia} onClick={()=>void refreshDevices()}>{t("마이크 권한 확인·장치 새로고침")}</button>
      <p>{t("장치 이름 확인을 위해 잠깐 마이크 권한을 요청합니다. 이 확인 과정에서는 녹음 파일을 만들지 않으며 확인 후 마이크를 해제합니다.")}</p>
      {deviceBusy&&<p role="status">{t("마이크 권한과 장치 목록을 확인하고 있습니다…")}</p>}
      {microphones.restricted&&<p role="status">{t("마이크 권한이 없으면 장치 이름과 목록이 제한될 수 있습니다. 권한을 확인한 뒤 다시 불러오세요.")}</p>}
      {missingDevice&&<p role="alert">{t("선택한 마이크가 목록에 없습니다. 연결을 확인하거나 다른 장치를 직접 선택하세요. 기본 장치로 자동 전환하지 않습니다.")}</p>}
      <p>{t("목록에서 고른 마이크는 해당 장치로 고정합니다. 녹음 중에는 장치 선택과 권한 확인을 바꿀 수 없습니다.")}</p>
    </>}
    {mode!=="microphone"&&<p>{t("시스템 소리는 공유 기능으로 캡처합니다. 출력 장치별 선택은 지원하지 않으며, 개별 WASAPI 출력 캡처는 별도 기능입니다.")}</p>}
    <p>{t("자동 재생 모니터링은 꺼져 있습니다. 양쪽 소스의 합친 소리는 각각 절반 크기로 섞습니다. 세션당 저장 한도는 2 GiB입니다.")}</p>
    <div className="dialog-actions"><span role="status">{active?`${t("녹음 중")} ${Math.floor(elapsed/60)}:${String(elapsed%60).padStart(2,"0")}`:t("대기")}</span>{active?<button className="primary" disabled={busy} onClick={()=>void stop()}>{t("녹음 종료·저장")}</button>:<button className="primary" disabled={busy||deviceBusy||missingDevice||!navigator.mediaDevices||typeof MediaRecorder==="undefined"} onClick={()=>void start()}>{t("녹음 시작")}</button>}</div>
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
