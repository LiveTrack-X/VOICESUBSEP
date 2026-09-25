const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { installCapturePermissions } = require('./capture-permissions.cjs');

function fixture(response = 1, platform = 'win32') {
  const handlers = {}; let prompts = 0; let enumerations = 0; let destroyed = false;
  const contents = Object.assign(new EventEmitter(), { mainFrame: {}, isDestroyed: () => destroyed, getURL: () => 'voicesubsep://app/' });
  const win = { webContents: contents, isDestroyed: () => destroyed };
  installCapturePermissions({ session: {
    setPermissionCheckHandler: (fn) => { handlers.check = fn; },
    setPermissionRequestHandler: (fn) => { handlers.permission = fn; },
    setDisplayMediaRequestHandler: (fn) => { handlers.display = fn; },
  }, getWindow: () => win, getUiUrl: () => 'voicesubsep://app/', platform,
  dialog: { showMessageBox: async () => { prompts++; return { response }; } },
  desktopCapturer: { getSources: async (options) => { enumerations++; assert.deepEqual(options.thumbnailSize, { width: 0, height: 0 }); return [{ id: 'screen:1', name: 'Display 1' }]; } },
  });
  const details = { isMainFrame: true, requestingUrl: 'voicesubsep://app/', mediaTypes: ['audio'] };
  const request = { frame: contents.mainFrame, securityOrigin: 'voicesubsep://app', audioRequested: true, videoRequested: true, userGesture: true };
  return { handlers, contents, details, request, counts: () => ({ prompts, enumerations }), destroy: () => { destroyed = true; } };
}

test('does not ask or open devices when handlers are installed; permission checks start ungranted', () => {
  const f = fixture(); assert.deepEqual(f.counts(), { prompts: 0, enumerations: 0 }); assert.equal(f.handlers.check(), false);
  assert.equal(f.handlers.check(f.contents, 'media', 'voicesubsep://app/', { ...f.details, mediaType: 'audio' }), false);
});

test('approved audio device labels remain available without granting camera, generic media, subframes or foreign origins', async () => {
  const f = fixture();
  assert.equal(await new Promise(resolve => f.handlers.permission(f.contents, 'media', resolve, f.details)), true);
  const audio = { ...f.details, mediaType: 'audio' };
  assert.equal(f.handlers.check(f.contents, 'media', 'voicesubsep://app/', audio), true);
  for (const [contents, permission, origin, details] of [
    [f.contents, 'media', 'voicesubsep://app/', { ...audio, mediaType: 'video' }],
    [f.contents, 'media', 'voicesubsep://app/', { ...audio, mediaType: 'unknown' }],
    [f.contents, 'media', 'voicesubsep://app/', f.details],
    [f.contents, 'media', 'voicesubsep://app/', { ...audio, isMainFrame: false }],
    [f.contents, 'media', 'https://other.example/', audio],
    [f.contents, 'media', 'voicesubsep://app/', { ...audio, requestingUrl: 'https://other.example/' }],
    [f.contents, 'speaker-selection', 'voicesubsep://app/', audio],
    [{ ...f.contents }, 'media', 'voicesubsep://app/', audio],
  ]) assert.equal(f.handlers.check(contents, permission, origin, details), false);
  assert.equal(f.counts().prompts, 1);
});

test('navigation revokes approval and invalidates a pending same-origin request', async () => {
  const f = fixture(), audio = { ...f.details, mediaType: 'audio' };
  await new Promise(resolve => f.handlers.permission(f.contents, 'media', resolve, f.details));
  f.contents.emit('did-start-navigation', { isMainFrame: false });
  assert.equal(f.handlers.check(f.contents, 'media', 'voicesubsep://app/', audio), true);
  f.contents.emit('did-start-navigation', { isMainFrame: true });
  assert.equal(f.handlers.check(f.contents, 'media', 'voicesubsep://app/', audio), false);
  const pending = new Promise(resolve => f.handlers.permission(f.contents, 'media', resolve, f.details));
  f.contents.emit('did-start-navigation', { isMainFrame: true });
  assert.equal(await pending, false);
  assert.equal(f.handlers.check(f.contents, 'media', 'voicesubsep://app/', audio), false);
});

