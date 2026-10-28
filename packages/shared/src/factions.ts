// The five factions and the universal combat law, ported 1:1 from testing/engine.py and
// testing/classes.py (the balance pass's compressed sheet, BALANCE_CONTRACT 5.2; the design source of truth is
// testing/CLASS_SHEET.md and testing/TUNING_BALANCE.md). Pure: the duel() here must keep reproducing the Python
// reference results (packages/shared/test/factions.test.ts).
//
// Rules of the law: every damage packet splits into physical / magic / true shares (a property of
// the attacker, or, for a signature part, of the signature: SIGNATURE_SHARES); armor cuts the physical share, shield
// the magic share, true ignores both, each as 1 / (1 + stat/100). Signature mechanics read only the attacker's own
// params and universal state, never the opponent's identity, so counters emerge from the numbers alone.
import { DUEL_PACE, MARK_TOP_TIER } from "./constants";
import { markTierOf, taxedRate } from "./mark";
import { SIGNATURE_SHARES } from "./signatureShares";
import type { SignatureKind } from "./signatures";

export type FactionId = "fire" | "sentenced" | "plague" | "frost" | "holy";
export type MechanicId = "dragonslayer" | "marked" | "rat_king" | "plain";

export interface FactionSpec {
  id: FactionId;
  /** Design-sheet name (stable key used in docs and tests). */
  name: string;
  /** Name shown to players; differs from `name` only where the theme renames the faction. */
  displayName: string;
  role: string;
  theme: string;
  /** Display colour (client only). */
  color: number;
  hp: number;
  /** Attacks per second. */
  rate: number;
  /** Raw damage per attack. */
  hit: number;
  /** Share of damage reduced by armor. */
  phys: number;
  /** Share that ignores all defense. The rest (1 − phys − trueShare) is magic, reduced by shield. */
  trueShare: number;
  armor: number;
  shield: number;
  mechanic: MechanicId;
  aura?: "wall_of_ice";
  sustain?: "radiant";
  params: Readonly<Record<string, number>>;
}

export const FACTIONS: Readonly<Record<FactionId, FactionSpec>> = {
  fire: {
    id: "fire", name: "Fire", displayName: "Fire", role: "Glass-cannon duelist", theme: "Dragonslayer, living fire", color: 0xff7043,
    hp: 835, rate: 0.6, hit: 100, phys: 0.0, trueShare: 0.0, armor: 0, shield: 45,
    mechanic: "dragonslayer", params: { burn: 18, backlash: 145 },
  },
  sentenced: {
    id: "sentenced", name: "Sentenced", displayName: "Sentenced", role: "Patient executioner", theme: "Marked for judgment", color: 0x9575cd,
    hp: 1050, rate: 0.9, hit: 20, phys: 0.9, trueShare: 0.0, armor: 150, shield: 240,
    mechanic: "marked", params: { mark_pct: 0.019, mark_kill: 0.00475, mark_amp: 1.5, tier_hits: 3, tax_keep: 0.5, tax_cap: 1.6, suppress: 0.8 },
  },
  plague: {
    id: "plague", name: "Plague", displayName: "Plague", role: "Attrition swarm", theme: "Rat King, disease", color: 0x9ccc65,
    hp: 1375, rate: 1.85, hit: 20, phys: 0.8, trueShare: 0.0, armor: 190, shield: 0,
    mechanic: "rat_king", params: { plague: 43, execute: 415 },
  },
  frost: {
    id: "frost", name: "Frost", displayName: "Frost", role: "Control bruiser", theme: "Living wall of ice", color: 0x4fc3f7,
    hp: 1200, rate: 0.45, hit: 175, phys: 0.9, trueShare: 0.0, armor: 20, shield: 190,
    mechanic: "plain", aura: "wall_of_ice", params: { slow: 0.52 },
  },
  holy: {
    id: "holy", name: "Holy", displayName: "Demon Blood", role: "Sustain juggernaut", theme: "Light that burns brighter near death", color: 0xfff176,
    hp: 1400, rate: 0.95, hit: 96, phys: 1.0, trueShare: 0.0, armor: 0, shield: 250,
    mechanic: "plain", sustain: "radiant", params: { ls0: 0.1, ls1: 0.8, ls_cap: 0.75 },
  },
};

export const FACTION_IDS: readonly FactionId[] = ["fire", "sentenced", "plague", "frost", "holy"];

/** The designed cycle: each faction beats exactly two others. (winner, loser) */
export const BEATS: ReadonlyArray<readonly [FactionId, FactionId]> = [
  ["fire", "sentenced"], ["fire", "plague"],
  ["sentenced", "plague"], ["sentenced", "frost"],
  ["plague", "frost"], ["plague", "holy"],
  ["frost", "holy"], ["frost", "fire"],
  ["holy", "fire"], ["holy", "sentenced"],
];

/**
 * The faction of a player who joined without picking one (bots, old clients): the n-th player to join a room gets the
 * n-th faction in FACTION_IDS order (round-robin), so a lobby of five such players has one of each.
 */
