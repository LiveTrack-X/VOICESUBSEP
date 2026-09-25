import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { beginTextRun, cloudTextReady, textProviderModels } from "./textProviders";
import { acceptMinutesResponse } from "./documents";
import { createProject } from "./domain";
import { translateBatch } from "./translation";
import { dictionaries } from "./i18n";

afterEach(() => vi.unstubAllGlobals());
const generation = "a".repeat(32);
const registration = { groq: {configured: true, generation}, xai: {configured: true, generation} };
const mock = (value: unknown) => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(value), { status: 200, headers: {"Content-Type":"application/json"} }));
  vi.stubGlobal("fetch", fetch); return fetch;
};
const modelMock = (value: unknown) => {
  const fetch = vi.fn().mockImplementation((url: string) => Promise.resolve(new Response(JSON.stringify(
    url === "/api/provider-credentials" ? registration : value), { status: 200 })));
  vi.stubGlobal("fetch", fetch); return fetch;
};

describe("explicit cloud text opt-in", () => {
  it("requires registered session key, a model, consent and idle credentials for cloud work", () => {
    expect(cloudTextReady("local", "", false, false, true)).toBe(true);
    for (const provider of ["groq", "xai"] as const) {
      expect(cloudTextReady(provider, "text/model", true, true, false)).toBe(true);
      expect(cloudTextReady(provider, "text/model", false, true, false)).toBe(false);
      expect(cloudTextReady(provider, "text/model", true, false, false)).toBe(false);
      expect(cloudTextReady(provider, "text/model", true, true, true)).toBe(false);
      expect(cloudTextReady(provider, "", true, true, false)).toBe(false);
      expect(cloudTextReady(provider, "bad\nmodel", true, true, false)).toBe(false);
    }
  });
  it("queries only model metadata and checks provider/model list bounds", async () => {
    const fetch = modelMock({provider:"groq", models:["text-model", "organization/model"]});
    expect(await textProviderModels("groq")).toEqual(["text-model", "organization/model"]);
    expect(fetch.mock.calls[1][0]).toBe(`/api/translation/models?provider=groq&credentialGeneration=${generation}`);
    expect(fetch.mock.calls[1][1].body).toBeUndefined();
    for (const value of [{provider:"xai",models:["valid"]}, {provider:"groq",models:["bad\nmodel"]}, {provider:"groq",models:Array(1001).fill("x")}]) {
      modelMock(value); await expect(textProviderModels("groq")).rejects.toThrow();
    }
  });
  it("translation sends only bounded source text and explicit provider consent, never a key", async () => {
    const fetch = mock({target:"en",model:"text-model",captions:[{id:"c",sourceText:"안녕",text:"Hello"}]});
    const rows = await translateBatch([{id:"c",text:"안녕"}],"en","text-model","auto",{provider:"xai",cloudConsent:true,credentialGeneration:generation});
    expect(rows[0].text).toBe("Hello");
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body).toEqual({model:"text-model",target:"en",device:"auto",captions:[{id:"c",text:"안녕"}],provider:"xai",cloudConsent:true,credentialGeneration:generation});
    expect(body.key).toBeUndefined();
    fetch.mockClear();
    await expect(translateBatch([{id:"c",text:"안녕"}],"en","text-model","auto",{provider:"xai",cloudConsent:false})).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("captures one registration at run start and reuses it unchanged across batches", async () => {
    const fetch = mock(registration);
    const options = await beginTextRun("groq", true);
    expect(options).toEqual({provider:"groq", cloudConsent:true, credentialGeneration:generation});
    fetch.mockImplementation((url: string) => Promise.resolve(new Response(JSON.stringify(url === "/api/provider-credentials"
      ? {...registration,groq:{configured:true,generation:"b".repeat(32)}}
      : {target:"en",model:"text-model",captions:[{id:"c",sourceText:"안녕",text:"Hello"}]}), {status:200})));
    for (let i = 0; i < 2; i++) await translateBatch([{id:"c",text:"안녕"}],"en","text-model","auto",options);
    expect(fetch.mock.calls.filter(call=>call[0]==="/api/provider-credentials")).toHaveLength(1);
    for (const call of fetch.mock.calls.slice(1)) expect(JSON.parse(call[1].body).credentialGeneration).toBe(generation);
  });
  it("rejects missing registration metadata and has no credential lookup for local work", async () => {
    const fetch = mock({groq:{configured:true},xai:{configured:false}});
    await expect(beginTextRun("groq",true)).rejects.toThrow();
    fetch.mockClear();
    await expect(beginTextRun("groq",false)).rejects.toThrow();
    await expect(translateBatch([{id:"c",text:"x"}],"en","text-model","auto",{provider:"groq",cloudConsent:true})).rejects.toThrow();
    expect(await beginTextRun("local",false)).toEqual({provider:"local",cloudConsent:false});
    expect(fetch).not.toHaveBeenCalled();
  });
  it("cloud minutes are accepted only for the explicitly selected provider and remain source-bound drafts", () => {
    const project = createProject();
    const caption = {id:"c",start:0,end:1,text:"Min sends it Friday.",speakerId:project.speakers[0].id,reasons:[],reviewed:false};
    const response = {provider:"groq",localOnly:false,items:[{kind:"action",text:"Send it",owner:"Min",due:"Friday",evidenceIds:["c"]}]};
    expect(() => acceptMinutesResponse(response,[caption])).toThrow();
    expect(() => acceptMinutesResponse(response,[caption],"xai")).toThrow();
    const rows = acceptMinutesResponse(response,[caption],"groq");
    expect(rows[0].status).toBe("draft"); expect(rows[0].evidence[0].text).toBe(caption.text);
    expect(() => acceptMinutesResponse({...response,items:[{...response.items[0],evidenceIds:["unknown"]}]},[caption],"groq")).toThrow();
  });
  it("local is the opening default, consent is cleared after completion, and new controls are localized", () => {
    for (const name of ["TranslationDialog", "DocumentsDialog"]) {
      const source = readFileSync(new URL(`./components/${name}.tsx`, import.meta.url),"utf8");
      expect(source).toContain('useState<TextProvider>("local")');
      expect(source).toMatch(/finally\s*\{[^}]*setCloudConsent\(false\)/);
    }
    const controls = readFileSync(new URL("./components/TextProviderControls.tsx",import.meta.url),"utf8");
    for (const match of controls.matchAll(/\bt\("([^"]+)"/g)) expect(dictionaries.en[match[1]],match[1]).toBeTruthy();
    expect(controls).toContain("if (!state.configured || state.busy) onConsentChange(false)");
  });
});
