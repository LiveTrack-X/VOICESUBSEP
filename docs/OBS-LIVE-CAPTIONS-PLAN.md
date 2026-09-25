# OBS live speaker captions: separate development plan / OBS 실시간 인물별 자막 개발 계획

Status: **planned, not implemented in v0.2.1**. Received from the user's separate planning conversation on 2026-09-25. This unit must not delay or be confused with the current API/report/installer work. Existing recording is analyzed after stopping; upload-based Groq/xAI jobs are not streaming transcription.

상태: **기획, v0.2.1 미구현**. 2026-09-25 사용자의 별도 기획 대화에서 전달받았습니다. 현재 API·보고서·설치 작업과 분리합니다. 기존 녹음 기능은 종료 후 분석하며, 파일을 올리는 Groq·xAI 작업도 실시간 전사가 아닙니다.

## Outcome and flow / 목표와 사용 흐름

During a broadcast, capture audio continuously, recognize text and speaker activity in VOICESUBSEP, and display names/colors on a transparent OBS browser source. After stopping, open the final captions with the same recording and source clock in the editor.

방송 중 연속 입력을 받아 VOICESUBSEP가 대사·화자를 분석하고, OBS 투명 브라우저 소스에 이름·색상이 있는 자막을 표시합니다. 종료 후 같은 녹음·원본 시간과 최종 자막을 편집기로 연결합니다.

1. Recording offers distinct **Record then analyze / Live captions** entries. Select microphone, communication loopback or isolated sources; verify meters and source names. / 녹음 안에서 **녹음 후 분석 / 라이브 자막**을 구분하고 입력·레벨을 확인합니다.
2. Assign names to isolated sources. For mixed audio, map detected speaker IDs to names/colors; calibration helps but does not promise reliable voice identification. / 분리 소스는 인물을 고정하고, 혼합 소스는 감지 ID에 이름·색상을 연결합니다.
3. Open OBS connection preview, send a labelled sample and copy the overlay URL. In OBS add a Browser source, paste that URL and set canvas dimensions such as 1920×1080. **These are the intended future steps, not a currently working connection.** / 오버레이 미리보기·샘플 확인 후 URL을 OBS 브라우저 소스에 연결합니다. **구현 후 예정 절차이며 현재 연결 기능이 아닙니다.**
4. Provide independent caption output mute/pause/clear controls, separate from recording. / 녹음과 별개로 자막 송출 음소거·일시중지·즉시 지우기를 제공합니다.
5. Stop and open a new editing project without overwriting existing work. / 종료 후 기존 편집 내용을 덮어쓰지 않고 새 프로젝트로 엽니다.

An OBS browser source displays captions; it does not feed OBS mixer audio into the app. Discord's mixed output is not a separate track for each friend. Prefer a fixed local microphone plus an isolated communication source, excluding game effects where possible.

OBS 브라우저 소스는 자막 표시용이며 OBS 믹서의 음성을 앱에 전달하지 않습니다. Discord 전체 출력도 친구별 분리 트랙이 아닙니다. 내 마이크 고정 + 통화 소스만 구분하는 구성을 우선하며 게임 효과음은 가능하면 제외합니다.

## Required device routing / 필수 장치 라우팅

Add multiple named sources, each with its capture type, actual enumerated device, channels and speaker role. Do not assume the Windows default output is the communication device, or change the user's default playback device. For example, the user's microphone may be Interface Input 1, Discord may use a separately exposed Chat/Playback 3–4 endpoint, and a game may use another endpoint. These are examples, not claims that a particular interface exposes those names or buses.

여러 소스를 추가하고 각각 캡처 방식·실제로 열거된 장치·채널·화자 역할을 지정합니다. Windows 기본 출력이 통화 장치라고 가정하거나 기본 재생 장치를 바꾸지 않습니다. 내 마이크는 오인페 Input 1, Discord는 별도 Chat/Playback 3–4 endpoint, 게임은 다른 출력일 수 있습니다. 예시 이름이며 특정 오인페가 해당 버스를 노출한다고 약속하지 않습니다. 사용자가 지정한 별칭과 실제 장치명을 함께 표시합니다.

