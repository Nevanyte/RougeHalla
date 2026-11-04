// Spells: abilities found on the map. A spell is an AbilityDef of kind "spell" in ABILITIES (one id space with the Wishes), cast
// from the spell slot (key Shift) through the same cast pipeline. A player holds ONE spell at a time (PlayerExtraState.spell):
// picking a find up puts it in the slot and lays the spell held before down in its place, so nothing is lost or made. A spell
// reloads on a stock clock (its rank's `charges` uses, one back every `cooldownMs`), and the clock belongs to the copy: it runs
// on in the hand and on the ground alike (PlayerExtraState.spellFullAt, ContainerState.readyAt), so a swap never reloads one.
//
// No spell exists yet: the pool is empty and the server places nothing. Everything here reads the catalog when called, so a test
// that registers a spell (server test/support/testSpell.ts) sees it. Pure: no state, no random (the caller hands in its own unit
// values, the server's salted hash).
import { ABILITIES, ABILITY_IDS, maxCharges, rankOf, stockReadyAt, type AbilityDef, type AbilityId } from "./abilities";
import { REGION_FACTIONS, REGION_IDS, worldToTile, type GameMap, type RegionFaction } from "./map";
import type { Vec2 } from "./messages";
import { TILE } from "./constants";

/** True for the id of a spell (an ability of kind "spell"). */
export function isSpellId(v: unknown): v is AbilityId {
  return typeof v === "string" && (ABILITY_IDS as readonly string[]).includes(v) && ABILITIES[v as AbilityId].kind === "spell";
}

/** The spell catalog, in wire order: every ability of kind "spell". Empty today. */
export function spellIds(): AbilityId[] {
  return ABILITY_IDS.filter((id) => ABILITIES[id].kind === "spell");
}

/** The spells a find on the map can hold: the catalog less those with `spawnWeight` 0. */
export function spellPool(): AbilityId[] {
  return spellIds().filter((id) => (ABILITIES[id].spawnWeight ?? 1) > 0);
}

/** A weighted pick from `pool` by a unit value `u` in [0, 1); null for an empty pool. */
export function pickSpell(pool: readonly AbilityId[], u: number): AbilityId | null {
  let total = 0;
  for (const id of pool) total += Math.max(0, ABILITIES[id].spawnWeight ?? 1);
  if (pool.length === 0 || !(total > 0)) return null;
  let at = Math.min(Math.max(u, 0), 0.999999999) * total;
  for (const id of pool) {
    at -= Math.max(0, ABILITIES[id].spawnWeight ?? 1);
    if (at < 0) return id;
  }
  return pool[pool.length - 1]!;
}

/** A spell's reload: how many uses it stores and how long one takes to come back (ms). Spells are flat: nothing shortens it. */
export function spellReload(def: AbilityDef, rank = 1): { charges: number; reloadMs: number } {
  return { charges: maxCharges(def, rank), reloadMs: rankOf(def, rank).cooldownMs };
}

/** The slot's ready time for a copy whose reload clock reads `fullAt` (0 = fully loaded). */
export function spellReadyAt(def: AbilityDef, fullAt: number, rank = 1): number {
  const { charges, reloadMs } = spellReload(def, rank);
  return stockReadyAt(fullAt, charges, reloadMs);
}

/** One spell find: where it lies (a ground spot of the map), its zone and its spell. */
export interface SpellFind {
  at: Vec2;
  zone: RegionFaction;
  spell: AbilityId;
}

/**
 * Where the spell finds go: in each zone, the `perZone` of its ground spots with the lowest `unit(0, spot)` among those at least
 * `clearanceTiles` from every point of `taken` (the containers already placed) and from each other, each holding the spell
 * `unit(1, spot)` picks from `pool`. Nothing is computed for an empty pool or a zero count. `unit` must be in [0, 1) and order-free
 * (a hash of the spot index), so the result depends only on the map, the pool and the hash.
 */
export function chooseSpellFinds(
  map: GameMap, pool: readonly AbilityId[], perZone: number, taken: readonly Vec2[], clearanceTiles: number,
  unit: (stream: 0 | 1, spot: number) => number,
): SpellFind[] {
  if (pool.length === 0 || perZone <= 0) return [];
  const clear = clearanceTiles * TILE;
  const far = (a: Vec2, b: Vec2): boolean => (a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y) >= clear * clear;
  const byZone = new Map<RegionFaction, Array<{ i: number; u: number; at: Vec2 }>>();
  map.groundSpots.forEach((at, i) => {
    const tx = worldToTile(at.x);
    const ty = worldToTile(at.y);
    const id = tx >= 0 && ty >= 0 && tx < map.w && ty < map.h ? REGION_IDS[map.regionGrid[ty * map.w + tx]!] : undefined;
    if (!id || !(REGION_FACTIONS as readonly string[]).includes(id)) return;
    if (!taken.every((t) => far(t, at))) return;
    const zone = id as RegionFaction;
    let list = byZone.get(zone);
    if (!list) byZone.set(zone, (list = []));
    list.push({ i, u: unit(0, i), at });
  });
  const out: SpellFind[] = [];
  for (const zone of REGION_FACTIONS) {
    const list = byZone.get(zone);
    if (!list) continue;
    list.sort((a, b) => a.u - b.u || a.i - b.i);
    const kept: Vec2[] = [];
    for (const c of list) {
      if (kept.length >= perZone) break;
      if (!kept.every((k) => far(k, c.at))) continue;
      const spell = pickSpell(pool, unit(1, c.i));
      if (!spell) continue;
      kept.push(c.at);
      out.push({ at: { x: c.at.x, y: c.at.y }, zone, spell });
    }
  }
  return out;
}

/** The server's refusals of a spell pickup (sim/spells.ts) and the client's words for them: one list. */
export const SPELL_REFUSAL = {
  casting: "Can't swap spells while casting one",
} as const;

/** The toast a pickup sends: what the slot now holds. */
export function spellTakenText(def: AbilityDef): string {
  return `Spell: ${def.name} (Shift)`;
}
