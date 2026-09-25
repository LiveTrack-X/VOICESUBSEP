import type { CaptionVirtualLayout } from "./captionVirtualList";

export const CAPTION_FOLLOW_KEY = "voicesubsep-caption-follow-v1";
export const CAPTION_FOLLOW_PAUSE_MS = 4000;
type StorageAccess = Pick<Storage, "getItem" | "setItem">;

export function loadCaptionFollow(storage?: StorageAccess): boolean {
  try { return (storage ?? localStorage).getItem(CAPTION_FOLLOW_KEY) !== "false"; }
  catch { return true; }
}
export function saveCaptionFollow(enabled: boolean, storage?: StorageAccess): boolean {
  try { (storage ?? localStorage).setItem(CAPTION_FOLLOW_KEY, String(enabled)); return true; }
  catch { return false; }
}

/** No project state belongs here: following only chooses a currently visible ID. */
export function playingCaptionId(captions: readonly { id: string; start: number; end: number }[], time: number, previous: string | null): string | null {
  if (!Number.isFinite(time) || time < 0) return null;
  const active = (caption: { start: number; end: number }) => caption.start <= time && time < caption.end;
  const retained = previous && captions.find(caption => caption.id === previous && active(caption));
  return retained ? retained.id : captions.find(active)?.id ?? null;
}

/** Scroll only if the active row has left the view; tall rows need not fit fully. */
export function captionFollowTop(layout: CaptionVirtualLayout, id: string, top: number, height: number): number | null {
  const index = layout.indexById.get(id);
  if (index === undefined || !Number.isFinite(top) || !Number.isFinite(height) || height <= 0) return null;
  const rowTop = layout.offsets[index]!;
  const rowBottom = layout.offsets[index + 1]!;
  const visibleHeight = Math.min(rowBottom, top + height) - Math.max(rowTop, top);
  if ((rowTop >= top - 1 && rowBottom <= top + height + 1) ||
      (rowBottom - rowTop > height && visibleHeight >= Math.min(80, height * 0.6))) return null;
  return layout.centeredTop(index, height);
}

export class CaptionFollowGate {
  private pausedUntil = 0;
  private pointerHeld = false;
  private composing = false;
  pause(now: number) { this.pausedUntil = now + CAPTION_FOLLOW_PAUSE_MS; }
  pointerDown(now: number) { this.pointerHeld = true; this.pause(now); }
  pointerUp(now: number) { if (this.pointerHeld) { this.pointerHeld = false; this.pause(now); } }
  composition(started: boolean, now: number) { this.composing = started; this.pause(now); }
  canFollow(enabled: boolean, playing: boolean, editing: boolean, now: number): boolean {
    return enabled && playing && !editing && !this.pointerHeld && !this.composing && now >= this.pausedUntil;
  }
}

export function followEditingTarget(target: unknown): boolean {
  return !!(target as { closest?: (selector: string) => unknown } | null)?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"], [role="slider"], [role="dialog"], [aria-modal="true"]');
}
