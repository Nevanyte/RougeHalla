// Real-sim check of testing/farm_route_proof.py's duel lens: two farmed kits (mob-kill stacks, no cards) fight, signatures on, both
// seats, the benches' setups and noise model; a mirror of one faction and weapon unless kit B is given its own. Report only.
//
//   npx tsx packages/server/bench/farmKitDuel.ts --kits FILE [--faction plague] [--weapon wand] [--faction-b holy] [--weapon-b axe]
//                                                 [--corpses 1] [--setups 18] [--draws 8]
// FILE: {"a": {"maxHp": 102, ...}, "b": {...}} in stacks per stat (the proof's kit form); each stat goes to one normal type paying it.
import { readFileSync } from "node:fs";
import { MOB_STAT_REWARDS, type FactionId, type WeaponId } from "@raid/shared";
import { runDuel } from "../src/harness/duel";
import { fullSetups } from "../src/harness/matrix";
import { noiseOf, opt } from "./lib/balance";

const args = process.argv.slice(2);
const kits = JSON.parse(readFileSync(opt(args, "kits", ""), "utf8")) as { a: Record<string, number>; b: Record<string, number> };
const faction = opt(args, "faction", "plague") as FactionId;
const weapon = opt(args, "weapon", "wand") as WeaponId;
const factionB = opt(args, "faction-b", faction) as FactionId;
const weaponB = opt(args, "weapon-b", weapon) as WeaponId;
const corpses = Number(opt(args, "corpses", "0"));
const setups = fullSetups().slice(0, Number(opt(args, "setups", "18")));
const draws = Number(opt(args, "draws", "8"));
const sigma = Number(opt(args, "noise", "0.45"));

const typeOf = new Map<string, string>();
for (const r of MOB_STAT_REWARDS) if (!typeOf.has(r.effect.stat)) typeOf.set(r.effect.stat, r.id);
const stacks = (kit: Record<string, number>): Record<string, number> =>
  Object.fromEntries(Object.entries(kit).filter(([, n]) => n > 0).map(([stat, n]) => [typeOf.get(stat)!, Math.round(n)]));
const [ka, kb] = [stacks(kits.a), stacks(kits.b)];

let aWins = 0;
let total = 0;
for (const [si, setup] of setups.entries()) {
  for (let draw = 0; draw < draws; draw++) {
    for (const seat of [0, 1] as const) {
      const seed = 1 + si * 7;
      const noise = noiseOf(seed, draw, sigma);
      const mob: [Record<string, number>, Record<string, number>] = seat === 0 ? [ka, kb] : [kb, ka];
      const factions: [FactionId, FactionId] = seat === 0 ? [faction, factionB] : [factionB, faction];
      const weapons: [WeaponId, WeaponId] = seat === 0 ? [weapon, weaponB] : [weaponB, weapon];
      const r = runDuel({
        faction, factions, weapons, distance: setup.distance, angle: setup.angle,
        delayTicks: setup.delayTicks, arena: "open", perception: "client", capSeconds: 60, seed, signatures: true,
        mobStats: mob, ...(corpses > 0 ? { corpses: [corpses, corpses] as const } : {}),
        ...(noise[0] !== 1 || noise[1] !== 1 ? { damageScale: noise } : {}),
      });
      total++;
      if (r.winner === seat) aWins++;
      else if (r.winner === null) aWins += 0.5;
    }
  }
}
const vs = factionB === faction && weaponB === weapon ? "mirror duels" : `duels against ${factionB} ${weaponB}`;
console.log(`${faction} ${weapon}${corpses ? ` with ${corpses} body` : ""}: kit A wins ${(100 * aWins / total).toFixed(0)}% of ${total} ${vs}`);
