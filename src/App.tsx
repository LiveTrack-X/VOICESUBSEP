import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { version } from "../package.json";
import {
  AudioLines,
  FilePlus2,
  FolderOpen,
  Save,
  Download,
  Undo2,
  Redo2,
  CheckCircle2,
  RefreshCw,
  X,
} from "lucide-react";
import {
  demoProject,
  createProject,
  parseProject,
  parseSrt,
  exportSrt,
  exportNotesCsv,
  exportNotesMarkdown,
  safeFilename,
  MAX_PROJECT_BYTES,
  type Project,
} from "./domain";
import { download, type AnalysisResult } from "./api";
import { useProject } from "./useProject";
import { Sidebar } from "./components/Sidebar";
import { MediaPlayer } from "./components/MediaPlayer";
import { CaptionEditor } from "./components/CaptionEditor";
import { NotesPanel } from "./components/NotesPanel";
import { Timeline } from "./components/Timeline";
import { Dialog } from "./components/Dialog";
import { AnalysisDialog } from "./components/AnalysisDialog";
import { UpdateDialog } from "./components/UpdateDialog";

export default function App() {
  const { project, update, replace, undo, redo, canUndo, canRedo, saveState } =
    useProject();
  const [file, setFile] = useState<File | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"export" | "analysis" | "update" | null>(null);
  const [notice, setNotice] = useState("");
  const [confirm, setConfirm] = useState<{
    message: string;
    action: () => void;
  } | null>(null);
  const mediaInput = useRef<HTMLInputElement>(null);
  const projectInput = useRef<HTMLInputElement>(null);
  const srtInput = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const projectRef = useRef(project);
  projectRef.current = project;
  useEffect(() => {
    if (file && file.name !== project.mediaName) {
      setFile(null);
      setPlaying(false);
      setNotice("복원된 프로젝트의 원본 미디어를 다시 연결하세요.");
    }
  }, [project.mediaName, file]);
  useEffect(() => {
    if (!file) {
      setSource(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setSource(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 7000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  });
  function seek(t: number) {
    const end = Math.max(
      project.duration,
      ...project.captions.map((c) => c.end),
      ...project.notes.map((n) => n.end ?? n.start),
    );
    const safe = Math.max(0, Math.min(t, end || t));
    if (videoRef.current && source) videoRef.current.currentTime = safe;
    setTime(safe);
  }
  function save() {
    try {
      flushSync(() => {
        if (document.activeElement instanceof HTMLElement)
          document.activeElement.blur();
      });
      const valid = parseProject(JSON.stringify(projectRef.current));
      download(
        `${safeFilename(valid.name)}.voicesub.json`,
        JSON.stringify(valid, null, 2),
        "application/json",
      );
      setNotice(
        "프로젝트를 저장했습니다. 원본 미디어 파일은 별도로 보관하세요.",
      );
    } catch (e) {
      setNotice(`저장 전 확인: ${(e as Error).message}`);
    }
  }
  async function readSmall(f: File) {
    if (f.size > MAX_PROJECT_BYTES)
      throw new Error("프로젝트·SRT 파일은 8 MiB 이하만 가져올 수 있습니다.");
    return f.text();
  }
  function changeProject(next: Project) {
    replace(next);
    setFile(null);
    setTime(0);
    setSelected(null);
    setPlaying(false);
  }
  function guarded(message: string, action: () => void) {
    if (project.captions.length || project.notes.length)
      setConfirm({ message, action });
    else action();
  }
  function applyAnalysis(result: AnalysisResult) {
    try {
      const next = parseProject(
        JSON.stringify({
          ...project,
          duration: result.duration,
          captions: result.captions,
          speakers: result.speakers.length ? result.speakers : project.speakers,
        }),
      );
      update(next);
      setSelected(null);
      setDialog(null);
      setNotice(
        "분석 결과를 적용했습니다. 목소리를 확인해 인물 이름을 지정하세요.",
      );
    } catch (e) {
      setNotice(`분석 결과를 적용할 수 없습니다: ${(e as Error).message}`);
    }
  }
  function exportText(kind: "srt" | "md" | "csv", speakerId?: string | null) {
    try {
      const base = safeFilename(project.name);
      const person =
        speakerId === undefined
          ? ""
          : `-${safeFilename(project.speakers.find((s) => s.id === speakerId)?.name ?? "미배정")}`;
      if (kind === "srt")
        download(
          `${base}${person}.srt`,
          exportSrt(project, speakerId),
          "application/x-subrip;charset=utf-8",
        );
      if (kind === "md")
        download(
          `${base}-notes.md`,
          exportNotesMarkdown(project),
          "text/markdown;charset=utf-8",
        );
      if (kind === "csv")
        download(
          `${base}-notes.csv`,
          exportNotesCsv(project),
          "text/csv;charset=utf-8",
        );
      setNotice("내보내기 파일을 생성했습니다.");
    } catch (e) {
      setNotice((e as Error).message);
    }
  }
  const reviewCount = project.captions.filter(
    (c) => c.reasons.length && !c.reviewed,
  ).length;
  return (
    <div className="app-shell">
      <header className="app-header">
        <a
          className="brand"
          href="#"
          onClick={(e) => e.preventDefault()}
          aria-label="VOICESUBSEP 홈"
        >
          <AudioLines size={26} />
          <span>VOICESUBSEP</span>
          <span className="version">{version}</span>
        </a>
        <div className="project-title">
          <input
            aria-label="프로젝트 이름"
            maxLength={160}
            value={project.name}
            onChange={(e) => update((p) => ({ ...p, name: e.target.value }))}
            onBlur={() => {
              if (!project.name.trim())
                update((p) => ({ ...p, name: "새 자막 프로젝트" }));
            }}
          />
          <span>인물별 자막 워크스페이스</span>
        </div>
        <div className="header-actions">
          {window.voicesubsepDesktop && (
            <button aria-label="앱 업데이트" title="앱 업데이트" className="icon-button" onClick={() => setDialog("update")}>
              <RefreshCw size={17} />
            </button>
          )}
          <button
            className="icon-button"
            aria-label="실행 취소"
            disabled={!canUndo}
            onClick={undo}
          >
            <Undo2 size={17} />
          </button>
          <button
            className="icon-button"
            aria-label="다시 실행"
            disabled={!canRedo}
            onClick={redo}
          >
            <Redo2 size={17} />
          </button>
          <span className="action-divider" />
          <button
            aria-label="새 프로젝트"
            onClick={() =>
              guarded(
                "새 프로젝트를 시작합니다. 현재 작업은 먼저 파일로 저장해 두세요.",
                () => changeProject(createProject()),
              )
            }
          >
            <FilePlus2 size={16} />
            <span>새로</span>
          </button>
          <button
            aria-label="프로젝트 열기"
            onClick={() => projectInput.current?.click()}
          >
            <FolderOpen size={16} />
            <span>열기</span>
          </button>
          <button aria-label="프로젝트 저장" onClick={save}>
            <Save size={16} />
            <span>저장</span>
          </button>
          <button className="primary" onClick={() => setDialog("export")}>
            <Download size={16} />
            내보내기
          </button>
        </div>
      </header>
      <main className="workspace">
        <Sidebar
          project={project}
          update={update}
          hasMedia={!!file}
          busy={dialog === "analysis"}
          onMedia={() => mediaInput.current?.click()}
          onAnalyze={() => setDialog("analysis")}
        />
        <div className="editor-workspace">
          <div className="editor-upper">
            <div className="editor-center">
              <MediaPlayer
                source={source}
                videoRef={videoRef}
                time={time}
                duration={project.duration}
                setTime={setTime}
                onDuration={(duration) => update((p) => ({ ...p, duration }))}
                onMedia={() => mediaInput.current?.click()}
                playing={playing}
                setPlaying={setPlaying}
                captions={project.captions}
                speakers={project.speakers}
                selected={project.captions.find((c) => c.id === selected)}
              />
              <CaptionEditor
                project={project}
                update={update}
                seek={seek}
                selected={selected}
                setSelected={setSelected}
                onImport={() => srtInput.current?.click()}
                onSample={() =>
                  guarded(
                    "샘플 프로젝트로 전환합니다. 현재 작업은 먼저 파일로 저장해 두세요.",
                    () => changeProject(demoProject()),
                  )
                }
                onError={setNotice}
                time={time}
              />
            </div>
            <NotesPanel
              project={project}
              update={update}
              time={time}
              seek={seek}
              onError={setNotice}
            />
          </div>
          <Timeline
            project={project}
            time={time}
            seek={seek}
            select={setSelected}
          />
        </div>
      </main>
      <footer className="status-bar">
        <span>
          <CheckCircle2 size={13} />
          {saveState}
        </span>
        <span>
          {project.captions.length}개 자막<span className="status-dot">·</span>
          검수 필요 {reviewCount}
          <span className="status-dot">·</span>
          {project.notes.length}개 노트
        </span>
        <span>
          로컬 작업<span className="status-dot">·</span>v{version}
        </span>
      </footer>
      <input
        className="sr-only"
        tabIndex={-1}
        ref={mediaInput}
        type="file"
        accept="video/*,audio/*,.mkv,.mov,.flac,.m4a"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          const action = () => {
            setFile(f);
            setTime(0);
            setPlaying(false);
            update((p) => ({ ...p, mediaName: f.name }));
          };
          if (
            project.mediaName &&
            project.mediaName !== f.name &&
            (project.captions.length || project.notes.length)
          )
            setConfirm({
              message:
                "다른 미디어를 연결합니다. 기존 자막과 노트의 시간은 유지되므로 파일이 같은 원본인지 확인하세요.",
              action,
            });
          else action();
        }}
      />
      <input
        className="sr-only"
        tabIndex={-1}
        ref={projectInput}
        type="file"
        accept=".json"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          try {
            const p = parseProject(await readSmall(f));
            guarded(
              "저장한 프로젝트를 엽니다. 현재 작업은 먼저 파일로 저장해 두세요.",
              () => changeProject(p),
            );
          } catch (error) {
            setNotice((error as Error).message);
          }
        }}
      />
      <input
        className="sr-only"
        tabIndex={-1}
        ref={srtInput}
        type="file"
        accept=".srt"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          try {
            const captions = parseSrt(await readSmall(f));
            const action = () => {
              update((p) => ({
                ...p,
                captions,
                duration: Math.max(p.duration, ...captions.map((c) => c.end)),
              }));
              setSelected(null);
              setNotice("SRT를 가져왔습니다. 화자를 직접 지정하세요.");
            };
            if (project.captions.length)
              setConfirm({
                message:
                  "SRT의 자막으로 현재 자막을 교체합니다. 노트는 유지됩니다.",
                action,
              });
            else action();
          } catch (error) {
            setNotice((error as Error).message);
          }
        }}
      />
      {notice && (
        <div className="toast" role="status">
          {notice}
          <button aria-label="알림 닫기" onClick={() => setNotice("")}>
            <X size={16} />
          </button>
        </div>
      )}
      {confirm && (
        <Dialog title="작업 전환" onClose={() => setConfirm(null)}>
          <p>{confirm.message}</p>
          <div className="dialog-actions">
            <button onClick={() => setConfirm(null)}>취소</button>
            <button onClick={save}>현재 프로젝트 저장</button>
            <button
              className="primary"
              onClick={() => {
                confirm.action();
                setConfirm(null);
              }}
            >
              계속
            </button>
          </div>
        </Dialog>
      )}
      {dialog === "analysis" && file && (
        <AnalysisDialog
          file={file}
          project={project}
          onClose={() => setDialog(null)}
          onApply={applyAnalysis}
        />
      )}
      {dialog === "export" && (
        <Dialog title="자막과 노트 내보내기" onClose={() => setDialog(null)}>
          <p className="dialog-intro">
            편집기에 맞는 형식을 선택하세요. 모든 시간은 원본 기준입니다.
          </p>
          <div className="export-section">
            <h3>자막</h3>
            <button
              disabled={!project.captions.length}
              onClick={() => exportText("srt")}
            >
              <Download size={16} />
              통합 SRT
            </button>
            <p>동시에 말한 대사는 같은 시간 구간에 여러 줄로 출력합니다.</p>
            <div className="export-speakers">
              {project.speakers
                .filter((s) =>
                  project.captions.some((c) => c.speakerId === s.id),
                )
                .map((s) => (
                  <button key={s.id} onClick={() => exportText("srt", s.id)}>
                    <span
                      className="speaker-dot"
                      style={{ background: s.color }}
                    />
                    {s.name} SRT
                  </button>
                ))}
              {project.captions.some((c) => !c.speakerId) && (
                <button onClick={() => exportText("srt", null)}>
                  미배정 SRT
                </button>
              )}
            </div>
            <p>
              인물별 파일은 각각 가져와 트랙에 배치하세요. 색상과 위치는
              편집기에서 지정합니다.
            </p>
          </div>
          <div className="export-section">
            <h3>편집 노트</h3>
            <button
              disabled={!project.notes.length}
              onClick={() => exportText("md")}
            >
              Markdown
            </button>
            <button
              disabled={!project.notes.length}
              onClick={() => exportText("csv")}
            >
              CSV
            </button>
            <p>시간코드, 분류, 내용, 완료 상태를 포함합니다.</p>
          </div>
          <div className="dialog-actions">
            <button onClick={save}>
              <Save size={16} />
              프로젝트 JSON 저장
            </button>
            <button onClick={() => setDialog(null)}>닫기</button>
          </div>
        </Dialog>
      )}
      {dialog === "update" && <UpdateDialog onClose={() => setDialog(null)} />}
    </div>
  );
}
