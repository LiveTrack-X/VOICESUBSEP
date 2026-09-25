import { recordingStore, type Recording, type RecordingSource, type RecordingStore } from "./recordingStore";
import { microphoneAccessError } from "./microphoneDevices";

export type CaptureMode = "microphone" | "system" | "both";
export function recordingMime(): string {
  const candidates = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/webm"];
  const mime = candidates.find(value => MediaRecorder.isTypeSupported(value));
  if (!mime) throw new Error("이 브라우저는 지원되는 오디오 형식으로 녹음할 수 없습니다.");
  return mime;
}
export class LiveCapture {
  private streams: MediaStream[] = [];
  private context?: AudioContext;
  private recorders: { recorder: MediaRecorder; started: boolean; stopped: boolean; ended: Promise<void> }[] = [];
  private writes: Promise<void> = Promise.resolve();
  private stopPromise?: Promise<void>;
  private stopping = false;
  private failure = "";
  private startSettled?: Promise<void>;
  private started = false;
  recording?: Recording;
  constructor(private onFailure: (error: string) => void, private store: RecordingStore = recordingStore) {}

  // Called directly by the Start click: system selection retains user activation.
  async start(mode: CaptureMode, deviceId: string): Promise<Recording> {
    if (this.started || this.stopping) throw new Error("녹음 시작이 취소되었거나 이미 시작된 세션입니다.");
    this.started = true;
    let settled!: () => void;
    this.startSettled = new Promise<void>(resolve => { settled = resolve; });
    const assertStarting = () => {
      if (this.stopping) throw new Error("녹음 시작이 취소되었거나 이미 시작된 세션입니다.");
    };
    const tracks: Partial<Record<RecordingSource, MediaStream>> = {};
    try {
      const mime = recordingMime();
      if (mode !== "microphone") {
        const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        this.streams.push(display);
        assertStarting();
        if (!display.getAudioTracks().length) throw new Error("시스템 소리가 선택되지 않았습니다. 소리 공유를 켜고 다시 시작하세요.");
        tracks.system = new MediaStream(display.getAudioTracks());
      }
      if (mode !== "system") {
        const mic = await navigator.mediaDevices.getUserMedia({ video: false, audio: {
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}), echoCancellation: false, noiseSuppression: false, autoGainControl: false,
        } }).catch(error => { throw new Error(microphoneAccessError(error)); });
        this.streams.push(mic); assertStarting();
        const micTrack = mic.getAudioTracks()[0];
        const actualId = micTrack?.getSettings?.().deviceId;
        if (!micTrack || deviceId && actualId && actualId !== deviceId) throw new Error("선택한 마이크를 사용할 수 없습니다. 장치 연결을 확인하고 목록을 새로고침한 뒤 직접 다시 선택하세요.");
        tracks.microphone = mic;
      }
      this.context = new AudioContext();
      await this.context.resume();
      assertStarting();
      const destination = this.context.createMediaStreamDestination();
      const inputs = Object.values(tracks);
      for (const stream of inputs) {
        const source = this.context.createMediaStreamSource(stream); const gain = this.context.createGain();
        gain.gain.value = 1 / inputs.length; source.connect(gain).connect(destination);
      }
      tracks.mix = destination.stream; this.streams.push(destination.stream);
      this.recording = { id: crypto.randomUUID(), startedAt: new Date().toISOString(), mime, sources: Object.keys(tracks) as RecordingSource[], offsets: {}, status: "recording", bytes: 0 };
      await this.store.create(this.recording);
      assertStarting();
      const epoch = performance.now();
      for (const [source, stream] of Object.entries(tracks) as [RecordingSource, MediaStream][]) {
        const recorder = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 128000 });
        let ended!: () => void;
        const item = { recorder, started: false, stopped: false, ended: new Promise<void>(resolve => { ended = resolve; }) };
        recorder.addEventListener("stop", () => { item.stopped = true; ended(); }, { once: true });
        let sequence = 0;
        recorder.ondataavailable = event => {
          if (!event.data.size) return;
          const index = sequence++;
          this.writes = this.writes.then(() => this.store.append(this.recording!.id, source, index, event.data)).catch(error => {
            this.fail(`녹음 저장 실패: ${error instanceof Error ? error.message : String(error)}`);
          });
        };
        recorder.onerror = () => this.fail("녹음 장치 오류가 발생했습니다. 저장된 조각을 복구할 수 있습니다.");
        this.recorders.push(item);
        this.recording.offsets[source] = performance.now() - epoch;
        recorder.start(1000);
        item.started = true;
      }
      for (const stream of this.streams) for (const track of stream.getTracks()) {
        if (track.readyState === "ended") throw new Error("입력 또는 공유가 종료되어 녹음을 멈췄습니다.");
        track.addEventListener("ended", () => {
          if (!this.stopping) this.fail("입력 또는 공유가 종료되어 녹음을 멈췄습니다.");
        }, { once: true });
      }
      // Persist stem offsets while recording, so crash recovery retains the same alignment metadata.
      await this.store.checkpoint(this.recording.id, this.recording.offsets);
      assertStarting();
      return this.recording;
    } catch(error) {
      this.failure ||= error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      settled();
      if (this.failure) await this.stop(this.failure);
    }
  }
  private fail(message: string) {
    try {
      if (!this.failure) { this.failure = message; this.onFailure(message); }
    } catch { /* A UI observer must not prevent resource cleanup. */ }
    finally {
      void this.stop(message).catch(() => { /* Durable chunks remain available after a final metadata failure. */ });
    }
  }
  stop(reason = ""): Promise<void> {
    if (this.stopPromise) return this.stopPromise;
    this.stopping = true; this.failure ||= reason;
    this.stopPromise = (async () => {
      let tracksReleased = false;
      const releaseTracks = () => {
        if (tracksReleased) return;
        tracksReleased = true;
        for (const stream of this.streams) for (const track of stream.getTracks()) track.stop();
      };
      try {
        // A request already awaiting the OS chooser may still yield a stream. Wait and close it too.
        await this.startSettled;
        await Promise.all(this.recorders.map(({ recorder, started, stopped, ended }) => new Promise<void>(resolve => {
          if (!started || stopped) { resolve(); return; }
          const timeout = setTimeout(() => { this.failure ||= "녹음 종료 응답이 없어 저장된 조각만 보존합니다."; resolve(); }, 5000);
          void ended.then(() => { clearTimeout(timeout); resolve(); });
          // On an encoder error, state may already be inactive before its last data/stop events.
          if (recorder.state !== "inactive") {
            try { recorder.stop(); }
            catch { this.failure ||= "녹음 장치 오류가 발생했습니다. 저장된 조각을 복구할 수 있습니다."; }
          }
        })));
        // Encoders have delivered their final chunks (or hit the bounded stop
        // timeout). Storage must not keep microphones or screen sharing open.
        releaseTracks();
        await this.writes;
        if (this.recording) await this.store.finish(this.recording.id, this.failure ? "interrupted" : "stopped", this.failure || undefined, this.recording.offsets);
      } finally {
        releaseTracks();
        if (this.context && this.context.state !== "closed") await this.context.close();
      }
    })();
    return this.stopPromise;
  }
}
