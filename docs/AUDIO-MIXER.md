# Audio mixer / 오디오 믹서

The mixer combines up to 16 audio tracks from multiple files or an OBS recording. It runs locally through FFmpeg. It does not require an AI model, upload audio to a cloud provider, or modify the originals. The mixer is a separate export operation; it does not change ASR, speaker assignments, or caption text.

믹서는 여러 파일 또는 OBS 녹화의 오디오 트랙을 최대 16개까지 합칩니다. FFmpeg로 로컬에서 실행하며, AI 모델이나 클라우드 전송 없이 원본을 보존합니다. 별도 파일을 만드는 기능이므로 음성 인식 결과, 인물 배정, 자막 원문은 바뀌지 않습니다.

## Workflow / 사용 순서

1. Open **Audio mixer / 오디오 믹서**. Add the current project source or other audio/video files. To mix several OBS tracks, duplicate its row with **Add another track from this file / 같은 파일의 트랙 추가**, then select a different audio track in each row.
2. Set each track's gain, offset and mute. Gain is −60 to +12 dB. A positive offset inserts silence before a track; a negative offset removes its beginning. Existing delays between video and audio streams remain part of the source timeline.
3. Keep the peak limiter enabled to prevent clipping. The FFmpeg limiter's lookahead is compensated. This limiter is separate from the ASR preprocessing VST chain; the mix does not automatically apply VST effects.
4. Optionally apply the current project's duration and cuts. Tracks outside the project duration are excluded; shorter tracks are padded with silence. When this option is off, the mix ends at the latest end of the enabled tracks.
5. Choose WAV, MP3, M4A or MP4. For MP4, select one of the added video sources and original/30/60 fps. The video is re-encoded at a constant frame rate. A shorter video holds its final frame while the mix continues. Audio is 48 kHz stereo.
6. Save the mixer settings to the project, or start mixing (which also saves them). Download or audition the resulting file. The mixer history can reopen exports after closing the dialog or restarting the app.

1. **오디오 믹서**를 열고 현재 원본 또는 다른 음성·영상 파일을 추가합니다. OBS 트랙 여러 개를 합치려면 **같은 파일의 트랙 추가**로 행을 늘린 뒤 각 행에서 다른 트랙을 고릅니다.
2. 행마다 음량, 시간 이동, 음소거를 지정합니다. 음량은 −60~+12 dB입니다. 양수 시간 이동은 시작 앞에 무음을 넣고, 음수는 앞부분을 잘라냅니다. 원본 영상과 오디오 사이에 이미 존재하는 지연은 유지합니다.
3. 피크 리미터를 켜면 합산된 소리의 클리핑을 방지합니다. 리미터의 미리 보기 지연은 보정합니다. 음성 인식 전처리용 VST 체인과는 별개이며, 믹싱에 VST 효과를 자동으로 적용하지 않습니다.
4. 필요하면 **현재 프로젝트 길이와 컷 구간 적용**을 켭니다. 프로젝트 밖 소리는 제외하고 짧은 트랙 뒤에는 무음을 채웁니다. 끄면 활성 트랙 중 가장 늦게 끝나는 시점까지 저장합니다.
5. WAV·MP3·M4A 또는 MP4를 선택합니다. MP4는 추가한 파일 중 영상 원본과 원본/30/60 fps를 고릅니다. 일정 프레임률로 다시 인코딩하며 영상이 먼저 끝나면 마지막 프레임을 유지합니다. 소리는 48 kHz 스테레오입니다.
6. 설정을 프로젝트에 저장하거나 믹싱을 시작합니다. 믹싱 시작도 설정을 저장합니다. 완성된 파일을 내려받거나 들어볼 수 있습니다. 창을 닫거나 앱을 다시 시작한 뒤에도 믹서 작업 이력에서 결과를 열 수 있습니다.

## Source identity and recovery / 원본 확인과 복구

Project JSON stores file names, SHA-256 hashes, cache IDs and mix decisions. It contains no media bytes or absolute file paths. After moving to another computer or removing cached media, reconnect each missing file. Reconnection requires the same SHA-256; a different file with the same name cannot silently replace a source. Mix history protects its referenced media from manual cache cleanup until its history/output is deleted. Deleting history/output does not remove the original media.

