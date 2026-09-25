import { describe, expect, it } from "vitest";
import { cacheCleanupSelection, protectConnectedMedia, type CacheInfo } from "./jobHistory";
import type { DesktopMediaSource } from "./mediaSource";
import { cacheMessages } from "./i18n-cache";

describe("reviewed cache cleanup selection", () => {
  const source = (id: string): DesktopMediaSource => ({ kind: "desktop-media", name: "original.wav", size: 10, media: { id, name: "original.wav", duration: 1, audioTracks: [], url: `/api/media/${id}/file` } });
  it("protects the editor's restored source and reports matching reclaimable bytes without mutating the server snapshot", () => {
    const cache: CacheInfo = {items:[{id:"current",name:"copy",bytes:10,duration:2,protected:false},{id:"other",name:"copy",bytes:20,duration:2,protected:false},{id:"job",name:"copy",bytes:30,duration:2,protected:true}],bytes:60,reclaimableBytes:30,freeBytes:100};
    const visible = protectConnectedMedia(cache, source("current"));
    expect(visible.reclaimableBytes).toBe(20);
    expect(visible.items.map(item => item.protected)).toEqual([true, false, true]);
    expect(cacheCleanupSelection(visible)).toEqual({ids:["other"],bytes:20});
    expect(cache.items[0].protected).toBe(false);
    expect(protectConnectedMedia(cache, null).reclaimableBytes).toBe(30);
    expect(protectConnectedMedia(cache, new File(["original"], "original.wav")).reclaimableBytes).toBe(30);
  });
  it("rechecks a stale confirmation against the latest connected source, job protection and cache entries", () => {
    const item = (id:string,bytes:number,protectedValue=false) => ({id,name:id,bytes,duration:1,protected:protectedValue});
    const previous:CacheInfo={items:[item("now-connected",10),item("now-busy",20),item("gone",30),item("eligible",40)],bytes:100,reclaimableBytes:100,freeBytes:100};
    const reviewed=cacheCleanupSelection(previous);
    const refreshed={...previous,items:[item("now-connected",10),item("now-busy",20,true),item("eligible",40),item("new-upload",50)]};
    expect(cacheCleanupSelection(protectConnectedMedia(refreshed,source("now-connected")),reviewed.ids)).toEqual({ids:["eligible"],bytes:40});
    expect(cacheCleanupSelection(protectConnectedMedia(refreshed,source("eligible")),["eligible"])).toEqual({ids:[],bytes:0});
  });
  it("excludes protected sources and preserves the confirmation snapshot across refreshes", () => {
    const cache: CacheInfo = {items:[{id:"free",name:"copy",bytes:5,duration:2,protected:false},{id:"busy",name:"job",bytes:10,duration:2,protected:true}],bytes:15,reclaimableBytes:5,freeBytes:100};
    const selection = cacheCleanupSelection(cache);
    cache.items[0].protected = true; cache.items.push({...cache.items[0],id:"new",protected:false});
    expect(selection).toEqual({ids:["free"],bytes:5});
    expect(cacheCleanupSelection(cache)).toEqual({ids:["new"],bytes:5});
  });
  it("bounds each confirmation to the server request limit with matching displayed bytes", () => {
    const items = Array.from({length:1001},(_,index)=>({id:String(index),name:"copy",bytes:2,duration:1,protected:false}));
    const selection = cacheCleanupSelection({items,bytes:2002,reclaimableBytes:2002,freeBytes:0});
    expect(selection.ids).toHaveLength(1000); expect(selection.bytes).toBe(2000);
    expect(selection.ids).not.toContain("1000");
  });
  it("provides all four translated labels with unchanged interpolation parameters", () => {
    const params = (value:string) => [...value.matchAll(/\{(\w+)\}/g)].map(match=>match[1]).sort();
    for(const [key,labels] of Object.entries(cacheMessages)) {
      expect(labels).toHaveLength(4);
      for(const label of labels){expect(label.length).toBeGreaterThan(0);expect(params(label)).toEqual(params(key));}
    }
  });
});
