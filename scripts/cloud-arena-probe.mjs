// Staging only: creates a normal arena with QA ownership and the configured filler bots.
// Run before assigning the public custom domain; it must not pull real players into a QA match.
import { Client } from "@colyseus/sdk";

const raw = process.argv[2];
if (!raw) throw new Error("Pass the explicit staging origin");
const base = new URL(raw).origin;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let room;
let stage = "claim";
const watchdog = setTimeout(() => { console.error(JSON.stringify({ error: "probe deadline", stage })); process.exit(1); }, 100000);
try {
  const name = `qaon${Math.random().toString(36).slice(2, 8)}`;
  const claim = await fetch(`${base}/api/profile/${name}`, { signal: AbortSignal.timeout(40000) });
  if (!claim.ok) throw new Error(`claim ${claim.status}`);
  const { token } = await claim.json();
  stage = "join";
  room = await new Client(base).create("raid", { profile: name, token, faction: "fire" });
  room.reconnection.enabled = false;
  room.onMessage("*", () => {});
  let planned = false;
  let phase = "";
  let last = null;
  let maxPlayers = 0;
  const patches = [];
  room.onStateChange((state) => {
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
  const pings = [];
  for (let i = 0; i < 50; i++) {
    const start = performance.now();
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("ping timeout")), 5000);
      room.ping(() => { clearTimeout(timer); pings.push(performance.now() - start); resolve(); });
    });
    await wait(200);
  }
  const stats = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    return { count: sorted.length, p50: sorted[Math.floor(sorted.length * .5)], p95: sorted[Math.floor(sorted.length * .95)], max: sorted.at(-1) };
  };
  const ready = await fetch(`${base}/readyz`).then((r) => r.json());
  console.log(JSON.stringify({ players: maxPlayers, mobs: room.state.mobs.size, ping: stats(pings), patches: stats(patches), runtime: ready.runtime }));
} catch (error) {
  console.error(JSON.stringify({ error: error.message, stage }));
  process.exitCode = 1;
} finally {
  clearTimeout(watchdog);
  if (room) {
    await Promise.race([room.leave().catch(() => {}), wait(2000)]);
    void room.leave(false).catch(() => {});
  }
}
