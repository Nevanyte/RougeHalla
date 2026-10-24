// Faction signatures in real time (GAME_DESIGN 8.3, 10.3; testing/COUNTER_REVIEW.md section 5, whose 20 Hz model is
// testing/realtime.py). The formulas are in @raid/shared signatures.ts; this module decides who they act on and when.
//
// Targets. Every fighter (player or mob) has at most one target: the last enemy it hit. A fighter with no target takes
// whoever hits it as its target, so both sides' signatures start at the pair's first contact, whoever swung first. A
// shield block counts as the attacker's contact; a passive hit (a riposte, a reflected arrow) only gives a target to a
// fighter that has none. Within one tick the choice never depends on order: a fighter that hit its target keeps it,
// else the largest hit decides (ties by a salted per-tick hash). A target is forgotten after TARGET_FORGET_SECONDS
// without a hit or block between the pair, once it is no longer standing, and at the coliseum teleport.
//
// Reach and engagement. The target is in reach while within engageRange(the weapon in hand) of the fighter with a clear
// line of sight (present positions, collisionMap). Engaged = in reach within the last ENGAGE_LINGER_SECONDS, and a hit
// or block between the pair within the trade window (tradeWindowMs: ENGAGE_TRADE_SECONDS, longer for a slow chilled
// pair): signatures need an ongoing trade, so one tag can't keep them running from range. While engaged, a fighter's signature acts on its target:
//   Fire       burn every tick, and backlash on each attack the target performs (backlashPerSwing of that weapon)
//   Plague     disease and execute every tick (the execute reads the target's hp fraction at the start of the tick)
//   Sentenced  the mark every tick at markDps(elapsed): `elapsed` counts the engaged time in reach, so it freezes
//              while the target hides; a new target or a weapon swap by the target restarts it
//   Frost      chills everyone engaged with it either way: its own target, and whoever has it as an engaged target
//   Holy       heals lifestealFraction(own hp fraction at the start of the tick) of all the damage it lands, on
//              anyone, with no lockout (it needs no engagement)
// Every bonus is raw damage x bonusMultiplier(the owner's weapon in hand), mitigated with the owner's damage shares. It
// joins this tick's ledger (beforeDamage), so it lands at the same moment as the tick's hits and no order decides.
//
// The chill. A chilled fighter's cooldown (readyAt), bow draw and press buffer advance at chillMultiplier x real time,
// re-decided every tick (stretchUntil), so nothing is snapshotted at swing time. These timers stay in unchilled seconds
// of work, which is what the weapon state machine computes with. The ranged recovery (0.1x move until the cooldown
// that started with the shot ends) keeps its unchilled end: stretched, it would near-root a chilled shooter at any
// range, and the chill's move slow is meant to reach only CHILL_MOVE_RADIUS. An attack started
// this tick from a carried remainder counted that remainder at full speed and is corrected for the chill of the tick
// that just ended. Within CHILL_MOVE_RADIUS of a Frost that chills it, a fighter also moves at CHILL_MOVE_MULT. Several
// Frosts don't stack.
//
// In the tick: afterWeapons (note this tick's attacks, correct new ones for the chill) → movement (the chill's slow) →
// ... → beforeDamage (contacts from this tick's hits and blocks, reach, signature damage into the ledger) → ledger →
// systems (lifesteal, the combat clock, the chill for the coming tick, visuals, damage-over-time fx).
import {
  attackInterval, backlashPerSwing, bonusMultiplier, burnDps, CHILL_MOVE_MULT, CHILL_MOVE_RADIUS, chillMultiplier,
  damageShares, diseaseDps, DOT_FX_MS, ENGAGE_LINGER_SECONDS, ENGAGE_TRADE_SECONDS, ENGAGE_TRADE_SLACK_SECONDS,
  engageRange, HEAL_LOCKOUT_SECONDS, hasLineOfSight, isDot, lifestealFraction, markDps, markShare, SIG_BURNING,
  SIG_CHILLED, SIG_DISEASED, SIG_EXECUTE, staggerImmuneUntil, TARGET_FORGET_SECONDS, type FactionSpec, type SignatureKind, type WeaponId,
} from "@raid/shared";
import {
  activeWeapon, allCombatants, combatant, factionOf, standing, standingCombatants, timingsOf, type Combatant,
} from "./combatant";
import { recordHit } from "./ledger";
import { chainHook, collisionMap, emit, tieRank, type PendingAction, type World } from "./world";

