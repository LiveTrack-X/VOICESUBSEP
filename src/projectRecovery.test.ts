import { describe, expect, it } from "vitest";
import { createProject, MAX_PROJECT_BYTES, parseProject } from "./domain";
import { PROJECT_STORAGE_KEY, PROJECT_BACKUP_KEY, PROJECT_DAMAGED_KEY, readRecoveryProject,
  readRecoveryRaw, recoveryRecords, saveRecoverableProject } from "./projectRecovery";

class Store {
  values = new Map<string, string>();
  blocked = new Set<string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { if (this.blocked.has(key)) throw new Error("quota"); this.values.set(key, value); }
}
function projectAt(time: string) { return { ...createProject(), updatedAt: time }; }

describe("recoverable autosave", () => {
  it("rejects invalid state before overwriting current or previous snapshots", () => {
    const store = new Store(); const project = createProject();
    expect(saveRecoverableProject(project, store)).toBe("saved");
    const saved = store.getItem(PROJECT_STORAGE_KEY);
    const invalid = { ...project, captions: [{ id: "bad", start: 0, end: 2, text: "a".repeat(10_001), speakerId: null, reasons: [], reviewed: false }] };
    expect(saveRecoverableProject(invalid, store)).toBe("invalid");
    expect(store.getItem(PROJECT_STORAGE_KEY)).toBe(saved);
    expect(store.getItem(PROJECT_BACKUP_KEY)).toBeNull();
    expect(parseProject(saved!).id).toBe(project.id);
  });
  it("keeps one older valid snapshot across close/reopen with at most minute rotation", () => {
    const store = new Store(); const original = projectAt("2026-09-25T00:00:00.000Z");
    saveRecoverableProject(original, store);
    saveRecoverableProject({ ...original, name: "one", updatedAt: "2026-09-25T00:00:01.000Z" }, store);
    saveRecoverableProject({ ...original, name: "two", updatedAt: "2026-09-25T00:00:20.000Z" }, store);
    expect(readRecoveryProject(PROJECT_BACKUP_KEY, store).name).toBe(original.name);
    saveRecoverableProject({ ...original, name: "three", updatedAt: "2026-09-25T00:01:10.000Z" }, store);
    saveRecoverableProject({ ...original, name: "four", updatedAt: "2026-09-25T00:01:11.000Z" }, store);
    expect(readRecoveryProject(PROJECT_BACKUP_KEY, store).name).toBe("three");
    expect(recoveryRecords(store).map((entry) => entry.valid)).toEqual([true, true]);
    expect(readRecoveryProject(PROJECT_STORAGE_KEY, store).name).toBe("four");
  });
  it("always checkpoints the outgoing project at replacement even within a minute", () => {
    const store = new Store(); const previous = createProject(); const next = createProject();
    saveRecoverableProject(previous, store); saveRecoverableProject(next, store);
    expect(readRecoveryProject(PROJECT_BACKUP_KEY, store).id).toBe(previous.id);
    expect(readRecoveryProject(PROJECT_STORAGE_KEY, store).id).toBe(next.id);
  });
  it("archives unreadable bytes before replacing them and offers raw export but no restore", () => {
    const store = new Store(); const damaged = "{broken Korean 전사";
    store.values.set(PROJECT_STORAGE_KEY, damaged);
    expect(saveRecoverableProject(createProject(), store)).toBe("saved");
    expect(readRecoveryRaw(PROJECT_DAMAGED_KEY, store)).toBe(damaged);
    expect(recoveryRecords(store).find((entry) => entry.key === PROJECT_DAMAGED_KEY)?.valid).toBe(false);
    expect(() => readRecoveryProject(PROJECT_DAMAGED_KEY, store)).toThrow();
  });
  it("does not overwrite an unreadable current entry when archiving fails", () => {
    const store = new Store(); store.values.set(PROJECT_STORAGE_KEY, "broken"); store.blocked.add(PROJECT_DAMAGED_KEY);
    expect(saveRecoverableProject(createProject(), store)).toBe("blocked");
    expect(store.getItem(PROJECT_STORAGE_KEY)).toBe("broken");
  });
  it("never replaces an already preserved different damaged original", () => {
    const store = new Store(); store.values.set(PROJECT_STORAGE_KEY, "new broken"); store.values.set(PROJECT_DAMAGED_KEY, "older broken");
    expect(saveRecoverableProject(createProject(), store)).toBe("blocked");
    expect(store.getItem(PROJECT_STORAGE_KEY)).toBe("new broken");
    expect(store.getItem(PROJECT_DAMAGED_KEY)).toBe("older broken");
  });
  it("can resume when the preserved damaged bytes are identical", () => {
    const store = new Store(); store.values.set(PROJECT_STORAGE_KEY, "broken"); store.values.set(PROJECT_DAMAGED_KEY, "broken");
    expect(saveRecoverableProject(createProject(), store)).toBe("saved");
  });
  it("reports backup failure without sacrificing a save that fits the current key", () => {
    const store = new Store(); const previous = createProject(); saveRecoverableProject(previous, store);
    store.blocked.add(PROJECT_BACKUP_KEY);
    expect(saveRecoverableProject({ ...previous, name: "new" }, store)).toBe("saved_without_backup");
    expect(readRecoveryProject(PROJECT_STORAGE_KEY, store).name).toBe("new");
  });
  it("sheds optional activity evidence when later edits push a project over the file limit", () => {
    const store = new Store(); const project = createProject(2); project.duration = 80;
    project.captions = Array.from({ length: 6_000 }, (_, index) => ({
      id: `large-${index}`, start: index / 100, end: index / 100 + 0.005,
      text: "t".repeat(450), speakerId: null, reasons: [], reviewed: false,
      speakerEvidence: { version: 1 as const, method: "activity" as const, reasons: ["insufficient_activity" as const],
        activity: Array.from({ length: 32 }, (_, speaker) => ({ speakerId: `speaker-${speaker}`, overlapSeconds: 0, coverage: 0 })), words: [] },
    }));
    project.captions[0] = { ...project.captions[0]!, speakerEvidence: {
      ...project.captions[0]!.speakerEvidence!,
      recommendation: { speakerId: project.speakers[0]!.id, method: "boundary_context", anchorCaptionIds: ["large-1"], targetWordCount: 1,
        sourceSnapshots: [
          { captionId: "large-0", start: 0, end: 0.005, text: "t".repeat(450), speakerId: null },
          { captionId: "large-1", start: 0.01, end: 0.015, text: "t".repeat(450), speakerId: project.speakers[0]!.id },
        ] },
    } };
    expect(new TextEncoder().encode(JSON.stringify(project)).byteLength).toBeGreaterThan(MAX_PROJECT_BYTES);
    const result = saveRecoverableProject(project, store);
    expect(result).toBe("saved_with_reduced_evidence");
    const saved = readRecoveryProject(PROJECT_STORAGE_KEY, store);
    expect(new TextEncoder().encode(store.getItem(PROJECT_STORAGE_KEY)!).byteLength).toBeLessThanOrEqual(MAX_PROJECT_BYTES);
    expect(saved.captions).toHaveLength(project.captions.length);
    expect(saved.captions[0]!.text).toBe(project.captions[0]!.text);
    expect(saved.captions[0]!.start).toBe(project.captions[0]!.start);
    expect(saved.captions[0]!.speakerEvidence?.recommendation).toBeUndefined();
    expect(saved.captions[1]!.speakerEvidence?.recommendation).toBeUndefined();
    expect(saved.captions.some(caption => caption.speakerEvidence?.activity.length)).toBe(false);
  });
  it("leaves the last current snapshot intact if the primary write fails", () => {
    const store = new Store(); const previous = createProject(); saveRecoverableProject(previous, store);
    store.blocked.add(PROJECT_STORAGE_KEY);
    expect(saveRecoverableProject({ ...previous, name: "new" }, store)).toBe("failed");
    expect(readRecoveryProject(PROJECT_STORAGE_KEY, store).name).toBe(previous.name);
    expect(readRecoveryProject(PROJECT_BACKUP_KEY, store).name).toBe(previous.name);
  });
  it("preserves an unreadable previous snapshot and warns while current autosave continues", () => {
    const store = new Store(); const previous = createProject(); saveRecoverableProject(previous, store);
    store.values.set(PROJECT_BACKUP_KEY, "broken previous");
    expect(saveRecoverableProject({ ...previous, name: "edited" }, store)).toBe("saved_without_backup");
    expect(readRecoveryRaw(PROJECT_BACKUP_KEY, store)).toBe("broken previous");
    expect(readRecoveryProject(PROJECT_STORAGE_KEY, store).name).toBe("edited");
    // An unchanged autosave/pagehide must not falsely report that the backup
    // recovered while its unreadable bytes are still intentionally preserved.
    expect(saveRecoverableProject({ ...previous, name: "edited" }, store)).toBe("saved_without_backup");
    expect(readRecoveryRaw(PROJECT_BACKUP_KEY, store)).toBe("broken previous");
  });
  it("does not let recovery export access arbitrary settings keys", () => {
    expect(() => readRecoveryRaw("secret" as typeof PROJECT_STORAGE_KEY, new Store())).toThrow(/복구할/);
  });
});
