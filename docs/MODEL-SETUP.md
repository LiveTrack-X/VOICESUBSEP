# 로컬 모델 실행 환경

기본 작업은 **Nemotron 화자 활동 분석 → faster-whisper 전사 → 인물별 자막 생성**이다. Nemotron은 기본 설치에 포함되는 핵심 실행 구성 요소다. 합성 데모 데이터를 실제 분석의 대체 결과로 사용하지 않는다. Qwen3 ASR + forced aligner는 선택 소스 어댑터와 모의 테스트를 구현했으나, 실제 음성 모델 추론은 미검증이고 토크나이저 배포 고지 불일치로 **동결 설치본에는 포함하지 않는다**. 자세한 범위와 감사 근거는 [Qwen 소스 실행 환경](QWEN-RUNTIME.md)을 따른다. MOSS와 음성 분리 모델은 조사 후보이다.

The default remains **Whisper + Nemotron**. Qwen is a source/development option with synthetic/mock verification, **not an included desktop runtime**. Its optional dependency group, real-inference limits and distribution audit gate are recorded in [Qwen runtime status](QWEN-RUNTIME.md).

## 상태의 의미

`/api/health`의 `engines.whisper`, `engines.nemotron`은 현재 서버 Python에서 필요한 실행 모듈이 준비됐는지 나타낸다. Nemotron은 모델·processor 클래스뿐 아니라 streaming feature extractor와 librosa도 확인한다. 실패 원인은 `engineIssues.whisper`, `engineIssues.nemotron`에 표시된다. 이것은 가중치의 다운로드·캐시 존재, GPU에서의 실행 성공, 한국어 정확도를 뜻하지 않는다.

분석 화면의 기본 선택은 **인물별 자막 생성 · Whisper + Nemotron**이다. Nemotron 실행 환경이 없으면 이유를 표시하고 이 기본 분석의 시작을 막는다. API에서 화자 구분을 요청한 경우에도 전사 전에 실행 환경을 확인해 실패를 알린다. 자동으로 전사 전용 결과를 대신 제공하지 않는다. 사용자가 **전사만 생성 · 인물은 직접 지정**을 명시적으로 고른 경우에만 Nemotron 없이 진행하며, 화자를 미지정으로 남긴다.

앱 시작과 health 조회는 모델 가중치를 다운로드하지 않는다. 실행 패키지 설치와 가중치 준비는 별개이며, 가중치가 없으면 사용자가 분석을 시작한 첫 실행에서 모델 파일을 내려받을 수 있다. 이 경로는 로컬 미디어를 외부 분석 API에 전송하지 않는다.

같은 응답의 `gpu`에는 `available`, `name`, `deviceCount`, `computeTypes`, `reason`이 포함된다. 이는 CUDA 장치와 지원 정밀도·런타임 DLL 로드 결과이며 모델 추론 검사는 아니다. `defaults`는 large-v3와 사용 가능한 CUDA/FP16을 권장하고, GPU가 준비되지 않았으면 CPU/INT8을 반환한다. 화면은 CPU 선택 사유를 표시한 상태에서 사용자가 분석을 시작하게 한다. 이미 시작한 CUDA 작업의 오류를 숨기고 CPU로 전환하지 않는다.

## Whisper

서버와 같은 가상환경에 `faster-whisper`가 필요하다. 기본 모델은 `large-v3`이며, 빠른 분석 비교용으로 `large-v3-turbo`를 선택할 수 있다. 과거 이름 `turbo`도 API가 받아 `large-v3-turbo`로 정규화한다. CPU는 INT8, CUDA는 FP16으로 실행한다. CUDA 실행 전 런타임과 FP16 지원을 확인하며, 앱 시작·health 확인에서 가중치를 자동 다운로드하지 않는다.

Windows에서 아래 Nemotron 절의 CUDA용 PyTorch를 설치하면, 앱은 `torch/lib`에 있는 완전한 CUDA DLL 묶음을 우선 사용한다. 이 공유 라이브러리를 Whisper의 CTranslate2도 사용하므로 **별도 NVIDIA 런타임 패키지가 항상 필요한 것은 아니다.** 설치 후 서버를 다시 시작하고 health의 `gpu.available`과 `gpu.reason`으로 준비 상태를 확인한다.

