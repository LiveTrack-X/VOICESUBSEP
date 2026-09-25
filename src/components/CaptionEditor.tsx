import { useI18n } from "../i18n";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  FileText,
  Search,
  Upload,
  FlaskConical,
  Scissors,
  Combine,
  Trash2,
  Plus,
  Palette,
  Play,
  Rows3,
} from "lucide-react";
import { formatTime, parseTime, resolveCaptionStyle, type Caption, type Project } from "../domain";
import { readableSpeakerColor } from "../speakerColor";
import { THEME_PALETTES, useTheme } from "../theme";
import { CaptionStyleDialog } from "./CaptionStyleDialog";
import { addCaption, splitCaption, mergeCaptions, bulkEditCaptions, replaceCaptionText,
  replacementCount, nextCaptionToReview, MAX_CAPTION_TEXT,
  type BulkCaptionAction } from "../editorOperations";
import { useCaptionVirtualList } from "../useCaptionVirtualList";
import { selectableSpeakers } from "../speakerOperations";
import "./caption-editor-density.css";
import "./caption-virtual-list.css";

const DENSITY_STORAGE_KEY = "voicesubsep-caption-density-v1";
type CaptionDensity = "compact" | "comfortable";

function loadCaptionDensity(): CaptionDensity {
  try {
    return localStorage.getItem(DENSITY_STORAGE_KEY) === "comfortable"
      ? "comfortable"
      : "compact";
  } catch {
    return "compact";
  }
}

