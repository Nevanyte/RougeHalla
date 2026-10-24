// Faction signatures in real time (GAME_DESIGN 8.3, 10.3; testing/COUNTER_REVIEW.md section 5, whose 20 Hz model is
// testing/realtime.py). The formulas are in @raid/shared signatures.ts; this module decides who they act on and when.
//
// Targets. Every fighter (player or mob) has at most one target: the last enemy it hit. A fighter with no target takes
// whoever hits it as its target, so both sides' signatures start at the pair's first contact, whoever swung first. A
// target is forgotten after TARGET_FORGET_SECONDS without contact (in reach, or a hit either way), once it is no longer
// standing, and at the coliseum teleport.
//
// Reach and engagement. The target is in reach while within engageRange(the weapon in hand) of the fighter with a clear
// line of sight (present positions, collisionMap). Engaged = in reach, or in reach within the last
// ENGAGE_LINGER_SECONDS. While engaged, a fighter's signature acts on its target:
//   Fire       burn every tick, and backlash on each attack the target performs (backlashPerSwing of that weapon)
//   Plague     disease and execute every tick (the execute reads the target's hp fraction at the start of the tick)
//   Sentenced  the mark every tick at markDps(elapsed): `elapsed` counts the time the target spent in reach, so it
//              freezes while the target hides; a new target or a weapon swap by the target restarts it
//   Frost      chills everyone engaged with it either way: its own target, and whoever has it as an engaged target
//   Holy       heals lifestealFraction(own hp fraction at the start of the tick) of all the damage it lands, on
//              anyone, with no lockout (it needs no engagement)
// Every bonus is raw damage x bonusMultiplier(the owner's weapon in hand), mitigated with the owner's damage shares. It
// joins this tick's ledger (beforeDamage), so it lands at the same moment as the tick's hits and no order decides.
//
// The chill. A chilled fighter's cooldown (readyAt), bow draw and ranged recovery advance at chillMultiplier x real
// time, re-decided every tick (stretchUntil), so nothing is snapshotted at swing time. An attack started this tick from
// a carried remainder had part of that remainder under the chill too, and is corrected for it. Within
// CHILL_MOVE_RADIUS of a Frost that chills it, the fighter also moves at that multiplier. Several Frosts don't stack.
//
// In the tick: afterWeapons (note this tick's attacks) → movement (the chill's slow) → ... → beforeDamage (contacts from
// this tick's hits, reach, signature damage into the ledger) → ledger → systems (lifesteal, the chill for the coming
// tick, visuals, damage-over-time fx).
import {
  backlashPerSwing, bonusMultiplier, burnDps, CHILL_MOVE_RADIUS, chillMultiplier, damageShares, diseaseDps, DOT_FX_MS,
  ENGAGE_LINGER_SECONDS, engageRange, HEAL_LOCKOUT_SECONDS, hasLineOfSight, isDot, lifestealFraction, markDps,
  markShare, SIG_BURNING, SIG_CHILLED, SIG_DISEASED, SIG_EXECUTE, TARGET_FORGET_SECONDS, type FactionSpec,
  type SignatureKind, type WeaponId,
} from "@raid/shared";
import { activeWeapon, allCombatants, combatant, factionOf, standing, standingCombatants, type Combatant } from "./combatant";
import { recordHit } from "./ledger";
import { chainHook, collisionMap, emit, type PendingAction, type World } from "./world";

/** One fighter's signature state. Times are server ms. */
export interface SigFighter {
  target: string | null;
  /** This tick: the target is within reach with a clear line. */
  inReach: boolean;
  /** This tick: in reach, or lingering. */
  engaged: boolean;
  /** When the target was last in reach (-Infinity: not yet). */
  reachAt: number;
  /** Last contact with the target: in reach, or a hit between them either way. */
  contactAt: number;
  /** Seconds the target has spent in reach since the mark (re)started. */
  markElapsed: number;
  /** hp / maxHp when this tick's damage phase began. */
  hpFrac: number;
  /** Last time this fighter dealt or took damage, or was engaged either way (the heal lockout). */
  combatAt: number;
  /** Cooldown-progress multiplier for the coming tick (1: not chilled), and the Frosts behind it. */
  chill: number;
  chillers: string[];
  /** The weapon action at the end of the last tick, to spot one started this tick. */
  seenAction: PendingAction | null;
}

