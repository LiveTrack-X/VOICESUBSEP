import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, request, uploadMedia } from "./api";
import { sameAnalysisSource, type HistoryItem } from "./jobHistory";

afterEach(()=>vi.unstubAllGlobals());
const info={id:"a".repeat(32),name:"voice.wav",duration:1,audioTracks:[{index:0,label:"A",channels:1}],url:"/file"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json"}});

describe("media source reuse",()=>{
  it("shares concurrent uploads then checks the retained source instead of copying again",async()=>{
    const fetch=vi.fn(async(url:string)=>json(url==="/api/cache"?{maxUploadBytes:1000}:info));vi.stubGlobal("fetch",fetch);
    const file=new File(["abc"],"voice.wav");
    const [left,right]=await Promise.all([uploadMedia(file),uploadMedia(file)]);
    expect(left.id).toBe(right.id);
    expect(fetch.mock.calls.filter(([url])=>url==="/api/media")).toHaveLength(1);
    await uploadMedia(file);
    expect(fetch.mock.calls.at(-1)![0]).toBe(`/api/media/${info.id}`);
    expect(fetch.mock.calls.filter(([url])=>url==="/api/media")).toHaveLength(1);
  });
  it("reuploads after explicit cache removal, but not on a transient connection error",async()=>{
    let status=200;
    const fetch=vi.fn(async(url:string)=>url.startsWith("/api/media/")?json({detail:"missing"},status):json(url==="/api/cache"?{maxUploadBytes:1000}:info));vi.stubGlobal("fetch",fetch);
    const file=new File(["abc"],"voice.wav");await uploadMedia(file);
    status=503;await expect(uploadMedia(file)).rejects.toBeInstanceOf(ApiError);
    expect(fetch.mock.calls.filter(([url])=>url==="/api/media")).toHaveLength(1);
    status=404;await uploadMedia(file);
    expect(fetch.mock.calls.filter(([url])=>url==="/api/media")).toHaveLength(2);
  });
  it("rejects oversized input before uploading and can retry a failed upload",async()=>{
    let limit=2;
    const fetch=vi.fn(async(url:string)=>json(url==="/api/cache"?{maxUploadBytes:limit}:info));vi.stubGlobal("fetch",fetch);
    const file=new File(["abc"],"voice.wav");await expect(uploadMedia(file)).rejects.toThrow("한도");
    expect(fetch.mock.calls).toHaveLength(1);limit=100;await expect(uploadMedia(file)).resolves.toEqual(info);
  });
  it("preserves HTTP status for missing-job recovery",async()=>{
    vi.stubGlobal("fetch",vi.fn(async()=>json({detail:"missing"},404)));
    await expect(request("/api/jobs/missing")).rejects.toMatchObject({status:404,message:"missing"});
  });
  it("does not apply history from another project or a different source with the same name",()=>{
    const item={kind:"analysis",projectId:"p1",mediaId:"source1",mediaName:"recording.mkv"} as HistoryItem;
    expect(sameAnalysisSource(item,"p1","source1")).toBe(true);
    expect(sameAnalysisSource(item,"p1","source2")).toBe(false);
    expect(sameAnalysisSource(item,"p2","source1")).toBe(false);
    expect(sameAnalysisSource({...item,projectId:undefined},"p1","source1")).toBe(false);
  });
});
