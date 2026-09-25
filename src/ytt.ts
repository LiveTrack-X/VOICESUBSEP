import { DEFAULT_CAPTION_STYLE, parseProject, resolveCaptionStyle, type CaptionStyle, type Project } from "./domain";
import { contrastColor } from "./colors";

// Independently written SRV3 serializer. Format/compatibility reference:
// https://github.com/arcusmaximus/YTSubConverter/blob/master/ytt.ytt
// This is experimental export, not proof of acceptance by YouTube upload.
const FONT_CATEGORY: Record<CaptionStyle["fontFamily"], number> = { sans: 4, serif: 2, mono: 3 };
const JUSTIFY: Record<CaptionStyle["align"], number> = { left: 0, center: 2, right: 1 };
const ANCHOR_COLUMN: Record<CaptionStyle["align"], number> = { left: 0, center: 1, right: 2 };
const ANCHOR_ROW: Record<CaptionStyle["position"], number> = { top: 0, middle: 3, bottom: 6 };
const MARGIN = 4;
const GAP = 1;
const TIMING_ERROR = "YTT에서 표현할 수 없는 1ms 이하 자막 구간이 있습니다. 자막 시간을 조정하세요.";
const LAYOUT_ERROR = "동시에 표시할 YTT 자막이 화면 높이를 넘습니다. 글자 크기나 위치를 조정하세요.";

/** XML 1.0 text: retain line breaks and Unicode, replace illegal scalar values. */
export function escapeYttText(text: string): string {
  const clean = Array.from(text.replace(/\r\n?/gu, "\n"), character => {
    const code = character.codePointAt(0)!;
    return (code >= 0x20 && code <= 0xd7ff) || (code >= 0xe000 && code <= 0xfffd) ||
      (code >= 0x10000 && code <= 0x10ffff) || code === 9 || code === 10 ? character : "\ufffd";
  }).join("");
  return clean.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;").replace(/'/gu, "&apos;");
}

/** SRV3 uses a virtual percentage: effective percent = 100 + (sz - 100) / 4. */
export function yttFontSize(fontSize: number): number {
  return Math.max(0, Math.round(400 * fontSize / DEFAULT_CAPTION_STYLE.fontSize - 300));
}

function foreground(hex: string): string {
  const upper = hex.toUpperCase();
  return upper === "#FFFFFF" ? "#FEFEFE" : upper;
}

function penAttributes(style: CaptionStyle, textColor: string): string {
  const opacity = Math.min(254, Math.round(style.backgroundOpacity * 255 / 100));
  return `fc="${foreground(textColor)}" fo="254" bc="${style.backgroundColor.toUpperCase()}" bo="${opacity}"` +
    ` b="${style.bold ? 1 : 0}" fs="${FONT_CATEGORY[style.fontFamily]}" sz="${yttFontSize(style.fontSize)}"` +
    ` et="${style.outline ? 3 : 0}" ec="${contrastColor(textColor).toUpperCase()}"`;
}

/** IDs are insertion ordered within each SRV3 element type, with no sparse IDs. */
class Definitions {
  private ids = new Map<string, number>();
  constructor(private tag: "pen" | "ws" | "wp") {}
  add(attributes: string): number {
    const known = this.ids.get(attributes);
    if (known !== undefined) return known;
    const id = this.ids.size + 1;
    this.ids.set(attributes, id);
    return id;
  }
  xml(): string[] {
    return [...this.ids].map(([attributes, id]) => `    <${this.tag} id="${id}" ${attributes}/>`);
  }
}

type Occupied = { end: number; top: number; bottom: number };

/** Conservative wrapping estimate on the same 1920×1080 reference as ASS.
 * Positions are approximate: fonts and wrapping differ between YouTube players.
 */
function heightPercent(text: string, style: CaptionStyle): number {
  const size = style.fontSize * 3;
  const lines = text.replace(/\r\n?/gu, "\n").split("\n").reduce((count, line) =>
    count + Math.max(1, Math.ceil(Array.from(line.replace(/\t/gu, "    ")).length * size / 1728)), 0);
  return Math.ceil((lines * size * 1.45 + 30) / 1080 * 100) + 1;
}

