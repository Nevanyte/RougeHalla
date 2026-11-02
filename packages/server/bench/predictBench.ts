// PREDICTBENCH: what a "predict the player's next movement" model has to beat, measured on this game. Report only.
//   npx tsx packages/server/bench/predictBench.ts                      3 headless bot runs (in parallel), then the report
//   npx tsx packages/server/bench/predictBench.ts --runs 6 --json out.json
//   npx tsx packages/server/bench/predictBench.ts --trace live.jsonl   score a recorded trace (TRACE_INPUTS) instead
//   npx tsx packages/server/bench/predictBench.ts --trace live.jsonl --humans   ...without the rows of the server's fill bots
// Each run is played the way test/e2e.test.ts plays one (an in-process server on a free port in 2781..2799, a temp profile file,
// four "hard" BotClient bots (hunter, hunter, farmer, opportunist) that each ask for a faction and join one after another, the
// server's own fill bots off, mobs and planning on, the Wish lock at 5 s; no bot quits), the runs as rooms of one server, with the
// server's own movement trace (TRACE_INPUTS, sim/trace.ts) recording them. The baselines and their scoring are
// sim/predictBaselines.ts. The report is Markdown on stdout; progress and the server's own logging go to stderr.
// (--trace here is a movement trace of INPUT rows; it is not net/netProbe's --trace of patch arrivals.)
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { matchMaker } from "@colyseus/core";
import { FACTION_IDS, PLAYER_SPEED, TICK_MS, type FactionId } from "@raid/shared";
import { BotClient, type BotRun } from "../src/bots/BotClient";
import type { PersonaId, TierId } from "../src/bots/brain/types";
import { loadConfig } from "../src/config";
import { startServer } from "../src/index";
import { traceWritesSettled } from "../src/rooms/traceWriter";
import { evaluate, MOVING_SPEED, SPLITS, TURN_ANGLE, type EvalReport, type Split } from "../src/sim/predictBaselines";
import type { TraceRow } from "../src/sim/trace";

const BOTS = 4;
const WISH_LOCK_SECONDS = 5;
/** As test/e2e.test.ts: the quickest hands, and a mix of personas so kills and mob kills keep their odds (docs/BOTS.md 9.2). */
const BOT_TIER: TierId = "hard";
const BOT_PERSONAS: readonly PersonaId[] = ["hunter", "hunter", "farmer", "opportunist"];
/** The ports this bench may listen on: a private range, never the dev server's or the playtest tunnel's. */
const PORT_FROM = 2781;
const PORT_TO = 2799;

const USAGE = [
  "usage: npx tsx packages/server/bench/predictBench.ts [options]",
  "  --runs N          headless bot runs to record (default 3)",
  "  --parallel N      runs played at once, as rooms of one server (default min(runs, 3))",
  "  --patience S      the run's patience timer before the coliseum teleport (default 30, as the e2e)",
  "  --sudden S        seconds in the coliseum before sudden death (default 10)",
  "  --horizons LIST   prediction horizons in ms (default 50,100,150,200,250,300)",
  "  --trace FILE      score this JSONL movement trace instead of playing runs (repeatable; not netProbe's patch trace)",
  "  --humans          drop the rows of server-filled bots from the traces scored (a live TRACE_INPUTS trace has them)",
  "  --port N          listen on this port (default: a free one in 2781..2799)",
  "  --out DIR         keep the recorded traces here (default: a temp dir, deleted)",
  "  --tmp DIR         make the profile file's and the traces' temp dirs under DIR (default: the system temp dir)",
  "  --json FILE       also write the report as JSON",
  "  --help            this help",
].join("\n");

interface Options {
  runs: number; parallel: number; patience: number; sudden: number; horizons: number[];
  traces: string[]; out: string | null; tmp: string | null; json: string | null; help: boolean; humans: boolean; port: number | null;
}

