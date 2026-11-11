import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { request, uploadMedia, type MediaInfo } from "../api";
import { formatTime, type Caption, type Project } from "../domain";
import { assertProjectMedia, sameMediaIdentity } from "../mediaIdentity";
import type { MediaSource } from "../mediaSource";
import { useI18n } from "../i18n";
import { parseVocabularyText } from "../vocabulary";
import { enrollVoiceReference, makeSpeechToolSnapshot, parseOverlapResult, parseSpeechToolJob, parseVoiceMatchResult,
  voiceMatchRequest, voiceReferenceIssue, voiceTargetIssue, type OverlapResult, type OverlapSelection,
  type SpeechToolJob, type SpeechToolKind, type SpeechToolSnapshot, type VoiceMatchResult } from "../speechTools";
import { Dialog } from "./Dialog";
import "./speech-tools.css";

const JOBS = "/api/speech-tools/jobs";
const INVALID = "음성 보완 요청을 확인할 수 없습니다.";
const CHANGED = "설정이나 원본이 바뀌어 이전 결과를 지웠습니다. 다시 실행하세요.";
type RuntimeStatus = { runtimeAvailable: boolean; ready: boolean; issue: string | null };
type ToolsStatus = { voice: RuntimeStatus; overlap: RuntimeStatus };
type Preview = { url: string; start: number; end: number; purpose: "reference" | "target"; captionId: string };
type VoiceView = { snapshot: SpeechToolSnapshot; result: VoiceMatchResult; captionId: string };
type OverlapView = { snapshot: SpeechToolSnapshot; result: OverlapResult };

async function discard(id: string): Promise<void> {
  try {
    await request(`${JOBS}/${id}/cancel`, { method: "POST" });
    await request(`${JOBS}/${id}`, { method: "DELETE" });
  } catch { /* A stopped backend or an already-discarded operation needs no retry. */ }
}

/** UI-owned jobs stay isolated from late POST/poll completions and replacement sources. */
export class SpeechToolRunner {
  private generation = 0;
  private id: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private controller: AbortController | null = null;
  cancel() {
    this.generation++;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.controller?.abort(); this.controller = null;
    const id = this.id; this.id = null;
    if (id) void discard(id);
  }
  async start(kind: SpeechToolKind, payload: Record<string, unknown>, onJob: (job: SpeechToolJob) => void,
    onComplete: (job: SpeechToolJob) => void, onError: (error: Error) => void): Promise<void> {
    this.cancel();
    const generation = this.generation;
    try {
      // Do not abort POST: a late response still supplies the exact owned job to cancel.
      const created = await request<{ id: string }>(JOBS, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, ...payload }) });
      if (!created || !/^[a-f0-9]{32}$/u.test(created.id)) throw new Error(INVALID);
      if (generation !== this.generation) { void discard(created.id); return; }
      this.id = created.id;
      onJob({ id: created.id, kind, status: "queued", stage: "queued", progress: 0 });
      const poll = async () => {
        if (generation !== this.generation) return;
        const controller = new AbortController(); this.controller = controller;
        try {
          const job = parseSpeechToolJob(await request<unknown>(`${JOBS}/${created.id}`, { signal: controller.signal }), kind);
          if (generation !== this.generation) return;
          if (job.id !== created.id) throw new Error(INVALID);
          onJob(job);
          if (job.status === "completed") onComplete(job);
          else if (job.status === "failed") onError(new Error(job.error || INVALID));
          else if (job.status === "queued" || job.status === "running") this.timer = setTimeout(() => { void poll(); }, 600);
        } catch (error) {
          if (generation === this.generation) onError(error instanceof Error ? error : new Error(INVALID));
        } finally { if (this.controller === controller) this.controller = null; }
      };
      await poll();
    } catch (error) {
      if (generation === this.generation) onError(error instanceof Error ? error : new Error(INVALID));
    }
  }
}

