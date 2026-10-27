// The augment extremes (BALANCE_CONTRACT 4.7, acceptance A14): the strongest builds a chest can deal against the minute-5 kit of the
// same faction, in the real sim with the guards on (G1-G13). It answers one question: does any build kill in under 1.0 s (4+ hits), and
// does a build's median kill stay at or above half the base kit's.
//
//   npx tsx packages/server/bench/augments.ts [--card id] [--factions fire,sentenced,...] [--setups 6] [--style lock|policy]
//                                              [--factor equal|real] [--draws 4] [--cap 200] [--only "name|name"] [--weapon id] [--minute 5] [--json FILE]
//
//   Duel    a mirror of one faction on its signature weapon (SIGNATURE_WEAPONS), both on the minute-5 kit (kits.ts: O1 vitality1 haste1
//           O2 armor1), `setups` of the 18 fullSetups(), both seats for the holder, signatures on, the PvP rules ON (the factor and the
//           caps G2/G3 are what is being checked). The holder gets the build's extra cards on top of the kit, in order (a conditional
//           after its base).
//   Factor  `equal` (the default, as in 4.7): the holder's damage is scaled by f(P of the kit) / f(P of the holder), so the extra cards
//           do not also buy the PvP factor and the build's own effect shows. `real` leaves the shipped factor in (a stacked build then
//           also wins on power, as 4.7 reading 6 says it should).
//   Weapon  every faction fights with its reference weapon unless `--weapon sword` (any of the five) gives all of them one: the
//           kit's offense base follows it (kits.ts), so a build that needs a weapon (Machine Gun wants a melee one: a ranged windup never
//           shortens, so it gains no extra arrows) can be judged where it is meant to be played.
//   Minute  the kit's minute, 5 by default (A14's); `--minute 0` plays fists against fists with no cards, where the unarmed cards (Fists of Fury)
//           are the extremes and `--weapon` is ignored.
//   Noise   the win % is measured under the balance pass's play-variance model (lib/balance.ts, sigma 0.45 per fighter and duel; the
//           contract's 4 draws at minute 5): `--draws 0` turns it off. The kill times are always noise-free (the A14 numbers).
//   Output  per build and faction: the holder's win % (noisy, with the noise-free one in brackets; a draw or cap counts half), the median and minimum kill time (seconds from the
//           first landed hit to the end of a finished duel, whoever won it) and, last, the A14 lines. A build that holds a card with
//           no effect in a duel (a card that is not live, or a rule with nothing to act on) says so: its numbers are the rest of the build.
//   A14     per faction, against that faction's own base kit (the strict reading is BALANCE_CONTRACT 1.2 as written):
//             median   at least 50% of the base's median there. A SUSTAIN MIRROR (a base median of 5 s or more: Holy's lifesteal, Frost's
//                      chill and blocks stall their mirrors at 8.8 s and 15.8 s against a pooled 5 s) is elastic: a pure +35% of damage
//                      already ends a Holy mirror in 4.7 s. There a build also passes with a median of at least A14_SUSTAIN_FLOOR_S (half
//                      the late-TTK target of 5 s, A2): it is printed PASS* with the strict miss beside it, so both readings stay visible.
//             fastest  at least 1.0 s where the base's median is 2 s or more, else at least 50% of the base's fastest (the Fire mirror's
//                      base already ends in about 1.1 s, 5-6 hits: an absolute second would fail the unmodified kit).
//           The fewest hits any winner needed is printed beside it. A holder that LOSES a faction it should not (win under 30% or over 85%
//           with a single card of the extremes) is a trap or a runaway and is printed by the TRAP line.
//   Weapon  every faction fights with its reference weapon unless `--weapon sword` (any of the five) gives all of them one: the
//           kit's offense base follows it (kits.ts), so a build that needs a weapon (Machine Gun wants a melee one: a ranged windup never
//           shortens, so it gains no extra arrows) can be judged where it is meant to be played.
//   Minute  the kit's minute, 5 by default (A14's); `--minute 0` plays fists against fists with no cards, where the unarmed cards (Fists of Fury)
//           are the extremes and `--weapon` is ignored.
//   Noise   the win % is measured under the balance pass's play-variance model (lib/balance.ts, sigma 0.45 per fighter and duel; the
//           contract's 4 draws at minute 5): `--draws 0` turns it off. The kill times are always noise-free (the A14 numbers).
//   Output  per build and faction: the holder's win % (noisy, with the noise-free one in brackets; a draw or cap counts half), the median and minimum kill time (seconds from the
//           first landed hit to the end of a finished duel, whoever won it) and, last, the A14 lines. A build that holds a card with
//           no effect in a duel (a card that is not live, or a rule with nothing to act on) says so: its numbers are the rest of the build.
//   A14     per faction, against that faction's own base kit: the median kill is at least 50% of the base's median there; the fastest
//           kill is at least 1.0 s where the base's median is 2 s or more, and at least 50% of the base's fastest where it is not (the
//           Fire mirror's base already ends in about 1.1 s, 5-6 hits: an absolute second would fail the unmodified kit). The fewest
//           hits any winner needed is printed beside it. A holder that LOSES a faction it should not (win under 30% or over 85% with a
//           single card of the extremes) is a trap or a runaway and is printed by the TRAP line.
import { writeFileSync } from "node:fs";
import {
  cardDef, cardPower, FACTION_IDS, pvpFactor, SIGNATURE_WEAPONS, type CardId, type FactionId, type WeaponId,
} from "@raid/shared";
import { runDuel } from "../src/harness/duel";
import { fullSetups } from "../src/harness/matrix";
import { flag, median, noiseOf, opt, pct, SIGMA, sec } from "./lib/balance";
import { kitCards, kitWeapon, parseMinutes } from "./kits";

