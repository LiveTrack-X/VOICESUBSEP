import { describe, expect, it } from "vitest";
import { createProject, type Caption } from "./domain";
import { escapeAssText, exportAss, exportSpeakerSrtZip } from "./subtitle-export";
import { exportMessages } from "./i18n-export";

function project() {
  const p = createProject(2); p.name = "방송 / 자막"; p.duration = 10;
  p.speakers[0]!.name = "방송인"; p.speakers[1]!.name = "방송인";
  p.speakers[0]!.color = "#123456";
  p.speakers[0]!.subtitleStyle = { fontFamily: "mono", textColor: "#abcdef", bold: true, position: "top", align: "left", backgroundOpacity: 50 };
  p.captions = [
    { id: "a", start: 1, end: 3, text: "안녕하세요", speakerId: p.speakers[0]!.id, reasons: [], reviewed: true },
    { id: "b", start: 2, end: 4, text: "같이 말해요", speakerId: p.speakers[1]!.id, reasons: ["overlap"], reviewed: false },
    { id: "u", start: 4, end: 5, text: "미지정 대사", speakerId: null, reasons: ["unassigned"], reviewed: false },
  ]; return p;
}

function unzipStored(bytes: Uint8Array): Map<string, string> {
  const files = new Map<string, string>(), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), decoder = new TextDecoder();
  const end = bytes.length - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  let central = view.getUint32(end + 16, true);
  for (let i = 0; i < view.getUint16(end + 10, true); i++) {
    expect(view.getUint32(central, true)).toBe(0x02014b50);
    expect(view.getUint16(central + 8, true)).toBe(0x800);
    const nameLength = view.getUint16(central + 28, true), offset = view.getUint32(central + 42, true);
    const name = decoder.decode(bytes.slice(central + 46, central + 46 + nameLength));
    expect(view.getUint32(offset, true)).toBe(0x04034b50);
    expect(view.getUint16(offset + 8, true)).toBe(0);
    expect(view.getUint32(offset + 14, true)).toBe(view.getUint32(central + 16, true));
    const start = offset + 30 + view.getUint16(offset + 26, true);
    files.set(name, decoder.decode(bytes.slice(start, start + view.getUint32(offset + 18, true))));
    central += 46 + nameLength;
  }
  expect(central).toBe(end); return files;
}

describe("styled ASS export", () => {
  it("resolves inherited/individual styling, speaker color and independent overlap events", () => {
    const p = project(); p.captions[1]!.style = { showSpeaker: false, backgroundOpacity: 0, outline: true };
    const ass = exportAss(p);
    expect(ass).toContain("PlayResX: 1920"); expect(ass).toContain("Style: Caption0,Consolas,45,&H00EFCDAB");
    expect(ass).toContain("&H8022120C"); expect(ass).toContain("{\\1c&H563412&}방송인:");
    expect(ass).toContain("Dialogue: 1,0:00:01.00,0:00:03.00,Caption0");
    expect(ass).toContain("Dialogue: 1,0:00:02.00,0:00:04.00,Caption1");
    expect(ass).toContain("\\an7");
    expect(ass.split("\n").find((line) => line.startsWith("Dialogue: 1,") && line.includes("Caption1"))).not.toContain("방송인");
    expect(ass).toContain("미배정"); expect(p.captions[0]!.text).toBe("안녕하세요");
  });
  it("puts simultaneous captions sharing a position on separate rows and reuses released rows", () => {
    const p = project(); delete p.speakers[0]!.subtitleStyle;
    const rows = exportAss(p).split("\n").filter((line) => line.startsWith("Dialogue: 1,"));
    const positions = rows.map((line) => line.match(/\\pos\((\d+),(\d+)\)/u)?.[2]);
    expect(positions[0]).not.toBe(positions[1]); expect(positions[2]).toBe(positions[0]);
  });
  it("prevents text/name metacharacters from becoming ASS override commands", () => {
    const text = "literal {\\p1} \\N, next\nline";
    expect(escapeAssText(text)).toBe("literal \\{\\\u200bp1\\} \\\u200bN, next\\Nline");
    const p = project(); p.captions[0]!.text = text; p.speakers[0]!.name = "{\\pos(0,0)}";
    const ass = exportAss(p);
    expect(ass).not.toContain("{\\p1}"); expect(ass).not.toContain("{\\pos(0,0)}");
  });
  it("retains a positive interval for a sub-centisecond cue and rejects empty cue output", () => {
    const p = project(); p.captions[0]!.start = 1.001; p.captions[0]!.end = 1.002;
    expect(exportAss(p)).toContain("0:00:01.00,0:00:01.01");
    p.captions[0]!.text = " "; expect(() => exportAss(p)).toThrow();
  });
});

describe("speaker SRT ZIP export", () => {
  it("bundles all populated speakers including duplicate names and unassigned cues without unsafe paths", () => {
    const p = project(); const files = unzipStored(exportSpeakerSrtZip(p));
    expect([...files.keys()]).toEqual(["방송 _ 자막-all.srt", "01-방송인.srt", "02-방송인.srt", "00-unassigned.srt", "editing-notes.csv", "manifest.json"]);
    expect(files.get("01-방송인.srt")).toContain("00:00:01,000 --> 00:00:03,000");
    expect(files.get("02-방송인.srt")).toContain("00:00:02,000 --> 00:00:04,000");
    expect(files.get("00-unassigned.srt")).toContain("미지정 대사");
    expect(JSON.parse(files.get("manifest.json")!).tracks).toHaveLength(3);
  });
  it("includes no empty speaker file and refuses invalid project data without partial output", () => {
    const p = project(); p.captions = [p.captions[0] as Caption];
    expect(unzipStored(exportSpeakerSrtZip(p)).has("02-방송인.srt")).toBe(false);
    p.captions[0]!.end = 0; expect(() => exportSpeakerSrtZip(p)).toThrow();
  });
});

it("provides export labels in every supported interface language", () => {
  for (const values of Object.values(exportMessages)) { expect(values).toHaveLength(4); expect(values.every((value) => value.trim())).toBe(true); }
});
