import { MAX_PROJECT_BYTES, parseProject, type Project } from "./domain";
import { fitSpeakerEvidence } from "./speakerEvidenceBudget";

export const PROJECT_STORAGE_KEY = "voicesubsep.project.v1";
export const PROJECT_BACKUP_KEY = "voicesubsep.project.previous.v1";
export const PROJECT_DAMAGED_KEY = "voicesubsep.project.unreadable.v1";
export type ProjectStorage = Pick<Storage, "setItem" | "getItem">;
export type RecoveryKey = typeof PROJECT_STORAGE_KEY | typeof PROJECT_BACKUP_KEY | typeof PROJECT_DAMAGED_KEY;
export type RecoveryRecord = {
  key: RecoveryKey;
  valid: boolean;
  name: string;
  updatedAt: string;
  captions: number;
  error: string;
};
export type SafeSaveResult = "saved" | "saved_without_backup" | "saved_with_reduced_evidence" | "failed" | "invalid" | "blocked";

/** Read from storage on demand; never cache or silently repair an unreadable backup. */
export function recoveryRecords(storage: ProjectStorage = localStorage): RecoveryRecord[] {
  return ([PROJECT_STORAGE_KEY, PROJECT_BACKUP_KEY, PROJECT_DAMAGED_KEY] as const).flatMap((key): RecoveryRecord[] => {
    const raw = storage.getItem(key);
    if (raw === null) return [];
    try {
      const project = parseProject(raw);
      return [{ key, valid: true, name: project.name, updatedAt: project.updatedAt, captions: project.captions.length, error: "" }];
    } catch (error) {
      return [{ key, valid: false, name: "", updatedAt: "", captions: 0, error: (error as Error).message }];
    }
  });
}

export function readRecoveryRaw(key: RecoveryKey, storage: ProjectStorage = localStorage): string {
  if (![PROJECT_STORAGE_KEY, PROJECT_BACKUP_KEY, PROJECT_DAMAGED_KEY].includes(key)) throw new Error("복구할 저장본이 없습니다.");
  const raw = storage.getItem(key);
  if (raw === null) throw new Error("복구할 저장본이 없습니다.");
  return raw;
}

export function readRecoveryProject(key: RecoveryKey, storage: ProjectStorage = localStorage): Project {
  return parseProject(readRecoveryRaw(key, storage));
}

/** Validate before writing. A failed write always retains the previous current entry.
 * Previous valid snapshots rotate at most once a minute, or at a project boundary.
 * An unreadable current entry must be archived intact before an explicit replacement.
 */
export function saveRecoverableProject(project: Project, storage: ProjectStorage = localStorage): SafeSaveResult {
  let raw: string;
  let reducedEvidence = false;
  try {
    const fitted = fitSpeakerEvidence(project, MAX_PROJECT_BYTES);
    raw = JSON.stringify(fitted.project);
    parseProject(raw);
    reducedEvidence = fitted.reduced;
  } catch { return "invalid"; }
  try {
    const previous = storage.getItem(PROJECT_STORAGE_KEY);
    if (previous === raw) {
      // A page-hide flush of unchanged work must not clear the warning about
      // an unreadable previous snapshot that we deliberately preserved.
      const backupRaw = storage.getItem(PROJECT_BACKUP_KEY);
      if (backupRaw !== null) {
        try { parseProject(backupRaw); } catch { return "saved_without_backup"; }
      }
      return "saved";
    }
    let backupFailed = false;
    if (previous !== null) {
      let previousProject: Project | null = null;
      try { previousProject = parseProject(previous); } catch { /* Archive the original bytes below. */ }
      if (!previousProject) {
        // Never overwrite an already preserved unreadable entry with another one.
        const archived = storage.getItem(PROJECT_DAMAGED_KEY);
        if (archived !== null && archived !== previous) return "blocked";
        try { storage.setItem(PROJECT_DAMAGED_KEY, previous); } catch { return "blocked"; }
      } else {
        let backup: Project | null = null;
        const backupRaw = storage.getItem(PROJECT_BACKUP_KEY);
        if (backupRaw !== null) {
          try { backup = parseProject(backupRaw); } catch { /* Preserve unreadable backup for manual export. */ }
        }
        const shouldRotate = backupRaw === null || (backup !== null && (
          previousProject.id !== project.id || backup.id !== previousProject.id ||
          Date.parse(previousProject.updatedAt) - Date.parse(backup.updatedAt) >= 60_000));
        if (shouldRotate) {
          try { storage.setItem(PROJECT_BACKUP_KEY, previous); } catch { backupFailed = true; }
        } else if (backupRaw !== null && backup === null) backupFailed = true;
      }
    }
    storage.setItem(PROJECT_STORAGE_KEY, raw);
    return backupFailed ? "saved_without_backup" : reducedEvidence ? "saved_with_reduced_evidence" : "saved";
  } catch { return "failed"; }
}