export function defaultFaction(joinIndex: number): FactionId {
  return FACTION_IDS[((joinIndex % FACTION_IDS.length) + FACTION_IDS.length) % FACTION_IDS.length]!;
}

export function isFactionId(v: unknown): v is FactionId {
  return typeof v === "string" && (FACTION_IDS as readonly string[]).includes(v);
}

export function magicShare(spec: FactionSpec): number {
  return Math.max(0, 1 - spec.phys - spec.trueShare);
}

/** Universal state a mechanic may read. No opponent identity. */
export interface CombatState {
  /** Seconds since the engagement began. */
  t: number;
  ownRate: number;
  foeRate: number;
  ownHpFrac: number;
  foeHpFrac: number;
  /** The target's max hp (the mark is a share of it). */
  foeMaxHp: number;
  /** Attacks landed so far (the integral of the attack rate): the mark climbs by them. */
  ownHits: number;
  /** Stacks earned (a denied execute is worth one, once). */
  ownStacks: number;
  /** The fighter's attack rate before any aura: what a hit's weight is paid back to. */
  ownBaseRate: number;
}

/** One signature part: its kind, its raw damage per second, and whether it is an execute (a tier-4 mark can deny it). */
export type BonusPart = readonly [SignatureKind, number, boolean?];

/**
 * Bonus raw damage per second added on top of rate × hit, split into its signature parts (each is mitigated as its own
 * damage type: SIGNATURE_SHARES). Listed in the order the Python engine adds them; the execute is a part of its own (the
 * third element) so the mark's denial can find it.
 */
export function bonusParts(spec: FactionSpec, s: CombatState): ReadonlyArray<BonusPart> {
  const p = spec.params;
  switch (spec.mechanic) {
    case "dragonslayer": return [["burn", p.burn!], ["backlash", p.backlash! * s.foeRate]];
    case "rat_king": return [["disease", p.plague!], ["disease", p.execute! * Math.max(0, 0.5 - s.foeHpFrac), true]];
    case "marked": {
      const tier = markTierOf(s.ownHits, 0, p.tier_hits!);
      if (tier === 0) return [];
      const pct = p.mark_pct! + p.mark_kill! * s.ownStacks;
      return [["mark", s.ownBaseRate * pct * s.foeMaxHp * (tier >= MARK_TOP_TIER ? p.mark_amp! : 1)]];
    }
    default: return [];
  }
}

/** The signature bonus as one number: the raw damage per second of every part together, before any mitigation. */
export function bonusDps(spec: FactionSpec, s: CombatState): number {
  let sum = 0;
  for (const [, v] of bonusParts(spec, s)) sum += v;
  return sum;
}

/** What a mechanic does to its opponent beyond damage (engine.py PRESSURE): the tax on its attack rate, the cut to its output, a denied execute. */
export interface Pressure { foeRate: number; foeOut: number; denyExecute: boolean }

export function pressureOf(spec: FactionSpec, s: CombatState): Pressure {
  if (spec.mechanic !== "marked") return { foeRate: s.foeRate, foeOut: 1, denyExecute: false };
  const p = spec.params;
  const tier = markTierOf(s.ownHits, 0, p.tier_hits!);
  return {
    foeRate: tier >= 2 ? taxedRate(s.foeRate, p.tax_keep!, p.tax_cap!) : s.foeRate,
    foeOut: tier >= 3 ? p.suppress! : 1,
    denyExecute: tier >= MARK_TOP_TIER,
  };
}

/** Multiplier this faction's aura applies to its opponent's attack rate (1 = none). */
export function auraRateMultiplier(spec: FactionSpec): number {
  return spec.aura === "wall_of_ice" ? 1 - spec.params.slow! : 1;
}

/** Fraction of post-mitigation damage dealt that heals the dealer. */
export function lifestealFraction(spec: FactionSpec, ownHpFrac: number): number {
  if (spec.sustain !== "radiant") return 0;
  const p = spec.params;
  return Math.min(p.ls_cap!, p.ls0! + p.ls1! * (1 - ownHpFrac));
}

/** Universal damage law. The defender contributes only its own armor and shield. */
export function mitigate(raw: number, atk: FactionSpec, dfn: FactionSpec): number {
  return raw * (atk.phys / (1 + dfn.armor / 100) + magicShare(atk) / (1 + dfn.shield / 100) + atk.trueShare);
}

/** A hit's damage split into the attacker's shares (they sum to 1). */
export interface DamageShares { phys: number; magic: number; true: number }

export function damageShares(spec: FactionSpec): DamageShares {
  return { phys: spec.phys, magic: magicShare(spec), true: spec.trueShare };
}

/** The damage law for a hit already split into shares; a defender with no faction (a training dummy) passes 0, 0. */
export function mitigateShares(raw: number, shares: DamageShares, dfn: { armor: number; shield: number }): number {
  return raw * (shares.phys / (1 + dfn.armor / 100) + shares.magic / (1 + dfn.shield / 100) + shares.true);
}

