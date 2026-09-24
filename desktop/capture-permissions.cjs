const { sameOrigin } = require('./helpers.cjs');

/** Only a visible native approval can grant microphone/system recording. No devices are opened here. */
function installCapturePermissions({ session, getWindow, getUiUrl, dialog, desktopCapturer, platform = process.platform }) {
  let prompting = false;
  const windowFor = (contents, details = {}) => {
    const win = getWindow();
    if (!win || win.isDestroyed() || !contents || contents !== win.webContents || contents.isDestroyed() ||
      details.isMainFrame !== true || !sameOrigin(contents.getURL(), getUiUrl()) || !sameOrigin(details.requestingUrl ?? details.securityOrigin ?? '', getUiUrl())) return null;
    return win;
  };
  // Returning false ensures Chromium reaches our per-request consent handler.
  session.setPermissionCheckHandler(() => false);
  session.setPermissionRequestHandler((contents, permission, callback, details) => {
    const win = windowFor(contents, details);
    if (!win) { callback(false); return; }
    // The display handler below independently verifies the frame, gesture and explicit selection.
    if (permission === 'display-capture') { callback(platform === 'win32'); return; }
    if (permission !== 'media' || !Array.isArray(details.mediaTypes) || details.mediaTypes.length !== 1 || details.mediaTypes[0] !== 'audio' || prompting) { callback(false); return; }
    prompting = true;
    let finished = false;
    const finish = (allowed) => {
      if (finished) return;
      finished = true; prompting = false;
      try { callback(allowed); } catch { /* Request frame was destroyed. */ }
    };
    void Promise.resolve().then(() => dialog.showMessageBox(win, { type: 'question', title: 'VOICESUBSEP · 마이크 녹음',
      message: '선택한 마이크 소리를 녹음하도록 허용할까요?',
      detail: '라이브 녹음 화면의 시작 요청입니다. 녹음 중지 버튼이나 창 종료로 마이크 사용을 끝낼 수 있습니다.',
      buttons: ['취소', '마이크 허용'], defaultId: 0, cancelId: 0, noLink: true,
    })).then(({ response }) => finish(response === 1 && !!windowFor(contents, details))).catch(() => finish(false));
  });
  session.setDisplayMediaRequestHandler((request, callback) => {
    const win = getWindow();
    const valid = () => platform === 'win32' && win && !win.isDestroyed() && !win.webContents.isDestroyed() &&
      request.frame === win.webContents.mainFrame && sameOrigin(request.securityOrigin, getUiUrl()) &&
      sameOrigin(win.webContents.getURL(), getUiUrl()) && request.userGesture === true && request.audioRequested === true && request.videoRequested === true;
    if (!valid() || prompting) { callback({}); return; }
    prompting = true;
    let finished = false;
    const finish = (selection) => {
      if (finished) return;
      finished = true; prompting = false;
      try { callback(selection); } catch { /* Request frame was destroyed. */ }
    };
    void (async () => {
      try {
        const sources = (await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: false })).slice(0, 8);
        if (!sources.length || !valid()) { finish({}); return; }
        const { response } = await dialog.showMessageBox(win, { type: 'question', title: 'VOICESUBSEP · 컴퓨터 소리 녹음',
          message: '컴퓨터에서 재생되는 전체 소리를 녹음할까요?',
          detail: '게임·통화·알림 등 시스템 재생음이 함께 포함됩니다. 아래 화면을 선택하면 캡처 권한을 부여합니다. 앱은 화면 영상을 녹음 파일에 넣지 않습니다.',
          buttons: ['취소', ...sources.map((source) => source.name)], defaultId: 0, cancelId: 0, noLink: true,
        });
        if (!valid() || response < 1 || response > sources.length) { finish({}); return; }
        finish({ video: sources[response - 1], audio: 'loopback' });
      } catch { finish({}); }
    })();
  });
}

module.exports = { installCapturePermissions };