const args = process.argv.slice(2);
if (flag(args, "help")) {
  console.log("usage: npx tsx packages/server/bench/augments.ts [--card id] [--factions fire,sentenced,...] [--setups 6] [--style lock|policy] [--factor equal|real] [--draws 4] [--cap 200] [--only 'name|name'] [--weapon id] [--minute 5] [--json FILE]");
  process.exit(0);
}
const cardArg = opt(args, "card", "");
const factions = opt(args, "factions", FACTION_IDS.join(",")).split(",") as FactionId[];
const nSetups = Number(opt(args, "setups", "6"));
const style: "lock" | "policy" = opt(args, "style", "lock") === "policy" ? "policy" : "lock";
const factor = opt(args, "factor", "equal") === "real" ? "real" : "equal";
const cap = Number(opt(args, "cap", "200"));
const draws = Number(opt(args, "draws", "4"));
/** A14's median floor for a sustain mirror (base median >= 5 s): half the late-TTK target of 5 s (BALANCE_CONTRACT 1.2, A2). */
const A14_SUSTAIN_FLOOR_S = 2.5;
const minute = parseMinutes(opt(args, "minute", "5"))[0]!;
const weaponArg = opt(args, "weapon", "");
if (weaponArg !== "" && !(["sword", "bow", "wand", "shield", "axe"] as const).includes(weaponArg as never)) throw new Error(`--weapon ${weaponArg} is not one of the five loop weapons`);
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
  // Machine Gun's build-around: every swing is a proc at full strength, so it is judged beside the same on-hit cards without it.
  { name: "Hemorrhage + Third Time + Eye", extra: ["hemorrhage", "thirdTimesTheCharm", "eyeForAnEye"] },
  { name: "Machine Gun + Hemorrhage + Third Time + Eye", extra: ["machineGun", "hemorrhage", "thirdTimesTheCharm", "eyeForAnEye"] },
  { name: "Machine Gun + Hemorrhage + Tunnel Vision", extra: ["machineGun", "hemorrhage", "tunnelVision"] },
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

interface Cell { faction: FactionId; win: number; winND: number; ttks: number[]; n: number; caps: number; minHits: number }

