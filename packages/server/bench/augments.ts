// The augment extremes (BALANCE_CONTRACT 4.7, acceptance A14): the strongest builds a chest can deal against the minute-5 kit of the
// same faction, in the real sim with the guards on (G1-G13). It answers one question: does any build kill in under 1.0 s (4+ hits), and
// does a build's median kill stay at or above half the base kit's.
//
//   npx tsx packages/server/bench/augments.ts [--card id] [--factions fire,sentenced,...] [--setups 6] [--style lock|policy]
//                                              [--factor equal|real] [--cap 200] [--json FILE]
//
//   Duel    a mirror of one faction on its signature weapon (SIGNATURE_WEAPONS), both on the minute-5 kit (kits.ts: O1 vitality1 haste1
//           O2 armor1), `setups` of the 18 fullSetups(), both seats for the holder, signatures on, the PvP rules ON (the factor and the
//           caps G2/G3 are what is being checked). The holder gets the build's extra cards on top of the kit, in order (a conditional
//           after its base).
//   Factor  `equal` (the default, as in 4.7): the holder's damage is scaled by f(P of the kit) / f(P of the holder), so the extra cards
//           do not also buy the PvP factor and the build's own effect shows. `real` leaves the shipped factor in (a stacked build then
//           also wins on power, as 4.7 reading 6 says it should).
//   Output  per build and faction: the holder's win % (a draw or cap counts half), the median and minimum kill time (seconds from the
//           first landed hit to the end of a finished duel, whoever won it) and, last, the A14 lines. A build that holds a card with
//           no effect in a duel (a card that is not live, or a rule with nothing to act on) says so: its numbers are the rest of the build.
import { writeFileSync } from "node:fs";
import {
  cardDef, cardPower, FACTION_IDS, pvpFactor, SIGNATURE_WEAPONS, type CardId, type FactionId,
} from "@raid/shared";
import { runDuel } from "../src/harness/duel";
import { fullSetups } from "../src/harness/matrix";
import { flag, median, opt, pct, sec } from "./lib/balance";
import { kitCards } from "./kits";

const args = process.argv.slice(2);
if (flag(args, "help")) {
  console.log("usage: npx tsx packages/server/bench/augments.ts [--card id] [--factions fire,sentenced,...] [--setups 6] [--style lock|policy] [--factor equal|real] [--cap 200] [--json FILE]");
  process.exit(0);
}
const cardArg = opt(args, "card", "");
const factions = opt(args, "factions", FACTION_IDS.join(",")).split(",") as FactionId[];
const nSetups = Number(opt(args, "setups", "6"));
const style: "lock" | "policy" = opt(args, "style", "lock") === "policy" ? "policy" : "lock";
const factor = opt(args, "factor", "equal") === "real" ? "real" : "equal";
const cap = Number(opt(args, "cap", "200"));
const jsonOut = opt(args, "json", "");
const setups = fullSetups().filter((_, i) => i % Math.ceil(18 / nSetups) === 0);

interface Build { name: string; extra: readonly CardId[]; note?: string }

