import { describe, expect, it } from "vitest";
import { createProject, parseProject, serializeProject, type Project } from "./domain";
import type { MediaInfo } from "./api";
import { assertProjectMedia, bindProjectMedia, mediaLinkDecision, MediaSelectionGuard, parseMediaIdentity, sameMediaIdentity, uploadedMediaIdentity } from "./mediaIdentity";
import { createProjectSession, editProjectSession, undoProjectSession } from "./projectSession";
const first={sha256:"a".repeat(64),bytes:1024};
const second={sha256:"b".repeat(64),bytes:1024};
const media=(identity=first,name="same.wav"):MediaInfo=>({id:identity.sha256.slice(0,32),name,url:"/api/media/source",duration:20,audioTracks:[{index:0,label:"Mic",channels:1}],...identity});
function fixture(identity=first):Project{
  const project=createProject(2);
  return {...project,schemaVersion:2,mediaName:"same.wav",mediaIdentity:identity,duration:20,
    captions:[{id:"cue",start:2,end:4,text:"Original content",speakerId:project.speakers[0]!.id,reviewed:true,reasons:[]}],
    notes:[{id:"note",start:5,end:null,text:"Original note",tag:"edit",done:false}],cuts:[{id:"cut",start:10,end:12}]};
}
describe("portable source content identity",()=>{
  it("rejects another same-name, same-duration, same-size source before analysis or rendering",()=>{
    const project=fixture(),before=structuredClone(project);
    expect(media(second).name).toBe(project.mediaName);expect(media(second).duration).toBe(project.duration);
    expect(mediaLinkDecision(project,second)).toBe("different");expect(()=>assertProjectMedia(project,media(second))).toThrow(/다른 파일/);
    expect(()=>bindProjectMedia(project,media(second),"same.wav",true)).toThrow(/다른 파일/);
    expect(project).toEqual(before);
  });
  it("allows renamed identical bytes while preserving caption, note, cut and speaker records",()=>{
    const project=fixture();const next=bindProjectMedia(project,media(first,"cached-old-name.wav"),"renamed-source.wav");
    expect(next.mediaName).toBe("renamed-source.wav");expect(next.mediaIdentity).toEqual(first);
    expect(next.captions).toBe(project.captions);expect(next.notes).toBe(project.notes);expect(next.cuts).toBe(project.cuts);expect(next.speakers).toBe(project.speakers);
    expect(()=>assertProjectMedia(next,media())).not.toThrow();expect(project.mediaName).toBe("same.wav");
  });
  it("preserves old project files but requires explicit first-link confirmation, never inferring trust from the filename",()=>{
    const {mediaIdentity:_,...old}=fixture();const project=parseProject(JSON.stringify(old));
    expect(project.mediaIdentity).toBeUndefined();expect(mediaLinkDecision(project,first)).toBe("legacy");
    expect(()=>bindProjectMedia(project,media(),"same.wav")).toThrow(/검증 정보가 없습니다/);
    expect(()=>assertProjectMedia(project,media())).toThrow(/검증 정보가 없습니다/);
    const confirmed=bindProjectMedia(project,media(),"same.wav",true);expect(confirmed.mediaIdentity).toEqual(first);expect(confirmed.cuts).toBe(project.cuts);
  });
  it("does not trust unbound imported subtitle or note timing silently",()=>{
    const project=createProject();project.captions=fixture().captions;
    expect(project.mediaName).toBeNull();expect(mediaLinkDecision(project,first)).toBe("legacy");
    expect(()=>bindProjectMedia(project,media(),"first.wav")).toThrow();
  });
  it("binds new files/recordings without carrying captions from another project",()=>{
    const original=fixture(),fresh=createProject(original.speakerCount);
    expect(mediaLinkDecision(fresh,second)).toBe("new");const next=bindProjectMedia(fresh,media(second),"recording.wav");
    expect(next.mediaIdentity).toEqual(second);expect(next.id).not.toBe(original.id);expect(next.captions).toEqual([]);expect(next.notes).toEqual([]);expect(next.cuts).toBeUndefined();expect(original.captions).toHaveLength(1);
  });
  it("round-trips verified identity through save/reload and undo restores the previous unbound state",()=>{
    const {mediaIdentity:_,...legacy}=fixture();const initial=createProjectSession(legacy);
    const linked=editProjectSession(initial,p=>bindProjectMedia(p,media(),"same.wav",true));
    const saved=parseProject(serializeProject(linked.current));expect(saved.mediaIdentity).toEqual(first);
    expect(undoProjectSession(linked).current.mediaIdentity).toBeUndefined();expect(sameMediaIdentity(undefined,first)).toBe(false);
  });
  it("requires both digest and byte count and rejects missing/invalid metadata from an older server",()=>{
    expect(sameMediaIdentity(first,{...first,bytes:1025})).toBe(false);
    expect(uploadedMediaIdentity(media(),1024)).toEqual(first);expect(()=>uploadedMediaIdentity(media(),999)).toThrow(/다릅니다/);
    for(const value of [{bytes:1024},{sha256:first.sha256},{sha256:"../bad",bytes:1024},{...first,bytes:0},{...first,bytes:1.5},{...first,bytes:Number.MAX_SAFE_INTEGER+1}])expect(()=>uploadedMediaIdentity(value)).toThrow();
  });
  it("rejects extra identity fields and invalid project identities without weakening strict project parsing",()=>{
    for(const value of [null,[],{},"hash",{...first,localPath:"private"},{...first,sha256:first.sha256.toUpperCase()},{...first,bytes:NaN}]){
      expect(()=>parseMediaIdentity(value)).toThrow();expect(()=>parseProject(JSON.stringify({...fixture(),mediaIdentity:value}))).toThrow();
    }
  });
});
describe("asynchronous source selection boundaries",()=>{
  it("ignores late upload completion after another file selection",async()=>{
    const guard=new MediaSelectionGuard();const original=guard.begin("project");
    let resolve!:(value:MediaInfo)=>void;const pending=new Promise<MediaInfo>(done=>{resolve=done;});let bound:MediaInfo|null=null;
    const completion=pending.then(info=>{if(guard.current(original,"project"))bound=info;});
    const latest=guard.begin("project");resolve(media());await completion;expect(bound).toBeNull();expect(guard.current(latest,"project")).toBe(true);
  });
  it("invalidates uploads and confirmation callbacks on cancellation, project change and reopening the same project",()=>{
    const guard=new MediaSelectionGuard();let token=guard.begin("project-one");expect(guard.current(token,"project-two")).toBe(false);
    guard.cancel();expect(guard.current(token,"project-one")).toBe(false);
    token=guard.begin("project-one");guard.cancel();guard.begin("project-one");expect(guard.current(token,"project-one")).toBe(false);
  });
});
