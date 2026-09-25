export type ResizablePanel = "sidebar" | "preview";
export type WidthBounds = { min: number; max: number };
export const PANEL_WIDTH_KEYS: Record<ResizablePanel, string> = {
  sidebar: "voicesubsep-sidebar-width-v1",
  preview: "voicesubsep-preview-width-v1",
};
type WidthStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Read only user choices. Viewport clamping must never overwrite them. */
export function readPanelWidth(panel: ResizablePanel, storage?: WidthStorage): number | null {
  try {
    const raw = (storage ?? localStorage).getItem(PANEL_WIDTH_KEYS[panel]);
    const value: unknown = raw === null ? null : JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    const entry = value as Record<string, unknown>;
    return entry.version === 1 && typeof entry.width === "number" && Number.isFinite(entry.width)
      && entry.width >= 1 && entry.width <= 4000 ? Math.round(entry.width) : null;
  } catch { return null; }
}

export function savePanelWidth(panel: ResizablePanel, width: number | null, storage?: WidthStorage): boolean {
  try {
    const target = storage ?? localStorage;
    if (width === null) target.removeItem(PANEL_WIDTH_KEYS[panel]);
    else {
      if (!Number.isFinite(width) || width < 1 || width > 4000) return false;
      target.setItem(PANEL_WIDTH_KEYS[panel], JSON.stringify({ version: 1, width: Math.round(width) }));
    }
    return true;
  } catch { return false; }
}

export function clampPanelWidth(width: number, bounds: WidthBounds): number {
  return Math.round(Math.max(bounds.min, Math.min(bounds.max, Number.isFinite(width) ? width : bounds.min)));
}

export function sidebarWidthBounds(containerWidth: number): WidthBounds {
  const width = Number.isFinite(containerWidth) ? Math.max(0, containerWidth) : 0;
  // Reserve the editor (including its padding, 210px preview and 480px captions)
  // before allowing the settings column to grow. Below 1200px the editor stacks.
  const max = Math.floor(Math.max(0, Math.min(420, width - (width >= 1200 ? 760 : 560) - 6)));
  return { min: Math.min(200, max), max };
}

export function defaultSidebarWidth(viewportWidth: number): number {
  return viewportWidth >= 1600 ? 260 : viewportWidth <= 1250 ? 215 : 244;
}

export function previewWidthBounds(contentWidth: number): WidthBounds {
  const width = Number.isFinite(contentWidth) ? Math.max(0, contentWidth) : 0;
  const max = Math.floor(Math.max(0, Math.min(960, width - 480 - 12)));
  return { min: Math.min(210, max), max };
}

export function keyboardPanelWidth(key: string, width: number, bounds: WidthBounds, shift = false): number | null {
  const step = shift ? 40 : 10;
  return key === "ArrowLeft" ? clampPanelWidth(width - step, bounds)
    : key === "ArrowRight" ? clampPanelWidth(width + step, bounds)
      : key === "Home" ? bounds.min : key === "End" ? bounds.max : null;
}
