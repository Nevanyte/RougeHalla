// The per-tick damage ledger. The projectile sweep, the melee phase, the signature damage (beforeDamage, sim/factions.ts)
// and sudden death's burn (arena.ts) only record hits here; applyLedger() applies them all at once after that, so the shuffled order fighters were
// processed in never decides who hit first, and a fighter killed this tick still lands what it started. Each hit is
// mitigated by the victim's armor and shield (the faction damage law) and then goes through the one way down: applyHits
// (players), hurtMob (regional mobs) or damageMob (dummies). Rewards for the kills of a pass (GV, bounties, stacks,
// shields, drops) are queued while the damage lands and paid after the last victim has taken theirs (payLater), so a
// kill's spoils never decide who survives the pass.
//
// The outgoing multiplier (roguelike R4a): a weapon hit's or signature damage's raw damage is multiplied by its attacker's
// damage rows (stat damage, `vs` rows whose test holds against the victim, `scale` rows; sim/mods.ts outgoingMult) before
// armor and shield. Every entry's multiplier is fixed at the start of the pass, before any victim takes damage, from the
// hp fractions as they stood then, so the order victims are processed in never changes it. A Wish's ability entry (`ability`
// set: its damage and its damage-over-time chunks) is NOT multiplied: ability power is flat (owner ruling "Keep Wishes flat",
// GAME_DESIGN 8.9). The status runtime's damageFactor (Trial's zone, sim/status.ts) multiplies in after the rows, ability
// damage included (it is the one relative number); the status table is frozen during the pass (changes are queued with
// payLater), so it reads the same for every entry too. The arena's own burn and a dealer that is not a fighter in the world
// are never multiplied.
//
// The balance pass adds three things to the same place (BALANCE_CONTRACT 3.4, 4.6):
//   The PvP factor. An entry between two players (both in state.players; never a mob, a dummy, a Wish or the arena) is also
//     multiplied by pvpFactor(card power of its attacker), outside the damage rows' early return, and by the harness's
//     duelScale. Pass-start state again (a build changes only in the inputs phase), so no order decides it. The mark's clock
//     (sim/factions.ts) runs at the same factor, so equal-power fights keep their outcome and only their pace changes.
//   A Race to 0 (G4). A holder's entries are multiplied by 1 / its hp fraction as the pass began (up to HP_RACE_CAP), as are
//     the entries it takes. The extra damage it DEALS feeds no lifesteal: a landed hit carries the multiplier (`race`).
//   The caps (G2, G3), after mitigation in applyVictim: no player-to-player hit (not a damage-over-time tick) takes more than
//     PVP_HIT_CAP_SHARE of the victim's max hp, and one source's damage over time on one player no more than
//     PVP_DOT_CAP_SHARE of it per second (a budget per tick). They bound what a stack of cards can do in one blow.
import { cardPower, hpRaceMult, isDot, mitigateShares, PVP_DOT_CAP_SHARE, PVP_HIT_CAP_SHARE, pvpFactor, TICK_MS } from "@raid/shared";
import { applyHits, type Attacker, type Hit } from "./arena";
import { combatant, defenseOf, standing } from "./combatant";
import { hurtMob } from "./mobLife";
import { damageMob } from "./mobs";
import { outgoingMult, type VsProbe } from "./mods";
import { damageFactor } from "./status";
import { stagger } from "./weapons";
import { feedOfPlayer, lobbyMedianFeed } from "./feed";
import { emit, type DamageSource, type LandedHit, type LedgerEntry, type World } from "./world";

/**
 * Records a hit landing this tick. Returns the entry, so the melee phase can still scale a projectile's hit. Mobs never
 * hurt each other (a camp's archer must not shoot its neighbour): such a hit is recorded with scale 0, which the ledger
 * skips, so a swing or an arrow still meets the body but does nothing to it.
 */