| Capture type / 캡처 방식 | Meaning / 의미 |
| --- | --- |
| Input device / 입력 장치 | Exposed microphone, line or hardware-loopback capture endpoint / 노출된 마이크·라인·하드웨어 loopback 녹음 endpoint |
| Output device / 출력 장치 소리 | WASAPI loopback of the selected rendering endpoint; all apps on that endpoint may be mixed / 지정 재생 endpoint의 WASAPI loopback, 같은 출력의 여러 앱이 섞일 수 있음 |
| Specific application / 특정 앱 소리 | Separate supported-OS process-tree loopback capability; do not label device capture as Discord-only / 지원 OS의 별도 프로세스 트리 loopback, 장치 캡처를 Discord 전용으로 표시하지 않음 |

Investigate native installed-app capture for arbitrary output selection; browser `getDisplayMedia` alone does not establish it. Start with WDM/WASAPI shared-mode endpoints. Direct ASIO, exclusive mode and interface-internal mixer buses are separate compatibility work. Unexposed buses cannot be promised as selectable sources. Explain unsupported app capture and the device-capture alternative explicitly.

임의 출력 선택에는 설치형 native capture 경로를 검토합니다. `getDisplayMedia`만으로 해당 기능을 제공한다고 가정하지 않습니다. WDM/WASAPI 공유 모드 endpoint부터 구현하고 직접 ASIO·독점 모드·오인페 내부 믹서 버스는 별도 호환 범위로 둡니다. 노출되지 않은 버스는 선택 가능하다고 표시하지 않으며 앱 캡처 미지원과 장치 캡처 대안을 명확히 안내합니다.

- Show per-source level/signal/silence/disconnection and a short capture test. Monitoring playback defaults off to prevent feedback. / 소스별 레벨·신호·무음·연결 끊김·짧은 테스트를 제공하고 모니터링 재생은 기본으로 끕니다.
- Store device ID/name, channels and fixed-person/mixed-speaker role in routing presets. Distinguish following the default device from pinning a specific device. / 프리셋에 장치 ID·표시 이름·채널·고정/혼합 화자 역할을 저장하고 기본 장치 따라가기와 특정 장치 고정을 구분합니다.
- Detect identical-endpoint duplicate selection and explain microphone-plus-loopback double transcription. Different hardware buses may share audio; do not claim complete deduplication from names alone. / 동일 endpoint 중복 선택을 감지하고 마이크·loopback 중복 전사를 안내합니다. 이름만으로 버스 간 중복을 완벽하게 제거한다고 주장하지 않습니다.
- If a device disappears, warn/pause that source; never silently fall back to another device or all-system capture. Verify the endpoint on reconnection and preserve timestamps/gaps. / 장치가 사라지면 해당 소스를 경고·일시중지하며 다른 장치·전체 시스템으로 몰래 전환하지 않습니다. 재연결 시 실제 endpoint와 시간·누락 구간을 확인합니다.
- Validate sample-rate/channel conversion and cross-device clock drift. Namespace fixed microphone identity and mixed communication speaker IDs separately. Keep source capture switches distinct from caption-output mute. / 소스별 샘플레이트·채널 변환·장치 시계 드리프트를 검증하고 고정 마이크·혼합 통화 화자 ID를 구분합니다. 캡처 on/off와 자막 송출 음소거는 별개입니다.

Physical acceptance scenarios: (A) Input 1 microphone plus non-default Chat/Playback output, with game audio excluded; (B) Discord and music sharing one endpoint with an accurate mixed-audio notice; (C) disconnect/reconnect and default-output changes without silently changing pinned sources; (D) long sessions with different source sample rates, checking drift and duplication. Unit tests and virtual devices alone do not prove a particular audio interface works.

