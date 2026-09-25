# VOICESUBSEP User Guide / 사용자 가이드

For **Windows 10/11 x64, v0.2.1 Preview**. Public [release downloads](https://github.com/LiveTrack-X/VOICESUBSEP/releases/tag/v0.2.1) require no GitHub login. The [online installer guide](ONLINE-INSTALLER.md) explains the small setup executable and its verification status; the [release record](releases/v0.2.1.md) records the app payload and tested scope.

대상: **Windows 10/11 x64, v0.2.1 Preview 시험 릴리즈**. 공개 [릴리즈 다운로드](https://github.com/LiveTrack-X/VOICESUBSEP/releases/tag/v0.2.1)는 GitHub 로그인이 필요하지 않습니다. 작은 설치 EXE의 사용법·검증 상태는 [온라인 설치 안내](ONLINE-INSTALLER.md), 앱 데이터·확인 범위는 [릴리즈 기록](releases/v0.2.1.md)을 따릅니다.

Whisper transcribes **what was said**; Nemotron identifies **who spoke when**. Review both against the source. Diarization does not separate mixed voices into audio stems or reconstruct inaudible speech.

VOICESUBSEP은 로컬 음성 인식과 화자 구분으로 자막을 만들고, 원본을 보며 자막·인물·메모를 고치는 편집기입니다. Whisper는 **무슨 말을 했는지**, Nemotron은 **누가 언제 말했는지**를 분석합니다. 화자 구분은 섞인 목소리를 별도 음원으로 분리하거나 들리지 않는 대사를 복원하는 기능이 아닙니다.

## 1. 설치와 첫 실행

*Install and first launch*

Download `VOICESUBSEP-0.2.1-Online-Setup-x64.exe` from the release. Run it, choose a download-speed limit, and start. It downloads the existing NSIS installer plus three data parts, verifies every file and the assembled SHA256, then opens the installation wizard. Completed verified downloads are reused when you return after cancellation; resumed data is verified before use. It needs .NET Framework 4.8. If the online asset is not available or cannot be used, the seven-file manual method below remains available. Publication and exercised test paths are tracked separately in [Online Installer](ONLINE-INSTALLER.md).

릴리즈에서 `VOICESUBSEP-0.2.1-Online-Setup-x64.exe`를 받아 실행하고 다운로드 속도 제한을 선택한 뒤 시작합니다. 기존 NSIS 설치 프로그램과 데이터 조각 3개를 받고, 각 파일과 재조립 결과의 SHA256을 검증한 뒤 설치 마법사를 엽니다. 취소 후 다시 시작하면 검증된 완료 파일을 재사용하고 이어받은 데이터도 사용 전에 검증합니다. .NET Framework 4.8이 필요합니다. 온라인 자산이 아직 없거나 사용할 수 없다면 아래 기존 7개 파일 수동 방식을 사용할 수 있습니다. 게시·실제 시험 상태는 [온라인 설치 안내](ONLINE-INSTALLER.md)에 구분합니다.

The payload is about **2.42 GB** before installation. Allow **at least 16 GiB free**, plus room for models and projects; the helper checks a 12 GiB minimum on its cache drive. Speeds are 40/80 Mbps or unlimited, with 80 Mbps as default. Save project JSON, finish recording/analysis/rendering, and close the old app before installing. This unsigned Preview may trigger Windows trust warnings; check the official source and checksums. The source-code ZIP is not an installer. Read the [dependency notices](BUNDLED-NOTICES.md) before redistribution.

설치 전 앱 데이터는 약 **2.42GB**입니다. 다운로드·재조립·설치를 위해 **여유 공간 16GiB 이상**과 모델·프로젝트 공간을 추가로 준비하세요. 도우미는 캐시 드라이브의 최소 12GiB를 검사합니다. 속도는 40/80Mbps·제한 없음이며 기본값은 80Mbps입니다. 기존 앱을 바꾸기 전 프로젝트 JSON을 저장하고 녹음·분석·렌더를 끝낸 뒤 앱을 종료하세요. 무서명 Preview라 Windows 신뢰도 경고가 나타날 수 있으므로 출처와 체크섬을 확인하세요. 소스 코드 ZIP은 설치 파일이 아닙니다. 재배포 전 [의존성 고지](BUNDLED-NOTICES.md)를 확인하세요.

**Manual fallback / 수동 설치 대안**

Download these seven files into one folder: the Offline Setup EXE, `.part001`, `.part002`, `.part003`, `installer-manifest.json`, `SHA256SUMS.txt`, and `Assemble-Installer.ps1`. Run the command below to verify and assemble `voicesubsep-0.2.1-x64.nsis.7z`, then manually run the colocated EXE. Do not extract the 7z yourself. A failed hash check must be resolved before installation. The assembly script does not launch the installer.

기존 자산 7개를 같은 폴더에 받습니다: Offline Setup EXE, `.part001`, `.part002`, `.part003`, `installer-manifest.json`, `SHA256SUMS.txt`, `Assemble-Installer.ps1`. 아래 명령으로 검증·재조립한 `voicesubsep-0.2.1-x64.nsis.7z`와 같은 폴더의 EXE를 직접 실행합니다. 7z를 직접 압축 해제할 필요는 없습니다. 해시 검증에 실패하면 해당 파일을 다시 확인한 뒤 설치하세요. 조립 스크립트는 설치기를 자동 실행하지 않습니다.

```powershell
powershell -NoProfile -File .\Assemble-Installer.ps1
```

If Windows blocks the downloaded script, compare `Get-FileHash .\Assemble-Installer.ps1 -Algorithm SHA256` with the release's `SHA256SUMS.txt`. Unblock only the verified file through its Properties dialog. Do not change system-wide or organizational execution policy for this procedure.

다운로드한 스크립트가 Windows 파일 차단 때문에 실행되지 않으면 `Get-FileHash .\Assemble-Installer.ps1 -Algorithm SHA256`을 릴리즈의 `SHA256SUMS.txt`와 대조하세요. 출처와 해시를 확인한 파일만 속성의 **차단 해제**로 허용합니다. 이 절차 때문에 시스템 전체 실행 정책이나 조직 정책을 바꾸지 마세요.

The installed app includes Python, FFmpeg, speech-analysis libraries and CUDA runtime libraries. You do not need the developer's Node/Python setup. A compatible NVIDIA driver is still required for GPU use. **Whisper/Nemotron weights are separate** and may download in the app on first analysis. Ollama and its text models, and commercial VST3 plugins, are separate optional components. macOS/Linux installers are not included.

설치형에는 Python·FFmpeg·음성 분석 라이브러리·CUDA 런타임을 포함하므로 개발용 Node/Python 설치가 필요하지 않습니다. GPU에는 호환되는 NVIDIA 드라이버가 필요합니다. **Whisper/Nemotron 가중치는 별도**이며 앱의 첫 분석 때 다운로드할 수 있습니다. Ollama·텍스트 모델·상용 VST3는 별도 선택 구성요소입니다. macOS/Linux 설치 패키지는 제공하지 않습니다.

## 2. 원본 열기와 프로젝트 관리

*Open media and manage projects*

Use the three **Workspace** buttons below the header: **Subtitles & video** for the timeline editor, **Interviews & minutes** to open document editing, and **Recording** to open microphone/system capture and recovery. These are entry points into the same project: switching does not reset captions, notes or speakers. Closing document/recording windows returns to editing. To start a different recording as a new project, use the separate **New project** action or the recorder's explicit analysis action.

상단의 작업 모드에서 **자막·영상 편집 / 인터뷰·회의록 / 녹음**을 선택합니다. 편집은 타임라인, 인터뷰·회의록은 문서 창, 녹음은 마이크·시스템 소리 녹음 및 복구 창을 엽니다. 같은 프로젝트를 사용하므로 전환만으로 자막·메모·인물을 초기화하지 않으며, 문서·녹음 창을 닫으면 편집으로 돌아갑니다. 다른 자료를 새 프로젝트로 시작하려면 별도의 `새로` 또는 녹음 결과의 `새 프로젝트로 분석`을 사용하세요.

Open video or MP3/M4A/WAV/FLAC audio; preview support depends on the codec even when analysis is possible. The default upload limit is 8 GiB. Start unrelated work with **New project**, which resets speakers and edits. Merely replacing the media can keep captions and notes.

Save project JSON and the original media separately: JSON contains edits, styles, cuts, translations and documents, **not media**. Reopen JSON, then reconnect the same source. Project relinking checks name and duration, not a portable full-file fingerprint; confirm it is the correct recording. Selecting a differently named source resets cuts after confirmation while caption/note times remain.

영상 또는 MP3·M4A·WAV·FLAC 등 음성 파일을 열 수 있습니다. 컨테이너의 실제 코덱에 따라 브라우저 미리보기 지원이 다를 수 있으므로, 분석 가능과 미리보기 가능을 동일하게 보지는 않습니다. 업로드 한 파일의 기본 제한은 8GiB입니다.

새 작업은 `새 프로젝트`로 시작합니다. 새 프로젝트는 인물 이름·색·스타일과 편집 내용을 초기화합니다. 다른 미디어만 연결하는 동작은 새 프로젝트 생성이 아니며 기존 자막·메모가 남을 수 있습니다.

`프로젝트 저장`으로 JSON 파일을 보관합니다. 자막·인물·스타일·노트·컷·번역·인터뷰/회의록 정보가 들어가고 **원본 미디어는 들어가지 않습니다**. 프로젝트 JSON과 원본 파일을 함께 보관하세요.

다시 열 때는 프로젝트 JSON을 연 뒤 같은 원본을 연결합니다. 현재 프로젝트의 원본 재연결은 파일명·길이를 확인하며, 휴대 가능한 파일 해시로 완전한 동일성을 보증하지 않습니다. 파일명과 길이가 같아도 다른 영상이면 잘못 연결할 수 있으므로 원본을 직접 확인하세요. 다른 이름의 미디어를 연결하면 확인 후 컷을 초기화하며 자막·메모 시간은 유지하므로 새 자료에는 새 프로젝트를 사용하는 편이 분명합니다.

## 3. 인물별 자막 분석

*Create speaker-aware subtitles*

Choose expected participants and conversation/review mode; open analysis, select the intended audio track, set AUTO or a known speech language, then choose large-v3/large-v3-turbo and GPU/CPU. Keep Whisper + Nemotron for speaker-aware results, or choose transcription only and assign speakers yourself. Review warnings before applying: applying replaces current captions, so save work first. Listen, rename speaker numbers, and inspect unassigned/overlap/boundary-adjusted captions.

`4+` means **at least four**, not a forced four-speaker result; detected speakers 5–8 are retained. All eight model channels being used may indicate additional mixed speakers. Short-word boundary correction offers off/0.2/0.5/0.8 seconds and affects the next analysis only; a wider allowance can misassign words. For isolated OBS tracks, map up to eight tracks to people and exclude the combined mix. This does not separate mixed voices.

1. 예상 인원과 일반 대화 / 동시 발화 검수 모드를 선택합니다.
2. `음성 분석`에서 오디오 트랙을 고릅니다. 게임 음향만 들어 있는 트랙이나 중복 믹스 트랙을 고르지 않았는지 확인합니다.
3. 음성 언어는 `AUTO` 자동 감지 또는 직접 선택합니다. 한국어 중심 자료처럼 주 언어를 아는 경우 직접 지정할 수 있습니다. 표시 언어나 번역 언어와는 별개입니다.
4. Whisper 모델과 연산 장치를 선택합니다. 기본은 `large-v3`이며 `large-v3-turbo`도 선택할 수 있습니다. GPU 준비 상태와 오류 설명을 확인하세요. 큰 모델의 CPU 처리는 오래 걸릴 수 있습니다.
5. 기본 `인물별 자막 생성 · Whisper + Nemotron`으로 분석합니다. `전사만 생성`은 인물을 직접 지정하는 선택입니다.
6. 결과와 경고를 확인하고 적용합니다. 적용하면 현재 자막을 교체하므로 필요한 이전 내용은 먼저 프로젝트로 저장하세요.
7. 목소리를 들어 자동 화자 번호에 실제 이름을 붙이고 미배정·동시 발화·경계 보정 자막을 검수합니다.

예상 인원 `1명·2명·3명`은 그 인원과 비교하고, **`4명 이상`은 최소 4명**이라는 뜻입니다. 검출된 5~8명을 4명으로 합치지 않습니다. 모델의 8개 화자 채널이 모두 사용되면 추가 화자가 섞였는지 확인하라는 경고가 나올 수 있습니다. 선택 인원은 정확한 화자 수나 실제 이름을 모델에 강제하는 기능이 아닙니다.

짧은 “The” 같은 말머리의 미배정이 많으면 `짧은 단어 화자 보정`을 조절할 수 있습니다. 끄기·0.2초·0.5초·0.8초 중 선택하며 **다음 분석부터** 적용합니다. 인접 단어·화자 활동이 일치할 때 제한적으로 보정하고, 겹침이나 전환은 미배정으로 남깁니다. 허용 폭을 넓히면 오배정 위험도 커집니다.

OBS 등에 인물별 마이크가 분리되어 있다면 최대 8개 트랙을 인물에 직접 연결해 순차 전사할 수 있습니다. 트랙마다 한 사람일 때 사용하고 전체 믹스 트랙은 제외합니다. 자세한 절차는 [분리 트랙 분석](EDITING-WORKFLOWS.md#obs-등에서-분리해-녹음한-트랙-분석)을 참고하세요.

## 4. 자막·인물·타임라인 편집

*Edit captions, speakers and the timeline*

Click a timeline caption to seek and reveal its row. Edit text, timing, speaker, name/color/style and review status; add time-linked notes. Collapse/resize the timeline or use compact/focus mode. Captions are paged in groups of 100, with bulk speaker/review/delete and literal find/replace. Load a summarized waveform and drag caption boundaries. See [detailed editing workflows](EDITING-WORKFLOWS.md).

In v0.2.1, wide layouts place a compact preview beside the main caption editor. Use the height slider or hide the picture while retaining playback. Notes start collapsed; choosing a timeline note opens its card. Windows up to 1000 px wide start in subtitle focus view, with a separate saved preference from wider windows. Show all panels to access collapsible project settings. The timeline is temporarily folded in narrow/focus views. The desktop window can be narrowed to 480 px. These changes do not clear projects, names or notes.

타임라인의 자막을 클릭하면 해당 시간과 자막으로 이동합니다. 인물 이름·색상·기본 자막 스타일을 정하고 필요한 자막은 개별 스타일로 바꿀 수 있습니다. 시작·끝 시간, 내용, 인물을 수정하고 검수 완료로 표시합니다. 메모도 시간과 연결해 타임라인에서 확인합니다.

타임라인 접기·높이 조절, 촘촘한 자막 목록과 자막 집중 보기를 사용해 편집 공간을 확보할 수 있습니다. 긴 목록은 100행씩 표시하며, 일괄 인물 지정·검수·삭제와 문자열 찾기/바꾸기를 제공합니다. `파형 불러오기`로 선택 트랙의 요약 파형을 표시하고 자막 경계 손잡이를 조절할 수 있습니다. 상세 조작은 [편집 워크플로](EDITING-WORKFLOWS.md#많은-자막을-검수하기)에 있습니다.

v0.2.1은 넓은 화면에서 작은 미리보기 옆에 자막 편집기를 크게 둡니다. 미리보기 높이를 조절하거나 화면만 접고 재생 컨트롤을 유지할 수 있습니다. 메모는 기본으로 접히며 타임라인에서 선택하면 해당 카드가 열립니다. 너비 1000px 이하에서는 자막 집중 보기로 시작하고, 좁은 창과 넓은 창의 선호를 따로 기억합니다. `전체 패널 보기`에서 접을 수 있는 프로젝트 설정에 접근합니다. 좁은 창·집중 보기의 타임라인 접힘은 임시입니다. 설치형 창은 너비 480px까지 줄일 수 있으며 프로젝트·인물 이름·메모를 지우지 않습니다.

## 5. 간단한 컷과 출력

*Cuts and export*

Exclude time ranges without overwriting the source, preview the kept material, and restore cuts or undo. Project captions/notes retain source times. Save project JSON for continued editing; export SRT for plain subtitles, ASS for styles, or a ZIP for all/speaker SRTs, notes and a manifest. These regular exports use **source time**. Render MP4/WAV/MP3/M4A and use that completed render's SRT/notes for **output time**. Cuts across captions may block export until you split/review the text at the boundary. MP4 can use the detected source rate, 30 or 60 fps, always re-encoded at a constant rate. Rendering selects one audio track; final multitrack mixing, multiple-video arrangements and burned-in subtitles are not implemented.

`간단한 컷편집`에서 시작·끝을 지정해 구간을 제외합니다. 원본을 덮어쓰지 않고 편집 결정을 저장하며, 제외 구간 복원과 실행 취소를 지원합니다. 편집본 미리보기는 해당 구간을 건너뜁니다. 원본 편집 화면의 자막·노트 시간은 계속 원본 기준입니다.

| 필요한 결과 | 출력 선택과 주의점 |
| --- | --- |
| 편집을 나중에 계속 | 프로젝트 JSON + 별도 원본 미디어 |
| 여러 편집기에서 쓸 기본 자막 | 전체 또는 인물별 SRT. 색·글꼴 스타일은 보존하지 않음 |
| 자막 스타일 전달 | ASS. 지원 플레이어의 글꼴·줄바꿈에 따라 표시가 달라짐 |
| 인물별 자막을 한 번에 전달 | SRT 묶음 ZIP. 전체/인물별 SRT, 메모 CSV, 인물 명세 포함 |
| 잘린 영상·음성 | MP4·WAV·MP3·M4A 렌더. 현재 한 오디오 트랙 선택 |
| 컷 뒤 시간에 맞는 자막·메모 | 완료한 렌더 창의 편집본 SRT·메모 CSV |

일반 내보내기의 SRT·ASS·ZIP은 **원본 시간**입니다. 렌더 결과의 SRT·메모는 **출력 시간**입니다. 컷이 자막 중간을 가로지르는데 유효한 단어 시간이 없으면 편집본 SRT 저장이 차단될 수 있습니다. 원본 편집기에서 컷 경계에 맞게 자막을 나누고 내용·시간을 검수하세요.

MP4는 원본 프레임률·30·60fps를 선택합니다. `원본`도 탐지된 프레임률로 고정 프레임률 재인코딩하며 가변 프레임률을 그대로 복사하지 않습니다. 영상에 자막을 직접 입히기, 여러 영상 배치, 최종 렌더의 다중 오디오 트랙 믹스는 아직 지원하지 않습니다.

## 6. 화면 언어와 자막 번역

*UI language and translation*

The UI supports Korean, English, Japanese, Simplified Chinese and Spanish; it does not translate existing names or original captions. Speech recognition language is independent. For subtitle translation, prepare local Ollama and a text model yourself, then choose target language/model/GPU-auto or CPU, review, and apply. The app does not install/start Ollama or pull models. Translations preserve source timing and are stored separately. Editing the source makes old translations stale; missing/stale translations block translated export. See the [translation contract](CUTS-AND-LANGUAGES.md#로컬-자막-번역).

Advanced settings can instead use a Groq/xAI text model with your session API key and explicit text-transmission confirmation. The same source/translation review rules apply; the local GPU/CPU option applies only to Ollama. See [advanced providers](ADVANCED-PROVIDERS.md).

화면 언어는 한국어·일본어·영어·중국어 간체·스페인어를 지원합니다. 화면 언어를 바꿔도 자막 원문이나 인물 이름은 바꾸지 않습니다. 음성 인식 언어는 별도로 AUTO/직접 선택합니다.

자막 번역에는 같은 컴퓨터에서 실행 중인 Ollama와 준비된 텍스트 모델이 필요합니다. 앱이 Ollama를 설치·시작하거나 모델을 자동으로 받지 않습니다. `자막 번역`에서 대상 언어와 모델, GPU 자동/CPU를 선택하고 결과를 검토한 뒤 적용합니다. 원문과 시간은 보존하고 번역을 별도로 저장합니다. 원문이 바뀌면 번역을 다시 확인해야 하며 누락·오래된 번역이 있으면 번역 자막 내보내기를 막습니다. 세부 규칙은 [번역 계약](CUTS-AND-LANGUAGES.md#로컬-자막-번역)을 참고하세요.

고급 설정에서는 세션 API 키와 명시적 텍스트 전송 확인을 거쳐 Groq·xAI 텍스트 모델을 대신 사용할 수 있습니다. 원문·번역 검수 규칙은 동일하며 GPU/CPU 선택은 로컬 Ollama에만 적용합니다. [고급 공급자 설정](ADVANCED-PROVIDERS.md)을 확인하세요.

## 7. 인터뷰와 회의록

*Interviews and meeting minutes*

The default **Transcript** tab produces a chronological document like `Minjun: Let's start.` directly from the current captions. It does not need Ollama or a paid API. Save an editable Word `.docx`, UTF-8 `.txt`, HTML, or open print preview for PDF. Timestamps are optional. Speaker names and original utterances come from your edited project; review recognition errors in the caption editor before exporting. Q&A tagging and AI summaries are separate tabs.

기본 **발언록** 탭은 `청둥찌덕: 오늘 이야기할 내용은…`처럼 현재 자막을 인물별 발언 순서로 정리합니다. Ollama나 유료 API 없이 바로 만들며, Word `.docx`·UTF-8 `.txt`·HTML 저장과 PDF용 인쇄 미리보기를 지원합니다. 시간 표시는 선택입니다. 프로젝트의 인물 이름과 원문을 사용하므로 인식 오류는 자막 편집기에서 고친 뒤 출력하세요. 문답 분류와 AI 회의 요약은 별도 탭입니다.

Assign interviewer/respondent/participant roles and question/answer/other caption tags. Timestamps return to the source. Write summaries/discussions/decisions/actions manually with evidence captions, or use a prepared local Ollama model for drafts. Review owners, dates, proposals versus decisions, jokes and reversals; generated items are never automatically confirmed. Changed evidence text, timing or speaker requires review. Store documents in project JSON and export Markdown.

`인터뷰·회의록`에서 인물의 질문자·답변자·참여자 역할과 자막별 질문·답변·기타를 수정합니다. 시간 표시를 누르면 원문으로 돌아갑니다.

회의록에는 요약·논의·결정·할 일을 수동으로 작성하고 근거 자막을 연결할 수 있습니다. 준비된 로컬 Ollama 모델이 있으면 초안 생성을 사용할 수 있습니다. 결과는 검토 후 직접 추가하며 자동 확정하지 않습니다. 담당자·기한, 제안과 결정, 농담과 번복을 원문과 비교하세요. 근거 자막의 내용·시간·인물이 바뀌면 재확인이 필요합니다. 문서는 프로젝트 JSON에 저장하고 Markdown으로 내보낼 수 있습니다. 자세한 한계는 [근거 문서 안내](EDITING-WORKFLOWS.md#인터뷰와-근거가-있는-회의록)에 있습니다.

Groq/xAI text generation is also optional through advanced settings; it transmits the selected transcript text after confirmation. Keep draft items separate from verified statements. Generated drafts must be added or discarded before exporting a document.

고급 설정에서 Groq·xAI 텍스트 생성을 선택할 수도 있으며, 확인 후 선택한 전사 텍스트를 보냅니다. 생성 초안은 확인된 사실과 구분해 검토하세요. 생성한 초안을 문서에 추가하거나 버린 뒤 내보낼 수 있습니다.

| Output / 출력 | Contents / 내용 |
| --- | --- |
| HTML report / HTML 보고서 | Standalone offline report with names, source times, Q/A or minutes and evidence / 이름·원본 시간·문답 또는 회의 항목·근거를 담은 독립 보고서 |
| PDF through print / 인쇄를 통한 PDF | Open report preview, then choose Save as PDF in the print dialog; the browser/app must support printing / 보고서 미리보기에서 인쇄를 열고 PDF 저장 선택, 브라우저·앱의 인쇄 기능 필요 |
| Excel `.xlsx` / Excel 통합문서 | Interview: report + transcript; minutes: report + transcript + actions + evidence / 인터뷰는 보고서·전체 대사, 회의록은 보고서·전체 대사·할 일·근거 시트 |
| Markdown / Markdown 문서 | Editable plain-text document / 수정 가능한 텍스트 문서 |

Reports show pending review and stale evidence. Export timestamps are not the meeting date. Original media times are retained; cuts do not rewrite report evidence times. Save project JSON as well to continue editing. PDF printing does not automatically save a file, and an embedded browser without printing can still download HTML/XLSX.

보고서에는 검수 대기·변경된 근거 상태를 표시합니다. 내보낸 시각을 회의 일시로 표시하지 않으며, 원본 미디어 시간은 컷편집 뒤에도 유지합니다. 편집을 계속하려면 프로젝트 JSON도 보관하세요. PDF는 자동 파일 저장이 아니며, 인쇄를 지원하지 않는 내장 브라우저에서는 HTML·XLSX를 내려받을 수 있습니다.

## 8. 마이크·시스템 소리 녹음

*Microphone and system audio recording*

Use **Microphone permission / refresh devices** to reveal available device names. The temporary permission stream is released after enumeration; this does not start a saved recording. Refresh after attaching an interface or changing permissions. If a fixed input disappears, choose a device again; the app does not silently switch to the OS default. Default input follows the OS default. Individual WASAPI playback-endpoint selection is not yet implemented.

**마이크 권한 확인·장치 새로고침**으로 사용 가능한 장치 이름을 확인합니다. 권한 확인용 임시 스트림은 목록 조회 뒤 해제하며 저장 녹음을 시작하지 않습니다. 오인페 연결이나 권한 변경 뒤 다시 새로고침하세요. 고정 입력이 사라지면 장치를 다시 선택해야 하며 OS 기본 장치로 자동 전환하지 않습니다. `기본 입력 장치`는 OS 기본값을 따릅니다. 개별 WASAPI 재생 출력 선택은 아직 구현되지 않았습니다.

Choose microphone/system/both and explicitly approve capture. System output may include calls, games and notifications; shared video is not stored in the recording. Support depends on the browser, OS and shared source. Approximately one-second chunks are saved locally. After stopping, download source files/mix/metadata or open the mix in a new project for analysis. **This is post-recording analysis, not live transcription.** Stable streaming speaker IDs, automatic device reconnection and external clock-drift correction are not implemented. Completed chunks may survive interruptions, but the last unwritten chunk and playability of every interrupted file are not guaranteed. Sessions are limited to 2 GiB across all sources and available browser storage.

상단 `녹음`을 눌러 연 `라이브 녹음·복구` 창에서 마이크·시스템 소리·둘 다 중 하나를 선택합니다. 시작 버튼을 누른 뒤 권한 요청과 소리 공유 대상을 확인하세요. 시스템 소리에는 게임·통화·알림 등이 함께 들어갈 수 있습니다. 화면 공유 허가를 사용하더라도 저장 파일에는 오디오만 넣습니다. 브라우저·OS·선택 대상에 따라 시스템 소리 공유가 지원되지 않을 수 있습니다.

약 1초 단위로 기기의 브라우저 저장소에 보관합니다. 녹음을 종료하면 소스별 파일·혼합본·메타데이터를 내려받거나 혼합본을 `새 프로젝트로 분석`할 수 있습니다. **녹음 종료 후 분석이며 실시간 자막 생성은 아닙니다.** 스트리밍 화자 고정, 장치 자동 재연결, 외부 오디오 드리프트 보정은 없습니다.

비정상 종료 뒤 저장을 마친 조각은 복구 목록에 남지만 마지막 미저장 조각과 모든 중단 파일의 재생을 보장하지 않습니다. 모든 소스 합계 2GiB 제한과 브라우저 저장 공간을 확인하고 중요한 녹음은 내려받아 보관하세요. [녹음·복구의 상세 한계](EDITING-WORKFLOWS.md#마이크시스템-소리-녹음과-복구)를 참고하세요.

## 9. VST3 사전처리

*VST3 preprocessing*

Use up to four separately installed/activated Windows x64 VST3 effects. CLEAR/RX licenses and plugins are not included. Add effects, adjust order/bypass/parameters and compare a short original/processed preview. Default processing applies to ASR only; applying it to Nemotron is optional. Reported plugin latency is compensated per processing run, not independently measured physical delay. Over-denoising can remove speech. Source files and final rendered audio are unchanged. Native plugin GUIs, vendor preset files and real-time VST processing are unsupported. See [VST details](VST-CHAIN.md).

설치·활성화한 Windows x64 VST3 효과를 최대 4개 연결할 수 있습니다. CLEAR·RX 플러그인과 라이선스는 앱에 포함되지 않습니다. `음성 분석`의 VST 영역에서 추가하고 순서·우회·매개변수를 조절한 뒤 짧은 원본/처리음 비교를 먼저 만드세요.

기본은 음성 인식에만 적용하며 Nemotron에도 적용할지 선택할 수 있습니다. 각 플러그인이 보고하는 지연을 처리마다 보정합니다. 잘못 보고된 지연이나 강한 잡음 제거에 따른 말소리 손실까지 자동으로 해결하지는 않습니다. 원본과 최종 렌더 오디오는 이 전처리로 바뀌지 않습니다. 전용 플러그인 창·제조사 프리셋·실시간 VST 처리는 지원하지 않습니다. [VST 사용법](VST-CHAIN.md)을 참고하세요.

## 10. 저장 복구·오류·디스크 관리

*Recovery, errors and storage*

Autosave Recovery lists current/previous/damaged JSON; download before restoring or removing damaged data. One previous snapshot is not a full history or external backup. Job History reopens analysis/render results; closing a dialog need not stop a running server job, but restarting the server does not resume interrupted computation. Results from another project/source are not silently applied. Delete unneeded terminal job history before removing unreferenced cached copies; original files, models and recorded sessions are separate. Settings/Error Logs exports diagnostics, including client-only logs if the server is unavailable. Settings JSON is distinct from project JSON. Logs are not automatically sent elsewhere; inspect before sharing.

| 상황 | 조치 |
| --- | --- |
| 자동 저장이 손상됐거나 이전 정상본이 필요함 | `자동 저장 복구`에서 현재·이전·오류 원본을 확인하고 JSON을 내려받은 뒤 복구합니다. 이전본 하나는 전체 편집 이력이나 외부 백업을 대신하지 않습니다. |
| 분석·렌더 창을 닫았음 | `작업 이력·저장 공간`에서 다시 엽니다. 서버가 살아 있으면 창을 닫아도 작업이 계속될 수 있습니다. |
| 서버 연결이 끊김 | 재연결하거나 화면에서 나갈 수 있습니다. 서버 재시작은 진행 중 계산을 자동 재개하지 않습니다. |
| 이전 분석을 현재 프로젝트에 적용할 수 없음 | 해당 프로젝트와 확인된 같은 원본인지 확인합니다. 다른 프로젝트의 결과는 자동으로 덮어쓰지 않습니다. |
| 디스크 공간 부족 | 필요한 결과를 저장한 뒤 종료된 작업 이력을 삭제하고 참조가 풀린 미디어 캐시를 정리합니다. 녹음 보관함과 모델 캐시는 별도입니다. |
| 모델·CUDA·VST 오류 | 화면의 준비 상태·오류를 확인하고 `설정 및 오류 로그`에서 로그를 저장합니다. 설치형 시작 오류는 앱 데이터의 `logs/backend.log`에도 기록합니다. |

설정 JSON과 프로젝트 JSON은 용도가 다릅니다. 설정 백업에는 화면 언어·분석 선호·VST 체인이, 프로젝트에는 편집 내용이 들어갑니다. 로그는 자동 외부 전송하지 않습니다. 문제를 공유할 때는 내보낸 로그에 민감한 경로·내용이 남아 있는지 확인하고 필요한 부분만 전달하세요. [설정과 오류 로그](SETTINGS-AND-LOGS.md)에 위치·보관 범위가 있습니다.

## 11. 앱 업데이트

*App updates*

**The v0.2.1 Preview has no update feed or code signature; in-app updating is `unconfigured`.** Public downloads and the online bootstrap do not configure electron-updater. Install a supplied newer setup manually. The future configured flow is check → download → save and restart, with no automatic download/install-on-quit. Back up project JSON before replacement; consult version-specific evidence for tested migration paths.

**이번 v0.2.1 Preview는 업데이트 feed와 코드 서명이 없어 인앱 업데이트가 `unconfigured`입니다.** 공개 다운로드나 온라인 설치기는 electron-updater를 설정하지 않습니다. 이후 버전은 제공된 새 설치 파일로 교체합니다.

The app and Python backend report version 0.2.1. During analysis, the latest two completed recognition segments appear as a draft. Elapsed time also updates before the first segment; a ticking timer alone is not evidence of new recognition activity. Draft text is not applied to captions until the completed result is explicitly applied. See the [release scope](releases/v0.2.1.md).

앱과 Python 백엔드는 0.2.1을 표시합니다. 분석 중 최근 인식 구간 두 개를 초안으로 보여주며 첫 구간 전에도 경과 시간을 표시합니다. 시간 증가만으로 새 인식 결과가 생성되었다고 판단하지 않습니다. 초안은 자막을 자동으로 바꾸지 않으며 완료 후 결과 적용을 눌러야 합니다. [릴리즈 범위](releases/v0.2.1.md)를 참고하세요.

향후 feed가 구성된 설치형에서는 `앱 업데이트`에서 확인 → 다운로드 → 저장 후 다시 시작을 각각 선택하는 구조입니다. 자동 다운로드·종료 시 자동 설치는 하지 않습니다. 브라우저 개발 화면에서는 설치형 업데이트를 사용할 수 없습니다. GitHub 게시와 feed 연결은 별개이며 버전별 실제 검증 여부는 [릴리즈 기록](releases/v0.2.1.md)을 따릅니다. 프로젝트·모델 캐시를 유지하도록 구성하지만 수동 교체 전 별도 프로젝트 백업을 권장합니다.
