# VOICESUBSEP

**Speaker-aware subtitles, editing notes, interviews, and manual meeting notes, with local processing by default.** Local Whisper transcribes speech; local NVIDIA Nemotron identifies speaker activity. Advanced settings offer opt-in Groq, xAI or Gemini speech recognition and Deepgram diarization. You review the text and speaker assignments while listening to the original media.

**로컬 처리가 기본인 인물별 자막·편집 메모·인터뷰·수동 회의록 편집기입니다.** 로컬 Whisper가 내용을 전사하고 로컬 NVIDIA Nemotron이 화자 활동을 분석합니다. Groq·xAI·Gemini 음성 인식과 Deepgram 화자 구분은 고급 설정에서 직접 선택할 때만 사용합니다. 원본을 들으며 자막과 인물 배정을 검수합니다.

[0.3.1 release record / 릴리즈 기록](docs/releases/v0.3.1.md) · [User guide / 사용자 가이드](docs/USER-GUIDE.md) · [Documentation / 문서 목차](docs/INDEX.md)

**v0.3.1 Windows preview is published.** Download the [small online setup EXE](https://github.com/LiveTrack-X/VOICESUBSEP/releases/download/v0.3.1/VOICESUBSEP-0.3.1-Online-Setup-x64.exe). See the [release record](docs/releases/v0.3.1.md) for checksums, local installation and tests, and [feature status](docs/FEATURE-STATUS.md) for implemented scope and limits.

**v0.3.1 Windows 프리뷰를 공개했습니다.** [작은 온라인 설치 EXE](https://github.com/LiveTrack-X/VOICESUBSEP/releases/download/v0.3.1/VOICESUBSEP-0.3.1-Online-Setup-x64.exe) 하나로 시작하세요. 검증·설치·체크섬은 [릴리즈 기록](docs/releases/v0.3.1.md), 구현 범위와 한계는 [기능 현황](docs/FEATURE-STATUS.md)에 있습니다.

**0.3.2 source is under validation; it is not published or installed yet.** It adds isolated analysis force-stop/priority controls, refreshed job history, SHA256-bound original relinking and pre-render verification, renewed review after manual edits, exact transcript-to-caption selection, remembered recording inputs and guarded VST residual-delay measurement. These changes are not in the 0.3.1 download above. See the [0.3.2 preparation record](docs/releases/v0.3.2.md) for current evidence and limits.

**0.3.2 소스는 검증 중이며 아직 게시·설치하지 않았습니다.** 분석 전용 프로세스 강제 종료·우선 실행, 작업 이력 갱신, SHA256 기반 원본 재연결·렌더 직전 검증, 직접 수정 후 재검수, 발언록에서 정확한 자막 선택, 녹음 입력 기억, 신뢰도 조건을 둔 VST 잔여 지연 측정을 추가했습니다. 위 0.3.1 다운로드에는 이번 변경이 없습니다. 현재 증거와 한계는 [0.3.2 준비 기록](docs/releases/v0.3.2.md)을 확인하세요.

Read [dependency notices and distribution obligations / 의존성 고지·재배포 의무](docs/BUNDLED-NOTICES.md) before redistributing. Public source access does not grant a permissive app license. / 재배포 전 고지를 확인하세요. 소스 공개가 앱에 자유로운 재배포 라이선스를 부여하지는 않습니다.

**0.3.2 YTT export, under validation:** the source now exports speaker-name colors and subtitle styles to CC files on the original or cut-edited timeline. YouTube upload/playback is unverified; advanced animation/karaoke is outside the initial scope. / **0.3.2 YTT 출력 검증 중:** 인물 이름 색·자막 스타일을 원본 또는 컷 적용 시간의 CC 파일로 출력하는 소스를 추가했습니다. YouTube 업로드·재생은 미검증이며 고급 애니메이션·노래방 효과는 첫 범위에서 제외합니다. [Guide / 안내](docs/YOUTUBE-CAPTIONS.md).

## Install / 설치

Download [VOICESUBSEP-0.3.1-Online-Setup-x64.exe](https://github.com/LiveTrack-X/VOICESUBSEP/releases/download/v0.3.1/VOICESUBSEP-0.3.1-Online-Setup-x64.exe) (166,912 bytes). It downloads the 2.42 GB runtime without GitHub login, verifies SHA256, assembles the payload, and opens the installation wizard. Model weights are separate. The source-code ZIP is not an installer.

게시된 설치 파일은 [0.3.1 릴리즈 기록](docs/releases/v0.3.1.md)에서 확인합니다. 작은 `VOICESUBSEP-0.3.1-Online-Setup-x64.exe`가 로그인 없이 설치 프로그램·데이터 조각을 받고 SHA256 검증·재조립 후 설치 마법사를 엽니다. 정확한 파일명·용량은 버전별 기록을 따르며 소스 코드 ZIP은 설치 파일이 아닙니다.

| Requirement / 항목 | Details / 내용 |
| --- | --- |
| System / 운영체제 | Windows 10/11 x64, .NET Framework 4.8 for the online setup / 온라인 설치기에 .NET Framework 4.8 필요 |
| Download / 다운로드 | Several GB; exact sizes in the release record, model weights separate / 수 GB, 정확한 크기는 릴리즈 기록·모델 가중치 별도 |
| Storage / 저장 공간 | At least 16 GiB free recommended; 12 GiB cache-drive minimum checked, plus room for models/projects / 16GiB 이상 권장, 캐시 드라이브 최소 12GiB 검사, 모델·프로젝트 공간 추가 |
| Included / 포함 | Python, FFmpeg, speech-analysis libraries, CUDA runtime libraries / Python·FFmpeg·음성 분석 라이브러리·CUDA 런타임 |
| Separate / 별도 준비 | NVIDIA driver, Whisper/Nemotron weights and VST3 plugins / NVIDIA 드라이버·Whisper/Nemotron 가중치·VST3 플러그인 |

The 0.3.1 desktop app supports explicit **check → download → install** updates from public GitHub releases. A bundled Ed25519 public key authenticates the release manifest; SHA256 verifies each part and the assembled installer payload. The private signing key stays outside the repository. **This is manifest authentication, not Windows Authenticode signing:** the Windows executables remain unsigned. Older builds without this updater need one manual installation. See [desktop update details](docs/DESKTOP.md#사용자가-선택하는-업데이트).

0.3.1 설치형은 GitHub 공개 릴리즈에서 **확인 → 다운로드 → 설치**를 각각 선택하는 업데이트를 지원합니다. 앱에 포함한 Ed25519 공개키로 배포 명세의 서명을 확인하고 조각·재조립 파일을 SHA256로 검증합니다. 개인키는 저장소 밖에 보관합니다. **배포 명세 인증이며 Windows Authenticode 코드 서명은 아닙니다.** 실행 파일은 무서명이며, 이 업데이트 기능이 없는 이전 설치본은 한 번 수동 설치해야 합니다.

The online helper defaults to **80 Mbps**, with 40 Mbps/unlimited options. In-app update files are downloaded serially at **80 Mbps**. These are download limits, not OS QoS or a guaranteed 10 Mbps reservation; they do not limit every model download. / 온라인 설치기는 기본 **80Mbps**, 40Mbps·제한 없음 선택입니다. 인앱 업데이트는 파일을 순차적으로 **80Mbps**로 받습니다. OS QoS·10Mbps 예약이나 모든 모델 다운로드에 적용되는 제한은 아닙니다.

## Features / 기능

**0.3.1 adds continuous scrolling, theme controls and clearer long-job handling.** The rows marked “0.3.1” describe this release's changes. See the [0.3.1 release record](docs/releases/v0.3.1.md) for publication, installation and verification scope.

**0.3.1은 연속 스크롤·테마 선택·긴 분석 작업 관리를 개선했습니다.** 아래 `0.3.1` 표시는 이번 변경이며 게시·설치·검증 범위는 [0.3.1 릴리즈 기록](docs/releases/v0.3.1.md)을 참고하세요.

| English | 한국어 |
| --- | --- |
| Three clear entry points: Subtitles & video, Interviews & minutes, and Live captions and recording; the project is shared across these workflows | 자막·영상 편집 / 인터뷰·회의록 / 실시간 자막·녹음 진입점 구분, 같은 프로젝트의 작업 내용 유지 |
| Local large-v3 / large-v3-turbo transcription, AUTO or explicit speech language, Nemotron diarization, isolated OBS track-to-speaker mapping | 로컬 large-v3 / large-v3-turbo 전사, AUTO·직접 음성 언어 선택, Nemotron 화자 구분, OBS 분리 트랙→인물 연결 |
| Speaker names, colors and subtitle styles; timeline playback, notes, waveform and boundary adjustment | 인물 이름·색·자막 스타일, 타임라인 재생·메모·파형·경계 조절 |
| 0.3.1: continuous caption/transcript scrolling replaces 100-row pages; bulk editing, literal find/replace and timeline reveal remain available | 0.3.1: 100행 페이지 대신 자막·발언록 연속 스크롤, 일괄 편집·문자열 치환·타임라인 이동 유지 |
| 0.3.1: explicit Light/Dark theme, clearly labeled interface Language, automatic aspect-preserving preview fit and a compact empty notes panel | 0.3.1: 라이트/다크 직접 선택, 화면 언어에 Language 표시, 비율을 유지한 미리보기 자동 맞춤·빈 메모 축소 |
| 0.3.1: speaker selectors hide unused preparation entries outside the expected count; assigned speakers are preserved. Transcript DOCX/HTML/PDF/XLSX carry speaker colors | 0.3.1: 예상 인원 밖의 미사용 준비 인물을 선택기에서 숨기고 실제 배정 인물은 유지, 발언록 DOCX/HTML/PDF/XLSX에 인물 색 반영 |
| Non-destructive cuts; MP4/WAV/MP3/M4A rendering; source frame rate, 30 or 60 fps | 원본을 보존하는 컷, MP4/WAV/MP3/M4A 렌더, 원본 프레임률·30·60fps |
| Local FFmpeg mixer: up to 16 file/OBS tracks, individual/solo 10-second previews, sample peaks, gain/offset/mute/limiter, cuts and export history | 최대 16개 파일·OBS 트랙, 개별·솔로 10초 미리듣기·샘플 피크·음량·시간 이동·음소거·리미터·컷·출력 이력 |
| SRT, styled ASS, speaker SRT ZIP, editing notes and project JSON export | SRT·스타일 ASS·인물별 SRT ZIP·편집 메모·프로젝트 JSON 출력 |
| Original transcripts, interview Q&A and manual meeting notes as DOCX/TXT/HTML/XLSX; reports preserve source evidence and review state | 원문 발언록·인터뷰 문답·수동 회의 메모를 DOCX/TXT/HTML/XLSX로 출력하고 근거·검수 상태 보존 |
| Direct desktop PDF save via a native save dialog; browser fallback uses print/save-as-PDF | 설치형은 저장 창을 거쳐 직접 PDF 생성, 브라우저는 인쇄/PDF 저장 사용 |
| Korean, English, Japanese, Simplified Chinese and Spanish UI; original speech transcripts and manual evidence-linked meeting notes | 한·영·일·중국어 간체·스페인어 UI, 원문 발언록과 근거를 연결한 수동 회의록 |
| Microphone/system/both recording; optional persistent local Whisper + Nemotron live captions and a read-only OBS overlay URL | 마이크·시스템·둘 다 녹음, 선택형 로컬 Whisper+Nemotron 라이브 자막·읽기 전용 OBS 주소 |
| Up to four installed VST3 effects before analysis, reported-latency compensation, A/B preview, settings and error logs | 설치된 VST3 최대 4개 분석 전처리, 보고 지연 보정·A/B 비교·설정·오류 로그 |

Detailed workflows: [editing and recovery](docs/EDITING-WORKFLOWS.md), [audio mixer](docs/AUDIO-MIXER.md), [cuts and languages](docs/CUTS-AND-LANGUAGES.md), [VST](docs/VST-CHAIN.md), [settings and logs](docs/SETTINGS-AND-LOGS.md).

자세한 흐름은 [편집·복구](docs/EDITING-WORKFLOWS.md), [오디오 믹서](docs/AUDIO-MIXER.md), [컷·언어](docs/CUTS-AND-LANGUAGES.md), [VST](docs/VST-CHAIN.md), [설정·로그](docs/SETTINGS-AND-LOGS.md)에 있습니다.

## Limits and local data / 한계와 로컬 데이터

- **0.3.1 local Whisper AUTO keeps the initially detected main language** for a file. Live AUTO retains the first confident language with usable speech; uncertain/empty windows retry detection without a forced fallback language. Select the speech language directly when one language predominates. This removes automatic per-segment language switching, not genuine foreign-language text; it does not guarantee that hallucinations disappear. Cloud-provider language policies are separate.
- **0.3.1 로컬 Whisper의 AUTO는 파일 초반에 감지한 주 언어를 유지합니다.** 라이브는 첫 유효 발화에서 충분한 확률로 감지한 언어를 유지하고 불확실·빈 결과이면 다음 구간에서 재시도합니다. 한국어 등 특정 언어로 강제 대체하지 않습니다. 한 언어 위주라면 음성 언어를 직접 선택하세요. 구간마다 언어를 바꾸는 동작을 없애는 수정이며 실제 외국어 문장을 지우거나 환각 제거를 보장하지 않습니다. 클라우드 공급자의 언어 정책은 별도입니다.
- **Diarization is not voice separation.** Mixed overlapping voices may remain unassigned or incomplete. `4+` means at least four expected speakers; detected speakers 5–8 are retained, not merged into four. Automatic numbers need human naming.
- **화자 구분은 음원 분리가 아닙니다.** 섞인 동시 발화는 미배정·누락될 수 있습니다. `4명 이상`은 최소 4명이며 검출된 5~8명을 4명으로 합치지 않습니다. 자동 번호의 실제 이름은 직접 지정합니다.
- Live captions reuse loaded local Whisper and Nemotron models throughout one session. Whisper commits roughly four-second segments; the first result needs about five seconds of audio plus inference time. First complete one local analysis of a short file with the same Whisper model and Nemotron to download/cache any missing weights. Live mode uses those complete caches only and never downloads them. Speaker labels remain drafts, especially during adaptation and overlapping speech. Live sessions are limited to two hours. Arbitrary WASAPI playback endpoints, ASIO routing and automatic clock-drift correction are not included.
- 라이브 자막은 한 세션에서 로컬 Whisper·Nemotron을 계속 유지합니다. 약 4초 구간 단위이며 첫 결과는 음성 약 5초 수집에 추론 시간을 더한 뒤 나옵니다. 먼저 짧은 파일의 `음성 분석`에서 **같은 Whisper 모델과 로컬 Nemotron 분석을 한 번 완료**해 가중치를 준비합니다. 라이브는 완성된 캐시만 쓰며 모델을 받지 않습니다. 초기 적응·동시 발화의 화자는 검수할 초안이며 라이브 세션은 최대 2시간입니다. 개별 WASAPI 출력·ASIO 라우팅·자동 드리프트 보정은 지원하지 않습니다.
- Mixer offsets do not move captions. Previews measure sample peaks only within the selected window; other sections and lossy-codec peaks can differ. A stereo mix is not an editable multitrack session. / 믹서 시간 이동은 자막을 옮기지 않습니다. 미리듣기 피크는 선택 구간의 샘플만 측정하며 다른 구간·압축 코덱에서는 달라질 수 있습니다. 결과는 스테레오 파일입니다.
- Project JSON contains edits, not the original media. Keep both and reconnect the same source when reopening. Autosave is local to the app/browser profile; save a separate JSON backup.
- 프로젝트 JSON에는 편집 내용만 들어가며 원본 미디어는 없습니다. 둘 다 보관하고 재열기 때 같은 원본을 연결하세요. 자동 저장은 앱/브라우저 프로필에 남으므로 별도 JSON도 저장하세요.
- Local processing is the default. Choosing a cloud provider and confirming the request sends the selected audio to that provider and may incur API charges. Keys are held only in the running backend session, not projects or settings backups. See [advanced providers](docs/ADVANCED-PROVIDERS.md).
- 기본은 로컬 처리입니다. 클라우드 공급자를 선택하고 전송을 확인하면 선택한 음성을 해당 공급자에게 보내며 API 비용이 발생할 수 있습니다. 키는 실행 중인 백엔드 세션에만 보관하고 프로젝트·설정 백업에 저장하지 않습니다. [고급 공급자 설정](docs/ADVANCED-PROVIDERS.md)과 [Deepgram 범위](docs/DEEPGRAM-DIARIZATION.md)를 확인하세요.
- File analysis may download missing local speech models; live mode requires them prepared in advance. Commercial VST3 plugins such as CLEAR/RX are separate. Subtitle translation and automatic AI summaries have been removed; export the original transcript for an external LLM if desired. Ollama is not used.
- 파일 분석은 없는 로컬 음성 모델을 받을 수 있으며 라이브 모델은 미리 준비해야 합니다. CLEAR/RX 등 상용 VST3는 별도입니다. 자막 번역·AI 자동 요약은 제거했으며 필요하면 원문 발언록을 외부 LLM에 직접 사용할 수 있습니다. Ollama는 사용하지 않습니다.
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

Automated checks do not establish transcription accuracy, device recording quality, or installer deployment. [Release evidence](docs/releases/v0.3.2.md) separates those scopes. Source data defaults to `data/` (`VOICESUBSEP_DATA_DIR`). **0.3.2 removes the fixed source-media upload cap and ignores the retired `VOICESUBSEP_MAX_UPLOAD_BYTES` setting.** Uploads still spool to disk and copy/hash in bounded blocks; available disk space, filesystem limits and media validity still matter. Project JSON, live recording and provider limits are separate and unchanged. Desktop data lives outside the install folder. Third-party [notices and redistribution obligations](docs/BUNDLED-NOTICES.md) remain separate from app functionality.

자동 검사는 인식 정확도·장치 녹음 품질·설치 배포를 대신 입증하지 않습니다. [릴리즈 증거](docs/releases/v0.3.2.md)에서 범위를 구분합니다. 개발 데이터는 기본 `data/`(`VOICESUBSEP_DATA_DIR`)입니다. **0.3.2는 원본 미디어 업로드의 고정 용량 상한을 없애고 기존 `VOICESUBSEP_MAX_UPLOAD_BYTES`를 무시합니다.** 디스크 임시 저장과 작은 블록의 복사·해시 계산은 유지하며 실제 여유 공간·파일시스템·미디어 유효성 제약은 남습니다. 프로젝트 JSON·라이브 녹음·공급자별 제한은 별개로 유지합니다. 설치형 데이터는 설치 폴더 밖에 남으며 외부 의존성의 [고지·재배포 의무](docs/BUNDLED-NOTICES.md)는 앱 기능과 별도로 확인합니다.
