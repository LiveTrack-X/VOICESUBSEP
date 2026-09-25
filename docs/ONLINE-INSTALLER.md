# Online Installer / 온라인 설치기

This guide targets the **0.3.0 Windows 10/11 x64 online installer**. Check the [0.3.0 release record](releases/v0.3.0.md) for actual publication, download links, hashes and installation evidence. Public downloads require no GitHub account/token. The helper downloads a version-pinned app payload; it does not rebuild the application. Read the [dependency notices and distribution scope](BUNDLED-NOTICES.md) before redistribution.

Windows 10/11 x64용 **0.3.0 대상 안내**입니다. 실제 게시·다운로드 링크·해시·설치 검증은 [0.3.0 릴리즈 기록](releases/v0.3.0.md)을 확인하세요. 공개 다운로드에 GitHub 계정·토큰은 필요 없으며, 도우미는 해당 버전의 앱 데이터를 받아 설치할 뿐 재빌드하지 않습니다. 소스 공개가 자유로운 재배포 허용을 뜻하지 않으므로 [의존성 고지·재배포 범위](BUNDLED-NOTICES.md)를 확인하세요.

**Online installer:** the target filename is `VOICESUBSEP-0.3.0-Online-Setup-x64.exe`. Use the release record's link **once publication is confirmed**; this guide does not assert that the asset is already available. Use its exact size and SHA256, rather than another version's checksums. Manual assembly remains an alternative.

**온라인 설치기:** 대상 파일명은 `VOICESUBSEP-0.3.0-Online-Setup-x64.exe`입니다. **릴리즈 기록에서 게시를 확인한 뒤** 그 링크를 사용하세요. 이 안내 자체가 게시 완료를 뜻하지 않습니다. 크기·SHA256은 같은 버전의 값으로 확인하며 수동 조립 방식도 유지합니다.

## Requirements / 준비 사항

| Item / 항목 | Requirement / 조건 |
| --- | --- |
| OS / 운영체제 | Windows 10/11 x64 |
| Runtime / 실행 환경 | .NET Framework 4.8 |
| Network / 네트워크 | Public GitHub release downloads over HTTPS / HTTPS로 공개 GitHub 릴리즈 다운로드 |
| Download / 다운로드 | Installer EXE plus several GB of app data; exact size in the release record / 설치 EXE와 수 GB 앱 데이터, 정확한 크기는 릴리즈 기록 확인 |
| Free disk / 여유 공간 | 16 GiB or more recommended, plus models and projects / 16GiB 이상 권장, 모델·프로젝트 공간 별도 |
| Minimum check / 시작 검사 | At least 12 GiB free on the cache drive / 캐시 드라이브 여유 공간 최소 12GiB 검사 |

The payload includes Python, FFmpeg, speech libraries and CUDA runtime libraries, not speech-model weights or the NVIDIA driver. Before live use, connect a short audio/video file and complete a local analysis with the same Whisper model and Nemotron enabled; it downloads missing weights. Live mode only accepts those complete caches. Commercial VST3 effects are separate. Subtitle translation and automatic AI summaries are outside the 0.3.0 scope. The helper's speed limit does not limit later model downloads.

Python·FFmpeg·음성 라이브러리·CUDA 런타임은 포함하지만 음성 모델 가중치·NVIDIA 드라이버는 별도입니다. 라이브 전에 짧은 음성·영상 파일을 연결하고 `음성 분석`에서 같은 Whisper 모델·로컬 Nemotron 분석을 한 번 완료해 없는 가중치를 받습니다. 라이브는 이 완성된 캐시만 읽습니다. 상용 VST3도 별도이고 자막 번역·AI 자동 요약은 0.3.0 범위에서 제거했습니다. 도우미의 속도 제한은 이후 모델 다운로드에 적용되지 않습니다.

## Install / 설치

