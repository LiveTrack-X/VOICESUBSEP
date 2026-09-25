# Feature status / 요청 기능 현황

Audited against the current working source on 2026-09-25. **Not every proposal is implemented, and current source changes are not deployed.** Implemented means code and a usable path exist; it does not establish real-device quality, paid-provider access or semantic accuracy. Public v0.2.0, the earlier local v0.2.1 checkpoint, and the empty unpublished v0.2.1 GitHub draft are separate states. See the [checkpoint record](releases/v0.2.1.md) and [current bug audit](BUG-AUDIT-2026-09-25.md).

2026-09-25 현재 작업 소스를 이전 요청과 대조했습니다. **모든 제안이 구현된 것은 아니며 현재 변경은 미배포입니다.** `구현`은 코드와 사용 경로가 있다는 뜻이며 실제 장치 품질·유료 계정 접근·인식 정확도 보증이 아닙니다. 공개 v0.2.0, 이전 로컬 v0.2.1 설치 checkpoint, 자산 없는 GitHub v0.2.1 초안은 서로 구분합니다.

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
| Audio track mixing / 여러 파일·트랙 합치기 | Implemented in source / 소스 구현 | Up to 16 file/OBS tracks, gain/offset/mute/limiter, optional project cuts, WAV/MP3/M4A/MP4 and history. No drift correction, VST mix rendering or editable multitrack session export / 최대 16트랙·음량·시간 이동·음소거·리미터·컷·출력·이력. 드리프트·VST 믹스·편집용 멀티트랙 세션은 없음 |
| Cutback-like automation / Cutback 수준 자동 편집 | Not implemented / 미구현 | No Premiere plug-in, clip rearrangement/transitions, automatic silence/filler removal or complete NLE / 프리미어 플러그인·클립 재배열·전환·자동 무음/군더더기 제거 없음 |
| Undo, bulk editing, search/replace / 실행 취소·일괄 수정·치환 | Implemented / 구현 | Bounded undo, 100-row pages, literal replacement and review navigation / 제한된 실행 취소·100행 페이지·문자열 치환·검수 이동 |
| New project retains names / 새 프로젝트 이름 잔존 | Main reset fixed / 주요 경로 수정 | New/open/sample project changes reset session/undo. Old job results cannot silently apply to another project / 프로젝트 전환 시 세션·실행 취소 분리 |
| Expected one speaker shows two / 예상 1명인데 두 인물 | Display fixed; explicit correction / 표시 수정·명시적 보정 | Sidebar uses assigned speakers; interview/report participants come from captions/evidence. Expected count does not silently merge distinct existing identities; explicit merge supports undo / 실제 배정·근거의 인물만 표시. 예상 수 변경으로 임의 통합하지 않고 명시적 통합·실행 취소 제공 |
| App and internal icons / 앱·내부 아이콘 | Implemented / 구현 | Shared brand asset, favicon and Windows icon; OS icon cache can affect display / 브랜드·파비콘·Windows 아이콘 통일, OS 캐시 영향 가능 |

Sources / 근거: [App](../src/App.tsx), [editor layout](../src/workspace-layout.css), [speaker operations](../src/speakerOperations.ts), [fullscreen](../src/components/useMediaFullscreen.ts), [rendering](../backend/voicesubsep/rendering.py), [mixer contract](AUDIO-MIXER.md), [project session](../src/projectSession.ts).

## Recognition and preprocessing / 인식·화자 구분·전처리

