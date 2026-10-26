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
//     killer is the player who did it the most damage over the whole fight (brain.threat: what each did since it last
//     rested, plus this pass's hits; an exact tie goes to the lower tick rank) among players still in the run with no
//     result out, so one last arrow cannot take an elite someone else wore down. With none, the mob just dies and its
//     weapon still drops. The spoils are paid after the ledger pass (payLater), in this order:
//       1. creditMobKill (arena.ts): mob GV (x m, GV_MOB / GV_ELITE, capped) and the feed, where m is the reward
//          multiplier read INSIDE the pass (every feed is still its tick-start value there, so the order kills are paid
//          in never changes it);
//       2. one buff drop: rollBuffStat(region, world.random) x mobBuffStacks(elite) x m stacks, through grantStacks;
//       3. the mob's weapon dropped as a loose weapon at its feet (loot.ts dropWeapon), unless the killer already holds
//          that weapon type in either slot;
//       4. onKill (buffs.ts): the kill combos.
//   - System `reapMobs`: a corpse older than MOB_CORPSE_MS leaves the state and world.mobs; an idle or returning mob below
//     full hp heals through heal() (3 s out-of-combat lockout, no fx); a mob walking home is whole when it arrives.
//   - On `teleported` every regional mob drops its fight (mobAI.resetMob), because everyone alive just left the map.
import {
  MOB_CORPSE_MS, MOB_REGEN_SECONDS, MOB_REPATH_MS, mobBuffStacks, mobFaction, mobName, mobWeapon, rollBuffStat, type FactionId, type Vec2,
} from "@raid/shared";
import { creditMobKill } from "./arena";
import { grantStacks, onKill } from "./buffs";
import { mobScale, type Combatant } from "./combatant";
import { heal } from "./factions";
import { mobRewardFor } from "./feed";
import { dropWeapon } from "./loot";
import { aggro, newBrain, resetMob } from "./mobAI";
import { addMob } from "./mobs";
import { cancelAction } from "./weapons";
import { chainHook, emit, payLater, tieRank, type LedgerEntry, type World } from "./world";

export type MobCombatant = Extract<Combatant, { kind: "mob" }>;

/**
 * Adds one regional mob of `region` resting at `at`: state (kind, name, faction, weapon, hp from mobFaction) and runtime
 * (a fresh MobBrain). The camp spawner and the tests both go through this. Returns its id.
 */
export function placeMob(world: World, o: { region: FactionId; elite: boolean; at: Vec2; facing?: number }): string {
  const id = addMob(world, {
    kind: o.elite ? "elite" : "mob", name: mobName(o.region, o.elite), at: o.at, facing: o.facing, hp: mobFaction(o.region, o.elite, mobScale(o.elite)).hp,
    faction: o.region, weapon: mobWeapon(o.region),
  });
  world.mobs.get(id)!.brain = newBrain(o.region, o.elite, o.at, o.facing ?? 0, (world.idCounter * 137) % MOB_REPATH_MS);
  return id;
}

