// A regional mob's life (GAME_DESIGN 11): it is placed at its camp when the run starts, takes damage through the ledger
// (hurtMob), dies once (killMob: GV, a buff, its weapon), lies there MOB_CORPSE_MS and is removed. The AI that moves it
// and decides its attacks is mobAI.ts. A training dummy (kind "dummy") is not handled here: see mobs.ts.
//
// Contract (the spine; the track fills the bodies in):
//   - Spawning, once per run in `raidStarted` and only when SimConfig.mobs is set: for every region's camp (map.regions[].
//     mobCamps), one mob per camp spot, in map order. The elite camp's FIRST spot is the region's one elite (kind "elite"),
//     the rest of that camp and every other camp are kind "mob". A mob's state: faction = the region id, weapon0 = the
//     camp's weapon, name from mobName, hp/maxHp = mobFaction(region, elite).hp (hp is not paced), status "alive", facing
//     toward the camp centre. Its runtime gets a MobBrain (mode "idle", home = the spot) and a staggered `phase`. Ids come
//     from addMob (mobs.ts), so they are unique and the order is deterministic for a map.
//   - hurtMob(world, c, amounts, entries) is the ledger's way down for a regional mob (ledger.ts calls it instead of
//     damageMob when kind != "dummy"). `amounts[i]` is the mitigated damage of `entries[i]`. It removes the hp (never
//     below 0), stamps lastHitAt, tells the AI who hit it (aggro) and, when the hp is gone, kills it. Returns the hp removed.
//   - killMob: status "dead", brain.diedAt = now, input queue and path cleared, a `death` fx (by = the killer's id). The
//     killer is the player with the largest hit in `entries` (ties go to the earlier entry) who is still in the run and
//     has not resolved; with none, the mob just dies (no rewards). The killer gets, in this order:
//       1. the reward multiplier m = mobRewardFor(world, p, rt), read BEFORE the kill is counted;
//       2. creditMobKill (arena.ts): mob GV (x m, GV_MOB / GV_ELITE, capped) and the feed;
//       3. one buff drop: rollBuffStat(region, world.random) x mobBuffStacks(elite) x m stacks, through grantStacks;
//       4. the mob's weapon dropped as a loose weapon at its feet (loot.ts dropWeapon), unless the killer already holds
//          that weapon type in either slot;
//       5. onKill (buffs.ts): the kill combos.
//   - System `reapMobs`: a corpse older than MOB_CORPSE_MS leaves the state and world.mobs; an idle or returning mob below
//     full hp heals back to full in MOB_REGEN_SECONDS (a fighting mob does not heal).
//   - On `teleported` every regional mob drops its fight (mobAI.resetMob), because everyone alive just left the map.
import {
  MOB_CORPSE_MS, MOB_REGEN_SECONDS, MOB_REPATH_MS, mobBuffStacks, mobFaction, mobName, mobWeapon, rollBuffStat, type FactionId, type Vec2,
} from "@raid/shared";
import type { PlayerState } from "@raid/shared/schema";
import { creditMobKill } from "./arena";
import { grantStacks, onKill } from "./buffs";
import type { Combatant } from "./combatant";
import { mobRewardFor } from "./feed";
import { dropWeapon } from "./loot";
import { aggro, newBrain, resetMob } from "./mobAI";
import { addMob } from "./mobs";
import { cancelAction } from "./weapons";
import { chainHook, emit, type LedgerEntry, type PlayerRuntime, type World } from "./world";

export type MobCombatant = Extract<Combatant, { kind: "mob" }>;

/** A mob hit this recently does not heal, so a returning mob a player keeps shooting at cannot out-regen the shots. */
const REGEN_QUIET_MS = 2000;

/**
 * Adds one regional mob of `region` resting at `at`: state (kind, name, faction, weapon, hp from mobFaction) and runtime
 * (a fresh MobBrain). The camp spawner and the tests both go through this. Returns its id.
 */
export function placeMob(world: World, o: { region: FactionId; elite: boolean; at: Vec2; facing?: number }): string {
  const id = addMob(world, {
    kind: o.elite ? "elite" : "mob", name: mobName(o.region, o.elite), at: o.at, facing: o.facing, hp: mobFaction(o.region, o.elite).hp,
    faction: o.region, weapon: mobWeapon(o.region),
  });
  world.mobs.get(id)!.brain = newBrain(o.region, o.elite, o.at, o.facing ?? 0, (world.idCounter * 137) % MOB_REPATH_MS);
  return id;
}

/** Places every camp's mobs. A no-op for a map without camps (a hand-built test map). */
export function spawnRegionalMobs(world: World): void {
  for (const region of world.map.regions) {
    for (const camp of region.mobCamps) {
      camp.spots.forEach((spot, i) => {
        placeMob(world, {
          region: camp.region, elite: camp.elite && i === 0, at: spot, facing: Math.atan2(camp.y - spot.y, camp.x - spot.x),
        });
      });
    }
  }
}