프로젝트 JSON에는 파일명·SHA-256·캐시 ID·믹서 설정을 저장합니다. 음원 자체나 절대 경로는 포함하지 않습니다. 다른 컴퓨터로 옮기거나 캐시를 삭제한 경우 같은 파일을 다시 연결해야 합니다. SHA-256이 일치해야 하므로 이름만 같은 다른 파일로 몰래 바뀌지 않습니다. 믹서 작업 이력이 참조하는 원본은 이력·출력을 지우기 전까지 캐시 정리에서 보호됩니다. 이력·출력 삭제는 원본 삭제가 아닙니다.

Cancel terminates the owned FFmpeg process and removes temporary mix files. A completed export is kept if cancellation arrives after its atomic completion. Closing the dialog leaves an active job running. If the backend exits before completion, history shows the interrupted job as failed; start a new export. Missing sources are errors, including muted rows; no requested source is silently skipped.

취소는 해당 FFmpeg 프로세스를 종료하고 임시 파일을 정리합니다. 파일 완성이 확정된 뒤 취소가 도착하면 완성본은 유지합니다. 창을 닫아도 진행 중인 작업은 계속됩니다. 백엔드가 완료 전에 종료되면 재시작 후 실패 이력으로 표시되며 새로 출력해야 합니다. 음소거한 행도 원본이 없으면 오류로 알려 주며, 누락된 파일을 조용히 건너뛰지 않습니다.

## Timing and limits / 시간과 제한

- Offsets never move captions automatically. Keep the main dialogue track on its original clock when exporting existing captions. Optional SRT/notes sidecars use the completed renderer's actual cut boundaries, and are available only for the current dialog's immutable project snapshot with project cuts enabled. History reopens media output only. Captions crossing a cut must be reviewed before SRT export.
- Mix offsets are rounded to 48 kHz samples. Video cuts align to output frames. MP3/AAC may have codec padding. The result reports retained content duration and cut boundaries.
- Up to 16 tracks, 8 queued/active mixer jobs, 200 retained cut ranges and a seven-day timeline. Export checks free cache space conservatively before starting. Long files need substantial temporary disk space; duration does not imply a tested performance guarantee.
- No automatic clock-drift correction, beat matching, arbitrary track stretching, VST mix rendering, or acoustic separation of a mixed track is included. A stereo mix is not an editable multitrack session export.
- Synthetic offline tests cover offset, gain, mute, sum, limiter delay/clipping, OBS stream selection, cuts, WAV/MP3/M4A/MP4, output frame rates, cancellation, hash validation, cache protection and history recovery. They do not establish real recording quality or a shipped installer version.

- 시간 이동은 자막을 자동으로 옮기지 않습니다. 기존 자막을 출력하려면 대화 원본의 시간축을 유지하세요. 컷을 적용한 현재 창의 프로젝트 스냅샷에서는 실제 출력 컷 경계에 맞춘 SRT·메모 CSV를 저장할 수 있습니다. 이력에서는 미디어만 다시 엽니다. 컷에 걸친 자막은 검수해야 SRT를 저장할 수 있습니다.
- 시간 이동은 48 kHz 샘플 단위, 영상 컷은 출력 프레임 단위로 맞춥니다. MP3/AAC에는 코덱 패딩이 생길 수 있습니다. 결과는 보존한 내용의 길이와 컷 경계를 제공합니다.
- 최대 16트랙·대기/실행 작업 8개·보존 구간 200개·7일 길이를 허용합니다. 시작 전에 캐시 디스크의 여유 공간을 보수적으로 확인합니다. 긴 파일에는 큰 임시 공간이 필요하며, 허용 길이가 처리 성능 보장은 아닙니다.
- 자동 녹음 시계 드리프트 보정, 박자 맞추기, 임의 시간 늘이기, VST 믹스 출력, 이미 섞인 음원에서 사람별 소리 분리는 포함하지 않습니다. 스테레오 믹싱 결과는 다시 편집할 수 있는 멀티트랙 세션 파일이 아닙니다.
- 합성 음원의 오프셋·음량·음소거·합산·리미터 지연/클리핑·OBS 트랙 선택·컷·출력 형식/프레임률·취소·해시 확인·캐시 보호·이력 복구를 오프라인 테스트합니다. 실제 녹음 품질이나 설치본 배포를 입증하는 것은 아닙니다.
