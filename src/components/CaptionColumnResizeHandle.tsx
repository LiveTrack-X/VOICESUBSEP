import { useRef } from "react";
import { useI18n } from "../i18n";
import { clampCaptionColumn, keyboardCaptionColumn } from "../captionColumns";

export function CaptionColumnResizeHandle({ label, value, min, max, controls, onBegin, onChange, onCommit, onCancel, onReset }: {
  label: string; value: number; min: number; max: number; controls: string;
  onBegin: () => void; onChange: (width: number) => void; onCommit: (width: number) => void;
  onCancel: () => void; onReset: () => void;
}) {
  const { t } = useI18n();
  const drag = useRef<{ pointer: number; x: number; start: number; latest: number } | null>(null);
  const cancel = () => { if (drag.current) { drag.current = null; onCancel(); } };
  return <span className="caption-column-resizer" role="separator" tabIndex={0}
    aria-orientation="vertical" aria-label={t(label)} aria-controls={controls}
    aria-valuemin={min} aria-valuemax={max} aria-valuenow={value}
    aria-valuetext={t("열 너비 {width}px", { width: value })}
    title={t("드래그·좌우 키로 열 너비 조절 · Shift 미세 조절 · 두 번 클릭 또는 Enter로 기본값")}
    onPointerDown={event => {
      if (!event.isPrimary || event.button !== 0 || max <= min) return;
      event.preventDefault(); event.stopPropagation(); event.currentTarget.focus();
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { pointer: event.pointerId, x: event.clientX, start: value, latest: value };
      onBegin();
    }}
    onPointerMove={event => {
      const active = drag.current;
      if (!active || active.pointer !== event.pointerId) return;
      event.preventDefault(); event.stopPropagation();
      active.latest = clampCaptionColumn(active.start + event.clientX - active.x, { min, max });
      onChange(active.latest);
    }}
    onPointerUp={event => {
      const active = drag.current;
      if (!active || active.pointer !== event.pointerId) return;
      event.preventDefault(); event.stopPropagation(); drag.current = null;
      onCommit(clampCaptionColumn(active.latest, { min, max }));
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    }}
    onPointerCancel={cancel} onLostPointerCapture={cancel}
    onDoubleClick={event => { event.preventDefault(); event.stopPropagation(); drag.current = null; onReset(); }}
    onKeyDown={event => {
      if (event.nativeEvent.isComposing || event.keyCode === 229 || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === "Escape" && drag.current) { event.preventDefault(); event.stopPropagation(); cancel(); return; }
      if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); drag.current = null; onReset(); return; }
      const width = keyboardCaptionColumn(event.key, value, { min, max }, event.shiftKey);
      if (width === null) return;
      event.preventDefault(); event.stopPropagation(); onCommit(width);
    }} />;
}
