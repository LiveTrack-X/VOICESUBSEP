import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createProject, parseProject } from "./domain";
import { createProjectSession, editProjectSession, redoProjectSession, undoProjectSession } from "./projectSession";
import { renameTimelineSpeaker, timelineNameKeyAction } from "./timelineSpeakerName";
import { CaptionTimelineLane } from "./components/CaptionTimelineLane";
import { I18nProvider, LOCALES, translate } from "./i18n";

describe("timeline speaker-name commits", () => {
  it("changes only the named identity and can undo/redo the complete edit in one step", () => {
    const project = createProject(2), speaker = project.speakers[0]!;
    project.captions = [{ id: "caption", start: 1, end: 2, text: "말", speakerId: speaker.id, reviewed: false, reasons: [] }];
    const before = JSON.stringify(project);
    const session = editProjectSession(createProjectSession(project), p => renameTimelineSpeaker(p, speaker.id, speaker.name, "새 인물 이름"));
    expect(session.past).toHaveLength(1);
    expect(session.current.speakers[0]).toEqual({ ...speaker, name: "새 인물 이름" });
    expect(session.current.speakers[1]).toBe(project.speakers[1]);
    expect(session.current.captions).toBe(project.captions);
    expect(session.current.notes).toBe(project.notes);
    expect(JSON.stringify(project)).toBe(before);
    const undone = undoProjectSession(session);
    expect(undone.current).toBe(project);
    expect(redoProjectSession(undone).current.speakers[0]?.name).toBe("새 인물 이름");
  });

  it.each(["", "  ", "이름 ", "가".repeat(80)])("preserves Sidebar-compatible names, including empty and whitespace: %s", name => {
    const project = createProject(), speaker = project.speakers[0]!;
    const next = renameTimelineSpeaker(project, speaker.id, speaker.name, name);
    expect(next.speakers[0]?.name).toBe(name);
    expect(parseProject(JSON.stringify(next)).speakers[0]?.name).toBe(name);
  });

  it("ignores duplicate blur commits, stale external edits, removed identities, and excess length", () => {
    const project = createProject(), speaker = project.speakers[0]!;
    const renamed = editProjectSession(createProjectSession(project), p => renameTimelineSpeaker(p, speaker.id, speaker.name, "새 이름"));
    expect(editProjectSession(renamed, p => renameTimelineSpeaker(p, speaker.id, speaker.name, "새 이름"))).toBe(renamed);
    expect(renameTimelineSpeaker(renamed.current, speaker.id, speaker.name, "늦은 초안")).toBe(renamed.current);
    expect(renameTimelineSpeaker(project, "missing", speaker.name, "이름")).toBe(project);
    expect(renameTimelineSpeaker(project, "", "미배정", "이름")).toBe(project);
    expect(renameTimelineSpeaker(project, speaker.id, speaker.name, "가".repeat(81))).toBe(project);
    expect(renameTimelineSpeaker(project, speaker.id, speaker.name, speaker.name)).toBe(project);
  });

  it("does not commit or cancel while IME owns Enter/Escape", () => {
    for (const key of ["Enter", "Escape"]) {
      expect(timelineNameKeyAction({ key, isComposing: true, keyCode: 0 })).toBeNull();
      expect(timelineNameKeyAction({ key, isComposing: false, keyCode: 229 })).toBeNull();
    }
    expect(timelineNameKeyAction({ key: "Enter", isComposing: false, keyCode: 13 })).toBe("commit");
    expect(timelineNameKeyAction({ key: "Escape", isComposing: false, keyCode: 27 })).toBe("cancel");
    expect(timelineNameKeyAction({ key: " ", isComposing: false, keyCode: 32 })).toBeNull();
  });
});

describe("editable timeline labels", () => {
  it("renders a bounded text field only for assigned identities without triggering edits or seeks", () => {
    const onRename = vi.fn(), preview = vi.fn(), onResize = vi.fn();
    const speaker = { ...createProject().speakers[0]!, name: '이름 <A> "B"' };
    const render = (id: string) => renderToStaticMarkup(<I18nProvider><CaptionTimelineLane
      captions={[]} speaker={{ ...speaker, id }} duration={30} mediaDuration={30} time={0} selected={null}
      preview={preview} onResize={onResize} onRename={onRename}/></I18nProvider>);
    const html = render(speaker.id);
    expect(html).toContain('class="timeline-speaker-name" type="text" maxLength="80"');
    expect(html).toContain('이름 &lt;A&gt; &quot;B&quot; 인물 이름 편집');
    expect(render("")).not.toContain("<input");
    expect(render("")).toContain("timeline-speaker-unassigned");
    expect(onRename).not.toHaveBeenCalled();
    expect(preview).not.toHaveBeenCalled();
    expect(onResize).not.toHaveBeenCalled();
  });

  it("provides editing instructions and an accessible label in every supported language", () => {
    for (const locale of LOCALES) {
      expect(translate(locale, "{name} 인물 이름 편집", { name: "Alex" })).toContain("Alex");
      expect(translate(locale, "인물 이름 편집 · Enter 또는 바깥 클릭으로 저장 · Escape로 취소")).toContain("Escape");
    }
  });
});
