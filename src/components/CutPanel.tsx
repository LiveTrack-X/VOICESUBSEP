import { useEffect, useMemo, useState } from "react";
import { Scissors, Undo2, Play, Square, Download } from "lucide-react";
import { formatTime, MAX_CUTS, parseTime, type Caption, type Project } from "../domain";
import { buildKeepSpans, projectForEditedExport } from "../cuts";
import { useI18n } from "../i18n";
import "./cuts-ui.css";

export function CutPanel({project, update, time, selected, preview, previewRange, stopPreview, mediaAvailable, editedPreview, setEditedPreview, onExport}: {
  project: Project; update: (change: (p: Project) => Project) => void; time: number; selected?: Caption;
  preview: (time: number) => void; previewRange: (start: number, end: number) => void;
  stopPreview: () => void; mediaAvailable: boolean; editedPreview: boolean;
  setEditedPreview: (value: boolean) => void; onExport: () => void;
}) {
  const {t} = useI18n();
  const [start, setStart] = useState("00:00:00.000");
  const [end, setEnd] = useState("00:00:00.000");
  const [error, setError] = useState("");
  useEffect(() => { setStart("00:00:00.000"); setEnd("00:00:00.000"); setError(""); }, [project.id]);
  const cuts = project.cuts ?? [];
  const spans = useMemo(()=>buildKeepSpans(project.cuts??[], project.duration),[project.cuts,project.duration]);
  const keptDuration = spans.at(-1)?.outputEnd ?? 0;
  const issues = useMemo(()=>projectForEditedExport(project).issues,[project]);
  function parsed(value: string) { try { return parseTime(value); } catch { return NaN; } }
  const from = parsed(start), to = parsed(end);
  const validRange = Number.isFinite(from) && Number.isFinite(to) && from >= 0 && to > from && to <= project.duration;
  function exclude() {
    if (!validRange) { setError(t("원본 길이 안에서 시작보다 늦은 끝 시간을 지정하세요.")); return; }
    if (cuts.length >= MAX_CUTS) { setError(t("최대 200개 구간까지 제외할 수 있습니다.")); return; }
    const next = [...cuts, {id: crypto.randomUUID(), start: from, end: to}];
    const kept = buildKeepSpans(next, project.duration);
    if (!kept.length) { setError(t("내보낼 구간을 하나 이상 남겨주세요.")); return; }
    if (kept.length>200) { setError(t("최대 200개 구간까지 제외할 수 있습니다.")); return; }
    update(p => ({...p, schemaVersion: 2, cuts: next})); setError("");
  }
  return <details className="cut-panel cut-workspace">
    <summary><Scissors size={16}/><strong>{t("간단한 컷편집")}</strong><span>{t("제외 {count}개",{count:cuts.length})}</span></summary>
    <div className="cut-workspace-body">
      <div className="cut-duration-summary"><span>{t("원본")}<strong>{formatTime(project.duration)}</strong></span><span>{t("편집본")}<strong>{formatTime(keptDuration)}</strong></span></div>
      <p className="muted">{t("원본을 보존하고 제외 구간만 저장합니다. 자막·메모 편집 시간은 원본 기준입니다.")}</p>
      <section className="cut-range-card" aria-label={t("제외할 구간 지정")}>
        <div className="cut-section-title"><strong>{t("1. 제외할 구간 지정")}</strong><span>{formatTime(time)}</span></div>
        <div className="cut-time-fields">
          <div><label>{t("시작")} · IN<input type="text" aria-label={t("컷 시작 시간")} value={start} spellCheck={false} placeholder="00:00:00.000" aria-invalid={!Number.isFinite(from) || from<0 || from>project.duration}
            onChange={e=>{setStart(e.target.value);setError("");}} onBlur={()=>{if(Number.isFinite(from))setStart(formatTime(from));}}/></label>
            <button onClick={()=>{setStart(formatTime(time));setError("");}}>{t("현재 위치를 시작으로")}</button></div>
          <div><label>{t("끝")} · OUT<input type="text" aria-label={t("컷 끝 시간")} value={end} spellCheck={false} placeholder="00:00:00.000" aria-invalid={!Number.isFinite(to) || to<0 || to>project.duration}
            onChange={e=>{setEnd(e.target.value);setError("");}} onBlur={()=>{if(Number.isFinite(to))setEnd(formatTime(to));}}/></label>
            <button onClick={()=>{setEnd(formatTime(time));setError("");}}>{t("현재 위치를 끝으로")}</button></div>
        </div>
        <small className="cut-time-help">{validRange ? t("선택 길이 {duration}",{duration:formatTime(to-from)}) : t("시작과 끝을 지정하세요 · 시:분:초 또는 초 입력")}</small>
        <div className="cut-range-actions"><button disabled={!selected} onClick={()=>{if(selected){setStart(formatTime(selected.start));setEnd(formatTime(selected.end));setError("");}}}>{t("선택 자막으로 범위 지정")}</button>
          <button disabled={!validRange || !mediaAvailable} onClick={()=>previewRange(from,to)}><Play size={14}/>{t("선택 구간 재생")}</button>
          <button aria-label={t("구간 재생 정지")} title={t("구간 재생 정지")} disabled={!mediaAvailable} onClick={stopPreview}><Square size={13}/></button></div>
        <button className="cut-exclude" disabled={!validRange} onClick={exclude}><Scissors size={15}/>{t("이 구간 제외")}</button>
      </section>
      {error && <p role="alert" className="inline-error">{error}</p>}
      <section className="cut-exclusions" aria-label={t("제외 구간 목록")}>
        <div className="cut-section-title"><strong>{t("2. 제외 구간 확인")}</strong><span>{cuts.length} / {MAX_CUTS}</span></div>
        {!cuts.length ? <p className="cut-empty">{t("아직 제외한 구간이 없습니다.")}</p> : <ol className="cut-exclusion-list">{[...cuts].sort((a,b)=>a.start-b.start||a.end-b.end).map((cut,index)=><li key={cut.id}>
          <button className="cut-range-link" onClick={()=>preview(cut.start)}><Play size={13}/><span>{formatTime(cut.start)}<br/>{formatTime(cut.end)}</span></button>
          <span className="cut-range-length">{formatTime(cut.end-cut.start)}</span>
          <button aria-label={t("제외 구간 {number} 복원",{number:index+1})} onClick={()=>{update(p=>({...p,cuts:(p.cuts??[]).filter(c=>c.id!==cut.id)}));if(cuts.length===1)setEditedPreview(false);}}><Undo2 size={13}/>{t("복원")}</button>
        </li>)}</ol>}
        <button className="cut-reset" disabled={!cuts.length} onClick={()=>{update(p=>({...p,cuts:[]}));setEditedPreview(false);}}><Undo2 size={13}/>{t("모든 구간 복원")}</button>
      </section>
      {issues.length > 0 && <p className="cut-warning">{t("자막 {count}개가 컷 경계에 걸립니다. 원문·시간을 조정해야 편집본 SRT를 내보낼 수 있습니다.",{count:issues.length})} {t("컷 경계 검수가 필요한 자막은 편집본 미리보기에서 숨깁니다.")}</p>}
      <div className="cut-export-bar"><label><input type="checkbox" checked={editedPreview} disabled={!cuts.length} onChange={e=>setEditedPreview(e.target.checked)}/>{t("제외 구간 건너뛰며 재생")}</label>
        <button className="primary" onClick={onExport} disabled={!project.duration}><Download size={14}/>{t("편집본 내보내기")}</button></div>
    </div>
  </details>;
}