Whisper만 설치했거나 필요한 DLL이 준비되지 않은 환경에서는 다음 명령으로 **대체 NVIDIA Windows 런타임 패키지**를 `.venv`에 추가할 수 있다. 이미 준비된 환경에 중복 설치할 필요는 없으며 모델 가중치를 받는 명령도 아니다.

```powershell
uv pip install --python .venv\Scripts\python.exe -e './backend[whisper,gpu-windows]'
```

`gpu-windows`는 프로젝트에서 버전을 지정한 CUDA 12용 cuBLAS·cuDNN 9·CUDA runtime 패키지를 설치한다. 패키지의 하위 의존성도 설치되며 버전 지정의 기준은 `backend/pyproject.toml`이다. GPU용 NVIDIA 드라이버는 별도로 필요하다. 현재 서버를 종료한 뒤 다시 실행해 새 DLL을 로드한다.

`gpu_runtime.py`는 `.venv`/현재 Python의 `site-packages/torch/lib`에 필요한 DLL이 모두 있으면 그 묶음을 먼저 선택한다. 이어서 `site-packages/nvidia/*/bin`, 프로젝트의 `runtime/cuda/bin`, 기존 절대 `PATH` 경로를 확인하며, 동결 배포본의 내부 라이브러리 경로도 지원한다. DLL 검색 경로와 핸들은 서버 프로세스 안에서만 유지하며, 시스템 전체 `PATH`·레지스트리를 변경하지 않는다. 준비되지 않은 DLL의 이름은 health의 `reason`과 분석 오류에서 확인할 수 있다. PyTorch가 CUDA를 인식하는지만 확인해서 CTranslate2 환경도 준비됐다고 판단하지 않는다.

Whisper 단독 실행 환경을 점검할 때는 분석 화면에서 **전사만 생성**을 명시적으로 선택하고 짧은 파일을 끝까지 전사할 수 있다. 이것만으로 기본 인물별 자막 기능의 준비가 끝난 것은 아니다. 환경 점검용 tiny CPU 실행, large-v3/turbo GPU 전사, Nemotron 화자 구분은 각각 검증한다. 가중치 다운로드를 포함한 첫 실행 시간도 이미 캐시된 실행 시간과 분리해 기록한다. 모델·속도·라이선스 및 **Faster Whisper XXL이 별도 모델이 아닌 실행 패키지라는 구분**은 [GPU 모델 문서](GPU-MODELS.md)에 정리했다.

Windows 신규 모델은 `%LOCALAPPDATA%/VOICESUBSEP/models/whisper/<모델명>`에 일반 파일로 저장한다. 완성된 기존 Hugging Face 캐시는 읽기 재사용한다. 이는 HF 병렬 캐시 다운로드의 symlink 권한 오류를 피하며 관리자 권한이나 Windows 개발자 모드를 요구하지 않는다. 모델은 앱 설치 디렉터리 밖에 있으므로 앱 업데이트 시 유지된다.

공식 설치·GPU 의존성: <https://github.com/SYSTRAN/faster-whisper>

## Nemotron 화자 구분 — 기본 기능 설치

공식 모델 ID는 `nvidia/Nemotron-3-Diarization`이다. 이 앱은 네이티브 Transformers 어댑터를 사용하며, 단순히 Transformers 패키지가 설치되어 있다는 것만으로 지원 여부를 판단하지 않는다. 다음 클래스와 후처리 API가 필요하다.

- `Nemotron3DiarizationForAudioFrameClassification`
- `Nemotron3DiarizationProcessor.extract_speaker_dict`
- `NemotronAsrStreamingFeatureExtractor` 및 librosa
- 캐시를 유지하는 streaming processor API

공식 안내: <https://huggingface.co/nvidia/Nemotron-3-Diarization>