/** Native played ranges exclude a seek directly to the end of the preview. */
export function heardWholePreview(element: Pick<HTMLAudioElement, "duration" | "played">): boolean {
  if (!Number.isFinite(element.duration) || element.duration <= 0 || !element.played.length) return false;
  let covered = 0;
  for (let index = 0; index < element.played.length; index++) {
    if (element.played.start(index) > covered + .15) return false;
    covered = Math.max(covered, element.played.end(index));
  }
  return covered >= element.duration - .15;
}

function initialRange(project: Project, captionId: string | null) {
  const caption = project.captions.find(c => c.id === captionId);
  const start = Math.min(caption?.start ?? 0, Math.max(0, project.duration - 2));
  return { start, end: Math.min(project.duration, Math.max(start + 2, Math.min(start + 20, caption?.end ?? start + 5))) };
}
function referenceEligible(project: Project, caption: Caption, track: number): boolean {
  return !!project.mediaIdentity && !!caption.speakerId && voiceReferenceIssue(project, { id: "prospective-reference", captionId: caption.id,
    speakerId: caption.speakerId, start: caption.start, end: caption.end, text: caption.text, audioTrack: track, sourceIdentity: project.mediaIdentity }, track) === null;
}
function parsePreview(job: SpeechToolJob, snapshot: SpeechToolSnapshot, start: number, end: number): string {
  if (!job.result || typeof job.result !== "object") throw new Error(INVALID);
  const row = job.result as Record<string, unknown>;
  if (row.originalUrl !== `${JOBS}/${job.id}/audio/original.wav` || row.mediaId !== snapshot.mediaId || row.audioTrack !== snapshot.audioTrack
    || !row.sourceIdentity || typeof row.sourceIdentity !== "object" || !sameMediaIdentity(row.sourceIdentity as SpeechToolSnapshot["sourceIdentity"], snapshot.sourceIdentity)
    || typeof row.start !== "number" || typeof row.end !== "number" || !Number.isFinite(row.start) || !Number.isFinite(row.end)
    || Math.abs(row.start - start) > .000126 || Math.abs(row.end - end) > .000126) throw new Error(INVALID);
  return row.originalUrl as string;
}

