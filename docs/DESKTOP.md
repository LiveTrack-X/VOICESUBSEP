# Windows 설치형 앱과 업데이트

이 문서는 Electron 설치형 앱의 실행·빌드·업데이트 계약입니다. 원격 업데이트 서버 공개나 코드 서명 완료를 뜻하지 않습니다. 기존 웹 개발 실행은 계속 `npm start`로 사용할 수 있습니다.

## 설치형 앱의 구조

- 제품명 `VOICESUBSEP`, 앱 ID `com.livetrack.voicesubsep`, Windows x64 NSIS 설치 프로그램입니다.
- Electron이 `resources/backend/voicesubsep-server.exe`를 임의의 `127.0.0.1` 포트로 실행합니다. 이 서버 하나가 웹 편집기와 API를 제공합니다. 개발용 5173·8787 포트를 사용하지 않습니다.
- 실행 인수는 `--port <port> --data-dir <userData>/data --web-dir <resources>/web`입니다. `/api/health`의 `status: ok`, `app: voicesubsep`을 확인한 뒤 창을 엽니다.
- 화면 주소는 `voicesubsep://app/`로 고정하고 Electron의 custom protocol에서 로컬 서버로 요청을 전달합니다. 따라서 임의 포트가 바뀌어도 자동 저장의 localStorage origin이 유지됩니다. 파일 업로드는 스트림으로 전달합니다.
- Python·FFmpeg·FFprobe는 백엔드 번들에 포함됩니다. 모델 가중치는 설치 파일에 넣지 않으며 첫 분석 때 별도 다운로드합니다.
- `<userData>/data`, Chromium 자동 저장, `<userData>/logs/backend.log`는 설치 디렉터리 밖에 보관합니다. 일반적인 Windows 위치는 `%APPDATA%/VOICESUBSEP`입니다. 로그는 약 4 MiB 단위로 직전 파일 하나를 보존합니다.
- `HF_HOME`을 덮어쓰지 않고 기존에 완성된 Hugging Face 캐시는 읽어 재사용합니다. Windows에서 새 Whisper 모델은 `%LOCALAPPDATA%/VOICESUBSEP/models/whisper` 아래에 보관합니다. 앱 업데이트는 이 두 캐시를 삭제하지 않습니다. NSIS 제거 옵션도 사용자 데이터를 자동 삭제하지 않도록 설정했습니다.

앱 종료 시 main 프로세스만 아는 임의 토큰으로 `/api/desktop/shutdown`을 요청합니다. 백엔드에 취소·정리 시간을 최대 12초 부여하고, 남아 있는 경우 앱이 실행한 PID의 프로세스 트리만 종료합니다. 진행 중인 분석을 재개하는 기능은 별도이며, 종료 전 프로젝트 파일 저장을 권장합니다.

업데이트 설치기는 백엔드 프로세스의 실제 종료를 확인한 뒤 실행합니다. 종료가 확인되지 않으면 설치를 차단하며, 설치기 실행에 실패하면 분석 서버를 복구한 뒤 오류를 표시하고 재시도를 허용합니다. 복구도 실패하면 앱을 다시 시작해야 한다는 오류를 표시합니다.

## 개발과 빌드

Node/npm과 백엔드 개발 환경은 기존 README의 설치 절차를 따릅니다.

```powershell
npm ci
npm run desktop:dev
```

`desktop:dev`는 기존 Vite/API 개발 서버와 Electron을 함께 시작하고 함께 종료합니다. 이미 `npm start`가 실행 중이면 먼저 종료해야 합니다. 개발 실행에서는 업데이트가 비활성화됩니다.

Windows 설치 파일을 만들려면 먼저 백엔드 번들을 준비합니다.

```powershell
uv pip install --python .venv\Scripts\python.exe -e './backend[whisper,gpu-windows,desktop-build]'
powershell -ExecutionPolicy Bypass -File scripts/build-backend.ps1
npm run desktop:pack
npm run desktop:installer
```

- `desktop:pack`: 웹 빌드 후 `release/win-unpacked/` 실행 폴더를 생성합니다.
- `desktop:installer`: 웹 빌드 후 `release/VOICESUBSEP-<version>-Setup-x64.exe`를 생성합니다.
- 두 명령은 `build/backend/voicesubsep-server/voicesubsep-server.exe`가 없으면 실패합니다. 백엔드를 묵시적으로 재빌드하거나 모델을 다운로드하지 않습니다.
- Electron·NSIS·코드 서명 도구가 로컬 캐시에 없으면 패키징 도구가 추가 파일을 다운로드할 수 있습니다. 오프라인 빌드에는 해당 버전의 로컬 배포 파일과 도구 경로를 먼저 준비해야 합니다.
- 빌드 스크립트는 항상 `--publish never`를 사용합니다. GitHub Release 또는 서버 업로드는 수행하지 않습니다.
- 백엔드 빌드는 NVIDIA 패키지와 FFmpeg의 원본 고지 파일을 포함하고 SHA256로 보존 여부를 확인합니다. [포함 고지 범위](BUNDLED-NOTICES.md)를 참고하세요.
- `release/`는 생성물이며 Git에 넣지 않습니다. 앱 코드는 ASAR로 묶고 웹 파일·백엔드 번들은 `extraResources`로 포함합니다. `.venv`, 원본 미디어, 개발 데이터 및 환경 설정 파일은 패키지 대상이 아닙니다.

