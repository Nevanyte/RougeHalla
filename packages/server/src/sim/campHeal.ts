// The camp-clear heal (balance contract 7, GAME_DESIGN 11). When a camp's last mob dies, everyone who damaged the camp and is
// still standing near it is healed `missing x f(m)` (shared/rules.ts campHealAmount): a scratched player gets a little back,
// one ganked low nearly all of it, and everyone leaves a camp at 83-96% of their max hp.
//
//   - WHO. `world.campContrib` (camp index -> the players who did damage above 0 to any of its mobs since it was engaged, a lethal
//     hit included) is filled by mobLife.hurtMob through noteCampContributors. At the clear a contributor is eligible when it is
//     a standing player of the run inside the camp's territory or within CAMP_HEAL_RANGE of its centre. A player who only
//     watched, or died, or left, or ran off, gets nothing and does not count the camp as cleared.
//   - WHEN. The `campCleared` hook (sim/camps.ts campMobDied queues it with payLater, so it runs after the ledger pass and `heal()`
//     is called directly). This module is installed after chests and quests (sim/gameplay.ts), so a chest's conditional offers
//     read the same contributor set (campContribOf) first; the set is cleared at the end of this link of the chain, so anything
//     chained after it sees none.
//   - WHAT. `heal(..., { ignoreLockout })`: the 3 s out-of-combat lockout does not apply (a camp is cleared in combat), the
//     anti-heal factor and any healTaken modifier do. It is not lifesteal and never enters world.combat.landed, so nothing that
//     feeds on landed damage sees it. The heal itself is quiet (no `heal` fx): the `campHeal` fx carries the number, so the
//     client draws one "+N", and a toast tells the player.
//   - Training rooms heal too. A practice camp (sim/training.ts) has no CampState and no `campCleared` hook run; camps.ts hands
//     its last mob's death to payCampHeal directly, keyed by MobState.camp - 1 (100 or more, never a map camp).
import { CAMP_HEAL_RANGE, campHealAmount, territoryAt, type Vec2 } from "@raid/shared";
import { combatant, standing, type Combatant } from "./combatant";
import { heal } from "./factions";
import { chainHook, emit, type LedgerEntry, type World } from "./world";

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
 * camp's territory or within CAMP_HEAL_RANGE of its centre. The heal pays them, Pack Leader counts the camp for them, and the camp's
 * chest offers conditional cards and augments by what they own (sim/chests.ts). Valid inside the `campCleared` chain up to this
 * module's link; empty for a camp nobody damaged.
 */
export function eligibleContributors(world: World, camp: number): Array<Extract<Combatant, { kind: "player" }>> {
  const contrib = world.campContrib?.get(camp);
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
 * Pays the clear of camp `camp`: heals and tells every eligible contributor, counts the camp for each (PlayerRuntime.campsCleared,
 * even for a player already at full hp), and forgets the camp's contributors. A no-op for a camp nobody damaged.
 */
export function payCampHeal(world: World, camp: number): void {
  const contrib = world.campContrib?.get(camp);
  if (!contrib) return;
  for (const c of eligibleContributors(world, camp)) {
    const id = c.id;
    c.rt.campsCleared = (c.rt.campsCleared ?? 0) + 1;
    const gained = heal(world, c, campHealAmount(c.s.hp, c.s.maxHp), { ignoreLockout: true, quiet: true });
    if (!(gained > 0)) continue;
    emit(world, { type: "fx", fx: { kind: "campHeal", id, camp, amount: gained } });
    const shown = Math.round(gained);
    if (shown >= 1) emit(world, { type: "toast", to: id, text: `Camp cleared: +${shown} health` });
  }
  world.campContrib!.delete(camp);
}

export function install(world: World): void {
  chainHook(world, "campCleared", payCampHeal);
}
