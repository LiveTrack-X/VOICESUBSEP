# Windows Desktop and Updates / 설치형 앱과 업데이트

This document targets **0.3.0**: desktop architecture, packaging and the signed-manifest GitHub updater. Actual publication, immutable artifacts, installation and test results belong in the [0.3.0 release record](releases/v0.3.0.md). The [user guide](USER-GUIDE.md) covers normal use. Earlier [0.2.0](releases/v0.2.0.md) and [0.2.1](releases/v0.2.1.md) records remain historical evidence.

**0.3.0 대상** 실행·빌드·업데이트 문서입니다. 실제 게시·산출물·설치·검증은 [0.3.0 기록](releases/v0.3.0.md), 일반 사용은 [사용자 가이드](USER-GUIDE.md)를 확인하세요. 소스 구현이나 빌드 성공만으로 배포·설치 성공을 주장하지 않습니다.

The small online setup downloads the matching NSIS EXE and split payload without GitHub login, verifies SHA256, and opens the installer. Windows 10/11 x64 and .NET Framework 4.8 are required. It offers 40/80 Mbps or unlimited, default 80 Mbps; cache is `%LOCALAPPDATA%\VOICESUBSEP\InstallerCache\<version>`. Verified files are reused; incomplete files resume with Range when supported. Allow at least 16 GiB free plus models/projects (the helper checks a 12 GiB minimum). File counts and sizes follow the versioned release manifest. The manual assembly method remains available.

작은 온라인 설치기는 로그인 없이 해당 버전의 NSIS EXE·데이터 조각을 받고 SHA256 검증 후 설치기를 엽니다. Windows 10/11 x64·.NET Framework 4.8이 필요합니다. 기본 80Mbps, 40Mbps·제한 없음 선택이며 캐시는 `%LOCALAPPDATA%\VOICESUBSEP\InstallerCache\<version>`입니다. 완료 파일은 검증 후 재사용하고 미완료 파일은 Range 지원 시 이어받습니다. 여유 공간 16GiB 이상과 모델·프로젝트 공간을 준비하세요(도우미 최소 검사 12GiB). 정확한 파일 수·크기는 버전별 명세를 따릅니다. 수동 조립 방법도 유지합니다.

**Windows executables are Authenticode-unsigned.** The in-app updater authenticates the release manifest using Ed25519; these are different signatures. Redistribution still requires the [dependency notices and obligations](BUNDLED-NOTICES.md). / **Windows 실행 파일은 Authenticode 미서명**입니다. 인앱 업데이트의 Ed25519 서명은 배포 명세를 인증하는 별도 장치이며, [의존성 재배포 의무](BUNDLED-NOTICES.md)는 그대로 적용됩니다.

## 설치형 앱의 구조

*Runtime architecture.* Electron launches the bundled Python backend on a random loopback port, exposes a stable `voicesubsep://app/` origin, and keeps user data outside the install folder. Python, FFmpeg/FFprobe, speech libraries and CUDA runtime DLLs are bundled. Model weights, a compatible NVIDIA driver and third-party VST3 plugins are separate. No Ollama or automatic text-generation runtime is used. On shutdown, the app requests backend cleanup, waits up to 12 seconds and terminates only its own remaining process tree. Interrupted analysis is not automatically resumed.

Electron은 임의 loopback 포트의 번들 백엔드를 실행하고 고정 `voicesubsep://app/` 주소를 사용합니다. 사용자 데이터는 설치 폴더 밖에 유지합니다. 앱·API의 버전과 실제 번들 식별자는 [릴리즈 기록](releases/v0.3.0.md)에서 확인하며, 창 최소 너비 480px과 자막 중심 반응형 화면을 지원합니다.

