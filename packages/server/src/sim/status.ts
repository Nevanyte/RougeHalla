// Timed statuses on players and mobs (stun, root, silence, slows, anti-heal, damage over time, invulnerability,
// untargetability, hiding, Trial's zone, Last Stand's death floor, haste). ONE runtime, data-driven by STATUS_RULES
// (shared/status.ts): the caps, the stacking and the cleanse class live there and nowhere else.
//
// An instance is identified by (kind, source id, ability ?? tag ?? ""): applying it again extends it, never doubles it.
// Across instances a kind combines by its rule (any, sum, max, product).
//
// The table is FROZEN while the ledger pass runs (world.combat.collecting): addStatus, removeStatuses and cleanse called
// then are queued with payLater and run once every victim has taken their damage, so every reader inside the pass
// (damageFactor, floorHp, immunity) sees one consistent table and nothing depends on the order victims are processed in.
//
// A LEAF module: it imports only shared, buffs, combatant and world. What a status DOES to casts, windups and fields is
// done by sim/abilities.ts, which is told through the `statusApplied` hook. Expiry (removing an instance whose `until` has
// passed) is that module's job too; every reader here ignores an instance past its `until`, so nothing depends on when.
import {
  EFFECT_CASTING, hasteMultiplier, SIG_CHILLED, STATUS_RULES, TICK_MS, type AbilityId, type CleanseClass,
  type StatusKind,
} from "@raid/shared";
import { moveSpeedMult } from "./buffs";
import { isQuestGiver, standing, type Combatant } from "./combatant";
import { recomputeMods } from "./mods";
import { emit, payLater, type DamageSource, type StatusInstance, type World } from "./world";

export interface StatusApply {
  kind: StatusKind;
  source: DamageSource;
  ms: number;
  ability?: AbilityId;
  tag?: string;
  /** The magnitude (default 0). */
  value?: number;
  /**
   * Accumulate into the same instance: value = min(cap, value + per). A fresh instance starts from `value ?? 0` and adds
   * `per` once (so a first on-hit stack is already `per`).
   */
  add?: { per: number; cap: number };
  data?: Pick<StatusInstance, "revealUntil" | "fieldId" | "dealtMult" | "takenFromSourceMult" | "floorHp" | "healShare" | "shares">;
}

const NONE: readonly StatusInstance[] = [];

export function statusesOf(c: Combatant): readonly StatusInstance[] {
  return c.rt.statuses ?? NONE;
}

function statusesById(world: World, id: string): readonly StatusInstance[] {
  return (world.players.get(id) ?? world.mobs.get(id))?.statuses ?? NONE;
}

const keyOf = (st: { ability?: AbilityId; tag?: string }): string => st.ability ?? st.tag ?? "";

/**
 * Applies a status (D21). Instance key = (kind, source.id, ability ?? tag ?? ""). A re-application extends `until` to the
 * later time; `value` takes the larger, or accumulates with `add`; `data` is replaced. `until` is at most now + the kind's
 * maxMs. Refused (null): a playersOnly kind on a mob; anything on a quest giver or a fighter not standing; no time. While the ledger
 * pass runs it is queued with payLater and returns null (D20). A fresh instance emits `status` (unless `quiet`).
 * invulnerable raises immuneUntil (D23). Refreshes the bits, then calls world.hooks.statusApplied(world, c, inst, fresh).
 */