1. After publication is confirmed in the release record, download **`VOICESUBSEP-0.3.0-Online-Setup-x64.exe`** and run it. The Windows executable is Authenticode-unsigned; verify its source and published checksum.
2. Choose **Download limit**: `40 Mbps (5 MB/s)`, `80 Mbps (10 MB/s)` or `Unlimited`. The default is **80 Mbps**. This limits this downloader, not all computer traffic or a guaranteed reserved bandwidth for other apps.
3. Press **Download & install**. The helper downloads, verifies and assembles the existing installer data. Progress shows the current file/stage, not a prediction of total install time.
4. After verification, the regular NSIS installation wizard opens. Follow its prompts. Save projects and close the old app before installing.
5. Open VOICESUBSEP and prepare the speech models as needed. Download completion or starting the wizard is not the same as finishing installation.

1. 릴리즈 기록에서 게시를 확인한 뒤 **`VOICESUBSEP-0.3.0-Online-Setup-x64.exe`**를 실행합니다. Windows Authenticode 미서명이므로 출처와 공개 체크섬을 확인하세요.
2. **다운로드 제한**에서 `40 Mbps (5 MB/s)`, `80 Mbps (10 MB/s)`, `제한 없음`을 선택합니다. 기본값은 **80Mbps**입니다. 이 도우미의 속도만 조절하며 컴퓨터 전체 트래픽을 제한하거나 다른 앱의 대역폭을 보장하지 않습니다.
3. **다운로드 및 설치**를 누르면 기존 설치 데이터를 받고 검증·재조립합니다. 진행률은 현재 파일·단계를 표시하며 전체 설치 시간 예측은 아닙니다.
4. 검증 후 일반 NSIS 설치 마법사가 열리면 안내에 따라 진행합니다. 설치 전 프로젝트를 저장하고 기존 앱을 종료하세요.
5. VOICESUBSEP을 열고 필요한 음성 모델을 준비합니다. 다운로드 완료·마법사 시작과 설치 완료는 서로 다른 단계입니다.

## Cancel, retry and cache / 취소·재시도·캐시

**Cancel** stops the helper's download/assembly. Closing its window requests cancellation before exit. Use **Resume** or reopen the same online EXE to continue. A different speed can be selected before the next attempt. Once the NSIS wizard has opened, its own cancel control manages installation; the helper's cancel button no longer controls that process.

**취소**는 도우미의 다운로드·조립을 중지합니다. 창을 닫으면 취소 정리를 거쳐 종료합니다. **이어받기** 또는 같은 온라인 EXE 재실행으로 계속할 수 있고 다음 시도 전에 속도를 바꿀 수 있습니다. NSIS 마법사가 열린 뒤에는 설치 마법사 자체의 취소 기능을 사용합니다. 도우미의 취소 버튼은 이미 시작한 설치를 제어하지 않습니다.

Cache / 캐시:

```text
%LOCALAPPDATA%\VOICESUBSEP\InstallerCache\0.3.0
```

- Completed files are reused only after size and SHA256 checks. Partial downloads are retained as `.partial` and requested with HTTP Range. If the server ignores Range and returns the whole file, that file starts over instead of appending duplicate bytes.
- 완료 파일은 크기·SHA256을 다시 확인한 뒤 재사용합니다. 덜 받은 파일은 `.partial`로 남겨 HTTP Range 이어받기를 요청합니다. 서버가 Range를 무시하고 전체 파일을 보내면 중복으로 덧붙이지 않고 해당 파일을 처음부터 받습니다.
- Every resumed file is verified before becoming a completed file. Corrupt data is not accepted for installation. Restarting assembly reuses verified parts but rebuilds the combined payload from the beginning.
- 이어받은 파일도 완료 파일로 확정하기 전에 검증합니다. 손상된 데이터로 설치하지 않습니다. 조립이 중단되면 검증된 조각은 재사용하되 합쳐진 payload는 처음부터 다시 조립합니다.
- The cache is retained for retry; it is not your project/media/model storage. After installation succeeds and both installer windows are closed, you may remove this version's installer cache if no retry is needed. A later run will download missing files again.
- 캐시는 재시도를 위해 유지하며 프로젝트·원본·모델 저장소와 별도입니다. 설치 성공 후 두 설치 창을 모두 닫고 재시도가 필요 없다면 해당 버전의 설치 캐시를 정리할 수 있습니다. 이후 다시 실행하면 없는 파일을 받습니다.

