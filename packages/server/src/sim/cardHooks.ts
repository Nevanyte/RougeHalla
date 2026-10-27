// The phase-B cards' hooks (balance pass, BALANCE_CONTRACT 4.4 and 4.6, agent A4): the machinery of the cards that are not a number
// on a stat sheet. The cards themselves are rows (shared/cards.ts: a stat, a flag, a trigger, an onHit row); this module reads them
// and answers three events of the tick plus one system, and every answer obeys the ledger's rules (CLAUDE.md "The ledger", "hitLanded"):
//
//   hitLanded   once per ledger entry that took damage, in the pass. It decides from the entry and the memory as the pass began, and
//               writes only statuses (deferred by the status runtime), payLater closures and entries for the NEXT tick's ledger
//               (sim/ledger.ts deferHit): the on-hit effects (sim/onHit.ts: the axe's shred, Hemorrhage's bleed, the sword's and
//               fists' power, Fists of Fury, Third Time's the Charm, Eye for an Eye) and the triggers on a hit TAKEN (Adrenaline's
//               boost, Spiked Shell's returned damage).
//   blocked     a shield stopped part of a hit (sim/melee.ts, sim/projectiles.ts; outside the pass): Tank Engine's tally, Pocket Sand's
//               slow, and Best Offense, which makes the block a hit for the streak, the on-hit effects and Wishful Thinking.
//   overkilled  the pass killed a victim with damage to spare: Overkill's splash, found after the pass (payLater) and queued for the next tick.
//   system      after the damage: the streak memory of the hits that landed (so every entry of a pass read the same count), Wishful
//               Thinking's cooldown cut, Plant Your Feet's stillness clock, and the chunked report of bleed damage.
// The mod source adds what statuses and timers give the stat mirrors: the axe's shred (a negative armor bonus) and Adrenaline's attack
// and move speed. Crits and Plant Your Feet's damage are decided in the weapon phase (sim/weapons.ts), Gambler in the ledger, the
// damage-over-time crit in sim/factions.ts and sim/abilities.ts, Festering Arcana in sim/factions.ts; they share sim/cardState.ts.
import {
  DOT_FX_MS, mitigateShares, STREAK_GAP_SECONDS, WEAPONS, WISHFUL_BUDGET_MS, WISHFUL_FLOOR_SHARE, WISHFUL_WINDOW_MS,
  type EffectOf, type Vec2,
} from "@raid/shared";
import type { PlayerState } from "@raid/shared/schema";
import { syncMaxHp } from "./buffs";
import { cardsOf } from "./cardState";
import {
  activeWeapon, combatant, defenseOf, hostile, isEvading, isQuestGiver, standing, standingCombatants, type Combatant,
} from "./combatant";
import { deferHit } from "./ledger";
import { hasFlag, outgoingKindOf, recomputeMods, returnedMultOf, setFlatMaxHp, triggersOf } from "./mods";
import { runOnHit } from "./onHit";
import { addStatus, isUntargetable, statusValue } from "./status";
import { packetFor } from "./weapons";
import {
  chainHook, emit, payLater, tieRank, type DamagePacket, type LandedHit, type LedgerEntry, type ModContribution, type OverkillHit,
  type PlayerRuntime, type World,
} from "./world";

type TriggerRow = EffectOf<"trigger">;

export function install(world: World): void {
  chainHook(world, "hitLanded", onHitLanded);
  chainHook(world, "blocked", onBlocked);
  chainHook(world, "overkilled", onOverkilled);
  chainHook(world, "raidStarted", resetAll);
  // A fresh fight in the coliseum: no streak and no boost survive the teleport (every status ends there too).
  chainHook(world, "teleported", resetFight);
  // What a pass queued for the next tick (a return, a splash) answers a fight that is over: it must not land on a mob the teleport just put back.
  chainHook(world, "teleported", dropDeferred);
  chainHook(world, "runEnded", dropDeferred);
  chainHook(world, "runEnded", flushBleeds);
  world.modSources.push(cardSource);
  world.systems.push(afterDamage);
}

// ------------------------------------------------------------------------------------------------------------------- the mirrors