export function addStatus(world: World, c: Combatant, a: StatusApply, opts?: { quiet?: boolean }): StatusInstance | null {
  const rule = STATUS_RULES[a.kind];
  if (rule.playersOnly && c.kind !== "player") return null;
  if (isQuestGiver(c) || !standing(c) || !(a.ms > 0)) return null;
  if (world.combat.collecting) {
    payLater(world, () => { addStatus(world, c, a, opts); });
    return null;
  }
  const now = world.state.serverTime;
  const list = (c.rt.statuses ??= []);
  const key = keyOf(a);
  let inst = list.find((st) => st.kind === a.kind && st.source.id === a.source.id && keyOf(st) === key);
  // An instance past its `until` that expiry has not removed yet is a stale one: this is a new application.
  const fresh = inst === undefined || inst.until <= now;
  const base = a.value ?? 0;
  if (inst === undefined) {
    inst = { kind: a.kind, source: a.source, startedAt: now, until: 0, value: 0 };
    if (a.ability !== undefined) inst.ability = a.ability;
    if (a.tag !== undefined) inst.tag = a.tag;
    list.push(inst);
  }
  if (fresh) {
    inst.startedAt = now;
    inst.until = now + Math.min(a.ms, rule.maxMs);
    inst.value = a.add ? Math.min(a.add.cap, base + a.add.per) : base;
    inst.source = a.source;
    delete inst.revealFrom;
    delete inst.revealUntil;
  } else {
    inst.until = Math.min(Math.max(inst.until, now + a.ms), now + rule.maxMs);
    inst.value = a.add ? Math.min(a.add.cap, inst.value + a.add.per) : Math.max(inst.value, base);
  }
  if (a.data) Object.assign(inst, a.data);
  if (a.kind === "invulnerable" && c.kind === "player") c.s.immuneUntil = Math.max(c.s.immuneUntil, inst.until);
  refreshEffects(world, c);
  if (fresh && !opts?.quiet) {
    emit(world, { type: "fx", fx: { kind: "status", id: c.id, status: a.kind, ms: inst.until - now, by: a.source.id || null } });
  }
  world.hooks.statusApplied?.(world, c, inst, fresh);
  return inst;
}

/** Removes the matching instances, with no side effects (the caller pays a heal or ends a field), and refreshes the bits. Deferred in a pass. */
export function removeStatuses(world: World, c: Combatant, pred: (st: StatusInstance) => boolean): StatusInstance[] {
  if (world.combat.collecting) {
    payLater(world, () => { removeStatuses(world, c, pred); });
    return [];
  }
  const list = c.rt.statuses;
  if (!list || list.length === 0) return [];
  const removed: StatusInstance[] = [];
  const kept: StatusInstance[] = [];
  for (const st of list) (pred(st) ? removed : kept).push(st);
  if (removed.length === 0) return removed;
  c.rt.statuses = kept;
  refreshEffects(world, c);
  // An attack slow is a stat-mirror source: its removal (a cleanse, an expiry, the teleport's clear) re-folds the mirror at once, so
  // this tick's weapons never read a slow that is gone. (An application does it through the statusApplied hook.)
  if (removed.some((st) => st.kind === "slowAttack")) recomputeMods(world, c);
  return removed;
}

/** Removes every instance whose kind's cleanse class is in `classes` ("never" ones never); deferred in a pass. */
export function cleanse(world: World, c: Combatant, classes: readonly CleanseClass[]): StatusInstance[] {
  return removeStatuses(world, c, (st) => {
    const cls = STATUS_RULES[st.kind].cleanse;
    return cls !== "never" && classes.includes(cls);
  });
}

/** The first instance of a kind (of one source, if given), active or not yet expired away: updateAbilities removes the stale ones first thing each tick. */
export function findStatus(c: Combatant, kind: StatusKind, sourceId?: string): StatusInstance | undefined {
  const list = c.rt.statuses;
  if (!list) return undefined;
  return list.find((st) => st.kind === kind && (sourceId === undefined || st.source.id === sourceId));
}

/** The kind's combined value over active instances (until > now), by STATUS_RULES combine and cap ("any": 1 or 0; a product of nothing is 1). */
export function statusValue(world: World, c: Combatant, kind: StatusKind): number {
  return valueOf(world, c.rt.statuses ?? NONE, kind);
}

function valueOf(world: World, list: readonly StatusInstance[], kind: StatusKind): number {
  if (list.length === 0) return STATUS_RULES[kind].combine === "product" ? 1 : 0;
  const now = world.state.serverTime;
  const rule = STATUS_RULES[kind];
  let any = false;
  let v = rule.combine === "product" ? 1 : 0;
  for (const st of list) {
    if (st.kind !== kind || st.until <= now) continue;
    any = true;
    if (rule.combine === "sum") v += st.value;
    else if (rule.combine === "max") v = Math.max(v, st.value);
    else if (rule.combine === "product") v *= st.value;
  }
  if (rule.combine === "any") return any ? 1 : 0;
  return rule.cap !== undefined ? Math.min(v, rule.cap) : v;
}

