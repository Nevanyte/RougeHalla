// Weapon state machines (GAME_DESIGN 9.1, 9.3, 10.3): the trigger, windups and casts, the bow draw, the shared
// cooldown, stagger, swaps, and the movement they impose. updateWeapons() runs once per active tick right after inputs
// (step.ts), for every standing fighter:
//   landing  a swing whose windup is over becomes a MeleeRequest (resolved in the melee phase, after the projectile
//            sweep); a cast whose windup is over becomes a SpawnRequest (its ball is spawned after the sweep)
//   bow      a pending release looses the arrow once the minimum draw is reached
//   start    a held (or just pressed) trigger starts the next attack as soon as the cooldown allows
// The cooldown carries its remainder: an attack from a trigger already down when the cooldown ended counts from that
// moment (at most one tick back), and a bow held past its full draw has the excess (at most a tick) taken off its
// cooldown. So cadences are not rounded up to the 50 ms tick grid, as in realtime.py.
import {
  ATTACK_BUFFER_MS, damagePerHit, damageShares, drawDamageScale, MAX_REWIND_MS, moveMultiplier, staggerImmuneUntil,
  swapReadyAt, TICK_MS, WEAPONS, type WeaponId, type WeaponTimings,
} from "@raid/shared";
import {
  activeWeapon, factionOf, slotWeapon, standingCombatants, timingsOf, type Combatant,
} from "./combatant";
import {
  chainHook, emit, newWeaponRuntime, type ActionHandler, type DamagePacket, type PendingAction, type World,
} from "./world";

export function install(world: World): void {
  world.actions.attack = handlePress;
  world.actions.release = handleRelease;
  world.actions.swap = handleSwap;
  // Nothing started before the teleport may land after it, and the trigger must be pressed again.
  chainHook(world, "teleported", (w) => {
    for (const c of standingCombatants(w)) {
      cancelAction(w, c);
      c.rt.weapon.held = false;
      c.rt.weapon.bufferedUntil = 0;
    }
  });
}

/** The raw damage packet of a hit with `weapon` in this fighter's hands; `scale` is the bow's draw share. */
export function packetFor(c: Combatant, weapon: WeaponId, scale = 1): DamagePacket {
  const f = factionOf(c.s);
  if (!f) return { raw: 0, phys: 1, magic: 0, true: 0 };
  return { raw: damagePerHit(f, weapon) * scale, ...damageShares(f) };
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
  setAim(world, c, cmd.a);
  noteLag(world, c, cmd.t);
  if (!w.held) w.pressedAt = now;
  w.held = true;
  w.bufferedUntil = now + ATTACK_BUFFER_MS;
};

export const handleRelease: ActionHandler = (world, c, cmd) => {
  if (cmd.kind !== "release") return;
  const w = c.rt.weapon;
  const now = world.state.serverTime;
  setAim(world, c, cmd.a);
  noteLag(world, c, cmd.t);
  w.held = false;
  // A draw in progress, or a quick tap that will start one: loose it as soon as the minimum draw allows.
  if (activeWeapon(c.s) === "bow" && (w.action?.kind === "draw" || now <= w.bufferedUntil)) w.releasePending = true;
};

export const handleSwap: ActionHandler = (world, c, cmd) => {
  if (cmd.kind !== "swap") return;
  const target = cmd.slot ?? (c.s.slot === 0 ? 1 : 0);
  if (target === c.s.slot || !slotWeapon(c.s, target)) return;
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
  world.hooks.weaponSwapped?.(world, c);
}

/** Drops whatever was in progress: no landing, no arrow, no root or cast slow left. The cooldown stays spent. */
export function cancelAction(world: World, c: Combatant): void {
  const w = c.rt.weapon;
  const now = world.state.serverTime;
  w.action = null;
  w.releasePending = false;
  w.rootUntil = Math.min(w.rootUntil, now);
  w.castSlowUntil = Math.min(w.castSlowUntil, now);
  c.s.drawStartedAt = 0;
}

/**
 * An unblocked sword hit landed on `c`: cancel its windup or cast (the cooldown stays spent) or restart its bow draw,
 * then STAGGER_IMMUNITY_SECONDS of immunity. Returns false (and does nothing) while it is immune.
 */
export function stagger(world: World, c: Combatant): boolean {
  const w = c.rt.weapon;
  const now = world.state.serverTime;
  if (now < w.staggerImmuneUntil) return false;
  w.staggerImmuneUntil = staggerImmuneUntil(now);
  const act = w.action;
  if (act?.kind === "draw") {
    act.startedAt = now;
    c.s.drawStartedAt = now;
  } else if (act) {
    w.action = null;
    w.rootUntil = Math.min(w.rootUntil, now);
    w.castSlowUntil = Math.min(w.castSlowUntil, now);
  }
  emit(world, { type: "fx", fx: { kind: "stagger", id: c.id } });
  return true;
}

