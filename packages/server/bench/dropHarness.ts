// Disconnects, end to end (docs/NETWORK_INVESTIGATION_2026-11-04.md): a real server in a child process (so its event loop can be
// stalled on purpose), one fault-injecting TCP proxy per client in front of it, and headless clients that run the game client's own
// liveness and reconnect code: net/linkWatch.ts (the beat and the 3 s stall drop), net/connection.ts (forceDrop, linkOf, the SDK's
// reconnection settings) and net/rejoin.ts (main.ts's recoverRun loop with the stored token), sending at a real player's cadence
// (an aim every 25 ms while the cursor or the player moves, a held move every 100 ms, the beat). Each trial injects one fault and
// reports what became of every client: kept its socket, won its seat back (and how long it was out), or ended on the menu (and why).
//   npx tsx packages/server/bench/dropHarness.ts [--clients 3] [--fill 8] [--faults stall:2000,stall:3500,...] [--trials N]
//        [--idle 1] [--settle 25] [--cpu 3] [--phase lobby|planning|active] [--json file]
// Faults: stall:MS (the server's event loop is blocked for MS), blackhole:MS (one client's link carries nothing either way for MS,
// then delivers everything it held, as TCP does), uplink:MS (only that client's uploads are held), downlink:MS (only its downloads).
// `--idle 1` makes the last client a player whose cursor and fighter are still (an aim keepalive every 500 ms, no moves).
// Report only; nothing fails.
import { fork, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { Client, type Room } from "@colyseus/sdk";
import { ROOM_NAME, type JoinOptions } from "@raid/shared";
import type { RaidState } from "@raid/shared/schema";

const here = fileURLToPath(import.meta.url);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ------------------------------------------------------------------------------------------------------------------ the server

interface ServeArgs { port: number; fill: number; humans: number; dir: string; liveness: number; planSeconds: number; fillSeconds: number }

async function serve(a: ServeArgs): Promise<void> {
  const { startServer } = await import("../src/index");
  const { loadConfig } = await import("../src/config");
  const { slowTickLog, LoopDelayWindow } = await import("../src/runtimeStats");
  const { tickStats } = await import("../src/rooms/tickPacer");
  const loop = new LoopDelayWindow(10, 600_000);
  const server = await startServer({
    ...loadConfig({ BOTS_FILL_TO: String(a.fill), MAP_POOL: "2" }),
    port: a.port,
    stashFile: path.join(a.dir, "stash.json"),
    minPlayers: a.humans,
    fillSeconds: a.fillSeconds,
    lobbySeconds: 60,
    planSeconds: a.planSeconds,
    patienceSeconds: 1200,
    patienceMinSeconds: 1200,
    firstPatienceSeconds: 1200,
    suddenDeathSeconds: 1200,
    livenessTimeoutMs: a.liveness,
    latencyMs: 0,
  });
  const stats = () => ({ tick: tickStats.snapshot(), worst: slowTickLog.worst, slow: slowTickLog.recent, loop: loop.snapshot(), maps: server.maps.stats });
  process.on("message", (m: { stall?: number; stats?: boolean; stop?: boolean }) => {
    if (m.stall) {
      // Blocks the loop from a fresh macrotask, like a long tick or a synchronous map build would.
      setImmediate(() => {
        const end = performance.now() + m.stall!;
        while (performance.now() < end) { /* the stall */ }
        process.send?.({ stalled: m.stall });
      });
    }
    if (m.stats) process.send?.({ stats: stats() });
    if (m.stop) void server.stop().then(() => process.exit(0));
  });
  // The driver is gone (killed, crashed): so is this server.
  process.on("disconnect", () => process.exit(0));
  process.send?.({ ready: true });
}

// ------------------------------------------------------------------------------------------------------------------ the proxy

type Dir = "up" | "down";

/** One TCP hop that can hold either direction for a while and then deliver, in order, everything it held (a stalled TCP stream). */
class FaultProxy {
  readonly server: net.Server;
  port = 0;
  private holdUp = false;
  private holdDown = false;
  private readonly flushers = new Set<() => void>();

  constructor(private readonly target: number) {
    this.server = net.createServer((c) => this.link(c));
  }

  listen(): Promise<number> {
    return new Promise((resolve) => this.server.listen(0, "127.0.0.1", () => { this.port = (this.server.address() as net.AddressInfo).port; resolve(this.port); }));
  }

  fault(kind: "blackhole" | "uplink" | "downlink", ms: number): void {
    this.holdUp = kind !== "downlink";
    this.holdDown = kind !== "uplink";
    setTimeout(() => { this.holdUp = false; this.holdDown = false; for (const f of [...this.flushers]) f(); }, ms);
  }

  private link(c: net.Socket): void {
    const u = net.connect(this.target, "127.0.0.1");
    c.setNoDelay(true); u.setNoDelay(true);
    const held: Record<Dir, Buffer[]> = { up: [], down: [] };
    const ended: Record<Dir, boolean> = { up: false, down: false };
    const out = (d: Dir) => (d === "up" ? u : c);
    const holding = (d: Dir) => (d === "up" ? this.holdUp : this.holdDown);
    const flush = () => {
      for (const d of ["up", "down"] as const) {
        if (holding(d)) continue;
        const sock = out(d);
        for (const b of held[d]) if (!sock.destroyed) sock.write(b);
        held[d] = [];
        if (ended[d] && !sock.destroyed) sock.end();
      }
    };
    this.flushers.add(flush);
    const pipe = (from: net.Socket, d: Dir) => {
      from.on("data", (b: Buffer) => { if (holding(d) || held[d].length > 0) held[d].push(b); else out(d).write(b); });
      // A closed end is passed on only after what was held: TCP delivers the data, then the FIN.
      from.on("end", () => { ended[d] = true; if (!holding(d) && held[d].length === 0) out(d).end(); });
    };
    pipe(c, "up");
    pipe(u, "down");
    const kill = () => { this.flushers.delete(flush); c.destroy(); u.destroy(); };
    c.on("error", kill); u.on("error", kill);
    c.on("close", () => { if (!holding("up")) { this.flushers.delete(flush); u.end(); } });
    u.on("close", () => { this.flushers.delete(flush); c.destroy(); });
  }
}

// ------------------------------------------------------------------------------------------------------------------ the clients

type Outcome = { kind: "kept" } | { kind: "back"; outMs: number; via: "sdk" | "rejoin"; dropCode: number } | { kind: "menu"; code: number; reason: string; outMs: number };

interface ClientLog { t: number; what: string }

class BrowserModel {
  room: Room<any, RaidState> | null = null;
  private client: Client;
  private seat: string | null = null;
  private sender: ReturnType<typeof setInterval> | null = null;
  private watch: { stop(): void } | null = null;
  private n = 0;
  log: ClientLog[] = [];
  /** Per trial. */
  lostAt: number | null = null;
  outcome: Outcome = { kind: "kept" };
  onMenu = false;
  messagesSent = 0;

  constructor(readonly name: string, readonly proxy: FaultProxy, readonly idle: boolean, private readonly mods: ClientMods) {
    this.client = new Client(`http://127.0.0.1:${proxy.port}`);
  }

  async join(): Promise<void> {
    const res = await fetch(`http://127.0.0.1:${this.proxy.port}/api/profile/${this.name}`);
    const { token } = (await res.json()) as { token: string };
    const opts: JoinOptions = { profile: this.name, token };
    const room = await this.client.joinOrCreate<RaidState>(ROOM_NAME, opts);
    this.wire(room);
  }

  get phase(): string { return this.room?.state?.phase ?? "?"; }

  private note(what: string): void { this.log.push({ t: Math.round(performance.now()), what }); }

  private wire(room: Room<any, RaidState>): void {
    this.room = room;
    this.mods.tuneReconnection(room);
    this.seat = room.reconnectionToken;
    for (const type of ["fxs", "plan", "vision", "toast", "result"]) room.onMessage(type, () => {});
    const watch = new this.mods.LinkWatch(this.mods.linkOf(room));
    this.watch = watch;
    watch.start({ stalls: true });
    room.onReconnect(() => {
      this.seat = room.reconnectionToken;
      if (this.lostAt !== null) this.outcome = { kind: "back", outMs: Math.round(performance.now() - this.lostAt), via: "sdk", dropCode: this.lastDrop };
      this.lostAt = null;
      this.note("sdk reconnected");
    });
    room.onDrop((code) => {
      this.lastDrop = code;
      this.lostAt ??= performance.now();
      this.note(`drop ${code}`);
    });
    room.onLeave((code, reason) => {
      watch.stop();
      this.note(`leave ${code} ${reason ?? ""}`);
      if (this.room !== room) return;
      this.room = null;
      if (this.mods.recoverableClose(code) && this.seat) void this.recover(code, this.lostAt ?? performance.now());
      else this.menu(code, String(reason ?? ""));
    });
    if (!this.sender) this.sender = setInterval(() => this.send(), 25);
  }

  private lastDrop = 0;

  private menu(code: number, reason: string): void {
    this.onMenu = true;
    this.outcome = { kind: "menu", code, reason, outMs: this.lostAt === null ? 0 : Math.round(performance.now() - this.lostAt) };
    this.note(`MENU ${code} ${reason}`);
  }

  /** main.ts recoverRun + reconnectLoop: the stored token, until the window since the loss is over or the room is gone. */
  private async recover(code: number, lostAt: number): Promise<void> {
    const wallLost = Date.now() - (performance.now() - lostAt);
    for (;;) {
      let failure: unknown;
      try {
        const back = await this.client.reconnect<RaidState>(this.seat!);
        this.outcome = { kind: "back", outMs: Math.round(performance.now() - lostAt), via: "rejoin", dropCode: code };
        this.lostAt = null;
        this.note("rejoined");
        this.wire(back);
        return;
      } catch (err) {
        failure = err;
        this.note(`rejoin refused: ${err instanceof Error ? err.message : String(err)}`);
      }
      // rejoinWindowFor is newer than the rule it refines: an older checkout of the client has the one window for every code.
      const windowMs = this.mods.rejoinWindowFor?.(code);
      const delay = windowMs === undefined ? this.mods.nextRejoinDelay(Date.now(), wallLost, failure) : this.mods.nextRejoinDelay(Date.now(), wallLost, failure, windowMs);
      if (delay === null) { this.menu(code, "rejoin window over"); return; }
      await sleep(delay);
    }
  }

  /** The real client's continuous streams: an aim each 25 ms while moving (keepalive 500 ms when still), a held move each 100 ms. */
  private send(): void {
    const room = this.room;
    if (!room || room.connection?.isOpen !== true || room.reconnection.isReconnecting) return;
    const me = room.state?.players?.get(room.sessionId);
    if (room.state?.phase !== "active" || me?.status !== "alive") return;
    this.n++;
    try {
      if (!this.idle || this.n % 20 === 0) { room.send("aim", { a: (this.n % 628) / 100 }); this.messagesSent++; }
      if (!this.idle && this.n % 4 === 0) {
        room.send("move", { x: me.x + 60 * Math.cos(this.n / 40), y: me.y + 60 * Math.sin(this.n / 40), seq: this.n & 255 });
        this.messagesSent++;
      }
    } catch { /* a socket that cannot send is the stall's to find */ }
  }

  stop(): void {
    if (this.sender) clearInterval(this.sender);
    this.watch?.stop();
    if (this.room) { this.room.removeAllListeners(); this.room.reconnection.enabled = false; void this.room.leave(true).catch(() => {}); }
  }
}

interface ClientMods {
  LinkWatch: typeof import("../../client/src/net/linkWatch").LinkWatch;
  linkOf: typeof import("../../client/src/net/roomLink").linkOf;
  tuneReconnection: typeof import("../../client/src/net/roomLink").tuneReconnection;
  recoverableClose: typeof import("../../client/src/net/rejoin").recoverableClose;
  nextRejoinDelay: typeof import("../../client/src/net/rejoin").nextRejoinDelay;
  rejoinWindowFor?: typeof import("../../client/src/net/rejoin").rejoinWindowFor;
}

// ------------------------------------------------------------------------------------------------------------------ the driver

function argsOf(argv: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith("--")) continue;
    if (argv[i + 1] !== undefined && !argv[i + 1]!.startsWith("--")) out[a.slice(2)] = argv[++i]!;
    else out[a.slice(2)] = "1";
  }
  return out;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => { const p = (s.address() as net.AddressInfo).port; s.close(() => resolve(p)); });
  });
}

