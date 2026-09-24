# 실제 Whisper 실행 확인

검증일: 2026-09-24. Windows에서 생성한 영어 합성 음성으로 `analyze()`를 직접 호출했고, 실제 faster-whisper tiny 가중치를 내려받아 CPU 전사를 완료했다. 이 결과는 단위 테스트의 모형 응답을 사용하지 않았다. HTTP API와 브라우저 화면을 경유한 검증은 이 기록의 범위에 포함되지 않는다.

## 입력과 실행 환경

- 입력: Windows `System.Speech.Synthesis.SpeechSynthesizer`, `Microsoft Zira Desktop`, 말하기 속도 `-1`로 만든 단일 음성 WAV. 사용자 미디어를 사용하지 않았다.
- 파일: `tmp/whisper-tiny-smoke.wav`, 22,050 Hz, 모노, 14.0224489796초.
- WAV SHA-256: `3C42FB5A2E1EA1CCB209D9CDAC0DA1BE3B1DF07E3E4D549F2F3509B5FF0E959E`.
- Windows 11, Python 3.12.0, faster-whisper 1.2.1, CTranslate2 4.8.2, PyAV 18.1.0, huggingface-hub 1.32.0.
- 실행 옵션: `whisper_model="tiny"`, `device="cpu"` (구현의 int8 경로), `language="en"`, `audio_track=0`, `diarization=False`, `mode="standard"`, `speaker_count=2`.
- 인물 수 옵션은 예상 인원이며, 이 입력은 실제로 한 합성 음성이다. 대사 속 Alice/Bob이라는 이름을 화자로 해석하지 않는다.

합성에 사용한 원문:

> Hello. This is a local subtitle test. Alice speaks first. Bob answers second. The meeting starts at nine. Please check the words and the timing.

## 관측한 결과

프로세스 종료 코드 0, 결과 `status="passed"`. 첫 가중치 다운로드, 모델 준비, 음원 추출, 전사를 포함한 단일 실행 전체 시간은 **10.782초**였다. 반복 측정이나 하드웨어 통제가 없으므로 이 수치를 처리 속도 벤치마크로 사용하지 않는다.

| 시작(초) | 종료(초) | 실제 반환 문장 |
| ---: | ---: | --- |
| 0.00 | 0.58 | Hello. |
| 1.52 | 3.48 | This is a local subtitle test. |
| 4.50 | 5.74 | Alice speaks first. |
| 6.72 | 7.90 | Bob answers second. |
| 8.88 | 10.62 | The meeting starts at 9. |
| 11.34 | 13.14 | Please check the words in the timing. |

원문의 `nine`은 `9`로 표기되었으며, 마지막 문장의 **`and`가 `in`으로 오인식**되었다. 실행 성공은 전사의 완전한 정확성을 뜻하지 않는다.

자막 6개와 단어 시간 25개가 반환되었다. 결과 길이는 14.0225초이며, 모든 자막의 `speakerId`는 `null`, `reasons`는 `["unassigned"]`, `reviewed`는 `false`였다. `speakers`는 빈 배열이고 다음 경고를 반환했다.

> 전사만 실행했습니다. 인물은 자동 추정하지 않았으므로 직접 배정하세요.

자동 검사 7개가 모두 통과했다.

- 비어 있지 않은 전사 결과.
- 모든 자막의 인물 미지정 유지.
- 추정 인물 목록을 생성하지 않음.
- 모든 자막에 `0 ≤ 시작 < 종료 ≤ 원본 길이` 적용.
- 자막 시작 시간 정렬.
- 모든 자막에 단어 시간 존재.
- 진행률의 단조 증가.

진행 이벤트의 마지막 값은 `완료`, `1.0`이었다.

다운로드 중 Hugging Face의 Windows 캐시 심볼릭 링크 미지원 경고와 비인증 요청 경고가 출력되었다. 실행 오류는 발생하지 않았고, 관리자 권한이나 Windows 개발자 모드 설정을 변경하지 않았다.

## 재현과 산출물

로컬 실행 스크립트와 전체 원본 응답은 각각 `tmp/run_model_smoke.py`, `tmp/whisper-tiny-smoke-result.json`에 보관했다. WAV, 스크립트, 응답의 `tmp/` 경로는 기존 `.gitignore`에 포함되어 저장소에 추가되지 않는다. 음성 파일은 일반 WAV 플레이어로 재생할 수 있다.

같은 로컬 산출물이 있는 작업 공간에서 다음 명령으로 재실행할 수 있다. 캐시가 있는 재실행 시간은 최초 실행 시간과 조건이 다르다.

```powershell
.\.venv\Scripts\python.exe tmp\run_model_smoke.py
```

최초 fixture를 생성한 방법은 다음과 같다. Windows PowerShell의 영어 Zira 음성이 설치되어 있어야 한다.

```powershell
Add-Type -AssemblyName System.Speech
$smokeSynth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
    $smokeSynth.SelectVoice('Microsoft Zira Desktop')
    $smokeSynth.Rate = -1
    $smokeSynth.SetOutputToWaveFile((Join-Path (Get-Location) 'tmp\whisper-tiny-smoke.wav'))
    $smokeSynth.Speak('Hello. This is a local subtitle test. Alice speaks first. Bob answers second. The meeting starts at nine. Please check the words and the timing.')
} finally {
    $smokeSynth.Dispose()
}
```

## 검증의 경계

`backend/tests/test_inference.py`의 20개 테스트는 별도로 통과했다. 해당 테스트는 합성 구간의 화자 귀속·겹침·미지정 처리, 취소, 시간 정렬, 선택한 오디오 스트림의 추출 등을 확인하는 구조적 검사이며, 이 문서의 실제 tiny 모델 실행과 구분한다.

이번 실행에서는 Nemotron, CUDA, 다른 Whisper 크기, 한국어, 두 인물 이상의 실제 발화, 동시 발화 복원, 긴 영상, 편집기 내보내기를 검증하지 않았다. 단어별 정답 경계와 청취 평가를 준비하지 않았으므로 타임스탬프의 음향적 정확도도 입증하지 않는다. 겹침이 많은 한국어 예능·게임·토론에서의 제품 품질은 별도의 실제 자료 평가가 필요하다. 이 smoke 과정에서 추론 코드 변경은 없었다.
