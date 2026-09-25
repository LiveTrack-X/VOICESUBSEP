import { useI18n, LOCALES, localeNames, type Locale } from "../i18n";
import { useState } from "react";
import { createPortal } from "react-dom";
import { AudioLines, Film, Info, Upload, Palette, ChevronDown, ChevronUp } from "lucide-react";
import { DEFAULT_CAPTION_STYLE, type Project } from "../domain";
import { CaptionStyleDialog } from "./CaptionStyleDialog";
import { Dialog } from "./Dialog";
import { assignAllCaptionsToSpeaker, editableSpeakers } from "../speakerOperations";

export function Sidebar({
  project,
  update,
  onMedia,
  onAnalyze,
  busy,
  hasMedia,
}: {
  project: Project;
  update: (fn: (p: Project) => Project) => void;
  onMedia: () => void;
  onAnalyze: () => void;
  busy: boolean;
  hasMedia: boolean;
}) {
  const { t, locale, setLocale } = useI18n();
  const [styleSpeakerId, setStyleSpeakerId] = useState<string | null>(null);
  const [settingsExpanded, setSettingsExpanded] = useState(false);
  const [mergeTarget, setMergeTarget] = useState<string | null>(null);
  const styleSpeaker = project.speakers.find((s) => s.id === styleSpeakerId);
  const visibleSpeakers = editableSpeakers(project);
  const mergeSpeaker = visibleSpeakers.find(speaker => speaker.id === mergeTarget);
  const assignedSpeakerCount = new Set(project.captions.map(c=>c.speakerId).filter(id=>id!==null)).size;
  const unassignedCount = project.captions.filter(caption => caption.speakerId === null).length;
  return (
    <aside className={`sidebar${settingsExpanded ? " sidebar-expanded" : ""}`}>
      <button className="sidebar-compact-toggle" aria-expanded={settingsExpanded} onClick={() => setSettingsExpanded(value => !value)}>
        {settingsExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}{t("프로젝트 설정·인물")}
      </button>
      <h2>{t('프로젝트')}</h2>
      <div className="sidebar-section"><label htmlFor="ui-language">{t("앱 화면 언어")}</label><select id="ui-language" aria-label={t("앱 화면 언어")} value={locale} onChange={(e) => setLocale(e.target.value as Locale)}>{LOCALES.map((code) => <option key={code} value={code}>{localeNames[code]}</option>)}</select><p className="setting-hint">{t("음성 인식 언어와 별도로 설정합니다.")}</p></div>
      <div className="sidebar-section media-section">
        <label>{t('미디어 소스')}</label>
        <button className="media-drop" onClick={onMedia} disabled={busy}>
          <Film size={28} />
          <strong>
            {hasMedia ? t("연결된 미디어") : project.mediaName ? t("원본 미디어 다시 연결") : t("미디어 불러오기")}
          </strong>
          <span>{project.mediaName ?? t("영상·음성 파일을 선택하세요")}</span>
          <small>{t(hasMedia ? "분석 방식은 음성 분석 창에서 선택합니다" : project.mediaName ? "저장된 자막은 유지되며, 원본 파일 연결이 필요합니다." : "분석 방식은 음성 분석 창에서 선택합니다")}</small>
        </button>
      </div>
      <div className="sidebar-section">
        <label>{t('자막 설정')}<Info size={13} />
        </label>
        <div className="segmented">
          <button
            aria-pressed={project.mode === "standard"}
            onClick={() => update((p) => ({ ...p, mode: "standard" }))}
          >{t('일반 대화')}</button>
          <button
            aria-pressed={project.mode === "overlap"}
            onClick={() => update((p) => ({ ...p, mode: "overlap" }))}
          >{t('동시 발화')}</button>
        </div>
        {project.mode === "overlap" && (
          <p className="setting-hint">{t('겹친 대사는 검수 대상으로 표시됩니다. 음원 분리는 후속 기능입니다.')}</p>
        )}
      </div>
      <div className="sidebar-section">
        <label>{t('다음 분석 예상 인원')}<Info size={13} />
        </label>
        <div className="speaker-count">
          {[1, 2, 3, 4].map((n) => (
            <button
              key={n}
              aria-label={n === 4 ? t("참가자 4명 이상") : t("참가자 {count}명", { count: n })}
              aria-pressed={project.speakerCount === n}
              onClick={() =>
                update((p) => {
                  const speakers = [...p.speakers];
                  const colors = ["#7357ff", "#f6ad38", "#27b9ad", "#3478f6"];
                  while (speakers.length < n)
                    speakers.push({
                      id: crypto.randomUUID(),
                      name: t("인물 {name}", { name: String.fromCharCode(65 + speakers.length) }),
                      color: colors[speakers.length % 4],
                    });
                  return { ...p, speakerCount: n, speakers };
                })
              }
            >
              {n === 4 ? t("4명 이상") : n}
            </button>
          ))}
        </div>
        <p className="setting-hint">{assignedSpeakerCount > 0
          ? t("현재 자막 인물 {count}명 · 예상 인원은 다음 분석의 검수 기준이며, 인물을 강제로 합치지 않습니다.", { count: assignedSpeakerCount })
          : t("예상 인원은 다음 분석의 검수 기준이며, 감지된 인물을 강제로 합치지 않습니다.")}</p>
      </div>
      <div className="sidebar-section speaker-names">
        <label>{project.captions.length > 0 ? t("현재 자막 인물 · {count}명", { count: assignedSpeakerCount }) : t("분석 전 인물 이름 · 색상")}</label>
        <p className="setting-hint">{t('색상과 자막 스타일을 인물별로 정하세요.')}</p>
        {unassignedCount > 0 && <p className="setting-hint">{t("미배정 자막 {count}개", { count: unassignedCount })}</p>}
        {visibleSpeakers.map((s, i) => (
          <div className="speaker-name" key={s.id}>
            <input
              className="speaker-color"
              type="color"
              aria-label={t("인물 {number} 색상", { number: i + 1 })}
              title={t("{name} 색상 변경", { name: s.name || t("인물 {name}", { name: i + 1 }) })}
              value={s.color}
              onChange={(e) => {
                const color = e.target.value;
                update((p) => ({
                  ...p,
                  speakers: p.speakers.map((x) =>
                    x.id === s.id ? { ...x, color } : x,
                  ),
                }));
              }}
            />
            <input
              type="text"
              aria-label={t("인물 {number} 이름", { number: i + 1 })}
              value={s.name}
              maxLength={80}
              onChange={(e) =>
                update((p) => ({
                  ...p,
                  speakers: p.speakers.map((x) =>
                    x.id === s.id ? { ...x, name: e.target.value } : x,
                  ),
                }))
              }
            />
            <button
              className="speaker-style-button"
              aria-label={t("인물 {number} 자막 스타일", { number: i + 1 })}
              title={t("{name} 자막 스타일", { name: s.name || t("인물 {name}", { name: i + 1 }) })}
              onClick={() => setStyleSpeakerId(s.id)}
            >
              <Palette size={16} />
            </button>
          </div>
        ))}
        {project.speakerCount === 1 && assignedSpeakerCount > 1 && (
          <button className="merge-speakers-button" disabled={busy} onClick={() => setMergeTarget(visibleSpeakers[0]?.id ?? null)}>
            {t("현재 자막을 1명으로 합치기")}
          </button>
        )}
      </div>
      <button
        className="primary analyze-button"
        disabled={busy}
        onClick={onAnalyze}
        title={!hasMedia ? t("먼저 영상 또는 음성 파일을 연결하세요") : undefined}
      >
        <AudioLines size={19} />{t(hasMedia ? "음성 분석" : "원본 연결 후 분석")}</button>
      <p className="setting-hint">{t("기본: Whisper 음성 인식 + Nemotron 화자 구분 · 로컬 실행")}</p>
      {!hasMedia && project.mediaName && (
        <p className="setting-hint">
          <Upload size={13} />{t('저장된 자막은 유지됩니다. 재생할 원본을 다시 연결하세요.')}</p>
      )}
      {styleSpeaker && createPortal(
        <CaptionStyleDialog
          key={`${project.id}-${styleSpeaker.id}`}
          title={t("{name} · 기본 자막 스타일", { name: styleSpeaker.name || t("인물") })}
          description={t("이 인물의 자막에 적용됩니다. 자막 한 개에 별도로 지정한 항목은 유지됩니다.")}
          value={styleSpeaker.subtitleStyle}
          inherited={DEFAULT_CAPTION_STYLE}
          name={styleSpeaker.name}
          nameColor={styleSpeaker.color}
          text={project.captions.find((c) => c.speakerId === styleSpeaker.id)?.text ?? t("이 인물의 자막은 이렇게 표시됩니다.")}
          resetLabel={t("기본값으로 되돌리기")}
          onApply={(subtitleStyle) => update((p) => ({
            ...p,
            speakers: p.speakers.map((s) => s.id === styleSpeaker.id
              ? { ...s, subtitleStyle }
              : s),
          }))}
          onClose={() => setStyleSpeakerId(null)}
        />, document.body,
      )}
      {mergeTarget !== null && createPortal(
        <Dialog title={t("현재 자막을 1명으로 합치기")} onClose={() => setMergeTarget(null)}>
          <p>{t("미배정을 포함한 자막 {count}개를 선택한 인물로 배정합니다. 텍스트·시간·노트는 유지되며 실행 취소로 되돌릴 수 있습니다.", { count: project.captions.length })}</p>
          <label className="speaker-merge-target">{t("합칠 인물")}
            <select value={mergeTarget} onChange={event => setMergeTarget(event.target.value)}>
              {visibleSpeakers.map(speaker => <option key={speaker.id} value={speaker.id}>{speaker.name || t("인물")}</option>)}
            </select>
          </label>
          <p className="setting-hint">{t("인물 기본 스타일은 선택한 인물을 따르고, 자막 개별 스타일은 유지됩니다.")}</p>
          <div className="dialog-actions">
            <button onClick={() => setMergeTarget(null)}>{t("취소")}</button>
            <button className="primary speaker-merge-confirm" disabled={busy || !mergeSpeaker} onClick={() => {
              if (!mergeSpeaker) return;
              const target = mergeSpeaker.id;
              update(previous => assignAllCaptionsToSpeaker(previous, target));
              setMergeTarget(null);
            }}>{t("{name}으로 {count}개 배정", { name: mergeSpeaker?.name || t("인물"), count: project.captions.length })}</button>
          </div>
        </Dialog>, document.body,
      )}
    </aside>
  );
}
