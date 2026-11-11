import type { Caption, Project } from "./domain";
import { CAPTION_LIMIT_ERROR, editCaption, MAX_CAPTION_TEXT } from "./editorOperations";
import { MAX_CAPTIONS } from "./domain";

export type CaptionEditAction = "splitCursor" | "splitTime" | "mergePrevious" | "mergeNext" | "mergeSelected";
export type CaptionEditRequest = { action: CaptionEditAction; id?: string };
export type SplitPosition = { kind: "cursor"; offset: number; time?: number } | { kind: "time"; time: number };
export type SplitPlan = { source: Caption; offset: number; time: number; left: string; right: string; timing: "words" | "estimated" | "playhead" };
export type MergePlan = { sources: Caption[]; result: Caption; gap: number; overlap: boolean };

export function orderedCaptions(captions: readonly Caption[]): Caption[] {
  return [...captions].sort((a, b) => a.start - b.start || a.end - b.end || a.id.localeCompare(b.id));
}

export function textBoundaries(text: string): number[] {
  const first = text.search(/\S/u), last = text.search(/\s*$/u);
  return [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)]
    .map(part => part.index).filter(offset => offset > first && offset < last);
}

/** Only use word times when they still describe the entire, unedited text. */
function alignedWordBoundaries(caption: Caption): { offset: number; time: number }[] {
  const words = caption.words;
  if (!words || words.length < 2) return [];
  const compact = (text: string) => text.replace(/\s/gu, "");
  if (compact(caption.text) !== words.map(word => compact(word.text)).join("")) return [];
  if (words.some((word, index) => !compact(word.text) || !Number.isFinite(word.start) || !Number.isFinite(word.end)
    || word.start < caption.start || word.end > caption.end || word.start >= word.end
    || (index > 0 && words[index - 1]!.end > word.start))) return [];
  const positions: number[] = [];
  for (let index = 0; index < caption.text.length; index++) if (!/\s/u.test(caption.text[index]!)) positions.push(index + 1);
  let length = 0;
  return words.slice(0, -1).map((word, index) => {
    length += compact(word.text).length;
    return { offset: positions[length - 1]!, time: (word.end + words[index + 1]!.start) / 2 };
  });
}

export function planCaptionSplit(caption: Caption, position: SplitPosition): SplitPlan {
  const boundaries = textBoundaries(caption.text);
  if (!boundaries.length) throw new Error("나눌 수 있는 글자가 부족합니다.");
  const aligned = alignedWordBoundaries(caption);
  let offset: number, time: number, timing: SplitPlan["timing"];
  if (position.kind === "cursor") {
    offset = position.offset;
    if (!boundaries.includes(offset)) throw new Error("글자 사이에 커서를 놓으세요. 양쪽에 자막 내용이 있어야 합니다.");
    const compactLeft = caption.text.slice(0, offset).replace(/\s/gu, "");
    const match = aligned.find(item => caption.text.slice(0, item.offset).replace(/\s/gu, "") === compactLeft);
    const all = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(caption.text)];
    time = match?.time ?? caption.start + (caption.end - caption.start) * all.filter(part => part.index < offset).length / all.length;
    timing = match ? "words" : "estimated";
    if (position.time !== undefined) { time = position.time; timing = "playhead"; }
  } else {
    time = position.time;
    if (!Number.isFinite(time) || time <= caption.start || time >= caption.end)
      throw new Error("분할 시간은 선택한 자막의 시작과 종료 사이여야 합니다.");
    const candidates = aligned.filter(item => boundaries.includes(item.offset));
    // Prefer word boundaries even without timestamps, falling back to graphemes for unspaced text.
    const spaces = boundaries.filter(index => /\s/u.test(caption.text[index]!));
    const choices = candidates.length ? candidates : (spaces.length ? spaces : boundaries).map(index => ({
      offset: index, time: caption.start + (caption.end - caption.start) * index / caption.text.length,
    }));
    offset = choices.reduce((best, item) => Math.abs(item.time - time) < Math.abs(best.time - time) ? item : best).offset;
    timing = "playhead";
  }
  time = Math.round(time * 1000) / 1000;
  if (!Number.isFinite(time) || time <= caption.start || time >= caption.end) throw new Error("분할 후 양쪽 자막에 시간이 있어야 합니다.");
  return { source: caption, offset, time, left: caption.text.slice(0, offset), right: caption.text.slice(offset), timing };
}

