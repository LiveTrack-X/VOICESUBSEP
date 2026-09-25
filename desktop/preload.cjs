const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('voicesubsepDesktop', Object.freeze({
  appVersion: () => ipcRenderer.invoke('desktop:version'),
  saveDocumentPdf: request => ipcRenderer.invoke('desktop:save-document-pdf', request),
  rememberMedia: (file, request) => {
    // Never accept a filesystem path from renderer JSON or expose it back.
    const filePath = webUtils.getPathForFile(file);
    if (!filePath) return Promise.resolve({ remembered: false });
    return ipcRenderer.invoke('desktop:remember-media', { projectId: request?.projectId, identity: request?.identity, mediaId: request?.mediaId, path: filePath });
  },
  restoreMedia: request => ipcRenderer.invoke('desktop:restore-media', { projectId: request?.projectId, identity: request?.identity, operationId: request?.operationId }),
  cancelMediaRestore: operationId => ipcRenderer.invoke('desktop:cancel-media-restore', operationId),
  updateStatus: () => ipcRenderer.invoke('desktop:update-status'),
  checkUpdate: () => ipcRenderer.invoke('desktop:update-check'),
  downloadUpdate: () => ipcRenderer.invoke('desktop:update-download'),
  installUpdate: () => ipcRenderer.invoke('desktop:update-install'),
  onUpdateStatus: (callback) => {
    if (typeof callback !== 'function') throw new TypeError('상태 수신 함수가 필요합니다.');
    const handler = (_event, status) => callback(status);
    ipcRenderer.on('desktop:update-status-changed', handler);
    return () => ipcRenderer.removeListener('desktop:update-status-changed', handler);
  },
}));
