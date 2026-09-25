# RNNoise and VST3 preprocessing / 분석 전 RNNoise·VST3 체인

**Windows x64 VST3 효과**를 최대 4개까지 연결해 음성 인식 앞에서 처리한다. 원본 미디어와 미디어 내보내기 오디오는 바뀌지 않는다. 아래 잔여 지연 실측은 0.3.1 이후 개발본의 개선 사항이며, 설치본에 포함됐는지는 [현재 기능 상태](FEATURE-STATUS.md)와 버전별 릴리즈 기록을 따른다. 상용 VST3 플러그인은 설치본에 포함하지 않는다.

**0.3.3 source additions; not yet published or installed:** optional built-in RNNoise and native VST3 editors are implemented in the current source. The public 0.3.2 release is unchanged. See the [0.3.3 draft](releases/v0.3.3.md) for validation boundaries.

**0.3.3 개발 소스·아직 미게시/미설치:** 내장 RNNoise와 플러그인 전용 창을 추가했습니다. 기존 공개 0.3.2 파일은 바뀌지 않았으며 검증 범위는 [0.3.3 초안](releases/v0.3.3.md)을 확인합니다.

## RNNoise without a VST / VST 없이 RNNoise 사용

RNNoise is **off by default**. Enabling it starts at a **70% processed / 30% original mix**, adjustable from 0 to 100%. It runs on the CPU through FFmpeg `arnndn` and a pinned **302,903-byte Xiph RNNoise v0.1** model included with the application data. No plugin license, GPU or model download is needed for this filter. A/B preview and analysis can use RNNoise with an empty VST chain. With both enabled, the order is **RNNoise → VST slots**.

RNNoise는 **기본 꺼짐**이며 켤 때 처리음 70%·원본 30%로 시작하고 0~100%를 조절합니다. CPU의 FFmpeg `arnndn`과 앱 데이터에 포함하는 고정 **302,903바이트 Xiph RNNoise v0.1 모델**을 사용합니다. 이 필터에는 별도 플러그인 라이선스·GPU·실행 중 모델 다운로드가 필요 없습니다. VST 슬롯 없이도 A/B와 분석에 쓸 수 있으며 함께 사용하면 **RNNoise → VST 슬롯** 순서입니다.

The filter pads the tail, compensates its fixed **480-sample / 10 ms** algorithm delay, then checks the exact original frame count at 48 kHz. This preserves time alignment, not every speech sound: weak speech, laughter and overlap may be affected. Start with an original/processed A/B comparison. Default scope is **ASR only**; **ASR + diarization** is optional. Neither mode changes the original, final rendered audio or live capture. Model provenance and original redistribution terms are in [bundled notices](BUNDLED-NOTICES.md).

필터 끝을 패딩하고 고정 **480샘플·10ms** 지연을 보정한 다음 48kHz 원본과 샘플 수가 같은지 검사합니다. 시간축 보존이 약한 말소리·웃음·동시 발화의 보존이나 인식률 향상을 뜻하지는 않습니다. 원본/처리음 A/B로 먼저 확인하세요. 기본은 **음성 인식에만**, 선택 시 **음성 인식+화자 구분**에 적용합니다. 원본·최종 렌더 음원·라이브 캡처는 바꾸지 않습니다. 모델 출처와 원본 배포 조건은 [번들 고지](BUNDLED-NOTICES.md)를 따릅니다.

## Native plugin editor / 플러그인 전용 창

In 0.3.3 source, each installed effect can open its own GUI in an isolated worker. Use **Close and apply** to collect the plugin's opaque state plus exposed parameters; cancelling discards those changes. Saved native state is limited to **256 KiB decoded per slot** and is restored before explicit parameter overrides. The state is part of local VST settings/backups and may contain vendor preset or licensing information; treat exported settings as private.

0.3.3 소스에서는 각 효과의 전용 창을 별도 작업 프로세스로 열 수 있습니다. **닫고 적용**하면 플러그인의 내부 상태와 노출 매개변수를 받아 저장하고, 취소하면 변경을 적용하지 않습니다. 내부 상태는 슬롯당 디코딩 후 **256KiB**까지이며 복원 후 직접 지정한 매개변수를 적용합니다. 상태는 로컬 VST 설정과 설정 백업에 포함되고 제조사 프리셋·라이선스 정보가 들어갈 수 있으므로 백업 공유에 주의하세요.

