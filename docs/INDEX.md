# Documentation / 문서 안내

Start with the bilingual user and online installer guides. Versioned evidence is separate from feature descriptions; see the release record for what was actually tested. Detailed engineering contracts and historical research are currently primarily Korean.

한·영 사용자 가이드와 온라인 설치 안내부터 확인하세요. 기능 설명과 실제 검증 증거를 구분하며 버전별 확인 범위는 릴리즈 기록을 따릅니다. 상세 구현 계약·과거 조사 문서는 현재 한국어 중심입니다.

## Users / 사용자

| Purpose / 목적 | Document / 문서 |
| --- | --- |
| Small EXE, speed limit, retry/cache, manual fallback / 작은 EXE·속도 제한·재시도·캐시·수동 대안 | [Online installer / 온라인 설치](ONLINE-INSTALLER.md) |
| Install, analyze, edit, export and recover / 설치·분석·편집·출력·복구 | [User guide / 사용자 가이드](USER-GUIDE.md) |
| Features and boundaries / 기능과 한계 | [README](../README.md) |
| Every requested feature and remaining gaps / 이전 요청별 구현·미완료 현황 | [Feature status / 기능 현황](FEATURE-STATUS.md) |
| Bulk captions, waveform, recovery, OBS, documents and recording / 일괄 자막·파형·복구·OBS·문서·녹음 | [Editing workflows / 편집 흐름](EDITING-WORKFLOWS.md) |
| Source/output time and translation contracts / 원본·출력 시간과 번역 규칙 | [Cuts and languages / 컷·언어](CUTS-AND-LANGUAGES.md) |
| External VST3 chains and latency / 외부 VST3 체인·지연 | [VST chain / VST 체인](VST-CHAIN.md) |
| Settings backup and diagnostics / 설정 백업·진단 | [Settings and logs / 설정·로그](SETTINGS-AND-LOGS.md) |
| Optional Groq/xAI processing, keys and data transmission / 선택적 Groq·xAI 처리·키·데이터 전송 | [Advanced providers / 고급 공급자](ADVANCED-PROVIDERS.md) |

The public Windows v0.2.1 Preview requires no GitHub login. Speech weights, optional Ollama/text models and third-party VST plugins are separate. The online helper downloads the existing app payload; the app's update feed remains unconfigured. Read the [dependency notices](BUNDLED-NOTICES.md) before redistribution.

공개 Windows v0.2.1 Preview는 GitHub 로그인이 필요하지 않습니다. 음성 가중치·선택적 Ollama/텍스트 모델·외부 VST는 별도입니다. 온라인 도우미는 기존 앱 데이터를 받으며 앱의 업데이트 feed는 미구성 상태입니다. 재배포 전 [의존성 고지](BUNDLED-NOTICES.md)를 확인하세요.

## Development and release / 개발·배포

- [Run from source / 소스 실행](../README.md#소스에서-개발-환경-실행)
- [Desktop architecture, builds and updates / 설치형 구조·빌드·업데이트](DESKTOP.md)
- [Model setup / 모델 환경](MODEL-SETUP.md), [GPU models and Faster Whisper XXL / GPU 모델·XXL](GPU-MODELS.md)
- [Dependency notices and distribution obligations / 의존성 고지·재배포 의무](BUNDLED-NOTICES.md)
- [v0.2.1 release and verification / v0.2.1 릴리즈·검증](releases/v0.2.1.md)
- [Design system / 디자인 시스템](design/DESIGN-SYSTEM.md)

## Historical evidence and proposals / 과거 증거·설계 제안

These documents describe their own versions and dates; they are not proof that every proposed feature or a newer installer was verified.

다음 문서는 각 버전·시점의 기록이며 모든 제안 기능이나 이후 설치본의 검증을 뜻하지 않습니다.

- [v0.2.0 release, original runtime and installer evidence / v0.2.0 릴리즈·기존 런타임·설치 파일 증거](releases/v0.2.0.md)
- [v0.1 contract / v0.1 계약](IMPLEMENTATION-CONTRACT.md), [Early development / 초기 개발](DEVELOPMENT-STATUS.md)
- [Whisper tiny smoke / tiny 실측](MODEL-SMOKE.md), [GPU/desktop validation / GPU·데스크톱 실측](GPU-DESKTOP-VALIDATION.md), [Nemotron/v0.1.1 validation / Nemotron·v0.1.1 실측](NEMOTRON-SMOKE.md)
- [Product design / 제품 설계](PRODUCT-DESIGN.md), [Alternatives and overlap / 대안·동시 발화](ALTERNATIVES-ANALYSIS.md)
- [Expansion proposal / 확장 제안](EXPANSION-ROADMAP.md), [Live capture proposal / 라이브 제안](LIVE-CAPTURE-PLAN.md), [Preprocessing proposal / 전처리 제안](AUDIO-PREPROCESSING.md)
- [OBS live speaker-caption plan / OBS 실시간 인물별 자막 계획](OBS-LIVE-CAPTIONS-PLAN.md) — separate future unit, not v0.2.1 functionality / 별도 후속 단위, v0.2.1 기능 아님
