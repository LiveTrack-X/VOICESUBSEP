import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, ZoomIn, ZoomOut } from "lucide-react";
import { formatTime, type Project } from "../domain";
import type { MediaSource } from "../mediaSource";
import { request, uploadMedia, type MediaInfo } from "../api";
import { CaptionTimelineLane } from "./CaptionTimelineLane";
import { resizeCaption, waveformPath } from "../timelineEditing";
import { NoteTimelineLane } from "./NoteTimelineLane";
import { normalizeCuts } from "../cuts";
import { useI18n } from "../i18n";
import { editableSpeakers } from "../speakerOperations";
import { renameTimelineSpeaker } from "../timelineSpeakerName";
import { deleteTimelineTarget, moveTimelineTarget, timelineMovePlan, timelineTarget, type TimelineMenuAnchor, type TimelineTarget } from "../timelineContext";
import { TimelineContextMenu } from "./TimelineContextMenu";
import "./timeline-layout.css";

const LAYOUT_STORAGE_KEY = "voicesubsep-timeline-layout-v1";
const DEFAULT_HEIGHT = 180;
const MIN_HEIGHT = 100;
const MAX_HEIGHT = 480;
type TimelineLayout = { height: number; collapsed: boolean };

function readLayout(): TimelineLayout {
  const defaults = { height: DEFAULT_HEIGHT, collapsed: false };
  try {
    const raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (!raw || raw.length > 256) return defaults;
    const saved: unknown = JSON.parse(raw);
    if (!saved || typeof saved !== "object") return defaults;
    const value = saved as Record<string, unknown>;
    if (value.version !== 1 || typeof value.collapsed !== "boolean" || typeof value.height !== "number" || !Number.isFinite(value.height)) return defaults;
    return { height: Math.round(Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, value.height))), collapsed: value.collapsed };
  } catch {
    return defaults;
  }
}

function saveLayout(layout: TimelineLayout) {
  try { localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify({ version: 1, ...layout })); }
  catch { /* The current layout remains usable when local storage is unavailable. */ }
}

