import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LiveCaptureDialog } from "./components/LiveCaptureDialog";
import { I18nProvider } from "./i18n";
import { CAPTURE_PREFERENCES_KEY } from "./capturePreferences";

afterEach(()=>vi.unstubAllGlobals());
function renderSaved(raw:string) {
  const getUserMedia=vi.fn(),enumerateDevices=vi.fn(),setItem=vi.fn();
  vi.stubGlobal("navigator",{mediaDevices:{getUserMedia,enumerateDevices}});
  vi.stubGlobal("localStorage",{getItem:(key:string)=>key===CAPTURE_PREFERENCES_KEY?raw:null,setItem});
  const html=renderToStaticMarkup(<I18nProvider><LiveCaptureDialog onClose={()=>{}} onUse={()=>{}}/></I18nProvider>);
  expect(getUserMedia).not.toHaveBeenCalled();
  expect(enumerateDevices).not.toHaveBeenCalled();
  expect(setItem).not.toHaveBeenCalled();
  return html;
}
describe("restored recording choices before device access",()=>{
  it("shows the saved source and exact microphone while enumeration has not completed",()=>{
    const html=renderSaved(JSON.stringify({version:1,mode:"both",deviceId:"fixed-usb",deviceLabel:"My USB input"}));
    expect(html).toContain('<option value="both" selected="">');
    expect(html).toContain('<option value="fixed-usb" selected="">저장된 선택 장치: My USB input</option>');
    expect(html).not.toContain('<option value="" selected="">');
    expect(html).toContain("녹음 소스와 마이크 선택을 이 기기에 저장했습니다.");
  });
  it("restores system-only mode without exposing or substituting the remembered microphone",()=>{
    const html=renderSaved(JSON.stringify({version:1,mode:"system",deviceId:"fixed-usb",deviceLabel:"My USB input"}));
    expect(html).toContain('<option value="system" selected="">');
    expect(html).not.toContain('aria-label="입력 장치"');
    expect(html).toContain("출력 장치별 선택은 지원하지 않으며");
  });
  it("explains damaged settings instead of silently presenting a restored success",()=>{
    const html=renderSaved('{"version":99}');
    expect(html).toContain("저장된 녹음 소스 설정을 읽을 수 없어 기본값을 표시합니다.");
    expect(html).not.toContain("녹음 소스와 마이크 선택을 이 기기에 저장했습니다.");
    expect(html).toContain('<option value="microphone" selected="">');
  });
});
