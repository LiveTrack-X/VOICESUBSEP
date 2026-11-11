import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createProject } from "./domain";
import { I18nProvider } from "./i18n";
import { heardWholePreview, SpeechToolRunner, SpeechToolsDialog } from "./components/SpeechToolsDialog";
import { speechToolsMessages } from "./i18n-speech-tools";

describe("speech tools dialog", () => {
  it("requires an original and explicit selected-track listening before any acoustic application", () => {
    const applyVoice = vi.fn(), applyOverlap = vi.fn(), update = vi.fn();
    const html = renderToStaticMarkup(<I18nProvider><SpeechToolsDialog project={createProject(2)} session={1} file={null}
      selectedCaptionId={null} onClose={vi.fn()} onUpdate={update} onApplyVoice={applyVoice} onApplyOverlap={applyOverlap}/></I18nProvider>);
    expect(html).toContain("확인한 목소리");
    expect(html).toContain("겹침 복원 실험");
    expect(html).toContain("선택한 트랙 듣기");
    expect(html).toContain("다른 인물의 기준 음성을 2명 이상 등록하세요.");
    expect(html).toContain("확률이 아닙니다");
    expect(html).toMatch(/disabled=""[^>]*>[^<]*기준 음성 등록/);
    expect(applyVoice).not.toHaveBeenCalled();
    expect(applyOverlap).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("provides four translations for every new message and preserves placeholders", () => {
    for (const [key, translations] of Object.entries(speechToolsMessages)) {
      expect(translations).toHaveLength(4);
      for (const value of translations) {
        expect(value.trim()).not.toBe("");
        expect(value.match(/\{\w+\}/g)?.sort() ?? []).toEqual(key.match(/\{\w+\}/g)?.sort() ?? []);
      }
    }
  });
});

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("owned speech tool operations", () => {
  const id = "a".repeat(32);
  const response = (value: unknown) => new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
  it("cancels and discards the exact late POST result after replacement or close", async () => {
    let resolve!: (value: Response) => void;
    const pending = new Promise<Response>(done => { resolve = done; });
    const fetcher = vi.fn((url: string) => url === "/api/speech-tools/jobs" ? pending : Promise.resolve(response({})));
    vi.stubGlobal("fetch", fetcher);
    const runner = new SpeechToolRunner(), onJob = vi.fn(), completed = vi.fn(), failed = vi.fn();
    const start = runner.start("prepare-voice", {}, onJob, completed, failed);
    runner.cancel();
    resolve(response({ id }));
    await start;
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledWith(`/api/speech-tools/jobs/${id}`, expect.objectContaining({ method: "DELETE" })));
    expect(fetcher).toHaveBeenCalledWith(`/api/speech-tools/jobs/${id}/cancel`, expect.objectContaining({ method: "POST" }));
    expect(onJob).not.toHaveBeenCalled(); expect(completed).not.toHaveBeenCalled(); expect(failed).not.toHaveBeenCalled();
  });

  it("ignores a completed poll that returns after its source was invalidated", async () => {
    let resolve!: (value: Response) => void;
    const pending = new Promise<Response>(done => { resolve = done; });
    const fetcher = vi.fn((url: string, options?: RequestInit) => {
      if (url === "/api/speech-tools/jobs") return Promise.resolve(response({ id }));
      if (url === `/api/speech-tools/jobs/${id}` && !options?.method) return pending;
      return Promise.resolve(response({}));
    });
    vi.stubGlobal("fetch", fetcher);
    const runner = new SpeechToolRunner(), onJob = vi.fn(), completed = vi.fn();
    const start = runner.start("voice-preview", {}, onJob, completed, vi.fn());
    await vi.waitFor(() => expect(onJob).toHaveBeenCalledTimes(1));
    runner.cancel();
    resolve(response({ id, kind: "voice-preview", status: "completed", stage: "done", progress: 1, result: { originalUrl: "obsolete" } }));
    await start;
    expect(onJob).toHaveBeenCalledTimes(1); expect(completed).not.toHaveBeenCalled();
  });

  it("keeps a model preparation alive through normal progress polling", async () => {
    vi.useFakeTimers();
    let polls = 0;
    vi.stubGlobal("fetch", vi.fn((url: string, options?: RequestInit) => {
      if (url === "/api/speech-tools/jobs") return Promise.resolve(response({ id }));
      if (!options?.method) return Promise.resolve(response({ id, kind: "prepare-overlap", status: ++polls === 1 ? "running" : "completed", stage: "preparing", progress: polls === 1 ? .4 : 1, result: {} }));
      return Promise.resolve(response({}));
    }));
    const runner = new SpeechToolRunner(), onJob = vi.fn(), completed = vi.fn();
    await runner.start("prepare-overlap", {}, onJob, completed, vi.fn());
    expect(completed).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(600);
    expect(completed).toHaveBeenCalledTimes(1);
    expect(onJob).toHaveBeenCalledTimes(3);
    runner.cancel();
  });

  it("requires played coverage across the preview, including after seeking", () => {
    const ranges = (items: [number, number][]) => ({ length: items.length, start: (index: number) => items[index]![0], end: (index: number) => items[index]![1] });
    expect(heardWholePreview({ duration: 3, played: ranges([[0, 3]]) })).toBe(true);
    expect(heardWholePreview({ duration: 3, played: ranges([[2.8, 3]]) })).toBe(false);
    expect(heardWholePreview({ duration: 3, played: ranges([[0, 1], [2, 3]]) })).toBe(false);
    expect(heardWholePreview({ duration: 3, played: ranges([[0, 1.8], [1.8, 3]]) })).toBe(true);
  });
});
