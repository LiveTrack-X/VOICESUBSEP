import { describe, expect, it } from "vitest";
import { createProject, MAX_CAPTIONS, parseProject, type Caption, type Project } from "./domain";
import { applyCaptionMerge, applyCaptionSplit, consecutiveCaptions, planCaptionMerge, planCaptionSplit, textBoundaries } from "./captionRestructure";
import { createProjectSession, editProjectSession, redoProjectSession, undoProjectSession } from "./projectSession";

function cue(id = "a", text = "안녕하세요반갑습니다", start = 0, end = 4): Caption {
  return { id, text, start, end, speakerId: "speaker-1", reviewed: true, reasons: [], style: { bold: true },
    translation: { sourceText: text, texts: { en: "Hello" } } };
}
function fixture(captions = [cue()]): Project { return { ...createProject(2), duration: 30, captions }; }

describe("precise subtitle splitting", () => {
  it("splits unspaced Korean at the cursor with estimated time and a single reversible edit", () => {
    const project = fixture(), plan = planCaptionSplit(project.captions[0]!, { kind: "cursor", offset: 5 });
    expect(plan).toMatchObject({ left: "안녕하세요", right: "반갑습니다", time: 2, timing: "estimated" });
    const edited = editProjectSession(createProjectSession(project), p => applyCaptionSplit(p, plan, "b"));
    expect(edited.current.captions.map(c => c.text)).toEqual(["안녕하세요", "반갑습니다"]);
    expect(edited.current.captions.every(c => !c.reviewed && c.reasons.includes("edited") && c.reasons.includes("timing"))).toBe(true);
    expect(edited.current.captions[1]!.style).toEqual({ bold: true });
    expect(undoProjectSession(edited).current).toBe(project);
    expect(redoProjectSession(undoProjectSession(edited)).current).toBe(edited.current);
    expect(parseProject(JSON.stringify(edited.current)).captions).toEqual(edited.current.captions);
  });
  it("preserves exact whitespace, line breaks, punctuation and emoji", () => {
    const source = cue("a", "안녕  👩‍👩‍👧‍👦\n반가워!"), offset = source.text.indexOf("반");
    const plan = planCaptionSplit(source, { kind: "cursor", offset });
    expect(plan.left + plan.right).toBe(source.text);
    expect(plan.left.endsWith("\n")).toBe(true);
    expect(() => planCaptionSplit(source, { kind: "cursor", offset: 5 })).toThrow(/커서/);
    expect(textBoundaries("한글")).toEqual([3]);
  });
  it.each([0, 10, -1, 3.5, NaN])("rejects invalid cursor %s", offset => {
    expect(() => planCaptionSplit(cue(), { kind: "cursor", offset })).toThrow();
  });
  it.each(["", "가", "  가  ", "\n\t", "👩‍👩‍👧‍👦"])("does not create blank or broken subtitles from %s", text => {
    expect(() => planCaptionSplit(cue("a", text), { kind: "time", time: 2 })).toThrow();
  });
  it("uses aligned word times at a text boundary and ignores stale or overlapping word metadata", () => {
    const source = { ...cue("a", "안녕  세상"), words: [{ text: "안녕", start: 0, end: .5 }, { text: " 세상", start: 1, end: 4 }] };
    expect(planCaptionSplit(source, { kind: "cursor", offset: 4 })).toMatchObject({ time: .75, timing: "words" });
    expect(planCaptionSplit({ ...source, text: "다른  문구" }, { kind: "cursor", offset: 4 }).timing).toBe("estimated");
    expect(planCaptionSplit({ ...source, words: [source.words[0]!, { ...source.words[1]!, start: .2 }] }, { kind: "cursor", offset: 4 }).timing).toBe("estimated");
  });
  it("uses the exact requested playback time, allowing unspaced text and preserving newlines", () => {
    const source = cue("a", "hello\nworld");
    expect(planCaptionSplit(source, { kind: "time", time: 1.234 })).toMatchObject({ time: 1.234, left: "hello", right: "\nworld" });
    expect(planCaptionSplit(cue(), { kind: "time", time: 2 }).left).toBe("안녕하세요");
    for (const time of [-1, 0, 4, 10, NaN, Infinity]) expect(() => planCaptionSplit(source, { kind: "time", time })).toThrow();
  });
  it("lets the user adjust time independently of a precise cursor split", () => {
    expect(planCaptionSplit(cue(), { kind: "cursor", offset: 5, time: 1.75 })).toMatchObject({ left: "안녕하세요", right: "반갑습니다", time: 1.75 });
    for (const time of [0, 4, NaN, Infinity]) expect(() => planCaptionSplit(cue(), { kind: "cursor", offset: 5, time })).toThrow();
  });
  it("rejects stale plans and full projects without mutating the original", () => {
    const project = fixture(), before = JSON.stringify(project), plan = planCaptionSplit(project.captions[0]!, { kind: "cursor", offset: 5 });
    expect(() => applyCaptionSplit({ ...project, captions: [{ ...plan.source, text: "changed" }] }, plan)).toThrow(/변경/);
    expect(() => applyCaptionSplit({ ...project, captions: [plan.source, ...Array.from({ length: MAX_CAPTIONS - 1 }, (_, i) => cue(String(i)))] }, plan)).toThrow(/20,000/);
    expect(JSON.stringify(project)).toBe(before);
  });
});

