import { demoProject } from "./testFixtures/demoProject";
import { describe, expect, it } from "vitest";
import { createProject, parseProject, type Project } from "./domain";
import {
  createProjectSession,
  editProjectSession,
  isCurrentProjectSession,
  persistProjectSession,
  PROJECT_STORAGE_KEY,
  redoProjectSession,
  replaceProjectSession,
  undoProjectSession,
} from "./projectSession";

class MemoryStorage {
  values = new Map<string, string>();
  writes = 0;
  failWrites = false;
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) {
    this.writes += 1;
    if (this.failWrites) throw new Error("Storage full");
    this.values.set(key, value);
  }
  project() { return parseProject(this.values.get(PROJECT_STORAGE_KEY)!); }
}
function rename(project: Project, name: string): Project {
  return { ...project, speakers: project.speakers.map((speaker, index) => index === 0 ? { ...speaker, name } : speaker) };
}

describe("project session boundaries", () => {
  it("drops previous names, styles, edits, and both history directions when starting a project", () => {
    const previous = demoProject();
    previous.speakers[0]!.name = "이전 참가자";
    previous.speakers[0]!.subtitleStyle = { fontSize: 40 };
    let session = editProjectSession(createProjectSession(previous), (project) => rename(project, "수정 이름"));
    session = undoProjectSession(session);
    expect(session.future).toHaveLength(1);
    const fresh = replaceProjectSession(createProject());
    expect(fresh.current.speakers.map((speaker) => speaker.name)).toEqual(["인물 A", "인물 B", "인물 C", "인물 D"]);
    expect(fresh.current.speakers[0]!.subtitleStyle).toBeUndefined();
    expect(fresh.current.captions).toEqual([]);
    expect(fresh.current.notes).toEqual([]);
    expect(fresh.past).toEqual([]);
    expect(fresh.future).toEqual([]);
    expect(undoProjectSession(fresh)).toBe(fresh);
    expect(redoProjectSession(fresh)).toBe(fresh);
    expect(previous.speakers[0]!.name).toBe("이전 참가자");
  });

  it("preserves names and styles from an opened project while creating a fresh history", () => {
    const opened = demoProject();
    opened.speakers[0]!.subtitleStyle = { textColor: "#123456" };
    const session = replaceProjectSession(opened);
    expect(session.current.id).toBe(opened.id);
    expect(session.current.speakers).toEqual(opened.speakers);
    expect(session.current.captions).toEqual(opened.captions);
    expect(session.past).toEqual([]);
    expect(session.future).toEqual([]);
  });

  it("keeps normal undo and redo within the replacement project and clears redo after an edit", () => {
    const fresh = replaceProjectSession(createProject());
    const edited = editProjectSession(fresh, (project) => rename(project, "새 참가자"));
    const undone = undoProjectSession(edited);
    expect(undone.current.speakers[0]!.name).toBe("인물 A");
    expect(redoProjectSession(undone).current.speakers[0]!.name).toBe("새 참가자");
    const revised = editProjectSession(undone, (project) => rename(project, "다른 이름"));
    expect(revised.future).toEqual([]);
    expect(revised.current.id).toBe(fresh.current.id);
    expect(revised.past.every((project) => project.id === fresh.current.id)).toBe(true);
  });

  it("bounds retained history during repeated edits and redo", () => {
    let session = createProjectSession(createProject());
    for (let index = 0; index < 65; index += 1)
      session = editProjectSession(session, (project) => rename(project, String(index)));
    expect(session.past).toHaveLength(40);
    for (let index = 0; index < 40; index += 1) session = undoProjectSession(session);
    expect(session.past).toHaveLength(0);
    for (let index = 0; index < 40; index += 1) session = redoProjectSession(session);
    expect(session.past).toHaveLength(40);
    expect(session.current.speakers[0]!.name).toBe("64");
  });

  it("rejects old project callbacks but accepts callbacks from previous edits in the same session", () => {
    const previous = createProjectSession(demoProject());
    const edited = editProjectSession(previous, (project) => rename(project, "현재 이름"));
    expect(isCurrentProjectSession(previous, edited)).toBe(true);
    expect(isCurrentProjectSession(edited, undoProjectSession(edited))).toBe(true);
    const reopened = replaceProjectSession(edited.current);
    expect(reopened.current.id).toBe(previous.current.id);
    expect(isCurrentProjectSession(previous, reopened)).toBe(false);
    expect(isCurrentProjectSession(edited, reopened)).toBe(false);
  });
});

