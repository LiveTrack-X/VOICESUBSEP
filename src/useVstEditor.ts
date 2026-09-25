import { useEffect, useRef, useState } from "react";
import { request } from "./api";
import { checkedEditor, type VstEditor, type VstInspection, type VstSlot } from "./vst";
import { vstPollFailure } from "./vst-polling";

const pending = (session: VstEditor) => session.status === "queued" || session.status === "running";
type EditorCommand = "close" | "cancel" | "focus";
type EditorOwner = { slot: VstSlot; id?: string; discard: boolean; revision: number; command?: EditorCommand };
const endpoint = (id: string) => `/api/vst/editors/${encodeURIComponent(id)}`;
const expired = "플러그인 창의 작업이 만료되었습니다. 다시 여세요.";
function editorFailure(message?: string) {
  if (message === "The plugin window did not open within 45 seconds. The editor was stopped; try opening it again.") {
    return "45초 안에 플러그인 창이 열리지 않아 종료했습니다. 다시 열어 보세요.";
  }
  if (message === "The plugin did not close in time. The editor was stopped; unsaved changes were not applied.") {
    return "플러그인 창이 제때 닫히지 않아 종료했습니다. 저장되지 않은 변경은 적용하지 않았습니다.";
  }
  return message ?? "플러그인 창을 열지 못했습니다. 매개변수로 조절할 수 있습니다.";
}
const cancelDetached = (id: string) => void request(endpoint(id), { method: "DELETE", signal: AbortSignal.timeout(10_000) }).catch(() => {});