/** One fighter's signature state. Times are server ms. */
export interface SigFighter {
  target: string | null;
  /** This tick: the target is within reach with a clear line. */
  inReach: boolean;
  /** This tick: recently in reach, and trading. */
  engaged: boolean;
  /** When the target was last in reach (-Infinity: not yet). */
  reachAt: number;
  /** Last hit or block between the fighter and its target, either way (or when it became the target). */
  contactAt: number;
  /** Seconds the target has spent engaged in reach since the mark (re)started. */
  markElapsed: number;
  /** hp / maxHp when this tick's damage phase began. */
  hpFrac: number;
  /** Last time this fighter dealt or took damage (the heal lockout). */
  combatAt: number;
  /** Cooldown-progress multiplier for the coming tick (1: not chilled), and the Frosts behind it. */
  chill: number;
  chillers: string[];
  /** The weapon action seen last tick after the weapon phase, to spot one started this tick. */
  seenAction: PendingAction | null;
  /** A stagger pauses this fighter's damage over time until then (see staggerPause). */
  dotPausedUntil: number;
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
  world.afterWeapons.push(afterWeapons);
  world.beforeDamage.push(signatureDamage);
  world.systems.push(afterDamage);
  world.moveModifiers.push(chillMoveMultiplier);
  chainHook(world, "weaponSwapped", onWeaponSwapped);
  // A fresh fight in the coliseum: nobody carries a target, a mark or a chill through the teleport (the heal lockout
  // keeps running).
  chainHook(world, "teleported", (w) => resetAll(w, true));
  chainHook(world, "raidStarted", (w) => resetAll(w, false));
}

function newRuntime(): FactionsRuntime {
  return { fighters: new Map(), attacks: [], dot: new Map(), dotSince: 0 };
}

