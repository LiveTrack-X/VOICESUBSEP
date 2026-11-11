import { useEffect, useId, useRef, useState } from "react";
import { BookOpen } from "lucide-react";
import type { AsrSelection } from "../cloudAsr";
import { useI18n } from "../i18n";
import { parseVocabularyText, vocabularyBlockReason, vocabularySupportNotice } from "../vocabulary";
import "./vocabulary-editor.css";

export function VocabularyEditor({ terms, selection, onSave, disabled = false, onDirtyChange }: {
  terms: readonly string[];
  selection: AsrSelection;
  onSave?: (terms: string[]) => void;
  disabled?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { t } = useI18n();
  const id = useId();
  const saved = terms.join("\n");
  const [draft, setDraft] = useState(saved);
  const [saveError, setSaveError] = useState("");
  const previousSaved = useRef(saved);
  const dirty = draft !== saved;
  useEffect(() => {
    if (previousSaved.current === saved) return;
    previousSaved.current = saved;
    setDraft(saved); setSaveError(""); onDirtyChange?.(false);
  }, [saved, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);
  let draftTerms: string[] = [], invalid = "";
  try { draftTerms = parseVocabularyText(draft); } catch (error) { invalid = (error as Error).message; }
  const block = vocabularyBlockReason(terms, selection);
  const notice = vocabularySupportNotice(terms, selection);
  function save() {
    try {
      const parsed = parseVocabularyText(draft);
      onSave?.(parsed);
      setDraft(parsed.join("\n"));
      onDirtyChange?.(false);
      setSaveError("");
    } catch (error) { setSaveError((error as Error).message); }
  }
  return <fieldset className="vocabulary-editor" disabled={disabled || !onSave}>
    <legend><BookOpen size={17} aria-hidden="true" />{t("프로젝트 용어 사전")}</legend>
    <label htmlFor={id}>{t("고유명사·게임 용어 · 한 줄에 하나")}</label>
    <textarea id={id} value={draft} rows={4} spellCheck={false} aria-describedby={`${id}-help`} aria-invalid={!!invalid}
      onChange={event => { const value = event.target.value; setDraft(value); setSaveError(""); onDirtyChange?.(value !== saved); }}/>
    <p id={`${id}-help`}>{t("프로젝트에 저장한 용어를 다음 분석의 인식 힌트로 사용합니다. 이미 편집한 자막은 그대로 유지합니다.")}</p>
    <small>{t("최대 50개 · 용어당 50자 · 전체 2,000자. 인식 결과의 정확한 표기를 보장하지 않습니다.")}</small>
    <div className="vocabulary-actions">
      <span>{t("저장된 용어 {count}개", { count: terms.length })}{dirty && ` · ${t("저장하지 않은 변경")}`}</span>
      <button type="button" disabled={disabled || !onSave || !dirty || !!invalid} onClick={save}>{t("프로젝트에 저장")}</button>
    </div>
    {dirty && !invalid && <small>{t("저장할 용어 {count}개", { count: draftTerms.length })}</small>}
    {(invalid || saveError) && <p className="error-box" role="alert">{t(invalid || saveError)}</p>}
    {block && <p className="error-box" role="status">{t(block)}</p>}
    {notice && <p className="info-box" role="status">{t(notice)}</p>}
  </fieldset>;
}
