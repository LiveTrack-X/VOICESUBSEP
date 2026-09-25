# VOICESUBSEP User Guide / 사용자 가이드

This guide includes the **0.3.4 Windows preview** features. Publication and installation are separate from implementation: check the [0.3.4 release record](releases/v0.3.4.md) before downloading, and [feature status](FEATURE-STATUS.md) for limits. Earlier [0.3.3](releases/v0.3.3.md), [0.3.2](releases/v0.3.2.md) and [0.3.1](releases/v0.3.1.md) release records remain unchanged. Versioned comparisons below explain compatibility.

이 가이드는 **0.3.4 Windows 프리뷰** 기능을 포함합니다. 구현과 게시·설치는 별개이므로 다운로드 전에 [0.3.4 릴리즈 기록](releases/v0.3.4.md)의 상태를 확인하고 한계는 [기능 현황](FEATURE-STATUS.md)을 참고하세요. 이전 [0.3.3](releases/v0.3.3.md)·[0.3.2](releases/v0.3.2.md)·[0.3.1](releases/v0.3.1.md) 릴리즈 기록은 보존하며 아래 버전별 비교는 호환 설명입니다.

Whisper transcribes **what was said**; Nemotron identifies **who spoke when**. Review both against the source. Diarization does not separate mixed voices into audio stems or reconstruct inaudible speech.

VOICESUBSEP은 로컬 음성 인식과 화자 구분으로 자막을 만들고, 원본을 보며 자막·인물·메모를 고치는 편집기입니다. Whisper는 **무슨 말을 했는지**, Nemotron은 **누가 언제 말했는지**를 분석합니다. 화자 구분은 섞인 목소리를 별도 음원으로 분리하거나 들리지 않는 대사를 복원하는 기능이 아닙니다.

## 0.3.4 editing workspace / 0.3.4 편집 화면 사용법

- **Panel widths:** drag the boundary beside project settings; on wide screens, drag the boundary between preview/cuts and captions. Focus a boundary to use Left/Right or Home/End; double-click to restore automatic width. Width preferences stay on this device, and narrow windows retain the stacked layout. / **패널 너비:** 프로젝트 설정 옆 경계를 드래그합니다. 넓은 화면에서는 미리보기·컷과 자막 사이 경계도 조절합니다. 경계에 포커스를 두고 좌우 키·Home/End를 쓰거나 두 번 클릭해 자동 너비로 복원하세요. 기기에 선택을 기억하며 좁은 창은 세로 배치를 유지합니다.
- **Caption columns:** drag the separators beside the **Time** and **Speaker** headings. Left/Right adjusts width, Shift makes a finer change, Home/End selects the limits, and double-click or Enter resets that column. Text fills the remaining space; continuous scrolling and edits remain available. / **자막 열:** **시간·인물** 머리글 옆 경계를 드래그합니다. 좌우 키로 조절하고 Shift로 미세 조절, Home/End로 최소·최대, 두 번 클릭 또는 Enter로 해당 열을 초기화합니다. 자막 본문은 나머지 폭을 사용하며 연속 스크롤·편집을 유지합니다.
- **Preview:** the picture automatically fits both available width and height without stretching or cropping. The old height slider is removed; use the column boundary, preview collapse or fullscreen instead. Black bars encoded in the original remain. / **미리보기:** 실제 가로·세로 공간 안에 원본 비율을 유지하며 맞춥니다. 높이 슬라이더 대신 열 너비·미리보기 접기·전체 화면을 사용하세요. 원본에 들어 있는 검은 여백은 자르지 않습니다.
- **Notes:** expand the notes panel, then drag its upper edge upward to enlarge it; Up/Down or Home/End also works, and double-click restores the default height. Add a note at the current position, edit its start/end as seconds or timecodes, or use the current-time buttons. An empty panel stays compact. / **메모:** 펼친 패널의 위 경계를 위로 끌어 높이를 늘립니다. 위아래 키·Home/End도 지원하며 두 번 클릭하면 기본 높이로 돌아갑니다. 현재 위치에 메모를 추가하고 시작·종료를 초 또는 시간 코드로 편집하거나 현재 시간 버튼을 사용하세요. 메모가 없으면 작은 빈 화면으로 표시합니다.
- **Original reconnection:** after explicitly linking a source in the desktop app, reopening the same project checks the remembered file's SHA256 and byte count. A match connects automatically using a verified cache or a streamed local upload. The sidebar distinguishes checking, connected and disconnected states with text/icons and color. Missing/changed files need manual reconnection; old projects without a remembered path need one explicit link. This is device-local, not browser `File` restoration; large-file checks can take time. / **원본 자동 연결:** 설치형에서 원본을 직접 연결한 뒤 같은 프로젝트를 다시 열면 기억한 파일의 SHA256·크기를 확인합니다. 같으면 검증된 캐시를 쓰거나 로컬 서버에 스트리밍해 자동 연결합니다. 왼쪽에서 확인 중·연결됨·미연결을 글자·아이콘·색으로 구분합니다. 누락·변경된 파일은 다시 선택하고, 위치 기록 없는 기존 프로젝트는 최초 한 번 직접 연결해야 합니다. 같은 기기용 기능이며 브라우저 `File` 복원이 아닙니다. 큰 파일은 확인에 시간이 걸릴 수 있습니다.
- **Timeline menu:** right-click a caption/note, or focus it and press Shift+F10. Choose **Open editor**, **Go to time**, **Move to playback position** or **Delete**. Opening the menu/editor does not start playback. Move preserves duration and respects media boundaries; edits can be undone. / **타임라인 메뉴:** 자막·메모에서 우클릭하거나 포커스 후 Shift+F10을 누릅니다. **편집 열기 / 해당 시점으로 이동 / 현재 재생 위치로 옮기기 / 삭제**를 선택하세요. 메뉴·편집 열기만으로 재생하지 않습니다. 옮기기는 길이와 미디어 끝 경계를 지키며 변경은 실행 취소할 수 있습니다.

## Features introduced in 0.3.3 / 0.3.3에서 추가된 기능

These controls remain available in 0.3.4. The [0.3.3 release record](releases/v0.3.3.md) retains that version's publication and verification evidence; it does not prove a later build's installation. / 아래 조작은 0.3.4에서도 유지합니다. [0.3.3 릴리즈 기록](releases/v0.3.3.md)은 해당 버전의 게시·검증 증거를 보존하며 이후 빌드의 설치 증거를 대신하지 않습니다.