/** The extremes of 4.7, as card lists. "Might III-class" is Attack Damage III (+33 flat), the biggest damage row a base card carries. */
const BUILDS: readonly Build[] = [
  { name: "base (the kit only)", extra: [] },
  { name: "Boom", extra: ["hereComesTheBoom"] },
  { name: "Boom + AP III", extra: ["hereComesTheBoom", "ap3"] },
  { name: "Glass Cannon + AD III", extra: ["glassCannon", "ad3"] },
  { name: "Race to 0", extra: ["raceToZero"] },
  { name: "Race + Bloodthirst + Leech III + Vitality III", extra: ["raceToZero", "leech3", "bloodthirst", "vitality3"] },
  { name: "Race + Boom", extra: ["raceToZero", "hereComesTheBoom"] },
  { name: "Machine Gun", extra: ["machineGun"] },
  { name: "Coup de Grace + AD III", extra: ["coupDeGrace", "ad3"] },
  { name: "Big Game Hunter + Sitting Ducks", extra: ["bigGameHunter", "sittingDucks"] },
  { name: "Slow Burn + Siphon + Leech III", extra: ["slowBurn", "siphon", "leech3"] },
  // The phase-B hooks (agent A4): crits, streaks, the on-hit pipeline, the gamble and the returned damage, stacked as far as a chest allows.
  { name: "Rhythm + Cruel Wounds + Haste III + AD III", extra: ["haste3", "rhythm", "cruelWounds", "ad3"] },
  { name: "Boom + Haste III + Rhythm", extra: ["hereComesTheBoom", "haste3", "rhythm"] },
  { name: "Gambler + Glass Cannon + AD III", extra: ["gambler", "glassCannon", "ad3"] },
  { name: "Boom + Gambler + AD III", extra: ["hereComesTheBoom", "gambler", "ad3"] },
  { name: "Tunnel Vision + First Impressions + AD III", extra: ["tunnelVision", "firstImpressions", "ad3"] },
  { name: "Glass Cannon + Tunnel Vision + Coup de Grace + AD III", extra: ["glassCannon", "tunnelVision", "coupDeGrace", "ad3"] },
  { name: "Hemorrhage + Third Time + Eye + Haste III", extra: ["hemorrhage", "thirdTimesTheCharm", "eyeForAnEye", "haste3"] },
  { name: "Machine Gun + Hemorrhage + Third Time + Fists of Fury", extra: ["machineGun", "hemorrhage", "thirdTimesTheCharm", "fistsOfFury"] },
  { name: "Plant Your Feet + AD III", extra: ["plantYourFeet", "ad3"] },
  { name: "Spiked Shell + Armor III + Vitality III", extra: ["spikedShell", "armor3", "vitality3"] },
  { name: "Adrenaline + Haste III + Fleet III", extra: ["adrenaline", "haste3", "fleet3"] },
  { name: "Overkill + Boom + AD III", extra: ["overkill", "hereComesTheBoom", "ad3"] },
  { name: "Festering Arcana + AP III + Slow Burn", extra: ["ap3", "festeringArcana", "slowBurn"] },
  { name: "Race + Rhythm + Cruel Wounds + Haste III", extra: ["raceToZero", "haste3", "rhythm", "cruelWounds"] },
];

/**
 * What a card in a build does not do (yet). Every card of the catalog is live since the phase-B hooks landed (agent A4); a card that
 * is not live, or a rule with nothing to act on in a duel (Overkill and Wishful Thinking need a third fighter or a Wish in play, Tank
 * Engine and Pocket Sand a shield), says so here and its numbers are the rest of the build.
 */
const INERT: Readonly<Partial<Record<CardId, string>>> = {
  overkill: "splashes only onto a third fighter: nothing to act on in a duel",
  wishfulThinking: "shortens a Wish that no duel casts",
  tankEngine: "grows only from blocks (a shield on the holder)",
  pocketSand: "slows only on a block (a shield on the holder)",
  bestOffense: "counts only blocks (a shield on the holder)",
};

function note(extra: readonly CardId[]): string {
  const parts = extra.flatMap((id) => {
    if (INERT[id]) return [`${id}: ${INERT[id]}`];
    return cardDef(id)?.ready === "b" ? [`${id}: not live, no effect (${cardDef(id)?.hook ?? "hook"})`] : [];
  });
  return parts.join("; ");
}

interface Cell { faction: FactionId; win: number; ttks: number[]; n: number; caps: number }

