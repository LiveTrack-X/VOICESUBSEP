import { describe, expect, it, vi } from "vitest";
import { createProject, type Caption } from "./domain";
import { buildTranscriptDocument } from "./transcriptDocument";
import { TranscriptSeekButton } from "./components/TranscriptDocumentPanel";
describe("transcript source navigation",()=>{
  it("the clicked overlapping speaker retains its exact cue ID, even with identical timestamps",()=>{
    const project=createProject(2);project.duration=8;
    project.captions=project.speakers.map((speaker,index):Caption=>({id:`speaker-${index}-cue`,speakerId:speaker.id,text:`Speech ${index}`,start:1,end:3,reasons:["overlap"],reviewed:false}));
    const turns=buildTranscriptDocument(project,key=>key).turns;expect(turns).toHaveLength(2);
    const onSeek=vi.fn();TranscriptSeekButton({turn:turns[1]!,onSeek,label:"Jump"}).props.onClick();
    expect(onSeek).toHaveBeenCalledExactlyOnceWith(1,"speaker-1-cue");
    expect(project.captions.find(c=>c.id===onSeek.mock.calls[0]![1])?.speakerId).toBe(project.speakers[1]!.id);
  });
  it("a grouped same-speaker turn jumps to its first source cue without inventing an ID",()=>{
    const project=createProject(1);project.duration=8;
    project.captions=[0,1].map((index):Caption=>({id:`cue-${index}`,speakerId:project.speakers[0]!.id,text:`Speech ${index}`,start:index*2,end:index*2+1,reasons:[],reviewed:true}));
    const turns=buildTranscriptDocument(project,key=>key).turns;expect(turns[0]!.ids).toEqual(["cue-0","cue-1"]);
    const onSeek=vi.fn();TranscriptSeekButton({turn:turns[0]!,onSeek,label:"Jump"}).props.onClick();expect(onSeek).toHaveBeenCalledExactlyOnceWith(0,"cue-0");
    const invalid=TranscriptSeekButton({turn:{...turns[0]!,ids:[]},onSeek,label:"Jump"});expect(invalid.props.disabled).toBe(true);invalid.props.onClick();expect(onSeek).toHaveBeenCalledOnce();
  });
});
