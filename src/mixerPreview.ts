import {request} from "./api";
import type {mixPreviewRequest} from "./audioMixer";

export type MixPreviewResult={start:number;duration:number;limiter:boolean;peakDbfs:number|null;outputPeakDbfs:number|null;clippedSamples:number;clipping:boolean;url:string};
export type MixPreviewState={busy:boolean;result?:MixPreviewResult;error?:string};
type Transport=(url:string,options?:RequestInit)=>Promise<unknown>;
const endpoint="/api/audio-mix-previews";
const idPattern=/^[a-f0-9]{32}$/;
function object(value:unknown):Record<string,unknown>{
  if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("Invalid mix preview response.");
  return value as Record<string,unknown>;
}
export function parseMixPreviewResult(value:unknown,id:string):MixPreviewResult {
  const r=object(value);
  const finite=(value:unknown,min:number,max:number)=>typeof value==="number"&&Number.isFinite(value)&&value>=min&&value<=max;
  const peak=(value:unknown)=>value===null||finite(value,-1000,1000);
  if(!idPattern.test(id)||r.url!==`${endpoint}/${id}/file`||!finite(r.start,0,604800)||!finite(r.duration,1/48000,10)
    ||typeof r.limiter!=="boolean"||!peak(r.peakDbfs)||!peak(r.outputPeakDbfs)||typeof r.clipping!=="boolean"
    ||!finite(r.clippedSamples,0,960000)||!Number.isInteger(r.clippedSamples)||r.clipping!==(Number(r.clippedSamples)>0))throw new Error("Invalid mix preview response.");
  return {start:r.start as number,duration:r.duration as number,limiter:r.limiter,peakDbfs:r.peakDbfs as number|null,
    outputPeakDbfs:r.outputPeakDbfs as number|null,clippedSamples:r.clippedSamples as number,clipping:r.clipping,url:r.url as string};
}
function pause(signal:AbortSignal) {
  return new Promise<void>((resolve,reject)=>{
    const abort=()=>{clearTimeout(timer);reject(new DOMException("Cancelled","AbortError"));};
    const timer=setTimeout(()=>{signal.removeEventListener("abort",abort);resolve();},250);
    if(signal.aborted)abort();else signal.addEventListener("abort",abort,{once:true});
  });
}
/** Owns one disposable preview, including cleanup of a late POST response. */
export class MixerPreviewSession {
  private generation=0;
  private id:string|null=null;
  private controller:AbortController|null=null;
  constructor(private transport:Transport=(url,options)=>request(url,options)){}
  private discard(id:string){void this.transport(`${endpoint}/${id}`,{method:"DELETE"}).catch(()=>{});}
  cancel(){
    this.generation++;
    this.controller?.abort();this.controller=null;
    if(this.id)this.discard(this.id);
    this.id=null;
  }
  async start(payload:ReturnType<typeof mixPreviewRequest>,publish:(state:MixPreviewState)=>void){
    this.cancel();const generation=this.generation;
    const controller=new AbortController();this.controller=controller;
    const current=()=>this.generation===generation&&!controller.signal.aborted;
    publish({busy:true});
    try{
      // Do not abort POST: once the server accepts it we need its ID to cancel
      // an obsolete request. GET/polling is abortable; late IDs are discarded.
      const created=object(await this.transport(endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)}));
      if(typeof created.id!=="string"||!idPattern.test(created.id))throw new Error("Invalid mix preview identifier.");
      const id=created.id;
      if(!current()){this.discard(id);return;}
      this.id=id;
      const deadline=Date.now()+120000;
      while(current()){
        const job=object(await this.transport(`${endpoint}/${id}`,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])}));
        if(!current())return;
        if(job.id!==id)throw new Error("Invalid mix preview response.");
        if(job.status==="completed"){publish({busy:false,result:parseMixPreviewResult(job.result,id)});return;}
        if(job.status!=="queued"&&job.status!=="running")throw new Error("Mix preview failed. Check the source and try again.");
        if(Date.now()>deadline)throw new Error("Mix preview timed out. Try again.");
        await pause(controller.signal);
      }
    }catch(error){
      if(current()){
        if(this.id)this.discard(this.id);this.id=null;
        publish({busy:false,error:error instanceof Error?error.message:"Mix preview failed."});
      }
    }
  }
}
