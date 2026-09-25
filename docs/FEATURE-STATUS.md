# Feature status / 요청 기능 현황

Audited against the v0.2.1 source on 2026-09-25. **Not every proposal is implemented.** Implemented means code and a usable path exist; it does not establish real-device quality, paid-provider access or semantic accuracy. Publication and local installation are recorded separately in the [release record](releases/v0.2.1.md).

2026-09-25 v0.2.1 소스를 이전 요청과 대조했습니다. **모든 제안이 구현된 것은 아닙니다.** `구현`은 코드와 사용 경로가 있다는 뜻이며, 실제 장치 품질·유료 계정 접근·인식 정확도 보증이 아닙니다. 게시·로컬 설치는 [릴리즈 기록](releases/v0.2.1.md)을 따릅니다.

## Editing / 자막 편집

| Request / 요청 | Status / 상태 | Actual scope / 실제 범위 |
| --- | --- | --- |
| Subtitle editor as main pane / 자막 중심 화면 | Implemented / 구현 | Compact preview beside captions on wide windows; narrow default focus, adjustable preview, collapsed notes and adjustable timeline / 넓은 창은 미리보기 옆 자막, 좁은 창은 기본 집중 보기·미리보기 높이·메모 접기·타임라인 조절 |
| Timeline click → caption and playback / 타임라인 클릭→자막·재생 | Implemented / 구현 | Seeks, selects and reveals caption; playback requires connected original media / 시간 이동·자막 선택·스크롤, 재생에는 원본 연결 필요 |
| Names, colors, individual styles / 인물 이름·색·개별 스타일 | Implemented / 구현 | Speaker defaults and individual cue overrides; ASS preserves styles, plain SRT does not / 인물별 기본값·개별 자막 덮어쓰기, ASS 스타일 전달·SRT는 글자와 시간만 |
| Fullscreen / 전체 화면 | Implemented with fallback / 대안 포함 구현 | Native request with in-app expanded fallback; embedded-browser native fullscreen is not guaranteed / 네이티브 요청 실패 시 앱 안 확대 |
| Editing notes on timeline / 편집 메모·타임라인 | Implemented / 구현 | Timed point/range, category, completion and jump-to-card / 시점·범위·분류·완료·메모 카드 이동 |
| Audio files MP3/M4A/etc. / 음성 파일 | Implemented / 구현 | FFmpeg/FFprobe analysis; browser preview depends on codec support / 오디오 분석 지원, 미리보기는 브라우저 코덱에 따름 |
| Simple cuts and actual output / 간단 컷·파일 출력 | Implemented / 구현 | Non-destructive exclusions, kept-range preview, MP4/WAV/MP3/M4A rendering and output-time SRT/notes / 원본 보존 제외·미리보기·렌더·편집본 시간 자막과 메모 |
| Arbitrary audio track mixing / 여러 파일·트랙 합치기 | Partial / 부분 | Recorder mixes microphone+system; file rendering selects one audio track. No track mixer with gain/mute / 녹음 두 소스 혼합만 가능, 파일 렌더는 한 트랙 선택 |
| Cutback-like automation / Cutback 수준 자동 편집 | Not implemented / 미구현 | No Premiere plug-in, clip rearrangement/transitions, automatic silence/filler removal or complete NLE / 프리미어 플러그인·클립 재배열·전환·자동 무음/군더더기 제거 없음 |
| Undo, bulk editing, search/replace / 실행 취소·일괄 수정·치환 | Implemented / 구현 | Bounded undo, 100-row pages, literal replacement and review navigation / 제한된 실행 취소·100행 페이지·문자열 치환·검수 이동 |
| New project retains names / 새 프로젝트 이름 잔존 | Main reset fixed / 주요 경로 수정 | New/open/sample project changes reset session/undo. Old job results cannot silently apply to another project / 프로젝트 전환 시 세션·실행 취소 분리 |
| Expected one speaker shows two / 예상 1명인데 두 인물 | Partial cleanup / 부분 정리 | Sidebar shows actual assigned speakers and explicit undoable merge. Interview role list can still show unused prepared speakers / 사이드바 실제 인물·명시적 통합 지원, 인터뷰 역할 목록에 미사용 준비 인물이 남을 수 있음 |
| App and internal icons / 앱·내부 아이콘 | Implemented / 구현 | Shared brand asset, favicon and Windows icon; OS icon cache can affect display / 브랜드·파비콘·Windows 아이콘 통일, OS 캐시 영향 가능 |

Sources / 근거: [App](../src/App.tsx), [editor layout](../src/workspace-layout.css), [speaker operations](../src/speakerOperations.ts), [fullscreen](../src/components/useMediaFullscreen.ts), [rendering](../backend/voicesubsep/rendering.py), [project session](../src/projectSession.ts).

## Recognition and preprocessing / 인식·화자 구분·전처리

