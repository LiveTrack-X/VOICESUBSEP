import { useLayoutEffect, useRef, useState } from "react";
import { formatTime, type Caption, type Speaker } from "../domain";
import { contrastColor } from "../colors";
import { resizeCaption } from "../timelineEditing";
import { useI18n } from "../i18n";
import { TimelineSpeakerName } from "./TimelineSpeakerName";
import { captionAtTimelinePosition, timelineMenuAnchor, type TimelineMenuAnchor } from "../timelineContext";
import { densityCaptionRect, densityTile, focusDensityTrack } from "../timelineDensity";

export function CaptionTimelineLane({ captions, speaker, duration, mediaDuration, time, selected, preview, onResize, onRename, onContextMenu }: {
  captions: Caption[]; speaker: Speaker; duration:number; mediaDuration:number; time:number; selected:string|null;
  preview:(time:number,id?:string,speakerId?:string)=>void; onResize:(id:string,edge:"start"|"end",position:number)=>void;
  onRename:(id:string,originalName:string,name:string)=>void;
  onContextMenu?: (id:string, anchor:TimelineMenuAnchor)=>void;
}) {
  const {t}=useI18n(); const canvas=useRef<HTMLCanvasElement>(null), lane=useRef<HTMLDivElement>(null);
  const drag=useRef<{pointerId:number;x:number;width:number;caption:Caption;edge:"start"|"end";next:Caption}|null>(null);
  const [draft,setDraft]=useState<Caption|null>(null);
  const dense=captions.length>400;
  useLayoutEffect(()=>{
    const element=canvas.current, track=lane.current;if(!element||!track)return;
    const scroller=track.closest<HTMLElement>(".timeline-scroll");
    let frame:number|null=null;
    const paint=()=>{
      frame=null;
      const bounds=track.getBoundingClientRect(), viewport=scroller?.getBoundingClientRect();
      const visibleLeft=Math.max(0,viewport?viewport.left+(scroller?.clientLeft??0):0);
      const visibleRight=Math.min(window.innerWidth,viewport?viewport.left+(scroller?.clientLeft??0)+(scroller?.clientWidth??0):window.innerWidth);
      const tile=densityTile(bounds.width,visibleLeft-bounds.left,visibleRight-bounds.left,window.devicePixelRatio);
      element.style.left=`${tile.left}px`;element.style.width=`${tile.cssWidth}px`;element.style.height=`${tile.cssHeight}px`;
      if(element.width!==tile.width)element.width=tile.width;
      if(element.height!==tile.height)element.height=tile.height;
      const context=element.getContext("2d");if(!context)return;
      context.clearRect(0,0,element.width,element.height);
      context.fillStyle=speaker.color;
      for(const c of captions){const rect=densityCaptionRect(c.start,c.end,duration,tile);if(rect)context.fillRect(rect.x,rect.y,rect.width,rect.height);}
    };
    const schedule=()=>{if(frame===null)frame=requestAnimationFrame(paint);};
    paint();const observer=new ResizeObserver(schedule);observer.observe(track);if(scroller)observer.observe(scroller);
    scroller?.addEventListener("scroll",schedule,{passive:true});window.addEventListener("resize",schedule);
    let densityQuery=window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    const changedDensity=()=>{densityQuery.removeEventListener("change",changedDensity);densityQuery=window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);densityQuery.addEventListener("change",changedDensity);schedule();};
    densityQuery.addEventListener("change",changedDensity);
    return()=>{observer.disconnect();scroller?.removeEventListener("scroll",schedule);window.removeEventListener("resize",schedule);densityQuery.removeEventListener("change",changedDensity);if(frame!==null)cancelAnimationFrame(frame);};
  },[captions,duration,speaker.color,dense]);
  const active=draft??captions.find(c=>c.id===selected);
  return <div className="timeline-lane">
    <div className="lane-label"><span className="speaker-dot" style={{background:speaker.color}}/>{speaker.id
      ? <TimelineSpeakerName speaker={speaker} onRename={onRename}/>
      : <span className="timeline-speaker-unassigned">{speaker.name}</span>}</div>
    <div className="lane-track" ref={lane} tabIndex={dense ? 0 : undefined} aria-label={dense ? t("{name} 자막 트랙 · Shift+F10으로 항목 작업",{name:speaker.name}) : undefined}
      onPointerDown={event=>focusDensityTrack(event,dense)}
      onContextMenu={event=>{if(!dense||!onContextMenu)return;const box=event.currentTarget.getBoundingClientRect();const c=captionAtTimelinePosition(captions,(event.clientX-box.left)/Math.max(1,box.width)*duration,selected,2/Math.max(1,box.width)*duration);if(c){event.preventDefault();event.stopPropagation();onContextMenu(c.id,timelineMenuAnchor(event.currentTarget,event));}}}
      onKeyDown={event=>{if(event.target!==event.currentTarget||!dense||!onContextMenu||!(event.key==="ContextMenu"||event.shiftKey&&event.key==="F10"))return;const c=captions.find(c=>c.id===selected)??captionAtTimelinePosition(captions,time,selected)??captions[0];if(c){event.preventDefault();event.stopPropagation();onContextMenu(c.id,timelineMenuAnchor(event.currentTarget));}}}
      onClick={event=>{const box=event.currentTarget.getBoundingClientRect();preview(Math.max(0,Math.min(1,(event.clientX-box.left)/box.width))*duration,undefined,speaker.id);}}>
      <span className="playhead" style={{left:`${time/duration*100}%`}}/>
      {dense&&<canvas ref={canvas} className="caption-density-canvas" aria-hidden="true"/>}
      {(dense?captions.filter(c=>c.id===selected):captions).map(original=>{
        const c=draft?.id===original.id?draft:original;
        return <button key={c.id} className={`caption-block ${selected===c.id?"selected":""}`} aria-pressed={selected===c.id} aria-label={`${speaker.name} ${formatTime(c.start)} ${c.text}`} title={`${speaker.name} · ${c.text} · ${t("클릭하여 재생")}`} style={{left:`${c.start/duration*100}%`,width:`${(c.end-c.start)/duration*100}%`,background:speaker.color,color:contrastColor(speaker.color)}}
          onContextMenu={event=>{if(onContextMenu){event.preventDefault();event.stopPropagation();onContextMenu(c.id,timelineMenuAnchor(event.currentTarget,event));}}}
          onKeyDown={event=>{if(onContextMenu&&(event.key==="ContextMenu"||event.shiftKey&&event.key==="F10")){event.preventDefault();event.stopPropagation();onContextMenu(c.id,timelineMenuAnchor(event.currentTarget));}}}
          onClick={event=>{event.stopPropagation();preview(c.start,c.id);}}>{c.text}</button>;
      })}
      {active&&(["start","end"] as const).map(edge=><button key={edge} className={`caption-edge caption-edge-${edge}`} role="slider" aria-label={t(edge==="start"?"선택 자막 시작 조절":"선택 자막 끝 조절")} aria-valuemin={edge==="start"?0:active.start+0.01} aria-valuemax={edge==="start"?active.end-0.01:Math.max(mediaDuration,active.end)||duration} aria-valuenow={active[edge]} aria-valuetext={formatTime(active[edge])} title={t("드래그 또는 방향키로 자막 경계 조절")} style={{left:`${active[edge]/duration*100}%`}}
        onClick={e=>e.stopPropagation()}
        onPointerDown={e=>{if(!e.isPrimary||e.button!==0)return;e.preventDefault();e.stopPropagation();e.currentTarget.focus();e.currentTarget.setPointerCapture(e.pointerId);drag.current={pointerId:e.pointerId,x:e.clientX,width:lane.current?.clientWidth||1,caption:active,edge,next:active};}}
        onPointerMove={e=>{const state=drag.current;if(!state||state.pointerId!==e.pointerId)return;state.next=resizeCaption(state.caption,state.edge,state.caption[state.edge]+(e.clientX-state.x)/state.width*duration,mediaDuration);setDraft(state.next);}}
        onPointerUp={e=>{const state=drag.current;if(!state||state.pointerId!==e.pointerId)return;drag.current=null;e.currentTarget.releasePointerCapture(e.pointerId);setDraft(null);if(state.next!==state.caption)onResize(state.caption.id,state.edge,state.next[state.edge]);}}
        onPointerCancel={()=>{drag.current=null;setDraft(null);}}
        onLostPointerCapture={()=>{drag.current=null;setDraft(null);}}
        onKeyDown={e=>{if(e.key==="Escape"){drag.current=null;setDraft(null);return;}if(!["ArrowLeft","ArrowRight"].includes(e.key))return;e.preventDefault();e.stopPropagation();const next=resizeCaption(active,edge,active[edge]+(e.key==="ArrowLeft"?-1:1)*(e.shiftKey?0.1:0.01),mediaDuration);if(next!==active)onResize(active.id,edge,next[edge]);}}
      />)}
    </div>
  </div>;
}
