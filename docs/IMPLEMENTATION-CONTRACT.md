# v0.1 implementation contract

This is the implementation boundary for the first runnable local version, 2026-09-24.

## Shared domain (frontend JSON)

```ts
type Mode = 'standard' | 'overlap';
type ReviewReason = 'overlap' | 'unassigned' | 'speaker_count' | 'timing';
type Speaker = { id: string; name: string; color: string };
type Word = { start: number; end: number; text: string; probability?: number };
type Caption = { id: string; start: number; end: number; text: string; speakerId: string | null; reasons: ReviewReason[]; reviewed: boolean; words?: Word[] };
type Note = { id: string; start: number; end: number | null; text: string; tag: 'edit' | 'highlight' | 'subtitle' | 'check'; done: boolean };
type Project = { schemaVersion: 1; id: string; name: string; mediaName: string | null; duration: number; mode: Mode; speakerCount: number; speakers: Speaker[]; captions: Caption[]; notes: Note[]; updatedAt: string };
```

Source media stays outside portable JSON and is re-linked by the user after reload. Times are source seconds, never compressed. Project JSON must validate strictly with bounded field lengths, count and finite times. `speakerCount` is 1..4, not a claim of successful model detection. Human edits are not silently replaced by fresh analysis. Demo data must be clearly named sample, never claimed as analyzed user media.

## Backend API

FastAPI under `backend/voicesubsep/`, loopback only, frontend Vite proxy `/api` -> http://127.0.0.1:8787.

- GET /api/health -> {status:'ok', ffmpeg:boolean, ffprobe:boolean, engines:{whisper:boolean,nemotron:boolean}, detail?:string}
- POST /api/media multipart `file` -> {id,name,duration,audioTracks:[{index:number,label:string,channels:number}],url:string}; preserve original media, no upload outside local host. Server source paths never accepted from clients.
- GET /api/media/{id}/file -> media response with browser range support.
- POST /api/jobs -> {mediaId:string, mode:'standard'|'overlap', speakerCount:1..4, audioTrack:number, whisperModel:'tiny'|'base'|'small'|'medium'|'large-v3'|'turbo', language:string, device:'cpu'|'cuda', diarization:boolean} -> {id:string}
- GET /api/jobs/{id} -> {id,status:'queued'|'running'|'completed'|'failed'|'cancelled',stage:string,progress:number,error?:string,result?:{captions:Caption[],speakers:Speaker[],duration:number,warnings:string[]}}
- DELETE /api/jobs/{id} -> cancellation requested; do not misreport completion as cancelled.

Single inference worker. Jobs stored under gitignored `data/`; no fake fallback transcription, no auto API-key/cloud. Missing engines -> explicit actionable error. FFmpeg args list, selected audio stream only; no shell command interpolation. Bound uploads and user input. Reject invalid media IDs and out-of-root paths. Backend tests exercise import/media/jobs validation and alignment with synthetic fixtures, not claims of model accuracy.

## Inference module contract (owned by inference worker)

`backend/voicesubsep/inference.py` exports `capabilities() -> dict[str,bool]` and `analyze(media_path:Path, *, audio_track:int, mode:str, speaker_count:int, whisper_model:str, language:str, device:str, diarization:bool, progress:Callable[[str,float],None], cancelled:Callable[[],bool]) -> dict` matching result shape. Raises `AnalysisCancelled` for cooperative cancellation; raises informative RuntimeError for missing engines. Uses isolated temp extraction, real faster-whisper, optional native Transformers Nemotron based on current official model card. Does not install dependencies at runtime. Expected count mismatch remains visible. Overlap mode flags overlap; v0.1 does not claim voice separation (future worker). Words ambiguous across simultaneous speakers remain unassigned/reviewable.

## Frontend core module (owned by domain worker)

`src/domain.ts` exports above types, `createProject()`, `demoProject()`, `parseProject(text):Project`, `parseSrt(text):Caption[]`, `exportSrt(project, speakerId?:string, includeNames?:boolean):string`, `exportNotesMarkdown(project):string`, `exportNotesCsv(project):string`, `formatTime(seconds):string`, `parseTime(value):number`. May export helpers. Tests use Vitest. SRT combined output uses non-overlapping event boundaries and preserves every caption; speaker exports maintain original timing. Portable projects include notes. No React dependency in domain module.

## Initial UI and acceptance

Korean desktop editor: source preview/seek, editable captions and speakers, 1..4 count, standard/overlap modes, timed notes, review filters, project import/export/local autosave, SRT import/export and per-speaker exports. Explicit sample/demo open; empty initial project. Analysis dialog calls backend and shows real job states; result applied only by user action preserving notes. File input supports local media and server upload. Keyboard shortcuts ignore text inputs. Accessible labels and narrow viewport fallback. Frontend lint/typecheck/build plus domain tests; backend tests; actual browser interaction QA.

Application implementation is new and independent; no AutoSubs source is copied. Keep research documents. Model weight licensing remains upstream. Heavy model accuracy and real Korean overlap verification are separate from application checks.