| Request / 요청 | Status / 상태 | Actual scope / 실제 범위 |
| --- | --- | --- |
| Local GPU and large Whisper / 로컬 GPU·큰 Whisper | Implemented / 구현 | CUDA/local faster-whisper large-v3 and large-v3-turbo; model weights downloaded separately / 로컬 CUDA·faster-whisper large-v3·turbo, 가중치 별도 |
| Faster Whisper XXL / XXL 실행기 | Not integrated / 미연결 | The faster-whisper library is used; Purfview's separate XXL executable is not launched / 라이브러리 사용, 별도 XXL EXE 미실행 |
| Core Nemotron diarization / 핵심 Nemotron 화자 구분 | Implemented / 구현 | Regular nvidia/Nemotron-3-Diarization, pinned revision; library bundled, weights separate; not the preview model / 정식 고정 모델, 라이브러리 포함·가중치 별도 |
| Speaker selection and 4+ / 화자 방식·4명 이상 | Implemented / 구현 | Nemotron/manual correction or isolated source-track mapping; expected 4+ preserves additional detected speakers / Nemotron·수동 수정·분리 트랙 매핑, 4명 이상 추가 인물 보존 |
| Frequent short unassigned words / 짧은 단어 미배정 | Implemented adjustment / 보정 구현 | Boundary/nearby speaker assignment controls with review; ambiguous overlap may remain unassigned / 경계·인접 화자 보정과 검수, 모호한 겹침은 남을 수 있음 |
| Overlapping speech / 동시 발화 | Partial / 부분 | Activity overlap detection and review, not acoustic source separation or recovery of missing words / 겹친 활동 표시·검수, 음원 분리·누락 대사 복원 아님 |
| AUTO or explicit ASR language / AUTO·직접 언어 | Implemented / 구현 | Local/Groq language choice; xAI ASR uses AUTO / 로컬·Groq 선택, xAI는 AUTO |
| Latest 1–2 recognized lines / 인식 중 1–2줄 | Implemented / 구현 | Latest completed segments with elapsed time; not token streaming or confirmed speaker identity / 완료 구간 두 개·경과 시간, 토큰 스트리밍·화자 확정 아님 |
| Qwen3, Confucius4-R2T2, Audio8 | Research only / 조사만 | No selectable runtime adapters in this release / 이번 버전에 실행 어댑터 없음 |
| CLEAR/RX and minimal VST chain / 최소 VST 체인 | Implemented / 구현 | Up to four installed Windows x64 VST3 effects, order/bypass/parameters, original/processed preview / 설치된 VST3 최대 4개·순서·우회·파라미터·비교 |
| Automatic plug-in delay compensation / 플러그인 지연 자동 보정 | Partial / 부분 | Compensates host-reported latency per run; does not independently measure every plug-in's real delay / 보고 지연 보정, 모든 플러그인의 실제 지연 독립 측정 아님 |
| Built-in RNNoise / RNNoise 내장 | Not implemented / 미구현 | External VST path exists; RNNoise package itself is not embedded / 외부 VST 경로만 있음 |

Sources / 근거: [inference and alignment](../backend/voicesubsep/inference.py), [model cache](../backend/voicesubsep/model_cache.py), [VST contract](VST-CHAIN.md), [model options](GPU-MODELS.md), [model research](ALTERNATIVES-ANALYSIS.md).

## Documents, languages and optional providers / 문서·언어·선택 API

| Request / 요청 | Status / 상태 | Actual scope / 실제 범위 |
| --- | --- | --- |
| Korean/Japanese/English/Chinese/Spanish UI / 5개 화면 언어 | Implemented / 구현 | ko/en/ja/zh/es; raw system/provider errors may remain untranslated / 5개 언어, 외부 오류 원문은 남을 수 있음 |
| Subtitle translation / 자막 번역 | Implemented / 구현 | Local Ollama or Groq/xAI; review/apply separately, original preserved / 로컬 또는 API, 원문 보존·번역 검토 후 적용 |
| Speaker: utterance document / 인물: 발언 문서 | Implemented / 구현 | Default transcript tab, chronological original, optional timestamps, DOCX/TXT/HTML and print preview; no AI needed / 기본 발언록·원문 시간순·시간 선택·AI 불필요 |
| Interview mode / 인터뷰 | Implemented / 구현 | Manual interviewer/respondent roles and Q/A tagging, source links; no automatic question-answer pairing / 역할·문답 분류·근거 이동, 자동 문답 짝짓기 없음 |
| Meeting minutes / 회의록 | Implemented with limits / 제한 있음 | Summary/discussion/decision/action drafts, owner/due/evidence review; long meetings generated per batch, no final global synthesis / 요약·논의·결정·할일·담당·기한·근거, 장시간 전체 통합 요약 단계 없음 |
| PDF and Excel / PDF·엑셀 | Partial by output / 출력별 부분 | PDF uses print/save-as-PDF; no direct automatic PDF file. Interview/minutes XLSX includes transcript/actions/evidence sheets / PDF는 인쇄 저장, 보고서 XLSX는 대사·할일·근거 시트 |
| All formats for every document / 모든 문서의 모든 형식 | Not complete / 미완료 | DOCX/TXT are transcript outputs; interview/summary uses HTML/PDF-print/XLSX/Markdown. No summary DOCX/TXT yet / 요약문서 DOCX·TXT는 아직 없음 |
| Paid Groq and xAI / 유료 API 둘 다 | Implemented, mocked verification / 구현·모의 검증 | ASR, translation, meeting drafts; local Nemotron can accompany cloud ASR. Real billing/authentication/quality untested / 두 ASR·번역·요약, 실제 유료 호출 미검증 |
| Other diarization providers / 다른 화자 모델 선택 | Not implemented / 미구현 | Nemotron/track mapping/manual paths; no cloud speaker-ID adapter / 로컬 Nemotron·트랙·수동, 추가 화자 API 없음 |
| ChatGPT OAuth / ChatGPT 로그인 | Not implemented / 미구현 | No supported general third-party contract established; no token reuse or OpenAI API adapter / 독립 앱용 공식 계약 확인 못함, 토큰 재사용·OpenAI 어댑터 없음 |