- **Shortcuts:** press **F1** or open the shortcut hub to search commands, assign/unassign keys and restore defaults. Defaults include Space for play/pause, Left/Right for five-second jumps, Ctrl+Z / Ctrl+Shift+Z for undo/redo, and Alt+Up/Down for caption navigation. Conflicting/reserved keys are rejected and preferences stay on this device. Editing shortcuts do not interrupt text input, Korean IME composition, dialogs or a focused button's normal Space action. Modified project-save shortcuts still save focused drafts. / **단축키:** **F1** 또는 단축키 허브에서 검색·개인 지정·해제·기본값 복원을 합니다. 기본 Space 재생/일시 정지, 좌우 5초 이동, Ctrl+Z/Ctrl+Shift+Z 실행 취소/다시 실행, Alt+상하 자막 이동을 제공합니다. 중복·예약 키는 거절하고 기기에 저장합니다. 입력·한글 조합·대화상자·버튼 고유 Space 동작을 방해하지 않으며 Ctrl/Command 조합 프로젝트 저장은 입력 중 초안에도 적용됩니다.
- **Playback follow:** the caption-list toggle starts enabled and remembers your choice. It centers the current caption during playback and paused seeking without changing selected cues, filters or playback. Typing/composition, held pointer gestures and a four-second pause after manual navigation protect editing. / **재생 따라가기:** 기본 켜짐이며 선택을 기억합니다. 재생과 일시정지 중 시간 이동에 맞춰 현재 자막을 중앙에 놓고 자막 선택·필터·재생 시점은 바꾸지 않습니다. 입력·한글 조합·포인터 조작 중, 직접 이동 후 4초 동안은 자동 이동을 멈춥니다.
- **Cuts:** first specify an IN/OUT range with timecodes, seconds, the current playhead or a selected caption; preview it, then explicitly exclude it. The second section lists excluded ranges, lengths and individual/all restore actions. Merely setting a range does not delete it. / **컷:** 첫 단계에서 시:분:초·초 입력, 현재 위치 또는 선택 자막으로 IN/OUT을 정하고 구간 재생 후 직접 제외합니다. 두 번째 목록에서 제외 범위·길이·개별/전체 복원을 확인합니다. 범위 지정만으로 삭제하지 않습니다.
- **Microphone connection:** choose **Check microphone permission and refresh devices**, approve the app's microphone prompt, then choose the real device name. The short probe releases its tracks immediately. The fixed Electron permission check now permits audio-device names after approval and revokes that grant on navigation/reload; it does not enable the camera or silently switch a missing fixed input. Device-list/error feedback appears beside the selector. This path was tested with fake Chromium devices, not your physical microphone. / **마이크 연결:** **마이크 권한 확인·장치 새로고침**으로 명시 허용한 뒤 실제 장치 이름을 선택하세요. 확인용 스트림은 즉시 해제합니다. Electron에서 승인 후에도 이름이 가려지던 검사를 고쳤고 이동·새로고침 때 승인을 무효화합니다. 카메라 허용이나 사라진 고정 장치의 기본값 전환은 하지 않습니다. 목록 상태·오류는 선택기 근처에 표시하며 실제 사용자 마이크 대신 가짜 Chromium 장치로 검증했습니다.
- **Analysis clarity:** the speech-language selector is visually distinct from interface language, and the visible reset action restores local large-v3 + Nemotron. Existing saved choices remain until you explicitly reset them. The window title is simply **VOICESUBSEP**. Optional RNNoise and native VST editors are described in section 9. / **분석 표시:** 화면 언어와 음성 인식 언어를 눈에 띄게 구분하고, 기본 조합 복원 버튼으로 로컬 large-v3+Nemotron을 선택합니다. 저장한 선택은 직접 복원하기 전까지 유지합니다. 창 제목은 **VOICESUBSEP**만 표시합니다. 선택 RNNoise와 VST 전용 창은 9절을 참고하세요.

## 1. 설치와 첫 실행

*Install and first launch*

After publication is confirmed in the [0.3.4 release record](releases/v0.3.4.md), download `VOICESUBSEP-0.3.4-Online-Setup-x64.exe`, choose a speed limit, and start. It downloads the NSIS installer and data parts, verifies every file and the assembled SHA256, then opens the installation wizard. Verified downloads are reused; partial downloads resume when the server supports Range. It needs .NET Framework 4.8. See the [online installer guide](ONLINE-INSTALLER.md), or use the manual method below if necessary.

[0.3.4 릴리즈 기록](releases/v0.3.4.md)에서 게시를 확인한 뒤 `VOICESUBSEP-0.3.4-Online-Setup-x64.exe`를 실행하고 속도 제한을 선택합니다. NSIS 설치 프로그램·데이터 조각을 받고 각 파일과 재조립 결과를 SHA256로 검증한 뒤 설치 마법사를 엽니다. 검증된 파일은 재사용하고 미완료 파일은 서버의 Range 지원 시 이어받습니다. .NET Framework 4.8이 필요합니다. [온라인 설치 안내](ONLINE-INSTALLER.md)를 참고하고 문제가 있으면 아래 수동 방법을 사용합니다.

The app data is several GB; exact sizes are in the release record. Allow **at least 16 GiB free**, plus models/projects; the helper checks a 12 GiB cache-drive minimum. Speeds are 40/80 Mbps or unlimited, default 80 Mbps. Save project JSON and finish recording/analysis/rendering before replacing the app. The Windows executables are **not Authenticode-signed**. In-app manifest authentication is a separate check, explained in section 11. The source-code ZIP is not an installer. Read the [dependency notices](BUNDLED-NOTICES.md) before redistribution.

앱 데이터는 수 GB이며 정확한 크기는 릴리즈 기록을 따릅니다. **여유 공간 16GiB 이상**과 모델·프로젝트 공간을 준비하세요. 도우미는 캐시 드라이브 최소 12GiB를 검사하며 속도는 기본 80Mbps, 40Mbps·제한 없음도 선택합니다. 앱 교체 전 프로젝트 JSON을 저장하고 녹음·분석·렌더를 끝내세요. Windows EXE는 **Authenticode 미서명**이며 11절의 배포 명세 인증과 다릅니다. 소스 ZIP은 설치 파일이 아니며 재배포 전 [의존성 고지](BUNDLED-NOTICES.md)를 확인합니다.

**Manual fallback / 수동 설치 대안**

Download the matching Offline Setup EXE, **all** `.partNNN` files listed in the release manifest, `installer-manifest.json`, `SHA256SUMS.txt`, and `Assemble-Installer.ps1` into one folder. The command below verifies and assembles `voicesubsep-0.3.4-x64.nsis.7z`; then run the colocated EXE yourself. Do not manually extract the 7z or continue after a hash mismatch. The assembly script does not launch the installer.

같은 버전의 Offline Setup EXE, 명세에 적힌 **모든** `.partNNN`, `installer-manifest.json`, `SHA256SUMS.txt`, `Assemble-Installer.ps1`을 같은 폴더에 받습니다. 아래 명령으로 `voicesubsep-0.3.4-x64.nsis.7z`를 검증·재조립한 뒤 같은 폴더의 EXE를 실행합니다. 7z 직접 압축 해제는 필요 없으며 해시가 다르면 설치하지 마세요. 조립 스크립트는 설치기를 자동 실행하지 않습니다.

```powershell
powershell -NoProfile -File .\Assemble-Installer.ps1
```

If Windows blocks the downloaded script, compare `Get-FileHash .\Assemble-Installer.ps1 -Algorithm SHA256` with the release's `SHA256SUMS.txt`. Unblock only the verified file through its Properties dialog. Do not change system-wide or organizational execution policy for this procedure.

다운로드한 스크립트가 Windows 파일 차단 때문에 실행되지 않으면 `Get-FileHash .\Assemble-Installer.ps1 -Algorithm SHA256`을 릴리즈의 `SHA256SUMS.txt`와 대조하세요. 출처와 해시를 확인한 파일만 속성의 **차단 해제**로 허용합니다. 이 절차 때문에 시스템 전체 실행 정책이나 조직 정책을 바꾸지 마세요.

The installed app includes Python, FFmpeg, speech-analysis libraries, CUDA runtime libraries, **Silero VAD ONNX and the pinned RNNoise model**. No developer Node/Python setup is needed. GPU use still needs a compatible NVIDIA driver. **Whisper/Nemotron weights are separate**: before a live session, connect a short audio/video file and complete one local speech analysis with the same Whisper model and Nemotron enabled. That file analysis downloads missing weights; live mode only uses the resulting complete caches. Commercial VST3 plugins are separate. Qwen, text-generation models and macOS/Linux installers are not included.

