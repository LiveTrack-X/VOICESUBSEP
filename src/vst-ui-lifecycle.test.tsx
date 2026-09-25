import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

// A deterministic hook runner exercises the component's async ownership without loading
// plugins or adding a browser dependency. Actual DOM clicks are covered by isolated QA.
const hooks = vi.hoisted(() => ({ values: [] as any[], cursor: 0, effects: [] as (() => void)[], dirty: false }));
vi.mock("react", async importOriginal => ({ ...await importOriginal<typeof import("react")>(),
  useState: (initial: any) => {
    const index = hooks.cursor++;
    if (!(index in hooks.values)) hooks.values[index] = typeof initial === "function" ? initial() : initial;
    return [hooks.values[index], (next: any) => {
      const value = typeof next === "function" ? next(hooks.values[index]) : next;
      if (!Object.is(value, hooks.values[index])) { hooks.values[index] = value; hooks.dirty = true; }
    }];
  },
  useRef: (initial: any) => { const index = hooks.cursor++; return hooks.values[index] ??= { current: initial }; },
  useMemo: (compute: () => any, deps: any[]) => {
    const index = hooks.cursor++, previous = hooks.values[index];
    if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) hooks.values[index] = { deps, value: compute() };
    return hooks.values[index].value;
  },
  useEffect: (effect: () => void | (() => void), deps: any[]) => {
    const index = hooks.cursor++, previous = hooks.values[index];
    if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) {
      hooks.values[index] = { deps, cleanup: previous?.cleanup };
      hooks.effects.push(() => { hooks.values[index].cleanup?.(); hooks.values[index].cleanup = effect(); });
    }
  },
}));
vi.mock("./i18n", () => ({ useI18n: () => ({ locale: "ko", t: (key: string, values: Record<string, unknown> = {}) => key.replace(/\{(\w+)\}/g, (match, name) => String(values[name] ?? match)) }) }));
vi.mock("./api", () => ({ request: vi.fn(), download: vi.fn() }));
import { request } from "./api";
import { VstChainPanel } from "./components/VstChainPanel";
import { VST_STORAGE_KEY } from "./vst";
const mockRequest = vi.mocked(request);
const slot = { id: "qa", name: "QA", path: "C:\\QA\\Test.vst3", enabled: true, parameters: { gain: 1 } };
let media: any, tree: any, audioTrack = 0;
const onStateChange = vi.fn();
function render() {
  for (let tries = 0; tries < 10; tries++) {
    hooks.cursor = 0; hooks.dirty = false;
    tree = VstChainPanel({ media, audioTrack, onStateChange });
    hooks.effects.splice(0).forEach(effect => effect());
    if (!hooks.dirty) return;
  }
  throw new Error("Hook updates did not settle");
}
async function settle() { for (let i = 0; i < 8; i++) { await Promise.resolve(); render(); } }
function nodes(node: any): any[] { return Array.isArray(node) ? node.flatMap(item => nodes(item)) : node && typeof node === "object" ? [node, ...nodes(node.props?.children ?? null)] : []; }
function text(node: any): string { return Array.isArray(node) ? node.map(text).join("") : node && typeof node === "object" ? text(node.props?.children) : typeof node === "string" ? node : ""; }
function click(label: string) { const button = nodes(tree).find(node => node.type === "button" && text(node).includes(label)); expect(button).toBeTruthy(); button.props.onClick(); render(); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function countEditorPosts() { return mockRequest.mock.calls.filter(([path, init]) => path === "/api/vst/editors" && init?.method === "POST").length; }
function editorStatus() { return nodes(tree).find(node => node.props?.className === "vst-editor-status"); }
async function tick(ms: number) { await vi.advanceTimersByTimeAsync(ms); await settle(); }
const completedEditor = (id = "editor") => ({ id, status: "completed", result: { path: slot.path, name: slot.name, parameters: [{ key: "gain", label: "Gain", type: "number", value: 2, min: 0, max: 5 }], state: "cHJlc2V0" } });

beforeEach(async () => {
  vi.useFakeTimers();
  hooks.values = []; hooks.cursor = 0; hooks.effects = []; hooks.dirty = false; onStateChange.mockClear(); mockRequest.mockReset();
  media = { id: "source-a", duration: 60 }; audioTrack = 0;
  vi.stubGlobal("window", { setTimeout, clearTimeout });
  vi.stubGlobal("localStorage", { getItem: (key: string) => key === VST_STORAGE_KEY ? JSON.stringify({ version: 1, enabled: true, applyTo: "asr", chain: [slot] }) : null, setItem: vi.fn() });
  mockRequest.mockImplementation(async (path, init) => {
    if (path === "/api/vst/status") return { available: true } as any;
    if (path === "/api/vst/plugins") return { plugins: [], roots: [] } as any;
    if (path === "/api/vst/editors") return { id: "editor", status: "running" } as any;
    if (path === "/api/vst/previews") return { id: "preview-a", status: "running" } as any;
    return { id: String(path).split("/").at(-1), status: init?.method === "DELETE" ? "cancelled" : "running" } as any;
  });
  render(); await settle();
});

describe("native VST window status and commands", () => {
  it("distinguishes the request, preparation and observed open stages, then focuses without reopening", async () => {
    const posted = deferred<any>();
    const normal = mockRequest.getMockImplementation()!;
    let stage = "opening";
    mockRequest.mockImplementation((path, init) => {
      if (path === "/api/vst/editors") return posted.promise;
      if (String(path).startsWith("/api/vst/editors/editor")) return Promise.resolve({ id: "editor", status: "running", stage } as any);
      return normal(path, init);
    });
    click("플러그인 창 열기");
    expect(text(editorStatus())).toContain("플러그인 창 요청 중…");
    posted.resolve({ id: "editor", status: "running", stage: "loading" }); await settle();
    expect(text(editorStatus())).toContain("플러그인 불러오는 중…");
    await tick(1250);
    expect(text(editorStatus())).toContain("플러그인 창 여는 중…");
    expect(text(editorStatus())).toContain("준비 대기 1초");
    stage = "open"; await tick(1000);
    expect(text(editorStatus())).toContain("플러그인 창 열림");
    expect(text(editorStatus())).not.toContain("준비 대기");
    expect(nodes(editorStatus()).filter(node => node.props?.className === "spin")).toHaveLength(0);
    click("창 앞으로 가져오기"); await settle();
    expect(mockRequest).toHaveBeenCalledWith("/api/vst/editors/editor/focus", expect.objectContaining({ method: "POST", body: "{}" }));
    expect(countEditorPosts()).toBe(1);
  });

  it("ignores the GET begun before close, then applies the final result exactly once", async () => {
    const previousPoll = deferred<any>();
    const normal = mockRequest.getMockImplementation()!;
    let polled = 0;
    mockRequest.mockImplementation((path, init) => {
      if (path === "/api/vst/editors/editor/close") return Promise.resolve({ id: "editor", status: "running", stage: "open", closeRequested: true } as any);
      if (path === "/api/vst/editors/editor" && !init?.method) return polled++ === 0 ? previousPoll.promise : Promise.resolve(completedEditor() as any);
      return normal(path, init);
    });
    click("플러그인 창 열기"); await settle(); await tick(500);
    click("닫고 적용"); await settle();
    expect(text(editorStatus())).toContain("설정 저장·창 닫는 중…");
    previousPoll.resolve({ id: "editor", status: "running", stage: "loading" }); await settle();
    expect(text(editorStatus())).toContain("설정 저장·창 닫는 중…");
    await tick(250);
    expect(text(tree)).toContain("플러그인 창의 설정을 적용했습니다.");
    expect(onStateChange.mock.lastCall?.[0].busy).toBe(false);
    const saves = vi.mocked(localStorage.setItem).mock.calls.filter(([, value]) => JSON.parse(value).chain[0]?.parameters.gain === 2);
    expect(saves).toHaveLength(1);
  });

  it("can leave accepted cancellation even with healthy running responses and ignores a detached result", async () => {
    const oldPoll = deferred<any>();
    const normal = mockRequest.getMockImplementation()!;
    let posted = 0, polled = 0;
    mockRequest.mockImplementation((path, init) => {
      if (path === "/api/vst/editors") return Promise.resolve({ id: ++posted === 1 ? "editor" : "new-editor", status: "running", stage: "loading" } as any);
      if (path === "/api/vst/editors/editor" && init?.method === "DELETE") return Promise.resolve({ id: "editor", status: "running", cancelRequested: true } as any);
      if (path === "/api/vst/editors/editor" && !init?.method) return polled++ === 0 ? Promise.resolve({ id: "editor", status: "running", cancelRequested: true } as any) : oldPoll.promise;
      return normal(path, init);
    });
    click("플러그인 창 열기"); await settle();
    click("변경 취소·창 닫기"); await settle(); await tick(1250);
    expect(text(editorStatus())).toContain("플러그인 창 취소 중…");
    click("창 닫기 요청·연결 해제"); await settle();
    expect(onStateChange.mock.lastCall?.[0].busy).toBe(false);
    click("플러그인 창 열기"); await settle();
    oldPoll.resolve(completedEditor()); await settle();
    expect(text(tree)).not.toContain("플러그인 창의 설정을 적용했습니다.");
    expect(text(editorStatus())).toContain("플러그인 불러오는 중…");
    expect(onStateChange.mock.lastCall?.[0].busy).toBe(true);
  });

  it("cleans up a late POST after cancellation before the session ID arrives", async () => {
    const posted = deferred<any>();
    const normal = mockRequest.getMockImplementation()!;
    let count = 0;
    mockRequest.mockImplementation((path, init) => path === "/api/vst/editors" && count++ === 0 ? posted.promise : normal(path, init));
    click("플러그인 창 열기");
    click("변경 취소·창 닫기"); await settle();
    expect(onStateChange.mock.lastCall?.[0].busy).toBe(false);
    click("플러그인 창 열기"); await settle();
    posted.resolve({ id: "late-editor", status: "running", stage: "open" }); await settle();
    expect(mockRequest).toHaveBeenCalledWith("/api/vst/editors/late-editor", expect.objectContaining({ method: "DELETE" }));
    expect(onStateChange.mock.lastCall?.[0].busy).toBe(true);
    expect(text(editorStatus())).toContain("플러그인 준비 중…");
  });

  it("never applies settings when a close races with the discard response", async () => {
    const normal = mockRequest.getMockImplementation()!;
    mockRequest.mockImplementation((path, init) => path === "/api/vst/editors/editor" && init?.method === "DELETE" ? Promise.resolve(completedEditor() as any) : normal(path, init));
    click("플러그인 창 열기"); await settle();
    click("변경 취소·창 닫기"); await settle();
    expect(onStateChange.mock.lastCall?.[0].busy).toBe(false);
    expect(text(tree)).not.toContain("플러그인 창의 설정을 적용했습니다.");
    expect(vi.mocked(localStorage.setItem).mock.calls.some(([, value]) => JSON.parse(value).chain[0]?.parameters.gain === 2)).toBe(false);
  });

  it("supports old backends missing focus without incorrectly expiring their editor", async () => {
    const normal = mockRequest.getMockImplementation()!;
    mockRequest.mockImplementation((path, init) => path === "/api/vst/editors/editor/focus" ? Promise.reject({ status: 404 }) : normal(path, init));
    click("플러그인 창 열기"); await settle(); click("창 앞으로 가져오기"); await settle();
    expect(onStateChange.mock.lastCall?.[0].busy).toBe(true);
    expect(text(tree)).toContain("창 앞으로 가져오기를 요청하지 못했습니다.");
    expect(text(tree)).not.toContain("작업이 만료되었습니다");
  });

  it.each([404, 503])("releases missing jobs or offers escape after repeated transport failure (%s)", async status => {
    const normal = mockRequest.getMockImplementation()!;
    mockRequest.mockImplementation((path, init) => path === "/api/vst/editors/editor" && !init?.method ? Promise.reject({ status }) : normal(path, init));
    click("플러그인 창 열기"); await settle(); await tick(2500);
    if (status === 404) {
      expect(onStateChange.mock.lastCall?.[0].busy).toBe(false);
      expect(text(tree)).toContain("플러그인 창의 작업이 만료되었습니다.");
    } else {
      expect(text(editorStatus())).toContain("플러그인 창 상태 확인 필요");
      click("창 닫기 요청·연결 해제"); await settle();
      expect(onStateChange.mock.lastCall?.[0].busy).toBe(false);
    }
  });

  it("cancels a late created window after the panel unmounts", async () => {
    const posted = deferred<any>();
    const normal = mockRequest.getMockImplementation()!;
    mockRequest.mockImplementation((path, init) => path === "/api/vst/editors" ? posted.promise : normal(path, init));
    click("플러그인 창 열기");
    for (const value of hooks.values) value?.cleanup?.();
    posted.resolve({ id: "unmounted", status: "running", stage: "open" });
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(mockRequest).toHaveBeenCalledWith("/api/vst/editors/unmounted", expect.objectContaining({ method: "DELETE" }));
  });
});
afterEach(() => { for (const value of hooks.values) value?.cleanup?.(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("VST UI operation ownership", () => {
  it.each(["source", "track"])("releases the preview guard after %s changes so native opening is not silently ignored", async changed => {
    click("원본 / 처리음 비교 생성"); await settle();
    if (changed === "source") media = { ...media, id: "source-b" }; else audioTrack = 1;
    render(); await settle();
    expect(mockRequest).toHaveBeenCalledWith("/api/vst/previews/preview-a", { method: "DELETE" });
    click("플러그인 창 열기"); await settle();
    expect(countEditorPosts()).toBe(1);
    expect(text(tree)).toContain("플러그인 준비 중…");
  });
  it("cancels a late preview POST and keeps a newer native editor busy", async () => {
    const pending = deferred<any>();
    const normal = mockRequest.getMockImplementation()!;
    mockRequest.mockImplementation((path, init) => path === "/api/vst/previews" ? pending.promise : normal(path, init));
    click("원본 / 처리음 비교 생성");
    media = { ...media, id: "source-b" }; render(); await settle();
    click("플러그인 창 열기"); await settle();
    pending.resolve({ id: "late-preview", status: "running" }); await settle();
    expect(mockRequest).toHaveBeenCalledWith("/api/vst/previews/late-preview", { method: "DELETE" });
    expect(countEditorPosts()).toBe(1);
    expect(text(tree)).not.toContain("비교 음성을 준비하고 있습니다…");
    expect(onStateChange.mock.lastCall?.[0].busy).toBe(true);
  });
  it("ignores a late cancellation response belonging to the replaced comparison", async () => {
    click("원본 / 처리음 비교 생성"); await settle();
    const pending = deferred<any>();
    const normal = mockRequest.getMockImplementation()!;
    mockRequest.mockImplementation((path, init) => path === "/api/vst/previews/preview-a" && init?.method === "DELETE" ? pending.promise : path === "/api/vst/previews" ? Promise.resolve({ id: "preview-b", status: "running" } as any) : normal(path, init));
    click("비교 생성 취소");
    media = { ...media, id: "source-b" }; render(); await settle();
    click("원본 / 처리음 비교 생성"); await settle();
    pending.resolve({ id: "preview-a", status: "cancelled" }); await settle();
    expect(text(tree)).toContain("비교 음성을 준비하고 있습니다…");
    expect(text(tree)).not.toContain("비교 음성 생성을 취소했습니다.");
    expect(onStateChange.mock.lastCall?.[0].busy).toBe(true);
  });
  it("surfaces a pre-request snapshot failure beside the clicked slot and unlocks retry", async () => {
    vi.stubGlobal("structuredClone", () => { throw new Error("Synthetic snapshot failure"); });
    click("플러그인 창 열기"); await settle();
    expect(countEditorPosts()).toBe(0);
    const alerts = nodes(tree).filter(node => node.props?.role === "alert");
    expect(alerts.map(text)).toEqual(["Synthetic snapshot failure"]);
    expect(nodes(tree).find(node => node.type === "li")?.props.children.map(text).join("")).toContain("Synthetic snapshot failure");
    expect(onStateChange.mock.lastCall?.[0].busy).toBe(false);
  });
});
