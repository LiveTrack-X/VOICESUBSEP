// The processor has no network or storage access. It emits bounded, transferable
// 0.5-second packets on a continuous 16 kHz clock; silence is never trimmed.
class LivePcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.active = false;
    this.finished = false;
    this.packet = new Int16Array(8000);
    this.used = 0;
    this.weight = 0;
    this.sum = 0;
    this.ratio = sampleRate / 16000;
    this.levelSamples = 0;
    this.levelSum = 0;
    this.levelPeak = 0;
    this.port.onmessage = ({ data }) => {
      if (data === "start" && !this.finished) this.active = true;
      if (data === "stop") {
        this.active = false;
        this.finished = true;
        this.emit();
        this.port.postMessage({ type: "stopped" });
      }
    };
  }
  emit() {
    if (!this.used) return;
    const pcm = this.packet.slice(0, this.used);
    this.port.postMessage({ type: "pcm", buffer: pcm.buffer }, [pcm.buffer]);
    this.used = 0;
  }
  process(inputs) {
    if (!this.active) return !this.finished;
    const channels = inputs[0];
    const length = channels?.[0]?.length ?? 128;
    for (let i = 0; i < length; i++) {
      let value = 0;
      for (const channel of channels ?? []) value += Number.isFinite(channel[i]) ? channel[i] : 0;
      value = Math.max(-1, Math.min(1, value / Math.max(1, channels?.length ?? 0)));
      this.levelSum += value * value;
      this.levelPeak = Math.max(this.levelPeak, Math.abs(value));
      if (++this.levelSamples >= sampleRate / 10) {
        this.port.postMessage({ type: "level", rms: Math.sqrt(this.levelSum / this.levelSamples), peak: this.levelPeak });
        this.levelSamples = 0; this.levelSum = 0; this.levelPeak = 0;
      }
      // Area-average resampling keeps fractional phase between render quanta.
      let remaining = 1;
      while (remaining > 1e-9) {
        const part = Math.min(remaining, this.ratio - this.weight);
        this.sum += value * part; this.weight += part; remaining -= part;
        if (this.weight >= this.ratio - 1e-9) {
          const sample = this.sum / this.ratio;
          this.packet[this.used++] = Math.round(sample * (sample < 0 ? 32768 : 32767));
          this.weight = 0; this.sum = 0;
          if (this.used === this.packet.length) this.emit();
        }
      }
    }
    return !this.finished;
  }
}
registerProcessor("voicesubsep-live-pcm", LivePcmProcessor);