Python·FFmpeg·음성 분석 라이브러리·CUDA 런타임과 **Silero VAD ONNX·고정 RNNoise 모델은 포함**하므로 개발 환경을 따로 설치할 필요가 없습니다. GPU에는 호환 NVIDIA 드라이버가 필요합니다. **Whisper/Nemotron 가중치는 별도**이며 라이브 전에 짧은 음성·영상 파일을 연결하고 `음성 분석`에서 라이브에 사용할 같은 Whisper 모델과 로컬 Nemotron을 선택해 분석을 한 번 완료합니다. 이때 없는 가중치를 받으며 라이브는 완성된 캐시만 읽습니다. 상용 VST3·Qwen·텍스트 생성 모델·macOS/Linux 설치기는 포함하지 않습니다.

## 2. 원본 열기와 프로젝트 관리

*Open media and manage projects*

Use the three **Workspace** buttons below the header: **Subtitles & video** for the timeline editor, **Interviews & minutes** to open document editing, and **Live captions and recording** to open microphone/system capture and recovery. These are entry points into the same project: switching does not reset captions, notes or speakers. Closing document/recording windows returns to editing. To start a different recording as a new project, use the separate **New project** action or the recorder's explicit analysis action.

상단의 작업 모드에서 **자막·영상 편집 / 인터뷰·회의록 / 실시간 자막·녹음**을 선택합니다. 편집은 타임라인, 인터뷰·회의록은 문서 창, 실시간 자막·녹음은 라이브·녹음 및 복구 창을 엽니다. 같은 프로젝트를 사용하므로 전환만으로 자막·메모·인물을 초기화하지 않으며, 문서·녹음 창을 닫으면 편집으로 돌아갑니다. 다른 자료를 새 프로젝트로 시작하려면 별도의 `새로` 또는 녹음 결과의 `새 프로젝트로 분석`을 사용하세요.

Open video or MP3/M4A/WAV/FLAC audio; preview support depends on the codec even when analysis is possible. **0.3.2 removes the fixed source-upload size limit** and ignores `VOICESUBSEP_MAX_UPLOAD_BYTES`. Large sources still need room for the multipart temporary file, cached copy, extracted audio and outputs. Memory stays bounded during copy/hash; disk capacity, filesystem limits and media validity still apply. Separate project JSON, live recording and provider limits are unchanged. Start unrelated work with **New project**, which resets speakers and edits.

Save project JSON and the original media separately: JSON contains edits, styles, cuts and documents, and preserves legacy translation data, **not media**. Reopen JSON; 0.3.4 desktop reconnection checks a remembered source automatically as described above. Otherwise reconnect it manually. **0.3.2:** source identity uses SHA256 and byte count from the streamed upload. Identical content under a new name keeps edits and cuts; different content requires explicit confirmation to start a new project. Cancelling keeps the current work. An old project without identity requires confirmation of the first linked source before its hash is saved: the app cannot prove that legacy choice from its name or duration. Source verification can be cancelled; a late upload must not bind itself to a different project. 0.3.1 did not have this fingerprint protection.

영상 또는 MP3·M4A·WAV·FLAC 등 음성 파일을 열 수 있습니다. 컨테이너 코덱에 따라 미리보기 지원은 분석 지원과 다를 수 있습니다. **0.3.2는 원본 업로드의 고정 용량 제한을 제거**하고 `VOICESUBSEP_MAX_UPLOAD_BYTES`도 적용하지 않습니다. 큰 원본은 multipart 임시 파일·캐시 사본·추출 오디오·출력 파일을 위한 공간이 필요합니다. 복사·해시는 제한된 메모리로 처리하지만 실제 디스크·파일시스템·미디어 유효성 제약은 남습니다. 프로젝트 JSON·라이브 녹음·공급자별 한도는 별개로 유지합니다.

새 작업은 `새 프로젝트`로 시작합니다. 새 프로젝트는 인물 이름·색·스타일과 편집 내용을 초기화합니다.

`프로젝트 저장`으로 JSON 파일을 보관합니다. 자막·인물·스타일·노트·컷·인터뷰/회의록 정보와 이전 프로젝트의 번역 데이터가 보존되며 **원본 미디어는 들어가지 않습니다**. 프로젝트 JSON과 원본 파일을 함께 보관하세요.

다시 열 때는 프로젝트 JSON을 엽니다. 0.3.4 설치형은 위 설명처럼 기억한 원본을 자동 확인하고, 해당하지 않으면 같은 원본을 직접 연결합니다. **0.3.2:** 업로드를 스트리밍하며 계산한 SHA256·바이트 수로 원본을 식별합니다. 이름이 바뀌어도 내용이 같으면 편집·컷을 유지하고, 내용이 다르면 새 프로젝트를 시작할지 직접 확인합니다. 취소하면 기존 작업을 유지합니다. 식별 정보 없는 옛 프로젝트는 첫 원본을 사용자가 확인한 뒤 해시를 저장하며 파일명·길이만으로 그 선택의 진위를 보증하지 않습니다. 확인 중 `연결 취소`나 프로젝트 전환은 늦게 끝난 업로드가 현재 프로젝트에 연결되는 것을 막습니다. 0.3.1에는 이 해시 보호가 없습니다.

**0.3.2 export check:** a bound single-source render rechecks the actual cached file's SHA256 and byte count just before rendering. Changed files and missing/corrupt export snapshots fail before the renderer runs. The check reads bounded blocks, accepts cancellation and never changes the original. Legacy API snapshots genuinely lacking identity keep compatibility; mixer inputs retain their separate per-track identity contract.

**0.3.2 내보내기 검사:** 원본이 등록된 단일 파일 렌더는 시작 직전에 실제 캐시 파일의 SHA256·바이트 수를 다시 검사합니다. 다른 파일이나 소실·손상된 작업 스냅샷은 렌더를 실행하지 않고 오류로 처리합니다. 검사는 작은 블록 단위로 읽고 취소할 수 있으며 원본을 수정하지 않습니다. 식별 정보가 원래 없는 기존 API 스냅샷은 호환을 유지하고 믹서는 별도의 트랙별 식별 계약을 사용합니다.

## 3. 인물별 자막 분석

*Create speaker-aware subtitles*

Choose expected participants and conversation/review mode; open analysis, select the intended audio track, set AUTO or a known speech language, then choose large-v3/large-v3-turbo and GPU/CPU. Keep Whisper + Nemotron for speaker-aware results, or choose transcription only and assign speakers yourself. Review warnings before applying: applying replaces current captions, so save work first. Listen, rename speaker numbers, and inspect unassigned/overlap/boundary-adjusted captions.

**0.3.1 local Whisper AUTO:** file analysis detects the main language near the beginning and keeps it, instead of detecting a different language for every segment. Live mode retains the first detected language with committed speech and a detection probability of at least 0.5; empty/uncertain windows try again. No Korean or other fallback language is forced. If the recording mainly uses a known language, select it directly before analysis. Neither choice removes genuine foreign-language text or guarantees hallucination-free output. Mixed-language recordings need review; cloud ASR policies are unchanged.

