const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { createHash } = require('node:crypto');
const { createMediaRelinkService, hashFile } = require('./media-relink.cjs');
const mediaId = '1'.repeat(32), newId = '2'.repeat(32);
const digest = data => ({ sha256: createHash('sha256').update(data).digest('hex'), bytes: data.length });
const body = Buffer.from('synthetic audio fixture; not personal media');
const expected = digest(body);
const info = (id = mediaId, data = body) => ({ id, name: 'recording.wav', duration: 1, audioTracks: [{ index: 0, channels: 1, label: 'Audio' }], url: `/api/media/${id}/file`, ...digest(data) });
async function fixture(t, fetchRequest) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'voicesubsep-media-relink-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const original = path.join(directory, 'original.wav'); await fs.writeFile(original, body);
  const service = createMediaRelinkService({ registryPath: path.join(directory, 'links.json'), getOrigin: () => 'http://127.0.0.1:12345', fetchRequest });
  const request = { projectId: 'project-1', identity: expected, operationId: 'restore-1' };
  const registration = { ...request, path: original, mediaId };
  return { directory, original, service, request, registration };
}
function cachedFetch(url) { return Promise.resolve(url.endsWith('/file') ? new Response(body) : Response.json(info())); }

test('same physical path and identity reconnect using the same verified cache ID without copying the original', async t => {
  const calls = [];
  const f = await fixture(t, async (...args) => { calls.push(args); return cachedFetch(...args); });
  assert.deepEqual(await f.service.register(f.registration), { remembered: true });
  const actual = await f.service.restore(f.request);
  assert.equal(actual.status, 'ready'); assert.equal(actual.media.id, mediaId);
  assert.equal(calls.length, 2); assert.ok(calls.every(([, options]) => !options.method));
  assert.ok(await hashFile(f.original, expected));
  assert.equal(JSON.stringify(actual).includes(f.directory), false);
  // A new main-process service reads the persisted project-scoped permission.
  const restarted = createMediaRelinkService({ registryPath: path.join(f.directory, 'links.json'), getOrigin: () => 'http://127.0.0.1:12345', fetchRequest: cachedFetch });
  assert.equal((await restarted.restore(f.request)).status, 'ready');
});

test('unrecorded projects and a different identity do not inspect another project original', async t => {
  const f = await fixture(t, () => assert.fail('no server request expected'));
  assert.equal((await f.service.restore(f.request)).status, 'unremembered');
  await f.service.register(f.registration);
  assert.equal((await f.service.restore({ ...f.request, projectId: 'another' })).status, 'unremembered');
  assert.equal((await f.service.restore({ ...f.request, identity: digest(Buffer.from('other')) })).status, 'unremembered');
});

test('missing and same-size modified originals never fall back to an old cache', async t => {
  const f = await fixture(t, () => assert.fail('changed original must not query cache'));
  await f.service.register(f.registration);
  await fs.writeFile(f.original, Buffer.alloc(body.length, 88));
  assert.equal((await f.service.restore(f.request)).status, 'changed');
  await fs.unlink(f.original);
  assert.equal((await f.service.restore(f.request)).status, 'missing');
});

test('an evicted cache is recreated with a bounded streamed multipart upload and final hash verification', async t => {
  let uploaded;
  const f = await fixture(t, async (url, options) => {
    if (options.method !== 'POST') return new Response('', { status: 404 });
    assert.equal(url, 'http://127.0.0.1:12345/api/media');
    assert.equal(options.headers.Origin, 'voicesubsep://app');
    assert.equal(options.redirect, 'error'); assert.equal(options.duplex, 'half');
    assert.equal(typeof options.body[Symbol.asyncIterator], 'function');
    const parts = []; for await (const part of options.body) parts.push(part);
    uploaded = Buffer.concat(parts);
    assert.equal(uploaded.length, Number(options.headers['Content-Length']));
    assert.ok(uploaded.includes(body)); return Response.json(info(newId));
  });
  await f.service.register(f.registration);
  assert.equal((await f.service.restore(f.request)).media.id, newId);
  assert.ok(uploaded); assert.ok(await hashFile(f.original, expected));
  assert.equal(JSON.parse(await fs.readFile(path.join(f.directory, 'links.json')))[0].mediaId, newId);
});

