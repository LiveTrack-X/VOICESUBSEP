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

it.runIf(process.platform === "win32" && existsSync(electron))("edits real subtitle controls, preserves cancellation and inheritance, and keeps narrow dialog actions reachable", async () => {
  const scratchRoot = path.resolve(workspace, ".tmp");
  await mkdir(scratchRoot, { recursive: true });
  const temporary = await mkdtemp(path.join(scratchRoot, "caption-style-dom-"));
  const built = path.join(temporary, "built"), screenshots = path.resolve(workspace, "tmp", "caption-style-ui");
  await mkdir(screenshots, { recursive: true });
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
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {CaptionStyleDialog} from '/src/components/CaptionStyleDialog.tsx';
import {I18nProvider} from '/src/i18n.tsx';
import {resolveCaptionStyleFields} from '/src/domain.ts';
import '/src/styles.css';
import '/src/theme.css';
localStorage.setItem('voicesubsep-ui-locale','ko');
window.__styleProbe={applied:[],closed:0,lists:0,failFonts:false};
window.voicesubsepDesktop={listFonts:async()=>{window.__styleProbe.lists++;return window.__styleProbe.failFonts?{available:false,fonts:[]}:{available:true,fonts:['Arial','Consolas','Unsafe, Font','Arial']}}};
window.__fixtureValue={fontSize:23,outline:true,outlineWidth:2,shadow:true,shadowColor:'#112233',shadowBlur:3,shadowOffsetX:1,shadowOffsetY:2};
function App(){const [open,setOpen]=useState(true),[value,setValue]=useState(window.__fixtureValue),[parentOutline,setParentOutline]=useState(undefined);
 window.__openStyle=(next,outline)=>{setValue(next);setParentOutline(outline);setOpen(true)};
 return <I18nProvider>{open&&<CaptionStyleDialog title="자막 스타일" description="글꼴과 테두리, 그림자를 미리 확인하세요." value={value} inherited={resolveCaptionStyleFields({fontName:'Consolas',outline:true,outlineColor:parentOutline})} inheritedOutlineColor={parentOutline} name="화자 A" nameColor="#ff0000" text="선명한 자막 미리보기" resetLabel="상속 스타일로 초기화" onApply={style=>window.__styleProbe.applied.push(style===undefined?null:style)} onClose={()=>{window.__styleProbe.closed++;setOpen(false)}}/>}</I18nProvider>;
}
createRoot(document.getElementById('root')).render(<App/>);
`);
    await writeFile(path.join(temporary, "main.cjs"), `
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path');
app.setPath('userData',path.join(__dirname,'user-data'));
const output=process.env.VOICESUBSEP_STYLE_DOM_RESULT;
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,width:1280,height:900,webPreferences:{contextIsolation:true,sandbox:true,nodeIntegration:false,backgroundThrottling:false,spellcheck:false}});
 const js=code=>win.webContents.executeJavaScript(code,true),logs=[];
 win.webContents.on('console-message',(_event,...args)=>logs.push(args.join(' ')));
 const wait=async code=>{const end=Date.now()+10000;while(Date.now()<end){if(await js(code))return;await new Promise(resolve=>setTimeout(resolve,25))}throw Error('Timed out: '+code)};
 const button=text=>"[...document.querySelectorAll('button')].find(el=>el.textContent==="+JSON.stringify(text)+")";
 const click=async text=>{await js(button(text)+'.click()')};
 const input=label=>"document.querySelector('[aria-label=\\\""+label+"\\\"]')";
 const set=async(label,value)=>{await js("(()=>{const el="+input(label)+";Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,"+JSON.stringify(value)+");el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));})()")};
 const open=async(override,parent)=>{await js('window.__openStyle('+JSON.stringify(override)+','+JSON.stringify(parent)+')');await wait("!!document.querySelector('[role=dialog]')")};
 const snapshot=async()=>js("(()=>{const line=document.querySelector('.styled-caption'),text=document.querySelector('.caption-text'),badge=document.querySelector('.preview-speaker');return {font:getComputedStyle(line).fontFamily,size:getComputedStyle(line).fontSize,stroke:getComputedStyle(text).webkitTextStroke,shadow:getComputedStyle(text).textShadow,badgeStroke:getComputedStyle(badge).webkitTextStrokeWidth}})()");
 const settle=async()=>js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
 const capture=async name=>{await settle();fs.writeFileSync(path.join(process.env.VOICESUBSEP_STYLE_DOM_SCREENSHOTS,name+'.png'),(await win.webContents.capturePage()).toPNG())};
 const layout=async()=>js("(()=>{const footer=document.querySelector('.caption-style-editor>.dialog-actions').getBoundingClientRect(),scroll=document.querySelector('.caption-style-scroll');return {overflow:document.documentElement.scrollWidth>innerWidth,footerVisible:footer.top>=0&&footer.bottom<=innerHeight,scrollable:scroll.scrollHeight>scroll.clientHeight}})()");
 try{
  await win.loadURL(process.env.VOICESUBSEP_STYLE_DOM_URL);await wait("!!document.querySelector('.caption-text')");
  const data={initial:await snapshot(),autoFontRequests:await js('window.__styleProbe.lists')};
  await set('글꼴 이름','Arial');await set('테두리 두께','4');await set('테두리 색상','#ff0000');await set('그림자 색상','#00ff00');await set('그림자 흐림','6');await set('그림자 가로 거리','-3');await set('그림자 세로 거리','4');
  await wait("getComputedStyle(document.querySelector('.caption-text')).webkitTextStrokeWidth==='8px'");data.edited=await snapshot();
  await click('취소');await wait("!document.querySelector('[role=dialog]')");data.cancelled=await js('window.__styleProbe.applied.length===0');
  await open(undefined,undefined);await click('설치 글꼴 불러오기');await wait("document.querySelector('[role=status]')?.textContent.includes('2개')");
  data.fonts=await js("[...document.querySelectorAll('datalist option')].map(el=>el.value)");data.fontRequests=await js('window.__styleProbe.lists');
  await set('글꼴 이름','');await click('적용');await wait("!document.querySelector('[role=dialog]')");
  await js('window.__openStyle(window.__fixtureValue)');await wait("!!document.querySelector('.caption-text')");await click('상속 스타일로 초기화');
  await wait("getComputedStyle(document.querySelector('.styled-caption')).fontSize==='15px'");data.reset=await snapshot();await click('적용');await wait("!document.querySelector('[role=dialog]')");
  await open({textColor:'#000000',outline:true},undefined);data.autoDark=await snapshot();await set('글자 색상','#ffffff');await wait("getComputedStyle(document.querySelector('.caption-text')).webkitTextStrokeColor==='rgb(0, 0, 0)'");data.autoLight=await snapshot();
  await set('글꼴 이름','Arial, serif');await wait("document.querySelector('[aria-invalid=true]')");data.invalidBlocked=await js(button('적용')+'.disabled');
  const before=await js('window.__styleProbe.closed');await js(input('글꼴 이름')+".dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',isComposing:true,bubbles:true}))");data.imeKeptOpen=await js('window.__styleProbe.closed==='+before+'&&!!document.querySelector("[role=dialog]")');
  await js(input('글꼴 이름')+".dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true}))");await wait("!document.querySelector('[role=dialog]')");
  await open({textColor:'#000000',outline:true},'#0000ff');data.parentOutline=await snapshot();
  await click('취소');await wait("!document.querySelector('[role=dialog]')");
  await js('window.__styleProbe.failFonts=true;window.__openStyle(window.__fixtureValue)');await wait("!!document.querySelector('.caption-text')");await click('설치 글꼴 불러오기');await wait("document.querySelector('[role=status]')?.textContent.includes('직접 입력')");data.fontFailureManual=await js("!document.querySelector('[aria-label=\\\"글꼴 이름\\\"]').disabled");
  win.setContentSize(1280,900);await capture('desktop-controls');data.wide=await layout();
  win.setContentSize(390,640);await capture('narrow-controls');data.narrow=await layout();
  await js("document.querySelector('.caption-style-scroll').scrollTop=document.querySelector('.caption-style-scroll').scrollHeight");await capture('narrow-effects');data.narrowBottom=await layout();
  await set('글꼴 이름','Malgun Gothic');await click('적용');await wait("!document.querySelector('[role=dialog]')");
  data.applied=await js('window.__styleProbe.applied');fs.writeFileSync(output,JSON.stringify(data));app.exit(0);
 }catch(error){fs.writeFileSync(output,JSON.stringify({error:String(error),stack:error.stack,logs,body:await js('document.body.innerText').catch(()=>null)}));app.exit(1)}
}).catch(error=>{fs.writeFileSync(output,JSON.stringify({error:String(error)}));app.exit(1)});
`);
    new Script(await readFile(path.join(temporary, "main.cjs"), "utf8"), { filename: "caption-style-dom-main.cjs" });
    await build({ root: workspace, configFile: false, plugins: [react()], logLevel: "error", build: { outDir: built, emptyOutDir: true, rollupOptions: { input: path.join(temporary, "index.html") } } });
    await new Promise<void>(resolve => { server.listen(0, "127.0.0.1", resolve); });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing DOM test server address");
    const entry = path.relative(workspace, path.join(temporary, "index.html")).split(path.sep).join("/");
    const resultPath = path.join(screenshots, "result.json"), env = { ...process.env };
    env.VOICESUBSEP_STYLE_DOM_URL = `http://127.0.0.1:${address.port}/${entry}`;
    env.VOICESUBSEP_STYLE_DOM_RESULT = resultPath;
    env.VOICESUBSEP_STYLE_DOM_SCREENSHOTS = screenshots;
    delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS; delete env.NODE_CHANNEL_FD; delete env.NODE_CHANNEL_SERIALIZATION_MODE; delete env.NODE_UNIQUE_ID;
    let logs = "";
    const code = await new Promise<number | null>((resolve, reject) => {
      const child = spawn(electron, [path.join(temporary, "main.cjs"), "--disable-gpu"], { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      child.stdout.on("data", chunk => { logs += String(chunk).slice(0, 3000); }); child.stderr.on("data", chunk => { logs += String(chunk).slice(0, 3000); });
      const timeout = setTimeout(() => { child.kill(); reject(new Error("Caption style DOM test timed out")); }, 30_000);
      child.on("error", error => { clearTimeout(timeout); reject(error); }); child.on("exit", result => { clearTimeout(timeout); resolve(result); });
    });
    if (!existsSync(resultPath)) throw new Error(`Electron style test exited ${code} without a result: ${logs.slice(-5000)}`);
    const result = JSON.parse(await readFile(resultPath, "utf8"));
    expect(result.error, JSON.stringify(result)).toBeUndefined(); expect(code).toBe(0);
    expect(result.autoFontRequests).toBe(0); expect(result.fontRequests).toBe(1); expect(result.fonts).toEqual(["Arial", "Consolas"]);
    expect(result.initial.font).toContain("Consolas"); expect(result.initial.stroke).toContain("4px"); expect(result.initial.badgeStroke).toBe("0px");
    expect(result.edited.font).toContain("Arial"); expect(result.edited.stroke).toContain("rgb(255, 0, 0)"); expect(result.edited.stroke).toContain("8px");
    expect(result.edited.shadow).toBe("rgb(0, 255, 0) -3px 4px 6px"); expect(result.cancelled).toBe(true);
    expect(result.reset.size).toBe("15px"); expect(result.reset.shadow).toBe("none"); expect(result.reset.font).toContain("Consolas");
    expect(result.autoDark.stroke).toContain("rgb(255, 255, 255)"); expect(result.autoLight.stroke).toContain("rgb(0, 0, 0)"); expect(result.parentOutline.stroke).toContain("rgb(0, 0, 255)");
    expect(result.invalidBlocked).toBe(true); expect(result.imeKeptOpen).toBe(true); expect(result.fontFailureManual).toBe(true);
    expect(result.wide).toEqual({ overflow: false, footerVisible: true, scrollable: true });
    expect(result.narrow).toEqual({ overflow: false, footerVisible: true, scrollable: true }); expect(result.narrowBottom).toEqual(result.narrow);
    expect(result.applied[0]).toEqual({ fontName: "" }); expect(result.applied[1]).toBeNull(); expect(result.applied[2].fontName).toBe("Malgun Gothic");
  } finally {
    await new Promise<void>(resolve => { server.close(() => resolve()); });
    const resolved = path.resolve(temporary);
    if (!resolved.startsWith(`${scratchRoot}${path.sep}`)) throw new Error("DOM test scratch path escaped its workspace");
    await rm(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}, 45_000);
