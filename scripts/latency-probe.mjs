// Bounded Colyseus ping sweep against a QA-only private training room.
// Usage: node scripts/latency-probe.mjs --url https://host.example [--samples 20] [--interval-ms 250]
import { Client } from "@colyseus/sdk";

function arg(name, fallback) {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1];
}

const rawUrl = arg("--url");
if (!rawUrl) throw new Error("Pass --url with an explicit HTTP(S) origin.");
const url = new URL(rawUrl);
if (!["http:", "https:"].includes(url.protocol)) throw new Error("--url must use http or https.");
if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
  throw new Error("--url must be an origin without credentials, path, query or fragment.");
}
const samples = Number(arg("--samples", "20"));
const intervalMs = Number(arg("--interval-ms", "250"));
if (!Number.isInteger(samples) || samples < 3 || samples > 100) throw new Error("--samples must be an integer from 3 to 100.");
if (!Number.isInteger(intervalMs) || intervalMs < 100 || intervalMs > 5000) throw new Error("--interval-ms must be from 100 to 5000.");

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const percentile = (values, p) => values[Math.min(values.length - 1, Math.ceil(values.length * p) - 1)];
function stats(input) {
  if (!input.length) return null;
  const values = [...input].sort((a, b) => a - b);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const consecutiveJitter = input.length > 1
    ? input.slice(1).reduce((sum, value, index) => sum + Math.abs(value - input[index]), 0) / (input.length - 1)
    : 0;
  return {
    count: values.length,
    minMs: +values[0].toFixed(1),
    p50Ms: +percentile(values, 0.50).toFixed(1),
    p95Ms: +percentile(values, 0.95).toFixed(1),
    maxMs: +values.at(-1).toFixed(1),
    p95MinusP50Ms: +(percentile(values, 0.95) - percentile(values, 0.50)).toFixed(1),
    jitterMs: +consecutiveJitter.toFixed(1),
    standardDeviationMs: +(Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length)).toFixed(1),
  };
}

// Cloudflare's edge health response does not wake the game container; compare it with readiness.
const edgeStarted = performance.now();
const edge = await fetch(new URL("/_edge/health", url), { signal: AbortSignal.timeout(10_000) });
const edgeRttMs = performance.now() - edgeStarted;
if (!edge.ok) throw new Error(`/_edge/health returned HTTP ${edge.status}`);
await edge.body?.cancel();

// Readiness is a separate HTTP cold-start observation, before WebSocket work.
const readinessStarted = performance.now();
const ready = await fetch(new URL("/readyz", url), { signal: AbortSignal.timeout(45_000) });
const readinessMs = performance.now() - readinessStarted;
if (!ready.ok) throw new Error(`/readyz returned HTTP ${ready.status}`);

const name = `qa_ping_${Math.random().toString(36).slice(2, 9)}`;
let room;
const pings = [];
const patches = [];
let lastPatch = null;
let patchCount = 0;
try {
  const claim = await fetch(new URL(`/api/profile/${name}`, url), { signal: AbortSignal.timeout(45_000) });
  if (!claim.ok) throw new Error(`QA profile claim returned HTTP ${claim.status}`);
  const { token, profile } = await claim.json();
  if (typeof token !== "string" || !profile) throw new Error("QA profile claim response was unreadable.");

  const client = new Client(url.origin);
  // create() always asks the server for a fresh private training instance. Never join public matchmaking.
  room = await client.create("training", { profile: name, token, faction: "fire", mode: "training" });
  room.reconnection.enabled = false;
  room.reconnection.maxRetries = 0;
  room.onMessage("*", () => {});
  room.onStateChange(() => {
    const now = performance.now();
    if (lastPatch !== null) patches.push(now - lastPatch);
    lastPatch = now;
    patchCount++;
  });
  const stateDeadline = Date.now() + 15_000;
  while (!room.state?.players?.size && Date.now() < stateDeadline) await wait(50);
  if (!room.state?.players?.size) throw new Error("Private training room did not deliver authoritative state within 15s.");

  // One request at a time: the SDK ping callback has no request id or cancellation API.
  for (let i = 0; i < samples; i++) {
    const started = performance.now();
    const result = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Ping ${i + 1}/${samples} timed out after 5s.`)), 5000);
      room.ping((ms) => { clearTimeout(timer); resolve({ ms, elapsed: performance.now() - started }); });
    });
    pings.push(result.elapsed);
    if (i + 1 < samples) await wait(intervalMs);
  }
  console.log(JSON.stringify({
    target: url.origin,
    room: "private-training",
    edgeHealthRttMs: +edgeRttMs.toFixed(1),
    readinessMs: +readinessMs.toFixed(1),
    ping: stats(pings),
    statePatches: { count: patchCount, interval: stats(patches) },
  }, null, 2));
} finally {
  if (room) {
    // A stalled socket must not make a diagnostic's cleanup wait forever or reconnect in the background.
    room.reconnection.enabled = false;
    room.onReconnect(() => { void room.leave(false).catch(() => {}); });
    let cleanupTimer;
    try {
      await Promise.race([
        room.leave().catch(() => {}),
        new Promise((resolve) => { cleanupTimer = setTimeout(resolve, 2000); }),
      ]);
      void room.leave(false).catch(() => {});
    } finally {
      clearTimeout(cleanupTimer);
    }
  }
}
