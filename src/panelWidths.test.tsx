import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { clampPanelWidth, defaultSidebarWidth, keyboardPanelWidth, PANEL_WIDTH_KEYS, previewWidthBounds, readPanelWidth, savePanelWidth, sidebarWidthBounds } from "./panelWidths";
import { WidthResizeHandle } from "./components/WidthResizeHandle";
import { WorkspaceShell } from "./components/WorkspaceShell";
import { Sidebar } from "./components/Sidebar";
import { createProject } from "./domain";
import { I18nProvider, LOCALES, translate } from "./i18n";

afterEach(() => vi.unstubAllGlobals());
function storage() {
  const data = new Map<string, string>();
  return { data, getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
}

describe("independent panel width preferences", () => {
  it("persists each width separately and resets just the selected panel to automatic", () => {
    const saved = storage();
    expect(readPanelWidth("sidebar", saved)).toBeNull();
    expect(savePanelWidth("sidebar", 320, saved)).toBe(true);
    expect(savePanelWidth("preview", 760, saved)).toBe(true);
    expect(readPanelWidth("sidebar", saved)).toBe(320);
    expect(readPanelWidth("preview", saved)).toBe(760);
    savePanelWidth("preview", null, saved);
    expect(readPanelWidth("preview", saved)).toBeNull();
    expect(readPanelWidth("sidebar", saved)).toBe(320);
  });
  it("rejects malformed and nonnumeric stored geometry, and handles unavailable storage", () => {
    const saved = storage();
    for (const raw of ['{', 'null', '[]', '{"width":300}', '{"version":1,"width":"300"}', '{"version":1,"width":[300]}', '{"version":1,"width":-1}', '{"version":1,"width":4001}']) {
      saved.setItem(PANEL_WIDTH_KEYS.sidebar, raw);
      expect(readPanelWidth("sidebar", saved)).toBeNull();
    }
    const broken = { getItem: () => { throw Error("blocked"); }, setItem: () => { throw Error("blocked"); }, removeItem: () => { throw Error("blocked"); } };
    expect(readPanelWidth("preview", broken)).toBeNull();
    expect(savePanelWidth("preview", 400, broken)).toBe(false);
    expect(savePanelWidth("preview", null, broken)).toBe(false);
    expect(savePanelWidth("preview", Infinity, saved)).toBe(false);
  });
  it("clamps temporarily on a smaller window and restores the stored wide-screen preference", () => {
    const saved = storage();
    savePanelWidth("preview", 900, saved);
    const preference = readPanelWidth("preview", saved)!;
    expect(clampPanelWidth(preference, previewWidthBounds(900))).toBe(408);
    expect(readPanelWidth("preview", saved)).toBe(900);
    expect(clampPanelWidth(preference, previewWidthBounds(1600))).toBe(900);
  });
});

describe("bounded desktop resizing and keyboard access", () => {
  it("reserves a working caption pane and never emits negative/nonfinite geometry", () => {
    for (const width of [0, 200, 900, 1200, 1440, 2560, NaN, Infinity]) {
      const bounds = previewWidthBounds(width);
      expect(Number.isFinite(bounds.min) && Number.isFinite(bounds.max)).toBe(true);
      expect(bounds.min).toBeGreaterThanOrEqual(0);
      expect(bounds.max).toBeGreaterThanOrEqual(bounds.min);
      if (Number.isFinite(width) && width >= 492) expect(width - bounds.max - 12).toBeGreaterThanOrEqual(480);
    }
    expect(sidebarWidthBounds(1200)).toEqual({ min: 200, max: 420 });
    expect(sidebarWidthBounds(1100)).toEqual({ min: 200, max: 420 });
    expect([defaultSidebarWidth(1100), defaultSidebarWidth(1440), defaultSidebarWidth(1920)]).toEqual([215, 244, 260]);
  });
  it("supports keyboard increments and bounded Home/End without resetting the other panel", () => {
    const bounds = { min: 210, max: 608 };
    expect(keyboardPanelWidth("ArrowLeft", 212, bounds)).toBe(210);
    expect(keyboardPanelWidth("ArrowRight", 600, bounds, true)).toBe(608);
    expect(keyboardPanelWidth("ArrowRight", 400, bounds, true)).toBe(440);
    expect(keyboardPanelWidth("Home", 400, bounds)).toBe(210);
    expect(keyboardPanelWidth("End", 400, bounds)).toBe(608);
    expect(keyboardPanelWidth("Enter", 400, bounds)).toBeNull();
  });
  it("renders an accessible separator and independent settings width without altering editor children", () => {
    vi.stubGlobal("localStorage", storage());
    const html = renderToStaticMarkup(<I18nProvider><WorkspaceShell sidebar={<aside className="sidebar">Settings</aside>}><input defaultValue="Keep draft"/></WorkspaceShell></I18nProvider>);
    expect(html).toContain('style="--sidebar-width:244px"');
    expect(html).toContain('role="separator"');
    expect(html).toContain('aria-orientation="vertical"');
    expect(html).toContain('aria-valuemin="200"');
    expect(html).toContain('aria-valuemax="420"');
    expect(html).toContain('value="Keep draft"');
    const handle = renderToStaticMarkup(<I18nProvider><WidthResizeHandle label="미리보기·컷 편집 너비 조절" className="test" value={400} min={210} max={608} onChange={() => {}} onCommit={() => {}} onCancel={() => {}} onReset={() => {}}/></I18nProvider>);
    expect(handle).toContain('aria-valuenow="400"');
    for (const locale of LOCALES) expect(translate(locale, "패널 너비 {width}px", { width: 400 })).toContain("400px");
  });
});

describe("media connection status is factual", () => {
  function sidebar(hasMedia: boolean, mediaVerifying = false, mediaStatus?: string) {
    const project = createProject(1); project.mediaName = "original.wav";
    return renderToStaticMarkup(<I18nProvider><Sidebar project={project} update={() => {}} onMedia={() => {}} onAnalyze={() => {}} busy={false} hasMedia={hasMedia} mediaVerifying={mediaVerifying} mediaStatus={mediaStatus}/></I18nProvider>);
  }
  it("does not label a saved filename as connected until verification succeeds", () => {
    expect(sidebar(false)).toContain("media-disconnected");
    expect(sidebar(false)).toContain("원본 미디어 다시 연결");
    expect(sidebar(false)).not.toContain("원본 연결됨");
    expect(sidebar(true)).toContain("media-connected");
    expect(sidebar(true)).toContain("원본 연결됨");
    expect(sidebar(true)).toContain("클릭하여 원본 미디어 변경");
  });
  it("distinguishes verification in progress and safely displays reconnect guidance", () => {
    const html = sidebar(true, true, "<original> unavailable");
    expect(html).toContain("media-checking");
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("원본 연결 확인 중");
    expect(html).not.toContain("원본 연결됨");
    expect(html).toContain("&lt;original&gt; unavailable");
  });
});
