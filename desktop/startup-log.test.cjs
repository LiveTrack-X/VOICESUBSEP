const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createAppLogger } = require('./startup-log.cjs');

test('a packaged app missing its backend persists the startup failure before exiting', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voicesubsep-startup-'));
  try {
    const errors = []; let quit = false;
    const app = { isPackaged: true, setName() {}, setAppUserModelId() {}, requestSingleInstanceLock: () => true, on() {}, getPath: () => dir, whenReady: () => Promise.resolve(), quit: () => { quit = true; } };
    const electron = { app, protocol: { registerSchemesAsPrivileged() {} }, dialog: { showErrorBox: (_title, message) => errors.push(message) } };
    const source = fs.readFileSync(path.join(__dirname, 'main.cjs'), 'utf8');
    vm.runInNewContext(source, { require: (id) => id === 'electron' ? electron : require(id), process: { platform: 'win32', resourcesPath: path.join(dir, 'missing'), env: {} }, __dirname, setTimeout, clearTimeout, fetch, AbortSignal, console });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(quit, true); assert.equal(errors.length, 1);
    assert.match(fs.readFileSync(path.join(dir, 'logs', 'backend.log'), 'utf8'), /배포 파일에 백엔드 또는 웹 편집기가 없습니다/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('logging failures do not throw or prevent the startup error UI', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voicesubsep-log-'));
  try { const file = path.join(dir, 'not-a-folder'); fs.writeFileSync(file, 'x'); const log = createAppLogger(file); assert.equal(log.write('failure'), false); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
