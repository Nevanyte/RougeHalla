// The tournament CLI (docs/BOTS.md 9.3):
//   npm run tournament -w @raid/server -- --games 400 --workers 6 --lineup E,E,N,N,H,H --seed 1 [--learn off] [--persona mix] [--json out.json]
// (at the repo root: npm run tournament -- --games 400 ...). Plays headless games, prints the report, and exits 0 unless it crashes:
// the pass criteria are the tuning target, not CI.
import fs from "node:fs";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { FACTION_IDS, MAX_PLAYERS, type FactionId } from "@raid/shared";
import { PERSONA_IDS, type PersonaId, type TierId } from "../brain/types";
import { MAX_GAME_MS, type GameSummary } from "./game";
import { aggregate, evaluate, formatReport, type ReportMeta } from "./report";
import { runBatch, type GameResult, type TournamentPlan, type WorkerMessage } from "./worker";

export interface TournamentArgs {
  readonly games: number;
  readonly workers: number;
  readonly tiers: readonly TierId[];
  readonly seed: number;
  readonly learn: boolean;
  readonly persona: PersonaId | "mix";
  readonly faction: FactionId | "mix";
  readonly json: string | null;
  readonly maxMinutes: number;
  /** Seconds, or null = the headless defaults (patience 120 s scaling to 48 s, sudden death 30 s). */
  readonly patience: number | null;
  readonly sudden: number | null;
  readonly latencyMs: number | null;
  readonly jitterMs: number | null;
  readonly quiet: boolean;
  readonly help: boolean;
}

export const USAGE = `usage: npm run tournament -w @raid/server -- [options]
  --games N        games to play (default 400)
  --workers N      worker threads (default min(cores - 1, 6); 1 plays in this thread)
  --lineup L       one letter per seat, E(asy) N(ormal) H(ard), comma separated (default E,E,N,N,H,H; 2 to ${MAX_PLAYERS} seats)
  --seed N         the tournament seed (default 1): game seeds, factions and personas all derive from it
  --learn on|off   the bots' learning store, in memory per worker (default on; off makes every game a pure function of its seed)
  --persona P      mix (default: rotated evenly), farmer, hunter, opportunist or cautious for every bot
  --faction F      mix (default: rotated evenly) or one faction id (fire, sentenced, plague, frost, holy) for every bot
  --json FILE      also write the games and the report there
  --max-minutes M  cut a game off after M simulated minutes (default ${MAX_GAME_MS / 60_000})
  --patience S     patience seconds at a full lobby, scaling to 40% of it (default 120)
  --sudden S       sudden death seconds (default 30)
  --latency MS     --jitter MS   one-way latency of the bots' commands (default 30 and 8)
  --quiet          no progress on stderr
  --help`;

const TIER_LETTERS: Readonly<Record<string, TierId>> = { e: "easy", n: "normal", h: "hard", easy: "easy", normal: "normal", hard: "hard" };

/** "E,E,N,N,H,H" (or easy/normal/hard) to tiers. Throws on a bad token or a lobby size the arena does not take. */
export function parseLineup(text: string): TierId[] {
  const tiers = text.split(",").map((t) => t.trim().toLowerCase()).filter((t) => t !== "").map((t) => {
    const tier = TIER_LETTERS[t];
    if (!tier) throw new Error(`unknown tier "${t}" in --lineup (use E, N or H)`);
    return tier;
  });
  if (tiers.length < 2 || tiers.length > MAX_PLAYERS) throw new Error(`--lineup needs 2 to ${MAX_PLAYERS} seats, got ${tiers.length}`);
  return tiers;
}

function number(flag: string, raw: string | undefined, min: number, integer = true): number {
  const n = raw === undefined || raw.trim() === "" ? NaN : Number(raw);
  if (!Number.isFinite(n) || n < min || (integer && !Number.isInteger(n))) {
    throw new Error(`${flag} needs ${integer ? "an integer" : "a number"} of at least ${min}, got "${raw ?? ""}"`);
  }
  return n;
}

/** The default worker count: leave a core for the main thread, and six is where a laptop stops gaining. */
export const defaultWorkers = (cores = os.cpus().length): number => Math.max(1, Math.min(cores - 1, 6));