/** Move speed multiplier from the fighter's weapon state (root, draw, cast slow, ranged recovery). */
export function moveMultiplierOf(world: World, c: Combatant): number {
  const w = c.rt.weapon;
  return moveMultiplier({
    now: world.state.serverTime,
    rootUntil: w.rootUntil,
    castSlowUntil: w.castSlowUntil,
    recoverUntil: w.recoverUntil,
    drawing: w.action?.kind === "draw",
  });
}

/** A fresh state machine and cooldown (the run starts). */
export function resetWeapons(c: Combatant): void {
  c.rt.weapon = newWeaponRuntime();
  c.s.readyAt = 0;
  c.s.drawStartedAt = 0;
}

/** The server time the fighter's client was drawing at `now`, for melee rewind: never before the window, never unpublished. */
export function rewindTime(now: number, lagMs: number): number {
  return now - Math.min(MAX_REWIND_MS, Math.max(TICK_MS, lagMs));
}

export function updateWeapons(world: World): void {
  for (const c of standingCombatants(world)) stepWeapon(world, c);
}

function stepWeapon(world: World, c: Combatant): void {
  const now = world.state.serverTime;
  const w = c.rt.weapon;
  const weapon = activeWeapon(c.s);
  const tm = weapon ? timingsOf(c.s, weapon) : null;
  if (!weapon || !tm) {
    if (w.action) cancelAction(world, c);
    return;
  }
  const act = w.action;
  if (act && act.kind !== "draw" && now >= act.landsAt) {
    w.action = null;
    if (act.kind === "swing") {
      world.combat.melee.push({ attacker: c.id, weapon: act.weapon, a: act.a, rewindT: rewindTime(now, w.lagMs), packet: act.packet });
    } else {
      world.combat.spawns.push({ owner: c.id, kind: "ball", weapon: act.weapon, a: act.a, packet: act.packet });
    }
  }
  if (w.action?.kind === "draw" && w.releasePending) {
    const drawn = (now - w.action.startedAt) / 1000;
    if (drawn >= tm.minDraw - 1e-9) loose(world, c, tm, drawn);
  }
  const wants = w.held || now <= w.bufferedUntil;
  if (!w.action && wants && now >= c.s.readyAt) startAttack(world, c, weapon, tm);
}

function startAttack(world: World, c: Combatant, weapon: WeaponId, tm: WeaponTimings): void {
  const now = world.state.serverTime;
  const w = c.rt.weapon;
  // A trigger already down when the cooldown ended attacks from that moment (carrying the remainder), at most a tick back.
  const start = w.pressedAt <= c.s.readyAt ? Math.max(c.s.readyAt, now - TICK_MS) : now;
  w.bufferedUntil = 0;
  if (weapon === "bow") {
    w.action = { kind: "draw", weapon, startedAt: start };
    c.s.drawStartedAt = start;
    return; // a pending release (a quick tap) looses it at the minimum draw
  }
  w.releasePending = false;
  const landsAt = start + tm.windup * 1000;
  const act: PendingAction = {
    kind: WEAPONS[weapon].shape.kind === "arc" ? "swing" : "cast",
    weapon, startedAt: start, landsAt, a: w.aim, packet: packetFor(c, weapon),
  };
  w.action = act;
  c.s.readyAt = start + tm.interval * 1000;
  if (tm.root > 0) w.rootUntil = start + tm.root * 1000;
  if (tm.castSlow > 0) w.castSlowUntil = start + tm.castSlow * 1000;
  if (tm.ranged) w.recoverUntil = c.s.readyAt;
  emit(world, { type: "fx", fx: { kind: "windup", by: c.id, weapon, a: w.aim, ms: landsAt - now } });
}

/** The bow looses an arrow drawn for `drawn` seconds toward the current aim. */
function loose(world: World, c: Combatant, tm: WeaponTimings, drawn: number): void {
  const now = world.state.serverTime;
  const w = c.rt.weapon;
  world.combat.spawns.push({
    owner: c.id, kind: "arrow", weapon: "bow", a: w.aim, packet: packetFor(c, "bow", drawDamageScale(drawn, tm)),
  });
  const overhold = Math.min(TICK_MS, Math.max(0, (drawn - tm.fullDraw) * 1000));
  c.s.readyAt = now + tm.cooldown * 1000 - overhold;
  w.recoverUntil = c.s.readyAt;
  w.action = null;
  w.releasePending = false;
  c.s.drawStartedAt = 0;
}
