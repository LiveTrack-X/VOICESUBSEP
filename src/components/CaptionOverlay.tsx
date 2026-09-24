import type { CSSProperties } from "react";
import { resolveCaptionStyle, type Caption, type CaptionStyle, type Speaker } from "../domain";
import { contrastColor } from "../colors";

export const CAPTION_FONTS: Record<CaptionStyle["fontFamily"], string> = {
  sans: '"Noto Sans KR", "Malgun Gothic", sans-serif',
  serif: '"Noto Serif KR", "Batang", serif',
  mono: '"D2Coding", "Consolas", monospace',
};

export type CaptionAppearance = {
  id: string;
  text: string;
  name: string;
  nameColor: string;
  style: CaptionStyle;
};

export function captionAppearance(caption: Caption, speaker?: Speaker, unassigned = "미배정"): CaptionAppearance {
  return {
    id: caption.id,
    text: caption.text,
    name: speaker?.name || unassigned,
    nameColor: speaker?.color ?? "#ffffff",
    style: resolveCaptionStyle(caption, speaker),
  };
}

function lineStyle(style: CaptionStyle): CSSProperties {
  const alpha = Math.round(style.backgroundOpacity * 2.55).toString(16).padStart(2, "0");
  const edge = contrastColor(style.textColor);
  return {
    fontFamily: CAPTION_FONTS[style.fontFamily],
    fontSize: style.fontSize,
    fontWeight: style.bold ? 700 : 500,
    color: style.textColor,
    backgroundColor: `${style.backgroundColor}${alpha}`,
    textAlign: style.align,
    textShadow: style.outline
      ? `-1px -1px 0 ${edge}, 1px -1px 0 ${edge}, -1px 1px 0 ${edge}, 1px 1px 0 ${edge}`
      : "none",
  };
}

/** Captions in the same position stack instead of painting over each other. */
export function CaptionOverlay({ entries }: { entries: CaptionAppearance[] }) {
  return (
    <>
      {(["top", "middle", "bottom"] as const).map((position) => {
        const group = entries.filter((entry) => entry.style.position === position);
        if (!group.length) return null;
        return (
          <div className={`caption-overlay caption-position-${position}`} key={position}>
            {group.map((entry) => (
              <div
                key={entry.id}
                data-caption-id={entry.id}
                className={`styled-caption caption-align-${entry.style.align}`}
                style={lineStyle(entry.style)}
              >
                {entry.style.showSpeaker && (
                  <span className="preview-speaker" style={{
                    color: entry.nameColor,
                    backgroundColor: contrastColor(entry.nameColor),
                    textShadow: "none",
                  }}>
                    {entry.name}
                  </span>
                )}
                <span className="caption-text">{entry.text}</span>
              </div>
            ))}
          </div>
        );
      })}
    </>
  );
}
