import { useState } from "react";
import { ZoomIn, ZoomOut } from "lucide-react";
import { formatTime, type Project } from "../domain";

export function Timeline({
  project,
  time,
  seek,
  select,
}: {
  project: Project;
  time: number;
  seek: (t: number) => void;
  select: (id: string) => void;
}) {
  const [zoom, setZoom] = useState(1);
  const duration = Math.max(
    30,
    project.duration,
    ...project.captions.map((c) => c.end),
    ...project.notes.map((n) => n.end ?? n.start),
  );
  const speakers = project.speakers.filter(
    (s, i) =>
      i < project.speakerCount ||
      project.captions.some((c) => c.speakerId === s.id),
  );
  const lanes = [
    ...speakers,
    ...(project.captions.some((c) => !c.speakerId)
      ? [{ id: "", name: "미배정", color: "#8892a3" }]
      : []),
  ];
  return (
    <section className="timeline" aria-label="인물별 타임라인">
      <div className="timeline-heading">
        <h2>타임라인</h2>
        <span>원본 시간 기준</span>
        <div>
          <button
            aria-label="타임라인 축소"
            disabled={zoom <= 1}
            onClick={() => setZoom((z) => z / 2)}
          >
            <ZoomOut size={15} />
          </button>
          <span>{zoom}×</span>
          <button
            aria-label="타임라인 확대"
            disabled={zoom >= 8}
            onClick={() => setZoom((z) => z * 2)}
          >
            <ZoomIn size={15} />
          </button>
        </div>
      </div>
      <div className="timeline-scroll">
        <div
          className="timeline-content"
          style={{ minWidth: `${zoom * 100}%` }}
        >
          <div className="timeline-ruler">
            <span />
            {Array.from({ length: 7 }, (_, i) => (
              <button
                key={i}
                style={{ left: `calc(96px + (100% - 112px) * ${i / 6})` }}
                onClick={() => seek((duration * i) / 6)}
              >
                {formatTime((duration * i) / 6).slice(3, 8)}
              </button>
            ))}
          </div>
          {lanes.map((s) => (
            <div className="timeline-lane" key={s.id}>
              <div className="lane-label">
                <span className="speaker-dot" style={{ background: s.color }} />
                {s.name}
              </div>
              <div
                className="lane-track"
                onClick={(e) => {
                  const box = e.currentTarget.getBoundingClientRect();
                  seek(((e.clientX - box.left) / box.width) * duration);
                }}
              >
                <span
                  className="playhead"
                  style={{ left: `${(time / duration) * 100}%` }}
                />
                {project.captions
                  .filter((c) => (c.speakerId ?? "") === s.id)
                  .map((c) => (
                    <button
                      className="caption-block"
                      aria-label={`${s.name} ${formatTime(c.start)} ${c.text}`}
                      title={`${s.name} · ${c.text}`}
                      key={c.id}
                      style={{
                        left: `${(c.start / duration) * 100}%`,
                        width: `${((c.end - c.start) / duration) * 100}%`,
                        background: s.color,
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        select(c.id);
                        seek(c.start);
                      }}
                    >
                      {c.text}
                    </button>
                  ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
