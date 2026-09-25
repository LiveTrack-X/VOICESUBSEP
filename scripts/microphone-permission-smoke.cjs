// Run with `node scripts/microphone-permission-smoke.cjs`.
// Chromium fake inputs, hidden window and a fresh profile: no real audio devices.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process');
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const child = spawnSync(require('electron'), [__filename], { env, encoding: 'utf8', windowsHide: true, timeout: 25000 });
  process.stdout.write(child.stdout || ''); process.stderr.write(child.stderr || '');
  if (child.error) console.error(child.error.message);
  process.exit(child.status ?? 1);
}

const { app, BrowserWindow, protocol, session } = require('electron');
const { installCapturePermissions } = require('../desktop/capture-permissions.cjs');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'voicesubsep-mic-permission-'));
app.setPath('userData', profile);
app.commandLine.appendSwitch('use-fake-device-for-media-stream');
protocol.registerSchemesAsPrivileged([{ scheme: 'voicesubsep', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
let win; let prompts = 0;
async function run() {
  protocol.handle('voicesubsep', () => new Response('<!doctype html><html><body>Fake microphone permission test</body></html>', { headers: { 'Content-Type': 'text/html' } }));
  win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  installCapturePermissions({ session: session.defaultSession, getWindow: () => win, getUiUrl: () => 'voicesubsep://app/',
    dialog: { showMessageBox: async () => { prompts++; return { response: 1 }; } },
    desktopCapturer: { getSources: async () => { throw Error('Physical screen enumeration prohibited'); } },
  });
  await win.loadURL('voicesubsep://app/');
  const result = await win.webContents.executeJavaScript(`(async () => {
    const inputs = async () => (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput');
    const before = await inputs(); const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    let during; try { during = await inputs(); } finally { stream.getTracks().forEach(t => t.stop()); }
    const after = await inputs(); const fixed = after.find(d => d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications');
    if (!fixed) throw Error('An approved fake microphone is missing from the list');
    const selected = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: fixed.deviceId } }, video: false });
    const matched = selected.getAudioTracks()[0].getSettings().deviceId === fixed.deviceId;
    selected.getTracks().forEach(t => t.stop());
    let cameraDenied = false;
    try { const camera = await navigator.mediaDevices.getUserMedia({ audio: false, video: true }); camera.getTracks().forEach(t => t.stop()); }
    catch(error) { cameraDenied = error.name === 'NotAllowedError'; }
    return { beforeRestricted: before.every(d => !d.label), duringNames: during.map(d => d.label), afterNames: after.map(d => d.label), matched, cameraDenied,
      stopped: [...stream.getTracks(), ...selected.getTracks()].every(t => t.readyState === 'ended') };
  })()`);
  assert.equal(result.beforeRestricted, true);
  assert.ok(result.duringNames.length >= 3 && result.duringNames.every(label => label.startsWith('Fake ')));
  assert.deepEqual(result.afterNames, result.duringNames);
  assert.equal(result.matched, true); assert.equal(result.stopped, true); assert.equal(result.cameraDenied, true);
  assert.equal(prompts, 2, 'A second actual capture still needs explicit approval');
  await win.loadURL('voicesubsep://app/');
  const afterReload = await win.webContents.executeJavaScript(`navigator.mediaDevices.enumerateDevices().then(rows => rows.filter(d => d.kind === 'audioinput').every(d => !d.label))`);
  assert.equal(afterReload, true, 'Reload must revoke this document approval');
  const evidence = { passed: true, fakeDevices: true, physicalCapture: false, explicitPrompts: prompts, reloadRevoked: afterReload, ...result };
  const output = path.resolve(__dirname, '../tmp/microphone-permission-validation.json');
  fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2)); win.destroy(); app.exit(0);
}
app.whenReady().then(run).catch(error => { console.error(error); if (win && !win.isDestroyed()) win.destroy(); app.exit(1); });
setTimeout(() => { console.error('Microphone fake-device smoke timed out'); app.exit(2); }, 20000).unref();
