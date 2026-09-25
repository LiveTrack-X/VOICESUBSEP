export type CaptionColumn = "time" | "speaker";
export type CaptionColumnPreferences = Record<CaptionColumn, number | null>;
export const CAPTION_COLUMNS_KEY = "voicesubsep-caption-columns-v1";
export const DEFAULT_CAPTION_COLUMNS: Readonly<CaptionColumnPreferences> = { time: null, speaker: null };
const DEFAULT_WIDTHS = { time: 106, speaker: 98 };
const MIN_WIDTHS = { time: 88, speaker: 64 };
const MAX_WIDTHS = { time: 420, speaker: 380 };
type StorageAccess = Pick<Storage, "getItem" | "setItem">;

function validWidth(value: unknown, column: CaptionColumn): value is number | null {
  return value === null || typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_WIDTHS[column];
}

export function parseCaptionColumns(raw: string | null): CaptionColumnPreferences {
  try {
    if (!raw || raw.length > 1024) return { ...DEFAULT_CAPTION_COLUMNS };
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return { ...DEFAULT_CAPTION_COLUMNS };
    const data = value as Record<string, unknown>;
    if (data.version !== 1 || !validWidth(data.time, "time") || !validWidth(data.speaker, "speaker")) return { ...DEFAULT_CAPTION_COLUMNS };
    return { time: data.time, speaker: data.speaker };
  } catch { return { ...DEFAULT_CAPTION_COLUMNS }; }
}

export function loadCaptionColumns(storage?: StorageAccess): CaptionColumnPreferences {
  try { return parseCaptionColumns((storage ?? localStorage).getItem(CAPTION_COLUMNS_KEY)); }
  catch { return { ...DEFAULT_CAPTION_COLUMNS }; }
}

export function saveCaptionColumns(value: CaptionColumnPreferences, storage?: StorageAccess): boolean {
  if (!validWidth(value.time, "time") || !validWidth(value.speaker, "speaker")) return false;
  try { (storage ?? localStorage).setItem(CAPTION_COLUMNS_KEY, JSON.stringify({ version: 1, ...value })); return true; }
  catch { return false; }
}

/** Viewport clamps are temporary: never write them over the user's wide layout. */
export function resolveCaptionColumns(preferences: CaptionColumnPreferences, viewportWidth: number) {
  const width = Number.isFinite(viewportWidth) && viewportWidth > 0 ? Math.floor(viewportWidth) : 600;
  const narrow = width < 480;
  const padding = narrow ? 8 : 16;
  const gap = narrow ? 6 : 12;
  const review = narrow ? 30 : 43;
  const available = Math.max(0, width - padding * 2 - gap * 3 - review);
  const textMinimum = Math.min(120, Math.floor(available * .45));
  const pairBudget = available - textMinimum;
  const scale = Math.min(1, pairBudget / (MIN_WIDTHS.time + MIN_WIDTHS.speaker));
  const minimum = { time: Math.floor(MIN_WIDTHS.time * scale), speaker: Math.floor(MIN_WIDTHS.speaker * scale) };
  let time = Math.max(minimum.time, Math.min(MAX_WIDTHS.time, preferences.time ?? DEFAULT_WIDTHS.time));
  let speaker = Math.max(minimum.speaker, Math.min(MAX_WIDTHS.speaker, preferences.speaker ?? DEFAULT_WIDTHS.speaker));
  if (time + speaker > pairBudget) {
    const spare = Math.max(0, pairBudget - minimum.time - minimum.speaker);
    const requested = time + speaker - minimum.time - minimum.speaker;
    time = minimum.time + Math.floor(spare * (time - minimum.time) / requested);
    speaker = minimum.speaker + spare - (time - minimum.time);
  }
  return { width, time, speaker, text: available - time - speaker, textMinimum, review, padding, gap, minimum, pairBudget };
}

export type CaptionColumnLayout = ReturnType<typeof resolveCaptionColumns>;
export function captionColumnBounds(layout: CaptionColumnLayout, column: CaptionColumn) {
  const other = column === "time" ? "speaker" : "time";
  return { min: layout.minimum[column], max: Math.max(layout.minimum[column], Math.min(MAX_WIDTHS[column], layout.pairBudget - layout[other])) };
}
export function clampCaptionColumn(value: number, bounds: { min: number; max: number }): number {
  return Math.round(Math.max(bounds.min, Math.min(bounds.max, Number.isFinite(value) ? value : bounds.min)));
}
export function keyboardCaptionColumn(key: string, value: number, bounds: { min: number; max: number }, fine = false): number | null {
  const step = fine ? 1 : 8;
  if (key === "Home") return bounds.min;
  if (key === "End") return bounds.max;
  if (key === "ArrowLeft") return clampCaptionColumn(value - step, bounds);
  if (key === "ArrowRight") return clampCaptionColumn(value + step, bounds);
  return null;
}
