const { EventEmitter } = require('node:events');
const { validateUpdateUrl, initialUpdateStatus } = require('./helpers.cjs');

class UpdateController extends EventEmitter {
  constructor({ updater, version, feed, packaged, beforeInstall = async () => {}, recoverInstall = async () => {} }) {
    super();
    this.updater = updater;
    this.beforeInstall = beforeInstall;
    this.recoverInstall = recoverInstall;
    this.installFailure = null;
    this.feed = validateUpdateUrl(feed);
    this.status = initialUpdateStatus(version, this.feed, packaged);
    this.downloading = false;
    this.checking = false;
    this.ready = false;
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.allowDowngrade = false;
    updater.allowPrerelease = false;
    if (this.status.configured) updater.setFeedURL({ provider: 'generic', url: this.feed });
    updater.on('checking-for-update', () => this.set({ state: 'checking', error: undefined, message: '업데이트를 확인하고 있습니다.' }));
    updater.on('update-available', (info) => this.set({ state: 'available', availableVersion: String(info.version), progress: undefined, message: '새 버전을 다운로드할 수 있습니다.' }));
    updater.on('update-not-available', () => this.set({ state: 'not-available', availableVersion: undefined, message: '현재 설치된 버전이 최신입니다.' }));
    updater.on('download-progress', ({ percent }) => this.set({ state: 'downloading', progress: Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0, message: '업데이트를 다운로드하고 있습니다.' }));
    updater.on('update-downloaded', (info) => {
      this.ready = true;
      this.set({ state: 'downloaded', availableVersion: String(info.version), progress: 100, message: '다운로드가 완료되었습니다. 작업을 저장한 뒤 다시 시작하세요.' });
    });
    updater.on('error', (error) => {
      if (this.status.state === 'installing') void this.recover(error);
      else this.fail(error);
    });
  }

  snapshot() { return { ...this.status }; }
  set(patch) { this.status = { ...this.status, ...patch }; this.emit('status', this.snapshot()); return this.snapshot(); }
  fail(error) {
    if (error?.code === 'UPDATE_CACHE_INVALID') this.ready = false;
    return this.set({ state: 'error', error: String(error?.message ?? error).slice(0, 1500), message: '업데이트 작업에 실패했습니다. 네트워크와 배포 서버를 확인하세요.' });
  }

  recover(error) {
    if (this.installFailure) return this.installFailure;
    // A launch failure can retry the verified files. A missing/corrupt cache
    // must instead release the download guard, even if backend recovery fails.
    if (error?.code === 'UPDATE_CACHE_INVALID') this.ready = false;
    this.set({ state: 'installing', message: '설치에 실패해 분석 서버를 복구하고 있습니다.' });
    this.installFailure = (async () => {
      try { await this.recoverInstall(); return this.fail(error); }
      catch (recoveryError) { return this.fail(new Error(`설치 후 서버를 복구하지 못했습니다. 프로젝트를 저장하고 앱을 다시 시작하세요.\n${error?.message ?? error}\n서버 복구 실패: ${recoveryError?.message ?? recoveryError}`)); }
    })();
    return this.installFailure;
  }

  async check() {
    // An installer-launch error must not trap the UI on an inert "check" action.
    if (this.status.configured && this.ready && this.status.state === 'error') return this.set({ state: 'downloaded', error: undefined, message: '다운로드한 설치 파일이 준비되어 있습니다. 다시 설치를 시도할 수 있습니다.' });
    if (!this.status.configured || this.checking || this.downloading || this.ready || this.status.state === 'installing') return this.snapshot();
    this.checking = true;
    this.set({ state: 'checking', error: undefined, progress: undefined });
    try { await this.updater.checkForUpdates(); }
    catch (error) { this.fail(error); }
    finally { this.checking = false; }
    return this.snapshot();
  }

  async download() {
    if (!this.status.configured || this.downloading || this.checking || this.ready || !this.status.availableVersion || !['available', 'error'].includes(this.status.state)) return this.snapshot();
    this.downloading = true;
    this.set({ state: 'downloading', error: undefined, progress: 0 });
    try { await this.updater.downloadUpdate(); }
    catch (error) { this.fail(error); }
    finally { this.downloading = false; }
    return this.snapshot();
  }

  async install() {
    if (!this.status.configured || !this.ready || this.status.state === 'installing') return this.snapshot();
    this.installFailure = null;
    this.set({ state: 'installing', error: undefined, message: '분석 서버를 종료한 뒤 업데이트를 설치합니다.' });
    try {
      await this.beforeInstall();
      await this.updater.quitAndInstall(false, true);
      if (this.installFailure) await this.installFailure;
    } catch (error) { await this.recover(error); }
    return this.snapshot();
  }
}

module.exports = { UpdateController };
