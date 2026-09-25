import { describe, expect, it } from "vitest";
import { analysisBlockReason, type Health } from "./api";

const ready: Health = {
  status: "ok",
  ffmpeg: true,
  ffprobe: true,
  engines: { whisper: true, nemotron: true },
};

describe("analysis runtime readiness", () => {
  it("requires speaker diarization by default and preserves the server's diagnosis", () => {
    const health: Health = {
      ...ready,
      engines: { whisper: true, nemotron: false },
      engineIssues: { nemotron: "Nemotron 구성요소를 불러올 수 없습니다: onnxruntime 누락" },
    };
    expect(analysisBlockReason(health)).toBe(health.engineIssues!.nemotron);
    expect(analysisBlockReason(health, true)).toBe(health.engineIssues!.nemotron);
    expect(analysisBlockReason(health, false)).toBeNull();
    expect(health.engines.nemotron).toBe(false);
  });

  it("blocks core analysis when an older server provides no diagnosis", () => {
    const health = { ...ready, engines: { whisper: true, nemotron: false } };
    expect(analysisBlockReason(health)).toContain("Nemotron");
    expect(analysisBlockReason({ ...health, engineIssues: { nemotron: "  " } })).toContain("Nemotron");
  });

  it("does not allow explicit transcription-only mode to bypass missing Whisper", () => {
    const health = { ...ready, engines: { whisper: false, nemotron: false } };
    expect(analysisBlockReason(health, false)).toContain("Whisper");
    expect(analysisBlockReason(health, true)).toContain("Whisper");
  });

  it("requires known health and media tools for both analysis modes", () => {
    for (const diarization of [true, false]) {
      expect(analysisBlockReason(null, diarization)).not.toBeNull();
      expect(analysisBlockReason({ ...ready, ffmpeg: false }, diarization)).toContain("FFmpeg");
      expect(analysisBlockReason({ ...ready, ffprobe: false }, diarization)).toContain("FFprobe");
    }
  });

  it("allows a complete runtime without changing the selected mode", () => {
    expect(analysisBlockReason(ready)).toBeNull();
    expect(analysisBlockReason(ready, true)).toBeNull();
    expect(analysisBlockReason(ready, false)).toBeNull();
  });

  it("allows cloud ASR without local Whisper or GPU but still requires selected local diarization", () => {
    const health: Health = {...ready, engines:{whisper:false,nemotron:false}, gpu:{available:false,name:null,deviceCount:0,computeTypes:[],reason:null}};
    for (const provider of ["groq", "xai"] as const) {
      expect(analysisBlockReason(health, false, provider)).toBeNull();
      expect(analysisBlockReason(health, true, provider)).toContain("Nemotron");
      expect(analysisBlockReason({...health, engines:{whisper:false,nemotron:true}}, true, provider)).toBeNull();
      expect(analysisBlockReason({...health, ffmpeg:false}, false, provider)).toContain("FFmpeg");
      expect(analysisBlockReason(null, false, provider)).not.toBeNull();
    }
  });
});
