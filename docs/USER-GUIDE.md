# VOICESUBSEP User Guide / 사용자 가이드

This guide targets **0.3.0 on Windows 10/11 x64**. The [0.3.0 release record](releases/v0.3.0.md) is the authority for published files, installation and validation status; this guide describes how the implemented features work. See [feature status](FEATURE-STATUS.md) for limits.

Windows 10/11 x64의 **0.3.0 대상 사용법**입니다. 게시 파일·설치·검증 상태는 [0.3.0 릴리즈 기록](releases/v0.3.0.md), 기능의 한계는 [기능 현황](FEATURE-STATUS.md)을 확인하세요. 과거 버전의 설치 성공을 새 버전의 성공으로 간주하지 않습니다.

Whisper transcribes **what was said**; Nemotron identifies **who spoke when**. Review both against the source. Diarization does not separate mixed voices into audio stems or reconstruct inaudible speech.

VOICESUBSEP은 로컬 음성 인식과 화자 구분으로 자막을 만들고, 원본을 보며 자막·인물·메모를 고치는 편집기입니다. Whisper는 **무슨 말을 했는지**, Nemotron은 **누가 언제 말했는지**를 분석합니다. 화자 구분은 섞인 목소리를 별도 음원으로 분리하거나 들리지 않는 대사를 복원하는 기능이 아닙니다.

## 1. 설치와 첫 실행

*Install and first launch*

When available in the release record, download `VOICESUBSEP-0.3.0-Online-Setup-x64.exe`, choose a speed limit, and start. It downloads the NSIS installer and data parts, verifies every file and the assembled SHA256, then opens the installation wizard. Verified downloads are reused; partial downloads resume when the server supports Range. It needs .NET Framework 4.8. Use the manual method below if necessary.

릴리즈 기록에서 게시 여부를 확인한 뒤 `VOICESUBSEP-0.3.0-Online-Setup-x64.exe`를 실행하고 속도 제한을 선택합니다. NSIS 설치 프로그램·데이터 조각을 받고 각 파일과 재조립 결과를 SHA256로 검증한 뒤 설치 마법사를 엽니다. 검증된 파일은 재사용하고 미완료 파일은 서버의 Range 지원 시 이어받습니다. .NET Framework 4.8이 필요하며 문제가 있으면 아래 수동 방법을 사용합니다.

The app data is several GB; exact sizes are in the release record. Allow **at least 16 GiB free**, plus models/projects; the helper checks a 12 GiB cache-drive minimum. Speeds are 40/80 Mbps or unlimited, default 80 Mbps. Save project JSON and finish recording/analysis/rendering before replacing the app. The Windows executables are **not Authenticode-signed**. In-app manifest authentication is a separate check, explained in section 11. The source-code ZIP is not an installer. Read the [dependency notices](BUNDLED-NOTICES.md) before redistribution.

앱 데이터는 수 GB이며 정확한 크기는 릴리즈 기록을 따릅니다. **여유 공간 16GiB 이상**과 모델·프로젝트 공간을 준비하세요. 도우미는 캐시 드라이브 최소 12GiB를 검사하며 속도는 기본 80Mbps, 40Mbps·제한 없음도 선택합니다. 앱 교체 전 프로젝트 JSON을 저장하고 녹음·분석·렌더를 끝내세요. Windows EXE는 **Authenticode 미서명**이며 11절의 배포 명세 인증과 다릅니다. 소스 ZIP은 설치 파일이 아니며 재배포 전 [의존성 고지](BUNDLED-NOTICES.md)를 확인합니다.

**Manual fallback / 수동 설치 대안**

Download the matching Offline Setup EXE, **all** `.partNNN` files listed in the release manifest, `installer-manifest.json`, `SHA256SUMS.txt`, and `Assemble-Installer.ps1` into one folder. The command below verifies and assembles `voicesubsep-0.3.0-x64.nsis.7z`; then run the colocated EXE yourself. Do not manually extract the 7z or continue after a hash mismatch. The assembly script does not launch the installer.