/** The card power of a list of ids, a repeated id counting once per copy (the shield's kit holds Armor I twice). */
function powerOfList(ids: readonly string[]): number {
  const counts: Record<string, number> = {};
  for (const id of ids) counts[id] = (counts[id] ?? 0) + 1;
  return cardPower(counts);
}

function playBuild(build: Build, faction: FactionId): Cell {
  const weapon = minute === 0 ? kitWeapon(faction, 0) : weaponArg !== "" ? (weaponArg as WeaponId) : SIGNATURE_WEAPONS[faction];
  const kit = kitCards(minute, weapon) as CardId[];
  const holder = [...kit, ...build.extra];
  const scaleFor = factor === "equal" ? pvpFactor(powerOfList(kit)) / pvpFactor(powerOfList(holder)) : 1;
  let winsND = 0;
  let winsNoisy = 0;
  let nNoisy = 0;
  let caps = 0;
  let minHits = Infinity;
  const ttks: number[] = [];
  let n = 0;
  const play = (setup: (typeof setups)[number], i: number, seat: 0 | 1, noise: readonly [number, number]) => {
    const seed = 1 + i * 7;
    const scale: [number, number] = seat === 0 ? [scaleFor * noise[0], noise[1]] : [noise[0], scaleFor * noise[1]];
    return runDuel({
      faction, factions: [faction, faction], weapons: [weapon, weapon], distance: setup.distance, angle: setup.angle,
      delayTicks: setup.delayTicks, arena: "open", perception: "client", capSeconds: cap, seed, signatures: true,
      ...(style === "lock" ? { locks: [true, true] as const } : {}),
      cards: seat === 0 ? [holder, kit] : [kit, holder],
      ...(scale[0] !== 1 || scale[1] !== 1 ? { damageScale: scale } : {}),
    });
  };
  const score = (r: ReturnType<typeof play>, seat: 0 | 1): number => (r.end === "cap" || r.winner === null ? 0.5 : r.winner === seat ? 1 : 0);
  setups.forEach((setup, i) => {
    for (const seat of [0, 1] as const) {
      const r = play(setup, i, seat, [1, 1]);
      n++;
      winsND += score(r, seat);
      if (r.end === "cap") caps++;
      else {
        ttks.push(r.seconds - (r.hitLog.length > 0 ? r.hitLog[0]!.t : 0)); // every finished duel is a kill time, whoever won it
        if (r.winner !== null) minHits = Math.min(minHits, r.counts.hits[r.winner]);
      }
      for (let d = 0; d < draws; d++) {
        winsNoisy += score(play(setup, i, seat, noiseOf(1 + i * 7, d, SIGMA)), seat);
        nNoisy++;
      }
    }
  });
  return { faction, win: draws > 0 ? winsNoisy / nNoisy : winsND / n, winND: winsND / n, ttks, n, caps, minHits };
}

const only = opt(args, "only", "").split("|").filter((x) => x !== "").map((x) => x.toLowerCase());
const picked: Build[] = cardArg
  ? [BUILDS[0]!, { name: cardDef(cardArg as CardId)?.title ?? cardArg, extra: prerequisiteThen(cardArg as CardId) }]
  : only.length > 0
    ? BUILDS.filter((b, i) => i === 0 || only.some((o) => b.name.toLowerCase().includes(o)))
    : [...BUILDS];

function prerequisiteThen(id: CardId): CardId[] {
  const def = cardDef(id);
  if (!def) throw new Error(`unknown card "${id}"`);
  return def.kind === "conditional" && def.requires ? [`${def.requires}1` as CardId, id] : [id];
}

