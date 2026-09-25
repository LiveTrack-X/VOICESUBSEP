const { validateUpdateUrl } = require('./helpers.cjs');
const { version } = require('../package.json');
const { RELEASE_FEED } = require('./release-updater.cjs');

const feed = validateUpdateUrl(process.env.VOICESUBSEP_UPDATE_URL);
const windowsIcon = 'desktop/assets/icon.ico';
const installerIcons = { installerIcon: windowsIcon, uninstallerIcon: windowsIcon };

module.exports = {
  appId: 'com.livetrack.voicesubsep',
  productName: 'VOICESUBSEP',
  asar: true,
  directories: { output: 'release', buildResources: 'desktop/assets' },
  files: ['desktop/**/*.cjs', '!desktop/**/*.test.cjs', '!desktop/smoke-runner.cjs', '!desktop/electron-builder.cjs', 'desktop/assets/icon.ico', 'desktop/assets/icon.png', 'desktop/update-public-key.pem', 'package.json'],
  extraMetadata: { main: 'desktop/main.cjs', desktopUpdateUrl: feed || RELEASE_FEED, desktopUpdateProvider: feed ? 'generic' : 'github-split' },
  extraResources: [
    { from: 'dist', to: 'web', filter: ['**/*'] },
    { from: 'build/backend/voicesubsep-server', to: 'backend', filter: ['**/*'] },
  ],
  npmRebuild: false,
  publish: feed ? [{ provider: 'generic', url: feed }] : null,
  win: { icon: windowsIcon, target: [{ target: 'nsis', arch: ['x64'] }], artifactName: 'VOICESUBSEP-${version}-Setup-${arch}.${ext}', verifyUpdateCodeSignature: true },
  nsis: { ...installerIcons, oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true, deleteAppDataOnUninstall: false, createDesktopShortcut: true, createStartMenuShortcut: true, shortcutName: 'VOICESUBSEP' },
  // NSIS-web verifies a co-located payload before using the optional download URL.
  // Without a configured feed, missing payloads cannot contact an external host.
  // Leave its standard packageFiles and --package-file updater path intact.
  nsisWeb: {
    ...installerIcons,
    appPackageUrl: new URL(`voicesubsep-${version}-x64.nsis.7z`, feed || 'http://127.0.0.1:9/').href,
    artifactName: 'VOICESUBSEP-${version}-Offline-Setup-${arch}.${ext}',
  },
};
