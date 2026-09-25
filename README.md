# VOICESUBSEP

**Speaker-aware subtitles, editing notes, interviews, and meeting minutes, with local processing by default.** Whisper transcribes speech; NVIDIA Nemotron identifies speaker activity. Optional advanced settings connect paid Groq/xAI APIs. You review the text and speaker assignments while listening to the original media.

**로컬 처리가 기본인 인물별 자막·편집 메모·인터뷰·회의록 편집기입니다.** Whisper가 내용을 전사하고 NVIDIA Nemotron이 화자 활동을 분석합니다. 고급 설정에서는 유료 Groq/xAI API를 선택적으로 연결합니다. 원본을 들으며 자막과 인물 배정을 검수합니다.

[Windows v0.2.1 Preview](https://github.com/LiveTrack-X/VOICESUBSEP/releases/tag/v0.2.1) · [User guide / 사용자 가이드](docs/USER-GUIDE.md) · [Documentation / 문서 목차](docs/INDEX.md)

**v0.2.1 improves editing in narrow windows:** more usable caption space, initially collapsed notes, and a compact focus view that temporarily folds the timeline. The desktop window can shrink to 480 px wide. / **v0.2.1은 좁은 창의 자막 편집을 개선합니다:** 자막 공간 확보, 메모 기본 접기, 작은 미리보기와 임시 타임라인 접기를 적용한 집중 보기를 제공합니다. 설치형 창은 너비 480px까지 줄일 수 있습니다.

Read [dependency notices and distribution obligations / 의존성 고지·재배포 의무](docs/BUNDLED-NOTICES.md) before redistributing. Public source access does not grant a permissive app license. / 재배포 전 고지를 확인하세요. 소스 공개가 앱에 자유로운 재배포 라이선스를 부여하지는 않습니다.

## Install / 설치

The public release requires no GitHub login. The small `VOICESUBSEP-0.2.1-Online-Setup-x64.exe` downloads the existing installer and three data parts, verifies SHA256, assembles the payload, and opens the installation wizard. See the [online installer guide](docs/ONLINE-INSTALLER.md) for publication status, download controls, and the seven-file manual fallback. The source-code ZIP is not the installer.

공개 릴리즈는 GitHub 로그인 없이 받을 수 있습니다. 작은 `VOICESUBSEP-0.2.1-Online-Setup-x64.exe`가 기존 설치 프로그램과 데이터 조각 3개를 다운로드하고 SHA256 검증·재조립 후 설치 마법사를 엽니다. 게시 상태·다운로드 조절·기존 7개 파일 수동 설치 방법은 [온라인 설치 안내](docs/ONLINE-INSTALLER.md)를 확인하세요. 소스 코드 ZIP은 설치 파일이 아닙니다.

| Requirement / 항목 | Details / 내용 |
| --- | --- |
| System / 운영체제 | Windows 10/11 x64, .NET Framework 4.8 for the online setup / 온라인 설치기에 .NET Framework 4.8 필요 |
| Download / 다운로드 | About 2.42 GB of application data; model weights are separate / 앱 데이터 약 2.42GB, 모델 가중치 별도 |
| Storage / 저장 공간 | At least 16 GiB free recommended; 12 GiB cache-drive minimum checked, plus room for models/projects / 16GiB 이상 권장, 캐시 드라이브 최소 12GiB 검사, 모델·프로젝트 공간 추가 |
| Included / 포함 | Python, FFmpeg, speech-analysis libraries, CUDA runtime libraries / Python·FFmpeg·음성 분석 라이브러리·CUDA 런타임 |
| Separate / 별도 준비 | NVIDIA driver, Whisper/Nemotron weights, optional Ollama models and VST3 plugins / NVIDIA 드라이버·Whisper/Nemotron 가중치·선택적 Ollama 모델·VST3 플러그인 |

This is an **unsigned Preview**. The online setup is a downloader for the existing installer; it does not configure in-app updates. The app's update feed remains `unconfigured`. Checksums, verification results, and limits are recorded in the [v0.2.1 release notes](docs/releases/v0.2.1.md); a new complete NSIS installation or GPU quality test is not implied by the online setup.

**코드 서명 없는 Preview**입니다. 온라인 설치기는 기존 설치 파일을 받는 도구이며 인앱 업데이트를 설정하지 않습니다. 앱의 업데이트 feed는 계속 `unconfigured`입니다. 체크섬·확인 결과·한계는 [v0.2.1 릴리즈 기록](docs/releases/v0.2.1.md)을 따르며 온라인 설치기 추가가 새로운 전체 NSIS 설치·GPU 품질 검증을 뜻하지 않습니다.

The app and backend are version 0.2.1. During transcription, the analysis dialog shows the latest two recognized segments as a draft, together with elapsed time. / 앱과 백엔드는 0.2.1입니다. 전사 중에는 분석 창에 최근 인식 구간 두 개를 초안으로 표시하고 경과 시간을 함께 보여줍니다.

The helper defaults to **80 Mbps**; choose 40 Mbps or unlimited as needed. This limit applies only to setup downloads. / 도우미의 기본 제한은 **80Mbps**이며 40Mbps·제한 없음도 선택할 수 있습니다. 이 제한은 설치 파일 다운로드에만 적용합니다.

## Features / 기능

| English | 한국어 |
| --- | --- |
| Three clear entry points: Subtitles & video, Interviews & minutes, and Recording; the project is shared across these workflows | 자막·영상 편집 / 인터뷰·회의록 / 녹음 진입점 구분, 같은 프로젝트의 작업 내용 유지 |
| Local large-v3 / large-v3-turbo transcription, AUTO or explicit speech language, Nemotron diarization, isolated OBS track-to-speaker mapping | 로컬 large-v3 / large-v3-turbo 전사, AUTO·직접 음성 언어 선택, Nemotron 화자 구분, OBS 분리 트랙→인물 연결 |
| Speaker names, colors and subtitle styles; timeline playback, notes, waveform and boundary adjustment | 인물 이름·색·자막 스타일, 타임라인 재생·메모·파형·경계 조절 |
| 100-row pages, bulk edits, literal find/replace, autosave recovery and job history | 100행 페이지, 일괄 편집·문자열 치환, 자동 저장 복구·작업 이력 |
| Non-destructive cuts; MP4/WAV/MP3/M4A rendering; source frame rate, 30 or 60 fps | 원본을 보존하는 컷, MP4/WAV/MP3/M4A 렌더, 원본 프레임률·30·60fps |
| SRT, styled ASS, speaker SRT ZIP, editing notes and project JSON export | SRT·스타일 ASS·인물별 SRT ZIP·편집 메모·프로젝트 JSON 출력 |
| Interview/meeting HTML reports, PDF through print preview, and genuine Excel workbooks with transcript/action/evidence sheets | 인터뷰·회의 HTML 보고서, 인쇄 미리보기의 PDF 저장, 대사·할 일·근거 시트의 실제 Excel 통합문서 |
| Chronological speaker transcripts as editable Word DOCX, UTF-8 TXT or HTML, with optional timestamps and no AI generation required | 시간순 인물: 발언 형식의 Word DOCX·UTF-8 TXT·HTML, 시간 표시 선택, AI 생성 없이 바로 출력 |
| Korean, English, Japanese, Simplified Chinese and Spanish UI; local Ollama or optional Groq/xAI subtitle translation and evidence-linked meeting drafts | 한·영·일·중국어 간체·스페인어 UI, 로컬 Ollama 또는 선택적 Groq/xAI 자막 번역·근거 회의록 초안 |
| Microphone/system recording with local chunk recovery, followed by analysis after recording stops | 마이크·시스템 녹음과 로컬 조각 복구, 녹음 종료 후 분석 |
| Up to four installed VST3 effects before analysis, reported-latency compensation, A/B preview, settings and error logs | 설치된 VST3 최대 4개 분석 전처리, 보고 지연 보정·A/B 비교·설정·오류 로그 |

Detailed workflows: [editing and recovery](docs/EDITING-WORKFLOWS.md), [cuts and translation](docs/CUTS-AND-LANGUAGES.md), [VST](docs/VST-CHAIN.md), [settings and logs](docs/SETTINGS-AND-LOGS.md). These detailed contracts are currently primarily Korean.

자세한 흐름은 [편집·복구](docs/EDITING-WORKFLOWS.md), [컷·번역](docs/CUTS-AND-LANGUAGES.md), [VST](docs/VST-CHAIN.md), [설정·로그](docs/SETTINGS-AND-LOGS.md)에 있습니다. 이 상세 계약 문서는 현재 한국어 중심입니다.

## Limits and local data / 한계와 로컬 데이터

- **Diarization is not voice separation.** Mixed overlapping voices may remain unassigned or incomplete. `4+` means at least four expected speakers; detected speakers 5–8 are retained, not merged into four. Automatic numbers need human naming.
- **화자 구분은 음원 분리가 아닙니다.** 섞인 동시 발화는 미배정·누락될 수 있습니다. `4명 이상`은 최소 4명이며 검출된 5~8명을 4명으로 합치지 않습니다. 자동 번호의 실제 이름은 직접 지정합니다.
- Recording is analyzed **after stopping**. Streaming ASR, stable live speaker IDs, external-audio clock-drift correction and final multitrack audio mixing are not implemented.
- 녹음은 **종료 후 분석**합니다. 스트리밍 ASR·라이브 화자 ID 고정·외부 오디오 시계 드리프트 보정·최종 다중 트랙 믹스는 미구현입니다.
- Project JSON contains edits, not the original media. Keep both and reconnect the same source when reopening. Autosave is local to the app/browser profile; save a separate JSON backup.
- 프로젝트 JSON에는 편집 내용만 들어가며 원본 미디어는 없습니다. 둘 다 보관하고 재열기 때 같은 원본을 연결하세요. 자동 저장은 앱/브라우저 프로필에 남으므로 별도 JSON도 저장하세요.
- Local processing is the default. Choosing a cloud provider and confirming the request sends the selected audio or transcript text to that provider and may incur API charges. Keys are held only in the running backend session, not projects or settings backups. See [advanced providers](docs/ADVANCED-PROVIDERS.md).
- 기본은 로컬 처리입니다. 클라우드 공급자를 선택하고 전송을 확인하면 선택한 음성 또는 전사 텍스트를 해당 공급자에게 보내며 API 비용이 발생할 수 있습니다. 키는 실행 중인 백엔드 세션에만 보관하고 프로젝트·설정 백업에 저장하지 않습니다. [고급 공급자 설정](docs/ADVANCED-PROVIDERS.md)을 확인하세요.
- Missing local speech models may download on first use. Ollama and its text models, and commercial VST3 plugins such as CLEAR/RX, are separate. Translation and minutes require human review.
- 로컬 음성 모델이 없으면 첫 사용 때 다운로드할 수 있습니다. Ollama·텍스트 모델·CLEAR/RX 등 상용 VST3는 별도이며 번역·회의록은 검수가 필요합니다.

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
