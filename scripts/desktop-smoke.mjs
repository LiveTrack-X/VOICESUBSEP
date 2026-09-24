import { spawn } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const folder = await mkdtemp(path.join(os.tmpdir(), 'voicesubsep-desktop-smoke-'));
for (const restarted of [false, true]) {
  const env = { ...process.env, VOICESUBSEP_SMOKE_DIR: folder, VOICESUBSEP_SMOKE_RESTART: restarted ? '1' : '0' };
  delete env.ELECTRON_RUN_AS_NODE;
  await new Promise((resolve, reject) => {
    const child = spawn(require('electron'), [path.join(root, 'desktop/smoke-runner.cjs')], { cwd: root, env, shell: false, windowsHide: true, stdio: 'inherit' });
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Electron smoke timed out.')); }, 45000);
    child.once('error', (error) => { clearTimeout(timeout); reject(error); });
    child.once('exit', (code) => { clearTimeout(timeout); code === 0 ? resolve() : reject(new Error(`Electron smoke exited ${code}`)); });
  });
  console.log(JSON.parse(await readFile(path.join(folder, 'result.json'), 'utf8')));
}
console.log(`Smoke evidence: ${folder}`);
