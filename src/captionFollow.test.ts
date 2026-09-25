import { describe, expect, it, vi } from "vitest";
import { CAPTION_FOLLOW_KEY, CAPTION_FOLLOW_PAUSE_MS, CaptionFollowGate, captionFollowTop, followEditingTarget, loadCaptionFollow, playingCaptionId, saveCaptionFollow } from "./captionFollow";
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
  it("keeps an already visible row steady and centers off-screen virtual rows", () => {
    const layout = new CaptionVirtualLayout(Array.from({ length: 2404 }, (_, index) => `caption-${index}`), new Map(), "test", 60);
    expect(captionFollowTop(layout, "caption-3", 0, 300)).toBeNull();
    expect(captionFollowTop(layout, "caption-100", 0, 300)).toBe(5880);
    expect(captionFollowTop(layout, "caption-2403", 0, 300)).toBe(layout.total - 300);
    expect(captionFollowTop(layout, "caption-0", 6000, 300)).toBe(0);
    expect(captionFollowTop(layout, "not-in-filter", 0, 300)).toBeNull();
    expect(captionFollowTop(layout, "caption-100", 0, 0)).toBeNull();
  });
  it("does not repeatedly recenter a tall row but rejects a barely visible edge", () => {
    const layout = new CaptionVirtualLayout(["before", "tall", "after"], new Map([["tall", { height: 700, context: "test" }]]), "test", 60);
    expect(captionFollowTop(layout, "tall", 100, 300)).toBeNull();
    expect(captionFollowTop(layout, "tall", 750, 300)).toBe(60);
  });
});

describe("reading and typing take priority over automatic scrolling", () => {
  it("follows only when enabled and actually playing", () => {
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
