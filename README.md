# VOICESUBSEP

영상 속 대화를 인물별 자막으로 정리하고, 원본을 보면서 자막과 편집 노트를 함께 수정하는 로컬 편집기입니다. 한국어 예능·게임·토론의 편집 작업을 목표로 개발 중인 **비공개 저장소의 초기 v0.1**입니다.

React 편집 화면과 Python FastAPI 분석 서버로 구성됩니다. 전사는 faster-whisper, 선택적 화자 구분은 NVIDIA Nemotron-3-Diarization을 사용합니다. 분석 서버는 내 컴퓨터의 `127.0.0.1`에서 실행하며 영상·음성을 외부 분석 API로 보내지 않습니다. 모델 파일이 없으면 첫 분석 때 Hugging Face에서 해당 모델을 내려받을 수 있습니다.

## 가능한 작업

- 영상·음성 열기, 원본 시간으로 탐색하며 자막의 내용·시간·인물 수정
- 예상 인원 1~4명 설정, 일반 대화 / 동시 발화 검수 모드 선택
- 오디오 트랙 선택 후 로컬 전사, Nemotron 설치 시 화자 활동 분석
- 동시 발화·인물 미지정·예상 인원 불일치 등을 검수 대상으로 확인
- 시간에 연결된 편집·하이라이트·자막·확인 노트 작성
- 프로젝트 JSON 저장·불러오기, 브라우저 자동 저장, 편집 실행 취소·다시 실행
- SRT 불러오기, 전체 SRT와 인물별 SRT 내보내기, 노트 Markdown·CSV 내보내기

처음에는 빈 프로젝트로 열립니다. 샘플 프로젝트는 사용자가 직접 열며, 업로드한 자료의 분석 결과를 대신하지 않습니다. 분석 결과는 사용자가 적용할 때 자막을 교체하고 기존 노트를 유지합니다.

## 먼저 알아둘 한계

**v0.1은 겹친 목소리를 분리하거나 가려진 두 번째 대사를 복원하지 않습니다.** 동시 발화 모드는 겹침 구간을 검수하기 위한 기능입니다. 여러 화자에게 동시에 걸치는 단어는 무리하게 한 사람에게 배정하지 않고 미지정으로 남깁니다. 화자 번호를 실제 인물 이름으로 바꾸는 작업은 직접 해야 합니다.

예상 인원 1~4명은 편집·검수 설정입니다. 모델이 실제로 그 인원을 정확히 구별했다는 뜻이 아니며, Nemotron이 더 많은 인물을 감지하면 강제로 합치지 않습니다. 한국어 예능·게임·토론의 정확도, 긴 영상 처리 시간, 12GB GPU에서의 실측 품질은 아직 검증하지 않았습니다. 합성 데이터 테스트 통과는 실제 모델의 정확도 보장이 아닙니다.

자동 저장은 현재 브라우저에 남습니다. 프로젝트 JSON에는 자막과 노트가 포함되지만 원본 영상은 포함되지 않으므로, 다시 열 때 원본을 연결해야 합니다. 중요한 작업은 JSON 파일로 따로 저장하세요. 브라우저에서 재생할 수 없는 영상 코덱은 분석 가능 여부와 별개입니다.

## Windows 설치

필수 프로그램을 먼저 설치하고 터미널에서 실행되는지 확인합니다.

- **Node.js 22.12 이상** 및 npm
- **uv**: Python 가상환경과 의존성 설치에 사용
- **FFmpeg와 FFprobe**: 둘 다 `PATH`에 등록되어 있어야 함

