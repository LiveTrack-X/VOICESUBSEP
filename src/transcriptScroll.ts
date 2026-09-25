import type {TranscriptTurn} from "./transcriptDocument";

export const MAX_TRANSCRIPT_ROWS = 120;
export function estimateTranscriptHeight(turn: TranscriptTurn, width: number, timestamps: boolean): number {
  const columns = Math.max(8, Math.floor((Math.max(100, width) - 42) / 10));
  const text = `${timestamps ? "[00:00:00.000 – 00:00:00.000] " : ""}${turn.speaker}: ${turn.text}`;
  return Math.max(1, text.split(/\r\n|\r|\n/).reduce((lines, line) => lines + Math.max(1, Math.ceil(line.length / columns)), 0)) * 24 + 17;
}
export function transcriptOffsets(turns: readonly TranscriptTurn[], measured: ReadonlyMap<string, number>, width: number, timestamps: boolean): number[] {
  const offsets = [0];
  for (const turn of turns) {
    const height = measured.get(turn.ids[0]);
    offsets.push(offsets[offsets.length - 1] + (height && Number.isFinite(height) && height > 0 ? height : estimateTranscriptHeight(turn, width, timestamps)));
  }
  return offsets;
}
export function transcriptIndexAt(offsets: readonly number[], top: number): number {
  let low = 0, high = Math.max(0, offsets.length - 1);
  while (low < high) { const middle = Math.floor((low + high + 1) / 2); if (offsets[middle] <= top) low = middle; else high = middle - 1; }
  return Math.min(low, Math.max(0, offsets.length - 2));
}
export function transcriptAnchoredTop(before: readonly number[], after: readonly number[], top: number): number {
  if (after.length < 2) return 0;
  const anchor = transcriptIndexAt(before, top), index = Math.min(anchor, after.length - 2);
  const inside = Math.max(0, top - (before[anchor] ?? 0));
  return after[index] + Math.min(inside, Math.max(0, after[index + 1] - after[index] - 1));
}
export function transcriptWindow(offsets: readonly number[], scrollTop: number, height: number) {
  const count = offsets.length - 1;
  if (!count) return {start: 0, end: 0, before: 0, after: 0};
  const top = Number.isFinite(scrollTop) ? Math.max(0, scrollTop) : 0;
  const viewport = Number.isFinite(height) ? Math.max(1, height) : 400;
  const start = Math.max(0, transcriptIndexAt(offsets, top - 400));
  const end = Math.min(count, start + MAX_TRANSCRIPT_ROWS, transcriptIndexAt(offsets, top + viewport + 400) + 2);
  return {start, end, before: offsets[start], after: offsets[count] - offsets[end]};
}
