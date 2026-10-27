// Camp rosters (ROGUELIKE_PLAN D5, balance contract 6.4): which mob type stands in which camp. Pure: the caller supplies the
// random stream, and the SERVER hands in `world.rewardRandom`, never `world.random` and never anything derived from the public
// seed (D16), so a client cannot read a camp's type off the map. Every camp is mono-type: its normal mobs share one type, and an
// elite camp holds one elite at its elite spot (the rest of that camp is its normal type).
//
// The normal types come from a BAG: the zone's four normal types twice (eight entries), shuffled once per zone (Fisher-Yates,
// seven draws), and the zone's camps take the entries in `GameMap.camps` order. A zone of eight camps therefore has each
// normal type in exactly two of them; with fewer camps they take the first entries (a type can repeat or be absent), with
// more the bag wraps. The elite of an elite camp is no draw at all: the k-th elite camp of a zone (camps order, `eliteSpot >= 0`)
// holds the k-th of `elitesOf(zone)`, wrapping past the second.
import type { CampDef } from "./map";
import type { FactionId } from "./factions";
import { elitesOf, normalTypesOf, type MobTypeId } from "./mobs";
import { shuffle, type Rng } from "./rng";

/** How many times each normal type is in a zone's bag: a zone of eight camps shows every type in exactly this many. */
export const BAG_COPIES = 2;

/**
 * The normal types of `campCount` camps of one zone, in camp order: the first `campCount` entries of the zone's shuffled
 * bag (the bag wraps when there are more than eight camps). Always seven draws for a zone with at least one camp, however many
 * camps it has, so a map's draw sequence does not depend on how its camps are split between zones; nothing is drawn for a zone
 * with no camps.
 */
export function rollZoneTypes(zone: FactionId, campCount: number, rng: Rng): MobTypeId[] {
  if (!(campCount > 0)) return [];
  const bag: MobTypeId[] = [];
  for (let copy = 0; copy < BAG_COPIES; copy++) for (const t of normalTypesOf(zone)) bag.push(t.id);
  shuffle(rng, bag);
  const out: MobTypeId[] = [];
  for (let i = 0; i < campCount; i++) out.push(bag[i % bag.length]!);
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
 * The elite type of every camp, in camp order: "" for a camp without an elite (`eliteSpot < 0`), else the k-th of the zone's
 * elites, k counting the zone's elite camps in camp order (so with two elite camps in a zone they hold one each, and with a
 * single one it holds the first). Draws nothing.
 */
export function rollCampElites(camps: ReadonlyArray<Pick<CampDef, "zone" | "eliteSpot">>): Array<MobTypeId | ""> {
  const seen = new Map<FactionId, number>();
  return camps.map((camp) => {
    if (!(camp.eliteSpot >= 0)) return "";
    const k = seen.get(camp.zone) ?? 0;
    seen.set(camp.zone, k + 1);
    const elites = elitesOf(camp.zone);
    return elites[k % elites.length]!.id;
  });
}

/**
 * What stands at each of the camp's spots, in `spots` order: the camp's elite (`eliteType`, the zone's first elite when left
 * out) at `eliteSpot` (none for -1), the camp's normal type everywhere else.
 */
export function campMobs(
  camp: Pick<CampDef, "zone" | "spots" | "eliteSpot">, campType: MobTypeId, eliteType?: MobTypeId,
): Array<{ type: MobTypeId; elite: boolean }> {
  const elite = eliteType ?? elitesOf(camp.zone)[0]!.id;
  return camp.spots.map((_, i) => (i === camp.eliteSpot ? { type: elite, elite: true } : { type: campType, elite: false }));
}
