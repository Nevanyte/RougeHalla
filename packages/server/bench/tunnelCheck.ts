// A real run through a Cloudflare quick tunnel (cloudflared tunnel --url), the way the owner would host it: this process runs the
// server, cloudflared exposes it as wss://….trycloudflare.com, local bots play in the run, and a client joins THROUGH the tunnel.
//   npx tsx packages/server/bench/tunnelCheck.ts [--port 2623] [--seconds 40] [--bots 5]
// It reports (1) the tunnel's round trip and jitter (the SDK's ping, 5 per second), (2) the netProbe numbers over the tunnel, and
// (3) the reconnection: a drop the client sees as the browser's `offline` event (close code MAY_TRY_RECONNECT) and an abrupt one
// (the server terminates the socket: what a tunnel or a Wi-Fi blip does), each timed to `onReconnect`, with the fighter checked to
// be the same one afterwards. Report only. cloudflared and its tunnel are killed at the end.
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { Client, type Room } from "@colyseus/sdk";
import { CloseCode, matchMaker } from "@colyseus/core";
import { ROOM_NAME } from "@raid/shared";
import type { RaidState } from "@raid/shared/schema";
import { loadConfig } from "../src/config";
import { startServer } from "../src/index";
import { formatReport, runProbe } from "./netProbe";

const args = process.argv.slice(2);
const get = (k: string, d: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1]! : d; };
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const stats = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))]!;
  let jit = 0;
  for (let i = 1; i < v.length; i++) jit += Math.abs(v[i]! - v[i - 1]!);
  return `n ${s.length}  min ${s[0]}  p50 ${q(0.5)}  p95 ${q(0.95)}  p99 ${q(0.99)}  max ${s[s.length - 1]}  mean |dRTT| ${(jit / Math.max(1, v.length - 1)).toFixed(1)}`;
};

async function startTunnel(port: number): Promise<{ proc: ChildProcess; url: string }> {
  const proc = spawn(process.env.TUNNEL_BIN ?? "/opt/homebrew/bin/cloudflared", ["tunnel", "--no-autoupdate", ...(process.env.TUNNEL_PROTOCOL ? ["--protocol", process.env.TUNNEL_PROTOCOL] : []), "--url", `http://127.0.0.1:${port}`], { stdio: ["ignore", "pipe", "pipe"] });
  const logFile = process.env.TUNNEL_LOG;
  const url = await new Promise<string>((resolve, reject) => {
    let log = "";
    if (logFile) {
      const keep = (d: Buffer) => fs.appendFileSync(logFile, d);
      proc.stdout!.on("data", keep);
      proc.stderr!.on("data", keep);
    }
    const onData = (d: Buffer) => {
      log += d.toString();
      // Not api.trycloudflare.com, which the startup log names too. And not before the edge has registered the connection: a
      // lookup of the new hostname before that is cached as "no such host" and keeps failing for minutes.
      const m = /https:\/\/(?!api\.)[a-z0-9-]+\.trycloudflare\.com/.exec(log);
      if (m && /Registered tunnel connection/.test(log)) resolve(m[0]);
    };
    proc.stdout!.on("data", onData);
    proc.stderr!.on("data", onData);
    proc.on("exit", (code) => reject(new Error(`cloudflared exited (${code}): ${log.slice(-500)}`)));
    const giveUp = setTimeout(() => { proc.kill("SIGTERM"); reject(new Error(`no tunnel URL after 40 s: ${log.slice(-500)}`)); }, 40_000);
    proc.stdout!.on("data", () => { if (/Registered tunnel connection/.test(log)) clearTimeout(giveUp); });
    proc.stderr!.on("data", () => { if (/Registered tunnel connection/.test(log)) clearTimeout(giveUp); });
  });
  // The hostname takes a few seconds to resolve after the edge registered the tunnel, and a lookup before that is remembered as
  // "no such host" for a long while: wait first.
  await sleep(15_000);
  for (let i = 0; i < 90; i++) {
    try {
      const res = await fetch(`${url}/api/health`);
      if (res.ok) return { proc, url };
      if (i % 10 === 0) console.log(`  waiting for the tunnel: HTTP ${res.status}`);
    } catch (err) {
      if (i % 10 === 0) console.log(`  waiting for the tunnel: ${err instanceof Error ? `${err.message} ${(err.cause as Error | undefined)?.message ?? ""}` : err}`);
    }
    await sleep(1000);
  }
  proc.kill("SIGTERM");
  throw new Error("the tunnel never answered /api/health");
}

async function join(url: string, name: string, token: string): Promise<Room<any, RaidState>> {
  const client = new Client(url);
  for (let attempt = 0; ; attempt++) {
    try {
      const room = await client.joinOrCreate<RaidState>(ROOM_NAME, { profile: name, token });
      // What client/src/net/connection.ts tuneReconnection sets.
      room.reconnection.maxRetries = 6;
      room.reconnection.maxDelay = 2000;
      room.reconnection.maxEnqueuedMessages = 0;
      room.onMessage("toast", () => {});
      room.onMessage("fxs", () => {});
      room.onMessage("result", () => {});
      return room;
    } catch (err) {
      if (attempt > 40) throw err;
      await sleep(1500);
    }
  }
}

async function claim(url: string, name: string): Promise<string> {
  const res = await fetch(`${url}/api/profile/${name}`);
  return ((await res.json()) as { token: string }).token;
}

