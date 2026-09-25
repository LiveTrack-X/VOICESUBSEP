import { useLayoutEffect, useRef, useState } from "react";
import { formatTime, type Caption, type Speaker } from "../domain";
import { contrastColor } from "../colors";
import { resizeCaption } from "../timelineEditing";
import { useI18n } from "../i18n";
import { TimelineSpeakerName } from "./TimelineSpeakerName";

export function CaptionTimelineLane({ captions, speaker, duration, mediaDuration, time, selected, preview, onResize, onRename }: {
  captions: Caption[]; speaker: Speaker; duration:number; mediaDuration:number; time:number; selected:string|null;
  preview:(time:number,id?:string,speakerId?:string)=>void; onResize:(id:string,edge:"start"|"end",position:number)=>void;
  onRename:(id:string,originalName:string,name:string)=>void;
}) {
  const {t}=useI18n(); const canvas=useRef<HTMLCanvasElement>(null), lane=useRef<HTMLDivElement>(null);
  const drag=useRef<{pointerId:number;x:number;width:number;caption:Caption;edge:"start"|"end";next:Caption}|null>(null);
  const [draft,setDraft]=useState<Caption|null>(null);
  const dense=captions.length>400;
  useLayoutEffect(()=>{
    const element=canvas.current;if(!element)return;
    const paint=()=>{
      element.width=Math.min(8192,Math.max(1,element.clientWidth));element.height=23;
      const context=element.getContext("2d");if(!context)return;
      context.fillStyle=speaker.color;
      for(const c of captions) context.fillRect(c.start/duration*element.width,3,Math.max(2,(c.end-c.start)/duration*element.width),17);
    };
    paint(); const observer=new ResizeObserver(paint);observer.observe(element);return()=>observer.disconnect();
  },[captions,duration,speaker.color,dense]);
  const active=draft??captions.find(c=>c.id===selected);
  return <div className="timeline-lane">
    <div className="lane-label"><span className="speaker-dot" style={{background:speaker.color}}/>{speaker.id
      ? <TimelineSpeakerName speaker={speaker} onRename={onRename}/>
      : <span className="timeline-speaker-unassigned">{speaker.name}</span>}</div>
    <div className="lane-track" ref={lane} onClick={event=>{const box=event.currentTarget.getBoundingClientRect();preview(Math.max(0,Math.min(1,(event.clientX-box.left)/box.width))*duration,undefined,speaker.id);}}>
      <span className="playhead" style={{left:`${time/duration*100}%`}}/>
      {dense&&<canvas ref={canvas} className="caption-density-canvas" aria-hidden="true"/>}
      {(dense?captions.filter(c=>c.id===selected):captions).map(original=>{
        const c=draft?.id===original.id?draft:original;
        return <button key={c.id} className={`caption-block ${selected===c.id?"selected":""}`} aria-pressed={selected===c.id} aria-label={`${speaker.name} ${formatTime(c.start)} ${c.text}`} title={`${speaker.name} · ${c.text} · ${t("클릭하여 재생")}`} style={{left:`${c.start/duration*100}%`,width:`${(c.end-c.start)/duration*100}%`,background:speaker.color,color:contrastColor(speaker.color)}} onClick={event=>{event.stopPropagation();preview(c.start,c.id);}}>{c.text}</button>;
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
