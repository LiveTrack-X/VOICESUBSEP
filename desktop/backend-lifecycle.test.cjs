const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { stopOwnedBackend } = require('./backend-lifecycle.cjs');

function fixture() {
  const child = new EventEmitter();
  Object.assign(child, { pid: 123, exitCode: null, signalCode: null });
  const exit = () => { child.exitCode = 0; child.emit('exit', 0, null); };
  return { child, exit };
}

test('graceful shutdown waits for the owned process exit without forcing it', async () => {
  const { child, exit } = fixture();
  let forced = false;
  const result = await stopOwnedBackend({ child, shutdown: async () => { setImmediate(exit); }, forceKill: async () => { forced = true; }, graceMs: 100, killMs: 100 });
  assert.equal(result, true);
  assert.equal(forced, false);
  assert.equal(child.listenerCount('exit'), 0);
});

test('a successful taskkill command alone is not treated as a confirmed process exit', async () => {
  const { child } = fixture();
  let forced = false;
  const result = await stopOwnedBackend({ child, shutdown: async () => {}, forceKill: async () => { forced = true; }, graceMs: 1, killMs: 1 });
  assert.equal(forced, true);
  assert.equal(result, false);
  assert.equal(child.listenerCount('exit'), 0);
});

test('HTTP failure falls back to force kill and still waits for actual exit', async () => {
  const { child, exit } = fixture();
  const result = await stopOwnedBackend({ child, shutdown: async () => { throw new Error('offline'); }, forceKill: async () => { setImmediate(exit); }, graceMs: 100, killMs: 100 });
  assert.equal(result, true);
});

test('termination errors propagate instead of authorizing file replacement', async () => {
  const { child } = fixture();
  await assert.rejects(stopOwnedBackend({ child, shutdown: async () => { throw new Error('offline'); }, forceKill: async () => { throw new Error('access denied'); } }), /access denied/);
});
