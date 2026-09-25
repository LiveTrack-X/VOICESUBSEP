const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validatePdfRequest, createDocumentPdfService, MAX_HTML_BYTES } = require('./document-pdf.cjs');

function fixture({ canceled = false, invalidPdf = false, renameError = false, writeError = false,
  selections, loadError = false, printError = false, pendingStage, timeoutMs = 60000, destroyError = false } = {}) {
  const calls = { destroyed: 0, writes: [], removed: [], dialogs: [], sessions: 0, requests: [], cleared: 0 };
  const isolated = {
    setPermissionRequestHandler(fn) { let allowed; fn(null, 'media', value => allowed = value); assert.equal(allowed, false); },
    setPermissionCheckHandler(fn) { assert.equal(fn(), false); },
    webRequest: { onBeforeRequest(fn) {
      if (fn === null) { calls.cleared++; calls.requestHandler = null; return; }
      calls.requestHandler = fn;
      fn({ url: 'https://example.invalid/' }, value => assert.equal(value.cancel, true));
    } },
  };
  class BrowserWindow {
    constructor(options) {
      calls.options = options;
      this.webContents = {
        setWindowOpenHandler(fn) { assert.equal(fn().action, 'deny'); },
        on(_name, fn) { let prevented = false; fn({ preventDefault() { prevented = true; } }); assert.equal(prevented, true); },
        async printToPDF(options) {
          calls.print = options;
          if (printError) throw new Error('print unavailable');
          if (pendingStage === 'print') return new Promise(() => {});
          return Buffer.from(invalidPdf ? 'bad' : '%PDF-1.7\nexample');
        },
      };
    }
    async loadURL(url) {
      calls.url = url;
      for (const details of [
        { url, resourceType: 'mainFrame' }, { url, resourceType: 'subFrame' },
        { url: `${url}#other`, resourceType: 'mainFrame' },
        { url: 'file:///C:/private/secret.txt', resourceType: 'mainFrame' },
        { url: 'https://example.invalid/', resourceType: 'image' },
        { url: 'data:text/html,foreign', resourceType: 'mainFrame' },
      ]) calls.requestHandler(details, result => calls.requests.push({ details, result }));
      if (loadError) throw new Error('load unavailable');
      if (pendingStage === 'load') return new Promise(() => {});
    }
    isDestroyed() { return false; }
    destroy() { calls.destroyed++; if (destroyError) throw new Error('renderer exited'); }
  }
  const service = createDocumentPdfService({ BrowserWindow,
    session: { fromPartition(name, options) { calls.sessions++; assert.ok(!name.startsWith('persist:')); assert.equal(options.cache, false); return isolated; } },
    dialog: { async showSaveDialog(_parent, options) {
      calls.dialog = { ...options }; calls.dialogs.push({ ...options });
      return selections ? selections.shift() : { canceled, filePath: 'C:\\exports\\회의록.pdf' };
    } },
    getWindow: () => ({}),
    fileSystem: {
      async writeFile(file, bytes, options) { calls.writes.push({ file, bytes, options }); if (writeError) throw new Error('write unavailable'); },
      async rename(from, to) { calls.rename = { from, to }; if (renameError) throw new Error('disk unavailable'); },
      async unlink(file) { calls.removed.push(file); },
    },
    timeoutMs,
  });
  return { service, calls };
}
const request = { html: '<h1>참가자: 발언</h1>', suggestedName: '회의록.pdf' };

