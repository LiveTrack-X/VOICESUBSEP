import { useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import { download } from "../api";
import { safeFilename, type Project } from "../domain";
import { useI18n } from "../i18n";
import { PROJECT_BACKUP_KEY, PROJECT_DAMAGED_KEY, PROJECT_STORAGE_KEY, readRecoveryProject,
  readRecoveryRaw, recoveryRecords, type RecoveryKey } from "../projectRecovery";
import { Dialog } from "./Dialog";
import "./caption-editor-density.css";

export function ProjectRecoveryDialog({ onClose, onRestore }: { onClose: () => void; onRestore: (project: Project) => void }) {
  const { t } = useI18n();
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  const [exportedDamage, setExportedDamage] = useState<string | null>(null);
  const [selected, setSelected] = useState<RecoveryKey | null>(null);
  const [snapshot] = useState(() => {
    try { return { entries: recoveryRecords(), error: "" }; }
    catch { return { entries: [], error: "복구 저장소에 접근할 수 없습니다." }; }
  });
  let entries = snapshot.entries;
  if (revision > 0) {
    try { entries = recoveryRecords(); } catch { /* Keep initial metadata and show retry error below. */ }
  }
  const names = { [PROJECT_STORAGE_KEY]: "현재 자동 저장본", [PROJECT_BACKUP_KEY]: "이전 유효 저장본", [PROJECT_DAMAGED_KEY]: "보관된 읽기 실패 원본" };
  function refresh() {
    try { recoveryRecords(); setRevision((value) => value + 1); setError(""); }
    catch { setError(t("복구 저장소에 접근할 수 없습니다.")); }
  }
  function exportEntry(key: RecoveryKey, name: string, valid: boolean) {
    try {
      const raw = readRecoveryRaw(key);
      download(`${safeFilename(name || "voicesubsep-recovery")}${valid ? ".voicesub" : "-unreadable"}.json`, raw, "application/json");
      if (key === PROJECT_DAMAGED_KEY) setExportedDamage(raw);
      setError("");
    } catch (cause) { setError((cause as Error).message); }
  }
  return <Dialog title={t("자동 저장 복구")} onClose={onClose}>
    <p className="dialog-intro">{t("복구하기 전에 현재 작업을 파일로 저장하세요. 복구 시 이전 편집 기록은 초기화됩니다.")}</p>
    <p className="muted">{t("현재 저장본과 이전 유효본 한 개를 보관합니다. 이전 유효본은 최대 1분 간격 또는 프로젝트 전환 시 갱신됩니다.")}</p>
    {(error || (revision === 0 && snapshot.error)) && <p role="alert" className="error-box">{t(error || snapshot.error)}</p>}
    {!entries.length && <p>{t("복구할 저장본이 없습니다.")}</p>}
    <div className="project-recovery-list">{entries.map((entry) => <section key={entry.key} className="project-recovery-entry">
      <h3>{t(names[entry.key])}</h3>
      {entry.valid ? <p>{entry.name} · {entry.updatedAt} · {t("{count}개 자막", { count: entry.captions })}</p>
        : <p className="inline-error">{t("읽을 수 없는 원본입니다. 파일로 내보내 보관할 수 있습니다.")}</p>}
      <div className="dialog-actions">
        <button onClick={() => exportEntry(entry.key, entry.name, entry.valid)}><Download size={15} />{t("원본 JSON 내보내기")}</button>
        {entry.valid && <button onClick={() => setSelected(entry.key)}>{t("이 저장본으로 복구")}</button>}
      </div>
    </section>)}</div>
    {selected && <section className="info-box">
      <p>{t("선택한 저장본으로 현재 작업을 바꿉니다. 계속할까요?")}</p>
      <div className="dialog-actions"><button onClick={() => setSelected(null)}>{t("취소")}</button>
        <button className="primary" onClick={() => {
          try { const project = readRecoveryProject(selected); onRestore(project); onClose(); }
          catch (cause) { setError((cause as Error).message); setSelected(null); }
        }}>{t("복구 실행")}</button></div>
    </section>}
    {exportedDamage !== null && <details className="recovery-cleanup">
      <summary>{t("내보낸 오류 원본 정리")}</summary>
      <p>{t("다운로드한 파일을 보관했는지 확인하세요. 이 작업은 보관된 읽기 실패 원본만 삭제합니다.")}</p>
      <button onClick={() => {
        try {
          if (localStorage.getItem(PROJECT_DAMAGED_KEY) !== exportedDamage) throw new Error(t("저장본이 변경되었습니다. 다시 내보내세요."));
          localStorage.removeItem(PROJECT_DAMAGED_KEY); setExportedDamage(null); refresh();
        } catch (cause) { setError((cause as Error).message); }
      }}>{t("내보낸 오류 원본 삭제")}</button>
    </details>}
    <div className="dialog-actions"><button onClick={refresh}><RefreshCw size={15} />{t("저장본 다시 확인")}</button><button onClick={onClose}>{t("닫기")}</button></div>
  </Dialog>;
}
