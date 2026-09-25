import { describe, expect, it } from "vitest";
import { createProject, parseProject, type Caption, type Project } from "./domain";
import { bulkEditCaptions, editCaption, mergeCaptions, nextCaptionToReview, replaceCaptionText, splitCaption } from "./editorOperations";
import { createProjectSession, editProjectSession, redoProjectSession, undoProjectSession } from "./projectSession";
import { exportDocumentTxt } from "./documentExports";
function fixture():Project{
  const project=createProject(2);
  const caption:Caption={id:"cue-one",start:0,end:2,text:"hello world",speakerId:project.speakers[0]!.id,reviewed:true,reasons:[],words:[{start:0,end:1,text:"hello"},{start:1,end:2,text:"world"}]};
  return {...project,duration:8,captions:[caption]};
}
describe("review status follows the content being certified",()=>{
  it("makes a changed, previously clean cue discoverable for review and clears stale word alignment",()=>{
    const project=fixture(),original=project.captions[0]!;
    const changed=editCaption(original,{text:"corrected words"});
    expect(changed).toMatchObject({reviewed:false,reasons:["edited"],text:"corrected words"});expect(changed.words).toBeUndefined();
    expect(nextCaptionToReview([changed],null,"review")).toBe(changed);
    expect(original.reviewed).toBe(true);expect(original.words).toHaveLength(2);expect(original.reasons).toEqual([]);
    const saved=parseProject(JSON.stringify({...project,captions:[changed]}));expect(saved.captions[0]).toEqual(changed);
    const report=exportDocumentTxt(saved,"interview",text=>text);expect(report).toContain("검수 필요");expect(report).not.toContain("확인 완료");
  });
  it("adds timing review for direct timestamp edits without disguising them as transcription changes",()=>{
    const original=fixture().captions[0]!;
    const changed=editCaption(original,{start:.25});expect(changed).toMatchObject({reviewed:false,reasons:["timing"]});expect(changed.words).toBeUndefined();expect(nextCaptionToReview([changed],null,"review")).toBe(changed);
  });
  it("preserves certification and word evidence for no-op edits and style-only changes",()=>{
    const original=fixture().captions[0]!;
    for(const change of [{text:original.text},{start:original.start,end:original.end},{speakerId:original.speakerId},{}])expect(editCaption(original,change)).toBe(original);
    const styled=editCaption(original,{style:{bold:true}});expect(styled.reviewed).toBe(true);expect(styled.reasons).toEqual([]);expect(styled.words).toBe(original.words);
  });
  it("keeps reasons unique and allows explicit review after correcting the cue",()=>{
    const original=fixture().captions[0]!;
    const first=editCaption(original,{text:"first correction"});const second=editCaption(first,{text:"next correction"});
    expect(second.reasons).toEqual(["edited"]);const approved=editCaption(second,{reviewed:true});expect(approved.reviewed).toBe(true);expect(nextCaptionToReview([approved],null,"review")).toBeUndefined();
  });
  it("uses the same review policy for replacement, split, merge and speaker reassignment",()=>{
    const project=fixture();
    const replaced=replaceCaptionText(project,new Set(["cue-one"]),"hello","hi");expect(replaced.captions[0]!.reasons).toEqual(["edited"]);
    const split=splitCaption(project,"cue-one",1,"cue-two");expect(split.captions.every(c=>!c.reviewed&&c.reasons.includes("edited")&&c.reasons.includes("timing"))).toBe(true);
    const approved={...split,captions:split.captions.map(c=>({...c,reviewed:true}))};expect(mergeCaptions(approved,"cue-one","cue-two").captions[0]!.reviewed).toBe(false);
    const assigned=bulkEditCaptions(project,new Set(["cue-one"]),{kind:"speaker",speakerId:project.speakers[1]!.id}).captions[0]!;
    expect(assigned).toMatchObject({reviewed:false,reasons:["edited"]});expect(assigned.words).toBe(project.captions[0]!.words);
  });
  it("restores the old certification and alignment on undo, and edited review on redo",()=>{
    const project=fixture();const session=editProjectSession(createProjectSession(project),p=>({...p,captions:p.captions.map(c=>editCaption(c,{text:"corrected"}))}));
    const undone=undoProjectSession(session);expect(undone.current).toBe(project);expect(undone.current.captions[0]!.reviewed).toBe(true);expect(undone.current.captions[0]!.words).toHaveLength(2);
    expect(redoProjectSession(undone).current.captions[0]).toMatchObject({reviewed:false,reasons:["edited"]});
  });
  it("retains old projects and rejects unknown reason strings rather than weakening parsing",()=>{
    const project=fixture();expect(parseProject(JSON.stringify(project))).toEqual(project);
    expect(()=>parseProject(JSON.stringify({...project,captions:[{...project.captions[0],reasons:["future-unknown-reason"]}]}))).toThrow();
  });
});