/**
 * What cards and statuses give the stat mirrors besides the rows: the axe's shred takes its value off the armor (the armor mirror dips
 * below 0; defenseOf stops the total at 0), and Adrenaline multiplies attack speed and move speed until it ends. Re-asked every tick
 * by updateMods, so an expiry shows by the end of its tick.
 */
function cardSource(world: World, c: Combatant): ModContribution | null {
  const shred = statusValue(world, c, "shred");
  const boost = c.kind === "player" && c.rt.cards && c.rt.cards.boostUntil > world.state.serverTime ? c.rt.cards : null;
  if (!(shred > 0) && !boost) return null;
  const out: ModContribution = {};
  if (shred > 0) out.armor = -shred;
  if (boost) {
    out.asMult = boost.boostAs;
    out.speedMult = boost.boostMove;
  }
  return out;
}

function resetAll(world: World): void {
  for (const rt of world.players.values()) rt.cards = undefined;
  pending.delete(world);
  bleeds.delete(world);
}

function dropDeferred(world: World): void {
  world.combat.deferred = [];
}

function resetFight(world: World): void {
  for (const [id, rt] of world.players) {
    const cards = rt.cards;
    if (!cards) continue;
    cards.streak = null;
    if (cards.boostUntil > 0) {
      cards.boostUntil = 0;
      const c = combatant(world, id);
      if (c) recomputeMods(world, c);
    }
  }
  pending.delete(world);
}

// ----------------------------------------------------------------------------------------------------------------------- a hit lands

function triggersOn(c: Combatant, on: TriggerRow["on"]): TriggerRow[] {
  let out: TriggerRow[] | null = null;
  for (const { row } of triggersOf(c.s)) if (row.on === on) (out ??= []).push(row);
  return out ?? NO_ROWS;
}
const NO_ROWS: TriggerRow[] = [];

/** Is the weapon a melee one (it swings)? */
const swings = (weapon: LedgerEntry["weapon"]): boolean => weapon !== null && WEAPONS[weapon].shape.kind === "arc";

/**
 * hitLanded (in the pass): the victim's triggers on a hit taken, and the attacker's on-hit effects. A follow-on (`derived`) sets off
 * nothing; a damage-over-time tick, an ability's damage and the arena's burn are no hit; returned damage applies the on-hit effects only
 * for an Eye for an Eye holder and sets off no trigger (so two Spiked Shells never answer each other without end).
 */
function onHitLanded(world: World, e: LedgerEntry, applied: number): void {
  if (e.arena || e.derived) return;
  const kind = outgoingKindOf(e);
  if (kind !== "hit" && kind !== "returned") return;
  const victim = combatant(world, e.victim);
  const attacker = combatant(world, e.by.id);
  if (kind === "hit" && victim && victim.kind === "player" && attacker) hitTaken(world, victim, attacker, e, applied);
  if (!attacker || !victim) return;
  if (kind === "hit") runOnHit(world, attacker, victim, e, true);
  else if (attacker.kind === "player" && hasFlag(attacker.s, "eyeForAnEye")) runOnHit(world, attacker, victim, e, false);
}

/** The triggers of `on: "hitTaken"` of a player that took `applied` off `e`: Adrenaline's boost and Spiked Shell's returned damage (any `status` verb works too). */
function hitTaken(world: World, victim: Extract<Combatant, { kind: "player" }>, attacker: Combatant, e: LedgerEntry, applied: number): void {
  for (const row of triggersOn(victim, "hitTaken")) {
    if (row.arg > 0 && !(victim.s.maxHp > 0 && applied >= row.arg * victim.s.maxHp - 1e-9)) continue;
    const a = row.do;
    switch (a.do) {
      case "boost": {
        const boost = a;
        payLater(world, () => startBoost(world, victim, boost.as, boost.move, boost.ms));
        break;
      }
      case "return": {
        if (a.melee && !swings(e.weapon)) break;
        const weapon = activeWeapon(victim.s);
        // A share of what the hit took, as physical damage; Boom's `returned` mult is in it, and the attacker's own armor cuts it.
        deferHit(world, {
          victim: attacker.id, by: { id: victim.id, name: victim.s.name },
          packet: { raw: a.share * applied * returnedMultOf(victim.s), phys: 1, magic: 0, true: 0 }, weapon, stagger: false,
          passive: true, final: true,
        });
        break;
      }
      case "status": {
        const target = a.to === "self" ? victim : attacker;
        addStatus(world, target, {
          kind: a.status, source: { id: victim.id, name: victim.s.name }, ms: a.ms, tag: "hitTaken", ...(a.value !== undefined ? { value: a.value } : {}),
        }, { quiet: true });
        break;
      }
      default: break;
    }
  }
}