- 제품명 `VOICESUBSEP`, 앱 ID `com.livetrack.voicesubsep`, Windows x64 NSIS 설치 프로그램입니다.
- Electron이 `resources/backend/voicesubsep-server.exe`를 임의의 `127.0.0.1` 포트로 실행합니다. 이 서버 하나가 웹 편집기와 API를 제공합니다. 개발용 5173·8787 포트를 사용하지 않습니다.
- 실행 인수는 `--port <port> --data-dir <userData>/data --web-dir <resources>/web`입니다. 가벼운 `/api/ready`의 `status: ok`, `app: voicesubsep`을 확인한 뒤 창을 엽니다. 분석 화면이 `/api/health`로 Whisper·Nemotron·CUDA의 준비 상태를 별도로 확인합니다. 최초 모델 라이브러리 로딩에는 수십 초가 걸릴 수 있습니다.
- 화면 주소는 `voicesubsep://app/`로 고정하고 Electron의 custom protocol에서 로컬 서버로 요청을 전달합니다. 따라서 임의 포트가 바뀌어도 자동 저장의 localStorage origin이 유지됩니다. 파일 업로드는 스트림으로 전달합니다.
- Python·FFmpeg·FFprobe·Whisper·Nemotron 실행 환경과 PyTorch CUDA DLL은 백엔드 번들에 포함됩니다. 모델 가중치는 설치 파일에 넣지 않으며 첫 분석 때 별도 다운로드합니다.
- `<userData>/data`, Chromium 자동 저장, `<userData>/logs/backend.log`는 설치 디렉터리 밖에 보관합니다. 일반적인 Windows 위치는 `%APPDATA%/VOICESUBSEP`입니다. 로그는 약 4 MiB 단위로 직전 파일 하나를 보존합니다.
- `HF_HOME`을 덮어쓰지 않고 기존에 완성된 Hugging Face 캐시는 읽어 재사용합니다. Windows에서 새 Whisper 모델은 `%LOCALAPPDATA%/VOICESUBSEP/models/whisper` 아래에 보관합니다. 앱 업데이트는 이 두 캐시를 삭제하지 않습니다. NSIS 제거 옵션도 사용자 데이터를 자동 삭제하지 않도록 설정했습니다.

앱 종료 시 main 프로세스만 아는 임의 토큰으로 `/api/desktop/shutdown`을 요청합니다. 백엔드에 취소·정리 시간을 최대 12초 부여하고, 남아 있는 경우 앱이 실행한 PID의 프로세스 트리만 종료합니다. 진행 중인 분석을 재개하는 기능은 별도이며, 종료 전 프로젝트 파일 저장을 권장합니다.

업데이트 설치기는 백엔드 프로세스의 실제 종료를 확인한 뒤 실행합니다. 종료가 확인되지 않으면 설치를 차단하며, 설치기 실행에 실패하면 분석 서버를 복구한 뒤 오류를 표시하고 재시도를 허용합니다. 복구도 실패하면 앱을 다시 시작해야 한다는 오류를 표시합니다.

## 개발과 빌드

*Development and builds.* Prepare Node/npm and the Python environment as described in the README. `desktop:dev` runs the UI, backend and Electron together; development updates are disabled. `desktop:pack` creates an unpacked app, `desktop:installer` a single NSIS installer, and `desktop:installer:split` a colocated EXE/payload pair. The existing backend bundle must be built first; packaging does not silently build it or download model weights. Package tools may download their own dependencies if uncached. Builds use `--publish never`; publishing is a separate action. Preserve the bundled original notices. Full runtime checks are separate from GPU inference and actual installer acceptance.

Node/npm과 백엔드 개발 환경은 기존 README의 설치 절차를 따릅니다.

```powershell
npm ci
npm run desktop:dev
```

`desktop:dev`는 기존 Vite/API 개발 서버와 Electron을 함께 시작하고 함께 종료합니다. 이미 `npm start`가 실행 중이면 먼저 종료해야 합니다. 개발 실행에서는 업데이트가 비활성화됩니다.

Windows 설치 파일을 만들려면 먼저 백엔드 번들을 준비합니다.

