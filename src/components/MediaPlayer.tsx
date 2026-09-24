import { useEffect, useRef, useState, type RefObject } from "react";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  Maximize,
  Repeat2,
} from "lucide-react";
import { formatTime, type Caption, type Speaker } from "../domain";

export function MediaPlayer({
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
}: {
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
}) {
  const [error, setError] = useState("");
  const [loop, setLoop] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setError("");
    setLoop(false);
  }, [source]);
  async function toggle() {
    if (!videoRef.current || !source) return;
    if (playing) videoRef.current.pause();
    else
      try {
        await videoRef.current.play();
      } catch {
        setError(
          "이 파일은 브라우저에서 재생할 수 없습니다. H.264 MP4 또는 WAV로 변환해 연결하세요. 분석은 별도로 사용할 수 있습니다.",
        );
      }
  }
  const active = captions
    .filter((c) => c.start <= time && c.end > time)
    .slice(0, 4);
  return (
    <section
      className="media-player"
      ref={container}
      aria-label="미디어 미리보기"
    >
      <div className="video-stage">
        {source ? (
          <video
            ref={videoRef}
            src={source}
            preload="metadata"
            onLoadedMetadata={(e) => {
              const value = e.currentTarget.duration;
              if (Number.isFinite(value)) onDuration(value);
            }}
            onTimeUpdate={(e) => {
              const v = e.currentTarget;
              if (loop && selected && v.currentTime >= selected.end) {
                v.currentTime = selected.start;
              }
              setTime(v.currentTime);
            }}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
            onError={() =>
              setError(
                "미리보기를 재생할 수 없습니다. H.264 MP4 또는 WAV를 사용하세요. 원본 분석은 계속 사용할 수 있습니다.",
              )
            }
          />
        ) : (
          <button className="video-empty" onClick={onMedia}>
            <span className="play-circle">
              <Play size={29} fill="currentColor" />
            </span>
            <span>영상을 불러와 편집을 시작하세요</span>
          </button>
        )}
        {source && active.length > 0 && (
          <div className="caption-overlay">
            {active.map((c) => (
              <div key={c.id}>
                <span
                  style={{
                    color:
                      speakers.find((s) => s.id === c.speakerId)?.color ??
                      "#fff",
                  }}
                >
                  {speakers.find((s) => s.id === c.speakerId)?.name ?? "미배정"}
                </span>{" "}
                {c.text}
              </div>
            ))}
          </div>
        )}
        {error && (
          <div className="media-error" role="alert">
            {error}
          </div>
        )}
      </div>
      <div className="player-controls">
        <input
          aria-label="재생 위치"
          type="range"
          min={0}
          max={duration || 1}
          step={0.01}
          value={Math.min(time, duration || 1)}
          onChange={(e) => {
            const t = Number(e.target.value);
            if (videoRef.current) videoRef.current.currentTime = t;
            setTime(t);
          }}
        />
        <div className="transport">
          <span className="time-display">
            {formatTime(time).slice(0, 8)} / {formatTime(duration).slice(0, 8)}
          </span>
          <div className="transport-center">
            <button
              aria-label="5초 뒤로"
              disabled={!source}
              onClick={() => {
                const t = Math.max(0, time - 5);
                if (videoRef.current) videoRef.current.currentTime = t;
                setTime(t);
              }}
            >
              <SkipBack size={17} />
            </button>
            <button
              aria-label={playing ? "일시 정지" : "재생"}
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
              aria-label="5초 앞으로"
              disabled={!source}
              onClick={() => {
                const t = Math.min(duration, time + 5);
                if (videoRef.current) videoRef.current.currentTime = t;
                setTime(t);
              }}
            >
              <SkipForward size={17} />
            </button>
          </div>
          <div className="transport-right">
            <button
              aria-label="선택 자막 반복"
              aria-pressed={loop}
              disabled={!selected || !source}
              onClick={() => {
                if (selected && videoRef.current) {
                  videoRef.current.currentTime = selected.start;
                  setTime(selected.start);
                }
                setLoop(!loop);
              }}
            >
              <Repeat2 size={16} />
            </button>
            <select
              aria-label="재생 속도"
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
              aria-label="음량"
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
              aria-label="전체 화면"
              disabled={!source}
              onClick={() => {
                void container.current
                  ?.requestFullscreen()
                  .catch(() => setError("전체 화면을 사용할 수 없습니다."));
              }}
            >
              <Maximize size={17} />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
