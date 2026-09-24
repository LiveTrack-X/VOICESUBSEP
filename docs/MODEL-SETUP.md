# 로컬 모델 실행 환경

v0.1은 **faster-whisper 전사 + 선택적 Nemotron 화자 활동 분석**을 실행한다. 합성 데모 데이터를 실제 분석의 대체 결과로 사용하지 않는다. Qwen/MOSS 및 음성 분리 모델은 조사 후보이며 아직 이 버전에 구현하지 않았다.

## 상태의 의미

`/api/health`의 `engines.whisper`, `engines.nemotron`은 현재 서버 Python에서 필요한 실행 클래스가 import되는지 나타낸다. 가중치의 다운로드·캐시 존재, GPU에서의 실행 성공, 한국어 정확도를 뜻하지 않는다. 모델 파일이 없다면 실제 분석 첫 실행에서 공식 Hugging Face 모델을 다운로드할 수 있다. 이 경로는 로컬 미디어를 외부 API에 전송하지 않는다.

## Whisper

서버와 같은 가상환경에 `faster-whisper`가 필요하다. CPU는 INT8, CUDA는 FP16으로 실행한다. CUDA 실행에는 사용 중인 CTranslate2 버전과 맞는 CUDA/cuDNN 런타임이 필요하다. 처음에는 `tiny` 또는 `base`의 짧은 파일로 환경을 검증한 뒤 품질 비교를 진행한다. 앱 시작 시 가중치를 자동 다운로드하지 않는다.

공식 설치·GPU 의존성: <https://github.com/SYSTRAN/faster-whisper>

## Nemotron 화자 구분 (선택)

공식 모델 ID는 `nvidia/Nemotron-3-Diarization`이다. 2026-09-24 확인한 모델 카드는 PyTorch와 최신 소스 Transformers를 안내한다. 단순히 Transformers 패키지가 있다고 해서 지원되는 것은 아니다. 다음 클래스와 후처리 API가 필요하다.

- `Nemotron3DiarizationForAudioFrameClassification`
- `Nemotron3DiarizationProcessor.extract_speaker_dict`
- 캐시를 유지하는 streaming processor API

공식 안내: <https://huggingface.co/nvidia/Nemotron-3-Diarization>

서버 환경에서 아래 확인은 다운로드 없이 클래스 지원 여부만 검사한다.

```powershell
python -c "from transformers import Nemotron3DiarizationForAudioFrameClassification, Nemotron3DiarizationProcessor; print('native Nemotron classes available')"
```

지원 버전 선택과 설치는 공식 카드 및 CUDA 호환성을 확인해 별도로 수행한다. 앱은 실행 중 Python 의존성을 설치하거나 자동 업그레이드하지 않는다. 실행 환경이 없으면 요청은 설명과 함께 실패한다. 사용자가 화자 구분을 끄면 전사만 실행하고 모든 자막의 인물을 미지정으로 남긴다.

이 구현은 low_latency streaming 설정으로 화자 캐시를 이어 간다. 공식 `extract_speaker_dict`의 `Start`, `End`, `Speaker`를 사용하며, 출력 시간은 processor의 mel hop/sample rate(기본 10 ms)에 따른다. 내부 encoder의 80 ms를 최종 출력 프레임 시간으로 오인하지 않는다. 표준 모드도 겹침 정보를 버리지 않는다. 출력 겹침 단어는 인물을 강제 배정하지 않고 검수 대상으로 남긴다.

공식 processor 소스: <https://github.com/huggingface/transformers/blob/main/src/transformers/models/nemotron3_diarization/processing_nemotron3_diarization.py>

## 원본 시간·트랙·자원

- UI의 오디오 트랙 번호는 FFprobe 전역 stream index다. FFmpeg는 선택한 한 트랙만 매핑한다.
- 선택한 트랙 안의 다채널은 분석용 mono로 변환하고 결과 경고에 기록한다. 다른 트랙을 함께 섞지 않으며 원본 파일은 수정하지 않는다.
- `-copyts -start_at_zero` 및 resampling의 `first_pts=0`으로 지연된 오디오와 무음 구간을 원본 재생 시간축에 유지한다.
- Whisper가 해제된 뒤 Nemotron을 적재한다. 화자 수 1~4 설정은 검수용 예상 인원이며 검출된 5~8명을 강제로 합치지 않는다.
- 화자 모델의 입력은 작은 청크로 처리하지만, 현재 CPU 메모리에는 선택 오디오의 전체 float32 파형과 출력 활동값을 보관한다. 긴 파일의 메모리·시간은 별도 측정해야 한다.
- 취소는 추출 subprocess를 종료하거나 모델 처리 청크/Whisper segment 경계에서 처리한다. 진행 중인 가중치 다운로드나 한 번의 native 모델 호출을 강제로 끊지는 못한다. 취소 요청 후 처리 완료까지 시간이 걸릴 수 있다.
- 중간 WAV는 임시 폴더에서 처리하고 성공·실패·취소 모두 정리한다.

## 검증 범위

합성 interval 테스트는 화자 연결·겹침 보존·시간 유지·취소를 검증하며 모델 품질을 증명하지 않는다. 작은 FFmpeg fixture는 지연 트랙의 시간과 전역 트랙 선택을 검증한다. 실제 한국어 예능·게임·토론의 누락률, 화자 오류, 수정 시간은 연구 문서의 동일 자료 비교로 검증해야 한다. **v0.1은 겹친 목소리를 분리하거나 누락된 두 번째 대사를 복원하지 않는다.**

Whisper 가중치와 faster-whisper 코드는 각 upstream MIT 조건, Nemotron 가중치는 공식 카드의 OpenMDW-1.1 조건을 따른다. 모델을 앱과 함께 재배포할 때는 실제 포함한 버전의 라이선스를 따로 확인한다.
