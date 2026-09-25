import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { EditorWorkspace } from "./components/EditorWorkspace";
import { NotesPanel } from "./components/NotesPanel";
import { Sidebar } from "./components/Sidebar";
import { createProject } from "./domain";
import { I18nProvider } from "./i18n";
import { calculateWorkspacePreview, type WorkspacePreviewMeasurement } from "./workspaceLayout";

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
    expect(html).toMatch(/class="notes-panel panel notes-expanded(?: |")/);
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

describe("automatic contained preview geometry", () => {
  const base: WorkspacePreviewMeasurement = { wide: true, width: 1100, height: 560,
    playerChrome: 92, auxiliaryHeight: 60, captionChrome: 130,
    aspectRatio: 16 / 9, kind: "video", collapsed: false };

  it("enlarges landscape video while preserving the main caption pane", () => {
    const result = calculateWorkspacePreview(base);
    expect(result.columnWidth).toBe(495);
    expect(result.stageHeight).toBe(278);
    expect(base.width - result.columnWidth - 12).toBeGreaterThanOrEqual(480);
    expect(result.columnWidth).toBeLessThanOrEqual(base.width * .45);
    expect(result.stageHeight).toBeGreaterThan(144);
  });

  it("fits portrait height and reserves expanding cut controls instead of cropping", () => {
    const portrait = calculateWorkspacePreview({ ...base, aspectRatio: 9 / 16 });
    expect(portrait.stageHeight).toBe(408);
    expect(portrait.columnWidth).toBe(495);
    const expandedCut = calculateWorkspacePreview({ ...base, aspectRatio: 9 / 16, auxiliaryHeight: 210 });
    expect(expandedCut.stageHeight).toBe(258);
    expect(expandedCut.columnWidth).toBe(portrait.columnWidth);
  });

  it("protects 324px of caption rows on stacked screens and bounds tall windows", () => {
    const narrow = calculateWorkspacePreview({ ...base, wide: false, width: 480, height: 700, auxiliaryHeight: 30 });
    expect(narrow.stageHeight).toBe(124);
    expect(700 - narrow.stageHeight - 92 - 30 - 130).toBe(324);
    expect(calculateWorkspacePreview({ ...base, wide: false, width: 900, height: 2000 }).stageHeight).toBe(260);
    expect(calculateWorkspacePreview({ ...base, wide: false, width: 480, height: 300 }).stageHeight).toBe(48);
  });

  it("fits the selected width while keeping collapse, audio and empty states compact", () => {
    expect(calculateWorkspacePreview({ ...base, manualWidth: 400 })).toEqual({ columnWidth: 400, stageHeight: 225 });
    expect(calculateWorkspacePreview({ ...base, manualWidth: 999 })).toEqual({ columnWidth: 608, stageHeight: 342 });
    expect(calculateWorkspacePreview({ ...base, collapsed: true, manualWidth: 400 })).toEqual({ columnWidth: 400, stageHeight: 0 });
    expect(calculateWorkspacePreview({ ...base, kind: "audio" }).stageHeight).toBe(48);
    expect(calculateWorkspacePreview({ ...base, kind: "audio", wide: false }).stageHeight).toBe(32);
    expect(calculateWorkspacePreview({ ...base, kind: "empty" }).stageHeight).toBe(40);
  });

  it.each([16 / 9, 9 / 16, 1])("never feeds height/cut wrapping back into either column (aspect=%s)", aspectRatio => {
    const measurement = { ...base, aspectRatio };
    const automatic = calculateWorkspacePreview(measurement);
    const heights = Array.from({ length: 40 }, (_, index) => 280 + index * 16);
    for (const height of [...heights, ...[...heights].reverse()]) {
      const resized = calculateWorkspacePreview({ ...measurement, height, auxiliaryHeight: height % 110 });
      expect(resized.columnWidth).toBe(automatic.columnWidth);
      expect(calculateWorkspacePreview({ ...measurement, height, manualWidth: 400 }).columnWidth).toBe(400);
    }
    expect(calculateWorkspacePreview({ ...measurement, manualWidth: null })).toEqual(automatic);
  });

  it("uses both available dimensions without the old 360px ceiling and ignores width preferences when stacked", () => {
    const full = calculateWorkspacePreview({ ...base, width: 1700, height: 1000, manualWidth: 900 });
    expect(full).toEqual({ columnWidth: 900, stageHeight: 506 });
    const constrained = calculateWorkspacePreview({ ...base, width: 1700, height: 480, manualWidth: 900 });
    expect(constrained).toEqual({ columnWidth: 900, stageHeight: 328 });
    const stacked = { ...base, wide: false, width: 640, height: 700 };
    expect(calculateWorkspacePreview({ ...stacked, manualWidth: 240 })).toEqual(calculateWorkspacePreview({ ...stacked, manualWidth: 900 }));
  });

  it("uses a safe unknown-video aspect and never emits nonfinite geometry", () => {
    expect(calculateWorkspacePreview({ ...base, aspectRatio: NaN })).toEqual(calculateWorkspacePreview(base));
    const result = calculateWorkspacePreview({ ...base, width: NaN, height: Infinity, playerChrome: NaN, auxiliaryHeight: -10 });
    expect(Number.isFinite(result.stageHeight) && Number.isFinite(result.columnWidth)).toBe(true);
    expect(result.stageHeight).toBe(0);
  });
});