The host attempts to keep its owned window/title bar within a Windows work area, and provides an explicit app-side close action. **Universal GUI scaling is not supported** by the hosting API: use a plugin's own zoom menu only if that plugin provides one. Window-position helper tests do not establish compatibility with every plugin/monitor. External vendor preset import, sidechains, automation, VST2/instruments and real-time VST processing remain outside scope.

호스트는 소유한 창·제목 표시줄이 Windows 작업 영역 안에 있도록 보조하고 앱 쪽 닫기 동작도 제공합니다. 호스트 API의 **범용 GUI 배율 조절은 지원하지 않으며**, 플러그인이 자체 배율 메뉴를 제공할 때만 그 메뉴를 사용합니다. 위치 보조 검사로 모든 플러그인·모니터 호환을 보증하지 않습니다. 제조사 프리셋 파일 가져오기·사이드체인·자동화·VST2/악기·실시간 VST는 범위 밖입니다.

## 사용

1. 영상 또는 음성 파일을 연결하고 **음성 분석**을 연다.
2. 분석할 오디오 트랙을 선택한 뒤 **VST3 사전처리 사용**을 켠다.
3. 설치된 VST3 목록에서 CLEAR 또는 RX Voice De-noise 등을 선택하고 **플러그인 확인 및 추가**를 누른다. 표준 경로 밖의 플러그인은 절대 경로를 직접 입력할 수 있다.
4. 슬롯의 **플러그인 매개변수**를 펼쳐 조절한다. 0.3.3 소스에서는 전용 창을 열어 조절한 뒤 닫고 적용할 수도 있다. 위·아래 버튼으로 순서를 바꾸고 각 슬롯을 우회하거나 삭제할 수 있다.
5. 비교 시작 위치와 길이(최대 30초)를 정하고 **원본 / 처리음 비교 생성**을 누른다. 두 플레이어를 번갈아 들어 말머리·말끝·작은 목소리가 남아 있는지 확인한다.
6. 기본값은 **음성 인식에만 적용**이다. Nemotron에도 같은 처리음을 쓰려면 적용 대상을 바꾼 뒤 분석을 시작한다.

플러그인의 기본값이 잡음을 줄이는 설정이라는 보장은 없다. 이 PC에서 확인한 CLEAR 기본값은 Ambience Gain과 Voice Reverb Gain이 모두 0 dB였다. 처음에는 CLEAR 하나 또는 RX 하나로 비교하고, 두 개를 겹쳐 강하게 적용하기 전에 짧은 발화와 동시 발화를 확인한다. 소리가 깨끗해지는 것과 자막 정확도가 높아지는 것은 별도로 검증해야 한다.

## 최소 호스트의 범위

- 추가·삭제·순서 변경·슬롯 우회·체인 전체 끄기.
- 플러그인이 노출하는 숫자·선택 항목·켜기/끄기 파라미터 조절. 실제로 수정한 값만 저장한다.
- 묶음 VST3가 여러 효과를 제공하면 효과 이름을 선택한다.
- 설정은 현재 기기/브라우저의 로컬 설정에 저장되며 프로젝트 JSON에는 포함하지 않는다. 분석 작업에는 요청 시점의 설정 사본과 처리 결과 보고서를 저장한다.
- **VST 설정 저장/불러오기**로 체인 JSON을 백업·복원할 수 있다. 전체 분석 설정 백업과 오류 로그 내보내기는 상단 **설정 및 오류 로그**에서 사용한다. [설정·로그 안내](SETTINGS-AND-LOGS.md)
- 0.3.3 전용 GUI와 내부 상태 저장 외에 제조사 프리셋 파일 가져오기, 별도 호스트 프로파일 학습/캡처, 자동화, 사이드체인, VST2, 가상 악기, 라이브 입력 처리, 처리음의 최종 미디어 내보내기는 이번 범위에 없다. 일반 파라미터로 노출되는 Program 선택 항목은 조절할 수 있다.
- CLEAR와 RX는 사용자가 별도로 설치·활성화한 것을 사용하며 자동 구매·다운로드하지 않는다. 내장 RNNoise의 작은 모델은 별도이며 앱 데이터로 제공한다. 공식 CLEAR 체험판은 주기적으로 잡음을 삽입하므로 분석 품질 검증에 주의한다.

