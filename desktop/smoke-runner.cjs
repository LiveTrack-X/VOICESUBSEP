// Isolated Electron integration harness, excluded from installed applications.
const { app, BrowserWindow, ipcMain, protocol, session } = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { APP_URL } = require('./helpers.cjs');
const { createProxyHandler } = require('./proxy.cjs');

const fixtureDir = process.env.VOICESUBSEP_SMOKE_DIR;
if (!fixtureDir) throw new Error('Run npm run desktop:smoke.');
app.setPath('userData', fixtureDir);
protocol.registerSchemesAsPrivileged([{ scheme: 'voicesubsep', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }]);
let server;
let window;
async function run() {
  server = http.createServer(async (request, response) => {
    response.setHeader('access-control-allow-origin', 'voicesubsep://app');
    response.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
    response.setHeader('access-control-allow-headers', 'Content-Type');
    if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
    if (request.url === '/api/echo') {
      const parts = [];
      for await (const chunk of request) parts.push(chunk);
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ method: request.method, origin: request.headers.origin, secFetchSite: request.headers['sec-fetch-site'], contentType: request.headers['content-type'], body: Buffer.concat(parts).toString('utf8') }));
    } else {
      response.setHeader('content-type', 'text/html; charset=utf-8');
      response.end('<!doctype html><html><body>VOICESUBSEP isolated smoke</body></html>');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  protocol.handle('voicesubsep', createProxyHandler(origin, (url, options) => fetch(url, options)));
  ipcMain.handle('desktop:version', () => 'smoke');
  ipcMain.handle('desktop:update-status', () => ({ state: 'unconfigured', configured: false, currentVersion: 'smoke' }));
  window = new BrowserWindow({ show: false, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  await window.loadURL(APP_URL);
  const result = await window.webContents.executeJavaScript(`(async () => {
    const previous = localStorage.getItem('smoke.persist');
    localStorage.setItem('smoke.persist', '한글 persistence');
    const data = new FormData(); data.append('file', new Blob(['한글 upload ' + 'x'.repeat(65536)]), '한글 테스트.txt');
    const response = await fetch('/api/echo', { method: 'POST', body: data });
    const echo = await response.json();
    return { previous, origin: location.href, version: await window.voicesubsepDesktop.appVersion(), update: await window.voicesubsepDesktop.updateStatus(), node: typeof require, echo };
  })()`);
  assert.equal(result.origin, APP_URL);
  assert.equal(result.version, 'smoke');
  assert.equal(result.node, 'undefined');
  assert.equal(result.update.state, 'unconfigured');
  assert.equal(result.echo.method, 'POST');
  assert.equal(result.echo.origin, 'voicesubsep://app');
  assert.match(result.echo.contentType, /^multipart\/form-data; boundary=/);
  assert.match(result.echo.body, /한글 upload/);
  if (process.env.VOICESUBSEP_SMOKE_RESTART === '1') assert.equal(result.previous, '한글 persistence');
  session.defaultSession.flushStorageData();
  fs.writeFileSync(path.join(fixtureDir, 'result.json'), JSON.stringify({ ok: true, restarted: process.env.VOICESUBSEP_SMOKE_RESTART === '1', port: server.address().port, unicodeUpload: true, sandbox: true, bridge: true, origin: result.echo.origin, secFetchSite: result.echo.secFetchSite ?? null }));
}

app.whenReady().then(run).then(() => {
  window.destroy();
  server.close(() => app.exit(0));
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
