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
//   Sentenced  the mark (docs/SENTENCED_REDESIGN.md): on every landed hit on its target a pulse of true damage, a share of the
//              target's max hp; the mark climbs four tiers by hits landed (or the target's weapon swaps) and from tier 2 taxes the
//              target's attack rate, from tier 3 cuts its output, at tier 4 denies its execute (ledger.ts reads `world.combat.marks`)
//   Frost      chills everyone engaged with it either way: its own target, and whoever has it as an engaged target
//   Holy       heals lifestealFraction(own hp fraction at the start of the tick) of all the damage it lands, on
//              anyone, with no lockout (it needs no engagement)
// Buffs (roguelike R4a; their rows fold in sim/mods.ts) act here too:
//   lifesteal  any faction: `lifesteal` rows (capped at LS_CAP) heal that share of the damage landed, like Holy's and on
//              top of it (the total never above LIFESTEAL_MAX), exempt from the lockout
//   markRate   a Sentenced fighter's landed hits credit (1 + markRate) toward its marks' tiers: Gathering Storm
//   triggers   Blood Saint: the first time a ledger pass leaves the owner standing below the row's hp share, it heals the
//              row's share of max hp, ignoring the lockout, once per run (the `hurt` hook; paid after the pass)
// Passives (roguelike R5, PlayerState.build; their rows fold in sim/mods.ts like the buffs') act here too:
//   Second Wind  a trigger like Blood Saint's whose heal is spread over time (`ms`): HEAL_OVER_TIME_STEP_MS steps, the first
//              paid with the pass, the rest by the `healOverTime` system, each through heal() with ignoreLockout. Its rank 2
//              re-arms at every coliseum teleport (`rearm: "teleport"`: the once-key is forgotten in the teleport hook).
//   Pestilence (a Plague owner) the execute runs below executeBandOf (0.5 + its executeBand rows) instead of half hp.
// Cards (balance pass, BALANCE_CONTRACT 3.3 and 4.6; the rows fold in sim/mods.ts) act here as well:
//   dot, returned   `bonus` multiplies each damage-over-time tick (burn, disease) by dotMultOf and Fire's backlash by returnedMultOf
//                   (Boom x1.25 both, Slow Burn x0.7 the first).
//   AP              every running burn or disease adds AP_DOT_RATIO x the owner's AP as magic damage per second while engaged: a
//                   second ledger entry with the same `sig`, so the DoT caps, the fx chunks and lifesteal see it as the same damage.
//   linger          Slow Burn: a DoT signature stays engaged lingerMultOf times ENGAGE_LINGER_SECONDS after the target leaves reach (still
//                   bounded by the trade window, ENGAGE_TRADE_SECONDS since the last hit or block).
//   lifestealMult, lifestealDot   Bloodthirst doubles the capped rows, Siphon adds a share for damage over time (shared lifestealTotal, G5).
//   healTaken       heal() multiplies every heal but lifesteal by healTakenMultOf (Wellspring, Vampiric Pact).
//   healBarrier     heal() turns a share of every heal received (lifesteal too, overheal included) into a capped, decaying barrier (Second Skin, G6).
//   slowResist      Iron Will: the chill's attack-rate cut and move slow are weaker by that share (resistSlow), as are slowMove and
//                   slowAttack statuses (sim/status.ts) and the bog (sim/terrainEffects.ts).
// With signatures off (createGameWorld's `signatures: false`) none of these run.
// Every bonus is raw damage x bonusMultiplier(the owner's weapon in hand), mitigated with the owner's damage shares. It
// joins this tick's ledger (beforeDamage), so it lands at the same moment as the tick's hits and no order decides.
//
// The chill. A chilled fighter's cooldown (readyAt), bow draw (its start and the moment the arrow leaves) and press buffer
// advance at chillMultiplier x real time, re-decided every tick (stretchUntil), so nothing is snapshotted at swing time.
// These timers stay in unchilled seconds of work, which is what the weapon state machine computes with. The other
// windups (a swing, a cast) are not stretched: only the cycle is, so a chilled melee fighter still lands its swing on
// time. An attack started this tick from a carried remainder counted that remainder at full speed and is corrected for
// the chill of the tick that just ended. Within CHILL_MOVE_RADIUS of a Frost that chills it, a fighter also moves at
// CHILL_MOVE_MULT. Several Frosts don't stack.
//
// In the tick: afterWeapons (note this tick's attacks, correct new ones for the chill) → movement (the chill's slow) →
// ... → beforeDamage (contacts from this tick's hits and blocks, reach, signature damage into the ledger) → ledger →
// systems (lifesteal, the combat clock, the chill for the coming tick, visuals, damage-over-time fx).
import {
  AP_DOT_RATIO, attackInterval, backlashPerSwing, bonusMultiplier, burnDps, capAsMult, CHILL_MOVE_MULT, CHILL_MOVE_RADIUS, chillMultiplier,
  CRIT_MULT, DOT_FX_MS, ENGAGE_LINGER_SECONDS, ENGAGE_TRADE_SECONDS, ENGAGE_TRADE_SLACK_SECONDS, executeDps, FACTIONS, FESTERING_AP_SHARE,
  FESTERING_TICK_MS, FESTERING_TICKS,
  engageRange, HEAL_LOCKOUT_SECONDS, HEAL_OVER_TIME_STEP_MS, healOverTimeSteps, hasLineOfSight, HEAVIER_SENTENCE_PER_BONUS, isDot, isFactionId, isRegionalKind,
  lifestealFraction,
  lifestealTotal, markPct, markTierOf, markWeight, MARK_DENIAL_LINGER_MS, MARK_FAR_SHARE, MARK_KILL_STACK_CAP, MARK_NEAR_RANGE, MARK_TOP_TIER,
  plagueDps, reachMask, resistSlow, SIG_BURNING, SIG_CHILLED, SIG_DISEASED, SIG_EXEC_BLOCKED, SIG_EXECUTE, SIG_SUPPRESSED, SIG_TAXED,
  staggerImmuneUntil, TARGET_FORGET_SECONDS, TARGET_LOS_GRACE_MS, TARGET_RANGE, taxedRate,
  type DamageShares, type FactionSpec, SIGNATURE_SHARES, type SignatureKind, type TriggerAction, type WeaponId,
} from "@raid/shared";
import { attackSpeedMult, grantBarrier, grantHealBarrier } from "./buffs";
import { rollDotCrit } from "./cardState";
import {
  activeWeapon, allCombatants, combatant, factionOf, isEvading, standing, standingCombatants, timingsOf, type Combatant,
} from "./combatant";
import { deferHit, recordHit } from "./ledger";
import {
  apOf, bonusMaxHpOf, cardAsMultOf, dotMultOf, executeBandOf, hasFlag, healBarrierOf, healTakenMultOf, lifestealDotOf, lifestealMultOf,
  lifestealRowsOf, lingerMultOf, markRateOf, recomputeMods, returnedMultOf, slowResistOf, triggersOf,
} from "./mods";
import { addStatus, healFactor, statusesOf } from "./status";
import {
  chainHook, collisionMap, emit, payLater, tieRank, type LedgerEntry, type MarkIndex, type ModContribution, type PendingAction, type PlayerRuntime,
  type World,
} from "./world";

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
  /**
   * The mark on `target` (a Sentenced only; docs/SENTENCED_REDESIGN.md): its tier (0 = no landed hit yet), the hits landed on this target,
   * those hits' credit toward the tiers (Gathering Storm credits more than 1 each), the target's weapon swaps while marked, whether this mark
   * has already been paid for a denied execute, and since when the target has been beyond TARGET_RANGE (-Infinity: it has not). A new target
   * or a lost one starts all of it over.
   */
  tier: number;
  markHits: number;
  markProgress: number;
  markSwaps: number;
  markDenied: boolean;
  farSince: number;
  /** Server ms the x1.5 amplifier lasts to after a denied execute: it outlives the mark by MARK_DENIAL_LINGER_MS. */
  ampUntil: number;
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
  /** The target this fighter's damage-over-time signature was running on when the last damage phase ended (null: none): Festering Arcana starts when it stops. */
  engagedOn?: string | null;
}

