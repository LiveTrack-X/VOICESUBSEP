import { describe, expect, it } from "vitest";
import { captureTimelineZoomAnchor, clampTimelineZoom, timelineRulerTicks, timelineZoomScrollLeft, TIMELINE_ZOOM_LEVELS, type TimelineZoomGeometry } from "./timelineZoom";
import { densityCaptionRect, densityTile, focusDensityTrack } from "./timelineDensity";

const viewport: TimelineZoomGeometry = { scrollLeft: 3000, viewportWidth: 1000, scrollWidth: 8000, trackLeft: 113, trackWidth: 7776, duration: 3600 };

describe("timeline zoom range and source-time anchoring", () => {
  it("extends doubling through 64× and bounds invalid control values", () => {
    expect(TIMELINE_ZOOM_LEVELS).toEqual([1, 2, 4, 8, 16, 32, 64]);
    for (const zoom of TIMELINE_ZOOM_LEVELS) expect(clampTimelineZoom(zoom)).toBe(zoom);
    expect(clampTimelineZoom(0)).toBe(1); expect(clampTimelineZoom(128)).toBe(64);
    expect(clampTimelineZoom(NaN)).toBe(1); expect(clampTimelineZoom(Infinity)).toBe(1);
  });

  it("keeps a visible playhead at its existing viewport position across zoom steps", () => {
    const anchor = captureTimelineZoomAnchor(viewport, 1500)!;
    expect(anchor.time).toBe(1500); expect(anchor.viewportX).toBe(353);
    const enlarged = { ...viewport, trackWidth: 15_664, scrollWidth: 15_888 };
    const scroll = timelineZoomScrollLeft(anchor, enlarged);
    expect(enlarged.trackLeft + anchor.time / enlarged.duration * enlarged.trackWidth - scroll).toBeCloseTo(353);
    expect(scroll).toBeGreaterThan(viewport.scrollLeft);
  });

  it("keeps the viewed source time centered when the playhead is outside the scrolled view", () => {
    const anchor = captureTimelineZoomAnchor(viewport, 0)!;
    expect(anchor.viewportX).toBe(500);
    expect(anchor.time).toBeCloseTo((3000 + 500 - 113) / 7776 * 3600);
    const enlarged = { ...viewport, trackWidth: 63_440, scrollWidth: 63_664 };
    const scroll = timelineZoomScrollLeft(anchor, enlarged);
    expect(enlarged.trackLeft + anchor.time / enlarged.duration * enlarged.trackWidth - scroll).toBeCloseTo(500);
  });

  it("retains seconds if duration changes before layout and clamps at either scroll boundary", () => {
    const anchor = captureTimelineZoomAnchor(viewport, 1500)!;
    const longer = { ...viewport, duration: 7200, trackWidth: 15_664, scrollWidth: 15_888 };
    const scroll = timelineZoomScrollLeft(anchor, longer);
    expect(longer.trackLeft + 1500 / 7200 * longer.trackWidth - scroll).toBeCloseTo(anchor.viewportX);
    const fitted = { ...viewport, scrollLeft: 0, scrollWidth: 1000, trackWidth: 776 };
    expect(timelineZoomScrollLeft(anchor, fitted)).toBe(0);
    expect(timelineZoomScrollLeft({ time: 3600, viewportX: 50 }, viewport)).toBe(7000);
    expect(timelineZoomScrollLeft({ time: 0, viewportX: 500 }, viewport)).toBe(0);
  });

  it("uses only the visible source track near padding and tolerates hidden or invalid geometry", () => {
    const start = { ...viewport, scrollLeft: 0 };
    expect(captureTimelineZoomAnchor(start, -1)?.viewportX).toBe(556.5);
    expect(captureTimelineZoomAnchor(start, 0)).toEqual({ time: 0, viewportX: 113 });
    expect(captureTimelineZoomAnchor({ ...viewport, viewportWidth: 0 }, 10)).toBeNull();
    expect(captureTimelineZoomAnchor({ ...viewport, duration: 0 }, 10)).toBeNull();
    expect(captureTimelineZoomAnchor({ ...viewport, trackWidth: NaN }, 10)).toBeNull();
    expect(timelineZoomScrollLeft({ time: NaN, viewportX: 20 }, viewport)).toBe(0);
    expect(timelineZoomScrollLeft({ time: 20, viewportX: 20 }, { ...viewport, duration: Infinity })).toBe(0);
  });
});

describe("readable ruler divisions at editing zoom", () => {
  it("adds timestamp divisions throughout a 64× timeline and exposes milliseconds for short media", () => {
    const ticks = timelineRulerTicks(30, 64);
    expect(ticks).toHaveLength(385);
    expect(ticks[0]).toEqual({ time: 0, left: 0, label: "00:00.000" });
    expect(ticks[1].time).toBe(30 / 384); expect(ticks[1].label).toBe("00:00.078");
    expect(ticks.at(-1)).toEqual({ time: 30, left: 100, label: "00:30.000" });
  });
  it("shows hours for long recordings, bounds node count, and handles invalid durations", () => {
    expect(timelineRulerTicks(7200, 1).at(-1)?.label).toBe("02:00:00");
    expect(timelineRulerTicks(7 * 86400, 128)).toHaveLength(385);
    expect(timelineRulerTicks(0, 64)).toEqual([]);
    expect(timelineRulerTicks(NaN, 64)).toEqual([]);
  });
  it("does not label a fractional-second tick as a different whole second", () => {
    const tick = timelineRulerTicks(600, 64)[1]!;
    expect(tick.time).toBe(1.5625);
    expect(tick.label).toBe("00:01.563");
  });
});

describe("64× dense timeline compatibility", () => {
  it.each([1, 1.25, 1.5, 2, 3])("keeps the scrolled raster viewport-sized at DPR %s", dpr => {
    const trackWidth = 2000 * 64, start = 64_000;
    const tile = densityTile(trackWidth, start, start + 1920, dpr);
    expect(tile.width / tile.cssWidth).toBe(dpr);
    expect(tile.cssWidth).toBeLessThanOrEqual(1920 + 192 + 1);
    expect(tile.width * tile.height * 4).toBeLessThan(2_000_000);
    expect(densityCaptionRect(1800, 1801, 3600, tile)).not.toBeNull();
    expect(densityCaptionRect(100, 101, 3600, tile)).toBeNull();
  });
  it("preserves scrolled right-click coordinates and the same source anchor after focus", () => {
    let scrollLeft = viewport.scrollLeft;
    const track = { focus: (options?: FocusOptions) => { if (!options?.preventScroll) scrollLeft = 0; } } as HTMLElement;
    let prevented = false;
    focusDensityTrack({ target: track, currentTarget: track, pointerType: "mouse", button: 2, preventDefault: () => { prevented = true; } }, true);
    if (!prevented) track.focus();
    expect(scrollLeft).toBe(viewport.scrollLeft);
    expect(captureTimelineZoomAnchor({ ...viewport, scrollLeft }, 1500)).toEqual({ time: 1500, viewportX: 353 });
  });
});
