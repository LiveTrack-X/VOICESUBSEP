const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomBytes } = require('node:crypto');
const { Readable } = require('node:stream');

const ID = /^[a-zA-Z0-9_-]{1,128}$/;
const MEDIA_ID = /^[a-f0-9]{32}$/;
const MAX_RECORDS = 100;
const MAX_JSON = 1024 * 1024;
function identity(value) {
  if (!value || !/^[a-f0-9]{64}$/.test(value.sha256) || !Number.isSafeInteger(value.bytes) || value.bytes <= 0) throw new Error('Invalid media identity.');
  return { sha256: value.sha256, bytes: value.bytes };
}
function same(a, b) { return a?.sha256 === b?.sha256 && a?.bytes === b?.bytes; }
function checkRequest(value) {
  if (!value || typeof value.projectId !== 'string' || !ID.test(value.projectId)) throw new Error('Invalid project.');
  return { projectId: value.projectId, identity: identity(value.identity) };
}
function recordKey(value) { return `${value.projectId}:${value.identity.sha256}`; }
async function hashReadable(stream, signal, maxBytes = Number.MAX_SAFE_INTEGER) {
  const hash = createHash('sha256'); let bytes = 0;
  for await (const chunk of stream) {
    signal?.throwIfAborted(); bytes += chunk.length;
    if (bytes > maxBytes) throw new Error('Media size changed.');
    hash.update(chunk);
  }
  signal?.throwIfAborted();
  return { sha256: hash.digest('hex'), bytes };
}
async function hashFile(filePath, expected, signal) {
  const handle = await fsp.open(filePath, 'r');
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size !== expected.bytes) return false;
    const actual = await hashReadable(handle.createReadStream({ autoClose: false, highWaterMark: 1024 * 1024, signal }), signal, expected.bytes);
    const after = await handle.stat();
    return same(actual, expected) && before.size === after.size && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs;
  } finally { await handle.close(); }
}
async function smallJson(response) {
  if (!response.ok) throw new Error('Media server unavailable.');
  const chunks = []; let bytes = 0;
  for await (const part of response.body) {
    bytes += part.length;
    if (bytes > MAX_JSON) throw new Error('Invalid media response.');
    chunks.push(part);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
function checkedMedia(value, expected) {
  if (!value || !MEDIA_ID.test(value.id) || value.url !== `/api/media/${value.id}/file` ||
      typeof value.name !== 'string' || value.name.length > 512 || !Number.isFinite(value.duration) || value.duration <= 0 ||
      !Array.isArray(value.audioTracks) || !same(identity(value), expected)) throw new Error('Invalid media response.');
  return value;
}

/** Only main-frame IPC callers can invoke this service. register's path is supplied
 * by preload webUtils.getPathForFile, never a renderer-provided JSON path. The
 * registry is private to this installation and is not part of project exports. */
function createMediaRelinkService({ registryPath, getOrigin, fetchRequest = fetch }) {
  const operations = new Map(); let writeQueue = Promise.resolve();
  async function readRegistry() {
    try {
      const stat = await fsp.stat(registryPath);
      if (!stat.isFile() || stat.size > MAX_JSON) return [];
      const value = JSON.parse(await fsp.readFile(registryPath, 'utf8'));
      if (!Array.isArray(value)) return [];
      return value.slice(-MAX_RECORDS).filter(row => {
        try { checkRequest(row); return typeof row.path === 'string' && path.isAbsolute(row.path) && row.path.length < 32768 && MEDIA_ID.test(row.mediaId); }
        catch { return false; }
      });
    } catch { return []; }
  }
  async function saveRecord(record) {
    const task = writeQueue.then(async () => {
      const rows = (await readRegistry()).filter(row => recordKey(row) !== recordKey(record));
      rows.push(record);
      while (rows.length > MAX_RECORDS || Buffer.byteLength(JSON.stringify(rows)) > MAX_JSON) rows.shift();
      await fsp.mkdir(path.dirname(registryPath), { recursive: true });
      const temporary = `${registryPath}.${randomBytes(8).toString('hex')}.tmp`;
      try { await fsp.writeFile(temporary, JSON.stringify(rows.slice(-MAX_RECORDS)), { mode: 0o600 }); await fsp.rename(temporary, registryPath); }
      finally { await fsp.unlink(temporary).catch(() => {}); }
    });
    writeQueue = task.catch(() => {}); return task;
  }
  function origin() {
    const value = new URL(getOrigin());
    if (value.protocol !== 'http:' || value.hostname !== '127.0.0.1' || !value.port || value.username || value.password || value.pathname !== '/') throw new Error('Invalid local server.');
    return value.origin;
  }
  const headers = { Origin: 'voicesubsep://app' };
  async function cached(record, signal) {
    try {
      const media = checkedMedia(await smallJson(await fetchRequest(`${origin()}/api/media/${record.mediaId}`, { headers, signal, redirect: 'error' })), record.identity);
      const source = await fetchRequest(`${origin()}${media.url}`, { headers, signal, redirect: 'error' });
      if (!source.ok || !source.body || !same(await hashReadable(source.body, signal, record.identity.bytes), record.identity)) return null;
      return media;
    } catch (error) { signal.throwIfAborted(); return null; }
  }
  async function upload(record, signal) {
    const boundary = `voicesubsep-${randomBytes(18).toString('hex')}`;
    const fileName = path.basename(record.path).replace(/[\r\n"\\]/g, '_');
    const prefix = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`);
    const suffix = Buffer.from(`\r\n--${boundary}--\r\n`);
    // The upload is streamed; the backend's hash verifies the actual copied bytes
    // even if the path changed after the initial read. Never attach mismatched data.
    const body = Readable.from((async function* () {
      yield prefix;
      const stream = fs.createReadStream(record.path, { signal, highWaterMark: 1024 * 1024 });
      try { for await (const part of stream) { signal.throwIfAborted(); yield part; } }
      finally { stream.destroy(); }
      yield suffix;
    })());
    try {
      return checkedMedia(await smallJson(await fetchRequest(`${origin()}/api/media`, {
        method: 'POST', headers: { ...headers, 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': String(prefix.length + record.identity.bytes + suffix.length) },
        body, duplex: 'half', signal, redirect: 'error',
      })), record.identity);
    } finally { body.destroy(); }
  }
  return {
    async register(value) {
      try {
        const checked = checkRequest(value);
        if (typeof value.path !== 'string' || !path.isAbsolute(value.path) || value.path.length >= 32768 || !MEDIA_ID.test(value.mediaId)) return { remembered: false };
        await saveRecord({ ...checked, path: value.path, mediaId: value.mediaId });
        return { remembered: true };
      } catch { return { remembered: false }; }
    },
    cancel(operationId) { operations.get(operationId)?.abort(); return { cancelled: true }; },
    async restore(value) {
      let controller;
      try {
        const checked = checkRequest(value);
        if (typeof value.operationId !== 'string' || !ID.test(value.operationId)) throw new Error('Invalid operation.');
        if (operations.has(value.operationId) || [...operations.values()].filter(operation => !operation.signal.aborted).length >= 2) return { status: 'unavailable' };
        controller = new AbortController(); operations.set(value.operationId, controller);
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(30 * 60_000)]);
        await writeQueue;
        const record = (await readRegistry()).find(row => recordKey(row) === recordKey(checked) && same(row.identity, checked.identity));
        signal.throwIfAborted();
        if (!record) return { status: 'unremembered' };
        let matches;
        try { matches = await hashFile(record.path, checked.identity, signal); }
        catch (error) { if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return { status: 'missing' }; throw error; }
        if (!matches) return { status: 'changed' };
        const media = await cached(record, signal) ?? await upload(record, signal);
        signal.throwIfAborted();
        if (!same(media, checked.identity)) return { status: 'changed' };
        if (media.id !== record.mediaId) await saveRecord({ ...record, mediaId: media.id });
        signal.throwIfAborted();
        return { status: 'ready', media };
      } catch { return { status: controller?.signal.aborted ? 'cancelled' : 'unavailable' }; }
      finally { if (controller) operations.delete(value.operationId); }
    },
  };
}
module.exports = { createMediaRelinkService, hashReadable, hashFile };
