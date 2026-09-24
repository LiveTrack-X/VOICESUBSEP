import { useEffect, useRef, useState } from "react";
import { Download, FolderOpen, RefreshCw } from "lucide-react";
import { version } from "../../package.json";
import { download } from "../api";
import { useI18n } from "../i18n";
import { importAppSettings, loadAppSettings, MAX_SETTINGS_BYTES, saveAppSettings, serializeAppSettings } from "../settings";
import { clientDiagnostics, readServerDiagnostics, recordClientError, serializeDiagnostics, type ServerDiagnostics } from "../diagnostics";
import { Dialog } from "./Dialog";
import "./settings-dialog.css";

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const { t, locale, setLocale } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [server, setServer] = useState<ServerDiagnostics | null>(null);
  const [clientRows, setClientRows] = useState(() => clientDiagnostics.read());
  const [checking, setChecking] = useState(true);
  const [serverUnavailable, setServerUnavailable] = useState(false);

  async function refreshLogs() {
    setChecking(true);
    let result: ServerDiagnostics | null = null;
    try { result = await readServerDiagnostics(); }
    catch { /* A disconnected server must not prevent the client log download. */ }
    if (alive.current) {
      setServer(result); setServerUnavailable(result === null);
      setClientRows(clientDiagnostics.read()); setChecking(false);
    }
    return result;
  }
  useEffect(() => { alive.current = true; void refreshLogs(); return () => { alive.current = false; }; }, []);

  function exportSettings() {
    setError(""); setNotice("");
    try {
      download("voicesubsep-settings.json", serializeAppSettings(loadAppSettings(locale)), "application/json;charset=utf-8");
      setNotice("설정 파일 저장을 요청했습니다.");
    } catch (caught) { recordClientError("settings", "export-failed", caught); setError("설정 파일을 저장하지 못했습니다."); }
  }
  async function importSettings(file: File) {
    setBusy(true); setError(""); setNotice("");
    try {
      if (file.size > MAX_SETTINGS_BYTES) throw new Error("Settings file is too large");
      const settings = importAppSettings(await file.text());
      const saved = saveAppSettings(settings);
      if (!saved.ok) {
        recordClientError("settings", "save-failed", saved.error ?? "Unable to save settings");
        setError(saved.error ?? "설정 파일을 적용하지 못했습니다. 파일 형식과 저장 공간을 확인하세요.");
        return;
      }
      setLocale(settings.locale);
      setNotice("설정을 불러왔습니다. 다음 분석 창부터 적용됩니다.");
    } catch (caught) { recordClientError("settings", "import-failed", caught); setError("설정 파일을 적용하지 못했습니다. 파일 형식과 저장 공간을 확인하세요."); }
    finally { setBusy(false); }
  }
  async function exportLogs() {
    setBusy(true); setError(""); setNotice("");
    try {
      const latest = await refreshLogs();
      download(`voicesubsep-errors-${new Date().toISOString().slice(0, 10)}.json`, serializeDiagnostics(version, latest), "application/json;charset=utf-8");
      setNotice(latest ? "오류 로그 파일 저장을 요청했습니다." : "서버에 연결할 수 없어 화면 오류 로그만 저장했습니다.");
    } catch (caught) { recordClientError("diagnostics", "export-failed", caught); setError("오류 로그를 저장하지 못했습니다."); }
    finally { setBusy(false); }
  }
  const entries = [...clientRows, ...(server?.entries ?? [])].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  return <Dialog title={t("설정 및 오류 로그")} onClose={onClose} closeDisabled={busy}>
    <section className="settings-section" aria-labelledby="settings-backup-heading">
      <h3 id="settings-backup-heading">{t("설정 백업")}</h3>
      <p>{t("화면 언어, 음성 인식 설정, VST 체인을 하나의 JSON 파일로 저장하고 불러옵니다. 자막과 편집 메모는 프로젝트 저장을 사용하세요.")}</p>
      <div className="settings-actions">
        <button onClick={exportSettings} disabled={busy}><Download size={16}/>{t("설정 파일 저장")}</button>
        <button onClick={() => input.current?.click()} disabled={busy}><FolderOpen size={16}/>{t("설정 파일 불러오기")}</button>
      </div>
      <input ref={input} type="file" hidden accept=".json,application/json" onChange={(event) => {
        const file = event.target.files?.[0]; event.target.value = ""; if (file) void importSettings(file);
      }}/>
      <small>{t("불러오면 현재 설정을 대체합니다. 다른 PC에서는 플러그인 설치 경로를 확인하세요. 모델이나 플러그인을 자동 실행하지 않습니다.")}</small>
    </section>
    <section className="settings-section" aria-labelledby="settings-log-heading">
      <h3 id="settings-log-heading">{t("오류 로그")}</h3>
      <p>{t("화면·분석·VST 오류를 기기에 자동 보관합니다. 오래된 기록은 순환 정리하며, 내보낼 때 파일 경로와 인증 정보를 가립니다.")}</p>
      <div className="settings-actions">
        <button onClick={() => void exportLogs()} disabled={busy || checking}><Download size={16}/>{t("오류 로그 저장")}</button>
        <button onClick={() => void refreshLogs()} disabled={busy || checking}><RefreshCw size={16} className={checking ? "spin" : ""}/>{t("로그 새로고침")}</button>
      </div>
      {checking && <p role="status">{t("오류 기록을 확인하고 있습니다…")}</p>}
      {serverUnavailable && <p className="info-box">{t("서버 로그를 읽을 수 없습니다. 화면 오류 로그는 저장할 수 있습니다.")}</p>}
      {(!clientDiagnostics.persistenceAvailable || server?.persistence.available === false) && <p className="error-box" role="status">{t("일부 오류 기록을 기기에 보관하지 못했습니다. 현재 로그를 파일로 저장하세요.")}</p>}
      {!checking && <p>{t("보관된 오류·경고 {count}건", { count: entries.length })}</p>}
      {!!entries.length && <details className="settings-log-preview"><summary>{t("최근 오류 보기")}</summary><ol>
        {entries.slice(0, 10).map((entry, index) => <li key={`${entry.timestamp}-${index}`}>
          <time>{new Date(entry.timestamp).toLocaleString(locale)}</time><span>{entry.source} · {entry.event}{entry.count ? ` ×${entry.count}` : ""}</span><pre>{entry.message}</pre>
        </li>)}
      </ol></details>}
    </section>
    {notice && <p className="info-box" role="status">{t(notice)}</p>}
    {error && <p className="error-box" role="alert">{t(error)}</p>}
    <div className="dialog-actions"><button onClick={onClose} disabled={busy}>{t("닫기")}</button></div>
  </Dialog>;
}