export interface FactionsRuntime {
  fighters: Map<string, SigFighter>;
  /** This tick's attacks: swings landing, balls leaving, arrows loosed. */
  attacks: Array<{ by: string; weapon: WeaponId }>;
  /** Damage over time landed since `dotSince`, reported together every DOT_FX_MS. */
  dot: Map<string, { victim: string; by: string; sig: SignatureKind; weapon: WeaponId | null; amount: number }>;
  dotSince: number;
}

export function install(world: World): void {
  world.factions = newRuntime();
  world.afterWeapons.push(afterWeapons);
  world.beforeDamage.push(signatureDamage);
  world.systems.push(afterDamage);
  world.systems.push(healOverTime);
  world.moveModifiers.push(chillMoveMultiplier);
  // The mark's attack-speed tax is a stat source: the mirrors stay the one truth for attack speed, and AS_MULT_CAP applies to it.
  world.modSources.push(markTaxSource);
  chainHook(world, "weaponSwapped", onWeaponSwapped);
  chainHook(world, "hurt", onHurt);
  chainHook(world, "playerKilled", onPlayerKilled);
  chainHook(world, "executeDenied", onExecuteDenied);
  // A fresh fight in the coliseum: nobody carries a target, a mark or a chill through the teleport (the heal lockout
  // keeps running). Triggers that re-arm at a teleport (Second Wind rank 2) may fire again, and a heal still being paid out
  // is dropped first, so the old one and the new one can never both run.
  chainHook(world, "teleported", (w) => { resetAll(w, true); dropHealsOverTime(w); rearmTriggers(w); });
  // A run's kill-stacks start from nothing (they are never banked).
  chainHook(world, "raidStarted", (w) => { resetAll(w, false); for (const p of w.state.players.values()) if (p.sentence !== 0) p.sentence = 0; });
  chainHook(world, "runEnded", flushDotFx);
}

function newRuntime(): FactionsRuntime {
  return { fighters: new Map(), attacks: [], dot: new Map(), dotSince: 0 };
}

function newFighter(): SigFighter {
  return {
    target: null, inReach: false, engaged: false, reachAt: -Infinity, contactAt: -Infinity, tier: 0, markHits: 0, markProgress: 0, markSwaps: 0,
    markDenied: false, farSince: -Infinity, ampUntil: 0, hpFrac: 1,
    combatAt: -Infinity, chill: 1, chillers: [], seenAction: null, dotPausedUntil: 0, engagedOn: null,
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
  // The marks end with the targets: whoever was taxed gets its attack speed back now, and nobody shows a mark for the tick it takes the visuals to follow.
  const taxed = world.combat.marks ? [...world.combat.marks.taxed.keys()] : [];
  world.combat.marks = undefined;
  for (const id of taxed) {
    const c = combatant(world, id);
    if (c) recomputeMods(world, c);
  }
  for (const c of allCombatants(world)) {
    if (c.s.markTier !== 0) c.s.markTier = 0;
    if (c.s.markBy !== "") c.s.markBy = "";
    if (c.s.markTax !== 0) c.s.markTax = 0;
    if (c.s.brand !== 0) c.s.brand = 0;
    const clean = c.s.sig & ~(SIG_TAXED | SIG_SUPPRESSED | SIG_EXEC_BLOCKED);
    if (c.s.sig !== clean) c.s.sig = clean;
  }
}

/** The mark starts over (its tier, hits, swaps and denial latch, and the distance clock); the amplifier's linger runs on. */
function resetMark(f: SigFighter): void {
  f.tier = 0;
  f.markHits = 0;
  f.markProgress = 0;
  f.markSwaps = 0;
  f.markDenied = false;
  f.farSince = -Infinity;
}

/** `f` now has `id` as its target: everything about the previous one (reach, linger, the mark) starts over. */
function setTarget(f: SigFighter, id: string, now: number): void {
  f.target = id;
  f.inReach = false;
  f.engaged = false;
  f.reachAt = -Infinity;
  f.contactAt = now;
  resetMark(f);
}

function clearTarget(f: SigFighter): void {
  f.target = null;
  f.inReach = false;
  f.engaged = false;
  f.reachAt = -Infinity;
  resetMark(f);
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
      c.s.readyAt += back;
      if (act.kind === "draw") {
        act.startedAt += back;
        act.landsAt += back;
        c.s.drawStartedAt = act.startedAt;
      }
    }
    f.seenAction = act;
  }
}

