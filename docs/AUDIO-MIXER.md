# Audio mixer / 오디오 믹서

This guide targets 0.3.0; publication, packaging and installation status are in the [release record](releases/v0.3.0.md). / 0.3.0 대상 사용법이며 게시·패키지·설치 상태는 [릴리즈 기록](releases/v0.3.0.md)을 확인하세요.

The mixer combines up to 16 audio tracks from multiple files or an OBS recording. It runs locally through FFmpeg. It does not require an AI model, upload audio to a cloud provider, or modify the originals. The mixer is a separate export operation; it does not change ASR, speaker assignments, or caption text.

믹서는 여러 파일 또는 OBS 녹화의 오디오 트랙을 최대 16개까지 합칩니다. FFmpeg로 로컬에서 실행하며, AI 모델이나 클라우드 전송 없이 원본을 보존합니다. 별도 파일을 만드는 기능이므로 음성 인식 결과, 인물 배정, 자막 원문은 바뀌지 않습니다.

## Workflow / 사용 순서

1. Open **Audio mixer / 오디오 믹서**. Add the current project source or other audio/video files. To mix several OBS tracks, duplicate its row with **Add another track from this file / 같은 파일의 트랙 추가**, then select a different audio track in each row.
2. Set each track's gain, offset and mute. Gain is −60 to +12 dB. A positive offset inserts silence before a track; a negative offset removes its beginning. Existing delays between video and audio streams remain part of the source timeline.
3. Before exporting, use **Listen to this track** for one row, **Solo** to select rows for a **solo preview**, or **Preview mix** for enabled tracks. The start defaults to the editor's current position; change it to audition another section. FFmpeg extracts the selected stream, including non-default OBS streams, for up to ten seconds.
4. Read the **peak before limiter** and **playback peak**. Lower gains when the sum clips; the enabled limiter controls sample peaks with its lookahead compensated. The peak check covers only the preview window. This limiter is separate from the ASR VST chain and does not automatically apply VST effects.
5. Optionally apply the current project's duration and cuts. Tracks outside the project duration are excluded; shorter tracks are padded with silence. With this off, the mix ends at the latest end of enabled tracks.
6. Choose WAV, MP3, M4A or MP4. MP4 needs one added video source and original/30/60 fps; video is re-encoded at a constant frame rate and holds its final frame if shorter. Audio is 48 kHz stereo.
7. Save the mixer settings to the project, or start mixing (which also saves them). Download/listen to the result. Mixer history reopens exports after the dialog or app closes; short previews are disposable and excluded from that history.

1. **오디오 믹서**를 열고 현재 원본 또는 다른 음성·영상 파일을 추가합니다. OBS 트랙 여러 개를 합치려면 **같은 파일의 트랙 추가**로 행을 늘린 뒤 각 행에서 다른 트랙을 고릅니다.
2. 행마다 음량, 시간 이동, 음소거를 지정합니다. 음량은 −60~+12 dB입니다. 양수 시간 이동은 시작 앞에 무음을 넣고, 음수는 앞부분을 잘라냅니다. 원본 영상과 오디오 사이에 이미 존재하는 지연은 유지합니다.
3. 출력 전에 **이 트랙 듣기**로 한 행, **솔로**로 선택한 행들, **믹스 미리듣기**로 활성 트랙을 듣습니다. 시작점은 편집기의 현재 위치이며 다른 구간을 들으려면 시간을 바꿉니다. FFmpeg가 OBS 기본 트랙이 아닌 **선택한 실제 스트림**을 최대 10초 추출합니다.
4. **리미터 전 피크·재생 피크**를 확인합니다. 합산 신호가 클리핑되면 음량을 낮추세요. 켜진 리미터는 샘플 피크를 제한하고 미리 보기 지연을 보정합니다. 측정은 미리듣기 구간만 대상으로 합니다. 음성 인식 VST 체인과는 별개이며 믹스에 VST를 자동 적용하지 않습니다.
5. 필요하면 **현재 프로젝트 길이와 컷 구간 적용**을 켭니다. 프로젝트 밖 소리는 제외하고 짧은 트랙 뒤에는 무음을 채웁니다. 끄면 활성 트랙 중 가장 늦게 끝나는 시점까지 저장합니다.
6. WAV·MP3·M4A 또는 MP4를 고릅니다. MP4는 추가한 영상 원본과 원본/30/60 fps를 선택하며 고정 프레임률로 재인코딩합니다. 영상이 먼저 끝나면 마지막 프레임을 유지하고 소리는 48 kHz 스테레오입니다.
7. 설정을 프로젝트에 저장하거나 믹싱을 시작합니다(시작할 때도 저장). 완성본은 내려받아 듣고 앱을 다시 켠 뒤 이력에서 열 수 있습니다. 짧은 미리듣기는 임시 결과이며 출력 이력에 넣지 않습니다.

