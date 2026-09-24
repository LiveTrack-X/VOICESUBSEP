import { describe,expect,it } from "vitest";
import { resizeCaption,waveformPath } from "./timelineEditing";
import type { Caption } from "./domain";
const caption:Caption={id:"c",start:1,end:3,text:"hi",speakerId:null,reviewed:true,reasons:[],words:[{start:1,end:2,text:"hi"}]};
describe("timeline boundary editing",()=>{
  it("keeps a positive duration and clamps media boundaries",()=>{
    expect(resizeCaption(caption,"start",8,5).start).toBe(2.99);
    expect(resizeCaption(caption,"end",-1,5).end).toBe(1.01);
    expect(resizeCaption(caption,"end",10,5).end).toBe(5);
    expect(resizeCaption(caption,"start",-2,5).start).toBe(0);
  });
  it("invalidates word alignment and requests timing review only after a change",()=>{
    expect(resizeCaption(caption,"start",1,5)).toBe(caption);
    expect(resizeCaption(caption,"start",NaN,5)).toBe(caption);
    const resized=resizeCaption(caption,"end",3.125,5);
    expect(resized).toMatchObject({end:3.13,reviewed:false,reasons:["timing"]});
    expect(resized.words).toBeUndefined();
    expect(resizeCaption(resized,"end",4,5).reasons).toEqual(["timing"]);
  });
  it("positions waveform bins on original source time without stretching",()=>{
    expect(waveformPath([1,0.5],1,10)).toBe("M0.00,1.00V31.00M100.00,8.50V23.50");
    expect(waveformPath([NaN,-2,3],1,10)).not.toContain("NaN");
    expect(waveformPath([1],0,10)).toBe("");
  });
});
