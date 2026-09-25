const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash, generateKeyPairSync, sign } = require('node:crypto');
const { ReleaseUpdater, RELEASE_FEED, validateManifest, newer } = require('./release-updater.cjs');
const { UpdateController } = require('./updater.cjs');

const keys = generateKeyPairSync('ed25519');
const hash = b => createHash('sha256').update(b).digest('hex');
async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'voicesubsep-update-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const version = '0.3.0', prefix = `https://github.com/LiveTrack-X/VOICESUBSEP/releases/download/v${version}/`;
  const payload = Buffer.from('synthetic package data'), exe = Buffer.from('synthetic installer');
  const entry = (name, bytes) => ({ name, size: bytes.length, sha256: hash(bytes) });
  const parts = [payload.subarray(0, 8), payload.subarray(8)];
  const m = { schemaVersion: 1, version, installer: entry(`VOICESUBSEP-${version}-Offline-Setup-x64.exe`, exe),
    payload: { ...entry(`voicesubsep-${version}-x64.nsis.7z`, payload), parts: parts.map((b, i) => entry(`voicesubsep-${version}-x64.nsis.7z.part00${i + 1}`, b)) } };
  const bytes = Buffer.from(JSON.stringify(m)), signature = sign(null, bytes, keys.privateKey);
  const files = new Map([['installer-manifest.json', bytes], ['installer-manifest.sig', signature], [m.installer.name, exe], ...m.payload.parts.map((p, i) => [p.name, parts[i]])]);
  const release = { tag_name: `v${version}`, draft: false, prerelease: true, published_at: '2026-09-25T00:00:00Z', assets: [...files].map(([name, data]) => ({ name, size: data.length, state: 'uploaded', browser_download_url: prefix + name })) };
  const calls = [], launched = [], events = []; let quits = 0;
  const updater = new ReleaseUpdater({ version: '0.2.1', cacheDir: directory, publicKey: keys.publicKey, bytesPerSecond: 1e9,
    fetcher: async url => { calls.push(url); if (url === RELEASE_FEED) return new Response(JSON.stringify([release])); const name = url.slice(prefix.length); return files.has(name) ? new Response(files.get(name)) : new Response('', { status: 404 }); },
    launch: async file => launched.push(file), quit: () => quits++ });
  for (const name of ['update-available', 'update-not-available', 'update-downloaded', 'download-progress']) updater.on(name, value => events.push([name, value]));
  return { updater, m, bytes, signature, files, release, directory, payload, exe, calls, launched, events, quits: () => quits };
}
test('only newer bounded semantic versions are accepted', () => {
  assert.equal(newer('0.10.0', '0.9.0'), true);
  for (const v of ['0.2.1', '0.1.9', 'main', '../0.4.0', '99999999999.0.0']) assert.equal(newer(v, '0.2.1'), false);
});
test('manifest signature, version, ordered parts and total sizes are required', async t => {
  const f = await fixture(t);
  assert.deepEqual(validateManifest(f.bytes, f.signature, keys.publicKey, '0.3.0'), f.m);
  assert.throws(() => validateManifest(Buffer.concat([f.bytes, Buffer.from(' ')]), f.signature, keys.publicKey, '0.3.0'), /서명/);
  assert.throws(() => validateManifest(f.bytes, f.signature, keys.publicKey, '0.4.0'), /버전/);
  for (const mutate of [m => m.installer.name = '../escape.exe', m => m.payload.parts.reverse(), m => m.payload.size++, m => m.payload.parts = [], m => m.installer.size = 40 * 1024 ** 2]) {
    const m = structuredClone(f.m); mutate(m); const b = Buffer.from(JSON.stringify(m));
    assert.throws(() => validateManifest(b, sign(null, b, keys.privateKey), keys.publicKey, '0.3.0'));
  }
});
test('explicit check downloads metadata only, then verifies/assembles before install', async t => {
  const f = await fixture(t); assert.equal(f.calls.length, 0);
  await assert.rejects(f.updater.quitAndInstall(), /검증/);
  await f.updater.checkForUpdates(); assert.equal(f.calls.length, 3); assert.equal(f.launched.length, 0);
  await f.updater.downloadUpdate();
  assert.deepEqual(await fs.readFile(path.join(f.directory, '0.3.0', f.m.payload.name)), f.payload);
  assert.equal(f.launched.length, 0); assert.equal(f.events.at(-1)[0], 'update-downloaded');
  await f.updater.quitAndInstall(); assert.equal(f.launched.length, 1); assert.equal(f.quits(), 1);
});
test('draft, older and unsigned releases cannot become update candidates', async t => {
  const f = await fixture(t);
  for (const state of ['draft', 'older', 'unsigned']) {
    const r = structuredClone(f.release);
    if (state === 'draft') r.draft = true;
    if (state === 'older') r.tag_name = 'v0.1.0';
    if (state === 'unsigned') r.assets = r.assets.filter(a => !a.name.endsWith('.sig'));
    f.updater.fetcher = async () => new Response(JSON.stringify([r]));
    await f.updater.checkForUpdates(); assert.equal(f.updater.release, null);
    assert.equal(f.events.at(-1)[0], 'update-not-available');
  }
});
test('altered data never produces a ready installer and verified cache is reused', async t => {
  const f = await fixture(t); await f.updater.checkForUpdates();
  const badName = f.m.payload.parts[1].name, original = f.files.get(badName);
  f.files.set(badName, Buffer.alloc(original.length));
  await assert.rejects(f.updater.downloadUpdate(), /체크섬/);
  await assert.rejects(f.updater.quitAndInstall(), /검증/);
  f.files.set(badName, original); const before = f.calls.length;
  await f.updater.downloadUpdate(); assert.equal(f.calls.length - before, 1);
});
test('installation rechecks payloads and a launch failure does not quit', async t => {
  const f = await fixture(t); await f.updater.checkForUpdates(); await f.updater.downloadUpdate();
  const payload = path.join(f.directory, '0.3.0', f.m.payload.name);
  await fs.writeFile(payload, Buffer.alloc(f.payload.length));
  await assert.rejects(f.updater.quitAndInstall(), error => error.code === 'UPDATE_CACHE_INVALID'); assert.equal(f.launched.length, 0);
  assert.equal(f.updater.prepared, null);
  await f.updater.downloadUpdate();
  f.updater.launch = async () => { throw new Error('launch failed'); };
  await assert.rejects(f.updater.quitAndInstall(), /launch failed/); assert.equal(f.quits(), 0);
});

