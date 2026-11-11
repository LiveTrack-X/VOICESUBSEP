import { useI18n } from "../i18n";
import { useEffect, useId, useRef, useState } from "react";
import { isValidCaptionFontName, normalizeCaptionFontName, resolveCaptionStyleFields, type CaptionStyle } from "../domain";
import { CaptionOverlay } from "./CaptionOverlay";
import { Dialog } from "./Dialog";
import "../caption-style.css";

const FONT_EXAMPLES = ["Malgun Gothic", "Noto Sans KR", "Batang", "D2Coding", "Consolas", "Arial"];

export function CaptionStyleDialog({
  title, description, value, inherited, inheritedOutlineColor, name, nameColor, text, resetLabel, onApply, onClose,
}: {
  title: string;
  description: string;
  value: Partial<CaptionStyle> | undefined;
  inherited: CaptionStyle;
  /** Raw parent override, so an automatic contrast outline follows text edits. */
  inheritedOutlineColor?: string;
  name: string;
  nameColor: string;
  text: string;
  resetLabel: string;
  onApply: (style: Partial<CaptionStyle> | undefined) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<Partial<CaptionStyle>>(() => ({ ...value }));
  const [fonts, setFonts] = useState<string[]>([]);
  const [fontState, setFontState] = useState<"idle" | "loading" | "ready" | "unavailable">("idle");
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const fontListId = useId(), fontHintId = useId(), fontErrorId = useId();
  const resolved = resolveCaptionStyleFields({ ...inherited, ...draft, outlineColor: draft.outlineColor ?? inheritedOutlineColor });
  const fontInput = draft.fontName ?? inherited.fontName ?? "";
  const fontValid = !fontInput.trim() || isValidCaptionFontName(fontInput);
  const canLoadFonts = typeof window !== "undefined" && typeof window.voicesubsepDesktop?.listFonts === "function";

  function change<K extends keyof CaptionStyle>(key: K, next: CaptionStyle[K]) {
    setDraft((previous) => ({ ...previous, [key]: next }));
  }
  async function loadFonts() {
    if (fontState === "loading") return;
    setFontState("loading");
    try {
      const result = await window.voicesubsepDesktop?.listFonts?.();
      if (!mounted.current) return;
      const names = [...new Set((result?.fonts ?? []).filter(isValidCaptionFontName).map(normalizeCaptionFontName))];
      setFonts(names);
      setFontState(result?.available && names.length ? "ready" : "unavailable");
    } catch {
      if (mounted.current) setFontState("unavailable");
    }
  }

  return (
    <Dialog title={title} onClose={onClose}>
      <div className="caption-style-editor" onKeyDown={(event) => {
        // Escape belongs to the input method while a font name is being composed.
        if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) event.stopPropagation();
      }}>
        <div className="caption-style-scroll" role="region" aria-label={t("자막 스타일 설정")} tabIndex={0}>
          <p className="dialog-intro">{description}</p>
          <div className="style-preview" aria-label={t("자막 스타일 미리보기")}>
            <CaptionOverlay entries={[{
              id: "style-sample", name, nameColor, text: text || t("이렇게 자막이 표시됩니다."), style: resolved,
            }]} />
          </div>

          <div className="style-fields">
            <label className="style-wide">{t("글꼴 이름")}
              <input aria-label={t("글꼴 이름")} type="text" list={fontListId} maxLength={120}
                value={fontInput} placeholder={t("예: Malgun Gothic")}
                aria-invalid={!fontValid || undefined} aria-describedby={`${fontHintId}${fontValid ? "" : ` ${fontErrorId}`}`}
                onChange={(event) => change("fontName", event.target.value)} />
              <datalist id={fontListId}>{(fontState === "ready" ? fonts : FONT_EXAMPLES).map((font) => <option key={font} value={font} />)}</datalist>
            </label>
            <div className="style-font-actions style-wide">
              <button type="button" onClick={() => change("fontName", "")}>{t("기본 글꼴 사용")}</button>
              {canLoadFonts && <button type="button" disabled={fontState === "loading"} onClick={() => { void loadFonts(); }}>
                {fontState === "loading" ? t("글꼴 목록 불러오는 중…") : t("설치 글꼴 불러오기")}
              </button>}
            </div>
            <p className="style-field-hint style-wide" id={fontHintId}>
              {t("PC에 설치된 글꼴 이름을 입력하세요. 없는 글꼴은 기본 글꼴로 표시됩니다. 글꼴 파일은 다운로드하지 않습니다.")}
            </p>
            {!canLoadFonts && <p className="style-field-hint style-wide">{t("설치 글꼴 목록은 Windows 설치형에서 지원합니다. 글꼴 이름을 직접 입력할 수 있습니다.")}</p>}
            {fontState !== "idle" && <p className="style-field-hint style-wide" role="status">
              {fontState === "loading" ? t("글꼴 목록 불러오는 중…") : fontState === "ready"
                ? t("설치 글꼴 {count}개를 불러왔습니다. 목록에서 선택하거나 이름을 입력하세요.", { count: fonts.length })
                : t("설치 글꼴 목록을 가져오지 못했습니다. 글꼴 이름을 직접 입력하거나 다시 시도하세요.")}
            </p>}
            {!fontValid && <p className="style-font-error style-wide" id={fontErrorId} role="alert">
              {t("글꼴 이름에는 문자, 숫자, 공백과 일반적인 이름 기호만 사용할 수 있습니다.")}
            </p>}
            <label>{t("기본 글꼴")}<select aria-label={t("기본 글꼴")} value={resolved.fontFamily} onChange={(event) => change("fontFamily", event.target.value as CaptionStyle["fontFamily"])}>
              <option value="sans">{t("고딕")}</option><option value="serif">{t("명조")}</option><option value="mono">{t("고정폭")}</option>
            </select></label>
            <label>{t("글자 크기")}<span>{resolved.fontSize}px</span>
              <input aria-label={t("글자 크기")} type="range" min={12} max={48} step={1} value={resolved.fontSize} onChange={(event) => change("fontSize", Number(event.target.value))} />
            </label>
            <label>{t("글자 색상")}<input aria-label={t("글자 색상")} type="color" value={resolved.textColor} onChange={(event) => change("textColor", event.target.value)} /></label>
            <label>{t("배경 색상")}<input aria-label={t("배경 색상")} type="color" value={resolved.backgroundColor} onChange={(event) => change("backgroundColor", event.target.value)} /></label>
            <label className="style-wide">{t("배경 불투명도")}<span>{resolved.backgroundOpacity}%</span>
              <input aria-label={t("배경 불투명도")} type="range" min={0} max={100} step={5} value={resolved.backgroundOpacity} onChange={(event) => change("backgroundOpacity", Number(event.target.value))} />
            </label>
            <label>{t("세로 위치")}<select aria-label={t("세로 위치")} value={resolved.position} onChange={(event) => change("position", event.target.value as CaptionStyle["position"])}>
              <option value="top">{t("위")}</option><option value="middle">{t("가운데")}</option><option value="bottom">{t("아래")}</option>
            </select></label>
            <label>{t("가로 정렬")}<select aria-label={t("가로 정렬")} value={resolved.align} onChange={(event) => change("align", event.target.value as CaptionStyle["align"])}>
              <option value="left">{t("왼쪽")}</option><option value="center">{t("가운데")}</option><option value="right">{t("오른쪽")}</option>
            </select></label>
          </div>
          <div className="style-toggles">
            <label><input type="checkbox" checked={resolved.bold} onChange={(event) => change("bold", event.target.checked)} />{t("굵게")}</label>
            <label><input type="checkbox" checked={resolved.showSpeaker} onChange={(event) => change("showSpeaker", event.target.checked)} />{t("인물 이름 표시")}</label>
          </div>

          <fieldset className="style-effect-section">
            <legend><label><input type="checkbox" checked={resolved.outline} onChange={(event) => change("outline", event.target.checked)} />{t("글자 테두리")}</label></legend>
            <div className="style-fields">
              <label>{t("테두리 두께")}<span>{resolved.outlineWidth}px</span>
                <input aria-label={t("테두리 두께")} type="range" min={0} max={8} step={0.5} disabled={!resolved.outline} value={resolved.outlineWidth} onChange={(event) => change("outlineWidth", Number(event.target.value))} />
              </label>
              <label>{t("테두리 색상")}<input aria-label={t("테두리 색상")} type="color" disabled={!resolved.outline} value={resolved.outlineColor} onChange={(event) => change("outlineColor", event.target.value)} /></label>
            </div>
          </fieldset>

          <fieldset className="style-effect-section">
            <legend><label><input type="checkbox" checked={resolved.shadow} onChange={(event) => change("shadow", event.target.checked)} />{t("글자 그림자")}</label></legend>
            <div className="style-fields">
              <label>{t("그림자 색상")}<input aria-label={t("그림자 색상")} type="color" disabled={!resolved.shadow} value={resolved.shadowColor} onChange={(event) => change("shadowColor", event.target.value)} /></label>
              <label>{t("그림자 흐림")}<span>{resolved.shadowBlur}px</span>
                <input aria-label={t("그림자 흐림")} type="range" min={0} max={12} step={0.5} disabled={!resolved.shadow} value={resolved.shadowBlur} onChange={(event) => change("shadowBlur", Number(event.target.value))} />
              </label>
              <label>{t("그림자 가로 거리")}<span>{resolved.shadowOffsetX}px</span>
                <input aria-label={t("그림자 가로 거리")} type="range" min={-12} max={12} step={0.5} disabled={!resolved.shadow} value={resolved.shadowOffsetX} onChange={(event) => change("shadowOffsetX", Number(event.target.value))} />
              </label>
              <label>{t("그림자 세로 거리")}<span>{resolved.shadowOffsetY}px</span>
                <input aria-label={t("그림자 세로 거리")} type="range" min={-12} max={12} step={0.5} disabled={!resolved.shadow} value={resolved.shadowOffsetY} onChange={(event) => change("shadowOffsetY", Number(event.target.value))} />
              </label>
            </div>
          </fieldset>
          <p className="style-save-hint">{t("스타일은 프로젝트에 저장됩니다. 일반 SRT에는 글자와 시간만 포함됩니다.")}</p>
        </div>
        <div className="dialog-actions">
          <button onClick={() => setDraft({})}>{resetLabel}</button>
          <button onClick={onClose}>{t("취소")}</button>
          <button className="primary" disabled={!fontValid} onClick={() => {
            const applied = { ...draft };
            if (applied.fontName !== undefined) applied.fontName = normalizeCaptionFontName(applied.fontName);
            onApply(Object.keys(applied).length ? applied : undefined);
            onClose();
          }}>{t("적용")}</button>
        </div>
      </div>
    </Dialog>
  );
}
