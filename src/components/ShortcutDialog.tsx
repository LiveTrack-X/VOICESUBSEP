import { useState, type KeyboardEvent } from "react";
import { Search } from "lucide-react";
import { useI18n } from "../i18n";
import { defaultShortcuts, formatShortcut, SHORTCUT_ACTIONS, shortcutConflict, shortcutFromEvent, shortcutProblem, type ShortcutAction, type ShortcutBindings, type ShortcutLoad } from "../shortcuts";
import { Dialog } from "./Dialog";
import "./shortcuts.css";

export function ShortcutDialog({ bindings, status, onSave, onClose }: {
  bindings: ShortcutBindings;
  status: ShortcutLoad["status"];
  onSave: (bindings: ShortcutBindings) => boolean;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<ShortcutAction | null>(null);
  const [candidate, setCandidate] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [resetting, setResetting] = useState(false);
  const visible = SHORTCUT_ACTIONS.filter(item => `${t(item.label)} ${t(item.group)} ${formatShortcut(bindings[item.id])}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));

  function validate(action: ShortcutAction, value: string | null): string {
    if (value && shortcutProblem(value)) return t(shortcutProblem(value) === "reserved" ? "운영체제나 브라우저에서 사용하는 예약 키입니다. 다른 조합을 선택하세요." : "이 키는 지정할 수 없습니다. 문자·숫자·방향 키 또는 기능 키를 사용하세요.");
    const conflict = shortcutConflict(bindings, action, value);
    return conflict ? t("이미 ‘{action}’에 지정된 키입니다. 해당 키를 먼저 해제하거나 다른 키를 선택하세요.", { action: t(SHORTCUT_ACTIONS.find(item => item.id === conflict)!.label) }) : "";
  }
  function apply(next: ShortcutBindings) {
    if (!onSave(next)) { setError(t("단축키를 저장하지 못했습니다. 이전 설정을 유지합니다.")); return; }
    setEditing(null); setCandidate(null); setResetting(false); setError(""); setNotice(t("단축키를 이 기기에 저장했습니다."));
  }
  function setBinding(action: ShortcutAction, value: string | null) {
    const problem = validate(action, value);
    if (problem) { setError(problem); return; }
    apply({ ...bindings, [action]: value });
  }
  function capture(event: KeyboardEvent) {
    if (!editing || candidate) return;
    if (event.key === "Tab") { setEditing(null); setCandidate(null); return; }
    event.stopPropagation();
    event.preventDefault();
    if (event.key === "Escape") { setEditing(null); setCandidate(null); setError(""); return; }
    if (event.repeat || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || ["Control", "Meta", "Alt", "Shift"].includes(event.key)) return;
    const value = shortcutFromEvent(event.nativeEvent);
    setCandidate(value);
    setError(value ? validate(editing, value) : t("이 키는 지정할 수 없습니다. 문자·숫자·방향 키 또는 기능 키를 사용하세요."));
  }
  return <Dialog title={t("단축키 허브")} onClose={onClose}>
    <div className="shortcut-hub">
      <p>{t("명령을 검색하고 변경 버튼을 누른 뒤 원하는 키 조합을 입력하세요. Ctrl은 Mac에서 Command에 해당합니다.")}</p>
      <p className="shortcut-help">{t("텍스트 입력·한글 조합·다른 대화상자에서는 편집 단축키를 실행하지 않습니다. Ctrl/Command가 포함된 프로젝트 저장은 입력 중에도 사용할 수 있습니다.")}</p>
      <label className="shortcut-search"><Search size={16}/><input type="search" value={query} onChange={event => setQuery(event.target.value)} aria-label={t("단축키 검색")} placeholder={t("명령 또는 키 검색")}/></label>
      {status === "invalid" && <p className="error-box" role="status">{t("저장된 단축키를 읽을 수 없어 기본값을 표시합니다. 변경 전까지 원래 저장값을 유지합니다.")}</p>}
      {status === "unavailable" && <p className="error-box" role="status">{t("이 환경에서 단축키 저장소에 접근할 수 없습니다.")}</p>}
      <div className="shortcut-list" aria-label={t("단축키 목록")}>
        {visible.map(item => <div className={`shortcut-row${editing === item.id ? " shortcut-editing" : ""}`} key={item.id}>
          <div className="shortcut-name"><strong>{t(item.label)}</strong><small>{t(item.group)}</small></div>
          <kbd aria-label={bindings[item.id] ? formatShortcut(bindings[item.id]) : t("지정 안 됨")}>{formatShortcut(bindings[item.id])}</kbd>
          <div className="shortcut-actions">
            <button aria-label={t("{action} 단축키 변경", { action: t(item.label) })} onKeyDown={capture} onClick={() => { setEditing(item.id); setCandidate(null); setError(""); setNotice(""); setResetting(false); }}>{t("변경")}</button>
            <button disabled={!bindings[item.id]} onClick={() => setBinding(item.id, null)} aria-label={t("{action} 단축키 해제", { action: t(item.label) })}>{t("해제")}</button>
            <button disabled={bindings[item.id] === item.defaultKey} onClick={() => setBinding(item.id, item.defaultKey)} aria-label={t("{action} 기본 단축키 복원", { action: t(item.label) })}>{t("기본값")}</button>
          </div>
          {editing === item.id && <div className="shortcut-capture">
            <span role="status">{candidate ? t("선택한 키: {key}", { key: formatShortcut(candidate) }) : t("키 조합을 누르세요. Esc 또는 Tab으로 취소합니다.")}</span>
            <button disabled={!candidate || !!validate(item.id, candidate)} onClick={() => setBinding(item.id, candidate)}>{t("적용")}</button>
            <button onClick={() => { setEditing(null); setCandidate(null); setError(""); }}>{t("취소")}</button>
          </div>}
        </div>)}
        {!visible.length && <p>{t("일치하는 단축키가 없습니다.")}</p>}
      </div>
      {notice && <p className="info-box" role="status">{notice}</p>}
      {error && <p className="error-box" role="alert">{error}</p>}
      {resetting && <div className="shortcut-reset" role="group" aria-label={t("전체 단축키 복원 확인")}><p>{t("개인 지정 단축키를 모두 기본값으로 복원할까요?")}</p><button onClick={() => apply(defaultShortcuts())}>{t("전체 기본값 복원")}</button><button onClick={() => setResetting(false)}>{t("취소")}</button></div>}
      <div className="dialog-actions"><button onClick={() => { setResetting(true); setEditing(null); setError(""); }}>{t("전체 기본값 복원")}</button><button onClick={onClose}>{t("닫기")}</button></div>
    </div>
  </Dialog>;
}
