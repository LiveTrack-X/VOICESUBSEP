import { BookOpenText, Captions, Mic } from "lucide-react";
import { useI18n } from "../i18n";
import "./workspace-mode-switcher.css";

export type WorkspaceMode = "editing" | "documents" | "recording";

// Mode follows the open workflow; closing its dialog returns to the editor.
export function workspaceModeForDialog(dialog: string | null): WorkspaceMode {
  return dialog === "documents" ? "documents" : dialog === "live" ? "recording" : "editing";
}

export function WorkspaceModeSwitcher({ mode, onSelect }: {
  mode: WorkspaceMode;
  onSelect: (mode: WorkspaceMode) => void;
}) {
  const { t } = useI18n();
  const options = [
    { id: "editing", label: t("자막·영상 편집"), hint: t("자막·컷·타임라인 편집"), Icon: Captions },
    { id: "documents", label: t("인터뷰·회의록"), hint: t("발언록·문서로 저장"), Icon: BookOpenText },
    { id: "recording", label: t("녹음"), hint: t("마이크·시스템 소리 녹음 후 분석"), Icon: Mic },
  ] as const;
  return <nav className="workspace-mode-switcher" aria-label={t("작업 모드 선택")}>
    <span className="workspace-mode-label">{t("작업 모드")}</span>
    <div className="workspace-mode-options">
      {options.map(({ id, label, hint, Icon }) => <button
        key={id}
        type="button"
        className="workspace-mode-option"
        aria-pressed={mode === id}
        aria-haspopup={id === "editing" ? undefined : "dialog"}
        title={hint}
        onClick={() => onSelect(id)}
      >
        <Icon size={18} aria-hidden="true" />
        <span className="workspace-mode-copy"><strong>{label}</strong><small>{hint}</small></span>
      </button>)}
    </div>
  </nav>;
}