같은 버전의 Offline Setup EXE, 명세에 적힌 **모든** `.partNNN`, `installer-manifest.json`, `SHA256SUMS.txt`, `Assemble-Installer.ps1`을 같은 폴더에 받습니다. 아래 명령으로 `voicesubsep-0.3.0-x64.nsis.7z`를 검증·재조립한 뒤 같은 폴더의 EXE를 실행합니다. 7z 직접 압축 해제는 필요 없으며 해시가 다르면 설치하지 마세요. 조립 스크립트는 설치기를 자동 실행하지 않습니다.

```powershell
powershell -NoProfile -File .\Assemble-Installer.ps1
```

If Windows blocks the downloaded script, compare `Get-FileHash .\Assemble-Installer.ps1 -Algorithm SHA256` with the release's `SHA256SUMS.txt`. Unblock only the verified file through its Properties dialog. Do not change system-wide or organizational execution policy for this procedure.

다운로드한 스크립트가 Windows 파일 차단 때문에 실행되지 않으면 `Get-FileHash .\Assemble-Installer.ps1 -Algorithm SHA256`을 릴리즈의 `SHA256SUMS.txt`와 대조하세요. 출처와 해시를 확인한 파일만 속성의 **차단 해제**로 허용합니다. 이 절차 때문에 시스템 전체 실행 정책이나 조직 정책을 바꾸지 마세요.

The installed app includes Python, FFmpeg, speech-analysis libraries and CUDA runtime libraries. No developer Node/Python setup is needed. GPU use still needs a compatible NVIDIA driver. **Whisper/Nemotron weights are separate**: before a live session, connect a short audio/video file and complete one local speech analysis with the same Whisper model and Nemotron enabled. That file analysis downloads missing weights; live mode only uses the resulting complete caches. Commercial VST3 plugins are separate. Text-generation models and macOS/Linux installers are not included.

Python·FFmpeg·음성 분석 라이브러리·CUDA 런타임은 포함하므로 개발 환경을 따로 설치할 필요가 없습니다. GPU에는 호환 NVIDIA 드라이버가 필요합니다. **Whisper/Nemotron 가중치는 별도**이며 라이브 전에 짧은 음성·영상 파일을 연결하고 `음성 분석`에서 라이브에 사용할 같은 Whisper 모델과 로컬 Nemotron을 선택해 분석을 한 번 완료합니다. 이때 없는 가중치를 받으며 라이브는 완성된 캐시만 읽습니다. 상용 VST3·텍스트 생성 모델·macOS/Linux 설치기는 포함하지 않습니다.

## 2. 원본 열기와 프로젝트 관리

*Open media and manage projects*

Use the three **Workspace** buttons below the header: **Subtitles & video** for the timeline editor, **Interviews & minutes** to open document editing, and **Live captions and recording** to open microphone/system capture and recovery. These are entry points into the same project: switching does not reset captions, notes or speakers. Closing document/recording windows returns to editing. To start a different recording as a new project, use the separate **New project** action or the recorder's explicit analysis action.

상단의 작업 모드에서 **자막·영상 편집 / 인터뷰·회의록 / 실시간 자막·녹음**을 선택합니다. 편집은 타임라인, 인터뷰·회의록은 문서 창, 실시간 자막·녹음은 라이브·녹음 및 복구 창을 엽니다. 같은 프로젝트를 사용하므로 전환만으로 자막·메모·인물을 초기화하지 않으며, 문서·녹음 창을 닫으면 편집으로 돌아갑니다. 다른 자료를 새 프로젝트로 시작하려면 별도의 `새로` 또는 녹음 결과의 `새 프로젝트로 분석`을 사용하세요.

Open video or MP3/M4A/WAV/FLAC audio; preview support depends on the codec even when analysis is possible. The default upload limit is 8 GiB. Start unrelated work with **New project**, which resets speakers and edits. Merely replacing the media can keep captions and notes.

Save project JSON and the original media separately: JSON contains edits, styles, cuts and documents, and preserves legacy translation data, **not media**. Reopen JSON, then reconnect the same source. Project relinking checks name and duration, not a portable full-file fingerprint; confirm it is the correct recording. Selecting a differently named source resets cuts after confirmation while caption/note times remain.

영상 또는 MP3·M4A·WAV·FLAC 등 음성 파일을 열 수 있습니다. 컨테이너의 실제 코덱에 따라 브라우저 미리보기 지원이 다를 수 있으므로, 분석 가능과 미리보기 가능을 동일하게 보지는 않습니다. 업로드 한 파일의 기본 제한은 8GiB입니다.

