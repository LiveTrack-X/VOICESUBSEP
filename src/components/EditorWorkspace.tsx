import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Columns2, PanelLeftClose } from "lucide-react";
import { useI18n } from "../i18n";
import { SubtitleFocusContext } from "../workspaceFocus";
import { calculateWorkspacePreview } from "../workspaceLayout";
import { previewWidthBounds } from "../panelWidths";
import { usePanelWidth } from "../usePanelWidth";
import { WidthResizeHandle, type WidthResizeHandleProps } from "./WidthResizeHandle";

const PreviewWidthContext = createContext<WidthResizeHandleProps | null>(null);

export function PreviewWidthResizer() {
  const props = useContext(PreviewWidthContext);
  return props ? <WidthResizeHandle {...props}/> : null;
}

const FOCUS_STORAGE_KEY = "voicesubsep-editor-focus-v1";
const NARROW_FOCUS_STORAGE_KEY = "voicesubsep-editor-focus-narrow-v1";

function readFocused(narrow: boolean): boolean {
  try {
    const stored = localStorage.getItem(narrow ? NARROW_FOCUS_STORAGE_KEY : FOCUS_STORAGE_KEY);
    return stored === null ? narrow : stored === "true";
  } catch { return narrow; }
}

export function EditorWorkspace({ children, noteReveal, tools }: {
  children: ReactNode;
  noteReveal: { id: string } | null;
  tools?: ReactNode;
}) {
  const { t } = useI18n();
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 1000px)").matches);
  const [focused, setFocused] = useState(() => readFocused(narrow));
  const chooseFocused = (value: boolean) => {
    setFocused(value);
    try { localStorage.setItem(narrow ? NARROW_FOCUS_STORAGE_KEY : FOCUS_STORAGE_KEY, String(value)); }
    catch { /* Layout remains usable without browser storage. */ }
  };
  const previousNoteReveal = useRef(noteReveal);
  const workspace = useRef<HTMLDivElement>(null);
  const previewWidth = usePanelWidth("preview");
  const requestedWidth = useRef(previewWidth.width);
  requestedWidth.current = previewWidth.width;
  const scheduleMeasurement = useRef(() => {});
  const [widthGeometry, setWidthGeometry] = useState({ wide: false, min: 0, max: 0, value: 0 });
  // Reveal notes in the same commit so NotesPanel measures a visible card.
  const focusedView = focused && !(noteReveal && previousNoteReveal.current !== noteReveal);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 1000px)");
    const resize = () => { setNarrow(query.matches); setFocused(readFocused(query.matches)); };
    query.addEventListener("change", resize);
    return () => query.removeEventListener("change", resize);
  }, []);
  useEffect(() => {
    // A timeline note must still reveal its editor while focus view is active.
    if (noteReveal && previousNoteReveal.current !== noteReveal) setFocused(false);
    previousNoteReveal.current = noteReveal;
  }, [noteReveal]);

  useEffect(() => {
    const root = workspace.current;
    if (!root || typeof ResizeObserver === "undefined") return;
    const center = root.querySelector<HTMLElement>(".editor-center");
    const upper = root.querySelector<HTMLElement>(".editor-upper");
    const player = center?.querySelector<HTMLElement>(".media-player");
    if (!center || !upper || !player) return;
    let frame = 0;
    let disposed = false;
    const size = (node: Element | null) => node?.getBoundingClientRect().height ?? 0;
    const measure = () => {
      frame = 0;
      if (disposed || player.classList.contains("media-player-expanded") || player.matches(":fullscreen")) return;
      const video = player.querySelector("video");
      const style = getComputedStyle(center);
      const paddingX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
      const paddingY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      const gap = parseFloat(style.rowGap) || 0;
      const stage = player.querySelector<HTMLElement>(".video-stage");
      const caption = center.querySelector<HTMLElement>(".caption-editor");
      const captionList = caption?.querySelector(".caption-list") ?? null;
      const notes = upper.querySelector<HTMLElement>(":scope > .notes-panel");
      const auxiliaries = [...center.children].filter(child => child !== player && child !== caption && !child.classList.contains("panel-width-resizer"));
      const shownAuxiliaries = auxiliaries.filter(child => size(child) > 0);
      const wide = window.matchMedia("(min-width: 1200px)").matches;
      const measurement = calculateWorkspacePreview({
        wide,
        width: Math.max(0, center.clientWidth - paddingX),
        height: Math.max(0, upper.clientHeight - size(notes) - paddingY),
        playerChrome: [...player.children].filter(child => child !== stage).reduce((sum, child) => sum + size(child), 2),
        auxiliaryHeight: shownAuxiliaries.reduce((sum, child) => sum + size(child), 0) + gap * (shownAuxiliaries.length + (wide ? 0 : 1)),
        captionChrome: Math.max(0, size(caption) - size(captionList)),
        aspectRatio: video?.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 16 / 9,
        kind: player.classList.contains("media-kind-empty") ? "empty" : player.classList.contains("media-kind-audio") ? "audio" : "video",
        collapsed: player.classList.contains("preview-collapsed"),
        manualWidth: requestedWidth.current,
      });
      const width = `${measurement.columnWidth}px`, height = `${measurement.stageHeight}px`;
      if (center.style.getPropertyValue("--preview-pane-width") !== width) center.style.setProperty("--preview-pane-width", width);
      if (center.style.getPropertyValue("--auto-preview-height") !== height) center.style.setProperty("--auto-preview-height", height);
      const bounds = previewWidthBounds(Math.max(0, center.clientWidth - paddingX));
      setWidthGeometry(current => current.wide === wide && current.min === bounds.min && current.max === bounds.max && current.value === measurement.columnWidth
        ? current : { wide, ...bounds, value: measurement.columnWidth });
    };
    const schedule = () => { if (!frame && !disposed) frame = requestAnimationFrame(measure); };
    scheduleMeasurement.current = schedule;
    const resize = new ResizeObserver(schedule);
    const watchSizes = () => {
      resize.disconnect();
      for (const node of [upper, center, player, ...player.children, ...center.children,
        ...root.querySelectorAll(".caption-list, .notes-panel")]) resize.observe(node);
    };
    const mutations = new MutationObserver(() => { watchSizes(); schedule(); });
    // Source/class/details changes include new media, manual preview choices,
    // expanded cut controls, note/focus layout and browser fullscreen fallback.
    mutations.observe(root, { attributes: true, attributeFilter: ["class"] });
    mutations.observe(player, { childList: true, attributes: true, attributeFilter: ["class", "style"] });
    mutations.observe(center, { childList: true });
    root.addEventListener("loadedmetadata", schedule, true);
    root.addEventListener("resize", schedule, true);
    document.addEventListener("fullscreenchange", schedule);
    window.addEventListener("resize", schedule);
    watchSizes(); schedule();
    return () => {
      disposed = true; if (frame) cancelAnimationFrame(frame);
      scheduleMeasurement.current = () => {};
      resize.disconnect(); mutations.disconnect();
      root.removeEventListener("loadedmetadata", schedule, true);
      root.removeEventListener("resize", schedule, true);
      document.removeEventListener("fullscreenchange", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, []);
  useEffect(() => { scheduleMeasurement.current(); }, [previewWidth.width]);

  return <SubtitleFocusContext.Provider value={focusedView}><PreviewWidthContext.Provider value={widthGeometry.wide ? {
    className: "preview-width-resizer", label: "미리보기·컷 편집 너비 조절", ...widthGeometry,
    onChange: previewWidth.change, onCommit: previewWidth.commit, onCancel: previewWidth.cancel, onReset: previewWidth.reset,
  } : null}><div ref={workspace} className={`editor-workspace${focusedView ? " subtitle-focus" : ""}`}>
    <div className="workspace-view-bar">
      <span className="workspace-view-label">{t(focusedView ? "자막 편집에 집중하는 화면입니다." : "편집 화면")}</span>
      {tools && <div className="workspace-tools">{tools}</div>}
      <button
        className="workspace-focus-button"
        aria-pressed={focusedView}
        onClick={() => chooseFocused(!focused)}
        title={t("미리보기와 보조 패널을 줄여 자막 편집 공간을 넓힙니다.")}
      >
        {focusedView ? <Columns2 size={15} /> : <PanelLeftClose size={15} />}
        {t(focusedView ? "전체 패널 보기" : "자막 집중")}
      </button>
    </div>
    {children}
  </div></PreviewWidthContext.Provider></SubtitleFocusContext.Provider>;
}
