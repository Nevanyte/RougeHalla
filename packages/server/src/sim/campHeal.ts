// Camp-clear recovery is a physical potion, consumed later for 40% HP over 5s. Contributor eligibility and clear counts
// remain shared with elite augment offers and champion passives. The historical payCampHeal name is kept for callers.
import { CAMP_HEAL_RANGE, territoryAt, type Vec2 } from "@raid/shared";
import { combatant, standing, type Combatant } from "./combatant";
import { dropConsumable } from "./consumables";
import { chainHook, type LedgerEntry, type World } from "./world";

/**
 * A hit on a mob of camp `campRef` (MobState.camp: the camp's index + 1, 0 = none) landed: every player behind an entry that took
 * hp off it (`amounts[i]` is the mitigated damage of `entries[i]`) is a contributor to the camp's clear from now on. Called by
 * hurtMob before the kill is handled, so a lethal hit counts.
 */
export function noteCampContributors(world: World, campRef: number, entries: readonly LedgerEntry[], amounts: readonly number[]): void {
  if (!(campRef >= 1)) return;
  let set: Set<string> | undefined;
  for (let i = 0; i < entries.length; i++) {
    if (!(amounts[i]! > 0)) continue;
    const by = entries[i]!.by.id;
    if (!world.state.players.has(by)) continue;
    if (!set) {
      const all = (world.campContrib ??= new Map());
      set = all.get(campRef - 1);
      if (!set) all.set(campRef - 1, (set = new Set()));
    }
    set.add(by);
  }
}

/**
 * The players who have damaged camp `camp` (its index in map.camps) since it was engaged, as a copy: empty for a camp nobody
 * hurt. Valid inside the `campCleared` hook chain up to this module's link (the chest reads it there) and any time before the clear.
 */
export function campContribOf(world: World, camp: number): ReadonlySet<string> {
  const set = world.campContrib?.get(camp);
  return set ? new Set(set) : new Set();
}

/** Where camp `camp` is: the map's centre for it, else (a hand-built map, a practice camp) the middle of its mobs' resting spots; null if neither. */
function campCentre(world: World, camp: number): Vec2 | null {
  const def = world.map.camps[camp];
  if (def) return { x: def.x, y: def.y };
  let n = 0, x = 0, y = 0;
  for (const rt of world.mobs.values()) {
    const m = world.state.mobs.get(rt.id);
    if (!rt.brain || !m || m.camp !== camp + 1) continue;
    x += rt.brain.home.x;
    y += rt.brain.home.y;
    n++;
  }
  return n > 0 ? { x: x / n, y: y / n } : null;
}

/** Inside the camp's territory, or within CAMP_HEAL_RANGE of its centre (a camp with no centre to measure from counts everyone who fought it). */
function nearCamp(world: World, camp: number, centre: Vec2 | null, at: Vec2): boolean {
  if (territoryAt(world.map, at) === camp + 1) return true;
  if (!centre) return true;
  return Math.hypot(at.x - centre.x, at.y - centre.y) <= CAMP_HEAL_RANGE;
}

/**
 * The players who count for camp `camp`'s clear: every contributor (campContribOf) who is a standing player of the run inside the
 * camp's territory or within CAMP_HEAL_RANGE of its centre. Pack Leader counts the camp for them, and the camp's
 * chest offers conditional cards and augments by what they own (sim/chests.ts). Valid inside the `campCleared` chain up to this
 * module's link; empty for a camp nobody damaged.
 */
export function eligibleContributors(world: World, camp: number, contributors?: ReadonlySet<string>): Array<Extract<Combatant, { kind: "player" }>> {
  const contrib = contributors ?? world.campContrib?.get(camp);
  if (!contrib) return [];
  const centre = campCentre(world, camp);
  const out: Array<Extract<Combatant, { kind: "player" }>> = [];
  for (const id of contrib) {
    const c = combatant(world, id);
    if (!c || c.kind !== "player" || !standing(c) || !nearCamp(world, camp, centre, c.s)) continue;
    out.push(c);
  }
  return out;
}

/**
 * Pays the clear of camp `camp`: drops one potion and counts the camp for every eligible contributor (PlayerRuntime.campsCleared,
 * even for a player already at full hp), and forgets the camp's contributors. A no-op for a camp nobody damaged.
 */
export function payCampHeal(world: World, camp: number): void {
  const contrib = world.campContrib?.get(camp);
  if (!contrib) return;
  for (const c of eligibleContributors(world, camp)) {
    c.rt.campsCleared = (c.rt.campsCleared ?? 0) + 1;
  }
  const centre = campCentre(world, camp);
  if (centre) dropConsumable(world, centre, "potionLarge");
  world.campContrib!.delete(camp);
}

export function install(world: World): void {
  chainHook(world, "campCleared", payCampHeal);
}