function parseArgs(argv: string[]): Options {
  const o: Options = {
    runs: 3, parallel: 0, patience: 30, sudden: 10, horizons: [50, 100, 150, 200, 250, 300], traces: [], out: null, tmp: null, json: null, help: false, humans: false, port: null,
  };
  const positive = (v: string, flag: string, int = true): number => {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0 || (int && !Number.isInteger(n))) throw new Error(`${flag} needs a positive ${int ? "integer" : "number"}, got "${v}"`);
    return n;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const eq = arg.startsWith("--") ? arg.indexOf("=") : -1;
    const flag = eq > 0 ? arg.slice(0, eq) : arg;
    const value = (): string => {
      const v = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      if (v === undefined || v === "") throw new Error(`${flag} needs a value`);
      return v;
    };
    switch (flag) {
      case "--runs": o.runs = positive(value(), flag); break;
      case "--parallel": o.parallel = positive(value(), flag); break;
      case "--patience": o.patience = positive(value(), flag, false); break;
      case "--sudden": o.sudden = positive(value(), flag, false); break;
      case "--horizons": o.horizons = value().split(",").map((h) => positive(h.trim(), flag, false)); break;
      case "--trace": o.traces.push(value()); break;
      case "--humans": o.humans = true; break;
      case "--port": o.port = positive(value(), flag); break;
      case "--out": o.out = value(); break;
      case "--tmp": o.tmp = value(); break;
      case "--json": o.json = value(); break;
      case "--help": case "-h": o.help = true; break;
      default: throw new Error(`unknown option ${arg}\n${USAGE}`);
    }
  }
  if (o.parallel === 0) o.parallel = Math.min(o.runs, 3);
  return o;
}

/** Where the temp dirs go: --tmp (made if need be), else the system's. (Setting TMPDIR instead breaks tsx's own socket path when it is long.) */
function tmpRoot(o: Options): string {
  if (!o.tmp) return os.tmpdir();
  fs.mkdirSync(o.tmp, { recursive: true });
  return o.tmp;
}

/** True if nothing listens on `port`. */
function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(false));
    s.listen(port, () => s.close(() => resolve(true)));
  });
}

async function pickPort(wanted: number | null): Promise<number> {
  if (wanted !== null) {
    if (!(await portFree(wanted))) throw new Error(`port ${wanted} is in use`);
    return wanted;
  }
  // From a random start, so two benches launched together do not probe the same port first.
  const span = PORT_TO - PORT_FROM + 1;
  const start = Math.floor(Math.random() * span);
  for (let k = 0; k < span; k++) {
    const port = PORT_FROM + ((start + k) % span);
    if (await portFree(port)) return port;
  }
  throw new Error(`no free port in ${PORT_FROM}..${PORT_TO}`);
}

interface RunSummary { roomId: string; seed: number; seconds: number; lineup: FactionId[]; outcomes: string[] }

/**
 * Plays `o.runs` runs on ONE in-process server (Colyseus's matchMaker and RaidRoom.ctx are process-wide, so a second server in
 * this process would take the first one's rooms over), `o.parallel` rooms at a time, every room tracing into `traceFile`.
 */
