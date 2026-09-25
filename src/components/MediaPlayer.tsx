import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  useId,
  type RefObject,
} from "react";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  Maximize,
  Minimize,
  Repeat2,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { formatTime, type Caption, type Speaker } from "../domain";
import { CaptionOverlay, captionAppearance } from "./CaptionOverlay";
import { useMediaFullscreen } from "./useMediaFullscreen";
import { sourceToOutput, outputToSource, type KeepSpan } from "../cuts";
import { useI18n } from "../i18n";
import { parsePreviewLayout, PREVIEW_LAYOUT_KEY } from "../previewLayout";
import "./media-fullscreen.css";

export type MediaPlayerHandle = {
  preview: (time: number) => void;
  previewRange: (start: number, end: number) => void;
  seek: (time: number) => void;
  toggle: () => void;
};

export function MediaPlayer({
  controlRef,
  source,
  videoRef,
  time,
  duration,
  setTime,
  onDuration,
  onMedia,
  playing,
  setPlaying,
  captions,
  speakers,
  selected,
  keepSpans,
}: {
  controlRef: RefObject<MediaPlayerHandle | null>;
  source: string | null;
  videoRef: RefObject<HTMLVideoElement | null>;
  time: number;
  duration: number;
  setTime: (time: number) => void;
  onDuration: (time: number) => void;
  onMedia: () => void;
  playing: boolean;
  setPlaying: (b: boolean) => void;
  captions: Caption[];
  speakers: Speaker[];
  selected: Caption | undefined;
  keepSpans?: KeepSpan[];
}) {
  const {t} = useI18n();
  const playbackDuration = keepSpans ? (keepSpans.at(-1)?.outputEnd ?? 0) : duration;
  const playbackTime = keepSpans ? (sourceToOutput(time,keepSpans) ?? keepSpans.find(s=>s.sourceStart>time)?.outputStart ?? playbackDuration) : time;
  const [error, setError] = useState("");
  const [loop, setLoop] = useState(false);
  const [audioOnly, setAudioOnly] = useState(false);
  const [layout, setLayout] = useState(() => {
    try { return parsePreviewLayout(localStorage.getItem(PREVIEW_LAYOUT_KEY)); }
    catch { return parsePreviewLayout(null); }
  });
  const previewId = useId();
  const rangeEnd = useRef<number | null>(null);
  useEffect(() => { rangeEnd.current = null; }, [source]);
  useEffect(() => {
    if (!playing) return;
    let frame: number;
    const tick = () => {
      const media = videoRef.current;
      const end = rangeEnd.current;
      if (media && end !== null && media.currentTime >= end) {
        rangeEnd.current = null;
        media.pause(); media.currentTime = end; setTime(end);
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, source]);
  const kind = !source ? "empty" : audioOnly ? "audio" : "video";
  useEffect(() => {
    try { localStorage.setItem(PREVIEW_LAYOUT_KEY, JSON.stringify({ version: 1, ...layout })); }
    catch { /* Preview controls still work when storage is unavailable. */ }
  }, [layout]);
  const container = useRef<HTMLDivElement>(null);
  const fullscreen = useMediaFullscreen(container);
  const pendingSeek = useRef<{ source: string; time: number } | null>(null);
  useEffect(() => {
    setError("");
    setLoop(false);
    setAudioOnly(false);
    pendingSeek.current = null;
  }, [source]);
  function playableSource(value:number) {
    if(!keepSpans)return value;
    const next=keepSpans.find(s=>value<s.sourceEnd);
    return next ? Math.max(value,next.sourceStart) : keepSpans.at(-1)?.sourceEnd??0;
  }
  function advanceEdited(media:HTMLVideoElement) {
    if(!keepSpans)return;
    const next=keepSpans.find(s=>media.currentTime<s.sourceEnd);
    if(!next){media.pause();const end=keepSpans.at(-1)?.sourceEnd??0;if(media.currentTime>end)media.currentTime=end;setTime(end);return;}
    if(media.currentTime<next.sourceStart){media.currentTime=next.sourceStart;setTime(next.sourceStart);}
  }
  useEffect(()=>{
    if(!keepSpans)return;
    setLoop(false);
    const media=videoRef.current;
    if(media && media.readyState>0)advanceEdited(media);
  },[keepSpans]);
  useEffect(()=>{
    if(!playing||!keepSpans)return;
    let frame:number;
    const tick=()=>{const media=videoRef.current;if(media&&!media.paused)advanceEdited(media);frame=requestAnimationFrame(tick);};
    frame=requestAnimationFrame(tick);
    return()=>cancelAnimationFrame(frame);
  },[playing,keepSpans]);
  async function play(media: HTMLVideoElement) {
    try {
      await media.play();
    } catch (cause) {
      // A later seek, pause or source change can cancel an earlier play request.
      if ((cause as { name?: string }).name === "AbortError") return;
      if (videoRef.current !== media || media.getAttribute("src") !== source)
        return;
      setError(
        t("재생을 시작할 수 없습니다. 재생 버튼으로 다시 시도하거나 H.264 MP4 또는 WAV 파일을 연결하세요."),
      );
    }
  }
  function seek(t: number) {
    rangeEnd.current = null;
    const media = videoRef.current;
    if (!media || !source) {
      setTime(Math.max(0, t));
      return;
    }
    const target = Math.max(
      0,
      playableSource(Number.isFinite(media.duration) ? Math.min(t, media.duration) : t),
    );
    if (media.readyState === 0) {
      pendingSeek.current = { source, time: target };
    } else {
      pendingSeek.current = null;
      media.currentTime = target;
    }
    setTime(target);
  }
  useImperativeHandle(controlRef, () => ({
    seek,
    toggle: () => { void toggle(); },
    previewRange(start, end) {
      const media = videoRef.current;
      if (!media || !source || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) return;
      setLoop(false); setError("");
      seek(start);
      rangeEnd.current = end;
      void play(media);
    },
    preview(t) {
      setLoop(false);
      setError("");
      const media = videoRef.current;
      if (!media || !source) return;
      seek(t);
      if (Number.isFinite(media.duration) && t >= media.duration) {
        media.pause();
        return;
      }
      // Keep play() in the click event so browser user activation is retained.
      void play(media);
    },
  }));
  async function toggle() {
    rangeEnd.current = null;
    if (!videoRef.current || !source) return;
    if (!videoRef.current.paused) videoRef.current.pause();
    else {
      setError("");
      if(keepSpans && (videoRef.current.currentTime >= (keepSpans.at(-1)?.sourceEnd??0))) seek(keepSpans[0]?.sourceStart??0);
      else if(keepSpans)seek(videoRef.current.currentTime);
      await play(videoRef.current);
    }
  }
  const active = captions
    .filter((c) => c.start <= (keepSpans?playbackTime:time) && c.end > (keepSpans?playbackTime:time))
    .sort(
      (a, b) => Number(b.id === selected?.id) - Number(a.id === selected?.id),
    )
    .slice(0, 4);
  return (
    <section
      className={`media-player media-kind-${kind}${layout.collapsed ? " preview-collapsed" : ""}${fullscreen.expanded ? " media-player-expanded" : ""}`}
      ref={container}
      aria-label={t("미디어 미리보기")}
      role={fullscreen.expanded ? "dialog" : undefined}
      aria-modal={fullscreen.expanded || undefined}
    >
      <div className="preview-layout-toolbar" hidden={fullscreen.expanded}>
        <span>{t("미디어 미리보기")}</span>
        <span className="preview-fit-label" title={t("가로·세로 공간에 원본 비율을 유지하며 최대 크기로 맞춥니다.")}>{t("자동 맞춤")}</span>
        <button aria-expanded={!layout.collapsed} aria-controls={previewId}
          title={t("화면만 접고 재생 제어는 유지합니다.")}
          onClick={() => setLayout(value => ({ ...value, collapsed: !value.collapsed }))}>
          {layout.collapsed ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
          {t(layout.collapsed ? "미리보기 펼치기" : "미리보기 접기")}
        </button>
      </div>
      <div className="media-expand-toolbar" hidden={!fullscreen.expanded}>
        <span>{fullscreen.nativeFullscreen ? t("전체 화면 미리보기") : t("앱 안에서 확대 미리보기")}</span>
        <button data-fullscreen-exit aria-label={t("확대 미리보기 닫기")} onClick={fullscreen.close}>
          <Minimize size={16} />{t("닫기 · Esc")}</button>
      </div>
      <div className="video-stage" id={previewId}>
        {source ? (
          <video
            ref={videoRef}
            src={source}
            preload="metadata"
            onLoadedMetadata={(e) => {
              const media = e.currentTarget;
              setAudioOnly(media.videoWidth === 0 && media.videoHeight === 0);
              const value = media.duration;
              if (Number.isFinite(value)) onDuration(value);
              const pending = pendingSeek.current;
              pendingSeek.current = null;
              if (pending?.source === source) {
                const target = Number.isFinite(value)
                  ? Math.min(pending.time, value)
                  : pending.time;
                media.currentTime = target;
                setTime(target);
                if (Number.isFinite(value) && target >= value) media.pause();
              }
            }}
            onTimeUpdate={(e) => {
              const v = e.currentTarget;
              if (loop && !keepSpans && selected && v.currentTime >= selected.end) {
                v.currentTime = selected.start;
              }
              advanceEdited(v);
              setTime(v.currentTime);
            }}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
            onError={() =>
              setError(
                t("미리보기를 재생할 수 없습니다. H.264 MP4 또는 WAV를 사용하세요. 원본 분석은 계속 사용할 수 있습니다."),
              )
            }
          />
        ) : (
          <button className="video-empty" onClick={onMedia}>
            <span className="play-circle">
              <Play size={29} fill="currentColor" />
            </span>
            <span>{t("영상·오디오 불러오기")}</span>
          </button>
        )}
        {source && active.length > 0 && (
          <CaptionOverlay entries={active.map((c) =>
            captionAppearance(c, speakers.find((s) => s.id === c.speakerId), t("미배정")),
          )} />
        )}
      </div>
      {error && <p className="media-playback-error" role="alert">{error}</p>}
      <div className="player-controls">
        <input
          aria-label={t("재생 위치")}
          data-caption-follow-seek
          type="range"
          min={0}
          max={playbackDuration || 1}
          step={0.01}
          value={Math.min(playbackTime, playbackDuration || 1)}
          onChange={(e) => {
            const t = Number(e.target.value);
            seek(keepSpans?outputToSource(t,keepSpans):t);
          }}
        />
        <div className="transport">
          <span className="time-display">
            {keepSpans&&<strong>{t("편집본")} · </strong>}{formatTime(playbackTime).slice(0, 8)} / {formatTime(playbackDuration).slice(0, 8)}
          </span>
          <div className="transport-center">
            <button
              aria-label={t("5초 뒤로")}
              disabled={!source}
              onClick={() => {
                const t = Math.max(0, playbackTime - 5);
                seek(keepSpans?outputToSource(t,keepSpans):t);
              }}
            >
              <SkipBack size={17} />
            </button>
            <button
              aria-label={playing ? t("일시 정지") : t("재생")}
              disabled={!source}
              onClick={toggle}
            >
              {playing ? (
                <Pause size={21} fill="currentColor" />
              ) : (
                <Play size={21} fill="currentColor" />
              )}
            </button>
            <button
              aria-label={t("5초 앞으로")}
              disabled={!source}
              onClick={() => {
                const t = Math.min(playbackDuration, playbackTime + 5);
                seek(keepSpans?outputToSource(t,keepSpans):t);
              }}
            >
              <SkipForward size={17} />
            </button>
          </div>
          <div className="transport-right">
            <button
              aria-label={t("선택 자막 반복")}
              aria-pressed={loop}
              disabled={!selected || !source || !!keepSpans}
              onClick={() => {
                if (selected && videoRef.current) {
                  seek(selected.start);
                }
                setLoop(!loop);
              }}
            >
              <Repeat2 size={16} />
            </button>
            <select
              aria-label={t("재생 속도")}
              defaultValue="1"
              onChange={(e) => {
                if (videoRef.current)
                  videoRef.current.playbackRate = Number(e.target.value);
              }}
            >
              {[0.5, 0.75, 1, 1.25, 1.5, 2].map((s) => (
                <option key={s} value={s}>
                  {s}×
                </option>
              ))}
            </select>
            <Volume2 className="volume-icon" size={17} />
            <input
              aria-label={t("음량")}
              type="range"
              min={0}
              max={1}
              step={0.05}
              defaultValue={1}
              onChange={(e) => {
                if (videoRef.current)
                  videoRef.current.volume = Number(e.target.value);
              }}
            />
            <button
              aria-label={fullscreen.expanded ? t("전체 화면 나가기") : t("전체 화면")}
              aria-pressed={fullscreen.expanded}
              disabled={!source && !fullscreen.expanded}
              onClick={fullscreen.expanded ? fullscreen.close : fullscreen.open}
            >
              {fullscreen.expanded ? <Minimize size={17} /> : <Maximize size={17} />}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
