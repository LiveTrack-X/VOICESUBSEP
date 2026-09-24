import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Recording } from "./recordingStore";

// A narrow IDB transaction double: requests run asynchronously, writes commit together,
// and abort rolls back every pending mutation. It opens no browser/device/storage handles.
type Range = { lower: unknown[]; upper: unknown[] };
type SavedChunk = { session: string; source: string; sequence: number; data: Blob };
function idbFixture() {
  let sessions = new Map<string, Recording>(); let chunks: SavedChunk[] = [];
  const deleted: unknown[] = []; const fileRanges: unknown[] = [];
  const connection = {
    close: vi.fn(), onversionchange: undefined as (() => void) | undefined, onclose: undefined as (() => void) | undefined,
    transaction() {
      const workingSessions = new Map([...sessions].map(([key, value]) => [key, structuredClone(value)]));
      const workingChunks = [...chunks]; let pending = 0; let aborted = false;
      const tx = {
        oncomplete: undefined as (() => void) | undefined, onabort: undefined as (() => void) | undefined,
        onerror: undefined as (() => void) | undefined, error: null,
        abort() { aborted = true; queueMicrotask(() => tx.onabort?.()); },
        objectStore(name: string) {
          const operation = <T>(fn: () => T) => {
            const request = { result: undefined as T | undefined, onsuccess: undefined as (() => void) | undefined, onerror: undefined as (() => void) | undefined };
            pending++;
            queueMicrotask(() => {
              if (!aborted) {
                try { request.result = fn(); request.onsuccess?.(); }
                catch { tx.abort(); }
              }
              pending--;
              if (!pending && !aborted) queueMicrotask(() => {
                if (!pending && !aborted) { sessions = workingSessions; chunks = workingChunks; tx.oncomplete?.(); }
              });
            });
            return request;
          };
          return {
            get: (key: string) => operation(() => workingSessions.get(key)),
            add: (value: Recording | SavedChunk) => operation(() => {
              if (name === "sessions") {
                const row = value as Recording; if (workingSessions.has(row.id)) throw new Error("duplicate"); workingSessions.set(row.id, structuredClone(row));
              } else {
                const row = value as SavedChunk;
                if (workingChunks.some(item => item.session === row.session && item.source === row.source && item.sequence === row.sequence)) throw new Error("duplicate");
                workingChunks.push(row);
              }
            }),
            put: (value: Recording) => operation(() => { workingSessions.set(value.id, structuredClone(value)); }),
            getAll: (range?: Range) => operation(() => {
              if (name === "sessions") return [...workingSessions.values()];
              fileRanges.push(range);
              return workingChunks.filter(row => row.session === range!.lower[0] && row.source === range!.lower[1]).sort((a,b) => a.sequence - b.sequence);
            }),
            delete: (key: string | Range) => operation(() => {
              deleted.push(key);
              if (name === "sessions") workingSessions.delete(key as string);
              else for (let index = workingChunks.length - 1; index >= 0; index--) if (workingChunks[index].session === (key as Range).lower[0]) workingChunks.splice(index, 1);
            }),
          };
        },
      };
      return tx;
    },
  };
  const open = vi.fn(() => {
    const request = { result: connection, onsuccess: undefined as (() => void) | undefined, onerror: undefined as (() => void) | undefined, onblocked: undefined as (() => void) | undefined };
    queueMicrotask(() => request.onsuccess?.()); return request;
  });
  vi.stubGlobal("indexedDB", { open }); vi.stubGlobal("IDBKeyRange", { bound: (lower: unknown[], upper: unknown[]) => ({ lower, upper }) });
  return { connection, open, deleted, fileRanges, sessions: () => sessions, chunks: () => chunks };
}
const row = (id = "session-a"): Recording => ({ id, startedAt: "2026-09-25T00:00:00.000Z", sources: ["microphone", "mix"], offsets: {}, mime: "audio/webm;codecs=opus", bytes: 0, status: "recording" });
beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