Windows의 기본 설치 명령은 다음과 같다. `scripts/setup.ps1`은 새 환경에 **Python 3.12.13**을 사용하고 CUDA 12.8용 PyTorch와 Whisper·Nemotron 실행 환경을 모두 설치한다. 기존 `.venv`는 **3.12 계열의 3.12.1 이상**이어야 하며 3.12.0은 거부한다. Node.js·uv·FFmpeg 등 사전 조건은 [README](../README.md)를 따른다. 설치 과정은 실행 패키지를 다운로드하므로 네트워크와 디스크 공간을 확보한 때 실행한다. 모델 가중치를 받는 명령은 아니다.

```powershell
powershell -ExecutionPolicy Bypass -File scripts/setup.ps1
```

이미 준비된 Python 3.12.1 이상·3.13 미만 `.venv`에서 같은 모델 실행 환경만 설치하는 수동 절차는 다음과 같다. 새 환경에는 3.12.13을 사용한다. PyTorch를 먼저 설치하며, 정상적인 기본 설치를 마쳤다면 이를 반복할 필요는 없다.

```powershell
uv pip install --python .venv\Scripts\python.exe 'torch==2.11.0+cu128' --index-url https://download.pytorch.org/whl/cu128
uv pip install --python .venv\Scripts\python.exe -e './backend[whisper,diarization]'
```

위 CUDA용 PyTorch에 포함된 공유 DLL이 앱의 준비 검사를 통과하면 `backend[whisper,gpu-windows]`를 추가 설치할 필요가 없다. PyTorch의 CUDA 환경과 CTranslate2에 필요한 DLL의 실제 로드 여부는 각각 확인한다. 설치가 끝나면 서버를 다시 시작한다. 기존 설치에 무조건 `--upgrade`를 추가하지 않으며, 앱은 실행 중 Python 패키지를 설치하거나 업그레이드하지 않는다.

`backend/pyproject.toml`에서는 의존성을 `diarization` extra로 묶어 관리하지만, 제품의 기본 인물별 자막 기능에서 Nemotron은 선택 설치가 아니다. 기본 setup은 `backend[whisper,diarization,test]`를 설치한다. 다음 표는 설치 계약이며 실제 실행 결과는 아래 검증 기록과 구분한다.

| 구성 요소 | 지정 값 |
| --- | --- |
| Python | 새 setup 환경 `3.12.13`; 기존 환경은 `>=3.12.1,<3.13`; 동결 빌드에서 `3.12.0` 거부 |
| PyTorch | `torch>=2.11,<2.12`; Windows 기본 setup은 `torch==2.11.0+cu128` 사용 |
| Transformers | 공식 저장소 커밋 `4b28d51d0d5f17ec20c23a187d0475a8e68810c8`의 ZIP 소스 |
| librosa | `0.11.0` |

Transformers 고정 소스: <https://github.com/huggingface/transformers/archive/4b28d51d0d5f17ec20c23a187d0475a8e68810c8.zip>

서버와 같은 가상환경에서 아래 명령으로 설치 버전·CUDA 인식과 실행 클래스 상태를 확인할 수 있다. 모델 가중치를 내려받거나 전사를 실행하지는 않는다. `torch.cuda.is_available()`와 `engines.nemotron=true`만으로 실제 Nemotron 추론 검증을 대신하지 않는다.

```powershell
.\.venv\Scripts\python.exe -c "import torch; print(torch.__version__, torch.version.cuda, torch.cuda.is_available())"
.\.venv\Scripts\python.exe -c "import json; from voicesubsep.inference import capability_report; print(json.dumps(capability_report(), ensure_ascii=False))"
```

로컬에 미리 모은 wheel로 오프라인 설치하는 경우에도 같은 버전과 소스를 유지하고 설치 결과를 따로 확인한다. 이 PC에서 실행된 조합은 PyTorch `2.11.0+cu128`, 위 고정 소스의 Transformers `5.18.0.dev0`, librosa `0.11.0`이다. 다른 PC의 설치·실행 성공을 이 기록으로 대신하지 않는다.

### Windows 동결 번들과 Python 유지보수 버전

