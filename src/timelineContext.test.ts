import { describe, expect, it } from "vitest";
import { createProject, MAX_TIME_SECONDS, type Project } from "./domain";
import { captionAtTimelinePosition, deleteTimelineTarget, moveTimelineTarget, timelineMenuPosition, timelineMovePlan, timelineTarget } from "./timelineContext";

function fixture(): Project {
  const project = createProject(2);
  return { ...project, duration: 30, captions: [
    { id: "cue", start: 2, end: 5, text: "Original text", speakerId: project.speakers[0].id, reviewed: true, reasons: [], words: [{ start: 2, end: 5, text: "Original text" }] },
    { id: "other", start: 2, end: 4, text: "Overlapping", speakerId: project.speakers[1].id, reviewed: false, reasons: ["overlap"] },
  ], notes: [
    { id: "point", start: 3, end: null, text: "Point", done: true, tag: "edit" },
    { id: "range", start: 4, end: 8, text: "Range", done: false, tag: "check" },
  ] };
}

describe("timeline context actions preserve project data and timing", () => {
  it("moves one caption, preserves length/text/style and marks changed timing for review", () => {
    const project = fixture(), before = JSON.stringify(project);
    project.captions[0].style = { fontSize: 36 };
    const moved = moveTimelineTarget(project, { kind: "caption", id: "cue" }, 10.1234);
    expect(moved.captions[0]).toMatchObject({ start: 10.123, end: 13.123, text: "Original text", reviewed: false, reasons: ["timing"], style: { fontSize: 36 } });
    expect(moved.captions[0].words).toBeUndefined();
    expect(moved.captions[1]).toBe(project.captions[1]);expect(moved.notes).toBe(project.notes);
    expect(project.captions[0]).toMatchObject({ start: 2, end: 5, reviewed: true });
    expect(JSON.parse(before).captions[0].text).toBe(moved.captions[0].text);
  });
  it("fits a range near EOF without truncating it and exposes the adjusted start", () => {
    const project = fixture();
    expect(timelineMovePlan(project, { kind: "note", id: "range" }, 29)).toEqual({ start: 26, end: 30, adjusted: true, changed: true });
    const moved = moveTimelineTarget(project, { kind: "note", id: "range" }, 29);
    expect(moved.notes[1]).toEqual({ ...project.notes[1], start: 26, end: 30 });
    expect(moved.captions).toBe(project.captions);
    expect(timelineMovePlan(project, { kind: "caption", id: "cue" }, 40)).toMatchObject({ start: 27, end: 30, adjusted: true });
  });
  it("retains point-note semantics/completion and bounds invalid positions safely", () => {
    const project = fixture();
    expect(moveTimelineTarget(project, { kind: "note", id: "point" }, -5).notes[0]).toEqual({ ...project.notes[0], start: 0 });
    expect(moveTimelineTarget(project, { kind: "note", id: "point" }, 100).notes[0]).toEqual({ ...project.notes[0], start: 30 });
    expect(moveTimelineTarget(project, { kind: "caption", id: "cue" }, NaN)).toBe(project);
    expect(moveTimelineTarget(project, { kind: "caption", id: "cue" }, 2)).toBe(project);
    expect(moveTimelineTarget(project, { kind: "note", id: "missing" }, 5)).toBe(project);
    expect(timelineMovePlan({ ...project, duration: 2 }, { kind: "note", id: "range" }, 1)).toBeNull();
    expect(timelineMovePlan({ ...project, duration: 0 }, { kind: "caption", id: "cue" }, MAX_TIME_SECONDS)).toMatchObject({ start: MAX_TIME_SECONDS - 3, end: MAX_TIME_SECONDS });
  });
  it("deletes only the requested kind/id and leaves an immutable prior state for undo", () => {
    const project = fixture(), before = JSON.stringify(project);
    const deleted = deleteTimelineTarget(project, { kind: "caption", id: "cue" });
    expect(deleted.captions.map(c => c.id)).toEqual(["other"]);expect(deleted.notes).toBe(project.notes);
    expect(deleteTimelineTarget(project, { kind: "note", id: "range" }).notes.map(n => n.id)).toEqual(["point"]);
    expect(deleteTimelineTarget(project, { kind: "caption", id: "range" })).toBe(project);
    expect(timelineTarget(project, { kind: "note", id: "cue" })).toBeUndefined();
    expect(JSON.stringify(project)).toBe(before);
  });
  it("resolves dense marker targets without selecting/playing first or choosing distant captions", () => {
    const { captions } = fixture();
    expect(captionAtTimelinePosition(captions, 3, "other")?.id).toBe("other");
    expect(captionAtTimelinePosition(captions, 3, null)?.id).toBe("cue");
    expect(captionAtTimelinePosition(captions, 1.99, null, .02)?.id).toBe("cue");
    expect(captionAtTimelinePosition(captions, 20, "cue", .02)).toBeUndefined();
    expect(captionAtTimelinePosition([], 3, null)).toBeUndefined();
  });
  it("keeps menu edges in both wide and narrow visible viewports", () => {
    expect(timelineMenuPosition(1200, 710, 250, 210, 1280, 720)).toEqual({ left: 1022, top: 502 });
    expect(timelineMenuPosition(-100, -10, 250, 210, 518, 778)).toEqual({ left: 8, top: 8 });
    expect(timelineMenuPosition(517, 777, 250, 210, 518, 778)).toEqual({ left: 260, top: 560 });
    expect(timelineMenuPosition(NaN, Infinity, 250, 210, 518, 778)).toEqual({ left: 8, top: 8 });
  });
});
