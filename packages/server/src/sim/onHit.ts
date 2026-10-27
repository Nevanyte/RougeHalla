// The on-hit pipeline (roguelike R4b, finished by the balance pass; BALANCE_CONTRACT 3.3 and 4.6): what a landed hit applies to its
// victim besides the damage. It hangs on the ledger's `hitLanded` hook (sim/cardHooks.ts calls runOnHit), so it follows that hook's
// rule: it decides from what the entry and the pass-start memory say, and everything it writes is a status, which the status
// runtime defers until the pass is over (addStatus under `collecting` queues itself), so a status counts from the next tick and the
// order victims were applied in changes nothing.
//
// Three sources feed it, all multiplied by the same number k = (the weapon's on-hit power) x (the times the on-hit effects apply):
//   the weapon's special   the axe's armor shred (WEAPONS.axe.special): -AXE_SHRED_ARMOR armor for AXE_SHRED_MS, stacking to AXE_SHRED_CAP.
//                          Armor is a mod source (sim/cardHooks.ts shredSource) over the `shred` status: total armor stops at 0.
//   the cards' onHit rows  Hemorrhage's bleed: `per` of the hit's physical damage, dealt as a physical damage-over-time over `ms`. Each
//                          hit is its own bleed (a status instance of its own), so a hit every half second keeps about four going; a
//                          slow or an anti-heal row adds `per` strength per hit up to `cap` (the accumulating `add` of addStatus).
//                          The hit it reads is the one WITHOUT the attacker's `hit` mult (Boom's x2.5, Machine Gun's x0.5): a proc
//                          is a property of the swing, not of how hard it lands, so Machine Gun's twice-as-many swings are twice
//                          the bleeds (its whole point as a build-around) and Boom's few big ones are fewer.
//   on-hit power           the sword 1.5 and fists 1.2 (WeaponSpec.onHitPower), 1 for the rest.
// The times the effects apply is 1, plus one for Fists of Fury's `twiceUnarmed` flag while the hand is empty, plus one for Third Time's
// the Charm's `thirdCharm` flag on every third hit in a row on one target (the streak memory, sim/cardState.ts, as the pass began).
// A returned hit (a riposte, a reflected arrow, Fire's backlash, Spiked Shell's thorns) applies them too, for a holder with Eye for an
// Eye; a hit of `derived` entry (a splash) applies none.
import { WEAPONS, type DamageShares } from "@raid/shared";
import { hasFlag, hitMultOf, onHitsOf } from "./mods";
import { streakBefore } from "./cardState";
import { handIsEmpty, standing, type Combatant } from "./combatant";
import { addStatus } from "./status";
import type { LedgerEntry, World } from "./world";

/** What the pipeline reads of a hit: the weapon that dealt it, its packet as recorded (before any multiplier) and its scale. A ledger entry is one; so is a block counted as a hit. */
export type OnHitSource = Pick<LedgerEntry, "weapon" | "packet" | "scale">;

/** A bleed's damage is physical: armor cuts it. */
const PHYSICAL: DamageShares = { phys: 1, magic: 0, true: 0 };

/** How many times the on-hit effects of the attacker's hit apply: 1, Fists of Fury's one more while unarmed, Third Time's the Charm's on every 3rd hit in a row. */
export function onHitApplications(world: World, attacker: Combatant, victimId: string, countStreak: boolean): number {
  if (attacker.kind !== "player") return 1;
  let n = 1;
  if (hasFlag(attacker.s, "twiceUnarmed") && handIsEmpty(attacker.s)) n++;
  if (countStreak && hasFlag(attacker.s, "thirdCharm") && (streakBefore(world, attacker.id, victimId) + 1) % 3 === 0) n++;
  return n;
}

/**
 * Applies the on-hit effects of entry `e`, a hit by `attacker` that took damage off `victim`. `streak`: the hit is a weapon hit on a
 * target the streak memory knows (a returned hit has no streak, so Third Time's the Charm leaves it alone).
 */
export function runOnHit(world: World, attacker: Combatant, victim: Combatant, e: OnHitSource, streak: boolean): void {
  if (!standing(victim)) return;
  const spec = e.weapon !== null ? WEAPONS[e.weapon] : null;
  const k = (spec?.onHitPower ?? 1) * onHitApplications(world, attacker, victim.id, streak);
  const source = { id: attacker.id, name: attacker.s.name };
  const special = world.config.weaponSpecials === false ? undefined : spec?.special;
  if (special?.kind === "shred") {
    addStatus(world, victim, { kind: "shred", source, ms: special.ms, tag: "axe", add: { per: special.armor * k, cap: special.cap } }, { quiet: true });
  }
  const rows = attacker.kind === "player" ? onHitsOf(attacker.s) : [];
  for (const row of rows) {
    if (row.status === "dot") {
      // The hit as it was recorded, before the multipliers: the bleed is mitigated, and scaled by the attacker's rows and the PvP factor, when it ticks.
      const hit = streak ? hitMultOf(attacker.s) : 1;
      const raw = (e.packet.raw / (hit > 0 ? hit : 1)) * e.scale * e.packet.phys * row.per * k;
      if (!(raw > 0) || !(row.ms > 0)) continue;
      addStatus(world, victim, {
        kind: "dot", source, ms: row.ms, tag: `bleed:${world.state.tick}`, add: { per: raw / (row.ms / 1000), cap: Number.MAX_VALUE },
        data: { shares: PHYSICAL },
      }, { quiet: true });
    } else {
      addStatus(world, victim, {
        kind: row.status, source, ms: row.ms, tag: `onHit:${row.status}`, add: { per: row.per * k, cap: row.cap },
      }, { quiet: true });
    }
  }
}
