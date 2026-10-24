// CLI: runs the weapon duel harness and prints its report.
//   npm run harness -w @raid/server [-- --quick] [--faction fire,holy] [--edge wand>bow] [--perception client|stale|present]
//                                   [--arena open|pillars|both] [--cap SECONDS] [--quiet]
// The full report takes about a minute; --quick (three setups per cell, no sensitivity passes) a few seconds. It never
// fails on an outcome: it is information for the owner.
import { WEAPON_BEATS, isFactionId, isWeaponId, type FactionId } from "@raid/shared";
import type { Arena, Perception } from "./duel";
import type { Edge } from "./matrix";
import { buildReport, type ReportOptions } from "./report";

const USAGE = [
  "usage: npm run harness -w @raid/server [-- options]",
  "  --quick               three setups per cell, no style grids, sensitivity or cluttered-arena passes",
  "  --core                the full matrix, grids, verdicts and kiting, without the client-view and cluttered-arena passes",
  "  --grid-setups full    every setup of the main matrix in each style-grid cell instead of three (steadier, about 6x slower grids)",
  "  --faction a,b         only these factions (fire, sentenced, plague, frost, holy)",
  "  --edge w>l,w>l        only these designed edges, e.g. wand>bow,sword>wand",
  "  --perception p        client (default), stale or present: what the clients read (see duel.ts)",
  "  --arena a             open (default), pillars (replaces the open one) or both",
  "  --cap seconds         one time cap for every faction",
  "  --quiet               no progress lines",
].join("\n");

function fail(msg: string): never {
  console.error(`${msg}\n${USAGE}`);
  process.exit(2);
}

function parseArgs(argv: string[]): ReportOptions & { quiet: boolean } {
  const opts: ReportOptions & { quiet: boolean } = { quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const eq = arg.startsWith("--") ? arg.indexOf("=") : -1;
    const flag = eq > 0 ? arg.slice(0, eq) : arg;
    const inline = eq > 0 ? arg.slice(eq + 1) : undefined;
    const value = (): string => {
      const v = inline ?? argv[++i];
      if (v === undefined || v === "" || v.startsWith("--")) fail(`${flag} needs a value`);
      return v;
    };
    switch (flag) {
      case "--quick": opts.quick = true; break;
      case "--core": opts.core = true; break;
      case "--quiet": opts.quiet = true; break;
      case "--grid-setups": {
        const v = value();
        if (v !== "full" && v !== "reduced") fail(`--grid-setups takes full or reduced, not "${v}"`);
        opts.gridSetups = v;
        break;
      }
      case "--faction": {
        const ids = value().split(",");
        const bad = ids.find((f) => !isFactionId(f));
        if (bad) fail(`unknown faction "${bad}"`);
        opts.factions = ids as FactionId[];
        break;
      }
      case "--edge": {
        const edges: Edge[] = [];
        for (const spec of value().split(",")) {
          const [w, l] = spec.split(">");
          const edge = WEAPON_BEATS.find(([a, b]) => a === w && b === l);
          if (!edge || !isWeaponId(w) || !isWeaponId(l)) fail(`"${spec}" is not a designed edge (winner>loser)`);
          edges.push(edge);
        }
        opts.edges = edges;
        break;
      }
      case "--perception": {
        const v = value();
        if (v !== "client" && v !== "stale" && v !== "present") fail(`unknown perception "${v}"`);
        opts.perception = v as Perception;
        break;
      }
      case "--arena": {
        const v = value();
        if (v !== "open" && v !== "pillars" && v !== "both") fail(`unknown arena "${v}"`);
        opts.arena = v as Arena | "both";
        break;
      }
      case "--cap": {
        const n = Number(value());
        if (!(n > 0)) fail("--cap needs a positive number of seconds");
        opts.capSeconds = n;
        break;
      }
      case "--help": case "-h": console.log(USAGE); process.exit(0);
      default: fail(`unknown option ${arg}`);
    }
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
if (!opts.quiet) opts.log = (line) => console.error(`[harness] ${line}`);
console.log(buildReport(opts).text);
