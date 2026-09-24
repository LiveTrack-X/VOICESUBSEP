import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { validateUpdateUrl } = require('../desktop/helpers.cjs');
const mode = process.argv[2];
if (!['pack', 'installer'].includes(mode) || process.argv.length !== 3) throw new Error('Use: node scripts/desktop-build.mjs pack|installer');
if (process.platform !== 'win32') throw new Error('Windows x64 installer must be built on Windows with its bundled backend.');
validateUpdateUrl(process.env.VOICESUBSEP_UPDATE_URL);
for (const relative of ['dist/index.html', 'build/backend/voicesubsep-server/voicesubsep-server.exe']) {
  if (!existsSync(path.join(root, relative))) throw new Error(`Missing ${relative}. Build the frontend and bundled backend first; see docs/DESKTOP.md.`);
}
const child = spawn(process.execPath, [path.join(root, 'node_modules/electron-builder/cli.js'), '--config', 'desktop/electron-builder.cjs', '--win', ...(mode === 'pack' ? ['--dir'] : ['nsis']), '--x64', '--publish', 'never'], {
  cwd: root, shell: false, windowsHide: true, stdio: 'inherit', env: process.env,
});
child.once('error', (error) => { console.error(error.message); process.exitCode = 1; });
child.once('exit', (code) => { process.exitCode = code ?? 1; });