function immune(world: World, c: Combatant): boolean {
  return c.kind === "player" && world.state.serverTime < c.s.immuneUntil;
}

/** An evading mob (combatant.ts isEvading) takes no signature target and no contact, so it cannot keep burning, diseasing or chilling a player who follows it. */
const evading = isEvading;

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
    if (attacker === victim) return;
    const a = byId.get(attacker);
    const v = byId.get(victim);
    if (!a || !v || immune(world, v) || evading(v) || evading(a)) return;
    // Mobs never hurt each other: a bash that a camp-mate's shield blocks is no contact between them.
    if (a.kind === "mob" && v.kind === "mob") return;
    push(out, attacker, { other: victim, amount, passive });
    push(inc, victim, { other: attacker, amount, passive });
  };
  for (const e of world.combat.ledger) {
    const raw = e.packet.raw * e.scale;
    // A signature's, an ability's or a card's damage over time (a bleed, Festering Arcana's tail) is no trade: it cannot keep a pair engaged.
    if (e.sig || e.ability !== undefined || e.dot === true || !(raw > 0)) continue;
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
  const fighters = standingCombatants(world);
  const byId = new Map(fighters.map((c) => [c.id, c]));
  for (const id of [...rt.fighters.keys()]) if (!byId.has(id)) rt.fighters.delete(id);
  for (const c of fighters) {
    const f = sigOf(world, c.id);
    f.hpFrac = c.s.maxHp > 0 ? c.s.hp / c.s.maxHp : 0;
    // A fighter loses its target when the target is gone or is walking home, and a mob walking home keeps none.
    if (f.target !== null && (!byId.has(f.target) || evading(c) || evading(byId.get(f.target)))) clearTarget(f);
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
    // The reach of the weapon in hand: a melee faction's signature does not cross a fence (LOW), a ranged one does.
    const weapon = activeWeapon(c.s);
    f.inReach = d <= engageRange(weapon) && hasLineOfSight(map, c.s, t.s, reachMask(weapon));
    if (f.inReach) f.reachAt = now;
    f.engaged = now - f.reachAt <= lingerMs(c) + 1e-6
      && now - f.contactAt <= tradeWindowMs(world, c, t) + 1e-6;
  }

  // The marks: this tick's landed hits climb them and pay their pulses (into this tick's ledger), then the pass-start index is rebuilt.
  markStep(world, fighters, byId, now);

  for (const c of fighters) {
    const f = sigOf(world, c.id);
    const spec = factionOf(c.s);
    const weapon = activeWeapon(c.s);
    const t = f.engaged && f.target !== null ? byId.get(f.target) : undefined;
    // Festering Arcana: the damage over time this fighter was running on someone has just stopped (out of reach, forgotten, a new target...).
    const was = f.engagedOn ?? null;
    f.engagedOn = spec && weapon && t && dealsDot(spec) ? t.id : null;
    if (was !== null && was !== f.engagedOn && spec) festerEnd(world, c, was, byId);
    if (spec && weapon && t) {
      const bm = bonusMultiplier(weapon);
      // This tick's damage over time covers (now - dt, now]; a stagger pause takes out whatever share of it overlaps.
      const pausedMs = Math.min(dtMs, Math.max(0, f.dotPausedUntil - (now - dtMs)));
      const secs = (dtMs - pausedMs) / 1000;
      const dot = bm * secs;
      const foeFrac = sigOf(world, t.id).hpFrac;
      // AP is flat power in points a second: no weapon multiplier, but the stagger pause takes out its share of the tick too.
      const apDot = AP_DOT_RATIO * apOf(c.s) * secs;
      dotBonus(world, c, spec, weapon, t, "burn", burnDps(spec) * dot, apDot);
      // The disease and its execute are two entries of one type: a tier-4 mark denies the second (docs/SENTENCED_REDESIGN.md R7). The AP rider rides the first.
      dotBonus(world, c, spec, weapon, t, "disease", plagueDps(spec) * dot, apDot);
      dotBonus(world, c, spec, weapon, t, "disease", executeDps(spec, foeFrac, executeBandOf(c.s)) * dot, 0, true);
      const foe = factionOf(t.s);
      if (spec.mechanic === "dragonslayer" && foe) {
        for (const a of rt.attacks) {
          if (a.by === t.id) bonus(world, c, spec, weapon, t, "backlash", backlashPerSwing(spec.params.backlash!, foe, a.weapon) * bm);
        }
      }
    }
  }
}

/**
 * Festering Arcana: a fighter's damage-over-time signature just stopped running on `from`. If it stands and the fighter has the card
 * and some AP, a `dot` status of magic damage keeps ticking on it: FESTERING_TICKS ticks, one every FESTERING_TICK_MS, each
 * FESTERING_AP_SHARE of the fighter's AP (a status dps of that per tick time). A second ending refreshes it, never doubles it.
 */
