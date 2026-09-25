import { useState } from "react";
import { readPanelWidth, savePanelWidth, type ResizablePanel } from "./panelWidths";

export function usePanelWidth(panel: ResizablePanel) {
  const [preferred, setPreferred] = useState(() => readPanelWidth(panel));
  const [draft, setDraft] = useState<number | null>(null);
  const commit = (width: number | null) => {
    setDraft(null); setPreferred(width); savePanelWidth(panel, width);
  };
  return { width: draft ?? preferred, change: setDraft, commit, cancel: () => setDraft(null), reset: () => commit(null) };
}
