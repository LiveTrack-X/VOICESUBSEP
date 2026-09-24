import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function serverCommands(root = projectRoot, platform = process.platform) {
  return [
    {
      name: 'API',
      command: path.join(root, '.venv', platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'),
      args: ['-m', 'uvicorn', 'voicesubsep.app:app', '--host', '127.0.0.1', '--port', '8787'],
    },
    {
      name: 'Editor',
      command: process.execPath,
      args: [path.join(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1'],
    },
  ];
}

export function checkInstallation(root = projectRoot, platform = process.platform) {
  const commands = serverCommands(root, platform);
  for (const file of [commands[0].command, commands[1].args[0]]) {
    if (!existsSync(file)) throw new Error(`Missing ${file}. Run scripts/setup.ps1 first; see README.md.`);
  }
  return commands;
}

async function terminateTree(child, platform = process.platform) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (platform === 'win32') {
    // Kill only the process tree started by this launcher, including FFmpeg children.
    await new Promise((resolve) => {
      const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
        shell: false, windowsHide: true, stdio: 'ignore',
      });
      killer.once('error', () => { child.kill(); resolve(); });
      killer.once('exit', () => resolve());
    });
    return;
  }
  const signalGroup = (signal) => {
    try { process.kill(-child.pid, signal); }
    catch (error) { if (error.code !== 'ESRCH') child.kill(signal); }
  };
  signalGroup('SIGTERM');
  await new Promise((resolve) => {
    const timeout = setTimeout(() => { signalGroup('SIGKILL'); resolve(); }, 3000);
    child.once('exit', () => { clearTimeout(timeout); resolve(); });
  });
}

/** Start exactly one API worker and one editor, with a shared lifetime. */
export function launchServers({
  commands = checkInstallation(),
  cwd = projectRoot,
  platform = process.platform,
  spawnProcess = spawn,
  terminate = (child) => terminateTree(child, platform),
  log = console.log,
} = {}) {
  const children = [];
  let stopping = false;
  let resolveDone;
  const done = new Promise((resolve) => { resolveDone = resolve; });
  const stop = async (code = 0) => {
    if (stopping) return done;
    stopping = true;
    log('Stopping local servers…');
    const results = await Promise.allSettled(children.map((child) => terminate(child)));
    for (const result of results) {
      if (result.status === 'rejected') { log(`Process cleanup failed: ${result.reason}`); code = 1; }
    }
    resolveDone(code);
    return code;
  };
  for (const spec of commands) {
    try {
      const child = spawnProcess(spec.command, spec.args, {
        cwd, shell: false, stdio: 'inherit', windowsHide: true,
        detached: platform !== 'win32',
        env: { ...process.env, PYTHONUNBUFFERED: '1' },
      });
      children.push(child);
      child.once('error', (error) => {
        log(`${spec.name} could not start: ${error.message}`);
        void stop(1);
      });
      child.once('exit', (code, signal) => {
        if (!stopping) {
          log(`${spec.name} stopped (${signal ?? code ?? 'unknown'}).`);
          void stop(code ?? (signal ? 1 : 0));
        }
      });
    } catch (error) {
      log(`${spec.name} could not start: ${error.message}`);
      void stop(1);
      break;
    }
  }
  return { children, done, stop };
}

async function main() {
  const unknown = process.argv.slice(2).filter((arg) => arg !== '--check');
  if (unknown.length) throw new Error(`Unknown arguments: ${unknown.join(' ')}. Use node scripts/dev.mjs [--check].`);
  const commands = checkInstallation();
  if (process.argv.includes('--check')) {
    console.log('Launcher prerequisites found. Run node scripts/dev.mjs to start both servers.');
    return;
  }
  console.log('VOICESUBSEP: http://127.0.0.1:5173 · API http://127.0.0.1:8787');
  console.log('Press Ctrl+C to stop both servers. Model weights are loaded only when analysis starts.');
  const session = launchServers({ commands });
  const onSignal = () => { void session.stop(0); };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  if (process.platform === 'win32') process.once('SIGBREAK', onSignal);
  process.exitCode = await session.done;
  process.removeListener('SIGINT', onSignal);
  process.removeListener('SIGTERM', onSignal);
  process.removeListener('SIGBREAK', onSignal);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
