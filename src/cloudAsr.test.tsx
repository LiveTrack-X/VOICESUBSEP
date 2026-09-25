import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { cloudAsrBlockReason, cloudAsrRequestFields, defaultAsrSelection, type AsrSelection } from "./cloudAsr";
import { getProviderCredentialStatus, parseProviderCredentialStatus, removeProviderCredential, setProviderCredential, validProviderKey } from "./providerCredentials";
import { CloudAsrSettings } from "./components/CloudAsrSettings";
import { I18nProvider } from "./i18n";
import { defaultAnalysisPreferences } from "./settings";

const status = { groq: { configured: true }, xai: { configured: false }, gemini: { configured: false }, deepgram: { configured: false } };
afterEach(() => { vi.unstubAllGlobals(); });

describe("cloud ASR request boundaries", () => {
  it("starts locally and sends no cloud consent or model for local analysis", () => {
    expect(defaultAsrSelection()).toEqual({provider:"local"});
    expect(cloudAsrRequestFields(defaultAsrSelection(), false, false)).toEqual({});
  });
  it.each(["groq", "xai", "gemini"] as const)("requires an explicit model, session key and current consent for %s", provider => {
    const selection = defaultAsrSelection(provider);
    expect(cloudAsrBlockReason(selection, true, true, true)).not.toBeNull();
    expect(() => cloudAsrRequestFields(selection, false, true)).toThrow();
    expect(() => cloudAsrRequestFields(selection, true, false)).toThrow();
    expect(() => cloudAsrRequestFields({provider,model:"invented-model"}, true, true)).toThrow();
    expect(cloudAsrRequestFields(selection, true, true)).toEqual({asrProvider:provider,providerModel:"model" in selection ? selection.model : undefined,cloudConsent:true});
  });
  it("whitelists job metadata instead of copying credential-like fields", () => {
    const selection = {...defaultAsrSelection("groq"), apiKey:"private-key", key:"private-key", token:"private-key"} as unknown as AsrSelection;
    const result = cloudAsrRequestFields(selection, true, true);
    expect(Object.keys(result).sort()).toEqual(["asrProvider","cloudConsent","providerModel"]);
    expect(JSON.stringify(result)).not.toContain("private-key");
  });
  it("shows cloud scope, session-only key storage and consent without offering ChatGPT OAuth", () => {
    const html = renderToStaticMarkup(<I18nProvider><CloudAsrSettings selection={defaultAsrSelection("xai")} onChange={()=>{}} consent={false} onConsent={()=>{}} disabled={false} credentialBusy={false} onCredentialState={()=>{}} preferences={defaultAnalysisPreferences()} onPreferences={()=>{}}/></I18nProvider>);
    expect(html).toContain('type="password"');
    expect(html).toContain('autoComplete="off"');
    expect(html).toContain("서버 재시작 시 다시 등록");
    expect(html).toContain("사용료가 발생할 수 있음");
    expect(html).toContain("grok-voice-transcribe-2.0");
    expect(html).not.toContain('value="whisper-large-v3"');
    expect(html).not.toMatch(/<button\b[^>]*>[^<]*ChatGPT/);
  });
});

describe("session credential transport", () => {
  it("matches the server's 12–512 printable ASCII key limit", () => {
    expect(validProviderKey("x".repeat(12))).toBe(true);
    expect(validProviderKey("x".repeat(512))).toBe(true);
    for (const key of ["x".repeat(11), "x".repeat(513), "key with spaces 123", "한글".repeat(10), "key\u0000control123"])
      expect(validProviderKey(key)).toBe(false);
  });
  it("retains only configured booleans and rejects incomplete status", () => {
    expect(parseProviderCredentialStatus({...status, key:"secret", groq:{configured:true,key:"secret"}})).toEqual(status);
    for (const value of [null, {}, {groq:{configured:"true"},xai:{configured:false}}])
      expect(() => parseProviderCredentialStatus(value)).toThrow();
  });
  it("posts a key only to the credential route and never puts it in URLs or browser storage", async () => {
    const setItem = vi.fn(); vi.stubGlobal("localStorage", {getItem:()=>null,setItem});
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(status), {status:200}));
    vi.stubGlobal("fetch", fetcher);
    await setProviderCredential("groq", "  gsk_private_test_value  ");
    expect(fetcher.mock.calls[0][0]).toBe("/api/provider-credentials");
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({provider:"groq",key:"gsk_private_test_value"});
    expect(fetcher.mock.calls[0][1].method).toBe("POST");
    expect(setItem).not.toHaveBeenCalled();
  });
  it("discards reflected keys from credential errors and never records response bodies", async () => {
    const setItem = vi.fn(); vi.stubGlobal("localStorage", {getItem:()=>null,setItem});
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({detail:"gsk_private_echo_value"}),{status:422})));
    await expect(setProviderCredential("groq", "gsk_private_echo_value")).rejects.toThrow("API 키를 등록하지 못했습니다.");
    expect(JSON.stringify(setItem.mock.calls)).not.toContain("gsk_private_echo_value");
  });
  it("uses no-store for status and a provider-only path for removal", async () => {
    const fetcher = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify(status), {status:200})));
    vi.stubGlobal("fetch", fetcher);
    expect(await getProviderCredentialStatus()).toEqual(status);
    expect(fetcher.mock.calls[0][1].cache).toBe("no-store");
    await removeProviderCredential("xai");
    expect(fetcher.mock.calls[1][0]).toBe("/api/provider-credentials/xai");
    expect(fetcher.mock.calls[1][1].method).toBe("DELETE");
    expect(fetcher.mock.calls[1][1].body).toBeUndefined();
  });
});
