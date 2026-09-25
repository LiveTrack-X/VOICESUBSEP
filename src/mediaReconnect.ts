import type { DesktopBridge } from './desktop';
import { checkedRestoredMedia, type DesktopMediaSource } from './mediaSource';
import type { MediaIdentity } from './mediaIdentity';

export type ReconnectResult = { status: 'ready'; source: DesktopMediaSource } | { status: 'unremembered' | 'missing' | 'changed' | 'unavailable' | 'cancelled' };
export const reconnectMessage = (status: Exclude<ReconnectResult['status'], 'ready'>): string => ({
  unremembered: '원본 위치 기록이 없습니다. 한 번 다시 연결하면 다음부터 자동 연결됩니다.',
  missing: '기억한 위치에서 원본을 찾지 못했습니다. 파일을 다시 연결하세요.',
  changed: '기억한 위치의 파일 내용이 원본과 다릅니다. 원본 파일을 다시 연결하세요.',
  unavailable: '원본 자동 연결을 완료하지 못했습니다. 파일을 다시 연결하세요.',
  cancelled: '',
})[status];

/** Cancels native IO and rejects late results, including close/reopen of the same project. */
export class MediaReconnect {
  private generation = 0;
  private current: { bridge: DesktopBridge; operationId: string } | null = null;
  cancel() {
    this.generation++;
    const operation = this.current; this.current = null;
    if (operation) void operation.bridge.cancelMediaRestore?.(operation.operationId).catch(() => {});
  }
  async start(bridge: DesktopBridge, projectId: string, identity: MediaIdentity, receive: (result: ReconnectResult) => void) {
    this.cancel();
    if (!bridge.restoreMedia) return;
    const generation = this.generation;
    const operationId = crypto.randomUUID(); this.current = { bridge, operationId };
    try {
      const result = await bridge.restoreMedia({ projectId, identity, operationId });
      if (generation !== this.generation) return;
      receive(result.status === 'ready' ? { status: 'ready', source: checkedRestoredMedia(result.media, identity) } : result);
    } catch { if (generation === this.generation) receive({ status: 'unavailable' }); }
    finally { if (generation === this.generation) this.current = null; }
  }
}
