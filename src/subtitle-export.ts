import { exportNotesCsv, exportSrt, parseProject, resolveCaptionStyle, safeFilename, type CaptionStyle, type Project } from "./domain";
import { contrastColor } from "./colors";

const encoder = new TextEncoder();
const FONT_NAMES: Record<CaptionStyle["fontFamily"], string> = { sans: "Malgun Gothic", serif: "Batang", mono: "Consolas" };
const STYLE_FORMAT = "Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding";
const color = (hex: string, opacity = 100) => `&H${Math.round(255 * (1 - opacity / 100)).toString(16).padStart(2, "0")}${hex.slice(5, 7)}${hex.slice(3, 5)}${hex.slice(1, 3)}`.toUpperCase();
const inlineColor = (hex: string) => `&H${hex.slice(5, 7)}${hex.slice(3, 5)}${hex.slice(1, 3)}&`.toUpperCase();
const alignment = (style: CaptionStyle) => ({ bottom: 0, middle: 3, top: 6 })[style.position] + ({ left: 1, center: 2, right: 3 })[style.align];
const assTime = (centiseconds: number) => `${Math.floor(centiseconds / 360000)}:${String(Math.floor(centiseconds / 6000) % 60).padStart(2, "0")}:${String(Math.floor(centiseconds / 100) % 60).padStart(2, "0")}.${String(centiseconds % 100).padStart(2, "0")}`;

/** Escape literal ASS metacharacters; zero-width space stops a typed backslash becoming \N/\h. */
export function escapeAssText(value: string): string {
  return value.replace(/\r\n?/gu, "\n").replace(/\\/gu, "\\\u200b").replace(/\{/gu, "\\{").replace(/\}/gu, "\\}").replace(/\n/gu, "\\N").replace(/\t/gu, " ");
}