export function SpeechToolsDialog({ project, session, file, selectedCaptionId, onClose, onUpdate, onApplyVoice, onApplyOverlap }: {
  project: Project; session: number; file: MediaSource | null; selectedCaptionId: string | null; onClose: () => void;
  onUpdate: (change: (project: Project) => Project) => void;
  onApplyVoice: (snapshot: SpeechToolSnapshot, result: VoiceMatchResult, captionId: string) => void;
  onApplyOverlap: (snapshot: SpeechToolSnapshot, result: OverlapResult, selected: OverlapSelection[]) => void;
}) {
  const { t } = useI18n(), tabId = useId();
  const [tab, setTab] = useState<"voice" | "overlap">("voice");
  const [media, setMedia] = useState<MediaInfo | null>(null), [mediaBusy, setMediaBusy] = useState(false);
  const [track, setTrack] = useState(0), [status, setStatus] = useState<ToolsStatus | null>(null);
  const [referenceId, setReferenceId] = useState(selectedCaptionId ?? ""), [targetId, setTargetId] = useState(selectedCaptionId ?? "");
  const [referenceConfirmed, setReferenceConfirmed] = useState(false), [targetConfirmed, setTargetConfirmed] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null), [heard, setHeard] = useState<"reference" | "target" | null>(null);
  const [range, setRange] = useState(() => initialRange(project, selectedCaptionId));
  const savedVocabularyText = (project.vocabulary ?? []).join("\n");
  const [whisperModel, setWhisperModel] = useState("small"), [language, setLanguage] = useState("ko"), [vocabulary, setVocabulary] = useState(savedVocabularyText);
  const [preparedWhisper, setPreparedWhisper] = useState<string | null>(null);
  const [job, setJob] = useState<SpeechToolJob | null>(null), [starting, setStarting] = useState(false);
  const [voiceView, setVoiceView] = useState<VoiceView | null>(null), [overlapView, setOverlapView] = useState<OverlapView | null>(null);
  const [choices, setChoices] = useState<Record<string, OverlapSelection>>({}), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [runner] = useState(() => new SpeechToolRunner()), [previewRunner] = useState(() => new SpeechToolRunner());
  const alive = useRef(true), loadGeneration = useRef(0);
  const operationGeneration = useRef(0);
  const context = useRef({ project, session, file }); context.current = { project, session, file };
  const audio = useRef<HTMLAudioElement>(null), playbackStarted = useRef(false);
  const busy = starting || job?.status === "queued" || job?.status === "running";
  const eligibleReferences = useMemo(() => project.captions.filter(caption => referenceEligible(project, caption, track)), [project, track]);
  const eligibleTargets = useMemo(() => project.captions.filter(caption => !voiceTargetIssue(project, caption)), [project]);
  const reference = eligibleReferences.find(caption => caption.id === referenceId), target = eligibleTargets.find(caption => caption.id === targetId);
  const enrolled = project.voiceReferences ?? [];
  const validReferences = enrolled.filter(ref => voiceReferenceIssue(project, ref, track) === null);
  const enoughSpeakers = new Set(validReferences.map(ref => ref.speakerId)).size >= 2;
  const selectedChoices = Object.values(choices);
  const rangeValid = Number.isFinite(range.start) && Number.isFinite(range.end) && range.start >= 0 && range.end <= project.duration && range.end - range.start >= 2 && range.end - range.start <= 20;
  const speakerName = (id: string) => project.speakers.find(speaker => speaker.id === id)?.name || t("이름 없는 인물");

  function clear(showNotice = false) {
    const hadWork = busy || !!preview || !!voiceView || !!overlapView;
    operationGeneration.current++;
    runner.cancel(); previewRunner.cancel(); audio.current?.pause(); playbackStarted.current = false;
    setStarting(false); setJob(null); setPreview(null); setHeard(null); setReferenceConfirmed(false); setTargetConfirmed(false);
    setVoiceView(null); setOverlapView(null); setChoices({}); setError("");
    setNotice(showNotice && hadWork ? CHANGED : "");
  }
  function close() { operationGeneration.current++; runner.cancel(); previewRunner.cancel(); audio.current?.pause(); onClose(); }
  async function refreshStatus() {
    const generation = ++loadGeneration.current;
    try {
      const next = await request<ToolsStatus>("/api/speech-tools/status", { signal: AbortSignal.timeout(90_000) });
      if (alive.current && generation === loadGeneration.current) {
        if (!next || typeof next.voice?.runtimeAvailable !== "boolean" || typeof next.voice.ready !== "boolean"
          || typeof next.overlap?.runtimeAvailable !== "boolean" || typeof next.overlap.ready !== "boolean") throw new Error(INVALID);
        setStatus(next);
      }
    } catch (failure) { if (alive.current && generation === loadGeneration.current) setError((failure as Error).message); }
  }
  useEffect(() => {
    alive.current = true; void refreshStatus();
    return () => { alive.current = false; loadGeneration.current++; operationGeneration.current++; runner.cancel(); previewRunner.cancel(); };
  }, [runner, previewRunner]);
  useLayoutEffect(() => { clear(true); }, [project, session, file]);
  useEffect(() => {
    let active = true;
    setMedia(null); setMediaBusy(!!file);
    if (file) void uploadMedia(file).then(info => {
      if (!active) return;
      assertProjectMedia(context.current.project, info);
      setMedia(info); setTrack(previous => info.audioTracks.some(item => item.index === previous) ? previous : info.audioTracks[0]?.index ?? 0);
    }).catch(failure => { if (active) setError((failure as Error).message); }).finally(() => { if (active) setMediaBusy(false); });
    return () => { active = false; };
  }, [file, session, project.id, project.mediaIdentity?.sha256, project.mediaIdentity?.bytes]);
  useEffect(() => { if (!reference) setReferenceId(eligibleReferences[0]?.id ?? ""); }, [reference, eligibleReferences]);
  useEffect(() => { if (!target) setTargetId(eligibleTargets[0]?.id ?? ""); }, [target, eligibleTargets]);
  useEffect(() => { setVocabulary(savedVocabularyText); }, [project.id, session, file, savedVocabularyText]);

  function snapshot(): SpeechToolSnapshot {
    if (!media || !file) throw new Error(t("원본 파일을 연결하면 선택한 트랙의 음성을 비교할 수 있습니다."));
    return makeSpeechToolSnapshot(project, session, media, track);
  }
  async function start(kind: SpeechToolKind, payload: Record<string, unknown>, complete: (job: SpeechToolJob) => void, owner = runner) {
    const generation = ++operationGeneration.current;
    setStarting(true); setError(""); setNotice("");
    // A start intentionally leaves a previous completed preview's listen confirmation
    // in memory; controls/source changes clear it through clear().
    try { await owner.start(kind, payload, setJob, complete, failure => { setStarting(false); setError(failure.message); }); }
    finally { if (alive.current && generation === operationGeneration.current) setStarting(false); }
  }
  function listen(caption: Caption, purpose: Preview["purpose"]) {
    try {
      clear(); const bound = snapshot();
      void start("voice-preview", { mediaId: bound.mediaId, sourceIdentity: bound.sourceIdentity, audioTrack: track, start: caption.start, end: caption.end }, completed => {
        const url = parsePreview(completed, bound, caption.start, caption.end);
        setPreview({ url, start: caption.start, end: caption.end, purpose, captionId: caption.id });
      }, previewRunner);
    } catch (failure) { setError((failure as Error).message); }
  }
  function prepare(kind: "prepare-voice" | "prepare-overlap") {
    try {
      if (kind === "prepare-overlap") parseVocabularyText(vocabulary);
      clear(); const requestedModel = whisperModel;
      void start(kind, kind === "prepare-overlap" ? { whisperModel: requestedModel } : {}, () => {
        if (kind === "prepare-overlap") setPreparedWhisper(requestedModel);
        void refreshStatus();
      });
    } catch (failure) { setError((failure as Error).message); }
  }
  function enroll() {
    try {
      if (!reference || heard !== "reference" || !referenceConfirmed || preview?.captionId !== reference.id) throw new Error(t("선택한 트랙의 구간을 먼저 끝까지 들으세요."));
      const selected = reference.id, selectedTrack = track;
      onUpdate(previous => {
        if (previous !== project) throw new Error(t(CHANGED));
        return enrollVoiceReference(previous, selected, selectedTrack);
      });
    } catch (failure) { setError((failure as Error).message); }
  }
  function compare() {
    try {
      if (!target || heard !== "target" || preview?.captionId !== target.id) throw new Error(t("선택한 트랙의 구간을 먼저 끝까지 들으세요."));
      const bound = snapshot(), input = voiceMatchRequest(project, track, target.id, targetConfirmed), captionId = target.id;
      setVoiceView(null);
      void start("voice-match", { mediaId: bound.mediaId, sourceIdentity: bound.sourceIdentity, audioTrack: track, ...input }, completed => {
        const result = parseVoiceMatchResult(completed.result);
        if (result.mediaId !== bound.mediaId || result.audioTrack !== bound.audioTrack || !sameMediaIdentity(result.sourceIdentity, bound.sourceIdentity)
          || result.candidates.length !== 1 || result.candidates[0]?.captionId !== captionId) throw new Error(INVALID);
        setVoiceView({ snapshot: bound, result, captionId });
      });
    } catch (failure) { setError((failure as Error).message); }
  }
  function recover() {
    try {
      if (!rangeValid) throw new Error(t("원본 시간 기준 2~20초를 선택하세요."));
      const terms = parseVocabularyText(vocabulary), bound = snapshot(), selectedRange = { ...range };
      setOverlapView(null); setChoices({});
      void start("overlap-recovery", { mediaId: bound.mediaId, sourceIdentity: bound.sourceIdentity, audioTrack: track,
        ...selectedRange, whisperModel, language, vocabulary: terms }, completed => {
        const result = parseOverlapResult(completed.result);
        if (result.mediaId !== bound.mediaId || result.audioTrack !== bound.audioTrack || !sameMediaIdentity(result.sourceIdentity, bound.sourceIdentity)
          || Math.abs(result.start - selectedRange.start) > .000126 || Math.abs(result.end - selectedRange.end) > .000126
          || result.originalUrl !== `${JOBS}/${completed.id}/audio/original.wav`) throw new Error(INVALID);
        setOverlapView({ snapshot: bound, result });
      });
    } catch (failure) { setError((failure as Error).message); }
  }
  const candidate = voiceView?.result.candidates[0], ranked = candidate?.scores.slice().sort((a, b) => b.similarity - a.similarity) ?? [];
  const enrolledSpeakerIds = new Set(validReferences.map(ref => ref.speakerId));
  const canApplyVoice = !!voiceView && voiceView.snapshot.project === project && voiceView.snapshot.session === session && candidate?.reason === "candidate"
    && !!candidate.recommendedSpeakerId && ranked.length >= 2 && ranked.length === enrolledSpeakerIds.size
    && ranked.every(score => enrolledSpeakerIds.has(score.speakerId)) && ranked[0]!.speakerId === candidate.recommendedSpeakerId
    && ranked[0]!.similarity >= .75 && ranked[0]!.similarity - ranked[1]!.similarity >= .15;
  const currentStatus = status?.[tab === "voice" ? "voice" : "overlap"];
  return <Dialog title={t("음성 보완 도구")} onClose={close}>
    <div className="speech-tools">
      <div className="speech-tools-tabs" role="tablist" aria-label={t("음성 보완 방식")}>
        <button role="tab" id={`${tabId}-voice-tab`} aria-controls={`${tabId}-voice`} aria-selected={tab === "voice"} onClick={() => { if (tab !== "voice") { clear(true); setTab("voice"); } }}>{t("확인한 목소리")}</button>
        <button role="tab" id={`${tabId}-overlap-tab`} aria-controls={`${tabId}-overlap`} aria-selected={tab === "overlap"} onClick={() => { if (tab !== "overlap") { clear(true); setTab("overlap"); } }}>{t("겹침 복원 실험")}</button>
      </div>
      <div className="speech-tools-scroll">
        <div className="speech-tools-common">
          <label>{t("오디오 트랙")}<select value={track} disabled={!media || mediaBusy} onChange={event => { clear(true); setTrack(Number(event.target.value)); }}>
            {media?.audioTracks.map(item => <option key={item.index} value={item.index}>{item.label}</option>)}
            {!media && <option value={track}>—</option>}
          </select></label>
          <p className="muted" role="status">{mediaBusy ? t("원본과 오디오 트랙 확인 중") : !status ? t("실행환경 확인 중") : t(currentStatus?.ready ? "모델 준비 완료" : "모델 준비 필요")}{" · CPU"}</p>
        </div>
        {!file && <p className="info-box">{t("원본 파일을 연결하면 선택한 트랙의 음성을 비교할 수 있습니다.")}</p>}
        {currentStatus?.issue && <p className="info-box">{t(currentStatus.issue)}</p>}
        {(error || notice) && <p className={error ? "error-box" : "info-box"} role={error ? "alert" : "status"}>{t(error || notice)}</p>}
        {busy && <div className="speech-tools-progress" role="status"><span>{job ? t(job.stage) : t("검토 결과 준비 중")}</span>
          <progress aria-label={t("검토 결과 준비 중")} max={1} value={job?.progress ?? 0}/>
          <button onClick={() => clear()}>{t("작업 취소")}</button>
        </div>}
        {tab === "voice" ? <section role="tabpanel" id={`${tabId}-voice`} aria-labelledby={`${tabId}-voice-tab`}>
          <p className="dialog-intro">{t("배정·검수 완료된 단독 발화 3~15초를 기준으로 등록합니다.")}</p>
          <button disabled={busy || !status?.voice.runtimeAvailable} onClick={() => prepare("prepare-voice")}>{t("음성 비교 모델 준비")}</button>
          <div className="speech-tools-grid">
            <section className="speech-tools-card">
              <h3>{t("등록한 기준 음성")}</h3>
              <label>{t("기준 자막")}<select value={reference?.id ?? ""} disabled={busy || !eligibleReferences.length} onChange={event => { clear(true); setReferenceId(event.target.value); }}>
                {!eligibleReferences.length && <option value="">{t("등록 가능한 기준 자막이 없습니다.")}</option>}
                {eligibleReferences.map(caption => <option key={caption.id} value={caption.id}>{speakerName(caption.speakerId!)} · {formatTime(caption.start)} · {caption.text.slice(0, 90)}</option>)}
              </select></label>
              {reference && <p className="speech-tools-caption">{formatTime(reference.start)}–{formatTime(reference.end)} · {reference.text}</p>}
              <button disabled={busy || !media || !reference} onClick={() => reference && listen(reference, "reference")}>{t("선택한 트랙 듣기")}</button>
              <label className="speech-tools-check"><input type="checkbox" checked={referenceConfirmed} disabled={busy || heard !== "reference" || preview?.captionId !== reference?.id}
                onChange={event => setReferenceConfirmed(event.target.checked)}/>{t("선택한 트랙을 끝까지 듣고 이 인물의 단독 목소리임을 확인했습니다.")}</label>
              <button disabled={busy || !media || !reference || !referenceConfirmed || heard !== "reference"} onClick={enroll}>{t("기준 음성 등록")}</button>
              {!!enrolled.length && <ul className="speech-tools-reference-list">{enrolled.map(ref => <li key={ref.id}><div><strong>{speakerName(ref.speakerId)}</strong> · {formatTime(ref.start)}–{formatTime(ref.end)} · #{ref.audioTrack}
                {voiceReferenceIssue(project, ref, track) && <p className="muted">{t(voiceReferenceIssue(project, ref, track)!)}</p>}</div>
                <button aria-label={`${t("기준 음성 삭제")} · ${speakerName(ref.speakerId)} · ${formatTime(ref.start)}`} onClick={() => onUpdate(previous => ({ ...previous, voiceReferences: previous.voiceReferences?.filter(item => item.id !== ref.id) }))}>{t("삭제")}</button>
              </li>)}</ul>}
              {!enoughSpeakers && <p className="muted">{t("다른 인물의 기준 음성을 2명 이상 등록하세요.")}</p>}
            </section>
            <section className="speech-tools-card">
              <h3>{t("미배정 비교 자막")}</h3>
              <label>{t("미배정 비교 자막")}<select value={target?.id ?? ""} disabled={busy || !eligibleTargets.length} onChange={event => { clear(true); setTargetId(event.target.value); }}>
                {!eligibleTargets.length && <option value="">{t("비교할 미배정 자막이 없습니다.")}</option>}
                {eligibleTargets.map(caption => <option key={caption.id} value={caption.id}>{formatTime(caption.start)} · {caption.text.slice(0, 100)}</option>)}
              </select></label>
              {target && <p className="speech-tools-caption">{formatTime(target.start)}–{formatTime(target.end)} · {target.text}</p>}
              <p className="muted">{t("단독 발화가 1.5초보다 짧거나 겹침·시간 불확실·수동 수정된 자막은 비교 적용하지 않습니다.")}</p>
              <button disabled={busy || !media || !target} onClick={() => target && listen(target, "target")}>{t("선택한 트랙 듣기")}</button>
              <label className="speech-tools-check"><input type="checkbox" checked={targetConfirmed} disabled={busy || heard !== "target" || preview?.captionId !== target?.id}
                onChange={event => setTargetConfirmed(event.target.checked)}/>{t("이 구간을 끝까지 들었고 한 사람만 말하는 것을 확인했습니다.")}</label>
              <button disabled={busy || !media || !target || !targetConfirmed || heard !== "target" || !enoughSpeakers || !status?.voice.ready} onClick={compare}>{t("목소리로 후보 비교")}</button>
            </section>
          </div>
          {preview && <div className="speech-tools-preview"><strong>{t("선택 트랙 원음")} · #{track} · {formatTime(preview.start)}–{formatTime(preview.end)}</strong>
            <audio key={preview.url} ref={audio} src={preview.url} controls preload="metadata" aria-label={t("선택 트랙 원음")}
              onPlay={() => { playbackStarted.current = true; }} onEnded={event => { if (playbackStarted.current && heardWholePreview(event.currentTarget)) setHeard(preview.purpose); }}/>
            <p className="muted">{t("원음 전체를 들은 뒤 인물 확인을 선택할 수 있습니다.")}</p>
          </div>}
          <p className="muted">{t("코사인 유사도는 확률이 아닙니다. 0.75 이상·다음 후보와 0.15 이상 차이를 검토 기준으로 사용하며 실제 자료에 보정되지 않았습니다.")}</p>
          {voiceView && <section className="speech-tools-card speech-tools-result" aria-label={t("음성 비교 결과")}>
            <h3>{t("음성 비교 결과")}</h3>
            {!!ranked.length && <table className="speech-tools-scores"><thead><tr><th>{t("인물")}</th><th>{t("코사인 유사도")}</th></tr></thead><tbody>{ranked.map(score => <tr key={score.speakerId}><td>{speakerName(score.speakerId)}</td><td>{score.similarity.toFixed(3)}</td></tr>)}</tbody></table>}
            {ranked.length >= 2 && <p>{t("다음 후보와 차이")}: {(ranked[0]!.similarity - ranked[1]!.similarity).toFixed(3)}</p>}
            {!canApplyVoice && <p>{t("음향 조건을 만족한 후보가 없습니다. 원음을 확인해 직접 배정하세요.")}</p>}
            <p className="muted">{t("화자만 수동 배정하며 원문·시간을 유지합니다. 실행 취소할 수 있습니다.")}</p>
            <button className="primary" disabled={busy || !canApplyVoice} onClick={() => {
              try { onApplyVoice(voiceView.snapshot, voiceView.result, voiceView.captionId); } catch (failure) { setError((failure as Error).message); }
            }}>{t("선택 자막에 후보 적용")}</button>
          </section>}
        </section> : <section role="tabpanel" id={`${tabId}-overlap`} aria-labelledby={`${tabId}-overlap-tab`}>
          <p className="dialog-intro">{t("혼합된 두 목소리를 CPU에서 분리해 다시 전사하는 실험입니다. 잔향·누출·잘못된 단어가 생길 수 있으므로 각 음성을 듣고 선택하세요.")}</p>
          <p className="info-box">{t("동시 2인용 실험 모델입니다. 한국어·게임 효과음의 복원 품질은 검증되지 않았습니다.")}</p>
          <div className="speech-tools-fields">
            <label>{t("복원 시작 (초)")}<input type="number" min={0} max={project.duration} step={.01} value={Number.isFinite(range.start) ? range.start : ""} onChange={event => { clear(true); setRange(previous => ({ ...previous, start: event.target.valueAsNumber })); }}/></label>
            <label>{t("복원 끝 (초)")}<input type="number" min={0} max={project.duration} step={.01} value={Number.isFinite(range.end) ? range.end : ""} onChange={event => { clear(true); setRange(previous => ({ ...previous, end: event.target.valueAsNumber })); }}/></label>
            <label>{t("복원 전사 모델")}<select value={whisperModel} onChange={event => { clear(true); setWhisperModel(event.target.value); }}>{["tiny", "base", "small", "medium", "large-v3", "large-v3-turbo"].map(model => <option key={model} value={model}>{model === "large-v3-turbo" ? "turbo" : model}</option>)}</select></label>
            <label>{t("복원 언어")}<select value={language} onChange={event => { clear(true); setLanguage(event.target.value); }}><option value="auto">{t("자동 감지")}</option><option value="ko">한국어</option><option value="en">English</option><option value="ja">日本語</option><option value="zh">中文</option><option value="es">Español</option></select></label>
          </div>
          <p className="muted">{t("원본 시간 기준 2~20초를 선택하세요.")}</p>
          <label>{t("복원 어휘 힌트")}<textarea rows={2} maxLength={2000} value={vocabulary} onChange={event => { clear(true); setVocabulary(event.target.value); }}/></label>
          <p className="muted">{t("최대 50개 · 용어당 50자 · 전체 2,000자. 인식 결과의 정확한 표기를 보장하지 않습니다.")}</p>
          {vocabulary !== savedVocabularyText && <p className="info-box">{t("이 어휘 변경은 이번 복원에만 사용하며 프로젝트 사전에는 저장하지 않습니다.")}</p>}
          <div className="speech-tools-actions"><button disabled={busy || !status?.overlap.runtimeAvailable} onClick={() => prepare("prepare-overlap")}>{t("겹침·전사 모델 준비")}</button>
            <button className="primary" disabled={busy || !media || !rangeValid || !status?.overlap.ready || preparedWhisper !== whisperModel} onClick={recover}>{t("선택 구간 겹침 복원")}</button></div>
          {overlapView && <section className="speech-tools-result" aria-label={t("복원 결과 비교")}>
            <h3>{t("복원 결과 비교")}</h3>
            <strong>{t("선택 트랙 원음")}</strong><audio src={overlapView.result.originalUrl} controls preload="metadata" aria-label={t("선택 트랙 원음")}/>
            <p className="muted">{t("분리 순서는 인물 번호가 아닙니다. 각 대사를 듣고 인물을 직접 선택하세요.")}</p>
            <div className="speech-tools-grid">{overlapView.result.streams.map(stream => <section key={stream.index} className="speech-tools-card">
              <h4>{t("분리 음성 {number}", { number: stream.index + 1 })}</h4><audio src={stream.audioUrl} controls preload="metadata" aria-label={t("분리 음성 {number}", { number: stream.index + 1 })}/>
              <div className="speech-tools-recovered">{stream.captions.map(caption => {
                const key = `${stream.index}:${caption.id}`, choice = choices[key];
                return <div key={caption.id} className="speech-tools-recovered-row"><input type="checkbox" checked={!!choice} aria-label={`${t("복원 자막 선택")} · ${formatTime(caption.start)} · ${caption.text}`} onChange={event => {
                  const checked = event.target.checked;
                  setChoices(previous => { const next = { ...previous }; if (checked) next[key] = { streamIndex: stream.index, captionId: caption.id, speakerId: null }; else delete next[key]; return next; });
                }}/><div><p className="speech-tools-caption">{formatTime(caption.start)}–{formatTime(caption.end)}<br/>{caption.text}</p>
                  <label>{t("인물")}<select value={choice?.speakerId ?? ""} disabled={!choice} onChange={event => { const speakerId = event.target.value || null; setChoices(previous => ({ ...previous, [key]: { streamIndex: stream.index, captionId: caption.id, speakerId } })); }}><option value="">{t("미배정으로 유지")}</option>{project.speakers.map(speaker => <option key={speaker.id} value={speaker.id}>{speaker.name}</option>)}</select></label>
                </div></div>;
              })}</div>
            </section>)}</div>
            {!!overlapView.result.warnings.length && <ul className="muted">{overlapView.result.warnings.map((warning, index) => <li key={index}>{t(warning)}</li>)}</ul>}
            <p className="muted">{t("기존 자막을 유지하고 선택한 복원 자막만 검토 대상으로 추가합니다. 실행 취소할 수 있습니다.")}</p>
            <button className="primary" disabled={busy || !selectedChoices.length} onClick={() => {
              try { onApplyOverlap(overlapView.snapshot, overlapView.result, selectedChoices); } catch (failure) { setError((failure as Error).message); }
            }}>{t("선택한 복원 자막 {count}개 추가", { count: selectedChoices.length })}</button>
          </section>}
        </section>}
      </div>
      <div className="dialog-actions"><button onClick={close}>{t("결과를 적용하지 않고 닫기")}</button></div>
    </div>
  </Dialog>;
}
