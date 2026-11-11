// Real hidden Chromium/React interaction; synthetic fetch only, no external API.
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
if (process.versions.electron) {
  const { app, BrowserWindow } = require("electron");
  app.setPath("userData", process.env.VOICESUBSEP_VOCABULARY_PROFILE);
  app.whenReady().then(async () => {
    const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    try {
      await win.loadURL(process.argv[2]);
      const result = await win.webContents.executeJavaScript("(async()=>{for(let i=0;i<500&&!window.vocabularyResult;i++)await new Promise(r=>setTimeout(r,10));if(!window.vocabularyResult)throw Error('Harness not loaded');return await window.vocabularyResult;})()");
      process.stdout.write(`VOCABULARY_RESULT=${JSON.stringify(result)}\n`); win.destroy(); app.exit(0);
    } catch (error) { process.stderr.write(`${error.message}\n`); win.destroy(); app.exit(1); }
  });
} else {
  (async () => {
    const { build } = await import("vite"), { default: react } = await import("@vitejs/plugin-react");
    const { spawn } = require("node:child_process"), { pathToFileURL } = require("node:url");
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), "voicesubsep-vocabulary-")), root = path.resolve(__dirname, "..");
    try {
      const bundle = await build({ root, configFile: false, logLevel: "error", define: { "process.env.NODE_ENV": JSON.stringify("development") }, plugins: [react()], build: { write: false, minify: false, lib: { entry: path.join(__dirname, "fixtures/vocabulary.tsx"), name: "VocabularySmoke", formats: ["iife"] } } });
      const output = (Array.isArray(bundle) ? bundle : [bundle]).flatMap(item => item.output), entry = output.find(item => item.type === "chunk" && item.isEntry);
      if (!entry) throw Error("Missing browser bundle");
      fs.writeFileSync(path.join(profile, "harness.js"), entry.code);
      fs.writeFileSync(path.join(profile, "harness.html"), '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script src="./harness.js"></script></body></html>');
      const env = { ...process.env, VOICESUBSEP_VOCABULARY_PROFILE: profile }; delete env.ELECTRON_RUN_AS_NODE;
      const stdout = await new Promise((resolve, reject) => {
        const child = spawn(require("electron"), [__filename, pathToFileURL(path.join(profile, "harness.html")).href], { cwd: root, env, windowsHide: true, shell: false, stdio: ["ignore", "pipe", "pipe"] });
        let stdout = "", stderr = "";
        child.stdout.on("data", chunk => { stdout += chunk; }); child.stderr.on("data", chunk => { stderr += chunk; });
        const timer = setTimeout(() => { child.kill(); reject(Error("Vocabulary smoke timed out")); }, 30000);
        child.once("error", error => { clearTimeout(timer); reject(error); });
        child.once("exit", code => { clearTimeout(timer); code === 0 ? resolve(stdout) : reject(Error(`Vocabulary smoke exited ${code}: ${stderr.slice(-2500)}`)); });
      });
      const line = stdout.split(/\r?\n/).find(line => line.startsWith("VOCABULARY_RESULT="));
      if (!line) throw Error("Missing vocabulary smoke evidence");
      process.stdout.write(`${JSON.stringify({ passed: true, ...JSON.parse(line.slice("VOCABULARY_RESULT=".length)) }, null, 2)}\n`);
    } finally {
      const checked = path.resolve(profile);
      if (path.dirname(checked) === path.resolve(os.tmpdir()) && path.basename(checked).startsWith("voicesubsep-vocabulary-")) {
        try { fs.rmSync(checked, { recursive: true, force: true }); } catch { /* Chromium may briefly retain its fresh temp profile. */ }
      }
    }
  })().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
