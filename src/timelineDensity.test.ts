import { describe, expect, it } from 'vitest';
import { densityCaptionRect, densityTile, focusDensityTrack } from './timelineDensity';

describe('dense timeline viewport raster', () => {
  it.each([1,1.25,1.5,2,3])('keeps native backing resolution at DPR %s for an 8× timeline', dpr => {
    const tile = densityTile(16000,0,1920,dpr);
    expect(tile.width / tile.cssWidth).toBe(dpr);
    expect(tile.height / tile.cssHeight).toBe(dpr);
    expect(tile.cssWidth).toBeLessThanOrEqual(1920+192+1);
    expect(tile.width*tile.height*4).toBeLessThan(2_000_000);
    expect(tile.cssWidth).toBeLessThan(16000/2);
  });
  it('scrolls the tile without squeezing distant times into the visible viewport', () => {
    const tile=densityTile(16000,8000,9920,2);
    expect(tile.left).toBe(7904);expect(tile.width).toBe((1920+192)*2);
    expect(densityCaptionRect(100,101,3600,tile)).toBeNull();
    const middle=densityCaptionRect(1800,1801,3600,tile)!;
    expect(middle.x).toBe(192);expect(middle.width).toBe(9);
    expect(densityCaptionRect(3500,3501,3600,tile)).toBeNull();
  });
  it('clips a long cue spanning the visible interval without discarding it', () => {
    const tile=densityTile(16000,8000,9920,1.25);
    const rect=densityCaptionRect(0,3600,3600,tile)!;
    expect(rect.x).toBe(0);expect(rect.width).toBe(tile.width);
  });
  it('keeps a short cue at least 2 CSS pixels rather than scaling a global minimum width', () => {
    for(const zoom of [1,8]){
      const tile=densityTile(2000*zoom,0,1920,2);
      expect(densityCaptionRect(1,1.001,3600,tile)!.width).toBeGreaterThanOrEqual(4);
      expect(densityCaptionRect(1,1.001,3600,tile)!.width).toBeLessThanOrEqual(5);
    }
  });
  it('snaps every rectangle edge to physical pixels without changing cue times', () => {
    const cue={start:1432.017,end:1433.637};const saved={...cue};
    const tile=densityTile(15291.4,6000.3,7600.7,1.25);
    const rect=densityCaptionRect(cue.start,cue.end,3600,tile)!;
    for(const value of Object.values(rect))expect(Number.isInteger(value)).toBe(true);
    expect(cue).toEqual(saved);
  });
  it('bounds a resize/end-of-track tile and handles hidden or invalid geometry safely', () => {
    const end=densityTile(16000,15700,17000,1.25);
    expect(end.left+end.cssWidth).toBeLessThanOrEqual(16001);
    expect(densityTile(16000,500,800,2).width).toBeLessThan(densityTile(16000,500,2400,2).width);
    expect(densityTile(0,0,0,2).width).toBe(1);
    expect(densityTile(NaN,NaN,Infinity,NaN).width).toBe(1);
    expect(densityCaptionRect(2,1,3600,end)).toBeNull();
  });
});

describe('dense track mouse focus preserves the scrolled timeline coordinates', () => {
  it.each([0,2])('does not let browser focus move scrollLeft before mouse button %s resolves time', button => {
    let scrollLeft=6144, prevented=false;
    const currentTarget={focus:(options?:FocusOptions)=>{if(!options?.preventScroll)scrollLeft=0;}} as HTMLElement;
    focusDensityTrack({target:currentTarget,currentTarget,pointerType:'mouse',button,preventDefault:()=>{prevented=true;}},true);
    if(!prevented)currentTarget.focus(); // Default browser focus before click.
    expect(scrollLeft).toBe(6144);expect(prevented).toBe(true);
  });
  it('leaves child controls, sparse rows and touch dragging native behavior untouched', () => {
    const currentTarget={focus:()=>{throw new Error('must not take focus');}} as unknown as HTMLElement;
    const event={target:currentTarget,currentTarget,pointerType:'mouse',button:0,preventDefault:()=>{throw new Error('must not suppress gesture');}};
    focusDensityTrack({...event,target:{} as EventTarget},true);
    focusDensityTrack({...event,pointerType:'touch'},true);
    focusDensityTrack({...event,button:1},true);
    focusDensityTrack(event,false);
  });
});