Sources / 근거: [transcript export](../src/transcriptDocument.ts), [documents dialog](../src/components/DocumentsDialog.tsx), [report outputs](../src/documentExports.ts), [provider contracts](ADVANCED-PROVIDERS.md).

## Recording, persistence and delivery / 녹음·저장·배포

| Request / 요청 | Status / 상태 | Actual scope / 실제 범위 |
| --- | --- | --- |
| Microphone/system recording / 입력·컴퓨터 소리 녹음 | Implemented / 구현 | Source selection, local chunks, microphone+system mix, recovery and analysis after stopping / 소스 선택·조각 저장·혼합·복구·종료 후 분석 |
| Full microphone list / 마이크 목록 | Implemented permission flow / 권한 흐름 구현 | Permission refresh reveals available device names, fixed selection, no silent default fallback / 권한 후 실제 이름·고정 선택, 임의 기본 전환 방지 |
| Real-time captions and OBS output / 실시간 자막·OBS 송출 | Planned / 설계만 | Not present; current recorder processes after stopping / 현재는 종료 후 분석 |
| WASAPI endpoint/ASIO/routing / 출력 장치별 선택·라우팅 | Planned / 설계만 | No arbitrary playback-device endpoint or ASIO channel routing / 재생 출력 장치별·ASIO 채널 라우팅 없음 |
| Settings and error logs / 설정·오류 로그 | Implemented / 구현 | Language/analysis/VST backup and sanitized diagnostic export; API keys are memory-only / 설정·진단 출력, API 키는 메모리 전용 |
| Autosave and recovery / 자동 저장·복구 | Implemented with limits / 제한 있음 | Current/previous/damaged JSON, job history; not unlimited versions or original-media backup / 현재·직전·손상 JSON·작업 이력, 원본 미디어 백업 아님 |
| Public repo, bilingual docs, small EXE / 공개·한영 문서·작은 EXE | Implemented / 구현 | Public releases, SHA256-pinned downloader, resume/verify/assemble; see per-version publication evidence / 공개·체크섬·이어받기·조립, 버전별 게시 증거 별도 |
| In-app update / 인앱 업데이트 | Partial / 부분 | UI and updater controller exist; release feed and signing are not configured / 화면·코드만 있고 배포 feed·서명 미설정 |
| Bandwidth cap / 대역폭 제한 | Partial / 부분 | Setup downloader offers 80/40 Mbps/unlimited; this release upload capped at 40 Mbps. No OS QoS reservation or model-download global limit / 설치 파일·이번 업로드 제한, OS 10Mbps 예약·전체 모델 다운로드 제한 아님 |
| SDAD adoption / SDAD 도입 | Not adopted / 미도입 | Documents/tests exist, but no SDAD adapter/state workflow; earlier question was not treated as completed adoption / 문서·테스트는 있으나 SDAD 체계 도입은 아님 |

Sources / 근거: [live capture](../src/liveCapture.ts), [microphone devices](../src/microphoneDevices.ts), [settings](../src/settings.ts), [updater](../desktop/updater.cjs), [online installer](ONLINE-INSTALLER.md), [OBS and routing plan](OBS-LIVE-CAPTIONS-PLAN.md).

## Remaining priorities / 남은 우선순위

1. Make real recording-device selection and long-session recovery reliable on the user's audio interface; add native playback-endpoint capture. / 실제 오인페 장치 선택·장시간 녹음 검증과 네이티브 출력 캡처.
2. Build incremental ASR/diarization and OBS delivery as a separate unit. / 스트리밍 인식·화자 유지·OBS 송출을 별도 단위로 구현.
3. Complete audio mixing and output-format consistency; remove unused speakers from interview role controls. / 오디오 믹서·문서 형식 통일·인터뷰 역할의 미사용 인물 정리.
4. Configure a signed update distribution before claiming in-app updates are operational. / 인앱 업데이트 운영 전 서명·배포 경로 구성.

These are open work items, not promises that they are already in the installer. / 위 항목은 아직 남은 작업이며 설치기에 이미 포함됐다는 뜻이 아닙니다.
