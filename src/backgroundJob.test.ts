import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, type Job } from "./api";
import { BackgroundJobMonitor, parseBackgroundPointer, sameBackgroundSource, type BackgroundJobPointer } from "./backgroundJob";
const pointer:BackgroundJobPointer={id:"a".repeat(32),projectId:"project-one",projectName:"My project",mediaId:"b".repeat(32),mediaName:"source.wav"};
const job=(status:Job["status"]="running"):Job=>({id:pointer.id,status,stage:status,progress:status==="completed"?1:.4});
const settle=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
function fixture(initial:BackgroundJobPointer|null=pointer){const write=vi.fn();const fetch=vi.fn(async(_id:string)=>job());const discover=vi.fn(async()=>pointer);const monitor=new BackgroundJobMonitor({read:()=>initial,write,fetch,discover});return{monitor,write,fetch,discover};}
beforeEach(()=>vi.useFakeTimers());afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});
describe("background analysis lifecycle",()=>{
  it("restores the exact pointer and polls only that job while dialogs are absent",async()=>{
    const {monitor,fetch,discover}=fixture();monitor.start();await settle();await vi.advanceTimersByTimeAsync(4000);
    expect(fetch).toHaveBeenCalledTimes(3);expect(fetch.mock.calls.every(call=>call[0]===pointer.id)).toBe(true);expect(discover).not.toHaveBeenCalled();expect(monitor.getSnapshot().job?.progress).toBe(.4);monitor.stop();
  });
  it("keeps completion visible until explicitly dismissed, without cancelling or restarting work",async()=>{
    const {monitor,fetch,write}=fixture();fetch.mockResolvedValue(job("completed"));monitor.start();await settle();await vi.advanceTimersByTimeAsync(20000);
    expect(fetch).toHaveBeenCalledOnce();expect(monitor.getSnapshot().job?.status).toBe("completed");monitor.dismiss();expect(monitor.getSnapshot().pointer).toBeNull();expect(write).toHaveBeenCalledWith(null);monitor.stop();
  });
  it("stops after three failures, retains the pointer and resumes only on retry",async()=>{
    const {monitor,fetch}=fixture();fetch.mockRejectedValue(new Error("offline"));monitor.start();await settle();await vi.advanceTimersByTimeAsync(30000);
    expect(fetch).toHaveBeenCalledTimes(3);expect(monitor.getSnapshot().paused).toBe(true);expect(monitor.getSnapshot().pointer).toEqual(pointer);
    fetch.mockResolvedValue(job());monitor.retry();await settle();expect(fetch).toHaveBeenCalledTimes(4);expect(monitor.getSnapshot().paused).toBe(false);monitor.stop();
  });
  it("does not retry a missing job endlessly or invent a successful result",async()=>{
    const {monitor,fetch}=fixture();fetch.mockRejectedValue(new ApiError("missing",404));monitor.start();await settle();await vi.advanceTimersByTimeAsync(30000);
    expect(fetch).toHaveBeenCalledOnce();expect(monitor.getSnapshot()).toMatchObject({paused:true,missing:true,job:null});monitor.dismiss();expect(monitor.getSnapshot().pointer).toBeNull();monitor.stop();
  });
  it("ignores stale responses after switching to a new job or receiving a terminal same-window notification",async()=>{
    const {monitor,fetch}=fixture();let resolve!:(value:Job)=>void;fetch.mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));monitor.start();
    monitor.track(pointer,job("completed"));resolve(job());await settle();expect(monitor.getSnapshot().job?.status).toBe("completed");
    const second={...pointer,id:"c".repeat(32),projectId:"project-two"};monitor.track(second,{...job(),id:second.id});expect(monitor.getSnapshot().pointer?.projectId).toBe("project-two");monitor.stop();
  });
  it("discovers existing active jobs once and never lets discovery overwrite a newly submitted job",async()=>{
    const {monitor,discover}=fixture(null);let resolve!:(value:BackgroundJobPointer)=>void;discover.mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));monitor.start();
    const second={...pointer,id:"c".repeat(32)};monitor.track(second,{...job(),id:second.id});resolve(pointer);await settle();expect(monitor.getSnapshot().pointer?.id).toBe(second.id);expect(discover).toHaveBeenCalledOnce();monitor.stop();
  });
  it("does not lose an active or restoring job when an old project restores a completed analysis",async()=>{
    const {monitor,write}=fixture();const old={...pointer,id:"d".repeat(32),projectId:"old-project"};
    monitor.track(old,{...job("completed"),id:old.id});expect(monitor.getSnapshot().pointer).toEqual(pointer);expect(write).not.toHaveBeenCalled();
    monitor.dismiss();expect(monitor.getSnapshot().pointer).toEqual(pointer);
    monitor.start();await settle();monitor.track(old,{...job("completed"),id:old.id});
    expect(monitor.getSnapshot().job?.status).toBe("running");expect(monitor.getSnapshot().pointer).toEqual(pointer);
    const submitted={...old,id:"e".repeat(32)};monitor.track(submitted,{...job("queued"),id:submitted.id});
    expect(monitor.getSnapshot().pointer).toEqual(submitted);monitor.stop();
  });
  it("requires both project and content identity; filenames never establish result application safety",()=>{
    expect(sameBackgroundSource(pointer,"project-one",pointer.mediaId)).toBe(true);
    expect(sameBackgroundSource(pointer,"project-two",pointer.mediaId)).toBe(false);expect(sameBackgroundSource(pointer,"project-one","different")).toBe(false);
    expect(parseBackgroundPointer({...pointer,result:{secret:"not persisted"}})).toEqual(pointer);
    expect(parseBackgroundPointer({...pointer,id:"../../jobs/other"})).toBeNull();
  });
});
