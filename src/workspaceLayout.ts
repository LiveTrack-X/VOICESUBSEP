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
  manualHeight?: number | null;
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
  const manual = input.manualHeight !== null && input.manualHeight !== undefined && Number.isFinite(input.manualHeight)
    ? Math.max(48, Math.min(360, input.manualHeight)) : null;
  const compactHeight = input.kind === "empty" ? 40 : input.wide ? 48 : 32;
  if (input.collapsed || input.kind !== "video") {
    return { columnWidth: input.wide ? minColumn : width, stageHeight: input.collapsed ? 0 : manual ?? compactHeight };
  }
  const reserved = nonnegative(input.playerChrome) + nonnegative(input.auxiliaryHeight)
    + (input.wide ? 0 : nonnegative(input.captionChrome) + 324);
  const available = Math.max(48, height - reserved);
  const maxStage = input.wide ? available : Math.min(260, available);
  const targetHeight = manual ?? maxStage;
  const columnWidth = input.wide ? Math.min(maxColumn, Math.max(minColumn, targetHeight * aspect)) : width;
  return {
    columnWidth: Math.round(columnWidth),
    stageHeight: Math.round(manual ?? Math.max(0, Math.min(maxStage, columnWidth / aspect))),
  };
}
