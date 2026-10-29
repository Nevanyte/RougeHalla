// Weapon state machines (GAME_DESIGN 9.1, 9.3, 10.3): the trigger, the attack windups, the shared cooldown, stagger,
// swaps, and the movement they impose. updateWeapons() runs once per active tick right after inputs and the target lock
// (step.ts), for every standing fighter:
//   landing  an attack whose windup is over: a swing becomes a MeleeRequest (resolved in the melee phase, after the
//            projectile sweep); a cast or a bow draw becomes a SpawnRequest (its ball or arrow is spawned after the sweep)
//   start    a held (or just pressed) trigger starts the next attack as soon as the cooldown allows
// Every attack is a windup (weaponTimings.windup): the fighter is rooted from its start until the swing lands or the
// ball or arrow leaves, and walks freely again afterwards (the axe stays rooted a while longer). A directional windup (a
// mob's, the harness's, an `attack` input) is committed: a move order given during it is kept as the path and walked once
// it ends; only a stagger (not on the bow) or a swap cancels it. One the target lock started (sim/targeting.ts) is the
// player's own click, so the player's next order cancels it as in LoL (cancelLockedWindup): a move, a stop, or locking
// another fighter. An attack started by the lock is aimed again at its target when it lands.
// The cooldown carries its remainder: an attack from a trigger already down when the cooldown ended counts from that
// moment (at most one tick back), so cadences are not rounded up to the 50 ms tick grid, as in realtime.py.
import {
  ATTACK_BUFFER_MS, attackInterval, CRIT_MULT, damagePerHit, damageShares, MAX_REWIND_MS, moveMultiplier, PLANT_FEET_BONUS,
  scalingDamage, staggerImmuneUntil, swapReadyAt, TICK_MS, WEAPONS, type Vec2, type WeaponId, type WeaponTimings,
} from "@raid/shared";
import { attackSpeedMult } from "./buffs";
import { plantArmed, rollAttackCrit, spendPlant } from "./cardState";
import {
  activeWeapon, combatant, factionOf, handIsEmpty, hostile, isEvading, slotItem, slotWeapon, standing, standingCombatants, timingsOf,
  type Combatant,
} from "./combatant";
import { hasFlag, hitMultOf, scalingStatsOf } from "./mods";
import { positionAt } from "./movement";
import { actionBlocked, isStunned, isUntargetable } from "./status";
import {
  chainHook, emit, newWeaponRuntime, type ActionHandler, type DamagePacket, type PendingAction, type World,
} from "./world";

export function install(world: World): void {
  world.actions.attack = handlePress;
  world.actions.release = handleRelease;
  world.actions.swap = handleSwap;
  // Nothing started before the teleport may land after it, no root follows anyone in, and the trigger must be pressed again.
  chainHook(world, "teleported", (w) => {
    for (const c of standingCombatants(w)) {
      releaseTrigger(w, c);
      c.rt.weapon.rootUntil = 0;
    }
  });
}

/**
 * Lets go of the trigger and the target lock for a fighter whose client can't (a dropped connection, a teleport, going
 * down) and cancels what was in progress, so nothing keeps drawing, swinging or chasing on its own.
 */
export function releaseTrigger(world: World, c: Combatant): void {
  dropLock(c);
  c.rt.weapon.attackMoveGoal = null;
  c.rt.weapon.held = false;
  c.rt.weapon.bufferedUntil = 0;
  cancelAction(world, c);
}

/** Locks `id` (a fresh chase; the re-plan throttle carries over) and mirrors it in the synced state. */
export function setLock(c: Combatant, id: string): void {
  const w = c.rt.weapon;
  w.lock = id;
  w.lockSeen = false;
  w.lockLosLostAt = 0;
  w.lockGoal = null;
  if (c.kind === "player" && c.s.attackTarget !== id) c.s.attackTarget = id;
}

/** Forgets the lock and the chase's memory, and clears the synced mirror. */
export function clearLock(c: Combatant): void {
  const w = c.rt.weapon;
  w.lock = null;
  w.lockSeen = false;
  w.lockLosLostAt = 0;
  w.lockGoal = null;
  if (c.kind === "player" && c.s.attackTarget !== "") c.s.attackTarget = "";
}

/**
 * The lock ends (another order, or its target is gone): the trigger it held and the path it chased with go with it, so the
 * fighter stops where it stands. Does nothing for a fighter without a lock, whose trigger and path are its own (a mob's, a
 * bot's). Returns whether there was a lock.
 */
export function dropLock(c: Combatant): boolean {
  const w = c.rt.weapon;
  if (w.lock === null) return false;
  clearLock(c);
  w.held = false;
  w.bufferedUntil = 0;
  c.rt.path = [];
  return true;
}

