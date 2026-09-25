import { useEffect, useRef, useState } from "react";
import { Dialog } from "./Dialog";
import { LiveCapture, type CaptureMode } from "../liveCapture";
import { recordingStore, saveBlob, type Recording, type RecordingSource } from "../recordingStore";
import { useI18n } from "../i18n";
import { emptyMicrophones, MicrophoneDiscovery, selectedMicrophoneMissing } from "../microphoneDevices";
import { analysisBlockReason, request, type AnalysisResult, type Health } from "../api";
import { effectiveAnalysisDevice, loadAnalysisPreferences } from "../settings";
import { ASR_LANGUAGES, languageName } from "../languages";
import { getLiveResult, liveHistory, LiveSession, liveSourceFile, liveTerminal, type LiveState } from "../liveSession";
import type { InputLevel } from "../livePcm";
import { loadCapturePreferences, saveCapturePreferences, type CapturePreferences, type CapturePreferencesStatus } from "../capturePreferences";
import "./live-capture.css";

const sourceNames: Record<RecordingSource, string> = { mix: "합친 소리", microphone: "마이크", system: "시스템 소리" };
const liveStatusNames: Record<LiveState["status"], string> = {loading:"준비 중",running:"인식 중",stopping:"마무리 중",completed:"저장 완료",failed:"실패",cancelled:"취소됨",interrupted:"중단됨"};
export function LiveCaptureDialog({ onClose, onUse, onLiveResult, speakerCount = 2 }: {
  onClose: () => void; onUse: (file: File) => void;
  onLiveResult?: (file: File, result: AnalysisResult) => void; speakerCount?: number;
}) {
  const { t, locale } = useI18n();
  const [purpose,setPurpose] = useState<"record"|"live">("record");
  const [preferences,setPreferences] = useState(()=>loadAnalysisPreferences().settings);
  const [health,setHealth] = useState<Health|null>(null);
  const [healthBusy,setHealthBusy] = useState(false), [healthError,setHealthError] = useState("");
  const [healthAttempt,setHealthAttempt] = useState(0);
  const [liveState,setLiveState] = useState<LiveState|null>(null), [liveFailed,setLiveFailed] = useState(false);
  const [queueSeconds,setQueueSeconds] = useState(0), [obsBusy,setObsBusy] = useState(false), [copied,setCopied] = useState(false);
  const [level,setLevel] = useState<InputLevel>({rms:0,peak:0});
  const [history,setHistory] = useState<LiveState[]>([]), [historyError,setHistoryError] = useState(false);
  const [visibleHistory,setVisibleHistory] = useState(10);
  const live = useRef<LiveSession|null>(null);
  const [initialCapturePreferences] = useState(loadCapturePreferences);
  const [capturePreferences,setCapturePreferences] = useState(initialCapturePreferences.settings);
  const [captureStorageStatus,setCaptureStorageStatus] = useState<CapturePreferencesStatus>(initialCapturePreferences.status);
  const {mode,deviceId:device,deviceLabel:selectedLabel}=capturePreferences;
  const [microphones,setMicrophones] = useState(emptyMicrophones), [sessions,setSessions] = useState<Recording[]>([]);
  const [deviceBusy,setDeviceBusy] = useState(false);
  const [busy,setBusy] = useState(false), [active,setActive] = useState(false), [elapsed,setElapsed] = useState(0);
  const [error,setError] = useState("");
  const [visibleSessions,setVisibleSessions] = useState(25);
  const capture = useRef<LiveCapture | null>(null), alive = useRef(true);
  const discovery = useRef<MicrophoneDiscovery | null>(null);
  const missingDevice = mode !== "system" && selectedMicrophoneMissing(microphones, device);
  function chooseCapturePreferences(next:CapturePreferences) {
    setCapturePreferences(next);
    setCaptureStorageStatus(saveCapturePreferences(next).ok?"saved":"unavailable");
  }
  const liveDevice=effectiveAnalysisDevice(preferences.device,health?!!health.gpu?.available:undefined);
  const liveBlock=analysisBlockReason(health,true);
  const preparing=liveState?.status==="loading"&&!liveFailed;
  const finalizing=liveState?.status==="stopping"&&!liveFailed;
  const ready=liveState?.status==="running"&&!liveFailed;
  const liveLocked=!!liveState&&!liveTerminal(liveState)&&!liveFailed;
  const errorText = (value: unknown) => {
    const message = value instanceof Error ? value.message : String(value);
    const prefix = "녹음 저장 실패: ";
    return message.startsWith(prefix) ? t("녹음 저장 실패: {error}", { error: t(message.slice(prefix.length)) }) : t(message);
  };
  const reportError = (value: unknown) => { if (alive.current) setError(errorText(value)); };
  const refresh = () => recordingStore.list().then(rows => { if(alive.current)setSessions(rows); });
  const refreshLiveHistory = () => liveHistory().then(rows=>{if(alive.current){setHistory(rows);setHistoryError(false);}}).catch(()=>{if(alive.current)setHistoryError(true);});
  useEffect(() => {
    alive.current=true;
    void refresh().catch(reportError);
    void refreshLiveHistory();
    const instance=new MicrophoneDiscovery(navigator.mediaDevices, rows=>{if(alive.current)setMicrophones(rows);}); discovery.current=instance;
    const list=()=>instance.refresh().catch(reportError);
    void list(); navigator.mediaDevices?.addEventListener("devicechange",list);
    return ()=>{alive.current=false;instance.dispose();navigator.mediaDevices?.removeEventListener("devicechange",list);void capture.current?.stop("창이 닫혀 녹음을 종료했습니다.").catch(()=>{});void live.current?.abort().catch(()=>{});};
  },[]);
  useEffect(()=>{
    if(purpose!=="live")return;
    const controller=new AbortController();
    setHealthBusy(true);setHealthError("");
    void request<Health>("/api/health",{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(90_000)])})
      .then(value=>{if(alive.current&&!controller.signal.aborted)setHealth(value);})
      .catch(()=>{if(alive.current&&!controller.signal.aborted)setHealthError("분석 서버의 준비 상태를 확인하지 못했습니다.");})
      .finally(()=>{if(alive.current&&!controller.signal.aborted)setHealthBusy(false);});
    return()=>controller.abort();
  },[purpose,healthAttempt]);
  useEffect(()=>{if(liveTerminal(liveState))void refreshLiveHistory();},[liveState?.status]);
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
  async function stop(reason="", abortLive=false) {
    setBusy(true);
    if(reason||abortLive)setLiveFailed(true);
    try {
      await capture.current?.stop(reason);
      if(live.current&&!liveTerminal(live.current.state)) {
        if(reason||abortLive)await live.current.abort();else await live.current.stop();
      }
    }
    catch(e){reportError(e);setLiveFailed(true);await live.current?.abort().catch(()=>{});}
    finally { if(alive.current){setActive(false);setBusy(false);void refresh().catch(reportError);} }
  }
  async function prepareLive() {
    if(active||busy||preparing||finalizing||liveBlock)return;
    setBusy(true);setError("");setLiveFailed(false);setLiveState(null);setCopied(false);
    await live.current?.abort().catch(()=>{});
    const session=new LiveSession(state=>{if(alive.current)setLiveState(state);},error=>{
      if(alive.current){setLiveFailed(true);reportError(error);void stop(error.message,true);}
    },seconds=>{if(alive.current)setQueueSeconds(seconds);});live.current=session;
    try {await session.prepare({whisperModel:preferences.whisperModel,language:preferences.language,device:liveDevice,diarization:true,speakerCount});}
    catch(error){if(alive.current){setLiveFailed(true);reportError(error);}await session.abort().catch(()=>{});}
    finally {if(alive.current)setBusy(false);}
  }
  async function resetLive(nextPurpose?: "record"|"live") {
    setBusy(true);
    try {await live.current?.abort();live.current=null;setLiveState(null);setLiveFailed(false);setCopied(false);if(nextPurpose)setPurpose(nextPurpose);}
    catch(error){reportError(error);}
    finally {if(alive.current)setBusy(false);}
  }
  async function start() {
    if(active||busy||deviceBusy||missingDevice)return;
    if(purpose==="live"&&!ready)return;
    setError("");setBusy(true);setElapsed(0);
    const session=new LiveCapture(message=>{
      if(alive.current){reportError(message);setLiveFailed(true);void stop(message,true);}
    },recordingStore,{
      ...(purpose==="live"?{onPcm:(pcm:ArrayBuffer)=>{live.current?.push(pcm);}}:{}),
      ...(typeof AudioWorkletNode!=="undefined"?{onLevel:(value:InputLevel)=>{if(alive.current)setLevel(value);}}:{}),
    });capture.current=session;
    try { await session.start(mode,device); if(alive.current){setActive(true);void discovery.current?.refresh().catch(reportError);void refresh().catch(reportError);} }
    catch(e){reportError(e);await live.current?.abort().catch(()=>{});if(alive.current){setLiveFailed(true);void refresh().catch(reportError);}}
    finally {if(alive.current)setBusy(false);}
  }
  async function useLiveResult() {
    if(!liveState?.result||liveState.status!=="completed"||!onLiveResult)return;
    setBusy(true);setError("");
    try {const file=await liveSourceFile(liveState);if(alive.current)onLiveResult(file,liveState.result);}
    catch(error){reportError(error);}
    finally {if(alive.current)setBusy(false);}
  }
  async function overlay(change:{muted?:boolean;clear?:boolean}) {
    setObsBusy(true);
    try {await live.current?.overlay(change);}
    catch(error){reportError(error);}
    finally {if(alive.current)setObsBusy(false);}
  }
  async function historyAction(row:LiveState, use:boolean) {
    setBusy(true);setError("");
    try {
      const snapshot=use?await getLiveResult(row.id):row;
      if(use&&(snapshot.status!=="completed"||!snapshot.result))throw new Error("완료된 라이브 자막 결과가 없습니다. 원본 녹음을 내려받아 다시 분석하세요.");
      const file=await liveSourceFile(snapshot);
      if(alive.current){if(use&&snapshot.result&&onLiveResult)onLiveResult(file,snapshot.result);else saveBlob(file,file.name);}
    } catch(error){reportError(error);}
    finally {if(alive.current)setBusy(false);}
  }
  async function removeLive(row:LiveState) {
    if(!window.confirm(t("라이브 자막 결과와 서버의 원본 WAV를 삭제할까요? 별도로 저장된 녹음 트랙은 유지됩니다.")))return;
    setBusy(true);setError("");
    try {
      await request(`/api/live/sessions/${row.id}/history`,{method:"DELETE"});
      if(liveState?.id===row.id){await live.current?.abort();live.current=null;setLiveState(null);}
      await refreshLiveHistory();
    }catch(error){reportError(error);}
    finally {if(alive.current)setBusy(false);}
  }
  async function fileAction(row:Recording, source:RecordingSource, use:boolean) {
    if(active||busy||finalizing)return;
    setBusy(true);setError("");
    try {const file=await recordingStore.file(row,source);if(alive.current){if(use)onUse(file);else saveBlob(file,file.name);}}
    catch(e){reportError(e);}
    finally {if(alive.current)setBusy(false);}
  }
  return <Dialog title={t("라이브 자막·녹음·복구")} onClose={onClose} closeDisabled={active||busy||finalizing}>
    <label className="capture-purpose">{t("작업 방식")}<select value={purpose} disabled={active||busy||finalizing} onChange={e=>void resetLive(e.target.value as "record"|"live")}><option value="record">{t("녹음 후 분석")}</option><option value="live">{t("라이브 자막 + 녹음")}</option></select></label>
    <p>{purpose==="record"?t("마이크와 컴퓨터 소리를 녹음하고, 종료 후 자막 분석에 연결합니다. 원본 트랙도 따로 보관합니다."):t("라이브 자막은 녹음 중 계속 갱신됩니다. 먼저 엔진을 준비한 뒤 입력을 시작하세요. 자막과 화자는 초안이며 처리 속도에 따라 늦어질 수 있습니다.")}</p>
    {purpose==="live"&&<section className="live-recognition-settings">
      <p>{t("로컬 Whisper + Nemotron을 사용합니다. 저장된 모델만 사용하며, 모델이 없으면 준비 오류를 표시합니다. 원본 트랙은 별도로 녹음합니다.")}</p>
      <div className="capture-options">
        <label>{t("Whisper 모델")}<select value={preferences.whisperModel} disabled={busy||active||liveLocked} onChange={e=>setPreferences({...preferences,whisperModel:e.target.value as typeof preferences.whisperModel})}>{["large-v3","large-v3-turbo","medium","small","base","tiny"].map(model=><option key={model} value={model}>{model}</option>)}</select></label>
        <label>{t("음성 언어")}<select value={preferences.language} disabled={busy||active||liveLocked} onChange={e=>setPreferences({...preferences,language:e.target.value})}><option value="auto">AUTO</option>{ASR_LANGUAGES.map(code=><option key={code} value={code}>{languageName(code,locale)} ({code})</option>)}</select></label>
        <label>{t("처리 장치")}<select value={liveDevice} disabled={busy||active||liveLocked} onChange={e=>setPreferences({...preferences,device:e.target.value as "cpu"|"cuda"})}><option value="cuda" disabled={!health?.gpu?.available}>NVIDIA GPU</option><option value="cpu">CPU</option></select></label>
      </div>
      <p>{t("예상 인원: {count}",{count:speakerCount===4?t("4명 이상"):t("{count}명",{count:speakerCount})})}</p>
      {health&&!health.gpu?.available&&<p>{t("GPU를 사용할 수 없어 이번 분석에는 CPU를 사용합니다. 저장된 GPU 선호 설정은 유지됩니다.")}</p>}
      {healthBusy?<p role="status">{t("로컬 실행환경을 확인하고 있습니다. 첫 확인은 최대 90초 걸릴 수 있습니다.")}</p>:<>
        {(healthError||liveBlock)&&<p role="status">{t(healthError||liveBlock!)}</p>}
        {(healthError||liveBlock)&&<button disabled={busy||active||liveLocked} onClick={()=>setHealthAttempt(value=>value+1)}>{t("실행환경 다시 확인")}</button>}
      </>}
      {(!liveLocked||liveFailed)&&<button disabled={busy||active||healthBusy||!!healthError||!!liveBlock} onClick={()=>void prepareLive()}>{t("라이브 엔진 준비")}</button>}
      {preparing&&<p role="status">{t("라이브 엔진을 준비하고 있습니다. 아직 입력 장치를 녹음하지 않습니다.")}</p>}
      {ready&&!active&&<p role="status">{t("엔진이 준비되었습니다. 아래 시작 버튼을 누르면 장치에 접근하고 녹음합니다.")}</p>}
    </section>}
    <p>{t("녹음은 이 앱에 1초 단위로 저장됩니다. 창이 비정상 종료되면 마지막 조각 일부는 빠질 수 있습니다.")}</p>
    <div className="capture-options"><label>{t("녹음 소스")}<select value={mode} disabled={active||busy||deviceBusy} onChange={e=>chooseCapturePreferences({...capturePreferences,mode:e.target.value as CaptureMode})}><option value="microphone">{t("마이크")}</option><option value="system">{t("시스템 소리")}</option><option value="both">{t("마이크 + 시스템 소리")}</option></select></label>
      {mode!=="system"&&<label>{t("입력 장치")}<select aria-label={t("입력 장치")} value={device} disabled={active||busy||deviceBusy} onChange={e=>chooseCapturePreferences({...capturePreferences,deviceId:e.target.value,deviceLabel:microphones.devices.find(d=>d.deviceId===e.target.value)?.label??""})}><option value="">{t("기본 입력 · 녹음 시작 시 시스템 설정 사용")}{microphones.defaultLabel?` — ${microphones.defaultLabel}`:""}</option>{microphones.devices.map(d=><option key={d.deviceId} value={d.deviceId}>{d.label}</option>)}{device&&!microphones.devices.some(d=>d.deviceId===device)&&<option value={device}>{t(missingDevice?"연결 해제된 선택 장치":"저장된 선택 장치")}: {selectedLabel||device}</option>}</select></label>}
    </div>
    {captureStorageStatus==="saved"&&<p className="inline-status" role="status">{t("녹음 소스와 마이크 선택을 이 기기에 저장했습니다.")}</p>}
    {captureStorageStatus==="invalid"&&<p className="error-box" role="status">{t("저장된 녹음 소스 설정을 읽을 수 없어 기본값을 표시합니다. 시작 전에 소스와 마이크를 확인하고 직접 선택하세요.")}</p>}
    {captureStorageStatus==="unavailable"&&<p className="error-box" role="status">{t("녹음 소스 설정을 저장하거나 불러오지 못했습니다. 현재 선택은 사용할 수 있지만 다음에 복원되지 않을 수 있습니다.")}</p>}
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
    {active&&<div className="live-input-level"><label>{t("입력 레벨")}<meter min={0} max={1} value={level.rms} aria-label={t("입력 레벨")}/></label><span>{level.peak>=.98?t("입력이 너무 큽니다"):level.peak<.001?t("입력 소리가 매우 작습니다"):t("입력 감지")}</span></div>}
    <div className="dialog-actions"><span role="status">{active?`${t("녹음 중")} ${Math.floor(elapsed/60)}:${String(elapsed%60).padStart(2,"0")}`:t("대기")}</span>{active?<button className="primary" disabled={busy} onClick={()=>void stop()}>{t("녹음 종료·저장")}</button>:<button className="primary" disabled={busy||deviceBusy||missingDevice||finalizing||purpose==="live"&&!ready||!navigator.mediaDevices||typeof MediaRecorder==="undefined"} onClick={()=>void start()}>{purpose==="live"?t("라이브 녹음 시작"):t("녹음 시작")}</button>}</div>
    {purpose==="live"&&liveState&&<section className="live-recognition-state">
      <p role="status">{t(liveState.stage)} · {t("수신 {received}초 · 처리 {processed}초 · 지연 {lag}초",{received:liveState.receivedSeconds.toFixed(1),processed:liveState.processedSeconds.toFixed(1),lag:liveState.lagSeconds.toFixed(1)})}</p>
      {queueSeconds>=1&&<p>{t("전송 대기 {seconds}초",{seconds:queueSeconds.toFixed(1)})}</p>}
      {liveState.lagSeconds>=10&&<p role="status">{t("인식이 입력을 따라가지 못하고 있습니다. 다음 세션에서 더 빠른 모델을 선택하세요.")}</p>}
      <h3>{t("최근 라이브 자막 · 초안")}</h3>
      <div className="live-caption-preview" aria-live="polite" aria-atomic="false">{liveState.captions.slice(-5).map(caption=><p key={caption.id}><strong>{liveState.speakers.find(s=>s.id===caption.speakerId)?.name??t("미배정")}</strong> {caption.text}</p>)}{!liveState.captions.length&&<p>{t("아직 인식된 대사가 없습니다.")}</p>}</div>
      <p>{t("라이브 화자 이름은 임시 배정입니다. 겹쳐 말한 대사가 모두 복원되는 것은 아닙니다.")}</p>
      {finalizing&&<p role="status">{t("남은 소리를 처리하고 최종 자막을 정리하고 있습니다.")}</p>}
      <div className="capture-files">
        {liveState.status==="completed"&&liveState.result&&onLiveResult&&<button className="primary" disabled={busy} onClick={()=>void useLiveResult()}>{t("자막과 녹음을 새 프로젝트로 열기")}</button>}
        {(preparing||finalizing)&&<button disabled={busy} onClick={()=>void stop("라이브 분석을 취소했습니다.",true)}>{t("라이브 분석 취소")}</button>}
        {!active&&!busy&&!finalizing&&<button onClick={()=>void resetLive()}>{t("라이브 세션 초기화")}</button>}
      </div>
      <h3>{t("OBS 브라우저 자막")}</h3>
      <p>{t("아래 주소를 OBS 브라우저 소스에 붙여 넣으세요. 이 컴퓨터에서만 접근하며 주소에는 읽기 전용 토큰이 포함됩니다.")}</p>
      <input readOnly value={liveState.overlayUrl} aria-label={t("OBS 자막 주소")} onFocus={e=>e.target.select()}/>
      <div className="capture-files"><button disabled={obsBusy} onClick={()=>{void navigator.clipboard.writeText(liveState.overlayUrl).then(()=>setCopied(true)).catch(()=>reportError(new Error("주소를 복사하지 못했습니다. 주소를 직접 선택해 복사하세요.")));}}>{copied?t("복사 완료"):t("OBS 주소 복사")}</button><a href={liveState.overlayUrl} target="_blank" rel="noreferrer">{t("OBS 화면 미리보기")}</a><button disabled={obsBusy||liveFailed} onClick={()=>void overlay({muted:!liveState.overlay.muted})}>{liveState.overlay.muted?t("자막 송출 켜기"):t("자막 송출 끄기")}</button><button disabled={obsBusy||liveFailed} onClick={()=>void overlay({clear:true})}>{t("송출 자막 지우기")}</button></div>
      <p>{t("송출 끄기와 지우기는 화면에만 적용됩니다. 녹음과 편집용 자막은 보존됩니다.")}</p>
    </section>}
    {error&&<p role="alert">{error}</p>}
    <h3>{t("저장된 라이브 자막")}</h3><p>{t("완료된 결과는 창을 다시 열어도 복구할 수 있습니다. 중단된 세션은 원본 WAV로 다시 분석하세요.")}</p>
    <button disabled={active||busy||finalizing} onClick={()=>void refreshLiveHistory()}>{t("라이브 기록 새로고침")}</button>
    {historyError&&<p role="status">{t("라이브 기록을 불러오지 못했습니다. 서버 연결을 확인한 뒤 새로고침하세요.")}</p>}
    <div className="capture-sessions">{history.slice(0,visibleHistory).map(row=><article key={row.id}>
      <strong>{row.createdAt?new Date(row.createdAt).toLocaleString():row.id.slice(0,8)}</strong><span>{t(liveStatusNames[row.status])} · {row.receivedSeconds.toFixed(1)}s</span>
      {row.error&&<p>{t(row.error)}</p>}
      <div className="capture-files">
        <button disabled={active||busy||finalizing||row.receivedSeconds<=0||!liveTerminal(row)} onClick={()=>void historyAction(row,false)}>{t("라이브 원본 WAV 저장")}</button>
        {row.status==="completed"&&onLiveResult&&<button disabled={active||busy||finalizing} onClick={()=>void historyAction(row,true)}>{t("자막과 녹음을 새 프로젝트로 열기")}</button>}
        <button disabled={active||busy||finalizing||!liveTerminal(row)} onClick={()=>void removeLive(row)}>{t("라이브 기록 삭제")}</button>
      </div>
    </article>)}</div>
    {history.length>visibleHistory&&<button onClick={()=>setVisibleHistory(value=>value+10)}>{t("이전 라이브 기록 더 보기")}</button>}
    <h3>{t("저장된 녹음")}</h3><p>{t("중단된 녹음도 저장된 조각을 내려받을 수 있습니다. 분석 연결은 새 프로젝트를 시작합니다.")}</p>
    <div className="capture-sessions">{sessions.slice(0,visibleSessions).map(row=><article key={row.id}>
      <strong>{new Date(row.startedAt).toLocaleString()}</strong><span>{(row.bytes/1024/1024).toFixed(1)} MiB · {t(row.status==="stopped"?"저장 완료":capture.current?.recording?.id===row.id&&active?"녹음 중":"복구 가능")}</span>
      {row.error&&<p>{errorText(row.error)}</p>}<div className="capture-files">{row.sources.map(source=><button key={source} disabled={active||busy||row.bytes===0} onClick={()=>void fileAction(row,source,false)}>{t(sourceNames[source])} ↓</button>)}
      <button disabled={active||busy} onClick={()=>saveBlob(new Blob([JSON.stringify(row,null,2)],{type:"application/json"}),`recording-${row.id}.json`)}>{t("녹음 정보 저장")}</button>
      <button disabled={active||busy||finalizing||row.bytes===0||!row.sources.includes("mix")} onClick={()=>void fileAction(row,"mix",true)}>{t("새 프로젝트로 분석")}</button>
      <button disabled={active||busy} onClick={()=>{if(window.confirm(t("저장된 녹음을 삭제할까요? 내려받은 파일은 유지됩니다."))){setBusy(true);void recordingStore.remove(row.id).then(refresh).catch(reportError).finally(()=>{if(alive.current)setBusy(false);});}}}>{t("삭제")}</button></div>
    </article>)}</div>
    {sessions.length>visibleSessions&&<button onClick={()=>setVisibleSessions(value=>value+25)}>{t("이전 녹음 더 보기")}</button>}
    <div className="dialog-actions"><button disabled={active||busy||finalizing} onClick={onClose}>{t("닫기")}</button></div>
  </Dialog>;
}
