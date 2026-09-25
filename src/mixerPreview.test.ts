import {afterEach,describe,expect,it,vi} from "vitest";
import {emptyAudioMix,mixPreviewRequest,type AudioMixTrack} from "./audioMixer";
import {MixerPreviewSession,parseMixPreviewResult,type MixPreviewState} from "./mixerPreview";

const id="a".repeat(32),other="b".repeat(32);
const track:AudioMixTrack={id:"first",mediaId:id,sha256:"c".repeat(64),name:"obs.mkv",audioTrack:2,gainDb:-6,offsetSeconds:.2,muted:false};
const plan=()=>({...emptyAudioMix(),tracks:[{...track},{...track,id:"second",audioTrack:3,muted:true}]});
const result=(jobId=id)=>({start:2,duration:10,limiter:true,peakDbfs:2,outputPeakDbfs:-.2,clippedSamples:20,clipping:true,url:`/api/audio-mix-previews/${jobId}/file`});
const ready=(jobId=id)=>({id:jobId,status:"completed",result:result(jobId)});
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return {promise,resolve};}
afterEach(()=>vi.useRealTimers());

describe("short mixer audition",()=>{
  it("sends the selected OBS stream and ignores mute only for explicitly listened/soloed tracks",()=>{
    const p=plan(),saved=structuredClone(p);
    expect(mixPreviewRequest(p,2).tracks.map(t=>t.audioTrack)).toEqual([2]);
    expect(mixPreviewRequest(p,2,{trackId:"second"})).toMatchObject({start:2,duration:10,tracks:[{audioTrack:3,muted:false,offsetSeconds:.2,gainDb:-6}]});
    expect(mixPreviewRequest(p,2,{soloIds:["second"]}).tracks.map(t=>t.audioTrack)).toEqual([3]);
    expect(p).toEqual(saved);
    for(const start of [NaN,-1,604800])expect(()=>mixPreviewRequest(p,start)).toThrow();
    expect(()=>mixPreviewRequest(p,0,{trackId:"missing"})).toThrow();
  });
  it("validates peak evidence and accepts only the matching local preview URL",()=>{
    expect(parseMixPreviewResult(result(),id)).toEqual(result());
    expect(parseMixPreviewResult({...result(),peakDbfs:null,outputPeakDbfs:null,clippedSamples:0,clipping:false},id).peakDbfs).toBeNull();
    for(const changes of [{url:"https://hostile.invalid/audio"},{url:`/api/audio-mix-previews/${other}/file`},{duration:11},{peakDbfs:NaN},{clippedSamples:-1},{clippedSamples:.5},{clipping:false}])expect(()=>parseMixPreviewResult({...result(),...changes},id)).toThrow();
  });
  it("discards the accepted job when POST finishes after settings changed or dialog closed",async()=>{
    const post=deferred<unknown>();const transport=vi.fn((_:string,init?:RequestInit)=>init?.method==="POST"?post.promise:Promise.resolve({removed:true}));
    const session=new MixerPreviewSession(transport),states:MixPreviewState[]=[];
    const pending=session.start(mixPreviewRequest(plan(),2),s=>states.push(s));
    session.cancel();post.resolve({id});await pending;
    expect(states).toEqual([{busy:true}]);
    expect(transport).toHaveBeenCalledWith(`/api/audio-mix-previews/${id}`,{method:"DELETE"});
  });
  it("ignores an old GET response even if its transport does not honor abort",async()=>{
    const oldGet=deferred<unknown>();let posts=0;
    const transport=vi.fn((url:string,init?:RequestInit):Promise<unknown>=>{
      if(init?.method==="POST")return Promise.resolve({id:posts++?other:id});
      if(init?.method==="DELETE")return Promise.resolve({removed:true});
      return url.endsWith(id)?oldGet.promise:Promise.resolve(ready(other));
    });
    const session=new MixerPreviewSession(transport),states:MixPreviewState[]=[];
    const first=session.start(mixPreviewRequest(plan(),2),s=>states.push(s));
    await Promise.resolve();
    const second=session.start(mixPreviewRequest(plan(),2,{trackId:"second"}),s=>states.push(s));
    await second;oldGet.resolve(ready());await first;
    expect(states.filter(s=>s.result).map(s=>s.result?.url)).toEqual([result(other).url]);
    expect(transport).toHaveBeenCalledWith(`/api/audio-mix-previews/${id}`,{method:"DELETE"});
    session.cancel();
  });
  it("cancels polling and exposes recoverable errors instead of a busy lock",async()=>{
    const transport=vi.fn((_:string,init?:RequestInit):Promise<unknown>=>init?.method==="POST"?Promise.resolve({id}):init?.method==="DELETE"?Promise.resolve({}):Promise.reject(new Error("connection lost")));
    const session=new MixerPreviewSession(transport),states:MixPreviewState[]=[];
    await session.start(mixPreviewRequest(plan(),2),s=>states.push(s));
    expect(states.at(-1)).toEqual({busy:false,error:"connection lost"});
    expect(transport).toHaveBeenCalledWith(`/api/audio-mix-previews/${id}`,{method:"DELETE"});
  });
  it("does not continue queued polling after cancellation",async()=>{
    vi.useFakeTimers();
    const transport=vi.fn((_:string,init?:RequestInit):Promise<unknown>=>Promise.resolve(init?.method==="POST"?{id}:init?.method==="DELETE"?{}:{id,status:"queued"}));
    const session=new MixerPreviewSession(transport),states:MixPreviewState[]=[];
    const pending=session.start(mixPreviewRequest(plan(),2),s=>states.push(s));
    await Promise.resolve();await Promise.resolve();
    session.cancel();await pending;await vi.advanceTimersByTimeAsync(1000);
    expect(states).toEqual([{busy:true}]);
    expect(transport.mock.calls.filter(([,init])=>init?.signal)).toHaveLength(1);
  });
});
