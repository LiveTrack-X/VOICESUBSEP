import { useI18n } from "../i18n";
import { useEffect, useRef, useState } from "react";
import { AudioLines, CheckCircle2, LoaderCircle } from "lucide-react";
import {
  analysisBlockReason,
  ApiError,
  request,
  uploadMedia,
  type AnalysisResult,
  type Health,
  type Job,
  type MediaInfo,
} from "../api";
import type { Project } from "../domain";
import { Dialog } from "./Dialog";
import { ASR_LANGUAGES, languageName } from "../languages";
import { VstChainPanel, type VstPanelState } from "./VstChainPanel";
import { effectiveAnalysisDevice, loadAnalysisPreferences, saveAnalysisPreferences, type AnalysisPreferences } from "../settings";
import { readHistory, sameAnalysisSource } from "../jobHistory";
import { RecognitionPreview } from "./RecognitionPreview";
import { CloudAsrSettings } from "./CloudAsrSettings";
import { cloudAsrBlockReason, cloudAsrRequestFields, defaultAsrSelection, type AsrSelection } from "../cloudAsr";
import { providerName, type CredentialState } from "../providerCredentials";
import { DiarizationSettings } from "./DiarizationSettings";

export function AnalysisDialog({
  file,
  project,
  onClose,
  onApply,
  onMediaReady,
}: {
  file: File;
  project: Project;
  onClose: () => void;
  onApply: (result: AnalysisResult) => void;
  onMediaReady?: (duration: number) => void;
}) {
  const { t, locale } = useI18n();
  const mediaReady = useRef(onMediaReady);mediaReady.current=onMediaReady;
  const [health, setHealth] = useState<Health | null>(null);
  const [media, setMedia] = useState<MediaInfo | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [job, setJob] = useState<Job | null>(null);
  const [starting, setStarting] = useState(false);
  const [asr, setAsr] = useState<AsrSelection>(defaultAsrSelection);
  const [cloudConsent, setCloudConsent] = useState(false);
  const [credential, setCredential] = useState<CredentialState>({ configured: false, busy: false });
  function changeAsr(selection: AsrSelection) {
    setCloudConsent(false);
    setDiarizationConsent(false);
    if (selection.provider !== asr.provider) setCredential({ configured: false, busy: selection.provider !== "local" });
    setAsr(selection);
  }
  const [initialPreferences] = useState(loadAnalysisPreferences);
  const [preferences, setPreferences] = useState(initialPreferences.settings);
  const [storageFailed, setStorageFailed] = useState(initialPreferences.status === "unavailable");
  const [invalidStoredPreferences, setInvalidStoredPreferences] = useState(initialPreferences.status === "invalid");
  const { whisperModel: model, device: preferredDevice, language, diarization, speakerBoundaryMs } = preferences;
  const device = effectiveAnalysisDevice(preferredDevice, health ? !!health.gpu?.available : undefined);
  function updatePreference<K extends keyof AnalysisPreferences>(key: K, value: AnalysisPreferences[K]) {
    setInvalidStoredPreferences(false);
    setCloudConsent(false);
    setDiarizationConsent(false);
    setPreferences((current) => ({ ...current, [key]: value }));
  }
  useEffect(() => {
    setStorageFailed(!saveAnalysisPreferences(preferences).ok);
  }, [preferences]);
  const localAsrEngine = preferences.localAsrEngine ?? "whisper";
  const qwenModel = preferences.qwenModel ?? "1.7b";
  const diarizationProvider = preferences.diarizationProvider ?? "nemotron";
  const [diarizationConsent, setDiarizationConsent] = useState(false);
  const [diarizationCredential, setDiarizationCredential] = useState<CredentialState>({ configured: false, busy: false });
  const [advancedOpen, setAdvancedOpen] = useState(false);
  function updateEnginePreferences(value: Partial<AnalysisPreferences>) {
    setInvalidStoredPreferences(false);
    setCloudConsent(false);
    setDiarizationConsent(false);
    setPreferences(current => ({ ...current, ...value }));
  }
  function restoreDefaultEngines() {
    changeAsr(defaultAsrSelection());
    updateEnginePreferences({ localAsrEngine: "whisper", whisperModel: "large-v3", diarization: true, diarizationProvider: "nemotron" });
    setIsolatedTracks(false);
  }
  const [track, setTrack] = useState(0);
  const [isolatedTrackMode,setIsolatedTracks]=useState(false);
  const isolatedTracks = asr.provider === "local" && isolatedTrackMode;
  const [trackSpeakers,setTrackSpeakers]=useState<Record<number,string>>({});
  const [vstState, setVstState] = useState<VstPanelState>({ busy: false, blocked: false });
  const mappedTracks=Object.entries(trackSpeakers).map(([audioTrack,speakerId])=>({audioTrack:Number(audioTrack),speaker:project.speakers.find(s=>s.id===speakerId)}));
  const invalidMapping=isolatedTracks&&(!mappedTracks.length||mappedTracks.length>8||mappedTracks.some(item=>!item.speaker));
  const cloudDiarization = diarization && !isolatedTracks && diarizationProvider === "deepgram";
  const localDiarization = diarization && !isolatedTracks && diarizationProvider === "nemotron";
  const defaultEngines = asr.provider === "local" && localAsrEngine === "whisper" && localDiarization;
  const supportedLanguages = asr.provider === "gemini" ? ["ko", "en", "ja", "zh", "es"] : asr.provider === "local" && localAsrEngine === "qwen" ? ["zh", "en", "yue", "fr", "de", "it", "ja", "ko", "pt", "ru", "es"] : null;
  const unsupportedLanguage = asr.provider !== "xai" && language !== "auto" && supportedLanguages !== null && !supportedLanguages.includes(language);
  const diarizationBlock = cloudDiarization ? diarizationCredential.busy ? "API 키 상태 확인을 마칠 때까지 기다리세요." : !diarizationCredential.configured ? "Deepgram API 키를 고급 설정에서 등록하세요." : !diarizationConsent ? "고급 설정에서 Deepgram 음성 전송과 API 과금에 동의하세요." : null : null;
  const cloudBlockReason = cloudAsrBlockReason(asr, credential.configured, cloudConsent, credential.busy);
  const blockedReason = analysisBlockReason(health, localDiarization, asr.provider, localAsrEngine) ?? (unsupportedLanguage ? "선택한 엔진이 지원하는 음성 언어를 선택하거나 AUTO로 변경하세요." : null) ?? cloudBlockReason ?? diarizationBlock;
  const sharedRuntimeIssue = health ? analysisBlockReason(health, false, asr.provider, localAsrEngine) : null;
  const running = job?.status === "running" || job?.status === "queued";
  useEffect(() => {
    let alive = true;
    setJob(null);
    setCloudConsent(false);
    setDiarizationConsent(false);
    setMedia(null);
    setHealth(null);
    setError("");
    setLoading(true);
    void (async () => {
      try {
        const h = await request<Health>("/api/health", {
          signal: AbortSignal.timeout(120_000),
        });
        if (!alive) return;
        setHealth(h);
        if (!h.ffmpeg || !h.ffprobe)
          throw new Error(
            t("FFmpeg와 FFprobe를 설치한 뒤 서버를 다시 실행하세요."),
          );
        const m = await uploadMedia(file);
        if (alive) {
          setMedia(m);
          mediaReady.current?.(m.duration);
          setTrack(m.audioTracks[0]?.index ?? 0);
          // Server job records survive page reload. Only reopen this project's
          // exact content identity; a matching filename is insufficient.
          try {
            const history = await readHistory();
            const previous = history.items.find(item => sameAnalysisSource(item, project.id, m.id) && ["queued", "running", "completed"].includes(item.status));
            if (previous) {
              const restored = await request<Job>(`/api/jobs/${previous.id}`);
              if (alive) setJob(restored);
            }
          } catch { /* History is optional; fresh analysis remains available. */ }
        }
      } catch (e) {
        if (alive)
          setError(
            t("분석 준비 실패: {error}. 로컬 서버가 실행 중인지 확인하세요.", { error: (e as Error).message }),
          );
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [file]);
  useEffect(() => {
    if (!job?.id || !running) return;
    let alive = true;
    let timer: number;
    const poll = async () => {
      try {
        const next = await request<Job>(`/api/jobs/${job.id}`);
        if (alive) {
          setJob(next);
          setError("");
        }
      } catch (e) {
        if (alive) {
          if (e instanceof ApiError && e.status === 404) setJob(current => current ? {...current, status:"failed", stage:"interrupted", updatedAt:undefined, error:t("이전 작업을 찾을 수 없습니다. 새 분석을 시작하세요.")} : current);
          setError(
            t("진행 상태 확인 실패: {error}. 다시 확인하는 중입니다.", { error: (e as Error).message }),
          );
        }
      } finally {
        if (alive) timer = window.setTimeout(poll, 1200);
      }
    };
    timer = window.setTimeout(poll, 500);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [job?.id, running]);
  async function start() {
    if (!media || loading || starting || running || vstState.busy || vstState.blocked || credential.busy || invalidMapping) return;
    if (blockedReason) {
      setError(t(blockedReason));
      return;
    }
    setStarting(true);
    setError("");
    const requestedAt = new Date().toISOString();
    try {
      const { id } = await request<{ id: string }>("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mediaId: media.id,
          projectId: project.id,
          projectName: project.name,
          mode: project.mode,
          speakerCount: project.speakerCount,
          audioTrack: track,
          whisperModel: model,
          language: asr.provider === "xai" ? "auto" : language,
          device,
          diarization: diarization && !isolatedTracks,
          localAsrEngine, qwenModel,
          diarizationProvider: cloudDiarization ? "deepgram" : "nemotron",
          diarizationConsent: cloudDiarization && diarizationConsent,
          ...cloudAsrRequestFields(asr, credential.configured, cloudConsent),
          ...(isolatedTracks?{trackSpeakers:mappedTracks.map(item=>({audioTrack:item.audioTrack,speakerId:item.speaker!.id,name:item.speaker!.name,color:item.speaker!.color}))}:{}),
          speakerBoundaryMs,
          ...(vstState.preprocessing ? { preprocessing: vstState.preprocessing } : {}),
        }),
      });
      // Server timestamps replace this local request timestamp on the first poll.
      setJob({ id, status: "queued", stage: "queued", progress: 0, createdAt: requestedAt, updatedAt: requestedAt });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStarting(false);
      setCloudConsent(false);
      setDiarizationConsent(false);
    }
  }
  return (
    <Dialog
      title={t("음성 분석")}
      onClose={onClose}
      closeDisabled={starting || vstState.busy}
    >
      <p className="dialog-intro">
        {file.name} · {t("예상 인원: {count}", { count: project.speakerCount === 4 ? t("4명 이상") : t("{count}명", { count: project.speakerCount }) })} ·{" "}
        {project.mode === "overlap" ? t("동시 발화") : t("일반 대화")}
      </p>
      <p className={storageFailed ? "error-box" : "inline-status"} role="status">
        {storageFailed
          ? t("분석 설정을 저장하지 못했습니다. 이 창의 선택은 사용할 수 있지만 다음에 복원되지 않을 수 있습니다.")
          : invalidStoredPreferences
            ? t("저장된 분석 설정을 읽을 수 없어 기본값을 사용합니다.")
            : t("분석 설정을 이 기기에 자동 저장했습니다.")}
      </p>
      {!job && health && !health.engines.nemotron && localDiarization && (
        <p className="error-box" role="status">
          <strong>{t('화자 구분 실행환경 준비 필요')}</strong>
          <br />{health.engineIssues?.nemotron?.trim() ||
            t("현재 앱 또는 서버에 Nemotron 실행에 필요한 구성요소가 준비되지 않았습니다.")}
          <br />{t('실행환경을 준비한 뒤 분석 창을 다시 열어 상태를 확인하세요.')}{diarization && <><br />{t('인물별 자막 분석은 준비가 끝나야 시작할 수 있습니다.')}</>}
        </p>
      )}
      {loading && (
        <p className="inline-status">
          <LoaderCircle className="spin" size={18} />
          {health
            ? t("이 기기의 분석 서버에 파일을 준비하고 있습니다…")
            : t("음성 인식·화자 구분 실행환경을 확인하고 있습니다. 첫 실행에는 수십 초가 걸릴 수 있습니다…")}
        </p>
      )}
      {!job && !loading && (
        <>
          <div className="analysis-preset" role="status">
            <strong>{defaultEngines ? t("기본 분석 · Whisper + Nemotron") : t("사용자 지정 분석")}</strong>
            <p>{defaultEngines ? t("Whisper가 음성을 글로 바꾸고, Nemotron이 말한 사람을 구분합니다. 이 기기에서 실행하며 API 키가 필요 없습니다.") : `${asr.provider === "local" ? localAsrEngine === "whisper" ? "Whisper" : "Qwen3-ASR" : providerName(asr.provider)} · ${isolatedTracks ? t("분리된 화자 트랙") : diarization ? diarizationProvider === "nemotron" ? "Nemotron" : "Deepgram" : t("전사만 생성 · 인물은 직접 지정")}`}</p>
            {!defaultEngines && <button disabled={starting || vstState.busy} onClick={restoreDefaultEngines}>{t("기본 조합으로 되돌리기")}</button>}
          </div>
          <div className="form-grid">
            <label>{t('오디오 트랙')}<select
                aria-label={t("오디오 트랙")}
                disabled={starting || vstState.busy}
                value={track}
                onChange={(e) => { setTrack(Number(e.target.value)); setCloudConsent(false); setDiarizationConsent(false); }}
              >
                {media?.audioTracks.map((audioTrack) => (
                  <option key={audioTrack.index} value={audioTrack.index}>
                    {audioTrack.label} · {t("{count}채널", { count: audioTrack.channels })}</option>
                ))}
              </select>
            </label>
            <label>{t('음성 언어')}<select
                aria-label={t("음성 언어")}
                value={asr.provider === "xai" ? "auto" : language}
                disabled={asr.provider === "xai" || starting}
                onChange={(e) => updateEnginePreferences({ language: e.target.value })}
              >
                <option value="auto">{t('자동 감지')}</option>
                {ASR_LANGUAGES.filter(code => !supportedLanguages || supportedLanguages.includes(code) || code === language).map((code) => <option key={code} value={code}>{languageName(code, locale)} ({code})</option>)}
              </select>
              <small>{asr.provider === "xai" ? t("현재 xAI 연결은 언어를 자동 인식합니다. 저장된 로컬 언어 설정은 유지합니다.") : t("자동 감지하거나 주로 사용하는 음성 언어를 직접 선택하세요. 앱 화면 언어에는 영향을 주지 않습니다.")}</small>
            </label>
          </div>
          <details className="analysis-advanced" open={advancedOpen} onToggle={event => setAdvancedOpen(event.currentTarget.open)}>
            <summary>{t("고급 설정 (Advanced)")}<small>{t("모델 · 로컬/유료 API · 오디오 처리")}</small></summary>
            <p>{t("기본은 로컬 Whisper + Nemotron입니다. 다른 엔진이 필요한 경우에만 아래 설정을 변경하세요.")}</p>
            <CloudAsrSettings selection={asr} onChange={changeAsr} consent={cloudConsent} onConsent={setCloudConsent}
              preferences={preferences} onPreferences={updateEnginePreferences}
              disabled={starting || vstState.busy} credentialBusy={credential.busy} onCredentialState={state => { setCredential(state); setCloudConsent(false); }}/>
            {(asr.provider === "local" || localDiarization) && <label>{t("연산 장치")}<select aria-label={t("연산 장치")} disabled={starting || vstState.busy} value={device}
              onChange={event => updatePreference("device", event.target.value as AnalysisPreferences["device"])}>
              <option value="cuda" disabled={!health?.gpu?.available}>{t("NVIDIA GPU · 우선 사용")}</option><option value="cpu">{t("CPU · 호환 모드")}</option>
            </select><small>{health?.gpu?.available ? health.gpu.name : t("GPU를 사용할 수 없어 이번 분석에는 CPU를 사용합니다. 저장된 GPU 선호 설정은 유지됩니다.")}</small></label>}
          {asr.provider === "local" && !!media&&media.audioTracks.length>1&&<fieldset className="analysis-options" disabled={starting||vstState.busy}>
            <legend>{t("분리된 화자 트랙")}</legend>
            <label className="checkbox-label"><input type="checkbox" checked={isolatedTracks} onChange={e=>setIsolatedTracks(e.target.checked)}/>{t("OBS 등에서 따로 녹음한 트랙을 인물별로 연결")}</label>
            {isolatedTracks&&<><p>{t("각 트랙에 한 사람의 목소리만 있을 때 사용하세요. 게임·전체 채팅이 섞인 트랙은 자동 분리하지 않습니다. 선택한 트랙을 순서대로 전사하고 원본 시간에 합칩니다.")}</p>
              {media.audioTracks.map((audio,index)=><div className="form-grid" key={audio.index}><label className="checkbox-label"><input type="checkbox" checked={!!trackSpeakers[audio.index]}
                onChange={e=>setTrackSpeakers(current=>{const next={...current};if(e.target.checked)next[audio.index]=project.speakers[Math.min(index,project.speakers.length-1)]?.id??"";else delete next[audio.index];return next;})}/>{audio.label}</label>
                {!!trackSpeakers[audio.index]&&<label>{t("인물")}<select value={trackSpeakers[audio.index]} onChange={e=>setTrackSpeakers(current=>({...current,[audio.index]:e.target.value}))}>{project.speakers.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>}</div>)}
              <p>{t("최대 8개 트랙을 선택하세요. 화자 구분 모델 대신 지정한 인물을 사용합니다.")}</p>
              {invalidMapping&&<p className="error-box">{t("분석할 트랙과 인물을 하나 이상 선택하세요. 최대 8개입니다.")}</p>}
            </>}
          </fieldset>}
          {!isolatedTracks&&<fieldset className="analysis-options" disabled={starting}>
            <legend>{t('분석 범위')}</legend>
            <label className="checkbox-label">
              <input
                type="radio"
                name="analysis-scope"
                checked={diarization}
                onChange={() => updatePreference("diarization", true)}
              />{t("인물별 자막 생성 · 음성 인식 + 화자 구분")}</label>
            <label className="checkbox-label">
              <input
                type="radio"
                name="analysis-scope"
                checked={!diarization}
                onChange={() => updatePreference("diarization", false)}
              />{t('전사만 생성 · 인물은 직접 지정')}</label>
          </fieldset>}
          {!isolatedTracks && diarization && <DiarizationSettings provider={diarizationProvider}
            onChange={provider => { updateEnginePreferences({ diarizationProvider: provider }); setDiarizationCredential({ configured: false, busy: provider === "deepgram" }); }}
            consent={diarizationConsent} onConsent={setDiarizationConsent} disabled={starting || vstState.busy}
            onCredentialState={state => { setDiarizationCredential(state); setDiarizationConsent(false); }}/>}
          {sharedRuntimeIssue && (
            <p className="error-box" role="status">{t(sharedRuntimeIssue)}</p>
          )}
          {cloudBlockReason && <p className="info-box" role="status">{t(cloudBlockReason)}</p>}
          <p className="info-box">
            {isolatedTracks ? t("최대 8개 트랙을 선택하세요. 화자 구분 모델 대신 지정한 인물을 사용합니다.") : diarization
              ? t("자동 화자 번호를 부여합니다. 분석 후 목소리를 확인하고 이름을 지정하세요.")
              : t("전사만 생성을 선택했습니다. 자막의 화자를 편집 화면에서 직접 지정해야 합니다.")}
            {(asr.provider === "local" || localDiarization) && <><br />{t('큰 모델은 첫 실행 시 수 GB를 다운로드해 이 기기에 보관합니다. CPU의 큰 모델은 오래 걸릴 수 있습니다. 겹쳐 말한 모든 대사의 복원을 보장하지 않습니다.')}</>}</p>
          <VstChainPanel media={media} audioTrack={track} disabled={starting} onStateChange={setVstState} />

        <fieldset className="analysis-options boundary-options" disabled={!diarization || isolatedTracks || starting || running}>
          <legend>{t('짧은 단어 화자 보정')}</legend>
          <label>{t('허용할 시간 차이')}<select
              aria-label={t("짧은 단어 화자 보정")}
              aria-describedby="speaker-boundary-help"
              value={speakerBoundaryMs}
              onChange={(e) => updatePreference("speakerBoundaryMs", Number(e.target.value) as AnalysisPreferences["speakerBoundaryMs"])}
            >
              <option value={0}>{t('끄기 · 엄격하게 배정')}</option>
              <option value={200}>{t('보수적 · 0.2초')}</option>
              <option value={500}>{t('기본 · 0.5초')}</option>
              <option value={800}>{t('넓게 · 0.8초')}</option>
            </select>
          </label>
          <p id="speaker-boundary-help">{t('The처럼 짧은 단어가 화자 구간에 일부 걸쳐 있고, 인접 단어의 화자도 같을 때 보정합니다. 겹친 목소리나 화자 전환은 미배정으로 남깁니다. 넓게 설정할수록 잘못 배정될 가능성도 커집니다. 보정한 자막에는 ‘경계 보정’을 표시합니다. 기존 자막은 유지되며 다음 분석부터 적용됩니다.')}</p>
        </fieldset>
          </details>
          {(cloudBlockReason || diarizationBlock || unsupportedLanguage) && <p className="info-box">{t(unsupportedLanguage ? "선택한 엔진이 지원하는 음성 언어를 선택하거나 AUTO로 변경하세요." : cloudBlockReason ?? diarizationBlock!)} <button onClick={() => setAdvancedOpen(true)}>{t("고급 설정 열기")}</button></p>}
        </>
      )}
      {job && (
        <div className="job-status">
          <div>
            {job.status === "completed" ? (
              <CheckCircle2 size={22} />
            ) : running ? (
              <LoaderCircle className="spin" size={22} />
            ) : (
              <AudioLines size={22} />
            )}
            <strong>
              {
                {
                  queued: t("분석 대기"),
                  running: t("분석 중"),
                  completed: t("분석 완료"),
                  failed: t("분석 실패"),
                  cancelled: t("분석 취소됨"),
                }[job.status]
              }
            </strong>
            <span>{Math.round(job.progress * 100)}%</span>
          </div>
          <progress value={job.progress} max={1} />
          <p>
            {{
              queued: t("분석 대기"),
              completed: t("분석 결과를 확인한 뒤 적용하세요."),
              preparing: t("분석을 준비하고 있습니다."),
              failed: t("아래 오류 내용을 확인하세요."),
              cancelled: t("작업이 취소되었습니다."),
              "cancellation requested": t("현재 처리 단계가 끝나면 취소합니다."),
              interrupted: t("서버가 중단되어 분석을 완료하지 못했습니다."),
            }[job.stage] ?? job.stage}
          </p>
          <RecognitionPreview key={job.id} job={job} />
          {job.error && <p className="error-box">{job.error}</p>}
          {job.result?.warnings.map((w, i) => (
            <p className="info-box" key={i}>
              {w}
            </p>
          ))}
          {job.result && (
            <p>{t("자막 {captions}개 · 감지된 인물 {speakers}명", { captions: job.result.captions.length, speakers: job.result.speakers.length })}</p>
          )}
        </div>
      )}
      {running && <p className="info-box">{t("창을 닫아도 작업은 계속됩니다. 작업 이력에서 다시 열 수 있습니다.")}</p>}
      {error && (
        <p className="error-box" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        {running ? (<>
          <button onClick={onClose}>{t("창 닫고 계속 작업")}</button>
          <button
            onClick={async () => {
              try {
                setJob(
                  await request<Job>(`/api/jobs/${job.id}`, {
                    method: "DELETE",
                  }),
                );
              } catch (e) {
                if (e instanceof ApiError && e.status === 404) setJob(current=>current?{...current,status:"failed",stage:"interrupted",updatedAt:undefined}:current);
                setError((e as Error).message);
              }
            }}
          >{t('분석 취소')}</button></>
        ) : job?.result ? (
          <>
            <p>{t('적용하면 기존 자막이 교체됩니다. 노트는 유지됩니다.')}</p>
            <button disabled={starting} onClick={() => {setJob(null); setError("");}}>{t("새 분석 설정")}</button>
            <button className="primary" disabled={starting} onClick={() => onApply(job.result!)}>{t('결과 적용')}</button>
          </>
        ) : (
          <>
            <button disabled={vstState.busy || starting} onClick={onClose}>{t('닫기')}</button>
            {job&&<button disabled={starting||vstState.busy} onClick={()=>{setJob(null);setError("");}}>{t("새 분석 설정")}</button>}
            <button
              className="primary"
              disabled={
                loading || starting || !media || !!blockedReason || vstState.busy || vstState.blocked || credential.busy || invalidMapping
              }
              onClick={start}
            >
              {starting ? t("시작 중…") : job ? t("다시 분석") : isolatedTracks ? t("선택한 트랙 분석") : diarization ? t("인물별 자막 분석 시작") : t("전사만 시작")}
            </button>
          </>
        )}
      </div>
    </Dialog>
  );
}