/**
 * The raw damage packet of a hit with `weapon` in this fighter's hands: the faction's own hit (damagePerHit, with its shares)
 * plus what the weapon scales the fighter's AD, AP, bonus max hp and bonus defense into (BALANCE_CONTRACT 3.3, shared
 * scalingDamage: the ad, hp and def parts physical, the ap part magic, each times asMult x interval), all times the fighter's `hit`
 * mult (Boom, Machine Gun). One packet, its shares blended, so the ledger is unchanged. A fighter with no AD, AP, bonus hp or
 * defense and no `hit` mult gets exactly the faction's packet.
 */
export function packetFor(c: Combatant, weapon: WeaponId): DamagePacket {
  const f = factionOf(c.s);
  if (!f) return { raw: 0, phys: 1, magic: 0, true: 0 };
  const as = attackSpeedMult(c.s);
  const base = damagePerHit(f, weapon, as);
  const shares = damageShares(f);
  const hit = hitMultOf(c.s);
  const { phys, magic } = scalingDamage(weapon, scalingStatsOf(c.s), as, attackInterval(f, weapon, as));
  if (phys === 0 && magic === 0) return { raw: hit === 1 ? base : base * hit, ...shares };
  const total = base + phys + magic;
  if (!(total > 0)) return { raw: 0, ...shares };
  return {
    raw: total * hit,
    phys: (base * shares.phys + phys) / total,
    magic: (base * shares.magic + magic) / total,
    true: (base * shares.true) / total,
  };
}

/** The fighter now aims at `a`: the shield faces it, the next attack goes there, and walking no longer turns it. */
export function setAim(world: World, c: Combatant, a: number): void {
  const w = c.rt.weapon;
  w.aim = a;
  w.aimAt = world.state.serverTime;
  c.s.facing = a;
}

/** Remembers how far behind the server the client renders (now - t), clamped; no `t` means the present. */
function noteLag(world: World, c: Combatant, t: number | undefined): void {
  const lag = t === undefined ? TICK_MS : world.state.serverTime - t;
  c.rt.weapon.lagMs = Math.min(MAX_REWIND_MS, Math.max(TICK_MS, lag));
}

export const handlePress: ActionHandler = (world, c, cmd) => {
  if (cmd.kind !== "attack") return;
  const w = c.rt.weapon;
  const now = world.state.serverTime;
  dropLock(c); // an attack order replaces the lock: this swing goes where the press aims
  w.attackMoveGoal = null;
  if (!isStunned(world, c)) setAim(world, c, cmd.a); // a stunned fighter's facing is frozen (D5)
  noteLag(world, c, cmd.t);
  if (!w.held) w.pressedAt = now;
  w.held = true;
  w.bufferedUntil = now + ATTACK_BUFFER_MS;
};

export const handleRelease: ActionHandler = (world, c, cmd) => {
  if (cmd.kind !== "release") return;
  const w = c.rt.weapon;
  if (w.lock === null && !isStunned(world, c)) setAim(world, c, cmd.a); // a lock aims the fighter itself; a stun freezes the facing
  // Without a timestamp the press's lag stands (only the press defaults to the present).
  if (cmd.t !== undefined) noteLag(world, c, cmd.t);
  w.held = false;
};

export const handleSwap: ActionHandler = (world, c, cmd) => {
  if (cmd.kind !== "swap") return;
  if (actionBlocked(world, c)) return;
  const target = cmd.slot ?? (c.s.slot === 0 ? 1 : 0);
  // An empty slot is fists, so swapping to one is fine; two empty slots are the same hand, and swapping costs the swap time.
  if (target === c.s.slot || slotWeapon(c.s, target) === null) return;
  if (target === 1 && hasFlag(c.s, "lockSecondSlot")) return; // Committed: the second slot is not used
  if (slotItem(c.s, target) === null && handIsEmpty(c.s)) return;
  c.s.slot = target;
  weaponChanged(world, c);
};

/**
 * The weapon in hand just changed (a swap, or a pickup that replaced it): the current action is cancelled and the
 * shared cooldown gets SWAP_SECONDS more, so changing weapons never cuts an animation short.
 */
export function weaponChanged(world: World, c: Combatant): void {
  cancelAction(world, c);
  c.s.readyAt = swapReadyAt(c.s.readyAt, world.state.serverTime);
  if (activeWeapon(c.s) !== "wand") dropLock(c);
  world.hooks.weaponSwapped?.(world, c);
}

/**
 * Drops whatever is in progress: no landing, no ball, no arrow. The cooldown stays spent. Only a swing or cast still
 * pending takes its root with it (a swap after an axe has landed must not cut its root short; a bow draw has no root of
 * its own, whatever an earlier weapon left).
 */
export function cancelAction(world: World, c: Combatant): void {
  const w = c.rt.weapon;
  if (w.action && w.action.kind !== "draw") w.rootUntil = Math.min(w.rootUntil, world.state.serverTime);
  w.action = null;
  c.s.drawStartedAt = 0;
}

