// What one card is worth in a duel (BALANCE_CONTRACT 4.7, the pick-value scan): mirror duels, fighter A holds the card and
// fighter B does not, everything else equal, in the real sim. A card is worth what it adds to the holder's side of a fight, so it is
// the holder's hp left (h) when it wins, and the damage multiplier r ~ 1 / (1 - h) that the same fight would need to be even.
//
//   npx tsx packages/server/bench/pickValue.ts <card|all|base|conditional|augment> [--weapons fists,sword,axe,bow,wand,shield]
//                                              [--setups 6] [--pvp] [--style lock|policy] [--cap 200] [--json FILE]
//
//   Duel    both fighters the same faction and weapon (a mirror, signatures on), each ordered pair of seats, `setups` of the 18
//           fullSetups() (evenly spread), seed 1 + 7 i, style `lock` (the controls of the game client) by default.
//   Kits    A holds `card`; B holds nothing, except that a conditional card's base card (its `requires` stat, tier I) goes to BOTH, so
//           the conditional is the only difference. Cards are granted through the chest's own `grantCard`: a card it refuses is held by
//           no one, and the cell says so.
//   PvP     the PvP factor and caps are OFF unless `--pvp` is given: with them on, a holder at card power 1 deals 1.10 against a
//           fresh fighter's 0.75 and every card would read as "worth +47%". The factor is the contract's own subject (3.4); this
//           scan measures the card.
//   h       median over setups and both seats of (holder's hp fraction at the end if it wins, 0 for a draw or a cap, minus the
//           opponent's hp fraction if it loses). 0 is even, +100 a clean win.
//
// Cards whose effect is a hook that is not wired yet (the phase-B cards, `ready: "b"`, and the readers listed in cards.ts) are
// reported as `no effect yet` instead of a value: an empty row cannot change a duel.
import { writeFileSync } from "node:fs";
import {
  CARD_IDS, cardDef, FACTION_IDS, type CardId, type FactionId, type WeaponId,
} from "@raid/shared";
import { runDuel } from "../src/harness/duel";
import { fullSetups } from "../src/harness/matrix";
import { flag, median, opt } from "./lib/balance";

const args = process.argv.slice(2);
if (flag(args, "help") || args.length === 0) {
  console.log("usage: npx tsx packages/server/bench/pickValue.ts <card|all|base|conditional|augment> [--weapons fists,sword,axe,bow,wand,shield] [--setups 6] [--pvp] [--style lock|policy] [--cap 200] [--json FILE]");
  process.exit(0);
}

const WEAPONS: readonly WeaponId[] = ["fists", "sword", "axe", "bow", "wand", "shield"];
const pickArg = args[0]!;
const weapons = opt(args, "weapons", WEAPONS.join(",")).split(",") as WeaponId[];
const nSetups = Number(opt(args, "setups", "6"));
const style: "lock" | "policy" = opt(args, "style", "lock") === "policy" ? "policy" : "lock";
const cap = Number(opt(args, "cap", "200"));
const pvp = flag(args, "pvp");
const jsonOut = opt(args, "json", "");

const setups = fullSetups().filter((_, i) => i % Math.ceil(18 / nSetups) === 0);

/** The ids a name stands for: one card, a kind, or the whole catalog. */
function picksOf(name: string): CardId[] {
  if (name === "all") return [...CARD_IDS];
  if (name === "base" || name === "conditional" || name === "augment") return CARD_IDS.filter((id) => cardDef(id)!.kind === name);
  if (!CARD_IDS.includes(name as CardId)) throw new Error(`unknown card "${name}" (all, base, conditional, augment, or one of ${CARD_IDS.slice(0, 6).join(", ")}...)`);
  return [name as CardId];
}

/** What fighter B holds: the card's base card, for a conditional (so the conditional is the only difference), else nothing. */
function prerequisite(id: CardId): CardId[] {
  const def = cardDef(id)!;
  return def.kind === "conditional" && def.requires ? [`${def.requires}1` as CardId] : [];
}

/** Holder's margin in one duel, seat 0 or 1: its hp left when it wins, minus the opponent's when it loses, 0 for a draw. */
function margin(f: FactionId, w: WeaponId, id: CardId, setupIndex: number, seat: 0 | 1): number {
  const setup = setups[setupIndex]!;
  const held = [...prerequisite(id), id];
  const other = prerequisite(id);
  const r = runDuel({
    faction: f, factions: [f, f], weapons: [w, w], distance: setup.distance, angle: setup.angle, delayTicks: setup.delayTicks,
    arena: "open", perception: "client", capSeconds: cap, seed: 1 + setupIndex * 7, signatures: true,
    ...(style === "lock" ? { locks: [true, true] as const } : {}),
    ...(pvp ? {} : { pvpRules: false }),
    cards: seat === 0 ? [held, other] : [other, held],
  });
  return r.winner === seat ? r.hpFrac[seat]! : r.winner === null ? 0 : -r.hpFrac[1 - seat]!;
}

const evenR = (h: number): number => (h >= 0 ? 1 / (1 - Math.min(0.95, h)) : -(1 / (1 + Math.max(-0.95, h))));

interface Cell { faction: FactionId; weapon: WeaponId; h: number; r: number }
const out: Record<string, Cell[] | string> = {};
const t0 = performance.now();
for (const id of picksOf(pickArg)) {
  const def = cardDef(id)!;
  if (def.effects.length === 0 && !def.byFaction) {
    out[id] = "no effect yet";
    console.log(`${id.padEnd(20)} no effect yet (${def.ready === "b" ? "phase B: needs the hook " + (def.hook ?? "?") : "empty"})`);
    continue;
  }
  const cells: Cell[] = [];
  const lines: string[] = [];
  for (const w of weapons) {
    const row: string[] = [];
    for (const f of FACTION_IDS) {
      const hs: number[] = [];
      for (let i = 0; i < setups.length; i++) for (const seat of [0, 1] as const) hs.push(margin(f, w, id, i, seat));
      const h = median(hs);
      cells.push({ faction: f, weapon: w, h, r: evenR(h) });
      row.push((h * 100).toFixed(0).padStart(5));
    }
    lines.push(`${id.padEnd(20)} ${w.padEnd(7)}${row.join("")}`);
  }
  out[id] = cells;
  const all = cells.map((c) => c.h);
  console.log(`# ${id} (${def.kind}, tier ${def.tier}${def.requires ? ", needs " + def.requires : ""}): h by weapon (rows) x faction (${FACTION_IDS.join(" ")})`);
  console.log(lines.join("\n"));
  console.log(`  median h ${(median(all) * 100).toFixed(0)}  min ${(Math.min(...all) * 100).toFixed(0)}  max ${(Math.max(...all) * 100).toFixed(0)}  r ~ x${evenR(median(all)).toFixed(2)}\n`);
}
console.log(`# ${pickArg}: ${((performance.now() - t0) / 1000).toFixed(1)} s, ${setups.length} setups x 2 seats, ${style}, PvP rules ${pvp ? "on" : "off"}`);
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(out));
