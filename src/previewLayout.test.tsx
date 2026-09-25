import { describe, expect, it, vi, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createRef } from "react";
import { parsePreviewLayout, previewHeight, PREVIEW_LAYOUT_KEY } from "./previewLayout";
import { MediaPlayer, type MediaPlayerHandle } from "./components/MediaPlayer";
import { I18nProvider } from "./i18n";

afterEach(() => vi.unstubAllGlobals());

describe("preview layout preferences", () => {
  it("defaults to a small media-aware preview without changing project data", () => {
    const layout = parsePreviewLayout(null);
    expect(layout).toEqual({ height: null, collapsed: false });
    expect(previewHeight(layout, "video")).toBe(144);
    expect(previewHeight(layout, "audio")).toBe(48);
    expect(previewHeight(layout, "empty")).toBe(40);
  });
  it("rejects malformed/versionless preferences and bounds saved heights", () => {
    for (const value of ["broken", "null", "[]", '{"collapsed":true}', '{"version":1,"collapsed":false,"height":"200"}'])
      expect(parsePreviewLayout(value)).toEqual({ height: null, collapsed: false });
    expect(parsePreviewLayout('{"version":1,"collapsed":true,"height":9999}')).toEqual({ collapsed: true, height: 360 });
    expect(parsePreviewLayout('{"version":1,"collapsed":false,"height":-9}')).toEqual({ collapsed: false, height: 48 });
    const custom = parsePreviewLayout('{"version":1,"collapsed":false,"height":232}');
    for (const kind of ["video", "audio", "empty"] as const) expect(previewHeight(custom, kind)).toBe(232);
  });
  it("keeps the media element and playback/fullscreen controls mounted when its picture is collapsed", () => {
    vi.stubGlobal("localStorage", { getItem: (key: string) => key === PREVIEW_LAYOUT_KEY ? '{"version":1,"collapsed":true,"height":152}' : null });
    const html = renderToStaticMarkup(<I18nProvider><MediaPlayer source="blob:qa-media" controlRef={createRef<MediaPlayerHandle>()}
      videoRef={createRef<HTMLVideoElement>()} time={0} duration={10} setTime={() => {}} onDuration={() => {}} onMedia={() => {}}
      playing={false} setPlaying={() => {}} captions={[]} speakers={[]} selected={undefined}/></I18nProvider>);
    expect(html).toContain("preview-collapsed");
    expect(html).toContain('src="blob:qa-media"');
    expect(html).toContain('aria-label="재생"');
    expect(html).toContain('aria-label="전체 화면"');
    expect(html).toContain("미리보기 펼치기");
  });
});
