import { useEffect, useState } from "react";
import { AudioLines, CheckCircle2, LoaderCircle } from "lucide-react";
import {
  request,
  uploadMedia,
  type AnalysisResult,
  type Health,
  type Job,
  type MediaInfo,
} from "../api";
import type { Project } from "../domain";
import { Dialog } from "./Dialog";

export function AnalysisDialog({
  file,
  project,
  onClose,
  onApply,
}: {
  file: File;
  project: Project;
  onClose: () => void;
  onApply: (result: AnalysisResult) => void;
}) {
  const [health, setHealth] = useState<Health | null>(null);
  const [media, setMedia] = useState<MediaInfo | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [job, setJob] = useState<Job | null>(null);
  const [starting, setStarting] = useState(false);
  const [model, setModel] = useState("small");
  const [device, setDevice] = useState("cpu");
  const [language, setLanguage] = useState("ko");
  const [track, setTrack] = useState(0);
  const [diarization, setDiarization] = useState(false);
  const running = job?.status === "running" || job?.status === "queued";
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const h = await request<Health>("/api/health");
        if (!alive) return;
        setHealth(h);
        setDiarization(h.engines.nemotron);
        if (!h.ffmpeg || !h.ffprobe)
          throw new Error(
            "FFmpeg와 FFprobe를 설치한 뒤 서버를 다시 실행하세요.",
          );
        const m = await uploadMedia(file);
        if (alive) {
          setMedia(m);
          setTrack(m.audioTracks[0]?.index ?? 0);
        }
      } catch (e) {
        if (alive)
          setError(
            `분석 준비 실패: ${(e as Error).message}. 로컬 서버가 실행 중인지 확인하세요.`,
          );
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [file]);
  useEffect(() => {
    if (!job?.id || !running) return;
    let alive = true;
    let timer: number;
    const poll = async () => {
      try {
        const next = await request<Job>(`/api/jobs/${job.id}`);
        if (alive) {
          setJob(next);
          setError("");
        }
      } catch (e) {
        if (alive)
          setError(
            `진행 상태 확인 실패: ${(e as Error).message}. 다시 확인하는 중입니다.`,
          );
      } finally {
        if (alive) timer = window.setTimeout(poll, 1200);
      }
    };
    timer = window.setTimeout(poll, 500);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [job?.id, running]);
  async function start() {
    if (!media) return;
    setStarting(true);
    setError("");
    try {
      const { id } = await request<{ id: string }>("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mediaId: media.id,
          mode: project.mode,
          speakerCount: project.speakerCount,
          audioTrack: track,
          whisperModel: model,
          language,
          device,
          diarization,
        }),
      });
      setJob({ id, status: "queued", stage: "대기 중", progress: 0 });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStarting(false);
    }
  }
  return (
    <Dialog
      title="로컬 음성 분석"
      onClose={onClose}
      closeDisabled={(!!running && !error) || starting}
    >
      <p className="dialog-intro">
        {file.name} · 예상 {project.speakerCount}명 ·{" "}
        {project.mode === "overlap" ? "동시 발화" : "일반 대화"}
      </p>
      {loading && (
        <p className="inline-status">
          <LoaderCircle className="spin" size={18} />이 기기의 분석 서버에
          파일을 준비하고 있습니다…
        </p>
      )}
      {!job && !loading && (
        <>
          <div className="form-grid">
            <label>
              오디오 트랙
              <select
                aria-label="오디오 트랙"
                value={track}
                onChange={(e) => setTrack(Number(e.target.value))}
              >
                {media?.audioTracks.map((t) => (
                  <option key={t.index} value={t.index}>
                    {t.label} · {t.channels}채널
                  </option>
                ))}
              </select>
            </label>
            <label>
              음성 언어
              <select
                aria-label="음성 언어"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
              >
                <option value="ko">한국어</option>
                <option value="en">영어</option>
                <option value="ja">일본어</option>
                <option value="auto">자동 감지</option>
              </select>
            </label>
            <label>
              Whisper 모델
              <select
                aria-label="Whisper 모델"
                value={model}
                onChange={(e) => setModel(e.target.value)}
              >
                {["tiny", "base", "small", "medium", "large-v3", "turbo"].map(
                  (m) => (
                    <option key={m}>{m}</option>
                  ),
                )}
              </select>
            </label>
            <label>
              연산 장치
              <select
                aria-label="연산 장치"
                value={device}
                onChange={(e) => setDevice(e.target.value)}
              >
                <option value="cpu">CPU · 기본 호환</option>
                <option value="cuda">NVIDIA GPU · CUDA 필요</option>
              </select>
            </label>
          </div>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={diarization}
              disabled={!health?.engines.nemotron}
              onChange={(e) => setDiarization(e.target.checked)}
            />
            Nemotron으로 인물 구분{" "}
            {health?.engines.nemotron ? "" : "(추가 설치 필요)"}
          </label>
          <p className="info-box">
            {diarization
              ? "자동 화자 번호를 부여합니다. 분석 후 목소리를 확인하고 이름을 지정하세요."
              : "현재는 음성 인식만 수행합니다. 자막의 화자를 편집 화면에서 직접 지정해야 합니다."}
            <br />첫 실행 시 선택 모델을 다운로드합니다. CPU의 큰 모델은 오래
            걸릴 수 있습니다. 겹쳐 말한 모든 대사의 복원을 보장하지 않습니다.
          </p>
        </>
      )}
      {job && (
        <div className="job-status">
          <div>
            {job.status === "completed" ? (
              <CheckCircle2 size={22} />
            ) : running ? (
              <LoaderCircle className="spin" size={22} />
            ) : (
              <AudioLines size={22} />
            )}
            <strong>
              {
                {
                  queued: "분석 대기",
                  running: "분석 중",
                  completed: "분석 완료",
                  failed: "분석 실패",
                  cancelled: "분석 취소됨",
                }[job.status]
              }
            </strong>
            <span>{Math.round(job.progress * 100)}%</span>
          </div>
          <progress value={job.progress} max={1} />
          <p>
            {{
              completed: "분석 결과를 확인한 뒤 적용하세요.",
              preparing: "분석을 준비하고 있습니다.",
              failed: "아래 오류 내용을 확인하세요.",
              cancelled: "작업이 취소되었습니다.",
              "cancellation requested": "현재 처리 단계가 끝나면 취소합니다.",
              interrupted: "서버가 중단되어 분석을 완료하지 못했습니다.",
            }[job.stage] ?? job.stage}
          </p>
          {job.error && <p className="error-box">{job.error}</p>}
          {job.result?.warnings.map((w, i) => (
            <p className="info-box" key={i}>
              {w}
            </p>
          ))}
          {job.result && (
            <p>
              자막 {job.result.captions.length}개 · 감지된 인물{" "}
              {job.result.speakers.length}명
            </p>
          )}
        </div>
      )}
      {error && (
        <p className="error-box" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        {running ? (
          <button
            onClick={async () => {
              try {
                setJob(
                  await request<Job>(`/api/jobs/${job.id}`, {
                    method: "DELETE",
                  }),
                );
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            분석 취소
          </button>
        ) : job?.result ? (
          <>
            <p>적용하면 기존 자막이 교체됩니다. 노트는 유지됩니다.</p>
            <button className="primary" onClick={() => onApply(job.result!)}>
              결과 적용
            </button>
          </>
        ) : (
          <>
            <button onClick={onClose}>닫기</button>
            <button
              className="primary"
              disabled={
                loading || starting || !media || !health?.engines.whisper
              }
              onClick={start}
            >
              {starting ? "시작 중…" : job ? "다시 분석" : "분석 시작"}
            </button>
          </>
        )}
      </div>
    </Dialog>
  );
}
