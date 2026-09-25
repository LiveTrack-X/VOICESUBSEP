import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BackgroundJobDialog, BackgroundJobStatus } from "./components/BackgroundJobStatus";
import { createProject } from "./domain";
import { I18nProvider } from "./i18n";
import type { BackgroundJobSnapshot } from "./backgroundJob";
const snapshot:BackgroundJobSnapshot={pointer:{id:"a".repeat(32),projectId:"original",projectName:"Original project",mediaId:"b".repeat(32),mediaName:"audio.wav"},job:{id:"a".repeat(32),status:"running",stage:"Recognizing speech",progress:.42},paused:false,missing:false};
describe("persistent progress controls",()=>{
  it("shows the actual stage/progress and a reopen action without a dismiss shortcut for active work",()=>{
    const html=renderToStaticMarkup(<I18nProvider><BackgroundJobStatus snapshot={snapshot} onOpen={()=>{}} onDismiss={()=>{}}/></I18nProvider>);
    expect(html).toContain("42%");expect(html).toContain("Recognizing speech");expect(html).toContain("분석 작업 다시 열기");expect(html).not.toContain("분석 상태 표시 닫기");
  });
  it("can inspect results without a File, while apply remains disabled for a different project",()=>{
    const completed={...snapshot,job:{...snapshot.job!,status:"completed" as const,progress:1,result:{captions:[],speakers:[],duration:1,warnings:[]}}};
    const html=renderToStaticMarkup(<I18nProvider><BackgroundJobDialog snapshot={completed} project={createProject(2)} file={null} onClose={()=>{}} onApply={()=>{}} onRetry={()=>{}}/></I18nProvider>);
    expect(html).toContain("분석 결과 JSON 저장");expect(html).toContain("파일 없이도");expect(html).toContain('class="primary" disabled="">결과 적용');
  });
});
