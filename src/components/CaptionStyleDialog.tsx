import { useI18n } from "../i18n";
import { useState } from "react";
import type { CaptionStyle } from "../domain";
import { CaptionOverlay } from "./CaptionOverlay";
import { Dialog } from "./Dialog";

export function CaptionStyleDialog({
  title, description, value, inherited, name, nameColor, text, resetLabel, onApply, onClose,
}: {
  title: string;
  description: string;
  value: Partial<CaptionStyle> | undefined;
  inherited: CaptionStyle;
  name: string;
  nameColor: string;
  text: string;
  resetLabel: string;
  onApply: (style: Partial<CaptionStyle> | undefined) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<Partial<CaptionStyle>>(() => ({ ...value }));
  const resolved = { ...inherited, ...draft };
  function change<K extends keyof CaptionStyle>(key: K, value: CaptionStyle[K]) {
    setDraft((previous) => ({ ...previous, [key]: value }));
  }
  return (
    <Dialog title={title} onClose={onClose}>
      <p className="dialog-intro">{description}</p>
      <div className="style-preview" aria-label={t("자막 스타일 미리보기")}>
        <CaptionOverlay entries={[{
          id: "style-sample", name, nameColor, text: text || t("이렇게 자막이 표시됩니다."), style: resolved,
        }]} />
      </div>
      <div className="style-fields">
        <label>{t('글꼴')}<select aria-label={t("글꼴")} value={resolved.fontFamily} onChange={(e) => change("fontFamily", e.target.value as CaptionStyle["fontFamily"])}>
            <option value="sans">{t('고딕')}</option><option value="serif">{t('명조')}</option><option value="mono">{t('고정폭')}</option>
          </select>
        </label>
        <label>{t('글자 크기')}<span>{resolved.fontSize}px</span>
          <input aria-label={t("글자 크기")} type="range" min={12} max={48} step={1} value={resolved.fontSize} onChange={(e) => change("fontSize", Number(e.target.value))} />
        </label>
        <label>{t('글자 색상')}<input aria-label={t("글자 색상")} type="color" value={resolved.textColor} onChange={(e) => change("textColor", e.target.value)} />
        </label>
        <label>{t('배경 색상')}<input aria-label={t("배경 색상")} type="color" value={resolved.backgroundColor} onChange={(e) => change("backgroundColor", e.target.value)} />
        </label>
        <label className="style-wide">{t('배경 불투명도')}<span>{resolved.backgroundOpacity}%</span>
          <input aria-label={t("배경 불투명도")} type="range" min={0} max={100} step={5} value={resolved.backgroundOpacity} onChange={(e) => change("backgroundOpacity", Number(e.target.value))} />
        </label>
        <label>{t('세로 위치')}<select aria-label={t("세로 위치")} value={resolved.position} onChange={(e) => change("position", e.target.value as CaptionStyle["position"])}>
            <option value="top">{t('위')}</option><option value="middle">{t('가운데')}</option><option value="bottom">{t('아래')}</option>
          </select>
        </label>
        <label>{t('가로 정렬')}<select aria-label={t("가로 정렬")} value={resolved.align} onChange={(e) => change("align", e.target.value as CaptionStyle["align"])}>
            <option value="left">{t('왼쪽')}</option><option value="center">{t('가운데')}</option><option value="right">{t('오른쪽')}</option>
          </select>
        </label>
      </div>
      <div className="style-toggles">
        <label><input type="checkbox" checked={resolved.bold} onChange={(e) => change("bold", e.target.checked)} />{t('굵게')}</label>
        <label><input type="checkbox" checked={resolved.outline} onChange={(e) => change("outline", e.target.checked)} />{t('글자 테두리')}</label>
        <label><input type="checkbox" checked={resolved.showSpeaker} onChange={(e) => change("showSpeaker", e.target.checked)} />{t('인물 이름 표시')}</label>
      </div>
      <p className="style-save-hint">{t('스타일은 프로젝트에 저장됩니다. 일반 SRT에는 글자와 시간만 포함됩니다.')}</p>
      <div className="dialog-actions">
        <button onClick={() => setDraft({})}>{resetLabel}</button>
        <button onClick={onClose}>{t('취소')}</button>
        <button className="primary" onClick={() => {
          onApply(Object.keys(draft).length ? draft : undefined);
          onClose();
        }}>{t('적용')}</button>
      </div>
    </Dialog>
  );
}
