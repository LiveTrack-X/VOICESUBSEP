const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { UpdateController } = require('./updater.cjs');

class FakeUpdater extends EventEmitter {
  calls = [];
  setFeedURL(value) { this.calls.push(['feed', value]); }
  async checkForUpdates() { this.calls.push(['check']); this.emit('update-available', { version: '0.2.0' }); }
  async downloadUpdate() { this.calls.push(['download']); this.emit('download-progress', { percent: 54.3 }); this.emit('update-downloaded', { version: '0.2.0' }); }
  quitAndInstall(...args) { this.calls.push(['install', ...args]); }
}

const setup = (options = {}) => {
  const updater = new FakeUpdater();
  const controller = new UpdateController({ updater, version: '0.1.0', feed: 'https://updates.example.org/', packaged: true, ...options });
  return { updater, controller };
};

test('no network or installer is invoked automatically or when feed is absent', async () => {
  for (const options of [{ feed: null }, { packaged: false }]) {
    const { updater, controller } = setup(options);
    assert.equal(updater.autoDownload, false);
    assert.equal(updater.autoInstallOnAppQuit, false);
    assert.equal(updater.allowDowngrade, false);
    await controller.check(); await controller.download(); await controller.install();
    assert.deepEqual(updater.calls, []);
    assert.equal(controller.snapshot().state, 'unconfigured');
  }
});

test('check, download, and install require distinct actions with observable progress', async () => {
  let flushed = false;
  const { updater, controller } = setup({ beforeInstall: async () => { flushed = true; } });
  const states = [];
  controller.on('status', (status) => states.push(status));
  assert.equal(updater.calls.length, 1);
  await controller.download(); await controller.install();
  assert.equal(updater.calls.length, 1);
  assert.equal((await controller.check()).state, 'available');
  assert.equal(updater.calls.filter(([action]) => action === 'download').length, 0);
  assert.equal((await controller.download()).state, 'downloaded');
  assert.ok(states.some((status) => status.progress === 54.3));
  assert.equal(updater.calls.filter(([action]) => action === 'install').length, 0);
  assert.equal((await controller.install()).state, 'installing');
  assert.ok(flushed);
  assert.deepEqual(updater.calls.at(-1), ['install', false, true]);
  await controller.install();
  assert.equal(updater.calls.filter(([action]) => action === 'install').length, 1);
});

test('duplicate checks do not duplicate requests, errors remain retryable', async () => {
  const { updater, controller } = setup();
  let release;
  let checks = 0;
  updater.checkForUpdates = async () => { checks += 1; await new Promise((resolve) => { release = resolve; }); throw new Error('offline'); };
  const pending = controller.check();
  await controller.check();
  assert.equal(checks, 1);
  release();
  await pending;
  assert.equal(controller.snapshot().state, 'error');
  assert.match(controller.snapshot().error, /offline/);
  updater.checkForUpdates = async () => { updater.emit('update-not-available'); };
  assert.equal((await controller.check()).state, 'not-available');
});

test('failed download never authorizes install; explicit retry can complete', async () => {
  const { updater, controller } = setup();
  await controller.check();
  updater.downloadUpdate = async () => { throw new Error('checksum mismatch'); };
  assert.equal((await controller.download()).state, 'error');
  await controller.install();
  assert.equal(updater.calls.filter(([action]) => action === 'install').length, 0);
  updater.downloadUpdate = async () => { updater.emit('update-downloaded', { version: '0.2.0' }); };
  assert.equal((await controller.download()).state, 'downloaded');
});

test('installer launch failure can recover to the downloaded state for explicit retry', async () => {
  const { updater, controller } = setup();
  await controller.check(); await controller.download();
  updater.quitAndInstall = () => { updater.emit('error', new Error('installer launch failed')); };
  assert.equal((await controller.install()).state, 'error');
  assert.equal((await controller.check()).state, 'downloaded');
  updater.quitAndInstall = (...args) => { updater.calls.push(['install', ...args]); };
  assert.equal((await controller.install()).state, 'installing');
});

test('installer waits for confirmed backend shutdown before it can start', async () => {
  let allowExit;
  const shutdown = new Promise((resolve) => { allowExit = resolve; });
  const { updater, controller } = setup({ beforeInstall: () => shutdown });
  await controller.check(); await controller.download();
  const installation = controller.install();
  assert.equal(controller.snapshot().state, 'installing');
  assert.equal(updater.calls.some(([kind]) => kind === 'install'), false);
  allowExit();
  await installation;
  assert.equal(updater.calls.filter(([kind]) => kind === 'install').length, 1);
});

test('unconfirmed shutdown blocks installer and recovery makes the UI usable again', async () => {
  let recovered = 0;
  const { updater, controller } = setup({ beforeInstall: async () => { throw new Error('backend still running'); }, recoverInstall: async () => { recovered += 1; } });
  await controller.check(); await controller.download();
  assert.equal((await controller.install()).state, 'error');
  assert.equal(recovered, 1);
  assert.equal(updater.calls.some(([kind]) => kind === 'install'), false);
  assert.equal((await controller.check()).state, 'downloaded');
});

test('installer error keeps the UI busy until backend recovery has finished', async () => {
  let finishRecovery;
  let recoveries = 0;
  const recovered = new Promise((resolve) => { finishRecovery = resolve; });
  const { updater, controller } = setup({ recoverInstall: async () => { recoveries += 1; await recovered; } });
  await controller.check(); await controller.download();
  updater.quitAndInstall = () => { updater.emit('error', new Error('installer failed')); };
  const installation = controller.install();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(controller.snapshot().state, 'installing');
  await controller.install();
  assert.equal(recoveries, 1);
  finishRecovery();
  assert.equal((await installation).state, 'error');
  assert.equal((await controller.check()).state, 'downloaded');
});

test('failed recovery surfaces an error and releases the installing UI state', async () => {
  const { updater, controller } = setup({ recoverInstall: async () => { throw new Error('restart failed'); } });
  await controller.check(); await controller.download();
  updater.quitAndInstall = () => { throw new Error('launch failed'); };
  const status = await controller.install();
  assert.equal(status.state, 'error');
  assert.match(status.error, /launch failed/);
  assert.match(status.error, /restart failed/);
});
