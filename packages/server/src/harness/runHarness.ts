// CLI: runs the weapon duel harness and prints its report.
//   npm run harness -w @raid/server [-- --quick] [--faction fire,holy] [--edge wand>bow] [--perception client|stale|present]
//                                   [--arena open|pillars|both] [--cap SECONDS] [--quiet]
//                                   [--kiting-only] [--shooter-cards haste2,fleet2] [--shooter-as 1.08]
//                                   [--chaser-cards quickdraw] [--winner-cards quickdraw] [--loser-cards quickdraw]
//                                   [--shooter-windup 0.88] [--shooter-move 1.1]
// The full report takes about a minute; --quick (three setups per cell, no sensitivity passes) a few seconds; --kiting-only
// (the kiting table and the faction edges against a kiting shooter, one holding cards with --shooter-*) about 35 s. It never
// fails on an outcome: it is information for the owner.
import { BEATS, WEAPON_BEATS, cardLive, isCardId, isFactionId, isWeaponId, type FactionId } from "@raid/shared";
import type { Arena, Perception } from "./duel";
import type { Edge } from "./matrix";
import { buildReport, type ReportOptions } from "./report";

const USAGE = [
  "usage: npm run harness -w @raid/server [-- options]",
  "  --quick               three setups per cell, no style grids, sensitivity or cluttered-arena passes",
  "  --core                the full matrix, grids, verdicts, target lock and kiting, without the client-view and cluttered-arena passes",
  "  --grid-setups full    every setup of the main matrix in each style-grid cell instead of three (steadier, about 6x slower grids)",
  "  --faction a,b         only these factions (fire, sentenced, plague, frost, holy)",
  "  --edge w>l,w>l        only these designed edges, e.g. wand>bow,sword>wand",
  "  --perception p        client (default), stale or present: what the clients read (see duel.ts)",
  "  --arena a             open (default), pillars (replaces the open one) or both",
  "  --cap seconds         one time cap for every faction",
  "  --quiet               no progress lines",
  "  --shooter-cards c,..  the shooter of every kiting duel holds these cards through the chest's own grant (a card id twice is two copies: haste2,haste2,fleet2); the chaser none",
  "  --shooter-as x        the shooter of every kiting duel attacks x times as fast on top of its cards (a mod source)",
  "  --shooter-speed x     a Fleet card on the shooter of every kiting duel, the shipped rule: 1.06 is Fleet I, 1.10 Fleet II (= --shooter-cards fleet1|fleet2)",
  "  --chaser-cards c,..   the same for the melee chaser (Quickdraw on the chaser); --winner-cards / --loser-cards: the designed winner / loser of every weapon-matrix duel",
  "  --shooter-windup x    a bare windup multiplier on the shooter (a scan; scaleWindup shortens melee windups only, so a shooter's ranged windups do not move); also --chaser-windup, --winner-windup, --loser-windup",
  "  --shooter-move x      a bare move-speed multiplier on the shooter (the pre-ruling Swift Boots: no pause after a shot, for comparison); also --chaser-move",
  "  --kite-edge a>b,..    only these faction edges (winner>loser, e.g. frost>fire) in KITE EDGES",
  "  --edge-setups n       KITE EDGES with 10 (default), 32 or 128 setups per melee weapon (for a cell on the 50% line)",
  "  --kiting-only         only the KITING section and KITE EDGES (the faction edges against a kiting shooter, signatures on)",
].join("\n");

function fail(msg: string): never {
  console.error(`${msg}\n${USAGE}`);
  process.exit(2);
}

function mult(flag: string, v: string): number {
  const n = Number(v);
  if (!(n > 0)) fail(`${flag} needs a positive multiplier`);
  return n;
}

/** "haste2,haste2,quickdraw" -> card ids (a repeat is another copy), refusing a name the catalog lacks and a card that is not live yet. */
function parseCards(spec: string): string[] {
  return spec.split(",").map((id) => {
    if (!isCardId(id) || !cardLive(id)) fail(`"${id}" is not a live card id (e.g. haste2, fleet2, quickdraw)`);
    return id;
  });
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
      case "--shooter-as": {
        const n = Number(value());
        if (!(n > 0)) fail("--shooter-as needs a positive multiplier");
        opts.shooter = { ...opts.shooter, asMult: n };
        break;
      }
      case "--shooter-speed": {
        // A Fleet card through the real grant (its pause after a shot included): 1.06 is Fleet I, 1.10 Fleet II.
        const v = value();
        const id = Number(v) === 1.06 ? "fleet1" : Number(v) === 1.1 ? "fleet2" : null;
        if (id === null) fail(`--shooter-speed takes 1.06 (Fleet I) or 1.10 (Fleet II), not "${v}"; --shooter-cards and --shooter-move take anything else`);
        opts.shooter = { ...opts.shooter, cards: [...(opts.shooter?.cards ?? []), id] };
        break;
      }
      case "--shooter-cards": opts.shooter = { ...opts.shooter, cards: parseCards(value()) }; break;
      case "--chaser-cards": opts.chaser = { ...opts.chaser, cards: parseCards(value()) }; break;
      case "--winner-cards": opts.winner = { ...opts.winner, cards: parseCards(value()) }; break;
      case "--loser-cards": opts.loser = { ...opts.loser, cards: parseCards(value()) }; break;
      case "--shooter-windup": opts.shooter = { ...opts.shooter, windupMult: mult(flag, value()) }; break;
      case "--chaser-windup": opts.chaser = { ...opts.chaser, windupMult: mult(flag, value()) }; break;
      case "--winner-windup": opts.winner = { ...opts.winner, windupMult: mult(flag, value()) }; break;
      case "--loser-windup": opts.loser = { ...opts.loser, windupMult: mult(flag, value()) }; break;
      case "--shooter-move": opts.shooter = { ...opts.shooter, speedMult: mult(flag, value()) }; break;
      case "--chaser-move": opts.chaser = { ...opts.chaser, speedMult: mult(flag, value()) }; break;
      case "--kiting-only": opts.kitingOnly = true; break;
      case "--kite-edge": {
        const edges: Array<readonly [FactionId, FactionId]> = [];
        for (const spec of value().split(",")) {
          const [a, b] = spec.split(">");
          if (!BEATS.some(([w, l]) => w === a && l === b)) fail(`"${spec}" is not a faction edge (winner>loser)`);
          edges.push([a as FactionId, b as FactionId]);
        }
        opts.kiteEdges = edges;
        break;
      }
      case "--edge-setups": {
        const n = Number(value());
        if (n !== 10 && n !== 32 && n !== 128) fail("--edge-setups takes 10, 32 or 128");
        opts.edgeSetups = n;
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
