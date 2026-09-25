import { describe, expect, it } from "vitest";
import type { TranscriptTurn } from "./transcriptDocument";
import { MAX_TRANSCRIPT_ROWS, estimateTranscriptHeight, transcriptAnchoredTop, transcriptIndexAt, transcriptOffsets, transcriptWindow } from "./transcriptScroll";

const turns = (count: number): TranscriptTurn[] => Array.from({length: count}, (_, index) => ({ids: [`cue-${index}`], speakerId: "a", speaker: "화자", color: "#123456", start: index, end: index + .9, text: `발언 ${index}`, overlap: false}));

describe("continuous transcript reading", () => {
  it("crosses the old 100-turn page boundary and reaches the last turn with bounded DOM rows", () => {
    const source = turns(20000), offsets = transcriptOffsets(source, new Map(), 640, false);
    for (const index of [0, 99, 100, 101, 5000, 19999]) {
      const visible = transcriptWindow(offsets, offsets[index], 500);
      expect(visible.start).toBeLessThanOrEqual(index); expect(visible.end).toBeGreaterThan(index);
      expect(visible.end - visible.start).toBeLessThanOrEqual(MAX_TRANSCRIPT_ROWS);
      expect(visible.before + offsets[visible.end] - offsets[visible.start] + visible.after).toBe(offsets.at(-1));
    }
  });
  it("uses actual variable heights and preserves the current paragraph when earlier rows resize", () => {
    const source = turns(200), initial = transcriptOffsets(source, new Map(), 640, false);
    const top = initial[101] + 12;
    const measured = new Map(source.slice(95, 110).map((turn, index) => [turn.ids[0], index % 2 ? 190 : 41]));
    const next = transcriptOffsets(source, measured, 640, false), anchored = transcriptAnchoredTop(initial, next, top);
    expect(transcriptIndexAt(next, anchored)).toBe(101); expect(anchored - next[101]).toBe(12);
    expect(transcriptWindow(next, anchored, 500).end).toBeGreaterThan(101);
  });
  it("retains a very long multiline paragraph while scrolling inside it without blank gaps", () => {
    const source = turns(3); source[1].text = "긴 줄\n".repeat(500);
    const offsets = transcriptOffsets(source, new Map(), 160, true);
    expect(offsets[2] - offsets[1]).toBeGreaterThan(12000);
    const range = transcriptWindow(offsets, offsets[1] + 7000, 300);
    expect(range.start).toBe(1); expect(range.end).toBeGreaterThan(1);
    expect(estimateTranscriptHeight(source[1], 160, true)).toBeGreaterThanOrEqual(estimateTranscriptHeight(source[1], 640, false));
  });
  it("handles empty documents, removal of trailing rows, and viewport extremes", () => {
    expect(transcriptWindow([0], 200, 400)).toEqual({start: 0, end: 0, before: 0, after: 0});
    expect(transcriptAnchoredTop([0, 40], [0], 30)).toBe(0);
    expect(transcriptAnchoredTop([0, 40, 80], [0, 20], 60)).toBe(19);
    expect(transcriptWindow([0, 40, 80], NaN, NaN).start).toBe(0);
    expect(transcriptWindow([0, 40, 80], 100000, 500).end).toBe(2);
  });
});
