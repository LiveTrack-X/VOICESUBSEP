import { useMemo, useState } from "react";
import { download } from "../api";
import { projectForEditedExport } from "../cuts";
import { safeFilename, type Project } from "../domain";
import { useI18n } from "../i18n";
import { exportYtt } from "../ytt";

/** Shares the established cut/word-evidence gate; never changes the saved clock. */
export function YttExportPanel({ project }: { project: Project }) {
  const { t } = useI18n();
  const [clock, setClock] = useState("source");
  const [notice, setNotice] = useState("");
  const prepared = useMemo(() => {
    try {
      if (clock === "source") return { project, issues: 0, error: "" };
      const mapped = projectForEditedExport(project);
      return { project: mapped.project, issues: mapped.issues.length, error: "" };
    } catch (error) { return { project, issues: 0, error: (error as Error).message }; }
  }, [project, clock]);
  const disabled = !prepared.project.captions.length || prepared.issues > 0 || !!prepared.error;
  function save() {
    if (disabled) return;
    try {
      const output = exportYtt(prepared.project);
      download(`${safeFilename(project.name)}-${clock}.ytt`, output, "application/xml;charset=utf-8");
      setNotice(t("YTT 파일을 생성했습니다. 유튜브 업로드 후 CC 표시를 확인하세요."));
    } catch (error) { setNotice(t((error as Error).message)); }
  }
  return <section className="export-section" aria-label={t("유튜브 스타일 CC")}>
    <h3>{t("유튜브 스타일 CC")}</h3>
    <p>{t("인물 이름 색과 자막별 색상·크기·위치·배경을 YTT에 담습니다. 영상에 글자를 굽지 않습니다.")}</p>
    <label>{t("YTT 시간 기준")} <select aria-label={t("YTT 시간 기준")} value={clock} onChange={event => { setClock(event.target.value); setNotice(""); }}>
      <option value="source">{t("원본 영상 시간")}</option>
      <option value="edited">{t("컷 적용한 편집본 시간")}</option>
    </select></label>
    <p>{clock === "source" ? t("원본 영상에 올릴 자막입니다. 제외한 구간도 포함합니다.") : t("이 프로젝트의 컷과 동일하게 편집한 영상에 올릴 자막입니다.")}</p>
    {prepared.issues > 0 && <p role="alert">{t("컷에 걸친 자막 {count}개의 시간을 먼저 확인하세요. 단어 시간 정보가 없거나 맞지 않아 YTT 생성을 막았습니다.", { count: prepared.issues })}</p>}
    {prepared.error && <p role="alert">{t(prepared.error)}</p>}
    {!prepared.project.captions.length && <p>{t("내보낼 자막이 없습니다.")}</p>}
    <button disabled={disabled} onClick={save}>{t("YouTube CC (.ytt) 저장")}</button>
    <p className="muted">{t("YTT는 호환 내보내기입니다. 유튜브·기기별로 글꼴·크기·배경 표시가 달라질 수 있으며 업로드와 재생 결과는 직접 확인하세요. 단어별 가사 효과는 포함하지 않습니다.")}</p>
    {notice && <p role="status">{notice}</p>}
  </section>;
}