**0.3.1 로컬 Whisper AUTO:** 파일 초반의 주 언어를 감지해 유지하며 매 구간 다른 언어로 전환하지 않습니다. 라이브는 실제 반영할 발화가 있고 언어 감지 확률이 0.5 이상일 때 처음 감지한 언어를 유지합니다. 빈 결과·낮은 확률이면 다음 구간에서 재시도하며 한국어 등 특정 언어로 대체하지 않습니다. 주 언어를 아는 자료는 분석 전에 직접 지정하세요. 실제 외국어 문장은 제거하지 않으며 환각이 전혀 없다는 보장은 아닙니다. 여러 언어가 섞인 자료는 원음과 검수해야 하며 클라우드 음성 인식의 언어 정책은 그대로입니다.

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

### 0.3.1: Waiting and execution order / 대기 원인과 실행 순서

Analysis runs one job at a time. A waiting job can remain at 0% until the current job releases the worker. The analysis/status window shows **queue position / waiting count**, the current job's project/media name, stage and progress, or that the worker is unavailable. Queue position 1 means next after the current job; it is not an estimated completion time.

분석은 한 번에 하나씩 실행합니다. 앞선 작업이 실행기를 반환하기 전까지 대기 작업은 0%일 수 있습니다. 분석·상태 창에서 **대기 순서 / 대기 수**, 현재 실행 중인 프로젝트·파일·단계·진행률 또는 실행기 미준비 상태를 확인합니다. 대기 1번은 앞 작업 다음이라는 뜻이며 완료 예정 시간은 아닙니다.

| Action / 조작 | Behavior / 동작 |
| --- | --- |
| **Run this job next / 이 작업을 다음으로** | Moves the selected waiting job to the front without stopping the current job. Other waiting jobs retain their order. / 선택한 대기 작업만 맨 앞으로 옮깁니다. 현재 작업은 계속되고 다른 대기 작업의 순서는 유지합니다. |
| **Stop current job, then prioritize this job / 현재 작업 중단 후 우선 실행** | Shows the specific current job for confirmation. If that job changes before confirmation, refresh and choose again; a different job is not silently cancelled. / 중단할 현재 작업을 확인한 뒤 요청합니다. 확인 사이 대상이 바뀌면 최신 상태에서 다시 선택하며 다른 작업을 임의로 취소하지 않습니다. |

Stopping is cooperative: native GPU inference **cannot be force-killed instantly** by this action. The UI shows stopping while the current calculation returns and acknowledges cancellation; the next job waits for that release. A stopped job's unfinished draft is not a completed result. If the analyzer has already returned a complete result, that result can still be retained as completed despite a late stop request. Source files, existing applied captions and completed history are preserved. Restarting the server does not automatically resume waiting/interrupted analysis.

중단은 실행 중 계산이 취소 요청을 확인하는 방식입니다. 이 버튼으로 네이티브 GPU 추론을 **즉시 강제 종료하지 않습니다**. 현재 계산이 반환해 취소를 확인할 때까지 중단 처리 중으로 표시하고 다음 작업도 기다립니다. 중단된 미완료 초안은 최종 결과가 아닙니다. 다만 분석기가 이미 완성된 결과를 반환했다면 늦은 중단 요청에도 완료 결과로 남을 수 있습니다. 원본·기존 적용 자막·완료 이력은 보존하며 서버 재시작으로 대기·중단 분석을 자동 재개하지 않습니다.

### 0.3.2: Force-stop an isolated analysis / 격리된 분석 강제 종료

When the running analysis supports isolation, **Force-stop analysis** terminates its dedicated process tree after confirmation. For a waiting job, **Force-stop current job, then prioritize this job** shows the current job's name and makes the selected job next. A changed current job invalidates the confirmation; it never silently targets the replacement. Ordinary **Stop** remains cooperative.

격리 실행 중인 분석에 **분석 강제 종료**가 표시되면 확인 후 그 분석 전용 프로세스 트리를 종료합니다. 대기 작업의 **현재 작업 강제 종료 후 우선 실행**은 현재 작업 이름을 확인하고 선택한 작업을 다음으로 옮깁니다. 확인 사이 현재 작업이 바뀌면 거부하며 새 작업을 임의로 종료하지 않습니다. 기존 **중단**은 계산 반환을 기다리는 방식입니다.

The UI stays in stopping state until owned-process exit is confirmed; only then can the next analysis begin. The app/backend and unrelated processes remain running. Unfinished recognition is not a final result; originals, applied captions and other completed results remain. If cleanup cannot be confirmed, the queue pauses with an error. This is not a guaranteed immediate GPU deadline. Windows process-tree cleanup has synthetic runtime coverage; equivalent POSIX behavior and real driver hangs are not established. Each isolated job may reload its models, adding preparation time. Force-stopping cannot recall audio already sent to a cloud provider or reverse charges.

소유 프로세스 종료를 확인할 때까지 중단 처리 중으로 표시하고, 확인된 뒤에만 다음 분석을 시작합니다. 앱·백엔드·관계없는 프로세스는 유지합니다. 미완료 인식은 최종 결과가 아니지만 원본·기존 적용 자막·다른 완료 결과는 남습니다. 정리 완료를 확인하지 못하면 오류와 함께 대기열을 멈춥니다. GPU 즉시 종료 시간을 보장하지 않습니다. Windows 프로세스 트리는 합성 실행으로 검증했으며 POSIX의 동등한 동작·실제 드라이버 멈춤은 미검증입니다. 작업별 격리로 모델을 다시 불러와 준비 시간이 재발생할 수 있습니다. 이미 클라우드로 전송한 음성·발생한 과금은 되돌리지 못합니다.

## 4. 자막·인물·타임라인 편집

*Edit captions, speakers and the timeline*

**0.3.2 review consistency:** text/speaker changes mark a caption **Manual edit** and clear reviewed status; start/end changes mark timing review. No-op and style-only changes preserve review. Recheck edited cues before marking them complete. Transcript timestamp links carry the exact caption ID, so two people starting at the same time select the intended cue.

**0.3.2 검수 상태:** 내용·화자 변경은 **수동 수정**, 시작·끝 시각 변경은 시간 검수 사유를 남기고 검수 완료를 해제합니다. 실제 변경 없음·스타일만 변경은 검수 상태를 유지합니다. 수정한 대사를 다시 확인한 뒤 완료하세요. 발언록 시간 링크는 자막 ID도 전달하므로 두 사람이 같은 시각에 시작해도 선택한 자막으로 이동합니다.

**Speech review since 0.3.3 / 0.3.3부터 적용된 음성 검수:** Local Whisper file analysis retains uncertain text as **Check speech** when recognition confidence, detected speech activity and audio level jointly require review. These captions appear under **Needs review**; listen to the original, then edit or mark reviewed. Quiet real speech can also be flagged. This is not proof of a hallucination and does not block every hallucination. Reports and transcripts show the pending warning separately from the unchanged utterance; subtitle text itself is not rewritten by the warning. Existing saved results are not reclassified automatically. Projects with `speech_uncertain` require a compatible version; keep a separate pre-upgrade backup for older readers.

로컬 Whisper 파일 분석에서 인식 신뢰도·음성 활동·음량을 함께 보아 확신할 수 없는 결과는 삭제하지 않고 **음성 확인 필요**로 남깁니다. **검수 필요**에서 원음을 듣고 수정하거나 검수 완료로 표시하세요. 실제 작은 목소리도 표시될 수 있으며, 환각 확정이나 모든 환각 차단을 뜻하지 않습니다. 보고서·발언록은 미확인 표시를 대사와 구분하며 자막 원문을 바꾸지 않습니다. 기존 저장 결과를 자동 재분류하지 않습니다. `speech_uncertain`이 든 프로젝트는 지원 버전이 필요하므로 이전 버전용 백업은 따로 보관하세요.

