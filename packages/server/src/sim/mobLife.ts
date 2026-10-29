// A regional mob's life (GAME_DESIGN 11): it is placed at its camp when the run starts, takes damage through the ledger
// (hurtMob), dies once (killMob: GV, its weapon), lies there MOB_CORPSE_MS and is removed. The AI that moves it
// and decides its attacks is mobAI.ts. A training dummy (kind "dummy") is not handled here: see mobs.ts.
//
// Contract (the spine; the track fills the bodies in):
//   - Spawning, once per run in `raidStarted` and only when SimConfig.mobs is set: for every camp of map.camps, one mob per
//     camp spot, in map order. The camp's `eliteSpot` holds the camp's elite (kind "elite", CampState.elite: the k-th elite
//     camp of a zone has the zone's k-th elite type); every other spot is kind "mob" of the camp's type, the roster rolled at
//     world build (sim/camps.ts, state.camps). A mob's state: faction = the zone id, type = its MobTypeId, weapon0 = the TYPE's
//     weapon (a caster shoots; what a kill drops), camp = the camp's index + 1, name = the type's MOB_TYPES name,
//     hp/maxHp = mobTypeFaction(region, elite, type).hp (the zone faction x k x the role's hpMult; hp is not paced), status
//     "alive", facing toward the camp centre. The role's damage multiplier lives in combatant.factionOf and its speed in
//     mobRoleMove below; nothing else about a mob depends on its type. Its runtime gets a MobBrain (mode "idle", home = the spot) and a staggered `phase`. Ids come from addMob
//     (mobs.ts), so they are unique and the order is deterministic for a map. killMob counts the camp's `alive` down.
//   - hurtMob(world, c, amounts, entries) is the ledger's way down for a regional mob (ledger.ts calls it instead of
//     damageMob when kind != "dummy"). `amounts[i]` is the mitigated damage of `entries[i]`. It removes the hp (never
//     below 0), stamps lastHitAt, tells the AI who hit it (aggro) and, when the hp is gone, kills it. Returns the hp removed.
//   - Camps (sim/camps.ts): the first damage to a member engages its camp (CampState.state 1), and the death of its last
//     member clears it (2) and pays the camp heal after the pass. Elite deaths alone drop chests. Its full roster returns after 3 min.
//   - killMob: status "dead", brain.diedAt = now, input queue and path cleared, a `death` fx (by = the killer's id). The
//     killer is the player who did it the most damage over the whole fight (brain.threat: what each did since it last
//     rested, plus this pass's hits; an exact tie goes to the lower tick rank) among players still in the run with no
//     result out, so one last arrow cannot take an elite someone else wore down. With none, the mob just dies and its
//     weapon still drops. The kill wakes the camp's idle mates onto that killer (mobAI.wakeMatesOnKill, D24), as any hit does. The spoils are paid after the ledger pass (payLater), in this order:
//       1. creditMobKill (arena.ts): mob GV (x m, GV_MOB / GV_ELITE, capped) and the feed, where m is the reward
//          multiplier read INSIDE the pass (every feed is still its tick-start value there, so the order kills are paid
//          in never changes it);
//       2. the mob's weapon: straight into the hand of a killer who is standing with an empty hand (it arms them, with a
//          toast, and nothing drops); otherwise dropped as a loose weapon at its feet (loot.ts dropWeapon), unless the killer
//          already holds that weapon type in either slot. A mob that carries fists (no item) drops nothing. The weapons of every mob a
//          killer kills in one pass are settled together at its first pay-out, in mob id order (the lowest id arms an empty hand);
//       3. the chainable mobKilled hook (quest objectives).
//     A credited normal kill grants one fixed, uncapped mob-type stat stack; elites grant no stat and drop an augment chest.
//   - System `reapMobs`: a corpse older than MOB_CORPSE_MS leaves the state and world.mobs; an idle or returning mob below
//     full hp heals through heal() (3 s out-of-combat lockout, no fx); a mob walking home is whole when it arrives.
//   - On `teleported` every regional mob drops its fight (mobAI.resetMob), because everyone alive just left the map.
import {
  campMobs, elitesOf, FISTS, isWeaponId, MOB_CORPSE_MS, MOB_REGEN_SECONDS, MOB_REPATH_MS, mobName, mobTypeById, mobTypeFaction, mobTypeIn,
  mobTypeWeapon, normalTypesOf, WEAPONS, type FactionId, type MobTypeId, type Vec2,
} from "@raid/shared";
import { creditMobKill } from "./arena";
import { CAMP_CLEARED, CAMP_IDLE, campEngaged, campMobDied, ensureRosters } from "./camps";
import { noteCampContributors } from "./campHeal";
import { combatant, creditedPlayerId, handIsEmpty, isQuestGiver, mobScale, setSlot, standing, type Combatant } from "./combatant";
import { heal } from "./factions";
import { mobRewardFor } from "./feed";
import { grantMobStat } from "./mobStats";
import { dropWeapon } from "./loot";
import { snapshotElitePickers } from "./chests";
import { aggro, newBrain, resetMob, wakeMatesOnKill } from "./mobAI";
import { addMob } from "./mobs";
import { cancelAction, weaponChanged } from "./weapons";
import { chainHook, emit, payLater, tieRank, type LedgerEntry, type World } from "./world";