## Preview and peaks / 미리듣기와 피크

Solo and individual listening are **audition-only**: even a muted row can be explicitly listened to without changing its stored mute or export. Clear solo selections to preview the enabled mix. Offsets/gains and the limiter are applied, but preview times stay on the **original source timeline**, before project cuts. Thus solo/cut-excluded audio can be heard in a preview without being included in the final export.

솔로·개별 듣기는 **미리듣기 전용**입니다. 음소거한 행도 직접 들을 수 있지만 저장된 음소거와 최종 출력은 바꾸지 않습니다. 전체 활성 믹스를 확인하려면 솔로 선택을 해제하세요. 음량·시간 이동·리미터는 적용하고, 시간은 프로젝트 컷 적용 전 **원본 시간축**입니다. 솔로·컷 제외 구간을 들었다고 최종 출력에 포함되는 것은 아닙니다.

The raw float sum is measured before the limiter; playback peak is measured from the generated WAV. Silence displays −∞ dBFS. An overload warning remains visible with the limiter enabled so it does not hide excessive gains. These are **sample peaks for this window**, not true-peak measurement or a guarantee about the whole export; other sections and MP3/AAC encoding can differ. Check several representative loud sections and the final file.

리미터 전 float 합산 신호와 실제 생성한 WAV의 재생 피크를 각각 측정합니다. 무음은 −∞ dBFS로 표시합니다. 리미터를 켜도 합산 과부하를 알려 과한 음량 설정이 가려지지 않게 합니다. **해당 구간의 샘플 피크**이며 true-peak·전체 파일 검사가 아닙니다. 다른 구간·MP3/AAC 인코딩에서 피크가 달라질 수 있으므로 큰 소리 구간 여러 곳과 최종 파일을 확인하세요.

Changing settings/start/solo cancels the old preview and removes it from the player; late responses cannot replace the new one. Closing the mixer cancels previews. Preview files are bounded/disposable and cleared on backend restart. An output export is separate and continues when the dialog closes.

설정·시작점·솔로를 바꾸면 이전 미리듣기를 취소하고 플레이어에서 제거하며 늦은 응답도 다시 표시하지 않습니다. 창을 닫으면 미리듣기를 취소합니다. 미리듣기 파일은 제한된 임시 자료이며 백엔드 재시작 때 정리합니다. 별도로 시작한 전체 출력 작업은 창을 닫아도 계속됩니다.

## Source identity and recovery / 원본 확인과 복구

Project JSON stores file names, SHA-256 hashes, cache IDs and mix decisions. It contains no media bytes or absolute file paths. After moving to another computer or removing cached media, reconnect each missing file. Reconnection requires the same SHA-256; a different file with the same name cannot silently replace a source. Mix history protects its referenced media from manual cache cleanup until its history/output is deleted. Deleting history/output does not remove the original media.

프로젝트 JSON에는 파일명·SHA-256·캐시 ID·믹서 설정을 저장합니다. 음원 자체나 절대 경로는 포함하지 않습니다. 다른 컴퓨터로 옮기거나 캐시를 삭제한 경우 같은 파일을 다시 연결해야 합니다. SHA-256이 일치해야 하므로 이름만 같은 다른 파일로 몰래 바뀌지 않습니다. 믹서 작업 이력이 참조하는 원본은 이력·출력을 지우기 전까지 캐시 정리에서 보호됩니다. 이력·출력 삭제는 원본 삭제가 아닙니다.