export interface FactionsRuntime {
  fighters: Map<string, SigFighter>;
  /** This tick's attacks: swings landing, balls leaving, arrows loosed. */
  attacks: Array<{ by: string; weapon: WeaponId }>;
  /** Damage over time landed since `dotSince`, reported together every DOT_FX_MS. */
  dot: Map<string, { victim: string; by: string; sig: SignatureKind; weapon: WeaponId; amount: number }>;
  dotSince: number;
}

export function install(world: World): void {
  world.factions = newRuntime();
  world.afterWeapons.push(noteAttacks);
  world.beforeDamage.push(signatureDamage);
  world.systems.push(afterDamage);
  world.moveModifiers.push(chillMoveMultiplier);
  const swapped = world.hooks.weaponSwapped;
  world.hooks.weaponSwapped = (w, c) => {
    swapped?.(w, c);
    onWeaponSwapped(w, c);
  };
  // A fresh fight in the coliseum: nobody carries a target, a mark or a chill through the teleport.
  chainHook(world, "teleported", (w) => resetAll(w));
  chainHook(world, "raidStarted", (w) => resetAll(w));
}

function newRuntime(): FactionsRuntime {
  return { fighters: new Map(), attacks: [], dot: new Map(), dotSince: 0 };
}

function newFighter(): SigFighter {
  return {
    target: null, inReach: false, engaged: false, reachAt: -Infinity, contactAt: -Infinity, markElapsed: 0, hpFrac: 1,
    combatAt: -Infinity, chill: 1, chillers: [], seenAction: null,
  };
}

function rtOf(world: World): FactionsRuntime {
  return world.factions ??= newRuntime();
}

function sigOf(world: World, id: string): SigFighter {
  const fighters = rtOf(world).fighters;
  let f = fighters.get(id);
  if (!f) fighters.set(id, f = newFighter());
  return f;
}

function resetAll(world: World): void {
  const rt = rtOf(world);
  rt.fighters.clear();
  rt.attacks = [];
  rt.dot.clear();
  rt.dotSince = world.state.serverTime;
}

/** `f` now has `id` as its target: everything about the previous one (reach, linger, the mark) starts over. */
function setTarget(f: SigFighter, id: string, now: number): void {
  f.target = id;
  f.inReach = false;
  f.engaged = false;
  f.reachAt = -Infinity;
  f.contactAt = now;
  f.markElapsed = 0;
}

function clearTarget(f: SigFighter): void {
  f.target = null;
  f.inReach = false;
  f.engaged = false;
  f.reachAt = -Infinity;
  f.markElapsed = 0;
}

/** `attacker` hit `victim`: the attacker's target becomes the victim, and a victim with no target answers. */
function noteHit(world: World, attacker: string, victim: string, now: number): void {
  const fa = sigOf(world, attacker);
  if (fa.target !== victim) setTarget(fa, victim, now);
  fa.contactAt = now;
  const fv = sigOf(world, victim);
  if (fv.target === null) setTarget(fv, attacker, now);
  if (fv.target === attacker) fv.contactAt = now;
}

/**
 * Starts the pair's contact now, as if they had just hit each other (each targets the other). For harnesses and tests
 * that open a duel in contact from the first tick, as realtime.py does.
 */
export function noteContact(world: World, a: string, b: string): void {
  const now = world.state.serverTime;
  noteHit(world, a, b, now);
  noteHit(world, b, a, now);
}

export function targetOf(world: World, id: string): string | null {
  return world.factions?.fighters.get(id)?.target ?? null;
}

/** The fighter's signature state, or undefined before it has any (tests, the harness and Phase 11 AI read it). */
export function signatureState(world: World, id: string): Readonly<SigFighter> | undefined {
  return world.factions?.fighters.get(id);
}