export type MobCombatant = Extract<Combatant, { kind: "mob" }>;

/**
 * Adds one regional mob of `region` resting at `at`: state (kind, name, faction, weapon, hp from mobTypeFaction) and runtime
 * (a fresh MobBrain). The camp spawner and the tests both go through this. Returns its id.
 * `type` (a MobTypeId, MobState.type) names it by its MOB_TYPES row instead of the region's two-name table, gives it the type's
 * weapon and its role's hp (damage and speed follow from MobState.type in combatant.factionOf and the move modifier below), and
 * `camp` (the camp's 0-based index in map.camps; stored +1 in MobState.camp) links it to its CampState. Both are optional: a
 * mob placed without them has no camp, carries the region's weapon with a grunt's numbers, and `mobTypeOf` gives it the
 * region's default type. A type of another region is ignored for the numbers and the weapon (it only names the mob).
 */
export function placeMob(
  world: World, o: { region: FactionId; elite: boolean; at: Vec2; facing?: number; type?: MobTypeId; camp?: number },
): string {
  const id = addMob(world, {
    kind: o.elite ? "elite" : "mob", name: (o.type !== undefined ? mobTypeById(o.type)?.name : undefined) ?? mobName(o.region, o.elite),
    at: o.at, facing: o.facing, hp: mobTypeFaction(o.region, o.elite, o.type, mobScale(o.elite)).hp,
    faction: o.region, weapon: mobTypeWeapon(o.region, o.type), type: o.type, camp: o.camp !== undefined ? o.camp + 1 : undefined,
  });
  world.mobs.get(id)!.brain = newBrain(o.region, o.elite, o.at, o.facing ?? 0, (world.idCounter * 137) % MOB_REPATH_MS);
  return id;
}

/**
 * Places every camp's mobs, one per spot of `map.camps`, in map order: the camp's published elite (CampState.elite) at its
 * elite spot, the camp's published type (state.camps, rolled by sim/camps.ts) everywhere else, and each camp's `alive` set to
 * what stands there. A no-op for a map without camps (a hand-built test map).
 */
export function spawnRegionalMobs(world: World): void {
  // A training world (sim/training.ts) has its dummies and nothing else: mobs would pay GV and feed that nothing records.
  if (world.config.training) return;
  // Worlds assembled without gameplay.ts (tests) have no roster yet: roll it now, from the same private stream.
  ensureRosters(world);
  world.map.camps.forEach((_camp, ci) => spawnCamp(world, ci));
}

/** Spawn the published roster without consuming either random stream. */
function spawnCamp(world: World, ci: number): void {
  const camp = world.map.camps[ci]!;
  const published = world.state.camps[ci]!;
  const campType = mobTypeIn(camp.zone, published.type)?.id ?? normalTypesOf(camp.zone)[0]!.id;
  const eliteType = mobTypeIn(camp.zone, published.elite)?.id;
  const roster = campMobs(camp, campType, eliteType);
  camp.spots.forEach((spot, i) => {
    placeMob(world, {
      region: camp.zone, elite: roster[i]!.elite, type: roster[i]!.type, camp: ci, at: spot,
      facing: Math.atan2(camp.y - spot.y, camp.x - spot.x),
    });
  });
  published.alive = camp.spots.length;
  published.state = CAMP_IDLE;
  published.clearedAt = published.respawnAt = published.wardExpiresAt = 0;
  published.wardOwner = "";
}

