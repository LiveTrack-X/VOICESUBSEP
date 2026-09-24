import { useState } from "react";
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
} from "lucide-react";
import { formatTime, parseTime, type Caption, type Project } from "../domain";

const reasonLabels: Record<string, string> = {
  overlap: "동시 발화",
  unassigned: "화자 미배정",
  speaker_count: "인원 확인",
  timing: "시간 확인",
};
export function CaptionEditor({
  project,
  update,
  seek,
  selected,
  setSelected,
  onImport,
  onSample,
  onError,
  time,
}: {
  project: Project;
  update: (fn: (p: Project) => Project) => void;
  seek: (t: number) => void;
  selected: string | null;
  setSelected: (id: string | null) => void;
  onImport: () => void;
  onSample: () => void;
  onError: (s: string) => void;
  time: number;
}) {
  const [reviewOnly, setReviewOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [speakerFilter, setSpeakerFilter] = useState("all");
  const sorted = [...project.captions].sort(
    (a, b) => a.start - b.start || a.end - b.end,
  );
  const visible = sorted.filter(
    (c) =>
      (!reviewOnly || (!c.reviewed && c.reasons.length > 0)) &&
      (speakerFilter === "all" || (c.speakerId ?? "none") === speakerFilter) &&
      `${c.text} ${project.speakers.find((s) => s.id === c.speakerId)?.name ?? "미배정"}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const current = visible.find((c) => c.id === selected);
  const following = current && sorted[sorted.indexOf(current) + 1];
  const next = following && visible.includes(following) ? following : undefined;
  function edit(id: string, change: Partial<Caption>) {
    update((p) => ({
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
      const t = parseTime(value);
      const start = field === "start" ? t : c.start;
      const end = field === "end" ? t : c.end;
      if (end <= start)
        throw new Error("종료 시간은 시작 시간보다 뒤여야 합니다.");
      if (t !== c[field]) edit(c.id, { [field]: t, words: undefined });
    } catch (error) {
      input.value = formatTime(c[field]);
      onError((error as Error).message);
    }
  }
  function split() {
    if (!current) return;
    const splitAt =
      time > current.start && time < current.end
        ? time
        : (current.start + current.end) / 2;
    const words = current.text.trim().split(/\s+/);
    if (words.length < 2) {
      onError("두 단어 이상인 자막을 선택하세요.");
      return;
    }
    const index = Math.max(
      1,
      Math.min(
        words.length - 1,
        Math.round(
          (words.length * (splitAt - current.start)) /
            (current.end - current.start),
        ),
      ),
    );
    update((p) => ({
      ...p,
      captions: p.captions.flatMap((c) =>
        c.id !== current.id
          ? [c]
          : [
              {
                ...c,
                end: splitAt,
                text: words.slice(0, index).join(" "),
                words: undefined,
              },
              {
                ...c,
                id: crypto.randomUUID(),
                start: splitAt,
                text: words.slice(index).join(" "),
                words: undefined,
              },
            ],
      ),
    }));
  }
  function merge() {
    if (!current || !next || current.speakerId !== next.speakerId) return;
    update((p) => ({
      ...p,
      captions: p.captions
        .filter((c) => c.id !== next.id)
        .map((c) =>
          c.id === current.id
            ? {
                ...c,
                end: Math.max(c.end, next.end),
                text: `${c.text} ${next.text}`,
                words: undefined,
                reasons: [...new Set([...c.reasons, ...next.reasons])],
                reviewed: c.reviewed && next.reviewed,
              }
            : c,
        ),
    }));
  }
  const pending = project.captions.filter(
    (c) => !c.reviewed && c.reasons.length > 0,
  ).length;
  return (
    <section className="caption-editor" aria-label="자막 편집">
      <div className="caption-toolbar">
        <div className="tabs">
          <button
            className={!reviewOnly ? "active" : ""}
            onClick={() => setReviewOnly(false)}
          >
            전체 자막
            {project.captions.length > 0 && (
              <span>{project.captions.length}</span>
            )}
          </button>
          <button
            className={reviewOnly ? "active" : ""}
            onClick={() => setReviewOnly(true)}
          >
            검수 필요{pending > 0 && <span>{pending}</span>}
          </button>
        </div>
        <div className="caption-tools">
          <label className="search">
            <Search size={15} />
            <input
              aria-label="자막 검색"
              placeholder="자막 내용, 이름으로 검색"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <button aria-label="SRT 가져오기" onClick={onImport}>
            <Upload size={15} />
            <span>SRT 가져오기</span>
          </button>
          <button aria-label="샘플 프로젝트" onClick={onSample}>
            <FlaskConical size={15} />
            <span>샘플 프로젝트</span>
          </button>
        </div>
      </div>
      {project.captions.length > 0 && (
        <div className="edit-actions">
          <select
            aria-label="인물 필터"
            value={speakerFilter}
            onChange={(e) => setSpeakerFilter(e.target.value)}
          >
            <option value="all">모든 인물</option>
            <option value="none">미배정</option>
            {project.speakers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <button disabled={!current} onClick={split}>
            <Scissors size={14} />
            나누기
          </button>
          <button
            disabled={!current || !next || current.speakerId !== next.speakerId}
            onClick={merge}
            title="다음 자막과 인물이 같을 때 합칠 수 있습니다"
          >
            <Combine size={14} />
            합치기
          </button>
          <button
            disabled={!current}
            onClick={() => {
              update((p) => ({
                ...p,
                captions: p.captions.filter((c) => c.id !== current?.id),
              }));
              setSelected(null);
            }}
          >
            <Trash2 size={14} />
            삭제
          </button>
          <button
            onClick={() => {
              const id = crypto.randomUUID();
              update((p) => ({
                ...p,
                captions: [
                  ...p.captions,
                  {
                    id,
                    start: time,
                    end: time + 2,
                    text: "새 자막",
                    speakerId: null,
                    reasons: ["unassigned"],
                    reviewed: false,
                  },
                ],
              }));
              setSelected(id);
            }}
          >
            <Plus size={14} />
            자막
          </button>
        </div>
      )}
      <div className="caption-columns">
        <span>시간</span>
        <span>인물</span>
        <span>자막</span>
        <span>검수</span>
      </div>
      <div className="caption-list">
        {visible.length === 0 ? (
          <div className="empty-state">
            <FileText size={42} strokeWidth={1.5} />
            <strong>
              {project.captions.length
                ? "조건에 맞는 자막이 없습니다"
                : "아직 자막이 없습니다"}
            </strong>
            <p>
              {project.captions.length
                ? "필터나 검색어를 바꿔보세요."
                : "영상을 분석하거나, SRT 파일을 가져와 시작하세요."}
            </p>
          </div>
        ) : (
          visible.map((c) => (
            <div
              key={c.id}
              className={`caption-row ${selected === c.id ? "selected" : ""} ${c.start <= time && c.end > time ? "current" : ""}`}
              onClick={() => setSelected(c.id)}
            >
              <div className="caption-times">
                <button
                  className="seek-button"
                  aria-label={`${formatTime(c.start)} 구간 재생`}
                  onClick={() => seek(c.start)}
                >
                  {formatTime(c.start).slice(0, 8)}
                </button>
                <input
                  key={`s${c.start}`}
                  aria-label={`시작 시간 ${c.id}`}
                  defaultValue={formatTime(c.start)}
                  onBlur={(e) => editTime(c, "start", e.target.value, e.target)}
                />
                <input
                  key={`e${c.end}`}
                  aria-label={`종료 시간 ${c.id}`}
                  defaultValue={formatTime(c.end)}
                  onBlur={(e) => editTime(c, "end", e.target.value, e.target)}
                />
              </div>
              <select
                className="caption-speaker"
                aria-label={`화자 ${c.id}`}
                style={{
                  color:
                    project.speakers.find((s) => s.id === c.speakerId)?.color ??
                    "#7c8798",
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
                <option value="">미배정</option>
                {project.speakers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name || "이름 없음"}
                  </option>
                ))}
              </select>
              <div className="caption-content">
                <textarea
                  aria-label={`자막 내용 ${c.id}`}
                  value={c.text}
                  rows={2}
                  maxLength={8000}
                  onChange={(e) =>
                    edit(c.id, { text: e.target.value, words: undefined })
                  }
                />
                {c.reasons.length > 0 && (
                  <div className="review-reasons">
                    {c.reasons.map((r) => (
                      <span key={r}>{reasonLabels[r] ?? r}</span>
                    ))}
                  </div>
                )}
              </div>
              <button
                className={`review-button ${c.reviewed ? "done" : ""}`}
                aria-label={`검수 완료 ${c.id}`}
                aria-pressed={c.reviewed}
                title={c.reviewed ? "검수 완료 취소" : "검수 완료"}
                onClick={() => edit(c.id, { reviewed: !c.reviewed })}
              >
                <Check size={15} />
              </button>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
