// The numbers testing/farm_route_proof.py reasons about, as JSON. Nothing is played: it generates maps and reads tables. Per map,
// every camp (zone, centre, spot count, elite) and the real walk between camps, from each spawn-pool start to each camp, and through
// the travel cannons (one at each zone pole, linked half-way round the ring, as sim/consumables.ts spawnTravel places them). Walks are
// the 5-7-11 walk field (gridTopology walkField16, about 2% over a string-pulled path) on the move mask. Then the sheets: factions,
// weapons, every mob type's faction as mobTypeFaction builds it (before DUEL_PACE), the stat each normal type pays, the bots' build
// goals and the balance bench's build weapons, and the constants the model reads. Rosters are NOT exported: the proof rolls them
// itself from the rule in shared/rosters.ts (BAG_COPIES shuffled rounds of the zone's four normal types), many times per map.
//
//   npx tsx packages/server/bench/farmRouteData.ts [--maps 24] [--from 1] [--out testing/farm_route_data.json]
import { writeFileSync } from "node:fs";
import {
  AP_DOT_RATIO, BAG_COPIES, CAMP_HEAL_HI, CAMP_HEAL_LO, CAMP_HEAL_MID, CAMP_HEAL_WIDTH, CAMP_RESPAWN_MS, CANNON_COOLDOWN_MS,
  DUEL_PACE, ELITE_DMG_MULT, ELITE_HP_MULT, ELITE_K, FACTIONS, FACTION_IDS, FIRE_BACKLASH_PER_DEFENSE, FIRE_BURN_AD_RATIO,
  FIRST_PATIENCE_SECONDS, FROST_CHILL_BONUS_CAP, FROST_CHILL_PER_ATTACK_SPEED, FROST_CHILL_PER_SD, HOLY_CAMP_LIFESTEAL_PER_CLEAR,
  HOLY_LEECH_ROW_MULT, LIFESTEAL_MAX, MARK_BONUS_STAT_PER_POINT, MOB_DMG_MULT, MOB_HP_MULT, MOB_K, MOB_KILL_STACKS, MOB_ROLE_DEFS,
  MOB_STAT_REWARDS, MOB_TYPES, PLAGUE_AP_PER_HIT, PLAYER_REGEN_QUIET_MS, PLAYER_REGEN_SHARE_IN, PLAYER_REGEN_SHARE_OUT,
  PLAGUE_CORPSE_HP_SHARE, PLAGUE_ZOMBIE_AD_SHARE, PLAGUE_ZOMBIE_HIT_CAP_SHARE, PLAGUE_ZOMBIE_HIT_PER_BONUS, PLAGUE_ZOMBIE_HIT_SHARE,
  PLAGUE_ZOMBIE_HP_PER_BONUS, PLAGUE_ZOMBIE_HP_SHARE, PLAYER_SPEED, POTION_HEAL_MS, POTION_LARGE_SHARE, PVP_F0, TILE, TILE_FLOOR,
  WAND_SPLASH_SHARE, WEAPONS, generateMap, mobTypeFaction, walkField16,
  type GameMap, type Vec2,
} from "@raid/shared";
import { BUILD_GOALS, STAT_FLOOR } from "../src/bots/brain/buildRoute";
import { opt } from "./lib/balance";

const args = process.argv.slice(2);
const maps = Number(opt(args, "maps", "24"));
const from = Number(opt(args, "from", "1"));
const out = opt(args, "out", "testing/farm_route_data.json");

const tileOf = (map: GameMap, p: Vec2): number => Math.floor(p.y / TILE) * map.w + Math.floor(p.x / TILE);

/** World units of walk from `src` to every point of `to` (-1 unreachable). */
function walks(map: GameMap, src: Vec2, to: readonly Vec2[]): number[] {
  const floor = new Uint8Array(map.w * map.h);
  for (let i = 0; i < floor.length; i++) floor[i] = map.tiles[i] === TILE_FLOOR ? 0 : 1;
  const field = walkField16(floor, map.w, map.h, [tileOf(map, src)]);
  return to.map((p) => {
    const v = field[tileOf(map, p)]!;
    return v < 0 ? -1 : Math.round((v / 5) * TILE);
  });
}

/** One cannon a zone, at its pole, aimed half-way round the ring (spawnTravel's link). */
function cannons(map: GameMap): { at: Vec2; to: number }[] {
  const sites = map.regions.map((r) => r.pole);
  const n = sites.length;
  return sites.map((at, i) => ({ at, to: (i + Math.max(1, Math.floor(n / 2))) % n }));
}

