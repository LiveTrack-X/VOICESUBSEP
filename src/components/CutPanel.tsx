import { useMemo, useState } from "react";
import { Scissors, Undo2 } from "lucide-react";
import { formatTime, MAX_CUTS, type Caption, type Project } from "../domain";
import { buildKeepSpans, projectForEditedExport } from "../cuts";
import { useI18n } from "../i18n";

export function CutPanel({project, update, time, selected, preview, editedPreview, setEditedPreview, onExport}: {
  project: Project;
  update: (change: (p: Project) => Project) => void;
  time: number;
  selected?: Caption;
  preview: (time: number) => void;
  editedPreview: boolean;
  setEditedPreview: (value: boolean) => void;
  onExport: () => void;
}) {
  const {t} = useI18n();
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [error, setError] = useState("");
  const cuts = project.cuts ?? [];
  const spans = useMemo(()=>buildKeepSpans(project.cuts??[], project.duration),[project.cuts,project.duration]);
  const keptDuration = spans.at(-1)?.outputEnd ?? 0;
  const issues = useMemo(()=>projectForEditedExport(project).issues,[project]);
  function exclude(from: number, to: number) {
    if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to <= from || to > project.duration) {
      setError(t("원본 길이 안에서 시작보다 늦은 끝 시간을 지정하세요.")); return;
    }
    if (cuts.length >= MAX_CUTS) { setError(t("최대 200개 구간까지 제외할 수 있습니다.")); return; }
    const next = [...cuts, {id: crypto.randomUUID(), start: from, end: to}];
    if (!buildKeepSpans(next, project.duration).length) { setError(t("내보낼 구간을 하나 이상 남겨주세요.")); return; }
    if (buildKeepSpans(next, project.duration).length>200) { setError(t("최대 200개 구간까지 제외할 수 있습니다.")); return; }
    update(p => ({...p, schemaVersion: 2, cuts: next}));
    setError("");
  }
  return <details className="cut-panel">
    <summary><Scissors size={15}/>{t("간단한 컷편집")} <span>{t("제외 {count}개 · 편집본 {duration}", {count:cuts.length, duration:formatTime(keptDuration)})}</span></summary>
    <p className="muted">{t("원본을 보존하고 제외 구간만 저장합니다. 자막·메모 편집 시간은 원본 기준입니다.")}</p>
    <div className="cut-controls">
      <label>{t("시작 (초)")}<input type="number" aria-label={t("컷 시작 (초)")} min={0} max={project.duration} step="0.01" value={start} onChange={e=>setStart(e.target.valueAsNumber)}/></label>
      <button onClick={()=>setStart(Math.round(time*1000)/1000)}>{t("현재 위치를 시작으로")}</button>
      <label>{t("끝 (초)")}<input type="number" aria-label={t("컷 끝 (초)")} min={0} max={project.duration} step="0.01" value={end} onChange={e=>setEnd(e.target.valueAsNumber)}/></label>
      <button onClick={()=>setEnd(Math.round(time*1000)/1000)}>{t("현재 위치를 끝으로")}</button>
      <button disabled={!project.duration} onClick={()=>exclude(start,end)}><Scissors size={14}/>{t("구간 제외")}</button>
      <button disabled={!selected} onClick={()=>selected&&exclude(selected.start,selected.end)}>{t("선택 자막 구간 제외")}</button>
    </div>
    <div className="cut-actions">
      <label><input type="checkbox" checked={editedPreview} disabled={!cuts.length} onChange={e=>setEditedPreview(e.target.checked)}/>{t("편집본 미리보기")}</label>
      <button onClick={onExport} disabled={!project.duration}>{t("편집본 내보내기")}</button>
      <button disabled={!cuts.length} onClick={()=>{update(p=>({...p,cuts:[]}));setEditedPreview(false);}}><Undo2 size={14}/>{t("모든 구간 복원")}</button>
    </div>
    {error && <p role="alert" className="inline-error">{error}</p>}
    {issues.length > 0 && <p className="cut-warning">{t("자막 {count}개가 컷 경계에 걸립니다. 원문·시간을 조정해야 편집본 SRT를 내보낼 수 있습니다.",{count:issues.length})} {t("컷 경계 검수가 필요한 자막은 편집본 미리보기에서 숨깁니다.")}</p>}
    {!!cuts.length && <ol className="cut-list">{cuts.map((cut,index)=><li key={cut.id}>
      <button onClick={()=>preview(cut.start)}>{index+1}. {formatTime(cut.start)} → {formatTime(cut.end)}</button>
      <button aria-label={t("제외 구간 {number} 복원",{number:index+1})} onClick={()=>update(p=>({...p,cuts:(p.cuts??[]).filter(c=>c.id!==cut.id)}))}>{t("복원")}</button>
    </li>)}</ol>}
  </details>;
}
