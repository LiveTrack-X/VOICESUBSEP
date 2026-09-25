/** Speaker colors are data, never arbitrary CSS. Keep the original as a marker. */
export function normalizeSpeakerColor(value: unknown): string | null {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : null;
}
const rgb = (color: string) => [1, 3, 5].map(index => parseInt(color.slice(index, index + 2), 16));
function luminance(channels: number[]): number {
  const linear = channels.map(channel => { const x = channel / 255; return x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4; });
  return linear[0] * .2126 + linear[1] * .7152 + linear[2] * .0722;
}
export function speakerColorContrast(foreground: string, background: string): number {
  const a = luminance(rgb(normalizeSpeakerColor(foreground) ?? "#000000"));
  const b = luminance(rgb(normalizeSpeakerColor(background) ?? "#ffffff"));
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
}
/** Minimal RGB blend toward black/white to make a name readable (WCAG 4.5:1).
 * This does not mutate the assigned color; use that unchanged for a marker.
 */
export function readableSpeakerColor(value: unknown, background = "#ffffff"): string {
  const color = normalizeSpeakerColor(value) ?? "#667085";
  const surface = normalizeSpeakerColor(background) ?? "#ffffff";
  if (speakerColorContrast(color, surface) >= 4.5) return color;
  const endpoint = speakerColorContrast("#000000", surface) >= speakerColorContrast("#ffffff", surface) ? 0 : 255;
  const original = rgb(color);
  const blend = (amount: number) => "#" + original.map(channel => Math.round(channel + (endpoint - channel) * amount).toString(16).padStart(2, "0")).join("");
  let low = 0, high = 1;
  for (let i = 0; i < 16; i++) {
    const midpoint = (low + high) / 2;
    if (speakerColorContrast(blend(midpoint), surface) >= 4.5) high = midpoint; else low = midpoint;
  }
  return blend(high);
}
