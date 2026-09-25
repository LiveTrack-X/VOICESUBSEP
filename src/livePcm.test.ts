import { afterEach, describe, expect, it, vi } from "vitest";
import { LivePcmTap } from "./livePcm";

function fixture() {
  const source={connect:vi.fn(),disconnect:vi.fn()};const mute={gain:{value:1},connect:vi.fn(),disconnect:vi.fn()};
  let node:any;
  class Worklet {port={onmessage:null as any,postMessage:vi.fn(),close:vi.fn()};onprocessorerror:any;connect=vi.fn(()=>mute);disconnect=vi.fn();constructor(){node=this;}}
  source.connect.mockImplementation(()=>node);vi.stubGlobal("AudioWorkletNode",Worklet);
  const context={audioWorklet:{addModule:vi.fn(async()=>{})},createMediaStreamSource:()=>source,createGain:()=>mute,destination:{}};
  return {source,mute,context:context as unknown as AudioContext,get node(){return node;}};
}
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
describe("worklet branch cleanup",()=>{
  it("keeps monitoring muted and accepts final PCM before its bounded stop acknowledgement",async()=>{
    const f=fixture();const pcm=vi.fn();const level=vi.fn();const failure=vi.fn();const tap=await LivePcmTap.create(f.context,{} as MediaStream,{onPcm:pcm,onLevel:level},failure);
    expect(f.mute.gain.value).toBe(0);tap.start();expect(f.node.port.postMessage).toHaveBeenCalledWith("start");
    const pending=tap.stop();expect(tap.stop()).toBe(pending);expect(f.source.disconnect).not.toHaveBeenCalled();
    const buffer=new ArrayBuffer(800);f.node.port.onmessage({data:{type:"pcm",buffer}});f.node.port.onmessage({data:{type:"stopped"}});await pending;
    expect(pcm).toHaveBeenCalledWith(buffer);expect(f.source.disconnect).toHaveBeenCalledOnce();expect(f.node.port.close).toHaveBeenCalledOnce();expect(level).toHaveBeenLastCalledWith({rms:0,peak:0});expect(failure).not.toHaveBeenCalled();
  });
  it("releases the audio graph after a missing stop response and marks possible missing final captions",async()=>{
    vi.useFakeTimers();const f=fixture();const failure=vi.fn();const tap=await LivePcmTap.create(f.context,{} as MediaStream,{},failure);
    const pending=tap.stop();await vi.advanceTimersByTimeAsync(1000);await pending;
    expect(failure).toHaveBeenCalledOnce();expect(failure.mock.calls[0][0]).toContain("일부가 빠질");expect(f.node.disconnect).toHaveBeenCalledOnce();
  });
});
