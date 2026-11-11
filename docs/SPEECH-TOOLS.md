# Project speech tools / 프로젝트 음성 보완 도구

2026-11-11 개발 소스 기능입니다. 게시된 0.3.5 설치본의 기능이나 실제 방송 정확도 개선을 주장하지 않습니다.

[소스·화면·실제 모델 실행 검증 기록](evidence/speech-tools-source-validation.json)

## 프로젝트 용어 사전

분석 창에서 닉네임·게임 용어·고유명사를 한 줄에 하나씩 입력하고 **프로젝트에 저장**합니다. JSON·자동 저장·실행 취소에 포함되며 기존 자막을 자동 치환하지 않습니다. 저장하지 않았거나 잘못된 입력은 분석 시작을 막습니다.

최대 50개, 용어당 Unicode 문자 50개, 쉼표·공백 포함 전체 2,000자입니다. NFC 정규화·앞뒤 공백 제거·중복 제거를 적용하고 제어 문자는 거절합니다. Whisper는 실제 tokenizer 한도를 검사하고, Groq는 224토큰 한도에 대해 보수적인 UTF-8 224바이트 제한을 적용합니다. 용어를 조용히 자르지 않습니다.

Whisper hotwords, Qwen prompt, Groq prompt, xAI 2.0 keyterm을 지원합니다. Gemini는 단어별 시간과 사전을 동시에 사용할 수 없으므로 사전을 보내지 않습니다. xAI 1.0도 미지원으로 표시합니다. 사전은 프로젝트에 남습니다. 지원 클라우드 경로에는 음성과 사전이 함께 전송됩니다. 사전 변경은 전송 동의를 해제하고, 대기열 작업은 당시 저장된 사전을 사용합니다.

## 확인한 목소리

편집 화면의 **음성 보완 도구**에서 원본 트랙을 선택합니다. 인물·문장·시간을 확인하고 검수 완료한 단독 발화 자막 3~15초를 선택해 미리듣기를 실제로 듣고 등록합니다. 프로젝트당 최대 16개이며 JSON에는 원본 hash·트랙·자막 스냅샷만 저장합니다. 임베딩·원본 음성은 저장하지 않습니다.

두 인물 이상의 기준을 등록한 뒤, 미배정 단독 발화 1.5~15초를 듣고 비교합니다. 수동 수정·검수 완료·겹침·시간 또는 음성 불확실 대상은 보호합니다. 짧은 추임새는 확정하지 않습니다. 추천은 원시 cosine 유사도와 2위와의 차이를 사용합니다. 0.75 / 차이 0.15는 실험 정책값이며 한국어 방송으로 보정된 확률이 아닙니다.

선택 적용은 화자만 바꾸고 원문·단어 시간을 유지하며 검수 미완료로 남깁니다. 실행 취소할 수 있습니다. 원본·트랙·기준 자막·프로젝트 세션이 바뀌면 재확인이 필요합니다. 파일 간 자동 인물 추적이나 실명 식별은 아닙니다.

## 겹침 복원 실험

원본 트랙과 2~20초 구간을 선택하고 **모델 준비**로 분리 모델과 선택한 Whisper를 준비합니다. CPU에서 두 후보 음성과 전사문을 만듭니다. 원본과 후보를 듣고 필요한 문장을 고르며 인물은 직접 지정합니다. 후보 순서는 신원이 아닙니다. **선택 후보 추가**는 기존 자막을 남긴 채 추가하므로 중복될 수 있습니다. 후보의 검수 필요 표시를 유지하고 실행 취소할 수 있습니다.

분리 모델은 **영어 WSJ0-2Mix 학습, 8kHz, 동시 2인** SepFormer입니다. 음악·효과음·고함·웃음·3인 이상에서 손상·누락·중복이 생길 수 있습니다. 분리된 마이크 트랙이 있으면 기존 트랙별 분석을 우선 사용하세요.

로컬 Windows 합성 두 화자 시험에서 실제 가중치 로드·두 WAV 생성·재전사·원본 시간 복원·원본 hash 보존을 확인했습니다. **그 시험에서는 두 후보 전사가 영어 쪽으로 치우쳤고 한국어 대사를 복원하지 못했습니다.** 실행 확인은 복원 품질 보증이 아닙니다. 실제 한국어 방송의 누락 감소·화자 정확도·편집 시간 개선은 미측정입니다.

## 선택 실행 환경

```powershell
powershell -NoProfile -File .\scripts\setup.ps1 -SpeechTools
npm start
```

기존 환경에 필요한 부분만 추가하려면:

```powershell
uv pip install --python .venv\Scripts\python.exe torchaudio==2.11.0+cu128 --index-url https://download.pytorch.org/whl/cu128
uv pip install --python .venv\Scripts\python.exe --editable ".\backend[voice-reference,separation]"
```

TorchAudio는 기존 PyTorch 2.11.0과 맞춥니다. 의존성이 없으면 화면에 준비 문제를 표시합니다. 음성 도구는 로컬 처리이며 사용자 음성을 외부에 전송하지 않습니다. 모델 준비는 공개 모델 파일만 다운로드합니다.

| 모델 | 고정 revision | 조건 |
| --- | --- | --- |
| WeSpeaker ResNet34-LM, 약 27MB | `f0c48c298fd835726c27956a5d617bad7115627e` | 모델 CC-BY-4.0; 코드 Apache-2.0 |
| SpeechBrain SepFormer, 약 113MB | `3a2826343a10e2d2e8a75f79aeab5ff3a2473531` | Apache-2.0 |

가중치는 사용자 캐시에 저장하고 고정 크기·SHA-256을 검사합니다. 시작·상태·비교·복원에서는 자동 다운로드하지 않습니다. 내려받은 Python/YAML을 실행하지 않고 체크포인트는 `weights_only=True`와 엄격한 키 검사로 읽습니다.

임시 음원은 앱 데이터의 `speech-tools`에 저장하고 결과 폐기·재시작 때 정리합니다. 작업 중 원본 캐시를 보호하며 일반 분석·라이브와 동시 실행하지 않습니다. 별도 소유 프로세스에서 실행하고 중지·종료 때 회수합니다.

향후 설치본에 포함하려면 `scripts/build-backend.ps1 -IncludeSpeechToolsRuntime`과 실제 동결 실행 검증이 필요합니다. 기본 빌드는 선택 TorchAudio/SpeechBrain을 제외합니다. [모델 고지](../third-party/speech-tools/SOURCE.md), [SentencePiece 원본 고지 보완](../third-party/sentencepiece-0.2.3/SOURCE.md).

공식 힌트 계약: [faster-whisper](https://github.com/SYSTRAN/faster-whisper), [고정 Qwen processor](https://github.com/huggingface/transformers/blob/4b28d51d0d5f17ec20c23a187d0475a8e68810c8/src/transformers/models/qwen3_asr/processing_qwen3_asr.py), [Groq](https://console.groq.com/docs/speech-to-text), [xAI](https://docs.x.ai/developers/model-capabilities/audio/speech-to-text), [Gemini](https://ai.google.dev/gemini-api/docs/transcribe).