/** Due camps return together at a tick boundary, including while the coliseum gates are locked. */
export function respawnCamps(world: World): void {
  if (!world.config.mobs || world.config.training || world.state.phase !== "active") return;
  const now = world.state.serverTime;
  for (let ci = 0; ci < world.state.camps.length; ci++) {
    const camp = world.state.camps[ci]!;
    if (camp.state !== CAMP_CLEARED || camp.alive !== 0 || camp.respawnAt <= 0 || now < camp.respawnAt || !world.map.camps[ci]) continue;
    // A large test step or stalled room may still have its old corpses. Never overlap cycles or recycle fighter ids.
    for (const [id, mob] of world.state.mobs) {
      if (mob.camp !== ci + 1) continue;
      world.state.mobs.delete(id);
      world.mobs.delete(id);
    }
    spawnCamp(world, ci);
  }
}

/**
 * The ledger's way down for a regional mob; returns the hp removed. A mob without a brain is a training dummy, which the
 * ledger sends to damageMob instead, so it is left alone here. A mob walking home is evading: nothing hurts it (the
 * ledger then shows no number and no stagger), so a shooter out of its reach cannot whittle it down while it leaves.
 */
export function hurtMob(world: World, c: MobCombatant, amounts: readonly number[], entries: readonly LedgerEntry[]): number {
  const brain = c.rt.brain;
  if (isQuestGiver(c) || !brain || brain.mode === "return" || c.s.status !== "alive") return 0;
  let total = 0;
  for (const a of amounts) if (a > 0) total += a;
  if (!(total > 0)) return 0;
  const before = c.s.hp;
  c.s.hp = Math.max(0, before - total);
  c.rt.lastHitAt = world.state.serverTime;
  campEngaged(world, c.s.camp);
  noteCampContributors(world, c.s.camp, entries, amounts);
  if (c.s.hp <= 0) {
    killMob(world, c, entries, amounts, before);
  } else {
    for (let i = 0; i < entries.length; i++) {
      const by = entries[i]!.by.ownerId ?? creditedPlayerId(world, entries[i]!.by.id);
      if (amounts[i]! > 0 && world.state.players.has(by)) aggro(world, c, by, amounts[i]!);
    }
  }
  return before - c.s.hp;
}

/**
 * The mob dies this tick. The kill goes to the player who did it the most damage over the whole fight (what each did
 * since it last rested, plus this pass's hits; an exact tie goes to the lower tick rank) among those still in the run,
 * with the death fx naming them; with none it simply falls, and its weapon still drops. The spoils (GV and feed,
 * the weapon) are paid once every victim of the pass has taken their damage (payLater), so they cannot
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
    const id = entries[i]!.by.ownerId ?? creditedPlayerId(world, entries[i]!.by.id);
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
  const { elite: killedElite } = brain;
  if (killedElite) snapshotElitePickers(world, c.s.camp - 1);
  campMobDied(world, c.s.camp, killer);
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
  // A lethal hit never reaches aggro's fight branch, so the camp is woken here, onto the credited killer (D24).
  if (killer !== null) wakeMatesOnKill(world, c, killer);

  const { elite, region } = brain;
  const type = mobTypeOf(c.s.type, region, elite);
  const camp = c.s.camp - 1;
  const weapon = c.s.weapon0 === FISTS ? "" : c.s.weapon0; // fists are never an item
  const at = { x: c.s.x, y: c.s.y };
  if (killer === null) {
    // Nobody to pay, but the weapon lies where the mob fell all the same.
    if (weapon !== "") payLater(world, () => dropWeapon(world, at, weapon));
    return;
  }
  if (weapon !== "" && !world.config.training) queueWeapon(world, killer, { mob: c.id, weapon, at });
  payLater(world, () => payMobKill(world, killer!, c.id, region, elite, type, camp, weapon, at, m));
}

/**
 * The mob's type: MobState.type when it names one, else (a mob placed before rosters assign types) the zone's first elite
 * type for an elite and its first normal type for any other.
 */
export function mobTypeOf(type: string, region: FactionId, elite: boolean): MobTypeId {
  const t = mobTypeById(type);
  if (t) return t.id;
  return elite ? elitesOf(region)[0]!.id : normalTypesOf(region)[0]!.id;
}