| Request / 요청 | Status / 상태 | Actual scope / 실제 범위 |
| --- | --- | --- |
| Local GPU and large Whisper / 로컬 GPU·큰 Whisper | Implemented / 구현 | CUDA/local faster-whisper large-v3 and large-v3-turbo; model weights downloaded separately / 로컬 CUDA·faster-whisper large-v3·turbo, 가중치 별도 |
| Faster Whisper XXL / XXL 실행기 | Not integrated / 미연결 | The faster-whisper library is used; Purfview's separate XXL executable is not launched / 라이브러리 사용, 별도 XXL EXE 미실행 |
| Core Nemotron diarization / 핵심 Nemotron 화자 구분 | Implemented / 구현 | Regular nvidia/Nemotron-3-Diarization, pinned revision; library bundled, weights separate; not the preview model / 정식 고정 모델, 라이브러리 포함·가중치 별도 |
| Speaker selection and 4+ / 화자 방식·4명 이상 | Implemented / 구현 | Nemotron/manual correction or isolated source-track mapping; expected 4+ preserves additional detected speakers / Nemotron·수동 수정·분리 트랙 매핑, 4명 이상 추가 인물 보존 |
| Frequent short unassigned words / 짧은 단어 미배정 | Implemented adjustment / 보정 구현 | Boundary/nearby speaker assignment controls with review; ambiguous overlap may remain unassigned / 경계·인접 화자 보정과 검수, 모호한 겹침은 남을 수 있음 |
| Overlapping speech / 동시 발화 | Partial / 부분 | Activity overlap detection and review, not acoustic source separation or recovery of missing words / 겹친 활동 표시·검수, 음원 분리·누락 대사 복원 아님 |
| AUTO or explicit ASR language / AUTO·직접 언어 | Implemented / 구현 | Whisper/Groq language selection; xAI AUTO; Gemini AUTO or supported language hints. Qwen source alignment accepts its 11 supported languages / Whisper·Groq 지정, xAI AUTO, Gemini AUTO·언어 힌트, Qwen 소스 정렬 11개 언어 |
| Latest 1–2 recognized lines / 인식 중 1–2줄 | Implemented / 구현 | Latest completed segments with elapsed time; not token streaming or confirmed speaker identity / 완료 구간 두 개·경과 시간, 토큰 스트리밍·화자 확정 아님 |
| Qwen3 ASR + forced aligner | Source adapter, mocked verification / 소스 구현·모의 검증 | Optional development runtime; no real-weight inference verification and excluded from frozen installers pending tokenizer distribution audit / 개발 환경 선택 기능, 실제 모델 추론 미검증·토크나이저 배포 감사로 설치본 미포함. [Details / 근거](QWEN-RUNTIME.md) |
| Confucius4-R2T2, Audio8 | Research only / 조사만 | No selectable runtime adapters / 실행 어댑터 없음 |
| CLEAR/RX and minimal VST chain / 최소 VST 체인 | Implemented / 구현 | Up to four installed Windows x64 VST3 effects, order/bypass/parameters, original/processed preview / 설치된 VST3 최대 4개·순서·우회·파라미터·비교 |
| Automatic plug-in delay compensation / 플러그인 지연 자동 보정 | Partial / 부분 | Compensates host-reported latency per run; does not independently measure every plug-in's real delay / 보고 지연 보정, 모든 플러그인의 실제 지연 독립 측정 아님 |
| Built-in RNNoise / RNNoise 내장 | Not implemented / 미구현 | External VST path exists; RNNoise package itself is not embedded / 외부 VST 경로만 있음 |

Sources / 근거: [inference and alignment](../backend/voicesubsep/inference.py), [model cache](../backend/voicesubsep/model_cache.py), [VST contract](VST-CHAIN.md), [model options](GPU-MODELS.md), [model research](ALTERNATIVES-ANALYSIS.md).

## Documents, languages and optional providers / 문서·언어·선택 API

