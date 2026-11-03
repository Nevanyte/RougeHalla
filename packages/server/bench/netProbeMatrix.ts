// Runs netProbe against a fresh server for each network profile (netSim: COLYSEUS_LATENCY, NET_JITTER_MS, NET_LOSS_PCT) with a few
// headless bots and the mobs on, and prints one table. Each profile starts its own server (a temp profile file) and bots, and kills
// them afterwards.
//   npx tsx packages/server/bench/netProbeMatrix.ts [--port 2620] [--seconds 60] [--bots 7] [--tag name] [--out dir]
//        [--profiles "0,30:5,60:10,120:20,30:5:1,60:10:1"] [--seed 1] [--hz 144 | --hz 60,144] [--steer frame|event|mixed] [--tmp dir]
//        [--aim legacy50|floor25|aligned] [--drawahead on|off|both] [--ahead '{"heldMoverMs":25}']
// A profile is rtt[:jitter[:loss%]] in ms and percent. Several --hz rates run one after the other on each profile's server. Output:
// <out>/<tag>-<profile>[-<hz>hz].json per run, each run's report, and at the end the draw-ahead table (netProbe.ts drawahead): per
// profile and rate the remote players' displayed age with it off and on, the error (mean/p95/p99 over all and over moving frames),
// corrections over 4 u, held movers, snaps, reversals and the acceptance gates' verdict.
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { RemoteDrawOptions } from "../../client/src/net/remoteDraw";
import { formatReport, parseAimMode, parseDrawAhead, runProbe, type AimMode, type ProbeReport } from "./netProbe";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

interface Profile { rtt: number; jitter: number; loss: number; name: string }

