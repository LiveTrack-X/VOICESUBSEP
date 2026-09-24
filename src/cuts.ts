import type { Caption, CutRange, Note, Project, Word } from "./domain";

export type KeepSpan = {
  sourceStart: number;
  sourceEnd: number;
  outputStart: number;
  outputEnd: number;
};
export type CutExportIssue = {
  captionId: string;
  reason: "missing_word_timing" | "stale_word_text" | "invalid_word_timing" | "cut_through_word";
};

/** Integer microseconds keep repeated joins from accumulating floating error. */
function tick(time: number): number {
  if (!Number.isFinite(time)) throw new Error("Time must be finite.");
  return Math.round(time * 1_000_000);
}
function seconds(time: number): number { return time / 1_000_000; }

/** Return a fresh, ordered union. Callers retain original ranges for undo/restore. */
export function normalizeCuts(cuts: readonly CutRange[], duration: number): CutRange[] {
  const limit = tick(duration);
  if (limit < 0) throw new Error("Duration cannot be negative.");
  const sorted = cuts.map((cut) => ({
    ...cut,
    start: Math.max(0, Math.min(limit, tick(cut.start))),
    end: Math.max(0, Math.min(limit, tick(cut.end))),
  })).filter((cut) => cut.end > cut.start)
    .sort((a, b) => a.start - b.start || a.end - b.end || a.id.localeCompare(b.id));
  const result: CutRange[] = [];
  for (const cut of sorted) {
    const previous = result[result.length - 1];
    if (previous && cut.start <= previous.end) previous.end = Math.max(previous.end, cut.end);
    else result.push({ ...cut });
  }
  return result.map((cut) => ({ ...cut, start: seconds(cut.start), end: seconds(cut.end) }));
}

export function buildKeepSpans(cuts: readonly CutRange[], duration: number): KeepSpan[] {
  const normalized = normalizeCuts(cuts, duration);
  const result: KeepSpan[] = [];
  let source = 0;
  let output = 0;
  const append = (end: number) => {
    const length = end - source;
    if (length <= 0) return;
    result.push({ sourceStart: seconds(source), sourceEnd: seconds(end), outputStart: seconds(output), outputEnd: seconds(output + length) });
    output += length;
  };
  for (const cut of normalized) {
    append(tick(cut.start));
    source = tick(cut.end);
  }
  append(tick(duration));
  return result;
}

/** Half-open spans; the final span's end is also accepted as an end timestamp. */
export function sourceToOutput(time: number, spans: readonly KeepSpan[]): number | null {
  const value = tick(time);
  for (const [index, span] of spans.entries()) {
    const start = tick(span.sourceStart);
    const end = tick(span.sourceEnd);
    if (value >= start && (value < end || (index === spans.length - 1 && value === end))) {
      return seconds(tick(span.outputStart) + value - start);
    }
  }
  return null;
}

/** Output joins select the source on their right, so playback skips excluded audio. */
export function outputToSource(time: number, spans: readonly KeepSpan[]): number {
  const value = tick(time);
  const first = spans[0];
  const last = spans[spans.length - 1];
  if (!first || !last) return 0;
  if (value < tick(first.outputStart)) return first.sourceStart;
  for (const span of spans) {
    if (value >= tick(span.outputStart) && value < tick(span.outputEnd)) {
      return seconds(tick(span.sourceStart) + value - tick(span.outputStart));
    }
  }
  return last.sourceEnd;
}

function mapOnSpan(time: number, span: KeepSpan): number {
  return seconds(tick(span.outputStart) + tick(time) - tick(span.sourceStart));
}
function intersects(start: number, end: number, span: KeepSpan): boolean {
  return tick(end) > tick(span.sourceStart) && tick(start) < tick(span.sourceEnd);
}
function contains(start: number, end: number, span: KeepSpan): boolean {
  return tick(start) >= tick(span.sourceStart) && tick(end) <= tick(span.sourceEnd);
}
function pointSpan(time: number, spans: readonly KeepSpan[], cuts: readonly CutRange[]): KeepSpan | undefined {
  const value = tick(time);
  if (cuts.some((cut) => value >= tick(cut.start) && value < tick(cut.end))) return undefined;
  return spans.find((span, index) => value >= tick(span.sourceStart) &&
    (value < tick(span.sourceEnd) || (index === spans.length - 1 && value === tick(span.sourceEnd))));
}
function cleanText(text: string): string { return text.replace(/\s+/gu, " ").trim(); }
function fragmentId(sourceId: string, fragment: number, used: Set<string>): string {
  if (fragment === 0) return sourceId;
  let number = fragment + 1;
  let candidate: string;
  do {
    const suffix = `.cut-${number++}`;
    candidate = `${sourceId.slice(0, 128 - suffix.length)}${suffix}`;
  } while (used.has(candidate));
  used.add(candidate);
  return candidate;
}