function has(world: World, c: Combatant, kind: StatusKind): boolean {
  const list = c.rt.statuses;
  if (!list || list.length === 0) return false;
  const now = world.state.serverTime;
  for (const st of list) if (st.kind === kind && st.until > now) return true;
  return false;
}

export function isStunned(world: World, c: Combatant): boolean {
  return has(world, c, "stun");
}

export function isRooted(world: World, c: Combatant): boolean {
  return has(world, c, "root");
}

export function isSilenced(world: World, c: Combatant): boolean {
  return has(world, c, "silence");
}

/** A slowMove status, or Frost's chill (SIG_CHILLED): R0's `vs slowed`. */
export function isSlowed(world: World, c: Combatant): boolean {
  return has(world, c, "slowMove") || (c.s.sig & SIG_CHILLED) !== 0;
}

/** A hidden instance's own attack or cast has it shown right now: inside [revealFrom, revealUntil). */
const revealedAt = (st: StatusInstance, now: number): boolean => now >= (st.revealFrom ?? 0) && now < (st.revealUntil ?? 0);

function hiddenNow(world: World, list: readonly StatusInstance[]): boolean {
  if (list.length === 0) return false;
  const now = world.state.serverTime;
  for (const st of list) if (st.kind === "hidden" && st.until > now && !revealedAt(st, now)) return true;
  return false;
}

function untargetableNow(world: World, list: readonly StatusInstance[]): boolean {
  if (list.length === 0) return false;
  const now = world.state.serverTime;
  for (const st of list) if (st.kind === "untargetable" && st.until > now) return true;
  return hiddenNow(world, list);
}

/** untargetable, or hidden outside its reveal window: nobody can lock or ability-target it. */
export function isUntargetable(world: World, c: Combatant): boolean {
  return untargetableNow(world, c.rt.statuses ?? NONE);
}

export function isUntargetableId(world: World, id: string): boolean {
  return untargetableNow(world, statusesById(world, id));
}

/** hidden, active, and not revealed by its own attack or cast just now. */
export function isHidden(world: World, c: Combatant): boolean {
  return hiddenNow(world, c.rt.statuses ?? NONE);
}

/** A cast with a telegraph (castMs > 0) is pending: it roots. One with none lands in the tick it is cast and never blocks what is queued after it. */
export function isCasting(c: Combatant): boolean {
  const cast = c.rt.cast;
  return cast != null && cast.landsAt > cast.startedAt;
}

/** stunned || rooted || casting. */
export function cannotMove(world: World, c: Combatant): boolean {
  return isStunned(world, c) || isRooted(world, c) || isCasting(c);
}

/** stunned || casting: no attack start, swap or pickup. */
export function actionBlocked(world: World, c: Combatant): boolean {
  return isStunned(world, c) || isCasting(c);
}

export function castBlocked(world: World, c: Combatant, blockedBy: readonly ("stun" | "silence" | "root")[]): boolean {
  for (const b of blockedBy) {
    if (b === "stun" ? isStunned(world, c) : b === "silence" ? isSilenced(world, c) : isRooted(world, c)) return true;
  }
  return false;
}

/**
 * A hidden fighter's own attack or cast reveals it until `until` (it only ever raises). A reveal takes effect from the NEXT tick, so
 * what another fighter reads in this one (a lock, a re-aimed shot, an ability target) is the tick-start state whatever order the
 * attacks started in: a window that is running or pending only grows, one that is over starts a tick from now. Refreshes the bits.
 */
export function reveal(world: World, c: Combatant, until: number): void {
  const now = world.state.serverTime;
  let changed = false;
  for (const st of c.rt.statuses ?? NONE) {
    if (st.kind !== "hidden" || !(until > (st.revealUntil ?? 0))) continue;
    if ((st.revealUntil ?? 0) <= now) st.revealFrom = now + TICK_MS;
    st.revealUntil = until;
    changed = true;
  }
  if (changed) refreshEffects(world, c);
}

