import type { CutRange, Project } from "./domain";
import { projectForEditedExport } from "./cuts";

export type RenderJob = {
  id: string;
  status: "queued"|"running"|"completed"|"failed"|"cancelled";
  progress: number;
  stage: string;
  error?: string;
  result?: {url:string;filename:string;duration:number;keepRanges:{start:number;end:number}[];warnings:string[]};
};

/** Re-map sidecars using the renderer's actual frame/sample boundaries. */
export function renderedProject(source:Project, keepRanges:{start:number;end:number}[]) {
  let cursor=0;
  const cuts:CutRange[]=[];
  for(const [i,range] of keepRanges.entries()) {
    if(!Number.isFinite(range.start)||!Number.isFinite(range.end)||range.start<cursor||range.end<=range.start||range.end>source.duration+0.000001)
      throw new Error("Invalid rendered keep ranges.");
    if(range.start>cursor) cuts.push({id:`render-${i}`,start:cursor,end:range.start});
    cursor=range.end;
  }
  if(!keepRanges.length) throw new Error("No rendered media ranges.");
  if(cursor<source.duration) cuts.push({id:"render-tail",start:cursor,end:source.duration});
  return projectForEditedExport({...source,schemaVersion:2,cuts});
}
