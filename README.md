<p align="center"><img src="public/app-icon.png" width="88" alt="VOICESUBSEP logo" /></p>

# VOICESUBSEP

**Turn interviews, meetings and video into editable, speaker-aware subtitles.** VOICESUBSEP runs local speech recognition and speaker analysis by default, then gives you a timeline editor to check every result against the original media.

**인터뷰·회의·영상의 음성을 화자별 자막으로 만들고 직접 검수하세요.** VOICESUBSEP은 기본적으로 내 컴퓨터에서 음성 인식과 화자 분석을 실행하고, 원본을 들으며 결과를 고치는 타임라인 편집기를 제공합니다.

[![Download VOICESUBSEP for Windows](https://img.shields.io/badge/Download-Windows%20x64-6846e8?style=for-the-badge)](https://github.com/LiveTrack-X/VOICESUBSEP/releases/latest/download/VOICESUBSEP-0.3.5-Online-Setup-x64.exe)
[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-ffdd00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black)](https://buymeacoffee.com/livetrack)

[Windows 다운로드](https://github.com/LiveTrack-X/VOICESUBSEP/releases/latest/download/VOICESUBSEP-0.3.5-Online-Setup-x64.exe) · [모든 릴리즈](https://github.com/LiveTrack-X/VOICESUBSEP/releases) · [사용자 가이드](docs/USER-GUIDE.md) · [기능 현황과 제한](docs/FEATURE-STATUS.md)

## Made for careful subtitle work / 꼼꼼한 자막 작업을 위해

1. **Analyze / 분석:** Open a video or audio file. Local Whisper transcribes speech; local NVIDIA Nemotron estimates who spoke when. / 영상·음성 파일을 열면 로컬 Whisper가 대사를 전사하고 로컬 NVIDIA Nemotron이 화자 구간을 추정합니다.
2. **Review / 검수:** Play the original, follow captions on the timeline, rename speakers and edit text or timing. The unassigned-speaker review shows evidence and cautious suggestions; you choose which changes to apply. / 원본을 재생하며 타임라인 자막의 문장·시간·인물 이름을 고칩니다. 미배정 검토는 근거와 보수적 후보를 보여주며, 적용할 항목은 사용자가 선택합니다.
3. **Finish / 마무리:** Add time-linked editing notes, mark cuts, prepare interview transcripts or manual meeting notes, then export the formats your workflow needs. / 시간 메모와 컷을 정리하고 인터뷰 발언록이나 직접 작성한 회의록을 만든 뒤 필요한 형식으로 내보냅니다.

### What you can do / 주요 기능

- **Local-first transcription and diarization.** Choose speech language and local models. Optional cloud providers are separate and only receive audio after you select them and confirm. / **로컬 음성 인식·화자 분석.** 음성 언어와 로컬 모델을 선택합니다. 클라우드 공급자는 별도 선택과 전송 확인 후에만 음성을 받습니다.
- **A timeline-connected subtitle editor.** Adjust speaker, words and time; search or jump by text/time; review unassigned captions; resize the workspace; save editing notes and cut ranges. / **타임라인 연동 자막 편집기.** 화자·문장·시간 수정, 검색·시간 이동, 미배정 검토, 화면 크기 조절, 편집 메모와 컷 구간 저장을 지원합니다.
- **Interview and meeting workflows.** Arrange a speaker transcript by time, add interview answers and meeting notes yourself, and export documents or subtitles. Meeting summaries are not generated automatically. / **인터뷰·회의 작업.** 화자별 발언을 시간순으로 정리하고 인터뷰 답변과 회의 메모를 직접 작성해 문서·자막으로 내보냅니다. 회의 요약을 자동 작성하지는 않습니다.
- **Optional audio processing.** Preview local RNNoise or separately installed VST3 effects before deciding what to use. / **선택형 오디오 처리.** 로컬 RNNoise 또는 별도 설치한 VST3 효과를 미리 듣고 적용 여부를 정합니다.

## Get started / 시작하기

Download the [Windows x64 online setup](https://github.com/LiveTrack-X/VOICESUBSEP/releases/latest/download/VOICESUBSEP-0.3.5-Online-Setup-x64.exe) from the latest release. The helper downloads and verifies the multi-gigabyte app package; speech-model weights are downloaded separately when needed. Keep at least **16 GiB free** for setup, working data and models. A compatible NVIDIA driver is needed for NVIDIA GPU acceleration; CPU-only processing is available but can take longer.

[최신 릴리즈의 Windows x64 온라인 설치기](https://github.com/LiveTrack-X/VOICESUBSEP/releases/latest/download/VOICESUBSEP-0.3.5-Online-Setup-x64.exe)를 받으세요. 설치기가 수 GB 실행 패키지를 내려받아 검증합니다. 음성 모델 가중치는 필요할 때 별도로 받습니다. 설치·작업 파일·모델을 위해 **16GiB 이상 여유 공간**을 권장합니다. NVIDIA GPU 가속에는 호환 드라이버가 필요하며 CPU로도 처리할 수 있지만 시간이 더 걸릴 수 있습니다.

Windows 10/11 x64 is supported. The setup requires an internet connection and .NET Framework 4.8 or later. The Windows executables are not Authenticode-signed. **The source ZIP is for developers; it is not the installer.** / Windows 10/11 x64에서 사용할 수 있습니다. 설치에는 인터넷 연결과 .NET Framework 4.8 이상이 필요합니다. Windows 실행 파일은 Authenticode 서명을 사용하지 않습니다. **소스 ZIP은 개발자용이며 설치 파일이 아닙니다.**

## What to expect / 알아둘 점

Speech recognition and speaker labels are drafts: listen to the original before publishing. Quiet speech, overlapping voices, music and noise can cause misses or wrong assignments. Speaker diarization does not separate mixed audio or restore inaudible words. The new speaker-review suggestions are not automatic corrections, and real-audio accuracy gains have not been measured.

음성 인식과 화자 표시는 초안입니다. 공개하기 전에 원본을 확인하세요. 작은 목소리·겹친 대화·음악·잡음은 누락이나 오배정을 만들 수 있습니다. 화자 분석은 섞인 음성을 분리하거나 들리지 않는 말을 복원하지 않습니다. 새 미배정 검토 후보는 자동 수정이 아니며 실제 음성의 정확도 개선은 아직 측정하지 않았습니다.

Project files save edits and references, **not the original media**. Keep the source file and a separate project backup. / 프로젝트 파일에는 편집 내용과 참조 정보가 저장되며 **원본 미디어는 포함되지 않습니다.** 원본과 별도 프로젝트 백업을 함께 보관하세요.

## 0.3.5 / 변경 사항

Speaker-review evidence and conservative boundary suggestions, explicit selected-caption apply/undo, clearer native VST window states and focus controls, and direct repository links from the app header. See the [0.3.5 release record](docs/releases/v0.3.5.md) for package, verification and update status.

미배정 원인 근거와 보수적 경계 후보, 항목별 적용·실행 취소, VST 전용 창 상태와 앞으로 가져오기, 상단 로고의 저장소 링크를 추가했습니다. 패키지·검증·업데이트 상태는 [0.3.5 릴리즈 기록](docs/releases/v0.3.5.md)에서 확인하세요.

## Learn more / 더 알아보기

- [User guide / 사용자 가이드](docs/USER-GUIDE.md)
- [Feature status and remaining work / 기능 현황과 남은 작업](docs/FEATURE-STATUS.md)
- [All documentation / 문서 목차](docs/INDEX.md)
- [Speaker-assignment strategy / 화자 배정 개선 전략](docs/SPEAKER-ASSIGNMENT-STRATEGY.md)
- [Dependency notices and redistribution terms / 의존성 고지와 재배포 조건](docs/BUNDLED-NOTICES.md)
- [GitHub repository / GitHub 저장소](https://github.com/LiveTrack-X/VOICESUBSEP)

## Run from source / 소스에서 실행

Requires Node.js 22.12+, npm, uv and FFmpeg/FFprobe on `PATH`. Setup creates a Python 3.12 environment. Model weights are separate. This is for development; installer users do not need these tools.

Node.js 22.12 이상, npm, uv, `PATH`에 등록된 FFmpeg/FFprobe가 필요합니다. setup은 Python 3.12 환경을 준비합니다. 모델 가중치는 별도입니다. 개발 환경용이며 설치형 사용자는 아래 도구를 준비할 필요가 없습니다.

```powershell
powershell -NoProfile -File .\scripts\setup.ps1 -Check
powershell -NoProfile -File .\scripts\setup.ps1
npm start
```

See [development and release documentation](docs/INDEX.md#development-and-release--개발배포). / 자세한 개발·배포 문서는 [문서 목차](docs/INDEX.md#development-and-release--개발배포)를 참고하세요.
