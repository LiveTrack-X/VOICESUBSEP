export const PREVIEW_LAYOUT_KEY = "voicesubsep-preview-layout-v1";
export type PreviewLayout = { height: null; collapsed: boolean };

export function parsePreviewLayout(raw: string | null): PreviewLayout {
  const fallback = { height: null, collapsed: false };
  try {
    const value: unknown = raw ? JSON.parse(raw) : null;
    if (!value || typeof value !== "object") return fallback;
    const entry = value as Record<string, unknown>;
    if (entry.version !== 1 || typeof entry.collapsed !== "boolean") return fallback;
    // Previous versions persisted a manual height. Preserve visibility, but
    // let the workspace fit the picture to both available dimensions now.
    return { collapsed: entry.collapsed, height: null };
  } catch { return fallback; }
}

export function previewHeight(_layout: PreviewLayout, kind: "empty" | "audio" | "video"): number {
  return kind === "video" ? 144 : kind === "audio" ? 48 : 40;
}
