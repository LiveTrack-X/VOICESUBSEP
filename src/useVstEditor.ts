import { useEffect, useRef, useState } from "react";
import { request } from "./api";
import { checkedEditor, type VstEditor, type VstInspection, type VstSlot } from "./vst";
import { vstPollFailure } from "./vst-polling";

const pending = (session: VstEditor) => session.status === "queued" || session.status === "running";
type EditorOwner = { generation: number; slot: VstSlot; id?: string; discard: boolean };
const endpoint = (id: string) => `/api/vst/editors/${encodeURIComponent(id)}`;

/** A native window belongs to this mounted panel; late results cannot replace another session. */
export function useVstEditor(onApplied: (slot: VstSlot, result: VstInspection) => void) {
  const [slotId, setSlotId] = useState<string | null>(null);
  const [session, setSession] = useState<VstEditor | null>(null);
  const [busy, setBusy] = useState(false);
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState("");
  const [commandPending, setCommandPending] = useState(false);
  const current = useRef<EditorOwner | null>(null);
  const generation = useRef(0);
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
      if (active?.id) void request(endpoint(active.id), { method: "DELETE", signal: AbortSignal.timeout(10_000) }).catch(() => {});
    };
  }, []);

  function receive(next: VstEditor, active: NonNullable<typeof current.current>) {
    if (!mounted.current || current.current !== active) return;
    setSession(next);
    if (!pending(next)) {
      clearTimeout(timer.current);
      current.current = null;
      setBusy(false); setPaused(false); setCommandPending(false);
      if (next.status === "completed" && next.result && !active.discard) applied.current(active.slot, next.result);
      if (next.status === "failed") setError(next.error ?? "플러그인 창을 열지 못했습니다. 매개변수로 조절할 수 있습니다.");
    }
  }

  async function poll(active: NonNullable<typeof current.current>, failures = 0) {
    if (!mounted.current || current.current !== active || !active.id) return;
    try {
      const next = checkedEditor(await request(endpoint(active.id), { signal: AbortSignal.timeout(10_000) }), active.slot, active.id);
      if (!mounted.current || current.current !== active) return;
      setError(""); setPaused(false);
      receive(next, active);
      if (pending(next)) timer.current = setTimeout(() => void poll(active), 1000);
    } catch (caught) {
      if (!mounted.current || current.current !== active) return;
      const action = vstPollFailure(caught, failures + 1);
      if (action === "missing") {
        receive({ id: active.id, status: "failed", error: "플러그인 창의 작업이 만료되었습니다. 다시 여세요." }, active);
      } else {
        setError("플러그인 창의 상태를 확인하지 못했습니다. 연결을 확인하고 다시 시도하세요.");
        if (action === "pause") setPaused(true);
        else timer.current = setTimeout(() => void poll(active, failures + 1), 1000);
      }
    }
  }

  async function open(slot: VstSlot) {
    if (current.current) return;
    let active: EditorOwner | null = null;
    setSlotId(slot.id);
    setBusy(true); setPaused(false); setError(""); setSession(null); setCommandPending(false);
    try {
      active = { generation: ++generation.current, slot: structuredClone(slot), discard: false, id: undefined };
      current.current = active;
      const { path, pluginName, enabled, parameters, state } = active.slot;
      const next = checkedEditor(await request("/api/vst/editors", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, pluginName, enabled, parameters, ...(state === undefined ? {} : { state }) }),
        signal: AbortSignal.timeout(30_000),
      }), slot);
      if (!mounted.current || current.current !== active) {
        if (pending(next)) void request(endpoint(next.id), { method: "DELETE", signal: AbortSignal.timeout(10_000) }).catch(() => {});
        return;
      }
      active.id = next.id;
      receive(next, active);
      if (pending(next)) { const accepted = active; timer.current = setTimeout(() => void poll(accepted), 500); }
    } catch (caught) {
      if (mounted.current && current.current === active) {
        current.current = null; setBusy(false); setError(caught instanceof Error && caught.message ? caught.message : "플러그인 창을 열지 못했습니다. 매개변수로 조절할 수 있습니다.");
      }
    }
  }

  async function finish(discard: boolean) {
    const active = current.current;
    if (!active?.id || commandPending) return;
    // Cancellation wins even if the plugin closes while the DELETE response is in flight.
    if (discard) active.discard = true;
    setCommandPending(true); setError("");
    try {
      const next = checkedEditor(await request(`${endpoint(active.id)}${discard ? "" : "/close"}`, {
        method: discard ? "DELETE" : "POST", signal: AbortSignal.timeout(10_000),
        ...(!discard ? { headers: { "Content-Type": "application/json" }, body: "{}" } : {}),
      }), active.slot, active.id);
      if (current.current !== active || !mounted.current) return;
      receive(next, active);
      if (pending(next)) { clearTimeout(timer.current); setPaused(false); timer.current = setTimeout(() => void poll(active), 250); }
    } catch (caught) {
      if (mounted.current && current.current === active) {
        if (vstPollFailure(caught, 1) === "missing") receive({ id: active.id, status: "failed", error: "플러그인 창의 작업이 만료되었습니다. 다시 여세요." }, active);
        else setError((caught as Error).message);
      }
    } finally { if (mounted.current && current.current === active) setCommandPending(false); }
  }

  function retry() {
    const active = current.current;
    if (!active?.id) return;
    clearTimeout(timer.current); setPaused(false); setError("");
    void poll(active);
  }

  function detach() {
    const active = current.current;
    current.current = null;
    clearTimeout(timer.current);
    setBusy(false); setPaused(false); setSession(null); setCommandPending(false);
    if (active?.id) void request(endpoint(active.id), { method: "DELETE", signal: AbortSignal.timeout(10_000) }).catch(() => {});
    setError("창 닫기를 요청하고 연결을 종료했습니다. 서버의 종료 완료는 확인되지 않았습니다.");
  }

  return { slotId, session, busy, paused, error, commandPending, open, finish, retry, detach };
}