/** Places every camp's mobs. A no-op for a map without camps (a hand-built test map). */
export function spawnRegionalMobs(world: World): void {
  // A training world (sim/training.ts) has its dummies and nothing else: mobs would pay GV and feed that nothing records.
  if (world.config.training) return;
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
 * ledger sends to damageMob instead, so it is left alone here. A mob walking home is evading: nothing hurts it (the
 * ledger then shows no number and no stagger), so a shooter out of its reach cannot whittle it down while it leaves.
 */
export function hurtMob(world: World, c: MobCombatant, amounts: readonly number[], entries: readonly LedgerEntry[]): number {
  const brain = c.rt.brain;
  if (!brain || brain.mode === "return" || c.s.status !== "alive") return 0;
  let total = 0;
  for (const a of amounts) if (a > 0) total += a;
  if (!(total > 0)) return 0;
  const before = c.s.hp;
  c.s.hp = Math.max(0, before - total);
  c.rt.lastHitAt = world.state.serverTime;
  if (c.s.hp <= 0) {
    killMob(world, c, entries, amounts, before);
  } else {
    for (let i = 0; i < entries.length; i++) {
      const by = entries[i]!.by.id;
      if (amounts[i]! > 0 && world.state.players.has(by)) aggro(world, c, by, amounts[i]!);
    }
  }
  return before - c.s.hp;
}

/**
 * The mob dies this tick. The kill goes to the player who did it the most damage over the whole fight (what each did
 * since it last rested, plus this pass's hits; an exact tie goes to the lower tick rank) among those still in the run,
 * with the death fx naming them; with none it simply falls, and its weapon still drops. The spoils (GV and feed, a buff,
 * the weapon, the kill combos) are paid once every victim of the pass has taken their damage (payLater), so they cannot
 * decide who survives it. A player who went down in the same pass still gets the GV and the feed, like any other kill GV.
 * `hpBefore` is the hp the mob had when this pass reached it: the pass's hits count for the hp they removed, so the
 * overkill of one big hit cannot make up for the work of someone who did most of it.
 */
export function killMob(
  world: World, c: MobCombatant, entries: readonly LedgerEntry[], amounts: readonly number[], hpBefore: number = c.s.hp,
): void {
  const brain = c.rt.brain;
  if (!brain || c.s.status !== "alive") return; // a mob dies once, whoever calls
  const inRun = (id: string): boolean => world.state.players.has(id) && world.players.get(id)?.resolved === false;
  const dealt = new Map<string, number>();
  for (const [id, sum] of brain.threat) if (inRun(id)) dealt.set(id, sum);
  let passTotal = 0;
  for (const a of amounts) if (a > 0) passTotal += a;
  const removedShare = passTotal > hpBefore ? hpBefore / passTotal : 1;
  for (let i = 0; i < entries.length; i++) {
    const a = amounts[i]!;
    const id = entries[i]!.by.id;
    if (a > 0 && inRun(id)) dealt.set(id, (dealt.get(id) ?? 0) + a * removedShare);
  }
  let killer: string | null = null;
  let best = 0;
  for (const [id, sum] of dealt) {
    if (sum > best || (sum === best && killer !== null && tieRank(world, id) < tieRank(world, killer))) {
      killer = id;
      best = sum;
    }
  }
  // Read here, in the pass: every feed is still its tick-start value, so the order the payouts run in cannot change it.
  const kp = killer !== null ? world.state.players.get(killer) : undefined;
  const krt = killer !== null ? world.players.get(killer) : undefined;
  const m = kp && krt ? mobRewardFor(world, kp, krt) : 1;

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
  c.rt.slip = null;
  cancelAction(world, c);
  c.rt.weapon.held = false;
  c.rt.weapon.bufferedUntil = 0;
  emit(world, { type: "fx", fx: { kind: "death", id: c.id, x: c.s.x, y: c.s.y, by: killer } });
  world.hooks.fighterOut?.(world, c.id, "down");

  const { elite, region } = brain;
  const weapon = c.s.weapon0;
  const at = { x: c.s.x, y: c.s.y };
  if (killer === null) {
    // Nobody to pay, but the weapon lies where the mob fell all the same.
    if (weapon !== "") payLater(world, () => dropWeapon(world, at, weapon));
    return;
  }
  payLater(world, () => payMobKill(world, killer!, elite, region, weapon, at, m));
}

function payMobKill(world: World, killerId: string, elite: boolean, region: FactionId, weapon: string, at: Vec2, m: number): void {
  const p = world.state.players.get(killerId);
  const rt = world.players.get(killerId);
  if (!p || !rt || rt.resolved) {
    if (weapon !== "") dropWeapon(world, at, weapon);
    return;
  }
  creditMobKill(world, p, rt, elite, m);
  grantStacks(world, p, rt, rollBuffStat(region, world.random), mobBuffStacks(elite) * m);
  if (weapon !== "" && p.weapon0 !== weapon && p.weapon1 !== weapon) dropWeapon(world, at, weapon);
  onKill(world, p, rt);
}

/** An idle mob below full hp (hurt by someone who was gone before they could wake it) heals after this long unhurt: the design's heal lockout. */
const IDLE_REGEN_QUIET_MS = 3000;

/**
 * System: corpses older than MOB_CORPSE_MS leave the state, and a mob walking home heals through heal() (it is untouchable
 * on the way; the walk is usually shorter than the 3 s lockout, so it is mostly made whole when it arrives). An idle mob that is hurt anyway (its attacker went down before it could
 * wake onto them) heals once it has been left alone for IDLE_REGEN_QUIET_MS. Walks the plain runtime map and allocates
 * nothing while there is nothing to do.
 */
export function reapMobs(world: World, dtMs: number): void {
  const now = world.state.serverTime;
  const perTick = dtMs / (MOB_REGEN_SECONDS * 1000);
  let gone: string[] | null = null;
  for (const rt of world.mobs.values()) {
    const brain = rt.brain;
    if (!brain) continue;
    const m = world.state.mobs.get(rt.id);
    if (!m) continue;
    if (m.status === "dead") {
      if (now - brain.diedAt >= MOB_CORPSE_MS) (gone ??= []).push(rt.id);
    } else if (m.hp < m.maxHp && (brain.mode === "return" || (brain.mode === "idle" && now - rt.lastHitAt >= IDLE_REGEN_QUIET_MS))) {
      // Through the faction layer's one way up (its 3 s out-of-combat lockout applies), without a heal number every tick.
      heal(world, { kind: "mob", id: rt.id, s: m, rt }, m.maxHp * perTick, { quiet: true });
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