| Request / 요청 | Status / 상태 | Actual scope / 실제 범위 |
| --- | --- | --- |
| Korean/Japanese/English/Chinese/Spanish UI / 5개 화면 언어 | Implemented / 구현 | ko/en/ja/zh/es; raw system/provider errors may remain untranslated / 5개 언어, 외부 오류 원문은 남을 수 있음 |
| Subtitle translation / 자막 번역 | Removed by user decision / 사용자 결정으로 제거 | No translation UI/API or Ollama dependency. Legacy project data remains readable without exposing translation controls / 번역 화면·실행 API·Ollama 제거, 기존 저장 자료는 비파괴 호환 |
| Speaker: utterance document / 인물: 발언 문서 | Implemented / 구현 | Chronological original, optional timestamps, DOCX/TXT/HTML, dedicated cue-by-cue XLSX and PDF path; no text-generation request / 원문 시간순·시간 선택·Word/TXT/HTML·자막별 XLSX·PDF, 텍스트 생성 호출 없음 |
| Interview mode / 인터뷰 | Implemented / 구현 | Manual interviewer/respondent roles and Q/A tagging, source links; no automatic question-answer pairing / 역할·문답 분류·근거 이동, 자동 문답 짝짓기 없음 |
| Manual meeting notes / 수동 회의 메모 | Implemented / 구현 | User-written discussion/decision/action items with owner, due date, source evidence and review. Old notes remain editable / 직접 작성한 논의·결정·할 일·담당·기한·근거·검수, 기존 자료 편집 유지 |
| Automatic AI summaries / AI 자동 요약 | Removed by user decision / 사용자 결정으로 제거 | No Ollama, AI draft generation or global synthesis. Export original documents for external LLM use if desired / Ollama·AI 초안·전체 통합 요약 제거, 필요하면 원문을 출력해 외부 LLM에 직접 사용 |
| PDF and Excel / PDF·엑셀 | Implemented in source / 소스 구현 | Desktop save dialog + Electron printToPDF; browser print fallback. Actual Chromium PDF, Korean text extraction and page rendering verified with a mocked Save dialog. XLSX includes appropriate transcript/report/actions/evidence sheets / 실제 PDF 생성·한글·렌더 확인, 저장 창은 모의. 문서별 XLSX 시트 제공 |
| Document output consistency / 문서 형식 통일 | Implemented in source / 소스 구현 | Transcript, interview and manual notes all have DOCX/TXT/HTML/XLSX/PDF paths; reports preserve review/evidence/owner/due. Markdown and project JSON remain available / 세 문서 Word/TXT/HTML/XLSX/PDF, 근거·검수·담당·기한 보존, Markdown·프로젝트 JSON 유지 |
| Paid ASR providers / 유료 음성 인식 | Implemented, mocked verification / 구현·모의 검증 | Advanced Groq/xAI/Gemini, independent from the speaker stage. Explicit consent and session-only keys; no real paid authentication/billing/quality test / 고급 Groq·xAI·Gemini, 화자 단계와 별도·명시 동의·세션 키, 실제 유료 호출 미검증 |
| Other diarization providers / 다른 화자 모델 선택 | Implemented, mocked verification / 구현·모의 검증 | Opt-in Deepgram v2 beside default local Nemotron; full-audio app limit 2h/256MiB, no chunked identity stitching. Intervals only; its transcript does not replace selected ASR / 선택 Deepgram v2·앱 한도 2시간/256MiB·구간만 사용, 선택 ASR 전사문을 덮어쓰지 않음 |
| ChatGPT OAuth / ChatGPT 로그인 | Not implemented / 미구현 | No supported general third-party contract established; no token reuse or OpenAI API adapter / 독립 앱용 공식 계약 확인 못함, 토큰 재사용·OpenAI 어댑터 없음 |

Sources / 근거: [transcript export](../src/transcriptDocument.ts), [documents dialog](../src/components/DocumentsDialog.tsx), [report outputs](../src/documentExports.ts), [desktop PDF](../desktop/document-pdf.cjs), [provider contracts](ADVANCED-PROVIDERS.md), [Deepgram limits](DEEPGRAM-DIARIZATION.md).

## Recording, persistence and delivery / 녹음·저장·배포

