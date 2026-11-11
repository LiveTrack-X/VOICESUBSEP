import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../i18n";
import { formatTime } from "../domain";
import { timelineMenuPosition, type TimelineMenuAnchor } from "../timelineContext";
import "./timeline-context-menu.css";

export function ContextMenu({ anchor, title, label, children, onClose }: {
  anchor: TimelineMenuAnchor; title: string; label: string; children: ReactNode; onClose: () => void;
}) {
  const { t } = useI18n();
  const menu = useRef<HTMLDivElement>(null);
  const close = useRef(onClose); close.current = onClose;
  const [position, setPosition] = useState({ left: 8, top: 8 });
  useLayoutEffect(() => {
    const element = menu.current;
    if (!element) return;
    const box = element.getBoundingClientRect();
    setPosition(timelineMenuPosition(anchor.x, anchor.y, box.width, box.height, window.innerWidth, window.innerHeight));
    element.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }, [anchor]);
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (!menu.current?.contains(event.target as Node)) close.current(); };
    const changed = () => close.current();
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("resize", changed);
    window.addEventListener("blur", changed);
    return () => { document.removeEventListener("pointerdown", outside, true); window.removeEventListener("resize", changed); window.removeEventListener("blur", changed); };
  }, []);
  return createPortal(<div className="timeline-context-menu" ref={menu} style={position} role="menu" aria-label={t(label)}
    onContextMenu={event => event.preventDefault()}
    onKeyDown={event => {
      event.stopPropagation();
      if (event.key === "Escape") { event.preventDefault(); onClose(); if (anchor.trigger.isConnected) anchor.trigger.focus(); return; }
      if (event.key === "Tab") { onClose(); return; }
      const buttons = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === "ArrowDown" ? (current + 1) % buttons.length : event.key === "ArrowUp" ? (current - 1 + buttons.length) % buttons.length
        : event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : null;
      if (next !== null) { event.preventDefault(); buttons[next]?.focus(); }
    }}>
    <p className="timeline-context-title">{title}</p>
    {children}
  </div>, document.body);
}

export function TimelineContextMenu({ anchor, title, canMove, adjustedStart, onEdit, onSeek, onMove, onDelete, onClose, captionActions }: {
  anchor: TimelineMenuAnchor; title: string; canMove: boolean; adjustedStart: number | null;
  onEdit: () => void; onSeek: () => void; onMove: () => void; onDelete: () => void; onClose: () => void;
  captionActions?: ReactNode;
}) {
  const { t } = useI18n();
  return <ContextMenu anchor={anchor} title={title} label="타임라인 항목 작업" onClose={onClose}>
    <button role="menuitem" onClick={onEdit}>{t("편집 열기")}</button>
    <button role="menuitem" onClick={onSeek}>{t("해당 시점으로 이동")}</button>
    <button role="menuitem" disabled={!canMove} onClick={onMove}>{t("현재 재생 위치로 옮기기")}</button>
    {adjustedStart !== null && <p className="timeline-context-hint">{t("끝 경계를 넘지 않도록 {time}부터 배치합니다.", { time: formatTime(adjustedStart) })}</p>}
    {captionActions}
    <button role="menuitem" className="timeline-context-delete" onClick={onDelete}>{t("삭제")}</button>
  </ContextMenu>;
}
