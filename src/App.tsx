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
  Keyboard,
  X,
} from "lucide-react";
import {
  createProject,
  parseProject,
  serializeProject,
  parseSrt,
  exportSrt,
  exportNotesCsv,
  exportNotesMarkdown,
  safeFilename,
  MAX_PROJECT_BYTES,
  type Project,
} from "./domain";
import { download, uploadMedia, type AnalysisResult, type MediaInfo } from "./api";
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
import { SettingsDialog } from "./components/SettingsDialog";
import { ThemeSelector } from "./components/ThemeSelector";
import { DocumentsDialog } from "./components/DocumentsDialog";
import { AudioMixerDialog } from "./components/AudioMixerDialog";
import { LiveCaptureDialog } from "./components/LiveCaptureDialog";
import { JobHistoryDialog } from "./components/JobHistoryDialog";
import { ProjectRecoveryDialog } from "./components/ProjectRecoveryDialog";
import { exportAss, exportSpeakerSrtZip } from "./subtitle-export";
import { YttExportPanel } from "./components/YttExportPanel";
import { ShortcutDialog } from "./components/ShortcutDialog";
import { useShortcuts } from "./useShortcuts";
import { adjacentCaptionId, formatShortcut, type ShortcutAction } from "./shortcuts";
import { saveBlob } from "./recordingStore";
import { buildKeepSpans, projectForEditedExport } from "./cuts";
import { useI18n } from "./i18n";
import { useBackgroundJob } from "./backgroundJob";
import { BackgroundJobStatus, BackgroundJobDialog } from "./components/BackgroundJobStatus";
import { bindProjectMedia, mediaLinkDecision, MediaSelectionGuard, sameMediaIdentity, uploadedMediaIdentity, type MediaIdentity } from "./mediaIdentity";

