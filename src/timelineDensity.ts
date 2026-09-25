export type DensityTile = { left: number; cssWidth: number; cssHeight: number; width: number; height: number; dpr: number; trackWidth: number };
/** Rasterize only the visible portion plus a small scroll margin. Backing pixels
 * follow DPR exactly; they never represent the entire zoomed timeline. */
export function densityTile(trackWidth: number, visibleStart: number, visibleEnd: number, pixelRatio: number, overscan = 96): DensityTile {
  const dpr = Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1;
  const total = Number.isFinite(trackWidth) ? Math.max(0, trackWidth) : 0;
  const start = Math.max(0, Math.min(total, Number.isFinite(visibleStart) ? visibleStart : 0));
  const end = Math.max(start, Math.min(total, Number.isFinite(visibleEnd) ? visibleEnd : 0));
  const left = Math.floor(Math.max(0, start - overscan) * dpr) / dpr;
  const right = end > start ? Math.min(total, end + overscan) : left;
  const width = Math.max(1, Math.ceil((right - left) * dpr));
  const height = Math.max(1, Math.ceil(23 * dpr));
  return { left, cssWidth: width / dpr, cssHeight: height / dpr, width, height, dpr, trackWidth: total };
}
export function densityCaptionRect(start: number, end: number, duration: number, tile: DensityTile) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(duration) || duration <= 0 || end <= start) return null;
  const first = start / duration * tile.trackWidth;
  const firstPixel = Math.round((first - tile.left) * tile.dpr);
  const lastPixel = Math.max(firstPixel + Math.ceil(2 * tile.dpr), Math.round((end / duration * tile.trackWidth - tile.left) * tile.dpr));
  const x = Math.max(0, firstPixel);
  const right = Math.min(tile.width, lastPixel);
  if (right <= x) return null;
  const y = Math.round(3 * tile.dpr), bottom = Math.round(20 * tile.dpr);
  return { x, y, width: right - x, height: bottom - y };
}

/** Focusing a very wide tabindex track normally scrolls its left edge into view
 * before click coordinates are read. Preserve the viewport for background mouse
 * clicks while leaving caption buttons, resize handles and touch panning alone. */
export function focusDensityTrack(event: { target: EventTarget | null; currentTarget: HTMLElement; pointerType: string; button: number; preventDefault: () => void }, dense: boolean) {
  if (!dense || event.target !== event.currentTarget || event.pointerType !== 'mouse' || ![0,2].includes(event.button)) return;
  event.preventDefault();
  event.currentTarget.focus({ preventScroll: true });
}
