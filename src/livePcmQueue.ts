export const MAX_PENDING_PCM_BYTES = 16000 * 2 * 5;
/** Exactly-once ordered delivery. A failed request is never retried because it
 * may already have reached the server; silently dropping samples breaks time. */
export class LivePcmQueue {
  private packets: ArrayBuffer[] = [];
  private bytes = 0;
  private sequence = 0;
  private sending = false;
  private accepting = true;
  private error?: Error;
  private controller = new AbortController();
  private waiters: { resolve: () => void; reject: (reason: Error) => void }[] = [];
  constructor(private send: (pcm: ArrayBuffer, sequence: number, signal: AbortSignal) => Promise<void>,
    private failed: (error: Error) => void, private changed: (seconds: number) => void = () => {}) {}
  push(pcm: ArrayBuffer): boolean {
    if (!this.accepting) return false;
    if (!pcm.byteLength || pcm.byteLength > 16000 || pcm.byteLength % 2) {
      this.fail(new Error("라이브 오디오 형식이 올바르지 않습니다.")); return false;
    }
    if (this.bytes + pcm.byteLength > MAX_PENDING_PCM_BYTES) {
      this.fail(new Error("라이브 전송이 5초 이상 밀려 중지했습니다. 원본 녹음으로 다시 분석할 수 있습니다.")); return false;
    }
    this.packets.push(pcm); this.bytes += pcm.byteLength; this.changed(this.bytes / 32000);
    void this.pump(); return true;
  }
  private async pump() {
    if (this.sending || this.error) return;
    this.sending = true;
    try {
      while (this.packets.length && !this.error) {
        const packet = this.packets[0]!;
        await this.send(packet, this.sequence, this.controller.signal);
        if (this.error) break;
        this.packets.shift(); this.bytes -= packet.byteLength; this.sequence++;
        this.changed(this.bytes / 32000);
      }
    } catch (error) { this.fail(error instanceof Error ? error : new Error("라이브 오디오 전송에 실패했습니다.")); }
    finally { this.sending = false; this.settle(); }
  }
  private settle() {
    if (!this.error && (this.packets.length || this.sending)) return;
    for (const waiter of this.waiters.splice(0)) this.error ? waiter.reject(this.error) : waiter.resolve();
  }
  private fail(error: Error) {
    if (this.error) return;
    this.error = error; this.accepting = false; this.controller.abort(); this.packets = []; this.bytes = 0;
    this.changed(0); this.settle(); this.failed(error);
  }
  finish(): Promise<void> {
    this.accepting = false;
    if (this.error) return Promise.reject(this.error);
    if (!this.packets.length && !this.sending) return Promise.resolve();
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
  }
  abort() {
    if (this.error) return;
    this.error = new Error("라이브 전송을 중단했습니다."); this.accepting = false;
    this.controller.abort(); this.packets = []; this.bytes = 0; this.changed(0); this.settle();
  }
}
