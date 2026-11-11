import type { CaptionEditAction } from "../captionRestructure";
import { useI18n } from "../i18n";

export function CaptionEditActions({ onAction, previous, next, checked = 0, cursor = true }: {
  onAction: (action: CaptionEditAction) => void; previous: boolean; next: boolean; checked?: number; cursor?: boolean;
}) {
  const { t } = useI18n();
  return <>
    {cursor && <button role="menuitem" onClick={() => onAction("splitCursor")}>{t("커서 위치에서 나누기")}</button>}
    <button role="menuitem" onClick={() => onAction("splitTime")}>{t("재생 시점에서 나누기")}</button>
    <button role="menuitem" disabled={!previous} onClick={() => onAction("mergePrevious")}>{t("이전 자막과 합치기")}</button>
    <button role="menuitem" disabled={!next} onClick={() => onAction("mergeNext")}>{t("다음 자막과 합치기")}</button>
    {checked > 0 && <button role="menuitem" disabled={checked < 2} onClick={() => onAction("mergeSelected")}>{t("선택 자막 합치기")}</button>}
  </>;
}