function parseProfile(s: string): Profile {
  const [rtt = "0", jitter = "0", loss = "0"] = s.split(":");
  const p = { rtt: Number(rtt), jitter: Number(jitter), loss: Number(loss), name: "" };
  p.name = `${p.rtt}ms` + (p.jitter ? `+-${p.jitter}` : "") + (p.loss ? `+${p.loss}%loss` : "");
  return p;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function start(file: string, args: string[], env: Record<string, string>, ready?: RegExp): Promise<ChildProcess> {
  const child = spawn(process.execPath, ["--import", "tsx", path.join(root, file), ...args], { cwd: root, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  // However the runner ends (killed included), what it started does not outlive it.
  process.on("exit", () => { try { child.kill("SIGTERM"); } catch { /* gone */ } });
  return new Promise((resolve, reject) => {
    let out = "";
    const onData = (d: Buffer) => {
      out += d.toString();
      if (!ready || ready.test(out)) { resolve(child); }
    };
    child.stdout!.on("data", onData);
    child.stderr!.on("data", (d: Buffer) => { if (process.env.MATRIX_VERBOSE) process.stderr.write(d); });
    child.on("exit", (code) => reject(new Error(`${file} exited early (${code}): ${out}`)));
    setTimeout(() => reject(new Error(`${file} did not become ready: ${out}`)), 60_000).unref();
    if (!ready) setTimeout(() => resolve(child), 500);
  });
}

async function kill(child: ChildProcess | undefined): Promise<void> {
  if (!child || child.exitCode !== null) return;
  child.removeAllListeners("exit");
  child.kill("SIGTERM");
  await new Promise<void>((r) => { child.once("exit", () => r()); setTimeout(() => { child.kill("SIGKILL"); r(); }, 4000).unref(); });
}

export interface MatrixOptions {
  port: number;
  seconds: number;
  bots: number;
  tag: string;
  out: string;
  profiles: Profile[];
  seed: number;
  /** Extra env for the server (e.g. a tunnel). */
  serverEnv?: Record<string, string>;
  legacy?: boolean;
  trace?: boolean;
  /** Cast the Wish (as Fire, whose Blaze Step is a blink) and report the prediction around the casts. */
  wish?: boolean;
  /** Measure in a training room (no bots; a Wish is ready every 5 s there). */
  training?: boolean;
  /** Swap weapons (a wand and a sword from the training rack) and report the predicted hand's effect; implies `training`. */
  swap?: boolean;
  faction?: string;
  render?: Record<string, number>;
  /** Frame rate of the probe's loop. */
  hz?: number;
  /** Several frame rates, run one after another on each profile (overrides `hz`). */
  hzs?: number[];
  /** The draw-ahead's arms (netProbe.ts; default both) and the on arm's RemoteDrawOptions. */
  drawAhead?: "on" | "off" | "both";
  ahead?: Partial<RemoteDrawOptions>;
  /** A WASD player whose key events are sent at the next frame or from the event (see ProbeOptions.steer). */
  steer?: "frame" | "event" | "mixed";
  /** Where each profile's temporary profile file lives (default: the OS temp dir). */
  tmp?: string;
  /** How the probe streams its aim (netProbe.ts; default its own, "aligned"). */
  aimMode?: AimMode;
}

export async function runMatrix(o: MatrixOptions): Promise<ProbeReport[]> {
  fs.mkdirSync(o.out, { recursive: true });
  const reports: ProbeReport[] = [];
  for (const p of o.profiles) {
    // --tmp or PROBE_TMP puts the server's profile file somewhere other than the system temp dir (setting TMPDIR for tsx breaks on a long path).
    const dir = fs.mkdtempSync(path.join(o.tmp ?? process.env.PROBE_TMP ?? os.tmpdir(), "raid-probe-"));
    let server: ChildProcess | undefined;
    let bots: ChildProcess | undefined;
    try {
      server = await start("packages/server/src/index.ts", [], {
        RAID_PORT: String(o.port), STASH_FILE: path.join(dir, "stash.json"), MIN_PLAYERS: "2", LOBBY_SECONDS: "4", FILL_SECONDS: "0",
        PATIENCE_SECONDS: "120", SUDDEN_DEATH_SECONDS: "30", WISH_LOCK_SECONDS: "0",
        COLYSEUS_LATENCY: String(p.rtt), NET_JITTER_MS: String(p.jitter), NET_LOSS_PCT: String(p.loss), NET_SEED: String(o.seed),
        ...o.serverEnv,
      }, /listening/);
      const url = `http://127.0.0.1:${o.port}`;
      const prefix = `pb${Math.floor(Math.random() * 1e5)}x`;
      if (!o.training) bots = await start("packages/server/src/bots/runBots.ts", [String(o.bots), "--url", url, "--prefix", prefix, "--loop"], {});
      await sleep(1500);
      const rates = o.hzs && o.hzs.length > 0 ? o.hzs : [o.hz];
      for (const hz of rates) {
        const at = rates.length > 1 ? ` ${hz} Hz` : "";
        console.error(`[matrix] ${o.tag} ${p.name}${at}: probing ${o.seconds} s ...`);
        const r = await runProbe({
          url, seconds: o.seconds, seed: o.seed, label: `${o.tag} ${p.name}${at}`, legacy: o.legacy, trace: o.trace, render: o.render, wish: o.wish,
          training: o.training, swap: o.swap, faction: o.faction, hz, steer: o.steer, ...(o.aimMode ? { aimMode: o.aimMode } : {}),
          ...(o.drawAhead ? { drawAhead: o.drawAhead } : {}), ...(o.ahead ? { ahead: o.ahead } : {}),
        });
        const suffix = rates.length > 1 ? `-${hz}hz` : "";
        fs.writeFileSync(path.join(o.out, `${o.tag}-${p.name.replace(/[^\w+%-]/g, "_")}${suffix}.json`), JSON.stringify(r));
        console.log(formatReport(r));
        reports.push(r);
      }
    } finally {
      await kill(bots);
      await kill(server);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  return reports;
}

function main(): void {
  // A SIGTERM runs the exit hooks that stop the server and bots this started.
  process.on("SIGTERM", () => process.exit(143));
  const a = process.argv.slice(2);
  const get = (k: string, d: string) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1]! : d; };
  const opts: MatrixOptions = {
    port: Number(get("--port", "2620")), seconds: Number(get("--seconds", "60")), bots: Number(get("--bots", "7")), tag: get("--tag", "run"),
    out: path.resolve(get("--out", path.join(os.tmpdir(), "netprobe"))), seed: Number(get("--seed", "1")),
    profiles: get("--profiles", "0,30:5,60:10,120:20,30:5:1,60:10:1").split(",").map(parseProfile),
    legacy: a.includes("--legacy"), trace: a.includes("--trace"), wish: a.includes("--wish"), training: a.includes("--training") || a.includes("--swap"),
    swap: a.includes("--swap"),
    ...(a.includes("--faction") ? { faction: get("--faction", "fire") } : {}),
    ...(a.includes("--tmp") ? { tmp: path.resolve(get("--tmp", "")) } : {}),
    ...(a.includes("--hz") ? (get("--hz", "144").includes(",") ? { hzs: get("--hz", "144").split(",").map(Number) } : { hz: Number(get("--hz", "144")) }) : {}),
    ...(a.includes("--drawahead") ? { drawAhead: parseDrawAhead(get("--drawahead", "both")) } : {}),
    ...(a.includes("--ahead") ? { ahead: JSON.parse(get("--ahead", "{}")) as Partial<RemoteDrawOptions> } : {}),
    ...(a.includes("--steer") ? { steer: get("--steer", "frame") as "frame" | "event" | "mixed" } : {}),
    ...(a.includes("--render") ? { render: JSON.parse(get("--render", "{}")) as Record<string, number> } : {}),
    ...(a.includes("--aim") ? { aimMode: parseAimMode(get("--aim", "aligned")) } : {}),
  };
  runMatrix(opts).then((reports) => {
    console.log(drawAheadTable(reports));
    process.exit(0);
  }, (err) => { console.error(err); process.exit(1); });
}

/** One row per run with both draw-ahead arms: the remote players' age off and on, the error, the corrections and the verdict. */
export function drawAheadTable(reports: readonly ProbeReport[]): string {
  const f1 = (v: number) => (Number.isFinite(v) ? v.toFixed(1) : "-");
  const f2 = (v: number) => (Number.isFinite(v) ? v.toFixed(2) : "-");
  const rows = reports.filter((r) => r.drawAhead?.on && r.drawAhead.off).map((r) => {
    const on = r.drawAhead!.on!.players;
    const off = r.drawAhead!.off!.players;
    const remote = r.drawAhead!.on!.remote;
    return [
      r.label.padEnd(26), String(r.hz).padStart(4), f1(off.ageMs.mean).padStart(7), f1(on.ageMs.mean).padStart(7), f1(off.ageMs.mean - on.ageMs.mean).padStart(6),
      `${f2(on.errU.mean)}/${f2(on.errU.p95)}/${f2(on.errU.p99)}`.padStart(17), `${f2(on.errMovingU.mean)}/${f2(on.errMovingU.p95)}/${f2(on.errMovingU.p99)}`.padStart(17),
      f2(on.jumpCombatPct).padStart(6), f1(on.heldMovingPct).padStart(6), String(on.snaps32).padStart(5), f2(remote.reversalsPerMin).padStart(7),
      r.drawAhead!.pass ? "PASS" : "FAIL",
    ].join(" | ");
  });
  if (rows.length === 0) return "";
  const head = ["run".padEnd(26), "hz".padStart(4), "age off".padStart(7), "age on".padStart(7), "drop".padStart(6),
    "err all m/p95/p99".padStart(17), "err mov m/p95/p99".padStart(17), "jump%".padStart(6), "held%".padStart(6), "snaps".padStart(5),
    "rev/min".padStart(7), "verdict"].join(" | ");
  return ["", "draw-ahead (remote players; jump% = corrections over 4 u in combat frames, held% = moving frames held, rev/min per drawn fighter-minute)", head, ...rows].join("\n");
}

const entry = process.argv[1];
if (entry && import.meta.url === new URL(`file://${entry}`).href) main();