/**
 * The player's own order (a move, a stop, or a lock on another fighter) cancels the attack its lock started and that has not
 * landed yet: no swing, ball or arrow, the cooldown refunded to the moment the attack began (it was over by then) and the root
 * cut, as LoL's move cancels a windup. A directional attack (a mob's, the harness's, an `attack` input) has no `target` and stays
 * committed, as does one that has landed (the axe's root after it stays). Emits `cancel` so clients drop the telegraph.
 * Returns whether it cancelled one.
 */
export function cancelLockedWindup(world: World, c: Combatant, preserveRanged = false): boolean {
  const act = c.rt.weapon.action;
  if (!act || act.target === undefined || (preserveRanged && (act.weapon === "wand" || act.weapon === "bow"))) return false;
  c.s.readyAt = act.startedAt;
  cancelAction(world, c);
  emit(world, { type: "fx", fx: { kind: "cancel", id: c.id } });
  return true;
}

/**
 * An unblocked sword hit landed on `c`: cancel its windup or cast (the cooldown stays spent), then
 * STAGGER_IMMUNITY_SECONDS of immunity. A bow draw is not interrupted (9.1 tuning): restarting it made every sword hit
 * cost the archer a whole draw, ~70 per duel, and the bow could never win the close trade. The stagger fx (the mark
 * over the fighter) is emitted only when something was cancelled, so a mark always means a lost windup or cast.
 * Returns false (and does nothing) while it is immune.
 */
export function stagger(world: World, c: Combatant): boolean {
  const w = c.rt.weapon;
  const now = world.state.serverTime;
  if (now < w.staggerImmuneUntil) return false;
  w.staggerImmuneUntil = staggerImmuneUntil(now);
  world.hooks.staggered?.(world, c);
  if (w.action && w.action.kind !== "draw") {
    cancelAction(world, c);
    emit(world, { type: "fx", fx: { kind: "stagger", id: c.id } });
  }
  return true;
}

/** Move speed multiplier from the fighter's weapon state: 0 while an attack winds up or the axe's root holds. Buffs and the chill are world.moveModifiers. */
export function moveMultiplierOf(world: World, c: Combatant): number {
  const w = c.rt.weapon;
  return moveMultiplier({ now: world.state.serverTime, rootUntil: w.rootUntil, windingUp: w.action !== null });
}

/** A fresh state machine and cooldown (the run starts), and no lock. */
export function resetWeapons(c: Combatant): void {
  c.rt.weapon = newWeaponRuntime();
  c.s.readyAt = 0;
  c.s.drawStartedAt = 0;
  if (c.kind === "player") c.s.attackTarget = "";
}

/** The server time the fighter's client was drawing at `now`, for melee rewind: never before the window, never unpublished. */
export function rewindTime(now: number, lagMs: number): number {
  return now - Math.min(MAX_REWIND_MS, Math.max(TICK_MS, lagMs));
}

/**
 * Where the fighter's client draws it right now (its rewound position). Clients measure aim angles from there, so a
 * projectile leaves from there too; from the present position, a shooter strafing while it draws would miss what it
 * aimed at by its speed times the render lag.
 */
function drawnOrigin(world: World, c: Combatant): Vec2 {
  return positionAt(c.rt, c.s, rewindTime(world.state.serverTime, c.rt.weapon.lagMs));
}

export function updateWeapons(world: World): void {
  for (const c of standingCombatants(world)) stepWeapon(world, c);
}

/**
 * A cooldown or a windup that ends exactly on a tick (an interval of 2/3 s lands three swings on 2.000 s) is due on that tick, whichever way
 * float noise in the carried times falls (testing/realtime.py's EPS, 1e-9 s): otherwise a swing slips a whole tick on some sums.
 */
const TIE_EPS_MS = 1e-6;

function stepWeapon(world: World, c: Combatant): void {
  const now = world.state.serverTime;
  const w = c.rt.weapon;
  const weapon = activeWeapon(c.s);
  const tm = weapon ? timingsOf(c.s, weapon) : null;
  if (!weapon || !tm) {
    if (w.action) cancelAction(world, c);
    return;
  }
  if (w.action && now + TIE_EPS_MS >= w.action.landsAt) land(world, c, w.action);
  const wants = w.held || now <= w.bufferedUntil;
  if (!w.action && wants && now + TIE_EPS_MS >= c.s.readyAt && !actionBlocked(world, c)) startAttack(world, c, weapon, tm);
}

/**
 * The target a locked attack is aimed at as it lands: the fighter the lock started it on, if it still stands and is an
 * enemy. Whether the lock itself still holds does not matter: the attack was committed to that fighter.
 */