async function main(): Promise<void> {
  const args = argsOf(process.argv.slice(2));
  if (args.serve) {
    await serve(JSON.parse(args.serve) as ServeArgs);
    return;
  }
  const clients = Number(args.clients ?? 3);
  const fill = Number(args.fill ?? 8);
  const settleS = Number(args.settle ?? 32);
  const faults = (args.faults ?? "stall:2000,stall:3500,stall:5000,uplink:3000,uplink:4000,blackhole:3000,blackhole:8000,downlink:4000").split(",");
  const trials = Number(args.trials ?? 1);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "raid-drop-"));
  const port = await freePort();
  const phase = (args.phase ?? "active") as "lobby" | "planning" | "active";
  // A lobby fault needs a lobby that stays open past it (the fault comes 2 s after the last join).
  const serveArgs: ServeArgs = { port, fill, humans: clients, dir, liveness: Number(args.liveness ?? 4500), planSeconds: Number(args.plan ?? 12), fillSeconds: phase === "lobby" ? 45 : 4 };
  const execArgv = ["--import", "tsx"];
  const child: ChildProcess = fork(here, ["--serve", JSON.stringify(serveArgs)], { execArgv, stdio: ["ignore", "inherit", "inherit", "ipc"] });
  if (args.cpu !== undefined) {
    // Pins the server to one core, as the 1-vCPU container sees it (Linux only).
    const { execFileSync } = await import("node:child_process");
    try { execFileSync("taskset", ["-pc", args.cpu, String(child.pid)]); } catch { console.warn("taskset failed; the server is not pinned"); }
  }
  const messages: Array<Record<string, unknown>> = [];
  child.on("message", (m) => messages.push(m as Record<string, unknown>));
  const waitFor = async (pred: () => boolean, what: string, ms = 60_000) => {
    const end = Date.now() + ms;
    while (!pred()) { if (Date.now() > end) throw new Error(`timed out: ${what}`); await sleep(20); }
  };
  await waitFor(() => messages.some((m) => m.ready), "server ready", 120_000);
  const stats = async () => {
    const at = messages.length;
    child.send({ stats: true });
    await waitFor(() => messages.length > at && messages.slice(at).some((m) => m.stats), "stats");
    return messages.slice(at).find((m) => m.stats)!.stats as Record<string, unknown>;
  };

  const mods: ClientMods = {
    ...(await import("../../client/src/net/linkWatch")),
    ...(await import("../../client/src/net/roomLink")),
    ...(await import("../../client/src/net/rejoin")),
  };
  let runs = 0;
  const results: Array<{ fault: string; trial: number; outcomes: Record<string, Outcome>; sent: Record<string, number> }> = [];
  for (let trial = 0; trial < trials; trial++) {
    for (const fault of faults) {
      // A fresh run per fault: earlier faults leave no trace (a client on the menu, a seat at the end of its grace).
      const proxies = await Promise.all(Array.from({ length: clients }, async () => { const p = new FaultProxy(port); await p.listen(); return p; }));
      const idleLast = args.idle === "1";
      const run = ++runs;
      const bs = proxies.map((p, i) => new BrowserModel(`dh${process.pid % 10000}r${run}c${i}`, p, idleLast && i === clients - 1, mods));
      for (const b of bs) await b.join();
      // The fault comes 2 s into the phase asked for (`--phase`), 6 s into the run by default.
      await waitFor(() => bs.every((b) => b.phase === phase), `the ${phase} phase`, 120_000);
      await sleep(phase === "active" ? 6000 : 2000);
      for (const b of bs) b.messagesSent = 0;
      const [kind, msText] = fault.split(":") as [string, string];
      const ms = Number(msText);
      const t0 = performance.now();
      if (kind === "stall") child.send({ stall: ms });
      else proxies[0]!.fault(kind as "blackhole" | "uplink" | "downlink", ms);
      await sleep(ms + settleS * 1000);
      const outcomes: Record<string, Outcome> = {};
      const sent: Record<string, number> = {};
      for (const b of bs) {
        // Still out at the end of the settle time and not on the menu: count it as out for the whole window.
        if (b.lostAt !== null && b.outcome.kind === "kept") b.outcome = { kind: "menu", code: -1, reason: "still out", outMs: Math.round(performance.now() - b.lostAt) };
        outcomes[b.name] = b.outcome;
        sent[b.name] = b.messagesSent;
      }
      results.push({ fault, trial, outcomes, sent });
      const line = bs.map((b, i) => {
        const o = b.outcome;
        const who = kind === "stall" ? `c${i}${b.idle ? "(idle)" : ""}` : i === 0 ? "c0(faulted)" : `c${i}`;
        return `${who}: ${o.kind === "kept" ? "kept" : o.kind === "back" ? `back via ${o.via} after ${(o.outMs / 1000).toFixed(1)} s (drop ${o.dropCode})` : `MENU code ${o.code} (${o.reason}) after ${(o.outMs / 1000).toFixed(1)} s`}`;
      }).join(" | ");
      console.log(`RESULT ${fault.padEnd(14)} t${trial}  ${line}  [${Math.round(performance.now() - t0)} ms]`);
      if (args.verbose) for (const b of bs) console.log(`   ${b.name}: ${b.log.map((l) => `${l.t - Math.round(t0)}:${l.what}`).join(", ")}`);
      for (const b of bs) b.stop();
      for (const p of proxies) p.server.close();
      // The seats of clients that ended on the menu are held for the grace: let them go before the next run.
      await sleep(2000);
    }
  }
  const s = await stats();
  console.log("server tick stats:", JSON.stringify(s.tick));
  console.log("server loop delay:", JSON.stringify(s.loop));
  console.log("worst ticks:", JSON.stringify((s.worst as unknown[]).slice(0, 5)));
  if (args.json) fs.writeFileSync(args.json, JSON.stringify({ results, stats: s }, null, 2));
  child.send({ stop: true });
  await sleep(3000);
  child.kill();
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(0);
}

void main().catch((err) => { console.error(err); process.exit(1); });
