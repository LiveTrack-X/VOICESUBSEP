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
  appVersion(): Promise<string>;
  updateStatus(): Promise<UpdateStatus>;
  onUpdateStatus(callback: (status: UpdateStatus) => void): () => void;
  checkUpdate(): Promise<UpdateStatus>;
  downloadUpdate(): Promise<UpdateStatus>;
  installUpdate(): Promise<UpdateStatus>;
}
declare global { interface Window { voicesubsepDesktop?: DesktopBridge } }