function festerEnd(world: World, c: Combatant, from: string, byId: ReadonlyMap<string, Combatant>): void {
  if (!hasFlag(c.s, "festering")) return;
  const ap = apOf(c.s);
  const target = byId.get(from);
  if (!(ap > 0) || !target || evading(target)) return;
  addStatus(world, target, {
    kind: "dot", source: { id: c.id, name: c.s.name }, ms: FESTERING_TICKS * FESTERING_TICK_MS, tag: "festering",
    value: (ap * FESTERING_AP_SHARE * 1000) / FESTERING_TICK_MS, data: { shares: AP_DOT_SHARES },
  }, { quiet: true });
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

/** How long (ms) a fighter stays engaged after its target leaves reach: ENGAGE_LINGER_SECONDS, longer by Slow Burn's `linger` for a damage-over-time signature. */
function lingerMs(c: Combatant): number {
  return ENGAGE_LINGER_SECONDS * 1000 * (dealsDot(factionOf(c.s)) ? lingerMultOf(c.s) : 1);
}

/** The faction's signature deals damage over time (Fire's burn, Plague's disease): Slow Burn's linger means nothing to a Frost, a Holy or a Sentenced (its mark pays per hit). */
function dealsDot(spec: FactionSpec | null | undefined): boolean {
  return !!spec && (spec.mechanic === "dragonslayer" || spec.mechanic === "rat_king");
}

/** The magic damage of AP on a damage-over-time signature (BALANCE_CONTRACT 3.3), whatever type the signature itself deals. */
const AP_DOT_SHARES: DamageShares = { phys: 0, magic: 1, true: 0 };

/**
 * One damage-over-time signature's tick: its own amount `raw`, and while it runs (`raw` above 0) the owner's AP as magic damage
 * `apRaw` under the same `sig`. `execute` flags Plague's execute entry (a tier-4 mark denies it).
 */
function dotBonus(
  world: World, c: Combatant, spec: FactionSpec, weapon: WeaponId, t: Combatant, sig: SignatureKind, raw: number, apRaw: number,
  execute = false,
): void {
  if (!(raw > 0)) return;
  bonus(world, c, spec, weapon, t, sig, raw, SIGNATURE_SHARES[sig], execute);
  if (apRaw > 0) bonus(world, c, spec, weapon, t, sig, apRaw, AP_DOT_SHARES);
}

function bonus(
  world: World, c: Combatant, spec: FactionSpec, weapon: WeaponId, t: Combatant, sig: SignatureKind, raw: number,
  shares: DamageShares = SIGNATURE_SHARES[sig], execute = false,
): void {
  // The owner's cards: damage over time (Boom, Slow Burn) and Fire's backlash (Boom) are products on the signature's amount.
  raw *= sig === "backlash" ? returnedMultOf(c.s) : dotMultOf(c.s);
  if (!(raw > 0)) return;
  // Cruel Wounds: a damage-over-time tick can critically strike (one roll for all of the player's ticks this tick; a backlash is no tick).
  const crit = sig !== "backlash" && rollDotCrit(world, c);
  // Each signature deals its own damage type, whatever the faction's weapon hits are (SIGNATURE_SHARES, BALANCE_CONTRACT 5.2).
  recordHit(world, {
    victim: t.id, by: { id: c.id, name: c.s.name },
    packet: crit ? { raw: raw * CRIT_MULT, ...shares, crit: true, mult: CRIT_MULT } : { raw, ...shares }, weapon, stagger: false, sig,
    ...(execute ? { execute: true as const } : {}),
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// The mark (docs/SENTENCED_REDESIGN.md)
// ---------------------------------------------------------------------------------------------------------------------

/** The tier of the mark `ownerId` holds on `targetId` right now (0 for none): Trial reads it as the ring lands. */
export function markTierOn(world: World, ownerId: string, targetId: string): number {
  const f = world.factions?.fighters.get(ownerId);
  return f && f.target === targetId ? f.tier : 0;
}

/** Is `t` inside a Trial ring cast by `ownerId`? The owner's mark on it is then at full strength whatever the distance. */
function inRing(world: World, ownerId: string, t: Combatant): boolean {
  const now = world.state.serverTime;
  for (const st of statusesOf(t)) if (st.kind === "zoned" && st.source.id === ownerId && st.until > now) return true;
  return false;
}

/** The mark is at full strength: the target is within MARK_NEAR_RANGE of its owner, or inside the owner's Trial ring. */
function markNear(world: World, c: Combatant, t: Combatant): boolean {
  return Math.hypot(t.s.x - c.s.x, t.s.y - c.s.y) <= MARK_NEAR_RANGE || inRing(world, c.id, t);
}

/** Does the entry count as a landed hit for a mark (R2): a weapon hit, not a signature, an ability, a damage over time, a riposte, a splash or returned damage? */
function countsForMark(e: LedgerEntry): boolean {
  return e.weapon !== null && e.sig === undefined && e.ability === undefined && e.dot !== true && e.passive !== true && e.derived !== true
    && e.final !== true && e.arena !== true && e.scale > 0 && e.packet.raw > 0;
}

/** This tick's hits that count for a mark, by their Sentenced attacker (the contacts' filter: nobody immune, nobody walking home, no mob on a mob). */
function markHitsOf(world: World, byId: ReadonlyMap<string, Combatant>): Map<string, LedgerEntry[]> {
  const out = new Map<string, LedgerEntry[]>();
  for (const e of world.combat.ledger) {
    if (!countsForMark(e)) continue;
    const a = byId.get(e.by.id);
    const v = byId.get(e.victim);
    if (!a || !v || immune(world, v) || evading(v) || evading(a) || (a.kind === "mob" && v.kind === "mob")) continue;
    if (factionOf(a.s)?.mechanic !== "marked") continue;
    const list = out.get(e.by.id);
    if (list) list.push(e);
    else out.set(e.by.id, [e]);
  }
  return out;
}

/** The tiers the target's weapon swaps (each one tier, two with No Commutation) and Swift Judgment's every second hit have earned. */
function swapSteps(f: SigFighter, s: Combatant["s"]): number {
  return f.markSwaps * (hasFlag(s, "noCommutation") ? 2 : 1) + (hasFlag(s, "swiftJudgment") ? Math.floor(f.markHits / 2) : 0);
}

/** Raises the mark's tier to what its hits and swaps have earned; the first tier on a player is announced to it. */
function promote(world: World, c: Combatant, f: SigFighter, t: Combatant): number {
  const tier = Math.min(MARK_TOP_TIER, markTierOf(f.markProgress, swapSteps(f, c.s)));
  if (tier > f.tier) {
    if (f.tier === 0 && t.kind === "player") emit(world, { type: "toast", to: t.id, text: "Sentenced marked you." });
    f.tier = tier;
  }
  return f.tier;
}

/**
 * The pool a mark's share reads: the target's max hp, except for a regional mob, whose hp is built small (MOB_K, ELITE_K) so a share of it
 * would be nothing: it reads the hp of a player-sized fighter of the mob's zone (the sheet's), as every other flat number a player deals does.
 */
function markPool(t: Combatant): number {
  const f = isFactionId(t.s.faction) ? FACTIONS[t.s.faction] : null;
  return t.kind === "mob" && isRegionalKind(t.s.kind) && f ? f.hp : t.s.maxHp;
}

/**
 * The pulse for one landed hit: a share of the target's max hp (`markPool`) as true damage, in this tick's ledger. The share is the faction's `mark_pct`
 * (kill-stacks and Heavier Sentence on it), times the hit's weight (its share of the faction's base hit, paid back for Frost's chill: a chilled
 * fighter lands fewer hits and each pays out the time it took), times the amplifier at tier 4 (or while a denied execute's linger runs), halved
 * beyond MARK_NEAR_RANGE unless the target stands in the owner's Trial ring. The ledger multiplies it like any hit (damage rows, the PvP factor,
 * Trial's x1.2) and nothing mitigates it.
 */
function recordPulse(world: World, c: Combatant, spec: FactionSpec, f: SigFighter, t: Combatant, hit: LedgerEntry, tier: number, near: boolean): void {
  const now = world.state.serverTime;
  const weapon = hit.weapon!;
  const stacks = c.kind === "player" ? c.s.sentence : 0;
  const heavier = hasFlag(c.s, "heavierSentence") && spec.hp > 0 ? 1 + HEAVIER_SENTENCE_PER_BONUS * (bonusMaxHpOf(c.s) / spec.hp) : 1;
  const weight = markWeight(spec, weapon, attackSpeedMult(c.s)) / Math.max(f.chill, 0.05);
  const amp = tier >= MARK_TOP_TIER || now < f.ampUntil ? spec.params.mark_amp! : 1;
  const raw = markPct(spec, stacks, heavier) * markPool(t) * weight * amp * (near ? 1 : MARK_FAR_SHARE);
  if (!(raw > 0)) return;
  recordHit(world, {
    victim: t.id, by: { id: c.id, name: c.s.name }, packet: { raw, ...SIGNATURE_SHARES.mark }, weapon, stagger: false, sig: "mark",
  });
}

/**
 * beforeDamage, after targets and reach are settled: every Sentenced fighter's mark. The target out of TARGET_RANGE for TARGET_LOS_GRACE_MS
 * breaks it (and drops the target); each landed hit on the target counts, climbs the tiers and pays its pulse; the weapon swaps counted since
 * the last tick promote too. Then the pass-start index (`world.combat.marks`) is rebuilt for the ledger and the tax.
 */
function markStep(world: World, fighters: readonly Combatant[], byId: ReadonlyMap<string, Combatant>, now: number): void {
  const hitsBy = markHitsOf(world, byId);
  let any = false;
  for (const c of fighters) {
    const spec = factionOf(c.s);
    if (!spec || spec.mechanic !== "marked") continue;
    any = true;
    const f = sigOf(world, c.id);
    const t = f.target !== null ? byId.get(f.target) : undefined;
    if (!t) continue;
    if (Math.hypot(t.s.x - c.s.x, t.s.y - c.s.y) > TARGET_RANGE) {
      if (f.farSince === -Infinity) f.farSince = now;
      else if (now - f.farSince >= TARGET_LOS_GRACE_MS) {
        clearTarget(f);
        continue;
      }
    } else {
      f.farSince = -Infinity;
    }
    const near = markNear(world, c, t);
    for (const hit of hitsBy.get(c.id) ?? []) {
      if (hit.victim !== t.id) continue;
      f.markHits += 1;
      // A chilled fighter lands fewer hits, and each is paid back for the time it took: the tiers climb at the unchilled pace (R3).
      f.markProgress += markRateOf(c.s) / Math.max(f.chill, 0.05);
      recordPulse(world, c, spec, f, t, hit, Math.max(1, promote(world, c, f, t)), near);
    }
    if (f.tier > 0) promote(world, c, f, t);
  }
  if (any || world.combat.marks) rebuildMarkIndex(world, fighters, byId);
}

/**
 * The marks as the ledger pass and the stat sources read them: who is suppressed, whose execute a Sentenced denies, who is taxed (and by
 * which Sentenced). A fighter whose tax appeared or went (a tier-2 promotion, a proximity flip, the mark ending) has its mirrors re-folded now.
 */
function rebuildMarkIndex(world: World, fighters: readonly Combatant[], byId: ReadonlyMap<string, Combatant>): void {
  const next: MarkIndex = { suppressed: new Map(), denies: new Map(), taxed: new Map() };
  const taxTier = new Map<string, number>();
  for (const c of fighters) {
    const spec = factionOf(c.s);
    if (!spec || spec.mechanic !== "marked") continue;
    const f = sigOf(world, c.id);
    const t = f.tier > 0 && f.target !== null ? byId.get(f.target) : undefined;
    if (!t) continue;
    if (f.tier >= 3) next.suppressed.set(t.id, Math.min(next.suppressed.get(t.id) ?? 1, spec.params.suppress ?? 1));
    if (f.tier >= MARK_TOP_TIER) next.denies.set(c.id, new Set([t.id]));
    if (f.tier >= 2 && markNear(world, c, t)) {
      const best = next.taxed.get(t.id);
      if (best === undefined || f.tier > taxTier.get(t.id)! || (f.tier === taxTier.get(t.id) && c.id < best)) {
        next.taxed.set(t.id, c.id);
        taxTier.set(t.id, f.tier);
      }
    }
  }
  const prev = world.combat.marks?.taxed;
  world.combat.marks = next;
  const changed = new Set<string>();
  if (prev) for (const id of prev.keys()) if (!next.taxed.has(id)) changed.add(id);
  for (const id of next.taxed.keys()) if (!prev?.has(id)) changed.add(id);
  for (const id of changed) {
    const c = combatant(world, id);
    if (c) recomputeMods(world, c);
  }
}

/** The factor the tax puts on `c`'s card attack speed under the Sentenced `byId`: taxedRate(r) / r with r the faction's rate times its card haste; 1 when it would cut nothing. */
function taxFactor(world: World, c: Combatant, byId: string): number {
  const spec = factionOf(c.s);
  const marker = combatant(world, byId);
  const m = marker ? factionOf(marker.s) : null;
  if (!spec || !m || m.mechanic !== "marked") return 1;
  const r = spec.rate * cardAsMultOf(c.s);
  if (!(r > 0)) return 1;
  const taxed = taxedRate(r, m.params.tax_keep!, m.params.tax_cap!);
  return taxed < r ? taxed / r : 1;
}

/**
 * The share of its attack speed the tax is taking from `c` under the Sentenced `byId`, 0..1: the mirror without the tax against the mirror with
 * it (both through AS_MULT_CAP, so a Haste-stacked fighter's cut is the real one: the cap alone would have cost it part of that haste anyway).
 */
function taxCut(world: World, c: Combatant, byId: string): number {
  const factor = taxFactor(world, c, byId);
  if (!(factor < 1)) return 0;
  const cards = cardAsMultOf(c.s);
  const before = capAsMult(cards);
  return before > 0 ? Math.max(0, 1 - capAsMult(cards * factor) / before) : 0;
}

/** world.modSources entry: the mark's tax, an attack-speed factor like any slow (the mirrors fold and cap it). */
function markTaxSource(world: World, c: Combatant): ModContribution | null {
  const by = world.combat.marks?.taxed.get(c.id);
  if (by === undefined) return null;
  const factor = taxFactor(world, c, by);
  return factor < 1 ? { asMult: factor } : null;
}

/** A kill-stack for a Sentenced's player kill, and the line for finishing its marked target. */
function onPlayerKilled(world: World, killer: PlayerRuntime, victim: PlayerRuntime, outcome: "died" | "mia"): void {
  if (outcome !== "died") return;
  const p = world.state.players.get(killer.id);
  if (!p || factionOf(p)?.mechanic !== "marked") return;
  const f = world.factions?.fighters.get(killer.id);
  if (f && f.target === victim.id && f.tier > 0) emit(world, { type: "toast", to: killer.id, text: "Your sentence has been carried out." });
  if (p.sentence < MARK_KILL_STACK_CAP) p.sentence += 1;
}

/**
 * The ledger denied execute damage (R7), after the pass: the Sentenced's x1.5 amplifier outlives its mark by MARK_DENIAL_LINGER_MS, the mark
 * pays one kill-stack (once per mark), each denied foe is told, and with Final Verdict the denied damage goes back to it as true damage
 * (queued for the next tick's ledger).
 */
function onExecuteDenied(world: World, victim: Combatant, denied: ReadonlyMap<string, number>): void {
  const f = world.factions?.fighters.get(victim.id);
  if (!f || factionOf(victim.s)?.mechanic !== "marked") return;
  f.ampUntil = Math.max(f.ampUntil, world.state.serverTime + MARK_DENIAL_LINGER_MS);
  if (!f.markDenied) {
    f.markDenied = true;
    if (victim.kind === "player" && victim.s.sentence < MARK_KILL_STACK_CAP) victim.s.sentence += 1;
  }
  for (const [foeId, amount] of denied) {
    if (world.players.has(foeId)) emit(world, { type: "toast", to: foeId, text: "Execute blocked - already sentenced." });
    if (hasFlag(victim.s, "finalVerdict") && amount > 0) {
      deferHit(world, {
        victim: foeId, by: { id: victim.id, name: victim.s.name }, packet: { raw: amount, ...SIGNATURE_SHARES.mark },
        weapon: activeWeapon(victim.s), stagger: false, passive: true, final: true,
      });
    }
  }
}

/** systems: lifesteal, the combat clock, the chill for the coming tick, visuals and damage-over-time fx. */
function afterDamage(world: World, dtMs: number): void {
  const rt = rtOf(world);
  const now = world.state.serverTime;
  const fighters = standingCombatants(world);
  const byId = new Map(fighters.map((c) => [c.id, c]));

  const dealt = new Map<string, number>();
  /** The part of `dealt` that was damage over time (Siphon heals more of it). */
  const dealtDot = new Map<string, number>();
  for (const h of world.combat.landed) {
    if (byId.has(h.victim)) sigOf(world, h.victim).combatAt = now;
    if (byId.has(h.by)) sigOf(world, h.by).combatAt = now;
    // A Race to 0 holder's extra damage feeds no lifesteal (G4): it reads the amount without the multiplier. A tier-3 mark's suppression is no cut
    // to the sustain either: the sentence never out-cuts a lifesteal (docs/SENTENCED_REDESIGN.md R6).
    const fed = h.amount / (h.race ?? 1) / (h.cut ?? 1);
    dealt.set(h.by, (dealt.get(h.by) ?? 0) + fed);
    if (isDot(h.sig) || h.dot === true) dealtDot.set(h.by, (dealtDot.get(h.by) ?? 0) + fed);
    if (isDot(h.sig)) {
      const key = `${h.victim}|${h.by}|${h.sig}`;
      const acc = rt.dot.get(key);
      if (acc) acc.amount += h.amount;
      else rt.dot.set(key, { victim: h.victim, by: h.by, sig: h.sig!, weapon: h.weapon, amount: h.amount });
    }
  }
  for (const [id, amount] of dealt) {
    const c = byId.get(id);
    if (!c) continue;
    const spec = factionOf(c.s);
    const own = spec?.sustain ? lifestealFraction(spec, sigOf(world, id).hpFrac) : 0;
    // Holy's own share and the rows' (Bloodthirst doubling them), and for damage over time Siphon's share on top (G5).
    const rows = lifestealRowsOf(c.s);
    const mult = lifestealMultOf(c.s);
    const share = lifestealTotal(own, rows, mult, 0);
    const onDot = lifestealDotOf(c.s);
    const dot = onDot > 0 ? dealtDot.get(id) ?? 0 : 0;
    const gain = (amount - dot) * share + dot * lifestealTotal(own, rows, mult, onDot);
    if (gain > 0) heal(world, c, gain, { lifesteal: true });
  }

  staggerPause(world, fighters);
  updateChill(world, fighters, byId, dtMs);
  syncVisuals(world, byId);

  if (now - rt.dotSince >= DOT_FX_MS) flushDotFx(world);
}

/**
 * Reports the damage over time landed since the last report, one `hit` fx per pair. Every DOT_FX_MS, and once more when the
 * run ends, so the last chunk (often the killing one) is never left unsaid.
 */
function flushDotFx(world: World): void {
  const rt = world.factions;
  if (!rt) return;
  for (const d of rt.dot.values()) {
    emit(world, { type: "fx", fx: { kind: "hit", id: d.victim, by: d.by, amount: d.amount, weapon: d.weapon, sig: d.sig } });
  }
  rt.dot.clear();
  rt.dotSince = world.state.serverTime;
}

/**
 * A stagger cancels a swing or cast only while it is still winding up (never a bow's draw), so on average it costs a fighter one windup of
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
    // A bow's draw is not interrupted by a stagger (weapons.ts), so a stagger costs it nothing to make up for.
    if (!tm || w === "bow" || !(tm.windup > 0)) continue;
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
    // Iron Will: the cut to the attack rate is weaker by the share resisted (so a chilled fighter is still chilled unless it resists it all).
    m = resistSlow(m, slowResistOf(c.s));
    f.chill = m;
    f.chillers = from ? [...from] : [];
    if (m < 1) {
      c.s.readyAt = stretchUntil(c.s.readyAt, now, dtMs, m);
      w.bufferedUntil = stretchUntil(w.bufferedUntil, now, dtMs, m);
      if (w.action?.kind === "draw") {
        // The draw's work runs at m x real time: the arrow leaves when its remaining work is done, and the pull drawn so far moves with it.
        const lands = stretchUntil(w.action.landsAt, now, dtMs, m);
        w.action.startedAt += lands - w.action.landsAt;
        w.action.landsAt = lands;
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
      return resistSlow(CHILL_MOVE_MULT, slowResistOf(c.s));
    }
  }
  return 1;
}

/** The synced `sig` bits, `brand` and mark fields of every fighter; zero for anyone no longer standing. */
function syncVisuals(world: World, byId: Map<string, Combatant>): void {
  const bits = new Map<string, number>();
  /** The strongest mark on each fighter: its tier and its owner (the lower id on a tie). */
  const mark = new Map<string, { tier: number; by: string }>();
  const idx = world.combat.marks;
  for (const c of byId.values()) {
    const f = sigOf(world, c.id);
    if (f.chill < 1) bits.set(c.id, (bits.get(c.id) ?? 0) | SIG_CHILLED);
    const spec = factionOf(c.s);
    const t = f.target !== null ? byId.get(f.target) : undefined;
    if (!spec || !t) continue;
    if (spec.mechanic === "marked" && f.tier > 0) {
      const best = mark.get(t.id);
      if (!best || f.tier > best.tier || (f.tier === best.tier && c.id < best.by)) mark.set(t.id, { tier: f.tier, by: c.id });
    }
    if (!f.engaged) continue;
    let b = bits.get(t.id) ?? 0;
    if (spec.mechanic === "dragonslayer") b |= SIG_BURNING;
    if (spec.mechanic === "rat_king") {
      b |= SIG_DISEASED;
      if (t.s.maxHp > 0 && t.s.hp / t.s.maxHp < executeBandOf(c.s)) b |= SIG_EXECUTE;
    }
    bits.set(t.id, b);
  }
  if (idx) {
    for (const id of idx.suppressed.keys()) if (byId.has(id)) bits.set(id, (bits.get(id) ?? 0) | SIG_SUPPRESSED);
    for (const foes of idx.denies.values()) for (const id of foes) if (byId.has(id)) bits.set(id, (bits.get(id) ?? 0) | SIG_EXEC_BLOCKED);
  }
  for (const c of allCombatants(world)) {
    const on = byId.has(c.id);
    const b = on ? bits.get(c.id) ?? 0 : 0;
    const m = on ? mark.get(c.id) : undefined;
    const tier = m?.tier ?? 0;
    const by = m?.by ?? "";
    const taxer = on ? idx?.taxed.get(c.id) : undefined;
    const tax = taxer !== undefined ? Math.round(taxCut(world, c, taxer) * 100) : 0;
    const bitsOut = tax > 0 ? b | SIG_TAXED : b;
    if (c.s.sig !== bitsOut) c.s.sig = bitsOut;
    if (c.s.brand !== tier * 25) c.s.brand = tier * 25;
    if (c.s.markTier !== tier) c.s.markTier = tier;
    if (c.s.markBy !== by) c.s.markBy = by;
    if (c.s.markTax !== tax) c.s.markTax = tax;
  }
}

/** The target swapped the weapon in hand: every mark on it counts a swap (it promotes at the next tick's mark step). */
function onWeaponSwapped(world: World, c: Combatant): void {
  for (const f of rtOf(world).fighters.values()) if (f.target === c.id && f.tier > 0) f.markSwaps += 1;
}

/**
 * Heals a standing fighter by up to `amount` (never past max hp) and emits a `heal` fx. Heals other than lifesteal are
 * refused within HEAL_LOCKOUT_SECONDS of the fighter last dealing or taking damage, unless `ignoreLockout` (Blood Saint's
 * trigger; Last Stand's payback, which comes right after the damage it answers), which skips that lockout and nothing else.
 * An anti-heal status scales every heal, lifesteal included (healFactor); the fighter's `healTaken` cards scale every heal but lifesteal
 * (healTakenMultOf: 1.25 with Wellspring, 0 with Vampiric Pact). `quiet` sends no fx (a mob's regeneration heals
 * every tick, which would be a heal number every tick). Returns the hp gained.
 */
export function heal(
  world: World, c: Combatant, amount: number, opts: { lifesteal?: boolean; quiet?: boolean; ignoreLockout?: boolean } = {},
): number {
  if (!(amount > 0) || !standing(c)) return 0;
  const now = world.state.serverTime;
  const f = world.factions?.fighters.get(c.id);
  if (!opts.lifesteal && !opts.ignoreLockout && f && now - f.combatAt < HEAL_LOCKOUT_SECONDS * 1000) return 0;
  amount *= healFactor(world, c);
  // Healing received is stronger or weaker by the fighter's cards (Wellspring, Vampiric Pact); lifesteal is exempt.
  if (!opts.lifesteal) amount *= healTakenMultOf(c.s);
  if (!(amount > 0)) return 0;
  // Second Skin (G6): a share of the heal received, overheal included, also stands as a barrier (capped and decaying: sim/buffs.ts).
  if (c.kind === "player") {
    const share = healBarrierOf(c.s);
    if (share > 0) grantHealBarrier(c.s, c.rt, share * amount, now);
  }
  const before = c.s.hp;
  c.s.hp = Math.min(c.s.maxHp, c.s.hp + amount);
  const gained = c.s.hp - before;
  if (gained > 0 && !opts.quiet) emit(world, { type: "fx", fx: { kind: "heal", id: c.id, amount: gained } });
  return gained;
}

/**
 * The `hurt` hook: a fighter still standing after a ledger pass checks its `hpBelow` trigger rows against its own hp.
 * A `once` row fires the first time a pass leaves it below the threshold (even if it was already below when it got the
 * row), then never again this run (PlayerRuntime.fired); any other row fires when a pass takes it across the threshold.
 * Decided from the fighter's own state only; what it does is paid after the pass (payLater).
 */
function onHurt(world: World, c: Combatant, _applied: number, hpBefore: number): void {
  if (c.kind !== "player") return;
  const triggers = triggersOf(c.s);
  if (triggers.length === 0 || !(c.s.maxHp > 0)) return;
  const frac = c.s.hp / c.s.maxHp;
  // The hp as the pass began: hp + applied would overstate it when a death floor (Last Stand) held the hp up.
  const before = hpBefore / c.s.maxHp;
  for (const { key, row } of triggers) {
    if (row.on !== "hpBelow" || !(frac < row.arg)) continue;
    if (row.once) {
      const fired = (c.rt.fired ??= new Set());
      if (fired.has(key)) continue;
      fired.add(key);
    } else if (before < row.arg) {
      continue;
    }
    runTrigger(world, c, row.do);
  }
}

/**
 * A trigger's action, paid after the pass. No row uses a status, cleanse or cooldown action yet: R4b runs the first two
 * through sim/status.ts (addStatus, cleanse), as a cast's landing does, and R6 the cooldown.
 */
function runTrigger(world: World, c: Extract<Combatant, { kind: "player" }>, a: TriggerAction): void {
  switch (a.do) {
    case "heal": {
      const amount = a.share * c.s.maxHp;
      const ignoreLockout = a.ignoreLockout === true;
      if (a.ms !== undefined && a.ms > 0) {
        const ms = a.ms;
        payLater(world, () => { startHealOverTime(world, c, amount, ms, ignoreLockout); });
        return;
      }
      payLater(world, () => { heal(world, c, amount, { ignoreLockout }); });
      return;
    }
    case "barrier": {
      const hp = a.share * c.s.maxHp;
      const until = world.state.serverTime + a.ms;
      payLater(world, () => { if (standing(c)) grantBarrier(c.s, c.rt, hp, until); });
      return;
    }
    case "status":
    case "cleanse":
    case "cooldown":
      return;
  }
}

/**
 * A heal of `amount` spread over `ms`: healOverTimeSteps(ms) equal steps HEAL_OVER_TIME_STEP_MS apart, the first now
 * (Second Wind: four steps of 5% of max hp, the last 1.5 s after the first). Each step goes through heal(), so it stops for
 * a fighter who is no longer standing, and never passes max hp. The teleport forgets the steps still to come.
 */
export function startHealOverTime(
  world: World, c: Extract<Combatant, { kind: "player" }>, amount: number, ms: number, ignoreLockout: boolean,
): void {
  if (!(amount > 0) || !standing(c)) return;
  const steps = healOverTimeSteps(ms);
  const each = amount / steps;
  heal(world, c, each, { ignoreLockout });
  if (steps > 1) {
    (c.rt.hots ??= []).push({ next: world.state.serverTime + HEAL_OVER_TIME_STEP_MS, left: steps - 1, amount: each, ignoreLockout });
  }
}

/** System: the steps of the heals over time that are due. A fighter who went down loses the rest. */
function healOverTime(world: World): void {
  const now = world.state.serverTime;
  for (const [id, rt] of world.players) {
    const hots = rt.hots;
    if (!hots || hots.length === 0) continue;
    const p = world.state.players.get(id);
    const c = p ? { kind: "player" as const, id, s: p, rt } : null;
    if (!c || !standing(c)) {
      hots.length = 0;
      continue;
    }
    for (const h of hots) {
      while (h.left > 0 && now >= h.next) {
        heal(world, c, h.amount, { ignoreLockout: h.ignoreLockout });
        h.left--;
        h.next += HEAL_OVER_TIME_STEP_MS;
      }
    }
    rt.hots = hots.filter((h) => h.left > 0);
  }
}

/** The teleport forgets the steps of every heal over time still to come (a fresh fight; the re-armed trigger may start its own). */
function dropHealsOverTime(world: World): void {
  for (const rt of world.players.values()) rt.hots = undefined;
}

/** The teleport: every once-trigger with `rearm: "teleport"` (Second Wind rank 2) may fire again. */
function rearmTriggers(world: World): void {
  for (const [id, rt] of world.players) {
    if (!rt.fired || rt.fired.size === 0) continue;
    const p = world.state.players.get(id);
    if (!p) continue;
    for (const { key, row } of triggersOf(p)) if (row.rearm === "teleport") rt.fired.delete(key);
  }
}