새 작업은 `새 프로젝트`로 시작합니다. 새 프로젝트는 인물 이름·색·스타일과 편집 내용을 초기화합니다. 다른 미디어만 연결하는 동작은 새 프로젝트 생성이 아니며 기존 자막·메모가 남을 수 있습니다.

`프로젝트 저장`으로 JSON 파일을 보관합니다. 자막·인물·스타일·노트·컷·인터뷰/회의록 정보와 이전 프로젝트의 번역 데이터가 보존되며 **원본 미디어는 들어가지 않습니다**. 프로젝트 JSON과 원본 파일을 함께 보관하세요.

다시 열 때는 프로젝트 JSON을 연 뒤 같은 원본을 연결합니다. 현재 프로젝트의 원본 재연결은 파일명·길이를 확인하며, 휴대 가능한 파일 해시로 완전한 동일성을 보증하지 않습니다. 파일명과 길이가 같아도 다른 영상이면 잘못 연결할 수 있으므로 원본을 직접 확인하세요. 다른 이름의 미디어를 연결하면 확인 후 컷을 초기화하며 자막·메모 시간은 유지하므로 새 자료에는 새 프로젝트를 사용하는 편이 분명합니다.

## 3. 인물별 자막 분석

*Create speaker-aware subtitles*

Choose expected participants and conversation/review mode; open analysis, select the intended audio track, set AUTO or a known speech language, then choose large-v3/large-v3-turbo and GPU/CPU. Keep Whisper + Nemotron for speaker-aware results, or choose transcription only and assign speakers yourself. Review warnings before applying: applying replaces current captions, so save work first. Listen, rename speaker numbers, and inspect unassigned/overlap/boundary-adjusted captions.

`4+` means **at least four**, not a forced four-speaker result; detected speakers 5–8 are retained. All eight model channels being used may indicate additional mixed speakers. Short-word boundary correction offers off/0.2/0.5/0.8 seconds and affects the next analysis only; a wider allowance can misassign words. For isolated OBS tracks, map up to eight tracks to people and exclude the combined mix. This does not separate mixed voices.

1. 예상 인원과 일반 대화 / 동시 발화 검수 모드를 선택합니다.
2. `음성 분석`에서 오디오 트랙을 고릅니다. 게임 음향만 들어 있는 트랙이나 중복 믹스 트랙을 고르지 않았는지 확인합니다.
3. 음성 언어는 `AUTO` 자동 감지 또는 직접 선택합니다. 한국어 중심 자료처럼 주 언어를 아는 경우 직접 지정할 수 있습니다. 표시 언어와는 별개입니다.
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

In the current development source, wide layouts place a compact preview beside the main caption editor. Use the height slider or hide the picture while retaining playback. Notes start collapsed; choosing a timeline note opens its card. Windows up to 1000 px wide start in subtitle focus view, with a separate saved preference from wider windows. Show all panels to access collapsible project settings. The timeline is temporarily folded in narrow/focus views. The desktop window can be narrowed to 480 px. These changes do not clear projects, names or notes.

타임라인의 자막을 클릭하면 해당 시간과 자막으로 이동합니다. 인물 이름·색상·기본 자막 스타일을 정하고 필요한 자막은 개별 스타일로 바꿀 수 있습니다. 시작·끝 시간, 내용, 인물을 수정하고 검수 완료로 표시합니다. 메모도 시간과 연결해 타임라인에서 확인합니다.

