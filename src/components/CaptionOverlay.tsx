import type { CSSProperties } from "react";
import { resolveCaptionStyle, resolveCaptionStyleFields, type Caption, type CaptionStyle, type ResolvedCaptionStyle, type Speaker } from "../domain";
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

function lineStyle(style: ResolvedCaptionStyle): CSSProperties {
  const alpha = Math.round(style.backgroundOpacity * 2.55).toString(16).padStart(2, "0");
  return {
    fontFamily: `${style.fontName ? `${JSON.stringify(style.fontName)}, ` : ""}${CAPTION_FONTS[style.fontFamily]}`,
    fontSize: style.fontSize,
    fontWeight: style.bold ? 700 : 500,
    color: style.textColor,
    backgroundColor: `${style.backgroundColor}${alpha}`,
    textAlign: style.align,
  };
}

function textStyle(style: ResolvedCaptionStyle): CSSProperties {
  return {
    // A centered CSS stroke needs twice the requested outside edge width.
    WebkitTextStroke: style.outline && style.outlineWidth > 0 ? `${style.outlineWidth * 2}px ${style.outlineColor}` : "0px transparent",
    paintOrder: "stroke fill",
    textShadow: style.shadow ? `${style.shadowOffsetX}px ${style.shadowOffsetY}px ${style.shadowBlur}px ${style.shadowColor}` : "none",
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
            {group.map((entry) => {
              const style = resolveCaptionStyleFields(entry.style);
              return (
                <div
                  key={entry.id}
                  data-caption-id={entry.id}
                  className={`styled-caption caption-align-${style.align}`}
                  style={lineStyle(style)}
                >
                  {style.showSpeaker && (
                    <span className="preview-speaker" style={{
                      color: entry.nameColor,
                      backgroundColor: contrastColor(entry.nameColor),
                      textShadow: "none",
                    }}>
                      {entry.name}
                    </span>
                  )}
                  <span className="caption-text" style={textStyle(style)}>{entry.text}</span>
                </div>
              );
            })}
          </div>
        );
      })}
    </>
  );
}
