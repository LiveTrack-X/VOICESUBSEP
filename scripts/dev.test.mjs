import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { checkInstallation, launchServers, serverCommands } from './dev.mjs';

function fixture() {
  const spawned = [];
  const terminated = [];
  const session = launchServers({
    commands: [{ name: 'API', command: 'python', args: ['-m', 'uvicorn'] }, { name: 'Editor', command: 'node', args: ['vite.js'] }],
    spawnProcess(command, args, options) {
      const child = new EventEmitter();
      spawned.push({ command, args, options, child });
      return child;
    },
    terminate: async (child) => { terminated.push(child); },
    log: () => {},
  });
  return { ...session, spawned, terminated };
}

test('platform commands bind local hosts and start one uvicorn worker without reload', () => {
  const win = serverCommands('/project', 'win32');
  const unix = serverCommands('/project', 'linux');
  assert.ok(win[0].command.endsWith(path.join('Scripts', 'python.exe')));
  assert.ok(unix[0].command.endsWith(path.join('bin', 'python')));
  assert.deepEqual(win[0].args, ['-m', 'uvicorn', 'voicesubsep.app:app', '--host', '127.0.0.1', '--port', '8787']);
  assert.deepEqual(win[1].args.slice(1), ['--host', '127.0.0.1']);
});

test('missing dependencies fail before starting a process', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'voicesubsep-launch-'));
  try { assert.throws(() => checkInstallation(root), /Run scripts\/setup.ps1/); }
  finally { rmSync(root, { recursive: true }); }
});

test('manual stop terminates both spawned processes once', async () => {
  const f = fixture();
  assert.equal(f.spawned.length, 2);
  assert.equal(f.spawned[0].options.shell, false);
  assert.equal(f.spawned[0].options.stdio, 'inherit');
  await Promise.all([f.stop(), f.stop()]);
  assert.equal(await f.done, 0);
  assert.deepEqual(f.terminated, f.children);
});

test('failed server exit shuts down its sibling and returns the failure code', async () => {
  const f = fixture();
  f.children[0].emit('exit', 3, null);
  assert.equal(await f.done, 3);
  assert.equal(f.terminated.length, 2);
});

test('a spawn error stops both servers with a useful failure status', async () => {
  const f = fixture();
  f.children[1].emit('error', new Error('ENOENT'));
  assert.equal(await f.done, 1);
  assert.equal(f.terminated.length, 2);
});

test('normal server exit also closes the sibling', async () => {
  const f = fixture();
  f.children[1].emit('exit', 0, null);
  assert.equal(await f.done, 0);
  assert.equal(f.terminated.length, 2);
});

test('real subprocesses are cleaned up without opening server ports', { timeout: 10000 }, async () => {
  const session = launchServers({
    commands: ['API fixture', 'Editor fixture'].map((name) => ({
      name, command: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'],
    })),
    log: () => {},
  });
  const exits = session.children.map((child) => once(child, 'exit'));
  try {
    await Promise.all(session.children.map((child) => once(child, 'spawn')));
    assert.equal(await session.stop(), 0);
    await Promise.all(exits);
    for (const child of session.children) {
      assert.ok(child.exitCode !== null || child.signalCode !== null);
    }
  } finally { await session.stop(); }
});
