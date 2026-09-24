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

test('desktop icon configuration is accepted by the installed builder schema', async () => {
  const { validateConfiguration } = require('app-builder-lib/out/util/config/config');
  await validateConfiguration(configuration(), { isEnabled: false });
});

test('Windows application and both installers use a packaged multi-resolution icon', () => {
  const config = configuration();
  const root = path.join(__dirname, '..');
  const icon = config.win.icon;
  for (const installer of [config.nsis, config.nsisWeb]) {
    assert.equal(installer.installerIcon, icon);
    assert.equal(installer.uninstallerIcon, icon);
  }
  assert.ok(config.files.includes(icon), 'the runtime icon must be included explicitly; buildResources alone is not packaged');
  const bytes = fs.readFileSync(path.join(root, icon));
  assert.equal(bytes.readUInt16LE(0), 0);
  assert.equal(bytes.readUInt16LE(2), 1, 'ICO image type');
  const count = bytes.readUInt16LE(4);
  const sizes = new Set();
  for (let i = 0; i < count; i += 1) {
    const entry = 6 + i * 16;
    const width = bytes[entry] || 256;
    const height = bytes[entry + 1] || 256;
    assert.equal(width, height);
    const length = bytes.readUInt32LE(entry + 8);
    const offset = bytes.readUInt32LE(entry + 12);
    assert.ok(length > 0 && offset >= 6 + count * 16 && offset + length <= bytes.length, 'ICO entries must point to complete image data');
    sizes.add(width);
  }
  for (const size of [16, 32, 48, 256]) assert.ok(sizes.has(size), `missing ${size}px icon for Windows scaling`);
  const png = 'desktop/assets/icon.png';
  assert.ok(config.files.includes(png));
  assert.equal(fs.readFileSync(path.join(root, png)).subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
});
