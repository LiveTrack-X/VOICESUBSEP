import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
function worklet(rate:number) {
  const messages:any[]=[];let Processor:any;
  class Base { port={onmessage:undefined as any,postMessage:(data:unknown)=>messages.push(data)}; }
  runInNewContext(readFileSync(new URL("./live-pcm-worklet.js",import.meta.url),"utf8"),{
    AudioWorkletProcessor:Base,sampleRate:rate,registerProcessor:(_name:string,value:unknown)=>{Processor=value;},Int16Array,
  });
  const processor=new Processor();processor.port.onmessage({data:"start"});
  return {processor,messages};
}
describe("synthetic AudioWorklet PCM clock",()=>{
  it.each([16000,44100,48000,96000])("resamples %s Hz without trimming silence or growing packets",rate=>{
    const {processor,messages}=worklet(rate);let emitted=0;
    while(emitted<rate){const length=Math.min(128,rate-emitted);processor.process([[new Float32Array(length).fill(0.5)]]);emitted+=length;}
    processor.port.onmessage({data:"stop"});
    const packets=messages.filter(m=>m.type==="pcm").map(m=>new Int16Array(m.buffer));
    expect(packets.reduce((n,p)=>n+p.length,0)).toBe(16000);expect(packets.every(p=>p.length<=8000)).toBe(true);
    expect(packets.flatMap(p=>Array.from(p)).every(value=>Math.abs(value-16384)<=1)).toBe(true);
    const level=messages.find(m=>m.type==="level");expect(level.rms).toBeCloseTo(.5);expect(level.peak).toBe(.5);
    expect(messages.at(-1).type).toBe("stopped");
  });
  it("downmixes channel samples and flushes the last partial packet exactly once",()=>{
    const {processor,messages}=worklet(48000);
    processor.process([[new Float32Array(120).fill(1),new Float32Array(120).fill(-1)]]);
    processor.port.onmessage({data:"stop"});processor.port.onmessage({data:"stop"});
    const packets=messages.filter(m=>m.type==="pcm");expect(packets).toHaveLength(1);
    expect(Array.from(new Int16Array(packets[0].buffer))).toEqual(Array(40).fill(0));
    expect(processor.process([[new Float32Array(128)]] )).toBe(false);
  });
});
