import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveCapture } from "./liveCapture";
import type { Recording, RecordingStore } from "./recordingStore";

class FakeTrack extends EventTarget {
  readyState = "live";
  constructor(readonly kind = "audio") { super(); }
  stop = vi.fn(() => { this.readyState = "ended"; });
}
class FakeStream {
  constructor(readonly tracks: FakeTrack[] = []) {}
  getTracks() { return this.tracks; }
  getAudioTracks() { return this.tracks.filter(track => track.kind === "audio"); }
}
class FakeRecorder extends EventTarget {
  static instances: FakeRecorder[] = [];
  static isTypeSupported = () => true;
  state = "inactive";
  ondataavailable?: (event: { data: Blob }) => void;
  onerror?: () => void;
  constructor(readonly stream: FakeStream) { super(); FakeRecorder.instances.push(this); }
  start = vi.fn((interval: number) => { expect(interval).toBe(1000); this.state = "recording"; });
  data(value: string) { this.ondataavailable?.({ data: new Blob([value]) }); }
  stop = vi.fn(() => {
    this.state = "inactive";
    setTimeout(() => { this.data("final"); this.dispatchEvent(new Event("stop")); }, 10);
  });
}
class FakeContext {
  static instances: FakeContext[] = [];
  state = "running";
  gains: number[] = [];
  destination = { stream: new FakeStream([new FakeTrack()]) };
  constructor() { FakeContext.instances.push(this); }
  resume = vi.fn(async () => {});
  close = vi.fn(async () => { this.state = "closed"; });
  createMediaStreamDestination() { return this.destination; }
  createMediaStreamSource() { return { connect: (gain: { gain: { value: number }; connect: (destination: unknown) => unknown }) => { this.gains.push(gain.gain.value); return gain; } }; }
  createGain() { return { gain: { value: 1 }, connect: () => {} }; }
}
const settle = () => new Promise(resolve => setTimeout(resolve, 35));
function fakeStore() {
  const rows = new Map<string, Recording>(); const chunks: string[] = [];
  const store: RecordingStore = {
    create: vi.fn(async row => { rows.set(row.id, structuredClone(row)); }),
    append: vi.fn(async (_id, source, sequence, data) => { chunks.push(`${source}:${sequence}:${await data.text()}`); }),
    checkpoint: vi.fn(async (id, offsets) => { rows.get(id)!.offsets = { ...offsets }; }),
    finish: vi.fn(async (id, status, error, offsets) => { Object.assign(rows.get(id)!, { status, error, offsets }); }),
    list: vi.fn(async () => [...rows.values()]), file: vi.fn(), remove: vi.fn(),
  };
  return { store, rows, chunks };
}
let mic: FakeStream; let display: FakeStream;
let devices: { getUserMedia: ReturnType<typeof vi.fn>; getDisplayMedia: ReturnType<typeof vi.fn> };
beforeEach(() => {
  FakeRecorder.instances = []; FakeContext.instances = [];
  mic = new FakeStream([new FakeTrack()]); display = new FakeStream([new FakeTrack(), new FakeTrack("video")]);
  devices = { getUserMedia: vi.fn(async () => mic), getDisplayMedia: vi.fn(async () => display) };
  vi.stubGlobal("navigator", { mediaDevices: devices }); vi.stubGlobal("MediaRecorder", FakeRecorder);
  vi.stubGlobal("MediaStream", FakeStream); vi.stubGlobal("AudioContext", FakeContext);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("live capture using only simulated audio devices and storage", () => {
  it("requests display first, records audio-only stems and mix, and persists offsets before returning", async () => {
    const { store, rows } = fakeStore(); const capture = new LiveCapture(vi.fn(), store);
    expect(devices.getDisplayMedia).not.toHaveBeenCalled();
    const row = await capture.start("both", "chosen-mic");
    expect(devices.getDisplayMedia.mock.invocationCallOrder[0]).toBeLessThan(devices.getUserMedia.mock.invocationCallOrder[0]);
    expect(devices.getUserMedia).toHaveBeenCalledWith({ video: false, audio: { deviceId: { exact: "chosen-mic" }, echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    expect(row.sources).toEqual(["system", "microphone", "mix"]);
    expect(FakeRecorder.instances.every(recorder => recorder.stream.getTracks().every(track => track.kind === "audio"))).toBe(true);
    expect(FakeContext.instances[0].gains).toEqual([0.5, 0.5]);
    expect(Object.keys(rows.get(row.id)!.offsets)).toEqual(row.sources);
    expect(display.tracks[1].stop).not.toHaveBeenCalled();
    await capture.stop(); expect(display.tracks.every(track => track.stop.mock.calls.length === 1)).toBe(true);
  });

  it("waits for final data events and durable writes before completion, with idempotent stop", async () => {
    const { store, chunks } = fakeStore(); const capture = new LiveCapture(vi.fn(), store);
    await capture.start("microphone", "");
    let release!: () => void; const pending = new Promise<void>(resolve => { release = resolve; });
    const original = store.append; store.append = vi.fn(async (...args: Parameters<RecordingStore["append"]>) => { await pending; await original(...args); });
    const stopping = capture.stop(); expect(capture.stop()).toBe(stopping);
    await settle(); expect(store.finish).not.toHaveBeenCalled();
    release(); await stopping;
    expect(chunks).toEqual(["microphone:0:final", "mix:0:final"]);
    expect(store.finish).toHaveBeenCalledOnce(); expect(store.finish).toHaveBeenCalledWith(expect.any(String), "stopped", undefined, expect.any(Object));
    expect(FakeContext.instances[0].close).toHaveBeenCalledOnce();
  });

  it("waits for trailing data after an encoder becomes inactive due to an error", async () => {
    const failure = vi.fn(); const { store, chunks } = fakeStore(); const capture = new LiveCapture(failure, store);
    await capture.start("microphone", "");
    const recorder = FakeRecorder.instances[0]; recorder.state = "inactive"; recorder.onerror?.();
    await settle(); expect(store.finish).not.toHaveBeenCalled();
    recorder.data("after-error"); recorder.dispatchEvent(new Event("stop")); await capture.stop();
    expect(chunks).toContain("microphone:0:after-error"); expect(recorder.stop).not.toHaveBeenCalled();
    expect(failure).toHaveBeenCalledOnce(); expect(store.finish).toHaveBeenCalledWith(expect.any(String), "interrupted", expect.any(String), expect.any(Object));
  });

  it.each(["append", "finish"] as const)("releases input devices while %s storage is still pending, then preserves final chunks", async stage => {
    vi.useFakeTimers();
    const { store, chunks, rows } = fakeStore(); const capture = new LiveCapture(vi.fn(), store);
    const recording = await capture.start("both", "");
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    if (stage === "append") {
      const original = store.append;
      store.append = vi.fn(async (...args: Parameters<RecordingStore["append"]>) => { await pending; await original(...args); });
    } else {
      const original = store.finish;
      store.finish = vi.fn(async (...args: Parameters<RecordingStore["finish"]>) => { await pending; await original(...args); });
    }
    let completed = false;
    const stopping = capture.stop(); void stopping.then(() => { completed = true; });
    expect(capture.stop()).toBe(stopping);
    await vi.advanceTimersByTimeAsync(20);
    const tracks = [...mic.tracks, ...display.tracks, ...FakeContext.instances[0].destination.stream.tracks];
    for (const track of tracks) expect(track.stop).toHaveBeenCalledOnce();
    expect(completed).toBe(false);
    expect(rows.get(recording.id)?.status).toBe("recording");
    expect(chunks).toHaveLength(stage === "append" ? 0 : 3);
    release(); await stopping;
    expect(chunks).toEqual(["system:0:final", "microphone:0:final", "mix:0:final"]);
    expect(rows.get(recording.id)?.status).toBe("stopped");
    expect(store.finish).toHaveBeenCalledOnce();
    expect(capture.stop()).toBe(stopping);
    for (const track of tracks) expect(track.stop).toHaveBeenCalledOnce();
    expect(FakeContext.instances[0].close).toHaveBeenCalledOnce();
  });

  it("closes a stream arriving after stop while the OS chooser was still pending", async () => {
    let choose!: (stream: FakeStream) => void;
    devices.getDisplayMedia.mockImplementation(() => new Promise<FakeStream>(resolve => { choose = resolve; }));
    const { store } = fakeStore(); const capture = new LiveCapture(vi.fn(), store);
    const starting = capture.start("both", ""); const rejected = expect(starting).rejects.toThrow("취소");
    const stopping = capture.stop("창이 닫혀 녹음을 종료했습니다."); choose(display);
    await Promise.all([rejected, stopping]);
    expect(display.tracks.every(track => track.stop.mock.calls.length === 1)).toBe(true);
    expect(devices.getUserMedia).not.toHaveBeenCalled(); expect(store.create).not.toHaveBeenCalled();
  });

  it("releases already-granted display tracks when microphone permission is denied", async () => {
    devices.getUserMedia.mockRejectedValue(new DOMException("Permission denied", "NotAllowedError"));
    const { store } = fakeStore(); await expect(new LiveCapture(vi.fn(), store).start("both", "")).rejects.toThrow("권한이 거부");
    expect(display.tracks.every(track => track.stop.mock.calls.length === 1)).toBe(true); expect(store.create).not.toHaveBeenCalled();
  });

  it("rejects display streams without audio and releases the video track", async () => {
    display = new FakeStream([new FakeTrack("video")]); devices.getDisplayMedia.mockResolvedValue(display);
    await expect(new LiveCapture(vi.fn(), fakeStore().store).start("system", "")).rejects.toThrow("시스템 소리");
    expect(display.tracks[0].stop).toHaveBeenCalledOnce();
  });
  it("uses the default only when explicitly selected and never retries a missing fixed device", async () => {
    const capture = new LiveCapture(vi.fn(), fakeStore().store);
    await capture.start("microphone", "");
    expect(devices.getUserMedia.mock.calls[0][0].audio.deviceId).toBeUndefined();
    await capture.stop(); devices.getUserMedia.mockClear();
    devices.getUserMedia.mockRejectedValue(new DOMException("Missing device", "OverconstrainedError"));
    const { store } = fakeStore();
    await expect(new LiveCapture(vi.fn(), store).start("microphone", "removed-device")).rejects.toThrow("다시 선택");
    expect(devices.getUserMedia).toHaveBeenCalledOnce();
    expect(devices.getUserMedia.mock.calls[0][0].audio.deviceId).toEqual({exact:"removed-device"});
    expect(store.create).not.toHaveBeenCalled();
  });
  it("rejects a browser-returned substitute microphone and releases it before creating a recording", async () => {
    Object.assign(mic.tracks[0], { getSettings: () => ({deviceId:"unexpected-default"}) });
    const { store } = fakeStore();
    await expect(new LiveCapture(vi.fn(), store).start("microphone", "chosen-fixed-device")).rejects.toThrow("다시 선택");
    expect(mic.tracks[0].stop).toHaveBeenCalledOnce(); expect(store.create).not.toHaveBeenCalled();
  });

  it("preserves earlier chunks and marks interruption after storage failure", async () => {
    const { store, chunks } = fakeStore(); const failure = vi.fn(); const capture = new LiveCapture(failure, store);
    await capture.start("microphone", ""); FakeRecorder.instances[0].data("saved"); await settle();
    vi.mocked(store.append).mockRejectedValueOnce(new Error("Quota exceeded")); FakeRecorder.instances[0].data("lost");
    await settle(); await capture.stop();
    expect(chunks).toContain("microphone:0:saved"); expect(failure).toHaveBeenCalledOnce();
    expect(store.finish).toHaveBeenCalledWith(expect.any(String), "interrupted", expect.stringContaining("Quota exceeded"), expect.any(Object));
    expect(mic.tracks[0].stop).toHaveBeenCalledOnce();
  });

  it("cleans up tracks even if final metadata cannot be written", async () => {
    const { store } = fakeStore(); const capture = new LiveCapture(vi.fn(), store); await capture.start("system", "");
    vi.mocked(store.finish).mockRejectedValue(new Error("Disk unavailable")); await expect(capture.stop()).rejects.toThrow("Disk unavailable");
    expect(display.tracks.every(track => track.stop.mock.calls.length === 1)).toBe(true); expect(FakeContext.instances[0].close).toHaveBeenCalledOnce();
  });

  it("times out a broken recorder and preserves recovery metadata without leaving devices open", async () => {
    vi.useFakeTimers();
    const { store } = fakeStore(); const capture = new LiveCapture(vi.fn(), store); await capture.start("microphone", "");
    for (const recorder of FakeRecorder.instances) recorder.stop.mockImplementation(() => { recorder.state = "inactive"; });
    const stopping = capture.stop(); await vi.advanceTimersByTimeAsync(5000); await stopping;
    expect(store.finish).toHaveBeenCalledWith(expect.any(String), "interrupted", expect.stringContaining("응답"), expect.any(Object));
    expect(mic.tracks[0].stop).toHaveBeenCalledOnce(); expect(FakeContext.instances[0].close).toHaveBeenCalledOnce();
  });
});
