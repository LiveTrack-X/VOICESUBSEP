const { app, BrowserWindow, desktopCapturer, dialog, ipcMain, protocol, session, shell } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const tcp = require('node:net');
const { randomBytes } = require('node:crypto');
const { APP_URL, sameOrigin, externalUrl, backendPaths, backendArguments } = require('./helpers.cjs');
const { createProxyHandler } = require('./proxy.cjs');
const { UpdateController } = require('./updater.cjs');
const { ReleaseUpdater } = require('./release-updater.cjs');
const { hasExited, stopOwnedBackend } = require('./backend-lifecycle.cjs');
const { createAppLogger } = require('./startup-log.cjs');
const { installCapturePermissions } = require('./capture-permissions.cjs');
const { createDocumentPdfService } = require('./document-pdf.cjs');

app.setName('VOICESUBSEP');
if (process.platform === 'win32') app.setAppUserModelId('com.livetrack.voicesubsep');
protocol.registerSchemesAsPrivileged([{ scheme: 'voicesubsep', privileges: {
  standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true,
} }]);

let mainWindow;
let backend;
let backendExit;
let stopping;
let quitting = false;
let uiUrl = APP_URL;
let appLog;
let backendOrigin;
let backendToken;
let preparingUpdate = false;
const expectedExits = new WeakSet();

function log(message) {
  appLog?.write(message);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = tcp.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function stopBackend({ requireExit = false } = {}) {
  if (hasExited(backend)) return true;
  const child = backend;
  expectedExits.add(child);
  if (!stopping) stopping = stopOwnedBackend({
    child,
    shutdown: async () => {
      const response = await fetch(`${backendOrigin}/api/desktop/shutdown`, { method: 'POST', headers: { 'X-VoiceSubSep-Token': backendToken }, signal: AbortSignal.timeout(1500) });
      if (!response.ok) throw new Error(`백엔드 종료 요청 실패 (${response.status})`);
    },
    forceKill: () => new Promise((resolve, reject) => {
      if (process.platform === 'win32') {
        // This app owns only this process tree; never kill by executable name or port.
        const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { shell: false, windowsHide: true, stdio: 'ignore' });
        killer.once('error', reject);
        killer.once('exit', () => resolve());
      } else {
        child.kill('SIGKILL');
        resolve();
      }
    }),
  });
  try {
    const exited = await stopping;
    if (requireExit && !exited) throw new Error('백엔드 종료를 확인하지 못해 업데이트 설치를 중단했습니다. 앱을 다시 시작한 뒤 시도하세요.');
    return exited;
  } catch (error) {
    log(`Backend shutdown: ${error.message}\n`);
    if (requireExit) throw error;
    return false;
  }
}

async function waitForBackend(origin) {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    if (backendExit) throw new Error(`백엔드가 시작 중 종료되었습니다: ${backendExit}`);
    try {
      const response = await fetch(`${origin}/api/ready`, { signal: AbortSignal.timeout(1500) });
      const body = response.ok ? await response.json() : null;
      if (body?.status === 'ok' && body?.app === 'voicesubsep') return;
    } catch { /* The bundled interpreter may still be initializing. */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('백엔드 준비 시간이 초과되었습니다. logs/backend.log를 확인하세요.');
}

async function startBackend() {
  if (backend && !hasExited(backend)) throw new Error('기존 백엔드가 아직 실행 중입니다.');
  backendExit = null;
  stopping = null;
  const paths = backendPaths(process.resourcesPath, app.getPath('userData'));
  if (!fs.existsSync(paths.executable) || !fs.existsSync(path.join(paths.webDir, 'index.html'))) {
    throw new Error('배포 파일에 백엔드 또는 웹 편집기가 없습니다. 전체 설치본으로 다시 설치하세요.');
  }
  fs.mkdirSync(paths.dataDir, { recursive: true });
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  backendOrigin = origin;
  backendToken = randomBytes(32).toString('hex');
  log(`\n[${new Date().toISOString()}] Starting backend on ${origin}\n`);
  backend = spawn(paths.executable, backendArguments(port, paths), {
    shell: false, windowsHide: true, cwd: path.dirname(paths.executable),
    stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PYTHONUNBUFFERED: '1', VOICESUBSEP_DESKTOP_TOKEN: backendToken },
  });
  const child = backend;
  backend.stdout.on('data', log);
  backend.stderr.on('data', log);
  backend.once('error', (error) => { backendExit = error.message; log(`${error.message}\n`); });
  backend.once('exit', (code, signal) => {
    backendExit = `code=${code}, signal=${signal}`;
    log(`Backend exited: ${backendExit}\n`);
    if (!quitting && !preparingUpdate && !expectedExits.has(child) && mainWindow && !mainWindow.isDestroyed()) {
      dialog.showErrorBox('VOICESUBSEP 백엔드 종료', '분석 서버가 종료되었습니다. 프로젝트 파일을 저장한 뒤 앱을 다시 시작하세요.');
    }
  });
  await waitForBackend(origin);
  if (protocol.isProtocolHandled('voicesubsep')) protocol.unhandle('voicesubsep');
  protocol.handle('voicesubsep', createProxyHandler(origin, (url, options) => fetch(url, options)));
}

