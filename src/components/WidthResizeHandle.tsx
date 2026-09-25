import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { clampPanelWidth, keyboardPanelWidth, type WidthBounds } from "../panelWidths";

export type WidthResizeHandleProps = WidthBounds & {
  value: number;
  label: string;
  className: string;
  onChange: (width: number) => void;
  onCommit: (width: number) => void;
  onCancel: () => void;
  onReset: () => void;
};

export function WidthResizeHandle({ value, min, max, label, className, onChange, onCommit, onCancel, onReset }: WidthResizeHandleProps) {
  const { t } = useI18n();
  const drag = useRef<{ id: number; startX: number; width: number; latest: number } | null>(null);
  const [resizing, setResizing] = useState(false);
  const cancelCallback = useRef(onCancel);
  cancelCallback.current = onCancel;
  useEffect(() => () => { if (drag.current) cancelCallback.current(); }, []);
  const cancel = () => { if (drag.current) { drag.current = null; setResizing(false); onCancel(); } };
  return <div className={`panel-width-resizer ${className}${resizing ? " panel-width-resizing" : ""}`}
    role="separator" tabIndex={0} aria-orientation="vertical" aria-label={t(label)}
    aria-valuemin={min} aria-valuemax={max} aria-valuenow={value}
    aria-valuetext={t("패널 너비 {width}px", { width: value })}
    title={t("드래그하거나 좌우 방향키로 너비 조절 · Home/End 최소/최대 · 두 번 클릭하여 자동")}
    onPointerDown={event => {
      if (!event.isPrimary || event.button !== 0 || max <= min) return;
      event.preventDefault(); event.stopPropagation(); event.currentTarget.focus();
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { id: event.pointerId, startX: event.clientX, width: value, latest: value };
      setResizing(true);
    }}
    onPointerMove={event => {
      const active = drag.current;
      if (!active || active.id !== event.pointerId) return;
      event.preventDefault(); event.stopPropagation();
      active.latest = clampPanelWidth(active.width + event.clientX - active.startX, { min, max });
      onChange(active.latest);
    }}
    onPointerUp={event => {
      const active = drag.current;
      if (!active || active.id !== event.pointerId) return;
      event.preventDefault(); event.stopPropagation();
      drag.current = null; setResizing(false);
      onCommit(clampPanelWidth(active.latest, { min, max }));
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    }}
    onPointerCancel={cancel} onLostPointerCapture={cancel}
    onDoubleClick={event => { event.preventDefault(); event.stopPropagation(); drag.current = null; setResizing(false); onReset(); }}
    onKeyDown={event => {
      if (event.nativeEvent.isComposing || event.keyCode === 229 || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === "Escape" && drag.current) {
        event.preventDefault(); event.stopPropagation(); cancel(); return;
      }
      const next = keyboardPanelWidth(event.key, value, { min, max }, event.shiftKey);
      if (next === null) return;
      event.preventDefault(); event.stopPropagation(); onCommit(next);
    }}><span aria-hidden="true"/></div>;
}
