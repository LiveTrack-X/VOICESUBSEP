import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { launchServers, projectRoot } from './dev.mjs';

const require = createRequire(import.meta.url);
const electron = require('electron');
const session = launchServers();
let desktop;
let stopping = false;
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  if (desktop && desktop.exitCode === null) desktop.kill();
  process.exitCode = await session.stop(code);
}
const signal = () => { void stop(); };
process.once('SIGINT', signal);
process.once('SIGTERM', signal);
if (process.platform === 'win32') process.once('SIGBREAK', signal);
session.done.then((code) => { if (!stopping) void stop(code); });

try {
  const deadline = Date.now() + 45000;
  let ready = false;
  while (!ready && !stopping && Date.now() < deadline) {
    try { ready = (await fetch('http://127.0.0.1:5173/', { signal: AbortSignal.timeout(1000) })).ok; }
    catch { /* Vite is starting. */ }
    if (!ready) await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!ready && !stopping) throw new Error('Editor startup timed out.');
  if (!stopping) {
    const env = { ...process.env, VOICESUBSEP_DEV_URL: 'http://127.0.0.1:5173/' };
    delete env.ELECTRON_RUN_AS_NODE;
    desktop = spawn(electron, [projectRoot], { cwd: projectRoot, env, shell: false, windowsHide: true, stdio: 'inherit' });
    desktop.once('error', (error) => { console.error(error.message); void stop(1); });
    desktop.once('exit', (code) => { void stop(code ?? 1); });
  }
} catch (error) { console.error(error.message); await stop(1); }
