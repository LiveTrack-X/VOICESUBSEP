import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkedLiveState, getLiveResult, liveHistory, LiveSession, liveSourceFile, type LiveState } from "./liveSession";

const id="a".repeat(32);
const state=(patch:Partial<LiveState>={}):LiveState=>({id,status:"running",stage:"ready",sequence:-1,receivedSeconds:0,processedSeconds:0,lagSeconds:0,captions:[],speakers:[],sourceUrl:`/api/live/sessions/${id}/source.wav`,overlayUrl:`http://127.0.0.1:8787/live-overlay/${id}/read-only-token`,overlay:{muted:false},...patch});
const options={whisperModel:"large-v3-turbo",language:"ko",device:"cpu" as const,diarization:true as const,speakerCount:2};
const reply=(value:unknown)=>new Response(JSON.stringify(value),{headers:{"Content-Type":"application/json"}});
const settle=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
beforeEach(()=>vi.useFakeTimers());
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();vi.restoreAllMocks();});

describe("live server boundary with mock HTTP only",()=>{
  it("accepts the real loopback overlay route but rejects external, credentialed and cross-session URLs",()=>{
    expect(checkedLiveState(state())).toEqual(state());
    for(const url of ["https://example.org/live-overlay/x",`http://127.0.0.1:8787/api/live/${id}`,`http://user:pass@127.0.0.1/live-overlay/${id}/x`,`http://127.0.0.1/live-overlay/${"b".repeat(32)}/x`])
      expect(()=>checkedLiveState(state({overlayUrl:url}))).toThrow();
    expect(()=>checkedLiveState(state({sourceUrl:"/api/media/other"}))).toThrow();
    expect(()=>checkedLiveState(state({receivedSeconds:Infinity}))).toThrow();
  });
  it("prepares without requesting devices, sends PCM in order, flushes before asynchronous stop and reads the final result",async()=>{
    const result={captions:[],speakers:[],duration:1,warnings:[]};let phase="running";const operations:string[]=[];
    const fetch=vi.fn(async(url:string,init?:RequestInit)=>{
      operations.push(`${init?.method??"GET"} ${url}`);
      if(url==="/api/live/sessions"){expect(JSON.parse(init!.body as string)).toEqual(options);return reply(state());}
      if(url.includes("/audio?")){expect((init!.body as ArrayBuffer).byteLength).toBe(16000);expect(new Headers(init?.headers).get("Content-Type")).toBe("application/octet-stream");return reply(state({sequence:0,receivedSeconds:.5}));}
      if(url.endsWith("/stop")){phase="completed";return reply(state({status:"stopping"}));}
      return reply(state({status:phase as LiveState["status"],result}));
    });vi.stubGlobal("fetch",fetch);const onState=vi.fn();const error=vi.fn();const session=new LiveSession(onState,error);
    await session.prepare(options);session.push(new ArrayBuffer(16000));session.push(new ArrayBuffer(16000));await session.stop();
    expect(operations.slice(0,4)).toEqual(["POST /api/live/sessions",`POST /api/live/sessions/${id}/audio?seq=0`,`POST /api/live/sessions/${id}/audio?seq=1`,`POST /api/live/sessions/${id}/stop`]);
    await vi.advanceTimersByTimeAsync(1001);expect(session.state?.result).toEqual(result);expect(session.state?.status).toBe("completed");expect(error).not.toHaveBeenCalled();await session.abort();
  });
  it("cancels an engine created after the window has already closed",async()=>{
    let created!:(response:Response)=>void;const fetch=vi.fn((url:string)=>url==="/api/live/sessions"?new Promise<Response>(resolve=>{created=resolve;}):Promise.resolve(reply(state({status:"cancelled"}))));vi.stubGlobal("fetch",fetch);
    const seen=vi.fn();const session=new LiveSession(seen,vi.fn());const preparing=session.prepare(options);await session.abort();created(reply(state({status:"loading"})));await preparing;
    expect(seen).not.toHaveBeenCalled();expect(fetch).toHaveBeenLastCalledWith(`/api/live/sessions/${id}`,expect.objectContaining({method:"DELETE"}));
  });
  it("does not restore a stale running poll over a newer stopping state",async()=>{
    let polled!:(response:Response)=>void;
    vi.stubGlobal("fetch",vi.fn((url:string,init?:RequestInit)=>{
      if(url==="/api/live/sessions")return Promise.resolve(reply(state()));
      if(url.endsWith("/stop"))return Promise.resolve(reply(state({status:"stopping"})));
      if(init?.method==="DELETE")return Promise.resolve(reply(state({status:"cancelled"})));
      return new Promise<Response>(resolve=>{polled=resolve;});
    }));
    const session=new LiveSession(vi.fn(),vi.fn());await session.prepare(options);await vi.advanceTimersByTimeAsync(1001);await session.stop();polled(reply(state()));await settle();
    expect(session.state?.status).toBe("stopping");await session.abort();
  });
  it("reports a polling failure once without continuing stale polling",async()=>{
    const fetch=vi.fn(async(url:string)=>{if(url==="/api/live/sessions")return reply(state());throw new Error("offline");});vi.stubGlobal("fetch",fetch);
    const error=vi.fn();const session=new LiveSession(vi.fn(),error);await session.prepare(options);await vi.advanceTimersByTimeAsync(20_000);
    expect(error).toHaveBeenCalledOnce();expect(fetch).toHaveBeenCalledTimes(2);await session.abort().catch(()=>{});
  });
  it("loads the backend PCM source rather than a different MediaRecorder clock",async()=>{
    const bytes=new TextEncoder().encode("RIFFfixtureWAVE");const fetch=vi.fn(async()=>new Response(bytes,{headers:{"Content-Type":"audio/wav","Content-Length":String(bytes.length)}}));vi.stubGlobal("fetch",fetch);
    const file=await liveSourceFile(state({status:"completed"}));expect(file.type).toBe("audio/wav");expect(await file.text()).toBe("RIFFfixtureWAVE");expect(fetch).toHaveBeenCalledWith(`/api/live/sessions/${id}/source.wav`,expect.any(Object));
  });
  it("restores completed captions from durable history without re-running recognition",async()=>{
    const result={captions:[{id:"caption",start:0,end:1,text:"restored",speakerId:null,reasons:["unassigned"],reviewed:false}],speakers:[],duration:1,warnings:[]};
    const fetch=vi.fn(async(url:string)=>reply(url==="/api/live/sessions"?{items:[state({status:"completed"})]}:state({status:"completed",result} as Partial<LiveState>)));vi.stubGlobal("fetch",fetch);
    const rows=await liveHistory();expect(rows[0].result).toBeUndefined();const recovered=await getLiveResult(rows[0].id);
    expect(recovered.result).toEqual(result);expect(fetch.mock.calls.map(([url])=>url)).toEqual(["/api/live/sessions",`/api/live/sessions/${id}`]);
    expect(fetch.mock.calls.every((call:any[])=>!call[1]?.method||call[1].method==="GET")).toBe(true);
  });
});