## 실행환경

개발용 Python 환경에 선택 의존성을 설치한다. 버전은 `pedalboard==0.9.25`로 고정한다.

```powershell
uv pip install --python .venv\Scripts\python.exe "pedalboard==0.9.25"
```

방송 중 대역폭 제한이 필요하면 패키지를 제한 속도로 먼저 내려받고 로컬 파일에서 설치한다. 이 작업에서는 공식 PyPI의 Windows CPython 3.12 wheel(3,691,258바이트)을 최대 8,000,000 B/s로 받아 SHA256을 확인하고 설치했다. 추가 모델은 받지 않았다.

표준 검색 경로는 `%COMMONPROGRAMFILES%\VST3`, `%LOCALAPPDATA%\Programs\Common\VST3`이다. 파일 목록 검색만으로 플러그인 코드를 실행하지 않는다. 명시적으로 추가·매개변수 불러오기·미리듣기·분석을 요청할 때 별도 프로세스에서 실행한다.

Pedalboard와 포함 라이브러리의 라이선스는 앱 소스 라이선스와 별도로 검토해야 한다. Pedalboard는 GPLv3이며, 별도 프로세스로 분리했다는 사실이 배포 조건을 면제하지 않는다. 빌드 스크립트는 설치된 경우에만 선택 모듈과 원문 라이선스 고지를 묶는다. 원문 고지 보존은 대응 소스 등 재배포 의무의 완료 증거가 아니며 [고지 범위](BUNDLED-NOTICES.md)와 버전별 릴리즈 기록을 확인한다.

## 처리와 시간 보존

선택한 원본 트랙 → 원본 시간축을 보존한 48 kHz 스테레오 PCM → 선택 RNNoise → 선택 VST3 체인 → 16 kHz 모노 변환 → Whisper 순서다. 기본 Nemotron 경로는 처리 전 원본 트랙을 사용한다. 다른 오디오 트랙은 섞지 않는다.

- 플러그인은 서버와 분리된 숨김 작업 프로세스에서 실행한다. 같은 사용자 범위의 OS 잠금으로 미리보기와 별도 분석 프로세스의 VST 실행을 한 번에 하나로 제한한다. 충돌·정지·취소 시 소유한 작업 프로세스를 회수하며 OS 잠금도 해제된다. 프로세스 분리는 충돌 격리이며 보안 샌드박스가 아니다.
- 전체 녹음을 메모리에 올리지 않고 청크 단위로 처리한다. 긴 작업의 최종 WAV는 RF64를 지원한다. 중간 처리는 float32 파일을 사용하며, 동시에 최대 두 단계의 파일과 최종 PCM16을 위한 여유 공간을 먼저 확인한다. 부족하면 사용자 파일을 지우지 않고 오류로 끝낸다. 중간 파일은 작업 임시 폴더에서 정리하고 PCM16 변환은 마지막 한 번만 한다.
- 각 효과를 처리하기 전에 한 번 초기화하고 청크 사이에는 상태를 유지한다. 플러그인의 보고 지연을 먼저 보정하며, 처리 중 보고 지연이 바뀌거나 실제 제거 프레임 수가 보고값과 다르면 오류로 끝낸다. 고정 47ms 값을 일괄 차감하지 않는다.
- 이어서 각 효과의 입력/출력에서 최대 7개의 겹치지 않는 0.5초 구간을 비교한다. 보고 지연을 보정한 상태에서 **±250ms 이내 잔여 지연**을 검색하고, 최소 3개 구간에서 충분히 강하고 고유한 상관 피크가 1샘플 이내로 일치할 때만 양의 잔여 지연을 추가 보정한다. 이미 보정된 지연을 다시 차감하지 않는다.
- 추가 보정에 필요한 끝부분은 최대 250ms까지 방출해 보존한 뒤 원본과 같은 샘플 수로 마친다. 너무 짧은 음원, 무음, 주기음, 강한 게이트/변형, 음수 또는 가변 지연은 **실측 불확실 · 추가 보정 안 함**으로 표시한다. 추측으로 이동하지 않으며, 샘플링한 구간 외 모든 순간의 싱크를 보증하지는 않는다.
- A/B 결과는 플러그인마다 **보고 지연**, **실측 추가 보정 또는 불확실 상태**, 적용한 합계를 샘플·밀리초로 표시한다. 측정은 이번 음원과 파라미터에만 해당하며 다음 처리에서 다시 수행한다.
- 실패한 효과를 조용히 무시하지 않는다. 원본 덮어쓰기를 금지하고 성공한 처리 파일만 적용한다.
- 0.3.3은 Windows가 상태 파일을 잠시 열고 있어 교체가 거절되는 `WinError 5`에 제한된 재시도를 적용한다. 중간 진행 정보 저장 실패만으로 음원 처리를 중단하지 않으며, 최종 결과가 계속 잠겨 저장되지 않으면 성공으로 숨기지 않고 오류로 끝낸다. / 0.3.3 uses bounded retries for transient Windows response-file replacement locks. A missed progress snapshot does not abort audio processing; a final response that remains locked still fails explicitly.
- A/B 미리듣기는 최대 2개 대기/실행 작업과 세션당 최근 16개로 제한한다. 앱 서버 종료 시 세션 임시 파일을 정리하므로 영구 내보내기 파일로 사용하지 않는다.