```powershell
# README의 setup.ps1로 CUDA PyTorch와 Nemotron 환경을 준비한 뒤
uv pip install --python .venv\Scripts\python.exe -e './backend[whisper,diarization,desktop-build]'
powershell -ExecutionPolicy Bypass -File scripts/build-backend.ps1 -CheckDependenciesOnly
powershell -ExecutionPolicy Bypass -File scripts/build-backend.ps1
npm run desktop:pack
npm run desktop:installer:split
```

- `desktop:pack`: 웹 빌드 후 `release/win-unpacked/` 실행 폴더를 생성합니다.
- `desktop:installer`: 웹 빌드 후 `release/VOICESUBSEP-<version>-Setup-x64.exe`를 생성합니다.
- `desktop:installer:split`: 공식 NSIS-web 형식으로 `VOICESUBSEP-<version>-Offline-Setup-x64.exe`와 `voicesubsep-<version>-x64.nsis.7z`를 생성합니다. **두 파일을 같은 폴더에 두고 EXE를 실행**합니다. Nemotron·CUDA를 포함한 현재 번들은 이 형식을 사용합니다. 같은 폴더의 데이터 파일은 SHA512 확인 후 사용하며, 기본 설치본에 데이터 파일이 없으면 외부 서버에서 대신 받지 못합니다.
- 모든 명령은 `build/backend/voicesubsep-server/voicesubsep-server.exe`가 없으면 실패합니다. 백엔드를 묵시적으로 재빌드하거나 모델을 다운로드하지 않습니다.
- Electron·NSIS·코드 서명 도구가 로컬 캐시에 없으면 패키징 도구가 추가 파일을 다운로드할 수 있습니다. 오프라인 빌드에는 해당 버전의 로컬 배포 파일과 도구 경로를 먼저 준비해야 합니다.
- 빌드 스크립트는 항상 `--publish never`를 사용합니다. GitHub Release 또는 서버 업로드는 수행하지 않습니다.
- 백엔드 빌드는 PyTorch·Transformers·음성 처리 의존성과 FFmpeg의 원본 고지 파일을 포함하고 SHA256로 보존 여부를 확인합니다. PyTorch가 완전한 CUDA DLL 묶음을 제공하면 같은 DLL을 다시 제공하는 NVIDIA 패키지는 중복해서 넣지 않습니다. [포함 고지 범위](BUNDLED-NOTICES.md)를 참고하세요.
- 백엔드 빌드가 끝나면 `scripts/bundled-runtime-check.py`를 자동 실행합니다. 외부 Python·CUDA 경로 없이 번들만으로 Whisper·Nemotron·FFmpeg·FFprobe를 불러오고 API 버전과 정상 종료까지 확인해야 빌드가 성공합니다. 이 검사는 가중치를 받거나 모델 추론을 실행하지 않으며 GPU가 없어도 실행할 수 있습니다. 실제 GPU 분석 검증은 [별도 기록](NEMOTRON-SMOKE.md)을 따릅니다.
- Python 3.12.0에는 동결 모듈의 `code.replace()` 버그가 있어 빌드를 거부합니다. 현재 setup의 새 개발 환경은 수정된 Python 3.12.13을 사용하며, 해당 런타임도 설치형에 함께 묶습니다. 시스템 Python을 변경할 필요는 없습니다.
- `release/`는 생성물이며 Git에 넣지 않습니다. 앱 코드는 ASAR로 묶고 웹 파일·백엔드 번들은 `extraResources`로 포함합니다. `.venv`, 원본 미디어, 개발 데이터 및 환경 설정 파일은 패키지 대상이 아닙니다.

