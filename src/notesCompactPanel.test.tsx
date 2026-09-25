import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createProject } from "./domain";
import { I18nProvider } from "./i18n";
import { NotesPanel } from "./components/NotesPanel";

afterEach(()=>vi.unstubAllGlobals());
describe("compact auxiliary notes panel",()=>{
  it("uses a single inline empty prompt with first-add action instead of the generic tall empty state",()=>{
    vi.stubGlobal("localStorage",{getItem:()=>"true"});
    const project=createProject(2),before=JSON.stringify(project),update=vi.fn();
    const html=renderToStaticMarkup(<I18nProvider><NotesPanel project={project} update={update} time={12} seek={()=>{}} reveal={null} onError={()=>{}}/></I18nProvider>);
    expect(html).toContain("notes-expanded notes-empty-panel");expect(html).toContain('class="notes-empty"');
    expect(html).not.toContain('class="empty-state');expect(html).toContain("첫 메모 남기기");expect(html).toContain("현재 시간에 메모 추가");
    expect(html).toContain("00:00:12.000");expect(update).not.toHaveBeenCalled();expect(JSON.stringify(project)).toBe(before);
  });
  it("still opens the requested timeline note and retains editable text, time, tags, done and delete controls",()=>{
    vi.stubGlobal("localStorage",{getItem:()=>"false"});const project=createProject(2);
    project.notes=[{id:"target",start:18,end:21,text:"Preserve this editing note",tag:"highlight",done:false}];
    const html=renderToStaticMarkup(<I18nProvider><NotesPanel project={project} update={()=>{}} time={18} seek={()=>{}} reveal={{id:"target"}} onError={()=>{}}/></I18nProvider>);
    expect(html).toContain("notes-expanded");expect(html).not.toContain("notes-empty-panel");expect(html).toContain('class="note-card  selected"');
    expect(html).toContain("Preserve this editing note");expect(html).toContain('rows="2"');
    for(const label of ["메모 1 시작 시간","메모 1 종료 시간 선택 입력","메모 1 분류","메모 1 완료 표시","메모 1 삭제"])expect(html).toContain(label);
  });
});
