# Online Installer / 온라인 설치기

For Windows 10/11 x64, VOICESUBSEP v0.2.0 Preview. The repository and release are public; no GitHub account or access token is required. The online helper uses the existing v0.2.0 app payload. It does not rebuild the app or enable its update feed. Read the [dependency notices and distribution scope](BUNDLED-NOTICES.md) alongside the download; public source access does not imply a permissive app license.

Windows 10/11 x64용 VOICESUBSEP v0.2.0 Preview 안내입니다. 저장소와 릴리즈는 공개이며 GitHub 계정·접근 토큰이 필요하지 않습니다. 온라인 도우미는 기존 v0.2.0 앱 데이터를 사용하며 앱을 다시 빌드하거나 인앱 업데이트 feed를 켜지 않습니다. 다운로드와 함께 [의존성 고지·재배포 범위](BUNDLED-NOTICES.md)를 확인하세요. 소스 공개가 앱에 자유로운 재배포 라이선스를 부여한다는 뜻은 아닙니다.

**Online installer:** download `VOICESUBSEP-0.2.0-Online-Setup-x64.exe` (approximately 167 KB) from the [release assets](https://github.com/LiveTrack-X/VOICESUBSEP/releases/tag/v0.2.0). Use that release's checksum file and [verification record](releases/v0.2.0.md) for the exact size, SHA256 and tested scope. The seven-file manual installer remains an alternative.

**온라인 설치기:** [릴리즈 자산](https://github.com/LiveTrack-X/VOICESUBSEP/releases/tag/v0.2.0)의 `VOICESUBSEP-0.2.0-Online-Setup-x64.exe`를 받으세요(약 167KB). 정확한 크기·SHA256·실제 확인 범위는 해당 릴리즈의 체크섬 파일과 [검증 기록](releases/v0.2.0.md)을 따릅니다. 7개 파일 수동 방식도 유지합니다.

## Requirements / 준비 사항

| Item / 항목 | Requirement / 조건 |
| --- | --- |
| OS / 운영체제 | Windows 10/11 x64 |
| Runtime / 실행 환경 | .NET Framework 4.8 |
| Network / 네트워크 | Public GitHub release downloads over HTTPS / HTTPS로 공개 GitHub 릴리즈 다운로드 |
| Download / 다운로드 | Installer EXE plus approximately 2.42 GB of app data; see release for exact size / 설치 EXE와 약 2.42GB 앱 데이터, 정확한 크기는 릴리즈 확인 |
| Free disk / 여유 공간 | 16 GiB or more recommended, plus models and projects / 16GiB 이상 권장, 모델·프로젝트 공간 별도 |
| Minimum check / 시작 검사 | At least 12 GiB free on the cache drive / 캐시 드라이브 여유 공간 최소 12GiB 검사 |

The download includes Python, FFmpeg, speech libraries and CUDA runtime libraries. It does not include model weights or an NVIDIA driver. Whisper/Nemotron weights download separately in the app when absent; prepare a compatible driver for GPU analysis. Commercial VST3 effects are separate optional components. Current source removes automatic translation and AI summaries; the older public installer has its original feature set. The online download limit does not limit later model downloads.

다운로드에는 Python·FFmpeg·음성 라이브러리·CUDA 런타임이 들어가지만 모델 가중치·NVIDIA 드라이버는 없습니다. Whisper/Nemotron 가중치가 없으면 앱에서 별도 다운로드하며 GPU 분석에는 호환 드라이버를 준비해야 합니다. 상용 VST3는 별도 선택 구성요소입니다. 현재 소스에서 번역·AI 요약을 제거했지만 기존 공개 설치기에는 당시 기능이 유지됩니다. 온라인 설치기의 다운로드 제한은 이후 모델 다운로드에 적용되지 않습니다.

## Install / 설치

1. Download **`VOICESUBSEP-0.2.0-Online-Setup-x64.exe`** from the release, then run it. This Preview is unsigned; verify its source and published checksum.
2. Choose **Download limit**: `40 Mbps (5 MB/s)`, `80 Mbps (10 MB/s)` or `Unlimited`. The default is **80 Mbps**. This limits this downloader, not all computer traffic or a guaranteed reserved bandwidth for other apps.
3. Press **Download & install**. The helper downloads, verifies and assembles the existing installer data. Progress shows the current file/stage, not a prediction of total install time.
4. After verification, the regular NSIS installation wizard opens. Follow its prompts. Save projects and close the old app before installing.
5. Open VOICESUBSEP and prepare the speech models as needed. Download completion or starting the wizard is not the same as finishing installation.

1. 릴리즈의 **`VOICESUBSEP-0.2.0-Online-Setup-x64.exe`**를 받아 실행합니다. 코드 서명 없는 Preview이므로 출처와 공개 체크섬을 확인하세요.
2. **다운로드 제한**에서 `40 Mbps (5 MB/s)`, `80 Mbps (10 MB/s)`, `제한 없음`을 선택합니다. 기본값은 **80Mbps**입니다. 이 도우미의 속도만 조절하며 컴퓨터 전체 트래픽을 제한하거나 다른 앱의 대역폭을 보장하지 않습니다.
3. **다운로드 및 설치**를 누르면 기존 설치 데이터를 받고 검증·재조립합니다. 진행률은 현재 파일·단계를 표시하며 전체 설치 시간 예측은 아닙니다.
4. 검증 후 일반 NSIS 설치 마법사가 열리면 안내에 따라 진행합니다. 설치 전 프로젝트를 저장하고 기존 앱을 종료하세요.
5. VOICESUBSEP을 열고 필요한 음성 모델을 준비합니다. 다운로드 완료·마법사 시작과 설치 완료는 서로 다른 단계입니다.

## Cancel, retry and cache / 취소·재시도·캐시

**Cancel** stops the helper's download/assembly. Closing its window requests cancellation before exit. Use **Resume** or reopen the same online EXE to continue. A different speed can be selected before the next attempt. Once the NSIS wizard has opened, its own cancel control manages installation; the helper's cancel button no longer controls that process.

**취소**는 도우미의 다운로드·조립을 중지합니다. 창을 닫으면 취소 정리를 거쳐 종료합니다. **이어받기** 또는 같은 온라인 EXE 재실행으로 계속할 수 있고 다음 시도 전에 속도를 바꿀 수 있습니다. NSIS 마법사가 열린 뒤에는 설치 마법사 자체의 취소 기능을 사용합니다. 도우미의 취소 버튼은 이미 시작한 설치를 제어하지 않습니다.

Cache / 캐시:

```text
%LOCALAPPDATA%\VOICESUBSEP\InstallerCache\0.2.0
```

- Completed files are reused only after size and SHA256 checks. Partial downloads are retained as `.partial` and requested with HTTP Range. If the server ignores Range and returns the whole file, that file starts over instead of appending duplicate bytes.
- 완료 파일은 크기·SHA256을 다시 확인한 뒤 재사용합니다. 덜 받은 파일은 `.partial`로 남겨 HTTP Range 이어받기를 요청합니다. 서버가 Range를 무시하고 전체 파일을 보내면 중복으로 덧붙이지 않고 해당 파일을 처음부터 받습니다.
- Every resumed file is verified before becoming a completed file. Corrupt data is not accepted for installation. Restarting assembly reuses verified parts but rebuilds the combined payload from the beginning.
- 이어받은 파일도 완료 파일로 확정하기 전에 검증합니다. 손상된 데이터로 설치하지 않습니다. 조립이 중단되면 검증된 조각은 재사용하되 합쳐진 payload는 처음부터 다시 조립합니다.
- The cache is retained for retry; it is not your project/media/model storage. After installation succeeds and both installer windows are closed, you may remove this version's installer cache if no retry is needed. A later run will download missing files again.
- 캐시는 재시도를 위해 유지하며 프로젝트·원본·모델 저장소와 별도입니다. 설치 성공 후 두 설치 창을 모두 닫고 재시도가 필요 없다면 해당 버전의 설치 캐시를 정리할 수 있습니다. 이후 다시 실행하면 없는 파일을 받습니다.

## Verification / 검증

The online EXE contains expected v0.2.0 names, sizes and SHA256 hashes. It fetches the original NSIS EXE and three release parts over public HTTPS, verifies each file and the assembled payload, then starts the original EXE **without `--package-file`**. EXE and payload stay colocated, preserving NSIS's normal payload/SHA512 check. Hash verification proves matching bytes, not Windows publisher trust or installation success.

온라인 EXE에는 v0.2.0의 예상 이름·크기·SHA256이 들어 있습니다. 공개 HTTPS로 원래 NSIS EXE와 릴리즈 조각 3개를 받고 각 파일과 재조립 결과를 확인한 뒤 **`--package-file` 없이** 원래 EXE를 실행합니다. EXE와 payload는 같은 폴더에 두어 NSIS의 기본 payload·SHA512 검사 경로를 유지합니다. 해시 검증은 파일 내용 일치를 확인하며 Windows 게시자 신뢰나 설치 성공을 증명하지 않습니다.

The public assets and prior download/assembly/runtime checks are recorded in the [v0.2.0 release record](releases/v0.2.0.md). v0.2.1 is a separately verified local checkpoint and an unpublished draft with no uploaded assets; see its [checkpoint record](releases/v0.2.1.md). Current development changes are not included in the public installer. Historical checks do not prove installation or GPU inference of a different build.

공개 자산과 이전 다운로드·조립·런타임 검사는 [v0.2.0 릴리즈 기록](releases/v0.2.0.md)을 따릅니다. v0.2.1은 별도로 확인한 로컬 설치본과 자산 없는 미공개 초안이며 [확인본 기록](releases/v0.2.1.md)에 구분합니다. 현재 개발 소스의 변경은 공개 설치기에 포함되지 않았습니다. 과거 검증은 다른 빌드의 설치나 GPU 추론을 입증하지 않습니다.

The Preview is unsigned and the application's update feed is still `unconfigured`. Public release access and this downloader do not configure in-app updating.

Preview는 무서명이며 앱의 업데이트 feed는 계속 `unconfigured`입니다. 공개 릴리즈와 이 다운로더는 인앱 업데이트를 구성하지 않습니다.

## Manual fallback / 수동 설치 대안

The original seven assets remain usable: Offline Setup EXE, `.part001`, `.part002`, `.part003`, `installer-manifest.json`, `SHA256SUMS.txt`, and `Assemble-Installer.ps1`. Download them together and follow the [manual instructions](USER-GUIDE.md#1-설치와-첫-실행). The script verifies/assembles only; then start the EXE manually. Neither route requires changing system-wide PowerShell execution policy.

기존 자산 7개도 사용할 수 있습니다: Offline Setup EXE, `.part001`, `.part002`, `.part003`, `installer-manifest.json`, `SHA256SUMS.txt`, `Assemble-Installer.ps1`. 모두 받아 [수동 설치 절차](USER-GUIDE.md#1-설치와-첫-실행)를 따르세요. 스크립트는 검증·조립만 하므로 이후 EXE를 직접 실행합니다. 어느 방식도 시스템 전체 PowerShell 실행 정책 변경을 요구하지 않습니다.
