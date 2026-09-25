import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { version } from "../package.json";
import {
  FilePlus2,
  FolderOpen,
  Save,
  Download,
  Undo2,
  Redo2,
  CheckCircle2,
  RefreshCw,
  Settings2,
  History,
  ArchiveRestore,
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
  type SubtitleLanguage,
} from "./domain";
import { download, type AnalysisResult } from "./api";
import { useProject } from "./useProject";
import { Sidebar } from "./components/Sidebar";
import { MediaPlayer, type MediaPlayerHandle } from "./components/MediaPlayer";
import { CaptionEditor } from "./components/CaptionEditor";
import { NotesPanel } from "./components/NotesPanel";
import { Timeline } from "./components/Timeline";
import { EditorWorkspace } from "./components/EditorWorkspace";
import { WorkspaceModeSwitcher, workspaceModeForDialog } from "./components/WorkspaceModeSwitcher";
import { Dialog } from "./components/Dialog";
import { AnalysisDialog } from "./components/AnalysisDialog";
import { UpdateDialog } from "./components/UpdateDialog";
import { CutPanel } from "./components/CutPanel";
import { RenderDialog } from "./components/RenderDialog";
import { TranslationDialog } from "./components/TranslationDialog";
import { SettingsDialog } from "./components/SettingsDialog";
import { DocumentsDialog } from "./components/DocumentsDialog";
import { LiveCaptureDialog } from "./components/LiveCaptureDialog";
import { JobHistoryDialog } from "./components/JobHistoryDialog";
import { ProjectRecoveryDialog } from "./components/ProjectRecoveryDialog";
import { exportAss, exportSpeakerSrtZip } from "./subtitle-export";
import { saveBlob } from "./recordingStore";
import { applyTranslations, captionTranslatedText, translatedProject } from "./translation";
import { buildKeepSpans, projectForEditedExport } from "./cuts";
import { useI18n, LOCALES, localeNames } from "./i18n";

