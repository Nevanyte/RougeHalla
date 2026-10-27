// The ability cast pipeline, the five Wishes and the status systems (GAME_DESIGN 8.8, 8.9).
//
// A `cast` input (handleCast) is validated in one fixed order and, once accepted, spends the slot's cooldown at once and
// becomes `rt.cast` (a CastRuntime, OUTSIDE the weapon's PendingAction: it roots through `castMs`, and only its def's
// `cancelledBy` causes end it). It LANDS in `updateAbilities`, the phase step.ts runs after the inputs and before the target
// locks. Every cast due in a tick lands together (D8): pass 1 re-validates them all against the state as it stood when the
// phase began, pass 2a applies the survivors' self effects and 2b their target effects, each in the tick's secret rank, so
// no processing order decides an outcome. A cast that fails at its landing keeps its cooldown spent (a `castEnd` fizzle).
//
// Statuses, fields and displacement are leaf runtimes (status.ts, fields.ts, displace.ts); this module is what gives them
// meaning for casts and windups: it installs the hooks they call (`statusApplied`, `fighterOut`, ...), expires statuses and
// fields, ends a Trial zone whose subject leaves it, and runs the damage-over-time systems (a Blaze Step trail ignites
// whoever stands on it; every `dot` status ticks through the ledger like any other hit).
//
// Everything here tolerates `world.abilities === null` (nothing has used it yet) and fighters with no statuses.
import {
  ABILITIES, abilityCooldownMs, abilityInSlot, blinkLanding, CAST_RANGE_SLACK, CAST_TELEPORT_GRACE_MS, CRIT_MULT, DOT_FX_MS, effectSide,
  hasLineOfSight,
  HIDDEN_REVEAL_MS, MAX_REWIND_MS, rankOf, setSlotReadyAt, slotReadyAt, TICK_MS, WISH_LOCK_SECONDS,
  type AbilityDef, type AbilityEffect, type AbilityId, type AbilityRank, type CastCancel, type CastEndReason, type DamageShares,
  type Vec2,
} from "@raid/shared";
import { cardsOf, rollDotCrit } from "./cardState";
import { combatant, hostile, isEvading, standing, standingCombatants, type Combatant } from "./combatant";
import { displace } from "./displace";
import { heal } from "./factions";
import { abilitiesRt, addField, fieldsOf, onTrail, removeField, removeFieldsWhere } from "./fields";
import { recordHit } from "./ledger";
import { dotMultOf, recomputeMods, wishCooldownMultOf } from "./mods";
import {
  addStatus, attackSlowFactor, castBlocked, cleanse, isUntargetable, refreshEffects, removeStatuses, reveal,
  statusesOf, statusMoveMultiplier,
} from "./status";
import { cancelAction, cancelLockedWindup, dropLock } from "./weapons";
import {
  chainHook, collisionMap, emit, payLater, type ActionHandler, type CastRuntime, type DamageSource, type FieldRuntime,
  type ModContribution, type StatusInstance, type World,
} from "./world";

/** The damage shares of a burn: all true, so armor and shield never touch it (D12: flat power). */
const TRUE_SHARES: DamageShares = { phys: 0, magic: 0, true: 1 };

export function install(world: World): void {
  world.actions.cast = handleCast;
  world.beforeDamage.push(statusDamage);
  world.systems.push(abilityDotFx);
  world.moveModifiers.push(statusMoveMultiplier);
  // Attack speed has one source of truth, the stat mirrors (sim/mods.ts, which cannot import this runtime): the slow joins them.
  world.modSources.push(attackSlowSource);
  chainHook(world, "raidStarted", armWishes);
  // The teleport resets the fight: every cast is cancelled (and refunded), every status and field ends, a Last Stand still pays.
  chainHook(world, "teleported", (w) => clearAll(w, "teleport"));
  chainHook(world, "runEnded", (w) => { flushAbilityDot(w); clearAll(w, "runEnd"); });
  // Down in the ledger pass: the status table is frozen there (D20), so what a death clears waits for its end like the spoils.
  chainHook(world, "fighterOut", (w, id, cause) => payLater(w, () => clearFighter(w, id, cause)));
  chainHook(world, "attackStarted", onAttackStarted);
  chainHook(world, "statusApplied", onStatusApplied);
  chainHook(world, "staggered", (w, c) => cancelIf(w, c, "stagger"));
}

