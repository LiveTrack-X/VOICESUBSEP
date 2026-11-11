const { execFile } = require('node:child_process');
const path = require('node:path');
const { promisify } = require('node:util');

// Fixed local .NET discovery. Renderer input never reaches a command or path.
const SCRIPT = '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); ' +
  'Add-Type -AssemblyName System.Drawing; $fontCollection = [System.Drawing.Text.InstalledFontCollection]::new(); ' +
  'try { ConvertTo-Json -InputObject @($fontCollection.Families | ForEach-Object { $_.Name }) -Compress } ' +
  'finally { $fontCollection.Dispose() }';

function createInstalledFontsService({ platform = process.platform, systemRoot = process.env.SystemRoot || 'C:\\Windows', execute = promisify(execFile) } = {}) {
  let cached;
  let pending;
  return async function listFonts() {
    if (platform !== 'win32') return { available: false, fonts: [], issue: '설치 글꼴 목록은 Windows 설치형에서 지원합니다. 글꼴 이름을 직접 입력할 수 있습니다.' };
    if (cached) return { ...cached, fonts: [...cached.fonts] };
    if (!pending) pending = (async () => {
      try {
        const program = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
        const { stdout } = await execute(program, ['-NoProfile', '-NonInteractive', '-Command', SCRIPT],
          { windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024, encoding: 'utf8' });
        if (typeof stdout !== 'string' || Buffer.byteLength(stdout, 'utf8') > 1024 * 1024) throw new Error('Invalid font list');
        const parsed = JSON.parse(stdout.replace(/^\ufeff/u, '').trim());
        if (!Array.isArray(parsed) || parsed.length > 4096) throw new Error('Invalid font list');
        const names = parsed.filter(name => typeof name === 'string').map(name => name.normalize('NFC').trim())
          .filter(name => name && [...name].length <= 120 && /^[\p{L}\p{M}\p{N} _.'()+&-]+$/u.test(name));
        cached = { available: true, fonts: [...new Set(names)].sort((a, b) => a.localeCompare(b, 'en')) };
        return cached;
      } catch {
        return { available: false, fonts: [], issue: '설치 글꼴 목록을 가져오지 못했습니다. 글꼴 이름을 직접 입력하거나 다시 시도하세요.' };
      } finally {
        pending = undefined;
      }
    })();
    const result = await pending;
    return { ...result, fonts: [...result.fonts] };
  };
}

module.exports = { createInstalledFontsService };
