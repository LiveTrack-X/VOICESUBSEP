const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');
const { createInstalledFontsService } = require('./installed-fonts.cjs');

test('font discovery is explicit, local, bounded, cached and shares concurrent reads', async () => {
  const calls = [];
  const discover = createInstalledFontsService({ platform: 'win32', systemRoot: 'C:\\Windows',
    execute: async (...args) => { calls.push(args); return { stdout: '\ufeff[" Arial ","나눔고딕","Arial","bad,name","bad\\nname","A_B (UI)",42]' }; } });
  assert.equal(calls.length, 0);
  const [first, second] = await Promise.all([discover(), discover()]);
  assert.equal(first.available, true);
  assert.deepEqual(first.fonts, ['A_B (UI)', 'Arial', '나눔고딕']);
  assert.deepEqual(second, first);
  await discover();
  assert.equal(calls.length, 1);
  assert.match(calls[0][0], /WindowsPowerShell[\\/]v1\.0[\\/]powershell\.exe$/);
  assert.equal(calls[0][2].windowsHide, true);
  assert.equal(calls[0][2].timeout, 15000);
  assert.equal(calls[0][1].includes('-NoProfile'), true);
});

test('discovery failures remain retryable and other platforms use manual font names', async () => {
  let calls = 0;
  const discover = createInstalledFontsService({ platform: 'win32', execute: async () => {
    if (++calls === 1) throw new Error('private system path');
    return { stdout: '["Malgun Gothic"]' };
  } });
  const failed = await discover();
  assert.equal(failed.available, false);
  assert.doesNotMatch(failed.issue, /private/);
  assert.equal((await discover()).available, true);
  assert.equal(calls, 2);
  const unsupported = createInstalledFontsService({ platform: 'linux', execute: () => assert.fail('No process allowed') });
  assert.deepEqual((await unsupported()).fonts, []);
});

test('malformed or oversized font lists never enter the renderer', async () => {
  for (const stdout of ['{}', 'not-json', JSON.stringify(Array(4097).fill('Arial'))]) {
    const discover = createInstalledFontsService({ platform: 'win32', execute: async () => ({ stdout }) });
    assert.equal((await discover()).available, false);
  }
});

test('preload exposes only a no-argument local font listing command', async () => {
  const calls = [];
  let bridge;
  vm.runInNewContext(await fs.readFile(path.join(__dirname, 'preload.cjs'), 'utf8'), { require: () => ({
    contextBridge: { exposeInMainWorld: (_name, value) => { bridge = value; } },
    ipcRenderer: { invoke: (...args) => { calls.push(args); return Promise.resolve({ available: true, fonts: [] }); } }, webUtils: {},
  }) });
  await bridge.listFonts({ command: 'untrusted', path: 'private-font-file' });
  assert.deepEqual(calls, [['desktop:list-fonts']]);
});