export default function App() {
  const {t} = useI18n();
  const background = useBackgroundJob();
  const { project, update, replace, undo, redo, canUndo, canRedo, saveState, recoveryWarning } =
    useProject();
  const [file, setFile] = useState<File | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [revealCaption, setRevealCaption] = useState<{ id: string } | null>(null);
  const [revealNote, setRevealNote] = useState<{ id: string } | null>(null);
  const [dialog, setDialog] = useState<"export" | "analysis" | "background" | "update" | "render" | "settings" | "documents" | "live" | "history" | "recovery" | "mixer" | "shortcuts" | null>(null);
  const [editedPreview, setEditedPreview] = useState(false);
  const [projectSession, setProjectSession] = useState(0);
  const [notice, setNotice] = useState("");
  const [mediaVerifying, setMediaVerifying] = useState(false);
  const mediaSelection = useRef(new MediaSelectionGuard());
  const connectedIdentity = useRef<{file:File;identity:MediaIdentity}|null>(null);
  const [confirm, setConfirm] = useState<{
    message: string;
    action: () => void;
    continueLabel?: string;
  } | null>(null);
  const mediaInput = useRef<HTMLInputElement>(null);
  const analyzeAfterMedia = useRef(false);
  const projectInput = useRef<HTMLInputElement>(null);
  const srtInput = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<MediaPlayerHandle>(null);
  const projectRef = useRef(project);
  projectRef.current = project;
  const shortcuts = useShortcuts(runShortcut, dialog !== null || confirm !== null);
  useEffect(()=>()=>mediaSelection.current.cancel(),[]);
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
    return captions;
  },[project,editedPreview]);
  useEffect(() => {
    if (file && (connectedIdentity.current?.file !== file || !sameMediaIdentity(project.mediaIdentity,connectedIdentity.current?.identity))) {
      setFile(null);
      setPlaying(false);
      setNotice(t("복원된 프로젝트의 원본 미디어를 다시 연결하세요."));
    }
  }, [project.mediaIdentity, file]);
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
  function runShortcut(action: ShortcutAction): boolean {
    switch (action) {
      case "save": save(); return true;
      case "open": projectInput.current?.click(); return true;
      case "new": guarded(t("새 프로젝트를 시작합니다. 현재 작업은 먼저 파일로 저장해 두세요."), () => changeProject(createProject())); return true;
      case "undo": if (canUndo) undo(); return canUndo;
      case "redo": if (canRedo) redo(); return canRedo;
      case "play": if (source) playerRef.current?.toggle(); return !!source;
      case "back": seek(time - 5); return true;
      case "forward": seek(time + 5); return true;
      case "previousCaption":
      case "nextCaption": {
        const id = adjacentCaptionId(project.captions, selected, time, action === "previousCaption" ? -1 : 1);
        const caption = project.captions.find(item => item.id === id);
        if (!caption) return false;
        setSelected(caption.id); setRevealCaption({ id: caption.id }); setRevealNote(null); seek(caption.start); return true;
      }
      case "analyze": if (!mediaVerifying) { if (file) setDialog("analysis"); else chooseMedia(true); } return !mediaVerifying;
      case "export": setDialog("export"); return true;
      case "shortcuts": setDialog("shortcuts"); return true;
    }
  }
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
      const serialized = serializeProject(projectRef.current);
      download(
        `${safeFilename(projectRef.current.name)}.voicesub.json`,
        serialized,
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
    mediaSelection.current.cancel();
    connectedIdentity.current=null;
    videoRef.current?.pause();
    analyzeAfterMedia.current = false;
    // A project switch ends the entire editor session, including retained input
    // drafts and media callbacks. Even reopening the same project starts fresh.
    flushSync(() => {
      replace(next);
      setMediaVerifying(false);
      setConfirm(null);
      setProjectSession((session) => session + 1);
      setFile(null);
      setSource(null);
      setTime(0);
      setSelected(null);
      setRevealCaption(null);
      setRevealNote(null);
      setPlaying(false);
      setEditedPreview(false);
      setDialog(null);
      setNotice("");
    });
  }
  function guarded(message: string, action: () => void) {
    const current=projectRef.current;
    if (current.captions.length || current.notes.length || current.cuts?.length || current.documents?.items.length || current.audioMix?.tracks.length)
      setConfirm({ message, action });
    else action();
  }
  function chooseMedia(analyze = false) {
    analyzeAfterMedia.current = analyze;
    mediaInput.current?.click();
  }
  function connectVerifiedFile(selectedFile:File,media:MediaInfo,analyze:boolean,allowLegacy=false) {
    const identity=uploadedMediaIdentity(media,selectedFile.size);
    // Update the project before connecting its File, so undo can disconnect a
    // different identity without ever silently playing it as the old source.
    const next=parseProject(JSON.stringify(bindProjectMedia(projectRef.current,media,selectedFile.name,allowLegacy)));
    connectedIdentity.current={file:selectedFile,identity};
    flushSync(()=>{update(next);setFile(selectedFile);setTime(0);setPlaying(false);});
    setNotice(t("원본 파일을 확인하고 연결했습니다."));
    if(analyze)setDialog("analysis");
  }
  async function selectMedia(selectedFile:File,analyze:boolean) {
    const token=mediaSelection.current.begin(projectRef.current.id);
    setMediaVerifying(true);setNotice("");
    try {
      const media=await uploadMedia(selectedFile);
      if(!mediaSelection.current.current(token,projectRef.current.id))return;
      const identity=uploadedMediaIdentity(media,selectedFile.size);
      const decision=mediaLinkDecision(projectRef.current,identity);
      const action=(newProject=false,allowLegacy=false)=>{
        if(!mediaSelection.current.current(token,projectRef.current.id))return;
        try {
          if(newProject){
            const next=bindProjectMedia({...createProject(projectRef.current.speakerCount),name:selectedFile.name.replace(/\.[^.]+$/u,"")||selectedFile.name},media,selectedFile.name);
            changeProject(parseProject(JSON.stringify(next)));
            connectedIdentity.current={file:selectedFile,identity};setFile(selectedFile);
            if(analyze)setDialog("analysis");
          } else connectVerifiedFile(selectedFile,media,analyze,allowLegacy);
        }catch(error){setNotice(t((error as Error).message));}
      };
      if(decision==="different")setConfirm({
        message:t("선택한 파일은 프로젝트에 등록된 원본과 내용이 다릅니다. 기존 자막·메모·컷을 재사용하지 않고 새 프로젝트로 시작합니다. 현재 작업이 필요하면 먼저 저장하세요."),
        continueLabel:t("이 파일로 새 프로젝트 시작"),action:()=>action(true),
      });
      else if(decision==="legacy")setConfirm({
        message:t("이 프로젝트에는 원본 해시가 없어 같은 원본인지 자동 확인할 수 없습니다. 선택한 파일이 원본인지 직접 확인하세요. 계속하면 기존 자막·메모·컷 시간을 유지하고 이 파일을 앞으로의 원본 기준으로 등록합니다."),
        continueLabel:t("원본으로 확인하고 연결"),action:()=>action(false,true),
      });
      else action();
    }catch(error){if(mediaSelection.current.current(token,projectRef.current.id))setNotice(t((error as Error).message));}
    finally{if(mediaSelection.current.current(token,projectRef.current.id))setMediaVerifying(false);}
  }
  async function openRecording(recording:File,result?:AnalysisResult) {
    const token=mediaSelection.current.begin(projectRef.current.id);
    setDialog(null);setMediaVerifying(true);setNotice("");
    try {
      const media=await uploadMedia(recording);
      if(!mediaSelection.current.current(token,projectRef.current.id))return;
      const identity=uploadedMediaIdentity(media,recording.size);
      const next=parseProject(JSON.stringify(bindProjectMedia({
        ...createProject(projectRef.current.speakerCount),name:recording.name.replace(/\.[^.]+$/u,"")||recording.name,
      },media,recording.name)));
      if(result){next.captions=result.captions;next.speakers=result.speakers;next.duration=result.duration;}
      const valid=parseProject(JSON.stringify(next));
      guarded(t("녹음으로 새 프로젝트를 시작합니다. 현재 작업은 먼저 파일로 저장해 두세요."),()=>{
        if(!mediaSelection.current.current(token,projectRef.current.id))return;
        changeProject(valid);connectedIdentity.current={file:recording,identity};setFile(recording);
        if(result)setNotice(t("분석 결과를 적용했습니다. 목소리를 확인해 인물 이름을 지정하세요."));
        else setDialog("analysis");
      });
    }catch(error){if(mediaSelection.current.current(token,projectRef.current.id))setNotice(t((error as Error).message));}
    finally{if(mediaSelection.current.current(token,projectRef.current.id))setMediaVerifying(false);}
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
      const base = safeFilename(project.name);
      const person =
        speakerId === undefined
          ? ""
          : `-${safeFilename(project.speakers.find((s) => s.id === speakerId)?.name ?? t("미배정"))}`;
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
      setNotice(t("내보내기 파일을 생성했습니다."));
    } catch (e) {
      setNotice((e as Error).message);
    }
  }
  function exportBundle(kind: "ass" | "zip") {
    try {
      const name = safeFilename(project.name);
      if (kind === "ass") download(`${name}.ass`, exportAss(project), "text/plain;charset=utf-8");
      else saveBlob(new Blob([new Uint8Array(exportSpeakerSrtZip(project))], { type: "application/zip" }), `${name}-speakers.zip`);
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
        </div>
        <div className="header-actions">
          <ThemeSelector />
          <button aria-label={t("단축키 허브")} title={`${t("단축키 허브")} · ${formatShortcut(shortcuts.bindings.shortcuts)}`} className="icon-button shortcut-hub-button" onClick={() => setDialog("shortcuts")}>
            <Keyboard size={17} />
          </button>
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
          busy={dialog === "analysis" || mediaVerifying}
          onMedia={() => chooseMedia()}
          onAnalyze={() => file ? setDialog("analysis") : chooseMedia(true)}
        />
        <EditorWorkspace noteReveal={revealNote} tools={<>
          <button onClick={() => setDialog("mixer")}>{t("오디오 트랙 믹서")}</button>
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
              <CutPanel project={project} update={update} time={time} selected={project.captions.find(c=>c.id===selected)} preview={preview} editedPreview={editedPreview} setEditedPreview={setEditedPreview} onExport={()=>setDialog("render")}
                previewRange={(from,to)=>{flushSync(()=>setEditedPreview(false));playerRef.current?.previewRange(from,to);}} stopPreview={()=>videoRef.current?.pause()} mediaAvailable={!!source}/>
              <CaptionEditor
                project={project}
                playing={playing}
                followSuspended={dialog !== null || confirm !== null}
                update={update}
                preview={preview}
                reveal={revealCaption}
                selected={selected}
                setSelected={setSelected}
                onImport={() => srtInput.current?.click()}
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
        <BackgroundJobStatus snapshot={background.snapshot} onOpen={()=>setDialog("background")} onDismiss={background.dismiss}/>
        {mediaVerifying&&<span role="status">{t("원본 파일 확인 중… 큰 파일은 시간이 걸릴 수 있습니다.")} <button onClick={()=>{mediaSelection.current.cancel();setMediaVerifying(false);}}>{t("연결 취소")}</button></span>}
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
          void selectMedia(f,analyze);
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
            >{confirm.continueLabel??t("계속")}</button>
          </div>
        </Dialog>
      )}
      {dialog === "analysis" && file && (
        <AnalysisDialog
          file={file}
          project={project}
          onClose={() => setDialog(null)}
          onApply={applyAnalysis}
          onJob={background.track}
          onMediaReady={duration=>{if(Number.isFinite(duration)&&duration>0)update(p=>p.duration>0?p:{...p,duration});}}
        />
      )}
      {dialog === "background" && <BackgroundJobDialog snapshot={background.snapshot} project={project} file={file} onClose={()=>setDialog(null)} onApply={applyAnalysis} onRetry={background.retry}/>}
      {dialog === "shortcuts" && <ShortcutDialog bindings={shortcuts.bindings} status={shortcuts.status} onSave={shortcuts.save} onClose={() => setDialog(null)}/>}
      {dialog === "export" && (
        <Dialog title={t("자막과 노트 내보내기")} onClose={() => setDialog(null)}>
          <p className="dialog-intro">{t("편집기에 맞는 형식을 선택하세요. SRT·ASS·노트는 원본 시간이며, YTT는 시간 기준을 선택할 수 있습니다.")}</p>
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
          <YttExportPanel project={project}/>
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
      {dialog === "mixer" && <AudioMixerDialog project={project} file={file} initialTime={time} onSave={audioMix => update(current => ({ ...current, audioMix }))} onClose={() => setDialog(null)}/>}
      {dialog === "documents" && <DocumentsDialog project={project} update={update} onClose={()=>setDialog(null)} onSource={(position,id)=>preview(position,id)}
        time={time} playing={playing} mediaAvailable={!!source} onTogglePlayback={()=>playerRef.current?.toggle()}/>}
      {dialog === "history" && <JobHistoryDialog project={project} file={file} onClose={()=>setDialog(null)} onApplyAnalysis={applyAnalysis}/>}
      {dialog === "recovery" && <ProjectRecoveryDialog onClose={()=>setDialog(null)} onRestore={next=>{setDialog(null);guarded(t("복구본을 엽니다. 현재 작업은 먼저 파일로 저장해 두세요."),()=>changeProject(next));}}/>}
      {dialog === "live" && <LiveCaptureDialog speakerCount={project.speakerCount} onClose={()=>setDialog(null)} onLiveResult={(recording,result)=>{void openRecording(recording,result);}} onUse={recording=>{void openRecording(recording);}}/>}
      {dialog === "render" && <RenderDialog project={project} file={file} onClose={()=>setDialog(null)}/>}
    </div>
  );
}
