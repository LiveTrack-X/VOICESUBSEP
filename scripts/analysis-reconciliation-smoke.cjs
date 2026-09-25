// node scripts/analysis-reconciliation-smoke.cjs
// Real hidden Chromium/React DOM; isolated profile, fake GET responses, no backend.
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

if (process.versions.electron) {
  const { app, BrowserWindow } = require("electron");
  app.setPath("userData", process.env.VOICESUBSEP_RECONCILE_PROFILE);
  app.whenReady().then(async () => {
    const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    try {
      await win.loadURL(process.argv[2]);
      const result = await win.webContents.executeJavaScript(`(async()=>{for(let i=0;i<500&&!window.reconciliationResult;i++)await new Promise(r=>setTimeout(r,10));if(!window.reconciliationResult)throw Error('Harness failed to load');return await window.reconciliationResult;})()`);
      process.stdout.write(`RECONCILIATION_RESULT=${JSON.stringify(result)}\n`);
      win.destroy(); app.exit(0);
    } catch (error) { process.stderr.write(`${error.message}\n`); win.destroy(); app.exit(1); }
  });
} else {
  (async () => {
    const { build } = await import("vite");
    const { default: react } = await import("@vitejs/plugin-react");
    const { spawn } = require("node:child_process");
    const root = path.resolve(__dirname, "..");
    const results = [];
    for (const legacy of [true, false]) {
      const profile = fs.mkdtempSync(path.join(os.tmpdir(), "voicesubsep-reconciliation-"));
      const bundle = await build({ root, configFile: false, logLevel: "error", define: { "process.env.NODE_ENV": JSON.stringify("development") }, plugins: [
        { name: "reproduce-old-sibling-keys", enforce: "pre", transform(source, id) {
          if (!legacy || !/\/(BackgroundJobStatus|JobHistoryDialog)\.tsx$/.test(id.replaceAll("\\", "/"))) return;
          return source.replaceAll('key={`queue-${job.id}`}', 'key={job.id}').replaceAll('key={`details-${job.id}`}', 'key={job.id}')
            .replaceAll('key={`queue-${analysis.job.id}`}', 'key={analysis.job.id}').replaceAll('key={`details-${analysis.job.id}`}', 'key={analysis.job.id}');
        } }, react(),
      ], build: { write: false, minify: false, lib: { entry: path.join(__dirname, "fixtures/analysis-reconciliation.tsx"), name: "AnalysisReconciliation", formats: ["iife"] } } });
      try {
        const output = (Array.isArray(bundle) ? bundle : [bundle]).flatMap(item => item.output);
        const entry = output.find(item => item.type === "chunk" && item.isEntry);
        if (!entry) throw Error("Missing test-only browser bundle");
        fs.writeFileSync(path.join(profile, "harness.js"), entry.code);
        fs.writeFileSync(path.join(profile, "harness.html"), '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script src="./harness.js"></script></body></html>');
        const { pathToFileURL } = require("node:url");
        const url = pathToFileURL(path.join(profile, "harness.html")); if (legacy) url.search = "legacy=1";
        const env = { ...process.env, VOICESUBSEP_RECONCILE_PROFILE: profile }; delete env.ELECTRON_RUN_AS_NODE;
        const stdout = await new Promise((resolve, reject) => {
          const child = spawn(require("electron"), [__filename, url.href], { cwd: root, env, windowsHide: true, shell: false, stdio: ["ignore", "pipe", "pipe"] });
          let stdout = "", stderr = "";
          child.stdout.on("data", data => { stdout += data; }); child.stderr.on("data", data => { stderr += data; });
          const timer = setTimeout(() => { child.kill(); reject(Error("Reconciliation smoke timed out")); }, 30000);
          child.once("error", error => { clearTimeout(timer); reject(error); });
          child.once("exit", code => { clearTimeout(timer); code === 0 ? resolve(stdout) : reject(Error(`Reconciliation smoke exited ${code}: ${stderr.slice(-2000)}`)); });
        });
        const line = stdout.split(/\r?\n/).find(line => line.startsWith("RECONCILIATION_RESULT="));
        if (!line) throw Error("Missing reconciliation evidence");
        results.push(JSON.parse(line.slice("RECONCILIATION_RESULT=".length)));
      } finally {
        // This process created the exact fresh profile; never touch app data.
        const checked = path.resolve(profile);
        if (path.dirname(checked) === path.resolve(os.tmpdir()) && path.basename(checked).startsWith("voicesubsep-reconciliation-")) {
          try { fs.rmSync(checked, { recursive: true, force: true }); } catch { /* A transient Chromium lock may delay temp cleanup. */ }
        }
      }
    }
    process.stdout.write(`${JSON.stringify({ passed: true, scenarios: results }, null, 2)}\n`);
  })().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