/** Point-damage params: x k with the hit at duel pace (`pacedFaction`). `mark_pct` and `mark_kill` are shares of the target's hp, so they are paced but never power-scaled. */
const DAMAGE_PARAMS = new Set(["burn", "backlash", "plague", "execute", "mark_pct", "mark_kill"]);
/** The params the power-level knob scales (a share of the target's hp already scales with the hp it is a share of). */
const POWER_SCALED = new Set(["burn", "backlash", "plague", "execute"]);

/** Power-level knob: multiplies hp and every point-damage number by k (ratios, and the mark's shares of the target's hp, untouched). */
export function scaledFaction(spec: FactionSpec, k: number): FactionSpec {
  const params: Record<string, number> = {};
  for (const [key, v] of Object.entries(spec.params)) params[key] = POWER_SCALED.has(key) ? v * k : v;
  return { ...spec, hp: spec.hp * k, hit: spec.hit * k, params };
}

/**
 * The faction as fought in the arena (DUEL_PACE, GAME_DESIGN 10.2): the hit and every damage param times k (the mark's share of the
 * target's hp too), with hp unchanged. Every fight runs k times shorter and the counter graph holds, so the reference duel's mark
 * climbs a tier in 1/k of the hits (`tier_hits`; the sim itself counts MARK_TIER_HITS weapon hits). k = 1 is the design sheet
 * (the parity tests).
 */
export function pacedFaction(spec: FactionSpec, k: number = DUEL_PACE): FactionSpec {
  const params: Record<string, number> = {};
  for (const [key, v] of Object.entries(spec.params)) params[key] = DAMAGE_PARAMS.has(key) ? v * k : key === "tier_hits" ? v / k : v;
  return { ...spec, hit: spec.hit * k, params };
}

export interface DuelResult { winner: 0 | 1 | null; t: number; hpA: number; hpB: number }

/** Continuous 1v1 reference duel; mirrors engine.duel exactly (same integration order). */
export function duel(a: FactionSpec, b: FactionSpec, dt = 0.002, tMax = 120): DuelResult {
  const f = [a, b] as const;
  const hp = [a.hp, b.hp];
  const hits = [0, 0];
  const stacks = [0, 0];
  let t = 0;
  while (t < tMax) {
    const rate = [f[0].rate, f[1].rate];
    for (const i of [0, 1] as const) rate[1 - i]! *= auraRateMultiplier(f[i]);
    const stateOf = (i: 0 | 1): CombatState => {
      const o = 1 - i;
      return {
        t, ownRate: rate[i]!, foeRate: rate[o]!,
        ownHpFrac: Math.max(hp[i]!, 0) / f[i].hp, foeHpFrac: Math.max(hp[o]!, 0) / f[o]!.hp,
        foeMaxHp: f[o]!.hp, ownHits: hits[i]!, ownStacks: stacks[i]!, ownBaseRate: f[i].rate,
      };
    };
    const press = [pressureOf(f[0], stateOf(0)), pressureOf(f[1], stateOf(1))] as const;
    // Pressure changes the opponent's rate (a tax).
    for (const i of [0, 1] as const) rate[1 - i] = press[i].foeRate;
    const out = [0, 0];
    const heal = [0, 0];
    const denied = [false, false];
    for (const i of [0, 1] as const) {
      const o = 1 - i;
      const st = stateOf(i);
      const cut = press[o]!.foeOut;
      let plain = mitigate(rate[i]! * f[i].hit * dt, f[i], f[o]!) * cut;
      let exe = 0;
      for (const [sig, v, isExecute] of bonusParts(f[i], st)) {
        const d = mitigateShares(v * dt, SIGNATURE_SHARES[sig], f[o]!) * cut;
        if (isExecute) exe += d;
        else plain += d;
      }
      if (exe > 0 && press[o]!.denyExecute) {
        const allowed = Math.max(0, Math.min(exe, hp[o]! - 1 - plain));
        denied[o] = exe - allowed > 1e-12;
        exe = allowed;
      }
      const dealt = plain + exe;
      out[i] = dealt;
      // The sentence cuts what a fighter deals, never what it heals from it (docs/SENTENCED_REDESIGN.md R6).
      heal[i] = (dealt / cut) * lifestealFraction(f[i], st.ownHpFrac);
    }
    hp[0] = Math.min(f[0].hp, hp[0]! - out[1]! + heal[0]!);
    hp[1] = Math.min(f[1].hp, hp[1]! - out[0]! + heal[1]!);
    for (const i of [0, 1] as const) {
      hits[i]! += f[i].rate * dt; // the tiers climb at the unslowed pace: a slow on the cadence never delays them
      if (denied[i] && stacks[i]! < 1) stacks[i] = 1;
    }
    t += dt;
    if (hp[0]! <= 0 || hp[1]! <= 0) {
      if (hp[0]! <= 0 && hp[1]! <= 0) return { winner: null, t, hpA: 0, hpB: 0 };
      return { winner: hp[1]! <= 0 ? 0 : 1, t, hpA: Math.max(hp[0]!, 0), hpB: Math.max(hp[1]!, 0) };
    }
  }
  return { winner: null, t, hpA: hp[0]!, hpB: hp[1]! };
}
