/** Portable mix decisions. Files stay in the media cache, never in the project. */
export type AudioMixTrack = {
  id: string; mediaId: string; name: string; sha256: string;
  audioTrack: number; gainDb: number; offsetSeconds: number; muted: boolean;
};
export type AudioMixPlan = {
  tracks: AudioMixTrack[]; format: "wav"|"mp3"|"m4a"|"mp4";
  limiter: boolean; applyCuts: boolean; videoMediaId: string|null; frameRate: "original"|"30"|"60";
};
export const MAX_MIX_TRACKS = 16;
export function emptyAudioMix(): AudioMixPlan {
  return {tracks:[],format:"wav",limiter:true,applyCuts:false,videoMediaId:null,frameRate:"30"};
}
function record(value:unknown, keys:string[]):Record<string,unknown> {
  if(!value||typeof value!=="object"||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k)))throw new Error("Invalid audio mix settings.");
  return value as Record<string,unknown>;
}
function finite(value:unknown,min:number,max:number):number {
  if(typeof value!=="number"||!Number.isFinite(value)||value<min||value>max)throw new Error("Invalid audio mix value.");
  return value;
}
function text(value:unknown,pattern:RegExp,max:number):string {
  if(typeof value!=="string"||!value.length||value.length>max||!pattern.test(value))throw new Error("Invalid audio mix source.");
  return value;
}
function boolean(value:unknown):boolean {if(typeof value!=="boolean")throw new Error("Invalid audio mix setting.");return value;}
export function parseAudioMix(value:unknown):AudioMixPlan {
  const p=record(value,["tracks","format","limiter","applyCuts","videoMediaId","frameRate"]);
  if(!Array.isArray(p.tracks)||p.tracks.length>MAX_MIX_TRACKS)throw new Error("A mix supports up to 16 tracks.");
  const seen=new Set<string>();
  const tracks=p.tracks.map(value=>{
    const t=record(value,["id","mediaId","name","sha256","audioTrack","gainDb","offsetSeconds","muted"]);
    const id=text(t.id,/^[a-zA-Z0-9_-]+$/,128);
    if(seen.has(id))throw new Error("Duplicate audio mix track.");seen.add(id);
    const audioTrack=finite(t.audioTrack,0,4096);if(!Number.isInteger(audioTrack))throw new Error("Invalid audio track index.");
    return {id,mediaId:text(t.mediaId,/^[a-f0-9]{32}$/,32),name:text(t.name,/^[^\x00-\x1f\x7f\\/]+$/u,512),
      sha256:text(t.sha256,/^[a-f0-9]{64}$/,64),audioTrack,gainDb:finite(t.gainDb,-60,12),
      offsetSeconds:finite(t.offsetSeconds,-604800,604800),muted:boolean(t.muted)};
  });
  if(typeof p.format!=="string"||!["wav","mp3","m4a","mp4"].includes(p.format)||typeof p.frameRate!=="string"||!["original","30","60"].includes(p.frameRate))throw new Error("Invalid audio mix output format.");
  const videoMediaId=p.videoMediaId===null?null:text(p.videoMediaId,/^[a-f0-9]{32}$/,32);
  if(videoMediaId&&!tracks.some(t=>t.mediaId===videoMediaId))throw new Error("The video must be one of the mix sources.");
  return {tracks,format:p.format as AudioMixPlan["format"],frameRate:p.frameRate as AudioMixPlan["frameRate"],
    limiter:boolean(p.limiter),applyCuts:boolean(p.applyCuts),videoMediaId};
}
export function mixRequest(plan:AudioMixPlan, duration:number, ranges:{start:number;end:number}[]) {
  const parsed=parseAudioMix(plan);
  if(!parsed.tracks.some(t=>!t.muted))throw new Error("Enable at least one audio track.");
  if(parsed.format==="mp4"&&!parsed.videoMediaId)throw new Error("Choose a video source.");
  if(parsed.applyCuts&&(!Number.isFinite(duration)||duration<=0||!ranges.length))throw new Error("The project has no retained media.");
  return {tracks:parsed.tracks.map(({mediaId,sha256,audioTrack,gainDb,offsetSeconds,muted})=>({mediaId,sha256,audioTrack,gainDb,offsetSeconds,muted})),
    format:parsed.format,limiter:parsed.limiter,videoMediaId:parsed.format==="mp4"?parsed.videoMediaId:null,frameRate:parsed.frameRate,
    ...(parsed.applyCuts?{timelineDuration:duration,keepRanges:ranges}:{})};
}
/** Solo/listen affect this audition only, never the stored mute/export choices. */
export function mixPreviewRequest(plan:AudioMixPlan, start:number, options:{soloIds?:string[];trackId?:string}={}) {
  const parsed=parseAudioMix(plan);
  if(!Number.isFinite(start)||start<0||start>=604800)throw new Error("Choose a valid preview start time.");
  const tracks=parsed.tracks.filter(track=>options.trackId?track.id===options.trackId:
    options.soloIds?.length?options.soloIds.includes(track.id):!track.muted);
  if(!tracks.length)throw new Error("Enable at least one audio track.");
  return {tracks:tracks.map(({mediaId,sha256,audioTrack,gainDb,offsetSeconds})=>({mediaId,sha256,audioTrack,gainDb,offsetSeconds,muted:false})),
    limiter:parsed.limiter,start,duration:10};
}
export function relinkMix(plan:AudioMixPlan, oldId:string, media:{id:string;sha256?:string;name:string}):AudioMixPlan {
  const source=plan.tracks.find(t=>t.mediaId===oldId);
  if(!source||!media.sha256||source.sha256!==media.sha256)throw new Error("The selected file does not match the saved source SHA-256.");
  return {...plan,tracks:plan.tracks.map(t=>t.mediaId===oldId?{...t,mediaId:media.id,name:media.name}:t),videoMediaId:plan.videoMediaId===oldId?media.id:plan.videoMediaId};
}