/**
 * The ledger's way down for a regional mob; returns the hp removed. A mob without a brain is a training dummy, which the
 * ledger sends to damageMob instead, so it is left alone here.
 */
export function hurtMob(world: World, c: MobCombatant, amounts: readonly number[], entries: readonly LedgerEntry[]): number {
  let total = 0;
  for (const a of amounts) if (a > 0) total += a;
  if (!(total > 0) || c.s.status !== "alive" || !c.rt.brain) return 0;
  const before = c.s.hp;
  c.s.hp = Math.max(0, before - total);
  c.rt.lastHitAt = world.state.serverTime;
  if (c.s.hp <= 0) {
    killMob(world, c, entries, amounts);
  } else {
    for (let i = 0; i < entries.length; i++) {
      const by = entries[i]!.by.id;
      if (amounts[i]! > 0 && world.state.players.has(by)) aggro(world, c, by, amounts[i]!);
    }
  }
  return before - c.s.hp;
}

/**
 * The mob dies this tick and pays whoever dealt its largest hit (ties: the earlier entry) among the players still in the
 * fight; with none it simply falls, with no GV, buff or drop. Players who already went down this tick do not collect.
 */
export function killMob(world: World, c: MobCombatant, entries: readonly LedgerEntry[], amounts: readonly number[]): void {
  const brain = c.rt.brain;
  if (!brain || c.s.status !== "alive") return; // a mob dies once, whoever calls
  let killer: { p: PlayerState; rt: PlayerRuntime } | null = null;
  let best = 0;
  for (let i = 0; i < entries.length; i++) {
    const a = amounts[i]!;
    if (!(a > best)) continue;
    const id = entries[i]!.by.id;
    const p = world.state.players.get(id);
    const rt = world.players.get(id);
    if (!p || !rt || p.status !== "alive" || rt.resolved || rt.down) continue;
    best = a;
    killer = { p, rt };
  }

  c.s.status = "dead";
  c.s.hp = 0;
  brain.diedAt = world.state.serverTime;
  brain.mode = "idle";
  brain.target = null;
  brain.threat.clear();
  brain.goal = null;
  brain.moving = false;
  brain.holding = false;
  c.rt.inputs.drain();
  c.rt.path = [];
  cancelAction(world, c);
  c.rt.weapon.held = false;
  c.rt.weapon.bufferedUntil = 0;
  emit(world, { type: "fx", fx: { kind: "death", id: c.id, x: c.s.x, y: c.s.y, by: killer?.rt.id ?? null } });
  if (!killer) return;

  const { p, rt } = killer;
  // Read before this kill counts toward the feed (creditMobKill reads it the same way), so the drop pays what the killer's feed earned until now.
  const m = mobRewardFor(world, p, rt);
  creditMobKill(world, p, rt, brain.elite);
  grantStacks(world, p, rt, rollBuffStat(brain.region, world.random), mobBuffStacks(brain.elite) * m);
  const weapon = c.s.weapon0;
  if (weapon !== "" && p.weapon0 !== weapon && p.weapon1 !== weapon) dropWeapon(world, { x: c.s.x, y: c.s.y }, weapon);
  onKill(world, p, rt);
}

/**
 * System: corpses older than MOB_CORPSE_MS leave the state, and a living mob that is not fighting and has not been hit for
 * REGEN_QUIET_MS heals toward full. Walks the plain runtime map and allocates nothing while there is nothing to do.
 */
export function reapMobs(world: World, dtMs: number): void {
  const now = world.state.serverTime;
  const heal = dtMs / (MOB_REGEN_SECONDS * 1000);
  let gone: string[] | null = null;
  for (const rt of world.mobs.values()) {
    const brain = rt.brain;
    if (!brain) continue;
    const m = world.state.mobs.get(rt.id);
    if (!m) continue;
    if (m.status === "dead") {
      if (now - brain.diedAt >= MOB_CORPSE_MS) (gone ??= []).push(rt.id);
    } else if (m.hp < m.maxHp && brain.mode !== "fight" && now - rt.lastHitAt >= REGEN_QUIET_MS) {
      m.hp = Math.min(m.maxHp, m.hp + m.maxHp * heal);
    }
  }
  // Removed after the walk, so neither map is ever changed while it is being iterated.
  if (gone) {
    for (const id of gone) {
      world.state.mobs.delete(id);
      world.mobs.delete(id);
    }
  }
}

/** Everyone alive left the map in the teleport, so no mob's fight is still on. */
function resetAllMobs(world: World): void {
  for (const rt of world.mobs.values()) {
    const s = world.state.mobs.get(rt.id);
    if (rt.brain && s && s.status === "alive") resetMob(world, { kind: "mob", id: rt.id, s, rt });
  }
}

export function install(world: World): void {
  world.systems.push(reapMobs);
  if (world.config.mobs) chainHook(world, "raidStarted", spawnRegionalMobs);
  chainHook(world, "teleported", resetAllMobs);
}