console.log(`# augment extremes: ${factions.join(" ")}${minute === 0 ? " all on fists, no cards" : weaponArg !== "" ? ` all on the ${weaponArg}` : ""}, ${setups.length} setups x 2 seats, ${style}, PvP rules on, factor ${factor}, ${draws > 0 ? `win % over ${draws} noise draws (sigma ${SIGMA}), noise-free in brackets` : "noise off"}\n`);
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
  console.log(`| ${build.name} | ${cells.map((c) => `${pct(c.win)}%${draws > 0 ? ` (${pct(c.winND)})` : ""} / ${sec(median(c.ttks))}`).join(" | ")} | ${sec(min)} | ${note(build.extra)} |`);
}
console.log(`\n# ${((performance.now() - t0) / 1000).toFixed(1)} s`);

const base = rows[0]!;
console.log("\nA14 per faction. Median: at least 50% of the base kit's median there (PASS*: only a sustain mirror, base median >= 5 s, under that, and at least " + A14_SUSTAIN_FLOOR_S + " s). Fastest kill: at least 1.0 s where the base median is 2 s or more, else at least 50% of the base's fastest.");
let fails = 0;
let soft = 0;
for (const r of rows) {
  const bad: string[] = [];
  const strict: string[] = [];
  let worst = Infinity;
  let minHits = Infinity;
  r.cells.forEach((c, i) => {
    const b = base.cells[i]!;
    const bMed = median(b.ttks);
    const bMin = Math.min(...b.ttks);
    const med = median(c.ttks);
    const mn = c.ttks.length > 0 ? Math.min(...c.ttks) : NaN;
    const ratio = med / bMed;
    if (Number.isFinite(ratio)) worst = Math.min(worst, ratio);
    minHits = Math.min(minHits, c.minHits);
    const minFloor = bMed >= 2 ? 1.0 : 0.5 * bMin;
    if (ratio < 0.5) {
      const line = `${c.faction} median ${sec(med)} s = ${(ratio * 100).toFixed(0)}% of ${sec(bMed)}`;
      if (bMed >= 5 && med >= A14_SUSTAIN_FLOOR_S) strict.push(line);
      else bad.push(line);
    }
    if (mn < minFloor) bad.push(`${c.faction} fastest ${sec(mn)} s < ${sec(minFloor)}`);
  });
  if (bad.length > 0) fails++;
  else if (strict.length > 0) soft++;
  const verdict = bad.length > 0 ? "FAIL " : strict.length > 0 ? "PASS*" : "PASS ";
  console.log(`${verdict} ${r.build.name}: min kill ${sec(r.min)} s, fewest hits ${Number.isFinite(minHits) ? minHits : "-"}, worst median ${(worst * 100).toFixed(0)}% of the base's${bad.length > 0 ? ` <- ${bad.join("; ")}` : ""}${strict.length > 0 ? ` (strict reading misses: ${strict.join("; ")})` : ""}`);
}
console.log(fails === 0 ? `A14 holds for every build above${soft > 0 ? ` (${soft} of them only on the sustain-mirror reading: PASS*)` : ""}.` : `${fails} build(s) break A14${soft > 0 ? `, ${soft} more pass only on the sustain-mirror reading` : ""}.`);
console.log("\nTRAP / RUNAWAY (a holder under 30% or over 85% in a faction, the base excluded):");
let traps = 0;
for (const r of rows.slice(1)) {
  const odd = r.cells.filter((c) => c.win < 0.3 || c.win > 0.85).map((c) => `${c.faction} ${pct(c.win)}%`);
  if (odd.length > 0) {
    traps++;
    console.log(`  ${r.build.name}: ${odd.join(", ")}`);
  }
}
console.log(`${traps} build(s) have a faction outside 30-85% (a stacked build is expected to beat an equal kit: only a single card of the extremes is judged a trap).`);
if (jsonOut) {
  writeFileSync(jsonOut, JSON.stringify(rows.map((r) => ({
    build: r.build.name, extra: r.build.extra, min: r.min, cells: r.cells.map((c) => ({ faction: c.faction, win: c.win, winND: c.winND, median: median(c.ttks), min: Math.min(...c.ttks), minHits: c.minHits, n: c.n, caps: c.caps })),
  }))));
}