아래 소스·UI 추론 성공은 기존 **Python 3.12.0** 환경에서 얻었다. 같은 버전으로 만든 PyInstaller 동결 실행에서는 `torch._numpy._ufuncs`의 `NameError: name 'name' is not defined`와 `scipy.stats._distn_infrastructure`의 `NameError: name 'obj' is not defined`가 관측됐다. 소스 실행 성공이 동결 배포본의 import·실행 성공을 보장하지 않는다.

이는 Python 3.12.0의 `code.replace()`와 comprehension 지역 변수 정보 문제로 보고된 [PyInstaller #7992](https://github.com/pyinstaller/pyinstaller/issues/7992)의 증상과 일치한다. [CPython #111866](https://github.com/python/cpython/pull/111866)은 관련 수정을 3.12 브랜치에 반영했고, [해당 이슈의 3.12.1 확인 댓글](https://github.com/pyinstaller/pyinstaller/issues/7992#issuecomment-1849304909)은 그 유지보수 버전에서 해결됐다고 기록한다. 이 근거에 따라 setup은 위 버전 조건을 사용하고 `scripts/build-backend.ps1`은 3.12.0으로 빌드하지 못하게 한다. 새 번들은 아래와 같이 별도 실제 실행으로 재검증했다.

**앱 전용 환경을 Python 3.12.13으로 교체했으며 시스템 Python은 변경하지 않았다.** 동결 실패를 소스 실행으로 대신 통과시키거나 Torch·SciPy·PyInstaller의 upstream 코드를 임시 패치하는 방식은 사용하지 않았다. 선택한 [Astral python-build-standalone 배포 파일](https://github.com/astral-sh/python-build-standalone/releases/download/20260510/cpython-3.12.13%2B20260510-x86_64-pc-windows-msvc-install_only_stripped.tar.gz)의 출처 정보는 다음과 같다. 공식 release 메타데이터와 이미 받은 로컬 파일의 크기·SHA256을 대조했다.

| 항목 | 값 |
| --- | --- |
| 파일 | `cpython-3.12.13+20260510-x86_64-pc-windows-msvc-install_only_stripped.tar.gz` |
| 크기 | `21921642`바이트 |
| SHA256 | `24168aff2e7d93784c6a436124c4ebb79b076a4e289bde4902c08333507b71d0` |

**Python 3.12.13으로 만든 백엔드 번들은 실제 준비 검사와 GPU 추론을 통과했다.** 준비 검사는 API `0.1.1`, Whisper·Nemotron·FFmpeg·FFprobe import와 정상 종료를 40.875초에 확인했다. 별도의 실제 CUDA Nemotron + turbo 분석은 39.484초에 완료됐고 정상 종료 코드 0과 포트 종료를 확인했다. 양쪽 모두 외부 Python·CUDA 경로가 없는 시스템 전용 `PATH`와 오프라인 환경을 사용했다. [portable 번들 증거](evidence/nemotron-bundle-validation.json) 및 [실행 기록](NEMOTRON-SMOKE.md)에 파일 해시와 결과 대조가 있다. 기존 소스 검증 JSON의 날짜·수치는 유지한다. v0.1.1 설치 EXE와 별도 데이터 파일 생성도 완료했으며, 파일 해시는 [설치 산출물 기록](NEMOTRON-SMOKE.md#v011-설치-파일)에 있다. 실제 설치·원격 업데이트는 실행하지 않았다.

### 고정 모델 캐시와 무결성

Nemotron 가중치는 다음 리비전으로 고정하며 Windows 사용자 캐시에 보관한다.

```text
%LOCALAPPDATA%/VOICESUBSEP/models/nemotron/f667ed73aee57d40cc39428eb768b4fd87a0a29e/
  config.json
  processor_config.json
  model.safetensors
```

- 모델 리비전: `f667ed73aee57d40cc39428eb768b4fd87a0a29e`
- `model.safetensors` 크기: `396954592`바이트
- 가중치 SHA256: `c074d86335b3b794f8fa5edc25594558f128bdb3914d27806a3a5a2e44963cb6`

모델 resolver는 가중치 크기와 SHA256을 검사하고, 두 JSON 설정의 모델 종류·화자 채널·특징 추출 형식도 검증한다. SHA 검증 결과는 같은 프로세스에서 파일의 크기·시간·식별자가 바뀌지 않은 동안만 재사용하며, 디스크의 완료 표시만 신뢰하지 않는다. 검증된 디렉터리를 processor와 model에 `local_files_only=True`로 전달한다.

온라인 첫 분석에서 없거나 손상된 파일만 고정 리비전의 일반 파일로 준비하며, 미완성 모델을 실행하지 않는다. 다운로드가 중단되면 부분 파일을 보존해 재시도할 수 있다. 캐시는 앱 설치 폴더 밖에 있으므로 앱 업데이트와 분리된다. 관리자 권한이나 Windows 개발자 모드를 요구하는 symlink 저장 경로를 사용하지 않는다.

오프라인 실행은 `HF_HUB_OFFLINE=1` 또는 `TRANSFORMERS_OFFLINE=1` 상태에서 완전하고 검증 가능한 캐시가 있어야 한다. 빠지거나 손상된 파일이 있으면 파일 이름과 캐시 경로를 표시하고 실패하며, 네트워크 다운로드로 전환하지 않는다. 짧은 두 음성 검증 절차는 [Nemotron 스모크 안내](NEMOTRON-SMOKE.md)에 있다. 준비된 합성 WAV와 실제 모델 실행 결과는 구별한다.

### 파일 분석 순서와 화자 전환 기반 전사

선택한 트랙을 16 kHz mono PCM16으로 준비한 뒤 **Nemotron을 먼저 실행하고 해제한 다음 Whisper를 적재한다.** Nemotron은 FP32를 사용하며, 한 파일 안에서 같은 화자 캐시를 이어 간다. 업로드된 파일에는 이후 음성이 이미 있으므로 1초 low-latency 프리셋 대신 고정 모델의 offline 설정값을 사용하는 `file` 프리셋을 적용한다. 청크 길이 340 + 오른쪽 문맥 40 encoder 프레임은 약 30.4초 문맥이며, FIFO 길이는 40, 화자 캐시 갱신 주기는 300이다. processor가 정하는 정렬·추가 샘플과 마지막 청크 처리를 유지하면서 청크마다 취소를 확인한다.

`speaker_change_clips`는 단독 활동 화자가 바뀌는 지점을 전사 구간 경계로 사용한다. 경계는 이전 단독 구간의 끝과 다음 단독 구간의 시작 사이 중간에 잡으며, 0.5초 미만 조각이 생기는 경계는 합친다. **구간들은 원본의 0초부터 끝까지 모두 덮는다.** 무음·겹침·Nemotron이 놓친 음성도 전사 입력에 남고 시간이 당겨지지 않는다. 이것은 음성 분리나 화자별 음성 추출이 아니다.

Whisper에는 이 구간을 `clip_timestamps`로 전달한다. `language=auto`는 언어를 고정하지 않고 `multilingual=True`로 실행하며, 이전 전사 문맥을 다음 구간에 강제로 이어 붙이지 않는다. 단어 시간과 화자 활동을 연결해 자막을 배정한다. 공식 `extract_speaker_dict`의 `Start`, `End`, `Speaker`를 사용하며, 최종 활동 시간 간격은 mel hop/sample rate에 따른 10 ms다. 내부 encoder의 80 ms를 최종 출력 프레임 시간으로 오인하지 않는다. 표준 모드도 겹침 정보를 보존하며 동시 활동에 걸친 단어는 인물을 강제 배정하지 않고 검수 대상으로 남긴다.

고정 커밋의 processor 소스: <https://github.com/huggingface/transformers/blob/4b28d51d0d5f17ec20c23a187d0475a8e68810c8/src/transformers/models/nemotron3_diarization/processing_nemotron3_diarization.py>

## 원본 시간·트랙·자원

- UI의 오디오 트랙 번호는 FFprobe 전역 stream index다. FFmpeg는 선택한 한 트랙만 매핑한다.
- 선택한 트랙 안의 다채널은 분석용 mono로 변환하고 결과 경고에 기록한다. 다른 트랙을 함께 섞지 않으며 원본 파일은 수정하지 않는다.
- `-copyts -start_at_zero` 및 resampling의 `first_pts=0`으로 지연된 오디오와 무음 구간을 원본 재생 시간축에 유지한다.
- 예상 인원 1·2·3명은 정확한 수와 비교하고, 숫자 4는 '4명 이상'을 뜻한다. 4명 이상 설정에서 검출된 5~8명은 모두 보존하고 인원 불일치 표시를 하지 않는다. 4명 미만은 불일치 표시하며 8채널을 모두 사용한 경우의 별도 검수 경고는 유지한다.
- Nemotron의 한 번에 처리하는 문맥은 위 청크 크기로 제한하지만, 현재 CPU 메모리에는 선택 오디오의 전체 float32 파형과 출력 활동값을 보관한다. 긴 파일의 메모리·시간과 화자 유지 품질은 별도 측정해야 한다.
- 취소는 추출 subprocess를 종료하거나 모델 처리 청크/Whisper segment 경계에서 처리한다. 진행 중인 가중치 다운로드나 한 번의 native 모델 호출을 강제로 끊지는 못한다. 취소 요청 후 처리 완료까지 시간이 걸릴 수 있다.
- 중간 WAV는 임시 폴더에서 처리하고 성공·실패·취소 모두 정리한다.

## 검증 범위

2026-09-24 이 PC의 NVIDIA GeForce RTX 3080 Ti, VRAM 12288 MiB(12 GB), 드라이버 616.56에서 **large-v3와 large-v3-turbo의 실제 CUDA FP16 전사를 완료했다.** 입력은 14초 영어 합성 음성이며 결과·실행 조건은 [GPU·데스크톱 검증 기록](GPU-DESKTOP-VALIDATION.md)에 있다. 한국어·다중 화자·설치본 실행 검증과 구별한다. 이전 CPU tiny 기록은 [MODEL-SMOKE.md](MODEL-SMOKE.md)에 보존했다.

같은 날 실제 소스 실행에서 **Nemotron → large-v3-turbo, 언어 auto, CUDA, 오프라인 캐시**로 39.466625초의 한국어·영어 두 합성 음성을 분석했다. 총 경과 시간 24.265초, 검출 화자 2명, 자막 24개·화자 배정 12개·겹침 검수 4개였고 실행·시간·화자 교대·자막 배정의 7개 검사가 모두 통과했다. 새 백엔드 번들의 별도 GPU 분석에서도 동일한 자막·단어 시간·화자 목록·길이를 확인했으며 실행 모드에 따른 안내 경고 한 줄만 달랐다. 입력 SHA256, 이전 실패 기록, 정확한 검사 범위와 JSON·로그는 [Nemotron 검증 기록](NEMOTRON-SMOKE.md)에 있다. 각 경과 시간은 로드 등을 포함한 한 번의 관측값이며 속도 보장이 아니다. 백엔드 번들 성공과 설치 프로그램 생성·설치 검증을 구분한다.

합성 interval 테스트는 화자 연결·겹침 보존·시간 유지·취소를 검증하며 모델 품질을 증명하지 않는다. 작은 FFmpeg fixture는 지연 트랙의 시간과 전역 트랙 선택을 검증한다. 실제 한국어 예능·게임·토론의 누락률, 화자 오류, 수정 시간은 연구 문서의 동일 자료 비교로 검증해야 한다. **v0.1은 겹친 목소리를 분리하거나 누락된 두 번째 대사를 복원하지 않는다.**

Whisper 가중치와 faster-whisper 코드는 각 upstream MIT 조건, Nemotron 가중치는 공식 카드의 OpenMDW-1.1 조건을 따른다. 모델을 앱과 함께 재배포할 때는 실제 포함한 버전의 라이선스를 따로 확인한다.
