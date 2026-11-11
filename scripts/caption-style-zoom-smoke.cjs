// Actual src/main.tsx -> App, a synthetic project and a disposable Chromium
// profile. Only history is mocked; installed fonts use the real desktop service.
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const PREFIX = "CAPTION_STYLE_ZOOM_RESULT=";

if (process.versions.electron) {
  const { app, BrowserWindow, session, ipcMain } = require("electron");
  const { createInstalledFontsService } = require("../desktop/installed-fonts.cjs");
  app.setPath("userData", process.env.VOICESUBSEP_STYLE_ZOOM_PROFILE);
  app.whenReady().then(async () => {
    const errors = [], blocked = [], evidence = [], ipc = [];
    const listFonts = createInstalledFontsService();
    ipcMain.handle("desktop:version", () => { ipc.push("version"); return require("../package.json").version; });
    ipcMain.handle("desktop:update-status", () => { ipc.push("update-status"); return { state: "unconfigured", configured: false, currentVersion: require("../package.json").version }; });
    ipcMain.handle("desktop:list-fonts", async () => { const result = await listFonts(); ipc.push({ command: "list-fonts", available: result.available, count: result.fonts.length }); return result; });
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      const allowed = /^(file|data|blob|devtools):/u.test(details.url) || new URL(details.url).origin === new URL(process.env.VOICESUBSEP_STYLE_ZOOM_URL).origin;
      if (!allowed) blocked.push(details.url);
      callback({ cancel: !allowed });
    });
    const win = new BrowserWindow({ show: false, frame: false, width: 1440, height: 1000, useContentSize: true,
      webPreferences: { preload: path.resolve(__dirname, "../desktop/preload.cjs"), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, spellcheck: false } });
    win.webContents.on("console-message", (_event, level, message) => {
      const severity = typeof level === "object" ? level.level : level;
      const detail = typeof level === "object" ? level.message : message;
      if (severity >= 2 && detail && !detail.startsWith("%cElectron Security Warning")) errors.push(detail);
    });
    const evaluate = code => win.webContents.executeJavaScript(code, true);
    const settle = () => evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
    const resize = async (width, height) => {
      win.setContentSize(width, height); await settle();
      const actual = await evaluate("({width:innerWidth,height:innerHeight})");
      if (actual.width !== width || actual.height !== height) { win.setContentSize(width * 2 - actual.width, height * 2 - actual.height); await settle(); }
    };
    const until = async (code, label, timeout = 12000) => {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) { if (await evaluate(code)) return; await new Promise(resolve => setTimeout(resolve, 30)); }
      throw Error(`Timed out: ${label}`);
    };
    const assert = (condition, detail) => { if (!condition) throw Error(detail); };
    const button = (label, scope = ".caption-style-editor") => `[...document.querySelectorAll(${JSON.stringify(`${scope} button`)})].find(el=>el.textContent.trim()===${JSON.stringify(label)})`;
    const click = async (label, scope) => { await evaluate(`${button(label, scope)}.click()`); await settle(); };
    const field = async (label, value, tag = "input") => {
      await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(`${tag}[aria-label="${label}"]`)});if(!el)throw Error('Missing field '+${JSON.stringify(label)});Object.getOwnPropertyDescriptor(${tag === "select" ? "HTMLSelectElement" : "HTMLInputElement"}.prototype,'value').set.call(el,${JSON.stringify(String(value))});el.dispatchEvent(new Event(${JSON.stringify(tag === "select" ? "change" : "input")},{bubbles:true}));})()`);
      await settle();
    };
    const toggle = async label => { await evaluate(`[...document.querySelectorAll('.style-effect-section legend label')].find(el=>el.textContent.trim()===${JSON.stringify(label)}).querySelector('input').click()`); await settle(); };
    const capture = async name => { await settle(); const target = path.join(process.env.VOICESUBSEP_STYLE_ZOOM_OUTPUT, `app-${name}.png`); fs.writeFileSync(target, (await win.webContents.capturePage()).toPNG()); return target; };
    const savedStyle = () => evaluate("JSON.parse(localStorage.getItem('voicesubsep.project.v1')).speakers[0].subtitleStyle??null");
    const openStyle = async () => { await evaluate(`document.querySelector('[aria-label="인물 1 자막 스타일"]').click()`); await until("!!document.querySelector('.caption-style-editor')", "Actual Sidebar style dialog"); await settle(); };
    const layout = () => evaluate(`(()=>{const dialog=document.querySelector('[role=dialog]'),scroll=document.querySelector('.caption-style-scroll'),footer=document.querySelector('.caption-style-editor .dialog-actions');const r=dialog.getBoundingClientRect(),f=footer.getBoundingClientRect();return{width:innerWidth,height:innerHeight,bodyOverflow:document.documentElement.scrollWidth-innerWidth,dialogOverflow:dialog.scrollWidth-dialog.clientWidth,scrollOverflow:scroll.scrollWidth-scroll.clientWidth,dialogInside:r.left>=0&&r.right<=innerWidth+1&&r.top>=0&&r.bottom<=innerHeight+1,footerVisible:f.top>=0&&f.bottom<=innerHeight+1,footerButtons:[...footer.querySelectorAll('button')].map(b=>{const r=b.getBoundingClientRect();return{text:b.textContent.trim(),inside:r.left>=0&&r.right<=innerWidth+1&&r.top>=0&&r.bottom<=innerHeight+1}})}})()`);
    const checkLayout = measured => assert(measured.dialogOverflow <= 1 && measured.scrollOverflow <= 1 && measured.dialogInside && measured.footerVisible && measured.footerButtons.every(button => button.inside), `Invalid style layout ${JSON.stringify(measured)}`);
    let result;
    try {
      await win.loadURL(process.env.VOICESUBSEP_STYLE_ZOOM_URL);
      await resize(1440, 1000);
      await until("document.querySelectorAll('.caption-density-canvas').length===2&&!!document.querySelector('[aria-label=\"인물 1 자막 스타일\"]')", "Actual App synthetic dense project");
      await openStyle();
      await click("설치 글꼴 불러오기");
      await until("document.querySelectorAll('.caption-style-editor datalist option').length>20", "Actual Windows installed font enumeration", 20000);
      const fonts = await evaluate("[...document.querySelectorAll('.caption-style-editor datalist option')].map(el=>el.value)");
      const selectedFont = fonts.includes("Consolas") ? "Consolas" : "Malgun Gothic";
      assert(fonts.includes(selectedFont), "Expected local Windows font unavailable");
      await field("글꼴 이름", selectedFont);
      await toggle("글자 테두리");
      await field("테두리 두께", 3); await field("테두리 색상", "#123456");
      await toggle("글자 그림자");
      await field("그림자 색상", "#abcdef"); await field("그림자 흐림", 5);
      await field("그림자 가로 거리", -4); await field("그림자 세로 거리", 6);
      const computed = await evaluate(`(()=>{const root=document.querySelector('.style-preview'),text=root.querySelector('.caption-text'),badge=root.querySelector('.preview-speaker'),style=getComputedStyle(text),name=getComputedStyle(badge);return{fontFamily:style.fontFamily,strokeWidth:style.webkitTextStrokeWidth,strokeColor:style.webkitTextStrokeColor,shadow:style.textShadow,badgeStroke:name.webkitTextStrokeWidth,badgeShadow:name.textShadow}})()`);
      assert(computed.fontFamily.includes(selectedFont) && computed.strokeWidth === "6px" && computed.strokeColor === "rgb(18, 52, 86)" && computed.shadow.includes("rgb(171, 205, 239)") && computed.shadow.includes("-4px 6px 5px") && computed.badgeStroke === "0px" && computed.badgeShadow === "none", `Unexpected computed style ${JSON.stringify(computed)}`);
      const desktopLayout = await layout(); checkLayout(desktopLayout);
      evidence.push({ stage: "desktop-style-preview", installedFontCount: fonts.length, selectedFont, computed, layout: desktopLayout, screenshot: await capture("desktop-style") });
      await click("적용");
      await until("!document.querySelector('.caption-style-editor')&&JSON.parse(localStorage.getItem('voicesubsep.project.v1')).speakers[0].subtitleStyle?.shadowOffsetX===-4", "Applied style autosave");
      const applied = await savedStyle();
      assert(applied.fontName === selectedFont && applied.outline === true && applied.outlineWidth === 3 && applied.outlineColor === "#123456" && applied.shadow === true && applied.shadowColor === "#abcdef" && applied.shadowBlur === 5 && applied.shadowOffsetX === -4 && applied.shadowOffsetY === 6, `Applied style differs ${JSON.stringify(applied)}`);
      await openStyle();
      const reopened = await evaluate("Object.fromEntries([...document.querySelectorAll('.caption-style-editor [aria-label]')].filter(el=>'value'in el).map(el=>[el.getAttribute('aria-label'),el.value]))");
      assert(reopened["글꼴 이름"] === selectedFont && reopened["테두리 두께"] === "3" && reopened["그림자 가로 거리"] === "-4", `Reopened controls differ ${JSON.stringify(reopened)}`);
      await field("그림자 흐림", 9); await click("취소");
      assert(JSON.stringify(await savedStyle()) === JSON.stringify(applied), "Cancel changed persisted style");
      evidence.push({ stage: "apply-autosave-reopen-cancel", applied, reopened, cancelPreserved: true });
      await resize(390, 844);
      const mobileEditor = await evaluate("({width:innerWidth,bodyOverflow:document.documentElement.scrollWidth-innerWidth,offenders:[...document.querySelectorAll('body *')].map(el=>({tag:el.tagName,class:el.className,left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right,width:el.getBoundingClientRect().width})).filter(el=>el.right>innerWidth+1&&el.width>0&&el.width<2000).slice(0,30)})");
      evidence.push({ stage: "mobile-editor-before-dialog", ...mobileEditor });
      await evaluate("(()=>{const toggle=document.querySelector('.sidebar-compact-toggle');if(toggle.getAttribute('aria-expanded')!=='true')toggle.click()})()"); await settle();
      await openStyle();
      const mobileTop = await layout(); checkLayout(mobileTop);
      evidence.push({ stage: "mobile-style-top", layout: mobileTop, screenshot: await capture("mobile-style-top") });
      await evaluate("(()=>{const scroll=document.querySelector('.caption-style-scroll');scroll.scrollTop=scroll.scrollHeight})()"); await settle();
      const mobileBottom = await layout(); checkLayout(mobileBottom);
      evidence.push({ stage: "mobile-style-bottom", layout: mobileBottom, screenshot: await capture("mobile-style-bottom") });
      await click("기본값으로 되돌리기");
      await until("document.querySelector('[aria-label=\"글꼴 이름\"]').value===''&&document.querySelector('[aria-label=\"그림자 흐림\"]').disabled", "Reset to inherited defaults");
      await click("적용");
      await until("!document.querySelector('.caption-style-editor')&&!JSON.parse(localStorage.getItem('voicesubsep.project.v1')).speakers[0].subtitleStyle", "Reset autosave");
      evidence.push({ stage: "reset-autosave", subtitleStyle: await savedStyle() });
      await resize(320, 844);
      const narrowHeader = await evaluate("({width:innerWidth,bodyOverflow:document.documentElement.scrollWidth-innerWidth,buttons:[...document.querySelectorAll('.header-actions button')].filter(button=>button.getBoundingClientRect().width>0).map(button=>{const r=button.getBoundingClientRect();return{text:button.textContent.trim()||button.getAttribute('aria-label'),left:r.left,right:r.right,inside:r.left>=0&&r.right<=innerWidth+1}})})");
      assert(narrowHeader.bodyOverflow <= 1 && narrowHeader.buttons.every(button => button.inside), `Header overflow at320px ${JSON.stringify(narrowHeader)}`);
      evidence.push({ stage: "mobile-header-320", ...narrowHeader, screenshot: await capture("mobile-header320") });
      await resize(1440, 1000);
      await until("!!document.querySelector('select[aria-label=\"타임라인 확대 비율\"]')", "Desktop zoom controls");
      const zoomLevels = [];
      for (const zoom of [1, 8, 16, 32, 64]) {
        await field("타임라인 확대 비율", zoom, "select");
        const geometry = await evaluate(`(()=>{const s=document.querySelector('.timeline-scroll');return{zoom:Number(document.querySelector('select[aria-label="타임라인 확대 비율"]').value),scrollWidth:s.scrollWidth,viewportWidth:s.clientWidth,minWidth:document.querySelector('.timeline-content').style.minWidth,outDisabled:document.querySelector('[aria-label="타임라인 축소"]').disabled,inDisabled:document.querySelector('[aria-label="타임라인 확대"]').disabled}})()`);
        assert(geometry.zoom === zoom && geometry.minWidth === `${zoom * 100}%` && geometry.outDisabled === (zoom === 1) && geometry.inDisabled === (zoom === 64), `Invalid zoom control ${JSON.stringify(geometry)}`); zoomLevels.push(geometry);
      }
      await field("타임라인 확대 비율", 32, "select");
      await evaluate("document.querySelector('[aria-label=\"타임라인 축소\"]').click()"); await settle();
      assert(await evaluate("document.querySelector('select[aria-label=\"타임라인 확대 비율\"]').value==='16'"), "Zoom-out button did not halve the zoom");
      await evaluate("document.querySelector('[aria-label=\"타임라인 확대\"]').click()"); await settle();
      assert(await evaluate("document.querySelector('select[aria-label=\"타임라인 확대 비율\"]').value==='32'"), "Zoom-in button did not double the zoom");
      await field("타임라인 확대 비율", 8, "select");
      await evaluate("(()=>{const s=document.querySelector('.timeline-scroll');s.scrollLeft=Math.floor((s.scrollWidth-s.clientWidth)*.47)})()"); await settle();
      const center = () => evaluate("(()=>{const s=document.querySelector('.timeline-scroll'),r=document.querySelector('.timeline-ruler').getBoundingClientRect(),v=s.getBoundingClientRect();return{time:(v.left+s.clientLeft+s.clientWidth/2-r.left)/r.width*600,scrollLeft:s.scrollLeft}})()");
      const before = await center();
      await field("타임라인 확대 비율", 64, "select");
      const after = await center();
      assert(Math.abs(after.time - before.time) < .015 && after.scrollLeft > before.scrollLeft, `Viewed source-time anchor moved ${JSON.stringify({ before, after })}`);
      const raster = await evaluate("[...document.querySelectorAll('.caption-density-canvas')].map(canvas=>({width:canvas.width,height:canvas.height,cssWidth:canvas.getBoundingClientRect().width,dpr:devicePixelRatio,viewportWidth:document.querySelector('.timeline-scroll').clientWidth}))");
      assert(raster.length === 2 && raster.every(tile => Math.abs(tile.width / tile.cssWidth - tile.dpr) < .001 && tile.cssWidth <= tile.viewportWidth + 194 && tile.width * tile.height * 4 < 2_000_000), `Unbounded or low-resolution raster ${JSON.stringify(raster)}`);
      await evaluate("(()=>{const s=document.querySelector('.timeline-scroll').getBoundingClientRect();const ticks=[...document.querySelectorAll('.timeline-ruler button')].filter(button=>{const r=button.getBoundingClientRect();return r.left>s.left+100&&r.right<s.right-100});ticks[Math.floor(ticks.length/2)].click()})()"); await settle();
      const playheadX = () => evaluate("document.querySelector('.lane-track .playhead').getBoundingClientRect().left-document.querySelector('.timeline-scroll').getBoundingClientRect().left");
      const playheadBefore = await playheadX(); await field("타임라인 확대 비율", 32, "select");
      const playheadAfter = await playheadX();
      assert(Math.abs(playheadAfter-playheadBefore) <= 1, `Visible playhead moved while zooming ${JSON.stringify({ playheadBefore, playheadAfter })}`);
      await field("타임라인 확대 비율", 64, "select");
      evidence.push({ stage: "timeline-64x", zoomLevels, buttonDoubling: true, before, after, sourceTimeErrorSeconds: Math.abs(after.time - before.time), visiblePlayhead: { before: playheadBefore, after: playheadAfter, errorPixels: Math.abs(playheadAfter-playheadBefore) }, raster, screenshot: await capture("desktop-timeline64") });
      const environment = await evaluate("({browserErrors:window.__styleZoomSmoke.errors,requests:window.__styleZoomSmoke.requests,projectCaptions:JSON.parse(localStorage.getItem('voicesubsep.project.v1')).captions.length,bodyOverflow:document.documentElement.scrollWidth-innerWidth,brandImageLoaded:document.querySelector('.brand-icon').naturalWidth>0})");
      assert(environment.projectCaptions === 2000 && environment.bodyOverflow <= 1 && environment.brandImageLoaded && !environment.browserErrors.length && !errors.length && !blocked.length, `Unexpected actual App environment ${JSON.stringify({ environment, errors, blocked })}`);
      assert(mobileTop.bodyOverflow <= 1 && mobileBottom.bodyOverflow <= 1, `Mobile editor document overflows behind the contained style dialog: ${JSON.stringify(mobileEditor)}`);
      result = { passed: true, actualEntry: "src/main.tsx", actualSidebar: true, actualPreload: true, actualInstalledFonts: true, noMedia: true, environment, ipc, errors, blocked, evidence };
    } catch (error) {
      result = { passed: false, error: error.stack || error.message, errors, blocked, ipc, evidence };
      try { result.screenshot = await capture("failure"); result.browser = await evaluate("({errors:window.__styleZoomSmoke?.errors,text:document.body.innerText.slice(-4000)})"); } catch {}
    }
    process.stdout.write(`${PREFIX}${JSON.stringify(result)}\n`);
    win.destroy(); app.exit(result.passed ? 0 : 1);
  }).catch(error => { process.stderr.write(`${error.stack}\n`); app.exit(1); });
} else {
  (async () => {
    const { build } = await import("vite"), { default: react } = await import("@vitejs/plugin-react");
    const { spawn, execFileSync } = require("node:child_process"), { createServer } = require("node:http");
    const root = path.resolve(__dirname, ".."), profile = fs.mkdtempSync(path.join(os.tmpdir(), "voicesubsep-style-zoom-"));
    const outputFolder = path.join(root, "tmp", "caption-style-zoom-smoke"); fs.mkdirSync(outputFolder, { recursive: true });
    let server;
    try {
      const bundle = await build({ root, configFile: false, logLevel: "error", define: { "process.env.NODE_ENV": JSON.stringify("development") }, plugins: [react()],
        build: { write: false, minify: false, lib: { entry: path.join(root, "src/main.tsx"), name: "ActualVoiceSubSepApp", formats: ["iife"] } } });
      const output = (Array.isArray(bundle) ? bundle : [bundle]).flatMap(item => item.output), entry = output.find(item => item.type === "chunk" && item.isEntry);
      if (!entry) throw Error("Missing actual App bundle");
      for (const asset of output) {
        const destination = path.resolve(profile, asset.fileName);
        if (!destination.startsWith(profile + path.sep)) throw Error("Invalid generated asset path");
        fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.writeFileSync(destination, asset.type === "chunk" ? asset.code : asset.source);
      }
      const seed = { schemaVersion: 1, id: "caption-style-zoom-smoke", name: "Synthetic caption style and zoom smoke", mediaName: null, duration: 600, mode: "overlap", speakerCount: 2,
        speakers: [{ id: "speaker-1", name: "테스트 인물 A", color: "#a78bfa" }, { id: "speaker-2", name: "테스트 인물 B", color: "#fbbf24" }],
        captions: Array.from({ length: 2000 }, (_, index) => ({ id: `cue-${index}`, start: Number((index * .3).toFixed(3)), end: Number((index * .3 + .25).toFixed(3)), text: `합성 타임라인 자막 ${index + 1}`, speakerId: `speaker-${index % 2 + 1}`, reviewed: true, reasons: [] })), notes: [], updatedAt: "2026-11-11T00:00:00.000Z" };
      const bootstrap = `window.__styleZoomSmoke={errors:[],requests:[]};window.addEventListener('error',event=>window.__styleZoomSmoke.errors.push(event.message));window.addEventListener('unhandledrejection',event=>window.__styleZoomSmoke.errors.push(String(event.reason)));localStorage.clear();localStorage.setItem('voicesubsep-ui-locale','ko');localStorage.setItem('voicesubsep-editor-focus-v1','false');localStorage.setItem('voicesubsep-editor-focus-narrow-v1','false');localStorage.setItem('voicesubsep.project.v1',${JSON.stringify(JSON.stringify(seed))});window.fetch=async(input,init)=>{const pathname=String(input),method=init?.method||'GET';window.__styleZoomSmoke.requests.push({pathname,method});if(method!=='GET'||pathname!=='/api/history')throw Error('Unexpected App request '+method+' '+pathname);return new Response(JSON.stringify({items:[]}),{status:200,headers:{'Content-Type':'application/json'}});};`;
      const styles = output.filter(item => item.type === "asset" && item.fileName.endsWith(".css")).map(item => `<link rel="stylesheet" href="./${item.fileName}">`).join("");
      fs.writeFileSync(path.join(profile, "index.html"), `<!doctype html><html><head><meta charset="utf-8">${styles}</head><body><div id="root"></div><script>${bootstrap}</script><script src="./${entry.fileName}"></script></body></html>`);
      for (const asset of ["app-icon.png", "favicon.ico", "favicon.png"]) fs.copyFileSync(path.join(root, "public", asset), path.join(profile, asset));
      server = createServer((request, response) => {
        try {
          const pathname = decodeURIComponent(new URL(request.url || "/", "http://127.0.0.1").pathname);
          const target = path.resolve(profile, `.${pathname === "/" ? "/index.html" : pathname}`);
          if (!target.startsWith(profile + path.sep)) throw Error("Invalid asset path");
          const body = fs.readFileSync(target);
          response.setHeader("Content-Type", target.endsWith(".js") ? "text/javascript" : target.endsWith(".css") ? "text/css" : target.endsWith(".png") ? "image/png" : target.endsWith(".ico") ? "image/x-icon" : "text/html");
          response.end(body);
        } catch { response.writeHead(404); response.end(); }
      });
      await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
      const env = { ...process.env, VOICESUBSEP_STYLE_ZOOM_PROFILE: profile, VOICESUBSEP_STYLE_ZOOM_OUTPUT: outputFolder, VOICESUBSEP_STYLE_ZOOM_URL: `http://127.0.0.1:${server.address().port}/` };
      for (const key of ["ELECTRON_RUN_AS_NODE", "NODE_OPTIONS", "NODE_PATH", "ELECTRON_EXTRA_LAUNCH_ARGS"]) delete env[key];
      const execution = await new Promise((resolve, reject) => {
        const child = spawn(require("electron"), [__filename], { cwd: root, env, windowsHide: true, shell: false, stdio: ["ignore", "pipe", "pipe"] });
        let stdout = "", stderr = "";
        child.stdout.on("data", chunk => { stdout += chunk; }); child.stderr.on("data", chunk => { stderr += chunk; });
        const timer = setTimeout(() => { if (process.platform === "win32") { try { execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }); } catch {} } else child.kill(); reject(Error("Actual App caption style/zoom smoke timed out")); }, 120000);
        child.once("error", error => { clearTimeout(timer); reject(error); });
        child.once("exit", code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
      });
      const line = execution.stdout.split(/\r?\n/).find(line => line.startsWith(PREFIX));
      if (!line) throw Error(`Missing smoke evidence; exit ${execution.code}: ${execution.stderr.slice(-4000)}`);
      const result = JSON.parse(line.slice(PREFIX.length));
      fs.writeFileSync(path.join(outputFolder, "app-smoke-result.json"), JSON.stringify(result, null, 2));
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      if (!result.passed || execution.code !== 0) throw Error(`Actual App caption style/zoom smoke failed: ${result.error}`);
    } finally {
      if (server) await new Promise(resolve => server.close(resolve));
      const checked = path.resolve(profile);
      if (path.dirname(checked) === path.resolve(os.tmpdir()) && path.basename(checked).startsWith("voicesubsep-style-zoom-")) {
        try { fs.rmSync(checked, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* Only this fresh disposable profile is eligible for cleanup. */ }
      }
    }
  })().catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
}