/**
 * applyVictim's multiplier (D9): 1 fast when neither fighter has statuses. The subject of a zone deals its dealtMult to
 * anyone, and takes takenFromSourceMult from the zone's caster only; several zones multiply.
 */
export function damageFactor(world: World, attackerId: string, victimId: string): number {
  const a = statusesById(world, attackerId);
  const v = statusesById(world, victimId);
  if (a.length === 0 && v.length === 0) return 1;
  const now = world.state.serverTime;
  let f = 1;
  for (const st of a) if (st.kind === "zoned" && st.until > now) f *= st.dealtMult ?? 1;
  for (const st of v) if (st.kind === "zoned" && st.until > now && st.source.id === attackerId) f *= st.takenFromSourceMult ?? 1;
  return f;
}

/**
 * applyHits' hp after `total` lands at `before`: held at min(floorHp, before) by a deathFloor, which adds `total` to `taken`
 * whether or not the floor had to hold (D3: the overkill it prevented counts).
 */
export function floorHp(world: World, id: string, before: number, total: number): number {
  const after = Math.max(0, before - total);
  const list = world.players.get(id)?.statuses;
  if (!list || list.length === 0) return after;
  const now = world.state.serverTime;
  for (const st of list) {
    if (st.kind !== "deathFloor" || st.until <= now) continue;
    st.taken = (st.taken ?? 0) + total;
    return Math.max(after, Math.min(st.floorHp ?? 1, before));
  }
  return after;
}

/** 1 − antiHeal (capped): heal() multiplies every heal by it (lifesteal included). */
export function healFactor(world: World, c: Combatant): number {
  return 1 - statusValue(world, c, "antiHeal");
}

/** 1 − slowAttack (capped). Not applied here: sim/abilities.ts registers it as a mod source, so the asMult mirror folds it in (D22). */
export function attackSlowFactor(world: World, c: Combatant): number {
  return 1 - statusValue(world, c, "slowAttack");
}

/**
 * world.moveModifiers entry: 0 if cannotMove; else (1 − slowMove) × hasteMultiplier(moveSpeedMult(world, c), haste). The
 * buffs' own modifier multiplies in too, so haste ends up ADDING value × PLAYER_SPEED to the stacks' speed (D12), not
 * multiplying it. If R0's speedMult mirror later folds slows and haste in, this keeps only the 0 (one source of truth).
 * The product of ALL move modifiers (this one, chill, buffs, bog) is floored at MOVE_MULT_FLOOR (0.35) in step.ts, so a
 * slow at its 0.6 cap (x0.4) together with chill (x0.7) walks at 0.35, not 0.28; only this function's 0 passes through.
 */
export function statusMoveMultiplier(world: World, c: Combatant): number {
  const list = c.rt.statuses;
  if ((!list || list.length === 0) && !c.rt.cast) return 1;
  if (cannotMove(world, c)) return 0;
  const slow = valueOf(world, list ?? NONE, "slowMove");
  const haste = valueOf(world, list ?? NONE, "haste");
  if (slow === 0 && haste === 0) return 1;
  return (1 - slow) * (haste > 0 ? hasteMultiplier(moveSpeedMult(world, c), haste) : 1);
}

/**
 * The `effects` bits of the active kinds (hidden only outside its reveal window), plus CASTING while a cast with a telegraph
 * (castMs > 0) is pending.
 */
export function effectsOf(world: World, c: Combatant): number {
  let bits = 0;
  const list = c.rt.statuses;
  if (list && list.length > 0) {
    const now = world.state.serverTime;
    for (const st of list) {
      if (st.until <= now) continue;
      if (st.kind === "hidden" && revealedAt(st, now)) continue;
      bits |= STATUS_RULES[st.kind].bit;
    }
  }
  const cast = c.rt.cast;
  if (cast && cast.landsAt > cast.startedAt) bits |= EFFECT_CASTING;
  return bits;
}

/** Writes `effects` only on a change (a synced field: an equal write costs nothing, but a skipped one is cheaper still). */
export function refreshEffects(world: World, c: Combatant): void {
  const bits = effectsOf(world, c);
  if (c.s.effects !== bits) c.s.effects = bits;
}
