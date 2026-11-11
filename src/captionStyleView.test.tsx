import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CaptionOverlay } from "./components/CaptionOverlay";
import { CaptionStyleDialog } from "./components/CaptionStyleDialog";
import { DEFAULT_CAPTION_STYLE, resolveCaptionStyleFields, type CaptionStyle } from "./domain";
import { I18nProvider } from "./i18n";

function overlay(style: Partial<CaptionStyle>) {
  return renderToStaticMarkup(<CaptionOverlay entries={[{ id: "sample", name: "Speaker", nameColor: "#ff0000", text: "A clear subtitle", style: { ...DEFAULT_CAPTION_STYLE, ...style } }]} />);
}
function dialog(value: Partial<CaptionStyle> | undefined, inheritedOutlineColor?: string) {
  return renderToStaticMarkup(<I18nProvider><CaptionStyleDialog title="Style" description="Preview before applying" value={value}
    inherited={resolveCaptionStyleFields({ fontName: "Consolas", outline: true })} inheritedOutlineColor={inheritedOutlineColor}
    name="Speaker" nameColor="#ff0000" text="A clear subtitle" resetLabel="Reset inheritance" onApply={() => {}} onClose={() => {}} /></I18nProvider>);
}

describe("subtitle style rendering", () => {
  it("renders a literal installed font with a category fallback and rejects font-list injection", () => {
    expect(overlay({ fontName: "Pretend Font", fontFamily: "serif" })).toContain('font-family:&quot;Pretend Font&quot;, &quot;Noto Serif KR&quot;, &quot;Batang&quot;, serif');
    const invalid = overlay({ fontName: 'Arial, serif; color:red' });
    expect(invalid).not.toContain("color:red");
    expect(invalid).toContain('font-family:&quot;Noto Sans KR&quot;');
  });
  it("keeps outline, offset, blur and fill separate on the caption text without stroking the name badge", () => {
    const html = overlay({ outline: true, outlineWidth: 3, outlineColor: "#ab1234", shadow: true, shadowColor: "#123abc", shadowBlur: 5, shadowOffsetX: -2, shadowOffsetY: 4 });
    const text = html.match(/<span class="caption-text"[^>]*>/)?.[0];
    expect(text).toContain("-webkit-text-stroke:6px #ab1234");
    expect(text).toContain("paint-order:stroke fill");
    expect(text).toContain("text-shadow:-2px 4px 5px #123abc");
    const badge = html.match(/<span class="preview-speaker"[^>]*>/)?.[0];
    expect(badge).toContain("text-shadow:none");
    expect(badge).not.toContain("text-stroke");
    expect(html).toContain("color:#ffffff");
  });
  it("renders no text effects when switches are off or outline width is zero", () => {
    expect(overlay({ outline: false, shadow: false })).toContain('-webkit-text-stroke:0px transparent;paint-order:stroke fill;text-shadow:none');
    expect(overlay({ outline: true, outlineWidth: 0 })).toContain('-webkit-text-stroke:0px transparent');
  });
  it("previews automatic outline contrast from edited text while keeping an explicit inherited color", () => {
    expect(dialog({ textColor: "#000000" })).toContain('-webkit-text-stroke:2px #ffffff');
    expect(dialog({ textColor: "#000000" }, "#ff0000")).toContain('-webkit-text-stroke:2px #ff0000');
    expect(dialog({ textColor: "#000000", outlineColor: "#00ff00" }, "#ff0000")).toContain('-webkit-text-stroke:2px #00ff00');
  });
  it("exposes labeled local font and effect controls, disabling Apply for invalid names", () => {
    const html = dialog({ fontName: "Arial, serif" });
    for (const label of ["글꼴 이름", "기본 글꼴", "테두리 두께", "테두리 색상", "그림자 색상", "그림자 흐림", "그림자 가로 거리", "그림자 세로 거리"])
      expect(html).toContain(`aria-label="${label}"`);
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('<button class="primary" disabled="">적용</button>');
    expect(html).toContain('role="region" aria-label="자막 스타일 설정" tabindex="0"');
    expect(html).toContain("글꼴 파일은 다운로드하지 않습니다.");
    expect(html).not.toContain("https://");
  });
});