실물 인수 시나리오: (A) Input 1 마이크 + 기본 출력이 아닌 Chat/Playback 통화 출력에서 게임 제외, (B) 같은 출력의 Discord·음악 혼합을 정확히 안내, (C) 분리·재연결·기본 출력 변경 때 고정 소스 유지, (D) 서로 다른 샘플레이트의 장시간 드리프트·중복 확인. 단위 검사·가상 장치 성공만으로 특정 오인페 실물 호환을 입증하지 않습니다.

## Architecture / 구조

Audio capture → per-source sample clock/resampling → parallel streaming ASR and Nemotron → timestamp-based text/speaker association → revisioned caption events → read-only OBS overlay. Use a dedicated persistent session rather than repeatedly starting file jobs. LocalVocal is a reference or future optional integration, not an initial dependency or fork.

음성 캡처 → 소스별 샘플 시계·리샘플링 → 스트리밍 ASR/Nemotron 병렬 처리 → 시간 기반 대사·화자 연결 → 수정 번호가 있는 자막 이벤트 → 읽기 전용 OBS 오버레이 구조입니다. 파일 작업 반복 실행이 아닌 지속 세션을 설계하며 LocalVocal은 참고·후속 연결 후보로 둡니다.

- Choose AudioWorklet PCM or verified native capture. MediaRecorder WebM fragments are not assumed to be independently decodable files. Preserve source recordings separately. / PCM 입력 또는 검증된 native capture를 선택하고 WebM 조각을 독립 파일로 가정하지 않습니다. 원본 저장은 분리합니다.
- Keep inference outside OBS/UI/audio callbacks; preload models and use bounded queues, backpressure and visible overload state. Preserve recording when inference fails. / 추론은 OBS·UI·오디오 콜백 밖에서 실행하고 모델 준비·큐 제한·과부하 표시를 둡니다. 분석 실패에도 녹음을 보존합니다.
- Use `sessionId`, `sourceId`, epoch and sequence with sample-count timestamps. Define clock alignment and discontinuities on device changes. Reuse Nemotron speaker cache within one session, not blindly across restarts. / 샘플 수 기준 시계와 세션·소스·epoch·순서 번호로 연결·장치 교체를 관리합니다. 화자 캐시는 같은 세션 안에서 유지합니다.
- Separate ASR partial/final from tentative/confirmed speaker identity. Update by caption ID + revision; avoid duplicates and unstable name flipping. Low confidence remains unassigned. / 부분·최종 대사와 잠정·확정 화자를 분리하고 ID·수정 번호로 갱신합니다. 불확실하면 미배정으로 남깁니다.
- Diarization does not recover both sentences from overlapping mixed voices. Preserve actual recognized text only. Prioritize four-person tests without silently dropping detected participants above four. / 화자 구분을 겹친 음성 복원으로 약속하지 않습니다. 4인 검증을 우선하되 초과 인물을 조용히 버리지 않습니다.
- Keep source utterance times separate from broadcast display times. A stream delay alone does not align captions with audio/video; validate the actual AV buffering path. Real-time VST requires separate latency/support testing. / 발화 시간·화면 표시 시간을 따로 보존합니다. 방송 지연 설정만으로 자막 싱크가 맞는다고 가정하지 않으며 AV 버퍼·실시간 VST를 별도 검증합니다.

## Overlay contract / 오버레이 계약

Use loopback HTTP plus WebSocket or SSE. Events include session/sequence, caption ID/revision, source times, text, speaker name/color, partial/final state, expiry and clear/reset. Give the overlay a read-only capability with no project editing or credential privileges. Escape text; do not transmit keys or full projects.

loopback HTTP와 WebSocket 또는 SSE로 세션·순서·자막 ID·수정 번호·시간·대사·이름·색·확정 상태·만료·지우기 이벤트를 보냅니다. 오버레이에는 편집·키 관리 권한을 주지 않고 텍스트를 안전하게 표시합니다.

Maintain a stable saved OBS address across app restarts with explicit port-conflict handling and connection reissue. Keep any capability secret out of logs/shared project files. Confirm connection using a client handshake, not URL copying. Reconnect safely, ignore old epochs/duplicates, expire stale captions on disconnection, and do not reset recognition when OBS changes scenes.