test('controller repairs invalid prepared files instead of trapping install retries', async t => {
  for (const damage of ['payload-corrupt', 'installer-missing']) {
    await t.test(damage, async t => {
      const f = await fixture(t); let recoveries = 0;
      const controller = new UpdateController({ updater: f.updater, version: '0.2.1', feed: RELEASE_FEED,
        packaged: true, recoverInstall: async () => { recoveries++; } });
      await controller.check(); await controller.download();
      const folder = path.join(f.directory, '0.3.0');
      if (damage === 'payload-corrupt') await fs.writeFile(path.join(folder, f.m.payload.name), Buffer.alloc(f.payload.length));
      else await fs.unlink(path.join(folder, f.m.installer.name));
      assert.equal((await controller.install()).state, 'error');
      assert.equal(recoveries, 1); assert.equal(f.launched.length, 0); assert.equal(f.quits(), 0);
      assert.equal(controller.ready, false); assert.equal(f.updater.prepared, null);
      assert.equal((await controller.check()).state, 'available');
      const before = f.calls.length;
      assert.equal((await controller.download()).state, 'downloaded');
      // Validated parts are retained; reassembly needs no network download.
      assert.equal(f.calls.length - before, damage === 'payload-corrupt' ? 0 : 1);
      assert.equal((await controller.install()).state, 'installing');
      assert.equal(f.launched.length, 1); assert.equal(f.quits(), 1);
    });
  }
});

test('invalid cache remains downloadable even when backend recovery also fails', async t => {
  const f = await fixture(t);
  const controller = new UpdateController({ updater: f.updater, version: '0.2.1', feed: RELEASE_FEED,
    packaged: true, recoverInstall: async () => { throw new Error('synthetic backend failure'); } });
  await controller.check(); await controller.download();
  await fs.unlink(path.join(f.directory, '0.3.0', f.m.payload.name));
  const failure = await controller.install();
  assert.equal(failure.state, 'error'); assert.match(failure.error, /synthetic backend failure/);
  assert.equal(controller.ready, false);
  assert.equal((await controller.check()).state, 'available');
  assert.equal((await controller.download()).state, 'downloaded');
});
test('foreign release URLs and non-GitHub redirects are refused before asset fetch', async t => {
  const f = await fixture(t); f.release.assets[0].browser_download_url = 'https://evil.example/installer-manifest.json';
  await assert.rejects(f.updater.checkForUpdates(), /자산/); assert.equal(f.calls.length, 1);
  f.updater.fetcher = async () => new Response('', { status: 302, headers: { location: 'http://127.0.0.1/private' } });
  await assert.rejects(f.updater.bytes(RELEASE_FEED, 1000), /허용/);
});