function lockedFoe(world: World, c: Combatant, id: string | undefined): Combatant | null {
  const t = id === undefined ? undefined : combatant(world, id);
  return t && standing(t) && hostile(c, t) && !isEvading(t) && !isUntargetable(world, t) ? t : null;
}

/**
 * The windup is over: the swing becomes a melee request, the ball or arrow a spawn request. This is the attack landing, so it is
 * where a critical strike is decided (the fighter's own accumulator, sim/cardState.ts rollAttackCrit): the hit it makes is 1.5x
 * and flagged, for every body a swing meets. A cancelled windup never gets here, so it counts for nothing.
 */
function land(world: World, c: Combatant, planned: PendingAction): void {
  const now = world.state.serverTime;
  const w = c.rt.weapon;
  w.action = null;
  const act: PendingAction = rollAttackCrit(c)
    ? { ...planned, packet: { ...planned.packet, raw: planned.packet.raw * CRIT_MULT, crit: true, mult: (planned.packet.mult ?? 1) * CRIT_MULT } }
    : planned;
  const foe = lockedFoe(world, c, act.target);
  if (act.kind === "swing") {
    const rewindT = rewindTime(now, w.lagMs);
    let a = act.a;
    if (foe) {
      const from = positionAt(c.rt, c.s, rewindT);
      const to = positionAt(foe.rt, foe.s, rewindT);
      a = Math.atan2(to.y - from.y, to.x - from.x);
    }
    world.combat.melee.push({ attacker: c.id, weapon: act.weapon, a, rewindT, packet: act.packet, ...(act.rangeMult !== undefined ? { rangeMult: act.rangeMult } : {}) });
    return;
  }
  const shape = WEAPONS[act.weapon].shape;
  if (shape.kind !== "projectile") return;
  w.lastShotAt = now;
  // The shot leaves from its drawn origin. Unit-targeted basic attacks follow the target after launch, so they aim at its
  // current position here rather than predicting its future position. Otherwise
  // an arrow goes along the aim held when the draw ends (a bow is aimed while drawn, as it was when it loosed on release)
  // and a ball where its cast was aimed (as it always was): the 9.1 edges were tuned with both.
  // A locked shot whose target fell keeps the aim it started with (at that target), not a cursor aim that came after.
  const a = foe ? Math.atan2(foe.s.y - act.origin.y, foe.s.x - act.origin.x)
    : act.kind === "draw" && act.target === undefined ? w.aim : act.a;
  world.combat.spawns.push({
    owner: c.id, kind: shape.projectile, weapon: act.weapon, a, packet: act.packet, origin: act.origin,
    ...(foe && act.weapon === "wand" ? { targetId: foe.id } : {}),
    ...(act.rangeMult !== undefined ? { rangeMult: act.rangeMult } : {}),
  });
  if (act.kind === "draw") c.s.drawStartedAt = 0;
}

function startAttack(world: World, c: Combatant, weapon: WeaponId, tm: WeaponTimings): void {
  const now = world.state.serverTime;
  const w = c.rt.weapon;
  // A trigger already down when the cooldown ended attacks from that moment (carrying the remainder), at most a tick back.
  const start = w.pressedAt <= c.s.readyAt ? Math.max(c.s.readyAt, now - TICK_MS) : now;
  w.bufferedUntil = 0;
  const landsAt = start + tm.windup * 1000;
  let packet = packetFor(c, weapon);
  // Plant Your Feet: standing still long enough arms this attack with more range and damage (spent by it; the damage is a baked multiplier G1 counts).
  let rangeMult: number | undefined;
  if (plantArmed(world, c)) {
    const bonus = 1 + PLANT_FEET_BONUS;
    packet = { ...packet, raw: packet.raw * bonus, mult: (packet.mult ?? 1) * bonus };
    rangeMult = bonus;
    spendPlant(world, c);
  }
  const target = weapon === "wand" ? w.lock ?? undefined : undefined;
  const act: PendingAction = WEAPONS[weapon].shape.kind === "arc"
    ? { kind: "swing", weapon, startedAt: start, landsAt, a: w.aim, packet, target, ...(rangeMult !== undefined ? { rangeMult } : {}) }
    : {
      kind: weapon === "bow" ? "draw" : "cast", weapon, startedAt: start, landsAt, a: w.aim, packet, origin: drawnOrigin(world, c), target,
      ...(rangeMult !== undefined ? { rangeMult } : {}),
    };
  w.action = act;
  c.s.readyAt = start + tm.interval * 1000;
  if (tm.root > 0) w.rootUntil = start + tm.root * 1000;
  // Clients draw the bow's pull from its synced start; every other windup is announced once.
  if (weapon === "bow") c.s.drawStartedAt = start;
  else emit(world, { type: "fx", fx: { kind: "windup", by: c.id, weapon, a: w.aim, ms: landsAt - now } });
  world.hooks.attackStarted?.(world, c);
}