export default function App() {
  const {t} = useI18n();
  const { project, update, replace, undo, redo, canUndo, canRedo, saveState, recoveryWarning } =
    useProject();
  const [file, setFile] = useState<File | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [revealCaption, setRevealCaption] = useState<{ id: string } | null>(null);
  const [revealNote, setRevealNote] = useState<{ id: string } | null>(null);
  const [dialog, setDialog] = useState<"export" | "analysis" | "update" | "render" | "translation" | "settings" | "documents" | "live" | "history" | "recovery" | null>(null);
  const [editedPreview, setEditedPreview] = useState(false);
  const [subtitleLanguage, setSubtitleLanguage] = useState<"original"|SubtitleLanguage>("original");
  const [projectSession, setProjectSession] = useState(0);
  const [notice, setNotice] = useState("");
  const [confirm, setConfirm] = useState<{
    message: string;
    action: () => void;
  } | null>(null);
  const mediaInput = useRef<HTMLInputElement>(null);
  const analyzeAfterMedia = useRef(false);
  const projectInput = useRef<HTMLInputElement>(null);
  const srtInput = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<MediaPlayerHandle>(null);
  const projectRef = useRef(project);
  projectRef.current = project;
  useEffect(() => {
    const input = mediaInput.current;
    const cancel = () => { analyzeAfterMedia.current = false; };
    input?.addEventListener("cancel", cancel);
    return () => input?.removeEventListener("cancel", cancel);
  }, []);
  const keepSpans = useMemo(()=>buildKeepSpans(project.cuts??[],project.duration),[project.cuts,project.duration]);
  const previewCaptions = useMemo(()=>{
    const mapped=editedPreview && project.cuts?.length ? projectForEditedExport(project) : null;
    const unresolved=new Set(mapped?.issues.map(i=>i.captionId));
    const captions=mapped ? mapped.project.captions.filter(c=>!unresolved.has(c.id)) : project.captions;
    return subtitleLanguage === "original" ? captions : captions.map(c=>({...c,text:captionTranslatedText(c,subtitleLanguage)}));
  },[project,editedPreview,subtitleLanguage]);
  useEffect(() => {
    if (file && file.name !== project.mediaName) {
      setFile(null);
      setPlaying(false);
      setNotice(t("복원된 프로젝트의 원본 미디어를 다시 연결하세요."));
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
    setTime(safe);
    if (source) playerRef.current?.seek(safe);
  }
  function preview(position: number, captionId?: string, speakerId?: string) {
    setRevealNote(null);
    const mediaDuration = videoRef.current?.duration;
    const safe = Math.max(
      0,
      mediaDuration !== undefined && Number.isFinite(mediaDuration)
        ? Math.min(position, mediaDuration)
        : position,
    );
    const active = project.captions
      .filter((c) => c.start <= safe && safe < c.end)
      .sort((a, b) => a.start - b.start || a.end - b.end);
    const caption =
      project.captions.find((c) => c.id === captionId) ??
      active.find(
        (c) => speakerId !== undefined && (c.speakerId ?? "") === speakerId,
      ) ??
      active[0];
    setSelected(caption?.id ?? null);
    // Each click is a fresh request, even when replaying the same caption.
    setRevealCaption(caption ? { id: caption.id } : null);
    setTime(safe);
    if (source) {
      setNotice("");
      playerRef.current?.preview(safe);
    }
    else setNotice(t("자막 위치를 표시했습니다. 재생하려면 원본 미디어를 연결하세요."));
  }
  function previewNote(id: string) {
    const note = project.notes.find((n) => n.id === id);
    if (!note) return;
    preview(note.start);
    setRevealNote({ id });
    if (!source) setNotice(t("메모 위치를 표시했습니다. 재생하려면 원본 미디어를 연결하세요."));
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
        t("프로젝트를 저장했습니다. 원본 미디어 파일은 별도로 보관하세요."),
      );
    } catch (e) {
      setNotice(t("저장 전 확인: {error}",{error:(e as Error).message}));
    }
  }
  async function readSmall(f: File) {
    if (f.size > MAX_PROJECT_BYTES)
      throw new Error(t("프로젝트·SRT 파일은 8 MiB 이하만 가져올 수 있습니다."));
    return f.text();
  }
  function changeProject(next: Project) {
    videoRef.current?.pause();
    analyzeAfterMedia.current = false;
    // A project switch ends the entire editor session, including retained input
    // drafts and media callbacks. Even reopening the same project starts fresh.
    flushSync(() => {
      replace(next);
      setProjectSession((session) => session + 1);
      setFile(null);
      setSource(null);
      setTime(0);
      setSelected(null);
      setRevealCaption(null);
      setRevealNote(null);
      setPlaying(false);
      setEditedPreview(false);
      setSubtitleLanguage("original");
      setDialog(null);
      setNotice("");
    });
  }
  function guarded(message: string, action: () => void) {
    if (project.captions.length || project.notes.length || project.cuts?.length || project.documents?.items.length)
      setConfirm({ message, action });
    else action();
  }
  function chooseMedia(analyze = false) {
    analyzeAfterMedia.current = analyze;
    mediaInput.current?.click();
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
        t("분석 결과를 적용했습니다. 목소리를 확인해 인물 이름을 지정하세요."),
      );
    } catch (e) {
      setNotice(t("분석 결과를 적용할 수 없습니다: {error}",{error:(e as Error).message}));
    }
  }
  function exportText(kind: "srt" | "md" | "csv", speakerId?: string | null) {
    try {
      const exportProject = kind === "srt" && subtitleLanguage !== "original" ? translatedProject({...project, captions: project.captions.filter(c=>speakerId===undefined||c.speakerId===speakerId)}, subtitleLanguage) : project;
      const base = safeFilename(project.name);
      const person =
        speakerId === undefined
          ? ""
          : `-${safeFilename(project.speakers.find((s) => s.id === speakerId)?.name ?? t("미배정"))}`;
      if (kind === "srt")
        download(
          `${base}${person}${subtitleLanguage==="original"?"":`-${subtitleLanguage}`}.srt`,
          exportSrt(exportProject, speakerId),
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
      setNotice(t("내보내기 파일을 생성했습니다."));
    } catch (e) {
      setNotice((e as Error).message);
    }
  }
  function exportBundle(kind: "ass" | "zip") {
    try {
      const output = subtitleLanguage === "original" ? project : translatedProject(project, subtitleLanguage);
      const name = `${safeFilename(project.name)}${subtitleLanguage === "original" ? "" : `-${subtitleLanguage}`}`;
      if (kind === "ass") download(`${name}.ass`, exportAss(output), "text/plain;charset=utf-8");
      else saveBlob(new Blob([new Uint8Array(exportSpeakerSrtZip(output))], { type: "application/zip" }), `${name}-speakers.zip`);
      setNotice(t("내보내기 파일을 생성했습니다."));
    } catch (error) { setNotice((error as Error).message); }
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
          aria-label={t("VOICESUBSEP 홈")}
        >
          <img className="brand-icon" src="/app-icon.png" width={30} height={30} alt="" />
          <span>VOICESUBSEP</span>
          <span className="version">{version}</span>
        </a>
        <div className="project-title">
          <input
            aria-label={t("프로젝트 이름")}
            maxLength={160}
            value={project.name}
            onChange={(e) => update((p) => ({ ...p, name: e.target.value }))}
            onBlur={() => {
              if (!project.name.trim())
                update((p) => ({ ...p, name: t("새 자막 프로젝트") }));
            }}
          />
          <span>{t("인물별 자막 워크스페이스")}</span>
        </div>
        <div className="header-actions">
          <button aria-label={t("설정 및 오류 로그")} title={t("설정 및 오류 로그")} className="icon-button settings-button" onClick={() => setDialog("settings")}>
            <Settings2 size={17} />
          </button>
          {window.voicesubsepDesktop && (
            <button aria-label={t("앱 업데이트")} title={t("앱 업데이트")} className="icon-button" onClick={() => setDialog("update")}>
              <RefreshCw size={17} />
            </button>
          )}
          <button
            className="icon-button"
            aria-label={t("실행 취소")}
            disabled={!canUndo}
            onClick={undo}
          >
            <Undo2 size={17} />
          </button>
          <button
            className="icon-button"
            aria-label={t("다시 실행")}
            disabled={!canRedo}
            onClick={redo}
          >
            <Redo2 size={17} />
          </button>
          <span className="action-divider" />
          <button
            aria-label={t("새 프로젝트")}
            onClick={() =>
              guarded(
                t("새 프로젝트를 시작합니다. 현재 작업은 먼저 파일로 저장해 두세요."),
                () => changeProject(createProject()),
              )
            }
          >
            <FilePlus2 size={16} />
            <span>{t("새로")}</span>
          </button>
          <button
            aria-label={t("프로젝트 열기")}
            onClick={() => projectInput.current?.click()}
          >
            <FolderOpen size={16} />
            <span>{t("열기")}</span>
          </button>
          <button aria-label={t("프로젝트 저장")} onClick={save}>
            <Save size={16} />
            <span>{t("저장")}</span>
          </button>
          <button className="primary" onClick={() => setDialog("export")}>
            <Download size={16} />{t("내보내기")}</button>
        </div>
      </header>
      <WorkspaceModeSwitcher
        mode={workspaceModeForDialog(dialog)}
        onSelect={mode => setDialog(mode === "documents" ? "documents" : mode === "recording" ? "live" : null)}
      />
      <main className="workspace" key={`${project.id}:${projectSession}`}>
        <Sidebar
          project={project}
          update={update}
          hasMedia={!!file}
          busy={dialog === "analysis"}
          onMedia={() => chooseMedia()}
          onAnalyze={() => file ? setDialog("analysis") : chooseMedia(true)}
        />
        <EditorWorkspace noteReveal={revealNote} tools={<>
          <button onClick={()=>setDialog("history")}><History size={15}/>{t("작업 이력·저장 공간")}</button>
          <button className={recoveryWarning?"recovery-warning":""} onClick={()=>setDialog("recovery")}><ArchiveRestore size={15}/>{t("자동 저장 복구")}</button>
        </>}>
          <div className="editor-upper">
            <div className="editor-center">
              <MediaPlayer
                controlRef={playerRef}
                source={source}
                videoRef={videoRef}
                time={time}
                duration={project.duration}
                setTime={setTime}
                onDuration={(duration) => {
                  if(project.cuts?.length && (Math.abs(duration-project.duration)>0.15 || project.cuts.some(c=>c.end>duration))){
                    videoRef.current?.pause();setFile(null);setPlaying(false);
                    setNotice(t("원본 길이가 프로젝트와 다릅니다. 같은 원본 파일을 연결하세요."));return;
                  }
                  if(duration!==project.duration)update((p) => ({ ...p, duration }));
                }}
                onMedia={() => chooseMedia()}
                playing={playing}
                setPlaying={setPlaying}
                captions={previewCaptions}
                speakers={project.speakers}
                selected={project.captions.find((c) => c.id === selected)}
                keepSpans={editedPreview && project.cuts?.length ? keepSpans : undefined}
              />
              <div className="subtitle-language-bar">
                <label>{t("미리보기·SRT 언어")} <select value={subtitleLanguage} onChange={e=>setSubtitleLanguage(e.target.value as typeof subtitleLanguage)}>
                  <option value="original">{t("원문")}</option>{LOCALES.map(l=><option key={l} value={l}>{localeNames[l]}</option>)}
                </select></label>
                <button disabled={!project.captions.length} onClick={()=>setDialog("translation")}>{t("자막 번역")}</button>
                {subtitleLanguage!=="original"&&<span>{t("미번역·수정된 자막은 원문으로 미리봅니다.")}</span>}
              </div>
              <CutPanel project={project} update={update} time={time} selected={project.captions.find(c=>c.id===selected)} preview={preview} editedPreview={editedPreview} setEditedPreview={setEditedPreview} onExport={()=>setDialog("render")}/>
              <CaptionEditor
                project={project}
                update={update}
                preview={preview}
                reveal={revealCaption}
                selected={selected}
                setSelected={setSelected}
                onImport={() => srtInput.current?.click()}
                onSample={() =>
                  guarded(
                    t("샘플 프로젝트로 전환합니다. 현재 작업은 먼저 파일로 저장해 두세요."),
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
              reveal={revealNote}
              onError={setNotice}
            />
          </div>
          <Timeline
            project={project}
            file={file}
            update={update}
            onError={setNotice}
            time={time}
            preview={preview}
            selected={selected}
            previewNote={previewNote}
            selectedNote={revealNote?.id ?? null}
          />
        </EditorWorkspace>
      </main>
      <footer className="status-bar">
        <span>
          <CheckCircle2 size={13} />
          {t(saveState)}
        </span>
        <span>
          {t("{count}개 자막",{count:project.captions.length})}<span className="status-dot">·</span>
          {t("검수 필요 {count}",{count:reviewCount})}
          <span className="status-dot">·</span>
          {t("{count}개 노트",{count:project.notes.length})}
        </span>
        <span>{t("로컬 작업")}<span className="status-dot">·</span>v{version}
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
          const analyze = analyzeAfterMedia.current;
          analyzeAfterMedia.current = false;
          e.target.value = "";
          if (!f) return;
          const action = () => {
            setFile(f);
            setTime(0);
            setPlaying(false);
            update((p) => ({ ...p, mediaName: f.name, ...(p.mediaName && p.mediaName !== f.name && p.schemaVersion===2 ? {cuts:[]} : {}) }));
            if(project.mediaName!==f.name)setEditedPreview(false);
            if(analyze)setDialog("analysis");
          };
          if (
            project.mediaName &&
            project.mediaName !== f.name &&
            (project.captions.length || project.notes.length || project.cuts?.length)
          )
            setConfirm({
              message:
                t("다른 미디어를 연결하면 컷 구간을 초기화합니다. 자막·메모 시간은 유지되므로 같은 원본인지 확인하세요."),
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
              t("저장한 프로젝트를 엽니다. 현재 작업은 먼저 파일로 저장해 두세요."),
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
                duration: p.mediaName ? p.duration : Math.max(p.duration, ...captions.map((c) => c.end)),
              }));
              setSelected(null);
              setNotice(t("SRT를 가져왔습니다. 화자를 직접 지정하세요."));
            };
            if (project.captions.length)
              setConfirm({
                message:
                  t("SRT의 자막으로 현재 자막을 교체합니다. 노트는 유지됩니다."),
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
          <button aria-label={t("알림 닫기")} onClick={() => setNotice("")}>
            <X size={16} />
          </button>
        </div>
      )}
      {confirm && (
        <Dialog title={t("작업 전환")} onClose={() => setConfirm(null)}>
          <p>{confirm.message}</p>
          <div className="dialog-actions">
            <button onClick={() => setConfirm(null)}>{t("취소")}</button>
            <button onClick={save}>{t("현재 프로젝트 저장")}</button>
            <button
              className="primary"
              onClick={() => {
                confirm.action();
                setConfirm(null);
              }}
            >{t("계속")}</button>
          </div>
        </Dialog>
      )}
      {dialog === "analysis" && file && (
        <AnalysisDialog
          file={file}
          project={project}
          onClose={() => setDialog(null)}
          onApply={applyAnalysis}
          onMediaReady={duration=>{if(Number.isFinite(duration)&&duration>0)update(p=>p.duration>0?p:{...p,duration});}}
        />
      )}
      {dialog === "export" && (
        <Dialog title={t("자막과 노트 내보내기")} onClose={() => setDialog(null)}>
          <p className="dialog-intro">{t("편집기에 맞는 형식을 선택하세요. 모든 시간은 원본 기준입니다.")}</p>
          <div className="export-section">
            <h3>{t("자막")}</h3>
            <button
              disabled={!project.captions.length}
              onClick={() => exportText("srt")}
            >
              <Download size={16} />{t("통합 SRT")}</button>
            <p>{t("동시에 말한 대사는 같은 시간 구간에 여러 줄로 출력합니다. SRT에는 스타일이 포함되지 않으며, 스타일은 프로젝트 JSON에 저장됩니다.")}</p>
            <div className="export-speakers">
              <button disabled={!project.captions.length} onClick={()=>exportBundle("ass")}>{t("스타일 포함 ASS")}</button>
              <button disabled={!project.captions.length} onClick={()=>exportBundle("zip")}>{t("인물별 SRT 묶음 ZIP")}</button>
            </div>
            <p>{t("ASS는 색상·크기·위치를 포함합니다. 글꼴과 줄바꿈은 재생기마다 다를 수 있습니다.")}</p>
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
                <button onClick={() => exportText("srt", null)}>{t("미배정 SRT")}</button>
              )}
            </div>
            <p>{t("인물별 파일은 각각 가져와 트랙에 배치하세요. 색상과 위치는 편집기에서 지정합니다.")}</p>
          </div>
          <div className="export-section">
            <h3>{t("편집 노트")}</h3>
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
            <p>{t("시간코드, 분류, 내용, 완료 상태를 포함합니다.")}</p>
          </div>
          <div className="dialog-actions">
            <button onClick={()=>setDialog("render")}>{t("편집본 미디어·SRT 내보내기")}</button>
            <button onClick={save}>
              <Save size={16} />{t("프로젝트 JSON 저장")}</button>
            <button onClick={() => setDialog(null)}>{t("닫기")}</button>
          </div>
        </Dialog>
      )}
      {dialog === "update" && <UpdateDialog onClose={() => setDialog(null)} />}
      {dialog === "settings" && <SettingsDialog onClose={() => setDialog(null)} />}
      {dialog === "documents" && <DocumentsDialog project={project} update={update} onClose={()=>setDialog(null)} onSource={(position,id)=>preview(position,id)}/>}
      {dialog === "history" && <JobHistoryDialog project={project} file={file} onClose={()=>setDialog(null)} onApplyAnalysis={applyAnalysis}/>}
      {dialog === "recovery" && <ProjectRecoveryDialog onClose={()=>setDialog(null)} onRestore={next=>{setDialog(null);guarded(t("복구본을 엽니다. 현재 작업은 먼저 파일로 저장해 두세요."),()=>changeProject(next));}}/>}
      {dialog === "live" && <LiveCaptureDialog onClose={()=>setDialog(null)} onUse={recording=>{
        setDialog(null);
        guarded(t("녹음으로 새 프로젝트를 시작합니다. 현재 작업은 먼저 파일로 저장해 두세요."),()=>{
          changeProject({...createProject(),name:recording.name.replace(/\.[^.]+$/,""),mediaName:recording.name});
          setFile(recording);setDialog("analysis");
        });
      }}/>}
      {dialog === "render" && <RenderDialog project={project} file={file} onClose={()=>setDialog(null)}/>}
      {dialog === "translation" && <TranslationDialog project={project} onClose={()=>setDialog(null)} onApply={(rows,target)=>{
        update(p=>applyTranslations(p,rows,target));setSubtitleLanguage(target);setDialog(null);setNotice(t("번역을 적용했습니다. 원문은 그대로 보존됩니다."));
      }}/>}
    </div>
  );
}