Cancel terminates the owned FFmpeg process and removes temporary mix files. An export already reported as completed is kept. Closing the dialog leaves an active export running. If the backend exits before completion, history shows the interrupted job as failed; start a new export. Missing sources are errors, including muted rows; no requested source is silently skipped.

취소는 해당 FFmpeg 프로세스를 종료하고 임시 파일을 정리합니다. 이미 완료 상태로 표시된 출력은 유지합니다. 창을 닫아도 진행 중인 전체 출력은 계속됩니다. 백엔드가 완료 전에 종료되면 재시작 후 실패 이력으로 표시되며 새로 출력해야 합니다. 음소거한 행도 원본이 없으면 오류로 알려 주며, 누락된 파일을 조용히 건너뛰지 않습니다.

## Timing and limits / 시간과 제한

- Offsets never move captions automatically. Keep the main dialogue track on its original clock when exporting existing captions. Optional SRT/notes sidecars use the completed renderer's actual cut boundaries, and are available only for the current dialog's immutable project snapshot with project cuts enabled. History reopens media output only. Captions crossing a cut must be reviewed before SRT export.
- Mix offsets are rounded to 48 kHz samples. Video cuts align to output frames. MP3/AAC may have codec padding. The result reports retained content duration and cut boundaries.
- Up to 16 tracks, 8 queued/active mixer jobs, 200 retained cut ranges and a seven-day timeline. Export checks free cache space conservatively before starting. Long files need substantial temporary disk space; duration does not imply a tested performance guarantee.
- No automatic clock-drift correction, beat matching, arbitrary track stretching, VST mix rendering, or acoustic separation of a mixed track is included. A stereo mix is not an editable multitrack session export.
- Synthetic offline tests cover offset, gain, mute, sum, limiter delay/clipping, actual OBS stream preview/late seeking, sample peaks, cuts, WAV/MP3/M4A/MP4, frame rates, cancellation/stale-response rejection, hash validation, cache protection and history recovery. They do not establish real recording quality or a shipped installer version.

- 시간 이동은 자막을 자동으로 옮기지 않습니다. 기존 자막을 출력하려면 대화 원본의 시간축을 유지하세요. 컷을 적용한 현재 창의 프로젝트 스냅샷에서는 실제 출력 컷 경계에 맞춘 SRT·메모 CSV를 저장할 수 있습니다. 이력에서는 미디어만 다시 엽니다. 컷에 걸친 자막은 검수해야 SRT를 저장할 수 있습니다.
- 시간 이동은 48 kHz 샘플 단위, 영상 컷은 출력 프레임 단위로 맞춥니다. MP3/AAC에는 코덱 패딩이 생길 수 있습니다. 결과는 보존한 내용의 길이와 컷 경계를 제공합니다.
- 최대 16트랙·대기/실행 작업 8개·보존 구간 200개·7일 길이를 허용합니다. 시작 전에 캐시 디스크의 여유 공간을 보수적으로 확인합니다. 긴 파일에는 큰 임시 공간이 필요하며, 허용 길이가 처리 성능 보장은 아닙니다.
- 자동 녹음 시계 드리프트 보정, 박자 맞추기, 임의 시간 늘이기, VST 믹스 출력, 이미 섞인 음원에서 사람별 소리 분리는 포함하지 않습니다. 스테레오 믹싱 결과는 다시 편집할 수 있는 멀티트랙 세션 파일이 아닙니다.
- 합성 음원의 오프셋·음량·음소거·합산·리미터 지연/클리핑·실제 OBS 선택 스트림의 늦은 구간 미리듣기·샘플 피크·컷·출력·취소/늦은 응답 차단·해시·캐시 보호·이력 복구를 오프라인 검사합니다. 실제 녹음 품질이나 설치본 배포를 입증하는 것은 아닙니다.
