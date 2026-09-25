import { describe, expect, it } from "vitest";
import { CaptionVirtualLayout, captionRenderIndexes, type CaptionRowMeasurement } from "./captionVirtualList";

const ids=(count:number)=>Array.from({length:count},(_,index)=>`caption-${index}`);
const measurements=(entries:[string,number][])=>new Map<string,CaptionRowMeasurement>(entries.map(([id,height])=>[id,{height,context:"wide"}]));
describe("continuous caption height index",()=>{
  it("keeps 2,404 rich rows bounded at the beginning, middle and end without page boundaries",()=>{
    const layout=new CaptionVirtualLayout(ids(2404),new Map(),"wide",60);
    for(const top of [0,5940,6000,60*1200,layout.total]){
      const range=layout.range(top,324);const indexes=captionRenderIndexes(layout,range,null);
      expect(indexes.length).toBeLessThan(22);expect(indexes.every((index,i)=>i===0||index===indexes[i-1]+1)).toBe(true);
    }
    expect(captionRenderIndexes(layout,layout.range(5940,324),null)).toContain(100);
    expect(captionRenderIndexes(layout,layout.range(layout.total,324),null)).toContain(2403);
    expect(layout.indexAt(60)).toBe(1);expect(layout.indexAt(59.999)).toBe(0);
  });
  it("uses stable IDs for measured heights after time sorting, deleting or inserting a caption",()=>{
    const cache=measurements([["long",240],["short",54]]);
    const before=new CaptionVirtualLayout(["short","long","new"],cache,"wide",60);
    expect(before.offsets).toEqual([0,54,294,354]);
    const after=new CaptionVirtualLayout(["new","long"],cache,"wide",60);
    expect(after.offsets).toEqual([0,60,300]);expect(after.height(after.indexById.get("long")!)).toBe(240);
    const resized=new CaptionVirtualLayout(["long","short"],cache,"narrow",96);
    expect(resized.offsets).toEqual([0,96,192]);
  });
  it("preserves the visible caption and intra-row offset when preceding textarea heights change",()=>{
    const before=new CaptionVirtualLayout(ids(20),new Map(),"wide",60);
    const anchor=before.anchor(612);expect(anchor).toEqual({id:"caption-10",inside:12});
    const after=new CaptionVirtualLayout(ids(20),measurements([["caption-2",200],["caption-9",100]]),"wide",60);
    const top=after.anchoredTop(anchor,612,324);
    expect(top).toBe(792);expect(after.anchor(top)).toEqual(anchor);
  });
  it("clamps the viewport after filtering/deleting and centers the last cue without an empty end",()=>{
    const small=new CaptionVirtualLayout(["one","two"],new Map(),"wide",60);
    expect(small.range(200000,324)).toEqual({start:0,end:2});
    expect(small.anchoredTop({id:"deleted",inside:5},200000,324)).toBe(0);
    const large=new CaptionVirtualLayout(ids(2404),new Map(),"wide",60);
    expect(large.centeredTop(2403,324)).toBe(large.total-324);
    const empty=new CaptionVirtualLayout([],new Map(),"wide");expect(empty.range(100,324)).toEqual({start:0,end:0});expect(empty.anchor(0)).toBeNull();
  });
  it("pins the focused cue and its keyboard neighbors after scrolling far away, adding at most three rows",()=>{
    const layout=new CaptionVirtualLayout(ids(2404),new Map(),"wide",60);const range=layout.range(60*2000,324);
    const indexes=captionRenderIndexes(layout,range,"caption-5");
    expect(indexes.slice(0,3)).toEqual([4,5,6]);expect(indexes).toContain(2000);
    expect(indexes.length).toBe(range.end-range.start+3);expect(new Set(indexes).size).toBe(indexes.length);
    expect(captionRenderIndexes(layout,range,"deleted")).toHaveLength(range.end-range.start);
  });
  it("ignores invalid measurements rather than corrupting all following offsets",()=>{
    const layout=new CaptionVirtualLayout(["zero","nan","small"],measurements([["zero",0],["nan",NaN],["small",2]]),"wide",60);
    expect(layout.offsets).toEqual([0,60,120,180]);expect(layout.indexAt(Infinity)).toBe(0);
  });
});