describe("project persistence across replacement", () => {
  it("writes the replacement immediately and rejects old timer and pagehide snapshots", () => {
    const storage = new MemoryStorage();
    const previous = createProjectSession(demoProject());
    expect(persistProjectSession(previous, previous, storage)).toBe("saved");
    const fresh = replaceProjectSession(createProject());
    expect(persistProjectSession(fresh, fresh, storage)).toBe("saved");
    expect(storage.project().id).toBe(fresh.current.id);
    expect(storage.project().speakers[0]!.name).toBe("인물 A");
    expect(persistProjectSession(previous, fresh, storage)).toBe("skipped");
    expect(storage.writes).toBe(3); // Current entry plus a previous valid snapshot.
    expect(storage.project().id).toBe(fresh.current.id);
  });

  it("rejects stale saves even if an opened project uses the same id", () => {
    const storage = new MemoryStorage();
    const previous = createProjectSession(demoProject());
    const reopened = replaceProjectSession(rename(previous.current, "파일의 이름"));
    expect(persistProjectSession(reopened, reopened, storage)).toBe("saved");
    expect(persistProjectSession(previous, reopened, storage)).toBe("skipped");
    expect(storage.project().speakers[0]!.name).toBe("파일의 이름");
  });

  it("does not overwrite a newer edit with its prior autosave snapshot", () => {
    const storage = new MemoryStorage();
    const initial = createProjectSession(createProject());
    const latest = editProjectSession(initial, (project) => rename(project, "최신 이름"));
    expect(persistProjectSession(initial, latest, storage)).toBe("skipped");
    expect(persistProjectSession(latest, latest, storage)).toBe("saved");
    expect(storage.project().speakers[0]!.name).toBe("최신 이름");
    expect(storage.writes).toBe(1);
  });

  it("reports a failed write, preserves the old backup, and allows a later retry", () => {
    const storage = new MemoryStorage();
    const previous = createProjectSession(demoProject());
    persistProjectSession(previous, previous, storage);
    const saved = storage.values.get(PROJECT_STORAGE_KEY);
    const fresh = replaceProjectSession(createProject());
    storage.failWrites = true;
    expect(persistProjectSession(fresh, fresh, storage)).toBe("failed");
    expect(storage.values.get(PROJECT_STORAGE_KEY)).toBe(saved);
    expect(persistProjectSession(previous, fresh, storage)).toBe("skipped");
    storage.failWrites = false;
    expect(persistProjectSession(fresh, fresh, storage)).toBe("saved");
    expect(storage.project().id).toBe(fresh.current.id);
  });

  it("preserves an unreadable backup during edits until an explicit replacement", () => {
    const storage = new MemoryStorage();
    storage.values.set(PROJECT_STORAGE_KEY, "unreadable project backup");
    const restored = createProjectSession(createProject(), false);
    const edited = editProjectSession(restored, (project) => rename(project, "복구 중"));
    expect(persistProjectSession(edited, edited, storage)).toBe("skipped");
    expect(storage.values.get(PROJECT_STORAGE_KEY)).toBe("unreadable project backup");
    expect(storage.writes).toBe(0);
    const explicit = replaceProjectSession(createProject());
    expect(persistProjectSession(explicit, explicit, storage)).toBe("saved");
    expect(storage.project().id).toBe(explicit.current.id);
  });
});
