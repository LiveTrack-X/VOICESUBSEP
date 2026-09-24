import { AudioLines, Film, Info, Upload } from "lucide-react";
import type { Project } from "../domain";

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
  const visibleSpeakers = project.speakers.filter(
    (s, i) =>
      i < project.speakerCount ||
      project.captions.some((c) => c.speakerId === s.id),
  );
  return (
    <aside className="sidebar">
      <h2>프로젝트</h2>
      <div className="sidebar-section media-section">
        <label>미디어 소스</label>
        <button className="media-drop" onClick={onMedia} disabled={busy}>
          <Film size={28} />
          <strong>
            {project.mediaName ? "영상 다시 연결" : "영상 불러오기"}
          </strong>
          <span>{project.mediaName ?? "영상·음성 파일을 선택하세요"}</span>
          <small>원본 파일은 이 기기에서 처리합니다</small>
        </button>
      </div>
      <div className="sidebar-section">
        <label>
          자막 설정 <Info size={13} />
        </label>
        <div className="segmented">
          <button
            aria-pressed={project.mode === "standard"}
            onClick={() => update((p) => ({ ...p, mode: "standard" }))}
          >
            일반 대화
          </button>
          <button
            aria-pressed={project.mode === "overlap"}
            onClick={() => update((p) => ({ ...p, mode: "overlap" }))}
          >
            동시 발화
          </button>
        </div>
        {project.mode === "overlap" && (
          <p className="setting-hint">
            겹친 대사는 검수 대상으로 표시됩니다. 음원 분리는 후속 기능입니다.
          </p>
        )}
      </div>
      <div className="sidebar-section">
        <label>
          참가자 <Info size={13} />
        </label>
        <div className="speaker-count">
          {[1, 2, 3, 4].map((n) => (
            <button
              key={n}
              aria-label={`참가자 ${n}명`}
              aria-pressed={project.speakerCount === n}
              onClick={() =>
                update((p) => {
                  const speakers = [...p.speakers];
                  const colors = ["#7357ff", "#f6ad38", "#27b9ad", "#3478f6"];
                  while (speakers.length < n)
                    speakers.push({
                      id: crypto.randomUUID(),
                      name: `인물 ${String.fromCharCode(65 + speakers.length)}`,
                      color: colors[speakers.length % 4],
                    });
                  return { ...p, speakerCount: n, speakers };
                })
              }
            >
              {n}
            </button>
          ))}
        </div>
      </div>
      <div className="sidebar-section speaker-names">
        <label>인물 이름</label>
        {visibleSpeakers.map((s, i) => (
          <div className="speaker-name" key={s.id}>
            <span className="speaker-dot" style={{ background: s.color }} />
            <input
              aria-label={`인물 ${i + 1} 이름`}
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
          </div>
        ))}
      </div>
      <button
        className="primary analyze-button"
        disabled={busy || !hasMedia}
        onClick={onAnalyze}
        title={!hasMedia ? "먼저 영상 또는 음성 파일을 연결하세요" : undefined}
      >
        <AudioLines size={19} />
        음성 분석
      </button>
      {!hasMedia && project.mediaName && (
        <p className="setting-hint">
          <Upload size={13} /> 저장된 자막은 유지됩니다. 재생할 원본을 다시
          연결하세요.
        </p>
      )}
    </aside>
  );
}