async function playRuns(o: Options, traceFile: string, log: (line: string) => void): Promise<RunSummary[]> {
  const dir = fs.mkdtempSync(path.join(tmpRoot(o), "raid-predict-"));
  try {
    const port = await pickPort(o.port);
    const server = await startServer({
      // The server's own fill bots (BOTS_FILL_TO defaults to 8) off: the four BotClients are the only players in a room.
      ...loadConfig({ BOTS_FILL_TO: "0" }),
      mobs: true,
      port,
      stashFile: path.join(dir, "data", "stash.json"),
      latencyMs: 0,
      minPlayers: BOTS,
      fillSeconds: 0,
      lobbySeconds: 30,
      firstPatienceSeconds: 0,
      patienceSeconds: o.patience,
      patienceMinSeconds: o.patience,
      suddenDeathSeconds: o.sudden,
      wishLockSeconds: WISH_LOCK_SECONDS,
      traceFile,
    });
    try {
      // One group joins at a time, one bot after another as the e2e does: the fourth join starts that room's run, and the next
      // group only knocks once the room is locked, so no room gets a fifth bot.
      let joining = Promise.resolve();
      return await pool(o.runs, o.parallel, async (index) => {
        const lineup = Array.from({ length: BOTS }, (_, j) => FACTION_IDS[(index + j) % FACTION_IDS.length]!);
        const bots = lineup.map((faction, j) => new BotClient({ timeoutMs: 300_000, faction, tier: BOT_TIER, persona: BOT_PERSONAS[j] }));
        let release!: () => void;
        const turn = joining;
        joining = new Promise<void>((r) => { release = r; });
        await turn;
        let roomId = "";
        try {
          for (const [j, bot] of bots.entries()) await bot.connect(`http://127.0.0.1:${port}`, `pb${index}x${j}`);
          roomId = bots[0]!.roomId;
          if (bots.some((b) => b.roomId !== roomId)) throw new Error(`run ${index + 1}: its bots landed in different rooms`);
          for (let i = 0; i < 250; i++) {
            const room = matchMaker.getLocalRoomById(roomId);
            if (!room || room.locked) break;
            await sleep(20);
          }
        } finally {
          release();
        }
        log(`run ${index + 1}/${o.runs} started in room ${roomId}`);
        const started = Date.now();
        const runs: BotRun[] = await Promise.all(bots.map((b) => b.run()));
        const s: RunSummary = {
          roomId, seed: bots[0]!.seed, seconds: (Date.now() - started) / 1000, lineup,
          outcomes: runs.map((r) => r.result?.outcome ?? `error: ${r.error ?? "none"}`),
        };
        log(`run ${index + 1}/${o.runs}: seed ${s.seed}, ${s.seconds.toFixed(1)} s, ${lineup.map((f, j) => `${f}=${s.outcomes[j]}`).join(" ")}`);
        return s;
      });
    } finally {
      await server.stop();
      await traceWritesSettled();
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function pool<T>(n: number, limit: number, job: (i: number) => Promise<T>): Promise<T[]> {
  const out = new Array<T>(n);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, n) }, async () => {
    while (next < n) { const i = next++; out[i] = await job(i); }
  }));
  return out;
}

function readTrace(file: string, humansOnly: boolean): TraceRow[] {
  const rows: TraceRow[] = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    const row = JSON.parse(line) as TraceRow;
    // A trace from before the `bot` column has none to drop.
    if (humansOnly && row.bot === true) continue;
    rows.push(row);
  }
  return rows;
}

const f1 = (v: number): string => v.toFixed(1);
const pct = (a: number, b: number): string => (b > 0 ? `${((100 * a) / b).toFixed(1)}%` : "-");

function errorTable(report: EvalReport, split: Split): string[] {
  const hs = report.horizons;
  const names = Object.keys(hs[0]?.errors ?? {});
  const lines = [
    `| predictor | ${hs.map((h) => `${h.horizonMs} ms`).join(" | ")} |`,
    `|---|${hs.map(() => "---:").join("|")}|`,
  ];
  for (const name of names) lines.push(`| ${name} | ${hs.map((h) => { const e = h.errors[name]![split]; return `${f1(e.mean)} / ${f1(e.p95)}`; }).join(" | ")} |`);
  const best = hs.map((h) => names.reduce((a, b) => (h.errors[b]![split].mean < h.errors[a]![split].mean ? b : a)));
  lines.push(`| *best (mean)* | ${best.join(" | ")} |`);
  return lines;
}

