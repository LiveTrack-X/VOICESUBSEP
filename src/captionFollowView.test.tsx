import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CaptionEditor } from "./components/CaptionEditor";
import { I18nProvider } from "./i18n";
import { createProject } from "./domain";
import { CAPTION_FOLLOW_KEY } from "./captionFollow";

afterEach(() => vi.unstubAllGlobals());
describe("playback-follow preference in the editor", () => {
  it.each([null, "true", "false"])("renders restored toggle %s without mutating project, selection or preferences", saved => {
    const setItem = vi.fn(), update = vi.fn(), setSelected = vi.fn(), preview = vi.fn();
    vi.stubGlobal("localStorage", { getItem: (key: string) => key === CAPTION_FOLLOW_KEY ? saved : null, setItem });
    const project = createProject();
    const original = JSON.stringify(project);
    const html = renderToStaticMarkup(<I18nProvider><CaptionEditor project={project} update={update} preview={preview} reveal={null} selected={null} setSelected={setSelected} onImport={() => {}} onSample={() => {}} onError={() => {}} time={0} playing/></I18nProvider>);
    expect(html).toContain(`class="caption-follow-toggle" aria-pressed="${saved !== "false"}"`);
    expect(html).toContain("재생 따라가기");
    expect(html).toContain("직접 스크롤한 뒤 4초");
    expect(JSON.stringify(project)).toBe(original);
    expect(update).not.toHaveBeenCalled(); expect(setSelected).not.toHaveBeenCalled(); expect(preview).not.toHaveBeenCalled(); expect(setItem).not.toHaveBeenCalled();
  });
});
