import type { Project } from "./domain";
import { saveRecoverableProject, type ProjectStorage, type SafeSaveResult } from "./projectRecovery";

export { PROJECT_STORAGE_KEY } from "./projectRecovery";
export const PROJECT_SAVE_ERROR = "자동 저장 공간이 부족합니다. 프로젝트 파일로 저장하세요.";
export const PROJECT_INVALID_ERROR = "저장할 수 없는 편집 내용입니다. 실행 취소하거나 파일을 확인하세요. 이전 저장본은 보존됩니다.";
export const PROJECT_RECOVERY_ERROR = "이전 저장본을 보존하지 못해 자동 저장을 중단했습니다. 복구 메뉴에서 원본을 내보내세요.";
export const PROJECT_BACKUP_ERROR = "현재 작업은 저장했지만 이전 복구본을 갱신하지 못했습니다. 프로젝트 파일도 저장하세요.";
export const PROJECT_EVIDENCE_REDUCED = "프로젝트는 저장했지만 용량을 맞추려고 선택적 화자 근거 일부를 생략했습니다.";

export type ProjectSession = {
  past: Project[];
  current: Project;
  future: Project[];
  canAutosave: boolean;
  token: object;
};
export type ProjectSaveResult = SafeSaveResult | "skipped";

export function createProjectSession(project: Project, canAutosave = true): ProjectSession {
  return { past: [], current: project, future: [], canAutosave, token: {} };
}

export function isCurrentProjectSession(snapshot: ProjectSession, active: ProjectSession): boolean {
  return snapshot.token === active.token;
}

export function editProjectSession(
  session: ProjectSession,
  change: Project | ((previous: Project) => Project),
): ProjectSession {
  const next = typeof change === "function" ? change(session.current) : change;
  if (next === session.current) return session;
  return {
    ...session,
    past: [...session.past.slice(-39), session.current],
    current: { ...next, updatedAt: new Date().toISOString() },
    future: [],
  };
}

/** New, open, and sample actions begin a separate undo/redo session. */
export function replaceProjectSession(project: Project): ProjectSession {
  return createProjectSession({ ...project, updatedAt: new Date().toISOString() });
}

export function undoProjectSession(session: ProjectSession): ProjectSession {
  return session.past.length ? {
    ...session,
    past: session.past.slice(0, -1),
    current: session.past.at(-1)!,
    future: [session.current, ...session.future],
  } : session;
}

export function redoProjectSession(session: ProjectSession): ProjectSession {
  return session.future.length ? {
    ...session,
    past: [...session.past.slice(-39), session.current],
    current: session.future[0]!,
    future: session.future.slice(1),
  } : session;
}

/** Ignore callbacks captured before any edit or project replacement. */
export function persistProjectSession(
  snapshot: ProjectSession,
  active: ProjectSession,
  storage?: ProjectStorage,
): ProjectSaveResult {
  if (snapshot !== active || !active.canAutosave) return "skipped";
  try { return saveRecoverableProject(active.current, storage ?? localStorage); }
  catch { return "failed"; }
}