function playBuild(build: Build, faction: FactionId): Cell {
  const weapon = SIGNATURE_WEAPONS[faction];
  const kit = kitCards(5, weapon) as CardId[];
  const holder = [...kit, ...build.extra];
  const scaleFor = factor === "equal" ? pvpFactor(cardPower(Object.fromEntries(kit.map((id) => [id, 1])))) / pvpFactor(cardPower(Object.fromEntries(holder.map((id) => [id, 1])))) : 1;
  let wins = 0;
  let caps = 0;
  const ttks: number[] = [];
  let n = 0;
  setups.forEach((setup, i) => {
    for (const seat of [0, 1] as const) {
      const seed = 1 + i * 7;
      const r = runDuel({
        faction, factions: [faction, faction], weapons: [weapon, weapon], distance: setup.distance, angle: setup.angle,
        delayTicks: setup.delayTicks, arena: "open", perception: "client", capSeconds: cap, seed, signatures: true,
        ...(style === "lock" ? { locks: [true, true] as const } : {}),
        cards: seat === 0 ? [holder, kit] : [kit, holder],
        ...(scaleFor !== 1 ? { damageScale: (seat === 0 ? [scaleFor, 1] : [1, scaleFor]) as [number, number] } : {}),
      });
      n++;
      if (r.end === "cap") { caps++; wins += 0.5; continue; }
      ttks.push(r.seconds - (r.hitLog.length > 0 ? r.hitLog[0]!.t : 0)); // every finished duel is a kill time, whoever won it
      if (r.winner === seat) wins++;
      else if (r.winner === null) wins += 0.5;
    }
  });
  return { faction, win: wins / n, ttks, n, caps };
}

const picked: Build[] = cardArg
  ? [BUILDS[0]!, { name: cardDef(cardArg as CardId)?.title ?? cardArg, extra: prerequisiteThen(cardArg as CardId) }]
  : [...BUILDS];

function prerequisiteThen(id: CardId): CardId[] {
  const def = cardDef(id);
  if (!def) throw new Error(`unknown card "${id}"`);
  return def.kind === "conditional" && def.requires ? [`${def.requires}1` as CardId, id] : [id];
}

console.log(`# augment extremes: ${factions.join(" ")}, ${setups.length} setups x 2 seats, ${style}, PvP rules on, factor ${factor}\n`);
console.log(`| build | ${factions.map((f) => `${f} win% / median s`).join(" | ")} | min kill s | note |`);
console.log(`|---|${factions.map(() => "---").join("|")}|---|---|`);

interface Row { build: Build; cells: Cell[]; medianAll: number; min: number }
const rows: Row[] = [];
const t0 = performance.now();
for (const build of picked) {
  const cells = factions.map((f) => playBuild(build, f));
  const all = cells.flatMap((c) => c.ttks);
  const min = all.length > 0 ? Math.min(...all) : NaN;
  const med = median(cells.map((c) => median(c.ttks)).filter(Number.isFinite));
  rows.push({ build, cells, medianAll: med, min });
  console.log(`| ${build.name} | ${cells.map((c) => `${pct(c.win)}% / ${sec(median(c.ttks))}`).join(" | ")} | ${sec(min)} | ${note(build.extra)} |`);
}
console.log(`\n# ${((performance.now() - t0) / 1000).toFixed(1)} s`);

const base = rows[0]!;
console.log("\nA14: no kill under 1.0 s (4+ hits), and in every faction a build's median kill is at least 50% of the base kit's median there:");
let fails = 0;
for (const r of rows) {
  const ratios = r.cells.map((c, i) => median(c.ttks) / median(base.cells[i]!.ttks));
  const worst = Math.min(...ratios.filter(Number.isFinite));
  const at = factions[ratios.indexOf(worst)];
  const okMin = !(r.min < 1.0);
  const okMed = worst >= 0.5;
  if (!okMin || !okMed) fails++;
  console.log(`${okMin && okMed ? "PASS" : "FAIL"} ${r.build.name}: min kill ${sec(r.min)} s (>= 1.0), worst median ${(worst * 100).toFixed(0)}% of the base's (>= 50%, ${at})`);
}
console.log(fails === 0 ? "A14 holds for every build above." : `${fails} build(s) break A14.`);
if (jsonOut) {
  writeFileSync(jsonOut, JSON.stringify(rows.map((r) => ({
    build: r.build.name, extra: r.build.extra, min: r.min, cells: r.cells.map((c) => ({ faction: c.faction, win: c.win, median: median(c.ttks), n: c.n, caps: c.caps })),
  }))));
}
