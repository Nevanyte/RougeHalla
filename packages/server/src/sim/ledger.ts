// The per-tick damage ledger. The projectile sweep and the melee phase only record hits here; applyLedger() applies
// them all at once after melee, so the shuffled order fighters were processed in never decides who hit first, and a
// fighter killed this tick still lands what it started. Each hit is mitigated by the victim's armor and shield
// (the faction damage law) and then goes through the one way down: applyHits (players) or damageMob (mobs).
import { mitigateShares } from "@raid/shared";
import { applyHits, type Attacker, type Hit } from "./arena";
import { combatant, defenseOf, standing } from "./combatant";
import { hurtMob } from "./mobLife";
import { damageMob } from "./mobs";
import { stagger } from "./weapons";
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
  return entry;
}

/** A player still in the room is credited as such; anyone else (a mob, a shooter who left) by name only. */
function sourceOf(world: World, by: DamageSource): Attacker | string {
  const p = world.state.players.get(by.id);
  const rt = world.players.get(by.id);
  return p && rt ? { id: by.id, p, rt } : by.name;
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
  for (const [id, entries] of byVictim) {
    const c = combatant(world, id);
    if (!c || !standing(c)) continue;
    const def = defenseOf(c.s);
    const amounts = entries.map((e) => (e.scale > 0 ? mitigateShares(e.packet.raw * e.scale, e.packet, def) : 0));
    const applied = c.kind === "player"
      ? applyHits(world, c.s, c.rt, entries.map((e, i): Hit => ({ amount: amounts[i]!, source: sourceOf(world, e.by) })))
      : c.s.kind === "dummy" ? damageMob(world, c, amounts) : hurtMob(world, c, amounts, entries);
    // Nothing got through (teleport immunity): no numbers, no stagger.
    if (!(applied > 0)) continue;
    entries.forEach((e, i) => {
      if (amounts[i]! > 0) emit(world, { type: "fx", fx: { kind: "hit", id, by: e.by.id, amount: amounts[i]!, weapon: e.weapon } });
    });
    if (standing(c) && entries.some((e, i) => e.stagger && amounts[i]! > 0)) stagger(world, c);
  }
}
