import { useCallback, useLayoutEffect, useMemo, useRef, useState, type FocusEvent } from "react";
import { CaptionVirtualLayout, captionRenderIndexes, type CaptionRowMeasurement } from "./captionVirtualList";

export function useCaptionVirtualList(ids: readonly string[], identity: string, density: "compact"|"comfortable", focusedId: string|null, setFocusedId: (id:string|null)=>void) {
  const listRef=useRef<HTMLDivElement>(null);
  const rows=useRef(new Map<string,HTMLDivElement>());
  const rowCallbacks=useRef(new Map<string,(row:HTMLDivElement|null)=>void>());
  const measurements=useRef(new Map<string,CaptionRowMeasurement>());
  const [revision,setRevision]=useState(0);
  const [view,setView]=useState({top:0,height:324,width:0});
  const [resetRevision,setResetRevision]=useState(0);
  const resetPending=useRef(false);
  const previous=useRef<{identity:string;layout:CaptionVirtualLayout}|null>(null);
  const context=`${identity}:${density}:${view.width}`;
  const layout=useMemo(()=>new CaptionVirtualLayout(ids,measurements.current,context,density==="compact"?60:96),[ids,context,density,revision]);
  const range=layout.range(view.top,view.height);
  const indexes=captionRenderIndexes(layout,range,focusedId);
  const current=useRef({context,layout});current.current={context,layout};
  const observer=useRef<ResizeObserver|null>(null);
  const readViewport=useCallback(()=>{
    const list=listRef.current;if(!list)return;
    const next={top:list.scrollTop,height:list.clientHeight||324,width:list.clientWidth};
    setView(prior=>prior.top===next.top&&prior.height===next.height&&prior.width===next.width?prior:next);
  },[]);
  useLayoutEffect(()=>{
    const list=listRef.current;if(!list)return;
    let frame=0;
    const changed=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(readViewport);};
    list.addEventListener("scroll",changed,{passive:true});
    const resize=typeof ResizeObserver!=="undefined"?new ResizeObserver(readViewport):null;
    resize?.observe(list);readViewport();
    return()=>{cancelAnimationFrame(frame);list.removeEventListener("scroll",changed);resize?.disconnect();};
  },[readViewport]);
  useLayoutEffect(()=>{
    const list=listRef.current;if(!list)return;
    const before=previous.current;
    if(resetPending.current||before&&before.identity!==identity){list.scrollTop=0;resetPending.current=false;setFocusedId(null);}
    else if(before&&before.layout!==layout){list.scrollTop=layout.anchoredTop(before.layout.anchor(list.scrollTop),list.scrollTop,list.clientHeight);}
    previous.current={identity,layout};readViewport();
  },[layout,identity,readViewport,resetRevision,setFocusedId]);
  useLayoutEffect(()=>{
    // One observer for mounted rows. Width/density changes invalidate estimates
    // by context; stable IDs keep heights and drafts attached to the right cue.
    const measure=()=>{
      let changed=false;const active=current.current;
      for(const [id,row] of rows.current){
        if(!active.layout.indexById.has(id))continue;
        const height=row.getBoundingClientRect().height;
        if(height<16)continue;
        const prior=measurements.current.get(id);
        if(prior?.context!==active.context||Math.abs(prior.height-height)>.5){measurements.current.set(id,{height,context:active.context});changed=true;}
      }
      if(changed)setRevision(value=>value+1);
    };
    observer.current=typeof ResizeObserver!=="undefined"?new ResizeObserver(measure):null;
    for(const row of rows.current.values())observer.current?.observe(row);
    measure();
    return()=>{observer.current?.disconnect();observer.current=null;};
  },[context]);
  useLayoutEffect(()=>{
    // Measure newly mounted rows before paint; RO also catches textarea resizing.
    let changed=false;
    for(const [id,row] of rows.current){
      const height=row.getBoundingClientRect().height;
      const prior=measurements.current.get(id);
      if(height>=16&&(prior?.context!==context||Math.abs(prior.height-height)>.5)){measurements.current.set(id,{height,context});changed=true;}
    }
    if(changed)setRevision(value=>value+1);
  });
  useLayoutEffect(()=>{
    // Filter changes may remove IDs. Do not retain detached DOM callbacks forever.
    const present=new Set(ids);
    for(const id of rowCallbacks.current.keys())if(!present.has(id))rowCallbacks.current.delete(id);
    for(const id of measurements.current.keys())if(!present.has(id))measurements.current.delete(id);
  },[ids]);
  const rowRef=useCallback((id:string)=>{
    let callback=rowCallbacks.current.get(id);
    if(!callback){callback=row=>{
      const old=rows.current.get(id);if(old)observer.current?.unobserve(old);
      if(row){rows.current.set(id,row);observer.current?.observe(row);}else rows.current.delete(id);
    };rowCallbacks.current.set(id,callback);}
    return callback;
  },[]);
  const reset=()=>{resetPending.current=true;setResetRevision(value=>value+1);if(listRef.current)listRef.current.scrollTop=0;setView(prior=>({...prior,top:0}));};
  const revealIndex=(index:number)=>{
    const list=listRef.current;if(!list)return;
    list.scrollTop=current.current.layout.centeredTop(index,list.clientHeight);readViewport();
  };
  const focus=(event:FocusEvent<HTMLDivElement>)=>{
    const row=(event.target as HTMLElement).closest<HTMLElement>("[data-caption-id]");
    if(row)setFocusedId(row.dataset.captionId??null);
  };
  const blur=(event:FocusEvent<HTMLDivElement>)=>{
    const target=event.relatedTarget instanceof HTMLElement?event.relatedTarget:null;
    const row=target?.closest<HTMLElement>("[data-caption-id]");
    setFocusedId(row&&listRef.current?.contains(row)?row.dataset.captionId??null:null);
  };
  return {listRef,rows,rowRef,layout,indexes,range,reset,revealIndex,onFocusCapture:focus,onBlurCapture:blur};
}
