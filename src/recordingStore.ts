export type RecordingSource = "mix" | "microphone" | "system";
export type Recording = {
  id: string; startedAt: string; stoppedAt?: string; mime: string;
  sources: RecordingSource[]; offsets: Partial<Record<RecordingSource, number>>;
  status: "recording" | "stopped" | "interrupted"; bytes: number; error?: string;
};
type Chunk = { session: string; source: RecordingSource; sequence: number; data: Blob };
let database: Promise<IDBDatabase> | undefined;
function open(): Promise<IDBDatabase> {
  if (!database) database = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("voicesubsep-recordings-v1", 1);
    let rejected = false;
    request.onupgradeneeded = () => {
      request.result.createObjectStore("sessions", { keyPath: "id" });
      request.result.createObjectStore("chunks", { keyPath: ["session", "source", "sequence"] });
    };
    request.onerror = () => { rejected = true; reject(request.error); };
    request.onblocked = () => { rejected = true; reject(new Error("다른 창에서 녹음 저장소를 사용 중입니다. 해당 창을 닫고 다시 시도하세요.")); };
    request.onsuccess = () => {
      if (rejected) { request.result.close(); return; }
      request.result.onversionchange = () => { request.result.close(); database = undefined; };
      request.result.onclose = () => { database = undefined; };
      resolve(request.result);
    };
  }).catch(error => { database = undefined; throw error; });
  return database;
}
function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
}
function complete(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(tx.error ?? new Error("녹음 저장에 실패했습니다. 저장 공간과 2 GiB 세션 한도를 확인하세요.")); });
}
const range = (id: string, source?: RecordingSource) => source
  ? IDBKeyRange.bound([id, source, 0], [id, source, Number.MAX_SAFE_INTEGER])
  : IDBKeyRange.bound([id], [id, []]);
export const recordingStore = {
  async create(recording: Recording) {
    const db = await open(); const tx = db.transaction("sessions", "readwrite"); const done = complete(tx);
    tx.objectStore("sessions").add(recording); await done;
  },
  async append(id: string, source: RecordingSource, sequence: number, data: Blob) {
    const db = await open(); const tx = db.transaction(["sessions", "chunks"], "readwrite"); const done = complete(tx);
    const sessions = tx.objectStore("sessions"); const get = sessions.get(id);
    get.onsuccess = () => {
      const session = get.result as Recording | undefined;
      if (!session || session.bytes + data.size > 2 * 1024 ** 3) { tx.abort(); return; }
      tx.objectStore("chunks").add({ session: id, source, sequence, data } satisfies Chunk);
      sessions.put({ ...session, bytes: session.bytes + data.size });
    };
    await done;
  },
  async finish(id: string, status: Recording["status"], error?: string, offsets?: Recording["offsets"]) {
    const db = await open(); const tx = db.transaction("sessions", "readwrite"); const done = complete(tx);
    const sessions = tx.objectStore("sessions"); const get = sessions.get(id);
    get.onsuccess = () => { if (get.result) sessions.put({ ...get.result, status, error, offsets: offsets ?? get.result.offsets, stoppedAt: new Date().toISOString() }); };
    await done;
  },
  async checkpoint(id: string, offsets: Recording["offsets"]) {
    const db = await open(); const tx = db.transaction("sessions", "readwrite"); const done = complete(tx);
    const sessions = tx.objectStore("sessions"); const get = sessions.get(id);
    get.onsuccess = () => { if (get.result) sessions.put({ ...get.result, offsets }); };
    await done;
  },
  async list(): Promise<Recording[]> {
    const db = await open();
    const rows = await result(db.transaction("sessions").objectStore("sessions").getAll()) as Recording[];
    return rows.sort((a,b) => b.startedAt.localeCompare(a.startedAt));
  },
  async file(recording: Recording, source: RecordingSource): Promise<File> {
    const db = await open(); const tx = db.transaction("chunks");
    const chunks = await result(tx.objectStore("chunks").getAll(range(recording.id, source))) as Chunk[];
    if (!chunks.length) throw new Error("저장된 오디오 조각이 없습니다.");
    const extension = recording.mime.includes("ogg") ? "ogg" : "webm";
    return new File(chunks.map(c => c.data), `recording-${recording.startedAt.replace(/[:.]/g,"-")}-${source}.${extension}`, { type: recording.mime });
  },
  async remove(id: string) {
    const db = await open(); const tx = db.transaction(["sessions", "chunks"], "readwrite"); const done = complete(tx);
    tx.objectStore("sessions").delete(id); tx.objectStore("chunks").delete(range(id)); await done;
  },
};
export type RecordingStore = typeof recordingStore;

export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob); const link = document.createElement("a");
  link.href = url; link.download = filename.replace(/[<>:"/\\|?*\x00-\x1f]/g,"_");
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
