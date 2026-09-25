import { useEffect, useSyncExternalStore } from "react";
import { ApiError, request, type Job } from "./api";
import { readHistory } from "./jobHistory";

export const BACKGROUND_JOB_KEY="voicesubsep-background-analysis-v1";
export type BackgroundJobPointer={id:string;projectId:string|null;projectName:string;mediaId:string;mediaName:string};
export type BackgroundJobSnapshot={pointer:BackgroundJobPointer|null;job:Job|null;paused:boolean;missing:boolean};
const identifier=(value:unknown)=>typeof value==="string"&&/^[a-f0-9]{32}$/u.test(value);
export function parseBackgroundPointer(value:unknown):BackgroundJobPointer|null {
  if(!value||typeof value!=="object")return null;
  const row=value as BackgroundJobPointer;
  if(!identifier(row.id)||!identifier(row.mediaId)||!(row.projectId===null||typeof row.projectId==="string"&&row.projectId.length<=128)||
    ![row.projectName,row.mediaName].every(text=>typeof text==="string"&&text.length<=500&&!/[\u0000-\u001f]/u.test(text)))return null;
  return {id:row.id,projectId:row.projectId,projectName:row.projectName,mediaId:row.mediaId,mediaName:row.mediaName};
}
export function backgroundJobRunning(job:Job|null){return !!job&&(job.status==="queued"||job.status==="running");}
export function sameBackgroundSource(pointer:BackgroundJobPointer,projectId:string,mediaId:string){return pointer.projectId===projectId&&pointer.mediaId===mediaId;}
type Dependencies={read:()=>BackgroundJobPointer|null;write:(pointer:BackgroundJobPointer|null)=>void;fetch:(id:string)=>Promise<Job>;discover:()=>Promise<BackgroundJobPointer|null>};

/** Only the known job is polled. Terminal responses, 404 and three consecutive
 * failures stop polling; restart/retry is always an explicit UI choice. */
export class BackgroundJobMonitor {
  private snapshot:BackgroundJobSnapshot;
  private listeners=new Set<()=>void>();
  private timer?:ReturnType<typeof setTimeout>;
  private active=false;
  private generation=0;
  private failures=0;
  private discovered=false;
  constructor(private deps:Dependencies){this.snapshot={pointer:deps.read(),job:null,paused:false,missing:false};}
  getSnapshot=()=>this.snapshot;
  subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
  private emit(value:BackgroundJobSnapshot){this.snapshot=value;for(const listener of this.listeners)listener();}
  start(){if(this.active)return;this.active=true;if(this.snapshot.pointer){void this.poll();return;}if(!this.discovered){this.discovered=true;const generation=this.generation;
    void this.deps.discover().then(pointer=>{if(this.active&&generation===this.generation&&!this.snapshot.pointer&&pointer)this.track(pointer);}).catch(()=>{});
  }}
  stop(){this.active=false;this.generation++;clearTimeout(this.timer);if(!this.snapshot.pointer)this.discovered=false;}
  track(pointer:BackgroundJobPointer,job?:Job){
    const checked=parseBackgroundPointer(pointer);if(!checked||job&&job.id!==checked.id)return;
    const changed=checked.id!==this.snapshot.pointer?.id;
    // Opening a previous project's completed analysis must not replace the
    // active (or still-being-restored) job. New submissions are queued/running.
    if(changed&&job&&!backgroundJobRunning(job)&&this.snapshot.pointer&&
      (!this.snapshot.job||backgroundJobRunning(this.snapshot.job)))return;
    if(changed){this.generation++;this.failures=0;clearTimeout(this.timer);this.deps.write(checked);}
    else if(job)this.generation++;
    this.emit({pointer:checked,job:job??(changed?null:this.snapshot.job),paused:false,missing:false});
    if(job&&!backgroundJobRunning(job)){clearTimeout(this.timer);return;}
    if(this.active)this.schedule();
  }
  private schedule(){clearTimeout(this.timer);if(this.active&&this.snapshot.pointer&&!this.snapshot.paused)this.timer=setTimeout(()=>void this.poll(),2000);}
  private async poll(){
    const pointer=this.snapshot.pointer;if(!this.active||!pointer)return;const generation=this.generation;
    try {
      const job=await this.deps.fetch(pointer.id);
      if(!this.active||generation!==this.generation||pointer.id!==this.snapshot.pointer?.id)return;
      if(job.id!==pointer.id)throw new Error("Job identity mismatch");
      this.failures=0;this.emit({...this.snapshot,job,paused:false,missing:false});
      if(backgroundJobRunning(job))this.schedule();
    }catch(error){
      if(!this.active||generation!==this.generation)return;
      const missing=error instanceof ApiError&&error.status===404;
      const paused=missing||++this.failures>=3;
      this.emit({...this.snapshot,paused,missing});if(!paused)this.schedule();
    }
  }
  retry=()=>{this.generation++;this.failures=0;clearTimeout(this.timer);this.emit({...this.snapshot,paused:false,missing:false});if(this.active)void this.poll();};
  dismiss=()=>{if((!this.snapshot.job||backgroundJobRunning(this.snapshot.job))&&!this.snapshot.missing)return;this.generation++;clearTimeout(this.timer);this.deps.write(null);this.emit({pointer:null,job:null,paused:false,missing:false});};
}
const monitor=new BackgroundJobMonitor({
  read:()=>{try{return parseBackgroundPointer(JSON.parse(localStorage.getItem(BACKGROUND_JOB_KEY)??"null"));}catch{return null;}},
  write:pointer=>{try{if(pointer)localStorage.setItem(BACKGROUND_JOB_KEY,JSON.stringify(pointer));else localStorage.removeItem(BACKGROUND_JOB_KEY);}catch{/* The current window still tracks the job. */}},
  fetch:id=>request<Job>(`/api/jobs/${id}`,{signal:AbortSignal.timeout(10_000)}),
  discover:async()=>{const history=await readHistory();const row=history.items.find(item=>item.kind==="analysis"&&(item.status==="queued"||item.status==="running"));return row?parseBackgroundPointer({...row,projectId:row.projectId??null}):null;},
});
export function useBackgroundJob(){
  const snapshot=useSyncExternalStore(monitor.subscribe,monitor.getSnapshot,monitor.getSnapshot);
  useEffect(()=>{monitor.start();return()=>monitor.stop();},[]);
  return {snapshot,track:(pointer:BackgroundJobPointer,job:Job)=>monitor.track(pointer,job),retry:monitor.retry,dismiss:monitor.dismiss};
}