New projects containing the `edited` review reason require a reader that understands it; 0.3.1 can reject them. Keep a separate pre-upgrade JSON if you need to return to 0.3.1. Old projects remain readable in 0.3.2. / 새 `edited` 검수 사유가 든 프로젝트는 이를 이해하는 버전이 필요하며 0.3.1에서는 열리지 않을 수 있습니다. 이전 버전으로 돌아갈 필요가 있으면 업그레이드 전 JSON을 따로 보관하세요. 기존 프로젝트는 0.3.2에서 읽을 수 있습니다.

Click a timeline caption to seek and reveal its row. Edit text, timing, speaker, name/color/style and review status; add time-linked notes. Collapse/resize the timeline or use compact/focus mode. **0.3.1 replaces 100-row pages with continuous scrolling** in captions and the original transcript. Only the nearby portion is drawn for long lists; the rest is available by scrolling and all content remains in the project/export. Bulk speaker/review/delete and literal find/replace remain available. **Select all filtered results** includes matches outside the visible area. Load a summarized waveform and drag caption boundaries.

In **0.3.1**, wide layouts keep the caption editor beside the preview. Automatic preview sizing fits the media into available width and height while preserving aspect ratio; narrow layouts reserve room for captions. Letterboxing can remain when the source shape differs. The height slider and picture collapse remain available, as do playback and fullscreen. Notes sit below the editor, start collapsed and take little room when empty; adding or selecting a timeline note opens its editor. Windows up to 1000 px wide start in subtitle focus view with a separate preference from wider windows. Show all panels to access collapsible project settings; the timeline folds temporarily in narrow/focus views. These changes preserve project content.

타임라인 옆 인물 이름을 바로 수정할 수 있습니다. Enter나 바깥 클릭으로 저장하고 Escape로 취소합니다. 실행 취소도 지원합니다.

타임라인의 자막을 클릭하면 해당 시간과 자막으로 이동합니다. 인물 이름·색상·기본 자막 스타일을 정하고 필요한 자막은 개별 스타일로 바꿀 수 있습니다. 시작·끝 시간, 내용, 인물을 수정하고 검수 완료로 표시합니다. 메모도 시간과 연결해 타임라인에서 확인합니다.

타임라인 접기·높이 조절, 촘촘한 목록과 자막 집중 보기로 편집 공간을 확보합니다. **0.3.1은 자막·발언록의 100행 페이지를 없애고 연속 스크롤로 표시합니다.** 긴 목록은 주변 행만 화면에 그리지만 나머지 내용도 계속 스크롤해 볼 수 있고 프로젝트·내보내기에는 전체가 남습니다. 일괄 인물 지정·검수·삭제와 문자열 찾기/바꾸기도 유지합니다. **필터 결과 모두 선택**은 지금 화면 밖의 일치 항목까지 포함하므로 개수를 확인하세요. `파형 불러오기`로 요약 파형을 표시하고 자막 경계 손잡이를 조절할 수 있습니다. [이전 편집 워크플로](EDITING-WORKFLOWS.md)의 100행 페이지 설명은 이전 동작입니다.

**0.3.1**은 넓은 화면에서 미리보기 옆 자막 편집기를 유지합니다. 미리보기 자동 크기는 사용 가능한 폭·높이에 원본 비율을 유지해 맞추고, 좁은 화면에서는 자막 공간을 확보합니다. 원본 비율 때문에 여백이 남을 수 있습니다. 높이 수동 조절·영상 접기·재생·전체 화면은 계속 사용할 수 있습니다. 메모는 편집기 아래에 두고 기본 접힘·빈 상태를 작게 표시하며, 추가하거나 타임라인에서 선택하면 편집기가 열립니다. 너비 1000px 이하에서는 자막 집중 보기로 시작하고 좁은 창·넓은 창의 선호를 따로 기억합니다. `전체 패널 보기`에서 프로젝트 설정을 열 수 있고 좁은 창·집중 보기의 타임라인 접힘은 임시입니다. 프로젝트 내용은 그대로 보존합니다.

**0.3.1 speaker choices:** row assignment, filters and bulk assignment retain the requested preparation identities plus every speaker already assigned to a caption. Unused preparation entries beyond the expected count are hidden, without deleting their saved names/styles or merging existing speakers. The names shown in the sidebar and transcript are based on actual use.

**0.3.1 인물 선택:** 행별 배정·필터·일괄 배정은 예상 인원에 해당하는 준비 인물과 이미 자막에 배정된 모든 인물을 남깁니다. 예상 인원 밖의 미사용 준비 인물은 숨기되 저장된 이름·스타일을 지우거나 기존 인물을 합치지 않습니다. 사이드바·발언록의 인물 표시는 실제 사용을 기준으로 합니다.

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

### 0.3.2: YouTube styled CC / YouTube 스타일 자막

Open **Export subtitles and notes → YouTube styled CC**, choose original or cut-edited video time, then **Save YouTube CC (.ytt)**. The source exporter includes speaker-name color and subtitle size/color/position/background. Edited-time output stops when a cut crosses a cue without reliable word timing. It does not upload automatically. YouTube upload/player rendering is unverified; karaoke/animation is outside this first scope. See the [YTT guide and format limits](YOUTUBE-CAPTIONS.md).

**자막과 노트 내보내기 → 유튜브 스타일 CC**에서 원본 또는 컷 적용 시간을 고르고 **YouTube CC (.ytt) 저장**을 누릅니다. 소스 출력기는 인물 이름 색·자막 크기/색/위치/배경을 담습니다. 컷 경계를 가로지르는 자막에 신뢰할 단어 시간이 없으면 편집본 출력을 막습니다. 자동 업로드하지 않으며 YouTube 업로드·플레이어 표시는 미검증입니다. 노래방·애니메이션은 첫 범위에서 제외합니다. [YTT 안내와 형식 한계](YOUTUBE-CAPTIONS.md)를 확인하세요.

## 6. 화면 언어와 음성 언어

*Interface and speech languages*

The UI supports Korean, English, Japanese, Simplified Chinese and Spanish. Speech recognition independently supports AUTO or an explicit input language. Changing the interface language does not translate captions. Subtitle translation and automatic AI summaries have been removed; all subtitle previews and exports use the original edited transcript. Existing project translation data is preserved for compatibility.

**0.3.1:** the header provides **Light/Dark** selection, saved on this device. Native lists and inputs follow the chosen theme. Project settings label the interface-language selector with **Language** so it remains identifiable after a language change. This changes interface text only; select the speech language separately in analysis. The saved theme is a device preference, not project content.

**0.3.1:** 상단에서 **라이트/다크**를 직접 고르면 이 기기에 기억합니다. 기본 선택 목록·입력칸도 테마를 따릅니다. 프로젝트 설정의 화면 언어 선택에는 **Language**를 함께 표시해 언어를 바꾼 뒤에도 찾을 수 있습니다. 메뉴 언어만 바뀌며 분석할 음성 언어는 분석 창에서 따로 선택합니다. 테마는 프로젝트 내용과 별개의 기기 설정입니다.

화면 언어는 한국어·영어·일본어·중국어 간체·스페인어입니다. 음성 인식은 별도로 AUTO 또는 직접 지정합니다. 화면 언어를 바꿔도 자막을 번역하지 않습니다. 자막 번역과 AI 자동 요약은 제거했으며 자막 미리보기·내보내기는 편집한 원문을 사용합니다. 이전 프로젝트에 들어 있는 번역 데이터는 호환을 위해 보존합니다.

