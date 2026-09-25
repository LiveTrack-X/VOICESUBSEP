import { describe, expect, it, vi } from "vitest";
import { LivePcmQueue, MAX_PENDING_PCM_BYTES } from "./livePcmQueue";

const ticks = async () => { for (let i=0;i<6;i++) await Promise.resolve(); };
describe("bounded live PCM delivery", () => {
  it("sends in order, serially, including the final short packet before finish", async () => {
    const resolvers: (() => void)[] = []; const sent: [number, number][] = [];
    const queue = new LivePcmQueue((pcm,seq) => new Promise<void>(resolve=>{sent.push([seq,pcm.byteLength]);resolvers.push(resolve);}),vi.fn());
    queue.push(new ArrayBuffer(16000)); queue.push(new ArrayBuffer(16000)); queue.push(new ArrayBuffer(320));
    let done = false; const pending = queue.finish().then(()=>{done=true;});
    expect(sent).toEqual([[0,16000]]); expect(queue.push(new ArrayBuffer(2))).toBe(false);
    resolvers.shift()!(); await ticks(); expect(sent).toEqual([[0,16000],[1,16000]]); expect(done).toBe(false);
    resolvers.shift()!(); await ticks(); expect(sent.at(-1)).toEqual([2,320]);
    resolvers.shift()!(); await pending; expect(done).toBe(true);
  });
  it("bounds memory including the in-flight packet and never drops time silently", async () => {
    let signal: AbortSignal | undefined; const failed = vi.fn();
    const send = vi.fn((_pcm: ArrayBuffer,_seq: number,s: AbortSignal) => {signal=s;return new Promise<void>(()=>{});});
    const queue = new LivePcmQueue(send,failed);
    for(let i=0;i<MAX_PENDING_PCM_BYTES/16000;i++) expect(queue.push(new ArrayBuffer(16000))).toBe(true);
    expect(queue.push(new ArrayBuffer(2))).toBe(false); expect(failed).toHaveBeenCalledOnce(); expect(signal?.aborted).toBe(true);
    await expect(queue.finish()).rejects.toThrow("5초"); expect(send).toHaveBeenCalledOnce();
  });
  it("does not retry ambiguous failed sends or transmit later packets", async () => {
    const send=vi.fn(async()=>{throw new Error("connection lost");}); const failed=vi.fn();const queue=new LivePcmQueue(send,failed);
    queue.push(new ArrayBuffer(16000));queue.push(new ArrayBuffer(16000));await ticks();
    await expect(queue.finish()).rejects.toThrow("connection lost");expect(send).toHaveBeenCalledOnce();expect(failed).toHaveBeenCalledOnce();
  });
  it("abort promptly releases pending finish even when a transport ignores cancellation", async () => {
    const failed=vi.fn(); const queue=new LivePcmQueue(()=>new Promise<void>(()=>{}),failed);
    queue.push(new ArrayBuffer(16000));const finishing=queue.finish();queue.abort();queue.abort();
    await expect(finishing).rejects.toThrow("중단");expect(queue.push(new ArrayBuffer(2))).toBe(false);expect(failed).not.toHaveBeenCalled();
  });
  it.each([0,1,16002])("rejects invalid packet byte length %s", size=>{
    const send=vi.fn();const failed=vi.fn();const queue=new LivePcmQueue(send,failed);
    expect(queue.push(new ArrayBuffer(size))).toBe(false);expect(send).not.toHaveBeenCalled();expect(failed).toHaveBeenCalledOnce();
  });
});
