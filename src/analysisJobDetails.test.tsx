import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Job } from "./api";
import type { BackgroundJobSnapshot } from "./backgroundJob";
import { AnalysisJobDetails } from "./components/AnalysisJobDetails";
import { BackgroundJobDialog } from "./components/BackgroundJobStatus";
import { createProject } from "./domain";
import { I18nProvider, LOCALE_STORAGE_KEY, LOCALES, translate } from "./i18n";

const job = (patch: Partial<Job> = {}): Job => ({
  id: "a".repeat(32), status: "completed", stage: "completed", progress: 1,
  recognitionPreview: { lines: ["Last <draft>"], updatedAt: "2026-09-25T00:00:00Z" },
  result: { captions: [], speakers: [], duration: 1, warnings: ["Processing notice", "Review warning"] },
  ...patch,
});
const render = (value: Job) => renderToStaticMarkup(<I18nProvider><AnalysisJobDetails job={value} /></I18nProvider>);
const details = (html: string) => html.match(/<details\b[^>]*>[\s\S]*?<\/details>/g) ?? [];
afterEach(() => vi.unstubAllGlobals());

describe("completed analysis details", () => {
  it("starts collapsed using a native keyboard-accessible summary and keeps the entire draft and notices", () => {
    const value = job(), before = JSON.stringify(value);
    const html = render(value);
    expect(details(html)).toHaveLength(1);
    expect(html).toContain('<details class="analysis-job-details"><summary>상세 보기</summary>');
    expect(html).not.toMatch(/<details[^>]*\bopen\b/);
    expect(html).toContain("Last &lt;draft&gt;");
    expect(html).toContain("Processing notice");
    expect(html).toContain("Review warning");
    expect(JSON.stringify(value)).toBe(before);
  });

  it.each(["queued", "running", "failed", "cancelled"] as const)("does not collapse the %s draft or notices", status => {
    const html = render(job({ status }));
    expect(html).not.toContain("<details");
    expect(html).toContain("Last &lt;draft&gt;");
    expect(html).toContain("Processing notice");
  });

  it("omits an empty completed disclosure, but retains warning-only and draft-only disclosures", () => {
    expect(render(job({ recognitionPreview: undefined, result: undefined }))).toBe("");
    expect(render(job({ recognitionPreview: undefined, result: { captions: [], speakers: [], duration: 1, warnings: [] } }))).toBe("");
    expect(details(render(job({ recognitionPreview: undefined })))).toHaveLength(1);
    expect(details(render(job({ result: undefined })))).toHaveLength(1);
  });

  it.each(LOCALES)("localizes the disclosure in %s", locale => {
    vi.stubGlobal("localStorage", { getItem: (key: string) => key === LOCALE_STORAGE_KEY ? locale : null });
    expect(render(job())).toContain(`<summary>${translate(locale, "상세 보기")}</summary>`);
  });

  it("keeps result totals, JSON export, source verification, apply and errors outside the disclosure", () => {
    const snapshot: BackgroundJobSnapshot = {
      pointer: { id: "a".repeat(32), projectId: "original", projectName: "QA", mediaId: "b".repeat(32), mediaName: "audio.wav" },
      job: job({ error: "Visible result error" }), paused: false, missing: false,
    };
    const html = renderToStaticMarkup(<I18nProvider><BackgroundJobDialog snapshot={snapshot} project={createProject(2)} file={null} onClose={() => {}} onApply={() => {}} onRetry={() => {}} /></I18nProvider>);
    const hidden = details(html).join("");
    const visible = html.replace(/<details\b[^>]*>[\s\S]*?<\/details>/g, "");
    expect(hidden).toContain("Processing notice");
    expect(hidden).toContain("Last &lt;draft&gt;");
    for (const text of ["자막 0개 · 감지된 인물 0명", "분석 결과 JSON 저장", "연결된 원본 확인", "Visible result error"]) {
      expect(visible).toContain(text);
      expect(hidden).not.toContain(text);
    }
    expect(hidden).not.toContain("<button");
    expect(visible).toContain('class="primary" disabled="">결과 적용');
  });
});
