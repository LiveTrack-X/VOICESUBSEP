export const NOTES_HEIGHT_KEY = "voicesubsep-notes-height-v1";

export function noteHeightBounds(availableHeight: number, empty: boolean) {
  const min = empty ? 100 : 180;
  const available = Number.isFinite(availableHeight) ? availableHeight : 600;
  return { min, max: Math.max(min, Math.min(900, available - 220)) };
}

export function clampNoteHeight(value: number, bounds: { min: number; max: number }) {
  return Math.round(Math.min(bounds.max, Math.max(bounds.min, Number.isFinite(value) ? value : 300)));
}

export function readNoteHeight(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 100 && number <= 4096 ? number : null;
}
