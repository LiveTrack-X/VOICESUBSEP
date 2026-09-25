import { useI18n } from "../i18n";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { MessageSquareText } from "lucide-react";
import { formatTime, type Note, type NoteTag } from "../domain";
import { timelineMenuAnchor, type TimelineMenuAnchor } from "../timelineContext";

const TAGS: Record<NoteTag, { label: string; color: string }> = {
  edit: { label: "편집", color: "#ddd5fb" },
  highlight: { label: "하이라이트", color: "#fde4a5" },
  subtitle: { label: "자막", color: "#c9e9fb" },
  check: { label: "확인", color: "#c7ebdc" },
};

export function NoteTimelineLane({
  notes, duration, time, selected, preview, onContextMenu,
}: {
  notes: Note[];
  duration: number;
  time: number;
  selected: string | null;
  preview: (id: string) => void;
  onContextMenu?: (id: string, anchor: TimelineMenuAnchor) => void;
}) {
  const { t } = useI18n();
  const track = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1);
  useLayoutEffect(() => {
    const element = track.current;
    if (!element) return;
    const measure = () => setWidth(Math.max(1, element.clientWidth));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const { markers, rowCount } = useMemo(() => {
    const rowEnds: number[] = [];
    const markers = [...notes]
      .sort((a, b) => a.start - b.start)
      .map((note) => {
        const isRange = note.end !== null && note.end > note.start;
        const markerWidth = Math.min(width, Math.max(
          16,
          isRange ? ((note.end! - note.start) / duration) * width : 16,
        ));
        const left = Math.min((note.start / duration) * width, width - markerWidth);
        let row = rowEnds.findIndex((end) => end + 3 <= left);
        if (row < 0) row = rowEnds.length;
        rowEnds[row] = left + markerWidth;
        return { note, isRange, row, left, width: markerWidth };
      });
    return { markers, rowCount: rowEnds.length };
  }, [notes, duration, width]);
  return (
    <div className="timeline-lane note-timeline-lane" style={{ height: Math.max(27, rowCount * 24 + 4) }}>
      <div className="lane-label"><MessageSquareText size={12} />{t('편집 메모')}</div>
      <div className="lane-track note-track" ref={track}>
        <span className="playhead" style={{ left: `${(time / duration) * 100}%` }} />
        {!notes.length && <span className="note-track-empty">{t('메모를 추가하면 이곳에 표시됩니다')}</span>}
        {markers.map(({ note, isRange, row, left, width }) => {
          const tag = TAGS[note.tag];
          const label = `${t(tag.label)} · ${formatTime(note.start)}${isRange ? `–${formatTime(note.end!)}` : ""} · ${note.text || t("내용 없는 메모")}${note.done ? t(" · 완료") : ""}`;
          return (
            <button
              key={note.id}
              className={`note-marker ${isRange ? "note-range" : "note-point"} ${note.done ? "is-done" : ""} ${selected === note.id ? "selected" : ""}`}
              style={{ left, width, top: row * 24 + 3, backgroundColor: tag.color }}
              aria-label={t("메모 {label}", { label })}
              aria-pressed={selected === note.id}
              title={t("{label} · 클릭하여 재생", { label })}
              onClick={() => preview(note.id)}
              onContextMenu={event => { if (onContextMenu) { event.preventDefault(); event.stopPropagation(); onContextMenu(note.id, timelineMenuAnchor(event.currentTarget, event)); } }}
              onKeyDown={event => { if (onContextMenu && (event.key === "ContextMenu" || event.shiftKey && event.key === "F10")) { event.preventDefault(); event.stopPropagation(); onContextMenu(note.id, timelineMenuAnchor(event.currentTarget)); } }}
            >
              {isRange ? `${note.done ? "✓ " : ""}${note.text || t(tag.label)}` : note.done ? "✓" : "◆"}
            </button>
          );
        })}
      </div>
    </div>
  );
}
