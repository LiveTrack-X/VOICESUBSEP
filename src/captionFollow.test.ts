import { describe, expect, it, vi } from "vitest";
import { CAPTION_FOLLOW_KEY, CAPTION_FOLLOW_PAUSE_MS, CaptionFollowGate, CaptionFollowPosition, captionFollowTop, followEditingTarget, loadCaptionFollow, playingCaptionId, saveCaptionFollow } from "./captionFollow";
import { CaptionVirtualLayout } from "./captionVirtualList";

describe("playback-follow scroll without project mutation", () => {
  const captions = [{ id: "one", start: 0, end: 2 }, { id: "two", start: 1, end: 3 }, { id: "three", start: 5, end: 6 }];
  it("retains an active overlapping row then advances without selecting or seeking", () => {
    const before = JSON.stringify(captions);
    expect(playingCaptionId(captions, 1.5, "two")).toBe("two");
    expect(playingCaptionId(captions, 1.5, null)).toBe("one");
    expect(playingCaptionId(captions, 2, "one")).toBe("two");
    expect(playingCaptionId(captions, 4, "two")).toBeNull();
    expect(playingCaptionId(captions, 5, "two")).toBe("three");
    expect(JSON.stringify(captions)).toBe(before);
  });
  it("uses only provided filtered captions, never requesting hidden rows", () => {
    expect(playingCaptionId([captions[2]!], 1, "one")).toBeNull();
    expect(playingCaptionId([], 1, null)).toBeNull();
    expect(playingCaptionId(captions, NaN, null)).toBeNull();
    expect(playingCaptionId(captions, -1, null)).toBeNull();
  });
  it("centers already visible and off-screen virtual rows, bounded at both ends", () => {
    const layout = new CaptionVirtualLayout(Array.from({ length: 2404 }, (_, index) => `caption-${index}`), new Map(), "test", 60);
    expect(captionFollowTop(layout, "caption-3", 0, 300)).toBe(60);
    expect(captionFollowTop(layout, "caption-3", 60, 300)).toBeNull();
    expect(captionFollowTop(layout, "caption-3", 60.4, 300)).toBeNull();
    expect(captionFollowTop(layout, "caption-100", 0, 300)).toBe(5880);
    expect(captionFollowTop(layout, "caption-2403", 0, 300)).toBe(layout.total - 300);
    expect(captionFollowTop(layout, "caption-0", 6000, 300)).toBe(0);
    expect(captionFollowTop(layout, "not-in-filter", 0, 300)).toBeNull();
    expect(captionFollowTop(layout, "caption-100", 0, 0)).toBeNull();
  });
  it("keeps the beginning of a row taller than the viewport readable and stable", () => {
    const layout = new CaptionVirtualLayout(["before", "tall", "after"], new Map([["tall", { height: 700, context: "test" }]]), "test", 60);
    expect(captionFollowTop(layout, "tall", 100, 300)).toBe(60);
    expect(captionFollowTop(layout, "tall", 60, 300)).toBeNull();
    expect(captionFollowTop(layout, "tall", 750, 300)).toBe(60);
  });
});

describe("center only on navigation, caption transitions or changed geometry", () => {
  const frame = { id: "cue", time: 1, playing: true, rowTop: 600, rowHeight: 60, total: 6000, viewportHeight: 300 };
  it("ignores ordinary same-caption playback ticks but centers the next caption and playback seeks", () => {
    const position = new CaptionFollowPosition();
    expect(position.changed(frame)).toBe(true);
    for (const time of [1.016, 1.25, 1.5, 1.75]) expect(position.changed({ ...frame, time })).toBe(false);
    expect(position.changed({ ...frame, id: "next", time: 2, rowTop: 660 })).toBe(true);
    expect(position.changed({ ...frame, id: "next", time: 10, rowTop: 660 })).toBe(true);
  });
  it("centers paused scrubbing even within the same caption without requiring playback", () => {
    const position = new CaptionFollowPosition();
    const paused = { ...frame, playing: false };
    expect(position.changed(paused)).toBe(true);
    expect(position.changed(paused)).toBe(false);
    expect(position.changed({ ...paused, time: 1.2 })).toBe(true);
    expect(position.changed({ ...paused, time: 1.2 })).toBe(false);
    expect(position.changed({ ...paused, time: 1.2, playing: true })).toBe(true);
  });
  it("rechecks centering after row measurement, viewport resizing or an editing pause", () => {
    const position = new CaptionFollowPosition();
    position.changed(frame);
    expect(position.changed({ ...frame, viewportHeight: 500 })).toBe(true);
    expect(position.changed({ ...frame, viewportHeight: 500, rowHeight: 120 })).toBe(true);
    position.invalidate();
    expect(position.changed({ ...frame, viewportHeight: 500, rowHeight: 120 })).toBe(true);
    expect(position.changed({ ...frame, viewportHeight: 500, rowHeight: 120 })).toBe(false);
  });
  it("does not invent a row in gaps or when the filter excludes the active caption", () => {
    const position = new CaptionFollowPosition();
    expect(position.changed({ ...frame, id: null })).toBe(false);
    expect(position.changed({ ...frame, id: null, time: 2 })).toBe(false);
    expect(position.changed({ ...frame, time: 3 })).toBe(true);
  });
});

