import { spawn } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require=createRequire(import.meta.url);
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const folder=await mkdtemp(path.join(os.tmpdir(),'voicesubsep-worklet-smoke-'));
const env={...process.env,VOICESUBSEP_WORKLET_SMOKE_DIR:folder};delete env.ELECTRON_RUN_AS_NODE;
await new Promise((resolve,reject)=>{
  const child=spawn(require('electron'),[path.join(root,'scripts/live-worklet-smoke.cjs')],{cwd:root,env,shell:false,windowsHide:true,stdio:'inherit'});
  const timeout=setTimeout(()=>{child.kill();reject(new Error('Electron AudioWorklet smoke timed out.'));},30000);
  child.once('error',error=>{clearTimeout(timeout);reject(error);});
  child.once('exit',code=>{clearTimeout(timeout);code===0?resolve():reject(new Error(`Electron AudioWorklet smoke exited ${code}. Evidence directory: ${folder}`));});
});
console.log(await readFile(path.join(folder,'result.json'),'utf8'));
console.log(`Evidence: ${path.join(folder,'result.json')}`);
