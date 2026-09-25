export type InputLevel = { rms: number; peak: number };
export type LivePcmCallbacks = { onPcm?: (pcm: ArrayBuffer) => void; onLevel?: (level: InputLevel) => void };

/** A muted analysis branch; it never monitors input through the speakers. */
export class LivePcmTap {
  private stopped?: Promise<void>;
  private finish?: () => void;
  private timer?: ReturnType<typeof setTimeout>;
  private constructor(private source: MediaStreamAudioSourceNode, private node: AudioWorkletNode,
    private mute: GainNode, private callbacks: LivePcmCallbacks, private failure: (message: string) => void) {
    node.port.onmessage = ({ data }) => {
      if (data?.type === "stopped") { this.finish?.(); return; }
      try {
        if (data?.type === "pcm" && data.buffer instanceof ArrayBuffer && data.buffer.byteLength <= 16000 && data.buffer.byteLength % 2 === 0)
          callbacks.onPcm?.(data.buffer);
        if (data?.type === "level" && Number.isFinite(data.rms) && Number.isFinite(data.peak))
          callbacks.onLevel?.({ rms: Math.max(0, Math.min(1, data.rms)), peak: Math.max(0, Math.min(1, data.peak)) });
      } catch { this.failure("오디오 처리기가 중단되어 라이브 입력을 멈췄습니다. 저장된 녹음은 복구할 수 있습니다."); }
    };
    node.onprocessorerror = () => this.failure("오디오 처리기가 중단되어 라이브 입력을 멈췄습니다. 저장된 녹음은 복구할 수 있습니다.");
  }
  static async create(context: AudioContext, stream: MediaStream, callbacks: LivePcmCallbacks, failure: (message: string) => void) {
    if (!context.audioWorklet || typeof AudioWorkletNode === "undefined") throw new Error("이 환경에서는 라이브 오디오 처리를 사용할 수 없습니다. 녹음 후 분석 모드를 사용하세요.");
    // Keep a same-origin file: Electron intentionally disallows data: scripts.
    await context.audioWorklet.addModule(new URL("./live-pcm-worklet.js?no-inline", import.meta.url));
    const source = context.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(context, "voicesubsep-live-pcm", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
    const mute = context.createGain(); mute.gain.value = 0;
    source.connect(node).connect(mute).connect(context.destination);
    return new LivePcmTap(source, node, mute, callbacks, failure);
  }
  start() { this.node.port.postMessage("start"); }
  stop(): Promise<void> {
    if (this.stopped) return this.stopped;
    this.stopped = new Promise(resolve => {
      this.finish = () => {
        clearTimeout(this.timer); this.node.port.onmessage = null; this.node.onprocessorerror = null;
        this.source.disconnect(); this.node.disconnect(); this.mute.disconnect(); this.node.port.close();
        try { this.callbacks.onLevel?.({ rms: 0, peak: 0 }); } finally { resolve(); }
      };
      this.timer = setTimeout(() => {
        this.failure("오디오 처리 종료 응답이 없습니다. 마지막 라이브 자막 일부가 빠질 수 있으며 원본 녹음은 보존됩니다.");
        this.finish?.();
      }, 1000);
      this.node.port.postMessage("stop");
    });
    return this.stopped;
  }
}
