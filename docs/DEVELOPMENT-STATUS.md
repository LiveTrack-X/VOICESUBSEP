# v0.1 development handoff — 2026-09-24

> Historical initial handoff: the runtime availability and test counts below describe the early implementation. Current Nemotron source/UI execution evidence and limitations are in [NEMOTRON-SMOKE.md](NEMOTRON-SMOKE.md); retain this document as the earlier record.

This is a working local editor and an initial analysis integration, not a validated Korean streamer transcription product. The repository is private. The new editing, meeting, and live-capture ideas are planned extensions, not completed features.

## Implemented

- React editor: local media preview/playback/seek; expected participants 1–4; standard/overlap mode; speaker names; caption text/time/speaker edits; split, merge, delete; review/search/speaker filters; source-time speaker lanes; undo/redo.
- Timecoded editing notes: text, range, type, completion; Markdown/CSV exports.
- Project JSON import/export and browser autosave. Original media must be reconnected after reload. Source media is not embedded in the project.
- SRT import, combined overlap-preserving export, per-speaker export, and unassigned-speaker export. Source gaps are preserved. Editor-specific colors/positions and NLE project interchange are not implemented.
- Loopback API: multipart upload, stream selection, byte-range media serving, persistent serialized inference jobs, cooperative cancellation, restart interruption handling, upload/request limits.
- Actual faster-whisper transcription and optional native Transformers Nemotron adapter. Engines are loaded lazily and sequentially. Ambiguous overlap assignments remain unassigned.
- Windows setup, combined development launcher, GitHub Actions tests/build.

## Verification performed

| Check | Result and scope |
| --- | --- |
| `npm test` | 35 domain tests + 7 launcher tests passed |
| `python -m pytest backend/tests -q` | 47 passed; one upstream Starlette/AnyIO deprecation warning |
| `npm run build` | TypeScript and Vite production build passed |
| Windows PowerShell 5.1 setup `-Check` | Passed; script contains only ASCII, so UTF-8 without BOM is safe here |
| `npm start` | Both servers started together: editor 5173, API 8787 |
| API health | FFmpeg, FFprobe, Whisper available; Nemotron not installed |
| Actual model | CPU Whisper tiny, 14.022-second synthesized English WAV: 6 captions, 25 timed words. See [smoke evidence](MODEL-SMOKE.md) for actual transcription errors and limits |
| Browser model path | Codex IAB: choose WAV → choose English/tiny/CPU → start → completed → apply → six unassigned captions → playback and elapsed time progression |
| Editing path | Sample edit, speaker reassignment, review filter/count changes, timestamp seek, add/edit timecoded note, refresh restoring edited text and notes |
| Regression checks | Filtering away selected caption disables delete/split. Ctrl+S commits focused time input before serializing; updated seek timestamp observed |
| Export | Generated SRT/CSV content covered by domain tests; browser export success state observed. IAB download-event watcher timed out, so an actual downloaded file was not independently verified in that browser |
| Browser errors | No console errors/warnings in the inspected stable session |

All model tests except the explicit tiny smoke use synthetic/mocked results. These numbers do not establish Korean, overlapping speech, long-video, GPU, or diarization quality. No user media was used for testing.

## Review fixes

- Hidden selected captions could be edited/deleted after filtering: commands now require a visible selected caption, and merge requires the adjacent caption to be visible too.
- Server disconnection could trap the user in a running analysis dialog: connection errors allow closing, and ordinary API requests have a timeout.
- Undoing a media change could leave different media connected: mismatching media names now disconnect the file and ask for re-linking.
- Ctrl+S could omit an in-progress time edit: blur/React state are flushed before serialization.
- Rapid page closure could lose the autosave debounce: pagehide and hidden-visibility handlers flush current state.
- Empty names while typing could make saved projects impossible to reopen: parser preserves empty names; exports supply defaults.
- Default API port collided with an existing unrelated application: changed to 8787 without stopping or modifying that application.

## Visual verification and intentional differences

Reference: [generated concept](design/editor-concept.png). This was adopted as an implementation reference; it was not separately approved by the user.

Browser method: Codex IAB through `cua_repl`, accessibility/DOM inspection plus rendered screenshots. A 1536×1024 desktop viewport matching the concept was requested; a 390×844 small viewport was also checked. The small viewport reported client/scroll width 375/375, with no horizontal page overflow. The normal in-app viewport was inspected at initial load. No Playwright fallback browser was used.

Both the concept and [latest saved browser screenshot](design/editor-preview.png) were inspected with `view_image`. Additional local QA screenshots are ignored under `tmp/`: `editor-final.png`, `editor-mobile.png`. IAB screenshot text is softer than the original design image, so typography checks also used computed CSS and accessible text. This is not pixel-exact visual proof.

| Comparison point | Concept evidence | Render and action |
| --- | --- | --- |
| Layout | Settings left; media/captions center; notes right; timeline below | Same hierarchy. Left rail 244px; notes 285px. Narrow screens stack notes beneath the editor |
| Typography | Korean sans, compact controls, larger caption text | Computed wordmark 20px and caption text 14px. Caption/note text enlarged after the first comparison |
| Palette | White panels, pale gray workspace, purple actions, four speaker colors | Same palette roles. Solid surfaces, no decorative gradients or stock imagery |
| Copy | General/overlap, participants, transcript/review, SRT, notes | Core workflow retained. `편집 노트`→`편집 메모`, `프로젝트 열기`→short visible `열기`, numbered names→A–D are deliberate; accessibility labels remain descriptive |
| Functional copy additions | Empty-state reference lacks running/error/edit states | Added source-locality/re-link text, overlap limitation, explicit review column, source-time label, new-project/undo/redo, export and progress dialogs. These describe real behavior |
| Media/icon treatment | Empty video with play affordance; line icons | Empty media remains empty. Lucide outline controls; generated concept is documentation only. Playback controls use a white strip for consistency with editor controls |
| Timeline | Four empty source-time lanes | Real caption blocks from project data; extra unassigned/detected voices retained. No simulated waveform |
| Spacing and responsiveness | Separate bordered panels and compact rows | Real editor panels retain that structure; notes header alignment and small-screen icon labels were repaired |

Above-the-fold copy comparison: additions/renames are the deliberate functional differences listed above and in [design tokens](design/DESIGN-SYSTEM.md). No marketing sections or simulated analysis result were added. The sample is explicitly labeled and only loads on user action.

The implementation was checked against the adopted design for the layout, palette, typography, icon family, copy, and source-time editing interaction. It is a functional adaptation with the listed differences; no pixel-perfect equivalence or independent design sign-off is claimed.

## Remaining limits

- Nemotron adapter and CUDA path are not exercised with actual model weights. Real overlapping voices are not separated; missed speech is not reconstructed.
- Analysis-dialog job restoration after browser reload is not implemented. Jobs/results remain on disk, but the UI currently starts a new analysis after reconnecting the source. Do not reload during a job you intend to apply.
- Filenames identify re-linked sources in v0.1, not content hashes. Users must choose the same original file. A source hash belongs in the next schema revision.
- Long-project UI performance, actual NLE imports, exports in a normal Chrome/Edge download flow, and a production installer need separate acceptance testing.
- Cutting/mixing, automatic interview/meeting documents, and live capture are future work. See the expansion and live-capture plans.