Python 3.12가 없으면 uv가 설치 과정에서 내려받을 수 있습니다. 설치 안내는 [Node.js](https://nodejs.org/), [uv](https://docs.astral.sh/uv/getting-started/installation/), [FFmpeg](https://ffmpeg.org/download.html)를 참고하세요.

저장소 루트 `VOICESUBSEP`에서 PowerShell로 실행합니다.

```powershell
# 사전 조건만 확인: 다운로드·설치 없음
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup.ps1 -Check

# .venv(Python 3.12), Python 패키지, npm 패키지 설치
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup.ps1

# 편집 화면과 분석 서버를 함께 실행
node scripts/dev.mjs
# 같은 실행: npm start
```

[http://127.0.0.1:5173](http://127.0.0.1:5173)을 엽니다. 종료는 실행한 터미널에서 `Ctrl+C`입니다. 한쪽 서버가 종료되면 실행기도 다른 서버를 종료합니다. 기존 `.venv`가 Python 3.12 환경이 아니면 설치 스크립트가 중단되며, 기존 환경을 자동 삭제하지 않습니다.

설치는 Whisper 실행 패키지를 포함하지만 **모델 가중치와 Nemotron 실행 환경은 설치하지 않습니다.** 먼저 화자 구분을 끄고 짧은 파일을 CPU의 `tiny` 또는 `base` 모델로 분석해 실행 환경을 확인할 수 있습니다. GPU/CUDA 및 Nemotron 설치 조건은 [모델 실행 환경](docs/MODEL-SETUP.md)을 참고하세요. 분석 화면의 엔진 표시와 `/api/health`는 클래스 import 가능 여부를 나타내며, 모델 가중치 준비·GPU 호환·정확도를 보장하지 않습니다.

## 사용 흐름

1. 영상 또는 음성을 열고 예상 인원과 대화 모드를 설정합니다.
2. 로컬 분석에서 오디오 트랙, 언어, Whisper 모델, CPU/GPU를 선택합니다.
3. 분석 완료 후 결과와 경고를 확인하고 적용합니다.
4. 인물 이름을 지정하고, 검수 대상 자막을 원본과 비교해 수정합니다.
5. 필요한 장면에 노트를 남기고 프로젝트 JSON, SRT, 편집 노트를 내보냅니다.

원본에 개별 마이크 트랙이 있으면 분석할 트랙을 직접 고를 수 있습니다. 현재 한 작업에서는 한 오디오 트랙을 선택하며, 여러 트랙을 인물별로 일괄 병합하는 기능은 없습니다. 한 트랙 안에서 이미 섞인 게임 채팅의 목소리를 개별 인물 트랙으로 복원하지는 않습니다.

## 개발 및 테스트

`npm run dev`는 편집 화면만 실행합니다. 두 서버를 한 번에 실행하려면 `node scripts/dev.mjs`를 사용합니다. 서버를 별도 터미널에서 실행할 수도 있습니다.

```powershell
.\.venv\Scripts\python.exe -m uvicorn voicesubsep.app:app --host 127.0.0.1 --port 8787
npm run dev
```

```powershell
# 편집 데이터 로직
npm test
npm run typecheck
npm run build

# API·검증·취소·화자 연결 및 FFmpeg 합성 fixture
.\.venv\Scripts\python.exe -m pytest backend\tests -q

# 개발 실행기의 실패·종료 처리
node --test scripts/dev.test.mjs
node scripts/dev.mjs --check
```

테스트는 실제 한국어 파일의 모델 추론이나 가중치 다운로드를 수행하지 않습니다. FFmpeg fixture 테스트에는 FFmpeg와 FFprobe가 필요합니다. Unix에서 직접 준비하는 경우 `.venv/bin/python`으로 가상환경을 만들고 `uv pip install --python .venv/bin/python -e './backend[whisper,test]'`, `npm ci`를 실행하면 같은 개발 실행기를 사용할 수 있습니다. 기본 설치 경로와 테스트 범위는 Windows를 기준으로 합니다.

분석 작업은 한 번에 하나씩 처리합니다. 같은 데이터 폴더로 백엔드 여러 개를 실행하거나 Uvicorn `--workers`·`--reload`를 사용하지 마세요. 취소는 모델 처리 경계에서 반영되므로 진행 중인 다운로드나 native 연산이 끝날 때까지 시간이 걸릴 수 있습니다. 중단된 작업은 서버 재시작 때 자동 재실행하지 않습니다.

## 로컬 데이터와 설정

원본 사본·메타데이터·작업 결과는 기본적으로 저장소의 `data/`에 저장되며 Git에서 제외됩니다. 실제 모델의 캐시는 Hugging Face 등 각 실행 라이브러리의 캐시 위치에 저장됩니다. 프로젝트 JSON을 내보내도 `data/`의 원본 사본이 자동 삭제되지는 않습니다.

| 환경 변수 | 기본값 | 의미 |
| --- | --- | --- |
| `VOICESUBSEP_DATA_DIR` | 저장소의 `data/` | 업로드·작업 저장 폴더 |
| `VOICESUBSEP_MAX_UPLOAD_BYTES` | `8589934592` (8 GiB) | 원본 한 파일의 업로드 한도 |

분석 전 업로드 사본과 추출 WAV를 위한 디스크 공간이 필요합니다. 저장 폴더를 정리할 때는 서버를 종료하고 필요한 원본·프로젝트를 먼저 보관하세요. 이 개발 서버는 인터넷 공개 배포용 구성이 아닙니다.

## 문서

- [제품 설계](docs/PRODUCT-DESIGN.md)
- [대안 및 동시 발화 처리 분석](docs/ALTERNATIVES-ANALYSIS.md)
- [모델 실행 환경과 검증 범위](docs/MODEL-SETUP.md)
- [v0.1 구현 계약·API](docs/IMPLEMENTATION-CONTRACT.md)
- [디자인 시스템](docs/design/DESIGN-SYSTEM.md)
- [구현·검증 상태와 알려진 한계](docs/DEVELOPMENT-STATUS.md)
- [실제 Whisper tiny 실행 기록](docs/MODEL-SMOKE.md)
- [컷 편집·오디오·인터뷰·회의록 확장 계획](docs/EXPANSION-ROADMAP.md)
- [라이브 입력·출력 오디오 캡처 설계](docs/LIVE-CAPTURE-PLAN.md)

기존 자막 프로그램의 소스를 복사하지 않고 새로 구현했습니다. 모델·라이브러리의 라이선스는 각 upstream 조건을 따르며, 모델 가중치는 저장소에 포함하지 않습니다.