async function reconnectTest(url: string, kind: "offline" | "abrupt"): Promise<void> {
  const name = `rc${kind}${Math.floor(Math.random() * 1e5)}`;
  const token = await claim(url, name);
  const room = await join(url, name, token);
  for (let i = 0; i < 400 && room.state?.phase !== "active"; i++) await sleep(100);
  const me0 = room.state.players.get(room.sessionId);
  if (room.state.phase !== "active" || !me0) { console.log(`  ${kind}: the run never started`); return; }
  await sleep(1500);
  const before = { x: me0.x, y: me0.y, hp: me0.hp, t: room.state.serverTime };
  let droppedAt = 0;
  let backAt = 0;
  let drops = 0;
  const seen: string[] = [];
  room.onDrop((code) => { drops++; seen.push(`drop ${code}`); });
  room.onReconnect(() => { backAt = performance.now(); seen.push("reconnect"); });
  room.onLeave((code) => seen.push(`leave ${code}`));
  const patchesBefore = { n: 0 };
  room.onStateChange(() => { patchesBefore.n++; });
  droppedAt = performance.now();
  if (kind === "offline") {
    room.connection.close(CloseCode.MAY_TRY_RECONNECT);
  } else {
    // The server cuts the socket without a close frame: the client learns from the TCP reset or its absence.
    for (const r of matchMaker.getLocalRoomById ? [matchMaker.getLocalRoomById(room.roomId)] : []) {
      const c = (r as unknown as { clients: Iterable<{ sessionId: string; ref: { terminate(): void } }> }).clients;
      for (const cl of c) if (cl.sessionId === room.sessionId) cl.ref.terminate();
    }
  }
  for (let i = 0; i < 150 && backAt === 0; i++) await sleep(100);
  const took = backAt ? backAt - droppedAt : NaN;
  let after: { x: number; y: number; hp: number; alive: boolean } | null = null;
  if (backAt) {
    const n0 = patchesBefore.n;
    for (let i = 0; i < 40 && patchesBefore.n === n0; i++) await sleep(50);
    const me = room.state.players.get(room.sessionId);
    after = me ? { x: me.x, y: me.y, hp: me.hp, alive: me.status === "alive" } : null;
  }
  console.log(
    `  ${kind.padEnd(8)} drop -> back after ${Number.isFinite(took) ? took.toFixed(0) + " ms" : "NEVER (15 s)"}  events [${seen.join(", ")}]  ` +
    `same fighter: ${after ? `yes, alive=${after.alive}, moved ${Math.hypot(after.x - before.x, after.y - before.y).toFixed(0)} u, hp ${before.hp.toFixed(0)} -> ${after.hp.toFixed(0)}` : "no"}  ` +
    `patches resumed: ${patchesBefore.n > 0}`,
  );
  void drops;
  room.reconnection.enabled = false;
  await room.leave(true).catch(() => {});
}

async function main(): Promise<void> {
  const port = Number(get("--port", "2623"));
  const seconds = Number(get("--seconds", "40"));
  const bots = Number(get("--bots", "5"));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "raid-tunnel-"));
  const server = await startServer(loadConfig({
    RAID_PORT: String(port), STASH_FILE: path.join(dir, "stash.json"), MIN_PLAYERS: "2", LOBBY_SECONDS: "4", FILL_SECONDS: "0",
    PATIENCE_SECONDS: "100000", SUDDEN_DEATH_SECONDS: "100000",
  }));
  const kids: ChildProcess[] = [];
  let tunnel: ChildProcess | undefined;
  try {
    const t = await startTunnel(port);
    tunnel = t.proc;
    console.log(`tunnel up: ${t.url}`);
    const local = `http://127.0.0.1:${port}`;
    const prefix = `tn${Math.floor(Math.random() * 1e5)}x`;
    kids.push(spawn(process.execPath, ["--import", "tsx", path.join(root, "packages/server/src/bots/runBots.ts"), String(bots), "--url", local, "--prefix", prefix, "--loop"], { stdio: "ignore" }));
    await sleep(2000);

    // (1) round trip and jitter, in the lobby/run: 5 pings a second for 30 s.
    const name = `tping${Math.floor(Math.random() * 1e5)}`;
    const room = await join(t.url, name, await claim(t.url, name));
    const rtts: number[] = [];
    const end = performance.now() + 30_000;
    while (performance.now() < end) {
      await new Promise<void>((res) => { room.ping((ms) => { rtts.push(ms); res(); }); setTimeout(res, 1000); });
      await sleep(200);
    }
    console.log(`tunnel RTT ms (SDK ping, 5/s for 30 s): ${stats(rtts)}`);
    room.reconnection.enabled = false;
    await room.leave(true).catch(() => {});
    await sleep(1500);

    // (2) the probe over the tunnel.
    const rep = await runProbe({ url: t.url, seconds, label: "through the tunnel", seed: 1 });
    console.log(formatReport(rep));

    // (3) reconnection.
    console.log("reconnection (client settings of connection.ts: 6 retries, 2 s cap; the server holds the seat 10 s):");
    await reconnectTest(t.url, "offline");
    await sleep(2000);
    await reconnectTest(t.url, "abrupt");
  } finally {
    for (const k of kids) k.kill("SIGTERM");
    tunnel?.kill("SIGTERM");
    await sleep(500);
    await server.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main().then(() => process.exit(0), (err) => { console.error(err); process.exit(1); });
