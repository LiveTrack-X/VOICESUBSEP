import { MAX_CAPTIONS, MAX_TIME_SECONDS, type Caption, type Project } from "./domain";

export const MAX_CAPTION_TEXT = 10_000;
export const CAPTION_PAGE_SIZE = 100;
export const CAPTION_LIMIT_ERROR = "자막은 최대 20,000개까지 추가할 수 있습니다.";
export const CAPTION_TEXT_ERROR = "자막 한 개는 10,000자 이하여야 합니다. 나누어서 편집하세요.";

function validText(text: string): void {
  if (text.length > MAX_CAPTION_TEXT) throw new Error(CAPTION_TEXT_ERROR);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text))
    throw new Error("지원하지 않는 제어 문자가 있습니다.");
}

/** Content review certifies the actual text, identity and interval, not merely
 * the cue ID. Styling and explicit review actions do not invalidate it. */
export function editCaption(caption: Caption, change: Partial<Caption>): Caption {
  if (Object.entries(change).every(([key, value]) => Object.is(caption[key as keyof Caption], value))) return caption;
  const next = { ...caption, ...change };
  const textChanged = next.text !== caption.text;
  const timeChanged = next.start !== caption.start || next.end !== caption.end;
  const speakerChanged = next.speakerId !== caption.speakerId;
  if (textChanged) validText(next.text);
  if (!textChanged && !timeChanged && !speakerChanged) return next;
  const reasons = new Set(next.reasons);
  if (textChanged || speakerChanged) reasons.add("edited");
  if (timeChanged) reasons.add("timing");
  if (speakerChanged) {
    if (next.speakerId === null) reasons.add("unassigned");
    else reasons.delete("unassigned");
  }
  return { ...next, ...(textChanged || timeChanged ? { words: undefined } : {}), reasons: [...reasons], reviewed: false };
}

export function addCaption(project: Project, time: number, text: string, id: string = crypto.randomUUID()): Project {
  if (project.captions.length >= MAX_CAPTIONS) throw new Error(CAPTION_LIMIT_ERROR);
  validText(text);
  const limit = project.mediaName && project.duration > 0 ? project.duration : MAX_TIME_SECONDS;
  if (!Number.isFinite(time) || time < 0 || time >= limit)
    throw new Error("자막을 추가하려면 미디어 끝보다 앞의 위치를 선택하세요.");
  return { ...project, captions: [...project.captions, {
    id, start: time, end: Math.min(time + 2, limit), text,
    speakerId: null, reasons: ["unassigned"], reviewed: false,
  }] };
}

export function splitCaption(project: Project, id: string, time: number, newId: string = crypto.randomUUID()): Project {
  const caption = project.captions.find((item) => item.id === id);
  if (!caption) return project;
  if (project.captions.length >= MAX_CAPTIONS) throw new Error(CAPTION_LIMIT_ERROR);
  const splitAt = time > caption.start && time < caption.end ? time : (caption.start + caption.end) / 2;
  const words = caption.text.trim().split(/\s+/u);
  if (words.length < 2) throw new Error("두 단어 이상인 자막을 선택하세요.");
  const index = Math.max(1, Math.min(words.length - 1,
    Math.round(words.length * (splitAt - caption.start) / (caption.end - caption.start))));
  return { ...project, captions: project.captions.flatMap((item) => item.id === id ? [
    editCaption(item, { end: splitAt, text: words.slice(0, index).join(" ") }),
    editCaption(item, { id: newId, start: splitAt, text: words.slice(index).join(" ") }),
  ] : [item]) };
}

export function mergeCaptions(project: Project, firstId: string, secondId: string): Project {
  const first = project.captions.find((item) => item.id === firstId);
  const second = project.captions.find((item) => item.id === secondId);
  if (!first || !second || first === second || first.speakerId !== second.speakerId) return project;
  const text = `${first.text} ${second.text}`;
  validText(text);
  return { ...project, captions: project.captions.filter((item) => item.id !== secondId).map((item) =>
    item.id === firstId ? editCaption(item, { start: Math.min(first.start, second.start), end: Math.max(first.end, second.end),
      text, reasons: [...new Set([...first.reasons, ...second.reasons])],
      reviewed: first.reviewed && second.reviewed }) : item) };
}

export type BulkCaptionAction = { kind: "speaker"; speakerId: string | null } |
  { kind: "review"; reviewed: boolean } | { kind: "delete" };

export function bulkEditCaptions(project: Project, ids: ReadonlySet<string>, action: BulkCaptionAction): Project {
  if (action.kind === "speaker" && action.speakerId !== null &&
    !project.speakers.some((speaker) => speaker.id === action.speakerId))
    throw new Error("존재하지 않는 인물입니다.");
  let changed = false;
  const captions = project.captions.flatMap((caption): Caption[] => {
    if (!ids.has(caption.id)) return [caption];
    if (action.kind === "delete") { changed = true; return []; }
    if (action.kind === "review") {
      if (caption.reviewed === action.reviewed) return [caption];
      changed = true; return [{ ...caption, reviewed: action.reviewed }];
    }
    const reasons = action.speakerId === null
      ? [...new Set([...caption.reasons, "unassigned" as const])]
      : caption.reasons.filter((reason) => reason !== "unassigned");
    if (caption.speakerId === action.speakerId && reasons.join() === caption.reasons.join()) return [caption];
    changed = true;
    return [editCaption(caption, { speakerId: action.speakerId, reasons })];
  });
  return changed ? { ...project, captions } : project;
}

/** Literal, case-sensitive replacement. Validate every result before returning any edits. */
export function replaceCaptionText(project: Project, ids: ReadonlySet<string>, find: string, replacement: string): Project {
  if (!find) throw new Error("찾을 내용을 입력하세요.");
  let changed = false;
  const captions = project.captions.map((caption) => {
    if (!ids.has(caption.id) || !caption.text.includes(find)) return caption;
    const text = caption.text.split(find).join(replacement);
    validText(text);
    if (text === caption.text) return caption;
    changed = true;
    // Existing translations retain their sourceText and are consequently marked stale.
    return editCaption(caption, { text });
  });
  return changed ? { ...project, captions } : project;
}

export function replacementCount(captions: readonly Caption[], ids: ReadonlySet<string>, find: string): number {
  if (!find) return 0;
  return captions.filter((caption) => ids.has(caption.id) && caption.text.includes(find)).length;
}

/** Wrap once in the current filtered list; never jump into hidden captions. */
export function nextCaptionToReview(captions: readonly Caption[], selectedId: string | null, kind: "review" | "unassigned"): Caption | undefined {
  const start = captions.findIndex((caption) => caption.id === selectedId);
  for (let offset = 1; offset <= captions.length; offset += 1) {
    const caption = captions[(start + offset) % captions.length]!;
    if (kind === "unassigned" ? caption.speakerId === null : !caption.reviewed && caption.reasons.length > 0) return caption;
  }
  return undefined;
}

export function captionPage(index: number): number { return Math.floor(Math.max(0, index) / CAPTION_PAGE_SIZE); }
