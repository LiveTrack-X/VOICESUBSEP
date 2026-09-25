import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { loadCaptionColumns, resolveCaptionColumns, saveCaptionColumns, type CaptionColumn, type CaptionColumnPreferences } from "./captionColumns";

export function useCaptionColumns(onSaveFailure: () => void) {
  const [preferred, setPreferred] = useState(loadCaptionColumns);
  const [draft, setDraft] = useState<Partial<CaptionColumnPreferences> | null>(null);
  const [viewport, setViewport] = useState(0);
  const editorRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const preferredRef = useRef(preferred);
  preferredRef.current = preferred;
  useLayoutEffect(() => {
    const editor = editorRef.current, list = listRef.current;
    if (!editor || !list) return;
    const measure = () => {
      const width = list.clientWidth;
      if (width > 0) setViewport(value => value === width ? value : width);
    };
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(editor); observer?.observe(list);
    window.addEventListener("resize", measure); measure();
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, []);
  const layout = resolveCaptionColumns({ ...preferred, ...draft }, viewport);
  const commit = (column: CaptionColumn, width: number | null) => {
    // A user resize freezes the other visible column, including in a narrow
    // viewport. Passive viewport clamps alone never overwrite saved widths.
    const next = width === null ? { ...preferredRef.current, [column]: null }
      : { time: layout.time, speaker: layout.speaker, [column]: width };
    preferredRef.current = next;
    setPreferred(next); setDraft(null);
    if (!saveCaptionColumns(next)) onSaveFailure();
  };
  const style = {
    "--caption-time-width": `${layout.time}px`, "--caption-speaker-width": `${layout.speaker}px`,
    "--caption-review-width": `${layout.review}px`, "--caption-column-gap": `${layout.gap}px`,
    "--caption-column-padding": `${layout.padding}px`,
    ...(viewport > 0 ? { "--caption-table-width": `${layout.width}px` } : {}),
  } as CSSProperties;
  return {
    editorRef, listRef, layout, style, resizing: draft !== null,
    measurementKey: `${layout.time}:${layout.speaker}:${layout.text}:${layout.gap}:${layout.padding}`,
    change: (column: CaptionColumn, width: number) => setDraft(previous => ({ time: layout.time, speaker: layout.speaker, ...previous, [column]: width })),
    begin: () => setDraft({ time: layout.time, speaker: layout.speaker }),
    commit, cancel: () => setDraft(null), reset: (column: CaptionColumn) => commit(column, null),
  };
}