function startBoost(world: World, c: Extract<Combatant, { kind: "player" }>, as: number, move: number, ms: number): void {
  if (!standing(c)) return;
  const cards = cardsOf(c.rt);
  const now = world.state.serverTime;
  // A boost still running keeps its stronger factors; a lapsed one starts over. Either way the end moves to the later time.
  const running = cards.boostUntil > now;
  cards.boostAs = Math.max(running ? cards.boostAs : 1, 1 + as);
  cards.boostMove = Math.max(running ? cards.boostMove : 1, 1 + move);
  cards.boostUntil = Math.max(cards.boostUntil, now + ms);
  recomputeMods(world, c);
}

// ------------------------------------------------------------------------------------------------------------------------- a block

/** A block that Best Offense turns into a hit: `holder` hit `victim` (the blocked attacker) with its own weapon. */
interface BlockHit { by: string; victim: string }
const pending = new WeakMap<World, BlockHit[]>();

/**
 * blocked (outside the pass): `holder`'s shield stopped `prevented` of a hit by `attacker`. Tank Engine adds the damage the block
 * really kept off the holder to its tally and earns max health from it; a `block` status trigger (Pocket Sand) is applied to the
 * attacker at once; Best Offense makes the block a hit: the on-hit effects apply now and the streak and Wishful Thinking hear of it after
 * the pass (the system), like any hit.
 */
function onBlocked(world: World, holder: Combatant, attacker: Combatant, prevented: DamagePacket, _melee: boolean): void {
  if (holder.kind !== "player") return;
  for (const row of triggersOn(holder, "block")) {
    const a = row.do;
    if (a.do === "fortify") {
      const cards = cardsOf(holder.rt);
      cards.prevented += mitigateShares(prevented.raw, prevented, defenseOf(holder.s));
      const earned = Math.min(a.cap, cards.prevented * a.per);
      if (earned > cards.tankHp + 1e-9) {
        cards.tankHp = earned;
        setFlatMaxHp(holder.s, earned);
        syncMaxHp(holder.s);
      }
    } else if (a.do === "status") {
      const target = a.to === "self" ? holder : attacker;
      addStatus(world, target, {
        kind: a.status, source: { id: holder.id, name: holder.s.name }, ms: a.ms, tag: "block", ...(a.value !== undefined ? { value: a.value } : {}),
      }, { quiet: true });
    }
  }
  if (hasFlag(holder.s, "blockHits") && standing(holder)) {
    const weapon = activeWeapon(holder.s);
    if (weapon) {
      // The block's "hit" is the holder's own blow with the weapon in hand (what its bash would have dealt).
      runOnHit(world, holder, attacker, { weapon, packet: packetFor(holder, weapon), scale: 1 }, true);
      let list = pending.get(world);
      if (!list) pending.set(world, list = []);
      list.push({ by: holder.id, victim: attacker.id });
    }
  }
}

// ------------------------------------------------------------------------------------------------------------------------ overkill

/**
 * overkilled (in the pass): the pass killed `victim` with `overkill` of the damage to spare. Each entry of an Overkill holder gets the
 * share of it that its damage was of the total, and after the pass (payLater, when who still stands is settled) that share, as damage
 * of the entry's own type, goes to the nearest enemy of the holder within the card's radius of the victim: an entry for the NEXT tick's
 * ledger, `final` (it already carries the multipliers the first hit did) and `derived` (it sets off nothing).
 */