function wordEvidence(caption: Caption, spans: readonly KeepSpan[], cuts: readonly CutRange[]):
  { separator: string; issue?: never } | { issue: CutExportIssue["reason"]; separator?: never } {
  const words = caption.words;
  if (!words?.length) return { issue: "missing_word_timing" };
  let previousStart = -1;
  for (const word of words) {
    if (!Number.isFinite(word.start) || !Number.isFinite(word.end) || word.end < word.start ||
      tick(word.start) < tick(caption.start) || tick(word.end) > tick(caption.end) || tick(word.start) < previousStart) {
      return { issue: "invalid_word_timing" };
    }
    previousStart = tick(word.start);
  }
  const text = cleanText(caption.text);
  const separator = cleanText(words.map((word) => word.text).join("")) === text ? "" :
    cleanText(words.map((word) => word.text).join(" ")) === text ? " " : undefined;
  if (separator === undefined) return { issue: "stale_word_text" };
  for (const word of words) {
    if (tick(word.start) === tick(word.end)) continue;
    const overlapsKept = spans.some((span) => intersects(word.start, word.end, span));
    const overlapsCut = cuts.some((cut) => tick(word.end) > tick(cut.start) && tick(word.start) < tick(cut.end));
    if (overlapsKept && overlapsCut) return { issue: "cut_through_word" };
  }
  return { separator };
}

function mapWord(word: Word, span: KeepSpan): Word {
  return { ...word, start: mapOnSpan(word.start, span), end: mapOnSpan(word.end, span) };
}

/**
 * Construct a disposable output-time view. The saved project stays in source time.
 * An issue is a hard gate for subtitle export: its text is retained once for review,
 * never copied into multiple fragments or silently treated as accurate timing.
 */
export function projectForEditedExport(project: Project): {
  project: Project;
  issues: CutExportIssue[];
  omittedNoteIds: string[];
} {
  const cuts = normalizeCuts(project.cuts ?? [], project.duration);
  const spans = buildKeepSpans(cuts, project.duration);
  const derived = structuredClone(project);
  derived.schemaVersion = 1;
  delete derived.cuts;
  if (!cuts.length) return { project: derived, issues: [], omittedNoteIds: [] };
  derived.duration = spans[spans.length - 1]?.outputEnd ?? 0;
  const issues: CutExportIssue[] = [];
  const omittedNoteIds: string[] = [];
  const captionIds = new Set(project.captions.map((caption) => caption.id));
  const noteIds = new Set(project.notes.map((note) => note.id));
  derived.captions = derived.captions.flatMap((caption): Caption[] => {
    const intersections = spans.filter((span) => intersects(caption.start, caption.end, span));
    if (!intersections.length) return [];
    const complete = intersections.find((span) => contains(caption.start, caption.end, span));
    if (complete) return [{ ...caption, start: mapOnSpan(caption.start, complete), end: mapOnSpan(caption.end, complete),
      ...(caption.words ? { words: caption.words.map((word) => mapWord(word, complete)) } : {}) }];
    const evidence = wordEvidence(caption, spans, cuts);
    if (evidence.issue) {
      issues.push({ captionId: caption.id, reason: evidence.issue });
      const first = intersections[0]!;
      const last = intersections[intersections.length - 1]!;
      const { words: _words, ...rest } = caption;
      return [{ ...rest,
        start: mapOnSpan(Math.max(caption.start, first.sourceStart), first),
        end: mapOnSpan(Math.min(caption.end, last.sourceEnd), last),
        reasons: caption.reasons.includes("timing") ? [...caption.reasons] : [...caption.reasons, "timing"],
        reviewed: false,
      }];
    }
    const fragments: Caption[] = [];
    for (const span of intersections) {
      const words = caption.words!.filter((word) => tick(word.start) === tick(word.end)
        ? pointSpan(word.start, spans, cuts) === span : contains(word.start, word.end, span));
      if (!words.length) continue;
      const text = cleanText(words.map((word) => word.text).join(evidence.separator));
      if (!text) continue;
      const start = Math.max(caption.start, span.sourceStart);
      const end = Math.min(caption.end, span.sourceEnd);
      const fragment: Caption = { ...caption, id: fragmentId(caption.id, fragments.length, captionIds), text,
        start: mapOnSpan(start, span), end: mapOnSpan(end, span), words: words.map((word) => mapWord(word, span)) };
      if (text !== caption.text) delete fragment.translation;
      fragments.push(fragment);
    }
    return fragments;
  });
  derived.notes = derived.notes.flatMap((note): Note[] => {
    if (note.end === null || tick(note.start) === tick(note.end)) {
      const span = pointSpan(note.start, spans, cuts);
      if (!span) { omittedNoteIds.push(note.id); return []; }
      const start = mapOnSpan(note.start, span);
      return [{ ...note, start, end: note.end === null ? null : start }];
    }
    const intersections = spans.filter((span) => intersects(note.start, note.end!, span));
    if (!intersections.length) { omittedNoteIds.push(note.id); return []; }
    return intersections.map((span, index) => ({ ...note, id: fragmentId(note.id, index, noteIds),
      start: mapOnSpan(Math.max(note.start, span.sourceStart), span),
      end: mapOnSpan(Math.min(note.end!, span.sourceEnd), span) }));
  });
  return { project: derived, issues, omittedNoteIds };
}
