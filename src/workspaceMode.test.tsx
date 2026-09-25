import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nProvider } from "./i18n";
import { WorkspaceModeSwitcher, workspaceModeForDialog, type WorkspaceMode } from "./components/WorkspaceModeSwitcher";

describe("workspace entry points", () => {
  it("follows the actual document and recording workflows and returns to editing on close", () => {
    expect(workspaceModeForDialog("documents")).toBe("documents");
    expect(workspaceModeForDialog("live")).toBe("recording");
    for (const dialog of [null, "analysis", "render", "settings", "export", "history"])
      expect(workspaceModeForDialog(dialog)).toBe("editing");
  });

  it.each(["editing", "documents", "recording"] as const)("marks only %s active and identifies modal entry points", (mode: WorkspaceMode) => {
    const html = renderToStaticMarkup(<I18nProvider><WorkspaceModeSwitcher mode={mode} onSelect={() => {}}/></I18nProvider>);
    const buttons = html.match(/<button\b[\s\S]*?<\/button>/g) ?? [];
    expect(buttons).toHaveLength(3);
    expect(buttons.filter(button => button.includes('aria-pressed="true"'))).toHaveLength(1);
    const active = buttons.find(button => button.includes('aria-pressed="true"'))!;
    expect(active).toContain({editing:"자막·영상 편집",documents:"인터뷰·회의록",recording:"녹음"}[mode]);
    expect(buttons.filter(button => button.includes('aria-haspopup="dialog"'))).toHaveLength(2);
    expect(html).toContain("마이크·시스템 소리 녹음 후 분석");
    expect(html).not.toContain("실시간 자막");
  });
});