test('corrupt cached bytes cannot be attached just because metadata claims the expected hash', async t => {
  let posts = 0;
  const f = await fixture(t, async (url, options) => {
    if (options.method === 'POST') { posts++; for await (const _ of options.body) {} return Response.json(info(newId)); }
    return url.endsWith('/file') ? new Response(Buffer.alloc(body.length)) : Response.json(info());
  });
  await f.service.register(f.registration);
  assert.equal((await f.service.restore(f.request)).media.id, newId); assert.equal(posts, 1);
});

test('same-size path mutation after initial hash is rejected when the actual copied hash differs', async t => {
  let original;
  const changed = Buffer.alloc(body.length, 90);
  const f = await fixture(t, async (_url, options) => {
    if (options.method !== 'POST') { await fs.writeFile(original, changed); return new Response('', { status: 404 }); }
    for await (const _ of options.body) {} return Response.json(info(newId, changed));
  }); original = f.original;
  await f.service.register(f.registration);
  const result = await f.service.restore(f.request);
  assert.notEqual(result.status, 'ready'); assert.equal(result.media, undefined);
});

test('cancellation aborts ongoing native fetch and never returns a ready source', async t => {
  let started; const entered = new Promise(resolve => { started = resolve; });
  const f = await fixture(t, async (_url, options) => { started(); return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted')))); });
  await f.service.register(f.registration);
  const operation = f.service.restore(f.request); await entered;
  f.service.cancel(f.request.operationId);
  assert.deepEqual(await operation, { status: 'cancelled' });
});

test('malformed registry and requests fail closed without leaking paths', async t => {
  const f = await fixture(t, () => assert.fail('no request'));
  await fs.writeFile(path.join(f.directory, 'links.json'), '{corrupt');
  assert.equal((await f.service.restore(f.request)).status, 'unremembered');
  assert.deepEqual(await f.service.register({ ...f.registration, path: '../private.txt' }), { remembered: false });
  assert.deepEqual(await f.service.restore({ ...f.request, identity: { sha256: 'x', bytes: 1 } }), { status: 'unavailable' });
});

test('restoration waits for an in-flight remembered path write and preserves independent project records', async t => {
  const f = await fixture(t, cachedFetch);
  const first = f.service.register(f.registration);
  const second = f.service.register({ ...f.registration, projectId: 'project-2' });
  const result = await f.service.restore(f.request);
  await Promise.all([first, second]);
  assert.equal(result.status, 'ready');
  assert.equal((await f.service.restore({ ...f.request, projectId: 'project-2' })).status, 'ready');
});

test('a non-loopback backend cannot receive the remembered original', async t => {
  const f = await fixture(t, cachedFetch); await f.service.register(f.registration);
  const service = createMediaRelinkService({ registryPath: path.join(f.directory, 'links.json'), getOrigin: () => 'https://example.com', fetchRequest: () => assert.fail('no external request allowed') });
  assert.deepEqual(await service.restore(f.request), { status: 'unavailable' });
});

test('preload uses the real selected File path and ignores arbitrary JSON path injection', async () => {
  const calls = []; let bridge;
  const selectedFile = {};
  const electron = {
    contextBridge: { exposeInMainWorld: (_name, value) => { bridge = value; } },
    ipcRenderer: { invoke: (...args) => { calls.push(args); return Promise.resolve({ remembered: true }); } },
    webUtils: { getPathForFile: file => file === selectedFile ? 'C:\\chosen\\original.wav' : '' },
  };
  vm.runInNewContext(await fs.readFile(path.join(__dirname, 'preload.cjs'), 'utf8'), { require: () => electron });
  await bridge.rememberMedia(selectedFile, { projectId: 'p', identity: expected, mediaId, path: 'C:\\private\\secret.txt' });
  assert.equal(calls[0][1].path, 'C:\\chosen\\original.wav');
  await bridge.rememberMedia({}, { path: 'C:\\private\\secret.txt' });
  assert.equal(calls.length, 1);
  await bridge.restoreMedia({ projectId: 'p', identity: expected, operationId: 'o', path: 'C:\\private\\secret.txt' });
  assert.equal(calls[1][1].path, undefined);
});