describe("reading and typing take priority over automatic scrolling", () => {
  it("notifies the resume scheduler for external reveals and all other pause sources", () => {
    const schedule = vi.fn();
    const gate = new CaptionFollowGate(schedule);
    gate.pause(100); // An external timeline reveal has no list pointer event.
    expect(schedule).toHaveBeenCalledTimes(1);
    expect(gate.canFollow(true, true, false, 4099)).toBe(false);
    expect(gate.canFollow(true, true, false, 4100)).toBe(true);
    gate.pointerDown(5000); gate.pointerUp(5001);
    gate.composition(true, 6000); gate.composition(false, 6001);
    expect(schedule).toHaveBeenCalledTimes(5);
    gate.pointerUp(7000); // Unrelated clicks must not replace the resume timer.
    expect(schedule).toHaveBeenCalledTimes(5);
  });
  it("follows only when enabled and no modal suspends it, independently of play/pause", () => {
    const gate = new CaptionFollowGate();
    expect(gate.canFollow(true, true, false, 0)).toBe(true);
    expect(gate.canFollow(false, true, false, 0)).toBe(false);
    expect(gate.canFollow(true, false, false, 0)).toBe(false);
    expect(gate.canFollow(true, true, true, 0)).toBe(false);
  });
  it("waits four seconds after the latest wheel/key/manual navigation activity", () => {
    const gate = new CaptionFollowGate();
    gate.pause(100);
    expect(gate.canFollow(true, true, false, 4099)).toBe(false);
    gate.pause(4000);
    expect(gate.canFollow(true, true, false, 7999)).toBe(false);
    expect(gate.canFollow(true, true, false, 4000 + CAPTION_FOLLOW_PAUSE_MS)).toBe(true);
  });
  it("never interrupts a held scrollbar drag even beyond the timeout", () => {
    const gate = new CaptionFollowGate();
    gate.pointerDown(0);
    expect(gate.canFollow(true, true, false, 60000)).toBe(false);
    gate.pointerUp(60000);
    expect(gate.canFollow(true, true, false, 63999)).toBe(false);
    expect(gate.canFollow(true, true, false, 64000)).toBe(true);
    gate.pointerUp(65000); // A later unrelated click must not extend the pause.
    expect(gate.canFollow(true, true, false, 65001)).toBe(true);
  });
  it("suspends through composition and a short reading pause afterward", () => {
    const gate = new CaptionFollowGate();
    gate.composition(true, 0);
    expect(gate.canFollow(true, true, false, 60000)).toBe(false);
    gate.composition(false, 60000);
    expect(gate.canFollow(true, true, false, 63999)).toBe(false);
    expect(gate.canFollow(true, true, false, 64000)).toBe(true);
  });
  it.each(["input", "textarea", "select", '[contenteditable]:not([contenteditable="false"])', '[role="textbox"]', '[role="combobox"]', '[role="dialog"]'])("recognizes %s even outside the caption panel", selector => {
    expect(followEditingTarget({ closest: (query: string) => query.split(", ").includes(selector) })).toBe(true);
    expect(followEditingTarget(null)).toBe(false);
    expect(followEditingTarget({ closest: () => null })).toBe(false);
  });
  it("allows only the explicitly marked seek control, while dialogs and other sliders remain protected", () => {
    const target = (...selectors: string[]) => ({ closest: (query: string) => query.split(", ").some(selector => selectors.includes(selector)) });
    expect(followEditingTarget(target("input", "[data-caption-follow-seek]"))).toBe(false);
    expect(followEditingTarget(target("input", '[role="dialog"]', "[data-caption-follow-seek]"))).toBe(true);
    expect(followEditingTarget(target("input"))).toBe(true);
    expect(followEditingTarget(target('[role="slider"]'))).toBe(true);
  });
});

describe("separate view preference", () => {
  it("defaults on and restores disabled without writing during load", () => {
    const setItem = vi.fn();
    expect(loadCaptionFollow({ getItem: () => null, setItem })).toBe(true);
    expect(loadCaptionFollow({ getItem: () => "false", setItem })).toBe(false);
    expect(loadCaptionFollow({ getItem: () => "broken", setItem })).toBe(true);
    expect(setItem).not.toHaveBeenCalled();
    expect(saveCaptionFollow(false, { getItem: () => null, setItem })).toBe(true);
    expect(setItem).toHaveBeenCalledWith(CAPTION_FOLLOW_KEY, "false");
  });
  it("handles inaccessible settings without losing the current editor state", () => {
    const storage = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("quota"); } };
    expect(loadCaptionFollow(storage)).toBe(true);
    expect(saveCaptionFollow(false, storage)).toBe(false);
  });
});
