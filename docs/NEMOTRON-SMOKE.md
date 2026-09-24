# Nemotron 로컬 검증 기록

2026-09-24 실제 소스의 **Nemotron → large-v3-turbo 전사 → 화자별 자막 배정**이 두 합성 음성 입력에서 7개 검사를 통과했다. 이후 **Python 3.12.13 동결 백엔드 번들도 오프라인 CUDA 분석과 정상 종료를 완료했다.** v0.1.1 설치 실행 파일과 별도 데이터 파일도 생성했다. 실제 한국어 방송 품질과 사용자 PC의 설치·업데이트 검증은 별개다.

GitHub 검토용 [이식 가능한 검증 JSON](evidence/nemotron-source-validation.json)에 직접 실행·UI 결과의 날짜, 수치, 전체 검사와 각 독립 발화 구간 결과, 입력 SHA256, 기록된 패키지 버전과 모델 리비전을 보존했다. 원본 두 JSON과 값을 자동 대조했으며 절대 로컬 경로·원문 대사는 제외했다. 아래 `tmp/` 링크는 이 PC의 전체 원본 산출물이다. UI 원본에 없는 시작 시각·패키지 버전은 추정해 채우지 않았다.

새 [번들 검증 JSON](evidence/nemotron-bundle-validation.json)은 번들 준비 검사·실제 GPU 분석·실행 파일 해시·소스와의 결과 대조를 별도로 담는다. 기존 source/UI 검증 JSON은 변경하지 않았다.

## 입력

`scripts/nemotron-smoke.py --prepare-only`는 Windows에 이미 설치된 서로 다른 SAPI 음성 두 개로 16 kHz mono PCM16 WAV를 만든다. 이 PC에서는 Microsoft Heami Desktop(한국어)과 Microsoft Zira Desktop(영어)을 확인했다. 음성을 스피커로 재생하거나 외부로 전송하지 않으며, 음성 패키지를 다운로드하지 않는다.

6개의 독립 발화 구간은 A/B/A/B/A/B로 교대한다. 그 사이에는 두 음성이 겹치는 짧은 구간을 넣는다. 원본 혼합 WAV와 A/B 개별 WAV, 정확한 배치 시각·음성 이름·원문·SHA256을 담은 truth JSON을 `tmp/`에 보관한다. 발화 내부의 무음까지 포함한 배치 시각이므로 정밀 음소/VAD 라벨과는 다르다.

이 PC에서 준비한 입력 길이는 39.466625초이며, 계획된 동시 발화는 23.7299375~28.0360625초(4.306125초)다. 파일은 `tmp/nemotron-two-voices.wav`, `tmp/nemotron-two-voices.truth.json`, 그리고 `-speaker-A.wav`·`-speaker-B.wav`다. 혼합 WAV의 SHA256은 `1a3830cc56d943ea8b1939646f412b203ad12a7b51c8fc5337515e64accad7e7`이다. 아래 실제 실행들은 이 입력을 사용했으며 통과를 위해 fixture나 검사 기준을 바꾸지 않았다.

입력을 새로 만들 때만 다음 명령을 사용한다. 기존 결과와 비교할 때는 생성된 WAV·truth를 그대로 사용한다.

```powershell
.\.venv\Scripts\python.exe scripts/nemotron-smoke.py --prepare-only
```

## GPU 실행 — 명시적으로 선택

방송 등 GPU 사용 작업이 없는 때 실행한다. 기본 setup에 포함되는 Torch·Transformers·librosa 실행 환경과 Nemotron 가중치, 전체 분석에 선택한 Whisper 모델 가중치가 먼저 준비되어 있어야 한다. [모델 설치 절차](MODEL-SETUP.md)를 따른다. 스크립트는 `HF_HUB_OFFLINE=1`, `TRANSFORMERS_OFFLINE=1`을 설정하므로 실행 중 가중치를 다운로드하지 않는다.