앱 재시작 뒤에도 OBS 주소가 유지되도록 포트 충돌·연결 재발급을 설계하고 연결 비밀을 로그·공유 프로젝트에서 제외합니다. URL 복사가 아닌 실제 클라이언트 연결로 상태를 표시합니다. 재연결·중복·이전 epoch를 처리하고 끊기면 오래된 자막을 지우며 OBS 장면 전환이 인식 세션을 초기화하지 않게 합니다.

Verify PTT/mute behavior against the actual capture path. Audio muted in OBS might still reach another capture path: explicit caption-output mute must prevent private speech from appearing as captions.

실제 캡처 경로의 PTT·음소거를 검증합니다. OBS에서 음소거한 음성이 다른 캡처 경로로 들어올 수 있으므로 자막 송출 음소거가 사적인 발화를 확실히 막도록 합니다.

## Delivery units and acceptance / 개발 단위와 완료 기준

| Unit / 단위 | Required evidence / 확인할 증거 |
| --- | --- |
| A. Overlay only / 오버레이 | Labelled sample partial/final/clear/reconnect events in an actual OBS browser source / 실제 OBS에서 샘플 이름·색·투명 배경·갱신·지우기·재연결 |
| B. One fixed live speaker / 고정 화자 | Updates before recording stops; silence/cancel/device-end handling; source and final caption storage / 녹음 중 갱신·침묵·취소·장치 종료·원본/최종 자막 저장 |
| C. Streaming diarization / 스트리밍 화자 | Two/four-person sequential and overlap tests, short speech, returning speakers and more than four people / 2·4인 순차·겹침·짧은 발화·장시간 후 재등장·4인 초과 |
| D. Editing handoff / 편집 복귀 | Recording timeline, captions, identity/style and recorded gaps preserved; no existing project overwrite / 녹음 시간·자막·인물/색·누락 구간 보존, 기존 프로젝트 보호 |

Run 30–60 minute tests with actual OBS and broadcast/game load. Record RAM/VRAM, queue delay, OBS encoding/rendering lag and device failures. Measure end-to-end partial/final/speaker-confirmation latency p50/p95 separately. Aspirational targets (partial 1–2 s, final 2–4 s) are not established performance. Nemotron input-buffer durations exclude computation and are not caption latency measurements.

실제 OBS·방송/게임 부하로 30~60분 검증하고 RAM/VRAM·큐 지연·인코딩/렌더 지연·장치 장애를 기록합니다. 부분 자막·최종 자막·화자 확정의 전체 지연 p50/p95를 각각 측정합니다. 부분 1~2초·최종 2~4초는 미검증 목표이며 Nemotron 입력 버퍼 길이는 추론을 포함한 자막 지연이 아닙니다.

Cloud streaming and real-time translation are follow-up units with explicit transmission/cost consent and no paid automatic fallback. Report unit/fake-event success, browser success, actual OBS output and Korean/overlap quality as separate evidence.

클라우드 스트리밍·실시간 번역은 외부 전송·과금 확인을 갖춘 후속 단위로 두며 유료 자동 우회 실행을 하지 않습니다. 단위/모의 이벤트 통과·브라우저 표시·실제 OBS 송출·한국어/겹침 품질을 구분해 보고합니다.

References to recheck when implementation starts / 착수 시 다시 확인할 공식 자료:

- [LocalVocal](https://github.com/royshil/obs-localvocal)
- [Nemotron regular model](https://huggingface.co/nvidia/Nemotron-3-Diarization)
- [OBS browser source](https://obsproject.com/kb/browser-source)
- [Windows loopback recording](https://learn.microsoft.com/en-us/windows/win32/coreaudio/loopback-recording)
- [Windows application loopback sample](https://learn.microsoft.com/en-us/samples/microsoft/windows-classic-samples/applicationloopbackaudio-sample/)
