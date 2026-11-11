import { useMemo, useState } from "react";
import { formatTime, parseTime, type Caption, type Project } from "../domain";
import { planCaptionMerge, planCaptionSplit, type MergePlan, type SplitPlan } from "../captionRestructure";
import { useI18n } from "../i18n";
import { Dialog } from "./Dialog";
import "./caption-restructure.css";

function Preview({ text, start, end }: { text: string; start: number; end: number }) {
  return <div className="caption-change-preview"><small>{formatTime(start)} → {formatTime(end)}</small><p>{text}</p></div>;
}

export function CaptionSplitDialog({ caption, mode: initialMode, cursor, time: playhead, onApply, onClose }: {
  caption: Caption; mode: "cursor" | "time"; cursor?: number; time: number;
  onApply: (plan: SplitPlan) => void; onClose: () => void;
}) {
  const { t } = useI18n();
  const [mode, setMode] = useState(initialMode);
  const [offset, setOffset] = useState(cursor ?? -1);
  const [time, setTime] = useState(formatTime(playhead));
  const [manualTime, setManualTime] = useState<string | null>(null);
  const { result, error } = useMemo(() => {
    try { return { result: planCaptionSplit(caption, mode === "cursor" ? { kind: "cursor", offset, ...(manualTime !== null ? { time: parseTime(manualTime) } : {}) } : { kind: "time", time: parseTime(time) }), error: "" }; }
    catch (issue) { return { result: undefined, error: (issue as Error).message }; }
  }, [caption, mode, offset, time, manualTime]);
  return <Dialog title={t("자막 나누기")} onClose={onClose}>
    <div className="caption-change-controls" role="group" aria-label={t("나누는 기준")}>
      <button aria-pressed={mode === "cursor"} onClick={() => setMode("cursor")}>{t("커서 위치에서 나누기")}</button>
      <button aria-pressed={mode === "time"} onClick={() => setMode("time")}>{t("재생 시점에서 나누기")}</button>
    </div>
    {mode === "cursor" && <label className="caption-change-field">{t("아래 글자 사이를 클릭하여 분할 위치를 정하세요.")}
      <textarea aria-label={t("분할 위치 선택")} readOnly value={caption.text} rows={4}
        onSelect={event => { const input = event.currentTarget; setOffset(input.selectionStart === input.selectionEnd ? input.selectionStart : -1); setManualTime(null); }} />
    </label>}
    <label className="caption-change-field">{t("분할 시간")}
      <div className="caption-change-controls"><input aria-label={t("분할 시간")} value={mode === "cursor" ? manualTime ?? (result ? formatTime(result.time) : "") : time}
        onChange={event => mode === "cursor" ? setManualTime(event.target.value) : setTime(event.target.value)} placeholder="00:00:00.000" />
        <button onClick={() => mode === "cursor" ? setManualTime(formatTime(playhead)) : setTime(formatTime(playhead))}>{t("현재 재생 시간 사용")}</button></div>
    </label>
    <p className="muted">{formatTime(caption.start)} → {formatTime(caption.end)}</p>
    {error && <p className="caption-change-error" role="status">{t(error)}</p>}
    {result && <>
      <p className="muted">{t(result.timing === "words" ? "단어 시각을 기준으로 나눕니다." : result.timing === "estimated" ? "글자 수로 추정한 시간입니다. 분할 시간을 직접 조절할 수 있습니다." : "지정한 시간에 나눕니다. 양쪽 문구를 확인하세요.")}</p>
      <div className="caption-change-previews" aria-label={t("분할 결과 미리보기")}>
        <Preview text={result.left} start={caption.start} end={result.time}/><Preview text={result.right} start={result.time} end={caption.end}/>
      </div>
    </>}
    <p className="muted">{t("적용 후 실행 취소 한 번으로 되돌릴 수 있습니다.")}</p>
    <div className="dialog-actions"><button onClick={onClose}>{t("취소")}</button><button className="primary" disabled={!result} onClick={() => result && onApply(result)}>{t("나누기 적용")}</button></div>
  </Dialog>;
}

export function CaptionMergeDialog({ project, captions, onApply, onClose }: {
  project: Project; captions: Caption[]; onApply: (plan: MergePlan) => void; onClose: () => void;
}) {
  const { t } = useI18n();
  const mixed = new Set(captions.map(caption => caption.speakerId)).size > 1;
  const [speaker, setSpeaker] = useState(mixed ? "choose" : captions[0]!.speakerId ?? "");
  const [separator, setSeparator] = useState<"auto" | "space" | "newline" | "none">("auto");
  const { result, error } = useMemo(() => {
    try { return { result: planCaptionMerge(project, captions.map(caption => caption.id), speaker === "choose" ? captions[0]!.speakerId : speaker || null, separator), error: "" }; }
    catch (issue) { return { result: undefined, error: (issue as Error).message }; }
  }, [project, captions, speaker, separator]);
  return <Dialog title={t("자막 합치기")} onClose={onClose}>
    <p>{t("선택한 {count}개 자막을 하나로 합칩니다.", { count: captions.length })}</p>
    <div className="caption-change-fields">
      <label className="caption-change-field">{t("합친 자막의 인물")}<select aria-label={t("합친 자막의 인물")} value={speaker} onChange={event => setSpeaker(event.target.value)}>
        {mixed && <option value="choose" disabled>{t("인물을 선택하세요")}</option>}<option value="">{t("미배정")}</option>
        {project.speakers.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
      <label className="caption-change-field">{t("문구 연결 방식")}<select aria-label={t("문구 연결 방식")} value={separator} onChange={event => setSeparator(event.target.value as typeof separator)}>
        <option value="auto">{t("공백 자동 연결")}</option><option value="space">{t("공백 추가")}</option><option value="newline">{t("줄바꿈 추가")}</option><option value="none">{t("바로 붙이기")}</option>
      </select></label>
    </div>
    {mixed && <p className="caption-change-warning">{t("서로 다른 인물의 자막입니다. 합친 뒤 사용할 인물을 선택하세요.")}</p>}
    {result && <>
      {result.gap > 0 && <p className="caption-change-warning">{t("자막 사이 최대 {seconds}초의 빈 구간도 포함됩니다.", { seconds: result.gap.toFixed(3) })}</p>}
      {result.overlap && <p className="caption-change-warning">{t("시간이 겹치는 자막이 포함되어 있습니다.")}</p>}
      <div aria-label={t("병합 결과 미리보기")}><Preview text={result.result.text} start={result.result.start} end={result.result.end}/></div>
    </>}
    {error && <p className="caption-change-error" role="alert">{t(error)}</p>}
    <p className="muted">{t("첫 자막의 스타일을 유지합니다. 적용 후 실행 취소 한 번으로 되돌릴 수 있습니다.")}</p>
    <div className="dialog-actions"><button onClick={onClose}>{t("취소")}</button><button className="primary" disabled={!result || speaker === "choose"} onClick={() => result && onApply(result)}>{t("합치기 적용")}</button></div>
  </Dialog>;
}
