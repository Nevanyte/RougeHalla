// QUESTBENCH: report-only real-sim quest balance. See the printed READ THIS header for metric definitions.
//   npm run questbench -w @raid/server -- --quick
//   npm run questbench -w @raid/server -- --seeds 6 --players 8
// All errors, including bad arguments and failed runs, produce a report with a successful exit status.
import { MAX_PLAYERS } from "@raid/shared";
import { runQuestBench, type QuestBenchOptions } from "../src/harness/questBench";
import { buildQuestBenchReport } from "../src/harness/questBenchReport";

const USAGE = [
  "usage: npm run questbench -w @raid/server [-- options]",
  "  --quick       one seed, three seats per policy, 120 s cap (unless explicitly overridden)",
  "  --seeds N     generated-map seeds 1..N (default 3; quick 1)",
  "  --players N   2..8 solo seats per policy and mixed-lobby players (default 4; quick 3)",
  "  --cap N       seconds per run (default 300; quick 120)",
  "  --quiet       no per-lobby progress on stderr",
  "  --help        this help",
].join("\n");

function positiveInt(value: string, flag: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${flag} needs a positive integer, got "${value}"`);
  return n;
}

function parseArgs(argv: string[]): QuestBenchOptions & { quiet: boolean; help: boolean } {
  const quick = argv.includes("--quick");
  const out = { seeds: quick ? 1 : 3, players: quick ? 3 : 4, capSeconds: quick ? 120 : 300, quiet: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const eq = arg.startsWith("--") ? arg.indexOf("=") : -1;
    const flag = eq > 0 ? arg.slice(0, eq) : arg;
    const inline = eq > 0 ? arg.slice(eq + 1) : undefined;
    const value = (): string => {
      const v = inline ?? argv[++i];
      if (v === undefined || v === "" || v.startsWith("--")) throw new Error(`${flag} needs a value`);
      return v;
    };
    switch (flag) {
      case "--quick": break;
      case "--seeds": out.seeds = positiveInt(value(), flag); break;
      case "--players": {
        out.players = positiveInt(value(), flag);
        if (out.players < 2 || out.players > MAX_PLAYERS) throw new Error(`--players takes 2..${MAX_PLAYERS}`);
        break;
      }
      case "--cap": out.capSeconds = positiveInt(value(), flag); break;
      case "--quiet": out.quiet = true; break;
      case "--help": case "-h": out.help = true; break;
      default: throw new Error(`unknown option ${arg}`);
    }
  }
  return out;
}

function main(): void {
  try {
    const opts = parseArgs(process.argv.slice(2));
    if (opts.help) { console.log(USAGE); return; }
    const log = opts.quiet ? undefined : (line: string) => console.error(`[questbench] ${line}`);
    const observation = runQuestBench({ ...opts, log });
    console.log(buildQuestBenchReport(observation));
  } catch (error) {
    console.log("# QUESTBENCH — real-sim, report only\n");
    console.log("The benchmark could not start. This is reported without failing CI.\n");
    console.log(`- ${error instanceof Error ? error.message : String(error)}`);
    console.log(`\n${USAGE}`);
  } finally {
    process.exitCode = 0;
  }
}

main();