describe("multiple subtitle merging", () => {
  it("merges in time order, preserves text/styles and restores all originals with one undo", () => {
    const project = fixture([cue("c", "셋", 4, 6), cue("a", "하나\n", 0, 2), cue("b", "둘", 2, 4)]);
    const plan = planCaptionMerge(project, ["c", "a", "b"], "speaker-2");
    expect(plan.result).toMatchObject({ id: "a", text: "하나\n둘 셋", start: 0, end: 6, speakerId: "speaker-2", reviewed: false, style: { bold: true } });
    const edited = editProjectSession(createProjectSession(project), p => applyCaptionMerge(p, plan));
    expect(edited.current.captions).toHaveLength(1);
    expect(undoProjectSession(edited).current).toBe(project);
    expect(parseProject(JSON.stringify(edited.current)).captions[0]!.text).toBe("하나\n둘 셋");
  });
  it.each([["none", "하나둘"], ["space", "하나 둘"], ["newline", "하나\n둘"]] as const)("supports %s separator", (separator, text) => {
    expect(planCaptionMerge(fixture([cue("a", "하나", 0, 1), cue("b", "둘", 1, 2)]), ["a", "b"], null, separator).result.text).toBe(text);
  });
  it("identifies gaps, overlaps and clears unassigned after choosing an identity", () => {
    const project = fixture([{ ...cue(), speakerId: null, reasons: ["unassigned"] }, cue("b", "둘", 3, 5), cue("c", "셋", 9, 10)]);
    const plan = planCaptionMerge(project, ["a", "b", "c"], "speaker-1");
    expect(plan.gap).toBe(4); expect(plan.overlap).toBe(true);
    expect(plan.result.reasons).not.toContain("unassigned");
    expect(planCaptionMerge(project, ["a", "b", "c"], null).result.reasons).toContain("unassigned");
  });
  it("rejects hidden intervening captions, missing ids, stale plans, invalid speakers and oversize text", () => {
    const project = fixture([cue("a", "a", 0, 2), cue("b", "b", 2, 4), cue("c", "c", 4, 6)]);
    expect(() => consecutiveCaptions(project, ["a", "c"])).toThrow(/연속/);
    expect(() => consecutiveCaptions(project, ["a", "missing"])).toThrow();
    expect(() => planCaptionMerge(project, ["a", "b"], "missing")).toThrow(/인물/);
    const plan = planCaptionMerge(project, ["a", "b"], null);
    expect(() => applyCaptionMerge({ ...project, captions: project.captions.map(c => c.id === "b" ? { ...c, text: "changed" } : c) }, plan)).toThrow(/변경/);
    const inserted = { ...project, captions: [...project.captions, cue("new", "intervening", 1, 2)] };
    expect(() => applyCaptionMerge(inserted, plan)).toThrow(/연속/);
    expect(() => planCaptionMerge(fixture([cue("a", "a".repeat(6000), 0, 2), cue("b", "b".repeat(6000), 2, 4)]), ["a", "b"], null)).toThrow(/10,000/);
  });
});