/** What the stat mirrors fold in of this runtime: an attack slow multiplies the attack-speed mirror (nothing else is a mirror yet). */
function attackSlowSource(world: World, c: Combatant): ModContribution | null {
  const factor = attackSlowFactor(world, c);
  return factor < 1 ? { asMult: factor } : null;
}

/** The first rank's effect of a kind, for the numbers a field or a status does not carry (a trail's burn, a zone's exit stun): Wishes have one rank, a skill's field would have to carry its rank. */
function effectOf<K extends AbilityEffect["do"]>(id: AbilityId, kind: K): Extract<AbilityEffect, { do: K }> | undefined {
  for (const e of rankOf(ABILITIES[id], 1).effects) if (e.do === kind) return e as Extract<AbilityEffect, { do: K }>;
  return undefined;
}

const sourceOf = (c: Combatant): DamageSource => ({ id: c.id, name: c.s.name });

// ---------------------------------------------------------------------------------------------------------------------
// The run starts
// ---------------------------------------------------------------------------------------------------------------------

/**
 * raidStarted: every Wish is locked for WISH_LOCK_SECONDS (none in a training world, where it is ready at once and its
 * cooldown is the short one). Statuses, casts and fields start clean, and the damage-over-time chunk starts now.
 */
export function armWishes(world: World): void {
  const s = world.state;
  const readyAt = world.config.training ? 0 : s.raidStartedAt + Math.max(0, world.config.wishLockSeconds ?? WISH_LOCK_SECONDS) * 1000;
  for (const [id, p] of s.players) {
    const rt = world.players.get(id);
    if (!rt) continue;
    const c: Combatant = { kind: "player", id, s: p, rt };
    rt.cast = null;
    removeStatuses(world, c, () => true);
    p.wishReadyAt = readyAt;
    p.qReadyAt = 0;
    p.eReadyAt = 0;
    refreshEffects(world, c);
  }
  removeFieldsWhere(world, () => true);
  const a = world.abilities;
  if (a) {
    a.dot.clear();
    a.dotSince = s.serverTime;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// The cast input
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Can `c` cast a unit-targeted ability on `t` now: a standing enemy that is not walking home, not untargetable (a hidden
 * fighter counts, outside its reveal window) and not under teleport immunity, within `maxRange` centre to centre and, if
 * `los`, in line of sight on the collision map.
 */
export function validUnitTarget(world: World, c: Combatant, t: Combatant, maxRange: number, los: boolean): boolean {
  if (t.id === c.id || !standing(t) || !hostile(c, t) || isEvading(t) || isUntargetable(world, t)) return false;
  if (t.kind === "player" && world.state.serverTime < t.s.immuneUntil) return false;
  const dx = t.s.x - c.s.x;
  const dy = t.s.y - c.s.y;
  if (Math.hypot(dx, dy) > maxRange) return false;
  return !los || hasLineOfSight(collisionMap(world), c.s, t.s);
}

/**
 * A `cast` input. Refused silently and at no cost (nothing changes but the `seq` echo) unless, in this order: the slot holds an
 * ability, the run is active, the caster stands, no status the def lists refuses it, it is not already casting, the slot is
 * ready, and the target is valid. Accepting spends the cooldown at once (flat: buffs never touch it) and starts the cast; a
 * cast with no telegraph lands in this same tick's `updateAbilities`.
 */
export const handleCast: ActionHandler = (world, c, cmd) => {
  if (cmd.kind !== "cast" || c.kind !== "player") return;
  // The ack of a predicted displacing cast, refused or not (D17).
  if (cmd.seq !== undefined) c.s.moveSeq = cmd.seq;
  const slotted = abilityInSlot(c.s, cmd.slot);
  if (!slotted || world.state.phase !== "active" || !standing(c)) return;
  const { def, rank } = slotted;
  const r = rankOf(def, rank);
  const now = world.state.serverTime;
  // Aimed at the world as it was before the teleport (the client had not seen it yet): refused, for free, so it cannot spend a Wish.
  if (now - (world.abilities?.teleportedAt ?? -Infinity) < CAST_TELEPORT_GRACE_MS) return;
  if (castBlocked(world, c, def.blockedBy) || c.rt.cast || now < slotReadyAt(c.s, cmd.slot)) return;

  const point: Vec2 = { x: cmd.x, y: cmd.y };
  const rule = r.targeting;
  let target: Combatant | null = null;
  if (rule.kind === "unit") {
    target = cmd.id === undefined ? null : combatant(world, cmd.id);
    if (!target || !validUnitTarget(world, c, target, rule.range + CAST_RANGE_SLACK, rule.los)) return;
  } else if (rule.kind === "point") {
    const blink = blinkOf(r);
    if (blink && blinkLanding(world.map, world.state.gatesLocked, c.s, point, blink.maxDist, blink.minDist) === null) return;
  }

  const prevReadyAt = slotReadyAt(c.s, cmd.slot);
  const cooldownMs = abilityCooldownMs(def, rank, { training: world.config.training === true, wishCooldownMult: wishCooldownMultOf(c.s) });
  setSlotReadyAt(c.s, cmd.slot, now + cooldownMs);
  // Wishful Thinking shortens this cooldown, never under half of it (G13): it needs to know when the Wish was spent and for how long.
  if (cmd.slot === "wish") cardsOf(c.rt).wishCast = { at: now, cooldownMs };
  const cast: CastRuntime = {
    ability: def.id, rank, slot: cmd.slot, startedAt: now, landsAt: now + r.castMs, target: target ? target.id : null, point,
    landing: null, prevReadyAt, lagMs: Math.min(MAX_REWIND_MS, Math.max(TICK_MS, now - (cmd.t ?? now))),
  };
  c.rt.cast = cast;
  const face = target ? target.s : rule.kind === "point" || rule.kind === "dir" ? point : null;
  if (face && Math.hypot(face.x - c.s.x, face.y - c.s.y) >= 1) c.s.facing = Math.atan2(face.y - c.s.y, face.x - c.s.x);

  // A cast with a telegraph roots, and an own order (the blink) or a lock-dropping one (Swarm) is a move's worth of choice: each is the
  // player's choice over the attack being wound up. No attack starts while casting (weapons.ts); a lock the cast does not drop stays.
  // Only an own order ends the walk too: a walk in hand survives a lock-dropper's cast root and goes on after it (a locked caster
  // has no walk of its own: the lock's chase path goes with the lock).
  if (r.castMs > 0 || def.ownOrder || def.dropsLock) {
    if (!cancelLockedWindup(world, c) && c.rt.weapon.action) {
      cancelAction(world, c);
      emit(world, { type: "fx", fx: { kind: "cancel", id: c.id } });
    }
    if (def.ownOrder || def.dropsLock) dropLock(c);
    if (def.ownOrder) c.rt.path = [];
  }
  if (r.castMs > 0) {
    const at = target ? target.s : rule.kind === "point" ? point : c.s;
    emit(world, {
      type: "fx",
      fx: { kind: "cast", by: c.id, ability: def.id, ms: r.castMs, target: target ? target.id : null, x: at.x, y: at.y },
    });
  }
  reveal(world, c, cast.landsAt + HIDDEN_REVEAL_MS);
  refreshEffects(world, c);
};

function blinkOf(r: AbilityRank): Extract<AbilityEffect, { do: "blink" }> | undefined {
  return r.effects.find((e): e is Extract<AbilityEffect, { do: "blink" }> => e.do === "blink");
}

// ---------------------------------------------------------------------------------------------------------------------
// Interrupts and clearing
// ---------------------------------------------------------------------------------------------------------------------

/** Ends the pending cast: a `castEnd` fx, the slot's cooldown restored if `refund`, the root and the bits gone. */
export function cancelCast(world: World, c: Combatant, reason: CastEndReason, refund: boolean): void {
  const cast = c.rt.cast;
  if (!cast) return;
  emit(world, { type: "fx", fx: { kind: "castEnd", by: c.id, ability: cast.ability, reason } });
  if (refund && c.kind === "player") setSlotReadyAt(c.s, cast.slot, cast.prevReadyAt);
  c.rt.cast = null;
  refreshEffects(world, c);
}

/** Interrupts the pending cast if its def lists `cause` (a Wish: only a stun or a silence; a stagger never wastes one). */
function cancelIf(world: World, c: Combatant, cause: CastCancel): void {
  const cast = c.rt.cast;
  if (cast && ABILITIES[cast.ability].cancelledBy.includes(cause)) cancelCast(world, c, "interrupted", false);
}

/**
 * statusApplied: a stun drops the weapon windup in progress, the bow's draw included (the cooldown stays spent), and a stun, a
 * silence or a root interrupts a cast that lists it.
 */
export function onStatusApplied(world: World, c: Combatant, st: StatusInstance): void {
  if (st.kind === "stun") {
    if (c.rt.weapon.action) cancelAction(world, c);
    cancelIf(world, c, "stun");
  } else if (st.kind === "silence") cancelIf(world, c, "silence");
  else if (st.kind === "root") cancelIf(world, c, "root");
  else if (st.kind === "slowAttack") recomputeMods(world, c); // its removal re-folds in removeStatuses
}

/** attackStarted: a hidden fighter's own attack shows it, from the next tick, until the swing lands or the shot leaves, and a moment more. */
function onAttackStarted(world: World, c: Combatant): void {
  const act = c.rt.weapon.action;
  if (act && c.rt.statuses && c.rt.statuses.length > 0) reveal(world, c, act.landsAt + HIDDEN_REVEAL_MS);
}

/** Ends a field and what it holds in place: a zone's subject stops being zoned, a cloud's owner stops being hidden. */
function endFields(world: World, pred: (f: FieldRuntime) => boolean): void {
  for (const f of removeFieldsWhere(world, pred)) {
    if (f.kind === "zone" && f.subject !== null) {
      const subject = combatant(world, f.subject);
      if (subject) removeStatuses(world, subject, (st) => st.kind === "zoned" && st.fieldId === f.id);
    } else if (f.kind === "cloud") {
      const owner = combatant(world, f.owner.id);
      if (owner) removeStatuses(world, owner, (st) => st.kind === "hidden" && st.source.id === f.owner.id && st.ability === f.ability);
    }
  }
}

/** Last Stand's heal: its share of the hp loss it held up, through the heal funnel without the lockout (anti-heal still cuts it). */
function payDeathFloor(world: World, c: Combatant, st: StatusInstance): void {
  const amount = (st.taken ?? 0) * (st.healShare ?? 0);
  if (amount > 0) heal(world, c, amount, { ignoreLockout: true });
}

/**
 * A fighter left the fight (it died, or left the run: the lifecycle table does not tell them apart). Its pending cast ends
 * (the cooldown stays spent), its statuses go with no heal, the zones and clouds it owns end, and a zone it is the subject of
 * ends with no stun. A Blaze Step trail it left outlives it (D14).
 */
export function clearFighter(world: World, id: string, _cause: "down" | "removed"): void {
  const c = combatant(world, id);
  if (c) {
    cancelCast(world, c, "cancelled", false);
    removeStatuses(world, c, () => true);
  }
  endFields(world, (f) => (f.owner.id === id && f.kind !== "trail") || f.subject === id);
}

/**
 * The arena resets the fight (`teleport`: every cast is cancelled and refunded, and a Last Stand pays what it held up) or the
 * run is over (`runEnd`: nothing is paid and nothing refunded). Every status and every field ends either way.
 */
export function clearAll(world: World, cause: "teleport" | "runEnd"): void {
  const now = world.state.serverTime;
  if (cause === "teleport") abilitiesRt(world).teleportedAt = now;
  for (const c of activeFighters(world)) {
    if (c.rt.cast) cancelCast(world, c, "cancelled", cause === "teleport");
    if (cause === "teleport") {
      for (const st of statusesOf(c)) if (st.kind === "deathFloor" && st.until > now) payDeathFloor(world, c, st);
    }
    removeStatuses(world, c, () => true);
  }
  removeFieldsWhere(world, () => true);
}

// ---------------------------------------------------------------------------------------------------------------------
// The tick phase
// ---------------------------------------------------------------------------------------------------------------------

const NO_FIGHTERS: Combatant[] = [];

/** Fighters with a status or a pending cast: usually none, so the phase costs a scan of the two runtime maps and nothing else. */
function activeFighters(world: World): Combatant[] {
  let out: Combatant[] | null = null;
  for (const rt of world.players.values()) {
    if (rt.cast || (rt.statuses && rt.statuses.length > 0)) {
      const c = combatant(world, rt.id);
      if (c) (out ??= []).push(c);
    }
  }
  for (const rt of world.mobs.values()) {
    if (rt.cast || (rt.statuses && rt.statuses.length > 0)) {
      const c = combatant(world, rt.id);
      if (c) (out ??= []).push(c);
    }
  }
  return out ?? NO_FIGHTERS;
}

/** One cast landing this tick. */
interface Landing {
  c: Combatant;
  cast: CastRuntime;
  def: AbilityDef;
  r: AbilityRank;
  /** The unit target of a `unit` cast. */
  t: Combatant | null;
  /** Where the caster stood when its effects began, and where a blink put it. */
  origin: Vec2;
  to: Vec2 | null;
}

/**
 * The tick's abilities phase (after the inputs, before the target locks, so a fighter that just became untargetable loses its
 * locks in the same tick):
 *   1  expire   statuses and fields past their end; a Last Stand pays its heal, a cloud and its Swarm go together, a zone and
 *               its subject's `zoned` too
 *   2  land     every cast due, together (D8): re-validate all, then the survivors' self effects, then their target effects
 *   3  zones    a subject that is gone ends its zone silently; one that left it ends it and is stunned by the zone's owner
 *   4  bits     the effect bits again for what changes with time alone (a reveal window ending)
 */
export function updateAbilities(world: World): void {
  const fields = world.abilities?.fields;
  const active = activeFighters(world);
  if (active.length === 0 && (!fields || fields.size === 0)) return;
  const now = world.state.serverTime;

  for (const c of active) {
    if (!statusesOf(c).some((st) => st.until <= now)) continue;
    for (const st of removeStatuses(world, c, (s) => s.until <= now)) {
      if (st.kind === "deathFloor") payDeathFloor(world, c, st);
      else if (st.kind === "hidden") endFields(world, (f) => f.kind === "cloud" && f.owner.id === c.id && f.ability === st.ability);
      else if (st.kind === "zoned" && st.fieldId !== undefined) removeField(world, st.fieldId);
    }
  }
  endFields(world, (f) => f.endsAt <= now);

  landCasts(world, active, now);
  endZones(world);

  for (const c of activeFighters(world)) {
    // A chilled bow's draw ends later than it was started with: keep its archer shown until the arrow is away.
    if (c.rt.weapon.action) reveal(world, c, c.rt.weapon.action.landsAt + HIDDEN_REVEAL_MS);
    refreshEffects(world, c);
  }
}

function landCasts(world: World, active: readonly Combatant[], now: number): void {
  const rank = (c: Combatant): number => world.combat.rank.get(c.id) ?? Infinity;
  const due = active
    .filter((c) => c.rt.cast != null && c.rt.cast.landsAt <= now)
    .sort((a, b) => { const ra = rank(a); const rb = rank(b); return ra < rb ? -1 : ra > rb ? 1 : 0; });
  if (due.length === 0) return;

  // Pass 1: every due cast is checked against the state as it stood when the phase began. A cast that fails keeps its cooldown.
  const landing: Landing[] = [];
  for (const c of due) {
    const cast = c.rt.cast!;
    const def = ABILITIES[cast.ability];
    const r = rankOf(def, cast.rank);
    let t: Combatant | null = null;
    let ok = standing(c) && !castBlocked(world, c, def.blockedBy);
    if (ok && r.targeting.kind === "unit") {
      t = cast.target === null ? null : combatant(world, cast.target);
      ok = t !== null && validUnitTarget(world, c, t, r.targeting.range + CAST_RANGE_SLACK, r.targeting.los);
    }
    const blink = ok ? blinkOf(r) : undefined;
    if (blink) {
      cast.landing = blinkLanding(world.map, world.state.gatesLocked, c.s, cast.point, blink.maxDist, blink.minDist);
      ok = cast.landing !== null;
    }
    if (!ok) {
      cancelCast(world, c, "fizzle", false);
      continue;
    }
    landing.push({ c, cast, def, r, t, origin: { x: c.s.x, y: c.s.y }, to: null });
  }
  // The casts that survive are done casting before any effect applies, so a stun another cast lands in this same tick cannot
  // interrupt what lands with it.
  for (const l of landing) {
    l.c.rt.cast = null;
    refreshEffects(world, l.c);
  }
  // Pass 2: the self effects of every cast, then the target effects of every cast.
  for (const side of ["self", "target"] as const) {
    for (const l of landing) {
      for (const e of l.r.effects) if (effectSide(e) === side) applyEffect(world, l, e, now);
    }
  }
  for (const l of landing) {
    const at = l.to ? l.origin : l.t ? l.t.s : l.c.s;
    emit(world, {
      type: "fx",
      fx: {
        kind: "castLand", by: l.c.id, ability: l.def.id, target: l.to ? null : l.t ? l.t.id : null, x: at.x, y: at.y,
        ...(l.to ? { x2: l.to.x, y2: l.to.y } : {}),
      },
    });
  }
}

/** What one effect of a landing cast does. Closed: a new `AbilityEffect` member is a compile error here. */
function applyEffect(world: World, l: Landing, e: AbilityEffect, now: number): void {
  const { c, def } = l;
  const source = sourceOf(c);
  switch (e.do) {
    case "status": {
      const who = e.to === "self" ? c : l.t;
      if (who) addStatus(world, who, { kind: e.status, source, ability: def.id, ms: e.ms, value: e.value });
      return;
    }
    case "cleanse": {
      const who = e.to === "self" ? c : l.t;
      if (who) cleanse(world, who, e.classes);
      return;
    }
    case "deathFloor": {
      const st = addStatus(world, c, { kind: "deathFloor", source, ability: def.id, ms: e.ms, data: { floorHp: e.floorHp, healShare: e.healBack } });
      // A fresh floor starts counting from nothing; a re-application of one still up keeps what it has held.
      if (st && (st.startedAt === now || st.taken === undefined)) st.taken = 0;
      return;
    }
    case "zone": {
      const t = l.t;
      if (!t) return;
      const f = addField(world, {
        kind: "zone", ability: def.id, owner: source, subject: t.id, x: t.s.x, y: t.s.y, x2: 0, y2: 0, r: e.radius, vx: 0, vy: 0,
        startedAt: now, endsAt: now + e.ms,
      });
      const st = addStatus(world, t, {
        // `value` is its outgoing multiplier: zoned combines by product, so statusValue(zoned) is what the subject deals now.
        kind: "zoned", source, ability: def.id, ms: e.ms, value: e.dealtMult,
        data: { fieldId: f.id, dealtMult: e.dealtMult, takenFromSourceMult: e.takenFromCasterMult },
      });
      if (!st) removeField(world, f.id);
      return;
    }
    case "cloud":
      // A new cloud replaces the caster's old one of the same ability (training's short cooldown can cast again while it is up). The
      // old one goes without taking the Swarm with it: the status this cast just extended is the new cloud's.
      removeFieldsWhere(world, (f) => f.kind === "cloud" && f.owner.id === c.id && f.ability === def.id);
      // The cloud follows its owner on the clients (they draw it at the owner's drawn position), so the server never moves it.
      addField(world, {
        kind: "cloud", ability: def.id, owner: source, subject: null, x: c.s.x, y: c.s.y, x2: 0, y2: 0, r: e.radius, vx: 0, vy: 0,
        startedAt: now, endsAt: now + e.ms,
      });
      return;
    case "blink":
      if (l.cast.landing) {
        l.to = l.cast.landing;
        displace(world, c, l.to);
      }
      return;
    case "trail":
      if (l.to) {
        addField(world, {
          kind: "trail", ability: def.id, owner: source, subject: null, x: l.origin.x, y: l.origin.y, x2: l.to.x, y2: l.to.y, r: e.halfWidth,
          vx: 0, vy: 0, startedAt: now, endsAt: now + e.ms,
        });
      }
      return;
    default: {
      const unknown: never = e;
      void unknown;
    }
  }
}

/** Step 3: a Trial's zone ends when its subject is gone (silently) or has walked, or blinked, out of it (stunned by the zone's owner). */
function endZones(world: World): void {
  const zones: FieldRuntime[] = [];
  for (const f of fieldsOf(world).values()) if (f.kind === "zone") zones.push(f);
  for (const f of zones) {
    const subject = f.subject === null ? null : combatant(world, f.subject);
    if (!subject || !standing(subject) || isEvading(subject)) {
      endFields(world, (g) => g.id === f.id);
      continue;
    }
    if (Math.hypot(subject.s.x - f.x, subject.s.y - f.y) <= f.r) continue;
    endFields(world, (g) => g.id === f.id);
    const exit = effectOf(f.ability, "zone");
    if (exit) addStatus(world, subject, { kind: "stun", source: f.owner, ability: f.ability, ms: exit.exitStunMs });
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Damage over time
// ---------------------------------------------------------------------------------------------------------------------

/**
 * beforeDamage: (a) a Blaze Step trail ignites every standing fighter on it but its owner (a burn status from the owner: it lasts
 * its `dotMs` after the last contact), then (b) every active `dot` status records its tick through the ledger as true damage
 * from its source, with no weapon: kill credit, the bounty and lifesteal work as for any hit. This is the generic ticker: a
 * later phase's on-hit burns ride it with no code of their own.
 */
export function statusDamage(world: World, dtMs: number): void {
  const now = world.state.serverTime;
  const trails: FieldRuntime[] = [];
  for (const f of fieldsOf(world).values()) if (f.kind === "trail") trails.push(f);
  if (trails.length > 0) {
    for (const t of standingCombatants(world)) {
      if (isEvading(t) || (t.kind === "player" && now < t.s.immuneUntil)) continue;
      for (const f of trails) {
        if (t.id === f.owner.id || !onTrail(f, t.s)) continue;
        const burn = effectOf(f.ability, "trail");
        if (!burn) continue;
        const quiet = statusesOf(t).some((st) => st.kind === "dot" && st.source.id === f.owner.id && st.ability === f.ability && st.until > now);
        addStatus(world, t, { kind: "dot", source: f.owner, ability: f.ability, ms: burn.dotMs, value: burn.dps, data: { shares: TRUE_SHARES } }, { quiet });
      }
    }
  }
  for (const c of activeFighters(world)) {
    if (!standing(c) || isEvading(c)) continue;
    for (const st of statusesOf(c)) {
      if (st.kind !== "dot" || st.until <= now) continue;
      const raw = (st.value * dtMs) / 1000;
      // A card's damage over time (a bleed, Festering Arcana's tail) is its owner's: Boom's x1.25 and Slow Burn's x0.7 multiply it as they do a
      // signature's (G1's `own` counts that mult, so it is in the packet and not in `mult`), and it can critically strike (Cruel Wounds); a Wish's is flat.
      const owner = st.ability === undefined && st.source.id !== c.id ? combatant(world, st.source.id) : null;
      const base = owner ? raw * dotMultOf(owner.s) : raw;
      const crit = owner !== null && rollDotCrit(world, owner);
      recordHit(world, {
        victim: c.id, by: st.source,
        packet: { raw: crit ? base * CRIT_MULT : base, ...(st.shares ?? TRUE_SHARES), ...(crit ? { crit: true, mult: CRIT_MULT } : {}) },
        weapon: null, ...(st.ability !== undefined ? { ability: st.ability } : {}), dot: true, stagger: false,
      });
    }
  }
}

/** systems: the damage of ability burns that landed, reported as one `hit` fx per victim and source every DOT_FX_MS. */
export function abilityDotFx(world: World): void {
  const now = world.state.serverTime;
  let a = world.abilities;
  for (const h of world.combat.landed) {
    if (!h.dot || h.ability === undefined) continue;
    a ??= abilitiesRt(world);
    const key = `${h.victim}|${h.by}|${h.ability}`;
    const acc = a.dot.get(key);
    if (acc) acc.amount += h.amount;
    else a.dot.set(key, { victim: h.victim, by: h.by, ability: h.ability, amount: h.amount });
  }
  if (!a || now - a.dotSince < DOT_FX_MS) return;
  flushAbilityDot(world);
}

/** The ability damage over time landed since the last report, one `hit` fx per pair; also when the run ends (its last chunk). */
function flushAbilityDot(world: World): void {
  const a = world.abilities;
  if (!a) return;
  for (const d of a.dot.values()) {
    emit(world, { type: "fx", fx: { kind: "hit", id: d.victim, by: d.by, amount: d.amount, weapon: null, ability: d.ability } });
  }
  a.dot.clear();
  a.dotSince = world.state.serverTime;
}
