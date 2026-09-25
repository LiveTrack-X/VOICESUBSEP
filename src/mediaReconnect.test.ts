import { describe, expect, it, vi } from 'vitest';
import type { DesktopBridge } from './desktop';
import { checkedRestoredMedia, sourceUrl } from './mediaSource';
import { MediaReconnect } from './mediaReconnect';
import { uploadMedia } from './api';
import { LOCALES, translate } from './i18n';
import { mediaReconnectMessages } from './i18n-media-reconnect';

const expected = { sha256: 'a'.repeat(64), bytes: 8_900_000_000 };
const media = { ...expected, id: 'b'.repeat(32), name: 'original.mp4', duration: 900, audioTracks: [{ index: 1, channels: 2, label: 'Audio' }], url: `/api/media/${'b'.repeat(32)}/file` };
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };
describe('original reconnection', () => {
  it('has translated reconnect statuses in every supported interface language', () => {
    for (const locale of LOCALES) for (const key of Object.keys(mediaReconnectMessages)) {
      expect(translate(locale, key)).toBeTruthy();
      if (locale !== 'ko') expect(translate(locale, key)).not.toMatch(/[가-힣]/u);
    }
  });
  it('uses a validated backend source URL, never a huge blob or fake empty File', () => {
    const source = checkedRestoredMedia(media, expected);
    expect(source.size).toBe(expected.bytes); expect(source.kind).toBe('desktop-media');
    expect(sourceUrl(source).url).toBe(media.url);
  });
  it.each([
    { ...media, sha256: 'c'.repeat(64) }, { ...media, bytes: 1 },
    { ...media, url: 'file:///private/media.mp4' }, { ...media, url: 'https://example.com/media' },
    { ...media, url: '/api/media/../../secret' }, { ...media, duration: NaN },
  ])('rejects mismatch or untrusted URLs before playback', value => {
    expect(() => checkedRestoredMedia(value, expected)).toThrow();
  });
  it('ignores an old result after switching to another project or reopening the same project', async () => {
    const one = deferred<Awaited<ReturnType<NonNullable<DesktopBridge['restoreMedia']>>>>();
    const two = deferred<Awaited<ReturnType<NonNullable<DesktopBridge['restoreMedia']>>>>();
    const restoreMedia = vi.fn().mockReturnValueOnce(one.promise).mockReturnValueOnce(two.promise);
    const cancelMediaRestore = vi.fn().mockResolvedValue({ cancelled: true });
    const bridge = { restoreMedia, cancelMediaRestore } as unknown as DesktopBridge;
    const receive = vi.fn(); const controller = new MediaReconnect();
    const first = controller.start(bridge, 'same-project', expected, receive);
    const second = controller.start(bridge, 'same-project', expected, receive);
    one.resolve({ status: 'ready', media }); await first;
    expect(receive).not.toHaveBeenCalled(); expect(cancelMediaRestore).toHaveBeenCalledTimes(1);
    two.resolve({ status: 'ready', media }); await second;
    expect(receive).toHaveBeenCalledTimes(1); expect(receive.mock.calls[0][0].source.media.id).toBe(media.id);
  });
  it('ignores a ready response after manual reconnect/cancel, without applying or restarting analysis', async () => {
    const task = deferred<Awaited<ReturnType<NonNullable<DesktopBridge['restoreMedia']>>>>();
    const bridge = { restoreMedia: () => task.promise, cancelMediaRestore: vi.fn().mockResolvedValue({ cancelled: true }) } as unknown as DesktopBridge;
    const receive = vi.fn(), controller = new MediaReconnect();
    const operation = controller.start(bridge, 'p', expected, receive); controller.cancel();
    task.resolve({ status: 'ready', media }); await operation;
    expect(receive).not.toHaveBeenCalled(); expect(bridge.cancelMediaRestore).toHaveBeenCalledOnce();
  });
  it('checks the restored cache identity on later analysis/render access and does not POST an empty source', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(media), { status: 200 }));
    vi.stubGlobal('fetch', fetcher);
    try {
      expect(await uploadMedia(checkedRestoredMedia(media, expected))).toMatchObject(media);
      expect(fetcher.mock.calls[0][0]).toBe(`/api/media/${media.id}`);
      expect(fetcher.mock.calls[0][1]?.method).not.toBe('POST');
      fetcher.mockResolvedValue(new Response(JSON.stringify({ ...media, sha256: 'c'.repeat(64) }), { status: 200 }));
      await expect(uploadMedia(checkedRestoredMedia(media, expected))).rejects.toThrow();
    } finally { vi.unstubAllGlobals(); }
  });
});
