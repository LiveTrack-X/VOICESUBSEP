// Real Electron/Chromium AudioWorklet smoke, with no microphone or screen input.
// Run through: node scripts/run-live-worklet-smoke.mjs
const { app, BrowserWindow, protocol, session } = require('electron');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { APP_URL } = require('../desktop/helpers.cjs');
const { createProxyHandler } = require('../desktop/proxy.cjs');

const root = path.resolve(__dirname, '..');
const profile = process.env.VOICESUBSEP_WORKLET_SMOKE_DIR;
if (!profile) throw new Error('Run node scripts/run-live-worklet-smoke.mjs.');
app.setPath('userData', profile);
protocol.registerSchemesAsPrivileged([{ scheme: 'voicesubsep', privileges: {
  standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true,
} }]);
let server;
let window;
async function run() {
  const assets = path.join(root, 'dist', 'assets');
  const matches = fs.readdirSync(assets).filter(name => /^live-pcm-worklet-[\w-]+\.js$/.test(name));
  assert.equal(matches.length, 1, 'Build must contain one external worklet JS asset, not a data URL.');
  const assetName = matches[0]; const asset = fs.readFileSync(path.join(assets, assetName));
  const permissions = [], permissionChecks = [];
  session.defaultSession.setPermissionRequestHandler((_web, permission, callback) => { permissions.push(permission); callback(false); });
  session.defaultSession.setPermissionCheckHandler((_web, permission) => { permissionChecks.push(permission); return false; });
  server = http.createServer((request, response) => {
    if (request.url === `/assets/${assetName}`) { response.setHeader('Content-Type', 'text/javascript; charset=utf-8'); response.end(asset); }
    else if (request.url === '/') { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end('<!doctype html><html><head><title>Isolated synthetic AudioWorklet smoke</title></head><body></body></html>'); }
    else { response.writeHead(404); response.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  protocol.handle('voicesubsep', createProxyHandler(origin, (url, options) => fetch(url, options)));
  window = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
  await window.loadURL(APP_URL);
  const result = await window.webContents.executeJavaScript(`(async () => {
    const assetUrl = ${JSON.stringify(`/assets/${assetName}`)};
    let deviceCalls=0;
    for(const name of ['getUserMedia','getDisplayMedia'])Object.defineProperty(navigator.mediaDevices,name,{value:()=>{deviceCalls++;throw new Error('Physical capture is forbidden in this synthetic harness.');}});
    const response = await fetch(assetUrl); const csp = response.headers.get('content-security-policy');
    const context = new AudioContext({sampleRate: 48000});
    const frames = [];
    let levels = 0, peak = 0, rms = 0, stopped = false, timeout;
    try {
      await context.audioWorklet.addModule(assetUrl);
      const node = new AudioWorkletNode(context, 'voicesubsep-live-pcm', {numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1]});
      const mute = context.createGain(); mute.gain.value = 0; node.connect(mute).connect(context.destination);
      const source = context.createBufferSource();
      const buffer = context.createBuffer(2, 48000 * 1.25, 48000);
      for (let channel=0;channel<2;channel++) { const samples=buffer.getChannelData(channel); for(let i=0;i<samples.length;i++) samples[i]=.25*Math.sin(2*Math.PI*440*i/48000); }
      source.buffer = buffer; source.connect(node);
      const completed = new Promise((resolve,reject) => {
        timeout = setTimeout(()=>reject(new Error('Worklet did not finish.')),8000);
        node.onprocessorerror=()=>reject(new Error('AudioWorklet processor error.'));
        node.port.onmessage=({data})=>{
          if(data.type==='pcm') frames.push(new Int16Array(data.buffer));
          if(data.type==='level'){levels++;peak=Math.max(peak,data.peak);rms=Math.max(rms,data.rms);}
          if(data.type==='stopped'){stopped=true;clearTimeout(timeout);resolve();}
        };
      });
      source.onended=()=>node.port.postMessage('stop');
      node.port.postMessage('start'); source.start(); await context.resume(); await completed;
      node.port.close(); source.disconnect(); node.disconnect(); mute.disconnect();
      const samples=frames.reduce((count,chunk)=>count+chunk.length,0);
      let nonzero=0,maxSample=0;for(const chunk of frames)for(const value of chunk){if(value!==0)nonzero++;maxSample=Math.max(maxSample,Math.abs(value));}
      return {origin:location.href,secure:isSecureContext,node:typeof require,sampleRate:context.sampleRate,csp,stopped,packetSizes:frames.map(chunk=>chunk.length),samples,nonzero,maxSample,levels,peak,rms,monitorGain:mute.gain.value,deviceCalls};
    } finally {clearTimeout(timeout);await context.close();}
  })()`, true);
  assert.equal(result.origin, APP_URL); assert.equal(result.secure, true); assert.equal(result.node, 'undefined');
  assert.match(result.csp, /script-src 'self';/); assert.equal(result.csp.includes('script-src \'self\' data:'), false);
  assert.equal(result.stopped, true); assert.equal(result.monitorGain, 0); assert.equal(result.sampleRate, 48000);
  assert.ok(result.packetSizes.length >= 3); assert.ok(result.packetSizes.every(size=>size>0&&size<=8000));
  // Real-time scheduling adds at most a few render quanta of leading/trailing silence.
  assert.ok(result.samples >= 19500 && result.samples <= 24000, `Unexpected duration ${result.samples/16000}`);
  assert.ok(result.nonzero > 18000); assert.ok(result.maxSample > 7000 && result.maxSample < 9000);
  assert.ok(result.levels >= 10); assert.ok(result.peak > .24 && result.peak <= .251); assert.ok(result.rms > .16 && result.rms < .19);
  assert.deepEqual(permissions, [], 'Synthetic input must never request a device permission.');
  assert.equal(result.deviceCalls, 0, 'No microphone or display-capture API may be called.');
  const evidence = { ok:true, kind:'real-electron-synthetic-audioworklet', createdAt:new Date().toISOString(),
    electron:process.versions.electron, chromium:process.versions.chrome,
    asset:`dist/assets/${assetName}`, assetBytes:asset.length, assetSha256:crypto.createHash('sha256').update(asset).digest('hex'),
    isolatedProfile:profile, physicalCapture:false, permissionRequests:permissions, permissionChecksDenied:permissionChecks, ...result };
  fs.writeFileSync(path.join(profile,'result.json'), JSON.stringify(evidence,null,2));
}
app.whenReady().then(run).then(()=>{window.destroy();server.close(()=>app.exit(0));}).catch(error=>{console.error(error);app.exit(1);});
