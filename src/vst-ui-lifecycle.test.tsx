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
vi.mock("./i18n", () => ({ useI18n: () => ({ locale: "ko", t: (key: string) => key }) }));
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
afterEach(() => { for (const value of hooks.values) value?.cleanup?.(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("VST UI operation ownership", () => {
  it.each(["source", "track"])("releases the preview guard after %s changes so native opening is not silently ignored", async changed => {
    click("원본 / 처리음 비교 생성"); await settle();
    if (changed === "source") media = { ...media, id: "source-b" }; else audioTrack = 1;
    render(); await settle();
    expect(mockRequest).toHaveBeenCalledWith("/api/vst/previews/preview-a", { method: "DELETE" });
    click("플러그인 창 열기"); await settle();
    expect(countEditorPosts()).toBe(1);
    expect(text(tree)).toContain("플러그인 창 요청 중…");
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