test('declining a later request revokes an earlier audio-label approval', async () => {
  const handlers = {}; const contents = Object.assign(new EventEmitter(), { mainFrame: {}, isDestroyed: () => false, getURL: () => 'voicesubsep://app/' });
  const win = { webContents: contents, isDestroyed: () => false }; let response = 1;
  installCapturePermissions({ session: { setPermissionCheckHandler: fn => handlers.check = fn, setPermissionRequestHandler: fn => handlers.permission = fn, setDisplayMediaRequestHandler: () => {} },
    getWindow: () => win, getUiUrl: () => 'voicesubsep://app/', dialog: { showMessageBox: async () => ({ response }) }, desktopCapturer: {} });
  const details = { isMainFrame: true, requestingUrl: 'voicesubsep://app/', mediaTypes: ['audio'] };
  await new Promise(resolve => handlers.permission(contents, 'media', resolve, details));
  response = 0;
  assert.equal(await new Promise(resolve => handlers.permission(contents, 'media', resolve, details)), false);
  assert.equal(handlers.check(contents, 'media', 'voicesubsep://app/', { ...details, mediaType: 'audio' }), false);
});
test('microphone requires trusted top-level audio-only request and affirmative native consent', async () => {
  for (const response of [0, 1]) {
    const f = fixture(response);
    const allowed = await new Promise((resolve) => f.handlers.permission(f.contents, 'media', resolve, f.details));
    assert.equal(allowed, response === 1); assert.equal(f.counts().prompts, 1);
  }
});
test('rejects camera, subframes, foreign URLs, nonmedia and different webContents without prompting', async () => {
  const f = fixture();
  for (const [contents, permission, details] of [[f.contents, 'media', { ...f.details, mediaTypes: ['video', 'audio'] }], [f.contents, 'media', { ...f.details, isMainFrame: false }], [f.contents, 'media', { ...f.details, requestingUrl: 'https://evil.example/' }], [f.contents, 'geolocation', f.details], [{ ...f.contents }, 'media', f.details]]) {
    assert.equal(await new Promise((resolve) => f.handlers.permission(contents, permission, resolve, details)), false);
  }
  assert.equal(f.counts().prompts, 0);
});
test('system audio requires a fresh gesture, own frame, audio request, and Windows', async () => {
  for (const patch of [{ userGesture: false }, { frame: {} }, { audioRequested: false }, { videoRequested: false }, { securityOrigin: 'https://evil.example' }]) {
    const f = fixture(); assert.deepEqual(await new Promise((resolve) => f.handlers.display({ ...f.request, ...patch }, resolve)), {}); assert.equal(f.counts().enumerations, 0);
  }
  const f = fixture(1, 'linux'); assert.deepEqual(await new Promise((resolve) => f.handlers.display(f.request, resolve)), {});
});
test('system audio returns selected screen plus unmuted loopback only after consent', async () => {
  const f = fixture(); assert.deepEqual(await new Promise((resolve) => f.handlers.display(f.request, resolve)), { video: { id: 'screen:1', name: 'Display 1' }, audio: 'loopback' });
  const denied = fixture(0); assert.deepEqual(await new Promise((resolve) => denied.handlers.display(denied.request, resolve)), {});
});
test('navigation/destruction while a permission prompt is open invalidates approval', async () => {
  const f = fixture(); const result = new Promise((resolve) => f.handlers.permission(f.contents, 'media', resolve, f.details)); f.destroy(); assert.equal(await result, false);
});

test('combined capture can ask for microphone immediately after display callback', async () => {
  const f = fixture();
  const microphone = await new Promise(resolve => f.handlers.display(f.request, selection => {
    assert.equal(selection.audio, 'loopback');
    f.handlers.permission(f.contents, 'media', resolve, f.details);
  }));
  assert.equal(microphone, true); assert.equal(f.counts().prompts, 2);
});

test('a destroyed request callback is never invoked twice', async () => {
  const f = fixture(); let callbacks = 0;
  await new Promise(resolve => f.handlers.display(f.request, () => { callbacks++; resolve(); throw new Error('frame destroyed'); }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(callbacks, 1);
});
