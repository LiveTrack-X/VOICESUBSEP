export type CaptionRowMeasurement = { height: number; context: string };
export type CaptionScrollAnchor = { id: string; inside: number } | null;

/** A stable-ID height index. Unknown rows use an estimate until measured; the
 * viewport lookup is logarithmic and does not scan 20,000 captions on scroll. */
export class CaptionVirtualLayout {
  readonly offsets: number[] = [0];
  readonly indexById: Map<string, number>;
  constructor(readonly ids: readonly string[], measurements: ReadonlyMap<string, CaptionRowMeasurement>, context: string, estimate = 60) {
    this.indexById = new Map(ids.map((id, index) => [id, index]));
    for (const id of ids) {
      const measured = measurements.get(id);
      const height = measured?.context === context && Number.isFinite(measured.height) && measured.height >= 16 ? measured.height : estimate;
      this.offsets.push(this.offsets[this.offsets.length - 1]! + height);
    }
  }
  get total() { return this.offsets[this.ids.length]!; }
  height(index: number) { return (this.offsets[index + 1] ?? this.total) - (this.offsets[index] ?? this.total); }
  indexAt(offset: number): number {
    if (!this.ids.length) return -1;
    let low = 0, high = this.ids.length;
    const target = Math.max(0, Number.isFinite(offset) ? offset : 0);
    while (low < high) {
      const middle = Math.floor((low + high + 1) / 2);
      if (this.offsets[middle]! <= target) low = middle; else high = middle - 1;
    }
    return Math.min(low, this.ids.length - 1);
  }
  range(scrollTop: number, viewportHeight: number, overscan = 360): { start: number; end: number } {
    if (!this.ids.length) return {start:0,end:0};
    const height = Math.max(1, viewportHeight);
    const top = Math.max(0, Math.min(scrollTop, Math.max(0, this.total - height)));
    return {start:this.indexAt(Math.max(0,top-overscan)),end:Math.min(this.ids.length,this.indexAt(top+height+overscan)+1)};
  }
  anchor(scrollTop: number): CaptionScrollAnchor {
    const index=this.indexAt(scrollTop);
    return index<0?null:{id:this.ids[index]!,inside:Math.max(0,scrollTop-this.offsets[index]!)};
  }
  anchoredTop(anchor: CaptionScrollAnchor, fallback: number, viewportHeight: number): number {
    const index=anchor?this.indexById.get(anchor.id):undefined;
    const desired=index===undefined?fallback:this.offsets[index]!+Math.min(anchor!.inside,Math.max(0,this.height(index)-1));
    return Math.max(0,Math.min(desired,Math.max(0,this.total-viewportHeight)));
  }
  centeredTop(index: number, viewportHeight: number): number {
    const desired=(this.offsets[index]??0)-Math.max(0,(viewportHeight-this.height(index))/2);
    return Math.max(0,Math.min(desired,Math.max(0,this.total-viewportHeight)));
  }
}

/** Keep an edited row mounted even after a long wheel/scrollbar jump. Adjacent
 * rows preserve ordinary Tab/Shift+Tab continuity at the virtual boundary. */
export function captionRenderIndexes(layout: CaptionVirtualLayout, range: {start:number;end:number}, focusedId: string|null): number[] {
  const indexes=new Set<number>();
  for(let index=range.start;index<range.end;index++)indexes.add(index);
  const focused=focusedId?layout.indexById.get(focusedId):undefined;
  if(focused!==undefined)for(let index=Math.max(0,focused-1);index<=Math.min(layout.ids.length-1,focused+1);index++)indexes.add(index);
  return [...indexes].sort((a,b)=>a-b);
}
