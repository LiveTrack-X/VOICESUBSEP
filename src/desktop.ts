export type UpdateStatus = {
  state: 'unconfigured' | 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'installing' | 'error';
  configured: boolean;
  currentVersion: string;
  availableVersion?: string;
  progress?: number;
  message?: string;
  error?: string;
};
export interface DesktopBridge {
  rememberMedia?(file: File, request: { projectId: string; identity: import('./mediaIdentity').MediaIdentity; mediaId: string }): Promise<{ remembered: boolean }>;
  restoreMedia?(request: { projectId: string; identity: import('./mediaIdentity').MediaIdentity; operationId: string }): Promise<{ status: 'ready'; media: import('./api').MediaInfo } | { status: 'unremembered' | 'missing' | 'changed' | 'unavailable' | 'cancelled' }>;
  cancelMediaRestore?(operationId: string): Promise<{ cancelled: boolean }>;
  saveDocumentPdf?(request: { html: string; suggestedName: string }): Promise<{ status: "saved" | "cancelled"; filePath?: string }>;
  appVersion(): Promise<string>;
  updateStatus(): Promise<UpdateStatus>;
  onUpdateStatus(callback: (status: UpdateStatus) => void): () => void;
  checkUpdate(): Promise<UpdateStatus>;
  downloadUpdate(): Promise<UpdateStatus>;
  installUpdate(): Promise<UpdateStatus>;
}
declare global { interface Window { voicesubsepDesktop?: DesktopBridge } }
