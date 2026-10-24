// Pure arena formulas shared by the sim, the client and the tests.
import {
  BOUNTY_EXPONENT, BOUNTY_FREE_KILLS, BOUNTY_SCALE, FEED_MOB_KILL_WEIGHT, PATIENCE_FULL_ALIVE, PATIENCE_MIN_ALIVE,
  SUDDEN_DEATH_RAMP_FRACTION, SUDDEN_DEATH_START_FRACTION,
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