function markdown(report: EvalReport, source: string): string {
  const hs = report.horizons;
  const out: string[] = [];
  out.push("# Movement prediction baselines", "");
  out.push(source, "");
  out.push(
    `${report.rows} rows (one per standing player per 50 ms tick) from ${report.players} player lives in ${report.runs} run(s). `
    + "Error is the distance in world units between the predicted and the true position h ms later "
    + `(a tile is 32 u; a player walks ${PLAYER_SPEED} u/s, ${(PLAYER_SPEED * TICK_MS) / 1000} u a tick). `
    + "Rows whose horizon crosses a forced move (blink, teleport) or the end of a life are not scored.",
    "",
  );
  out.push("Predictors: `hold` stays put; `constantVelocity` keeps the last 100 ms velocity (dead reckoning: all a remote client sees); "
    + "`holdLastSteer` walks straight at the last move order's point at the walking speed, with the known root (a WASD walk is a "
    + "stream of move orders 8 to 64 u ahead, so it saturates past about 375 ms); `pathFollow` walks the server's path in hand at the "
    + "walking speed, with the known root. The last two read the orders and the path, which only the server has: they are the ceiling "
    + "if the walk goal were synced, not a number a remote client can reach today.", "");
  out.push("## All samples: mean / p95 error (u)", "", ...errorTable(report, "all"), "");
  out.push("## How often straight-line extrapolation must be wrong", "");
  out.push(`Moving: over ${MOVING_SPEED} u/s at the prediction. Turn: a tick's step within the horizon more than ${Math.round((TURN_ANGLE * 180) / Math.PI)} degrees off the heading. `
    + "Stop: a tick within the horizon with no walk. Start: a still player walks within the horizon.", "");
  out.push("| horizon | scored | dropped (end / forced move) | moving | turn (of moving) | stop (of moving) | start (of still) | turn or stop (of all) |");
  out.push("|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const h of hs) {
    const g = h.heading;
    out.push(`| ${h.horizonMs} ms | ${h.samples} | ${h.dropped.ended} / ${h.dropped.displaced} | ${pct(g.moving, h.samples)} | ${pct(g.turned, g.moving)} | ${pct(g.stopped, g.moving)} | ${pct(g.started, g.still)} | ${pct(g.turned + g.stopped, h.samples)} |`);
  }
  out.push("");
  const titles: Partial<Record<Split, string>> = {
    melee: "Melee weapon in hand (sword, axe, shield)", ranged: "Ranged weapon in hand (bow, wand)", unarmed: "Unarmed (fists)",
    combat: "In combat (a lock, an attack winding up, or a hit given or taken in the last 1 s)", calm: "Out of combat",
    moving: `Moving at the prediction (over ${MOVING_SPEED} u/s)`, still: "Still at the prediction",
  };
  for (const split of SPLITS) {
    const title = titles[split];
    const n = hs[0]?.errors[Object.keys(hs[0].errors)[0]!]![split].n ?? 0;
    if (!title || n === 0) continue;
    out.push(`## ${title}: mean / p95 (u), ${n} samples at ${hs[0]!.horizonMs} ms`, "", ...errorTable(report, split), "");
  }
  return out.join("\n");
}

async function main(): Promise<void> {
  const o = parseArgs(process.argv.slice(2));
  if (o.help) { console.log(USAGE); return; }
  let files = o.traces;
  let source: string;
  let cleanup: string | null = null;
  if (files.length === 0) {
    const dir = o.out ?? fs.mkdtempSync(path.join(tmpRoot(o), "raid-predict-traces-"));
    if (o.out) fs.mkdirSync(dir, { recursive: true });
    else cleanup = dir;
    const file = path.join(dir, `predict-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`);
    // The report is stdout's; the server's own logging goes to stderr while the runs play.
    const log = console.log;
    console.log = (...args: unknown[]) => console.error(...args);
    const started = Date.now();
    let summaries: RunSummary[];
    try {
      summaries = await playRuns(o, file, (line) => console.error(`[predict] ${line}`));
    } finally {
      console.log = log;
    }
    files = [file];
    source = `${o.runs} headless bot run(s), ${BOTS} BotClient bots each (hard tier; factions rotated per run; mobs, planning and quests on; `
      + `patience ${o.patience} s, sudden death after ${o.sudden} s; ${((Date.now() - started) / 1000).toFixed(0)} s wall, up to ${o.parallel} rooms at once). `
      + `Seeds ${summaries.map((s) => s.seed).join(", ")}.${o.out ? ` Trace kept in ${file}.` : ""}`;
  } else {
    source = `Trace file(s): ${files.join(", ")}${o.humans ? " (rows of server-filled bots dropped)" : ""}.`;
  }
  const rows = files.flatMap((f) => readTrace(f, o.humans));
  if (cleanup) fs.rmSync(cleanup, { recursive: true, force: true });
  if (rows.length === 0) throw new Error("the trace is empty: nothing to score");
  const report = evaluate(rows, { horizons: o.horizons });
  console.log(markdown(report, source));
  if (o.json) {
    fs.writeFileSync(o.json, `${JSON.stringify({ source, files: o.traces.length > 0 || o.out ? files : [], report }, null, 2)}\n`);
    console.error(`[predict] wrote ${o.json}`);
  }
}

main().then(
  () => process.exit(0),
  (err: unknown) => { console.error(err instanceof Error ? err.stack ?? err.message : err); process.exit(1); },
);
