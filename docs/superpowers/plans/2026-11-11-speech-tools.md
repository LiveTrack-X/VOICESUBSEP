# Project speech tools implementation plan

> **For agentic workers:** use the selected user scope and isolated file ownership; verify each feature with focused tests, then review the integrated result.

**Goal:** Add a portable project vocabulary, acoustic reference-based suggestions for unassigned speakers, and experimental local separation/retranscription of a selected overlapping interval.

**Architecture:** Keep vocabulary in the project and pass supported hints through existing analysis adapters. Store voice-reference source metadata in the project, never inferred names or audio embeddings. Run explicitly prepared acoustic tools in one cancellable, contained worker process. Preserve original media and all existing captions until explicit, stale-checked user application.

**Tech stack:** existing React/TypeScript, FastAPI and isolated analysis IPC; WeSpeaker ONNX with Kaldi fbank; optional SpeechBrain SepFormer and matching torchaudio; local faster-whisper.

## Accepted scope

The user selected these three features after reviewing the recommendations. Routine interface/model choices are resolved here without another generic approval round. Existing uncommitted caption split/merge work is preserved. Publication, a new installer and claims of real-world accuracy are outside this implementation.

- Vocabulary: optional project `vocabulary`, up to 50 plain terms, 50 characters per term, 2,000 joined characters. No automatic replacements. Supported hint paths: Whisper, Qwen, bounded Groq and xAI 2.0. Unsupported paths are visible. Preserve word times and explicit cloud consent.
- Voice references: explicit user-confirmed, reviewed single-speaker captions, 3–15 seconds, source identity/track/range/text snapshots. Compare unedited/unreviewed unassigned clean targets, 1.5–15 seconds, against at least two enrolled speakers. Raw cosine and margin are experimental policy gates, never probabilities. User selects suggestions; undo is available.
- Overlap: one 2–20 second interval, two unordered source streams, 8kHz English-trained SepFormer, local CPU Whisper transcription, original-source time offsets. Listen to original and separated outputs, inspect candidates, explicitly append chosen candidates. Preserve originals and manual edits; never infer stream identity.
- Prepare pinned weights only on explicit preparation action. Validate immutable revision, size and SHA-256. No model code or remote YAML execution. Optional dependencies report unavailable truthfully. Cancel/shutdown reaps owned workers; active sources have a cache lease; regular/live work and tools cannot race.

## Tasks

- [x] Implement vocabulary persistence, editor, analysis validation and supported adapters, with legacy/malformed/provider/queue snapshot tests.
- [x] Implement pinned WeSpeaker preparation, exact feature extraction and acoustic comparison with quality/threshold tests.
- [x] Implement pinned SepFormer preparation, audited strict checkpoint loading, bounded extraction, two-source output and source-time retranscription tests.
- [x] Implement independent speech-tool API/queue using contained worker IPC, status/preparation/cancel/audio endpoints and lifecycle/cache guards.
- [x] Implement voice-reference project metadata and stale-safe candidate application; add project dialog for references and overlap experiments.
- [x] Add dependency/notices/provenance/setup documentation; preserve existing distribution gates.
- [x] Run focused and full tests, TypeScript/build, isolated rendered UI checks and actual short local model smoke if dependencies/weights can be prepared.
- [x] Review requirements and code, correct issues, report exactly what was verified and remaining real-audio/release limits.

Validation: frontend 959 passed, backend 1,189 passed / 1 skipped, Node 84 passed, production web build and selected runtime notice inventory passed. Real model execution was checked with local synthetic voices. The overlap trial did **not** recover the Korean phrase; quality remains experimental. See `docs/evidence/speech-tools-source-validation.json` and `docs/SPEECH-TOOLS.md`. No installer or release was produced.