## Verification / 검증

Each online EXE pins its own version's names, sizes and SHA256 hashes. It fetches the matching NSIS EXE and release parts over public HTTPS, verifies each and the assembled payload, then starts the EXE **without `--package-file`**. EXE and payload stay colocated, preserving NSIS's normal payload/SHA512 check. Hash verification proves matching bytes, not Windows publisher trust or installation success.

온라인 EXE마다 해당 버전의 이름·크기·SHA256을 고정합니다. 공개 HTTPS로 같은 버전의 NSIS EXE·데이터 조각을 받고 각 파일·재조립 결과를 검증한 뒤 **`--package-file` 없이** EXE를 실행합니다. 같은 폴더 payload·NSIS SHA512 검사를 유지합니다. 해시 일치는 Windows 게시자 신뢰나 설치 성공을 증명하지 않습니다.

Current publication/download/installation evidence belongs to [0.3.0](releases/v0.3.0.md). The historical [0.2.0](releases/v0.2.0.md) and [0.2.1](releases/v0.2.1.md) records are unchanged and do not prove installation or GPU inference for a different build.

현재 게시·다운로드·설치 증거는 [0.3.0 기록](releases/v0.3.0.md)을 따릅니다. 과거 [0.2.0](releases/v0.2.0.md)·[0.2.1](releases/v0.2.1.md) 기록은 그대로 보존하며 다른 빌드의 설치·GPU 추론 증거로 재사용하지 않습니다.

The 0.3.0 app's **in-app updater is separate from this setup helper**. It uses a bundled Ed25519 public key to authenticate a GitHub release manifest and SHA256 to verify split files/payload, with explicit check/download/install and serial 80 Mbps transfers. Its incomplete individual downloads restart; only complete verified files are reused. This is manifest authentication, **not Windows Authenticode signing**. See [desktop updates](DESKTOP.md#사용자가-선택하는-업데이트).

0.3.0 **인앱 업데이트는 이 설치 도우미와 별도**입니다. 포함된 Ed25519 공개키로 GitHub 명세를 인증하고 SHA256로 조각·payload를 검증하며 확인·다운로드·설치를 직접 선택합니다. 순차 80Mbps이고 미완료 개별 파일은 다시 받으며 검증된 완료 파일만 재사용합니다. 이는 명세 인증이며 **Windows Authenticode 코드 서명은 아닙니다**. [업데이트 계약](DESKTOP.md#사용자가-선택하는-업데이트)을 참고하세요.

## Manual fallback / 수동 설치 대안

Download the matching Offline Setup EXE, **all `.partNNN` files in that release's manifest**, `installer-manifest.json`, `SHA256SUMS.txt`, and `Assemble-Installer.ps1` together. Follow the [manual instructions](USER-GUIDE.md#1-설치와-첫-실행). The script verifies/assembles only; then run the EXE manually. No system-wide PowerShell execution-policy change is required.

같은 버전의 Offline Setup EXE, **명세에 적힌 모든 `.partNNN`**, `installer-manifest.json`, `SHA256SUMS.txt`, `Assemble-Installer.ps1`을 함께 받아 [수동 절차](USER-GUIDE.md#1-설치와-첫-실행)를 따릅니다. 스크립트는 검증·조립만 하므로 이후 EXE를 직접 실행하며 시스템 전체 PowerShell 실행 정책을 바꿀 필요는 없습니다.
