import { describe, expect, it } from "vitest";
import { createProject, type Caption, type CaptionStyle } from "./domain";
import { projectForEditedExport } from "./cuts";
import { escapeYttText, exportYtt, yttFontSize } from "./ytt";

function project() {
  const p=createProject(2);p.name="Styled CC";p.duration=20;
  p.speakers[0].name="다나 & Dana";p.speakers[0].color="#123456";
  p.speakers[1].name="Sam";p.speakers[1].color="#fedcba";
  p.speakers[0].subtitleStyle={fontFamily:"mono",fontSize:30,textColor:"#aBcDef",backgroundColor:"#112233",backgroundOpacity:50,bold:true,outline:true,position:"top",align:"left"};
  p.captions=[
    {id:"a",start:0,end:2,text:"안녕하세요 & <hello>\nNext line",speakerId:p.speakers[0].id,reasons:[],reviewed:true},
    {id:"b",start:1,end:3,text:"함께 말해요",speakerId:p.speakers[1].id,reasons:["overlap"],reviewed:false},
    {id:"c",start:3,end:4,text:"미배정 음성",speakerId:null,reasons:["unassigned"],reviewed:false},
  ];
  return p;
}
const attributes=(text:string)=>Object.fromEntries([...text.matchAll(/([a-z]+)="([^"]*)"/gu)].map(match=>[match[1],match[2]]));
function elements(xml:string,tag:string) {
  return [...xml.matchAll(new RegExp(`<${tag} ([^>]*?)(?:/>|>([\\s\\S]*?)</${tag}>)`,"gu"))]
    .map(match=>({attributes:attributes(match[1]),text:match[2]??""}));
}
const byId=(xml:string,tag:string)=>new Map(elements(xml,tag).map(row=>[row.attributes.id,row.attributes]));

describe("experimental full-cue YTT SRV3 export",()=>{
  it("resolves speaker and per-caption overrides with separate colored name/body spans",()=>{
    const p=project();p.captions[0].style={fontSize:24,textColor:"#ffffff"};
    const original=JSON.stringify(p),xml=exportYtt(p),pens=byId(xml,"pen"),cue=elements(xml,"p")[0];
    expect(xml).toContain('<timedtext format="3">');
    const body=pens.get(cue.attributes.p)!;
    expect(body).toMatchObject({fc:"#FEFEFE",fo:"254",bc:"#112233",bo:"128",b:"1",fs:"3",sz:"340",et:"3",ec:"#000000"});
    const spans=elements(cue.text,"s");
    expect(spans).toHaveLength(2);
    expect(pens.get(spans[0].attributes.p)?.fc).toBe("#123456");
    expect(spans[0].text).toBe("다나 &amp; Dana: ");
    expect(spans[1].attributes.p).toBe(cue.attributes.p);
    expect(spans[1].text).toBe("안녕하세요 &amp; &lt;hello&gt;\nNext line");
    expect(cue.text).toContain('</s>&#8203;<s p="');
    expect(JSON.stringify(p)).toBe(original);
  });
  it("uses fo254/near-white text and disables the separate window background",()=>{
    const p=project();p.captions[0].style={backgroundOpacity:100};p.captions[1].style={backgroundOpacity:0,showSpeaker:false};
    const xml=exportYtt(p),pens=byId(xml,"pen"),cues=elements(xml,"p");
    expect(pens.get(cues[0].attributes.p)?.bo).toBe("254");
    expect(pens.get(cues[1].attributes.p)?.bo).toBe("0");
    expect(cues[1].text).toBe("함께 말해요");
    for(const pen of pens.values()){expect(pen.fo).toBe("254");expect(pen.fc).not.toBe("#FFFFFF");}
    for(const ws of elements(xml,"ws"))expect(ws.attributes.wfo).toBe("0");
  });
  it("moves a zero start to 1ms without moving the end or adding karaoke timing",()=>{
    const p=project();p.captions[0].words=[{start:0,end:.5,text:"안녕하세요"}];
    const cues=elements(exportYtt(p),"p");
    expect(cues[0].attributes).toMatchObject({t:"1",d:"1999"});
    expect(Number(cues[0].attributes.t)+Number(cues[0].attributes.d)).toBe(2000);
    expect(cues[1].attributes).toMatchObject({t:"1000",d:"2000"});
    for(const cue of cues)for(const span of elements(cue.text,"s"))expect(span.attributes.t).toBeUndefined();
  });
  it.each([[0,.001],[0,.0004],[1.0001,1.0004]])("fails explicitly when millisecond compatibility cannot preserve end %s-%s",(start,end)=>{
    const p=project();p.captions=[{...p.captions[0],start,end}];
    expect(()=>exportYtt(p)).toThrow("1ms");
  });
  it("preserves overlapping intervals and reuses freed positions",()=>{
    const p=project();delete p.speakers[0].subtitleStyle;
    p.captions[0].text="First";
    const cues=elements(exportYtt(p),"p");
    expect(cues).toHaveLength(3);
    expect(cues.map(cue=>[Number(cue.attributes.t),Number(cue.attributes.d)])).toEqual([[1,1999],[1000,2000],[3000,1000]]);
    expect(cues[0].attributes.wp).not.toBe(cues[1].attributes.wp);
    expect(cues[2].attributes.wp).toBe(cues[0].attributes.wp);
  });
  it.each(["top","middle","bottom"] as const)("handles different-height rows without overlap at %s",position=>{
    const p=project();delete p.speakers[0].subtitleStyle;
    p.captions=p.captions.slice(0,2).map((cue,index)=>({...cue,start:1,end:3,text:index===0?"One\nTwo":"Three",style:{position,fontSize:index===0?15:24}}));
    const xml=exportYtt(p),cues=elements(xml,"p"),positions=byId(xml,"wp");
    const y=cues.map(cue=>Number(positions.get(cue.attributes.wp)?.av));
    expect(y[0]).not.toBe(y[1]);
    expect(y.every(value=>value>=0&&value<=100)).toBe(true);
    expect(position==="bottom"?y[1]<y[0]:y[1]>y[0]).toBe(true);
  });
  it.each([
    ["top","left",0,0],["top","center",1,2],["top","right",2,1],
    ["middle","left",3,0],["middle","center",4,2],["middle","right",5,1],
    ["bottom","left",6,0],["bottom","center",7,2],["bottom","right",8,1],
  ] as const)("maps %s/%s position and justification",(position,align,anchor,justify)=>{
    const p=project();p.captions=[{...p.captions[1],style:{position,align}}];
    const xml=exportYtt(p),cue=elements(xml,"p")[0],wp=byId(xml,"wp").get(cue.attributes.wp)!,ws=byId(xml,"ws").get(cue.attributes.ws)!;
    expect(wp.ap).toBe(String(anchor));expect(ws.ju).toBe(String(justify));
    expect(Number.isInteger(Number(wp.ah))&&Number.isInteger(Number(wp.av))).toBe(true);
  });
  it("deduplicates definitions and emits consecutive increasing IDs with valid references",()=>{
    const p=project();delete p.speakers[0].subtitleStyle;
    p.captions=Array.from({length:30},(_,index)=>({...p.captions[1],id:`cue-${index}`,start:index*2,end:index*2+1}));p.duration=60;
    const xml=exportYtt(p),pens=byId(xml,"pen"),windows=byId(xml,"ws"),positions=byId(xml,"wp");
    expect(pens.size).toBe(2);expect(windows.size).toBe(1);expect(positions.size).toBe(1);
    for(const tag of ["pen","ws","wp"]){const ids=elements(xml,tag).map(row=>Number(row.attributes.id));expect(ids).toEqual(ids.map((_,index)=>index+1));}
    for(const cue of elements(xml,"p")){
      expect(pens.has(cue.attributes.p)&&windows.has(cue.attributes.ws)&&positions.has(cue.attributes.wp)).toBe(true);
      for(const span of elements(cue.text,"s"))expect(pens.has(span.attributes.p)).toBe(true);
    }
  });
  it("is deterministic even when source arrays use a different order",()=>{
    const p=project();p.captions[1].start=0;p.captions[1].end=2;
    const reordered={...p,captions:[...p.captions].reverse(),speakers:[...p.speakers].reverse()};
    expect(exportYtt(reordered)).toBe(exportYtt(p));
  });
  it("exports the caller's timebase and retains existing cut-safety decisions",()=>{
    const p=project();p.schemaVersion=2;p.cuts=[{id:"cut",start:5,end:10}];
    p.captions=[{...p.captions[1],start:12,end:14}];
    expect(elements(exportYtt(p),"p")[0].attributes).toMatchObject({t:"12000",d:"2000"});
    const edited=projectForEditedExport(p);expect(edited.issues).toEqual([]);
    expect(elements(exportYtt(edited.project),"p")[0].attributes).toMatchObject({t:"7000",d:"2000"});
    expect(p.captions[0].start).toBe(12);
    p.captions[0].start=4;
    expect(projectForEditedExport(p).issues[0].reason).toBe("missing_word_timing");
  });
  it("keeps unassigned names neutral and does not export legacy translations",()=>{
    const p=project();p.captions=[{...p.captions[2],translation:{sourceText:"미배정 음성",texts:{en:"OLD TRANSLATION"}}}];
    const xml=exportYtt(p),name=elements(elements(xml,"p")[0].text,"s")[0];
    expect(name.text).toBe("미배정: ");expect(byId(xml,"pen").get(name.attributes.p)?.fc).toBe("#FEFEFE");
    expect(xml).not.toContain("OLD TRANSLATION");
  });
  it("fails before returning partial output when rows or long text cannot fit",()=>{
    const p=project();delete p.speakers[0].subtitleStyle;
    p.captions=Array.from({length:20},(_,index):Caption=>({...p.captions[1],id:`crowd-${index}`,start:1,end:3}));
    expect(()=>exportYtt(p)).toThrow("화면 높이를 넘습니다");
    p.captions=[{...p.captions[0],text:"Long\n".repeat(60)}];
    expect(()=>exportYtt(p)).toThrow("화면 높이를 넘습니다");
  });
  it("rejects invalid project data and blank cues rather than emitting broken XML",()=>{
    const p=project();p.captions[0].text=" ";expect(()=>exportYtt(p)).toThrow();
    p.captions[0].text="text";p.captions[0].end=NaN;expect(()=>exportYtt(p)).toThrow();
    p.captions[0].end=2;p.captions[0].style={textColor:'" onload="x'};expect(()=>exportYtt(p)).toThrow();
    p.captions[0].style={};p.captions[0].text="bad\u0000";expect(()=>exportYtt(p)).toThrow();
  });
  it("escapes XML injection and replaces unpaired surrogates/illegal XML scalars",()=>{
    expect(escapeYttText('&<>"\'\r\n\u0000\u000b\ufffe\uffff\ud800😀')).toBe('&amp;&lt;&gt;&quot;&apos;\n�����😀');
    const p=project();p.captions=[{...p.captions[1],text:'</s></p><script>&\ud800\uffff😀'}];
    const xml=exportYtt(p);
    expect(xml).toContain('&lt;/s&gt;&lt;/p&gt;&lt;script&gt;&amp;��😀');expect(xml).not.toContain('<script>');
    expect(xml).not.toMatch(/[\ud800-\udfff\ufffe\uffff]/u);
  });
  it("supports all project font categories and correctly transforms relative size",()=>{
    expect([12,15,24,30,48].map(yttFontSize)).toEqual([20,100,340,500,980]);
    for(const [fontFamily,expected] of Object.entries({sans:4,serif:2,mono:3})){
      const p=project();p.captions=[{...p.captions[1],style:{fontFamily:fontFamily as CaptionStyle["fontFamily"]}}];
      expect(elements(exportYtt(p),"pen")[0].attributes.fs).toBe(String(expected));
    }
  });
});
