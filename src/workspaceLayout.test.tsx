import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { EditorWorkspace } from "./components/EditorWorkspace";
import { NotesPanel } from "./components/NotesPanel";
import { Sidebar } from "./components/Sidebar";
import { createProject } from "./domain";
import { I18nProvider } from "./i18n";

afterEach(() => vi.unstubAllGlobals());

function environment(narrow: boolean, values: Record<string, string> = {}) {
  vi.stubGlobal("window", { matchMedia: () => ({ matches: narrow }) });
  vi.stubGlobal("localStorage", { getItem: (key: string) => values[key] ?? null });
}
function workspace() {
  return renderToStaticMarkup(<I18nProvider><EditorWorkspace noteReveal={null} tools={<button>Recovery control</button>}>
    <input aria-label="Retained editor draft" defaultValue="unsaved draft"/>
  </EditorWorkspace></I18nProvider>);
}

describe("workspace layout preferences and accessible recovery controls", () => {
  it.each([true, false])("starts with focus only on narrow screens (narrow=%s)", narrow => {
    environment(narrow);
    const html = workspace();
    expect(html.includes('class="editor-workspace subtitle-focus"')).toBe(narrow);
    expect(html).toContain(`aria-pressed="${narrow}"`);
    expect(html).toContain(narrow ? "전체 패널 보기" : "자막 집중");
    expect(html).toContain("Recovery control");
    expect(html).toContain('value="unsaved draft"');
  });

  it.each([true, false])("keeps narrow and wide saved preferences independent (narrow=%s)", narrow => {
    environment(narrow, { "voicesubsep-editor-focus-v1": "true", "voicesubsep-editor-focus-narrow-v1": "false" });
    expect(workspace().includes('class="editor-workspace subtitle-focus"')).toBe(!narrow);
  });

  it("keeps restore controls and mounted editor state available when storage is blocked", () => {
    environment(true);
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("Storage unavailable"); } });
    const html = workspace();
    expect(html).toContain("전체 패널 보기");
    expect(html).toContain("Recovery control");
    expect(html).toContain('value="unsaved draft"');
  });

  it.each(["saved", "reveal"])("opens the notes editor from %s without changing project data", mode => {
    environment(false, mode === "saved" ? { "voicesubsep-notes-expanded-v1": "true" } : {});
    const project = createProject(1);
    project.notes.push({ id: "note-1", start: 0, end: null, text: "Keep my note", tag: "edit", done: false });
    const before = JSON.stringify(project), update = vi.fn();
    const html = renderToStaticMarkup(<I18nProvider><NotesPanel project={project} update={update} time={0} seek={() => {}}
      reveal={mode === "reveal" ? { id: "note-1" } : null} onError={() => {}}/></I18nProvider>);
    expect(html).toContain('class="notes-panel panel notes-expanded"');
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain("Keep my note");
    expect(update).not.toHaveBeenCalled();
    expect(JSON.stringify(project)).toBe(before);
  });

  it("keeps the compact settings opener available without requiring a DOM or an open modal", () => {
    environment(true);
    const html = renderToStaticMarkup(<I18nProvider><Sidebar project={createProject(1)} update={() => {}}
      onMedia={() => {}} onAnalyze={() => {}} busy={false} hasMedia={false}/></I18nProvider>);
    expect(html).toContain('class="sidebar-compact-toggle" aria-expanded="false"');
    expect(html).toContain("프로젝트 설정·인물");
    expect(html).toContain("미디어 불러오기");
    expect(html).not.toContain('role="dialog"');
  });
});
