// What opening a room does to the rooms already running: an arena room ticks with bots while training rooms are created (each
// one builds a map), and the event loop of the server process is watched meanwhile. Report only, never fails.
//   npx tsx packages/server/bench/eventLoop.ts [--worker on|off] [--rooms 12] [--port 2625] [--bots 7]
// --worker off is the old behaviour (generateMap inline in the first join); on is mapService's worker thread.
// Numbers, per phase: monitorEventLoopDelay (a 1 ms timer: how late it fires, so the longest synchronous block shows as the max)
// and the gap between the arena room's ticks (50 ms when healthy; a block longer than that makes it run catch-up steps).
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const get = (k: string, d: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1]! : d; };
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function trainer(url: string, count: number, everyMs: number): Promise<void> {
  const { Client } = await import("@colyseus/sdk");
  const { TRAINING_ROOM_NAME } = await import("@raid/shared");
  const client = new Client(url);
  const names = [0, 1, 2].map((i) => `trn${Math.floor(Math.random() * 1e6)}${i}`);
  const tokens: string[] = [];
  for (const n of names) tokens.push(((await (await fetch(`${url}/api/profile/${n}`)).json()) as { token: string }).token);
  for (let i = 0; i < count; i++) {
    const k = i % names.length;
    const t0 = performance.now();
    try {
      const room = await client.create(TRAINING_ROOM_NAME, { profile: names[k], token: tokens[k] });
      for (let j = 0; j < 400 && !(room.state as { players?: unknown })?.players; j++) await sleep(5);
      console.log(`  training room ${i + 1}: ready after ${(performance.now() - t0).toFixed(0)} ms`);
      room.reconnection.enabled = false;
      await Promise.race([room.leave(true).catch(() => {}), new Promise((r) => setTimeout(r, 3000))]);
    } catch (err) {
      console.log(`  training room ${i + 1} failed: ${err instanceof Error ? err.message : err}`);
    }
    await sleep(everyMs);
  }
}

if (args[0] === "--trainer") {
  trainer(args[1]!, Number(args[2]), Number(args[3])).then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
} else {
  void main();
}

interface Stats { n: number; p50: number; p99: number; max: number }
function stats(v: number[]): Stats {
  if (v.length === 0) return { n: 0, p50: NaN, p99: NaN, max: NaN };
  const s = [...v].sort((a, b) => a - b);
  return { n: s.length, p50: s[Math.floor(s.length / 2)]!, p99: s[Math.min(s.length - 1, Math.floor(s.length * 0.99))]!, max: s[s.length - 1]! };
}

async function main(): Promise<void> {
  const worker = get("--worker", "on");
  process.env.MAP_WORKER = worker === "on" ? "1" : "0";
  const port = Number(get("--port", "2625"));
  const rooms = Number(get("--rooms", "12"));
  const nBots = Number(get("--bots", "7"));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "raid-loop-"));
  const { startServer } = await import("../src/index");
  const { loadConfig } = await import("../src/config");
  const { RaidRoom } = await import("../src/rooms/RaidRoom");
  const cfg = loadConfig({
    RAID_PORT: String(port), STASH_FILE: path.join(dir, "stash.json"), MIN_PLAYERS: "2", LOBBY_SECONDS: "4", FILL_SECONDS: "0",
    PATIENCE_SECONDS: "100000", SUDDEN_DEATH_SECONDS: "100000",
  });

  // Tick gaps of the arena room(s): wrap the room's tick.
  const gaps: number[] = [];
  const last = new WeakMap<object, number>();
  const proto = RaidRoom.prototype as unknown as { tick: (this: { training: boolean; built?: unknown }, ms: number) => void };
  const original = proto.tick;
  proto.tick = function (this, ms) {
    if (!this.training && this.built) {
      const now = performance.now();
      const prev = last.get(this);
      if (prev !== undefined) gaps.push(now - prev);
      last.set(this, now);
    }
    return original.call(this, ms);
  };

  const server = await startServer(cfg);
  await sleep(1500); // the worker (when on) warms up and builds its lane tables
  const url = `http://127.0.0.1:${port}`;
  const children: ChildProcess[] = [];
  const spawnChild = (file: string, a: string[]) => {
    const c = spawn(process.execPath, ["--import", "tsx", file, ...a], { cwd: root, stdio: ["ignore", "pipe", "inherit"] });
    children.push(c);
    return c;
  };
  const prefix = `el${Math.floor(Math.random() * 1e5)}x`;
  spawnChild(path.join(root, "packages/server/src/bots/runBots.ts"), [String(nBots), "--url", url, "--prefix", prefix, "--loop"]);
  await sleep(8000); // lobby, run starts, bots spread out

  const h = monitorEventLoopDelay({ resolution: 1 });
  const phase = async (name: string, ms: number, during?: () => Promise<void>) => {
    h.reset();
    gaps.length = 0;
    h.enable();
    const t0 = performance.now();
    if (during) await during();
    const rest = ms - (performance.now() - t0);
    if (rest > 0) await sleep(rest);
    h.disable();
    const g = stats(gaps);
    const over = gaps.filter((x) => x > 75).length;
    console.log(
      `${name.padEnd(22)} event loop ms: mean ${(h.mean / 1e6).toFixed(2)} p50 ${(h.percentile(50) / 1e6).toFixed(2)} p99 ${(h.percentile(99) / 1e6).toFixed(2)} ` +
      `max ${(h.max / 1e6).toFixed(1)}   arena tick gap ms: p50 ${g.p50.toFixed(1)} p99 ${g.p99.toFixed(1)} max ${g.max.toFixed(1)}  (${over}/${g.n} over 75 ms)`,
    );
  };

  console.log(`map worker ${worker}, ${nBots} bots in an arena room, ${rooms} training rooms`);
  await phase("arena alone", 10_000);
  await phase("training rooms opening", rooms * 1500 + 3000, async () => {
    const t = spawnChild(path.join(root, "packages/server/bench/eventLoop.ts"), ["--trainer", url, String(rooms), "1500"]);
    t.stdout!.on("data", (d: Buffer) => process.stdout.write(d));
    await new Promise<void>((r) => t.on("exit", () => r()));
  });
  for (const c of children) c.kill("SIGTERM");
  await server.stop();
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(0);
}