const reasonLabels: Record<string, string> = {
  overlap: "동시 발화",
  unassigned: "화자 미배정",
  speaker_count: "인원 확인",
  timing: "시간 확인",
  speaker_boundary: "경계 보정",
};
export function CaptionEditor({
  project,
  update,
  preview,
  reveal,
  selected,
  setSelected,
  onImport,
  onSample,
  onError,
  time,
}: {
  project: Project;
  update: (fn: (p: Project) => Project) => void;
  preview: (time: number, captionId?: string) => void;
  reveal: { id: string } | null;
  selected: string | null;
  setSelected: (id: string | null) => void;
  onImport: () => void;
  onSample: () => void;
  onError: (s: string) => void;
  time: number;
}) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const [reviewOnly, setReviewOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [speakerFilter, setSpeakerFilter] = useState("all");
  const [styleCaptionId, setStyleCaptionId] = useState<string | null>(null);
  const [density, setDensity] = useState<CaptionDensity>(loadCaptionDensity);
  const [focusedCaptionId, setFocusedCaptionId] = useState<string|null>(null);
  const [checked, setChecked] = useState<Set<string>>(() => new Set());
  const [rowReveal, setRowReveal] = useState(reveal);
  const [bulkSpeaker, setBulkSpeaker] = useState("");
  const [find, setFind] = useState("");
  const [replacement, setReplacement] = useState("");
  const [replaceScope, setReplaceScope] = useState<"selected" | "filtered">("selected");
  const [bulkNotice, setBulkNotice] = useState("");
  const styleCaption = project.captions.find((c) => c.id === styleCaptionId);
  const styleSpeaker = project.speakers.find((s) => s.id === styleCaption?.speakerId);
  const revealed = useRef<typeof reveal>(null);
  const speakerOptions = useMemo(()=>selectableSpeakers(project),[project.speakers,project.speakerCount,project.captions]);
  const speakerById = useMemo(() => new Map(project.speakers.map((speaker) => [speaker.id, speaker])), [project.speakers]);
  const sorted = useMemo(() => [...project.captions].sort((a, b) => a.start - b.start || a.end - b.end), [project.captions]);
  const visible = useMemo(() => sorted.filter((caption) => caption.id===focusedCaptionId || (
    (!reviewOnly || (!caption.reviewed && caption.reasons.length > 0)) &&
    (speakerFilter === "all" || (caption.speakerId ?? "none") === speakerFilter) &&
    `${caption.text} ${speakerById.get(caption.speakerId ?? "")?.name ?? t("미배정")}`.toLowerCase().includes(search.toLowerCase())
  )), [sorted, reviewOnly, speakerFilter, search, speakerById, t, focusedCaptionId]);
  const visibleIds = useMemo(()=>visible.map(caption=>caption.id),[visible]);
  const virtual = useCaptionVirtualList(visibleIds,project.id,density,focusedCaptionId,setFocusedCaptionId);
  const {listRef,rows}=virtual;
  const checkedIds = useMemo(() => new Set(visible.filter((caption) => checked.has(caption.id)).map((caption) => caption.id)), [visible, checked]);
  const replaceIds = replaceScope === "selected" ? checkedIds : new Set(visible.map((caption) => caption.id));
  const replaceCount = replacementCount(visible, replaceIds, find);
  function resetFilterView() { virtual.reset(); setFocusedCaptionId(null); setChecked(new Set()); setRowReveal(null); setBulkNotice(""); }
  function run(change: (project: Project) => Project) {
    try { update(change); return true; }
    catch (error) { onError(t((error as Error).message)); return false; }
  }
  function bulk(action: BulkCaptionAction) {
    if (!checkedIds.size) return;
    if (run((previous) => bulkEditCaptions(previous, checkedIds, action))) {
      setBulkNotice(t("{count}개 자막에 적용했습니다. 실행 취소로 되돌릴 수 있습니다.", { count: checkedIds.size }));
      if (action.kind === "delete") { setChecked(new Set()); setSelected(null); }
    }
  }
  function navigate(kind: "review" | "unassigned") {
    const caption = nextCaptionToReview(visible, selected, kind);
    if (!caption) { setBulkNotice(t("현재 필터에서 이동할 자막이 없습니다.")); return; }
    setSelected(caption.id); setRowReveal({ id: caption.id });
  }
  function toggleDensity() {
    const next = density === "compact" ? "comfortable" : "compact";
    setDensity(next);
    try {
      localStorage.setItem(DENSITY_STORAGE_KEY, next);
    } catch {
      // The current view still works when device storage is unavailable.
    }
  }
  useLayoutEffect(() => { setRowReveal(reveal); }, [reveal]);
  useLayoutEffect(() => {
    // A once-used extra identity can disappear from the available choices after
    // reassignment. Do not leave a hidden filter or bulk target selected.
    if(speakerFilter!=="all"&&speakerFilter!=="none"&&!speakerOptions.some(speaker=>speaker.id===speakerFilter)) {
      setSpeakerFilter("all");resetFilterView();
    }
    if(bulkSpeaker&&!speakerOptions.some(speaker=>speaker.id===bulkSpeaker))setBulkSpeaker("");
  },[speakerOptions,speakerFilter,bulkSpeaker]);
  useLayoutEffect(() => {
    if (!rowReveal || revealed.current === rowReveal) return;
    const row = rows.current.get(rowReveal.id);
    const list = listRef.current;
    if (!project.captions.some((c) => c.id === rowReveal.id)) {
      revealed.current = rowReveal;
      return;
    }
    const index = visible.findIndex((caption) => caption.id === rowReveal.id);
    if (index < 0) {
      setReviewOnly(false);
      setSearch("");
      setSpeakerFilter("all");
      setChecked(new Set());
      return;
    }
    if (!row) {
      virtual.revealIndex(index);
      return;
    }
    if (list && row) {
      // Scroll only the caption list, keeping the player and timeline in place.
      const offset = row.getBoundingClientRect().top - list.getBoundingClientRect().top;
      list.scrollTop += offset - Math.max(0, (list.clientHeight - row.clientHeight) / 2);
    }
    revealed.current = rowReveal;
  }, [rowReveal, visible, virtual.layout, virtual.indexes.join(","), project.captions]);
  const current = visible.find((c) => c.id === selected);
  const following = current && sorted[sorted.indexOf(current) + 1];
  const next = following && visible.includes(following) ? following : undefined;
  function edit(id: string, change: Partial<Caption>) {
    run((p) => ({
      ...p,
      captions: p.captions.map((c) => (c.id === id ? { ...c, ...change } : c)),
    }));
  }
  function editTime(
    c: Caption,
    field: "start" | "end",
    value: string,
    input: HTMLInputElement,
  ) {
    try {
      const parsed = parseTime(value);
      const start = field === "start" ? parsed : c.start;
      const end = field === "end" ? parsed : c.end;
      if (end <= start)
        throw new Error(t("종료 시간은 시작 시간보다 뒤여야 합니다."));
      if (project.mediaName && project.duration > 0 && end > project.duration)
        throw new Error(t("자막 시간은 연결된 미디어 길이 안에 있어야 합니다."));
      if (parsed !== c[field]) { edit(c.id, { [field]: parsed, words: undefined }); setRowReveal({ id: c.id }); }
    } catch (error) {
      input.value = formatTime(c[field]);
      onError(t((error as Error).message));
    }
  }
  function split() {
    if (!current) return;
    run((previous) => splitCaption(previous, current.id, time));
  }
  function merge() {
    if (!current || !next || current.speakerId !== next.speakerId) return;
    run((previous) => mergeCaptions(previous, current.id, next.id));
  }
  const pending = project.captions.filter(
    (c) => !c.reviewed && c.reasons.length > 0,
  ).length;
  return (
    <section className={`caption-editor caption-density-${density}`} aria-label={t("자막 편집")}>
      <div className="caption-toolbar">
        <div className="tabs">
          <button
            className={!reviewOnly ? "active" : ""}
            onClick={() => { setReviewOnly(false); resetFilterView(); }}
          >{t('전체 자막')}{project.captions.length > 0 && (
              <span>{project.captions.length}</span>
            )}
          </button>
          <button
            className={reviewOnly ? "active" : ""}
            onClick={() => { setReviewOnly(true); resetFilterView(); }}
          >{t('검수 필요')}{pending > 0 && <span>{pending}</span>}
          </button>
        </div>
        <div className="caption-tools">
          <button
            className="caption-density-toggle"
            aria-label={t("자막 간격 촘촘하게")}
            aria-pressed={density === "compact"}
            title={density === "compact" ? t("자막 간격을 넓게 보기") : t("자막 간격을 촘촘하게 보기")}
            onClick={toggleDensity}
          >
            <Rows3 size={15} />
            <span>{t("촘촘하게")}</span>
          </button>
          <label className="search">
            <Search size={15} />
            <input
              aria-label={t("자막 검색")}
              placeholder={t("자막 내용, 이름으로 검색")}
              value={search}
              onChange={(e) => { setSearch(e.target.value); resetFilterView(); }}
            />
          </label>
          <button aria-label={t("SRT 가져오기")} onClick={onImport}>
            <Upload size={15} />
            <span>{t('SRT 가져오기')}</span>
          </button>
          <button aria-label={t("샘플 프로젝트")} onClick={onSample}>
            <FlaskConical size={15} />
            <span>{t('샘플 프로젝트')}</span>
          </button>
        </div>
      </div>
        <div className="edit-actions">
          <select
            aria-label={t("인물 필터")}
            value={speakerFilter}
            onChange={(e) => { setSpeakerFilter(e.target.value); resetFilterView(); }}
          >
            <option value="all">{t('모든 인물')}</option>
            <option value="none">{t('미배정')}</option>
            {speakerOptions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <button disabled={!current} onClick={split}>
            <Scissors size={14} />{t('나누기')}</button>
          <button
            disabled={!current}
            onClick={() => current && setStyleCaptionId(current.id)}
            title={t("선택한 자막 한 개의 스타일")}
          >
            <Palette size={14} />{t('자막 스타일')}</button>
          <button
            disabled={!current || !next || current.speakerId !== next.speakerId}
            onClick={merge}
            title={t("다음 자막과 인물이 같을 때 합칩니다. 선택한 자막의 스타일을 유지합니다.")}
          >
            <Combine size={14} />{t('합치기')}</button>
          <button
            disabled={!current}
            onClick={() => {
              run((p) => ({
                ...p,
                captions: p.captions.filter((c) => c.id !== current?.id),
              }));
              setSelected(null);
            }}
          >
            <Trash2 size={14} />{t('삭제')}</button>
          <button
            onClick={() => {
              const id = crypto.randomUUID();
              if (run((previous) => addCaption(previous, time, t("새 자막"), id))) {
                setSelected(id); setRowReveal({ id });
              }
            }}
          >
            <Plus size={14} />{t('자막')}</button>
        </div>
      <div className="caption-navigation">
        <button onClick={() => navigate("review")} disabled={!visible.length}>{t("다음 검수 필요")}</button>
        <button onClick={() => navigate("unassigned")} disabled={!visible.length}>{t("다음 미배정")}</button>
        <span>{t("필터 결과 {count}개", { count: visible.length })}</span>
      </div>
      <details className="caption-bulk-tools">
        <summary>{t("여러 자막 편집 · 찾기/바꾸기")}{checkedIds.size > 0 && ` · ${t("선택 {count}개", { count: checkedIds.size })}`}</summary>
        <div className="caption-bulk-actions">
          <button onClick={() => setChecked(new Set(visible.map((caption) => caption.id)))} disabled={!visible.length}>{t("필터 결과 모두 선택")}</button>
          <button onClick={() => setChecked(new Set())} disabled={!checkedIds.size}>{t("선택 해제")}</button>
          <label>{t("일괄 인물")}<select aria-label={t("일괄 인물")} value={bulkSpeaker} onChange={(event) => setBulkSpeaker(event.target.value)}>
            <option value="">{t("미배정")}</option>{speakerOptions.map((speaker) => <option value={speaker.id} key={speaker.id}>{speaker.name}</option>)}
          </select></label>
          <button disabled={!checkedIds.size} onClick={() => bulk({ kind: "speaker", speakerId: bulkSpeaker || null })}>{t("인물 적용")}</button>
          <button disabled={!checkedIds.size} onClick={() => bulk({ kind: "review", reviewed: true })}>{t("선택 검수 완료")}</button>
          <button disabled={!checkedIds.size} onClick={() => bulk({ kind: "review", reviewed: false })}>{t("선택 검수 취소")}</button>
          <button disabled={!checkedIds.size} onClick={() => bulk({ kind: "delete" })}>{t("선택 자막 삭제")}</button>
        </div>
        <div className="caption-replace-controls">
          <label>{t("찾을 내용")}<input aria-label={t("찾을 내용")} value={find} maxLength={MAX_CAPTION_TEXT} onChange={(event) => setFind(event.target.value)} /></label>
          <label>{t("바꿀 내용")}<input aria-label={t("바꿀 내용")} value={replacement} maxLength={MAX_CAPTION_TEXT} onChange={(event) => setReplacement(event.target.value)} /></label>
          <label>{t("바꾸기 범위")}<select aria-label={t("바꾸기 범위")} value={replaceScope} onChange={(event) => setReplaceScope(event.target.value as typeof replaceScope)}>
            <option value="selected">{t("선택한 자막")}</option><option value="filtered">{t("현재 필터 결과")}</option>
          </select></label>
          <button disabled={!find || replaceCount === 0} onClick={() => {
            if (run((previous) => replaceCaptionText(previous, replaceIds, find, replacement)))
              setBulkNotice(t("{count}개 자막에 적용했습니다. 실행 취소로 되돌릴 수 있습니다.", { count: replaceCount }));
          }}>{t("{count}개 자막 바꾸기", { count: replaceCount })}</button>
        </div>
        <p className="muted">{t("대소문자를 구분해 입력한 글자 그대로 바꿉니다. 필터를 바꾸면 선택을 해제합니다.")}</p>
      </details>
      {bulkNotice && <p className="caption-bulk-notice" role="status">{bulkNotice}</p>}
      <div className="caption-columns">
        <span>{t('시간')}</span>
        <span>{t('인물')}</span>
        <span>{t('자막')}</span>
        <span>{t('검수')}</span>
      </div>
      <div className="caption-list" ref={listRef} onFocusCapture={virtual.onFocusCapture} onBlurCapture={virtual.onBlurCapture}>
        {visible.length === 0 ? (
          <div className="empty-state">
            <FileText size={42} strokeWidth={1.5} />
            <strong>
              {project.captions.length
                ? t("조건에 맞는 자막이 없습니다")
                : t("아직 자막이 없습니다")}
            </strong>
            <p>
              {project.captions.length
                ? t("필터나 검색어를 바꿔보세요.")
                : t("자막을 직접 추가하거나, 미디어 분석·SRT 가져오기로 시작하세요.")}
            </p>
          </div>
        ) : (
          <div className="caption-virtual-space" style={{height:virtual.layout.total}} role="list" aria-label={t("자막 편집")}>
          {virtual.indexes.map((index) => {const c=visible[index]!;return (
            <div
              key={c.id}
              ref={virtual.rowRef(c.id)}
              data-caption-id={c.id}
              role="listitem" aria-posinset={index+1} aria-setsize={visible.length}
              style={{transform:`translateY(${virtual.layout.offsets[index]}px)`}}
              className={`caption-row ${selected === c.id ? "selected" : ""} ${c.start <= time && c.end > time ? "current" : ""}`}
              onClick={() => setSelected(c.id)}
            >
              <div className="caption-times">
                <button
                  className="seek-button"
                  aria-label={t("{time} 구간 재생", { time: formatTime(c.start) })}
                  onClick={(e) => {
                    e.stopPropagation();
                    preview(c.start, c.id);
                  }}
                >
                  <Play size={13} className="caption-seek-icon" aria-hidden="true" />
                  <span className="caption-seek-time">{formatTime(c.start).slice(0, 8)}</span>
                </button>
                <input
                  key={`s${c.start}`}
                  aria-label={t("시작 시간 {id}", { id: c.id })}
                  defaultValue={formatTime(c.start)}
                  onBlur={(e) => editTime(c, "start", e.target.value, e.target)}
                />
                <input
                  key={`e${c.end}`}
                  aria-label={t("종료 시간 {id}", { id: c.id })}
                  defaultValue={formatTime(c.end)}
                  onBlur={(e) => editTime(c, "end", e.target.value, e.target)}
                />
              </div>
              <select
                className="caption-speaker"
                aria-label={t("화자 {id}", { id: c.id })}
                style={{
                  color: readableSpeakerColor(speakerById.get(c.speakerId ?? "")?.color,THEME_PALETTES[theme].surface),
                  backgroundColor: "var(--surface)",
                }}
                value={c.speakerId ?? ""}
                onChange={(e) =>
                  edit(c.id, {
                    speakerId: e.target.value || null,
                    reasons: e.target.value
                      ? c.reasons.filter((r) => r !== "unassigned")
                      : [...new Set([...c.reasons, "unassigned" as const])],
                  })
                }
              >
                <option value="">{t('미배정')}</option>
                {speakerOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name || t("이름 없음")}
                  </option>
                ))}
              </select>
              <div className="caption-content">
                {c.style && Object.keys(c.style).length > 0 && (
                  <span className="caption-style-marker">{t('개별 스타일')}</span>
                )}
                <textarea
                  aria-label={t("자막 내용 {id}", { id: c.id })}
                  value={c.text}
                  rows={density === "compact" ? 1 : 2}
                  maxLength={MAX_CAPTION_TEXT}
                  onChange={(e) =>
                    edit(c.id, { text: e.target.value, words: undefined })
                  }
                />
                {c.reasons.length > 0 && (
                  <div className="review-reasons">
                    {c.reasons.map((r) => (
                      <span key={r}>{t(reasonLabels[r] ?? r)}</span>
                    ))}
                  </div>
                )}
              </div>
              <div className="caption-review-controls">
                <input type="checkbox" aria-label={t("자막 선택 {id}", { id: c.id })} checked={checkedIds.has(c.id)}
                  onClick={(event) => event.stopPropagation()} onChange={(event) => {
                    setChecked((previous) => { const next = new Set(previous); if (event.target.checked) next.add(c.id); else next.delete(c.id); return next; });
                  }} />
              <button
                className={`review-button ${c.reviewed ? "done" : ""}`}
                aria-label={t("검수 완료 {id}", { id: c.id })}
                aria-pressed={c.reviewed}
                title={c.reviewed ? t("검수 완료 취소") : t("검수 완료")}
                onClick={() => edit(c.id, { reviewed: !c.reviewed })}
              >
                <Check size={15} />
              </button>
              </div>
            </div>
          );})}
          </div>
        )}
      </div>
      {styleCaption && (
        <CaptionStyleDialog
          key={`${project.id}-${styleCaption.id}`}
          title={t("선택 자막 스타일")}
          description={t("이 자막 한 개에만 적용됩니다. 별도로 바꾸지 않은 항목은 인물의 기본 스타일을 따릅니다.")}
          value={styleCaption.style}
          inherited={resolveCaptionStyle(undefined, styleSpeaker)}
          name={styleSpeaker?.name ?? t("미배정")}
          nameColor={styleSpeaker?.color ?? "#ffffff"}
          text={styleCaption.text}
          resetLabel={t("인물 스타일로 되돌리기")}
          onApply={(style) => edit(styleCaption.id, { style })}
          onClose={() => setStyleCaptionId(null)}
        />
      )}
    </section>
  );
}