function newFighter(): SigFighter {
  return {
    target: null, inReach: false, engaged: false, reachAt: -Infinity, contactAt: -Infinity, markElapsed: 0, hpFrac: 1,
    combatAt: -Infinity, chill: 1, chillers: [], seenAction: null, dotPausedUntil: 0,
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

function resetAll(world: World, keepCombat: boolean): void {
  const rt = rtOf(world);
  const combat = new Map([...rt.fighters].map(([id, f]) => [id, f.combatAt]));
  rt.fighters.clear();
  if (keepCombat) for (const [id, at] of combat) sigOf(world, id).combatAt = at;
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

/**
 * Starts the pair's contact now, each targeting the other, as if they had just traded hits. For harnesses and tests that
 * open a duel in contact from the first tick, as realtime.py does.
 */
export function noteContact(world: World, a: string, b: string): void {
  const now = world.state.serverTime;
  for (const [x, y] of [[a, b], [b, a]] as const) {
    const f = sigOf(world, x);
    if (f.target !== y) setTarget(f, y, now);
    f.contactAt = now;
  }
}

export function targetOf(world: World, id: string): string | null {
  return world.factions?.fighters.get(id)?.target ?? null;
}

/** The fighter's signature state, or undefined before it has any (tests, the harness and Phase 11 AI read it). */
export function signatureState(world: World, id: string): Readonly<SigFighter> | undefined {
  return world.factions?.fighters.get(id);
}

/**
 * afterWeapons: the attacks performed this tick (before the melee and spawn phases consume them), and the chill on
 * attacks that started this tick. Such an attack counted its carried remainder (start..now) at full speed, but that
 * stretch belongs to the tick that just ended: take its chill back off.
 */
function afterWeapons(world: World): void {
  const rt = rtOf(world);
  const now = world.state.serverTime;
  rt.attacks = [];
  for (const m of world.combat.melee) rt.attacks.push({ by: m.attacker, weapon: m.weapon });
  for (const s of world.combat.spawns) rt.attacks.push({ by: s.owner, weapon: s.weapon });
  for (const c of standingCombatants(world)) {
    const f = sigOf(world, c.id);
    const w = c.rt.weapon;
    const act = w.action;
    if (act && act !== f.seenAction && f.chill < 1) {
      const back = (1 - f.chill) * Math.max(0, now - act.startedAt);
      if (act.kind === "draw") {
        act.startedAt += back;
        c.s.drawStartedAt = act.startedAt;
      } else {
        c.s.readyAt += back;
      }
    }
    f.seenAction = act;
  }
}

function immune(world: World, c: Combatant): boolean {
  return c.kind === "player" && world.state.serverTime < c.s.immuneUntil;
}

interface Contact { other: string; amount: number; passive: boolean }

function push(map: Map<string, Contact[]>, id: string, c: Contact): void {
  const list = map.get(id);
  if (list) list.push(c);
  else map.set(id, [c]);
}

function largest(world: World, cs: readonly Contact[]): string {
  let best = cs[0]!;
  for (const c of cs) {
    if (c.amount > best.amount || (c.amount === best.amount && tieRank(world, c.other) < tieRank(world, best.other))) best = c;
  }
  return best.other;
}

/** This tick's hits and blocks between standing fighters, by attacker and by victim. */
function contactsOf(world: World, byId: Map<string, Combatant>): { out: Map<string, Contact[]>; inc: Map<string, Contact[]> } {
  const out = new Map<string, Contact[]>();
  const inc = new Map<string, Contact[]>();
  const add = (attacker: string, victim: string, amount: number, passive: boolean): void => {
    if (attacker === victim || !byId.has(attacker)) return;
    const v = byId.get(victim);
    if (!v || immune(world, v)) return;
    push(out, attacker, { other: victim, amount, passive });
    push(inc, victim, { other: attacker, amount, passive });
  };
  for (const e of world.combat.ledger) {
    const raw = e.packet.raw * e.scale;
    if (e.sig || !(raw > 0)) continue;
    add(e.by.id, e.victim, raw, e.passive === true || (e.projectile !== undefined && e.weapon === "shield"));
  }
  // A blocked swing or arrow never reaches the ledger, but the attack met its target.
  for (const ev of world.events) {
    if (ev.type === "fx" && ev.fx.kind === "block") add(ev.fx.by, ev.fx.id, 0, ev.fx.passive === true);
  }
  return { out, inc };
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

  const { out, inc } = contactsOf(world, byId);
  for (const c of fighters) {
    const f = sigOf(world, c.id);
    const hit = out.get(c.id) ?? [];
    const taken = inc.get(c.id) ?? [];
    if (f.target === null || !hit.some((x) => x.other === f.target)) {
      const active = hit.filter((x) => !x.passive);
      if (active.length > 0) setTarget(f, largest(world, active), now);
    }
    if (f.target === null && hit.length + taken.length > 0) setTarget(f, largest(world, [...hit, ...taken]), now);
    if (f.target !== null && (hit.some((x) => x.other === f.target) || taken.some((x) => x.other === f.target))) {
      f.contactAt = now;
    }
  }

  const map = collisionMap(world);
  for (const c of fighters) {
    const f = sigOf(world, c.id);
    const t = f.target !== null ? byId.get(f.target) : undefined;
    if (!t) continue;
    if (now - f.contactAt >= TARGET_FORGET_SECONDS * 1000) {
      clearTarget(f);
      continue;
    }
    const d = Math.hypot(t.s.x - c.s.x, t.s.y - c.s.y);
    f.inReach = d <= engageRange(activeWeapon(c.s)) && hasLineOfSight(map, c.s, t.s);
    if (f.inReach) f.reachAt = now;
    f.engaged = now - f.reachAt <= ENGAGE_LINGER_SECONDS * 1000 + 1e-6
      && now - f.contactAt <= tradeWindowMs(world, c, t) + 1e-6;
  }

  for (const c of fighters) {
    const f = sigOf(world, c.id);
    const spec = factionOf(c.s);
    const weapon = activeWeapon(c.s);
    const t = f.engaged && f.target !== null ? byId.get(f.target) : undefined;
    if (spec && weapon && t) {
      const bm = bonusMultiplier(weapon);
      const dot = now < f.dotPausedUntil ? 0 : bm * dt;
      const foeFrac = sigOf(world, t.id).hpFrac;
      bonus(world, c, spec, weapon, t, "burn", burnDps(spec) * dot);
      bonus(world, c, spec, weapon, t, "disease", diseaseDps(spec, foeFrac) * dot);
      bonus(world, c, spec, weapon, t, "mark", markDps(spec, f.markElapsed) * dot);
      const foe = factionOf(t.s);
      if (spec.mechanic === "dragonslayer" && foe) {
        for (const a of rt.attacks) {
          if (a.by === t.id) bonus(world, c, spec, weapon, t, "backlash", backlashPerSwing(spec.params.backlash!, foe, a.weapon) * bm);
        }
      }
    }
    if (f.inReach && f.engaged) f.markElapsed += dt;
  }
}

/** Seconds between this fighter's attacks right now, the chill included (0 without a faction or a weapon). */
function cadence(world: World, c: Combatant): number {
  const spec = factionOf(c.s);
  const w = activeWeapon(c.s);
  return spec && w ? attackInterval(spec, w) / sigOf(world, c.id).chill : 0;
}

/** How long a pair may go without a hit or block and stay engaged: never shorter than a trade between them can take. */
function tradeWindowMs(world: World, a: Combatant, b: Combatant): number {
  const slowest = Math.max(cadence(world, a), cadence(world, b));
  return Math.max(ENGAGE_TRADE_SECONDS, slowest + ENGAGE_TRADE_SLACK_SECONDS) * 1000;
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

  staggerPause(world, fighters);
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
 * A stagger cancels a swing or cast only while it is still winding up, so on average it costs a fighter one windup of
 * its weapon's damage. Damage over time would lose nothing (a DoT faction's hits are a small share of its damage), so
 * every stagger that lands (its immunity starts this tick, whether or not it cancelled anything) pauses the fighter's
 * burn, disease and mark for its weapon's windup: the same expected cost. Fire's backlash, a reply to the enemy's
 * swings, never pauses. Without this a sword's staggers trade only against hit-based factions: Holy (sword) lost
 * Holy > Sentenced (sword) outright in the real sim.
 */
function staggerPause(world: World, fighters: readonly Combatant[]): void {
  const now = world.state.serverTime;
  const landed = staggerImmuneUntil(now);
  for (const c of fighters) {
    if (c.rt.weapon.staggerImmuneUntil !== landed) continue;
    const w = activeWeapon(c.s);
    const tm = w ? timingsOf(c.s, w) : null;
    if (!tm || !(tm.windup > 0)) continue;
    const f = sigOf(world, c.id);
    f.dotPausedUntil = Math.max(f.dotPausedUntil, now + tm.windup * 1000);
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
    const from = chillers.get(c.id);
    let m = 1;
    if (from) for (const id of from) m = Math.min(m, chillOf(byId.get(id)!));
    f.chill = m;
    f.chillers = from ? [...from] : [];
    if (m < 1) {
      c.s.readyAt = stretchUntil(c.s.readyAt, now, dtMs, m);
      w.bufferedUntil = stretchUntil(w.bufferedUntil, now, dtMs, m);
      if (w.action?.kind === "draw") {
        w.action.startedAt += (1 - m) * dtMs;
        c.s.drawStartedAt = w.action.startedAt;
      }
    }
  }
}

/** moveModifiers: inside CHILL_MOVE_RADIUS of a Frost that chills it, a fighter walks at CHILL_MOVE_MULT. */
function chillMoveMultiplier(world: World, c: Combatant): number {
  const f = world.factions?.fighters.get(c.id);
  if (!f || f.chillers.length === 0) return 1;
  for (const id of f.chillers) {
    const frost = combatant(world, id);
    if (frost && standing(frost) && Math.hypot(frost.s.x - c.s.x, frost.s.y - c.s.y) <= CHILL_MOVE_RADIUS) {
      return CHILL_MOVE_MULT;
    }
  }
  return 1;
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
 * lifesteal are refused within HEAL_LOCKOUT_SECONDS of the fighter last dealing or taking damage. Returns the hp gained.
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
