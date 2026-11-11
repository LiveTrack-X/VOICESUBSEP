import { formatTime } from "./domain";

export const TIMELINE_ZOOM_LEVELS = [1, 2, 4, 8, 16, 32, 64] as const;
export type TimelineZoomGeometry = { scrollLeft: number; viewportWidth: number; scrollWidth: number; trackLeft: number; trackWidth: number; duration: number };
export type TimelineZoomAnchor = { time: number; viewportX: number };
export function clampTimelineZoom(value: number) { return Number.isFinite(value) ? Math.max(1, Math.min(64, value)) : 1; }

function validGeometry(geometry: TimelineZoomGeometry) {
  return Object.values(geometry).every(Number.isFinite) && geometry.duration > 0 && geometry.viewportWidth > 0 && geometry.trackWidth > 0;
}

/** Preserve the visible playhead, or the middle of the viewed source interval
 * when playback is elsewhere. Track offsets include the ruler/row labels. */
export function captureTimelineZoomAnchor(geometry: TimelineZoomGeometry, time: number): TimelineZoomAnchor | null {
  if (!validGeometry(geometry)) return null;
  const { scrollLeft, viewportWidth, trackLeft, trackWidth, duration } = geometry;
  const trackX = trackLeft - scrollLeft;
  const left = Math.max(0, trackX), right = Math.min(viewportWidth, trackX + trackWidth);
  if (right <= left) return null;
  const playhead = trackX + time / duration * trackWidth;
  if (Number.isFinite(time) && time >= 0 && time <= duration && playhead >= left && playhead <= right) return { time, viewportX: playhead };
  const viewportX = (left + right) / 2;
  return { time: (scrollLeft + viewportX - trackLeft) / trackWidth * duration, viewportX };
}

/** Read the new DOM geometry after zoom; fixed label widths mean multiplying
 * scrollLeft by the zoom ratio alone would move the source-time anchor. */
export function timelineZoomScrollLeft(anchor: TimelineZoomAnchor, geometry: TimelineZoomGeometry) {
  if (!validGeometry(geometry) || !Number.isFinite(anchor.time) || !Number.isFinite(anchor.viewportX)) return 0;
  const time = Math.max(0, Math.min(geometry.duration, anchor.time));
  return Math.max(0, Math.min(Math.max(0, geometry.scrollWidth - geometry.viewportWidth),
    geometry.trackLeft + time / geometry.duration * geometry.trackWidth - anchor.viewportX));
}

export function timelineRulerTicks(duration: number, zoom: number): { time: number; left: number; label: string }[] {
  if (!Number.isFinite(duration) || duration <= 0) return [];
  const divisions = Math.round(6 * clampTimelineZoom(zoom));
  const fractional = duration / divisions < 1;
  return Array.from({ length: divisions + 1 }, (_, index) => {
    const time = duration * index / divisions;
    const formatted = formatTime(time);
    const label = (duration >= 3600 ? formatted : formatted.slice(3));
    const needsMilliseconds = fractional || Math.abs(time - Math.round(time)) > 1e-6;
    return { time, left: index / divisions * 100, label: needsMilliseconds ? label : label.slice(0, -4) };
  });
}
