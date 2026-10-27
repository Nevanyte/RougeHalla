// Runs netProbe against a fresh server for each network profile (netSim: COLYSEUS_LATENCY, NET_JITTER_MS, NET_LOSS_PCT) with a few
// headless bots and the mobs on, and prints one table. Each profile starts its own server (a temp profile file) and bots, and kills
// them afterwards.
//   npx tsx packages/server/bench/netProbeMatrix.ts [--port 2620] [--seconds 60] [--bots 7] [--tag name] [--out dir]
//        [--profiles "0,30:5,60:10,120:20,30:5:1,60:10:1"] [--seed 1]
// A profile is rtt[:jitter[:loss%]] in ms and percent. Output: <out>/<tag>-<profile>.json per profile and the table on stdout.
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { formatReport, runProbe, type ProbeReport } from "./netProbe";

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
  faction?: string;
  render?: Record<string, number>;
}

export async function runMatrix(o: MatrixOptions): Promise<ProbeReport[]> {
  fs.mkdirSync(o.out, { recursive: true });
  const reports: ProbeReport[] = [];
  for (const p of o.profiles) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "raid-probe-"));
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
      console.error(`[matrix] ${o.tag} ${p.name}: probing ${o.seconds} s ...`);
      const r = await runProbe({ url, seconds: o.seconds, seed: o.seed, label: `${o.tag} ${p.name}`, legacy: o.legacy, trace: o.trace, render: o.render, wish: o.wish, training: o.training, faction: o.faction });
      fs.writeFileSync(path.join(o.out, `${o.tag}-${p.name.replace(/[^\w+%-]/g, "_")}.json`), JSON.stringify(r));
      console.log(formatReport(r));
      reports.push(r);
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
    legacy: a.includes("--legacy"), trace: a.includes("--trace"), wish: a.includes("--wish"), training: a.includes("--training"),
    ...(a.includes("--faction") ? { faction: get("--faction", "fire") } : {}),
    ...(a.includes("--render") ? { render: JSON.parse(get("--render", "{}")) as Record<string, number> } : {}),
  };
  runMatrix(opts).then(() => process.exit(0), (err) => { console.error(err); process.exit(1); });
}

const entry = process.argv[1];
if (entry && import.meta.url === new URL(`file://${entry}`).href) main();
