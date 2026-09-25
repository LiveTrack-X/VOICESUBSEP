import { describe, expect, it } from "vitest";
import { normalizeSpeakerColor, readableSpeakerColor, speakerColorContrast } from "./speakerColor";

describe("readable speaker names", () => {
  it("keeps readable assigned colors unchanged and rejects arbitrary CSS", () => {
    expect(readableSpeakerColor("#123456")).toBe("#123456");
    expect(normalizeSpeakerColor("#Ab12Cd")).toBe("#ab12cd");
    for (const invalid of [null, "red", "#123", "#fff;display:none", "url(https://invalid)"]) expect(normalizeSpeakerColor(invalid)).toBeNull();
    expect(readableSpeakerColor(null)).toBe("#667085");
  });
  it.each(["#ffffff", "#ffff00", "#ff0000", "#111111", "#abcdef", "#00ff00"])("makes %s readable on both document and dark app surfaces", color => {
    for (const background of ["#ffffff", "#181e2a"]) {
      const foreground = readableSpeakerColor(color, background);
      expect(speakerColorContrast(foreground, background)).toBeGreaterThanOrEqual(4.5);
      expect(normalizeSpeakerColor(foreground)).toBe(foreground);
    }
  });
});