/** Styled ASS uses a 1920×1080 canvas and separate box/text layers. Fonts remain local. */
export function exportAss(project: Project): string {
  const valid = parseProject(JSON.stringify(project));
  const speakers = new Map(valid.speakers.map((speaker) => [speaker.id, speaker]));
  const styleLines: string[] = [];
  const events: string[] = [];
  const active: Record<CaptionStyle["position"], { end: number; offset: number; height: number }[]> = { top: [], middle: [], bottom: [] };
  [...valid.captions].sort((a, b) => a.start - b.start || a.end - b.end).forEach((caption, index) => {
    if (!caption.text.trim() || caption.end <= caption.start) throw new Error("빈 자막이나 잘못된 자막 시간을 수정한 뒤 내보내세요.");
    const speaker = caption.speakerId ? speakers.get(caption.speakerId) : undefined;
    const style = resolveCaptionStyle(caption, speaker);
    const name = speaker?.name.trim() || "미배정";
    const plain = `${style.showSpeaker ? `${name}: ` : ""}${caption.text}`;
    const size = style.fontSize * 3;
    const start = Math.round(caption.start * 100), end = Math.max(start + 1, Math.round(caption.end * 100));
    const height = Math.ceil(plain.split(/\r?\n/u).reduce((rows, line) => rows + Math.max(1, Math.ceil(Array.from(line).length * size / 1740)), 0) * size * 1.35 + 12);
    const occupied = active[style.position].filter((row) => row.end > start).sort((a, b) => a.offset - b.offset);
    let offset = 0;
    for (const row of occupied) { if (offset + height <= row.offset) break; offset = Math.max(offset, row.offset + row.height); }
    active[style.position] = [...occupied, { end, offset, height }];
    const x = ({ left: 60, center: 960, right: 1860 })[style.align];
    const y = style.position === "bottom" ? 1040 - offset : style.position === "top" ? 40 + offset : 540 + offset;
    const position = `{\\pos(${x},${y})\\an${alignment(style)}}`;
    const id = `Caption${index}`;
    const styleLine = (name: string, box: boolean) => `Style: ${[name, FONT_NAMES[style.fontFamily], size,
      box ? color(style.textColor, 0) : color(style.textColor), color(style.textColor), box ? color(style.backgroundColor, style.backgroundOpacity) : color(contrastColor(style.textColor)),
      color(style.backgroundColor, 0), style.bold ? -1 : 0, 0, 0, 0, 100, 100, 0, 0, box ? 3 : 1, box ? 4 : style.outline ? 2 : 0, 0, alignment(style), 60, 60, 40, 1].join(",")}`;
    const event = (layer: number, selectedStyle: string, text: string) => `Dialogue: ${layer},${assTime(start)},${assTime(end)},${selectedStyle},,0,0,0,,${position}${text}`;
    if (style.backgroundOpacity > 0) { styleLines.push(styleLine(`${id}Box`, true)); events.push(event(0, `${id}Box`, escapeAssText(plain))); }
    styleLines.push(styleLine(id, false));
    const text = style.showSpeaker ? `{\\1c${inlineColor(speaker?.color ?? "#ffffff")}}${escapeAssText(name)}: {\\1c${inlineColor(style.textColor)}}${escapeAssText(caption.text)}` : escapeAssText(caption.text);
    events.push(event(1, id, text));
  });
  return `[Script Info]\nTitle: ${valid.name.replace(/[\r\n\u0000-\u001f]/gu, " ")}\nScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\nScaledBorderAndShadow: yes\nYCbCr Matrix: None\nWrapStyle: 0\n; Source times; centisecond precision. Font fallback and wrapping may vary by player.\n; Name colors, text styling and backgrounds are portable approximations of the editor preview.\n\n[V4+ Styles]\nFormat: ${STYLE_FORMAT}\n${styleLines.join("\n")}\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n${events.join("\n")}\n`;
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const value of bytes) crc = CRC_TABLE[(crc ^ value) & 255]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** ZIP STORE, UTF-8 names, bounded 32-bit entries; no compression dependencies. */
export function zipStore(files: { name: string; text: string }[]): Uint8Array {
  const entries = files.map((file) => ({ name: encoder.encode(file.name), data: encoder.encode(file.text) }));
  const size = entries.reduce((sum, file) => sum + 30 + file.name.length + file.data.length + 46 + file.name.length, 22);
  if (size > 256 * 1024 * 1024 || entries.length > 65535) throw new Error("내보내기 파일이 너무 큽니다.");
  const bytes = new Uint8Array(size), view = new DataView(bytes.buffer);
  const offsets: number[] = []; let cursor = 0;
  const u16 = (offset: number, value: number) => view.setUint16(offset, value, true);
  const u32 = (offset: number, value: number) => view.setUint32(offset, value, true);
  for (const file of entries) {
    offsets.push(cursor); u32(cursor, 0x04034b50); u16(cursor + 4, 20); u16(cursor + 6, 0x0800); u16(cursor + 12, 33);
    u32(cursor + 14, crc32(file.data)); u32(cursor + 18, file.data.length); u32(cursor + 22, file.data.length); u16(cursor + 26, file.name.length);
    bytes.set(file.name, cursor + 30); bytes.set(file.data, cursor + 30 + file.name.length); cursor += 30 + file.name.length + file.data.length;
  }
  const central = cursor;
  entries.forEach((file, index) => {
    u32(cursor, 0x02014b50); u16(cursor + 4, 20); u16(cursor + 6, 20); u16(cursor + 8, 0x0800); u16(cursor + 14, 33);
    u32(cursor + 16, crc32(file.data)); u32(cursor + 20, file.data.length); u32(cursor + 24, file.data.length); u16(cursor + 28, file.name.length); u32(cursor + 42, offsets[index]!);
    bytes.set(file.name, cursor + 46); cursor += 46 + file.name.length;
  });
  u32(cursor, 0x06054b50); u16(cursor + 8, entries.length); u16(cursor + 10, entries.length); u32(cursor + 12, cursor - central); u32(cursor + 16, central);
  return bytes;
}

/** Includes every populated speaker, unassigned cues, combined SRT and timing/identity manifest. */
export function exportSpeakerSrtZip(project: Project): Uint8Array {
  const valid = parseProject(JSON.stringify(project));
  const base = safeFilename(valid.name).slice(0, 80);
  const tracks: { speakerId: string | null; name: string; color?: string; file: string }[] = [];
  const files: { name: string; text: string }[] = [{ name: `${base}-all.srt`, text: exportSrt(valid) }];
  for (const [index, speaker] of valid.speakers.entries()) {
    if (!valid.captions.some((caption) => caption.speakerId === speaker.id)) continue;
    const name = `${String(index + 1).padStart(2, "0")}-${safeFilename(speaker.name, "speaker").slice(0, 80)}.srt`;
    files.push({ name, text: exportSrt(valid, speaker.id) }); tracks.push({ speakerId: speaker.id, name: speaker.name, color: speaker.color, file: name });
  }
  if (valid.captions.some((caption) => caption.speakerId === null)) {
    files.push({ name: "00-unassigned.srt", text: exportSrt(valid, null) }); tracks.push({ speakerId: null, name: "미배정", file: "00-unassigned.srt" });
  }
  files.push({ name: "editing-notes.csv", text: exportNotesCsv(valid) }, { name: "manifest.json", text: JSON.stringify({ format: "voicesubsep-speaker-subtitles", version: 1, timebase: "project-source", projectName: valid.name, duration: valid.duration, tracks,
    note: "SRT files contain timing and speaker names. Styling remains in the project JSON or ASS export." }, null, 2) });
  return zipStore(files);
}
