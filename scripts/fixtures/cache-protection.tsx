import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { createProject } from "../../src/domain";
import { I18nProvider } from "../../src/i18n";
import { JobHistoryDialog } from "../../src/components/JobHistoryDialog";
import type { MediaSource } from "../../src/mediaSource";

/** Actual React rerenders, fake API only; never contacts or deletes user cache. */
export async function runCacheProtection() {
  const check = (condition:unknown,message:string) => { if(!condition) throw Error(message); };
  const until = async (test:()=>boolean) => { for(let i=0;i<300;i++){if(test())return;await new Promise(resolve=>setTimeout(resolve,5));}throw Error("Cache test timed out"); };
  const button = (text:string) => Array.from(document.querySelectorAll("button")).find(item=>item.textContent===text);
  const a="e".repeat(32),b="f".repeat(32),c="1".repeat(32);
  const item=(id:string,bytes:number,protectedValue=false)=>({id,name:id,bytes,duration:1,protected:protectedValue});
  let cache={items:[item(a,10),item(b,20),item(c,30,true)],bytes:60,reclaimableBytes:30,freeBytes:100};
  const requests:{method:string;path:string;ids?:string[]}[]=[];
  const previousFetch=window.fetch;
  window.fetch=async(input,init)=>{
    const path=String(input),method=init?.method??"GET";
    let data:unknown;
    if(method==="GET"&&path==="/api/cache")data=cache;
    else if(method==="GET"&&path==="/api/history")data={items:[]};
    else if(method==="POST"&&path==="/api/cache/cleanup"){
      const ids=JSON.parse(String(init?.body)).mediaIds;
      requests.push({method,path,ids});
      data={removedCount:ids.length,removedBytes:20,skippedCount:0,failedCount:0};
    }else throw Error(`Unexpected synthetic cache request: ${method} ${path}`);
    return new Response(JSON.stringify(data),{status:200,headers:{"Content-Type":"application/json"}});
  };
  const root=createRoot(document.getElementById("root")!),project=createProject(1);
  const source=(id:string):MediaSource=>({kind:"desktop-media",name:id,size:10,media:{id,name:id,duration:1,audioTracks:[],url:`/api/media/${id}/file`}});
  const render=(file:MediaSource|null,key:string)=>flushSync(()=>root.render(<I18nProvider><JobHistoryDialog key={key} project={project} file={file} onClose={()=>{}} onApplyAnalysis={()=>{throw Error("Unexpected apply");}}/></I18nProvider>));
  try{
    render(source(a),"initial");
    await until(()=>!!button("복사본 삭제"));
    const row=Array.from(document.querySelectorAll(".dialog-actions")).find(row=>row.querySelector("span")?.textContent?.includes(a));
    check(row?.querySelector<HTMLButtonElement>("button")?.disabled,"Connected source delete remained enabled");
    check(row?.textContent?.includes("현재 편집기에 연결됨"),"Missing connected-source label");
    check(document.body.textContent?.includes("정리 가능 20 B"),"Reclaimable bytes included connected source");
    render(null,"single");await until(()=>!!button("복사본 삭제"));
    button("복사본 삭제")!.click();await until(()=>!!button("삭제 확인"));
    render(source(a),"single");
    check(button("삭제 확인")?.disabled,"Stale single-delete confirmation remained enabled");
    button("삭제 확인")!.click();check(requests.length===0,"Protected source was deleted");
    render(null,"bulk");await until(()=>!!button("복사본 삭제"));
    Array.from(document.querySelectorAll("button")).find(button=>button.textContent?.startsWith("정리 가능한 캐시 정리"))!.click();
    await until(()=>!!button("정리 확인"));
    render(source(a),"bulk");
    check(document.body.textContent?.includes("복사본 1개 · 20 B"),"Stale cleanup count/bytes did not update");
    // A later upload is not part of the already-reviewed snapshot.
    cache={...cache,items:[...cache.items,item("2".repeat(32),40)],bytes:100,reclaimableBytes:70};
    button("새로고침")!.click();await until(()=>document.body.textContent?.includes("정리 가능 60 B")===true);
    button("정리 확인")!.click();await until(()=>requests.length===1);
    check(JSON.stringify(requests[0].ids)===JSON.stringify([b]),"Cleanup included a connected or unreviewed source");
    return {connectedDeleteDisabled:true,reclaimableBytesExcludeConnected:true,staleSingleConfirmationDisabled:true,staleBulkRechecked:true,newUploadExcluded:true,syntheticCleanupIds:requests[0].ids};
  }finally{root.unmount();window.fetch=previousFetch;}
}