/** afterWeapons: the attacks performed this tick, before the melee and spawn phases consume them. */
function noteAttacks(world: World): void {
  const rt = rtOf(world);
  rt.attacks = [];
  for (const m of world.combat.melee) rt.attacks.push({ by: m.attacker, weapon: m.weapon });
  for (const s of world.combat.spawns) rt.attacks.push({ by: s.owner, weapon: s.weapon });
}

function immune(world: World, c: Combatant): boolean {
  return c.kind === "player" && world.state.serverTime < c.s.immuneUntil;
}

/** beforeDamage: contacts from this tick's hits, reach and engagement, then the signature damage of the tick. */
function signatureDamage(world: World, dtMs: number): void {
  const rt = rtOf(world);
  const now = world.state.serverTime;
  const dt = dtMs / 1000;
  const fighters = standingCombatants(world);
  const byId = new Map(fighters.map((c) => [c.id, c]));
  for (const id of [...rt.fighters.keys()]) if (!byId.has(id)) rt.fighters.delete(id);
  for (const c of fighters) {
    const f = sigOf(world, c.id);
    f.hpFrac = c.s.maxHp > 0 ? c.s.hp / c.s.maxHp : 0;
    if (f.target !== null && !byId.has(f.target)) clearTarget(f);
  }

  for (const e of world.combat.ledger) {
    if (e.sig || !(e.packet.raw * e.scale > 0) || e.by.id === e.victim) continue;
    const victim = byId.get(e.victim);
    if (!victim || !byId.has(e.by.id) || immune(world, victim)) continue;
    noteHit(world, e.by.id, e.victim, now);
  }

  const map = collisionMap(world);
  const lingerMs = ENGAGE_LINGER_SECONDS * 1000;
  for (const c of fighters) {
    const f = sigOf(world, c.id);
    const t = f.target !== null ? byId.get(f.target) : undefined;
    if (!t) continue;
    const d = Math.hypot(t.s.x - c.s.x, t.s.y - c.s.y);
    f.inReach = d <= engageRange(activeWeapon(c.s)) && hasLineOfSight(map, c.s, t.s);
    if (f.inReach) f.reachAt = f.contactAt = now;
    if (now - f.contactAt >= TARGET_FORGET_SECONDS * 1000) {
      clearTarget(f);
      continue;
    }
    f.engaged = now - f.reachAt <= lingerMs + 1e-6;
    if (f.engaged) f.combatAt = sigOf(world, t.id).combatAt = now;
  }

  for (const c of fighters) {
    const f = sigOf(world, c.id);
    const spec = factionOf(c.s);
    const weapon = activeWeapon(c.s);
    const t = f.engaged && f.target !== null ? byId.get(f.target) : undefined;
    if (spec && weapon && t) {
      const bm = bonusMultiplier(weapon);
      const foeFrac = sigOf(world, t.id).hpFrac;
      bonus(world, c, spec, weapon, t, "burn", burnDps(spec) * bm * dt);
      bonus(world, c, spec, weapon, t, "disease", diseaseDps(spec, foeFrac) * bm * dt);
      bonus(world, c, spec, weapon, t, "mark", markDps(spec, f.markElapsed) * bm * dt);
      const foe = factionOf(t.s);
      if (spec.mechanic === "dragonslayer" && foe) {
        for (const a of rt.attacks) {
          if (a.by === t.id) bonus(world, c, spec, weapon, t, "backlash", backlashPerSwing(spec.params.backlash!, foe, a.weapon) * bm);
        }
      }
    }
    if (f.inReach) f.markElapsed += dt;
  }
}

function bonus(
  world: World, c: Combatant, spec: FactionSpec, weapon: WeaponId, t: Combatant, sig: SignatureKind, raw: number,
): void {
  if (!(raw > 0)) return;
  recordHit(world, {
    victim: t.id, by: { id: c.id, name: c.s.name }, packet: { raw, ...damageShares(spec) }, weapon, stagger: false, sig,
  });
}

