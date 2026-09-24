# GPU 및 데스크톱 검증 기록

이 문서는 **v0.1.0의 Whisper 단독 GPU·데스크톱 검증**을 보존한 기록이다. v0.1.1의 Nemotron 포함 분석과 설치형 엔진 검증은 [Nemotron 검증 기록](NEMOTRON-SMOKE.md)을 따른다.

검증일: 2026-09-24. 기존 [CPU tiny 기록](MODEL-SMOKE.md) 이후의 변경이다.

## 이번 구현

- 참가자는 1 / 2 / 3 / 4명 이상이다. 저장 형식의 숫자 4는 최소 4명을 뜻하며, 5~8명이 검출되어도 4명으로 줄이거나 인원 불일치로 처리하지 않는다. Nemotron의 8채널 한계는 그대로다.
- 기본 모델은 large-v3, 빠른 분석 선택지는 large-v3-turbo다. GPU 준비 상태를 조회하고 CUDA FP16을 우선 사용한다. CPU 전환은 화면에 이유를 표시하며, 실행 중 오류를 묵시적 CPU 재시도로 숨기지 않는다.
- Windows GPU DLL은 앱 프로세스 안에서 등록한다. 시스템 PATH·보안 설정을 바꾸지 않았다.
- Windows의 HF 동시 다운로드에서 발생한 symlink 권한 오류를 피하려고 신규 모델은 사용자 폴더의 일반 파일로 저장한다. 완성된 기존 HF 캐시는 읽기 재사용한다.
- Electron의 설치형 실행 구조와 명시적 확인·다운로드·재시작 업데이트 UI를 추가했다. 자세한 경로 및 배포 조건은 [DESKTOP.md](DESKTOP.md)를 따른다.

## 실제 GPU 실행

장치: NVIDIA GeForce RTX 3080 Ti 12 GB, 드라이버 616.56. Python 3.12, faster-whisper 1.2.1, CTranslate2 4.8.2. 앱 전용 가상환경의 CUDA 12 cuBLAS와 cuDNN 9를 사용했다.

입력은 Microsoft Zira로 생성한 14.0225초 영어 음성이다. 실제 방송이나 한국어 품질 평가용 자료가 아니다. 음성은 외부로 업로드하지 않았다. `scripts/gpu-smoke.py`로 앱의 실제 분석 함수를 호출했다.

| 모델 | 연산 | 결과 | 실행 전체 시간 |
| --- | --- | --- | --- |
| large-v3 | CUDA FP16 | 3개 자막, 25개 word 항목, 유효한 시간 범위 | 12.703초 |
| large-v3-turbo | CUDA FP16 | 3개 자막, 25개 word 항목, 유효한 시간 범위 | 75.360초 |

시간에는 모델 준비·다운로드·로딩·전처리가 섞여 있다. large-v3는 앞선 실패 때 받은 가중치를 재사용했고 turbo는 처음 받았으므로, 이 수치로 두 모델의 추론 속도를 비교할 수 없다. 단어 항목 수는 토큰 분할 방식의 결과이며 원문 단어 수와 같다는 주장이 아니다.

large-v3 출력:

> hello this is a local subtitle test alice speaks first bob answers second the meeting starts at nine please check the words and the timing

turbo 출력:

> Hello. This is a local subtitle test. Alice speaks first. Bob answers second. The meeting starts at 9. Please check the words and the timing.

화자 구분은 끄고 실행했으므로 모든 자막은 미배정으로 남겼다. GPU 전사 성공이 Nemotron 실행, 다중 화자 정확도, 실시간 성능을 증명하지 않는다.

## 자동 검사와 화면 확인

