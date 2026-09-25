import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyMicrophones, MicrophoneDiscovery, microphoneAccessError, microphoneListState, reconcileMicrophones, selectedMicrophoneMissing, type MicrophoneSnapshot } from "./microphoneDevices";
import { dictionaries } from "./i18n";

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
const row = (deviceId: string, label: string, kind: MediaDeviceKind = "audioinput") => ({deviceId,label,kind,groupId:"group",toJSON:()=>({})} as MediaDeviceInfo);
const full = [row("default","Default - USB microphone"),row("communications","Communications - USB microphone"),row("usb","USB microphone"),row("line","Line input"),row("camera","Camera","videoinput"),row("out","Speakers","audiooutput")];
function fixture() {
  const track = {enabled:true,stop:vi.fn()};
  const stream = {getTracks:()=>[track],getAudioTracks:()=>[track]} as unknown as MediaStream;
  const media = {getUserMedia:vi.fn(async()=>stream),enumerateDevices:vi.fn(async()=>full)};
  const snapshots:MicrophoneSnapshot[] = [];
  const discovery = new MicrophoneDiscovery(media, snapshot=>snapshots.push(snapshot));
  return {track,stream,media,snapshots,discovery};
}
const deferred = <T,>() => { let resolve!: (value:T)=>void; const promise=new Promise<T>(done=>{resolve=done;}); return {promise,resolve}; };

