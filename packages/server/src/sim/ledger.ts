// The per-tick damage ledger. The projectile sweep and the melee phase only record hits here; applyLedger() applies
// them all at once after melee, so the shuffled order fighters were processed in never decides who hit first, and a
// fighter killed this tick still lands what it started. Each hit is mitigated by the victim's armor and shield
// (the faction damage law) and then goes through the one way down: applyHits (players), hurtMob (regional mobs) or
// damageMob (dummies). Rewards for the kills of a pass (GV, bounties, stacks, shields, drops) are queued while the damage
// lands and paid after the last victim has taken theirs (payLater), so a kill's spoils never decide who survives the pass.
import { mitigateShares } from "@raid/shared";
import { applyHits, type Attacker, type Hit } from "./arena";
import { combatant, defenseOf, standing } from "./combatant";
import { hurtMob } from "./mobLife";
import { damageMob } from "./mobs";
import { stagger } from "./weapons";
import { lobbyMedianFeed } from "./feed";
import { emit, type DamageSource, type LedgerEntry, type World } from "./world";

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
  const c0 = world.combat;
  c0.collecting = true;
  // Every mob reward of the pass reads the lobby as it stood before it, not as kills earlier in the pass left it.
  c0.medianFeed = lobbyMedianFeed(world);
  try {
    for (const [id, entries] of byVictim) applyVictim(world, id, entries);
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

function applyVictim(world: World, id: string, entries: LedgerEntry[]): void {
  const c = combatant(world, id);
  if (!c || !standing(c)) return;
  const def = defenseOf(c.s);
  const amounts = entries.map((e) => (e.scale > 0 ? mitigateShares(e.packet.raw * e.scale, e.packet, def) : 0));
  // A player's hits reach the one way down in the tick's secret order (players by rank, then anyone else), so an exact
  // tie for the kill never follows join order or the order the hits were recorded in. (The hit fx stay in entry order.)
  const rank = (i: number): number => world.combat.rank.get(entries[i]!.by.id) ?? Infinity;
  const order = entries.map((_, i) => i).sort((a, b) => rank(a) - rank(b));
  const applied = c.kind === "player"
    ? applyHits(world, c.s, c.rt, order.map((i): Hit => ({ amount: amounts[i]!, source: sourceOf(world, entries[i]!.by) })))
    : c.s.kind === "dummy"
      ? damageMob(world, c, amounts)
      : hurtMob(world, c, order.map((i) => amounts[i]!), order.map((i) => entries[i]!));
  // Nothing got through (teleport immunity): no numbers, no stagger.
  if (!(applied > 0)) return;
  entries.forEach((e, i) => {
    if (amounts[i]! > 0) emit(world, { type: "fx", fx: { kind: "hit", id, by: e.by.id, amount: amounts[i]!, weapon: e.weapon } });
  });
  if (standing(c) && entries.some((e, i) => e.stagger && amounts[i]! > 0)) stagger(world, c);
}
