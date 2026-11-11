import { describe, expect, it } from "vitest";
import { createProject, parseProject, serializeProject, type Caption } from "./domain";
import { applyVoiceCandidate, appendOverlapCandidates, enrollVoiceReference, makeSpeechToolSnapshot,
  parseOverlapResult, parseVoiceMatchResult, voiceMatchRequest, voiceReferenceIssue,
  type OverlapResult, type VoiceMatchResult } from "./speechTools";

const identity = { sha256: "a".repeat(64), bytes: 10 };
function fixture() {
  const p = { ...createProject(2), mediaName: "test.wav", mediaIdentity: identity, duration: 30 };
  p.captions = [
    { id: "a", start: 0, end: 3, text: "기준 하나", speakerId: "speaker-1", reviewed: true, reasons: [] },
    { id: "b", start: 4, end: 7, text: "기준 둘", speakerId: "speaker-2", reviewed: true, reasons: [] },
    { id: "t", start: 8, end: 10, text: "미배정", speakerId: null, reviewed: false, reasons: ["unassigned"], words: [{ start: 8, end: 10, text: "미배정" }] },
  ] as Caption[];
  return enrollVoiceReference(enrollVoiceReference(p, "a", 1), "b", 1);
}
function snapshot(p = fixture()) {
  return makeSpeechToolSnapshot(p, 1, { id: "1".repeat(32), name: "test.wav", duration: 30,
    audioTracks: [{ index: 1, label: "track", channels: 1 }], url: "/api/media/x/file", ...identity }, 1);
}
function match(p = fixture()): VoiceMatchResult {
  const s = snapshot(p);
  return { mediaId: s.mediaId, sourceIdentity: identity, audioTrack: 1, model: "Wespeaker/wespeaker-voxceleb-resnet34-LM",
    revision: "f0c48c298fd835726c27956a5d617bad7115627e", candidates: [{ captionId: "t", scores: [
      { speakerId: "speaker-1", similarity: .9 }, { speakerId: "speaker-2", similarity: .4 }], recommendedSpeakerId: "speaker-1", reason: "candidate" }], warnings: [] };
}
function overlap(p = fixture()): OverlapResult {
  const base = snapshot(p), id = "2".repeat(32);
  return { mediaId: base.mediaId, sourceIdentity: identity, audioTrack: 1, model: "speechbrain/sepformer-wsj02mix",
    revision: "3a2826343a10e2d2e8a75f79aeab5ff3a2473531", start: 8, end: 12,
    originalUrl: `/api/speech-tools/jobs/${id}/audio/original.wav`, streams: [0, 1].map(index => ({ index: index as 0 | 1,
      audioUrl: `/api/speech-tools/jobs/${id}/audio/stream-${index + 1}.wav`, captions: [
        { id: `recovered-${index}`, start: 8, end: 10, text: `후보${index}`, speakerId: null, reviewed: false, reasons: ["overlap", "unassigned"] }] })), warnings: [] };
}

describe("confirmed acoustic reference metadata", () => {
  it("roundtrips independently of embeddings and preserves legacy projects", () => {
    const p = fixture();
    expect(parseProject(serializeProject(p)).voiceReferences).toEqual(p.voiceReferences);
    expect(parseProject(serializeProject(createProject())).voiceReferences).toBeUndefined();
    expect(serializeProject(p)).not.toContain("embedding");
  });
  it("requires a reviewed, assigned, clean reference and rejects changed text/track/source", () => {
    const p = fixture(), ref = p.voiceReferences![0]!;
    expect(() => enrollVoiceReference(p, "t", 1)).toThrow();
    expect(voiceReferenceIssue(p, ref, 0)).not.toBeNull();
    expect(voiceReferenceIssue({ ...p, mediaIdentity: { ...identity, bytes: 20 } }, ref, 1)).not.toBeNull();
    expect(voiceReferenceIssue({ ...p, captions: p.captions.map(c => c.id === "a" ? { ...c, text: "changed" } : c) }, ref, 1)).not.toBeNull();
    expect(() => enrollVoiceReference({ ...p, captions: p.captions.map(c => c.id === "a" ? { ...c, reasons: ["overlap"] } : c) }, "a", 1)).toThrow();
  });
  it("requires explicit clean-target confirmation and protects manual/reviewed/overlap cues", () => {
    const p = fixture();
    expect(() => voiceMatchRequest(p, 1, "t", false)).toThrow();
    expect(voiceMatchRequest(p, 1, "t", true).references).toHaveLength(2);
    for (const patch of [{ reviewed: true }, { reasons: ["edited"] }, { reasons: ["overlap"] }]) {
      const changed = { ...p, captions: p.captions.map(c => c.id === "t" ? { ...c, ...patch } as Caption : c) };
      expect(() => voiceMatchRequest(changed, 1, "t", true)).toThrow();
    }
  });
  it("rejects malformed saved references instead of trusting imported metadata", () => {
    const p = fixture();
    for (const patch of [{ audioTrack: -1 }, { start: NaN }, { end: 30 }, { sourceIdentity: { bytes: 1 } }, { embedding: [1, 2] }]) {
      expect(() => parseProject(JSON.stringify({ ...p, voiceReferences: [{ ...p.voiceReferences![0], ...patch }] }))).toThrow();
    }
  });
});