describe("permission-aware microphone discovery without real devices", () => {
  it("distinguishes unasked/permission-hidden devices from genuinely empty and default-only input lists", () => {
    expect(microphoneListState(emptyMicrophones())).toBe("unchecked");
    expect(microphoneListState(reconcileMicrophones(emptyMicrophones(), [row("", "")]))).toBe("restricted");
    expect(microphoneListState(reconcileMicrophones(emptyMicrophones(), [], true))).toBe("empty");
    expect(microphoneListState(reconcileMicrophones(emptyMicrophones(), [row("default", "Default input")], true))).toBe("available");
    expect(microphoneListState(reconcileMicrophones(emptyMicrophones(), full, true))).toBe("available");
  });
  it("lists passively without requesting capture, filters outputs/cameras and removes OS aliases", async () => {
    const f = fixture(); await f.discovery.refresh();
    expect(f.media.getUserMedia).not.toHaveBeenCalled(); expect(f.track.stop).not.toHaveBeenCalled();
    expect(f.snapshots[0].devices).toEqual([{deviceId:"usb",label:"USB microphone"},{deviceId:"line",label:"Line input"}]);
    expect(f.snapshots[0].defaultLabel).toBe("Default - USB microphone");
  });
  it("reveals labels only after explicit permission and stops the disabled probe before returning", async () => {
    const f = fixture(); let granted=false;
    f.media.enumerateDevices.mockImplementation(async()=>granted?full:[row("","")]);
    f.media.getUserMedia.mockImplementation(async()=>{granted=true;return f.stream;});
    await f.discovery.refresh(); expect(f.snapshots[0].restricted).toBe(true); expect(f.snapshots[0].devices).toEqual([]);
    await f.discovery.refresh(true);
    expect(f.media.getUserMedia).toHaveBeenCalledWith({audio:true,video:false});
    expect(f.snapshots[1].restricted).toBe(false); expect(f.snapshots[1].devices).toHaveLength(2);
    expect(f.track.enabled).toBe(false); expect(f.track.stop).toHaveBeenCalledOnce();
  });
  it("preserves cached real names when permission hides the list rather than declaring devices removed", () => {
    const known = reconcileMicrophones(emptyMicrophones(), full, true);
    const masked = reconcileMicrophones(known, [row("","")]);
    expect(masked.devices).toEqual(known.devices); expect(masked.restricted).toBe(true);
    expect(selectedMicrophoneMissing(masked,"usb")).toBe(false);
    expect(reconcileMicrophones(masked,[]).restricted).toBe(true);
    const removed = reconcileMicrophones(known,[row("line","Line input")]);
    expect(selectedMicrophoneMissing(removed,"usb")).toBe(true);
    expect(selectedMicrophoneMissing(removed,"")).toBe(false);
  });
  it("handles hotplug refresh without acquiring another microphone or silently selecting a replacement", async () => {
    const f = fixture(); await f.discovery.refresh(true);
    f.media.enumerateDevices.mockResolvedValue([row("new","New microphone")]);
    await f.discovery.refresh();
    expect(f.media.getUserMedia).toHaveBeenCalledOnce();
    expect(selectedMicrophoneMissing(f.snapshots.at(-1)!,"usb")).toBe(true);
    expect(f.snapshots.at(-1)!.devices[0].deviceId).toBe("new");
  });
  it("releases the permission stream even when enumeration fails", async () => {
    const f = fixture(); f.media.enumerateDevices.mockRejectedValue(new Error("enumeration failed"));
    await expect(f.discovery.refresh(true)).rejects.toThrow("장치 확인에 실패");
    expect(f.track.stop).toHaveBeenCalledOnce(); expect(f.snapshots).toEqual([]);
  });
  it("does not enumerate or publish after permission is denied", async () => {
    const f = fixture(); f.media.getUserMedia.mockRejectedValue(new DOMException("Denied","NotAllowedError"));
    await expect(f.discovery.refresh(true)).rejects.toThrow("권한이 거부");
    expect(f.media.enumerateDevices).not.toHaveBeenCalled(); expect(f.snapshots).toEqual([]);
  });
  it("releases a stream arriving after the dialog closes and does not publish late results", async () => {
    const f = fixture(), granted=deferred<MediaStream>();
    f.media.getUserMedia.mockReturnValue(granted.promise);
    const pending=f.discovery.refresh(true); f.discovery.dispose(); granted.resolve(f.stream); await pending;
    expect(f.track.stop).toHaveBeenCalledOnce(); expect(f.media.enumerateDevices).not.toHaveBeenCalled(); expect(f.snapshots).toEqual([]);
  });
  it("immediately closes an acquired probe on dialog disposal while enumeration is pending", async () => {
    const f=fixture(), enumerated=deferred<MediaDeviceInfo[]>(); f.media.enumerateDevices.mockReturnValue(enumerated.promise);
    const pending=f.discovery.refresh(true); await Promise.resolve(); f.discovery.dispose();
    expect(f.track.stop).toHaveBeenCalledOnce(); enumerated.resolve(full); await pending;
    expect(f.track.stop).toHaveBeenCalledOnce(); expect(f.snapshots).toEqual([]);
  });
  it("prevents overlapping probes and stale passive enumeration from overriding permission results", async () => {
    const f=fixture(), old=deferred<MediaDeviceInfo[]>(), granted=deferred<MediaStream>();
    f.media.enumerateDevices.mockReturnValueOnce(old.promise); f.media.getUserMedia.mockReturnValue(granted.promise);
    const passive=f.discovery.refresh(), pending=f.discovery.refresh(true);
    old.resolve([row("","")]); await passive;
    await f.discovery.refresh(true); await f.discovery.refresh();
    expect(f.media.getUserMedia).toHaveBeenCalledOnce(); expect(f.media.enumerateDevices).toHaveBeenCalledOnce();
    granted.resolve(f.stream); await pending;
    expect(f.snapshots).toHaveLength(1); expect(f.snapshots[0].restricted).toBe(false);
  });
  it("times out discovery and releases a microphone even when enumeration never resolves", async () => {
    vi.useFakeTimers(); const f=fixture(); f.media.enumerateDevices.mockReturnValue(new Promise(()=>{}));
    const pending=f.discovery.refresh(true), rejection=expect(pending).rejects.toThrow("지연");
    await vi.advanceTimersByTimeAsync(5000); await rejection;
    expect(f.track.stop).toHaveBeenCalledOnce(); expect(f.snapshots).toEqual([]);
  });
  it("reports missing browser support without trying any capture", async () => {
    await expect(new MicrophoneDiscovery(undefined,vi.fn()).refresh(true)).rejects.toThrow("이 환경");
  });
  it.each(["NotAllowedError","NotFoundError","OverconstrainedError","NotReadableError","TimeoutError","UnknownError"])("provides translated recovery guidance for %s", name=>{
    const message=microphoneAccessError({name});
    for(const locale of ["ko","en","ja","zh","es"] as const)expect(dictionaries[locale][message]).toBeTruthy();
  });
});
