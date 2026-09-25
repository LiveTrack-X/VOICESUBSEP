# VOICESUBSEP

**Speaker-aware subtitles, editing notes, interviews, and manual meeting notes, with local processing by default.** Local Whisper transcribes speech; local NVIDIA Nemotron identifies speaker activity. Advanced settings offer opt-in Groq, xAI or Gemini speech recognition and Deepgram diarization. You review the text and speaker assignments while listening to the original media.

**로컬 처리가 기본인 인물별 자막·편집 메모·인터뷰·수동 회의록 편집기입니다.** 로컬 Whisper가 내용을 전사하고 로컬 NVIDIA Nemotron이 화자 활동을 분석합니다. Groq·xAI·Gemini 음성 인식과 Deepgram 화자 구분은 고급 설정에서 직접 선택할 때만 사용합니다. 원본을 들으며 자막과 인물 배정을 검수합니다.

[Public Windows v0.2.0 Preview / 공개 설치본](https://github.com/LiveTrack-X/VOICESUBSEP/releases/tag/v0.2.0) · [User guide / 사용자 가이드](docs/USER-GUIDE.md) · [Documentation / 문서 목차](docs/INDEX.md)

**Release status checked 2026-09-25:** v0.2.0 is public. v0.2.1 has a prior local installation checkpoint and an unpublished GitHub draft with no assets. The features below describe the current source; newer changes have **not been distributed or installed**. See [feature status](docs/FEATURE-STATUS.md), [the bug audit](docs/BUG-AUDIT-2026-09-25.md) and [the v0.2.1 checkpoint record](docs/releases/v0.2.1.md).

**2026-09-25 확인:** 공개 설치본은 v0.2.0입니다. v0.2.1은 이전 로컬 설치 검증과 자산 없는 GitHub 초안만 있습니다. 아래는 현재 소스 기능이며, 이후 변경은 **배포·설치되지 않았습니다**. [기능 현황](docs/FEATURE-STATUS.md)·[버그 감사](docs/BUG-AUDIT-2026-09-25.md)·[설치 검증 기록](docs/releases/v0.2.1.md)을 구분해 확인하세요.

Read [dependency notices and distribution obligations / 의존성 고지·재배포 의무](docs/BUNDLED-NOTICES.md) before redistributing. Public source access does not grant a permissive app license. / 재배포 전 고지를 확인하세요. 소스 공개가 앱에 자유로운 재배포 라이선스를 부여하지는 않습니다.

## Install / 설치

The public **v0.2.0** release requires no GitHub login. Its small [online setup EXE](https://github.com/LiveTrack-X/VOICESUBSEP/releases/download/v0.2.0/VOICESUBSEP-0.2.0-Online-Setup-x64.exe) downloads the existing installer and three data parts, verifies SHA256, assembles the payload, and opens the installation wizard. See the [online installer guide](docs/ONLINE-INSTALLER.md) for download controls and the seven-file manual fallback. The source-code ZIP is not the installer; there is no public v0.2.1 installer download yet.

공개 **v0.2.0**은 GitHub 로그인 없이 받을 수 있습니다. 위 작은 EXE가 기존 설치 프로그램과 데이터 조각 3개를 다운로드하고 SHA256 검증·재조립 후 설치 마법사를 엽니다. 다운로드 조절·7개 파일 수동 설치 방법은 [온라인 설치 안내](docs/ONLINE-INSTALLER.md)를 확인하세요. 소스 코드 ZIP은 설치 파일이 아니며 v0.2.1 공개 설치 다운로드는 아직 없습니다.

| Requirement / 항목 | Details / 내용 |
| --- | --- |
| System / 운영체제 | Windows 10/11 x64, .NET Framework 4.8 for the online setup / 온라인 설치기에 .NET Framework 4.8 필요 |
| Download / 다운로드 | About 2.42 GB of application data; model weights are separate / 앱 데이터 약 2.42GB, 모델 가중치 별도 |
| Storage / 저장 공간 | At least 16 GiB free recommended; 12 GiB cache-drive minimum checked, plus room for models/projects / 16GiB 이상 권장, 캐시 드라이브 최소 12GiB 검사, 모델·프로젝트 공간 추가 |
| Included / 포함 | Python, FFmpeg, speech-analysis libraries, CUDA runtime libraries / Python·FFmpeg·음성 분석 라이브러리·CUDA 런타임 |
| Separate / 별도 준비 | NVIDIA driver, Whisper/Nemotron weights and VST3 plugins / NVIDIA 드라이버·Whisper/Nemotron 가중치·VST3 플러그인 |

This is an **unsigned Preview**. The online setup downloads the existing installer; it does not configure in-app updates. The app's update feed remains `unconfigured`. Public artifact checksums and limits are in the [v0.2.0 release record](docs/releases/v0.2.0.md). The separate [v0.2.1 record](docs/releases/v0.2.1.md) describes a local checkpoint, not a public update.

**코드 서명 없는 Preview**입니다. 온라인 설치기는 기존 설치 파일을 받는 도구이며 인앱 업데이트를 설정하지 않습니다. 앱의 업데이트 feed는 계속 `unconfigured`입니다. 공개 파일의 체크섬·한계는 [v0.2.0 기록](docs/releases/v0.2.0.md), 별도의 로컬 설치 checkpoint는 [v0.2.1 기록](docs/releases/v0.2.1.md)에 있습니다.

The development app/backend still report 0.2.1; that version string does not identify all current source changes as installed. Recognition previews show the latest two completed segments and elapsed time, without applying unfinished captions. / 개발 앱·백엔드의 0.2.1 표시가 현재 소스 전체의 설치를 뜻하지는 않습니다. 전사 미리보기는 최근 완료 구간 두 개와 경과 시간을 보여주며 미완성 자막을 적용하지 않습니다.

The helper defaults to **80 Mbps**; choose 40 Mbps or unlimited as needed. This limit applies only to setup downloads. / 도우미의 기본 제한은 **80Mbps**이며 40Mbps·제한 없음도 선택할 수 있습니다. 이 제한은 설치 파일 다운로드에만 적용합니다.

## Features / 기능

| English | 한국어 |
| --- | --- |
| Three clear entry points: Subtitles & video, Interviews & minutes, and Recording; the project is shared across these workflows | 자막·영상 편집 / 인터뷰·회의록 / 녹음 진입점 구분, 같은 프로젝트의 작업 내용 유지 |
| Local large-v3 / large-v3-turbo transcription, AUTO or explicit speech language, Nemotron diarization, isolated OBS track-to-speaker mapping | 로컬 large-v3 / large-v3-turbo 전사, AUTO·직접 음성 언어 선택, Nemotron 화자 구분, OBS 분리 트랙→인물 연결 |
| Speaker names, colors and subtitle styles; timeline playback, notes, waveform and boundary adjustment | 인물 이름·색·자막 스타일, 타임라인 재생·메모·파형·경계 조절 |
| 100-row pages, bulk edits, literal find/replace, autosave recovery and job history | 100행 페이지, 일괄 편집·문자열 치환, 자동 저장 복구·작업 이력 |
| Non-destructive cuts; MP4/WAV/MP3/M4A rendering; source frame rate, 30 or 60 fps | 원본을 보존하는 컷, MP4/WAV/MP3/M4A 렌더, 원본 프레임률·30·60fps |
| Local FFmpeg mixer: up to 16 file/OBS audio tracks, gain, offset, mute, limiter, project cuts and export history | 최대 16개 파일·OBS 오디오 트랙의 음량·시간 이동·음소거·리미터·프로젝트 컷·출력 이력을 지원하는 로컬 FFmpeg 믹서 |
| SRT, styled ASS, speaker SRT ZIP, editing notes and project JSON export | SRT·스타일 ASS·인물별 SRT ZIP·편집 메모·프로젝트 JSON 출력 |
| Original transcripts, interview Q&A and manual meeting notes as DOCX/TXT/HTML/XLSX; reports preserve source evidence and review state | 원문 발언록·인터뷰 문답·수동 회의 메모를 DOCX/TXT/HTML/XLSX로 출력하고 근거·검수 상태 보존 |
| Direct desktop PDF save via a native save dialog; browser fallback uses print/save-as-PDF | 설치형은 저장 창을 거쳐 직접 PDF 생성, 브라우저는 인쇄/PDF 저장 사용 |
| Korean, English, Japanese, Simplified Chinese and Spanish UI; original speech transcripts and manual evidence-linked meeting notes | 한·영·일·중국어 간체·스페인어 UI, 원문 발언록과 근거를 연결한 수동 회의록 |
| Microphone/system recording with local chunk recovery, followed by analysis after recording stops | 마이크·시스템 녹음과 로컬 조각 복구, 녹음 종료 후 분석 |
| Up to four installed VST3 effects before analysis, reported-latency compensation, A/B preview, settings and error logs | 설치된 VST3 최대 4개 분석 전처리, 보고 지연 보정·A/B 비교·설정·오류 로그 |

Detailed workflows: [editing and recovery](docs/EDITING-WORKFLOWS.md), [audio mixer](docs/AUDIO-MIXER.md), [cuts and languages](docs/CUTS-AND-LANGUAGES.md), [VST](docs/VST-CHAIN.md), [settings and logs](docs/SETTINGS-AND-LOGS.md).

자세한 흐름은 [편집·복구](docs/EDITING-WORKFLOWS.md), [오디오 믹서](docs/AUDIO-MIXER.md), [컷·언어](docs/CUTS-AND-LANGUAGES.md), [VST](docs/VST-CHAIN.md), [설정·로그](docs/SETTINGS-AND-LOGS.md)에 있습니다.

## Limits and local data / 한계와 로컬 데이터

- **Diarization is not voice separation.** Mixed overlapping voices may remain unassigned or incomplete. `4+` means at least four expected speakers; detected speakers 5–8 are retained, not merged into four. Automatic numbers need human naming.
- **화자 구분은 음원 분리가 아닙니다.** 섞인 동시 발화는 미배정·누락될 수 있습니다. `4명 이상`은 최소 4명이며 검출된 5~8명을 4명으로 합치지 않습니다. 자동 번호의 실제 이름은 직접 지정합니다.
- Recording is analyzed **after stopping**. Streaming ASR, stable live speaker IDs, arbitrary WASAPI output selection and automatic clock-drift correction are not implemented. Mixer offsets do not automatically move captions; its stereo result is not an editable multitrack session.
- 녹음은 **종료 후 분석**합니다. 스트리밍 ASR·라이브 화자 ID 고정·임의 WASAPI 출력 선택·자동 시계 드리프트 보정은 미구현입니다. 믹서의 시간 이동은 자막을 자동 이동하지 않으며 결과는 편집용 멀티트랙 세션이 아닌 스테레오 파일입니다.
- Project JSON contains edits, not the original media. Keep both and reconnect the same source when reopening. Autosave is local to the app/browser profile; save a separate JSON backup.
- 프로젝트 JSON에는 편집 내용만 들어가며 원본 미디어는 없습니다. 둘 다 보관하고 재열기 때 같은 원본을 연결하세요. 자동 저장은 앱/브라우저 프로필에 남으므로 별도 JSON도 저장하세요.
- Local processing is the default. Choosing a cloud provider and confirming the request sends the selected audio to that provider and may incur API charges. Keys are held only in the running backend session, not projects or settings backups. See [advanced providers](docs/ADVANCED-PROVIDERS.md).
- 기본은 로컬 처리입니다. 클라우드 공급자를 선택하고 전송을 확인하면 선택한 음성을 해당 공급자에게 보내며 API 비용이 발생할 수 있습니다. 키는 실행 중인 백엔드 세션에만 보관하고 프로젝트·설정 백업에 저장하지 않습니다. [고급 공급자 설정](docs/ADVANCED-PROVIDERS.md)과 [Deepgram 범위](docs/DEEPGRAM-DIARIZATION.md)를 확인하세요.
- Missing local speech models may download on first use. Commercial VST3 plugins such as CLEAR/RX are separate. Subtitle translation and automatic AI summaries have been removed; export the original transcript for use in an external LLM if desired. Ollama is not used.
- 로컬 음성 모델이 없으면 첫 사용 때 다운로드할 수 있습니다. CLEAR/RX 등 상용 VST3는 별도입니다. 자막 번역과 AI 자동 요약은 제거했으며 필요하면 원문 발언록을 외부 LLM에 직접 넣어 사용할 수 있습니다. Ollama는 사용하지 않습니다.
- Qwen3 ASR/forced alignment is a development-only source option. Its tokenizer license declarations conflict, so default desktop builds exclude it. Mock tests and tokenizer smoke do not establish real-model quality. See [Qwen runtime status](docs/QWEN-RUNTIME.md).
- Qwen3 ASR·시간 정렬은 개발 환경의 소스 선택 기능입니다. 토크나이저 라이선스 표시 불일치로 기본 설치본에서 제외하며 모의 검사·토큰화 확인이 실제 모델 품질 검증을 뜻하지 않습니다. [Qwen 상태](docs/QWEN-RUNTIME.md)를 확인하세요.

Use the app's job-history/storage dialog to remove unreferenced media copies. Referenced jobs/results are protected; source files you opened are not deleted. Recorded sessions and model caches have separate storage. See the [user guide](docs/USER-GUIDE.md).

작업 이력·저장 공간에서 참조가 풀린 미디어 사본을 정리합니다. 작업·결과가 참조하는 사본은 보호하며 사용자가 연 원본은 삭제하지 않습니다. 녹음 보관함과 모델 캐시는 별도입니다. [사용자 가이드](docs/USER-GUIDE.md)를 참고하세요.

## 소스에서 개발 환경 실행

**Run from source.** Requires Node.js 22.12+, npm, uv, and FFmpeg/FFprobe on PATH. Setup creates a Python 3.12 environment and may download dependencies; model weights are separate. This is not required for the Windows installer.

**개발 실행.** Node.js 22.12 이상·npm·uv와 PATH의 FFmpeg/FFprobe가 필요합니다. setup은 Python 3.12 환경을 준비하며 의존성을 다운로드할 수 있습니다. 모델 가중치는 별도입니다. 설치형 사용자는 이 과정이 필요하지 않습니다.

```powershell
powershell -NoProfile -File .\scripts\setup.ps1 -Check
powershell -NoProfile -File .\scripts\setup.ps1
npm start
```

Open [127.0.0.1:5173](http://127.0.0.1:5173); stop with Ctrl+C. `npm run dev` starts only the UI. See [model setup](docs/MODEL-SETUP.md) and [desktop build contracts](docs/DESKTOP.md). Run one backend per data directory; do not use multiple Uvicorn workers or reload against that directory.

[127.0.0.1:5173](http://127.0.0.1:5173)을 열고 Ctrl+C로 종료합니다. `npm run dev`는 화면만 실행합니다. [모델 환경](docs/MODEL-SETUP.md)과 [데스크톱 빌드 계약](docs/DESKTOP.md)을 참고하세요. 데이터 폴더마다 백엔드 하나만 실행하고 여러 Uvicorn worker·reload를 함께 사용하지 마세요.

```powershell
npm test
npm run typecheck
npm run build
.\.venv\Scripts\python.exe -m pytest backend\tests -q
npm run desktop:test
npm run desktop:smoke
```

Automated checks do not establish transcription accuracy, device recording quality, or installer deployment. [Release evidence](docs/releases/v0.2.1.md) separates those scopes. Source data defaults to `data/` (`VOICESUBSEP_DATA_DIR`); the upload limit defaults to 8 GiB (`VOICESUBSEP_MAX_UPLOAD_BYTES`). Desktop data lives outside the install folder. Third-party [notices and redistribution obligations](docs/BUNDLED-NOTICES.md) remain separate from app functionality.

자동 검사는 인식 정확도·장치 녹음 품질·설치 배포를 대신 입증하지 않습니다. [릴리즈 증거](docs/releases/v0.2.1.md)에서 범위를 구분합니다. 개발 데이터는 기본 `data/`(`VOICESUBSEP_DATA_DIR`), 업로드 제한은 기본 8GiB(`VOICESUBSEP_MAX_UPLOAD_BYTES`)입니다. 설치형 데이터는 설치 폴더 밖에 남습니다. 외부 의존성의 [고지·재배포 의무](docs/BUNDLED-NOTICES.md)는 앱 기능과 별도로 확인합니다.
