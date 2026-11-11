import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Timeline } from "./components/Timeline";
import { createProject } from "./domain";
import { I18nProvider } from "./i18n";

afterEach(() => vi.unstubAllGlobals());

describe("timeline zoom controls", () => {
  it("offers direct access to every doubling step through 64× without editing the project or starting playback", () => {
    vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
    vi.stubGlobal("localStorage", { getItem: () => null });
    const project = createProject(), before = JSON.stringify(project);
    const update = vi.fn(), preview = vi.fn(), seek = vi.fn();
    const html = renderToStaticMarkup(<I18nProvider><Timeline project={project} file={null} update={update}
      onError={() => {}} time={0} preview={preview} selected={null} previewNote={() => {}} selectedNote={null}
      seek={seek} editCaption={() => {}} editNote={() => {}}/></I18nProvider>);
    expect(html).toContain('<select aria-label="타임라인 확대 비율"');
    for (const zoom of [1, 2, 4, 8, 16, 32, 64]) expect(html).toMatch(new RegExp(`<option value="${zoom}"[^>]*>${zoom}×</option>`));
    expect(html).toContain('aria-label="타임라인 축소" disabled=""');
    expect(html).toContain('aria-label="타임라인 확대"');
    expect(update).not.toHaveBeenCalled(); expect(preview).not.toHaveBeenCalled(); expect(seek).not.toHaveBeenCalled();
    expect(JSON.stringify(project)).toBe(before);
  });
});
