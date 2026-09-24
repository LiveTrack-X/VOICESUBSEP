import { useEffect, useMemo, useRef, useState } from "react";
import { Languages, LoaderCircle, RefreshCw } from "lucide-react";
import type { Project, SubtitleLanguage } from "../domain";
import { useI18n } from "../i18n";
import {
  buildTranslationBatches, isValidTranslationText, MAX_TRANSLATION_TEXT_CHARACTERS,
  TRANSLATION_LANGUAGES, TRANSLATION_LANGUAGE_NAMES, translateBatch, translationStatus,
  type TranslationDevice, type TranslationRow, type TranslationStatus,
} from "../translation";
import { Dialog } from "./Dialog";

const MODEL_STORAGE_KEY = "voicesubsep-translation-model";
const PAGE_SIZE = 20;
function rememberedModel(): string {
  try { return localStorage.getItem(MODEL_STORAGE_KEY) ?? ""; } catch { return ""; }
}

export function TranslationDialog({ project, onClose, onApply }: {
  project: Project;
  onClose: () => void;
  onApply: (rows: TranslationRow[], target: SubtitleLanguage) => void;
}) {
  const { t } = useI18n();
  const [status, setStatus] = useState<TranslationStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [model, setModel] = useState(rememberedModel);
  const [target, setTarget] = useState<SubtitleLanguage>("en");
  const [device, setDevice] = useState<TranslationDevice>("auto");
  const [retranslateAll, setRetranslateAll] = useState(false);
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [rows, setRows] = useState<TranslationRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const alive = useRef(true);
  const shouldStop = useRef(false);
  const statusRequest = useRef<AbortController | null>(null);
  const preparation = useMemo(() => {
    try { return { batches: buildTranslationBatches(project.captions, target, retranslateAll), error: "" }; }
    catch (error) { return { batches: [], error: (error as Error).message }; }
  }, [project.captions, target, retranslateAll]);
  const eligible = preparation.batches.reduce((count, batch) => count + batch.length, 0);
  const configurationDisabled = running || rows.length > 0;
  const validResults = rows.length > 0 && rows.every((row) => isValidTranslationText(row.text));
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));

  async function refresh() {
    statusRequest.current?.abort();
    const controller = new AbortController();
    statusRequest.current = controller;
    setLoading(true);
    setError("");
    try {
      const next = await translationStatus(AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]));
      if (!alive.current || controller.signal.aborted) return;
      setStatus(next);
      setModel((current) => next.models.includes(current) ? current : next.models[0] ?? "");
    } catch (error) {
      if (alive.current && !controller.signal.aborted) {
        setStatus(null);
        setError((error as Error).message);
      }
    } finally {
      if (alive.current && !controller.signal.aborted) setLoading(false);
    }
  }

  useEffect(() => {
    alive.current = true;
    void refresh();
    return () => { alive.current = false; shouldStop.current = true; statusRequest.current?.abort(); };
  }, []);

  async function start() {
    if (running || loading || rows.length || !status?.ready || !status.models.includes(model) || !eligible) return;
    const batches = preparation.batches;
    setError("");
    setRunning(true);
    setStopping(false);
    setStopped(false);
    setPage(0);
    setTotal(eligible);
    shouldStop.current = false;
    try { localStorage.setItem(MODEL_STORAGE_KEY, model); } catch { /* Optional preference. */ }
    const completed: TranslationRow[] = [];
    try {
      for (const batch of batches) {
        if (shouldStop.current || !alive.current) break;
        const translated = await translateBatch(batch, target, model, device);
        if (!alive.current) return;
        completed.push(...translated);
        setRows([...completed]);
      }
      if (alive.current) setStopped(shouldStop.current && completed.length < eligible);
    } catch (error) {
      if (alive.current) setError((error as Error).message);
    } finally {
      if (alive.current) { setRunning(false); setStopping(false); }
    }
  }

  function clearResults() {
    setRows([]);
    setTotal(0);
    setPage(0);
    setStopped(false);
    setError("");
  }

  return <Dialog title={t("로컬 자막 번역")} onClose={onClose} closeDisabled={running}>
    <p className="dialog-intro">{t("원문과 인물·시간은 유지하고, 언어별 번역을 따로 저장합니다.")}</p>
    <p className="info-box">{t("이 기기의 Ollama 모델만 사용합니다. 모델을 자동 다운로드하지 않습니다.")}</p>
    <div className="form-grid">
      <label>{t("번역 언어")}<select aria-label={t("번역 언어")} value={target} disabled={configurationDisabled}
        onChange={(event) => { setTarget(event.target.value as SubtitleLanguage); setTotal(0); setStopped(false); setError(""); }}>
        {TRANSLATION_LANGUAGES.map((language) => <option key={language} value={language}>{TRANSLATION_LANGUAGE_NAMES[language]}</option>)}
      </select></label>
      <label>{t("로컬 번역 모델")}<select aria-label={t("로컬 번역 모델")} value={model} disabled={loading || configurationDisabled}
        onChange={(event) => setModel(event.target.value)}>
        {!status?.models.length && <option value="">{t("준비된 모델 없음")}</option>}
        {status?.models.map((name) => <option key={name} value={name}>{name}</option>)}
      </select></label>
      <label>{t("번역 연산 장치")}<select aria-label={t("번역 연산 장치")} value={device} disabled={configurationDisabled}
        onChange={(event) => setDevice(event.target.value as TranslationDevice)}>
        <option value="auto">{t("자동 · 로컬 GPU 우선")}</option>
        <option value="cpu">{t("CPU만 사용")}</option>
      </select></label>
    </div>
    <label className="checkbox-label"><input type="checkbox" checked={retranslateAll} disabled={configurationDisabled}
      onChange={(event) => { setRetranslateAll(event.target.checked); setTotal(0); setStopped(false); }} />{t("이미 번역된 자막도 다시 번역")}</label>
    <p className="dialog-intro">{t("기본적으로 번역이 없거나 원문이 바뀐 자막만 처리합니다. 빈 자막은 건너뜁니다.")}</p>
    {loading && <p className="inline-status" role="status"><LoaderCircle size={18} className="spin" />{t("로컬 번역 모델을 확인하고 있습니다…")}</p>}
    {!loading && !status?.ready && <p className="info-box" role="status">
      {t("Ollama를 실행하고 번역 가능한 로컬 모델을 준비한 뒤 다시 확인하세요.")}
      {status?.error && <><br />{status.error}</>}
    </p>}
    {!running && !rows.length && <p>{t("번역할 자막: {count}개", { count: eligible })}</p>}
    {(running || total > 0) && <div className="translation-progress" role="status" aria-live="polite">
      {running && <LoaderCircle size={18} className="spin" />}
      <p>{t("번역 완료 {done} / {total}개", { done: rows.length, total })}</p>
      <progress aria-label={t("번역 진행률")} value={rows.length} max={Math.max(1, total)} />
      {stopping && <p>{t("현재 묶음이 완료되면 중지합니다. 진행 중인 연산은 바로 취소되지 않습니다.")}</p>}
      {stopped && <p>{t("번역을 중지했습니다. 완료된 결과만 검토하고 적용할 수 있습니다.")}</p>}
    </div>}
    {(error || preparation.error) && <p className="error-box" role="alert">{t(error || preparation.error)}</p>}
    {!!rows.length && <>
      <h3>{t("번역 결과 검토")}</h3>
      <p className="dialog-intro">{t("번역문을 수정한 뒤 적용하세요. 적용 전에는 프로젝트가 바뀌지 않습니다.")}</p>
      {rows.length < total && <p className="info-box">{t("부분 결과입니다. {total}개 중 완료된 {done}개만 적용됩니다.", { total, done: rows.length })}</p>}
      <div className="translation-results">
        {rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((row, index) => <section className="translation-row" key={row.id}>
          <p className="translation-source"><strong>{t("원문 {number}", { number: page * PAGE_SIZE + index + 1 })}</strong><br />{row.sourceText}</p>
          <label>{TRANSLATION_LANGUAGE_NAMES[target]}<textarea aria-label={t("번역문 {number}", { number: page * PAGE_SIZE + index + 1 })}
            value={row.text} rows={3} maxLength={MAX_TRANSLATION_TEXT_CHARACTERS} disabled={running}
            onChange={(event) => setRows((previous) => previous.map((item) => item.id === row.id ? { ...item, text: event.target.value } : item))} /></label>
        </section>)}
      </div>
      {pageCount > 1 && <nav className="dialog-actions" aria-label={t("번역 결과 페이지")}>
        <button disabled={page === 0} onClick={() => setPage((value) => value - 1)}>{t("이전 결과")}</button>
        <span>{page + 1} / {pageCount}</span>
        <button disabled={page >= pageCount - 1} onClick={() => setPage((value) => value + 1)}>{t("다음 결과")}</button>
      </nav>}
      {!validResults && <p className="error-box">{t("빈 번역문을 채워야 적용할 수 있습니다.")}</p>}
    </>}
    <div className="dialog-actions">
      {!running && !rows.length && <button disabled={loading} onClick={() => void refresh()}><RefreshCw size={16} />{t("모델 다시 확인")}</button>}
      {!running && !!rows.length && <button onClick={clearResults}>{t("결과 지우고 다시 준비")}</button>}
      <button disabled={running} onClick={onClose}>{t("닫기")}</button>
      {running ? <button disabled={stopping} onClick={() => { shouldStop.current = true; setStopping(true); }}>{t("현재 묶음 완료 후 중지")}</button>
        : rows.length ? <button className="primary" disabled={!validResults} onClick={() => {
          try { onApply(rows, target); onClose(); } catch (error) { setError((error as Error).message); }
        }}>{t("{count}개 번역 적용", { count: rows.length })}</button>
          : <button className="primary" disabled={loading || !status?.ready || !model || !eligible || !!preparation.error} onClick={() => void start()}>
            <Languages size={16} />{t("번역 시작")}</button>}
    </div>
  </Dialog>;
}
