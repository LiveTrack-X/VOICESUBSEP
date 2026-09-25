/** Device discovery never records audio or opens the system-output chooser. */
export type MicrophoneDevice = { deviceId: string; label: string };
export type MicrophoneSnapshot = { devices: MicrophoneDevice[]; defaultLabel: string; restricted: boolean; checked: boolean };
export const emptyMicrophones = (): MicrophoneSnapshot => ({ devices: [], defaultLabel: "", restricted: true, checked: false });
type DevicesApi = Pick<MediaDevices, "enumerateDevices" | "getUserMedia">;

export function microphoneAccessError(error: unknown): string {
  const name = error && typeof error === "object" && "name" in error ? String(error.name) : "";
  if (["NotAllowedError", "PermissionDeniedError", "SecurityError"].includes(name)) return "마이크 권한이 거부되었습니다. 앱·브라우저와 Windows 개인정보 설정에서 마이크 접근을 허용한 뒤 다시 확인하세요.";
  if (["NotFoundError", "DevicesNotFoundError", "OverconstrainedError", "ConstraintNotSatisfiedError"].includes(name)) return "선택한 마이크를 사용할 수 없습니다. 장치 연결을 확인하고 목록을 새로고침한 뒤 직접 다시 선택하세요.";
  if (["NotReadableError", "TrackStartError", "AbortError"].includes(name)) return "마이크를 열 수 없습니다. 다른 앱의 독점 사용이나 장치 연결을 확인한 뒤 다시 시도하세요.";
  if (name === "TimeoutError") return "장치 목록 확인이 지연되어 마이크 연결을 해제했습니다. 다시 시도하세요.";
  return "마이크 장치 확인에 실패했습니다. 연결과 권한을 확인한 뒤 다시 시도하세요.";
}

export function reconcileMicrophones(previous: MicrophoneSnapshot, rows: readonly MediaDeviceInfo[], permissionConfirmed = false): MicrophoneSnapshot {
  const inputs = rows.filter(row => row.kind === "audioinput");
  const restricted = inputs.some(row => !row.deviceId || !row.label.trim()) || (!inputs.length && !permissionConfirmed && (!previous.checked || previous.restricted));
  const byId = new Map<string, MicrophoneDevice>();
  for (const row of inputs) {
    // Pseudo devices follow OS settings and must not masquerade as fixed hardware.
    if (row.deviceId && row.label.trim() && !["default", "communications"].includes(row.deviceId)) {
      byId.set(row.deviceId, { deviceId: row.deviceId, label: row.label.trim() });
    }
  }
  const defaultLabel = inputs.find(row => row.deviceId === "default")?.label.trim() || "";
  if (restricted) {
    // Permission-redacted lists are not evidence that previously selected
    // hardware disappeared. Retain names but mark their availability unknown.
    return { devices: previous.devices.length ? previous.devices : [...byId.values()], defaultLabel: previous.defaultLabel || defaultLabel, restricted: true, checked: true };
  }
  return { devices: [...byId.values()], defaultLabel, restricted: false, checked: true };
}

export function selectedMicrophoneMissing(snapshot: MicrophoneSnapshot, deviceId: string): boolean {
  return !!deviceId && snapshot.checked && !snapshot.restricted && !snapshot.devices.some(device => device.deviceId === deviceId);
}

/** Owns a short permission probe, including streams granted after the UI closes. */
export class MicrophoneDiscovery {
  private disposed = false;
  private epoch = 0;
  private probing = false;
  private releaseProbe?: () => void;
  private state = emptyMicrophones();
  constructor(private media: DevicesApi | undefined, private publish: (snapshot: MicrophoneSnapshot) => void) {}

  async refresh(requestPermission = false): Promise<void> {
    if (this.disposed || this.probing) return;
    if (!this.media?.enumerateDevices || requestPermission && !this.media.getUserMedia) throw new Error("이 환경에서는 마이크 장치 목록을 확인할 수 없습니다.");
    const epoch = ++this.epoch;
    let probe: MediaStream | undefined;
    let releaseTimer: ReturnType<typeof setTimeout> | undefined;
    let released = false;
    const release = () => { if (probe && !released) { released = true; for (const track of probe.getTracks()) track.stop(); } };
    this.probing = requestPermission;
    try {
      if (requestPermission) {
        probe = await this.media.getUserMedia({ audio: true, video: false });
        if (this.disposed) return;
        this.releaseProbe = release;
        if (!probe.getAudioTracks().length) throw new DOMException("No microphone", "NotFoundError");
        // Disable samples immediately. No AudioContext/MediaRecorder/storage is
        // used. Keep access only for enumeration, then stop every track below.
        for (const track of probe.getTracks()) track.enabled = false;
      }
      const enumeration = this.media.enumerateDevices();
      const rows = requestPermission ? await Promise.race([enumeration, new Promise<MediaDeviceInfo[]>((_, reject) => {
        releaseTimer = setTimeout(() => { release(); reject(new DOMException("Device enumeration timed out", "TimeoutError")); }, 5000);
      })]) : await enumeration;
      if (this.disposed || epoch !== this.epoch) return;
      this.state = reconcileMicrophones(this.state, rows, requestPermission);
      this.publish(this.state);
    } catch (error) {
      if (!this.disposed && epoch === this.epoch) throw new Error(microphoneAccessError(error));
    } finally {
      if (releaseTimer !== undefined) clearTimeout(releaseTimer);
      release();
      if (this.releaseProbe === release) this.releaseProbe = undefined;
      if (epoch === this.epoch) this.probing = false;
    }
  }
  dispose(): void {
    this.disposed = true; this.epoch++;
    this.releaseProbe?.(); this.releaseProbe = undefined;
  }
}
