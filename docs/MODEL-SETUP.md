# 로컬 모델 실행 환경

v0.1은 **faster-whisper 전사 + 선택적 Nemotron 화자 활동 분석**을 실행한다. 합성 데모 데이터를 실제 분석의 대체 결과로 사용하지 않는다. Qwen/MOSS 및 음성 분리 모델은 조사 후보이며 아직 이 버전에 구현하지 않았다.

## 상태의 의미

`/api/health`의 `engines.whisper`, `engines.nemotron`은 현재 서버 Python에서 필요한 실행 클래스가 import되는지 나타낸다. 가중치의 다운로드·캐시 존재, GPU에서의 실행 성공, 한국어 정확도를 뜻하지 않는다. 모델 파일이 없다면 실제 분석 첫 실행에서 공식 Hugging Face 모델을 다운로드할 수 있다. 이 경로는 로컬 미디어를 외부 API에 전송하지 않는다.

같은 응답의 `gpu`에는 `available`, `name`, `deviceCount`, `computeTypes`, `reason`이 포함된다. 이는 CUDA 장치와 지원 정밀도·런타임 DLL 로드 결과이며 모델 추론 검사는 아니다. `defaults`는 large-v3와 사용 가능한 CUDA/FP16을 권장하고, GPU가 준비되지 않았으면 CPU/INT8을 반환한다. 화면은 CPU 선택 사유를 표시한 상태에서 사용자가 분석을 시작하게 한다. 이미 시작한 CUDA 작업의 오류를 숨기고 CPU로 전환하지 않는다.

## Whisper

서버와 같은 가상환경에 `faster-whisper`가 필요하다. 기본 모델은 `large-v3`이며, 빠른 분석 비교용으로 `large-v3-turbo`를 선택할 수 있다. 과거 이름 `turbo`도 API가 받아 `large-v3-turbo`로 정규화한다. CPU는 INT8, CUDA는 FP16으로 실행한다. CUDA 실행 전 런타임과 FP16 지원을 확인하며, 앱 시작·health 확인에서 가중치를 자동 다운로드하지 않는다.

Windows에서는 기본 설치 후 저장소 루트에서 다음 명령으로 **NVIDIA의 Windows 런타임 패키지**를 `.venv`에 추가할 수 있다. 모델 가중치를 받는 명령은 아니다.

```powershell
uv pip install --python .venv\Scripts\python.exe -e './backend[whisper,gpu-windows]'
```

`gpu-windows`는 프로젝트에서 버전을 지정한 CUDA 12용 cuBLAS·cuDNN 9·CUDA runtime 패키지를 설치한다. 패키지의 하위 의존성도 설치되며 버전 지정의 기준은 `backend/pyproject.toml`이다. GPU용 NVIDIA 드라이버는 별도로 필요하다. 현재 서버를 종료한 뒤 다시 실행해 새 DLL을 로드한다.

`gpu_runtime.py`는 `.venv`/현재 Python의 `site-packages/nvidia/*/bin`, 프로젝트의 `runtime/cuda/bin`, 기존 절대 `PATH` 경로에서 필요한 DLL을 찾는다. DLL 검색 경로와 핸들은 서버 프로세스 안에서만 유지하며, 시스템 전체 `PATH`·레지스트리를 변경하지 않는다. 준비되지 않은 DLL의 이름은 health의 `reason`과 분석 오류에서 확인할 수 있다. PyTorch가 CUDA를 인식하는지만 확인해서 CTranslate2 환경도 준비됐다고 판단하지 않는다.

GPU 설치 후에는 화자 구분을 끄고 선택한 큰 모델로 짧은 파일을 끝까지 전사해 확인한다. 환경 점검용 tiny CPU 실행과 large-v3/turbo의 GPU 실행은 별도 검증이다. 가중치 다운로드를 포함한 첫 실행 시간도 이미 캐시된 실행 시간과 분리해 기록한다. 모델·속도·라이선스 및 **Faster Whisper XXL이 별도 모델이 아닌 실행 패키지라는 구분**은 [GPU 모델 문서](GPU-MODELS.md)에 정리했다.

Windows 신규 모델은 `%LOCALAPPDATA%/VOICESUBSEP/models/whisper/<모델명>`에 일반 파일로 저장한다. 완성된 기존 Hugging Face 캐시는 읽기 재사용한다. 이는 HF 병렬 캐시 다운로드의 symlink 권한 오류를 피하며 관리자 권한이나 Windows 개발자 모드를 요구하지 않는다. 모델은 앱 설치 디렉터리 밖에 있으므로 앱 업데이트 시 유지된다.

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
- Whisper가 해제된 뒤 Nemotron을 적재한다. 예상 인원 1·2·3명은 정확한 수와 비교하고, 숫자 4는 '4명 이상'을 뜻한다. 4명 이상 설정에서 검출된 5~8명은 모두 보존하고 인원 불일치 표시를 하지 않는다. 4명 미만은 불일치 표시하며 8채널을 모두 사용한 경우의 별도 검수 경고는 유지한다.
- 화자 모델의 입력은 작은 청크로 처리하지만, 현재 CPU 메모리에는 선택 오디오의 전체 float32 파형과 출력 활동값을 보관한다. 긴 파일의 메모리·시간은 별도 측정해야 한다.
- 취소는 추출 subprocess를 종료하거나 모델 처리 청크/Whisper segment 경계에서 처리한다. 진행 중인 가중치 다운로드나 한 번의 native 모델 호출을 강제로 끊지는 못한다. 취소 요청 후 처리 완료까지 시간이 걸릴 수 있다.
- 중간 WAV는 임시 폴더에서 처리하고 성공·실패·취소 모두 정리한다.

## 검증 범위

2026-09-24 이 PC의 NVIDIA GeForce RTX 3080 Ti, VRAM 12288 MiB(12 GB), 드라이버 616.56에서 **large-v3와 large-v3-turbo의 실제 CUDA FP16 전사를 완료했다.** 입력은 14초 영어 합성 음성이며 결과·실행 조건은 [GPU·데스크톱 검증 기록](GPU-DESKTOP-VALIDATION.md)에 있다. 한국어·다중 화자·설치본 실행 검증과 구별한다. 이전 CPU tiny 기록은 [MODEL-SMOKE.md](MODEL-SMOKE.md)에 보존했다.

합성 interval 테스트는 화자 연결·겹침 보존·시간 유지·취소를 검증하며 모델 품질을 증명하지 않는다. 작은 FFmpeg fixture는 지연 트랙의 시간과 전역 트랙 선택을 검증한다. 실제 한국어 예능·게임·토론의 누락률, 화자 오류, 수정 시간은 연구 문서의 동일 자료 비교로 검증해야 한다. **v0.1은 겹친 목소리를 분리하거나 누락된 두 번째 대사를 복원하지 않는다.**

Whisper 가중치와 faster-whisper 코드는 각 upstream MIT 조건, Nemotron 가중치는 공식 카드의 OpenMDW-1.1 조건을 따른다. 모델을 앱과 함께 재배포할 때는 실제 포함한 버전의 라이선스를 따로 확인한다.
