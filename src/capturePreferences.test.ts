import { describe, expect, it, vi } from "vitest";
import { CAPTURE_PREFERENCES_KEY, defaultCapturePreferences, loadCapturePreferences, saveCapturePreferences, type CapturePreferences } from "./capturePreferences";
import { emptyMicrophones, reconcileMicrophones, selectedMicrophoneMissing } from "./microphoneDevices";
import { dictionaries, LOCALES } from "./i18n";

const fixed: CapturePreferences = {mode:"both",deviceId:"usb-fixed-id",deviceLabel:"USB 마이크"};
const encoded = (value: unknown) => JSON.stringify(value);
function storage(initial: string | null = null) {
  let raw = initial;
  return {
    getItem: vi.fn((key:string) => key === CAPTURE_PREFERENCES_KEY ? raw : null),
    setItem: vi.fn((key:string,value:string) => {if(key===CAPTURE_PREFERENCES_KEY)raw=value;}),
    raw: () => raw,
  };
}

describe("recording source and fixed microphone preferences", () => {
  it("does not write defaults when no preference exists", () => {
    const s=storage();
    expect(loadCapturePreferences(s)).toEqual({settings:defaultCapturePreferences(),status:"default"});
    expect(s.setItem).not.toHaveBeenCalled();
  });
  it("restores the exact microphone and source across dialog sessions", () => {
    const s=storage();
    expect(saveCapturePreferences(fixed,s)).toEqual({ok:true});
    expect(loadCapturePreferences(s)).toEqual({settings:fixed,status:"saved"});
    expect(JSON.parse(s.raw()!)).toEqual({version:1,...fixed});
    expect(saveCapturePreferences({...fixed,mode:"system"},s).ok).toBe(true);
    const reopened=loadCapturePreferences(s).settings;
    expect(reopened).toEqual({...fixed,mode:"system"});
    expect(saveCapturePreferences({...reopened,mode:"microphone"},s).ok).toBe(true);
    expect(loadCapturePreferences(s).settings.deviceId).toBe(fixed.deviceId);
  });
  it("switches to the OS default only when explicitly saved with an empty device ID", () => {
    const s=storage(encoded({version:1,...fixed}));
    expect(saveCapturePreferences({...fixed,deviceId:"",deviceLabel:""},s).ok).toBe(true);
    expect(loadCapturePreferences(s).settings).toEqual({mode:"both",deviceId:"",deviceLabel:""});
  });
  it("retains a saved missing ID and does not interpret a permission-hidden list as removal", () => {
    const s=storage(encoded({version:1,...fixed})), restored=loadCapturePreferences(s).settings;
    const row=(deviceId:string,label:string)=>({deviceId,label,kind:"audioinput"} as MediaDeviceInfo);
    const hidden=reconcileMicrophones(emptyMicrophones(),[row("","")]);
    expect(selectedMicrophoneMissing(hidden,restored.deviceId)).toBe(false);
    const removed=reconcileMicrophones(emptyMicrophones(),[row("another-id","Other microphone")]);
    expect(selectedMicrophoneMissing(removed,restored.deviceId)).toBe(true);
    expect(restored).toEqual(fixed);
    expect(s.setItem).not.toHaveBeenCalled();
    expect(loadCapturePreferences(s).settings.deviceId).toBe(fixed.deviceId);
  });
  const malformed = [
    ["invalid JSON", "{"], ["null", "null"], ["array", "[]"],
    ["missing version", encoded(fixed)], ["future version", encoded({version:2,...fixed})],
    ["wrong mode", encoded({version:1,...fixed,mode:"output"})],
    ["wrong device type", encoded({version:1,...fixed,deviceId:1})],
    ["missing label", encoded({version:1,mode:"both",deviceId:"usb"})],
    ["extra property", encoded({version:1,...fixed,permissionGranted:true})],
    ["OS default alias", encoded({version:1,...fixed,deviceId:"default"})],
    ["communications alias", encoded({version:1,...fixed,deviceId:"communications"})],
    ["whitespace ID", encoded({version:1,...fixed,deviceId:" usb "})],
    ["control in label", encoded({version:1,...fixed,deviceLabel:"bad\u0000label"})],
    ["default with stale name", encoded({version:1,...fixed,deviceId:""})],
    ["long ID", encoded({version:1,...fixed,deviceId:"a".repeat(1025)})],
    ["long label", encoded({version:1,...fixed,deviceLabel:"a".repeat(513)})],
    ["oversized raw", " ".repeat(4097)],
    ["UTF-8 byte limit", encoded({version:1,...fixed,deviceId:"가".repeat(1024),deviceLabel:"나".repeat(512)})],
  ];
  it.each(malformed)("shows safe defaults but preserves the invalid original: %s", (_,raw) => {
    const s=storage(raw);
    expect(loadCapturePreferences(s)).toEqual({settings:defaultCapturePreferences(),status:"invalid"});
    expect(s.setItem).not.toHaveBeenCalled();
    expect(s.raw()).toBe(raw);
  });
  it("distinguishes inaccessible storage and failed writes without throwing or mutating the choice", () => {
    const s=storage(encoded({version:1,...fixed})), prior=s.raw();
    s.getItem.mockImplementation(()=>{throw new Error("denied");});
    expect(loadCapturePreferences(s).status).toBe("unavailable");
    s.setItem.mockImplementation(()=>{throw new Error("quota");});
    const next={...fixed,mode:"system" as const};
    expect(saveCapturePreferences(next,s)).toEqual({ok:false});
    expect(next).toEqual({...fixed,mode:"system"});
    expect(s.raw()).toBe(prior);
  });
  it("rejects invalid settings before writing over a previous selection", () => {
    const s=storage(encoded({version:1,...fixed})), prior=s.raw();
    expect(saveCapturePreferences({...fixed,deviceId:"default"},s)).toEqual({ok:false});
    expect(s.setItem).not.toHaveBeenCalled();
    expect(s.raw()).toBe(prior);
  });
  it("provides recovery messages in all five interface languages", () => {
    for(const key of ["저장된 선택 장치","녹음 소스와 마이크 선택을 이 기기에 저장했습니다.","저장된 녹음 소스 설정을 읽을 수 없어 기본값을 표시합니다. 시작 전에 소스와 마이크를 확인하고 직접 선택하세요.","녹음 소스 설정을 저장하거나 불러오지 못했습니다. 현재 선택은 사용할 수 있지만 다음에 복원되지 않을 수 있습니다."])
      for(const locale of LOCALES)expect(dictionaries[locale][key]).toBeTruthy();
  });
});
