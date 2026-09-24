import { useI18n } from "../i18n";
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  Check,
  Clock3,
  MessageSquareText,
  Play,
  Plus,
  Trash2,
} from "lucide-react";
import {
  formatTime,
  MAX_NOTES,
  MAX_TIME_SECONDS,
  parseTime,
  type Note,
  type NoteTag,
  type Project,
} from "../domain";

export type NotesPanelProps = {
  project: Project;
  update: (fn: (p: Project) => Project) => void;
  time: number;
  seek: (time: number) => void;
  reveal: { id: string } | null;
  onError: (message: string) => void;
};

const TAGS: Array<{ value: NoteTag; label: string }> = [
  { value: "edit", label: "편집" },
  { value: "highlight", label: "하이라이트" },
  { value: "subtitle", label: "자막" },
  { value: "check", label: "확인" },
];

export function NotesPanel({
  project,
  update,
  time,
  seek,
  reveal,
  onError,
}: NotesPanelProps) {
  const { t } = useI18n();
  const [focusId, setFocusId] = useState<string | null>(null);
  const textInputs = useRef(new Map<string, HTMLTextAreaElement>());
  const cards = useRef(new Map<string, HTMLElement>());
  const list = useRef<HTMLDivElement>(null);
  const notes = [...project.notes].sort((a, b) => a.start - b.start);
  const pending = project.notes.filter((note) => !note.done).length;
  const currentTime = Number.isFinite(time)
    ? Math.max(0, Math.min(time, project.duration || MAX_TIME_SECONDS))
    : 0;
  useLayoutEffect(() => {
    const card = reveal && cards.current.get(reveal.id);
    const container = list.current;
    if (!card || !container) return;
    const item = card.getBoundingClientRect();
    const box = container.getBoundingClientRect();
    container.scrollTop += item.top - box.top - Math.max(0, (container.clientHeight - card.clientHeight) / 2);
    container.scrollLeft += item.left - box.left - Math.max(0, (container.clientWidth - card.clientWidth) / 2);
  }, [reveal]);

  useEffect(() => {
    if (!focusId) return;
    textInputs.current.get(focusId)?.focus();
    setFocusId(null);
  }, [focusId, project.notes]);

  function change(id: string, fields: Partial<Note>) {
    update((previous) => ({
      ...previous,
      notes: previous.notes.map((note) =>
        note.id === id ? { ...note, ...fields } : note,
      ),
    }));
  }

  function addNote() {
    if (project.notes.length >= MAX_NOTES) {
      onError(
        t("메모는 프로젝트당 최대 {count}개까지 저장할 수 있습니다.", { count: MAX_NOTES }),
      );
      return;
    }
    const id = crypto.randomUUID();
    update((previous) => ({
      ...previous,
      notes: [
        ...previous.notes,
        {
          id,
          start: currentTime,
          end: null,
          text: "",
          tag: "edit",
          done: false,
        },
      ],
    }));
    setFocusId(id);
  }

  function editTime(
    note: Note,
    field: "start" | "end",
    input: HTMLInputElement,
  ) {
    try {
      const value =
        field === "end" && input.value.trim() === ""
          ? null
          : parseTime(input.value);
      const start = field === "start" ? (value as number) : note.start;
      const end = field === "end" ? value : note.end;
      if (end !== null && end < start)
        throw new Error(t("메모 종료 시간은 시작 시간보다 빠를 수 없습니다."));
      if (
        project.duration > 0 &&
        (start > project.duration || (end !== null && end > project.duration))
      ) {
        throw new Error(
          t("메모 시간은 영상 길이 {time} 이내로 입력하세요.", { time: formatTime(project.duration) }),
        );
      }
      input.value = value === null ? "" : formatTime(value);
      if (value !== note[field]) change(note.id, { [field]: value });
    } catch (error) {
      input.value = note[field] === null ? "" : formatTime(note[field]);
      onError(error instanceof Error ? t(error.message) : t("시간을 확인해 주세요."));
    }
  }

  function timeKey(
    event: KeyboardEvent<HTMLInputElement>,
    original: number | null,
  ) {
    if (event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.blur();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.currentTarget.value = original === null ? "" : formatTime(original);
      event.currentTarget.blur();
    }
  }

  return (
    <aside className="notes-panel panel" aria-label={t("편집 메모")}>
      <div className="panel-heading">
        <div className="notes-heading">
          <MessageSquareText size={18} aria-hidden="true" />
          <h2>{t('편집 메모')}</h2>
          <span
            className="notes-count"
            aria-label={t("완료 전 메모 {count}개", { count: pending })}
          >
            {pending}
          </span>
        </div>
        <button
          type="button"
          className="subtle-button"
          onClick={addNote}
          aria-label={t("현재 시간에 메모 추가")}
        >
          <Plus size={15} aria-hidden="true" />{t('메모 추가')}</button>
      </div>
      <p className="notes-hint">
        <Clock3 size={13} aria-hidden="true" />
        <span>{t("현재 위치 {time} · 원본 영상 기준", { time: formatTime(currentTime) })}</span>
      </p>
      <div className="notes-list" ref={list}>
        {notes.length === 0 ? (
          <div className="empty-state notes-empty">
            <MessageSquareText size={32} strokeWidth={1.5} aria-hidden="true" />
            <strong>{t('놓치고 싶지 않은 순간을 기록하세요')}</strong>
            <p>{t('컷 편집, 강조할 장면, 확인할 대사를')}<br />{t('재생 시간과 함께 남길 수 있어요.')}</p>
            <button type="button" className="subtle-button" onClick={addNote}>
              <Plus size={15} aria-hidden="true" />{t('첫 메모 남기기')}</button>
          </div>
        ) : (
          notes.map((note, index) => (
            <article
              key={note.id}
              ref={(card) => {
                if (card) cards.current.set(note.id, card);
                else cards.current.delete(note.id);
              }}
              className={`note-card ${note.done ? "is-done" : ""} ${reveal?.id === note.id ? "selected" : ""}`}
              aria-label={t("메모 {number}", { number: index + 1 })}
            >
              <div className="note-time">
                <button
                  type="button"
                  className="icon-button note-seek"
                  onClick={() => seek(note.start)}
                  title={t("이 위치로 이동")}
                  aria-label={t("메모 {number} 위치 {time}로 이동", { number: index + 1, time: formatTime(note.start) })}
                >
                  <Play size={13} aria-hidden="true" />
                </button>
                <label className="note-time-field">
                  <span>{t('시작')}</span>
                  <input
                    key={`${note.id}-start-${note.start}`}
                    aria-label={t("메모 {number} 시작 시간", { number: index + 1 })}
                    defaultValue={formatTime(note.start)}
                    placeholder="00:00:00.000"
                    maxLength={24}
                    onBlur={(event) =>
                      editTime(note, "start", event.currentTarget)
                    }
                    onKeyDown={(event) => timeKey(event, note.start)}
                  />
                </label>
                <span className="note-time-separator" aria-hidden="true">
                  –
                </span>
                <label className="note-time-field">
                  <span>{t('종료 · 선택')}</span>
                  <input
                    key={`${note.id}-end-${note.end}`}
                    aria-label={t("메모 {number} 종료 시간 선택 입력", { number: index + 1 })}
                    defaultValue={note.end === null ? "" : formatTime(note.end)}
                    placeholder={t("선택 입력")}
                    maxLength={24}
                    onBlur={(event) =>
                      editTime(note, "end", event.currentTarget)
                    }
                    onKeyDown={(event) => timeKey(event, note.end)}
                  />
                </label>
              </div>
              <textarea
                className="note-body"
                ref={(element) => {
                  if (element) textInputs.current.set(note.id, element);
                  else textInputs.current.delete(note.id);
                }}
                aria-label={t("메모 {number} 내용", { number: index + 1 })}
                placeholder={t("이 장면에서 할 편집을 적어보세요…")}
                value={note.text}
                rows={3}
                maxLength={10_000}
                onChange={(event) =>
                  change(note.id, { text: event.target.value })
                }
              />
              <div className="note-footer">
                <select
                  className={`note-tag tag-${note.tag}`}
                  aria-label={t("메모 {number} 분류", { number: index + 1 })}
                  value={note.tag}
                  onChange={(event) =>
                    change(note.id, { tag: event.target.value as NoteTag })
                  }
                >
                  {TAGS.map((tag) => (
                    <option key={tag.value} value={tag.value}>
                      {t(tag.label)}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className={`subtle-button note-done ${note.done ? "active" : ""}`}
                  aria-pressed={note.done}
                  aria-label={t(note.done ? "메모 {number} 완료 취소" : "메모 {number} 완료 표시", { number: index + 1 })}
                  onClick={() => change(note.id, { done: !note.done })}
                >
                  <Check size={14} aria-hidden="true" />
                  {note.done ? t("완료됨") : t("완료")}
                </button>
                <button
                  type="button"
                  className="icon-button note-delete"
                  title={t("메모 삭제")}
                  aria-label={t("메모 {number} 삭제", { number: index + 1 })}
                  onClick={() =>
                    update((previous) => ({
                      ...previous,
                      notes: previous.notes.filter(
                        (item) => item.id !== note.id,
                      ),
                    }))
                  }
                >
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              </div>
            </article>
          ))
        )}
      </div>
    </aside>
  );
}

export default NotesPanel;