function onOverkilled(world: World, victim: Combatant, hits: readonly OverkillHit[], overkill: number, total: number): void {
  if (!(total > 0)) return;
  for (const h of hits) {
    const e = h.entry;
    if (e.derived || e.final) continue;
    const holder = combatant(world, e.by.id);
    if (!holder || holder.kind !== "player") continue;
    for (const row of triggersOn(holder, "kill")) {
      if (row.do.do !== "splash") continue;
      const radius = row.do.radius;
      const raw = h.raw * (overkill / total);
      if (!(raw > 0)) continue;
      const at: Vec2 = { x: victim.s.x, y: victim.s.y };
      const victimId = victim.id;
      payLater(world, () => splashOverkill(world, holder, victimId, at, radius, e, raw));
    }
  }
}

function splashOverkill(world: World, holder: Combatant, victimId: string, at: Vec2, radius: number, e: LedgerEntry, raw: number): void {
  const now = world.state.serverTime;
  let best: Combatant | null = null;
  let bestD = Infinity;
  for (const c of standingCombatants(world)) {
    if (c.id === holder.id || c.id === victimId || !hostile(holder, c) || isEvading(c) || isQuestGiver(c) || isUntargetable(world, c)) continue;
    if (c.kind === "player" && now < c.s.immuneUntil) continue;
    const d = Math.hypot(c.s.x - at.x, c.s.y - at.y);
    if (d > radius) continue;
    if (d < bestD - 1e-9 || (Math.abs(d - bestD) <= 1e-9 && best !== null && tieRank(world, c.id) < tieRank(world, best.id))) {
      best = c;
      bestD = d;
    }
  }
  if (!best) return;
  deferHit(world, {
    victim: best.id, by: e.by, packet: { raw, phys: e.packet.phys, magic: e.packet.magic, true: e.packet.true }, weapon: e.weapon,
    stagger: false, derived: true, final: true,
  });
}

// ------------------------------------------------------------------------------------------------------------------ after the pass

/** What a bleed (or a Festering Arcana tail) dealt, by victim and source, for the chunked hit fx. */
interface BleedReport { since: number; by: Map<string, { victim: string; by: string; amount: number }> }
const bleeds = new WeakMap<World, BleedReport>();

function bleedsOf(world: World): BleedReport {
  let r = bleeds.get(world);
  if (!r) bleeds.set(world, r = { since: world.state.serverTime, by: new Map() });
  return r;
}

/** One `hit` fx per pair for the card damage over time landed since the last report (no weapon, signature or ability: the client draws it as a drip). */
function flushBleeds(world: World): void {
  const r = bleeds.get(world);
  if (!r) return;
  for (const d of r.by.values()) {
    emit(world, { type: "fx", fx: { kind: "hit", id: d.victim, by: d.by, amount: d.amount, weapon: null } });
  }
  r.by.clear();
  r.since = world.state.serverTime;
}

/** A hit of a weapon: not damage over time, an ability's damage, a signature, a returned hit or a follow-on. */
const isWeaponHit = (h: LandedHit): boolean =>
  h.weapon !== null && h.sig === undefined && h.ability === undefined && h.dot !== true && h.passive !== true && h.derived !== true;

/**
 * system: the streak memory and Wishful Thinking hear of the tick's hits (a block under Best Offense is one too); Plant Your Feet's
 * clock follows the players' feet; card damage over time is reported in chunks. Hits are grouped by attacker first, and every
 * decision below depends on the group alone (the streak keeps its target if it was hit, else takes the biggest hit with the tick's
 * tie-break), so the order the pass applied them in decides nothing.
 */
