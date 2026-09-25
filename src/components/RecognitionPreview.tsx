import { useEffect, useId, useState } from "react";
import type { Job } from "../api";
import { elapsedClock, jobElapsedSeconds, recognitionPreviewLines, validJobTime } from "../analysisProgress";
import { useI18n } from "../i18n";
import "./recognition-preview.css";

export function RecognitionPreview({ job }: { job: Job }) {
  const { t, locale } = useI18n();
  const heading = useId();
  const [now, setNow] = useState(Date.now);
  const active = job.status === "queued" || job.status === "running";
  useEffect(() => {
    setNow(Date.now());
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [job.id, active]);
  const lines = recognitionPreviewLines(job);
  const elapsed = jobElapsedSeconds(job, now);
  const updated = validJobTime(job.recognitionPreview?.updatedAt);
  if (!active && !lines.length) return null;

  return <section className="recognition-preview" aria-labelledby={heading}>
    <header><strong id={heading}>{active ? t("인식 중인 초안") : t("마지막 인식 초안")}</strong>
      {elapsed !== undefined && <span>{t("요청 후 경과 {time}", { time: elapsedClock(elapsed) })}</span>}
    </header>
    <div className="recognition-preview-lines" role="log" aria-live="polite" aria-atomic="true">
      {lines.length ? lines.map((line, index) => <p key={index} title={line}>{line}</p>) :
        <p className="recognition-preview-waiting">{t("아직 인식된 구간이 없습니다. 대기·모델 준비·화자 분석 중에는 초안이 늦게 표시될 수 있습니다.")}</p>}
    </div>
    {!!lines.length && updated !== undefined && <small>{t("마지막 인식 수신 {time}", {
      time: new Date(updated).toLocaleTimeString(locale === "zh" ? "zh-CN" : locale),
    })}</small>}
    <small>{t("최근 인식 구간 최대 2개입니다. 문구·인물은 미확정이며 결과 적용 전까지 자막에 넣지 않습니다.")}</small>
    {active && <small>{t("경과 시간은 대기 시간을 포함하며 인식 결과의 갱신을 뜻하지 않습니다.")}</small>}
  </section>;
}
