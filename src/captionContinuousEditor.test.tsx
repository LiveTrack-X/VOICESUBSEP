import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CaptionEditor } from "./components/CaptionEditor";
import { createProject, type Project } from "./domain";
import { I18nProvider } from "./i18n";

function projectWithCaptions(count:number):Project {
  const project=createProject(2);
  project.captions=Array.from({length:count},(_,index)=>({id:`caption-${index}`,start:index*2,end:index*2+1,text:`Caption ${index}`,speakerId:project.speakers[0].id,reasons:[],reviewed:false}));
  return project;
}
function editor(project:Project,selected:string|null=null){
  return renderToStaticMarkup(<I18nProvider><CaptionEditor project={project} update={()=>{}} preview={()=>{}} reveal={null} selected={selected} setSelected={()=>{}} onImport={()=>{}} onError={()=>{}} time={0}/></I18nProvider>);
}
describe("continuous subtitle editor rendering",()=>{
  it("exposes two accessible column boundaries while retaining text, review and bounded rows",()=>{
    const project=projectWithCaptions(2404),before=JSON.stringify(project),html=editor(project,"caption-2200");
    expect(html.match(/role="separator"/g)).toHaveLength(2);
    expect(html).toContain('aria-label="시간 열 너비"');expect(html).toContain('aria-label="인물 열 너비"');
    expect(html.match(/aria-orientation="vertical"/g)).toHaveLength(2);
    expect(html).toContain('aria-controls=');expect(html).toContain('aria-valuenow="106"');
    expect(html).toContain('class="caption-content"');expect(html).toContain('class="caption-review-controls"');
    expect(html.match(/data-caption-id=/g)?.length).toBeLessThan(22);
    expect(JSON.stringify(project)).toBe(before);
  });
  it("renders a full-length scroll surface and a bounded initial row window, without page controls",()=>{
    const project=projectWithCaptions(2404), before=JSON.stringify(project);const html=editor(project);
    expect(html).toContain('class="caption-virtual-space"');expect(html).toContain('aria-setsize="2404"');
    expect(html.match(/data-caption-id=/g)?.length).toBeLessThan(22);
    expect(html).toContain('data-caption-id="caption-0"');expect(html).not.toContain('data-caption-id="caption-100"');
    for(const label of ["이전 페이지","다음 페이지","이 페이지 선택","한 페이지에 최대","caption-pagination"])expect(html).not.toContain(label);
    expect(html).toContain("필터 결과 모두 선택");expect(JSON.stringify(project)).toBe(before);
  });
  it("keeps offscreen selection available to editor actions without rendering the entire preceding list",()=>{
    const html=editor(projectWithCaptions(2404),"caption-2200");
    expect(html).not.toContain('data-caption-id="caption-2200"');
    const split=(html.match(/<button\b[\s\S]*?<\/button>/g)??[]).find(button=>button.includes(">나누기</button>"));
    expect(split).toBeDefined();expect(split).not.toContain("disabled");
    expect(html.match(/data-caption-id=/g)?.length).toBeLessThan(22);
  });
  it("omits unused prepared C/D identities from filter, bulk and row choices and never forces a black/white background",()=>{
    const project=projectWithCaptions(1);project.speakers[0].name="Used A";project.speakers[1].name="Prepared B";
    project.speakers.push({id:"unused-c",name:"Unused C",color:"#000000"},{id:"unused-d",name:"Unused D",color:"#ffffff"});
    const html=editor(project);expect(html).toContain("Prepared B");expect(html).not.toContain("Unused C");expect(html).not.toContain("Unused D");
    expect(html).toContain("background-color:var(--surface)");expect(html).not.toMatch(/background-color:#(?:000000|ffffff)/);
    project.captions[0].speakerId="unused-d";expect(editor(project)).toContain("Unused D");
  });
});
