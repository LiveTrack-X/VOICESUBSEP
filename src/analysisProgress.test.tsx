import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Job } from "./api";
import { elapsedClock, jobElapsedSeconds, recognitionPreviewLines } from "./analysisProgress";
import { RecognitionPreview } from "./components/RecognitionPreview";
import { I18nProvider } from "./i18n";

const job = (patch: Partial<Job> = {}): Job => ({ id: "a", status: "running", stage: "대사 전사", progress: .2, ...patch });
const render = (value: Job) => renderToStaticMarkup(<I18nProvider><RecognitionPreview job={value}/></I18nProvider>);

describe("recognition draft display", () => {
  it("keeps only the current job's latest two bounded Unicode segments without mutating it", () => {
    const value = job({recognitionPreview:{lines:["first", "second\n\u0000line", "😀".repeat(520)], updatedAt:"2026-09-25T00:00:05Z"}});
    const before = JSON.stringify(value);
    const lines = recognitionPreviewLines(value);
    expect(lines).toEqual(["second line", "😀".repeat(500)]);
    expect(JSON.stringify(value)).toBe(before);
    expect(recognitionPreviewLines(job({id:"b"}))).toEqual([]);
  });

  it("shows honest pre-segment waiting text for old records with no preview or timestamps", () => {
    const html = render(job({stage:"preparing"}));
    expect(html).toContain("아직 인식된 구간이 없습니다.");
    expect(html).toContain("경과 시간은 대기 시간을 포함");
    expect(html).not.toContain("요청 후 경과");
    expect(html).not.toContain("마지막 인식 수신");
  });

  it("escapes recognized text and labels it provisional without adding application actions", () => {
    const html = render(job({recognitionPreview:{lines:["<script>test</script>", "second"],updatedAt:"2026-09-25T00:00:05Z"}}));
    expect(html).toContain("&lt;script&gt;test&lt;/script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain('role="log"');
    expect(html).toContain("문구·인물은 미확정");
    expect(html).not.toContain("<button");
  });

  it.each(["failed", "cancelled", "completed"] as const)("retains only a labelled last draft for %s", status => {
    const html = render(job({status,recognitionPreview:{lines:["last draft"],updatedAt:"bad"}}));
    expect(html).toContain("마지막 인식 초안");
    expect(html).toContain("last draft");
    expect(html).not.toContain("인식 중인 초안");
    expect(html).not.toContain("마지막 인식 수신");
    expect(render(job({status}))).toBe("");
  });

  it("tolerates malformed optional preview data from old or incompatible servers", () => {
    expect(recognitionPreviewLines(job({recognitionPreview:{lines:null,updatedAt:"bad"} as unknown as Job["recognitionPreview"]}))).toEqual([]);
    expect(recognitionPreviewLines(job({recognitionPreview:{lines:[{}," \n "],updatedAt:"bad"} as unknown as Job["recognitionPreview"]}))).toEqual([]);
  });

  it("labels preview timestamps as clock time and treats equivalent UTC offsets identically", () => {
    const preview = { lines: ["draft"], updatedAt: "2026-09-25T09:33:50Z" };
    const utc = render(job({ recognitionPreview: preview }));
    const localOffset = render(job({ recognitionPreview: { ...preview, updatedAt: "2026-09-25T18:33:50+09:00" } }));
    expect(utc).toBe(localOffset);
    expect(utc).toContain("마지막 결과 갱신 시각:");
    expect(utc).not.toContain("마지막 인식 수신");
    expect(utc).not.toContain("요청 후 경과");
  });
});

describe("analysis elapsed time is not simulated progress", () => {
  const start = "2026-09-25T01:00:00Z";
  it("counts real request/queue time while active regardless of unchanged progress", () => {
    const value = job({createdAt:start,status:"queued",progress:0});
    expect(jobElapsedSeconds(value,Date.parse(start)+65_000)).toBe(65);
    expect(elapsedClock(65)).toBe("01:05");
    expect(elapsedClock(3605)).toBe("1:00:05");
    expect(value.progress).toBe(0);
  });
  it("freezes terminal duration at the server update timestamp", () => {
    const value = job({createdAt:start,updatedAt:"2026-09-25T01:00:09Z",status:"cancelled"});
    expect(jobElapsedSeconds(value,Date.parse(start)+999_000)).toBe(9);
    expect(jobElapsedSeconds({...value,updatedAt:undefined},Date.now())).toBeUndefined();
  });
  it("omits invalid/missing timestamps and clamps clock differences", () => {
    expect(jobElapsedSeconds(job(),Date.now())).toBeUndefined();
    expect(jobElapsedSeconds(job({createdAt:"bad"}),Date.now())).toBeUndefined();
    expect(jobElapsedSeconds(job({createdAt:start}),NaN)).toBeUndefined();
    expect(jobElapsedSeconds(job({createdAt:start}),Date.parse(start)-1000)).toBe(0);
  });
});