export function applyCaptionSplit(project: Project, plan: SplitPlan, newId: string = crypto.randomUUID()): Project {
  if (project.captions.find(caption => caption.id === plan.source.id) !== plan.source)
    throw new Error("자막이 변경되었습니다. 편집 창을 다시 열어주세요.");
  if (project.captions.length >= MAX_CAPTIONS) throw new Error(CAPTION_LIMIT_ERROR);
  return { ...project, captions: project.captions.flatMap(caption => caption !== plan.source ? [caption] : [
    editCaption(caption, { text: plan.left, end: plan.time }),
    editCaption(caption, { id: newId, text: plan.right, start: plan.time }),
  ]) };
}

export function consecutiveCaptions(project: Project, ids: readonly string[]): Caption[] {
  const wanted = new Set(ids), ordered = orderedCaptions(project.captions);
  const sources = ordered.filter(caption => wanted.has(caption.id));
  if (sources.length < 2 || sources.length !== wanted.size) throw new Error("합칠 자막을 두 개 이상 선택하세요.");
  const start = ordered.indexOf(sources[0]!);
  if (sources.some((caption, index) => ordered[start + index] !== caption))
    throw new Error("시간순으로 연속된 자막을 선택하세요. 숨겨진 자막은 자동으로 합치지 않습니다.");
  return sources;
}

export function planCaptionMerge(project: Project, ids: readonly string[], speakerId: string | null, separator: "auto" | "space" | "newline" | "none" = "auto"): MergePlan {
  const sources = consecutiveCaptions(project, ids);
  if (speakerId !== null && !project.speakers.some(speaker => speaker.id === speakerId)) throw new Error("존재하지 않는 인물입니다.");
  const text = sources.map(caption => caption.text).reduce((combined, text) => combined + (
    separator === "newline" ? "\n" : separator === "none" ? "" : separator === "space" ? " " : /\s$/u.test(combined) || /^\s/u.test(text) ? "" : " "
  ) + text);
  if (text.length > MAX_CAPTION_TEXT) throw new Error("자막 한 개는 10,000자 이하여야 합니다. 나누어서 편집하세요.");
  let gap = 0, overlap = false, end = sources[0]!.end;
  for (const caption of sources.slice(1)) {
    gap = Math.max(gap, caption.start - end);
    overlap ||= caption.start < end;
    end = Math.max(end, caption.end);
  }
  const reasons = new Set(sources.flatMap(caption => caption.reasons));
  if (speakerId === null) reasons.add("unassigned"); else reasons.delete("unassigned");
  const result = editCaption(sources[0]!, { text, end, speakerId, reasons: [...reasons] });
  return { sources, result: { ...result, reviewed: false, words: undefined, speakerEvidence: undefined }, gap, overlap };
}

export function applyCaptionMerge(project: Project, plan: MergePlan): Project {
  const sources = consecutiveCaptions(project, plan.sources.map(caption => caption.id));
  if (sources.some((caption, index) => caption !== plan.sources[index])) throw new Error("자막이 변경되었습니다. 편집 창을 다시 열어주세요.");
  if (plan.result.speakerId !== null && !project.speakers.some(speaker => speaker.id === plan.result.speakerId))
    throw new Error("자막이 변경되었습니다. 편집 창을 다시 열어주세요.");
  const removed = new Set(sources.slice(1).map(caption => caption.id));
  return { ...project, captions: project.captions.filter(caption => !removed.has(caption.id))
    .map(caption => caption.id === plan.result.id ? plan.result : caption) };
}
