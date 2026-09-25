const { sameOrigin } = require('./helpers.cjs');

/** Only a visible native approval can grant microphone/system recording. No devices are opened here. */
function installCapturePermissions({ session, getWindow, getUiUrl, dialog, desktopCapturer, platform = process.platform }) {
  let prompting = false;
  const microphoneApprovals = new WeakMap();
  const documents = new WeakMap();
  const documentFor = (contents) => {
    let state = documents.get(contents);
    if (!state) {
      state = { generation: 0 };
      documents.set(contents, state);
      contents.on('did-start-navigation', (event, _url, _inPlace, isMainFrame) => {
        if (event.isMainFrame === true || isMainFrame === true) {
          state.generation++;
          microphoneApprovals.delete(contents);
        }
      });
      contents.once('destroyed', () => microphoneApprovals.delete(contents));
    }
    return state;
  };
  const windowFor = (contents, details = {}) => {
    const win = getWindow();
    if (!win || win.isDestroyed() || !contents || contents !== win.webContents || contents.isDestroyed() ||
      details.isMainFrame !== true || !sameOrigin(contents.getURL(), getUiUrl()) || !sameOrigin(details.requestingUrl ?? details.securityOrigin ?? '', getUiUrl())) return null;
    return win;
  };
  // Chromium independently checks audio permission when enumerating devices.
  // Always denying that check redacts labels even while an approved microphone
  // is open. Retain audio-only approval for this document, never across reloads.
  // Generic media checks still reach the explicit per-request consent handler.
  session.setPermissionCheckHandler((contents, permission, origin, details = {}) => {
    if (permission !== 'media' || details.mediaType !== 'audio' ||
        !sameOrigin(origin, getUiUrl()) || !windowFor(contents, details)) return false;
    return microphoneApprovals.has(contents) && microphoneApprovals.get(contents) === documents.get(contents)?.generation;
  });
  session.setPermissionRequestHandler((contents, permission, callback, details) => {
    const win = windowFor(contents, details);
    if (!win) { callback(false); return; }
    // The display handler below independently verifies the frame, gesture and explicit selection.
    if (permission === 'display-capture') { callback(platform === 'win32'); return; }
    if (permission !== 'media' || !Array.isArray(details.mediaTypes) || details.mediaTypes.length !== 1 || details.mediaTypes[0] !== 'audio' || prompting) { callback(false); return; }
    const document = documentFor(contents);
    const generation = document.generation;
    const frame = contents.mainFrame;
    prompting = true;
    let finished = false;
    const finish = (allowed) => {
      if (finished) return;
      finished = true; prompting = false;
      const approved = allowed && !!windowFor(contents, details) &&
        document.generation === generation && contents.mainFrame === frame;
      if (approved) microphoneApprovals.set(contents, generation);
      else microphoneApprovals.delete(contents);
      try { callback(approved); } catch { /* Request frame was destroyed. */ }
    };
    void Promise.resolve().then(() => dialog.showMessageBox(win, { type: 'question', title: 'VOICESUBSEP · 마이크 녹음',
      message: '마이크 사용을 허용할까요?',
      detail: '장치 확인은 입력 이름을 확인한 뒤 마이크를 해제합니다. 녹음 시작을 누른 경우에는 소리를 저장하며, 녹음 중지 버튼이나 창 종료로 끝낼 수 있습니다. 이 화면에서 허용한 입력 목록은 앱을 새로 열기 전까지 확인할 수 있습니다.',
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