| Request / 요청 | Status / 상태 | Actual scope / 실제 범위 |
| --- | --- | --- |
| Microphone/system recording / 입력·컴퓨터 소리 녹음 | Implemented / 구현 | Source selection, local chunks, microphone+system mix, recovery and analysis after stopping / 소스 선택·조각 저장·혼합·복구·종료 후 분석 |
| Full microphone list / 마이크 목록 | Implemented permission flow / 권한 흐름 구현 | Permission refresh reveals available device names, fixed selection, no silent default fallback / 권한 후 실제 이름·고정 선택, 임의 기본 전환 방지 |
| Real-time captions and OBS output / 실시간 자막·OBS 송출 | Planned / 설계만 | Not present; current recorder processes after stopping / 현재는 종료 후 분석 |
| WASAPI endpoint/ASIO/routing / 출력 장치별 선택·라우팅 | Planned / 설계만 | No arbitrary playback-device endpoint or ASIO channel routing / 재생 출력 장치별·ASIO 채널 라우팅 없음 |
| Settings and error logs / 설정·오류 로그 | Implemented / 구현 | Language/analysis/VST backup and sanitized diagnostic export; API keys are memory-only / 설정·진단 출력, API 키는 메모리 전용 |
| Autosave and recovery / 자동 저장·복구 | Implemented with limits / 제한 있음 | Current/previous/damaged JSON, job history; not unlimited versions or original-media backup / 현재·직전·손상 JSON·작업 이력, 원본 미디어 백업 아님 |
| Public repo, bilingual docs, small EXE / 공개·한영 문서·작은 EXE | Public v0.2.0; newer source unshipped / v0.2.0 공개·최신 변경 미배포 | SHA256-pinned downloader, resume/verify/assemble. v0.2.1 only has a prior local installation checkpoint and empty GitHub draft / 체크섬·이어받기·조립, v0.2.1은 이전 로컬 설치·빈 초안만 존재 |
| In-app update / 인앱 업데이트 | Partial / 부분 | UI and updater controller exist; release feed and signing are not configured / 화면·코드만 있고 배포 feed·서명 미설정 |
| Bandwidth cap / 대역폭 제한 | Partial / 부분 | Setup downloader offers 80/40 Mbps/unlimited. No OS QoS reservation or model-download global limit; temporary development throttles are not an app-wide promise / 설치 다운로드 제한, OS 10Mbps 예약·전체 모델 다운로드 제한은 없음. 일시 개발 제한과 제품 기능 구분 |
| SDAD adoption / SDAD 도입 | Not adopted / 미도입 | Documents/tests exist, but no SDAD adapter/state workflow; earlier question was not treated as completed adoption / 문서·테스트는 있으나 SDAD 체계 도입은 아님 |

Sources / 근거: [live capture](../src/liveCapture.ts), [microphone devices](../src/microphoneDevices.ts), [settings](../src/settings.ts), [updater](../desktop/updater.cjs), [online installer](ONLINE-INSTALLER.md), [OBS and routing plan](OBS-LIVE-CAPTIONS-PLAN.md).

## Remaining priorities / 남은 우선순위

1. Make real recording-device selection and long-session recovery reliable on the user's audio interface; add native playback-endpoint capture. / 실제 오인페 장치 선택·장시간 녹음 검증과 네이티브 출력 캡처.
2. Build incremental ASR/diarization and OBS delivery as a separate unit. / 스트리밍 인식·화자 유지·OBS 송출을 별도 단위로 구현.
3. Validate mixer timing, Word/Excel rendering and native PDF saving with real user files; rebuild and validate a new installer before distributing current changes. / 실사용 파일의 믹스 시간·Word/Excel 표시·네이티브 PDF 저장 확인 후 새 설치본 재빌드·검증·배포.
4. Configure a signed update distribution before claiming in-app updates are operational. / 인앱 업데이트 운영 전 서명·배포 경로 구성.
5. Resolve Qwen dependency distribution declarations before bundling; separately validate real models and paid ASR/diarization quality. / Qwen 배포 고지 불일치 해소 후 번들 검토, 실제 모델·유료 인식·화자 구분 품질은 별도 검증.

These are open work items, not promises that they are already in the installer. Removed translation and AI summarization are intentional scope decisions, not outstanding implementation tasks. / 위 항목은 남은 작업이며 설치기에 포함됐다는 뜻이 아닙니다. 제거한 번역·AI 요약은 사용자의 범위 결정이며 미완료 개발 항목으로 계산하지 않습니다.
