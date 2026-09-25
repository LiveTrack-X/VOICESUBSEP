import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Download, LoaderCircle, Plus, RefreshCw, Trash2, Upload, AppWindow } from "lucide-react";
import { download, request, type MediaInfo } from "../api";
import { useI18n } from "../i18n";
import { recordClientError } from "../diagnostics";
import { vstPollFailure } from "../vst-polling";
import { useVstEditor } from "../useVstEditor";
import {
  applyVstEditorResult, checkedPreview, importVstSettings, inspectVst, loadVstSettings, MAX_VST_SETTINGS_BYTES, MAX_VST_SLOTS, moveVstSlot, saveVstSettings, serializeVstSettings, validParameterValue, vstLatencySummary, vstRequest,
  type VstParameter, type VstPlugins, type VstPreprocessing, type VstPreview, type VstSettings, type VstSlot, type VstStatus, type VstValue,
} from "../vst";
import "./vst-chain.css";

export type VstPanelState = { preprocessing?: VstPreprocessing; busy: boolean; blocked: boolean };
type Props = { media: MediaInfo | null; audioTrack: number; disabled?: boolean; onStateChange: (state: VstPanelState) => void };

function ParameterControl({ parameter, value, onChange, onValid }: {
  parameter: VstParameter; value: VstValue; onChange: (value: VstValue) => void; onValid: (valid: boolean) => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(String(value));
  useEffect(() => { setDraft(String(value)); }, [value]);
  const valid = parameter.type !== "number" || (!!draft.trim() && validParameterValue(parameter, Number(draft)));
  useEffect(() => { onValid(valid); }, [valid]);
  return <label className="vst-parameter">
    <span>{parameter.label}</span>
    {parameter.type === "boolean" ? <input type="checkbox" checked={value === true} onChange={(event) => onChange(event.target.checked)} />
      : parameter.type === "string" && parameter.choices?.length ? <select value={String(value)} onChange={(event) => onChange(event.target.value)}>
        {parameter.choices.map((choice, index) => <option key={`${choice}-${index}`} value={choice}>{choice}</option>)}
      </select> : parameter.type === "number" ? <span>
        <input type="number" value={draft} min={parameter.min} max={parameter.max} step={parameter.step ?? "any"} aria-invalid={!valid}
          onChange={(event) => { const text = event.target.value; setDraft(text); if (text.trim() && validParameterValue(parameter, Number(text))) onChange(Number(text)); }} />
        {!valid && <small className="vst-invalid">{t("허용 범위의 숫자를 입력하세요.")}</small>}
      </span> : <input type="text" value={String(value)} maxLength={1024} onChange={(event) => { if (validParameterValue(parameter, event.target.value)) onChange(event.target.value); }} />}
  </label>;
}

export function VstChainPanel({ media, audioTrack, disabled = false, onStateChange }: Props) {
  const { t } = useI18n();
  const [settings, setSettings] = useState<VstSettings>(loadVstSettings);
  const [saved, setSaved] = useState<boolean | null>(null);
  const [importing, setImporting] = useState(false);
  const [presetMessage, setPresetMessage] = useState("");
  const [status, setStatus] = useState<VstStatus | null>(null);
  const [plugins, setPlugins] = useState<VstPlugins>({ plugins: [], roots: [] });
  const [checking, setChecking] = useState(false);
  const [inspecting, setInspecting] = useState(false);
  const [error, setError] = useState("");
  const [path, setPath] = useState("");
  const [bundleNames, setBundleNames] = useState<string[]>([]);
  const [bundleName, setBundleName] = useState("");
  const [metadata, setMetadata] = useState<Record<string, VstParameter[]>>({});
  const [invalidParameters, setInvalidParameters] = useState<Set<string>>(() => new Set());
  const [preview, setPreview] = useState<VstPreview | null>(null);
  const [previewStarting, setPreviewStarting] = useState(false);
  const [cancelPending, setCancelPending] = useState(false);
  const [pollPaused, setPollPaused] = useState(false);
  const [start, setStart] = useState("0");
  const [duration, setDuration] = useState("30");
  const alive = useRef(true);
  const busyRef = useRef(false);
  const previewId = useRef<string | null>(null);
  const previewRequest = useRef<object | null>(null);
  const originalAudio = useRef<HTMLAudioElement | null>(null);
  const processedAudio = useRef<HTMLAudioElement | null>(null);
  const presetInput = useRef<HTMLInputElement | null>(null);
  const editor = useVstEditor((slot, result) => {
    setSettings((current) => applyVstEditorResult(current, slot, result));
    setMetadata((current) => ({ ...current, [slot.id]: result.parameters ?? [] }));
    setInvalidParameters((current) => new Set([...current].filter((key) => !key.startsWith(`${slot.id}:`))));
    setPresetMessage(t("플러그인 창의 설정을 적용했습니다."));
  });
  const previewRunning = !pollPaused && (preview?.status === "queued" || preview?.status === "running");
  const busy = previewStarting || previewRunning || inspecting || importing || editor.busy;
  const locked = disabled || busy || checking || pollPaused;
  const preprocessing = useMemo(() => vstRequest(settings), [settings]);
  const badParameters = settings.chain.some((slot) => slot.enabled && [...invalidParameters].some((key) => key.startsWith(`${slot.id}:`)));
  const needsVst = settings.chain.some(slot => slot.enabled);
  const blocked = pollPaused || (settings.enabled && (checking || !preprocessing || badParameters ||
    (needsVst && !status?.available) || (!!settings.noiseReduction && !status?.noiseReduction?.available)));
  const startSeconds = Number(start);
  const durationSeconds = Number(duration);
  const validRange = !!media && !!start.trim() && !!duration.trim() && Number.isFinite(startSeconds) && startSeconds >= 0 && startSeconds < media.duration && Number.isFinite(durationSeconds) && durationSeconds > 0 && durationSeconds <= 30;
  const latency = vstLatencySummary(preview);
  const editorCancelling = editor.cancelling || editor.command === "cancel";
  const editorClosing = editor.command === "close" || !!editor.session?.closeRequested;
  const editorOpen = !editor.paused && !editorCancelling && !editorClosing && editor.session?.stage === "open";
  const editorLabel = editorCancelling ? t("플러그인 창 취소 중…") : editorClosing ? t("설정 저장·창 닫는 중…") :
    editor.paused ? t("플러그인 창 상태 확인 필요") : !editor.session ? t("플러그인 창 요청 중…") :
    editor.session.stage === "open" ? t("플러그인 창 열림") : editor.session.stage === "opening" ? t("플러그인 창 여는 중…") :
    editor.session.stage === "loading" ? t("플러그인 불러오는 중…") : t("플러그인 준비 중…");

  useEffect(() => { setSaved(saveVstSettings(settings)); }, [settings]);
  useEffect(() => { onStateChange({ preprocessing, busy, blocked }); }, [preprocessing, busy, blocked, onStateChange]);
  useEffect(() => {
    // A changed source/track/chain invalidates this comparison, including an in-flight POST.
    // Release only the preview's lock; inspection/import may own the same synchronous guard.
    const id = previewId.current;
    if (previewRequest.current || id) {
      previewRequest.current = null; previewId.current = null; busyRef.current = false;
      setPreviewStarting(false); setPollPaused(false); setCancelPending(false);
      if (id) void request(`/api/vst/previews/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => {});
    }
    setPreview(null); setError("");
  }, [settings, media?.id, audioTrack]);

  async function refresh() {
    if (busyRef.current || editor.busy) return;
    setChecking(true); setError("");
    const results = await Promise.allSettled([request<VstStatus>("/api/vst/status"), request<VstPlugins>("/api/vst/plugins")]);
    if (!alive.current) return;
    const [health, listing] = results;
    if (health.status === "fulfilled" && typeof health.value?.available === "boolean") setStatus(health.value);
    else { setStatus(null); setError(health.status === "rejected" ? (health.reason as Error).message : t("VST 응답 형식이 올바르지 않습니다.")); }
    if (listing.status === "fulfilled" && Array.isArray(listing.value?.plugins) && listing.value.plugins.every((item) => typeof item?.path === "string" && typeof item.name === "string") && Array.isArray(listing.value.roots)) setPlugins(listing.value);
    else if (listing.status === "rejected") setError((listing.reason as Error).message);
    else setError(t("VST 응답 형식이 올바르지 않습니다."));
    setChecking(false);
  }
  useEffect(() => {
    alive.current = true;
    void refresh();
    return () => {
      alive.current = false;
      previewRequest.current = null;
      if (previewId.current) void request(`/api/vst/previews/${encodeURIComponent(previewId.current)}`, { method: "DELETE" }).catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (!preview?.id || !previewRunning) return;
    let live = true;
    let timer: number;
    let failures = 0;
    const id = preview.id;
    const poll = async () => {
      let retry = true;
      try {
        const next = checkedPreview(await request(`/api/vst/previews/${encodeURIComponent(id)}`));
        if (next.id !== id) throw new Error(t("VST 응답 형식이 올바르지 않습니다."));
        failures = 0;
        if (live && previewId.current === id) { setPreview(next); setError(""); if (!["queued", "running"].includes(next.status)) { busyRef.current = false; previewId.current = null; previewRequest.current = null; setCancelPending(false); retry = false; } }
      } catch (caught) {
        if (live && previewId.current === id) {
          const action = vstPollFailure(caught, ++failures);
          if (action === "missing") { retry = false; finishMissingPreview(id); }
          else if (action === "pause") { retry = false; setPollPaused(true); busyRef.current = false; setCancelPending(false); setError(t("서버 연결이 끊겨 미리보기 상태를 확인하지 못했습니다. 작업이 서버에서 계속될 수 있습니다.")); }
          else setError(t("미리보기 상태 확인 실패: {error}. 다시 확인하는 중입니다.", { error: (caught as Error).message }));
        }
      } finally { if (live && retry && previewId.current === id) timer = window.setTimeout(poll, 1000); }
    };
    timer = window.setTimeout(poll, 500);
    return () => { live = false; window.clearTimeout(timer); };
  }, [preview?.id, previewRunning]);

  function finishMissingPreview(id: string) {
    busyRef.current = false; previewId.current = null; previewRequest.current = null; setCancelPending(false); setPollPaused(false); setError("");
    setPreview({ id, status: "failed", error: t("서버가 다시 시작됐거나 미리보기가 만료되었습니다. 다시 생성하세요.") });
  }
  function detachPreview() {
    const id = previewId.current;
    previewId.current = null; previewRequest.current = null; busyRef.current = false; setPollPaused(false); setPreview(null); setCancelPending(false);
    if (id) void request(`/api/vst/previews/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => {});
    setError(t("미리보기 대기를 종료했습니다. 서버의 취소 완료 여부는 확인되지 않았습니다."));
  }

  function changeSlot(id: string, change: Partial<VstSlot>) {
    setSettings((current) => ({ ...current, chain: current.chain.map((slot) => slot.id === id ? { ...slot, ...change } : slot) }));
  }
  function exportPreset() {
    if (locked) return;
    setError(""); setPresetMessage("");
    try {
      download("voicesubsep-vst-settings.json", serializeVstSettings(settings), "application/json;charset=utf-8");
      setPresetMessage(t("설정 파일 다운로드를 시작했습니다."));
    } catch (caught) { recordClientError("settings", "vst-export-failed", caught); setError((caught as Error).message); }
  }
  async function importPreset(file: File) {
    if (locked || busyRef.current) return;
    busyRef.current = true; setImporting(true); setError(""); setPresetMessage("");
    try {
      if (file.size > MAX_VST_SETTINGS_BYTES) throw new Error(t("VST 설정 파일은 2MB 이하여야 합니다."));
      const restored = importVstSettings(await file.text());
      if (!alive.current) return;
      originalAudio.current?.pause(); processedAudio.current?.pause();
      setMetadata({}); setInvalidParameters(new Set()); setPreview(null);
      setPath(""); setBundleNames([]); setBundleName("");
      setSettings(restored);
      setPresetMessage(t("설정을 불러왔습니다. 플러그인은 실행하지 않았습니다."));
    } catch (caught) { recordClientError("settings", "vst-import-failed", caught); if (alive.current) setError(t("설정을 불러오지 못했습니다. 현재 설정을 유지합니다. {error}", { error: t((caught as Error).message) })); }
    finally { busyRef.current = false; if (alive.current) setImporting(false); }
  }
  async function inspect(existing?: VstSlot) {
    if (locked || busyRef.current || !status?.available || (!existing && settings.chain.length >= MAX_VST_SLOTS)) return;
    const chosenPath = existing?.path ?? path.trim();
    if (!chosenPath) return;
    busyRef.current = true; setInspecting(true); setError("");
    try {
      const result = await inspectVst(chosenPath, existing?.pluginName ?? (bundleNames.length ? bundleName : undefined));
      if (!alive.current) return;
      if (result.plugins) { setBundleNames(result.plugins); setBundleName(result.plugins[0] ?? ""); return; }
      const parameters = result.parameters ?? [];
      if (existing) {
        const byKey = new Map(parameters.map((parameter) => [parameter.key, parameter]));
        if (Object.entries(existing.parameters).some(([key, value]) => !byKey.has(key) || !validParameterValue(byKey.get(key)!, value))) throw new Error(t("저장된 설정이 플러그인과 맞지 않습니다. 슬롯을 삭제하고 다시 추가하세요."));
        setMetadata((current) => ({ ...current, [existing.id]: parameters }));
      } else {
        const id = crypto.randomUUID();
        const slot: VstSlot = { id, path: chosenPath, name: result.name ?? result.pluginName ?? chosenPath.split(/[\\/]/u).pop() ?? chosenPath,
          ...(result.pluginName === undefined ? {} : { pluginName: result.pluginName }), enabled: true,
          parameters: {} };
        setSettings((current) => ({ ...current, chain: [...current.chain, slot] }));
        setMetadata((current) => ({ ...current, [id]: parameters }));
        setPath(""); setBundleNames([]); setBundleName("");
      }
    } catch (caught) { if (alive.current) setError((caught as Error).message); }
    finally { busyRef.current = false; if (alive.current) setInspecting(false); }
  }
  async function startPreview() {
    if (locked || busyRef.current || blocked || !preprocessing || !media || !validRange) return;
    const owner = {};
    previewRequest.current = owner;
    busyRef.current = true; setPreviewStarting(true); setPreview(null); setPollPaused(false); setError(""); setCancelPending(false);
    try {
      const next = checkedPreview(await request("/api/vst/previews", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mediaId: media.id, audioTrack, start: startSeconds, duration: Math.min(durationSeconds, media.duration - startSeconds), chain: preprocessing.chain,
          ...(preprocessing.noiseReduction ? { noiseReduction: preprocessing.noiseReduction } : {}) }),
      }));
      if (!alive.current || previewRequest.current !== owner) { if (["queued", "running"].includes(next.status)) void request(`/api/vst/previews/${encodeURIComponent(next.id)}`, { method: "DELETE" }).catch(() => {}); return; }
      setPreview(next);
      if (["queued", "running"].includes(next.status)) previewId.current = next.id;
      else busyRef.current = false;
    } catch (caught) {
      if (alive.current && previewRequest.current === owner) { busyRef.current = false; setError((caught as Error).message); }
    } finally {
      if (alive.current && previewRequest.current === owner) {
        setPreviewStarting(false);
        if (!previewId.current) previewRequest.current = null;
      }
    }
  }
  async function cancelPreview() {
    if (!preview || !previewRunning || cancelPending) return;
    const owner = previewRequest.current;
    setCancelPending(true);
    try {
      const next = checkedPreview(await request(`/api/vst/previews/${encodeURIComponent(preview.id)}`, { method: "DELETE" }));
      if (!alive.current || previewRequest.current !== owner || previewId.current !== preview.id) return;
      if (next.id !== preview.id) throw new Error(t("VST 응답 형식이 올바르지 않습니다."));
      setPreview(next);
      if (!["queued", "running"].includes(next.status)) { busyRef.current = false; previewId.current = null; previewRequest.current = null; setCancelPending(false); }
    } catch (caught) { if (alive.current && previewRequest.current === owner && previewId.current === preview.id) { if (vstPollFailure(caught, 1) === "missing") finishMissingPreview(preview.id); else { setError((caught as Error).message); setCancelPending(false); } } }
  }

  return <section className="vst-chain-panel" aria-label={t("오디오 사전처리")}>
    <div className="vst-panel-heading"><label className="checkbox-label"><input type="checkbox" checked={settings.enabled} disabled={locked}
      onChange={(event) => setSettings((current) => ({ ...current, enabled: event.target.checked }))} />{t("오디오 사전처리 사용")}</label>
      <button type="button" className="vst-refresh" disabled={locked} title={t("플러그인 목록 새로고침")} aria-label={t("플러그인 목록 새로고침")} onClick={() => void refresh()}>
        {checking ? <LoaderCircle size={16} className="spin" /> : <RefreshCw size={16} />}
      </button></div>
    {editor.busy && <section className="vst-editor-status" aria-label={t("플러그인 설정창")}>
      <p className="inline-status" role="status">{editorOpen || editor.paused ? <AppWindow size={16} /> : <LoaderCircle size={16} className="spin" />}{editorLabel}
        {editor.preparing && <small>{t("준비 대기 {seconds}초", { seconds: editor.elapsedSeconds })}</small>}</p>
      {editorOpen && <p>{t("별도 플러그인 창에서 설정을 조절하세요.")}</p>}
      {editor.preparing && <p>{t("준비가 끝나면 별도 창이 열립니다. 경과 시간은 완료 예상 시간이 아닙니다.")}</p>}
      {!editorCancelling && !editorClosing && <p>{t("창이 뒤에 있으면 앞으로 가져오기를 누르세요. 창을 닫으면 설정이 적용됩니다.")}</p>}
      <div className="vst-preset-actions">
        <button type="button" disabled={!editor.session || editor.commandPending || editorCancelling || editorClosing}
          onClick={() => void editor.focus()}><AppWindow size={15} />{t("창 앞으로 가져오기")}</button>
        <button type="button" disabled={!editor.session || editor.commandPending || editorCancelling || editorClosing}
          onClick={() => void editor.finish(false)}>{t("닫고 적용")}</button>
        <button type="button" disabled={editor.commandPending || editorCancelling}
          onClick={() => void editor.finish(true)}>{t("변경 취소·창 닫기")}</button>
        {editor.paused && <button type="button" disabled={editor.commandPending} onClick={editor.retry}>{t("상태 다시 확인")}</button>}
        {(editor.paused || editorCancelling) && <button type="button" onClick={editor.detach}>{t("창 닫기 요청·연결 해제")}</button>}
      </div>
    </section>}
    <p>{t("분석용 음성만 처리합니다. 원본 미디어와 내보내기 소리는 바뀌지 않습니다.")}</p>
    <div className="vst-preset-actions">
      <button type="button" disabled={locked || badParameters} onClick={exportPreset}><Download size={15} />{t("VST 설정 저장")}</button>
      <button type="button" disabled={locked} onClick={() => presetInput.current?.click()}><Upload size={15} />{t("VST 설정 불러오기")}</button>
      <input ref={presetInput} type="file" hidden accept="application/json,.json" aria-label={t("VST 설정 파일")} disabled={locked}
        onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void importPreset(file); }} />
    </div>
    {saved !== null && <p className={saved ? "vst-save-status" : "error-box"} role="status">{saved ? t("VST 설정을 이 기기에 자동 저장했습니다.") : t("VST 설정 자동 저장에 실패했습니다. 설정 파일로 저장하면 보관할 수 있습니다.")}</p>}
    {presetMessage && <p className="vst-save-status" role="status">{presetMessage}</p>}
    <p className="vst-hint">{t("체인 순서·활성화·적용 범위·조절값을 앱 설정 JSON으로 저장합니다. 플러그인 파일은 포함하지 않습니다.")}</p>
    {settings.enabled && <>
      <p className="info-box">{t("CLEAR·RX 등은 직접 설치하고 라이선스를 활성화해야 합니다. 플러그인과 모델을 자동 다운로드하지 않습니다.")}<br />{t("강한 소음 제거는 짧은 말이나 말끝을 손상할 수 있습니다. 먼저 원본과 처리음을 비교하세요.")}</p>
      {!checking && needsVst && !status?.available && <p className="error-box" role="status">{t("VST 실행환경이 준비되지 않았습니다. 이 옵션을 끄면 원본으로 분석할 수 있습니다.")}{status?.issue && <><br />{status.issue}</>}</p>}
      <fieldset className="vst-controls" disabled={locked}>
        <section className="noise-reduction-card" aria-label={t("로컬 잡음 제거 · RNNoise")}>
          <label className="checkbox-label"><input type="checkbox" checked={!!settings.noiseReduction} onChange={event=>setSettings(current=>{
            if(event.target.checked)return {...current,noiseReduction:{engine:"rnnoise",mix:0.7}};
            const {noiseReduction:_noise,...rest}=current;return rest;
          })}/><strong>{t("로컬 잡음 제거 · RNNoise")}</strong></label>
          <p>{t("별도 플러그인 없이 CPU에서 처리합니다. 켜면 VST보다 먼저 적용합니다.")}</p>
          {settings.noiseReduction && <><label className="noise-mix">{t("처리음 비율")} <strong>{Math.round(settings.noiseReduction.mix*100)}%</strong>
            <input type="range" min="0" max="1" step="0.05" aria-label={t("처리음 비율")} value={settings.noiseReduction.mix}
              onChange={event=>setSettings(current=>({...current,noiseReduction:{engine:"rnnoise",mix:Number(event.target.value)}}))}/></label>
            <small>{t("낮추면 원본을 더 섞습니다. 음성 손상을 확인한 뒤 사용하세요.")}</small>
            {!checking && !status?.noiseReduction?.available && <p className="error-box" role="status">{t("RNNoise 실행환경을 사용할 수 없습니다.")}{status?.noiseReduction?.issue && <><br/>{status.noiseReduction.issue}</>}</p>}
          </>}
        </section>
        <label>{t("사전처리 적용 범위")}<select value={settings.applyTo} onChange={(event) => setSettings((current) => ({ ...current, applyTo: event.target.value as VstSettings["applyTo"] }))}>
          <option value="asr">{t("음성 인식만 · 화자 구분은 원본 사용")}</option><option value="both">{t("음성 인식과 화자 구분 모두")}</option>
        </select></label>
        <p className="vst-hint">{t("위에서 아래 순서로 처리합니다. 최대 4개이며 체크를 끄면 해당 슬롯을 건너뜁니다.")}</p>
        <ol className="vst-slots">{settings.chain.map((slot, index) => <li key={slot.id} className={slot.enabled ? "" : "vst-bypassed"}>
          <div className="vst-slot-heading"><label className="checkbox-label"><input type="checkbox" checked={slot.enabled} onChange={(event) => changeSlot(slot.id, { enabled: event.target.checked })} />
            <strong>{index + 1}. {slot.name}</strong></label>
            <div className="vst-slot-actions"><button type="button" disabled={index === 0} aria-label={t("{name} 위로 이동", { name: slot.name })} onClick={() => setSettings((current) => moveVstSlot(current, slot.id, -1))}><ArrowUp size={15} /></button>
              <button type="button" disabled={index === settings.chain.length - 1} aria-label={t("{name} 아래로 이동", { name: slot.name })} onClick={() => setSettings((current) => moveVstSlot(current, slot.id, 1))}><ArrowDown size={15} /></button>
              <button type="button" aria-label={t("{name} 슬롯 삭제", { name: slot.name })} onClick={() => { setSettings((current) => ({ ...current, chain: current.chain.filter((item) => item.id !== slot.id) })); setInvalidParameters((current) => new Set([...current].filter((key) => !key.startsWith(`${slot.id}:`)))); }}><Trash2 size={15} /></button>
            </div></div>
          <small className="vst-path" title={slot.path}>{slot.path}{slot.pluginName ? ` · ${slot.pluginName}` : ""}</small>
          <button type="button" className="vst-native-open" disabled={!status?.available || badParameters}
            onClick={() => { if (!locked && !busyRef.current) { setPresetMessage(""); setError(""); void editor.open(slot); } }}>
            {editor.busy && editor.slotId === slot.id ? <>{editorOpen || editor.paused ? <AppWindow size={16} /> : <LoaderCircle size={16} className="spin" />}{editorLabel}</> : <><AppWindow size={16} />{t("플러그인 창 열기")}</>}
          </button>
          {editor.slotId === slot.id && editor.busy && <p className="vst-editor-inline-status" role="status">{t("창 제어 버튼은 오디오 사전처리 영역 위쪽에 있습니다.")}</p>}
          {editor.slotId === slot.id && editor.error && <p className="error-box" role="alert">{t(editor.error)}</p>}
          <details className="vst-parameters"><summary>{t("플러그인 매개변수")}</summary>
            {!metadata[slot.id] ? <><p>{t("저장된 설정을 사용합니다. 조정하려면 플러그인을 불러오세요.")}</p><button type="button" disabled={!status?.available} onClick={() => void inspect(slot)}>{t("매개변수 불러오기")}</button></>
              : !metadata[slot.id]!.length ? <p>{t("이 플러그인은 조정 가능한 매개변수를 제공하지 않습니다.")}</p>
              : <div className="vst-parameter-grid">{metadata[slot.id]!.map((parameter) => <ParameterControl key={parameter.key} parameter={parameter} value={slot.parameters[parameter.key] ?? parameter.value}
                onChange={(value) => changeSlot(slot.id, { parameters: { ...slot.parameters, [parameter.key]: value } })}
                onValid={(valid) => setInvalidParameters((current) => { const key = `${slot.id}:${parameter.key}`; if (current.has(key) === !valid) return current; const next = new Set(current); if (valid) next.delete(key); else next.add(key); return next; })} />)}</div>}
          </details>
        </li>)}</ol>
        {settings.chain.length < MAX_VST_SLOTS && <div className="vst-add">
          <label>{t("설치된 VST3 선택")}<select value={plugins.plugins.some((item) => item.path === path) ? path : ""} onChange={(event) => { setPath(event.target.value); setBundleNames([]); setBundleName(""); }}>
            <option value="">{t("플러그인을 선택하거나 경로를 입력하세요")}</option>{plugins.plugins.map((plugin) => <option key={plugin.path} value={plugin.path}>{plugin.name}</option>)}
          </select></label>
          <label>{t("VST3 파일 또는 번들 경로")}<input type="text" value={path} maxLength={2048} placeholder="C:\\Program Files\\Common Files\\VST3\\Plugin.vst3"
            onChange={(event) => { setPath(event.target.value); setBundleNames([]); setBundleName(""); }} /></label>
          {!!bundleNames.length && <label>{t("번들 안의 플러그인")}<select value={bundleName} onChange={(event) => setBundleName(event.target.value)}>{bundleNames.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>}
          <button type="button" disabled={!path.trim() || !status?.available} onClick={() => void inspect()}><Plus size={16} />{bundleNames.length ? t("선택한 플러그인 추가") : t("플러그인 확인 및 추가")}</button>
          <small>{t("목록 확인은 파일만 검색합니다. 추가 또는 매개변수 불러오기를 누르면 플러그인을 실행합니다.")}</small>
        </div>}
        {settings.enabled && !preprocessing && <p className="vst-hint" role="status">{t("RNNoise를 켜거나 사용할 플러그인을 추가하세요.")}</p>}
        <p className="vst-hint">{t("전용 창을 닫으면 조절값과 플러그인 상태를 저장합니다. 창에는 오디오가 재생되지 않으므로 조절 후 비교 음성을 생성하세요.")}<br />{t("GUI 배율은 플러그인 자체 메뉴에서 조절합니다. 공통 배율 변경은 지원하지 않습니다.")}</p>
        <div className="vst-preview-settings"><label>{t("비교 시작 (초)")}<input type="number" min={0} max={media?.duration} step="any" value={start} onChange={(event) => { setStart(event.target.value); setPreview(null); }} /></label>
          <label>{t("비교 길이 (최대 30초)")}<input type="number" min={0.01} max={30} step="any" value={duration} onChange={(event) => { setDuration(event.target.value); setPreview(null); }} /></label>
          <button type="button" disabled={blocked || !validRange} onClick={() => void startPreview()}>{t("원본 / 처리음 비교 생성")}</button></div>
      </fieldset>
      {editor.session?.status === "cancelled" && <p role="status">{t("플러그인 설정 변경을 취소했습니다.")}</p>}
      {inspecting && <p className="inline-status" role="status"><LoaderCircle size={16} className="spin" />{t("플러그인을 확인하고 있습니다…")}</p>}
      {(previewStarting || previewRunning) && <div className="vst-preview-progress" role="status"><p className="inline-status"><LoaderCircle size={16} className="spin" />{t("비교 음성을 준비하고 있습니다…")}</p>
        {preview?.progress !== undefined && <progress value={preview.progress} max={1} aria-label={t("비교 음성 진행률")} />}
        {previewRunning && <button type="button" disabled={cancelPending} onClick={() => void cancelPreview()}>{cancelPending ? t("취소 중…") : t("비교 생성 취소")}</button>}
      </div>}
      {pollPaused && <div className="vst-preset-actions"><button type="button" onClick={() => { busyRef.current = true; setError(""); setPollPaused(false); }}>{t("미리보기 상태 다시 확인")}</button><button type="button" onClick={detachPreview}>{t("미리보기 대기 종료")}</button></div>}
      {preview?.status === "cancelled" && <p role="status">{t("비교 음성 생성을 취소했습니다.")}</p>}
      {preview?.status === "failed" && <p className="error-box" role="alert">{preview.error ?? t("비교 음성 생성에 실패했습니다.")}</p>}
      {preview?.status === "completed" && <div className="vst-preview-audio"><label>{t("원본 음성")}<audio ref={originalAudio} controls preload="metadata" src={preview.originalUrl} onPlay={() => processedAudio.current?.pause()} /></label>
        <label>{t("처리한 음성")}<audio ref={processedAudio} controls preload="metadata" src={preview.processedUrl} onPlay={() => originalAudio.current?.pause()} /></label>
        {latency && <section className="vst-latency-report" aria-label={t("플러그인 지연 확인 · 자동 보정")}>
          <strong>{t("플러그인 지연 확인 · 자동 보정")}</strong>
          <ul>{latency.plugins.map((plugin, index) => <li key={index}><span>{plugin.name}</span><span>
            {t("보고 지연: {samples} 샘플 / {ms} ms", { samples: plugin.samples, ms: plugin.milliseconds.toFixed(2) })}
            {plugin.residual&&<><br/><small>{plugin.residual.status==="uncertain"?t("실측 불확실 · 추가 보정 안 함"):plugin.residual.status==="verified"?
              t("실측 추가 지연 없음 · {windows}개 구간 확인",{windows:plugin.residual.matchedWindows}):
              t("실측 추가 보정: {samples} 샘플 / {ms} ms · {windows}개 구간",{samples:plugin.residual.appliedSamples,ms:(plugin.residual.appliedSamples/48).toFixed(2),windows:plugin.residual.matchedWindows})}</small></>}
          </span></li>)}</ul>
          <p><strong>{t("총 보정 지연")}</strong><span>{t("{samples} 샘플 / {ms} ms", { samples: latency.totalSamples, ms: latency.totalMilliseconds.toFixed(2) })}</span></p>
          <small>{t(latency.residualChecked?"보고 지연을 먼저 보정한 뒤, 최대 ±250ms 범위에서 여러 구간의 잔여 지연을 확인합니다. 충분히 일치하는 양의 지연만 추가 보정하며 무음·주기음·게이트·가변 지연은 불확실할 수 있습니다. 이번 음원과 설정에 대한 확인이며 모든 구간의 싱크를 보장하지 않습니다.":"플러그인이 보고한 지연을 기준으로 보정했습니다. 실제 지연을 잘못 보고하는 플러그인은 추가 확인이 필요합니다.")}</small>
        </section>}
        {preview.report?.warnings?.map((warning, index) => <p className="info-box" key={index}>{t(warning==="Some residual delays could not be verified. No additional shift was guessed for those effects."?"일부 잔여 지연을 확인하지 못했습니다. 해당 효과는 추측으로 추가 이동하지 않았습니다.":warning)}</p>)}
        <small>{t("음성 인식 결과가 좋아지는지는 별도로 비교해야 합니다. 소음이 줄어도 인식률이 낮아질 수 있습니다.")}</small>
      </div>}
    </>}
    {(error || (editor.error && !settings.chain.some(slot => slot.id === editor.slotId))) && <p className="error-box" role="alert">{t(error || editor.error)}</p>}
  </section>;
}