## 7. 인터뷰와 회의록

*Interviews and meeting minutes*

The default **Transcript** tab produces a chronological document like `Minjun: Let's start.` directly from the current captions. It does not need Ollama or a paid API. Save an editable Word `.docx`, UTF-8 `.txt`, Excel `.xlsx`, or HTML. The desktop source saves PDF directly; the browser offers PDF print preview. Timestamps are optional. Speaker names and original utterances come from your edited project; review recognition errors in the caption editor before exporting. Q&A tagging and manually written meeting notes are separate views. There is no automatic AI summary.

**0.3.3 재생·찾기:** 발언의 재생 버튼은 문서를 열어 둔 채 원음을 재생합니다. 위쪽 재생·일시정지 버튼과 시간 표시를 이용하세요. 내용·인물 검색으로 발언을 좁히고, 시간 찾기에 초·분:초·시:분:초를 입력하면 해당 발언 또는 다음 발언으로 이동합니다. 시간 찾기는 재생하지 않으며 현재 검색 결과 안에서 찾습니다. 검색 중 내보내기도 전체 발언록을 포함합니다.

**0.3.3 playback and lookup:** play a turn without closing the document, then use its play/pause control and clock. Search by text or speaker, or enter seconds, mm:ss or hh:mm:ss to reveal the matching/next turn within the current results without playing. Export always includes the complete transcript.

기본 **발언록** 탭은 `청둥찌덕: 오늘 이야기할 내용은…`처럼 현재 자막을 인물별 발언 순서로 정리합니다. Ollama나 유료 API 없이 바로 만들며, Word `.docx`·UTF-8 `.txt`·Excel `.xlsx`·HTML 저장을 지원합니다. 설치형 소스는 PDF 직접 저장, 브라우저는 PDF용 인쇄 미리보기를 제공합니다. 시간 표시는 선택입니다. 프로젝트의 인물 이름과 원문을 사용하므로 인식 오류는 자막 편집기에서 고친 뒤 출력하세요. 문답 분류와 수동 회의록은 별도 화면이며 AI 자동 요약은 제공하지 않습니다.

**0.3.1 transcript colors and scrolling:** scroll the full transcript without page buttons. Speaker markers keep the selected color, while name text is adjusted for contrast on the current background; utterance text stays readable in the normal text color. DOCX, HTML/PDF and XLSX transcript exports carry colored speaker names/markers on a light document background. TXT and SRT cannot store these styles. App dark mode does not make exported documents dark, and a PDF printer's monochrome setting can discard color. Exports include all transcript turns, not only the visible portion.

**0.3.1 발언록 색·스크롤:** 페이지 버튼 없이 전체를 계속 스크롤합니다. 인물 표식은 지정한 색을 유지하고 이름 글자는 배경에서 읽기 좋게 대비를 조정하며, 발언 본문은 일반 글자색을 사용합니다. 발언록 DOCX·HTML/PDF·XLSX에도 밝은 문서 배경 기준의 인물 이름색·표식을 반영합니다. TXT·SRT는 스타일을 저장할 수 없습니다. 앱 다크 모드가 출력 문서를 어둡게 만들지는 않으며 PDF 인쇄의 흑백 설정은 색을 제거할 수 있습니다. 화면에 보이는 일부가 아니라 전체 발언을 내보냅니다.

Assign interviewer/respondent/participant roles and question/answer/other caption tags. Timestamps return to the source. Write summaries/discussions/decisions/actions manually with evidence captions. Review owners, dates, proposals versus decisions, jokes and reversals; saved draft items are never automatically confirmed. Changed evidence text, timing or speaker requires review. Store documents in project JSON and export Markdown.

`인터뷰·회의록`에서 인물의 질문자·답변자·참여자 역할과 자막별 질문·답변·기타를 수정합니다. 시간 표시를 누르면 원문으로 돌아갑니다.

