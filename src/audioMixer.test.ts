import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";
import {emptyAudioMix,mixRequest,parseAudioMix,relinkMix,type AudioMixTrack} from "./audioMixer";
import {createProject,parseProject} from "./domain";
import {dictionaries} from "./i18n";
const track:AudioMixTrack={id:"track-1",mediaId:"a".repeat(32),sha256:"b".repeat(64),name:"audio.wav",audioTrack:2,gainDb:-6,offsetSeconds:.125,muted:false};
const plan=()=>({...emptyAudioMix(),tracks:[{...track}]});
describe("portable mixer decisions",()=>{
  it("roundtrips project decisions without embedding media or modifying captions",()=>{
    const project=createProject();project.audioMix=plan();
    expect(parseProject(JSON.stringify(project))).toEqual(project);
    expect(parseProject(JSON.stringify(createProject())).audioMix).toBeUndefined();
  });
  it("rejects untrusted paths, credentials, nonfinite values and duplicate track IDs",()=>{
    for(const invalid of [
      {...plan(),secret:"key"}, {...plan(),tracks:[{...track,path:"C:/file.wav"}]},
      {...plan(),tracks:[{...track,name:"../file.wav"}]}, {...plan(),tracks:[{...track,gainDb:NaN}]},
      {...plan(),tracks:[track,track]}, {...plan(),tracks:[{...track,offsetSeconds:Infinity}]},
      {...plan(),tracks:[{...track,audioTrack:1.5}]}, {...plan(),tracks:Array.from({length:17},(_,i)=>({...track,id:String(i)}))},
      {...plan(),videoMediaId:"c".repeat(32)}, {...plan(),tracks:[{...track,muted:"false"}]},
      {...plan(),format:["wav"]}, {...plan(),frameRate:30}, {...plan(),frameRate:["60"]},
    ])expect(()=>parseAudioMix(invalid)).toThrow();
  });
  it("copies decisions and sends only media hashes/settings to the backend",()=>{
    const p=plan();const parsed=parseAudioMix(p);parsed.tracks[0].gainDb=2;expect(p.tracks[0].gainDb).toBe(-6);
    expect(mixRequest(p,8,[])).toEqual({tracks:[{mediaId:track.mediaId,sha256:track.sha256,audioTrack:2,gainDb:-6,offsetSeconds:.125,muted:false}],format:"wav",limiter:true,videoMediaId:null,frameRate:"30"});
  });
  it("uses original project times for optional cuts and rejects empty enabled mixes",()=>{
    const p={...plan(),applyCuts:true};const ranges=[{start:1,end:3}];
    expect(mixRequest(p,8,ranges)).toMatchObject({timelineDuration:8,keepRanges:ranges});
    expect(()=>mixRequest(p,0,[])).toThrow();
    expect(()=>mixRequest({...plan(),tracks:[{...track,muted:true}]},8,[])).toThrow();
    expect(()=>mixRequest({...plan(),format:"mp4"},8,[])).toThrow();
  });
  it("relinks only exact hashes and updates all references including video",()=>{
    const p={...plan(),videoMediaId:track.mediaId,tracks:[track,{...track,id:"track-2",audioTrack:3}]};
    expect(()=>relinkMix(p,track.mediaId,{id:"c".repeat(32),sha256:"d".repeat(64),name:"audio.wav"})).toThrow();
    const linked=relinkMix(p,track.mediaId,{id:"c".repeat(32),sha256:track.sha256,name:"renamed.wav"});
    expect(linked.tracks.map(t=>t.mediaId)).toEqual(["c".repeat(32),"c".repeat(32)]);expect(linked.videoMediaId).toBe("c".repeat(32));
    expect(p.tracks[0].name).toBe("audio.wav");
  });
  it("localizes the new mixer controls",()=>{
    const source=readFileSync(new URL("./components/AudioMixerDialog.tsx",import.meta.url),"utf8");
    expect([...source.matchAll(/\bt\((["'])(.*?)\1/g)].map(m=>m[2]).filter(key=>/[가-힣]/.test(key)&&!dictionaries.en[key])).toEqual([]);
  });
});
