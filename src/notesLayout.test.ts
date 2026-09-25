import { describe, expect, it } from "vitest";
import { clampNoteHeight, noteHeightBounds, readNoteHeight } from "./notesLayout";

describe("notes panel sizing", () => {
  it("reserves editor space and restores a saved size after a smaller viewport", () => {
    const saved = 500;
    expect(clampNoteHeight(saved, noteHeightBounds(600, false))).toBe(380);
    expect(clampNoteHeight(saved, noteHeightBounds(900, false))).toBe(500);
    expect(noteHeightBounds(100, false)).toEqual({ min: 180, max: 180 });
    expect(noteHeightBounds(600, true).min).toBe(100);
  });
  it("ignores malformed storage and supports automatic sizing", () => {
    for (const value of [null, "", " ", "null", "Infinity", "-500", "10000"])
      expect(readNoteHeight(value)).toBeNull();
    expect(readNoteHeight("320")).toBe(320);
    expect(clampNoteHeight(NaN, { min: 180, max: 400 })).toBe(300);
  });
});
