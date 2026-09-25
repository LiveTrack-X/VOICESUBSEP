# Optional Deepgram diarization / 선택형 Deepgram 화자 구분

Local Nemotron remains the default. Deepgram is an optional paid provider for identifying who spoke when. Its speech recognition service also transcribes the uploaded audio, but VOICESUBSEP discards that transcript and uses only the speaker-labelled word intervals. The separately selected ASR provider still produces the editable captions. This is speaker diarization, not separation of an already mixed waveform into isolated voices.

기본값은 로컬 Nemotron입니다. Deepgram은 ‘누가 언제 말했는지’를 구분하는 선택형 유료 제공자입니다. 이 API는 업로드한 음성을 전사하기도 하지만 앱은 해당 전사문을 폐기하고 단어별 화자·시간 정보만 사용합니다. 편집할 자막 원문은 별도로 고른 음성 인식 제공자가 만듭니다. 이미 섞인 녹음에서 사람별 소리를 추출하는 음향 분리 기능은 아닙니다.

## API contract / 연결 방식

- Fixed endpoint: `POST https://api.deepgram.com/v1/listen`; `Authorization: Token …`; binary WAV body. API keys remain in the backend process and are bound to their registration version for the submitted job. Deleting/replacing a key stops remaining upload or response processing; it cannot withdraw already transmitted audio or its charges.
- Fixed request: `model=nova-3&diarize_model=v2&utterances=true&smart_format=false`. Explicit supported languages use `language`; AUTO uses `detect_language=true`. The deprecated `diarize=true` parameter is not used. [Diarization documentation](https://developers.deepgram.com/docs/diarization), [models and languages](https://developers.deepgram.com/docs/models-languages-overview).
- AUTO identifies the dominant language. Deepgram documents that automatic detection can fall back to another supported ASR model for that language. It is not a guarantee that every code-switching speaker or word is understood. [Language detection](https://developers.deepgram.com/docs/language-detection).
- 앱은 고정 주소로 추출한 WAV만 보내며, 키나 파일 경로를 URL에 넣지 않습니다. 제출 당시 키 등록 버전에 연결하므로 키 변경·삭제 후 다른 계정으로 이어서 전송하지 않습니다. 이미 보낸 음성과 발생한 요금은 취소할 수 없습니다.
- `nova-3`와 batch용 `v2` 화자 모델을 요청합니다. AUTO는 주 언어 자동 감지이며 제공자가 언어에 따라 음성 인식 모델을 바꿀 수 있습니다. 로컬 Whisper의 다국어 동작과 동일하다고 간주하면 안 됩니다.

## Bounded whole-file processing / 전체 파일 처리와 한도

VOICESUBSEP accepts at most **two hours / 256 MiB** of extracted **16 kHz mono 16-bit PCM WAV** for this provider. These are application limits. One request contains the whole selected audio track so that speaker IDs are not restarted independently at arbitrary chunk boundaries. Over-limit input is rejected before sending anything. There is no automatic chunk fallback, redirect, or retry. Nova's documented provider limits are a 2 GB file and a ten-minute processing timeout; those provider limits do not guarantee every two-hour recording finishes. [Prerecorded limits](https://developers.deepgram.com/docs/pre-recorded-audio#limits).

이 앱의 Deepgram 입력 제한은 추출한 **16 kHz 모노 16비트 PCM WAV 최대 2시간·256 MiB**입니다. 공급자 최대치보다 보수적인 앱 제한입니다. 선택한 트랙 전체를 한 번 보내 화자 번호가 조각마다 새로 시작하는 문제를 피합니다. 초과 파일은 전송 전에 거부하며 자동 분할·재시도·리디렉션을 하지 않습니다. 공급자 처리 제한 안에 끝난다는 보장은 없습니다.

The client bounds upload plus response to 660 seconds and responses to 32 MiB. Cancellation closes the owned TLS connection. The app validates the returned full-audio duration, v2 diarizer metadata, speaker IDs, and word times before accepting intervals. Missing speaker labels or malformed/partial results fail explicitly. No provider transcript, request identifier, key, or arbitrary metadata is returned to the editing pipeline.

전송과 응답의 합계는 660초, 응답은 32 MiB로 제한합니다. 취소하면 해당 TLS 연결을 닫습니다. 응답의 전체 길이·v2 실행 정보·화자 번호·단어 시간을 검사하며, 화자 누락이나 잘못된 부분 결과를 임의 보정하지 않고 오류로 처리합니다. 공급자 전사문·요청 식별자·키·임의 메타데이터는 편집 파이프라인에 반환하지 않습니다.

## Verification and limitations / 검증과 제한

Tests use a fake HTTP transport and synthetic WAV files. They cover the real wire contract, no retries/redirects, bounds, cancellation, key replacement, hostile/malformed responses, metadata/timestamp validation and speaker IDs across a long timeline. **No paid API call or real Korean diarization quality test was performed.** Provider speaker identity, missed speech, overlaps and word boundaries remain recognition-quality limitations. Silence and pauses are not filled with invented speaker activity. A third-party provider handles transmitted audio under its own terms; the app does not claim remote deletion or an offline guarantee for this option.

테스트는 가짜 HTTP 전송 계층과 합성 WAV로 계약·한도·취소·키 변경·잘못된 응답·시간 검사·긴 시간축의 화자 ID 보존을 확인합니다. **실제 유료 API 호출이나 한국어 화자 구분 품질 검증은 하지 않았습니다.** 화자 인식 오류, 누락 발화, 겹친 말, 단어 경계 오차는 남을 수 있습니다. 침묵을 가짜 화자 구간으로 채우지 않습니다. 전송된 음성은 제공자 정책에 따라 처리되며 앱이 원격 삭제나 오프라인 처리를 보장하지 않습니다.
