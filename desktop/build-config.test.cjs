const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

function configuration(env = {}) {
  const filename = path.join(__dirname, 'electron-builder.cjs');
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, require: createRequire(filename), process: { env }, URL,
  }, { filename });
  return module.exports;
}

test('split installer without a feed keeps both local payload support and updates unconfigured', () => {
  const config = configuration();
  const { version } = require('../package.json');
  assert.equal(config.nsisWeb.appPackageUrl, `http://127.0.0.1:9/voicesubsep-${version}-x64.nsis.7z`);
  assert.equal(config.publish, null);
  assert.equal(config.extraMetadata.desktopUpdateUrl, null);
  assert.equal(config.win.verifyUpdateCodeSignature, true);
  assert.equal(config.nsis.deleteAppDataOnUninstall, false);
  assert.equal(config.nsisWeb.include, undefined);
  assert.equal(config.nsisWeb.script, undefined);
});

test('configured split installer uses the same HTTPS feed for its standard payload URL', () => {
  const config = configuration({ VOICESUBSEP_UPDATE_URL: 'https://updates.example.org/product' });
  const { version } = require('../package.json');
  assert.equal(config.nsisWeb.appPackageUrl, `https://updates.example.org/product/voicesubsep-${version}-x64.nsis.7z`);
  assert.equal(config.publish[0].url, 'https://updates.example.org/product/');
  assert.equal(config.extraMetadata.desktopUpdateUrl, config.publish[0].url);
  assert.equal(config.win.verifyUpdateCodeSignature, true);
});

test('split payload configuration does not relax feed URL validation', () => {
  for (const feed of ['http://updates.example.org', 'https://user:secret@example.org', 'https://example.org?token=secret']) {
    assert.throws(() => configuration({ VOICESUBSEP_UPDATE_URL: feed }));
  }
});
