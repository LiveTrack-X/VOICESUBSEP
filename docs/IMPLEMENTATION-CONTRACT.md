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

Source media stays outside portable JSON and is re-linked by the user after reload. Times are source seconds, never compressed. Project JSON must validate strictly with bounded field lengths, count and finite times. `speakerCount` retains the numeric values 1..4: values 1, 2 and 3 are exact expected counts; value 4 means **at least four people**. It is not a detection cap or a claim of successful detection. In the 4+ mode, detected speakers 5..8 remain distinct without a `speaker_count` mismatch reason; fewer than four trigger that reason. Preserve the separate eight-channel saturation warning. Human edits are not silently replaced by fresh analysis. Demo data must be clearly named sample, never claimed as analyzed user media.

## Backend API

FastAPI under `backend/voicesubsep/`, loopback only, frontend Vite proxy `/api` -> http://127.0.0.1:8787.

- GET /api/ready -> {app:'voicesubsep',status:'ok'}; desktop process identity/liveness only, no model imports.
- GET /api/health -> {app:'voicesubsep', status:'ok', ffmpeg:boolean, ffprobe:boolean, engines:{whisper:boolean,nemotron:boolean}, engineIssues:{whisper:string|null,nemotron:string|null}, gpu:{available:boolean,name:string|null,deviceCount:number,computeTypes:string[],reason:string|null}, defaults:{device:'cuda'|'cpu',whisperModel:'large-v3',computeType:'float16'|'int8'}, detail?:string}
- POST /api/media multipart `file` -> {id,name,duration,audioTracks:[{index:number,label:string,channels:number}],url:string}; preserve original media, no upload outside local host. Server source paths never accepted from clients.
- GET /api/media/{id}/file -> media response with browser range support.
- POST /api/jobs -> {mediaId:string, mode:'standard'|'overlap', speakerCount:1..4, audioTrack:number, whisperModel:'tiny'|'base'|'small'|'medium'|'large-v3'|'large-v3-turbo'|'turbo', language:string, device:'cpu'|'cuda', diarization:boolean} -> {id:string}
- GET /api/jobs/{id} -> {id,status:'queued'|'running'|'completed'|'failed'|'cancelled',stage:string,progress:number,error?:string,result?:{captions:Caption[],speakers:Speaker[],duration:number,warnings:string[]}}
- DELETE /api/jobs/{id} -> cancellation requested; do not misreport completion as cancelled.

Single inference worker. Jobs stored under gitignored `data/`; no fake fallback transcription, no auto API-key/cloud. Missing engines -> explicit actionable error. FFmpeg args list, selected audio stream only; no shell command interpolation. Bound uploads and user input. Reject invalid media IDs and out-of-root paths. Backend tests exercise import/media/jobs validation and alignment with synthetic fixtures, not claims of model accuracy.

`large-v3-turbo` is the canonical model name; accept legacy `turbo` and normalize it to that name. Omitted API model/device values default to `large-v3`/`cuda`. The frontend checks health and explicitly sends its selected device: choose CUDA when `gpu.available`, otherwise show the failure reason and select CPU before the user starts analysis. Health's `defaults` follows that availability. A running CUDA job must not silently fall back to CPU or a smaller model.

`engines` reports import availability and `engineIssues` explains unavailable runtimes. Nemotron is required by the default speaker-aware workflow; an unavailable requested engine blocks analysis before extraction/ASR. Only an explicit transcription-only request bypasses it and leaves speakers unassigned. `gpu` reports CUDA device count, supported compute types and loadable runtime libraries; it does not download weights or perform model inference. On Windows, a complete CUDA DLL set in `torch/lib` is preferred and shared with CTranslate2. The `gpu-windows` group is an alternative when runtime libraries are missing, not a mandatory duplicate installation. `gpu_runtime.py` registers DLL directories only in the server process, without changing global PATH/registry. Dependency readiness and actual model execution are separate evidence.

## Inference module contract (owned by inference worker)

`backend/voicesubsep/inference.py` exports `capabilities() -> dict[str,bool]` and `analyze(media_path:Path, *, audio_track:int, mode:str, speaker_count:int, whisper_model:str, language:str, device:str, diarization:bool, progress:Callable[[str,float],None], cancelled:Callable[[],bool]) -> dict` matching result shape. Raises `AnalysisCancelled` for cooperative cancellation; raises informative RuntimeError for missing engines. Uses isolated temp extraction, real faster-whisper and native Transformers Nemotron. Does not install dependencies at runtime.