export function recordHit(world: World, e: Omit<LedgerEntry, "scale"> & { scale?: number }): LedgerEntry {
  const mobOnMob = world.mobs.has(e.by.id) && world.mobs.has(e.victim);
  const entry: LedgerEntry = { ...e, scale: mobOnMob ? 0 : e.scale ?? 1 };
  world.combat.ledger.push(entry);
  // A mob that lands a hit on a player has not tired of the fight (its give-up timer counts what it deals, not what it takes).
  const brain = world.mobs.get(e.by.id)?.brain;
  if (brain && entry.scale > 0 && world.players.has(e.victim)) brain.lastCombatAt = world.state.serverTime;
  return entry;
}

/**
 * A player still in the run is credited as such; anyone else (a mob, a shooter who left or whose result is already
 * out) by name only, so a living player's hit in the same tick takes the kill instead of a dead shooter's arrow.
 */
function sourceOf(world: World, by: DamageSource): Attacker | string {
  const p = world.state.players.get(by.id);
  const rt = world.players.get(by.id);
  return p && rt && !rt.resolved ? { id: by.id, p, rt } : by.name;
}

export function applyLedger(world: World): void {
  const ledger = world.combat.ledger;
  world.combat.ledger = [];
  if (ledger.length === 0) return;
  const byVictim = new Map<string, LedgerEntry[]>();
  for (const e of ledger) {
    const list = byVictim.get(e.victim);
    if (list) list.push(e);
    else byVictim.set(e.victim, [e]);
  }
  // Before anything lands: every multiplier reads the hp as the pass began.
  const out = outgoingMults(world, ledger);
  const c0 = world.combat;
  // A pass that threw would have left its queue and snapshot behind: start clean.
  c0.payouts = [];
  c0.campWakes = [];
  c0.medianFeed = null;
  c0.collecting = true;
  // Every mob reward of the pass reads the lobby as it stood before it, not as kills earlier in the pass left it.
  c0.medianFeed = lobbyMedianFeed(world);
  try {
    for (const [id, entries] of byVictim) applyVictim(world, id, entries, out);
  } finally {
    c0.collecting = false;
  }
  // Everyone has taken their damage: survival is settled, the spoils can go out.
  const payouts = c0.payouts;
  c0.payouts = [];
  try {
    for (const pay of payouts) pay();
  } finally {
    c0.medianFeed = null;
  }
}

/** hp / maxHp of a fighter, or 1 when it has no hp bar (nothing is tested against it then). */
function hpFrac(world: World, id: string): number {
  const s = world.state.players.get(id) ?? world.state.mobs.get(id);
  return s && s.maxHp > 0 ? s.hp / s.maxHp : 1;
}

/**
 * The `vs` tests beyond hp (roguelike R5) for a hit by `by` on `victim`, answered from the state as it stands when asked:
 * outgoingMults asks before any victim of the pass takes damage, and kills pay their feed only after the pass, so every
 * answer is the pass's start. Lazy: nothing is read for an attacker without such a row.
 *   higherFeed  both are players and the victim's feed (kills + a quarter per mob kill) is above the attacker's.
 *   thirdParty  the victim's target lock, a mob victim's fight target, or its signature target (the last enemy it hit,
 *               sim/factions.ts) names someone other than the attacker.
 */
function vsProbe(world: World, by: string, victim: string): VsProbe {
  return {
    higherFeed: () => {
      const vp = world.state.players.get(victim);
      const vrt = world.players.get(victim);
      const ap = world.state.players.get(by);
      const art = world.players.get(by);
      return !!(vp && vrt && ap && art) && feedOfPlayer(vp, vrt) > feedOfPlayer(ap, art);
    },
    thirdParty: () => {
      const other = (t: string | null | undefined): boolean => t != null && t !== by;
      const lock = world.players.get(victim)?.weapon.lock ?? null;
      const fight = world.mobs.get(victim)?.brain?.target ?? null;
      const sig = world.factions?.fighters.get(victim)?.target ?? null;
      return other(lock) || other(fight) || other(sig);
    },
  };
}

/**
 * The PvP multiplier of attacker `by` against `victim`: pvpFactor(its card power) times the harness's duelScale, and 1 unless
 * both are players of the run (a mob, a dummy and a fighter that already left are never scaled). The mark's clock reads it too.
 */
