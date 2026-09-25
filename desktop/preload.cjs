const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('voicesubsepDesktop', Object.freeze({
  appVersion: () => ipcRenderer.invoke('desktop:version'),
  saveDocumentPdf: request => ipcRenderer.invoke('desktop:save-document-pdf', request),
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
