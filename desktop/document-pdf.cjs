const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const MAX_HTML_BYTES = 4 * 1024 * 1024;
function validatePdfRequest(value) {
  if (!value || typeof value !== 'object' || Object.keys(value).some(key => !['html', 'suggestedName'].includes(key))
      || typeof value.html !== 'string' || !value.html.trim() || Buffer.byteLength(value.html, 'utf8') > MAX_HTML_BYTES
      || typeof value.suggestedName !== 'string' || value.suggestedName.length > 240) {
    throw new Error('유효한 PDF 문서가 필요합니다.');
  }
  const name = value.suggestedName.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').slice(0, 180) || 'transcript';
  // The export renderer has no scripts, network, preload or access to the app session.
  const policy = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; base-uri \'none\'; form-action \'none\'; frame-src \'none\'">';
  return { html: `<!doctype html><html><head><meta charset="utf-8">${policy}</head><body>${value.html}</body></html>`,
    suggestedName: name.toLowerCase().endsWith('.pdf') ? name : `${name}.pdf` };
}

async function deadline(operation, milliseconds = 60000) {
  let timer;
  try { return await Promise.race([operation, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('PDF 생성 시간이 초과되었습니다.')), milliseconds); })]); }
  finally { clearTimeout(timer); }
}

function createDocumentPdfService({ BrowserWindow, session, dialog, getWindow, fileSystem = fs, timeoutMs = 60000 }) {
  let busy = false;
  // Electron keeps named sessions for the process lifetime. Reuse one isolated
  // in-memory session, and release each document URL from its request listener.
  const partition = `voicesubsep-pdf-${randomUUID()}`;
  let isolated;
  return async value => {
    if (busy) throw new Error('다른 PDF 저장이 진행 중입니다.');
    const request = validatePdfRequest(value);
    busy = true;
    let renderer, temporary;
    try {
      const saveOptions = { title: 'PDF 저장', defaultPath: request.suggestedName,
        filters: [{ name: 'PDF', extensions: ['pdf'] }], properties: ['showOverwriteConfirmation', 'createDirectory'] };
      let destination;
      for (;;) {
        const selection = await dialog.showSaveDialog(getWindow(), saveOptions);
        if (selection.canceled || !selection.filePath) return { status: 'cancelled' };
        if (selection.filePath.toLowerCase().endsWith('.pdf')) {
          destination = selection.filePath;
          break;
        }
        // An extension added after the dialog changes its overwrite target. Let
        // the native dialog confirm the exact final path before writing anything.
        saveOptions.defaultPath = `${selection.filePath}.pdf`;
      }
      if (!isolated) isolated = session.fromPartition(partition, { cache: false });
      isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
      isolated.setPermissionCheckHandler(() => false);
      const documentUrl = `data:text/html;charset=utf-8,${encodeURIComponent(request.html)}`;
      isolated.webRequest.onBeforeRequest((details, callback) => callback({ cancel: details.resourceType !== 'mainFrame' || details.url !== documentUrl }));
      renderer = new BrowserWindow({ show: false, width: 900, height: 1200, webPreferences: {
        session: isolated, javascript: false, nodeIntegration: false, contextIsolation: true,
        sandbox: true, webSecurity: true, webviewTag: false,
      } });
      renderer.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      renderer.webContents.on('will-navigate', event => event.preventDefault());
      renderer.webContents.on('will-attach-webview', event => event.preventDefault());
      await deadline(renderer.loadURL(documentUrl), timeoutMs);
      const pdf = await deadline(renderer.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true, pageSize: 'A4' }), timeoutMs);
      if (!Buffer.isBuffer(pdf) || pdf.length < 5 || pdf.subarray(0, 5).toString() !== '%PDF-' || pdf.length > 64 * 1024 * 1024) {
        throw new Error('PDF 파일을 생성하지 못했습니다.');
      }
      temporary = path.join(path.dirname(destination), `.voicesubsep-${randomUUID()}.pdf.tmp`);
      await fileSystem.writeFile(temporary, pdf, { flag: 'wx' });
      await fileSystem.rename(temporary, destination);
      temporary = undefined;
      return { status: 'saved', filePath: destination };
    } finally {
      try {
        if (renderer && !renderer.isDestroyed()) renderer.destroy();
      } finally {
        // Never leave the service busy if Chromium has already exited, and do
        // not retain an entire private transcript in a long-lived session hook.
        try {
          try {
            if (isolated) isolated.webRequest.onBeforeRequest(null);
          } finally {
            if (temporary) await fileSystem.unlink(temporary).catch(() => {});
          }
        } finally { busy = false; }
      }
    }
  };
}

module.exports = { validatePdfRequest, createDocumentPdfService, MAX_HTML_BYTES };
