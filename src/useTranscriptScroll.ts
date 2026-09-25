import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { TranscriptTurn } from "./transcriptDocument";
import { transcriptAnchoredTop, transcriptOffsets, transcriptWindow } from "./transcriptScroll";

/** Variable-height, continuous reading. Exports do not depend on this window. */
export function useTranscriptScroll(turns: readonly TranscriptTurn[], timestamps: boolean, identity: string, reveal?: { id: string; nonce: number } | null) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ top: 0, width: 640, height: 400 });
  const [revision, setRevision] = useState(0);
  const measured = useMemo(() => new Map<string, number>(), [turns, timestamps, viewport.width]);
  const offsets = useMemo(() => transcriptOffsets(turns, measured, viewport.width, timestamps), [turns, measured, viewport.width, timestamps, revision]);
  const range = transcriptWindow(offsets, viewport.top, viewport.height);
  const previous = useRef<{ offsets: number[]; identity: string } | null>(null);
  const scrollTop = useRef(0);
  const appliedReveal = useRef<typeof reveal>(null);
  const readViewport = useCallback(() => {
    const node = scrollRef.current; if (!node) return;
    scrollTop.current = node.scrollTop;
    const next = { top: node.scrollTop, width: node.clientWidth || 640, height: node.clientHeight || 400 };
    setViewport(prior => prior.top === next.top && prior.width === next.width && prior.height === next.height ? prior : next);
  }, []);

  useLayoutEffect(() => {
    const node = scrollRef.current; if (!node) return;
    const before = previous.current;
    if (before?.identity !== identity) node.scrollTop = 0;
    else if (before.offsets !== offsets) {
      // Keep the same paragraph/position while estimates become measured heights.
      node.scrollTop = transcriptAnchoredTop(before.offsets, offsets, scrollTop.current);
    }
    previous.current = { offsets, identity }; readViewport();
  }, [offsets, identity, readViewport]);

  useLayoutEffect(() => {
    const node = scrollRef.current;
    if (!node || !reveal || appliedReveal.current === reveal) return;
    const index = turns.findIndex(turn => turn.ids[0] === reveal.id);
    if (index < 0) return;
    appliedReveal.current = reveal;
    node.scrollTop = offsets[index] ?? 0;
    readViewport();
  }, [reveal, turns, offsets, readViewport]);

  useLayoutEffect(() => {
    const node = scrollRef.current; if (!node) return;
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(readViewport);
    resize?.observe(node); window.addEventListener("resize", readViewport);
    return () => { resize?.disconnect(); window.removeEventListener("resize", readViewport); };
  }, [readViewport]);

  useLayoutEffect(() => {
    const node = scrollRef.current; if (!node) return;
    const rows = Array.from(node.querySelectorAll<HTMLElement>("[data-transcript-index]"));
    const measure = () => {
      let changed = false;
      for (const row of rows) {
        const turn = turns[Number(row.dataset.transcriptIndex)]; if (!turn) continue;
        const height = row.getBoundingClientRect().height;
        if (height > 0 && Math.abs((measured.get(turn.ids[0]) ?? 0) - height) > .5) {
          measured.set(turn.ids[0], height); changed = true;
        }
      }
      if (changed) setRevision(value => value + 1);
    };
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    rows.forEach(row => resize?.observe(row)); measure();
    return () => resize?.disconnect();
  }, [turns, measured, range.start, range.end]);

  return { scrollRef, range, onScroll: readViewport };
}
