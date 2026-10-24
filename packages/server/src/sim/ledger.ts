// The per-tick damage ledger. The projectile sweep and the melee phase only record hits here; applyLedger() applies
// them all at once after melee, so the shuffled order fighters were processed in never decides who hit first, and a
// fighter killed this tick still lands what it started. Each hit is mitigated by the victim's armor and shield
// (the faction damage law) and then goes through the one way down: applyHits (players) or damageMob (mobs).
import { mitigateShares } from "@raid/shared";
import { applyHits, type Attacker, type Hit } from "./arena";
import { combatant, defenseOf, standing } from "./combatant";
import { damageMob } from "./mobs";
import { stagger } from "./weapons";
import { emit, type DamageSource, type LedgerEntry, type World } from "./world";

/** Records a hit landing this tick. Returns the entry, so the melee phase can still scale a projectile's hit. */
export function recordHit(world: World, e: Omit<LedgerEntry, "scale"> & { scale?: number }): LedgerEntry {
  const entry: LedgerEntry = { ...e, scale: e.scale ?? 1 };
  world.combat.ledger.push(entry);
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
  // A player's hits reach applyHits in the tick's secret order (players by rank, then anyone else), so an exact tie for
  // the kill never follows join order or the order the hits were recorded in.
  const rank = (h: { by: string }) => world.combat.rank.get(h.by) ?? Infinity;
  for (const [id, entries] of byVictim) {
    const c = combatant(world, id);
    if (!c || !standing(c)) continue;
    const def = defenseOf(c.s);
    const amounts = entries.map((e) => (e.scale > 0 ? mitigateShares(e.packet.raw * e.scale, e.packet, def) : 0));
    const ranked = entries.map((e, i) => ({ by: e.by.id, hit: { amount: amounts[i]!, source: sourceOf(world, e.by) } as Hit }))
      .sort((a, b) => rank(a) - rank(b));
    const applied = c.kind === "player"
      ? applyHits(world, c.s, c.rt, ranked.map((r) => r.hit))
      : damageMob(world, c, amounts);
    // Nothing got through (teleport immunity): no numbers, no stagger.
    if (!(applied > 0)) continue;
    entries.forEach((e, i) => {
      if (amounts[i]! > 0) emit(world, { type: "fx", fx: { kind: "hit", id, by: e.by.id, amount: amounts[i]!, weapon: e.weapon } });
    });
    if (standing(c) && entries.some((e, i) => e.stagger && amounts[i]! > 0)) stagger(world, c);
  }
}
