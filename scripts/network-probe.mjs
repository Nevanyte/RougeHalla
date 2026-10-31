// Compare persistent WebSocket RTTs. Layer differences are observations, not additive CPU timings.
import fs from "node:fs";
import { lookup } from "node:dns/promises";
import WebSocket from "ws";
const args = process.argv.slice(2);
const arg = (key, fallback) => { const i = args.indexOf(key); return i < 0 ? fallback : args[i + 1]; };
const target = new URL(arg("--url", "https://play.roguehalla.com"));
if (!["https:", "http:"].includes(target.protocol) || target.username || target.password || target.pathname !== "/" || target.search || target.hash) throw new Error("--url must be an explicit HTTP(S) origin");
const samples = Number(arg("--samples", "80"));
const interval = Number(arg("--interval-ms", "100"));
const familyArg = arg("--family", "auto");
if (!["auto", "4", "6"].includes(familyArg)) throw new Error("--family must be auto, 4 or 6");
const family = familyArg === "auto" ? undefined : Number(familyArg);
// Optional control for comparing layers over one destination route. It does not change browser/game routing.
const pinned = args.includes("--pin-dns") ? await lookup(target.hostname, { family: family ?? 0 }) : null;
if (!Number.isInteger(samples) || samples < 10 || samples > 200 || !Number.isInteger(interval) || interval < 50 || interval > 250) throw new Error("Use 10–200 samples and 50–250ms interval");
const output = arg("--output");
const tokenFile = arg("--token-file");
if (!tokenFile) throw new Error("Pass a private --token-file containing the dedicated diagnostic credential");
if (target.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(target.hostname)) throw new Error("Diagnostic credentials require HTTPS");
const token = fs.readFileSync(tokenFile, "utf8").trim();
if (!/^[a-f0-9]{64}$/.test(token)) throw new Error("Invalid diagnostic credential file");
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
function stats(values) {
  const s = [...values].sort((a, b) => a - b);
  if (!s.length) return null;
  const p = v => +s[Math.max(0, Math.min(s.length - 1, Math.ceil(v * s.length) - 1))].toFixed(3);
  return { count: s.length, min: p(0), p50: p(.5), p95: p(.95), max: p(1), mean: +(s.reduce((a,b)=>a+b,0)/s.length).toFixed(3) };
}
const ready = await fetch(new URL("/readyz", target), { signal: AbortSignal.timeout(100_000) });
if (!ready.ok) throw new Error(`Readiness returned ${ready.status}`);
const before = await ready.json(), build = ready.headers.get("X-Rougehalla-Server-Build");
const sockets = [], pending = new Map();
// Every server socket expires after 60s. Include sequential handshakes in a shorter whole-probe
// budget, so slow links or large requested sample counts fail with useful guidance before then.
const deadline = performance.now() + 50_000;
function remainingMs(limit) {
  const remaining = Math.floor(deadline - performance.now());
  if (remaining <= 0) throw new Error("Probe exceeded its 50s budget; lower --samples or --interval-ms and retry");
  return Math.min(limit, remaining);
}
try {
  for (const layer of ["edge", "coordinator", "origin"]) {
    const endpoint = new URL(`/_diagnostics/net/${layer}`, target); endpoint.protocol = target.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(endpoint, {
      family: pinned?.family ?? family,
      ...(pinned ? { lookup: (_host, options, callback) => options.all
        ? callback(null, [pinned]) : callback(null, pinned.address, pinned.family) } : {}),
      headers: { Authorization: `Bearer ${token}` },
    });
    const results = { layer, rtt: [], handler: [], loopOvershoot: [], queuedBytes: [] };
    socket.once("upgrade", response => {
      const ray = response.headers["cf-ray"];
      if (typeof ray === "string") {
        results.cfRayId = ray;
        results.cfRayColo = ray.split("-").at(-1);
      }
    });
    const entry = { socket, results, closed: null };
    sockets.push(entry);
    socket.on("close", code => { entry.closed = code; });
    socket.on("message", bytes => {
      if (bytes.length !== (layer === "origin" ? 32 : 8) || bytes.readUInt32LE(0) !== 0x52484c50) return;
      const seq = bytes.readUInt32LE(4), key = layer + ":" + seq, p = pending.get(key);
      if (!p) return;
      clearTimeout(p.timer); pending.delete(key);
      if (seq >= 5) {
        results.rtt.push(performance.now() - p.start);
        if (bytes.length === 32) { results.handler.push(bytes.readDoubleLE(8)); results.loopOvershoot.push(bytes.readDoubleLE(16)); results.queuedBytes.push(bytes.readDoubleLE(24)); }
      }
      p.resolve();
    });
    const handshakeMs = remainingMs(15_000);
    await new Promise((resolve, reject) => { const timer = setTimeout(()=>reject(new Error(`${layer} handshake timeout; reduce the sample count if the probe budget expired`)),handshakeMs); socket.once("open",()=>{clearTimeout(timer);resolve()}); socket.once("error",()=>{clearTimeout(timer);reject(new Error(`${layer} WebSocket failed`))}); });
  }
  // Interleave layers to reduce time-of-day/load bias; discard five warm-up replies per socket.
  for (let i = 0; i < samples + 5; i++) {
    for (const entry of [...sockets.slice(i % 3), ...sockets.slice(0, i % 3)]) {
      const { socket, results } = entry;
      if (entry.closed !== null) throw new Error(`${results.layer} closed with ${entry.closed}`);
      const bytes = Buffer.alloc(8); bytes.writeUInt32LE(0x52484c50,0); bytes.writeUInt32LE(i,4);
      const echoMs = remainingMs(5000);
      await new Promise((resolve,reject)=>{const key=results.layer+":"+i;const timer=setTimeout(()=>{pending.delete(key);reject(new Error(`${results.layer} echo timed out; lower --samples if the probe budget expired`))},echoMs);pending.set(key,{start:performance.now(),timer,resolve});socket.send(bytes);});
    }
    await wait(remainingMs(interval));
  }
  const afterResponse = await fetch(new URL("/readyz", target), { signal: AbortSignal.timeout(10_000) });
  if (!afterResponse.ok || afterResponse.headers.get("X-Rougehalla-Server-Build") !== build) throw new Error("Server release changed during probe");
  const report = { at: new Date().toISOString(), target: target.origin, requestedIpFamily:familyArg, pinnedServerAddress:pinned, serverBuild: build, before: before.runtime, after: (await afterResponse.json()).runtime,
    layers: sockets.map(({results:r})=>({layer:r.layer,cfRayId:r.cfRayId??null,cfRayColo:r.cfRayColo??null,rttMs:stats(r.rtt),...(r.handler.length?{echoHandlerMs:stats(r.handler),finalCumulativeEventLoopOvershootP95Ms:r.loopOvershoot.at(-1),webSocketBufferedAmountBytes:stats(r.queuedBytes)}:{})})),
    limits: ["RTTs include network, Cloudflare forwarding and scheduling; differences between layer distributions are not a precise additive decomposition.","Cf-Ray identifies a processing data center, which need not be the ingress location. Pinning a DNS address controls the destination IP, not Cloudflare's data-center selection.","Origin handler time starts when Node dispatches the message and ends before send; it excludes earlier kernel/event-loop queueing and simulation CPU. The final cumulative event-loop P95 estimates timer overshoot during this probe, not per-message queue delay.","The readyz runtime eventLoopP95Ms is cumulative since process startup and includes cold simulation warm-up; it is not a current queue-delay measurement.","No simulation tick or interpolation wait is included; game SDK pings are also answered immediately.","The after snapshot includes the origin diagnostic socket in transport counters. Buffered amount is only the ws library send backlog, not kernel/network queue depth."] };
  if (output) fs.writeFileSync(output, JSON.stringify(report,null,2)+"\n",{flag:"wx",mode:0o600});
  console.log(JSON.stringify(report,null,2));
} finally {
  for(const p of pending.values())clearTimeout(p.timer);
  for(const {socket}of sockets)socket.terminate();
}