export function Timeline({
  project,
  file,
  update,
  onError,
  time,
  preview,
  selected,
  previewNote,
  selectedNote,
  seek,
  editCaption,
  editNote,
}: {
  project: Project;
  file: MediaSource | null;
  update: (change: (project: Project) => Project) => void;
  onError: (message: string) => void;
  time: number;
  preview: (time: number, captionId?: string, speakerId?: string) => void;
  selected: string | null;
  previewNote: (id: string) => void;
  selectedNote: string | null;
  seek: (time: number) => void;
  editCaption: (id: string) => void;
  editNote: (id: string) => void;
}) {
  const {t}=useI18n();
  const [zoom, setZoom] = useState(1);
  const [contextMenu, setContextMenu] = useState<{ projectId: string; target: TimelineTarget; anchor: TimelineMenuAnchor } | null>(null);
  const menuItem = contextMenu?.projectId === project.id ? timelineTarget(project,contextMenu.target) : undefined;
  const movePlan = contextMenu && menuItem ? timelineMovePlan(project,contextMenu.target,time) : null;
  const [layout, setLayout] = useState(readLayout);
  const [narrow, setNarrow] = useState(() => window.matchMedia("(max-width: 1000px)").matches);
  const [focusExpanded, setFocusExpanded] = useState(false);
  // A narrow window starts compact without replacing the saved desktop layout.
  const compactFocus = narrow;
  const collapsed = compactFocus ? !focusExpanded : layout.collapsed;
  useEffect(() => { if (contextMenu && (!menuItem || collapsed)) setContextMenu(null); }, [contextMenu,menuItem,collapsed]);
  function openContext(target: TimelineTarget, anchor: TimelineMenuAnchor) { setContextMenu({ projectId: project.id, target, anchor }); }
  function contextAction(action: "edit" | "seek" | "move" | "delete") {
    if (!contextMenu || !menuItem || contextMenu.projectId !== project.id) { setContextMenu(null); return; }
    const { projectId, target } = contextMenu;
    setContextMenu(null);
    if (action === "edit") { if (target.kind === "note") editNote(target.id); else editCaption(target.id); }
    else if (action === "seek") seek(menuItem.start);
    else update(current => current.id !== projectId ? current : action === "move" ? moveTimelineTarget(current,target,time) : deleteTimelineTarget(current,target));
  }
  useEffect(() => {
    const query = window.matchMedia("(max-width: 1000px)");
    const changed = () => setNarrow(query.matches);
    changed();
    query.addEventListener("change", changed);
    return () => query.removeEventListener("change", changed);
  }, []);
  useEffect(() => { if (!compactFocus) setFocusExpanded(false); }, [compactFocus]);
  const [maxHeight, setMaxHeight] = useState(MAX_HEIGHT);
  const [resizing, setResizing] = useState(false);
  const [waveform,setWaveform] = useState<{peaks:{values:number[];secondsPerPoint:number};duration:number}|null>(null);
  const [media,setMedia] = useState<MediaInfo|null>(null);
  const [audioTrack,setAudioTrack] = useState(0);
  const [waveBusy,setWaveBusy] = useState(false);
  const captionGroups=useMemo(()=>{
    const groups=new Map<string,Project["captions"]>();
    for(const caption of project.captions){const key=caption.speakerId??"";const rows=groups.get(key)??[];rows.push(caption);groups.set(key,rows);}
    return groups;
  },[project.captions]);
  const waveGeneration=useRef(0);
  useEffect(()=>{waveGeneration.current++;setWaveform(null);setMedia(null);setAudioTrack(0);setWaveBusy(false);return()=>{waveGeneration.current++;};},[file]);
  async function loadWaveform() {
    if(!file)return;
    const generation=++waveGeneration.current;setWaveBusy(true);
    try {
      const info=await uploadMedia(file);
      if(generation!==waveGeneration.current)return;
      setMedia(info);
      const track=info.audioTracks.some(track=>track.index===audioTrack)?audioTrack:info.audioTracks[0]?.index;
      if(track===undefined)throw new Error(t("분석할 오디오 트랙이 없습니다."));
      setAudioTrack(track);
      const wave=await request<{peaks:{values:number[];secondsPerPoint:number};duration:number}>(`/api/media/${info.id}/waveform?audioTrack=${track}&points=2000`,{signal:AbortSignal.timeout(200000)});
      if(generation===waveGeneration.current)setWaveform(wave);
    }catch(error){if(generation===waveGeneration.current)onError((error as Error).message);}
    finally{if(generation===waveGeneration.current)setWaveBusy(false);}
  }
  function changeBoundary(id:string,edge:"start"|"end",position:number) {
    update(p=>{
      const current=p.captions.find(c=>c.id===id);if(!current)return p;
      const next=resizeCaption(current,edge,position,p.duration);if(next===current)return p;
      return {...p,captions:p.captions.map(c=>c.id===id?next:c)};
    });
  }
  function renameSpeaker(id: string, originalName: string, name: string) {
    update(project => renameTimelineSpeaker(project, id, originalName, name));
  }
  const sectionRef = useRef<HTMLElement>(null);
  const dragRef = useRef<{ pointerId: number; startY: number; height: number } | null>(null);
  const latestLayout = useRef(layout);
  latestLayout.current = layout;
  const contentId = useId();
  const height = Math.min(layout.height, maxHeight);
  const clampHeight = (value: number) => Math.round(Math.max(MIN_HEIGHT, Math.min(maxHeight, value)));
  const commitLayout = (next: TimelineLayout) => {
    latestLayout.current = next;
    setLayout(next);
    saveLayout(next);
  };

  useLayoutEffect(() => {
    const workspace = sectionRef.current?.parentElement;
    if (!workspace) return;
    const measure = () => {
      const available = workspace.clientHeight;
      if (available > 0) setMaxHeight(Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, Math.floor(available * 0.45), available - 240)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(workspace);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => saveLayout(layout), 150);
    return () => window.clearTimeout(timeout);
  }, [layout]);
  useEffect(() => () => saveLayout(latestLayout.current), []);
  const duration = Math.max(
    30,
    project.duration,
    ...project.captions.map((c) => c.end),
    ...project.notes.map((n) => n.end ?? n.start),
  );
  const speakers = editableSpeakers(project);
  const lanes = [
    ...speakers,
    ...(project.captions.some((c) => !c.speakerId)
      ? [{ id: "", name: t("미배정"), color: "#8892a3" }]
      : []),
  ];
  return (
    <section
      ref={sectionRef}
      className={`timeline timeline-adjustable${collapsed ? " timeline-collapsed" : ""}${resizing ? " timeline-resizing" : ""}`}
      style={{ height: collapsed ? 42 : height }}
      aria-label={t("인물별 타임라인")}
    >
      {!collapsed && <div
        className="timeline-resize-handle"
        role="separator"
        tabIndex={0}
        aria-label={t("타임라인 높이 조절")}
        aria-orientation="horizontal"
        aria-controls={contentId}
        aria-valuemin={MIN_HEIGHT}
        aria-valuemax={maxHeight}
        aria-valuenow={height}
        aria-valuetext={t("타임라인 높이 {height}px", { height })}
        title={t("드래그하거나 위·아래 방향키로 높이 조절 · 두 번 클릭하여 기본 높이")}
        onPointerDown={event => {
          if (!event.isPrimary || event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.focus();
          event.currentTarget.setPointerCapture(event.pointerId);
          dragRef.current = { pointerId: event.pointerId, startY: event.clientY, height };
          setResizing(true);
        }}
        onPointerMove={event => {
          const drag = dragRef.current;
          if (!drag || drag.pointerId !== event.pointerId) return;
          const nextHeight = clampHeight(drag.height + drag.startY - event.clientY);
          setLayout(current => current.height === nextHeight ? current : { ...current, height: nextHeight });
        }}
        onPointerUp={event => {
          if (dragRef.current?.pointerId !== event.pointerId) return;
          dragRef.current = null;
          setResizing(false);
          event.currentTarget.releasePointerCapture(event.pointerId);
          saveLayout(latestLayout.current);
        }}
        onPointerCancel={() => { dragRef.current = null; setResizing(false); }}
        onLostPointerCapture={() => { dragRef.current = null; setResizing(false); }}
        onDoubleClick={() => commitLayout({ ...layout, height: clampHeight(DEFAULT_HEIGHT) })}
        onKeyDown={event => {
          const step = event.shiftKey ? 40 : 16;
          const nextHeight = event.key === "ArrowUp" ? height + step
            : event.key === "ArrowDown" ? height - step
              : event.key === "Home" ? MIN_HEIGHT
                : event.key === "End" ? maxHeight : null;
          if (nextHeight === null) return;
          event.preventDefault();
          commitLayout({ ...layout, height: clampHeight(nextHeight) });
        }}
      ><span /></div>}
      <div className="timeline-heading">
        <h2>{t("타임라인")}</h2>
        <span className="timeline-heading-hint">{t("클릭하면 해당 위치부터 재생 · 원본 시간 기준")}</span>
        <div className="timeline-heading-actions">
          {!collapsed&&<>
            {!!media&&media.audioTracks.length>1&&<select aria-label={t("파형 오디오 트랙")} disabled={waveBusy} value={audioTrack} onChange={e=>{setAudioTrack(Number(e.target.value));setWaveform(null);}}>{media.audioTracks.map(track=><option key={track.index} value={track.index}>{track.label}</option>)}</select>}
            <button disabled={!file||waveBusy} onClick={()=>void loadWaveform()}>{t(waveBusy?"파형 준비 중":"파형 불러오기")}</button>
          </>}
          {!collapsed && <div className="timeline-zoom-controls">
          <button
            aria-label={t("타임라인 축소")}
            disabled={zoom <= 1}
            onClick={() => setZoom((z) => z / 2)}
          >
            <ZoomOut size={15} />
          </button>
          <span>{zoom}×</span>
          <button
            aria-label={t("타임라인 확대")}
            disabled={zoom >= 8}
            onClick={() => setZoom((z) => z * 2)}
          >
            <ZoomIn size={15} />
          </button>
          </div>}
          <button
            className="timeline-collapse-button"
            aria-expanded={!collapsed}
            aria-controls={contentId}
            aria-label={t(collapsed ? "타임라인 펼치기" : "타임라인 접기")}
            title={t(collapsed ? "타임라인 펼치기" : "타임라인 접기")}
            onClick={() => compactFocus ? setFocusExpanded(value => !value) : commitLayout({ ...layout, collapsed: !layout.collapsed })}
          >
            {collapsed ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
            <span>{t(collapsed ? "펼치기" : "접기")}</span>
          </button>
        </div>
      </div>
      <div className="timeline-scroll" id={contentId} hidden={collapsed}>
        <div
          className="timeline-content"
          style={{ minWidth: `${zoom * 100}%` }}
        >
          <div
            className="timeline-ruler"
            onClick={(e) => {
              const box = e.currentTarget.getBoundingClientRect();
              preview(
                Math.max(0, Math.min(1, (e.clientX - box.left) / box.width)) * duration,
              );
            }}
          >
            {Array.from({ length: 7 }, (_, i) => (
              <button
                key={i}
                style={{ left: `${(i / 6) * 100}%` }}
                aria-label={t("{time}부터 재생",{time:formatTime((duration * i) / 6)})}
                onClick={(e) => {
                  e.stopPropagation();
                  preview((duration * i) / 6);
                }}
              >
                {formatTime((duration * i) / 6).slice(3, 8)}
              </button>
            ))}
          </div>
          <NoteTimelineLane
            notes={project.notes}
            duration={duration}
            time={time}
            selected={selectedNote}
            preview={previewNote}
            onContextMenu={(id,anchor)=>openContext({kind:"note",id},anchor)}
          />
          {waveform&&<div className="timeline-lane waveform-lane"><div className="lane-label">{t("오디오 파형")}</div><div className="lane-track" onClick={event=>{const box=event.currentTarget.getBoundingClientRect();preview(Math.max(0,Math.min(1,(event.clientX-box.left)/box.width))*duration);}}><svg viewBox="0 0 1000 32" preserveAspectRatio="none" aria-label={t("오디오 파형")}><path d={waveformPath(waveform.peaks.values,waveform.peaks.secondsPerPoint,duration)}/></svg><span className="playhead" style={{left:`${time/duration*100}%`}}/></div></div>}
          {!!project.cuts?.length&&<div className="timeline-lane cut-lane">
            <div className="lane-label">{t("제외 구간")}</div>
            <div className="lane-track"><span className="playhead" style={{left:`${time/duration*100}%`}}/>
              {normalizeCuts(project.cuts,project.duration).map(cut=><button key={cut.id} className="cut-block" style={{left:`${cut.start/duration*100}%`,width:`${(cut.end-cut.start)/duration*100}%`}} title={`${formatTime(cut.start)} → ${formatTime(cut.end)}`} aria-label={t("제외 구간 {start}부터 {end}",{start:formatTime(cut.start),end:formatTime(cut.end)})} onClick={()=>preview(cut.start)}>{t("제외")}</button>)}
            </div>
          </div>}
          {lanes.map(s=><CaptionTimelineLane key={s.id} speaker={s} captions={captionGroups.get(s.id)??[]} duration={duration} mediaDuration={project.duration} time={time} selected={selected} preview={preview} onResize={changeBoundary} onRename={renameSpeaker} onContextMenu={(id,anchor)=>openContext({kind:"caption",id},anchor)}/>)}
        </div>
      </div>
      {contextMenu&&menuItem&&!collapsed&&<TimelineContextMenu anchor={contextMenu.anchor}
        title={`${formatTime(menuItem.start)} · ${menuItem.text || t("내용 없는 메모")}`}
        canMove={!!movePlan?.changed} adjustedStart={movePlan?.adjusted ? movePlan.start : null}
        onEdit={()=>contextAction("edit")} onSeek={()=>contextAction("seek")} onMove={()=>contextAction("move")} onDelete={()=>contextAction("delete")}
        onClose={()=>setContextMenu(null)} />}
    </section>
  );
}
