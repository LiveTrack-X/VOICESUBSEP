import type { MediaInfo } from './api';
import { parseMediaIdentity, sameMediaIdentity, type MediaIdentity } from './mediaIdentity';

/** A restored source stays in the local backend cache. It is not a fake empty File
 * and is never materialized as a multi-gigabyte browser Blob. */
export type DesktopMediaSource = { kind: 'desktop-media'; name: string; size: number; media: MediaInfo };
export type MediaSource = File | DesktopMediaSource;
export function isDesktopMediaSource(value: MediaSource): value is DesktopMediaSource {
  return 'kind' in value && value.kind === 'desktop-media';
}
export function checkedRestoredMedia(value: unknown, expected: MediaIdentity): DesktopMediaSource {
  if (!value || typeof value !== 'object') throw new Error('원본 자동 연결 결과를 확인할 수 없습니다. 파일을 다시 연결하세요.');
  const media = value as MediaInfo;
  const actual = parseMediaIdentity({ sha256: media.sha256, bytes: media.bytes });
  if (!sameMediaIdentity(actual, expected) || !/^[a-f0-9]{32}$/u.test(media.id) || media.url !== `/api/media/${media.id}/file` ||
      typeof media.name !== 'string' || !media.name || !Number.isFinite(media.duration) || media.duration <= 0 || !Array.isArray(media.audioTracks)) {
    throw new Error('원본 자동 연결 결과를 확인할 수 없습니다. 파일을 다시 연결하세요.');
  }
  return { kind: 'desktop-media', name: media.name, size: actual.bytes, media: { ...media } };
}
export function sourceUrl(source: MediaSource): { url: string; release: () => void } {
  if (isDesktopMediaSource(source)) return { url: source.media.url, release: () => {} };
  const url = URL.createObjectURL(source);
  return { url, release: () => URL.revokeObjectURL(url) };
}
