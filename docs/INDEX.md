# Documentation / 문서 안내

Start with the [0.3.2 release record](releases/v0.3.2.md) for the published Windows preview, verified downloads and local installation. Tests, frozen inference, public files and installed-profile checks have distinct limits; detailed engineering/history documents remain primarily Korean.

[0.3.2 릴리즈 기록](releases/v0.3.2.md)에서 공개 프리뷰·검증된 다운로드·로컬 설치를 확인하세요. 테스트·동결 추론·공개 파일·설치 프로필 검사 범위는 구분하며 상세 기술·과거 문서는 한국어 중심입니다.

**Earlier 0.3.1 is preserved.** It adds continuous scrolling, theme/language controls, speaker-colored transcripts, improved preview layout, local Whisper AUTO language retention, background job status and queue/cache controls. See the [release record](releases/v0.3.1.md) for exact scope and artifacts.

**이전 0.3.1 기록을 보존합니다.** 연속 스크롤·테마/언어 조작·인물 색 발언록·미리보기 배치·로컬 Whisper AUTO 언어 유지·백그라운드 작업 상태·대기열/캐시 조작을 개선했습니다. 정확한 범위·파일은 [릴리즈 기록](releases/v0.3.1.md)을 확인하세요.

**0.3.2 is published and locally installed.** The [release record](releases/v0.3.2.md) separates source/CI, frozen Whisper+Nemotron, public asset/signature checks and profile preservation. YTT upload/player rendering and real-broadcast acceptance remain unverified.

**0.3.2를 공개하고 로컬 설치했습니다.** [릴리즈 기록](releases/v0.3.2.md)에서 소스·CI, 동결 Whisper+Nemotron, 공개 파일·명세 서명, 프로필 보존 증거를 구분합니다. YTT 업로드·플레이어 표시·실방송 수용 검증은 별도입니다.

## Users / 사용자

[0.3.3 preparation / 개발·검증 중인 0.3.3](releases/v0.3.3.md) documents native VST windows, built-in RNNoise, shortcut customization and editing fixes. Publication and installation are tracked separately. / VST 전용 창·내장 RNNoise·단축키·편집 개선의 구현과 게시·설치를 구분합니다.

