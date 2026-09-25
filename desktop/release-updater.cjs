// Signed manifests allow GitHub's split assets to update the large Windows runtime.
// No download or installer starts until the corresponding explicit UI action.
const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const path = require('node:path');
const { createHash, verify, randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');

const REPOSITORY = 'LiveTrack-X/VOICESUBSEP';
const RELEASE_FEED = `https://api.github.com/repos/${REPOSITORY}/releases`;
const ASSET_ROOT = `https://github.com/${REPOSITORY}/releases/download/`;
const MAX_PAYLOAD = 10 * 1024 ** 3;
const RATE = 10_000_000; // 80 Mbps, serial transfers across all parts.
const versionParts = value => typeof value === 'string' && /^\d{1,6}\.\d{1,6}\.\d{1,6}$/.test(value) ? value.split('.').map(Number) : null;
function newer(candidate, current) {
  const a = versionParts(candidate), b = versionParts(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
function validAssetUrl(value, version) {
  return typeof value === 'string' && value.startsWith(`${ASSET_ROOT}v${version}/`) && !/[?#]/.test(value)
    && !value.slice(`${ASSET_ROOT}v${version}/`.length).includes('/');
}
function validateManifest(bytes, signature, publicKey, version) {
  if (!Buffer.isBuffer(bytes) || bytes.length > 65536 || !Buffer.isBuffer(signature) || signature.length !== 64
      || !verify(null, bytes, publicKey, signature)) throw new Error('업데이트 서명을 확인하지 못했습니다.');
  const m = JSON.parse(bytes.toString('utf8'));
  if (m.schemaVersion !== 1 || m.version !== version || !versionParts(version)) throw new Error('업데이트 버전이 일치하지 않습니다.');
  function entry(item, name, max) {
    if (!item || item.name !== name || !Number.isSafeInteger(item.size) || item.size <= 0 || item.size > max
        || !/^[a-f0-9]{64}$/.test(item.sha256)) throw new Error('업데이트 파일 정보가 유효하지 않습니다.');
  }
  entry(m.installer, `VOICESUBSEP-${version}-Offline-Setup-x64.exe`, 32 * 1024 ** 2);
  entry(m.payload, `voicesubsep-${version}-x64.nsis.7z`, MAX_PAYLOAD);
  if (!Array.isArray(m.payload.parts) || !m.payload.parts.length || m.payload.parts.length > 16) throw new Error('업데이트 조각 정보가 유효하지 않습니다.');
  m.payload.parts.forEach((item, i) => entry(item, `${m.payload.name}.part${String(i + 1).padStart(3, '0')}`, 2 * 1024 ** 3 - 1));
  if (m.payload.parts.reduce((n, p) => n + p.size, 0) !== m.payload.size) throw new Error('업데이트 전체 크기가 일치하지 않습니다.');
  return m;
}
async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
async function matches(file, item) {
  try { const info = await fs.lstat(file); return info.isFile() && !info.isSymbolicLink() && info.size === item.size && await sha256(file) === item.sha256; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

class ReleaseUpdater extends EventEmitter {
  constructor({ version, cacheDir, publicKey, fetcher = fetch, launch, quit, bytesPerSecond = RATE }) {
    super(); Object.assign(this, { version, cacheDir, publicKey, fetcher, launch, quit, bytesPerSecond });
    this.release = null; this.prepared = null;
  }
  setFeedURL({ url }) { if (typeof url !== 'string' || url.replace(/\/$/, '') !== RELEASE_FEED) throw new Error('허용하지 않은 업데이트 저장소입니다.'); }
  async response(url, timeout = 30_000) {
    let current = url;
    for (let i = 0; i < 5; i++) {
      const u = new URL(current);
      if (u.protocol !== 'https:' || u.username || u.password || !['api.github.com', 'github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(u.hostname)) throw new Error('허용하지 않은 업데이트 다운로드 주소입니다.');
      const result = await this.fetcher(current, { redirect: 'manual', signal: AbortSignal.timeout(timeout), headers: { 'User-Agent': 'VOICESUBSEP-Updater', Accept: u.hostname === 'api.github.com' ? 'application/vnd.github+json' : 'application/octet-stream' } });
      if ([301, 302, 303, 307, 308].includes(result.status)) { await result.body?.cancel(); current = new URL(result.headers.get('location'), current).href; continue; }
      if (!result.ok) { await result.body?.cancel(); throw new Error(`업데이트 서버 응답 오류 (${result.status})`); }
      return result;
    }
    throw new Error('업데이트 주소 이동이 너무 많습니다.');
  }
  async bytes(url, limit) {
    const response = await this.response(url); const chunks = []; let size = 0;
    if (!response.body) throw new Error('업데이트 응답이 비어 있습니다.');
    for await (const chunk of response.body) { size += chunk.length; if (size > limit) throw new Error('업데이트 응답이 너무 큽니다.'); chunks.push(Buffer.from(chunk)); }
    return Buffer.concat(chunks);
  }
  async checkForUpdates() {
    this.emit('checking-for-update'); this.release = null; this.prepared = null;
    const list = JSON.parse((await this.bytes(RELEASE_FEED, 2 * 1024 ** 2)).toString('utf8'));
    if (!Array.isArray(list)) throw new Error('릴리즈 정보를 읽지 못했습니다.');
    // Preview releases are intentional for the 0.x application, never drafts.
    const candidates = list.filter(r => !r.draft && r.published_at && typeof r.tag_name === 'string' && newer(r.tag_name.replace(/^v/, ''), this.version));
    candidates.sort((a, b) => newer(a.tag_name.slice(1), b.tag_name.slice(1)) ? -1 : 1);
    for (const r of candidates) {
      const version = r.tag_name.replace(/^v/, '');
      if (r.tag_name !== `v${version}` || !Array.isArray(r.assets)) continue;
      const assets = new Map(r.assets.filter(a => a.state === 'uploaded').map(a => [a.name, a]));
      if (!assets.has('installer-manifest.json') || !assets.has('installer-manifest.sig')) continue;
      const asset = name => { const a = assets.get(name); if (!a || !validAssetUrl(a.browser_download_url, version)) throw new Error('업데이트 자산이 완전하지 않습니다.'); return a; };
      const bytes = await this.bytes(asset('installer-manifest.json').browser_download_url, 65536);
      const signature = await this.bytes(asset('installer-manifest.sig').browser_download_url, 64);
      const manifest = validateManifest(bytes, signature, this.publicKey, version);
      for (const item of [manifest.installer, ...manifest.payload.parts]) if (asset(item.name).size !== item.size) throw new Error('공개 업데이트 자산 크기가 일치하지 않습니다.');
      this.release = { manifest, assets };
      this.emit('update-available', { version }); return;
    }
    this.emit('update-not-available', { version: this.version });
  }
  async downloadFile(directory, item, url, onBytes) {
    const target = path.join(directory, item.name);
    if (await matches(target, item)) { onBytes(item.size); return target; }
    const existing = await fs.lstat(target).catch(e => { if (e.code !== 'ENOENT') throw e; return null; });
    if (existing && (!existing.isFile() || existing.isSymbolicLink())) throw new Error('업데이트 캐시 경로가 유효하지 않습니다.');
    const temporary = path.join(directory, `.download-${randomUUID()}.tmp`);
    let file, received = 0; const hash = createHash('sha256'); const started = performance.now();
    try {
      const response = await this.response(url, 30 * 60_000);
      if (!response.body) throw new Error('업데이트 파일 응답이 비어 있습니다.');
      file = await fs.open(temporary, 'wx');
      for await (const chunk of response.body) {
        received += chunk.length; if (received > item.size) throw new Error('업데이트 파일 크기가 다릅니다.');
        await file.writeFile(chunk); hash.update(chunk); onBytes(chunk.length);
        const wait = received / this.bytesPerSecond * 1000 - (performance.now() - started);
        if (wait > 0) await delay(wait);
      }
      if (received !== item.size || hash.digest('hex') !== item.sha256) throw new Error('업데이트 파일 체크섬이 일치하지 않습니다.');
      await file.close(); file = null; await fs.rename(temporary, target); return target;
    } finally { if (file) await file.close(); await fs.unlink(temporary).catch(() => {}); }
  }
  async downloadUpdate() {
    if (!this.release) throw new Error('먼저 업데이트를 확인하세요.');
    const { manifest: m, assets } = this.release;
    const directory = path.join(this.cacheDir, m.version);
    await fs.mkdir(directory, { recursive: true });
    for (const dir of [this.cacheDir, directory]) if ((await fs.lstat(dir)).isSymbolicLink()) throw new Error('업데이트 캐시는 일반 폴더여야 합니다.');
    const free = await fs.statfs(directory); if (Number(free.bavail) * Number(free.bsize) < m.payload.size * 2 + 512 * 1024 ** 2) throw new Error('업데이트 다운로드·조립 공간이 부족합니다.');
    const total = m.installer.size + m.payload.size; let transferred = 0;
    const progress = count => { transferred += count; this.emit('download-progress', { percent: 90 * transferred / total }); };
    for (const item of [m.installer, ...m.payload.parts]) await this.downloadFile(directory, item, assets.get(item.name).browser_download_url, progress);
    const payload = path.join(directory, m.payload.name);
    if (!await matches(payload, m.payload)) {
      const prior = await fs.lstat(payload).catch(e => { if (e.code !== 'ENOENT') throw e; return null; });
      if (prior && (!prior.isFile() || prior.isSymbolicLink())) throw new Error('업데이트 조립 경로가 유효하지 않습니다.');
      const temporary = path.join(directory, `.assemble-${randomUUID()}.tmp`); let target;
      try {
        target = await fs.open(temporary, 'wx'); const hash = createHash('sha256'); let size = 0;
        for (const part of m.payload.parts) for await (const chunk of createReadStream(path.join(directory, part.name))) {
          await target.writeFile(chunk); hash.update(chunk); size += chunk.length;
          this.emit('download-progress', { percent: 90 + 10 * size / m.payload.size });
        }
        if (size !== m.payload.size || hash.digest('hex') !== m.payload.sha256) throw new Error('조립한 업데이트 체크섬이 다릅니다.');
        await target.close(); target = null; await fs.rename(temporary, payload);
      } finally { if (target) await target.close(); await fs.unlink(temporary).catch(() => {}); }
    }
    this.prepared = { directory, manifest: m };
    this.emit('update-downloaded', { version: m.version });
  }
  async quitAndInstall() {
    if (!this.prepared) throw new Error('검증된 업데이트가 없습니다.');
    const { directory, manifest: m } = this.prepared;
    if (!await matches(path.join(directory, m.installer.name), m.installer) || !await matches(path.join(directory, m.payload.name), m.payload)) {
      this.prepared = null;
      const error = new Error('설치 직전 파일 검증에 실패했습니다. 업데이트를 다시 확인하고 다운로드하세요.');
      error.code = 'UPDATE_CACHE_INVALID';
      throw error;
    }
    await this.launch(path.join(directory, m.installer.name));
    this.quit();
  }
}
module.exports = { ReleaseUpdater, RELEASE_FEED, REPOSITORY, validateManifest, newer };