describe("explicit stale-safe candidate application", () => {
  it("applies only a validated acoustic recommendation while preserving words and text", () => {
    const p = fixture(), before = p.captions[2]!;
    const next = applyVoiceCandidate(p, snapshot(p), 1, match(p), "t");
    expect(next.captions[2]).toMatchObject({ speakerId: "speaker-1", text: before.text, words: before.words, reviewed: false });
    expect(next.captions[2]!.reasons).toContain("edited");
    expect(p.captions[2]!.speakerId).toBeNull();
    expect(next.captions[0]).toBe(p.captions[0]);
  });
  it("rejects late results, changed source/track and low or ambiguous score proposals", () => {
    const p = fixture(), s = snapshot(p), r = match(p);
    expect(() => applyVoiceCandidate({ ...p }, s, 1, r, "t")).toThrow();
    expect(() => applyVoiceCandidate(p, s, 2, r, "t")).toThrow();
    expect(() => applyVoiceCandidate(p, s, 1, { ...r, audioTrack: 2 }, "t")).toThrow();
    expect(() => applyVoiceCandidate(p, s, 1, { ...r, candidates: [{ ...r.candidates[0]!, scores: [
      { speakerId: "speaker-1", similarity: .8 }, { speakerId: "speaker-2", similarity: .79 }] }] }, "t")).toThrow();
  });
  it("appends only chosen overlap candidates and keeps every original caption", () => {
    const p = fixture(), next = appendOverlapCandidates(p, snapshot(p), 1, overlap(p), [
      { streamIndex: 1, captionId: "recovered-1", speakerId: "speaker-2" }]);
    expect(next.captions).toHaveLength(p.captions.length + 1);
    expect(next.captions.filter(c => p.captions.includes(c))).toHaveLength(p.captions.length);
    expect(next.captions.find(c => c.text === "후보1")).toMatchObject({ speakerId: "speaker-2", reviewed: false });
    expect(next.captions.find(c => c.text === "후보0")).toBeUndefined();
  });
  it("rejects arbitrary preview URLs and out-of-window captions", () => {
    const p = fixture(), good = overlap(p);
    expect(() => parseOverlapResult({ ...good, originalUrl: "https://evil.test/audio" })).toThrow();
    const bad = { ...good, streams: good.streams.map(s => ({ ...s, captions: [{ ...s.captions[0], start: 0 }] })) };
    expect(() => parseOverlapResult(bad)).toThrow();
    expect(() => parseVoiceMatchResult({ ...match(p), candidates: [{ ...match(p).candidates[0], scores: [{ speakerId: "speaker-1", similarity: 2 }] }] })).toThrow();
  });
  it("retains uncertainty flags when accepting separated speech", () => {
    const p = fixture(), result = overlap(p);
    result.streams[0]!.captions[0]!.reasons.push("speech_uncertain", "timing");
    const next = appendOverlapCandidates(p, snapshot(p), 1, result, [{ streamIndex: 0, captionId: "recovered-0", speakerId: "speaker-1" }]);
    expect(next.captions.find(c => c.text === "후보0")!.reasons).toEqual(expect.arrayContaining(["overlap", "edited", "speech_uncertain", "timing"]));
    expect(next.captions.find(c => c.text === "후보0")!.reasons).not.toContain("unassigned");
  });
  it("requires a score for every enrolled speaker before using the margin", () => {
    let p = fixture();
    p = { ...p, speakers: [...p.speakers, { id: "speaker-3", name: "third", color: "#aabbcc" }], captions: [...p.captions,
      { id: "c", start: 20, end: 23, text: "세번째", speakerId: "speaker-3", reviewed: true, reasons: [] }] };
    p = enrollVoiceReference(p, "c", 1);
    expect(() => applyVoiceCandidate(p, snapshot(p), 1, match(p), "t")).toThrow();
  });
});
