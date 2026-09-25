import { describe, expect, it, vi } from "vitest";
import { CAPTION_COLUMNS_KEY, DEFAULT_CAPTION_COLUMNS, captionColumnBounds, clampCaptionColumn, keyboardCaptionColumn, loadCaptionColumns, parseCaptionColumns, resolveCaptionColumns, saveCaptionColumns } from "./captionColumns";
import { CaptionVirtualLayout } from "./captionVirtualList";

describe("caption table widths without project state", () => {
  it("keeps the user's two columns independent and gives remaining width to text and review", () => {
    const initial = resolveCaptionColumns(DEFAULT_CAPTION_COLUMNS, 800);
    expect(initial).toMatchObject({ time: 106, speaker: 98, review: 43, text: 485 });
    const changed = resolveCaptionColumns({ time: 190, speaker: 155 }, 800);
    expect(changed).toMatchObject({ time: 190, speaker: 155, review: 43, text: 344 });
    expect(changed.time + changed.speaker + changed.text + changed.review + changed.gap * 3 + changed.padding * 2).toBe(800);
  });
  it("temporarily fits extreme saved widths into narrow windows, without overwriting preferences", () => {
    const preferred = { time: 420, speaker: 380 }, before = JSON.stringify(preferred);
    for (const width of [160, 240, 320, 350, 440, 479, 480, 518, 800, 1600]) {
      const layout = resolveCaptionColumns(preferred, width);
      expect(layout.time).toBeGreaterThanOrEqual(layout.minimum.time);
      expect(layout.speaker).toBeGreaterThanOrEqual(layout.minimum.speaker);
      expect(layout.text).toBeGreaterThanOrEqual(layout.textMinimum);
      expect(layout.time + layout.speaker + layout.text + layout.review + layout.gap * 3 + layout.padding * 2).toBe(width);
      for (const column of ["time", "speaker"] as const) {
        const bounds = captionColumnBounds(layout, column);
        expect(bounds.max).toBeGreaterThanOrEqual(bounds.min);
        expect(layout[column]).toBeGreaterThanOrEqual(bounds.min);
        expect(layout[column]).toBeLessThanOrEqual(bounds.max);
      }
    }
    expect(JSON.stringify(preferred)).toBe(before);
    expect(resolveCaptionColumns(preferred, 1600)).toMatchObject(preferred);
  });
  it("retains the other visible column while one boundary grows to its text-space limit", () => {
    const layout = resolveCaptionColumns({ time: 420, speaker: 380 }, 420);
    const bounds = captionColumnBounds(layout, "time");
    const adjusted = resolveCaptionColumns({ time: clampCaptionColumn(9999, bounds), speaker: layout.speaker }, 420);
    expect(adjusted.time).toBe(bounds.max);
    expect(adjusted.speaker).toBe(layout.speaker);
    expect(adjusted.text).toBe(layout.textMinimum);
  });
  it("supports bounded arrows, fine adjustment, Home/End and ignores unrelated typing", () => {
    const bounds = { min: 88, max: 200 };
    expect(keyboardCaptionColumn("ArrowRight", 106, bounds)).toBe(114);
    expect(keyboardCaptionColumn("ArrowLeft", 106, bounds, true)).toBe(105);
    expect(keyboardCaptionColumn("ArrowLeft", 88, bounds)).toBe(88);
    expect(keyboardCaptionColumn("ArrowRight", 199, bounds)).toBe(200);
    expect(keyboardCaptionColumn("Home", 106, bounds)).toBe(88);
    expect(keyboardCaptionColumn("End", 106, bounds)).toBe(200);
    for (const key of ["a", "Space", "ArrowUp", "Tab"]) expect(keyboardCaptionColumn(key, 106, bounds)).toBeNull();
    expect(clampCaptionColumn(NaN, bounds)).toBe(88);
  });
  it("round trips personal widths and per-column defaults under a versioned independent key", () => {
    let raw: string | null = null;
    const storage = { getItem: vi.fn(() => raw), setItem: vi.fn((_key: string, value: string) => { raw = value; }) };
    expect(loadCaptionColumns(storage)).toEqual(DEFAULT_CAPTION_COLUMNS);
    expect(saveCaptionColumns({ time: 180, speaker: 135 }, storage)).toBe(true);
    expect(storage.setItem).toHaveBeenCalledWith(CAPTION_COLUMNS_KEY, JSON.stringify({ version: 1, time: 180, speaker: 135 }));
    expect(loadCaptionColumns(storage)).toEqual({ time: 180, speaker: 135 });
    expect(saveCaptionColumns({ time: null, speaker: 135 }, storage)).toBe(true);
    expect(loadCaptionColumns(storage)).toEqual({ time: null, speaker: 135 });
    expect(resolveCaptionColumns(loadCaptionColumns(storage), 800)).toMatchObject({ time: 106, speaker: 135 });
  });
  it("ignores corrupt/versioned/oversized storage and reports blocked writes without erasing it", () => {
    for (const raw of ["{", "[]", "null", "{}", JSON.stringify({ version: 2, time: 100, speaker: 100 }), JSON.stringify({ version: 1, time: -5, speaker: 100 }), JSON.stringify({ version: 1, time: 100.1, speaker: 100 }), JSON.stringify({ version: 1, time: 9000, speaker: 100 }), JSON.stringify({ version: 1, time: "100", speaker: 100 }), " ".repeat(1025)]) {
      expect(parseCaptionColumns(raw)).toEqual(DEFAULT_CAPTION_COLUMNS);
    }
    const storage = { getItem: () => { throw new Error("blocked"); }, setItem: vi.fn(() => { throw new Error("quota"); }) };
    expect(loadCaptionColumns(storage)).toEqual(DEFAULT_CAPTION_COLUMNS);
    expect(saveCaptionColumns({ time: 180, speaker: 135 }, storage)).toBe(false);
    expect(saveCaptionColumns({ time: NaN, speaker: 135 }, storage)).toBe(false);
    expect(storage.setItem).toHaveBeenCalledTimes(1);
  });
  it("invalidates offscreen wrapping estimates while preserving the current virtual anchor", () => {
    const ids = Array.from({ length: 2404 }, (_, i) => `cue-${i}`);
    const measured = new Map([["cue-2", { height: 200, context: "old-columns" }]]);
    const before = new CaptionVirtualLayout(ids, measured, "old-columns", 60);
    const anchor = before.anchor(1400);
    const after = new CaptionVirtualLayout(ids, measured, "new-columns", 60);
    expect(after.height(2)).toBe(60);
    const top = after.anchoredTop(anchor, 1400, 300);
    expect(after.anchor(top)).toEqual(anchor);
    expect(after.range(top, 300).end - after.range(top, 300).start).toBeLessThan(22);
  });
});
