import type { Job } from "../api";
import { recognitionPreviewLines } from "../analysisProgress";
import { useI18n } from "../i18n";
import { RecognitionPreview } from "./RecognitionPreview";
import "./analysis-job-details.css";

/** Keep the completed draft and processing notes available without hiding actions or errors. */
export function AnalysisJobDetails({ job, language }: { job: Job; language?: string }) {
  const { t } = useI18n();
  const content = <>
    <RecognitionPreview key={job.id} job={job} language={language} />
    {job.result?.warnings.map((warning, index) => <p className="info-box" key={index}>{warning}</p>)}
  </>;
  if (job.status !== "completed") return content;
  if (!recognitionPreviewLines(job).length && !job.result?.warnings.length) return null;
  return <details className="analysis-job-details" key={job.id}>
    <summary>{t("상세 보기")}</summary>
    <div className="analysis-job-details-content">{content}</div>
  </details>;
}
