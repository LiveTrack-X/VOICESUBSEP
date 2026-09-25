import { useState } from "react";
import { useI18n } from "../i18n";
import { parseTheme, useTheme } from "../theme";

export function ThemeSelector({ className = "" }: { className?: string }) {
  const { t } = useI18n();
  const { theme, setTheme } = useTheme();
  const [saveFailed, setSaveFailed] = useState(false);
  return <label className={`theme-selector ${className}`}>
    <span>{t("테마")}</span>
    <select aria-label={t("화면 테마")} value={theme} onChange={event => {
      setSaveFailed(!setTheme(parseTheme(event.target.value)));
    }}>
      <option value="light">{t("라이트")}</option>
      <option value="dark">{t("다크")}</option>
    </select>
    {saveFailed && <span className="theme-save-warning" role="status">{t("테마를 저장하지 못했습니다. 이 창에는 적용되었습니다.")}</span>}
  </label>;
}
