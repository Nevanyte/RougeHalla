// The five factions and the universal combat law, ported 1:1 from testing/engine.py and
// testing/classes.py (v3 numbers; the design source of truth is testing/CLASS_SHEET.md). Pure: the
// duel() here must keep reproducing the Python reference results (packages/shared/test/factions.test.ts).
//
// Rules of the law: every damage packet splits into physical / magic / true shares (a property of
// the attacker); armor cuts the physical share, shield the magic share, true ignores both, each as
// 1 / (1 + stat/100). Signature mechanics read only the attacker's own params and universal state,
// never the opponent's identity, so counters emerge from the numbers alone.
import { DUEL_PACE } from "./constants";

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
    hp: 500, rate: 0.6, hit: 150, phys: 0.0, trueShare: 0.0, armor: 0, shield: 125,
    mechanic: "dragonslayer", params: { burn: 10, backlash: 200 },
  },
  sentenced: {
    id: "sentenced", name: "Sentenced", displayName: "Sentenced", role: "Patient executioner", theme: "Marked for judgment", color: 0x9575cd,
    hp: 700, rate: 0.9, hit: 5, phys: 0.0, trueShare: 0.0, armor: 100, shield: 50,
    mechanic: "marked", params: { mark_ramp: 35, mark_cap: 275 },
  },
  plague: {
    id: "plague", name: "Plague", displayName: "Plague", role: "Attrition swarm", theme: "Rat King, disease", color: 0x9ccc65,
    hp: 1000, rate: 1.85, hit: 20, phys: 0.8, trueShare: 0.0, armor: 200, shield: 0,
    mechanic: "rat_king", params: { plague: 40, execute: 2050 },
  },
  frost: {
    id: "frost", name: "Frost", displayName: "Frost", role: "Control bruiser", theme: "Living wall of ice", color: 0x4fc3f7,
    hp: 1750, rate: 0.45, hit: 90, phys: 0.9, trueShare: 0.0, armor: 100, shield: 100,
    mechanic: "plain", aura: "wall_of_ice", params: { slow: 0.6 },
  },
  holy: {
    id: "holy", name: "Holy", displayName: "Demon Blood", role: "Sustain juggernaut", theme: "Light that burns brighter near death", color: 0xfff176,
    hp: 1450, rate: 0.95, hit: 65, phys: 1.0, trueShare: 0.0, armor: 0, shield: 250,
    mechanic: "plain", sustain: "radiant", params: { ls0: 0.25, ls1: 1.25, ls_cap: 1.0 },
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
}

/** Bonus raw damage per second added on top of rate × hit. */
export function bonusDps(spec: FactionSpec, s: CombatState): number {
  const p = spec.params;
  switch (spec.mechanic) {
    case "dragonslayer": return p.burn! + p.backlash! * s.foeRate;
    case "rat_king": return p.plague! + p.execute! * Math.max(0, 0.5 - s.foeHpFrac);
    case "marked": return Math.min(p.mark_cap!, p.mark_ramp! * s.t);
    default: return 0;
  }
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

const DAMAGE_PARAMS = new Set(["burn", "backlash", "plague", "execute", "mark_ramp", "mark_cap"]);

/** Power-level knob: multiplies hp and every point-damage number by k (ratios untouched). */
export function scaledFaction(spec: FactionSpec, k: number): FactionSpec {
  const params: Record<string, number> = {};
  for (const [key, v] of Object.entries(spec.params)) params[key] = DAMAGE_PARAMS.has(key) ? v * k : v;
  return { ...spec, hp: spec.hp * k, hit: spec.hit * k, params };
}

/**
 * The faction as fought in the arena (DUEL_PACE, GAME_DESIGN 10.2): the hit and every damage param times k, and the
 * mark ramp times k squared (so the mark is full in 1/k of the time), with hp unchanged. Every fight runs k times
 * shorter and the counter graph holds. k = 1 is the design sheet (the parity tests).
 */
export function pacedFaction(spec: FactionSpec, k: number = DUEL_PACE): FactionSpec {
  const params: Record<string, number> = {};
  for (const [key, v] of Object.entries(spec.params)) {
    params[key] = key === "mark_ramp" ? v * k * k : DAMAGE_PARAMS.has(key) ? v * k : v;
  }
  return { ...spec, hit: spec.hit * k, params };
}

export interface DuelResult { winner: 0 | 1 | null; t: number; hpA: number; hpB: number }

/** Continuous 1v1 reference duel; mirrors engine.duel exactly (same integration order). */
export function duel(a: FactionSpec, b: FactionSpec, dt = 0.002, tMax = 120): DuelResult {
  const f = [a, b] as const;
  const hp = [a.hp, b.hp];
  let t = 0;
  while (t < tMax) {
    const rate = [f[0].rate, f[1].rate];
    for (const i of [0, 1] as const) rate[1 - i]! *= auraRateMultiplier(f[i]);
    const out = [0, 0];
    const heal = [0, 0];
    for (const i of [0, 1] as const) {
      const o = 1 - i;
      const st: CombatState = {
        t, ownRate: rate[i]!, foeRate: rate[o]!,
        ownHpFrac: Math.max(hp[i]!, 0) / f[i].hp, foeHpFrac: Math.max(hp[o]!, 0) / f[o]!.hp,
      };
      const raw = (rate[i]! * f[i].hit + bonusDps(f[i], st)) * dt;
      const dealt = mitigate(raw, f[i], f[o]!);
      out[i] = dealt;
      heal[i] = dealt * lifestealFraction(f[i], st.ownHpFrac);
    }
    hp[0] = Math.min(f[0].hp, hp[0]! - out[1]! + heal[0]!);
    hp[1] = Math.min(f[1].hp, hp[1]! - out[0]! + heal[1]!);
    t += dt;
    if (hp[0]! <= 0 || hp[1]! <= 0) {
      if (hp[0]! <= 0 && hp[1]! <= 0) return { winner: null, t, hpA: 0, hpB: 0 };
      return { winner: hp[1]! <= 0 ? 0 : 1, t, hpA: Math.max(hp[0]!, 0), hpB: Math.max(hp[1]!, 0) };
    }
  }
  return { winner: null, t, hpA: hp[0]!, hpB: hp[1]! };
}
