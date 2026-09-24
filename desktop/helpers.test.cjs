const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { APP_URL, validateUpdateUrl, sameOrigin, externalUrl, proxyUrl, backendPaths, backendArguments, initialUpdateStatus } = require('./helpers.cjs');

test('update URL is opt-in and excludes embedded credentials or token queries', () => {
  assert.equal(validateUpdateUrl(undefined), null);
  assert.equal(validateUpdateUrl(''), null);
  assert.equal(validateUpdateUrl('https://updates.example.org/voicesubsep'), 'https://updates.example.org/voicesubsep/');
  for (const value of ['http://example.org/feed', 'file:///updates', 'https://user:secret@example.org', 'https://example.org/?token=secret', 'https://example.org/#secret', 'not a URL', 123]) {
    assert.throws(() => validateUpdateUrl(value));
  }
});

test('trusted origin cannot be confused by a custom-scheme null origin or prefix', () => {
  assert.ok(sameOrigin('voicesubsep://app/api/health', APP_URL));
  for (const value of ['voicesubsep://evil/', 'voicesubsep://app.evil/', 'voicesubsep://user@app/', 'https://app/', 'file:///app', 'javascript:alert(1)']) assert.equal(sameOrigin(value, APP_URL), false);
  assert.ok(sameOrigin('http://127.0.0.1:5173/api', 'http://127.0.0.1:5173/'));
  assert.equal(sameOrigin('http://127.0.0.1:5174/', 'http://127.0.0.1:5173/'), false);
});

test('proxy preserves URL paths and queries without permitting host replacement', () => {
  assert.equal(proxyUrl('voicesubsep://app/api/media?q=%ED%95%9C%EA%B8%80', 'http://127.0.0.1:49231'), 'http://127.0.0.1:49231/api/media?q=%ED%95%9C%EA%B8%80');
  assert.equal(new URL(proxyUrl('voicesubsep://app//evil.example/file', 'http://127.0.0.1:49231')).hostname, '127.0.0.1');
  assert.throws(() => proxyUrl('voicesubsep://evil/', 'http://127.0.0.1:49231'));
  assert.throws(() => proxyUrl(APP_URL, 'https://other.example/'));
});

test('backend paths separate installed files and persistent data and are argv-safe', () => {
  const resources = path.resolve('Program Files', 'VOICESUBSEP', 'resources');
  const userData = path.resolve('Users', '테스트 사용자', 'AppData', 'VOICESUBSEP');
  const paths = backendPaths(resources, userData, 'win32');
  assert.equal(paths.executable, path.join(resources, 'backend', 'voicesubsep-server.exe'));
  assert.equal(paths.dataDir, path.join(userData, 'data'));
  assert.equal(paths.webDir, path.join(resources, 'web'));
  assert.deepEqual(backendArguments(49231, paths), ['--port', '49231', '--data-dir', paths.dataDir, '--web-dir', paths.webDir]);
  for (const port of [0, -1, 65536, 1.5, NaN, '8787']) assert.throws(() => backendArguments(port, paths));
});

test('external links reject executable protocols and updater is explicitly unconfigured', () => {
  assert.equal(externalUrl('https://example.org/help'), 'https://example.org/help');
  for (const url of ['file:///C:/Windows/cmd.exe', 'javascript:alert(1)', 'ms-settings:privacy', 'https://user:pass@example.org']) assert.equal(externalUrl(url), null);
  assert.equal(initialUpdateStatus('0.1.0', null, true).state, 'unconfigured');
  assert.equal(initialUpdateStatus('0.1.0', 'https://example.org/', false).configured, false);
  assert.equal(initialUpdateStatus('0.1.0', 'https://example.org/', true).state, 'idle');
});
