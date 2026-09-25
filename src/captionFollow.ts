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

/** Center the active row even when it is already visible; edges remain bounded. */
export function captionFollowTop(layout: CaptionVirtualLayout, id: string, top: number, height: number): number | null {
  const index = layout.indexById.get(id);
  if (index === undefined || !Number.isFinite(top) || !Number.isFinite(height) || height <= 0) return null;
  const target = layout.centeredTop(index, height);
  return Math.abs(target - top) <= 1 ? null : target;
}

type FollowFrame = { id: string | null; time: number; playing: boolean; rowTop: number; rowHeight: number; total: number; viewportHeight: number };

/** Ordinary playback ticks within one caption must not fight manual reading. */
export class CaptionFollowPosition {
  private previous: FollowFrame | null = null;
  private invalid = true;
  invalidate() { this.invalid = true; }
  changed(frame: FollowFrame): boolean {
    const before = this.previous;
    this.previous = frame;
    const changed = this.invalid || !before || before.id !== frame.id ||
      (!frame.playing && before.time !== frame.time) || (frame.playing && !before.playing) ||
      Math.abs(frame.time - before.time) > 1 ||
      before.rowTop !== frame.rowTop || before.rowHeight !== frame.rowHeight ||
      before.total !== frame.total || before.viewportHeight !== frame.viewportHeight;
    this.invalid = false;
    return changed && frame.id !== null;
  }
}

export class CaptionFollowGate {
  private pausedUntil = 0;
  private pointerHeld = false;
  private composing = false;
  constructor(private readonly onPause?: () => void) {}
  pause(now: number) { this.pausedUntil = now + CAPTION_FOLLOW_PAUSE_MS; this.onPause?.(); }
  pointerDown(now: number) { this.pointerHeld = true; this.pause(now); }
  pointerUp(now: number) { if (!this.pointerHeld) return false; this.pointerHeld = false; this.pause(now); return true; }
  composition(started: boolean, now: number) { this.composing = started; this.pause(now); }
  canFollow(enabled: boolean, available: boolean, editing: boolean, now: number): boolean {
    return enabled && available && !editing && !this.pointerHeld && !this.composing && now >= this.pausedUntil;
  }
}

export function followEditingTarget(target: unknown): boolean {
  const element = target as { closest?: (selector: string) => unknown } | null;
  if (element?.closest?.('[role="dialog"], [aria-modal="true"], [role="menu"]')) return true;
  if (element?.closest?.('[data-caption-follow-seek]')) return false;
  return !!element?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"], [role="slider"]');
}
