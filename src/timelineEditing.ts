import { MAX_TIME_SECONDS, type Caption } from "./domain";
export function resizeCaption(caption: Caption, edge: "start" | "end", position: number, mediaDuration: number): Caption {
  if (!Number.isFinite(position)) return caption;
  const limit = Math.min(MAX_TIME_SECONDS, mediaDuration > 0 ? Math.max(mediaDuration, caption.end) : MAX_TIME_SECONDS);
  const value = Math.round(position * 100) / 100;
  const next = { ...caption, [edge]: edge === "start" ? Math.max(0, Math.min(caption.end - 0.01, value)) : Math.min(limit, Math.max(caption.start + 0.01, value)) };
  if (next.start === caption.start && next.end === caption.end) return caption;
  const { words: _words, ...withoutWords } = next;
  return { ...withoutWords, reviewed: false, reasons: caption.reasons.includes("timing") ? caption.reasons : [...caption.reasons, "timing"] };
}
export function waveformPath(values: readonly number[], secondsPerPoint: number, duration: number): string {
  if (!(duration > 0) || !(secondsPerPoint > 0)) return "";
  return values.slice(0,4000).map((v,index)=>{
    const x=index*secondsPerPoint/duration*1000, height=Math.max(0,Math.min(1,Number.isFinite(v)?v:0))*15;
    return x>1000?"":`M${x.toFixed(2)},${(16-height).toFixed(2)}V${(16+height).toFixed(2)}`;
  }).join("");
}