export function pvpScale(world: World, by: string, victim: string): number {
  const a = world.state.players.get(by);
  if (!a || !world.state.players.has(victim)) return 1;
  const f = world.config.pvpRules === false ? 1 : pvpFactor(cardPower(a.build));
  const noise = world.combat.duelScale?.get(by);
  return noise === undefined ? f : f * noise;
}

/** The ceiling of a Race to 0 holder's multiplier (G4), or 0 for a fighter that holds none (see CombatScratch.hpRace). */
function hpRaceCapOf(world: World, id: string): number {
  // TODO(cards, agent A3): the card's folded `mult` row `hpRace` (sim/mods.ts) is the production source; `combat.hpRace` stays the override.
  return world.combat.hpRace?.get(id) ?? 0;
}

/** hp-fraction multiplier of the Race to 0 `id` holds (1 for everyone else), from the hp as the pass began. */
function hpRaceOf(world: World, id: string): number {
  const cap = hpRaceCapOf(world, id);
  return cap > 1 ? hpRaceMult(hpFrac(world, id), cap) : 1;
}

/** What outgoingMults answers: every entry's multiplier, and the Race to 0 share of it that lifesteal must not feed on. */
interface Outgoing {
  mult: ReadonlyMap<LedgerEntry, number>;
  /** The dealer's own Race to 0 multiplier inside `mult` (only entries where it is above 1). */
  race: ReadonlyMap<LedgerEntry, number>;
}

/** Each entry's outgoing multiplier (1 for most, and for every ability entry), from the state before the pass; only entries that differ are listed. */
function outgoingMults(world: World, ledger: readonly LedgerEntry[]): Outgoing {
  const mult = new Map<LedgerEntry, number>();
  const race = new Map<LedgerEntry, number>();
  for (const e of ledger) {
    // Ability power is flat (the Wishes' D12): a Wish's damage and its DoT chunks never read the caster's buffs.
    if (e.arena || e.ability !== undefined || !(e.scale > 0)) continue;
    const by = world.state.players.get(e.by.id) ?? world.state.mobs.get(e.by.id);
    if (!by) continue;
    const dealt = hpRaceOf(world, e.by.id);
    const m = outgoingMult(by, hpFrac(world, e.victim), vsProbe(world, e.by.id, e.victim))
      * pvpScale(world, e.by.id, e.victim) * dealt * hpRaceOf(world, e.victim);
    if (dealt !== 1) race.set(e, dealt);
    if (m !== 1) mult.set(e, m);
  }
  return { mult, race };
}

/**
 * The guards on player-to-player damage (G2, G3), applied to the amounts already mitigated: a hit (not a damage-over-time tick)
 * is cut to PVP_HIT_CAP_SHARE of the victim's max hp, and all of one source's damage over time on this victim in the tick to
 * its PVP_DOT_CAP_SHARE-per-second budget, shrinking each of its entries by the same factor. The world's damage (the arena,
 * mobs) is never capped.
 */
function capPvp(world: World, maxHp: number, entries: readonly LedgerEntry[], amounts: number[]): void {
  if (world.config.pvpRules === false) return;
  const hitCap = PVP_HIT_CAP_SHARE * maxHp;
  const dotBudget = PVP_DOT_CAP_SHARE * maxHp * (TICK_MS / 1000);
  const dotSum = new Map<string, number>();
  entries.forEach((e, i) => {
    if (e.arena || !(amounts[i]! > 0) || !world.state.players.has(e.by.id)) return;
    if (isDot(e.sig) || e.dot) dotSum.set(e.by.id, (dotSum.get(e.by.id) ?? 0) + amounts[i]!);
    else if (amounts[i]! > hitCap) amounts[i] = hitCap;
  });
  if (dotSum.size === 0) return;
  entries.forEach((e, i) => {
    if (e.arena || !(isDot(e.sig) || e.dot)) return;
    const sum = dotSum.get(e.by.id);
    if (sum !== undefined && sum > dotBudget) amounts[i] = amounts[i]! * (dotBudget / sum);
  });
}