/** systems: lifesteal, the combat clock, the chill for the coming tick, visuals and damage-over-time fx. */
function afterDamage(world: World, dtMs: number): void {
  const rt = rtOf(world);
  const now = world.state.serverTime;
  const fighters = standingCombatants(world);
  const byId = new Map(fighters.map((c) => [c.id, c]));

  const dealt = new Map<string, number>();
  for (const h of world.combat.landed) {
    if (byId.has(h.victim)) sigOf(world, h.victim).combatAt = now;
    if (byId.has(h.by)) sigOf(world, h.by).combatAt = now;
    dealt.set(h.by, (dealt.get(h.by) ?? 0) + h.amount);
    if (isDot(h.sig)) {
      const key = `${h.victim}|${h.by}|${h.sig}`;
      const acc = rt.dot.get(key);
      if (acc) acc.amount += h.amount;
      else rt.dot.set(key, { victim: h.victim, by: h.by, sig: h.sig!, weapon: h.weapon, amount: h.amount });
    }
  }
  for (const [id, amount] of dealt) {
    const c = byId.get(id);
    const spec = c ? factionOf(c.s) : null;
    if (c && spec?.sustain) heal(world, c, amount * lifestealFraction(spec, sigOf(world, id).hpFrac), { lifesteal: true });
  }

  updateChill(world, fighters, byId, dtMs);
  syncVisuals(world, byId);

  if (now - rt.dotSince >= DOT_FX_MS) {
    for (const d of rt.dot.values()) {
      emit(world, { type: "fx", fx: { kind: "hit", id: d.victim, by: d.by, amount: d.amount, weapon: d.weapon, sig: d.sig } });
    }
    rt.dot.clear();
    rt.dotSince = now;
  }
}

/**
 * The time `until` (server ms) moves to when the work left before it (until - now) progresses at `m` x real time over
 * the next `dtMs`: it finishes within the tick at now + left / m, or is pushed back by (1 - m) x dtMs.
 */
export function stretchUntil(until: number, now: number, dtMs: number, m: number): number {
  const left = until - now;
  if (!(left > 0) || !(m < 1) || !(m > 0)) return until;
  return left < m * dtMs ? now + left / m : until + (1 - m) * dtMs;
}

/** chillMultiplier of a fighter's faction; 1 for one without (a dummy never chills). */
function chillOf(c: Combatant): number {
  const spec = factionOf(c.s);
  return spec ? chillMultiplier(spec) : 1;
}

function updateChill(world: World, fighters: Combatant[], byId: Map<string, Combatant>, dtMs: number): void {
  const now = world.state.serverTime;
  const chillers = new Map<string, Set<string>>();
  const add = (victim: string, frost: string): void => {
    if (victim === frost) return;
    const set = chillers.get(victim);
    if (set) set.add(frost);
    else chillers.set(victim, new Set([frost]));
  };
  for (const c of fighters) {
    const f = sigOf(world, c.id);
    const t = f.engaged && f.target !== null ? byId.get(f.target) : undefined;
    if (!t) continue;
    if (chillOf(c) < 1) add(t.id, c.id);
    if (chillOf(t) < 1) add(c.id, t.id);
  }
  for (const c of fighters) {
    const f = sigOf(world, c.id);
    const w = c.rt.weapon;
    // An attack started this tick counted its carried remainder (start..now) at full speed: take back the chill of the
    // tick that just ended over that stretch. A cooldown or draw already running was stretched tick by tick.
    if (w.action && w.action !== f.seenAction && f.chill < 1) {
      const back = (1 - f.chill) * Math.max(0, now - w.action.startedAt);
      if (w.action.kind === "draw") {
        w.action.startedAt += back;
        c.s.drawStartedAt = w.action.startedAt;
      } else {
        if (w.recoverUntil === c.s.readyAt) w.recoverUntil += back;
        c.s.readyAt += back;
      }
    }
    const from = chillers.get(c.id);
    let m = 1;
    if (from) for (const id of from) m = Math.min(m, chillOf(byId.get(id)!));
    f.chill = m;
    f.chillers = from ? [...from] : [];
    if (m < 1) {
      c.s.readyAt = stretchUntil(c.s.readyAt, now, dtMs, m);
      w.recoverUntil = stretchUntil(w.recoverUntil, now, dtMs, m);
      if (w.action?.kind === "draw") {
        w.action.startedAt += (1 - m) * dtMs;
        c.s.drawStartedAt = w.action.startedAt;
      }
    }
    f.seenAction = w.action;
  }
}