## API

- `GET /api/vst/status`: 선택 실행환경 준비 여부.
- `GET /api/vst/plugins`: 표준 경로의 VST3 파일/번들 목록, 코드 로드 없음.
- `POST /api/vst/inspect`: `{path, pluginName?}`의 효과 이름/파라미터 조회.
- `POST /api/vst/previews`: `{mediaId, audioTrack, start, duration, chain, noiseReduction?}`으로 A/B 생성.
- `GET /api/vst/previews/{id}`, `DELETE /api/vst/previews/{id}`: 상태와 취소.
- 완료된 작업의 `/original`, `/processed`: WAV 재생, 범위 요청 지원.
- 분석 요청의 선택 필드: `preprocessing: {chain, applyTo: "asr" | "both", noiseReduction?: {engine: "rnnoise", mix: 0..1}}`. RNNoise가 있으면 빈 VST 체인을 허용한다.
- 체인 슬롯: `{path, pluginName?, enabled, parameters, state?}`. 최대 4개, 슬롯당 파라미터 최대 256개, base64 내부 상태는 디코딩 후 256KiB까지다.
- Native editor / 전용 창: `POST /api/vst/editors`, `GET /api/vst/editors/{id}`, `POST /api/vst/editors/{id}/close`, `DELETE /api/vst/editors/{id}`. Apply requires a successfully completed result; cancellation supplies none. / 성공한 완료 결과만 적용하며 취소 결과는 적용하지 않는다.
- Analysis, preview and native-editor submission JSON is capped at 2 MiB; ordinary routes keep their separate limits and local Origin checks. / 분석·미리보기·전용 창 요청 JSON은 2MiB이며 일반 경로의 별도 한도·로컬 Origin 검사는 유지한다.

## 검증 경계

0.3.3 focused checks: 41 RNNoise tests passed, including real FFmpeg mono/stereo, short/non-block-aligned lengths, sample-exact dry mix and zero measured residual lag for a synthetic wet fixture. Separate preprocessing integration tests cover RNNoise→VST order, scope, cancellation and source preservation. These are synthetic/function checks, not Korean ASR quality or live-broadcast acceptance. Actual CLEAR native GUI opening, close/apply (17 parameters, 1,067-byte state), restoration and cancel-without-result were checked; this does not prove all vendor GUIs work. Current full-suite/package/install status belongs to the release record.

0.3.3 개별 검사에서 RNNoise 41개를 통과했습니다. 실제 FFmpeg 모노·스테레오, 짧은/블록 비정렬 길이, 강도 0 샘플 동일성, 합성 처리음 잔여 지연 0을 확인했습니다. 별도 통합 검사로 RNNoise→VST 순서·적용 범위·취소·원본 보존을 확인합니다. 한국어 인식률·실방송 수용 검증은 아닙니다. 실제 CLEAR 전용 창 열기, 닫고 적용(17개 매개변수·1,067바이트 내부 상태), 복원 및 적용 없이 취소를 확인했으며 모든 제조사 창의 호환 증거는 아닙니다. 전체 검사·패키지·설치 상태는 릴리즈 기록을 따릅니다.

