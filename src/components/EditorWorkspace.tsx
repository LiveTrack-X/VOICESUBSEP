import { useEffect, useRef, useState, type ReactNode } from "react";
import { Columns2, PanelLeftClose } from "lucide-react";
import { useI18n } from "../i18n";
import { SubtitleFocusContext } from "../workspaceFocus";

const FOCUS_STORAGE_KEY = "voicesubsep-editor-focus-v1";
const NARROW_FOCUS_STORAGE_KEY = "voicesubsep-editor-focus-narrow-v1";

function readFocused(narrow: boolean): boolean {
  try {
    const stored = localStorage.getItem(narrow ? NARROW_FOCUS_STORAGE_KEY : FOCUS_STORAGE_KEY);
    return stored === null ? narrow : stored === "true";
  } catch { return narrow; }
}

export function EditorWorkspace({ children, noteReveal, tools }: {
  children: ReactNode;
  noteReveal: { id: string } | null;
  tools?: ReactNode;
}) {
  const { t } = useI18n();
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 1000px)").matches);
  const [focused, setFocused] = useState(() => readFocused(narrow));
  const chooseFocused = (value: boolean) => {
    setFocused(value);
    try { localStorage.setItem(narrow ? NARROW_FOCUS_STORAGE_KEY : FOCUS_STORAGE_KEY, String(value)); }
    catch { /* Layout remains usable without browser storage. */ }
  };
  const previousNoteReveal = useRef(noteReveal);
  // Reveal notes in the same commit so NotesPanel measures a visible card.
  const focusedView = focused && !(noteReveal && previousNoteReveal.current !== noteReveal);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 1000px)");
    const resize = () => { setNarrow(query.matches); setFocused(readFocused(query.matches)); };
    query.addEventListener("change", resize);
    return () => query.removeEventListener("change", resize);
  }, []);
  useEffect(() => {
    // A timeline note must still reveal its editor while focus view is active.
    if (noteReveal && previousNoteReveal.current !== noteReveal) setFocused(false);
    previousNoteReveal.current = noteReveal;
  }, [noteReveal]);

  return <SubtitleFocusContext.Provider value={focusedView}><div className={`editor-workspace${focusedView ? " subtitle-focus" : ""}`}>
    <div className="workspace-view-bar">
      <span className="workspace-view-label">{t(focusedView ? "자막 편집에 집중하는 화면입니다." : "편집 화면")}</span>
      {tools && <div className="workspace-tools">{tools}</div>}
      <button
        className="workspace-focus-button"
        aria-pressed={focusedView}
        onClick={() => chooseFocused(!focused)}
        title={t("미리보기와 보조 패널을 줄여 자막 편집 공간을 넓힙니다.")}
      >
        {focusedView ? <Columns2 size={15} /> : <PanelLeftClose size={15} />}
        {t(focusedView ? "전체 패널 보기" : "자막 집중")}
      </button>
    </div>
    {children}
  </div></SubtitleFocusContext.Provider>;
}