test('validates and restricts document payload before opening a dialog', () => {
  for (const invalid of [null, {}, { ...request, html: '' }, { ...request, html: '가'.repeat(MAX_HTML_BYTES) }, { ...request, path: 'C:\\secret' }]) {
    assert.throws(() => validatePdfRequest(invalid));
  }
  const safe = validatePdfRequest({ ...request, suggestedName: '../meeting?notes' });
  assert.equal(safe.suggestedName, '.._meeting_notes.pdf');
  assert.match(safe.html, /default-src 'none'/);
});
test('cancelling save never creates a renderer or writes a file', async () => {
  const { service, calls } = fixture({ canceled: true });
  assert.deepEqual(await service(request), { status: 'cancelled' });
  assert.equal(calls.options, undefined);
  assert.equal(calls.writes.length, 0);
});
test('isolates rendering and atomically saves a PDF', async () => {
  const { service, calls } = fixture();
  assert.deepEqual(await service(request), { status: 'saved', filePath: 'C:\\exports\\회의록.pdf' });
  assert.equal(calls.options.show, false);
  assert.equal(calls.options.webPreferences.javascript, false);
  assert.equal(calls.options.webPreferences.sandbox, true);
  assert.equal(calls.options.webPreferences.nodeIntegration, false);
  assert.match(calls.url, /^data:text\/html/);
  assert.equal(calls.writes[0].options.flag, 'wx');
  assert.equal(calls.rename.to, 'C:\\exports\\회의록.pdf');
  assert.equal(calls.destroyed, 1);
  assert.equal(calls.cleared, 1);
  assert.deepEqual(calls.requests.map(item => item.result.cancel), [false, true, true, true, true, true]);
});
test('invalid PDF does not overwrite destination and busy flag recovers', async () => {
  const { service, calls } = fixture({ invalidPdf: true });
  await assert.rejects(service(request), /PDF 파일/);
  await assert.rejects(service(request), /PDF 파일/);
  assert.equal(calls.writes.length, 0);
  assert.equal(calls.destroyed, 2);
});
test('save failure removes temporary bytes and closes renderer', async () => {
  const { service, calls } = fixture({ renameError: true });
  await assert.rejects(service(request), /disk unavailable/);
  assert.equal(calls.removed[0], calls.writes[0].file);
  assert.equal(calls.destroyed, 1);
});
test('only one save dialog can be pending', async () => {
  let resolve;
  const service = createDocumentPdfService({ dialog: { showSaveDialog: () => new Promise(done => resolve = done) }, getWindow() {} });
  const first = service(request);
  await assert.rejects(service(request), /다른 PDF/);
  resolve({ canceled: true });
  await first;
});

test('an appended PDF extension is confirmed at its exact overwrite destination', async () => {
  const { service, calls } = fixture({ selections: [
    { canceled: false, filePath: 'C:\\exports\\existing' },
    { canceled: false, filePath: 'C:\\exports\\existing.pdf' },
  ] });
  assert.deepEqual(await service(request), { status: 'saved', filePath: 'C:\\exports\\existing.pdf' });
  assert.equal(calls.dialogs.length, 2);
  assert.equal(calls.dialogs[1].defaultPath, 'C:\\exports\\existing.pdf');
  assert.ok(calls.dialogs[1].properties.includes('showOverwriteConfirmation'));
  assert.equal(calls.rename.to, calls.dialogs[1].defaultPath);
});

test('cancelling the final extension confirmation preserves the existing PDF', async () => {
  const { service, calls } = fixture({ selections: [
    { canceled: false, filePath: 'C:\\exports\\existing' }, { canceled: true },
  ] });
  assert.deepEqual(await service(request), { status: 'cancelled' });
  assert.equal(calls.writes.length, 0);
  assert.equal(calls.sessions, 0);
});

test('repeated saves reuse an isolated session without retaining document listeners', async () => {
  const { service, calls } = fixture();
  await service(request);
  assert.equal(calls.requestHandler, null);
  await service({ ...request, html: '<h1>Another private document</h1>' });
  assert.equal(calls.sessions, 1);
  assert.equal(calls.destroyed, 2);
  assert.equal(calls.cleared, 2);
  assert.equal(calls.requestHandler, null);
});

for (const stage of ['load', 'print']) {
  test(`${stage} timeout destroys the renderer and releases the next export`, async () => {
    const { service, calls } = fixture({ pendingStage: stage, timeoutMs: 10 });
    await assert.rejects(service(request), /시간이 초과/);
    await assert.rejects(service(request), /시간이 초과/);
    assert.equal(calls.writes.length, 0);
    assert.equal(calls.destroyed, 2);
    assert.equal(calls.requestHandler, null);
  });
}

for (const [option, message] of [['loadError', /load unavailable/], ['printError', /print unavailable/],
  ['writeError', /write unavailable/], ['destroyError', /renderer exited/]]) {
  test(`${option} closes the renderer and does not permanently hold the busy flag`, async () => {
    const { service, calls } = fixture({ [option]: true });
    await assert.rejects(service(request), message);
    await assert.rejects(service(request), message);
    assert.equal(calls.destroyed, 2);
    assert.equal(calls.requestHandler, null);
    if (option === 'writeError') assert.equal(calls.removed.length, 2);
  });
}
