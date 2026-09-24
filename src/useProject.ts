import { useEffect, useState } from "react";
import { createProject, parseProject, type Project } from "./domain";

const STORAGE_KEY = "voicesubsep.project.v1";
function restore(): { project: Project; error: string } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return { project: raw ? parseProject(raw) : createProject(), error: "" };
  } catch {
    return {
      project: createProject(),
      error:
        "이전 자동 저장을 열지 못했습니다. 새 작업 저장 전에 프로젝트 파일을 확인하세요.",
    };
  }
}

export function useProject() {
  const [initial] = useState(restore);
  const [history, setHistory] = useState<{
    past: Project[];
    current: Project;
    future: Project[];
  }>({ past: [], current: initial.project, future: [] });
  const [saveState, setSaveState] = useState(initial.error || "자동 저장됨");
  const [canAutosave, setCanAutosave] = useState(!initial.error);
  useEffect(() => {
    if (!canAutosave) return;
    const flush = () => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(history.current));
      } catch {
        /* The normal save path surfaces storage errors. */
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(history.current));
        setSaveState("자동 저장됨");
      } catch {
        setSaveState(
          "자동 저장 공간이 부족합니다. 프로젝트 파일로 저장하세요.",
        );
      }
    }, 500);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [history.current, canAutosave]);
  function update(change: Project | ((previous: Project) => Project)) {
    setHistory((h) => {
      const next = typeof change === "function" ? change(h.current) : change;
      return {
        past: [...h.past.slice(-39), h.current],
        current: { ...next, updatedAt: new Date().toISOString() },
        future: [],
      };
    });
    if (canAutosave) setSaveState("저장 중…");
  }
  function replace(project: Project) {
    update(project);
    setCanAutosave(true);
  }
  function undo() {
    setHistory((h) =>
      h.past.length
        ? {
            past: h.past.slice(0, -1),
            current: h.past.at(-1)!,
            future: [h.current, ...h.future],
          }
        : h,
    );
  }
  function redo() {
    setHistory((h) =>
      h.future.length
        ? {
            past: [...h.past, h.current],
            current: h.future[0],
            future: h.future.slice(1),
          }
        : h,
    );
  }
  return {
    project: history.current,
    update,
    replace,
    undo,
    redo,
    canUndo: !!history.past.length,
    canRedo: !!history.future.length,
    saveState,
  };
}
