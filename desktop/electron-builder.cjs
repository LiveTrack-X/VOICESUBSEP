const { validateUpdateUrl } = require('./helpers.cjs');

const feed = validateUpdateUrl(process.env.VOICESUBSEP_UPDATE_URL);

module.exports = {
  appId: 'com.livetrack.voicesubsep',
  productName: 'VOICESUBSEP',
  asar: true,
  directories: { output: 'release', buildResources: 'desktop/assets' },
  files: ['desktop/**/*.cjs', '!desktop/**/*.test.cjs', '!desktop/smoke-runner.cjs', '!desktop/electron-builder.cjs', 'package.json'],
  extraMetadata: { main: 'desktop/main.cjs', desktopUpdateUrl: feed },
  extraResources: [
    { from: 'dist', to: 'web', filter: ['**/*'] },
    { from: 'build/backend/voicesubsep-server', to: 'backend', filter: ['**/*'] },
  ],
  npmRebuild: false,
  publish: feed ? [{ provider: 'generic', url: feed }] : null,
  win: { target: [{ target: 'nsis', arch: ['x64'] }], artifactName: 'VOICESUBSEP-${version}-Setup-${arch}.${ext}', verifyUpdateCodeSignature: true },
  nsis: { oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true, deleteAppDataOnUninstall: false, createDesktopShortcut: true, createStartMenuShortcut: true, shortcutName: 'VOICESUBSEP' },
};