회의록에는 요약·논의·결정·할 일을 수동으로 작성하고 근거 자막을 연결할 수 있습니다. 자동 생성 없이 직접 작성하며 기존 문서 초안도 그대로 보존합니다. 담당자·기한, 제안과 결정, 농담과 번복을 원문과 비교하세요. 근거 자막의 내용·시간·인물이 바뀌면 재확인이 필요합니다. 문서는 프로젝트 JSON에 저장하고 Markdown으로 내보낼 수 있습니다. 자세한 한계는 [근거 문서 안내](EDITING-WORKFLOWS.md#인터뷰와-근거가-있는-회의록)에 있습니다.

For external AI assistance, export a speaker transcript and provide it to the LLM of your choice. This app does not send transcript text to an AI summarizer.

외부 AI 도움이 필요하면 인물별 발언록을 출력해 원하는 LLM에 직접 넣으세요. 앱이 전사 텍스트를 AI 요약기에 보내지는 않습니다.

| Output / 출력 | Contents / 내용 |
| --- | --- |
| HTML report / HTML 보고서 | Standalone offline report with names, source times, Q/A or minutes and evidence / 이름·원본 시간·문답 또는 회의 항목·근거를 담은 독립 보고서 |
| PDF / PDF | Desktop: choose a destination in the native save dialog to generate a PDF. Browser: open report preview and choose Save as PDF through printing / 설치형은 저장 창에서 위치를 고르면 PDF 생성, 브라우저는 보고서 미리보기의 인쇄/PDF 저장 |
| Excel `.xlsx` / Excel 통합문서 | Interview: report + transcript; minutes: report + transcript + actions + evidence / 인터뷰는 보고서·전체 대사, 회의록은 보고서·전체 대사·할 일·근거 시트 |
| Markdown / Markdown 문서 | Editable plain-text document / 수정 가능한 텍스트 문서 |

Reports show pending review and stale evidence. Export timestamps are not the meeting date. Original media times are retained; cuts do not rewrite report evidence times. Save project JSON as well to continue editing. Desktop PDF requires an explicit save destination; browser printing requires choosing PDF and saving in the print dialog. An embedded browser without printing can still download HTML/XLSX.

보고서에는 검수 대기·변경된 근거 상태를 표시합니다. 내보낸 시각을 회의 일시로 표시하지 않으며, 원본 미디어 시간은 컷편집 뒤에도 유지합니다. 편집을 계속하려면 프로젝트 JSON도 보관하세요. 설치형 PDF는 저장 위치를 직접 선택하고 브라우저에서는 인쇄 창의 PDF 저장을 선택합니다. 인쇄를 지원하지 않는 내장 브라우저에서도 HTML·XLSX는 내려받을 수 있습니다.

## 8. 라이브 자막·마이크·시스템 소리 녹음

*Live captions and recording*

Open **Live captions and recording** and choose **Record, then analyze** or **Live captions + recording**. Both modes capture microphone, system audio, or both in the browser/Electron. Use **Microphone permission / refresh devices** to reveal device names; this temporary permission check releases the microphone without creating a recording. A fixed missing input is never silently replaced by the OS default. System sharing depends on the browser/OS and can include calls, games and notifications; only audio is stored. Individual WASAPI playback endpoints and ASIO channel routing are not supported.

상단 **실시간 자막·녹음**에서 **녹음 후 분석** 또는 **라이브 자막 + 녹음**을 고릅니다. 브라우저·Electron 모두 마이크·시스템 소리·둘 다를 선택합니다. **마이크 권한 확인·장치 새로고침**은 이름을 확인한 뒤 임시 마이크 접근을 해제하며 파일 녹음을 시작하지 않습니다. 고정 입력이 사라지면 직접 다시 선택해야 합니다. 시스템 공유는 브라우저·OS에 따라 달라지고 통화·게임·알림까지 담길 수 있으며 영상은 저장하지 않습니다. 개별 WASAPI 출력 장치·ASIO 채널 라우팅은 지원하지 않습니다.

**0.3.2 input preferences:** microphone/system/both and the chosen microphone are remembered in this app/browser profile. Reopening does not start recording or preapprove permissions. A fixed input that is absent or not yet visible after permissions must be checked or selected again; it is never silently replaced by the default. Storage and device IDs can differ between profiles.

**0.3.2 입력 기억:** 마이크·시스템·둘 다와 선택 마이크를 현재 앱·브라우저 프로필에 기억합니다. 창 재열기는 녹음·권한 승인을 자동 실행하지 않습니다. 저장한 고정 입력이 없거나 권한 전이라 확인되지 않으면 확인·재선택해야 하며 기본 장치로 임의 대체하지 않습니다. 프로필마다 저장 공간·장치 식별자는 다를 수 있습니다.

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

## 9. RNNoise·VST3 사전처리

*RNNoise and VST3 preprocessing*

Use up to four separately installed/activated Windows x64 VST3 effects. CLEAR/RX licenses and plugins are not included. Add effects, adjust order/bypass/parameters and compare a short original/processed preview. Default processing applies to ASR only; applying it to Nemotron is optional. Reported latency is compensated per run. **0.3.2 also compares real input/output windows for residual delay**, adding compensation only when strong, unambiguous matches agree. Uncertain, negative or time-varying delay adds no guessed shift. This checks the current material, not every setting or a plugin's universal latency. Over-denoising can remove speech. Source files and final rendered audio are unchanged. Native plugin GUIs are absent in 0.3.2; 0.3.3 and later add open/close/apply and saved state up to 256 KiB per slot. Universal GUI scaling remains unsupported; use vendor zoom menus when available. Vendor preset-file import and real-time VST processing remain unsupported. See [VST details](VST-CHAIN.md).

설치·활성화한 Windows x64 VST3 효과를 최대 4개 연결할 수 있습니다. CLEAR·RX 플러그인과 라이선스는 앱에 포함되지 않습니다. `음성 분석`의 VST 영역에서 추가하고 순서·우회·매개변수를 조절한 뒤 짧은 원본/처리음 비교를 먼저 만드세요.

기본은 음성 인식에만 적용하며 Nemotron에도 적용할지 선택할 수 있습니다. 보고 지연을 처리마다 보정합니다. **0.3.2는 실제 입출력의 여러 구간을 비교해 남은 지연도 측정**하며, 충분히 높은 상관과 모호하지 않은 일치 결과가 모일 때만 추가 보정합니다. 불확실·음수·가변 지연은 추측해 이동하지 않습니다. 이번 처리 음원의 증거이지 플러그인의 모든 설정에 적용되는 지연 보증은 아니며, 잡음 제거로 사라진 말소리를 복원하지도 않습니다. 원본과 최종 렌더 오디오는 이 전처리로 바뀌지 않습니다. 0.3.2에는 전용 창이 없지만 0.3.3부터 창 열기·닫고 적용·슬롯당 256KiB 내부 상태 저장을 추가했습니다. 범용 GUI 배율은 없으며 제공되는 제조사 메뉴를 사용합니다. 제조사 프리셋 파일 가져오기·실시간 VST 처리는 여전히 범위 밖입니다. [VST 사용법](VST-CHAIN.md)을 참고하세요.

**RNNoise (0.3.3 and later):** enable the built-in CPU filter independently of VST, starting at 70% processed mix. The pinned 303 KB Xiph model is included; runtime downloading is unnecessary. RNNoise precedes VST, compensates its fixed 10 ms delay, and preserves the original sample count. ASR-only is the default; ASR + diarization is optional. Compare a short A/B preview because quieter speech may be lost. This does not modify final rendered media or live audio and does not guarantee improved transcription.

**RNNoise (0.3.3부터):** VST 없이 내장 CPU 필터를 켤 수 있고 처리음 비율 70%로 시작합니다. 고정 303KB Xiph 모델을 포함하므로 실행 중 다운로드는 없습니다. RNNoise→VST 순서로 고정 10ms 지연을 보정하고 원본 샘플 수를 유지합니다. 기본은 음성 인식만이며 화자 구분에도 적용할 수 있습니다. 작은 목소리가 손상될 수 있으므로 짧은 A/B로 비교하세요. 최종 렌더·라이브 음원은 바꾸지 않으며 인식률 향상을 보장하지 않습니다.

## 10. 저장 복구·오류·디스크 관리

*Recovery, errors and storage*

Autosave Recovery lists current/previous/damaged JSON; download before restoring or removing damaged data. One previous snapshot is not a full history or external backup. Job History reopens analysis/render results; closing a dialog need not stop a running server job, but restarting the server does not resume interrupted computation. Results from another project/source are not silently applied. Delete unneeded terminal job history before removing unreferenced cached copies; original files, models and recorded sessions are separate. Settings/Error Logs exports diagnostics, including client-only logs if the server is unavailable. Settings JSON is distinct from project JSON. Logs are not automatically sent elsewhere; inspect before sharing.

### 0.3.1: Keep working during analysis / 분석 창을 닫고 편집 계속하기

Use **Close window and keep working** to close the analysis dialog while its server job continues. The footer keeps the tracked analysis state, stage and progress; click it to reopen the latest status, recognized draft lines or completed result. Reloading the page restores the saved job reference and queries the server. Without a saved reference, the app can discover an active analysis from job history; use **Job History** for the other jobs. Closing the dialog is different from exiting the desktop app or stopping the backend, which can interrupt computation.

**창 닫고 계속 작업**으로 분석 창만 닫으면 서버의 작업은 계속됩니다. 하단에 추적 중인 분석 상태·단계·진행률이 남고, 클릭하면 최신 상태·인식 초안·완료 결과를 다시 엽니다. 페이지를 새로고침하면 저장한 작업 참조로 서버에 상태를 묻고, 참조가 없으면 이력에서 진행 중 분석을 찾을 수 있습니다. 다른 작업들은 **작업 이력**에서 확인합니다. 분석 창 닫기와 설치형 앱 종료·백엔드 종료는 다르며 후자는 계산을 중단할 수 있습니다.

Completion **never applies results automatically**. In a reopened result, reconnect its project and original media, choose **Verify linked source**, then explicitly **Apply result**. Application replaces captions and keeps notes. You can save result JSON and inspect progress without the original file. Dismissing a completed footer indicator only hides that indicator; it does not delete history. If polling repeatedly fails or the job is missing, automatic checks stop and the UI offers a manual retry/history path; it does not claim the server job stopped.

완료돼도 **결과를 자동 적용하지 않습니다**. 다시 연 결과에서는 해당 프로젝트·원본을 연결하고 **연결된 원본 확인 → 결과 적용**을 직접 선택합니다. 적용은 자막을 교체하며 메모는 유지합니다. 원본 파일 없이도 진행 상태를 확인하거나 결과 JSON을 저장할 수 있습니다. 완료된 하단 표시를 닫아도 이력을 삭제하지 않습니다. 반복 연결 실패·작업 없음일 때 자동 조회를 멈추고 재확인·이력 경로를 제공하며, 서버 작업까지 취소됐다고 표시하지 않습니다.

**0.3.2 history refresh:** while job history is open, running entries and the selected analysis update as work progresses and completes. The queue controls can act on that selected job; closing/reopening is unnecessary to discover completion. Connection errors do not auto-cancel a server job, and results still require explicit application.

**0.3.2 작업 이력 갱신:** 이력 창을 열어두면 실행 중 항목과 선택한 분석의 진행·완료를 갱신합니다. 선택한 작업의 대기열 조작을 사용할 수 있고 완료를 확인하려고 창을 닫았다 다시 열 필요가 없습니다. 조회 연결 오류가 서버 작업을 자동 취소하지 않으며 완료 결과도 직접 적용합니다.

### 0.3.1: Review and clean unused media copies / 미사용 미디어 사본 확인 후 정리

Open **Job History and Storage → Media cache → Clean unused cache**. Review the displayed number and size, then **Confirm cleanup**. Only that reviewed set of app-owned copies is submitted, up to 1,000 at a time; uploads arriving afterwards are not added. Immediately before deletion the server checks reservations again, so a copy newly used by analysis, rendering, mixing, preview or waveform generation is skipped. The result separates removed copies, protected/missing copies and failures. Refresh and review another batch if needed.

**작업 이력 및 저장 공간 → 미디어 캐시 → 정리 가능한 캐시 정리**에서 표시한 개수·크기를 확인한 뒤 **정리 확인**을 누릅니다. 확인한 앱 사본만 한 번에 최대 1,000개 요청하며 이후 업로드한 파일을 추가하지 않습니다. 삭제 직전에 사용 여부를 다시 검사하므로 분석·렌더·믹스·미리듣기·파형 생성에서 새로 사용하는 사본은 건너뜁니다. 결과는 삭제·보호/이미 없음·실패로 구분합니다. 필요하면 새로고침 후 다음 묶음을 다시 확인하세요.

There is **no automatic age/quota deletion**. Retained job history continues to protect its input copies even after completion. Remove only unneeded terminal history when you also intend to discard that job's stored results, then review newly unused media separately. Bulk cache cleanup does not delete original files outside the cache, models, recordings, project JSON or job-result folders.

**기간·용량에 따른 자동 삭제는 없습니다.** 완료 뒤에도 보관 중인 작업 이력은 입력 사본을 보호합니다. 해당 작업의 저장 결과도 더 이상 필요 없을 때만 종료된 이력을 삭제하고, 새로 정리 가능해진 미디어를 별도로 확인하세요. 일괄 캐시 정리는 캐시 밖 사용자 원본·모델·녹음·프로젝트 JSON·작업 결과 폴더를 삭제하지 않습니다.

| 상황 | 조치 |
| --- | --- |
| 자동 저장이 손상됐거나 이전 정상본이 필요함 | `자동 저장 복구`에서 현재·이전·오류 원본을 확인하고 JSON을 내려받은 뒤 복구합니다. 이전본 하나는 전체 편집 이력이나 외부 백업을 대신하지 않습니다. |
| 분석·렌더 창을 닫았음 | `작업 이력·저장 공간`에서 다시 엽니다. 0.3.1은 하단 분석 상태로도 다시 엽니다. 서버가 살아 있어야 작업이 계속됩니다. |
| 서버 연결이 끊김 | 재연결하거나 화면에서 나갈 수 있습니다. 서버 재시작은 진행 중 계산을 자동 재개하지 않습니다. |
| 이전 분석을 현재 프로젝트에 적용할 수 없음 | 해당 프로젝트와 확인된 같은 원본인지 확인합니다. 다른 프로젝트의 결과는 자동으로 덮어쓰지 않습니다. |
| 디스크 공간 부족 | 0.3.1의 `정리 가능한 캐시 정리`에서 개수·크기를 확인합니다. 보호된 사본이 더 이상 필요 없다면 결과를 먼저 저장하고 종료 이력을 삭제한 뒤 다시 검토합니다. 녹음 보관함과 모델 캐시는 별도입니다. |
| 모델·CUDA·VST 오류 | 화면의 준비 상태·오류를 확인하고 `설정 및 오류 로그`에서 로그를 저장합니다. 설치형 시작 오류는 앱 데이터의 `logs/backend.log`에도 기록합니다. |

설정 JSON과 프로젝트 JSON은 용도가 다릅니다. 설정 백업에는 화면 언어·분석 선호·VST 체인이, 프로젝트에는 편집 내용이 들어갑니다. 로그는 자동 외부 전송하지 않습니다. 문제를 공유할 때는 내보낸 로그에 민감한 경로·내용이 남아 있는지 확인하고 필요한 부분만 전달하세요. [설정과 오류 로그](SETTINGS-AND-LOGS.md)에 위치·보관 범위가 있습니다.

## 11. 앱 업데이트

*App updates*

The desktop updater uses the project's public GitHub releases. Open **App update**, explicitly **check**, then **download** a newer offered version. Save project JSON and finish live/analysis/render jobs before choosing **save and restart/install**. It does not automatically download or install on ordinary quit. Browser development mode has no installer update. Older builds with an unconfigured updater need a manually installed published version first. Check the [0.3.4 release record](releases/v0.3.4.md) for its publication status and actual upgrade evidence; a draft release is not an available update.

설치형의 **앱 업데이트**는 프로젝트의 GitHub 공개 릴리즈를 사용합니다. **확인 → 다운로드 → 저장 후 다시 시작/설치**를 각각 누릅니다. 설치 전 프로젝트 JSON을 저장하고 라이브·분석·렌더를 끝내세요. 자동 다운로드·일반 종료 시 자동 설치는 하지 않습니다. 브라우저 개발 화면에는 설치 업데이트가 없으며, 업데이트 미설정인 이전 설치본은 게시된 버전을 먼저 수동 설치해야 합니다. 0.3.4의 게시 상태·실제 업그레이드 증거는 [릴리즈 기록](releases/v0.3.4.md)을 확인하세요. 초안 릴리즈는 받을 수 있는 업데이트가 아닙니다.

The updater authenticates `installer-manifest.json` with its bundled **Ed25519 public key**, then checks each file and the assembled payload with SHA256, including another check before launching the installer. The private key is outside the repository. This authenticates the release manifest; **Windows EXEs remain Authenticode-unsigned**. Downloads run serially at **80 Mbps** and reuse complete verified files; an interrupted file restarts on retry. This differs from the online setup's partial Range resume. Neither feature reserves OS bandwidth or limits all model downloads. User data/model caches remain outside the install folder; keep a separate project backup.

업데이트는 포함된 **Ed25519 공개키**로 `installer-manifest.json` 서명을 확인하고 파일·재조립 payload의 SHA256을 검증하며 설치 직전에도 다시 확인합니다. 개인키는 저장소 밖에 있습니다. 이는 배포 명세 인증이며 **Windows EXE의 Authenticode 서명은 없습니다**. 파일은 순차적으로 **80Mbps**로 받고 검증된 완료 파일은 재사용합니다. 중단된 개별 파일은 재시도 때 처음부터 받으며 온라인 설치기의 Range 이어받기와 다릅니다. OS 대역폭 예약이나 전체 모델 다운로드 제한은 아닙니다. 사용자 데이터·모델 캐시는 설치 폴더 밖에 유지하고 프로젝트는 별도 백업하세요.