function applyVictim(world: World, id: string, entries: LedgerEntry[], out: Outgoing): void {
  const c = combatant(world, id);
  if (!c || !standing(c)) return;
  const def = defenseOf(c.s);
  // Before mitigation: the attacker's outgoing rows (`out`, read as the pass began), then damageFactor (Trial's zone), the one
  // place a status changes the damage of every source. The arena's own burn is no one's hit.
  const amounts = entries.map((e) => {
    if (!(e.scale > 0)) return 0;
    const raw = e.packet.raw * e.scale * (out.mult.get(e) ?? 1) * (e.arena ? 1 : damageFactor(world, e.by.id, id));
    return mitigateShares(raw, e.packet, def);
  });
  if (c.kind === "player") capPvp(world, c.s.maxHp, entries, amounts);
  // A player's hits reach the one way down in the tick's secret order (players by rank, then anyone else), so an exact
  // tie for the kill never follows join order or the order the hits were recorded in. (The hit fx stay in entry order.)
  const rank = (i: number): number => world.combat.rank.get(entries[i]!.by.id) ?? Infinity;
  const order = entries.map((_, i) => i).sort((a, b) => rank(a) - rank(b));
  const barrierBefore = c.kind === "player" ? c.s.barrier : 0;
  const hpBefore = c.s.hp;
  const applied = c.kind === "player"
    ? applyHits(world, c.s, c.rt, order.map((i): Hit => ({ amount: amounts[i]!, source: sourceOf(world, entries[i]!.by) })))
    : c.s.kind === "dummy"
      ? damageMob(world, c, amounts)
      : hurtMob(world, c, order.map((i) => amounts[i]!), order.map((i) => entries[i]!));
  // Nothing got through (teleport immunity, a mob walking home): no numbers, no stagger.
  if (!(applied > 0)) return;
  // A survivor's own reactions to its hp (Blood Saint): they read only its own state and pay later.
  if (standing(c)) world.hooks.hurt?.(world, c, applied, hpBefore);
  // A regional mob has little hp: what a lifesteal can feed on is the hp the hits actually removed, not the overkill.
  let total = 0;
  for (const a of amounts) total += a;
  let landedShare = c.kind === "mob" && c.s.kind !== "dummy" && total > applied ? applied / total : 1;
  // What a kill barrier swallowed is not hp lost: lifesteal feeds on the rest.
  if (c.kind === "player" && barrierBefore > c.s.barrier && total > 0) landedShare = Math.max(0, 1 - (barrierBefore - c.s.barrier) / total);
  // The arena's own damage reports the hp it took, its share of what the pass removed (a measurement tap: WorldHooks.arenaHurt).
  const arenaHurt = world.hooks.arenaHurt;
  if (arenaHurt && total > 0) {
    entries.forEach((e, i) => { if (e.arena && amounts[i]! > 0) arenaHurt(world, id, e.by, (amounts[i]! * applied) / total); });
  }
  const hitLanded = world.hooks.hitLanded;
  entries.forEach((e, i) => {
    const amount = amounts[i]!;
    if (!(amount > 0) || e.arena) return;
    const landed: LandedHit = { victim: id, by: e.by.id, amount: amount * landedShare, weapon: e.weapon, sig: e.sig };
    if (e.ability !== undefined) landed.ability = e.ability;
    if (e.dot) landed.dot = true;
    const race = out.race.get(e);
    if (race !== undefined) landed.race = race;
    world.combat.landed.push(landed);
    // Damage over time is reported in chunks (sim/factions.ts, sim/abilities.ts).
    if (!(isDot(e.sig) || e.dot)) {
      const fx = { kind: "hit" as const, id, by: e.by.id, amount, weapon: e.weapon };
      const named = e.sig ? { ...fx, sig: e.sig } : fx;
      emit(world, { type: "fx", fx: e.ability !== undefined ? { ...named, ability: e.ability } : named });
    }
    // After the victim took the damage and its hit fx went out (on-hit effects: R4b; see WorldHooks.hitLanded). DoT entries too.
    hitLanded?.(world, e, amount);
  });
  if (standing(c) && entries.some((e, i) => e.stagger && amounts[i]! > 0)) stagger(world, c);
}