/** Throws an Error with a plain message on anything it does not understand. Takes `--flag value` and `--flag=value`. */
export function parseArgs(argv: readonly string[], cores = os.cpus().length): TournamentArgs {
  const a: { -readonly [K in keyof TournamentArgs]: TournamentArgs[K] } = {
    games: 400, workers: defaultWorkers(cores), tiers: parseLineup("E,E,N,N,H,H"), seed: 1, learn: true, persona: "mix", faction: "mix", json: null,
    maxMinutes: MAX_GAME_MS / 60_000, patience: null, sudden: null, latencyMs: null, jitterMs: null, quiet: false, help: false,
  };
  const args = [...argv];
  while (args.length > 0) {
    const raw = args.shift()!;
    if (raw === "--") continue;
    const eq = raw.indexOf("=");
    const flag = raw.startsWith("--") && eq > 0 ? raw.slice(0, eq) : raw;
    const inline = raw.startsWith("--") && eq > 0 ? raw.slice(eq + 1) : undefined;
    const value = (): string => {
      const v = inline ?? args.shift();
      if (v === undefined) throw new Error(`${flag} needs a value`);
      return v;
    };
    switch (flag) {
      case "--games": a.games = number(flag, value(), 1); break;
      case "--workers": a.workers = number(flag, value(), 1); break;
      case "--lineup": a.tiers = parseLineup(value()); break;
      case "--seed": a.seed = number(flag, value(), 0) >>> 0; break;
      case "--learn": {
        const v = value().toLowerCase();
        if (v !== "on" && v !== "off") throw new Error(`--learn takes on or off, got "${v}"`);
        a.learn = v === "on";
        break;
      }
      case "--persona": {
        const v = value().toLowerCase();
        if (v !== "mix" && !PERSONA_IDS.includes(v as PersonaId)) throw new Error(`--persona takes mix or one of ${PERSONA_IDS.join(", ")}, got "${v}"`);
        a.persona = v as PersonaId | "mix";
        break;
      }
      case "--faction": {
        const v = value().toLowerCase();
        if (v !== "mix" && !FACTION_IDS.includes(v as FactionId)) throw new Error(`--faction takes mix or one of ${FACTION_IDS.join(", ")}, got "${v}"`);
        a.faction = v as FactionId | "mix";
        break;
      }
      case "--json": a.json = value(); break;
      case "--max-minutes": a.maxMinutes = number(flag, value(), 0.1, false); break;
      case "--patience": a.patience = number(flag, value(), 1, false); break;
      case "--sudden": a.sudden = number(flag, value(), 1, false); break;
      case "--latency": a.latencyMs = number(flag, value(), 0, false); break;
      case "--jitter": a.jitterMs = number(flag, value(), 0, false); break;
      case "--quiet": a.quiet = true; break;
      case "--help": case "-h": a.help = true; break;
      default: throw new Error(`unknown option "${raw}"`);
    }
  }
  return a;
}

/** The plan the games run from (the same data goes to every worker). */
export function planOf(a: TournamentArgs): TournamentPlan {
  const config: { patienceSeconds?: number; patienceMinSeconds?: number; suddenDeathSeconds?: number } = {};
  if (a.patience !== null) {
    config.patienceSeconds = a.patience;
    config.patienceMinSeconds = a.patience * 0.4;
  }
  if (a.sudden !== null) config.suddenDeathSeconds = a.sudden;
  return {
    games: a.games, seed: a.seed, tiers: a.tiers, persona: a.persona, faction: a.faction, learn: a.learn, maxSimMs: a.maxMinutes * 60_000,
    ...(Object.keys(config).length > 0 ? { config } : {}),
    ...(a.latencyMs !== null ? { latencyMs: a.latencyMs } : {}),
    ...(a.jitterMs !== null ? { jitterMs: a.jitterMs } : {}),
  };
}

/** Game g goes to worker g mod W: a fixed split, so a run replays whatever the machine's load does to the order of arrival. */
export function split(games: number, workers: number): number[][] {
  const w = Math.max(1, Math.min(workers, games));
  const out: number[][] = Array.from({ length: w }, () => []);
  for (let g = 0; g < games; g++) out[g % w]!.push(g);
  return out;
}

/** Plays the whole plan; resolves with every game in index order. `onGame` hears each as it finishes. */
export async function play(plan: TournamentPlan, workers: number, onGame?: (r: GameResult) => void): Promise<GameResult[]> {
  const batches = split(plan.games, workers);
  if (batches.length === 1) return runBatch(plan, batches[0]!, onGame);
  const results: GameResult[] = [];
  const workerUrl = new URL("./worker.ts", import.meta.url);
  await Promise.all(batches.map((indices) => new Promise<void>((resolve, reject) => {
    const w = new Worker(workerUrl, { workerData: { tournamentWorker: true, plan, indices } });
    w.on("message", (m: WorkerMessage) => {
      if (m.type === "game") {
        results.push(m);
        onGame?.(m);
      } else resolve();
    });
    w.on("error", reject);
    w.on("exit", (code) => { if (code !== 0) reject(new Error(`a worker exited with code ${code}`)); });
  })));
  return results.sort((x, y) => x.index - y.index);
}

export async function main(argv: readonly string[]): Promise<number> {
  let args: TournamentArgs;
  try {
    args = parseArgs(argv);
  } catch (err) {
    console.error(`${(err as Error).message}\n\n${USAGE}`);
    return 2;
  }
  if (args.help) {
    console.log(USAGE);
    return 0;
  }
  const plan = planOf(args);
  const lineup = args.tiers.map((t) => t[0]!.toUpperCase()).join(",");
  let done = 0;
  let lastShown = 0;
  const t0 = performance.now();
  const results = await play(plan, args.workers, () => {
    done++;
    const now = performance.now();
    if (!args.quiet && (done === args.games || now - lastShown > 2000)) {
      lastShown = now;
      process.stderr.write(`\r${done}/${args.games} games, ${(done / ((now - t0) / 1000)).toFixed(2)} games/s   `);
    }
  });
  if (!args.quiet) process.stderr.write("\n");
  const wallMs = performance.now() - t0;
  const games: GameSummary[] = results.map((r) => r.summary);
  const report = aggregate(games);
  const meta: ReportMeta = {
    lineup, seed: args.seed, learn: args.learn, persona: args.persona, faction: args.faction, workers: Math.min(args.workers, args.games), wallMs,
    gameMs: results.length === 0 ? null : results.reduce((a, r) => a + r.wallMs, 0) / results.length,
  };
  console.log(formatReport(report, meta));
  if (args.json !== null) {
    fs.writeFileSync(args.json, JSON.stringify({ meta, plan, report, criteria: evaluate(report), games }));
    console.log(`\nwrote ${args.json}`);
  }
  return 0;
}

// Run only as the entry point (never when a test imports it).
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    (code) => { process.exitCode = code; },
    (err) => { console.error(err); process.exitCode = 1; },
  );
}