| Purpose / 목적 | Document / 문서 |
| --- | --- |
| 0.3.1 publication, verified installer and checksums / 0.3.1 게시 상태·설치 검증·체크섬 | [0.3.1 release record / 릴리즈 기록](releases/v0.3.1.md) |
| 0.3.2 publication, checksums and installation / 0.3.2 게시·체크섬·설치 | [0.3.2 release record / 릴리즈 기록](releases/v0.3.2.md) |
| Small EXE, speed limit, retry/cache, manual fallback / 작은 EXE·속도 제한·재시도·캐시·수동 대안 | [Online installer / 온라인 설치](ONLINE-INSTALLER.md) |
| Install, analyze, edit, export and recover / 설치·분석·편집·출력·복구 | [User guide / 사용자 가이드](USER-GUIDE.md) |
| Features and boundaries / 기능과 한계 | [README](../README.md) |
| Every requested feature and remaining gaps / 이전 요청별 구현·미완료 현황 | [Feature status / 기능 현황](FEATURE-STATUS.md) |
| Live captions, input selection and OBS overlay / 라이브 자막·입력 선택·OBS 표시 | [Current live workflow / 라이브 사용법](USER-GUIDE.md#8-라이브-자막마이크시스템-소리-녹음) |
| Source/output time, UI languages and original transcripts / 원본·출력 시간·화면 언어·원문 | [Cuts and languages / 컷·언어](CUTS-AND-LANGUAGES.md) |
| File/OBS mix, individual/solo preview and sample peaks / 파일·OBS 믹스·개별/솔로 미리듣기·샘플 피크 | [Audio mixer / 오디오 믹서](AUDIO-MIXER.md) |
| External VST3 chains and latency / 외부 VST3 체인·지연 | [VST chain / VST 체인](VST-CHAIN.md) |
| 0.3.2 YTT styled CC scope and YouTube verification limits / 0.3.2 YTT 스타일 CC 범위·YouTube 검증 한계 | [YouTube captions / YouTube 자막](YOUTUBE-CAPTIONS.md) |
| Settings backup and diagnostics / 설정 백업·진단 | [Settings and logs / 설정·로그](SETTINGS-AND-LOGS.md) |
| Optional Groq/xAI/Gemini speech recognition, keys and transmission / 선택적 Groq·xAI·Gemini 음성 인식·키·전송 | [Advanced providers / 고급 공급자](ADVANCED-PROVIDERS.md) |
| Optional cloud speaker intervals and limits / 선택적 클라우드 화자 구간·한도 | [Deepgram diarization / Deepgram 화자 구분](DEEPGRAM-DIARIZATION.md) |

## Development and release / 개발·배포

- [Run from source / 소스 실행](../README.md#소스에서-개발-환경-실행)
- [Desktop architecture, builds and updates / 설치형 구조·빌드·업데이트](DESKTOP.md)
- [Model setup / 모델 환경](MODEL-SETUP.md), [GPU models and Faster Whisper XXL / GPU 모델·XXL](GPU-MODELS.md)
- [Qwen source-only runtime, alignment and distribution audit / Qwen 개발 환경·정렬·배포 감사](QWEN-RUNTIME.md)
- [Dependency notices and distribution obligations / 의존성 고지·재배포 의무](BUNDLED-NOTICES.md)
- [0.3.1 runtime, installer and release evidence / 0.3.1 실행환경·설치·릴리즈 증거](releases/v0.3.1.md)
- [0.3.2 source validation and remaining acceptance / 0.3.2 소스 검증·남은 수용 확인](releases/v0.3.2.md)
- [Design system / 디자인 시스템](design/DESIGN-SYSTEM.md)

## Historical evidence and proposals / 과거 증거·설계 제안

These documents describe their own versions and dates; they are not proof that every proposed feature or a newer installer was verified.

다음 문서는 각 버전·시점의 기록이며 모든 제안 기능이나 이후 설치본의 검증을 뜻하지 않습니다.

**0.3.0 verified local scope:** the installed app reports `0.3.0.0`, the API reports `0.3.0`, its window/backend respond, and all 23 checked profile files were unchanged. Release commit `d03c887` passed [CI](https://github.com/LiveTrack-X/VOICESUBSEP/actions/runs/36117554010). Publication and checks on publicly downloaded artifacts are tracked separately in the release record. The default is local Whisper + Nemotron; weights and third-party VST plugins are separate. Live captions/OBS output and the signed-manifest GitHub updater are implemented. Manifest authentication is not Windows Authenticode signing. Subtitle translation and automatic text AI/Ollama remain removed. Read the [dependency notices](BUNDLED-NOTICES.md) before redistribution.

**0.3.0 로컬 검증:** 설치 앱 `0.3.0.0`·API `0.3.0`·창과 백엔드 응답, 프로필 파일 23개 보존을 확인했습니다. 릴리즈 커밋 `d03c887`의 [CI](https://github.com/LiveTrack-X/VOICESUBSEP/actions/runs/36117554010)도 통과했습니다. 게시·공개 다운로드 검사는 릴리즈 기록에서 별도로 확인합니다. 기본은 로컬 Whisper+Nemotron이며 가중치·외부 VST는 별도입니다. 라이브·OBS와 명세 서명 GitHub 업데이트를 구현했으며 명세 인증은 Windows Authenticode 서명이 아닙니다. 번역·텍스트 AI/Ollama는 제거했습니다. 재배포 전 [의존성 고지](BUNDLED-NOTICES.md)를 확인하세요.

- [v0.3.0 publication and original installation evidence / v0.3.0 공개·당시 설치 증거](releases/v0.3.0.md)
- [v0.2.0 release, original runtime and installer evidence / v0.2.0 릴리즈·기존 런타임·설치 파일 증거](releases/v0.2.0.md)
- [v0.2.1 local installation checkpoint and unpublished draft / v0.2.1 로컬 설치·미게시 초안](releases/v0.2.1.md)
- [Earlier 2026-09-25 source audit / 이전 소스 감사](BUG-AUDIT-2026-09-25.md), [its evidence snapshot / 당시 증거](evidence/source-audit-2026-09-25.json), [earlier editing workflows / 이전 편집 흐름](EDITING-WORKFLOWS.md) — current behavior and release status follow the guides above / 현행 사용법·배포 상태는 위 최신 안내 우선
- [v0.1 contract / v0.1 계약](IMPLEMENTATION-CONTRACT.md), [Early development / 초기 개발](DEVELOPMENT-STATUS.md)
- [Whisper tiny smoke / tiny 실측](MODEL-SMOKE.md), [GPU/desktop validation / GPU·데스크톱 실측](GPU-DESKTOP-VALIDATION.md), [Nemotron/v0.1.1 validation / Nemotron·v0.1.1 실측](NEMOTRON-SMOKE.md)
- [Product design / 제품 설계](PRODUCT-DESIGN.md), [Alternatives and overlap / 대안·동시 발화](ALTERNATIVES-ANALYSIS.md)
- [Expansion proposal / 확장 제안](EXPANSION-ROADMAP.md), [Live capture proposal / 라이브 제안](LIVE-CAPTURE-PLAN.md), [Preprocessing proposal / 전처리 제안](AUDIO-PREPROCESSING.md)
- [Original OBS live speaker-caption plan / 초기 OBS 라이브 설계](OBS-LIVE-CAPTIONS-PLAN.md) — partly implemented in 0.3.0; broader native routing remains a proposal / 0.3.0에서 일부 구현, 확장 네이티브 라우팅은 제안 범위
