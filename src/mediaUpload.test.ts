import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, request, uploadMedia } from "./api";
import { sameAnalysisSource, type HistoryItem } from "./jobHistory";

afterEach(()=>vi.unstubAllGlobals());
const info={id:"a".repeat(32),name:"voice.wav",duration:1,audioTracks:[{index:0,label:"A",channels:1}],url:"/file"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json"}});

describe("media source reuse",()=>{
  it("shares concurrent uploads then checks the retained source instead of copying again",async()=>{
    const fetch=vi.fn(async(url:string)=>{expect(url).not.toBe("/api/cache");return json(info);});vi.stubGlobal("fetch",fetch);
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
    const fetch=vi.fn(async(url:string)=>{expect(url).not.toBe("/api/cache");return url.startsWith("/api/media/")?json({detail:"missing"},status):json(info);});vi.stubGlobal("fetch",fetch);
    const file=new File(["abc"],"voice.wav");await uploadMedia(file);
    status=503;await expect(uploadMedia(file)).rejects.toBeInstanceOf(ApiError);
    expect(fetch.mock.calls.filter(([url])=>url==="/api/media")).toHaveLength(1);
    status=404;await uploadMedia(file);
    expect(fetch.mock.calls.filter(([url])=>url==="/api/media")).toHaveLength(2);
  });
  it("does not preflight cache capacity or reject a file above the former cap",async()=>{
    const fetch=vi.fn(async(url:string,options?:RequestInit)=>{
      expect(url).toBe("/api/media");expect(options?.method).toBe("POST");
      expect(options?.body).toBeInstanceOf(FormData);
      return json(info);
    });vi.stubGlobal("fetch",fetch);
    const file=new File(["small fixture, no giant allocation"],"large-recording.mkv");
    Object.defineProperty(file,"size",{value:9*1024**3});
    await expect(uploadMedia(file)).resolves.toEqual(info);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((fetch.mock.calls[0][1]?.body as FormData).get("file")).toBe(file);
  });
  it("can retry a failed upload without a separate cache request",async()=>{
    let failed=true;
    const fetch=vi.fn(async(url:string)=>{
      expect(url).toBe("/api/media");return failed?json({detail:"Disk full"},507):json(info);
    });vi.stubGlobal("fetch",fetch);
    const file=new File(["abc"],"voice.wav");
    await expect(uploadMedia(file)).rejects.toMatchObject({status:507,message:"Disk full"});
    failed=false;await expect(uploadMedia(file)).resolves.toEqual(info);
    expect(fetch).toHaveBeenCalledTimes(2);
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
