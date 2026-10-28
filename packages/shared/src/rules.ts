// Pure arena formulas shared by the sim, the client and the tests.
import {
  BOUNTY_EXPONENT, BOUNTY_FREE_KILLS, BOUNTY_SCALE, CAMP_HEAL_HI, CAMP_HEAL_LO, CAMP_HEAL_MID, CAMP_HEAL_WIDTH, CATCHUP_GAP,
  CATCHUP_MULT, FEED_MOB_KILL_WEIGHT, HEAL_OVER_TIME_STEP_MS, HP_RACE_CAP, LIFESTEAL_MAX, LS_CAP, PATIENCE_FULL_ALIVE,
  PATIENCE_MIN_ALIVE, PVP_F0, PVP_FMAX, PVP_P0, REWARD_FLOOR, REWARD_MID, REWARD_WIDTH, SUDDEN_DEATH_RAMP_FRACTION,
  SUDDEN_DEATH_START_FRACTION,
} from "./constants";

export function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/** Feed score of a run so far: how "fed" a player is. */
export function feedScore(playerKills: number, mobKills: number): number {
  return playerKills + FEED_MOB_KILL_WEIGHT * mobKills;
}

/**
 * Whole GV paid to whoever kills a player who has killed `playerKills` players; 0 until that passes BOUNTY_FREE_KILLS.
 * Only player kills count: mob kills feed the mob reward curve (feedScore) but never the bounty.
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

// ---- The PvP factor (balance pass, BALANCE_CONTRACT 3.4 / 4.6 G4). Card power itself is cards.ts cardPower (the catalog's tiers). ----

/**
 * The PvP factor: the multiplier on every player-to-player damage entry of an attacker with card power `power`, including its
 * mark pulses: PVP_F0 + (PVP_FMAX - PVP_F0) x (1 - exp(-P / PVP_P0)). 0.77 for a fresh
 * fighter, 1.40 at P 2, 2.18 at P 6, towards 3.0.
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

// ---- The feed's rewards: the mob reward curve and the catch-up (they scale mob GV and quest cards; no stat comes from a kill) ----

/** The mob reward curve: near 1 while hungry, falling sharply around a feed of REWARD_MID, never below REWARD_FLOOR. */
export function rewardCurve(feed: number): number {
  return REWARD_FLOOR + (1 - REWARD_FLOOR) * (1 - sigmoid((feed - REWARD_MID) / REWARD_WIDTH));
}

/** Median of the values (the mean of the two middle ones for an even count); 0 for none. */
export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** CATCHUP_MULT for a feed more than CATCHUP_GAP below the lobby median, else 1. */
export function catchUpMultiplier(feed: number, medianFeed: number): number {
  return feed < medianFeed - CATCHUP_GAP ? CATCHUP_MULT : 1;
}

/** What a mob's GV is multiplied by for a player with this feed in a lobby with this median feed. */
export function mobRewardMultiplier(feed: number, medianFeed: number): number {
  return rewardCurve(feed) * catchUpMultiplier(feed, medianFeed);
}

/**
 * The share of the damage it lands a fighter heals: its faction's own lifesteal (Holy's, `own`) plus what its `lifesteal` rows add
 * (`rows`, capped at LS_CAP), never more than LIFESTEAL_MAX in all. (shared/mods.ts lifestealTotal is the card engine's form, with
 * Bloodthirst's multiplier and Siphon's damage-over-time share.)
 */
export function lifestealShare(own: number, rows: number): number {
  const fromRows = rows > 0 ? Math.min(LS_CAP, rows) : 0;
  return Math.min(LIFESTEAL_MAX, (own > 0 ? own : 0) + fromRows);
}

/** How many equal steps a heal over time of nominal length `ms` is paid in, the first at once (Second Wind's 2000 is four). */
export function healOverTimeSteps(ms: number): number {
  return Math.max(1, Math.round(ms / HEAL_OVER_TIME_STEP_MS));
}

/** From its first step to its last: what a heal over time really spans, and what its text says (four steps 500 ms apart: 1.5 s). */
export function healOverTimeSpanMs(ms: number): number {
  return (healOverTimeSteps(ms) - 1) * HEAL_OVER_TIME_STEP_MS;
}
