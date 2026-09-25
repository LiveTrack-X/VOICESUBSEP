import { useEffect, useRef, useState } from "react";
import { createProject, parseProject, type Project } from "./domain";
import {
  createProjectSession,
  editProjectSession,
  isCurrentProjectSession,
  persistProjectSession,
  PROJECT_SAVE_ERROR,
  PROJECT_INVALID_ERROR,
  PROJECT_RECOVERY_ERROR,
  PROJECT_BACKUP_ERROR,
  PROJECT_EVIDENCE_REDUCED,
  PROJECT_STORAGE_KEY,
  redoProjectSession,
  replaceProjectSession,
  undoProjectSession,
  type ProjectSession,
} from "./projectSession";

function restore(): { project: Project; error: string } {
  try {
    const raw = localStorage.getItem(PROJECT_STORAGE_KEY);
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
  const [session, setSession] = useState(() => createProjectSession(initial.project, !initial.error));
  // Updated during actions, before React commits: pagehide and stale timers must
  // never put the preceding project back into storage during a transition.
  const activeSession = useRef(session);
  const [saveState, setSaveState] = useState(initial.error || "자동 저장됨");
  const [recoveryWarning, setRecoveryWarning] = useState(!!initial.error);

  function persist(snapshot: ProjectSession) {
    const result = persistProjectSession(snapshot, activeSession.current);
    if (result === "skipped") return;
    setRecoveryWarning(result !== "saved");
    if (result === "saved") setSaveState("자동 저장됨");
    else if (result === "invalid") setSaveState(PROJECT_INVALID_ERROR);
    else if (result === "blocked") setSaveState(PROJECT_RECOVERY_ERROR);
    else if (result === "saved_without_backup") setSaveState(PROJECT_BACKUP_ERROR);
    else if (result === "saved_with_reduced_evidence") { setRecoveryWarning(false); setSaveState(PROJECT_EVIDENCE_REDUCED); }
    else setSaveState(PROJECT_SAVE_ERROR);
  }

  useEffect(() => {
    if (!session.canAutosave) return;
    const flush = () => persist(activeSession.current);
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    const timer = window.setTimeout(() => persist(session), 500);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [session]);

  function commit(next: ProjectSession) {
    if (next === activeSession.current) return;
    activeSession.current = next;
    setSession(next);
    if (next.canAutosave) setSaveState("저장 중…");
  }
  function update(change: Project | ((previous: Project) => Project)) {
    if (!isCurrentProjectSession(session, activeSession.current)) return;
    commit(editProjectSession(activeSession.current, change));
  }
  function replace(project: Project) {
    if (!isCurrentProjectSession(session, activeSession.current)) return;
    const next = replaceProjectSession(project);
    commit(next);
    // Persist before returning, including when the app is reloaded within the
    // normal 500 ms autosave window. Failed writes leave the old backup intact.
    persist(next);
  }
  function undo() {
    if (!isCurrentProjectSession(session, activeSession.current)) return;
    commit(undoProjectSession(activeSession.current));
  }
  function redo() {
    if (!isCurrentProjectSession(session, activeSession.current)) return;
    commit(redoProjectSession(activeSession.current));
  }
  return {
    project: session.current,
    update,
    replace,
    undo,
    redo,
    canUndo: !!session.past.length,
    canRedo: !!session.future.length,
    saveState,
    recoveryWarning,
  };
}