```powershell
# 실제 앱의 Nemotron 함수만 실행
.\.venv\Scripts\python.exe scripts/nemotron-smoke.py --mode diarize --output tmp/nemotron-diarize-smoke.json

# 실제 앱의 Nemotron 화자 분석 → turbo 전사 → 자막 배정
.\.venv\Scripts\python.exe scripts/nemotron-smoke.py --mode analyze --whisper-model large-v3-turbo --language auto --output tmp/nemotron-turn-guided-rerun.json

# 같은 입력으로 Whisper 모델만 비교하고 결과 파일을 분리
.\.venv\Scripts\python.exe scripts/nemotron-smoke.py --mode analyze --whisper-model large-v3 --language auto --output tmp/nemotron-large-v3-rerun.json
```

`--whisper-model` 기본값은 `large-v3-turbo`, `--language` 기본값은 `auto`다. 이 선택값을 JSON의 `whisperModel`, `language`에 기록한다. 두 인자는 전체 분석 모드에 적용되며 `diarize` 단독 모드는 Whisper를 실행하지 않는다.

전체 분석 모드의 관찰 함수는 실제 `_diarize`를 한 번 호출하고 반환 활동 구간을 기록한다. 결과를 바꾸거나 재현 데이터로 대체하지 않는다. 현재 앱은 Nemotron을 먼저 실행해 화자 캐시를 유지하고, 모델 해제 후 화자 전환 지점으로 나눈 전체 음성을 Whisper에 전달한다. `file` 프리셋은 340+40 encoder 프레임(약 30.4초), FIFO 40, 캐시 갱신 주기 300을 사용한다. `speaker_change_clips`의 구간은 겹침·무음·미검출 음성을 포함해 원본 전체를 보존하며, `auto`는 multilingual 전사를 사용한다. 구현 계약은 [모델 실행 환경](MODEL-SETUP.md#파일-분석-순서와-화자-전환-기반-전사)에 있다.

## 실제 소스 실행 결과

근거는 [실행 JSON](../tmp/nemotron-turn-guided-smoke.json)과 [서버 없는 직접 실행 로그](../tmp/nemotron-turn-guided-smoke.log)다. `tmp/`의 파일은 이 PC에서 생성한 로컬 검증 산출물이다.

| 항목 | 관측값 |
| --- | --- |
| 시작 | 2026-09-24 15:49:40 +09:00 |
| 모드 | `analyze`, CUDA, offline, `large-v3-turbo`, `language=auto` |
| 실행 환경 | Python `3.12.0`, PyTorch `2.11.0+cu128`, Transformers `5.18.0.dev0`, faster-whisper `1.2.1`, huggingface-hub `1.32.0` |
| 입력 / 전체 경과 시간 | 39.466625초 / 24.265초 |
| 실행·검사 결과 | `runtimeCompleted=true`, `passed=true`, 7개 검사 모두 통과 |
| 화자 | 2명; A → `speaker-1`, B → `speaker-2` |
| 자막 | 24개 중 화자 배정 12개, 미지정 12개; 겹침 검수 4개 |
| 검출 동시 활동 | 23.70–25.40초, 26.23–28.05초 |
| 계획 혼합 구간과 검출 겹침의 교집합 | 3.476125초; 계획 구간 점유율 약 80.73% |

전체 경과 시간에는 Python 모듈 준비·모델 적재·오디오 추출·추론이 포함되고, 가중치는 이미 캐시되어 있었다. 한 번의 관측값이며 처리 속도 보장이 아니다. 로그 시작에 Transformers의 `[ERROR] image_like_kwargs ...` 문서 검사 메시지가 있지만, 이어진 실제 모델 실행은 완료되었고 위 JSON의 검사 결과가 모두 참이었다. 이를 오류 메시지가 없는 실행으로 기록하지 않는다.

이전 실패도 보존했다. [초기 low-latency 화자 분석](../tmp/nemotron-diarize-smoke.json)은 2명과 겹침을 찾았지만 교대 일관성이 실패했다. 파일 문맥 설정을 적용한 [초기 전체 분석](../tmp/nemotron-analyze-smoke.json)과 [large-v3 비교](../tmp/nemotron-large-v3-smoke.json)는 화자 활동 검사는 통과했지만 자막의 교대 일관성이 실패했다. 현재 통과 기록은 모델 크기 변경만으로 얻은 결과가 아니라, Nemotron을 먼저 실행하고 전체 음성을 화자 전환 기준으로 전사하는 현재 경로의 결과다.

## 실제 UI에서 large-v3 분석·적용

같은 39.466625초 WAV를 실제 브라우저 탭에서 선택한 뒤 기본 large-v3, CUDA, 언어 auto, Nemotron 사용으로 분석을 시작하고 완료 결과를 편집기에 적용했다. 일반 대화 모드·참가자 2명·오디오 트랙 0 요청이며, 입력 SHA256은 위 turbo 실행과 같다. 근거는 [UI 실행 JSON](../tmp/nemotron-ui-large-v3-evidence.json), [완료 화면](../tmp/nemotron-ui-complete.png), [적용 후 편집기 상태](../tmp/nemotron-ui-applied.txt)다.

이 UI 검증도 기존 Python 3.12.0의 소스 서버에서 실행했다. 이후 앱 전용 Python을 교체하는 작업과 구분하며, 이미 기록된 추론 수치를 새 Python 환경의 결과로 다시 표시하지 않는다.

| 항목 | 관측값 |
| --- | --- |
| 실제 작업 시간 | 28.096215초 |
| 결과 | 화자 2명, 자막 26개 |
| 배정 | 인물 1에 6개, 인물 2에 6개; 총 12개 |
| 미지정·검수 | 14개 미지정, 그중 겹침 검수 4개 |
| 독립 발화 검증 | 같은 6개 A/B 교대 구간에서 자막의 우세 화자·30% 점유 기준 모두 통과 |
| UI 반영 | 완료 화면의 자막 26개·화자 2명 확인, 결과 적용 후 편집기 전체 26개·검수 필요 14개 확인 |

적용된 첫 한국어 자막 `안녕하세요. 오늘은`과 영어 자막 `Hello. I` 등 일부 시작 단어는 미지정으로 남았다. 겹침 구간도 강제 배정하지 않았다. 합성 대사의 전사 정확도가 완벽하다는 결과가 아니며 원본 재생과 수정이 필요하다. 이 검증은 실제 UI의 파일 선택→분석→완료→적용 연결과 화자 교대를 확인한다. 위 직접 실행 스모크의 7개 검사 결과나 완성된 번들 실행 증거로 바꿔 해석하지 않는다.

## 동결 번들 진단과 실제 GPU 재검증

Python 3.12.0으로 만든 PyInstaller 번들에서는 `torch._numpy._ufuncs`의 `name`과 `scipy.stats._distn_infrastructure`의 `obj`를 찾지 못하는 `NameError`가 관측됐다. 앞의 소스·UI 성공과 별도로 남기는 실패 기록이다. [PyInstaller #7992](https://github.com/pyinstaller/pyinstaller/issues/7992) 및 [CPython #111866](https://github.com/python/cpython/pull/111866)의 `code.replace()` 관련 문제와 증상이 일치하고, 이슈에는 [Python 3.12.1에서 수정됐다는 확인](https://github.com/pyinstaller/pyinstaller/issues/7992#issuecomment-1849304909)이 있다.

시스템 Python을 건드리지 않고 앱 전용 환경을 3.12.13으로 교체했다. setup의 새 환경은 3.12.13, 기존 환경은 3.12.1 이상·3.13 미만으로 제한하고 동결 빌드는 3.12.0을 거부한다. 사용한 Astral 배포 파일의 URL·크기·SHA256은 [모델 설치 문서](MODEL-SETUP.md#windows-동결-번들과-python-유지보수-버전)에 기록했다. 소스 실행 fallback이나 upstream 임시 패치를 적용하지 않았다.

새 번들에서는 [준비 검사 JSON](../tmp/bundled-runtime-check.json)과 [실제 GPU 스모크 JSON](../tmp/bundled-nemotron-turbo-smoke.json)이 모두 통과했다. 둘 다 독립 임시 데이터 폴더, 외부 Python·CUDA 경로를 뺀 Windows 시스템 전용 `PATH`, 오프라인 환경에서 실행했다. 실제 추론은 이미 준비된 모델 캐시를 사용했다.

| 항목 | 관측값 |
| --- | --- |
| 빌드 | Python `3.12.13`, PyInstaller `6.22.3`, API `0.1.1` |
| 준비 검사 | `passed=true`, `runtimePassed=true`, 40.875초; `inferenceRun=false` |
| 실제 추론 | `passed=true`, `analysisPassed=true`, 39.484초; Nemotron + `large-v3-turbo`, CUDA, auto, 참가자 2명 |
| 입력 | 동일 SHA256의 39.466625초 합성 WAV, 16 kHz mono |
| 생성 결과 | 화자 2명, 자막 24개, 시간 있는 단어 88개 |
| 배정·검수 | 각 화자 6개씩 총 12개 배정, 12개 미지정, 겹침 검수 4개 |
| 종료 | 두 검사 모두 종료 요청 확인, `clean=true`, `forced=false`, `exitCode=0`, 포트 닫힘 |
| 자식 CPU 스레드 설정 | `OMP_NUM_THREADS=2`, `MKL_NUM_THREADS=2` |

39.484초는 서버 시작·모듈 준비·업로드·모델 실행·종료를 포함한 전체 스모크 시간으로, 순수 추론 시간이나 소스 실행 24.265초와 같은 측정 범위가 아니다. 준비 검사 40.875초도 모델 추론 속도를 뜻하지 않는다.

표준 라이브러리로 원본 JSON을 비교한 결과, **번들의 모든 자막·단어 시간·확률·화자 배정·화자 목록·재생 길이는 소스 turbo 결과와 정확히 같았다.** 전체 result 객체는 동일하지 않다. 소스 요청은 overlap 모드, 번들 요청은 standard 모드여서 소스에만 겹침 모드 설명 경고 한 줄이 있고 나머지 경고는 같다. portable JSON은 `fullResultEqual=false`와 항목별 동일 여부를 함께 보존한다.

이미 생성된 배정 자막에 기존 `inspect_activity`를 적용한 비교에서도 6개 독립 발화의 A/B 교대와 30% 점유 기준을 모두 만족했다. 이 비교는 모델을 다시 실행하지 않았다. API 결과에는 원시 화자 활동이 없고 겹침 자막은 미지정이므로, 배정 자막만으로 원시 활동의 4개 검사를 재실행했다고 주장하지 않는다.

검증한 `voicesubsep-server.exe`는 **57,573,943바이트**, SHA256 **`04640c3d09c7e667f99896c45d7815d6deeeaec622539eff51bb32ca0f6110dd`**다. 실제 파일과 대조했으며 백엔드 디렉터리는 4,258개 파일·5,009,309,197바이트로 측정했다. 별도의 회귀검사는 backend 198개 + web 40개 + Node 32개, 총 270개가 통과했다. 이러한 검사 수를 실제 모델 품질 점수로 사용하지 않는다.

기존 source/UI 검증 수치는 그대로 보존했다. 설치 프로그램 생성 결과는 아래에 별도로 기록하며, 실제 설치나 원격 업데이트 성공을 의미하지 않는다.

## v0.1.1 설치 파일

Nemotron·CUDA를 포함한 단일 NSIS 빌드는 2,385,519,735바이트 압축 payload를 내장하는 과정에서 `failed creating mmap`으로 실패했다. 같은 압축 데이터를 공식 NSIS-web 형식으로 재사용했고, embedded blockmap을 붙인 최종 데이터 파일과 설치 EXE 생성은 종료 코드 0으로 완료했다. 설치 EXE와 `.nsis.7z`를 같은 폴더에 두고 EXE를 실행한다. 이 PC의 산출물 폴더는 `release/nsis-web/`다.

| 파일 | 바이트 | SHA256 |
| --- | ---: | --- |
| `VOICESUBSEP-0.1.1-Offline-Setup-x64.exe` | 694,537 | `42f57954540d3a9004a14824d90946aece5657df63ad16e4fd4dfef627199be0` |
| `voicesubsep-0.1.1-x64.nsis.7z` | 2,387,994,200 | `f804740967a0eb5a237026b00ce6be002ca01f87182278ce0c1e87e77737c0c2` |

설치 파일은 서명하지 않았고 업데이트 feed는 설정하지 않았다. 같은 폴더의 payload를 공식 SHA512 확인 경로로 사용하며, 기본본에 데이터 파일이 빠지면 외부 서버에서 대신 받지 못한다. 모델 가중치는 포함하지 않으며 이미 준비된 로컬 캐시를 사용한다. [데스크톱 빌드 절차](DESKTOP.md)의 `desktop:installer:split`으로 같은 형식을 만들 수 있다. 이 기록에서는 설치 EXE 실행·설치·원격 업데이트를 수행하지 않았다.

[설치 산출물 검증 JSON](evidence/nemotron-installer-validation.json)에 파일 해시와 검증 결과를 보존했다. 전체 payload의 `7z t`는 종료 코드 0과 `Everything is Ok`를 반환했다. `data after end` 경고는 electron-builder가 붙인 2,474,465바이트 embedded blockmap이며 trailer 길이와 deflate JSON을 직접 확인했다. 압축 내부의 백엔드 EXE 해시·4,258개 파일·총 바이트, app.asar, 웹 JS를 검증한 원본과 대조했다. 설치 EXE의 제품/파일 버전은 0.1.1이고 서명 상태는 `NotSigned`다. JSON 증거 파일은 체크섬 보존을 위해 Git의 줄바꿈 변환에서 제외한다.

## 검사 기준과 한계

JSON에는 실행 완료 여부, 원본 시간, 화자 활동, 자막 배정과 검수 정보가 남는다. 다음 7개 조건을 모두 충족해야 전체 분석의 `passed=true`가 된다. 기준은 이전 실패 기록과 동일하다.

| 검사 이름 | 의미 |
| --- | --- |
| `finiteSourceTimeIntervals` | 화자 활동이 존재하고 시작·끝 시간이 유한하며 원본 범위 안에 있음(끝의 0.1초 허용) |
| `exactlyTwoDetectedSpeakers` | 화자 활동에서 정확히 2개 ID 검출 |
| `soloTurnAlternationConsistent` | 익명 ID를 최적 대응한 뒤 독립 구간 6개의 우세 화자가 A/B 교대와 일치하고 각 구간 점유율이 30% 이상 |
| `overlapDetectedInsidePlannedMix` | 계획한 혼합 구간 안에서 최소 0.2초 동시 활동 검출 |
| `nonemptyCaptionText` | 생성 자막이 있고 비어 있지 않은 텍스트가 존재 |
| `captionSourceTimesValid` | 자막 시간이 유한하고 원본 범위 안에 있음(끝의 0.1초 허용) |
| `captionSoloTurnAlternationConsistent` | 실제 화자가 배정된 자막에서도 독립 구간별 우세 화자와 30% 점유 기준 충족 |

독립 구간 점유율은 배치 시각의 양끝 0.15초를 제외하고 계산한다. `diarize` 단독 모드는 앞의 4개만 검사한다. 모델이 끝까지 실행됐어도 기준을 만족하지 못하면 `runtimeCompleted=true`, `passed=false`로 기록한다. 자막의 모든 단어나 겹친 두 대사의 복원을 비교하는 검사는 아니다. 현재도 12개 자막은 미지정이며 사람이 원본을 보고 검수해야 한다.

두 음성은 합성이고 언어도 서로 다르다. 따라서 통과해도 실제 한국어 두 사람, 비슷한 목소리, 방송 효과음, 장시간 화자 유지, 현실의 동시 대화 정확도를 증명하지 않는다. 보고하는 시간 점유율은 DER/JER이나 단어 정확도가 아니다. v0.1은 겹친 음성을 분리하지 않으며 누락된 두 번째 대사도 복원하지 않는다. 실제 스트리머 자료의 누락률·화자 오류·편집 시간, 다른 PC의 실행 및 설치·업데이트는 별도 검증이 필요하다.
