import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ApiError, type Job } from "./api";
import { priorityRequest, prioritizeAnalysis, queueError } from "./jobQueue";
import { jobStageLabel } from "./jobStage";
import { AnalysisQueueControls } from "./components/AnalysisQueueControls";
import { I18nProvider } from "./i18n";
import { queueMessages } from "./i18n-queue";
const blocker={id:"b".repeat(32),projectName:"Previous project",mediaName:"First.wav",stage:"preparing",progress:.43,cancelRequested:false};
const queued:Job={id:"a".repeat(32),status:"queued",stage:"queued",progress:0,queue:{position:2,waitingCount:3,workerAvailable:true,blockingJob:blocker}};
const markup=(job:Job)=>renderToStaticMarkup(<I18nProvider><AnalysisQueueControls job={job} onUpdated={()=>{}}/></I18nProvider>);
afterEach(()=>vi.unstubAllGlobals());
describe("analysis queue controls",()=>{
  it("shows the actual predecessor and order, and does not issue a request by rendering",()=>{
    const fetch=vi.fn();vi.stubGlobal("fetch",fetch);const html=markup(queued);
    expect(html).toContain("대기 순서 2 / 3");expect(html).toContain("Previous project · First.wav");expect(html).toContain("43%");expect(html).toContain("분석을 준비하고 있습니다.");expect(html).toContain("이 작업을 다음으로");expect(fetch).not.toHaveBeenCalled();
  });
  it("has no cancellation action without a running predecessor or when already stopping",()=>{
    expect(markup({...queued,queue:{...queued.queue!,blockingJob:null}})).not.toContain("현재 작업 중단 후 우선 실행");
    const html=markup({...queued,queue:{...queued.queue!,blockingJob:{...blocker,cancelRequested:true}}});
    expect(html).toContain("중단 처리 중입니다.");expect(html).toContain('disabled="">현재 작업 중단 후 우선 실행');
  });
  it("leaves unsupported old-server queues and unavailable workers honest",()=>{
    expect(markup({...queued,queue:undefined})).toContain("대기 순서를 확인하고 있습니다.");
    const html=markup({...queued,queue:{...queued.queue!,workerAvailable:false}});
    expect(html).toContain("분석 실행기가 준비되지 않아 대기 중입니다.");expect(html).toContain('disabled="">이 작업을 다음으로');
  });
  it("requires the exact user-confirmed running ID before requesting cancellation",()=>{
    expect(priorityRequest(queued)).toEqual({cancelRunning:false});
    expect(priorityRequest(queued,blocker.id)).toEqual({cancelRunning:true,expectedRunningJobId:blocker.id});
    for(const current of [{...queued,status:"running" as const},{...queued,queue:undefined},{...queued,queue:{...queued.queue!,workerAvailable:false}},{...queued,queue:{...queued.queue!,blockingJob:null}},{...queued,queue:{...queued.queue!,blockingJob:{...blocker,id:"c".repeat(32)}}},{...queued,queue:{...queued.queue!,blockingJob:{...blocker,cancelRequested:true}}}])expect(()=>priorityRequest(current,blocker.id)).toThrow("queue-changed");
  });
  it("sends only a bounded priority request with the confirmed identity, without deleting jobs",async()=>{
    const fetch=vi.fn(async()=>new Response(JSON.stringify(queued),{status:200}));vi.stubGlobal("fetch",fetch);
    await prioritizeAnalysis(queued,blocker.id);
    expect(fetch).toHaveBeenCalledWith(`/api/jobs/${queued.id}/prioritize`,expect.objectContaining({method:"POST",body:JSON.stringify({cancelRunning:true,expectedRunningJobId:blocker.id})}));
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("rejects a mismatched response and never reports an uncertain request as successful",async()=>{
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({...queued,id:blocker.id}),{status:200})));
    await expect(prioritizeAnalysis(queued)).rejects.toThrow("queue-changed");
    expect(queueError(new ApiError("private detail",409))).toContain("대기열이 변경");expect(queueError(new ApiError("private detail",503))).toContain("실행기가 준비");expect(queueError(new Error("secret"))).not.toContain("secret");
  });
  it("shows cooperative stopping without promising an immediate restart",()=>{
    const html=markup({...queued,status:"running",cancelRequested:true});expect(html).toContain("즉시 중단되지 않을 수 있습니다.");expect(html).not.toContain("이 작업을 다음으로");
    expect(jobStageLabel("cancellation requested")).toBe("현재 처리 단계가 끝나면 취소합니다.");expect(jobStageLabel("custom engine stage")).toBe("custom engine stage");expect(jobStageLabel("__proto__")).toBe("__proto__");
  });
  it("provides complete four translated locales while preserving named placeholders",()=>{
    const slots=(text:string)=>[...text.matchAll(/\{\w+\}/g)].map(match=>match[0]).sort();
    for(const [key,translations]of Object.entries(queueMessages)){expect(translations).toHaveLength(4);for(const value of translations){expect(value).toBeTruthy();expect(value).not.toMatch(/[가-힣]/);expect(slots(value)).toEqual(slots(key));}}
  });
});