- 백엔드 pytest: 127개 통과.
- 자막 도메인 Vitest: 35개 통과.
- 개발 런처 Node 테스트: 7개 통과.
- 데스크톱 Node 테스트: 22개 통과. 설치 전 서버 종료, 종료 확인 실패 시 설치 차단, 설치 실패 후 서버 복구를 포함한다.
- TypeScript 및 Vite production build 통과.
- 브라우저에서 4명 이상 선택, RTX 3080 Ti 표시, large-v3/GPU 기본값 확인.
- 실제 Electron 두 번 실행: 임의 포트 변경 후 localStorage 유지, custom scheme 요청·한글 multipart 업로드·sandbox preload 브리지 확인. 전달된 Origin이 `voicesubsep://app`이고 CSP를 보존하는지 확인했다. 이 검증은 격리된 임시 프로필을 사용했다.

## 패키징과 남은 검증

PyInstaller의 독립 백엔드 번들 생성은 성공했다. 외부 Python·FFmpeg·CUDA 경로를 제거하고 PATH를 Windows/System32와 Windows로만 제한한 별도 프로세스에서 `/api/health`를 확인했다. 포함된 Whisper import, FFmpeg/FFprobe 발견, RTX 3080 Ti 및 CUDA DLL 준비 상태가 모두 성공했고, 세션 토큰으로 종료를 요청해 exit 0과 포트 닫힘을 확인했다. 모델 추론은 이 번들 확인에서 실행하지 않았다.

빌드의 onnxruntime 양자화 모듈 관련 선택적 onnx 누락 경고 및 tzdata 경고를 보존했다. 현재 기동·import 확인은 통과했으나 번들의 실제 추론 전체 검증은 별도다. NVIDIA·FFmpeg 원본 고지 등 7개 파일은 번들에 포함해 SHA256 일치를 확인했다.

Windows x64 NSIS 설치 파일 생성도 종료 코드 0으로 완료했다. 로컬에 준비된 Electron·NSIS·7zip을 사용했고, 빌드의 외부 다운로드 경로는 loopback으로 제한했다. 패키지 안의 데스크톱 실행 코드 6개와 백엔드 실행 파일이 검증한 원본과 일치한다. 이번 산출물은 서명하지 않은 개발용 설치본이며, 업데이트 feed는 미설정이다. 실제 설치·제거는 수행하지 않았다.

| 산출물 | 바이트 | SHA256 |
| --- | ---: | --- |
| `release/VOICESUBSEP-0.1.0-Setup-x64.exe` | 1,412,643,775 | `bf442110212678ac5e3c011fbc47966a96d33e5f62323cf58e5f6ead73ac9f00` |
| `release/VOICESUBSEP-0.1.0-Setup-x64.exe.blockmap` | 1,467,421 | `8481a0462ae7752695bbe83c4eb9e7d8bfaf19147ffe5c9983df239ae8a64f64` |
| `build/backend/voicesubsep-server/voicesubsep-server.exe` | — | `dbaef3ad6eed140f1e7f32c8d25337af70c1c580805a54d4a16fa4ff9a23fca3` |

오프라인 실제 추론을 재검증할 때는 캐시된 모델과 명시적으로 준비한 영어 WAV를 사용한다. 이 명령은 GPU를 점유한다.

```powershell
.venv\Scripts\python.exe scripts/bundled-backend-smoke.py --source <spoken-english.wav>
```

위 스크립트는 `HF_HUB_OFFLINE=1`을 설정해 모델을 추가 다운로드하지 않으며, 격리된 임시 데이터로 업로드·전사·시간 범위·정상 종료를 점검한다.

아직 확인하지 않은 범위:

- NSIS 설치본의 실제 설치·제거 및 다른 PC 실행.
- 서명된 배포 서버에서 업데이트 확인·다운로드·교체·데이터 보존의 전체 과정. 현재 feed는 미설정이다.
- 한국어, 게임 효과음, 동시 발화, 긴 파일의 품질·최대 VRAM·지연.
- Nemotron GPU 실행, 라이브 입력/출력 캡처, 회의록 생성, 영상 컷·오디오 믹스.

생성된 모델·미디어·빌드 산출물은 Git에 넣지 않는다. 재실행 명령은 [MODEL-SETUP.md](MODEL-SETUP.md)와 [DESKTOP.md](DESKTOP.md)를 참고한다.
