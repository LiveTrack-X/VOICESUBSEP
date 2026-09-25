import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { CaptionFollowGate, captionFollowTop, followEditingTarget, playingCaptionId } from "./captionFollow";
import type { CaptionVirtualLayout } from "./captionVirtualList";

export function useCaptionFollow({ enabled, playing, time, captions, layout, listRef, reveal, revealIndex }: {
  enabled: boolean; playing: boolean; time: number;
  captions: readonly { id: string; start: number; end: number }[];
  layout: CaptionVirtualLayout;
  listRef: RefObject<HTMLDivElement | null>;
  reveal: { id: string } | null;
  revealIndex: (index: number) => void;
}) {
  const gate = useRef(new CaptionFollowGate());
  const followed = useRef<string | null>(null);
  const priorReveal = useRef(reveal);
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const pause = () => gate.current.pause(Date.now());
    const down = () => gate.current.pointerDown(Date.now());
    const up = () => gate.current.pointerUp(Date.now());
    const startComposition = () => gate.current.composition(true, Date.now());
    const endComposition = () => gate.current.composition(false, Date.now());
    const blur = () => { up(); endComposition(); };
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
    return () => {
      list.removeEventListener("wheel", pause); list.removeEventListener("touchmove", pause); list.removeEventListener("pointerdown", down);
      window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up); window.removeEventListener("blur", blur);
      document.removeEventListener("compositionstart", startComposition); document.removeEventListener("compositionend", endComposition); document.removeEventListener("keydown", keys, true);
    };
  }, [listRef]);
  useLayoutEffect(() => {
    // Explicit row navigation gets a reading pause too, without changing it.
    if (priorReveal.current !== reveal) { priorReveal.current = reveal; if (reveal) gate.current.pause(Date.now()); }
    const list = listRef.current;
    if (!list || !gate.current.canFollow(enabled, playing, followEditingTarget(document.activeElement), Date.now())) return;
    const id = playingCaptionId(captions, time, followed.current);
    followed.current = id;
    if (!id || captionFollowTop(layout, id, list.scrollTop, list.clientHeight) === null) return;
    const index = layout.indexById.get(id);
    // Use the virtual list's own viewport updater so an unmounted row appears
    // immediately. Never call preview/seek, selection or filter setters.
    if (index !== undefined) revealIndex(index);
  }, [enabled, playing, time, captions, layout, listRef, reveal, revealIndex]);
}
