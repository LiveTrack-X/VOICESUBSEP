import { useEffect, useRef, useState } from "react";
import { dispatchShortcut, loadShortcuts, saveShortcuts, SHORTCUT_CHANGE_EVENT, SHORTCUT_STORAGE_KEY, type ShortcutAction, type ShortcutBindings } from "./shortcuts";

export function useShortcuts(onAction: (action: ShortcutAction) => boolean, blocked: boolean) {
  const [loaded, setLoaded] = useState(loadShortcuts);
  const current = useRef({ onAction, blocked, bindings: loaded.bindings });
  current.current = { onAction, blocked, bindings: loaded.bindings };
  useEffect(() => {
    const refresh = () => setLoaded(loadShortcuts());
    const storage = (event: StorageEvent) => { if (event.key === SHORTCUT_STORAGE_KEY || event.key === null) refresh(); };
    const keydown = (event: KeyboardEvent) => {
      const state = current.current;
      dispatchShortcut(event, state.bindings, state.onAction, state.blocked);
    };
    window.addEventListener(SHORTCUT_CHANGE_EVENT, refresh);
    window.addEventListener("storage", storage);
    window.addEventListener("keydown", keydown);
    return () => {
      window.removeEventListener(SHORTCUT_CHANGE_EVENT, refresh);
      window.removeEventListener("storage", storage);
      window.removeEventListener("keydown", keydown);
    };
  }, []);
  return { ...loaded, save(bindings: ShortcutBindings) { return saveShortcuts(bindings); } };
}
