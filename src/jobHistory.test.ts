import { describe, expect, it } from "vitest";
import { cacheCleanupSelection, type CacheInfo } from "./jobHistory";
import { cacheMessages } from "./i18n-cache";

describe("reviewed cache cleanup selection", () => {
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
