import { useLayoutEffect, useMemo, useState } from "react";
import { Check, Play, RefreshCw, Square } from "lucide-react";
import { formatTime, type Project } from "../domain";
import { useI18n } from "../i18n";
import { useCaptionVirtualList } from "../useCaptionVirtualList";
import { checkSpeakerRecommendation, speakerCauseCounts, speakerCauses, speakerReviewRange,
  SPEAKER_CAUSES, SPEAKER_CAUSE_LABELS, SPEAKER_REVIEW_STALE, type SpeakerCause, type SpeakerReviewSnapshot } from "../speakerReview";
import { Dialog } from "./Dialog";
import "./speaker-review.css";

export function SpeakerReviewDialog({ project, session, mediaAvailable, playing, onListen, onStop, onApply, onClose }: {
  project: Project; session: number; mediaAvailable: boolean; playing: boolean;
  onListen: (start: number, end: number, captionId: string) => void; onStop: () => void;
  onApply: (snapshot: SpeakerReviewSnapshot, ids: ReadonlySet<string>) => void; onClose: () => void;
}) {
  const { t } = useI18n();
  const [snapshot, setSnapshot] = useState<SpeakerReviewSnapshot>(() => ({ project, session }));
  const [cause, setCause] = useState<SpeakerCause | "all">("all");
  const [onlyRecommended, setOnlyRecommended] = useState(false);
  const [selected, setSelected] = useState<string | null>(() => project.captions.find(caption => caption.speakerId === null)?.id ?? null);
  const [focused, setFocused] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState("");
  const stale = snapshot.project !== project || snapshot.session !== session;
  const view = snapshot.project;
  const indexes = useMemo(() => ({ captions: new Map(view.captions.map(caption => [caption.id, caption])),
    speakers: new Map(view.speakers.map(speaker => [speaker.id, speaker])) }), [view]);
  const unassigned = useMemo(() => view.captions.filter(caption => caption.speakerId === null).sort((a, b) => a.start - b.start || a.end - b.end), [view]);
  const checks = useMemo(() => new Map(unassigned.map(caption => [caption.id, checkSpeakerRecommendation(view, caption, indexes.captions)])), [unassigned, view, indexes]);
  const counts = useMemo(() => speakerCauseCounts(unassigned), [unassigned]);
  const eligibleCount = [...checks.values()].filter(check => check.eligible).length;
  const visible = useMemo(() => unassigned.filter(caption => (cause === "all" || speakerCauses(caption).includes(cause))
    && (!onlyRecommended || checks.get(caption.id)?.eligible)), [unassigned, cause, onlyRecommended, checks]);
  const ids = useMemo(() => visible.map(caption => caption.id), [visible]);
  const virtual = useCaptionVirtualList(ids, `${view.id}:${snapshot.session}`, "comfortable", focused, setFocused);
  useLayoutEffect(() => {
    if (!selected || !visible.some(caption => caption.id === selected)) setSelected(visible[0]?.id ?? null);
  }, [visible, selected]);
  const caption = selected ? indexes.captions.get(selected) : undefined;
  const evidence = caption?.speakerEvidence, candidate = evidence?.recommendation;
  const check = caption ? checks.get(caption.id) : undefined;
  const name = (id: string) => indexes.speakers.get(id)?.name || t("이름 없음");
  function resetFilters(nextCause: SpeakerCause | "all", recommended: boolean) {
    setCause(nextCause); setOnlyRecommended(recommended); setChecked(new Set()); virtual.reset();
  }
  function refresh() {
    onStop(); setSnapshot({ project, session }); setChecked(new Set()); setSelected(null); setError(""); virtual.reset();
  }
  function listen(id: string) {
    const cue = indexes.captions.get(id);
    if (!cue || stale || !mediaAvailable) return;
    const range = speakerReviewRange(cue, view.duration);
    onListen(range.start, range.end, cue.id);
  }
  function close() { onStop(); onClose(); }
  return <Dialog title={t("미배정 보완 검토")} onClose={close}>
    <div className="speaker-review">
      <div className="speaker-review-scroll">
      <p className="dialog-intro">{t("분석 근거로 추천한 인물입니다. 원음과 근거를 듣고 선택한 자막에만 적용하세요. 자동 확정하지 않습니다.")}</p>
      <p className="muted">{t("기존 결과에 근거가 없으면 원인 상세 없음으로 표시합니다. 이 창은 새 분석이나 모델 다운로드를 실행하지 않습니다.")}</p>
      {unassigned.length > 0 && unassigned.every(caption => !caption.speakerEvidence) && <p className="info-box">{t("이전 결과에는 화자 활동 근거가 없습니다. 새 분석부터 후보가 생성됩니다.")}</p>}
      {(stale || error) && <p className="error-box" role="alert">{t(stale ? SPEAKER_REVIEW_STALE : error)}</p>}
      <div className="speaker-review-filters">
        <label>{t("미배정 원인")}
          <select value={cause} onChange={event => resetFilters(event.target.value as SpeakerCause | "all", onlyRecommended)}>
            <option value="all">{t("전체 미배정 {count}개", { count: unassigned.length })}</option>
            {SPEAKER_CAUSES.map(reason => <option key={reason} value={reason}>{t(SPEAKER_CAUSE_LABELS[reason])} ({counts[reason]})</option>)}
          </select>
        </label>
        <label className="speaker-review-check"><input type="checkbox" checked={onlyRecommended} onChange={event => resetFilters(cause, event.target.checked)}/>{t("적용 가능한 추천 {count}개", { count: eligibleCount })}</label>
        <button onClick={refresh}><RefreshCw size={14}/>{t("다시 확인")}</button>
      </div>
      <p className="muted">{t("한 자막에 원인이 여러 개면 각 집계에 포함됩니다. 수동 수정·검수 완료·이미 배정된 자막은 보호합니다.")}</p>
      <div className="speaker-review-body">
        <div className="speaker-review-list" ref={virtual.listRef} onFocusCapture={virtual.onFocusCapture} onBlurCapture={virtual.onBlurCapture}>
          {!visible.length ? <p className="speaker-review-empty">{t("조건에 맞는 자막이 없습니다")}</p> : <div role="list" aria-label={t("미배정 자막 목록")} style={{ position: "relative", height: virtual.layout.total }}>
            {virtual.indexes.map(index => {
              const cue = visible[index]!, state = checks.get(cue.id)!;
              return <div key={cue.id} role="listitem" ref={virtual.rowRef(cue.id)} data-caption-id={cue.id}
                aria-posinset={index + 1} aria-setsize={visible.length} className={`speaker-review-row${selected === cue.id ? " selected" : ""}`}
                style={{ transform: `translateY(${virtual.layout.offsets[index]}px)` }}>
                <input type="checkbox" aria-label={t("{time} 후보 선택", { time: formatTime(cue.start) })}
                  disabled={stale || !state.eligible} checked={checked.has(cue.id)} onChange={event => {
                    setSelected(cue.id); setChecked(previous => { const next = new Set(previous); if (event.target.checked) next.add(cue.id); else next.delete(cue.id); return next; });
                  }}/>
                <button className="speaker-review-row-button" aria-pressed={selected === cue.id} onClick={() => setSelected(cue.id)}>
                  <strong>{formatTime(cue.start)} · {cue.text || t("자막")}</strong>
                  <span>{speakerCauses(cue).map(reason => t(SPEAKER_CAUSE_LABELS[reason])).join(" · ")}</span>
                  {state.eligible && <span className="speaker-review-proposal">{t("추천 인물: {name}", { name: name(state.speakerId) })}</span>}
                </button>
              </div>;
            })}
          </div>}
        </div>
        <section className="speaker-review-detail" aria-label={t("선택 자막의 배정 근거")}>
          {!caption ? <p>{t("목록에서 자막을 선택하세요.")}</p> : <>
            <h3>{formatTime(caption.start)} — {formatTime(caption.end)}</h3>
            <p className="speaker-review-text">{caption.text}</p>
            <div className="speaker-review-listen"><button disabled={!mediaAvailable || stale} onClick={() => listen(caption.id)}><Play size={14}/>{t("앞뒤 1.5초 함께 듣기")}</button>
              <button disabled={!playing} onClick={onStop}><Square size={13}/>{t("재생 중지")}</button></div>
            {!mediaAvailable && <p className="muted">{t("원음을 들으려면 원본 미디어를 연결하세요.")}</p>}
            {check && !check.eligible && <p className="info-box">{t(check.reason)}</p>}
            {!evidence ? <p>{t("원인 상세 없음")}</p> : <>
              <h4>{t("분석 당시 검출 활동")}</h4>
              <p className="muted">{t("비율은 단어 시간과 검출 활동의 중첩량이며 인물 정답 확률이 아닙니다.")}</p>
              {!evidence.activity.length ? <p>{t(evidence.activityTruncated ? "활동 상세 생략" : "화자 활동 없음")}</p> : <ul className="speaker-review-activity">{evidence.activity.map(activity => <li key={activity.speakerId}>
                {name(activity.speakerId)} · {activity.overlapSeconds.toFixed(3)}s · {(activity.coverage * 100).toFixed(1)}%
              </li>)}</ul>}
              {(evidence.wordsTruncated || evidence.activityTruncated) && <p className="muted">{t("근거 상세가 일부 생략되어 이 후보는 선택 적용할 수 없습니다.")}</p>}
              {candidate && <>
                <h4>{t("추천 인물: {name}", { name: name(candidate.speakerId) })}</h4>
                <p>{t("단독 검출 활동과 인접 단어의 경계 근거를 비교한 추천입니다. 다른 사람의 짧은 추임새일 수 있습니다.")}</p>
                <h4>{t("근거 대사 듣기")}</h4>
                {candidate.anchorCaptionIds.map(id => { const anchor = indexes.captions.get(id); return anchor ? <div key={id} className="speaker-review-anchor">
                  <p><strong>{name(anchor.speakerId ?? "")}</strong> · {formatTime(anchor.start)}<br/>{anchor.text}</p>
                  <button disabled={!mediaAvailable || stale} onClick={() => listen(id)}><Play size={14}/>{t("근거 대사 듣기")}</button>
                </div> : <p key={id}>{t("근거 자막이 없습니다.")}</p>; })}
              </>}
            </>}
          </>}
        </section>
      </div>
      <p className="muted">{t("적용은 화자만 바꾸고 원문·시간을 유지합니다. 수동 수정으로 표시하며 검수 완료는 직접 선택하세요. 실행 취소로 되돌릴 수 있습니다.")}</p>
      </div>
      <div className="dialog-actions"><button onClick={close}>{t("닫기")}</button>
        <button className="primary" disabled={stale || !checked.size} onClick={() => {
          try { onApply(snapshot, checked); } catch (cause) { setError((cause as Error).message); }
        }}><Check size={15}/>{t("선택한 후보 {count}개 적용", { count: checked.size })}</button></div>
    </div>
  </Dialog>;
}