const mapRows = [];
for (let s = from; s < from + maps; s++) {
  const map = generateMap(s, undefined, { decor: false });
  const camps = map.camps.map((c) => ({ id: c.id, zone: c.zone, x: c.x, y: c.y, spots: c.spots.length, elite: c.eliteSpot >= 0 }));
  const campPts = map.camps.map((c) => ({ x: c.x, y: c.y }));
  const can = cannons(map);
  mapRows.push({
    seed: s,
    attempt: map.attempt,
    camps,
    campWalk: campPts.map((p) => walks(map, p, campPts)),
    spawns: map.spawnPool.map((p) => ({ x: p.x, y: p.y, zone: p.zone })),
    spawnWalk: map.spawnPool.map((p) => walks(map, p, campPts)),
    cannons: can.map((c) => ({ x: c.at.x, y: c.at.y, to: c.to })),
    // cannon i -> every camp (walk from the cannon's landing, which is cannon `to`'s site), and every camp -> cannon i.
    cannonWalk: can.map((c) => walks(map, c.at, campPts)),
  });
  process.stderr.write(`map ${s} (attempt ${map.attempt}): ${camps.length} camps, ${map.spawnPool.length} starts\n`);
}

const mobTypes = MOB_TYPES.map((t) => {
  const f = mobTypeFaction(t.zone, t.elite, t.id);
  return {
    id: t.id, zone: t.zone, elite: t.elite, name: t.name, role: t.role, weapon: t.weapon, moveMult: t.moveMult,
    hp: f.hp, rate: f.rate, hit: f.hit, phys: f.phys, trueShare: f.trueShare, armor: f.armor, shield: f.shield,
    mechanic: f.mechanic, aura: f.aura ?? null, sustain: f.sustain ?? null, params: f.params,
  };
});

const data = {
  generatedBy: "packages/server/bench/farmRouteData.ts",
  constants: {
    TILE, PLAYER_SPEED, CAMP_RESPAWN_MS, CANNON_COOLDOWN_MS, FIRST_PATIENCE_SECONDS, DUEL_PACE, MOB_KILL_STACKS, BAG_COPIES,
    MOB_K, ELITE_K, MOB_HP_MULT, MOB_DMG_MULT, ELITE_HP_MULT, ELITE_DMG_MULT, PVP_F0,
    AP_DOT_RATIO, FIRE_BURN_AD_RATIO, FIRE_BACKLASH_PER_DEFENSE, PLAGUE_AP_PER_HIT, MARK_BONUS_STAT_PER_POINT,
    FROST_CHILL_PER_SD, FROST_CHILL_PER_ATTACK_SPEED, FROST_CHILL_BONUS_CAP, HOLY_LEECH_ROW_MULT, HOLY_CAMP_LIFESTEAL_PER_CLEAR,
    LIFESTEAL_MAX, PLAYER_REGEN_SHARE_OUT, PLAYER_REGEN_SHARE_IN, PLAYER_REGEN_QUIET_MS, POTION_LARGE_SHARE, POTION_HEAL_MS,
    CAMP_HEAL_LO, CAMP_HEAL_HI, CAMP_HEAL_MID, CAMP_HEAL_WIDTH, STAT_FLOOR, WAND_SPLASH_SHARE, PLAGUE_CORPSE_HP_SHARE,
    PLAGUE_ZOMBIE_HP_SHARE, PLAGUE_ZOMBIE_HP_PER_BONUS, PLAGUE_ZOMBIE_HIT_SHARE, PLAGUE_ZOMBIE_HIT_PER_BONUS, PLAGUE_ZOMBIE_AD_SHARE,
    PLAGUE_ZOMBIE_HIT_CAP_SHARE,
  },
  factions: Object.fromEntries(FACTION_IDS.map((id) => [id, FACTIONS[id]])),
  weapons: WEAPONS,
  roles: MOB_ROLE_DEFS,
  mobTypes,
  rewards: MOB_STAT_REWARDS.map((r) => ({ id: r.id, zone: r.zone, k: r.effect.k, stat: r.effect.stat, v: r.effect.v })),
  buildGoals: BUILD_GOALS,
  maps: mapRows,
};
writeFileSync(out, JSON.stringify(data));
process.stderr.write(`wrote ${out}\n`);
