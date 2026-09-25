import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { CAPTION_FOLLOW_PAUSE_MS, CaptionFollowGate, CaptionFollowPosition, captionFollowTop, followEditingTarget, playingCaptionId } from "./captionFollow";
import type { CaptionVirtualLayout } from "./captionVirtualList";

export function useCaptionFollow({ enabled, playing, suspended, time, captions, layout, listRef, reveal, revealIndex }: {
  enabled: boolean; playing: boolean; suspended: boolean; time: number;
  captions: readonly { id: string; start: number; end: number }[];
  layout: CaptionVirtualLayout;
  listRef: RefObject<HTMLDivElement | null>;
  reveal: { id: string } | null;
  revealIndex: (index: number) => void;
}) {
  const scheduleResume = useRef<() => void>(() => {});
  // Every reading pause, including an external reveal while paused, must wake
  // once it expires. Paused media cannot supply another playback time update.
  const gate = useRef(new CaptionFollowGate(() => scheduleResume.current()));
  const position = useRef(new CaptionFollowPosition());
  const [revision, setRevision] = useState(0);
  const followed = useRef<string | null>(null);
  const priorReveal = useRef(reveal);
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    let pauseTimer = 0, focusFrame = 0;
    const wake = () => setRevision(value => value + 1);
    const resumeLater = () => {
      position.current.invalidate();
      window.clearTimeout(pauseTimer);
      pauseTimer = window.setTimeout(wake, CAPTION_FOLLOW_PAUSE_MS);
    };
    scheduleResume.current = resumeLater;
    const pause = () => gate.current.pause(Date.now());
    const down = () => gate.current.pointerDown(Date.now());
    const up = () => gate.current.pointerUp(Date.now());
    const startComposition = () => gate.current.composition(true, Date.now());
    const endComposition = () => gate.current.composition(false, Date.now());
    const blur = () => { up(); endComposition(); };
    const focusChanged = () => { cancelAnimationFrame(focusFrame); focusFrame = requestAnimationFrame(wake); };
    const keys = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229) pause();
      else if (list.contains(event.target as Node) && ["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", "Space"].includes(event.code)) pause();
    };
    list.addEventListener("wheel", pause, { passive: true });
    list.addEventListener("touchmove", pause, { passive: true });
    list.addEventListener("pointerdown", down, { passive: true });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    window.addEventListener("blur", blur);
    document.addEventListener("compositionstart", startComposition);
    document.addEventListener("compositionend", endComposition);
    document.addEventListener("keydown", keys, true);
    document.addEventListener("focusin", focusChanged);
    document.addEventListener("focusout", focusChanged);
    const resize = typeof ResizeObserver !== "undefined" ? new ResizeObserver(wake) : null;
    resize?.observe(list);
    return () => {
      scheduleResume.current = () => {};
      clearTimeout(pauseTimer); cancelAnimationFrame(focusFrame); resize?.disconnect();
      list.removeEventListener("wheel", pause); list.removeEventListener("touchmove", pause); list.removeEventListener("pointerdown", down);
      window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up); window.removeEventListener("blur", blur);
      document.removeEventListener("compositionstart", startComposition); document.removeEventListener("compositionend", endComposition); document.removeEventListener("keydown", keys, true);
      document.removeEventListener("focusin", focusChanged); document.removeEventListener("focusout", focusChanged);
    };
  }, [listRef]);
  useLayoutEffect(() => {
    // Explicit row navigation gets a reading pause too, without changing it.
    if (priorReveal.current !== reveal) { priorReveal.current = reveal; if (reveal) gate.current.pause(Date.now()); }
    const list = listRef.current;
    if (!list) return;
    if (!gate.current.canFollow(enabled, !suspended, followEditingTarget(document.activeElement), Date.now())) {
      position.current.invalidate(); return;
    }
    const id = playingCaptionId(captions, time, followed.current);
    followed.current = id;
    const index = id ? layout.indexById.get(id) : undefined;
    const changed = position.current.changed({ id, time, playing, rowTop: index === undefined ? 0 : layout.offsets[index]!, rowHeight: index === undefined ? 0 : layout.height(index), total: layout.total, viewportHeight: list.clientHeight });
    if (!changed || !id || captionFollowTop(layout, id, list.scrollTop, list.clientHeight) === null) return;
    // Use the virtual list's own viewport updater so an unmounted row appears
    // immediately. Never call preview/seek, selection or filter setters.
    if (index !== undefined) revealIndex(index);
  }, [enabled, playing, suspended, time, captions, layout, listRef, reveal, revealIndex, revision]);
}
