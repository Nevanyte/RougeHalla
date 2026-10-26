// Camp rosters (ROGUELIKE_PLAN D5): which mob type stands in which camp. Pure: the caller supplies the random stream, and the
// SERVER hands in `world.rewardRandom`, never `world.random` and never anything derived from the public seed (D16), so a
// client cannot read a camp's type off the map. Every camp is mono-type: its normal mobs share one type, and the zone's one
// elite stands at the elite spot of the elite camp (the rest of that camp is its normal type).
import type { CampDef } from "./map";
import type { FactionId } from "./factions";
import { eliteTypeOf, normalTypesOf, type MobTypeId } from "./mobs";
import { pick, shuffle, type Rng } from "./rng";

/**
 * The normal types of `campCount` camps of one zone, in camp order. The zone's three normal types are shuffled (Fisher-Yates,
 * two draws) and handed out in that order, so no type repeats while camps last: a 3-camp zone has each type once, a 2-camp
 * zone (wedge maps) one type absent, a 1-camp zone one. Every camp past the third takes one more draw to repeat one of the
 * three. Nothing is drawn for a zone with no camps.
 */
export function rollZoneTypes(zone: FactionId, campCount: number, rng: Rng): MobTypeId[] {
  if (!(campCount > 0)) return [];
  const order = shuffle(rng, normalTypesOf(zone).map((t) => t.id));
  const out: MobTypeId[] = [];
  for (let i = 0; i < campCount; i++) out.push(i < order.length ? order[i]! : pick(rng, order));
  return out;
}

/**
 * The normal type of every camp, in the order of `zones` (the zone of each camp: `map.camps.map((c) => c.zone)`). Zones are
 * rolled in the order they first appear, so the draw sequence is fixed by the map alone.
 */
export function rollCampTypes(zones: readonly FactionId[], rng: Rng): MobTypeId[] {
  const byZone = new Map<FactionId, number[]>();
  zones.forEach((zone, i) => {
    const mine = byZone.get(zone);
    if (mine) mine.push(i);
    else byZone.set(zone, [i]);
  });
  const out = new Array<MobTypeId>(zones.length);
  for (const [zone, at] of byZone) {
    const types = rollZoneTypes(zone, at.length, rng);
    at.forEach((camp, k) => { out[camp] = types[k]!; });
  }
  return out;
}

/**
 * What stands at each of the camp's spots, in `spots` order: the zone's elite type at `eliteSpot` (none for -1), the camp's
 * normal type everywhere else.
 */
export function campMobs(camp: Pick<CampDef, "zone" | "spots" | "eliteSpot">, campType: MobTypeId): Array<{ type: MobTypeId; elite: boolean }> {
  const elite = eliteTypeOf(camp.zone).id;
  return camp.spots.map((_, i) => (i === camp.eliteSpot ? { type: elite, elite: true } : { type: campType, elite: false }));
}
