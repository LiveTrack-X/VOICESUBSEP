# 로컬 GPU와 큰 Whisper 모델 선택

조사일: 2026-09-24. 목적은 **로컬 GPU에서 large-v3 또는 large-v3-turbo를 사용하는 방향**을 정리하는 것이다. 이 문서는 모델 비교 조사이며 후속 구현의 실제 GPU 실행 결과는 [GPU·데스크톱 검증 기록](GPU-DESKTOP-VALIDATION.md)에 따로 기록한다. 한국어 및 동시 발화 품질은 아직 검증하지 않았다.

## 모델과 실행 패키지의 차이

| 이름 | 역할 | 이 앱과의 관계 |
| --- | --- | --- |
| Whisper large-v3 | OpenAI의 큰 다국어 전사 모델. large 계열 약 15.5억 파라미터 | 현재 모델 설정 `large-v3`로 선택하는 가중치 |
| Whisper large-v3-turbo | large-v3를 줄이고 추가 학습한 약 8.09억 파라미터 모델. decoder 32층을 4층으로 축소 | 앱 설정 `large-v3-turbo`; 이전 `turbo` 값도 정규화하여 지원 |
| faster-whisper | Whisper 가중치를 CTranslate2로 실행하는 Python 라이브러리 | 현재 앱의 실제 전사 엔진 |
| Faster Whisper XXL | Purfview의 독립 실행형 전사 프로그램. 모델 선택과 추가 처리 기능을 제공 | 별도 실행기 후보. large-v3보다 큰 `XXL`이라는 모델을 뜻하지 않음 |

