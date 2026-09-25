import { request, type AnalysisResult } from "./api";
import { LivePcmQueue } from "./livePcmQueue";

export type LiveOptions = { whisperModel: string; language: string; device: "cpu" | "cuda"; diarization: true; speakerCount: number };
export type LiveState = {
  id: string; status: "loading" | "running" | "stopping" | "completed" | "failed" | "cancelled" | "interrupted";
  stage: string; sequence: number; receivedSeconds: number; processedSeconds: number; lagSeconds: number;
  createdAt?: string; updatedAt?: string;
  captions: AnalysisResult["captions"]; speakers: AnalysisResult["speakers"]; error?: string; result?: AnalysisResult;
  sourceUrl: string; overlayUrl: string; overlay: { muted: boolean };
};
export const liveTerminal = (state?: LiveState | null) => !!state && ["completed", "failed", "cancelled", "interrupted"].includes(state.status);
export async function liveHistory(): Promise<LiveState[]> {
  const value = await request<{items:unknown[]}>("/api/live/sessions");
  if (!Array.isArray(value.items) || value.items.length > 100) throw new Error("라이브 서버 응답 형식이 올바르지 않습니다.");
  return value.items.map(checkedLiveState);
}
export async function getLiveResult(id: string): Promise<LiveState> {
  if (!idPattern.test(id)) throw new Error("라이브 서버 응답 형식이 올바르지 않습니다.");
  return checkedLiveState(await request(`/api/live/sessions/${id}`));
}
const idPattern = /^[a-f0-9-]{32,36}$/u;
export function checkedLiveState(value: unknown): LiveState {
  const row = value as LiveState | null;
  if (!row || !idPattern.test(row.id) || !["loading","running","stopping","completed","failed","cancelled","interrupted"].includes(row.status) ||
    typeof row.stage !== "string" || ![row.receivedSeconds,row.processedSeconds,row.lagSeconds].every(n=>Number.isFinite(n)&&n>=0&&n<=7201) ||
    !Number.isInteger(row.sequence) || row.sequence < -1 || !Array.isArray(row.captions) || row.captions.length > 50 || !Array.isArray(row.speakers) ||
    typeof row.overlay?.muted !== "boolean" || row.sourceUrl !== `/api/live/sessions/${row.id}/source.wav`) throw new Error("라이브 서버 응답 형식이 올바르지 않습니다.");
  const url = new URL(row.overlayUrl);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || !url.pathname.startsWith(`/live-overlay/${row.id}/`) || url.username || url.password)
    throw new Error("라이브 서버 응답 형식이 올바르지 않습니다.");
  return row;
}

/** Network work is separate from audio capture. Prepare first, then explicitly
 * start devices, so model loading never fills the bounded outgoing queue. */
export class LiveSession {
  state?: LiveState;
  private closed = false;
  private timer?: ReturnType<typeof setTimeout>;
  private controller = new AbortController();
  private failureReported = false;
  private mutation = 0;
  private queue: LivePcmQueue;
  constructor(private onState: (state: LiveState) => void, private onError: (error: Error) => void,
    onQueue: (seconds: number) => void = () => {}) {
    this.queue = new LivePcmQueue(async (pcm, sequence, signal) => {
      if (!this.state || this.closed) throw new Error("라이브 세션이 준비되지 않았습니다.");
      await request(`/api/live/sessions/${this.state.id}/audio?seq=${sequence}`, {
        method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: pcm,
        signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
      });
    }, error => this.fail(error), onQueue);
  }
  private accept(value: unknown) {
    const state = checkedLiveState(value);
    if (this.state && (liveTerminal(this.state) && !liveTerminal(state) || this.state.status === "stopping" && ["running","loading"].includes(state.status))) return this.state;
    this.state = state;
    if (!this.closed) this.onState(state);
    if (state.status === "failed" || state.status === "interrupted") this.fail(new Error(state.error || "라이브 분석이 중단되었습니다. 원본 녹음으로 다시 분석할 수 있습니다."));
    if (liveTerminal(state)) clearTimeout(this.timer);
    return state;
  }
  async prepare(options: LiveOptions) {
    // The response still gets consumed after a close so a just-created session
    // can be explicitly cancelled instead of left occupying the inference slot.
    const state = checkedLiveState(await request("/api/live/sessions", { method: "POST", headers: { "Content-Type":"application/json" }, body: JSON.stringify(options) }));
    if (this.closed) { await request(`/api/live/sessions/${state.id}`, {method:"DELETE"}); return; }
    this.accept(state); this.schedule();
  }
  push(pcm: ArrayBuffer) { return this.queue.push(pcm); }
  private schedule() {
    clearTimeout(this.timer);
    if (this.closed || liveTerminal(this.state)) return;
    this.timer = setTimeout(()=>void this.poll(), 1000);
  }
  private async poll() {
    if (!this.state || this.closed) return;
    const mutation = this.mutation;
    try {
      const state = await request(`/api/live/sessions/${this.state.id}`, {signal:AbortSignal.any([this.controller.signal,AbortSignal.timeout(15_000)])});
      if (!this.closed && mutation === this.mutation) this.accept(state);
    } catch(error) { if (!this.closed) this.fail(error instanceof Error ? error : new Error("라이브 상태를 확인하지 못했습니다.")); }
    finally { if (!this.failureReported) this.schedule(); }
  }
  private fail(error: Error) {
    if (this.failureReported || this.closed) return;
    this.failureReported = true; clearTimeout(this.timer); this.queue.abort(); this.onError(error);
  }
  async stop() {
    await this.queue.finish();
    if (!this.state || this.closed) throw new Error("라이브 세션이 준비되지 않았습니다.");
    this.mutation++;
    this.accept(await request(`/api/live/sessions/${this.state.id}/stop`, {method:"POST"})); this.schedule();
  }
  async overlay(change: { muted?: boolean; clear?: boolean }) {
    if (!this.state || this.closed) return;
    this.mutation++;
    this.accept(await request(`/api/live/sessions/${this.state.id}/overlay`, {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(change)}));
  }
  async abort() {
    if (this.closed) return;
    this.closed = true; clearTimeout(this.timer); this.queue.abort(); this.controller.abort();
    if (this.state && !liveTerminal(this.state)) {
      const state = checkedLiveState(await request(`/api/live/sessions/${this.state.id}`, {method:"DELETE"}));
      this.state=state; this.onState(state);
    }
  }
}

/** The backend's PCM WAV shares the exact caption clock; MediaRecorder stems
 * remain separately recoverable, but their encoder start offsets can differ. */
export async function liveSourceFile(state: LiveState): Promise<File> {
  checkedLiveState(state);
  const response = await fetch(state.sourceUrl, {signal:AbortSignal.timeout(60_000)});
  if (!response.ok || !response.body) throw new Error("라이브 원본 녹음을 불러오지 못했습니다.");
  const max = 256 * 1024 ** 2;
  if (Number(response.headers.get("Content-Length")) > max) { await response.body.cancel(); throw new Error("라이브 원본 녹음이 허용 크기를 초과했습니다."); }
  const reader=response.body.getReader();const chunks:Uint8Array<ArrayBuffer>[]=[];let size=0;
  try {
    while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>max)throw new Error("라이브 원본 녹음이 허용 크기를 초과했습니다.");chunks.push(value as Uint8Array<ArrayBuffer>);}
  } catch(error) {await reader.cancel().catch(()=>{});throw error;}
  finally {reader.releaseLock();}
  return new File(chunks,`live-${state.id}.wav`,{type:"audio/wav"});
}