v0.1.1 로컬 패키징은 `electronDist`와 `ELECTRON_BUILDER_7ZIP_PATH`, `ELECTRON_BUILDER_NSIS_DIR`, `ELECTRON_BUILDER_NSIS_RESOURCES_DIR` 경로를 이용했습니다. 원본 체크섬과 대조한 Electron·7zip을 사용하고 다운로드 mirror/proxy를 외부에 연결할 수 없는 loopback으로 제한했습니다. `ELECTRON_DOWNLOAD_CACHE_MODE=1`은 캐시가 없을 때 다운로드할 수 있으므로 오프라인 차단 옵션으로 사용하지 않습니다. 단일 NSIS는 2.39 GB 압축 데이터 내장 단계에서 실패했고, 같은 압축 데이터를 재사용한 공식 NSIS-web 설치 EXE와 별도 payload 생성은 성공했습니다. 실제 산출물과 해시는 [v0.1.1 설치 파일 기록](NEMOTRON-SMOKE.md#v011-설치-파일)에 있습니다.

### 앱 아이콘

*App icons.* Windows executable, taskbar and installers use `desktop/assets/icon.ico`; other window contexts use `icon.png`. Rebuild after icon changes. Replacing a favicon does not update an installed executable; preserve user data and close the running app before replacement.

`desktop/assets/icon.ico`는 Windows 실행 파일·작업 표시줄·NSIS 및 NSIS-web 설치/제거 프로그램에 공통으로 사용합니다. 작은 작업 표시줄부터 고해상도 표시까지 지원하도록 ICO에는 16·32·48·256px 이상의 여러 크기를 포함합니다. `desktop/assets/icon.png`는 다른 플랫폼의 창 아이콘입니다. 두 파일은 `app.asar`에 명시적으로 포함하며 개발 실행과 설치 실행 모두 `desktop/main.cjs` 옆의 `assets/`에서 읽습니다. Windows AppUserModelID는 설치기와 동일한 `com.livetrack.voicesubsep`입니다.

아이콘을 변경한 뒤 `node --test desktop/build-config.test.cjs`로 빌더 스키마·포함 경로·ICO 크기를 확인하고 `npm run desktop:pack` 또는 설치기 빌드를 다시 실행합니다. 웹 favicon 변경만으로 이미 설치된 EXE나 작업 표시줄 아이콘이 바뀌지는 않습니다. 실행 중인 설치본의 파일을 덮어쓰지 말고 프로젝트를 저장하여 앱을 정상 종료한 뒤 새 빌드를 적용합니다. 사용자 데이터·자동 저장·모델 캐시는 아이콘 변경 대상이 아닙니다. Windows에 이전 바로가기 아이콘이 남는 경우 새 실행 파일로 다시 고정하여 확인합니다.

## 사용자가 선택하는 업데이트

The default 0.3.0 build uses `desktop/release-updater.cjs` with public releases from `LiveTrack-X/VOICESUBSEP`. The user separately chooses **check → download → save and restart/install**. There is no automatic download or install on ordinary quit. Development/browser mode cannot install updates. A previous build with no configured updater needs one manual replacement before this path is available.

0.3.0 기본 빌드는 `LiveTrack-X/VOICESUBSEP`의 공개 릴리즈를 조회합니다. **확인 → 다운로드 → 저장 후 다시 시작/설치**를 각각 선택하며 자동 다운로드·일반 종료 시 자동 설치는 하지 않습니다. 개발·브라우저 모드에서는 설치할 수 없습니다. 업데이트가 미설정인 이전 버전은 이 경로를 쓰기 전에 한 번 수동 교체해야 합니다.

- Release discovery excludes drafts, accepts newer semantic `major.minor.patch` versions, and requires both `installer-manifest.json` and `installer-manifest.sig`. Preview releases are allowed for this 0.x application.
- The bundled `desktop/update-public-key.pem` verifies the raw manifest's Ed25519 signature before download. The manifest pins the version, safe exact filenames, lengths, part order and SHA256. Only the configured GitHub repository's release asset URLs and allowlisted HTTPS redirects are used; no GitHub credential is embedded.
- Files download serially at **80 Mbps** into `<userData>/updates/<version>`. A completed file is reused only after size/hash verification. An interrupted individual download restarts; it does not have the online helper's Range resume. Assembly verifies the full payload again, and installer/payload hashes are checked immediately before launch.
- Install requires the app's backend to exit. Failure to stop it blocks installation; launch failure attempts backend recovery. Save project JSON and finish active work before installing. Data and model caches remain outside the install folder.

- 초안은 제외하고 더 높은 `major.minor.patch` 버전의 `installer-manifest.json`·`installer-manifest.sig`가 있는 릴리즈를 찾습니다. 0.x 앱의 Preview 릴리즈는 허용합니다.
- 앱의 `desktop/update-public-key.pem`으로 명세 원본 바이트의 Ed25519 서명을 먼저 검증합니다. 명세에는 버전·정확한 파일명·크기·조각 순서·SHA256이 묶입니다. 지정 저장소 자산과 허용된 HTTPS 리다이렉트만 사용하며 GitHub 인증 정보는 넣지 않습니다.
- `<userData>/updates/<version>`에 **순차 80Mbps**로 받습니다. 완료 파일은 크기·해시 확인 후 재사용하며 중단된 개별 파일은 다시 받습니다. 온라인 도우미의 Range 이어받기와 다릅니다. 조립 결과와 설치 직전 EXE·payload를 다시 검증합니다.
- 백엔드 종료가 확인되어야 설치합니다. 종료 실패 시 차단하고 설치기 시작 실패 시 백엔드 복구를 시도합니다. 실행 중 작업을 마치고 프로젝트 JSON을 저장하세요. 사용자 데이터·모델 캐시는 설치 폴더 밖에 남습니다.

### Release signing / 릴리즈 서명

Build the final installer/payload, prepare the split release assets, then sign the **final unchanged** manifest:

```powershell
node scripts/sign-update-manifest.cjs release/github-v0.3.0
```

The signing script reads a private key outside the repository (`VOICESUBSEP_RELEASE_KEY`, or the local release-key directory), verifies that it matches the bundled public key, and writes only `installer-manifest.sig`. Never package the private key. Publish the matching installer, every part, manifest and signature together after validation. The signature authenticates the manifest and its pinned hashes; **it does not sign the Windows EXE with Authenticode or establish SmartScreen reputation**. Key rotation requires an explicit trust transition, not simply replacing the release's signature.

최종 설치 파일과 분할 자산을 만든 뒤 **더 이상 바꾸지 않을 명세**를 서명합니다. 스크립트는 저장소 밖 개인키(`VOICESUBSEP_RELEASE_KEY` 또는 로컬 릴리즈 키 폴더)를 읽어 포함 공개키와 일치하는지 확인하고 `installer-manifest.sig`만 생성합니다. 개인키를 패키지에 넣지 않습니다. 검증된 설치기·모든 조각·명세·서명을 함께 게시합니다. 서명은 명세와 해시를 인증하며 **Windows EXE의 Authenticode 서명·SmartScreen 신뢰도를 제공하지 않습니다**. 개인키 교체만으로 기존 앱의 신뢰 키가 바뀌지 않습니다.

An explicit `VOICESUBSEP_UPDATE_URL` at build time selects the separate legacy generic/electron-updater path instead of GitHub split updates. It requires its own valid HTTPS feed and signature/publisher configuration; it is not the default 0.3.0 delivery path. Do not set it when building the normal GitHub release. Published status and actual upgrade acceptance remain in the [release record](releases/v0.3.0.md).

빌드 때 `VOICESUBSEP_UPDATE_URL`을 지정하면 별도 generic/electron-updater 경로를 선택합니다. 유효한 HTTPS feed·서명/publisher 설정이 따로 필요하며 일반 0.3.0 GitHub 배포에서는 지정하지 않습니다. 실제 게시·업그레이드 수용 결과는 [릴리즈 기록](releases/v0.3.0.md)을 따릅니다.

## UI 브리지

*Renderer bridge.* `window.voicesubsepDesktop` exists only in Electron, not the normal browser. It exposes limited version/update functions, not arbitrary filesystem/process/IPC access. The main frame and expected origin are checked. Context isolation, sandbox and web security stay enabled; Node integration is disabled.

`window.voicesubsepDesktop`은 설치형 앱에만 존재합니다. 브라우저에서 열면 없는 것이 정상입니다.

```ts
type UpdateStatus = {
  state: 'unconfigured' | 'idle' | 'checking' | 'available' | 'not-available'
    | 'downloading' | 'downloaded' | 'installing' | 'error';
  configured: boolean;
  currentVersion: string;
  availableVersion?: string;
  progress?: number; // 0..100
  message?: string;
  error?: string;
};

interface DesktopBridge {
  appVersion(): Promise<string>;
  updateStatus(): Promise<UpdateStatus>;
  onUpdateStatus(callback: (status: UpdateStatus) => void): () => void;
  checkUpdate(): Promise<UpdateStatus>;
  downloadUpdate(): Promise<UpdateStatus>;
  installUpdate(): Promise<UpdateStatus>;
}
```

구독 함수는 해제 함수를 반환합니다. Renderer에 파일시스템·프로세스 실행·임의 IPC 기능을 노출하지 않습니다. main IPC는 메인 창의 최상위 프레임과 기대한 origin을 확인합니다. `contextIsolation`, `sandbox`, `webSecurity`는 켜고 `nodeIntegration`은 끕니다. 외부 탐색은 앱 안에서 차단하고 HTTP(S) 링크만 시스템 브라우저로 엽니다.

### 녹음 권한

*Capture permissions.* Microphone access is explicitly approved for the app's own main frame. Windows display/system audio capture additionally checks the user gesture and explicit selection. Shared video is not stored in recordings; system audio can contain calls, games and notifications. Recording uses local chunks. Optional live mode feeds PCM to persistent cached-only Whisper + Nemotron; the record-only mode analyzes after stopping. Device and long-duration tests are distinct from permission-handler tests.

장치 권한은 기본 거부하며 녹음 기능에 필요한 요청만 별도 확인합니다. 마이크 요청은 앱의 현재 메인 창·최상위 프레임·origin과 오디오 전용 요청을 검사한 뒤 사용자의 네이티브 확인창 응답으로 허용합니다. Windows 시스템 캡처는 해당 프레임의 사용자 동작, 오디오·영상 요청을 확인하고 화면 선택창에서 명시적으로 선택한 경우에만 loopback을 제공합니다. 외부 origin과 iframe 요청, 겹친 권한 요청은 허용하지 않습니다.

시스템 캡처에는 게임·통화·알림 등 전체 출력음이 섞일 수 있음을 안내합니다. 공유 권한에 필요한 화면 트랙은 최종 녹음 파일에 넣지 않습니다. 녹음은 약 1초 단위 IndexedDB 저장을 사용합니다. 선택한 라이브 모드는 캐시의 Whisper·Nemotron을 유지하며 약 4초 구간을 계속 처리하고, 녹음 전용 모드는 종료 후 분석합니다. 첫 결과에는 약 5초 음성 수집과 추론 시간이 필요합니다. 최대 2시간 라이브·세션 녹음 합계 2GiB이며, 개별 WASAPI 출력·ASIO 라우팅은 없습니다. OBS에는 같은 컴퓨터에서 접근하는 읽기 전용 토큰 URL을 제공하고 송출 끄기·지우기는 원본과 편집 자막을 보존합니다. 실제 장치·장시간 검증은 [릴리즈 기록](releases/v0.3.0.md)에서 확인합니다.

## 검증과 한계

*Evidence boundaries.* Current results are in the versioned release record. The historical v0.1.1 data below is retained for provenance and does not validate a newer installer. Developer Electron smoke uses a mock server/profile and is not proof of packaged-main behavior, actual NSIS installation, microphone capture, driver compatibility or a signed remote upgrade.

**0.3.0의 게시·설치·검증 상태는 [릴리즈 기록](releases/v0.3.0.md)에 모읍니다.** 아래는 v0.1.1 당시의 역사적 실행 기록이며 새 설치 파일의 성공 증거로 재사용하지 않습니다.

### v0.1.1 이전 검증 기록

2026-09-24 Python 3.12.13·PyInstaller 6.22.3으로 만든 **API 0.1.1 백엔드 번들**은 준비 검사와 실제 Nemotron + large-v3-turbo CUDA 분석을 모두 통과했습니다. 외부 Python·CUDA 경로를 제외한 시스템 전용 `PATH`, 독립 임시 데이터 폴더, 오프라인 모델 캐시 조건입니다. 준비 검사 40.875초는 모델 추론 없이 런타임·API·정상 종료를 확인했고, 별도의 GPU 스모크 39.484초는 같은 39.466625초 두 합성 음성을 실제 분석한 뒤 종료 코드 0과 포트 종료까지 확인했습니다.

결과는 화자 2명, 자막 24개, 배정 12개(인물별 6개), 미지정 12개, 겹침 검수 4개입니다. 자막·단어 시간·화자·길이는 소스 turbo 출력과 같고 모드 안내 경고 한 줄만 다릅니다. 실행 파일은 57,573,943바이트, SHA256 `04640c3d09c7e667f99896c45d7815d6deeeaec622539eff51bb32ca0f6110dd`로 직접 대조했습니다. 백엔드 폴더는 4,258개 파일·5,009,309,197바이트이며, [portable 번들 증거](evidence/nemotron-bundle-validation.json)에 기록했습니다. [모델 검증의 범위와 한계](NEMOTRON-SMOKE.md)는 별도로 확인합니다.

회귀검사 backend 198개 + web 40개 + Node 32개, 총 270개가 통과했습니다. 이는 위 실제 모델 스모크와 별도의 검사입니다. **v0.1.1 분리 설치 파일 생성은 완료했으며 실제 설치·원격 업데이트는 실행하지 않았습니다.** 로컬 산출물은 `release/nsis-web/VOICESUBSEP-0.1.1-Offline-Setup-x64.exe`와 같은 폴더의 `voicesubsep-0.1.1-x64.nsis.7z`입니다. 두 파일을 함께 보관합니다.

```powershell
npm run desktop:test
npm run desktop:smoke
npm test
npm run build
```

`desktop:test`는 URL·경로·업데이트 상태 전이, 중복 요청, 다운로드 실패 후 설치 차단을 검증합니다. `desktop:smoke`는 사용자 프로필과 분리된 임시 프로필에서 실제 Electron을 두 번 실행하여 custom scheme 요청, 한글 multipart 업로드, sandbox preload 브리지, 재시작 후 저장 유지 여부를 검사합니다. 임시 결과 경로를 출력하며 실제 사용자 미디어와 프로젝트를 읽지 않습니다.

이 검증은 GPU 모델 분석 품질, NSIS 관리자 정책, SmartScreen 신뢰도, 서명된 원격 업데이트 및 다른 PC의 드라이버 호환성을 증명하지 않습니다. 설치형 앱을 배포하기 전 별도 수용 검증에 포함해야 합니다.

참조: [Electron 보안 지침](https://www.electronjs.org/docs/latest/tutorial/security), [custom protocol API](https://www.electronjs.org/docs/latest/api/protocol), [contextBridge](https://www.electronjs.org/docs/latest/api/context-bridge), [electron-builder v26 자동 업데이트](https://www.electron.build/v26/docs/features/auto-update/), [NSIS 설정](https://www.electron.build/nsis/).