function payMobKill(
  world: World, killerId: string, mobId: string, region: FactionId, elite: boolean, type: MobTypeId, camp: number, weapon: string, at: Vec2, m: number,
): void {
  // A training world's practice mobs (sim/training.ts, the console's `camp`) pay nothing: no GV, feed or drop, so a
  // practice kill never changes the build the player set up.
  if (world.config.training) return;
  const p = world.state.players.get(killerId);
  const rt = world.players.get(killerId);
  if (!p || !rt || rt.resolved) {
    if (weapon !== "") {
      unqueueWeapon(world, killerId, mobId);
      dropWeapon(world, at, weapon);
    }
    return;
  }
  creditMobKill(world, p, rt, elite, m);
  if (!elite) grantMobStat(world, { kind: "player", id: killerId, s: p, rt }, type);
  settleWeapons(world, killerId);
  world.hooks.mobKilled?.(world, rt, { type, zone: region, camp, elite, at });
}

/** A weapon a killed mob carried, waiting for its killer's pay-out. */
interface WeaponAward { mob: string; weapon: string; at: Vec2 }

/**
 * The weapons of the mobs a player killed in one pass, by killer. The pay-outs run in the order the victims were applied, which follows
 * the order the hits were recorded (join order), and the first weapon to be handed out arms an empty hand while the rest lie loose: so the
 * pass's weapons are settled together, at the killer's first pay-out, in mob id order, and no processing order decides which one arms.
 */
const weaponAwards = new WeakMap<World, Map<string, WeaponAward[]>>();

function queueWeapon(world: World, killerId: string, award: WeaponAward): void {
  let by = weaponAwards.get(world);
  if (!by) weaponAwards.set(world, by = new Map());
  const list = by.get(killerId);
  if (list) list.push(award);
  else by.set(killerId, [award]);
}

/** A killer that is gone has no hand to arm: the mob's own pay-out drops its weapon, so it leaves the queue. */
function unqueueWeapon(world: World, killerId: string, mobId: string): void {
  const list = weaponAwards.get(world)?.get(killerId);
  if (!list) return;
  const i = list.findIndex((a) => a.mob === mobId);
  if (i >= 0) list.splice(i, 1);
  if (list.length === 0) weaponAwards.get(world)!.delete(killerId);
}

/** Mob ids count up in base 36 (nextId), so the shorter one is the earlier. */
const byMobId = (a: WeaponAward, b: WeaponAward): number => a.mob.length - b.mob.length || (a.mob < b.mob ? -1 : a.mob > b.mob ? 1 : 0);

function settleWeapons(world: World, killerId: string): void {
  const by = weaponAwards.get(world);
  const list = by?.get(killerId);
  if (!by || !list) return;
  by.delete(killerId);
  for (const a of list.sort(byMobId)) awardMobWeapon(world, killerId, a.weapon, a.at);
}

/**
 * The weapon a mob carried, after a kill by a player of this run. A killer who is standing with an empty hand is armed with
 * it on the spot (the hand takes it up like a pickup into the hand: weaponChanged) and told so; nothing lies on the ground.
 * Any other killer (armed, or down in this very pass and so unable to wield it) leaves it as a loose weapon at the mob's feet,
 * unless they already hold that type in either slot.
 */
function awardMobWeapon(world: World, killerId: string, weapon: string, at: Vec2): void {
  const killer = combatant(world, killerId);
  if (killer?.kind === "player" && isWeaponId(weapon) && standing(killer) && handIsEmpty(killer.s)) {
    setSlot(killer.s, killer.s.slot === 1 ? 1 : 0, weapon);
    weaponChanged(world, killer);
    emit(world, { type: "toast", to: killerId, text: `Armed: ${WEAPONS[weapon].name}` });
    return;
  }
  const p = world.state.players.get(killerId)!;
  if (p.weapon0 !== weapon && p.weapon1 !== weapon) dropWeapon(world, at, weapon);
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

/**
 * world.moveModifiers entry: a regional mob walks at its type's role speed (swarm and skirmisher faster than a player, brute
 * slower; shared MOB_ROLE_DEFS). A player, a dummy, a quest giver and a mob without a type of its region walk at 1.
 */
export function mobRoleMove(_world: World, c: Combatant): number {
  if (c.kind !== "mob" || c.s.type === "") return 1;
  return mobTypeIn(c.s.faction as FactionId, c.s.type)?.moveMult ?? 1;
}

export function install(world: World): void {
  world.systems.push(reapMobs);
  world.systems.push(respawnCamps);
  world.moveModifiers.push(mobRoleMove);
  if (world.config.mobs) chainHook(world, "raidStarted", spawnRegionalMobs);
  chainHook(world, "teleported", resetAllMobs);
}