function validSender(event) {
  return mainWindow && !mainWindow.isDestroyed() && event.sender === mainWindow.webContents
    && event.senderFrame === mainWindow.webContents.mainFrame && sameOrigin(event.senderFrame.url, uiUrl);
}

function installIpc(updates) {
  const saveDocumentPdf = createDocumentPdfService({ BrowserWindow, session, dialog, getWindow: () => mainWindow });
  const methods = {
    'desktop:version': () => app.getVersion(),
    'desktop:update-status': () => updates.snapshot(),
    'desktop:update-check': () => updates.check(),
    'desktop:update-download': () => updates.download(),
    'desktop:update-install': () => updates.install(),
    'desktop:save-document-pdf': request => saveDocumentPdf(request),
  };
  for (const [channel, handler] of Object.entries(methods)) {
    ipcMain.handle(channel, (event, request) => {
      if (!validSender(event)) throw new Error('허용되지 않은 앱 요청입니다.');
      return handler(request);
    });
  }
  updates.on('status', (status) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('desktop:update-status-changed', status);
  });
}

function openExternal(value) {
  const safe = externalUrl(value);
  if (safe) void shell.openExternal(safe).catch((error) => log(`External link: ${error.message}\n`));
}

async function start() {
  appLog = createAppLogger(path.join(app.getPath('userData'), 'logs'));
  if (!app.isPackaged) {
    const devUrl = process.env.VOICESUBSEP_DEV_URL || 'http://127.0.0.1:5173/';
    if (!sameOrigin(devUrl, 'http://127.0.0.1:5173/')) throw new Error('개발 UI는 http://127.0.0.1:5173/만 허용합니다.');
    uiUrl = devUrl;
  } else await startBackend();

  installCapturePermissions({ session: session.defaultSession, getWindow: () => mainWindow, getUiUrl: () => uiUrl, dialog, desktopCapturer });
  const { autoUpdater } = require('electron-updater');
  const metadata = require(path.join(app.getAppPath(), 'package.json'));
  const releaseUpdater = metadata.desktopUpdateProvider === 'github-split' ? new ReleaseUpdater({
    version: app.getVersion(), cacheDir: path.join(app.getPath('userData'), 'updates'),
    publicKey: fs.readFileSync(path.join(__dirname, 'update-public-key.pem')),
    launch: installer => new Promise((resolve, reject) => {
      const child = spawn(installer, ['--updated', '/S', '--force-run', `/D=${path.dirname(app.getPath('exe'))}`], { detached: true, stdio: 'ignore', windowsHide: true });
      child.once('error', reject); child.once('spawn', () => { child.unref(); resolve(); });
    }), quit: () => app.quit(),
  }) : autoUpdater;
  const updates = new UpdateController({ updater: releaseUpdater, version: app.getVersion(),
    feed: metadata.desktopUpdateUrl, packaged: app.isPackaged,
    beforeInstall: async () => {
      preparingUpdate = true;
      session.defaultSession.flushStorageData();
      await stopBackend({ requireExit: true });
    },
    recoverInstall: async () => {
      try {
        if (hasExited(backend)) await startBackend();
        else {
          stopping = null;
          const response = await fetch(`${backendOrigin}/api/ready`, { signal: AbortSignal.timeout(3000) });
          const health = response.ok ? await response.json() : null;
          if (health?.status !== 'ok' || health?.app !== 'voicesubsep') throw new Error('분석 서버에 다시 연결하지 못했습니다. 프로젝트 파일을 저장하고 앱을 다시 시작하세요.');
          expectedExits.delete(backend);
        }
      } finally { preparingUpdate = false; }
    },
  });
  installIpc(updates);
  mainWindow = new BrowserWindow({
    title: 'VOICESUBSEP', width: 1440, height: 940, minWidth: 480, minHeight: 640,
    icon: path.join(__dirname, 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    backgroundColor: '#101114', show: false, autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, webviewTag: false },
  });
  mainWindow.removeMenu();
  mainWindow.webContents.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: 'deny' }; });
  mainWindow.webContents.on('will-navigate', (event, url) => { if (!sameOrigin(url, uiUrl)) { event.preventDefault(); openExternal(url); } });
  mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault());
  mainWindow.once('ready-to-show', () => mainWindow.show());
  await mainWindow.loadURL(uiUrl);
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); } });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', (event) => {
    if (quitting) return;
    event.preventDefault();
    quitting = true;
    session.defaultSession.flushStorageData();
    void stopBackend().finally(() => app.quit());
  });
  app.whenReady().then(start).catch(async (error) => {
    log(`${error.stack ?? error.message}\n`);
    dialog.showErrorBox('VOICESUBSEP 시작 실패', error.message);
    quitting = true;
    await stopBackend();
    app.quit();
  });
}