타임라인 접기·높이 조절, 촘촘한 자막 목록과 자막 집중 보기를 사용해 편집 공간을 확보할 수 있습니다. 긴 목록은 100행씩 표시하며, 일괄 인물 지정·검수·삭제와 문자열 찾기/바꾸기를 제공합니다. `파형 불러오기`로 선택 트랙의 요약 파형을 표시하고 자막 경계 손잡이를 조절할 수 있습니다. 상세 조작은 [편집 워크플로](EDITING-WORKFLOWS.md#많은-자막을-검수하기)에 있습니다.

현재 개발 소스는 넓은 화면에서 작은 미리보기 옆에 자막 편집기를 크게 둡니다. 미리보기 높이를 조절하거나 화면만 접고 재생 컨트롤을 유지할 수 있습니다. 메모는 기본으로 접히며 타임라인에서 선택하면 해당 카드가 열립니다. 너비 1000px 이하에서는 자막 집중 보기로 시작하고, 좁은 창과 넓은 창의 선호를 따로 기억합니다. `전체 패널 보기`에서 접을 수 있는 프로젝트 설정에 접근합니다. 좁은 창·집중 보기의 타임라인 접힘은 임시입니다. 설치형 창은 너비 480px까지 줄일 수 있으며 프로젝트·인물 이름·메모를 지우지 않습니다.

## 5. 간단한 컷과 출력

*Cuts and export*

Exclude time ranges without overwriting the source, preview the kept material, and restore cuts or undo. Project captions/notes retain source times. Save project JSON for continued editing; export SRT for plain subtitles, ASS for styles, or a ZIP for all/speaker SRTs, notes and a manifest. These regular exports use **source time**. Render MP4/WAV/MP3/M4A and use that completed render's SRT/notes for **output time**. Cuts across captions may block export until reviewed. The basic renderer selects one audio track; use the separate **Audio mixer** for multiple file/OBS tracks. Multiple-video arrangements and burned-in subtitles are not included.

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

MP4는 원본 프레임률·30·60fps를 선택합니다. `원본`도 고정 프레임률로 재인코딩하며 가변 프레임률을 그대로 복사하지 않습니다. 기본 렌더는 한 오디오 트랙을 고릅니다. 여러 파일·OBS 트랙을 합치려면 별도의 **오디오 믹서**를 사용하세요. 자막 직접 입히기와 여러 영상 배치는 지원하지 않습니다.

In the mixer, use **Listen to this track**, **Solo**, or **Preview mix** before exporting. Up to ten seconds from the current playback position are rendered from the selected audio streams. Adjust the start field to check another section. The displayed peaks are pre-limiter and playback **sample peaks for that window**, not whole-file or true-peak certification. Solo/listen do not change saved mutes. See [Audio mixer](AUDIO-MIXER.md).

믹서에서 **이 트랙 듣기·솔로·믹스 미리듣기**로 출력 전에 확인합니다. 현재 재생 위치부터 최대 10초 동안 선택한 실제 스트림을 추출하고 시작 시간을 바꿔 다른 구간도 들을 수 있습니다. 리미터 전·재생 피크는 **이 구간의 샘플 피크**이며 전체 파일·true-peak 검사가 아닙니다. 솔로·트랙 듣기는 저장할 음소거 설정을 바꾸지 않습니다. [믹서 사용법](AUDIO-MIXER.md)을 참고하세요.

## 6. 화면 언어와 음성 언어

*Interface and speech languages*

The UI supports Korean, English, Japanese, Simplified Chinese and Spanish. Speech recognition independently supports AUTO or an explicit input language. Changing the interface language does not translate captions. Subtitle translation and automatic AI summaries have been removed; all subtitle previews and exports use the original edited transcript. Existing project translation data is preserved for compatibility.

화면 언어는 한국어·영어·일본어·중국어 간체·스페인어입니다. 음성 인식은 별도로 AUTO 또는 직접 지정합니다. 화면 언어를 바꿔도 자막을 번역하지 않습니다. 자막 번역과 AI 자동 요약은 제거했으며 자막 미리보기·내보내기는 편집한 원문을 사용합니다. 이전 프로젝트에 들어 있는 번역 데이터는 호환을 위해 보존합니다.

## 7. 인터뷰와 회의록

*Interviews and meeting minutes*

The default **Transcript** tab produces a chronological document like `Minjun: Let's start.` directly from the current captions. It does not need Ollama or a paid API. Save an editable Word `.docx`, UTF-8 `.txt`, Excel `.xlsx`, or HTML. The desktop source saves PDF directly; the browser offers PDF print preview. Timestamps are optional. Speaker names and original utterances come from your edited project; review recognition errors in the caption editor before exporting. Q&A tagging and manually written meeting notes are separate views. There is no automatic AI summary.

기본 **발언록** 탭은 `청둥찌덕: 오늘 이야기할 내용은…`처럼 현재 자막을 인물별 발언 순서로 정리합니다. Ollama나 유료 API 없이 바로 만들며, Word `.docx`·UTF-8 `.txt`·Excel `.xlsx`·HTML 저장을 지원합니다. 설치형 소스는 PDF 직접 저장, 브라우저는 PDF용 인쇄 미리보기를 제공합니다. 시간 표시는 선택입니다. 프로젝트의 인물 이름과 원문을 사용하므로 인식 오류는 자막 편집기에서 고친 뒤 출력하세요. 문답 분류와 수동 회의록은 별도 화면이며 AI 자동 요약은 제공하지 않습니다.

Assign interviewer/respondent/participant roles and question/answer/other caption tags. Timestamps return to the source. Write summaries/discussions/decisions/actions manually with evidence captions. Review owners, dates, proposals versus decisions, jokes and reversals; saved draft items are never automatically confirmed. Changed evidence text, timing or speaker requires review. Store documents in project JSON and export Markdown.

`인터뷰·회의록`에서 인물의 질문자·답변자·참여자 역할과 자막별 질문·답변·기타를 수정합니다. 시간 표시를 누르면 원문으로 돌아갑니다.

회의록에는 요약·논의·결정·할 일을 수동으로 작성하고 근거 자막을 연결할 수 있습니다. 자동 생성 없이 직접 작성하며 기존 문서 초안도 그대로 보존합니다. 담당자·기한, 제안과 결정, 농담과 번복을 원문과 비교하세요. 근거 자막의 내용·시간·인물이 바뀌면 재확인이 필요합니다. 문서는 프로젝트 JSON에 저장하고 Markdown으로 내보낼 수 있습니다. 자세한 한계는 [근거 문서 안내](EDITING-WORKFLOWS.md#인터뷰와-근거가-있는-회의록)에 있습니다.

For external AI assistance, export a speaker transcript and provide it to the LLM of your choice. This app does not send transcript text to an AI summarizer.

외부 AI 도움이 필요하면 인물별 발언록을 출력해 원하는 LLM에 직접 넣으세요. 앱이 전사 텍스트를 AI 요약기에 보내지는 않습니다.

| Output / 출력 | Contents / 내용 |
| --- | --- |
| HTML report / HTML 보고서 | Standalone offline report with names, source times, Q/A or minutes and evidence / 이름·원본 시간·문답 또는 회의 항목·근거를 담은 독립 보고서 |
| PDF through print / 인쇄를 통한 PDF | Open report preview, then choose Save as PDF in the print dialog; the browser/app must support printing / 보고서 미리보기에서 인쇄를 열고 PDF 저장 선택, 브라우저·앱의 인쇄 기능 필요 |
| Excel `.xlsx` / Excel 통합문서 | Interview: report + transcript; minutes: report + transcript + actions + evidence / 인터뷰는 보고서·전체 대사, 회의록은 보고서·전체 대사·할 일·근거 시트 |
| Markdown / Markdown 문서 | Editable plain-text document / 수정 가능한 텍스트 문서 |

Reports show pending review and stale evidence. Export timestamps are not the meeting date. Original media times are retained; cuts do not rewrite report evidence times. Save project JSON as well to continue editing. PDF printing does not automatically save a file, and an embedded browser without printing can still download HTML/XLSX.

보고서에는 검수 대기·변경된 근거 상태를 표시합니다. 내보낸 시각을 회의 일시로 표시하지 않으며, 원본 미디어 시간은 컷편집 뒤에도 유지합니다. 편집을 계속하려면 프로젝트 JSON도 보관하세요. PDF는 자동 파일 저장이 아니며, 인쇄를 지원하지 않는 내장 브라우저에서는 HTML·XLSX를 내려받을 수 있습니다.

## 8. 라이브 자막·마이크·시스템 소리 녹음

*Live captions and recording*

Open **Live captions and recording** and choose **Record, then analyze** or **Live captions + recording**. Both modes capture microphone, system audio, or both in the browser/Electron. Use **Microphone permission / refresh devices** to reveal device names; this temporary permission check releases the microphone without creating a recording. A fixed missing input is never silently replaced by the OS default. System sharing depends on the browser/OS and can include calls, games and notifications; only audio is stored. Individual WASAPI playback endpoints and ASIO channel routing are not supported.

상단 **실시간 자막·녹음**에서 **녹음 후 분석** 또는 **라이브 자막 + 녹음**을 고릅니다. 브라우저·Electron 모두 마이크·시스템 소리·둘 다를 선택합니다. **마이크 권한 확인·장치 새로고침**은 이름을 확인한 뒤 임시 마이크 접근을 해제하며 파일 녹음을 시작하지 않습니다. 고정 입력이 사라지면 직접 다시 선택해야 합니다. 시스템 공유는 브라우저·OS에 따라 달라지고 통화·게임·알림까지 담길 수 있으며 영상은 저장하지 않습니다. 개별 WASAPI 출력 장치·ASIO 채널 라우팅은 지원하지 않습니다.

**Live workflow / 라이브 순서**

1. **Prepare the exact models first:** connect a short audio/video file, open speech analysis, select local Whisper with the model you intend to use live, enable local Nemotron, and complete one analysis. Missing weights download during that file analysis. There is no separate model-management screen. Then open live mode with the **same Whisper model**, choose AUTO/explicit language and CPU/NVIDIA GPU, and click **Prepare live engine**. Live preparation loads both complete caches once without downloading or opening the input; a missing/incomplete cache is an error.
2. Choose the input and click **Start live recording**, approving microphone/system sharing as needed. The level meter shows received sound. Whisper commits approximately four-second segments with context; the first result needs roughly five seconds of audio **plus model inference**, not a guaranteed five-second latency. Check received/processed/lag indicators. If processing falls behind, use a faster model for the next session.
3. Copy **OBS subtitle URL** into an OBS Browser Source on the same computer. The loopback URL contains a read-only token. **Turn subtitle output off** and **Clear output captions** only affect the overlay, preserving recording and editable captions. Do not publish the token URL. Restarting the backend invalidates old tokens; copy the current URL again.
4. Click **Stop recording and save**, wait for the remaining audio, then **Open captions and recording as a new project** to review names, words and boundaries. Cancelling analysis preserves available recorded source data but does not promise a completed transcript.

1. **짧은 영상·음성 파일 연결 → 음성 분석 → 로컬 Whisper 모델 선택 + 로컬 Nemotron 사용 → 분석 1회 완료**로 먼저 준비합니다. 라이브에서 사용할 바로 그 Whisper 모델을 고르세요. 없는 가중치는 이 파일 분석 때 받으며 별도 모델 관리 화면은 없습니다. 이어서 라이브에서도 **같은 Whisper 모델**과 AUTO/직접 언어·CPU/NVIDIA GPU를 선택하고 **라이브 엔진 준비**를 누릅니다. 라이브는 완성된 캐시만 한 번 불러와 유지하며, 없거나 불완전하면 오류를 표시합니다. 라이브 준비 중 다운로드나 입력 장치 접근은 하지 않습니다.
2. 소스·입력 장치를 고른 뒤 **라이브 녹음 시작**을 눌러 권한을 승인합니다. 레벨 미터로 입력을 확인하세요. 약 4초 구간 단위로 전사하며 첫 결과에는 음성 약 5초 수집과 **추론 시간**이 필요합니다. 수신·처리·지연 수치를 보고, 계속 밀리면 다음 세션에 더 빠른 모델을 선택합니다.
3. **OBS 주소 복사**의 주소를 같은 컴퓨터의 OBS 브라우저 소스에 넣습니다. 로컬 주소에는 읽기 전용 토큰이 있으므로 공개하지 마세요. **자막 송출 끄기·송출 자막 지우기**는 화면에만 적용하고 녹음·편집 자막은 남깁니다. 백엔드 재시작 뒤에는 새 주소를 복사합니다.
4. **녹음 종료·저장** 후 남은 처리를 기다리고 **자막과 녹음을 새 프로젝트로 열기**에서 이름·내용·경계를 검수합니다. 분석 취소는 저장된 원본을 보존하지만 완성된 전사문을 보장하지 않습니다.

Nemotron keeps its streaming speaker cache for the session; labels remain provisional during adaptation, overlapping speech and short utterances. This is incremental segment recognition, not token-by-token ASR or voice separation. Live mode is local Whisper + Nemotron only: optional cloud providers and VST preprocessing belong to file analysis. One live session is allowed at a time, up to **two hours**; automatic device reconnection and clock-drift correction are not included.

Nemotron은 세션 내 화자 캐시를 유지하지만 초기 적응·동시 발화·짧은 발언의 인물은 임시 배정입니다. 구간 단위 갱신이며 단어마다 즉시 확정하거나 섞인 목소리를 분리하는 기능은 아닙니다. 라이브는 로컬 Whisper+Nemotron 전용이며 클라우드·VST 전처리는 파일 분석에서 사용합니다. 동시 라이브 세션은 하나, 최대 **2시간**이며 장치 자동 재연결·드리프트 보정은 없습니다.

Both recording modes journal approximately one-second chunks locally. After stopping, download source tracks, mix and metadata; record-only mode can start file analysis in a new project. The recorder has a **2 GiB total per-session** limit plus available browser storage. Completed chunks can survive interruption; the last unwritten chunk and every interrupted file's playability are not guaranteed. Save important recordings separately. Live PCM/state is also retained in backend storage, but an interrupted inference session does not automatically resume after restart.

두 방식 모두 약 1초 조각을 로컬 저장소에 보관합니다. 종료 후 소스별 파일·혼합본·메타데이터를 저장하고, 녹음 전용 결과도 새 프로젝트에서 분석할 수 있습니다. 녹음 보관 한도는 **모든 소스 합계 2GiB/세션**과 브라우저 여유 공간입니다. 저장 완료 조각은 복구할 수 있지만 마지막 조각·모든 중단 파일의 재생은 보장하지 않습니다. 라이브 PCM·상태는 백엔드에도 남지만 재시작 뒤 중단된 추론을 자동 재개하지 않습니다. 중요한 파일은 별도로 내려받으세요.

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

The 0.3.0 desktop updater uses the project's public GitHub releases. Open **App update**, explicitly **check**, then **download** a newer offered version. Save project JSON and finish live/analysis/render jobs before choosing **save and restart/install**. It does not automatically download or install on ordinary quit. Browser development mode has no installer update. Older builds with an unconfigured updater need a manual 0.3.0 installation first. See the [release record](releases/v0.3.0.md) for published assets and actual upgrade evidence.

0.3.0 설치형의 **앱 업데이트**는 프로젝트의 GitHub 공개 릴리즈를 사용합니다. **확인 → 다운로드 → 저장 후 다시 시작/설치**를 각각 누릅니다. 설치 전 프로젝트 JSON을 저장하고 라이브·분석·렌더를 끝내세요. 자동 다운로드·일반 종료 시 자동 설치는 하지 않습니다. 브라우저 개발 화면에는 설치 업데이트가 없으며, 업데이트 미설정인 이전 설치본은 0.3.0을 먼저 수동 설치해야 합니다. 게시·실제 업그레이드 검증은 [릴리즈 기록](releases/v0.3.0.md)을 확인하세요.

The updater authenticates `installer-manifest.json` with its bundled **Ed25519 public key**, then checks each file and the assembled payload with SHA256, including another check before launching the installer. The private key is outside the repository. This authenticates the release manifest; **Windows EXEs remain Authenticode-unsigned**. Downloads run serially at **80 Mbps** and reuse complete verified files; an interrupted file restarts on retry. This differs from the online setup's partial Range resume. Neither feature reserves OS bandwidth or limits all model downloads. User data/model caches remain outside the install folder; keep a separate project backup.

업데이트는 포함된 **Ed25519 공개키**로 `installer-manifest.json` 서명을 확인하고 파일·재조립 payload의 SHA256을 검증하며 설치 직전에도 다시 확인합니다. 개인키는 저장소 밖에 있습니다. 이는 배포 명세 인증이며 **Windows EXE의 Authenticode 서명은 없습니다**. 파일은 순차적으로 **80Mbps**로 받고 검증된 완료 파일은 재사용합니다. 중단된 개별 파일은 재시도 때 처음부터 받으며 온라인 설치기의 Range 이어받기와 다릅니다. OS 대역폭 예약이나 전체 모델 다운로드 제한은 아닙니다. 사용자 데이터·모델 캐시는 설치 폴더 밖에 유지하고 프로젝트는 별도 백업하세요.