The normal Windows `scripts/setup.ps1` installs Python 3.12, `torch==2.11.0+cu128` and `backend[whisper,diarization,test]`. The `diarization` dependency group is package organization, not an optional product feature: it pins Transformers source commit `4b28d51d0d5f17ec20c23a187d0475a8e68810c8` and librosa `0.11.0` with `torch>=2.11,<2.12`. Setup installs runtimes; absent model weights are prepared only when analysis is explicitly started. See [model setup](MODEL-SETUP.md) for the fixed Nemotron revision, size/SHA256 validation and offline cache behavior.

For speaker-aware jobs, Nemotron runs first in FP32 and unloads before Whisper loads. `_configure_file_diarization` uses the pinned model's offline context values in a streaming `file` preset: 340 chunk + 40 right-context encoder frames (about 30.4 seconds), FIFO length 40 and cache update period 300. A single speaker cache spans the file; cancellation checks occur between bounded forwards. Final activity timestamps use the native processor's 10 ms output stride, not the 80 ms encoder stride. CPU memory still holds the full waveform and activity output, so bounded GPU context does not imply constant total memory for long recordings.

`speaker_change_clips` creates adjacent Whisper decode windows covering the entire source `[0, duration]`. It cuts between changes of exclusively active speaker IDs, merges sub-0.5-second windows, and preserves silence, overlap and missed activity without shifting source time. These are decode windows, not isolated voices or speaker labels. Whisper uses CUDA FP16 after a runtime/compute-support check, or CPU INT8. `language=auto` enables multilingual decoding; word timestamps are requested, VAD trimming is disabled and previous-text conditioning is disabled. Attribution follows transcription. Expected count mismatch uses the exact 1..3 / minimum-four semantics above; it never merges extra speakers. Both modes preserve overlap; v0.1 does not claim voice separation or recovery of every simultaneous utterance. Words ambiguous across simultaneous speakers remain unassigned/reviewable.

## Frontend core module (owned by domain worker)

`src/domain.ts` exports above types, `createProject()`, `demoProject()`, `parseProject(text):Project`, `parseSrt(text):Caption[]`, `exportSrt(project, speakerId?:string, includeNames?:boolean):string`, `exportNotesMarkdown(project):string`, `exportNotesCsv(project):string`, `formatTime(seconds):string`, `parseTime(value):number`. May export helpers. Tests use Vitest. SRT combined output uses non-overlapping event boundaries and preserves every caption; speaker exports maintain original timing. Portable projects include notes. No React dependency in domain module.

## Initial UI and acceptance

Korean desktop editor: source preview/seek, editable captions and speakers, 1/2/3/4+ count, standard/overlap modes, timed notes, review filters, project import/export/local autosave, SRT import/export and per-speaker exports. Explicit sample/demo open; empty initial project. Analysis dialog defaults to large-v3 and available CUDA, with a visible CPU fallback before analysis. It calls the backend and shows real job states; result is applied only by user action preserving notes. File input supports local media and server upload. Keyboard shortcuts ignore text inputs. Accessible labels and narrow viewport fallback. Frontend lint/typecheck/build plus domain tests; backend tests; actual browser interaction QA.

Application implementation is new and independent; no AutoSubs source is copied. Keep research documents. Model weight licensing remains upstream. Both large-v3 and large-v3-turbo completed CUDA FP16 transcription on the RTX 3080 Ti with a 14-second English synthetic fixture; see [execution evidence](GPU-DESKTOP-VALIDATION.md). Heavy model accuracy and real Korean overlap verification are separate from application checks. Faster Whisper XXL is an optional standalone runner, not a larger model; see [GPU models](GPU-MODELS.md). Optional Windows installer/build details belong in [DESKTOP.md](DESKTOP.md).

The 2026-09-24 source-run Nemotron + large-v3-turbo smoke used the unchanged 39.466625-second Korean/English synthetic fixture, CUDA and offline cached models. It completed in 24.265 seconds with 2 detected speakers, 24 captions, 12 assigned captions, 4 overlap-review captions and all 7 existing checks passing. The Python 3.12.13 frozen backend separately completed offline CUDA analysis and clean shutdown in 39.484 seconds with an isolated system-only PATH. Its captions, word timings, speakers and duration matched the source turbo result; one mode-specific warning differed. These times cover different operations and are not a performance comparison. See [Nemotron evidence and limitations](NEMOTRON-SMOKE.md). This establishes synthetic source and bundled-backend integration, not real streamer quality, complete overlap recovery, installation or remote-update acceptance.