describe("recording journal transaction contracts", () => {
  it("saves audio bytes atomically and exports one source in sequence order", async () => {
    const db = idbFixture(); const { recordingStore } = await import("./recordingStore");
    const session = row(); await recordingStore.create(session);
    await recordingStore.append(session.id, "mix", 1, new Blob(["second"]));
    await recordingStore.append(session.id, "microphone", 0, new Blob(["separate"]));
    await recordingStore.append(session.id, "mix", 0, new Blob(["first"]));
    expect(db.sessions().get(session.id)!.bytes).toBe(19);
    const file = await recordingStore.file(session, "mix"); expect(await file.text()).toBe("firstsecond");
    expect(file.type).toBe(session.mime); expect(file.name.endsWith("-mix.webm")).toBe(true);
    expect(db.fileRanges).toEqual([{ lower: [session.id, "mix", 0], upper: [session.id, "mix", Number.MAX_SAFE_INTEGER] }]);
  });

  it("rolls back a duplicate chunk without inflating byte totals", async () => {
    const db = idbFixture(); const { recordingStore } = await import("./recordingStore");
    await recordingStore.create(row()); await recordingStore.append("session-a", "mix", 0, new Blob(["saved"]));
    await expect(recordingStore.append("session-a", "mix", 0, new Blob(["duplicate"]))).rejects.toThrow();
    expect(db.sessions().get("session-a")!.bytes).toBe(5); expect(db.chunks()).toHaveLength(1);
  });

  it("refuses missing sessions and the session cap before adding any chunk", async () => {
    const db = idbFixture(); const { recordingStore } = await import("./recordingStore");
    await expect(recordingStore.append("missing", "mix", 0, new Blob(["x"]))).rejects.toThrow();
    await recordingStore.create({ ...row(), bytes: 2 * 1024 ** 3 });
    await expect(recordingStore.append("session-a", "mix", 0, new Blob(["x"]))).rejects.toThrow("2 GiB");
    expect(db.chunks()).toHaveLength(0); expect(db.sessions().get("session-a")!.bytes).toBe(2 * 1024 ** 3);
  });

  it("preserves recoverable chunks and offsets across interrupted session metadata", async () => {
    idbFixture(); const { recordingStore } = await import("./recordingStore");
    await recordingStore.create(row()); await recordingStore.checkpoint("session-a", { microphone: 0, mix: 3.5 });
    await recordingStore.append("session-a", "mix", 0, new Blob(["recoverable"]));
    expect((await recordingStore.list())[0]).toMatchObject({ status: "recording", offsets: { microphone: 0, mix: 3.5 } });
    await recordingStore.finish("session-a", "interrupted", "device ended");
    const saved = (await recordingStore.list())[0]; expect(saved).toMatchObject({ status: "interrupted", error: "device ended", bytes: 11, offsets: { microphone: 0, mix: 3.5 } });
    expect(await (await recordingStore.file(saved, "mix")).text()).toBe("recoverable");
    await expect(recordingStore.file(saved, "microphone")).rejects.toThrow("조각");
  });

  it("deletes all stems of only the selected session and retains adjacent sessions", async () => {
    const db = idbFixture(); const { recordingStore } = await import("./recordingStore");
    for (const id of ["session-a", "session-ab"]) {
      await recordingStore.create(row(id)); await recordingStore.append(id, "mix", 0, new Blob([id])); await recordingStore.append(id, "microphone", 0, new Blob([id]));
    }
    await recordingStore.remove("session-a");
    expect(db.deleted).toEqual(["session-a", { lower: ["session-a"], upper: ["session-a", []] }]);
    expect([...db.sessions().keys()]).toEqual(["session-ab"]); expect(db.chunks().map(chunk => chunk.session)).toEqual(["session-ab", "session-ab"]);
  });

  it("reopens a connection after an unexpected IndexedDB close", async () => {
    const db = idbFixture(); const { recordingStore } = await import("./recordingStore");
    await recordingStore.list(); db.connection.onclose?.(); await recordingStore.list(); expect(db.open).toHaveBeenCalledTimes(2);
  });
});