로컬 배포를 지정하는 `electronDist`와 `ELECTRON_BUILDER_7ZIP_PATH`, `ELECTRON_BUILDER_NSIS_DIR`, `ELECTRON_BUILDER_NSIS_RESOURCES_DIR` 경로를 이용한 오프라인 NSIS 빌드를 검증했습니다. 해당 빌드는 원본 체크섬과 대조한 Electron·7zip을 사용하고 다운로드 mirror/proxy를 외부에 연결할 수 없는 loopback으로 제한했습니다. `ELECTRON_DOWNLOAD_CACHE_MODE=1`은 캐시가 없을 때 다운로드할 수 있으므로 오프라인 차단 옵션으로 사용하지 않습니다.

## 사용자가 선택하는 업데이트

자동 확인·자동 다운로드·종료 시 자동 설치는 하지 않습니다. 업데이트 확인 → 다운로드 → 저장 후 다시 시작을 각각 눌러야 합니다. `electron-updater`의 `autoDownload`와 `autoInstallOnAppQuit`은 모두 `false`입니다.

업데이트 서버가 없으면 `unconfigured` 상태와 “이 설치본에는 업데이트 서버가 설정되지 않았습니다” 메시지를 표시합니다. 이 상태에서는 확인 버튼을 호출해도 네트워크 요청이 발생하지 않습니다. 현재 버전을 무조건 최신이라고 표시하지 않습니다. 나중에 서버를 준비하더라도, 업데이트 주소가 설정된 설치본으로 한 번 수동 교체해야 앱 안에서 업데이트할 수 있습니다.

배포 담당자가 사용할 **인증 정보 없는 HTTPS generic feed**를 준비한 뒤 빌드 시 지정할 수 있습니다.

```powershell
$env:VOICESUBSEP_UPDATE_URL = 'https://updates.example.com/voicesubsep/windows/'
npm run desktop:installer
Remove-Item Env:VOICESUBSEP_UPDATE_URL
```

주소는 빌드된 앱 메타데이터와 updater 설정에 들어갑니다. HTTPS 외 프로토콜, URL 사용자명·암호, 쿼리 토큰, fragment는 거부합니다. GitHub 개인 액세스 토큰을 앱·브리지·저장소에 넣지 않습니다. 비공개 GitHub 저장소의 다운로드 주소만 지정하면 인증 없이 업데이트할 수 있는 것은 아닙니다. 별도의 배포용 HTTPS 저장소 또는 사용자 인증 설계가 필요합니다.

새 버전 배포 절차는 다음과 같습니다.

1. `package.json`의 버전을 올리고 동일한 앱 ID·feed 주소로 빌드합니다.
2. 코드 서명 인증서를 설정하고 설치본 및 업데이트 파일의 서명을 검증합니다.
3. 빌드 결과의 설치 EXE, `.blockmap`, `latest.yml`을 같은 feed 경로에 게시합니다. 업로드 완료 후 `latest.yml`을 마지막에 교체합니다.
4. 이전 버전 설치 상태에서 확인·다운로드·명시적 재시작·새 버전 확인·프로젝트와 캐시 보존을 실제 검증합니다.

현재 코드에서 Windows 업데이트 서명 검증을 끄지 않았습니다. **서명 인증서와 실제 원격 feed를 연결한 업데이트 전체 과정은 별도 검증 대상**입니다. 서명 없는 로컬 설치본은 Windows 신뢰도 경고가 발생할 수 있습니다. 로컬 설치 성공을 원격 업데이트 성공으로 간주하지 않습니다.

## UI 브리지

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

구독 함수는 해제 함수를 반환합니다. Renderer에 파일시스템·프로세스 실행·임의 IPC 기능을 노출하지 않습니다. main IPC는 메인 창의 최상위 프레임과 기대한 origin을 확인합니다. `contextIsolation`, `sandbox`, `webSecurity`는 켜고 `nodeIntegration`은 끕니다. 외부 탐색은 앱 안에서 차단하고 HTTP(S) 링크만 시스템 브라우저로 엽니다. 장치 권한은 현재 기능에 필요하지 않아 거부하며 라이브 캡처를 구현할 때 별도 검토합니다.

## 검증과 한계

```powershell
npm run desktop:test
npm run desktop:smoke
npm test
npm run build
```

`desktop:test`는 URL·경로·업데이트 상태 전이, 중복 요청, 다운로드 실패 후 설치 차단을 검증합니다. `desktop:smoke`는 사용자 프로필과 분리된 임시 프로필에서 실제 Electron을 두 번 실행하여 custom scheme 요청, 한글 multipart 업로드, sandbox preload 브리지, 재시작 후 저장 유지 여부를 검사합니다. 임시 결과 경로를 출력하며 실제 사용자 미디어와 프로젝트를 읽지 않습니다.

이 검증은 GPU 모델 분석 품질, NSIS 관리자 정책, SmartScreen 신뢰도, 서명된 원격 업데이트 및 다른 PC의 드라이버 호환성을 증명하지 않습니다. 설치형 앱을 배포하기 전 별도 수용 검증에 포함해야 합니다.

참조: [Electron 보안 지침](https://www.electronjs.org/docs/latest/tutorial/security), [custom protocol API](https://www.electronjs.org/docs/latest/api/protocol), [contextBridge](https://www.electronjs.org/docs/latest/api/context-bridge), [electron-builder v26 자동 업데이트](https://www.electron.build/v26/docs/features/auto-update/), [NSIS 설정](https://www.electron.build/nsis/).
