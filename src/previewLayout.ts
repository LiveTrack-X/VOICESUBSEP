export const PREVIEW_LAYOUT_KEY = "voicesubsep-preview-layout-v1";
export type PreviewLayout = { height: number | null; collapsed: boolean };

export function parsePreviewLayout(raw: string | null): PreviewLayout {
  const fallback = { height: null, collapsed: false };
  try {
    const value: unknown = raw ? JSON.parse(raw) : null;
    if (!value || typeof value !== "object") return fallback;
    const entry = value as Record<string, unknown>;
    if (entry.version !== 1 || typeof entry.collapsed !== "boolean") return fallback;
    if (entry.height !== null && (typeof entry.height !== "number" || !Number.isFinite(entry.height))) return fallback;
    return { collapsed: entry.collapsed, height: entry.height === null ? null : Math.round(Math.max(48, Math.min(360, entry.height as number))) };
  } catch { return fallback; }
}

export function previewHeight(layout: PreviewLayout, kind: "empty" | "audio" | "video"): number {
  return layout.height ?? (kind === "video" ? 144 : kind === "audio" ? 48 : 40);
}
