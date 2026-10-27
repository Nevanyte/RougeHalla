// Pure arena formulas shared by the sim, the client and the tests.
import {
  BOUNTY_EXPONENT, BOUNTY_FREE_KILLS, BOUNTY_SCALE, CAMP_HEAL_HI, CAMP_HEAL_LO, CAMP_HEAL_MID, CAMP_HEAL_WIDTH, FEED_MOB_KILL_WEIGHT,
  HP_RACE_CAP, PATIENCE_FULL_ALIVE, PATIENCE_MIN_ALIVE, PVP_F0, PVP_FMAX, PVP_P0, SUDDEN_DEATH_RAMP_FRACTION,
  SUDDEN_DEATH_START_FRACTION,
} from "./constants";

/** Feed score of a run so far: how "fed" a player is. */
export function feedScore(playerKills: number, mobKills: number): number {
  return playerKills + FEED_MOB_KILL_WEIGHT * mobKills;
}

/**
 * Whole GV paid to whoever kills a player who has killed `playerKills` players; 0 until that passes BOUNTY_FREE_KILLS.
 * Only player kills count: mob kills feed the buffs and the mob reward curve (feedScore) but never the bounty.
 */
export function bountyFor(playerKills: number): number {
  const over = playerKills - BOUNTY_FREE_KILLS;
  return over > 0 ? Math.round(BOUNTY_SCALE * over ** BOUNTY_EXPONENT) : 0;
}

/**
 * Patience timer length for `alive` players standing: `fullSeconds` at PATIENCE_FULL_ALIVE or more, `minSeconds` at
 * PATIENCE_MIN_ALIVE or fewer, linear in between.
 */
export function patienceSecondsFor(alive: number, fullSeconds: number, minSeconds: number): number {
  const k = Math.min(1, Math.max(0, (alive - PATIENCE_MIN_ALIVE) / (PATIENCE_FULL_ALIVE - PATIENCE_MIN_ALIVE)));
  return minSeconds + (fullSeconds - minSeconds) * k;
}

/** Share of max hp per second sudden death burns `elapsedMs` into it (the sim's burn, and the client's damage flash). */
export function suddenDeathShare(elapsedMs: number): number {
  return SUDDEN_DEATH_START_FRACTION + SUDDEN_DEATH_RAMP_FRACTION * Math.floor(Math.max(0, elapsedMs) / 1000);
}

/**
 * What clearing a camp heals a player at `hp` of `maxHp`: the missing hp times f(m), m = 1 - hp / maxHp, on an S-curve from
 * CAMP_HEAL_LO (a scratch) to CAMP_HEAL_HI (nearly dead): hp 95% -> +1.4% of max hp, 60% -> +24%, 30% -> +64%, 10% -> +85%.
 * 0 for a full or over-full pool and for a pool with no max.
 */
export function campHealAmount(hp: number, maxHp: number): number {
  if (!(maxHp > 0) || !(hp < maxHp)) return 0;
  const missing = maxHp - Math.max(0, hp);
  const m = missing / maxHp;
  const f = CAMP_HEAL_LO + (CAMP_HEAL_HI - CAMP_HEAL_LO) / (1 + Math.exp(-(m - CAMP_HEAL_MID) / CAMP_HEAL_WIDTH));
  return missing * f;
}

// ---- Card power and the PvP factor (balance pass, BALANCE_CONTRACT 3.4 / 4.6 G4) ----

/** A run's cards as the sim holds them: id -> count (PlayerState.build, a MapSchema or a Map), or a plain record. */
export type PowerBuild = { forEach(cb: (count: number, id: string) => void): void } | Readonly<Record<string, number>>;

/** The base-stat card ids ("ad2": the stat, then the tier) of the contract's catalog (BALANCE_CONTRACT 4.2). */
const BASE_CARD_TIER = /^(ad|ap|haste|vitality|armor|mr|leech|fleet)([123])$/;

/**
 * A card's tier, 1-3. STUB until the card catalog lands (shared/cards.ts, agent A3): the base-stat ids carry their tier in
 * their last digit and every other id (the passives of today's build, a conditional, an augment) counts as tier 1. Swap this
 * body for the catalog lookup and `cardPower` follows.
 */
export function cardTierOf(id: string): 1 | 2 | 3 {
  const m = BASE_CARD_TIER.exec(id);
  return m ? (Number(m[2]) as 1 | 2 | 3) : 1;
}

/**
 * A fighter's card power P: the sum over its cards of tier x count (a base card stacks, so Attack Damage II twice is 4).
 * The PvP factor reads it. Pure; an empty or missing build is 0.
 */
export function cardPower(build: PowerBuild | null | undefined): number {
  if (!build) return 0;
  let p = 0;
  const add = (count: number, id: string): void => {
    if (count > 0) p += cardTierOf(id) * count;
  };
  if (typeof (build as { forEach?: unknown }).forEach === "function") (build as Exclude<PowerBuild, Readonly<Record<string, number>>>).forEach(add);
  else for (const [id, count] of Object.entries(build)) add(count, id);
  return p;
}

/**
 * The PvP factor: the multiplier on every player-to-player damage entry of an attacker with card power `power`, and on the
 * clock of the mark it runs against a player: PVP_F0 + (PVP_FMAX - PVP_F0) x (1 - exp(-P / PVP_P0)). 0.75 for a fresh
 * fighter, 1.39 at P 2, 2.17 at P 6, towards 3.0.
 */
export function pvpFactor(power: number): number {
  const p = power > 0 ? power : 0; // NaN and negatives are no power; Infinity saturates
  return PVP_F0 + (PVP_FMAX - PVP_F0) * (1 - Math.exp(-p / PVP_P0));
}

/**
 * A Race to 0's multiplier (G4): 1 / hp fraction, between 1 and `cap` (at most HP_RACE_CAP). It applies to the damage its holder
 * deals and the damage it takes alike.
 */
export function hpRaceMult(hpFrac: number, cap: number = HP_RACE_CAP): number {
  const ceiling = Math.min(cap, HP_RACE_CAP);
  if (!(hpFrac > 0)) return Math.max(1, ceiling);
  return Math.min(Math.max(1 / hpFrac, 1), Math.max(1, ceiling));
}