/** A native window belongs to this mounted panel; late results cannot replace another session. */
export function useVstEditor(onApplied: (slot: VstSlot, result: VstInspection) => void) {
  const [slotId, setSlotId] = useState<string | null>(null);
  const [session, setSession] = useState<VstEditor | null>(null);
  const [busy, setBusy] = useState(false);
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState("");
  const [command, setCommand] = useState<EditorCommand | null>(null);
  const [startedAt, setStartedAt] = useState(0);
  const [now, setNow] = useState(0);
  const current = useRef<EditorOwner | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mounted = useRef(true);
  const applied = useRef(onApplied);
  applied.current = onApplied;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimeout(timer.current);
      const active = current.current;
      current.current = null;
      if (active?.id) cancelDetached(active.id);
    };
  }, []);
  const cancelling = busy && (!!current.current?.discard || !!session?.cancelRequested);
  const preparing = busy && !paused && !cancelling && !session?.closeRequested &&
    command !== "cancel" && command !== "close" && session?.stage !== "open";
  useEffect(() => {
    if (!preparing) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [preparing]);

  function owned(active: EditorOwner, revision?: number) {
    return mounted.current && current.current === active && (revision === undefined || active.revision === revision);
  }
  function schedule(active: EditorOwner, delay: number, failures = 0) {
    clearTimeout(timer.current);
    if (owned(active)) timer.current = setTimeout(() => void poll(active, failures), delay);
  }
  function receive(next: VstEditor, active: EditorOwner) {
    if (!owned(active)) return;
    // Discard is irreversible locally, even when an in-flight server response is "completed".
    setSession(active.discard && pending(next) ? { ...next, cancelRequested: true } : next);
    if (!pending(next)) {
      clearTimeout(timer.current);
      current.current = null;
      setBusy(false); setPaused(false); setCommand(null);
      if (next.status === "completed" && next.result && !active.discard) applied.current(active.slot, next.result);
      if (next.status === "failed") setError(editorFailure(next.error));
    }
  }

  async function poll(active: EditorOwner, failures = 0) {
    if (!owned(active) || !active.id || active.command) return;
    const revision = ++active.revision;
    try {
      const next = checkedEditor(await request(endpoint(active.id), { signal: AbortSignal.timeout(10_000) }), active.slot, active.id);
      if (!owned(active, revision)) return;
      setError(""); setPaused(false);
      receive(next, active);
      if (pending(next)) schedule(active, 1000);
    } catch (caught) {
      if (!owned(active, revision)) return;
      const action = vstPollFailure(caught, failures + 1);
      if (action === "missing") receive({ id: active.id, status: "failed", error: expired }, active);
      else {
        setError("플러그인 창의 상태를 확인하지 못했습니다. 연결을 확인하고 다시 시도하세요.");
        if (action === "pause") setPaused(true);
        else schedule(active, 1000, failures + 1);
      }
    }
  }

  async function open(slot: VstSlot) {
    if (current.current) return;
    let active: EditorOwner | null = null;
    const started = Date.now();
    setSlotId(slot.id); setStartedAt(started); setNow(started);
    setBusy(true); setPaused(false); setError(""); setSession(null); setCommand(null);
    try {
      active = { slot: structuredClone(slot), discard: false, revision: 0 };
      current.current = active;
      const { path, pluginName, enabled, parameters, state } = active.slot;
      const next = checkedEditor(await request("/api/vst/editors", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, pluginName, enabled, parameters, ...(state === undefined ? {} : { state }) }),
        signal: AbortSignal.timeout(30_000),
      }), slot);
      if (!owned(active)) {
        if (pending(next)) cancelDetached(next.id);
        return;
      }
      active.id = next.id;
      receive(next, active);
      if (pending(next)) schedule(active, 500);
    } catch (caught) {
      if (mounted.current && current.current === active) {
        current.current = null; setBusy(false);
        setError(caught instanceof Error && caught.message ? caught.message : "플러그인 창을 열지 못했습니다. 매개변수로 조절할 수 있습니다.");
      }
    }
  }

  async function sendCommand(action: EditorCommand) {
    const active = current.current;
    if (!active?.id || active.command) return;
    if (action === "focus" && (active.discard || session?.closeRequested || session?.cancelRequested)) return;
    if (action === "cancel") active.discard = true;
    active.command = action;
    const revision = ++active.revision;
    clearTimeout(timer.current);
    setCommand(action); setError("");
    try {
      const next = checkedEditor(await request(`${endpoint(active.id)}${action === "cancel" ? "" : `/${action}`}`, {
        method: action === "cancel" ? "DELETE" : "POST", signal: AbortSignal.timeout(10_000),
        ...(action !== "cancel" ? { headers: { "Content-Type": "application/json" }, body: "{}" } : {}),
      }), active.slot, active.id);
      if (!owned(active, revision)) return;
      setPaused(false); receive(next, active);
    } catch (caught) {
      if (owned(active, revision)) {
        // Older backends have no /focus route. Its 404 must not expire the actual editor.
        if (action !== "focus" && vstPollFailure(caught, 1) === "missing") receive({ id: active.id, status: "failed", error: expired }, active);
        else setError(action === "focus" ? "창 앞으로 가져오기를 요청하지 못했습니다. 작업 표시줄에서 플러그인 창을 확인하세요." :
          caught instanceof Error && caught.message ? caught.message : "플러그인 창의 상태를 확인하지 못했습니다. 연결을 확인하고 다시 시도하세요.");
      }
    } finally {
      if (owned(active, revision)) {
        active.command = undefined; setCommand(null);
        // Recheck after an ambiguous timeout: the server may have accepted the command.
        schedule(active, 250);
      }
    }
  }

  function finish(discard: boolean) {
    if (discard && current.current && !current.current.id) { detach(); return; }
    return sendCommand(discard ? "cancel" : "close");
  }
  function retry() {
    const active = current.current;
    if (!active?.id || active.command) return;
    clearTimeout(timer.current); setPaused(false); setError("");
    void poll(active);
  }
  function detach() {
    const active = current.current;
    if (active) active.discard = true;
    current.current = null;
    clearTimeout(timer.current);
    setBusy(false); setPaused(false); setSession(null); setCommand(null);
    if (active?.id) cancelDetached(active.id);
    setError("창 닫기를 요청하고 연결을 종료했습니다. 서버의 종료 완료는 확인되지 않았습니다.");
  }

  return { slotId, session, busy, paused, error, commandPending: command !== null, command, cancelling,
    preparing, elapsedSeconds: Math.max(0, Math.floor((now - startedAt) / 1000)),
    open, finish, focus: () => sendCommand("focus"), retry, detach };
}
