import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { Script } from "node:vm";
import { createServer } from "node:http";
import { build } from "vite";
import react from "@vitejs/plugin-react";
import { expect, it } from "vitest";

const workspace = process.cwd(), electron = path.join(workspace, "node_modules", "electron", "dist", "electron.exe");

it.runIf(process.platform === "win32" && existsSync(electron))("submits vocabulary arrays from the real overlap form and blocks invalid terms", async () => {
  const scratchRoot = path.resolve(workspace, ".tmp");
  await mkdir(scratchRoot, { recursive: true });
  const temporary = await mkdtemp(path.join(scratchRoot, "speech-tools-dom-"));
  await mkdir(path.join(temporary, "user-data"));
  const built = path.join(temporary, "built");
  const server = createServer(async (req, res) => {
    const pathname = new URL(req.url || "/", "http://127.0.0.1").pathname;
    const target = path.resolve(built, `.${decodeURIComponent(pathname)}`);
    if (!target.startsWith(`${built}${path.sep}`)) { res.writeHead(404); res.end(); return; }
    try { const body = await readFile(target); res.setHeader("Content-Type", target.endsWith(".js") ? "text/javascript" : target.endsWith(".css") ? "text/css" : "text/html"); res.end(body); }
    catch { res.writeHead(404); res.end(); }
  });
  try {
    await writeFile(path.join(temporary, "index.html"), '<!doctype html><html><body><div id="root"></div><script type="module" src="./entry.tsx"></script></body></html>');
    await writeFile(path.join(temporary, "entry.tsx"), `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {SpeechToolsDialog} from '/src/components/SpeechToolsDialog.tsx';
import {I18nProvider} from '/src/i18n.tsx';
import {createProject} from '/src/domain.ts';
import '/src/styles.css';
import '/src/theme.css';
const media={id:'a'.repeat(32),name:'fixture.wav',duration:12,audioTracks:[{index:0,label:'fixture track',channels:1}],url:'/api/media/'+ 'a'.repeat(32)+'/file',sha256:'b'.repeat(64),bytes:4};
const initial={...createProject(2),mediaName:'fixture.wav',duration:12,mediaIdentity:{sha256:media.sha256,bytes:4},vocabulary:[]};
initial.captions=[{id:'reference-a',start:0,end:3,text:'확인한 첫 번째 목소리 기준 구간',speakerId:'speaker-1',reviewed:true,reasons:[]},{id:'reference-b',start:4,end:7,text:'확인한 두 번째 목소리 기준 구간',speakerId:'speaker-2',reviewed:true,reasons:[]},{id:'unassigned',start:8,end:10,text:'목소리를 비교할 미배정 구간',speakerId:null,reviewed:false,reasons:['unassigned']}];
const source=new File([new Uint8Array(4)],'fixture.wav');
window.__speechProbe={calls:[],jobs:{},initial};
window.fetch=async(url,options={})=>{
 const probe=window.__speechProbe;
 let value={};
 if(url==='/api/speech-tools/status')value={voice:{runtimeAvailable:true,ready:true,issue:null},overlap:{runtimeAvailable:true,ready:true,issue:null}};
 else if(url==='/api/media'||url==='/api/media/'+media.id)value=media;
 else if(url==='/api/speech-tools/jobs'){
  const body=JSON.parse(options.body);probe.calls.push(body);
  const id=probe.calls.length.toString(16).padStart(32,'0');
  probe.jobs[id]={id,kind:body.kind,status:body.kind==='overlap-recovery'?'failed':'completed',stage:'done',progress:1,result:{},error:'fixture stops after request capture'};value={id};
 }else if(/^\\/api\\/speech-tools\\/jobs\\/[a-f0-9]{32}$/.test(url)&&!options.method)value=probe.jobs[url.split('/').at(-1)];
 return new Response(JSON.stringify(value),{status:200,headers:{'Content-Type':'application/json'}});
};
function App(){const [project,setProject]=React.useState(initial);window.__setVocabulary=terms=>setProject(p=>({...p,vocabulary:terms}));return <I18nProvider><SpeechToolsDialog project={project} session={1} file={source} selectedCaptionId={null} onClose={()=>{}} onUpdate={setProject} onApplyVoice={()=>{}} onApplyOverlap={()=>{}}/></I18nProvider>}
createRoot(document.getElementById('root')).render(<App/>);
`);
    await writeFile(path.join(temporary, "main.cjs"), `
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path');
app.setPath('userData',path.join(__dirname,'user-data'));
const url=process.env.VOICESUBSEP_SPEECH_DOM_URL,output=process.env.VOICESUBSEP_SPEECH_DOM_RESULT;
fs.writeFileSync(output,JSON.stringify({stage:'main'}));
app.whenReady().then(async()=>{
 fs.writeFileSync(output,JSON.stringify({stage:'ready'}));
 const win=new BrowserWindow({show:false,webPreferences:{contextIsolation:true,sandbox:true,nodeIntegration:false,backgroundThrottling:false}});
 fs.writeFileSync(output,JSON.stringify({stage:'window'}));
 const logs=[];win.webContents.on('console-message',(_event,...args)=>logs.push(args.join(' ')));
 const js=code=>win.webContents.executeJavaScript(code,true);
 const capture=async name=>{await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');fs.writeFileSync(path.join(process.env.VOICESUBSEP_SPEECH_DOM_SCREENSHOTS,name+'.png'),(await win.webContents.capturePage()).toPNG());};
 const layout=async()=>js("(()=>{const footer=document.querySelector('.speech-tools > .dialog-actions').getBoundingClientRect();return {overflow:document.documentElement.scrollWidth>innerWidth,footerVisible:footer.top>=0&&footer.bottom<=innerHeight}})()");
 const wait=async code=>{const end=Date.now()+12000;while(Date.now()<end){if(await js(code))return;await new Promise(r=>setTimeout(r,40));}throw Error('Timed out: '+code);};
 const button=text=>"[...document.querySelectorAll('button')].find(el=>el.textContent==="+JSON.stringify(text)+")";
 const setText=async value=>js("(()=>{const el=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,"+JSON.stringify(value)+");el.dispatchEvent(new Event('input',{bubbles:true}));})()");
 try{
  await win.loadURL(url);
  fs.writeFileSync(output,JSON.stringify({stage:'loaded',url}));
  await wait("document.querySelectorAll('[role=tab]').length===2 && !!window.__speechProbe");
  win.setContentSize(1280,900);await capture('desktop-confirmed-voices');
  await js(button('겹침 복원 실험')+'.click()');
  await wait('!!document.querySelector("textarea")');
  await capture('desktop-overlap-experiment');
  await wait(button('겹침·전사 모델 준비')+' && !'+button('겹침·전사 모델 준비')+'.disabled');
  await js(button('겹침·전사 모델 준비')+'.click()');
  await wait(button('선택 구간 겹침 복원')+' && !'+button('선택 구간 겹침 복원')+'.disabled');
  await js(button('선택 구간 겹침 복원')+'.click()');
  await wait("window.__speechProbe.calls.filter(c=>c.kind==='overlap-recovery').length===1");
  await wait('!'+button('선택 구간 겹침 복원')+'.disabled');
  await setText('VOICESUBSEP\\nKAS\\nVOICESUBSEP');
  await new Promise(r=>setTimeout(r,100));
  await js(button('선택 구간 겹침 복원')+'.click()');
  await wait("window.__speechProbe.calls.filter(c=>c.kind==='overlap-recovery').length===2");
  await wait('!'+button('선택 구간 겹침 복원')+'.disabled');
  await setText('x'.repeat(51));
  await new Promise(r=>setTimeout(r,100));
  await js(button('선택 구간 겹침 복원')+'.click()');
  await new Promise(r=>setTimeout(r,150));
  await js(button('겹침·전사 모델 준비')+'.click()');
  await new Promise(r=>setTimeout(r,100));
  const data=await js("(()=>{const calls=window.__speechProbe.calls.filter(c=>c.kind==='overlap-recovery');return {empty:calls[0].vocabulary,terms:calls[1].vocabulary,invalidBlocked:calls.length===2,invalidPrepareBlocked:window.__speechProbe.calls.filter(c=>c.kind==='prepare-overlap').length===1,projectVocabulary:window.__speechProbe.initial.vocabulary}})()");
  await js("window.__setVocabulary(['Saved term'])");
  await wait("document.querySelector('textarea').value==='Saved term'");
  data.savedReset=await js("document.querySelector('textarea').value");
  win.setContentSize(390,844);await capture('narrow-overlap-experiment');data.narrowOverlap=await layout();
  await js("document.querySelector('.speech-tools-scroll').scrollTop=document.querySelector('.speech-tools-scroll').scrollHeight");
  await capture('narrow-overlap-bottom');
  data.overlapRunReachable=await js("(()=>{const el="+button('선택 구간 겹침 복원')+";const r=el.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight})()");
  await js(button('확인한 목소리')+'.click()');
  await capture('narrow-confirmed-voices');data.narrowVoice=await layout();
  await js("document.querySelector('.speech-tools-scroll').scrollTop=document.querySelector('.speech-tools-scroll').scrollHeight");
  await capture('narrow-confirmed-voices-bottom');
  fs.writeFileSync(output,JSON.stringify(data));app.exit(0);
 }catch(error){fs.writeFileSync(output,JSON.stringify({error:String(error),stack:error.stack,logs,body:await js('document.body.innerText').catch(()=>null)}));app.exit(1);}
}).catch(error=>{fs.writeFileSync(output,JSON.stringify({error:String(error)}));app.exit(1)});
`);
    new Script(await readFile(path.join(temporary, "main.cjs"), "utf8"), { filename: "speech-tools-dom-main.cjs" });
    await build({ root: workspace, configFile: false, plugins: [react()], logLevel: "error", build: { outDir: built, emptyOutDir: true,
      rollupOptions: { input: path.join(temporary, "index.html") } } });
    await new Promise<void>(resolve => { server.listen(0, "127.0.0.1", resolve); });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing DOM test server address");
    const entry = path.relative(workspace, path.join(temporary, "index.html")).split(path.sep).join("/");
    const resultPath = path.join(temporary, "result.json"), env = { ...process.env };
    env.VOICESUBSEP_SPEECH_DOM_URL = `http://127.0.0.1:${address.port}/${entry}`;
    env.VOICESUBSEP_SPEECH_DOM_RESULT = resultPath;
    const screenshots = path.resolve(workspace, "tmp", "speech-tools-ui");
    await mkdir(screenshots, { recursive: true });
    env.VOICESUBSEP_SPEECH_DOM_SCREENSHOTS = screenshots;
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.NODE_OPTIONS; delete env.NODE_CHANNEL_FD; delete env.NODE_CHANNEL_SERIALIZATION_MODE; delete env.NODE_UNIQUE_ID;
    await writeFile(path.join(temporary, "launch.cjs"), "const {spawn}=require('node:child_process');const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.NODE_OPTIONS;const c=spawn(process.argv[2],process.argv.slice(3),{env,windowsHide:true,stdio:'inherit'});c.on('error',e=>{console.error(e);process.exit(1)});c.on('exit',code=>process.exit(code===0?0:1));");
    let logs = "";
    const code = await new Promise<number | null>((resolve, reject) => {
      const child = spawn(electron, [path.join(temporary, "main.cjs"), "--disable-gpu"], { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      child.stdout.on("data", chunk => { logs += String(chunk).slice(0, 3000); });
      child.stderr.on("data", chunk => { logs += String(chunk).slice(0, 3000); });
      const timeout = setTimeout(() => { child.kill(); reject(new Error("Speech tools DOM test timed out")); }, 20_000);
      child.on("error", error => { clearTimeout(timeout); reject(error); });
      child.on("exit", result => { clearTimeout(timeout); resolve(result); });
    });
    if (!existsSync(resultPath)) throw new Error(`Electron DOM test exited ${code} without a result: ${logs.slice(-5000)}`);
    const result = JSON.parse(await readFile(resultPath, "utf8"));
    expect(result.error, JSON.stringify(result)).toBeUndefined();
    expect(code).toBe(0);
    expect(result.empty).toEqual([]);
    expect(result.terms).toEqual(["VOICESUBSEP", "KAS"]);
    expect(result.invalidBlocked).toBe(true);
    expect(result.invalidPrepareBlocked).toBe(true);
    expect(result.projectVocabulary).toEqual([]);
    expect(result.savedReset).toBe("Saved term");
    expect(result.narrowOverlap).toEqual({ overflow: false, footerVisible: true });
    expect(result.narrowVoice).toEqual({ overflow: false, footerVisible: true });
    expect(result.overlapRunReachable).toBe(true);
  } finally {
    await new Promise<void>(resolve => { server.close(() => resolve()); });
    const resolved = path.resolve(temporary);
    if (!resolved.startsWith(`${scratchRoot}${path.sep}`)) throw new Error("DOM test scratch path escaped its workspace");
    await rm(resolved, { recursive: true, force: true });
  }
}, 35_000);
