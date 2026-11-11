// Actual src/main.tsx -> App integration. Fresh hidden Electron profile, fake
// read-only API replies, no server/model/user-media connection or UI source edits.
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
if (process.versions.electron) {
  const { app, BrowserWindow, session } = require("electron");
  app.setPath("userData", process.env.VOICESUBSEP_APP_SMOKE_PROFILE);
  app.whenReady().then(async () => {
    const errors = [], blocked = [], evidence = [];
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      const allowed = /^(file|data|blob|devtools):/u.test(details.url);
      if (!allowed) blocked.push(details.url);
      callback({ cancel: !allowed });
    });
    const win = new BrowserWindow({ show: false, width: 1440, height: 1000, useContentSize: true,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    win.webContents.on("console-message", (_event, level, message) => { if (level >= 2 && !message.startsWith("%cElectron Security Warning")) errors.push(message); });
    const evaluate = code => win.webContents.executeJavaScript(code, true);
    const until = async (code, label) => {
      for (let i = 0; i < 300; i++) { if (await evaluate(code)) return; await new Promise(resolve => setTimeout(resolve, 10)); }
      throw Error(`Timed out: ${label}`);
    };
    try {
      await win.loadURL(process.argv[2]);
      await until('!!Array.from(document.querySelectorAll(".workspace-tools button")).find(b=>b.textContent==="음성 보완 도구")', "Actual App toolbar");
      await evaluate('Array.from(document.querySelectorAll(".workspace-tools button")).find(b=>b.textContent==="음성 보완 도구").click()');
      await until('!!document.querySelector(".speech-tools") && document.querySelectorAll(".speech-tools [role=tab]").length===2', "Speech tools from App");
      for (const [name, width, height] of [["desktop", 1440, 1000], ["small", 680, 760]]) {
        win.setContentSize(width, height);
        await new Promise(resolve => setTimeout(resolve, 100));
        for (const [tab, label] of [["voice", "확인한 목소리"], ["overlap", "겹침 복원 실험"]]) {
          await evaluate(`Array.from(document.querySelectorAll('.speech-tools [role=tab]')).find(b=>b.textContent===${JSON.stringify(label)}).click()`);
          await until(`!!Array.from(document.querySelectorAll('.speech-tools [role=tab]')).find(b=>b.textContent===${JSON.stringify(label)}&&b.getAttribute('aria-selected')==='true')`, `${name} ${tab}`);
          // DOM state can commit before the hidden window's compositor paints.
          await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
          await new Promise(resolve => setTimeout(resolve, 50));
          const measured = await evaluate(`(()=>{const d=document.querySelector('[role=dialog]'),s=document.querySelector('.speech-tools'),f=s.querySelector('.dialog-actions'),r=d.getBoundingClientRect(),fr=f.getBoundingClientRect();return{width:innerWidth,height:innerHeight,bodyOverflow:document.documentElement.scrollWidth-innerWidth,dialogOverflow:d.scrollWidth-d.clientWidth,toolsOverflow:s.scrollWidth-s.clientWidth,dialogInside:r.left>=0&&r.right<=innerWidth+1,footerVisible:fr.top>=0&&fr.bottom<=innerHeight+1,activeTab:Array.from(s.querySelectorAll('[role=tab]')).find(b=>b.getAttribute('aria-selected')==='true').textContent,errorOverlay:!!document.querySelector('vite-error-overlay'),browserErrors:window.__appSmoke.errors,requests:window.__appSmoke.requests};})()`);
          if (measured.errorOverlay || measured.dialogOverflow > 1 || measured.toolsOverflow > 1 || !measured.dialogInside || !measured.footerVisible || measured.browserErrors.length) throw Error(`Invalid actual App layout: ${JSON.stringify(measured)}`);
          const screenshot = path.join(process.env.VOICESUBSEP_APP_SMOKE_OUTPUT, `app-${name}-${tab}.png`);
          fs.writeFileSync(screenshot, (await win.webContents.capturePage()).toPNG());
          evidence.push({ name, tab, ...measured, screenshot });
        }
      }
      await evaluate('Array.from(document.querySelectorAll(".speech-tools > .dialog-actions button")).find(b=>b.textContent==="결과를 적용하지 않고 닫기").click()');
      await until('!document.querySelector(".speech-tools") && !!document.querySelector(".workspace-tools")', "Return to actual editor");
      if (errors.length || blocked.length) throw Error(JSON.stringify({ consoleErrors: errors, unexpectedNetwork: blocked }));
      process.stdout.write(`APP_SPEECH_TOOLS_RESULT=${JSON.stringify({ passed: true, actualEntry: "src/main.tsx", actualAppToolbar: true, bothTabs: true, returnedToEditor: true, consoleErrors: errors, unexpectedNetwork: blocked, evidence })}\n`);
      win.destroy(); app.exit(0);
    } catch (error) { process.stderr.write(`${error.message}\n`); win.destroy(); app.exit(1); }
  });
} else {
  (async () => {
    const { build } = await import("vite"), { default: react } = await import("@vitejs/plugin-react");
    const { spawn, execFileSync } = require("node:child_process"), { pathToFileURL } = require("node:url");
    const root = path.resolve(__dirname, ".."), profile = fs.mkdtempSync(path.join(os.tmpdir(), "voicesubsep-app-smoke-"));
    const outputFolder = path.join(root, "tmp", "speech-tools-ui"); fs.mkdirSync(outputFolder, { recursive: true });
    try {
      const bundle = await build({ root, configFile: false, logLevel: "error", define: { "process.env.NODE_ENV": JSON.stringify("development") }, plugins: [react()],
        build: { write: false, minify: false, lib: { entry: path.join(root, "src/main.tsx"), name: "ActualVoiceSubSepApp", formats: ["iife"] } } });
      const output = (Array.isArray(bundle) ? bundle : [bundle]).flatMap(item => item.output), entry = output.find(item => item.type === "chunk" && item.isEntry);
      if (!entry) throw Error("Missing actual app entry bundle");
      for (const asset of output) {
        const destination = path.resolve(profile, asset.fileName);
        if (!destination.startsWith(profile + path.sep)) throw Error("Invalid generated asset path");
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.writeFileSync(destination, asset.type === "chunk" ? asset.code : asset.source);
      }
      const bootstrap = `window.__appSmoke={errors:[],requests:[]};window.addEventListener('error',e=>window.__appSmoke.errors.push(e.message));window.addEventListener('unhandledrejection',e=>window.__appSmoke.errors.push(String(e.reason)));localStorage.clear();localStorage.setItem('voicesubsep-ui-locale','ko');window.fetch=async(input,init)=>{const p=String(input),method=init?.method||'GET';window.__appSmoke.requests.push({path:p,method});if(method!=='GET')throw Error('Unexpected app mutation '+p);const body=p==='/api/history'?{items:[]}:p==='/api/speech-tools/status'?{voice:{runtimeAvailable:false,ready:false,issue:null},overlap:{runtimeAvailable:false,ready:false,issue:null}}:null;if(!body)throw Error('Unexpected app request '+p);return new Response(JSON.stringify(body),{status:200,headers:{'Content-Type':'application/json'}});};`;
      const styles = output.filter(item => item.type === "asset" && item.fileName.endsWith(".css")).map(item => `<link rel="stylesheet" href="./${item.fileName}">`).join("");
      fs.writeFileSync(path.join(profile, "index.html"), `<!doctype html><html><head><meta charset="utf-8">${styles}</head><body><div id="root"></div><script>${bootstrap}</script><script src="./${entry.fileName}"></script></body></html>`);
      const env = { ...process.env, VOICESUBSEP_APP_SMOKE_PROFILE: profile, VOICESUBSEP_APP_SMOKE_OUTPUT: outputFolder };
      for (const key of ["ELECTRON_RUN_AS_NODE", "NODE_OPTIONS", "NODE_PATH", "ELECTRON_EXTRA_LAUNCH_ARGS"]) delete env[key];
      const stdout = await new Promise((resolve, reject) => {
        const child = spawn(require("electron"), [__filename, pathToFileURL(path.join(profile, "index.html")).href], { cwd: root, env, windowsHide: true, shell: false, stdio: ["ignore", "pipe", "pipe"] });
        let stdout = "", stderr = "";
        child.stdout.on("data", chunk => { stdout += chunk; }); child.stderr.on("data", chunk => { stderr += chunk; });
        const timer = setTimeout(() => { if (process.platform === "win32") { try { execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }); } catch {} } else child.kill(); reject(Error("Actual App smoke timed out")); }, 45000);
        child.once("error", error => { clearTimeout(timer); reject(error); });
        child.once("exit", code => { clearTimeout(timer); code === 0 ? resolve(stdout) : reject(Error(`Actual App smoke exited ${code}: ${stderr.slice(-3500)}`)); });
      });
      const line = stdout.split(/\r?\n/).find(line => line.startsWith("APP_SPEECH_TOOLS_RESULT="));
      if (!line) throw Error("Missing actual App smoke evidence");
      const result = JSON.parse(line.slice("APP_SPEECH_TOOLS_RESULT=".length));
      fs.writeFileSync(path.join(outputFolder, "app-smoke-result.json"), JSON.stringify(result, null, 2));
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } finally {
      const checked = path.resolve(profile);
      if (path.dirname(checked) === path.resolve(os.tmpdir()) && path.basename(checked).startsWith("voicesubsep-app-smoke-")) {
        try { fs.rmSync(checked, { recursive: true, force: true }); } catch { /* Only this fresh disposable Chromium profile is eligible for cleanup. */ }
      }
    }
  })().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
