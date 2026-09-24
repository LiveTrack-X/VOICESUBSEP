const test = require('node:test');
const assert = require('node:assert/strict');
const { createProxyHandler } = require('./proxy.cjs');

test('custom protocol blocks requests from another origin before contacting backend', async () => {
  let calls = 0;
  const proxy = createProxyHandler('http://127.0.0.1:40000', async () => { calls += 1; return new Response('ok'); });
  for (const initiatorOrigin of ['https://evil.example', 'voicesubsep://other', 'null']) {
    const response = await proxy({ url: 'voicesubsep://app/api/health', initiatorOrigin });
    assert.equal(response.status, 403);
  }
  const response = await proxy({ url: 'voicesubsep://other/api/health' });
  assert.equal(response.status, 404);
  assert.equal(calls, 0);
});

test('custom protocol streams its request body and forbids redirect following', async () => {
  const body = new ReadableStream();
  const headers = new Headers({ 'content-type': 'application/octet-stream' });
  let captured;
  const proxy = createProxyHandler('http://127.0.0.1:40000', async (url, options) => { captured = { url, options }; return new Response('ok'); });
  await proxy({ url: 'voicesubsep://app/api/media?lang=ko', initiatorOrigin: 'voicesubsep://app', method: 'POST', body, headers });
  assert.equal(captured.url, 'http://127.0.0.1:40000/api/media?lang=ko');
  assert.equal(captured.options.body, body);
  assert.equal(captured.options.headers.get('content-type'), headers.get('content-type'));
  assert.equal(captured.options.headers.get('Origin'), 'voicesubsep://app');
  assert.equal(headers.has('Origin'), false);
  assert.equal(captured.options.duplex, 'half');
  assert.equal(captured.options.redirect, 'error');
});

test('an external original Origin is rejected instead of rewritten as trusted', async () => {
  let calls = 0;
  const proxy = createProxyHandler('http://127.0.0.1:40000', async () => { calls += 1; return new Response('ok'); });
  for (const origin of ['https://evil.example', 'voicesubsep://other', 'null']) {
    const response = await proxy({ url: 'voicesubsep://app/api/media', method: 'POST', headers: new Headers({ Origin: origin }) });
    assert.equal(response.status, 403);
  }
  assert.equal(calls, 0);
});

test('proxy preserves range responses and adds CSP directly to the streamed response', async () => {
  const proxy = createProxyHandler('http://127.0.0.1:40000', async () => new Response('part', { status: 206, headers: { 'Content-Range': 'bytes 0-3/8', 'Content-Type': 'video/mp4' } }));
  const response = await proxy({ url: 'voicesubsep://app/api/media/example/file', method: 'GET' });
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('Content-Range'), 'bytes 0-3/8');
  assert.equal(response.headers.get('Content-Type'), 'video/mp4');
  assert.match(response.headers.get('Content-Security-Policy'), /script-src 'self'/);
  assert.equal(await response.text(), 'part');
});
