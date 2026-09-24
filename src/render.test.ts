import { describe, expect, it } from "vitest";
import { createProject, type Project } from "./domain";
import { renderedProject } from "./render";

function fixture():Project{return {...createProject(1),schemaVersion:2,duration:10,cuts:[{id:"rough",start:2.01,end:4.01}],
  captions:[{id:"kept",start:5,end:6,text:"hello",speakerId:"speaker-1",reasons:[],reviewed:true}],
  notes:[{id:"n",start:6,end:7,text:"edit",tag:"edit",done:false}]};}
describe("render sidecars",()=>{
 it("uses returned frame boundaries, preserving the editing source",()=>{
  const source=fixture();const before=structuredClone(source);
  const output=renderedProject(source,[{start:0,end:2},{start:4.033333333333333,end:10}]);
  expect(output.project.duration).toBe(7.966667);
  expect(output.project.captions[0].start).toBe(2.966667);
  expect(output.project.notes[0].start).toBe(3.966667);
  expect(source).toEqual(before);
 });
 it("detects a caption cut by quantization even if the original boundary missed it",()=>{
  const source=fixture();source.captions[0]={...source.captions[0],start:4.01,end:5};
  expect(renderedProject(source,[{start:0,end:2},{start:4.033333,end:10}]).issues).toHaveLength(1);
 });
 it.each([[],[{start:3,end:2}],[{start:0,end:11}],[{start:2,end:5},{start:4,end:9}],[{start:NaN,end:3}]].map(ranges=>({ranges})))("rejects invalid backend ranges $ranges",({ranges})=>{
   expect(()=>renderedProject(fixture(),ranges)).toThrow();
 });
});
