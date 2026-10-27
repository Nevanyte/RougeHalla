// Screenshots of the zone art on a map, three per zone (zone-shapes WP6): the game view at the zone's signature shape, the minimap
// cropped round the zone at 4x, and the hold-Tab map. Dev only. Needs the client dev server and a Chrome with a debugging port:
//   cd packages/client && npx vite --port 5791 --strictPort --host 127.0.0.1 &
//   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --remote-debugging-port=9791 --user-data-dir=<dir> about:blank &
//   node test/dev/shots.mjs <outDir> <seed> [synth=1|0] [cdpPort=9791] [httpPort=5791]
// synth=1 (the default) dresses the plain generated map with synthetic features of every kind (test/synthFeatures.ts); synth=0 shows
// the map exactly as the generator makes it (the real stylers: what phase C checks). Files: <outDir>/s<seed>-<zone>-{game,minimap,tab}.png.
import fs from "node:fs";
const [outDir, seed = "3", synth = "1", cdp = "9791", http = "5791"] = process.argv.slice(2);
if (!outDir) { console.error("usage: node shots.mjs <outDir> <seed> [synth] [cdpPort] [httpPort]"); process.exit(1); }
fs.mkdirSync(outDir, { recursive: true });
const base = `http://127.0.0.1:${http}/test/dev/zoneart.html`;
const ver = await (await fetch(`http://127.0.0.1:${cdp}/json/version`)).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0; const pending = new Map();
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}, sessionId) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
const ev = async (s, expr) => { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }, s); if (r.error || r.result?.exceptionDetails) throw new Error(JSON.stringify(r.error ?? r.result.exceptionDetails).slice(0, 300)); return r.result.result.value; };
async function page(url, w, h, dpr) {
  const { result: { targetId } } = await send("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId } } = await send("Target.attachToTarget", { targetId, flatten: true });
  await send("Page.enable", {}, sessionId);
  await send("Runtime.enable", {}, sessionId);
  await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: dpr, mobile: false }, sessionId);
  await send("Page.navigate", { url }, sessionId);
  for (let k = 0; k < 600; k++) { try { if (await ev(sessionId, "Boolean(window.__zoneart && window.__zoneart.ready)")) break; } catch { /* loading */ } await new Promise((r) => setTimeout(r, 100)); }
  await new Promise((r) => setTimeout(r, 700));
  return { targetId, sessionId };
}
const save = async (s, file, clip) => { const shot = await send("Page.captureScreenshot", { format: "png", ...(clip ? { clip: { ...clip, scale: 1 } } : {}) }, s); fs.writeFileSync(`${outDir}/${file}`, Buffer.from(shot.result.data, "base64")); console.log(file); };
const ZONES = ["fire", "sentenced", "plague", "frost", "holy"];
const q = `seed=${seed}&synth=${synth}`;
for (const zone of ZONES) {
  let p = await page(`${base}?mode=game&${q}&focus=${zone}`, 1440, 900, 1);
  await save(p.sessionId, `s${seed}-${zone}-game.png`);
  await send("Target.closeTarget", { targetId: p.targetId });
  // The minimap at 4x, cropped to a window of 64 tiles round the zone's pole.
  p = await page(`${base}?mode=minimap&${q}`, 1440, 900, 4);
  const crop = await ev(p.sessionId, `(() => { const r = document.querySelector("canvas.minimap").getBoundingClientRect(); const m = __zoneart.map; const pole = m.regions.find((x) => x.id === ${JSON.stringify(zone)}).pole; const tile = r.width / m.w; const cx = r.left + (pole.x / 32) * tile, cy = r.top + (pole.y / 32) * tile; const half = 34 * tile; return { x: Math.max(r.left, cx - half), y: Math.max(r.top, cy - half), width: Math.min(r.right, cx + half) - Math.max(r.left, cx - half), height: Math.min(r.bottom, cy + half) - Math.max(r.top, cy - half) }; })()`);
  await save(p.sessionId, `s${seed}-${zone}-minimap.png`, crop);
  await send("Target.closeTarget", { targetId: p.targetId });
  p = await page(`${base}?mode=tab&${q}`, 1440, 900, 1);
  await save(p.sessionId, `s${seed}-${zone}-tab.png`);
  await send("Target.closeTarget", { targetId: p.targetId });
}
ws.close();