기능 검증과 실제 방송 자료의 자막 정확도는 구분한다. 자동 검사에는 순서/우회, 엄격한 요청 검증, 원본 보존, 선택 트랙의 시간 보존, 지연과 끝부분 샘플, 취소/충돌 회수 및 화면 설정 저장을 포함한다. 모든 VST3 제품/버전과 수 시간짜리 방송의 성능을 보증하는 결과는 아니다.

2026-09-25 후속 개발본에서는 기존 12초 테스트 음원과 설치된 CLEAR → RX 10 Voice De-noise를 다시 처리했다. CLEAR는 보고 지연 2,238샘플(46.625ms)을 보정한 뒤 실측 잔여 0샘플(최저 상관 0.999567, 7구간), RX는 보고 지연과 실측 잔여 모두 0샘플(0.981071, 7구간)이었다. 최종 처리음과 원본 사이도 실측 잔여 0샘플(0.979446, 7구간)이어서 추가 차감하지 않았다. 576,000프레임·48kHz·스테레오, 원본 SHA256 보존, 클리핑 0 및 작업 프로세스 회수를 확인했다. 다운로드·활성화·플러그인 창 조작은 없었으며, 증거는 `tmp/vst-residual-smoke.json`이다.

보고값이 0인데 실제 2,238샘플 늦는 경우의 추가 보정과 여러 효과의 합산은 가짜 지연 효과로 검증했다. 실제 CLEAR/RX가 이번 검사에서 지연을 잘못 보고했다는 뜻은 아니다. 무음·게이트·주기음·가변/음수 지연을 추측 보정하지 않는 회귀도 포함하며, 실제 방송 자료나 음성 인식 정확도 개선 검증과는 구분한다.

2026-09-24 검증 결과이며 v0.2.0 설치본의 새 실행 기록과는 구분한다:

- 백엔드 전체 474개, 프런트엔드 203개, 데스크톱/실행기 34개 검사 통과. 프런트엔드 빌드와 선택 의존성/라이선스 수집 사전 검사 통과. 새 설치 패키지는 만들지 않았다.
- 이 PC에 설치된 CLEAR → RX 10 Voice De-noise 체인으로 48 kHz 스테레오 12초(576,000프레임)를 처리했다. CLEAR의 처리 시 보고 지연은 2,238샘플(46.625 ms), RX는 0샘플이었다. 보고된 합계와 실제 보정량이 일치했고 출력 프레임 수 및 원본 해시도 유지됐다.
- 같은 테스트 음원의 처리 전후 상호상관 최대점은 보정 후 0샘플 차이였다. 이 결과는 해당 설정과 테스트 음원의 정렬 확인이며 모든 플러그인의 물리적 지연을 자동 측정한다는 뜻은 아니다.
- 실제 체인 처리음을 기존 로컬 Whisper tiny CPU 모델로 분석해 자막 생성과 0~12초 타임스탬프를 확인했다. 이 검사는 연결 동작을 검증하며 잡음 제거에 따른 인식률 개선을 입증하지 않는다. 추가 모델 다운로드는 없었다.
- 브라우저에서 두 플러그인 추가·파라미터 변경·순서 변경·우회·새로고침 후 설정 복원을 확인했다. 6초 A/B 파일 두 개의 재생 가능 상태와 동일 길이, 각 플러그인 및 총 지연 표시를 확인했다. 방송을 방해하지 않도록 소리를 직접 재생하지는 않았다.

개발 작업의 로컬 증거는 `tmp/vst-inspect-smoke.json`, `tmp/vst-process-smoke.json`, `tmp/vst-asr-smoke.json`에 남겼다. `tmp` 자료는 배포 파일이나 버전 관리 대상이 아니다.

## 공식 자료

- [Supertone CLEAR](https://www.supertone.ai/en/clear): Windows VST3, 조절 항목과 체험판 제한.
- [iZotope Voice De-noise](https://downloads.izotope.com/docs/rx6/36-voice-de-noise/index.html): Voice De-noise 작동 방식. 현재 검증한 설치 제품은 RX 10이다.
- [Pedalboard API](https://spotify.github.io/pedalboard/reference/pedalboard.html), [호환성 한계](https://spotify.github.io/pedalboard/compatibility.html), [라이선스](https://spotify.github.io/pedalboard/license.html).