function afterDamage(world: World): void {
  const now = world.state.serverTime;
  const hits = new Map<string, Map<string, { damage: number; n: number }>>();
  const note = (by: string, victim: string, damage: number): void => {
    let m = hits.get(by);
    if (!m) hits.set(by, m = new Map());
    const cur = m.get(victim);
    if (cur) { cur.damage += damage; cur.n++; } else m.set(victim, { damage, n: 1 });
  };
  for (const h of world.combat.landed) {
    if (h.dot === true && h.ability === undefined && h.sig === undefined) {
      const key = `${h.victim}|${h.by}`;
      const r = bleedsOf(world);
      const acc = r.by.get(key);
      if (acc) acc.amount += h.amount;
      else r.by.set(key, { victim: h.victim, by: h.by, amount: h.amount });
    } else if (isWeaponHit(h)) note(h.by, h.victim, h.amount);
  }
  const blocks = pending.get(world);
  if (blocks) {
    for (const b of blocks) note(b.by, b.victim, 0);
    pending.delete(world);
  }
  for (const [by, victims] of hits) {
    const rt = world.players.get(by);
    const p = world.state.players.get(by);
    if (!rt || !p) continue;
    noteStreak(world, by, victims);
    wishfulThinking(world, by, p, rt, [...victims.values()].reduce((n, v) => n + v.n, 0));
  }
  stillness(world, now);
  const report = bleeds.get(world);
  if (report && now - report.since >= DOT_FX_MS) flushBleeds(world);
}

/** The attacker's streak: kept (one more per hit) if its target was hit this tick, else restarted on the biggest hit (ties by the tick's hash rank). */
function noteStreak(world: World, by: string, victims: ReadonlyMap<string, { damage: number; n: number }>): void {
  const rt = world.players.get(by);
  if (!rt) return;
  const now = world.state.serverTime;
  const cards = cardsOf(rt);
  const mem = cards.streak;
  const live = mem !== null && now - mem.last < STREAK_GAP_MS;
  const same = live ? victims.get(mem!.target) : undefined;
  if (mem && same) {
    mem.count += same.n;
    mem.last = now;
    return;
  }
  let target: string | null = null;
  let best = -1;
  for (const [id, v] of victims) {
    if (v.damage > best || (v.damage === best && target !== null && tieRank(world, id) < tieRank(world, target))) {
      target = id;
      best = v.damage;
    }
  }
  if (target !== null) cards.streak = { target, count: victims.get(target)!.n, last: now };
}
const STREAK_GAP_MS = STREAK_GAP_SECONDS * 1000;

/**
 * Wishful Thinking (G13): `n` hits landed this tick, each shortening the Wish's cooldown by the card's `ms`. Only a Wish that is on
 * cooldown from a cast is shortened (the opening lock is no cooldown), by at most WISHFUL_BUDGET_MS in any window of
 * WISHFUL_WINDOW_MS, and never to less than WISHFUL_FLOOR_SHARE of the cooldown it was cast with.
 */
function wishfulThinking(world: World, by: string, p: PlayerState, rt: PlayerRuntime, n: number): void {
  const c = combatant(world, by);
  if (!c || c.kind !== "player") return;
  let ms = 0;
  for (const row of triggersOn(c, "hit")) if (row.do.do === "cooldown") ms += row.do.ms;
  if (!(ms > 0)) return;
  const cards = cardsOf(rt);
  const cast = cards.wishCast;
  const now = world.state.serverTime;
  if (!cast || !(p.wishReadyAt > now)) return;
  cards.trims = cards.trims.filter((t) => now - t.at < WISHFUL_WINDOW_MS);
  const used = cards.trims.reduce((sum, t) => sum + t.ms, 0);
  const floorAt = Math.max(now, cast.at + WISHFUL_FLOOR_SHARE * cast.cooldownMs);
  const cut = Math.min(n * ms, WISHFUL_BUDGET_MS - used, p.wishReadyAt - floorAt);
  if (!(cut > 0)) return;
  p.wishReadyAt -= cut;
  cards.trims.push({ at: now, ms: cut });
}

/** Plant Your Feet's clock: a player that moved since the last check was last seen moving now. */
function stillness(world: World, now: number): void {
  for (const [id, p] of world.state.players) {
    if (!hasFlag(p, "plantFeet")) continue;
    const rt = world.players.get(id);
    if (!rt) continue;
    const cards = cardsOf(rt);
    if (!(Math.abs(p.x - cards.stillX) <= 0.01 && Math.abs(p.y - cards.stillY) <= 0.01) || p.status !== "alive") {
      cards.stillSince = now;
      cards.stillX = p.x;
      cards.stillY = p.y;
    }
  }
}
