// Staging only: creates a normal arena with QA ownership and the configured filler bots.
// Run before assigning the public custom domain; it must not pull real players into a QA match.
import { Client } from "@colyseus/sdk";

const raw = process.argv[2];
if (!raw) throw new Error("Pass the explicit staging origin");
const base = new URL(raw).origin;
const sampleIndex = process.argv.indexOf("--samples");
const samples = sampleIndex < 0 ? 50 : Number(process.argv[sampleIndex + 1]);
if (!Number.isInteger(samples) || samples < 50 || samples > 200) throw new Error("--samples must be from 50 to 200");
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let room;
let stage = "claim";
let leaveCode = null;
let errorCode = null;
let socketError = null;
let closeDetail = null;
let completedPings = 0;
let lastPatchAt = null;
const watchdog = setTimeout(() => { console.error(JSON.stringify({ error: "probe deadline", stage })); process.exit(1); }, 180000);
try {
  const name = `qaon${Math.random().toString(36).slice(2, 8)}`;
  const claim = await fetch(`${base}/api/profile/${name}`, { signal: AbortSignal.timeout(40000) });
  if (!claim.ok) throw new Error(`claim ${claim.status}`);
  const { token } = await claim.json();
  stage = "join";
  room = await new Client(base).create("raid", { profile: name, token, faction: "fire" });
  room.reconnection.enabled = false;
  room.onLeave((code) => { leaveCode = typeof code === "number" ? code : null; });
  room.onError((code) => { errorCode = typeof code === "number" ? code : null; });
  const socket = room.connection.transport.ws;
  socket?.addEventListener("error", (event) => {
    socketError = { code: event.error?.code ?? null, message: String(event.message ?? event.error?.message ?? "WebSocket error").replace(/\b(?:https?|wss?):\/\/\S+/g, "[redacted URL]").slice(0, 200) };
  });
  socket?.addEventListener("close", (event) => { closeDetail = { code: event.code, wasClean: event.wasClean }; });
  room.onMessage("*", () => {});
  let planned = false;
  let phase = "";
  let last = null;
  let maxPlayers = 0;
  const patches = [];
  const pings = [];
  const windows = [];
  let windowPatchStart = 0;
  room.onStateChange((state) => {
    lastPatchAt = performance.now();
    maxPlayers = Math.max(maxPlayers, state.players.size);
    if (state.phase !== phase) { phase = state.phase; console.log(JSON.stringify({ phase, players: state.players.size })); }
    if (state.phase === "planning" && !planned) { planned = true; room.send("plan", { spawn: 0, ready: true }); }
    if (state.phase === "active") {
      const now = performance.now();
      if (last !== null) patches.push(now - last);
      last = now;
    }
  });
  stage = "wait for active";
  const deadline = Date.now() + 50000;
  while (room.state.phase !== "active" && Date.now() < deadline) await wait(100);
  if (room.state.phase !== "active") throw new Error("arena never became active");
  stage = "ping";
  const stats = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    return { count: sorted.length, p50: sorted[Math.floor(sorted.length * .5)], p95: sorted[Math.floor(sorted.length * .95)], max: sorted.at(-1) };
  };
  for (let i = 0; i < samples; i++) {
    if (room.state.phase !== "active") throw new Error("arena ended before the measurement finished");
    const start = performance.now();
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("ping timeout")), 5000);
      room.ping(() => { clearTimeout(timer); pings.push(performance.now() - start); completedPings++; resolve(); });
    });
    await wait(200);
    if ((i + 1) % 50 === 0 || i + 1 === samples) {
      const window = {
        throughSample: i + 1,
        alivePlayers: [...room.state.players.values()].filter((p) => p.status === "alive").length,
        ping: stats(pings.slice(Math.floor(i / 50) * 50)),
        patches: stats(patches.slice(windowPatchStart)),
      };
      windows.push(window); windowPatchStart = patches.length;
      console.log(JSON.stringify({ window }));
    }
  }
  const ready = await fetch(`${base}/readyz`).then((r) => r.json());
  console.log(JSON.stringify({ players: maxPlayers, mobs: room.state.mobs.size, ping: stats(pings), patches: stats(patches), windows, runtime: ready.runtime }));
} catch (error) {
  console.error(JSON.stringify({ error: error.message, stage, completedPings, leaveCode, errorCode, socketError, closeDetail, socketOpen: room?.connection?.isOpen, phase: room?.state?.phase, patchAgeMs: lastPatchAt === null ? null : Math.round(performance.now() - lastPatchAt) }));
  process.exitCode = 1;
} finally {
  clearTimeout(watchdog);
  if (room) {
    await Promise.race([room.leave().catch(() => {}), wait(2000)]);
    void room.leave(false).catch(() => {});
  }
}