/** moveModifiers: inside CHILL_MOVE_RADIUS of a Frost that chills it, a fighter walks at the chill's multiplier. */
function chillMoveMultiplier(world: World, c: Combatant): number {
  const f = world.factions?.fighters.get(c.id);
  if (!f || f.chillers.length === 0) return 1;
  let m = 1;
  for (const id of f.chillers) {
    const frost = combatant(world, id);
    if (!frost || !standing(frost)) continue;
    if (Math.hypot(frost.s.x - c.s.x, frost.s.y - c.s.y) > CHILL_MOVE_RADIUS) continue;
    m = Math.min(m, chillOf(frost));
  }
  return m;
}

/** The synced `sig` bits and `brand` of every fighter; zero for anyone no longer standing. */
function syncVisuals(world: World, byId: Map<string, Combatant>): void {
  const bits = new Map<string, number>();
  const brand = new Map<string, number>();
  for (const c of byId.values()) {
    const f = sigOf(world, c.id);
    if (f.chill < 1) bits.set(c.id, (bits.get(c.id) ?? 0) | SIG_CHILLED);
    const spec = factionOf(c.s);
    const t = f.target !== null ? byId.get(f.target) : undefined;
    if (!spec || !t) continue;
    if (spec.mechanic === "marked") {
      const pct = Math.round(markShare(spec, f.markElapsed) * 20) * 5;
      if (pct > (brand.get(t.id) ?? 0)) brand.set(t.id, pct);
    }
    if (!f.engaged) continue;
    let b = bits.get(t.id) ?? 0;
    if (spec.mechanic === "dragonslayer") b |= SIG_BURNING;
    if (spec.mechanic === "rat_king") {
      b |= SIG_DISEASED;
      if (t.s.maxHp > 0 && t.s.hp / t.s.maxHp < 0.5) b |= SIG_EXECUTE;
    }
    bits.set(t.id, b);
  }
  for (const c of allCombatants(world)) {
    const on = byId.has(c.id);
    const b = on ? bits.get(c.id) ?? 0 : 0;
    const m = on ? brand.get(c.id) ?? 0 : 0;
    if (c.s.sig !== b) c.s.sig = b;
    if (c.s.brand !== m) c.s.brand = m;
  }
}

/** The target swapped the weapon in hand: every mark on it starts over. */
function onWeaponSwapped(world: World, c: Combatant): void {
  for (const f of rtOf(world).fighters.values()) if (f.target === c.id) f.markElapsed = 0;
}

/**
 * Heals a standing fighter by up to `amount` (never past max hp) and emits a `heal` fx. Heals other than Holy's
 * lifesteal are refused within HEAL_LOCKOUT_SECONDS of the fighter's last combat. Returns the hp gained.
 */
export function heal(world: World, c: Combatant, amount: number, opts: { lifesteal?: boolean } = {}): number {
  if (!(amount > 0) || !standing(c)) return 0;
  const now = world.state.serverTime;
  const f = world.factions?.fighters.get(c.id);
  if (!opts.lifesteal && f && now - f.combatAt < HEAL_LOCKOUT_SECONDS * 1000) return 0;
  const before = c.s.hp;
  c.s.hp = Math.min(c.s.maxHp, c.s.hp + amount);
  const gained = c.s.hp - before;
  if (gained > 0) emit(world, { type: "fx", fx: { kind: "heal", id: c.id, amount: gained } });
  return gained;
}
