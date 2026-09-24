# VOICESUBSEP 문서 안내

v0.2.0은 비공개 저장소의 Windows Preview 시험 릴리즈입니다. 설치 파일·배포·검증 상태는 [v0.2.0 릴리즈 기록](releases/v0.2.0.md)을 기준으로 확인합니다. 소스 기능 설명과 설치·배포 완료 여부는 별도로 기록합니다. 이번 Preview는 분할 자산을 검증·재조립하는 수동 설치이며 인앱 업데이트는 미구성 상태입니다.

## 처음 사용하는 경우

| 목적 | 문서 |
| --- | --- |
| 설치, 첫 분석, 프로젝트 저장, 자막 편집·출력, 오류 해결 | [사용자 가이드](USER-GUIDE.md) |
| 어떤 기능이 있고 무엇을 지원하지 않는지 빠르게 확인 | [README](../README.md) |
| 많은 자막, 복구, 파형, OBS 트랙, 작업 이력, 회의록, 녹음 | [편집·복구·녹음의 사용 흐름](EDITING-WORKFLOWS.md) |
| 컷 전후 시간, 번역 저장·내보내기 규칙 | [컷편집·다국어 계약](CUTS-AND-LANGUAGES.md) |
| CLEAR/RX 등 외부 VST3 전처리 연결과 지연 보정 | [VST 체인](VST-CHAIN.md) |
| 설정 JSON 백업·복원, 오류 로그 저장 | [설정과 오류 로그](SETTINGS-AND-LOGS.md) |

## 개발·운영·배포

- [Windows 설치형 구조, 빌드와 인앱 업데이트](DESKTOP.md)
- [모델 실행 환경](MODEL-SETUP.md), [GPU 모델과 Faster Whisper XXL의 차이](GPU-MODELS.md)
- [번들 의존성 원문 고지 보존 범위](BUNDLED-NOTICES.md)
- [v0.2.0 변경·한계·검증·산출물 기록](releases/v0.2.0.md)
- [디자인 시스템](design/DESIGN-SYSTEM.md)

개발 시작 명령과 테스트 명령은 [README의 개발 안내](../README.md#소스에서-개발-환경-실행)를 따릅니다. 설치 파일에는 모델 가중치, Ollama 모델, 상용 VST3 플러그인이 포함되지 않습니다.

## 이전 검증과 설계 기록

다음 문서는 기록 당시 버전의 근거 또는 설계 제안입니다. 현재 기능 전체의 완료·배포 증거로 읽지 않습니다.

- [v0.1 구현 계약·API](IMPLEMENTATION-CONTRACT.md), [초기 개발 상태](DEVELOPMENT-STATUS.md)
- [Whisper tiny 실측](MODEL-SMOKE.md), [Whisper GPU·데스크톱 실측](GPU-DESKTOP-VALIDATION.md), [Nemotron GPU·v0.1.1 번들 실측](NEMOTRON-SMOKE.md)
- [제품 설계](PRODUCT-DESIGN.md), [대안·동시 발화 분석](ALTERNATIVES-ANALYSIS.md)
- [컷·믹스·인터뷰·회의록 확장 제안](EXPANSION-ROADMAP.md), [라이브 캡처 제안](LIVE-CAPTURE-PLAN.md), [음성 전처리 제안](AUDIO-PREPROCESSING.md)

구현 동작이 궁금하면 사용자 가이드와 현재 계약을, 특정 설치 파일이 검증됐는지 궁금하면 해당 버전의 릴리즈 기록을 먼저 확인하세요.