크기와 속도 비교는 [OpenAI Whisper README](https://github.com/openai/whisper#available-models-and-languages), turbo의 구조는 [OpenAI large-v3-turbo 모델 카드](https://huggingface.co/openai/whisper-large-v3-turbo), CTranslate2 실행 방식은 [SYSTRAN faster-whisper](https://github.com/SYSTRAN/faster-whisper)에 근거한다.

Purfview는 Python 환경을 따로 구성하지 않고 실행하는 CLI 배포를 제공하며, XXL에는 여러 VAD 방법·보컬 추출 전처리·화자 구분 등의 추가 기능이 있다고 설명한다. 공개 사용 예에도 `--model medium`, `-m turbo`처럼 **실행기 안에서 모델을 선택**한다. 따라서 큰 모델을 쓰기 위해 현재 앱을 XXL로 교체할 필요는 없다. 이 앱은 이미 faster-whisper를 사용하므로 GPU 의존성과 해당 가중치를 준비하면 large-v3/turbo 경로를 검증할 수 있다. [Purfview 공식 저장소](https://github.com/Purfview/whisper-standalone-win)

XXL을 비교 후보로 넣는다면 같은 원본·모델·언어·전사 옵션으로 평가한다. VAD나 전처리의 차이가 결과에 영향을 주므로 출력이 달라졌다고 모델 자체가 개선되었다고 판단하지 않는다. 보컬 추출 기능도 동시 발화자의 대사를 각각 복원한다는 보장이 아니다. 이 조사는 XXL 실행파일을 내려받거나 개별 기능을 시험하지 않았다.

## Windows GPU 의존성

SYSTRAN의 현행 안내는 CTranslate2 GPU 실행에 **CUDA 12용 cuBLAS와 CUDA 12용 cuDNN 9**를 요구한다. Windows 경로로는 Purfview가 제공하는 라이브러리 아카이브를 안내하며 DLL을 프로세스에서 찾을 수 있는 `PATH`에 두도록 설명한다. 같은 README의 NVIDIA 라이브러리 `pip` 설치 예시는 **Linux 전용**이므로 그대로 Windows 설치 절차로 옮기지 않는다. 구형 CUDA/cuDNN용 CTranslate2 버전 고정도 문서에 있으나, 이 프로젝트에서는 우선 현행 조합을 검증하는 방향이다. [SYSTRAN GPU 요구 사항](https://github.com/SYSTRAN/faster-whisper#gpu)

설정과 검증은 다음 순서로 진행한다.

1. 실행 중인 서버의 Python 환경과 faster-whisper/CTranslate2 버전을 확정한다.
2. NVIDIA GPU·드라이버 상태와 사용할 CUDA/cuDNN 런타임 위치를 확인한다. 드라이버가 표시하는 CUDA 지원 정보, Python import 성공, 실제 CUDA 연산 성공을 각각 구분한다.
3. 필요한 DLL을 서버 프로세스에 한정해 제공하고, 서로 다른 버전이 섞이지 않게 한다. 시스템 전체 `PATH`를 임의로 바꾸기 전에 프로젝트 실행 경로에서 관리하는 방식을 우선 검토한다.
4. 선택한 가중치를 준비한 뒤 실제 짧은 파일로 GPU 전사를 끝까지 실행한다. 장치명·모델 식별자·정밀도·실행 버전·처리 시간·출력 자막을 기록한다.

이 앱은 조사 시점의 코드에서 `device="cuda"`에 `compute_type="float16"`, CPU에 `int8`을 사용한다. GPU 오류를 작은 모델이나 CPU로 조용히 바꿔 성공 처리하지 않는다. 사용자의 GPU 우선 선택을 유지하면서 설치 오류·메모리 부족을 설명해야 한다. GPU 전사와 Nemotron의 PyTorch 실행 환경은 별개로 확인한다.

faster-whisper 자체는 PyAV로 오디오를 읽지만, VOICESUBSEP은 트랙 선택·원본 시간 보존에 FFmpeg/ffprobe를 직접 사용하므로 이 두 실행파일은 계속 필요하다. 앱의 현재 구현 확인은 `backend/voicesubsep/inference.py`와 [모델 환경 문서](MODEL-SETUP.md)를 기준으로 한다.

## large-v3와 turbo의 선택

| 용도 | 우선 검토할 모델 | 판단 근거와 한계 |
| --- | --- | --- |
| 편집용 최종 자막, 품질 우선 비교 기준 | `large-v3` | 사용자가 원하는 큰 모델을 기준으로 결과를 검수한다. 모든 한국어 구간에서 turbo보다 정확하다는 실측 주장은 아니다. |
| 빠른 초안, 긴 녹화의 반복 수정 | `turbo` | OpenAI가 속도 향상과 소폭의 정확도 저하를 설명하는 경량화 모델이다. 실제 수정 시간이 얼마나 줄어드는지는 비교해야 한다. |
| 한국어 겹침 발화 | 둘 다 동일 자료로 비교 | 모델 크기만 바꿔 두 목소리를 모두 복원하거나 인물 귀속까지 해결한다고 보지 않는다. 기존 겹침·미지정 검수 흐름을 유지한다. |

OpenAI의 참조 표는 large 계열 약 **10 GB**, turbo 약 **6 GB**, turbo 상대 속도 약 **8배**를 제시한다. 속도 측정 조건은 **A100에서 영어 음성을 처리한 경우**이며, 이 메모리·속도 수치는 현재 앱의 CTranslate2 실행에서 측정한 값이 아니다. RTX 3080 Ti 12 GB에서 같은 숫자나 배수를 보장할 수 없다. 언어·배치 크기·beam 크기·단어 시간 추출·다른 GPU 프로그램에 따라 달라진다. [OpenAI 참조 표와 조건](https://github.com/openai/whisper#available-models-and-languages)

SYSTRAN README의 대표 GPU 비교도 RTX 3070 Ti의 **large-v2** 등을 사용한 별도 조건이다. 해당 메모리 수치를 large-v3/turbo의 이 PC 실측값으로 기재하지 않는다. 같은 설정으로 비교하라는 공식 안내에 따라 모델 로딩·최초 다운로드 시간과 순수 전사 시간을 나눠 기록한다. [SYSTRAN 비교 조건](https://github.com/SYSTRAN/faster-whisper#comparing-performance-against-other-implementations)

12 GB 환경의 초기 계획은 **한 모델씩 적재, 배치 확대 없이 FP16 검증, Whisper 종료 후 화자 모델 실행**이다. 메모리가 부족하면 배치·동시 점유를 먼저 확인하고 GPU `int8_float16` 같은 선택은 별도 품질 비교 후 도입할 수 있다. 이 정밀도는 faster-whisper가 지원하지만 조사 시점 앱의 선택 옵션에는 없다. [SYSTRAN 사용 예](https://github.com/SYSTRAN/faster-whisper#faster-whisper)

turbo를 영어 번역용 모델로 설명하지 않는다. OpenAI README는 번역 작업으로 학습되지 않았다고 명시한다. 이번 용도인 한국어 음성의 한국어 자막 생성과 다른 요구다. [OpenAI 작업별 안내](https://github.com/openai/whisper#command-line-usage)

## 라이선스에서 확인한 범위

- OpenAI는 Whisper 코드와 모델 가중치가 MIT라고 명시하며, turbo 모델 카드에도 MIT가 표시된다. SYSTRAN faster-whisper 저장소도 MIT다. 실제 배포 시 사용하는 버전의 라이선스와 고지 파일을 보관한다. [OpenAI 라이선스 설명](https://github.com/openai/whisper#license), [SYSTRAN 저장소](https://github.com/SYSTRAN/faster-whisper)
- Purfview의 공개 저장소 루트와 README에서는 **XXL 실행파일 전체에 적용되는 명시적 재배포 조건을 이번 조사로 확인하지 못했다.** 공개 다운로드 가능 여부를 앱에 묶어 재배포할 권한의 확인으로 간주하지 않는다. 실행 아카이브 내부 고지와 포함 의존성·추가 모델별 조건은 아직 조사하지 않았다. [Purfview 공개 안내](https://github.com/Purfview/whisper-standalone-win)
- 같은 저장소는 XXL Pro를 후원자용 비공개 버전으로 구분한다. 공개 XXL과 Pro의 접근·배포 조건을 동일하게 취급하지 않는다. CUDA/cuDNN DLL도 Whisper의 MIT 범위에 포함된다고 가정하지 않는다. XXL·GPU 라이브러리의 앱 동봉 재배포는 이번 문서에서 승인하거나 확정한 사항이 아니다.

현재 통합 방향은 **faster-whisper를 유지하면서 large-v3/turbo의 로컬 CUDA 실행을 검증**하는 것이다. XXL은 별도 프로그램 비교나 향후 외부 실행기 연결 후보로 남긴다. 두 경로가 사용할 수 있는 모델은 겹치므로 엔진 이름만으로 한국어 자막 품질의 우열을 정하지 않는다.

## 다음 실측에서 남길 결과

같은 한국어 자료에서 large-v3와 turbo를 실행하고, 설치·모델 준비 성공과 인식 품질을 나누어 기록한다. 짧은 정상 대화, 게임 효과음, 짧은 리액션, 겹침 구간을 포함해 원문 기준 오인식·누락·중복, 자막 시간 오류, 검수 소요 시간을 비교한다. 처리 시간·최대 VRAM·실패·취소 동작도 함께 기록한다. 숫자를 얻기 전에는 한국어 품질이나 실시간 처리가 검증되었다고 표시하지 않는다.
