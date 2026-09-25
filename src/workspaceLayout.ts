import { clampPanelWidth, previewWidthBounds } from "./panelWidths";

export type WorkspacePreviewMeasurement = {
  wide: boolean;
  width: number;
  height: number;
  playerChrome: number;
  auxiliaryHeight: number;
  captionChrome: number;
  aspectRatio: number;
  kind: "video" | "audio" | "empty";
  collapsed: boolean;
  manualWidth?: number | null;
};

const nonnegative = (value: number): number => Number.isFinite(value) ? Math.max(0, value) : 0;

/** Largest contained picture while preserving the caption pane's minimum size.
 * Height is only for the picture; measured playback controls and cut tools are
 * reserved separately. No media pixels are stretched or cropped.
 */
export function calculateWorkspacePreview(input: WorkspacePreviewMeasurement): { columnWidth: number; stageHeight: number } {
  const width = nonnegative(input.width), height = nonnegative(input.height);
  const aspect = Number.isFinite(input.aspectRatio) && input.aspectRatio > 0 ? input.aspectRatio : 16 / 9;
  const maxColumn = input.wide ? Math.max(0, Math.min(width * .45, width - 480 - 12)) : width;
  const minColumn = Math.min(210, maxColumn);
  const manualWidth = input.manualWidth !== null && input.manualWidth !== undefined && Number.isFinite(input.manualWidth)
    ? clampPanelWidth(input.manualWidth, previewWidthBounds(width)) : null;
  // Width comes only from horizontal space or an explicit user choice. Picture
  // height/cut wrapping must never feed back into column width during resizing.
  const columnWidth = input.wide ? manualWidth ?? (input.kind === "video" ? maxColumn : minColumn) : width;
  const compactHeight = input.kind === "empty" ? 40 : input.wide ? 48 : 32;
  if (input.collapsed || input.kind !== "video") {
    return { columnWidth: Math.round(columnWidth), stageHeight: input.collapsed ? 0 : compactHeight };
  }
  const reserved = nonnegative(input.playerChrome) + nonnegative(input.auxiliaryHeight)
    + (input.wide ? 0 : nonnegative(input.captionChrome) + 324);
  const available = Math.max(48, height - reserved);
  const maxStage = input.wide ? available : Math.min(260, available);
  return {
    columnWidth: Math.round(columnWidth),
    stageHeight: Math.floor(Math.max(0, Math.min(maxStage, columnWidth / aspect))),
  };
}