function place(style: CaptionStyle, height: number, occupied: Occupied[]): { top: number; bottom: number; attributes: string } {
  const descending = style.position === "bottom";
  let top = descending ? 100 - MARGIN - height : style.position === "middle" ? 50 - height / 2 : MARGIN;
  const rows = [...occupied].sort((a, b) => descending ? b.bottom - a.bottom : a.top - b.top);
  for (const row of rows) {
    if (top + height + GAP <= row.top || top >= row.bottom + GAP) continue;
    top = descending ? row.top - GAP - height : row.bottom + GAP;
  }
  const bottom = top + height;
  if (top < MARGIN || bottom > 100 - MARGIN) throw new Error(LAYOUT_ERROR);
  const anchorY = descending ? bottom : style.position === "middle" ? (top + bottom) / 2 : top;
  // The player applies (coordinate * .96) + 2; use integral server-compatible
  // coordinates. The margin and gap also absorb rounding to integer percent.
  const y = Math.round((anchorY - 2) / .96);
  const x = ({left:3, center:50, right:97})[style.align];
  const anchor = ANCHOR_ROW[style.position] + ANCHOR_COLUMN[style.align];
  return {top, bottom, attributes:`ap="${anchor}" ah="${x}" av="${y}"`};
}

/**
 * Serialize the supplied timebase, just like exportAss. The caller may pass the
 * issue-gated result of projectForEditedExport; cuts must not be applied twice.
 * No karaoke/word timing, network, translation, mutation or dependency is used.
 */
export function exportYtt(project: Project): string {
  const valid = parseProject(JSON.stringify(project));
  const speakers = new Map(valid.speakers.map(speaker => [speaker.id, speaker]));
  const pens = new Definitions("pen"), windows = new Definitions("ws"), positions = new Definitions("wp");
  const active: Record<CaptionStyle["position"], Occupied[]> = {top:[], middle:[], bottom:[]};
  const paragraphs: string[] = [];
  const captions = [...valid.captions].sort((a,b)=>a.start-b.start || a.end-b.end || (a.id<b.id?-1:a.id>b.id?1:0));
  for (const caption of captions) {
    if (!caption.text.trim() || caption.end <= caption.start) throw new Error("빈 자막이나 잘못된 자막 시간을 수정한 뒤 내보내세요.");
    const start = Math.max(1, Math.round(caption.start * 1000));
    const end = Math.round(caption.end * 1000);
    if (end <= start) throw new Error(TIMING_ERROR);
    const speaker = caption.speakerId ? speakers.get(caption.speakerId) : undefined;
    const style = resolveCaptionStyle(caption, speaker);
    const name = speaker?.name.trim() || "미배정";
    const plain = `${style.showSpeaker ? `${name}: ` : ""}${caption.text}`;
    const occupied = active[style.position].filter(row=>row.end>start);
    const position = place(style, heightPercent(plain,style), occupied);
    active[style.position] = [...occupied, {end,top:position.top,bottom:position.bottom}];
    const wp = positions.add(position.attributes);
    const ws = windows.add(`ju="${JUSTIFY[style.align]}" wfo="0"`);
    const bodyPen = pens.add(penAttributes(style,style.textColor));
    let text = escapeYttText(caption.text);
    if (style.showSpeaker) {
      const namePen = pens.add(penAttributes(style,speaker?.color??"#ffffff"));
      // Text outside the first span preserves its pen during SRV3 conversion.
      text = `<s p="${namePen}">${escapeYttText(name)}: </s>&#8203;<s p="${bodyPen}">${text}</s>`;
    }
    paragraphs.push(`    <p t="${start}" d="${end-start}" wp="${wp}" ws="${ws}" p="${bodyPen}">${text}</p>`);
  }
  return `<?xml version="1.0" encoding="utf-8"?>\n<timedtext format="3">\n  <head>\n` +
    [...pens.xml(),...windows.xml(),...positions.xml()].join("\n") + `\n  </head>\n  <body>\n${paragraphs.join("\n")}\n  </body>\n</timedtext>\n`;
}
