// Kill augments: only a credited player (or bot) kill drops one, never a mob. The killer gets a private "Trophy" reward container
// whose three options are the victim's top stat investments; a pick grants KILL_AUG_SHARE of the victim's bonus in that stat,
// stored in PlayerState.killStats and folded like earned farm stats (outside card ceilings, not in card power / the PvP factor).
// Pure: the sim rolls options from the victim's public mirrors; the client words the cards with the same helpers.
import { combatReadability, type InvestedStatKey, type ReadableFighter } from "./combatReadability";
import type { Effect } from "./effects";

/** Share of the victim's bonus the killer takes. Best guess (owner may retune). */
export const KILL_AUG_SHARE = 0.5;
/** Options on a trophy. */
export const KILL_AUG_OPTIONS = 3;
/** A trophy outlives a chest (a killer may still be fighting). */
export const KILL_AUG_SECONDS = 30;
export const KILL_AUG_PREFIX = "kill:";
export const KILL_AUG_LABEL = "Trophy";

/** One tier-I-sized unit of each readable stat (the same normalisers combatReadability scores with). */
const UNIT: Record<InvestedStatKey, number> = { ad: 12, ap: 12, damage: 0.01, health: 0.09, attackSpeed: 0.09, armor: 15, mr: 15, speed: 0.06, leech: 0.05 };
const FLAT: ReadonlySet<InvestedStatKey> = new Set(["ad", "ap", "armor", "mr"]);
const NAMES: Record<InvestedStatKey, string> = {
  ad: "Offense", ap: "Soul Offence", damage: "damage", health: "max health", attackSpeed: "attack speed", armor: "Defense", mr: "Soul Defense",
  speed: "movement speed", leech: "leech",
};
export const KILL_STAT_KEYS = Object.keys(UNIT) as InvestedStatKey[];
/** The `killStats` map key each stat is stored under (a flat stat keeps its Effect name, the rest an Effect stat). */
const STORE: Record<InvestedStatKey, string> = {
  ad: "ad", ap: "ap", damage: "damage", health: "maxHp", attackSpeed: "attackSpeed", armor: "armor", mr: "shield", speed: "moveSpeed", leech: "lifesteal",
};

export interface KillAugment { key: InvestedStatKey; gain: number }

export function encodeKillAugment(key: InvestedStatKey, gain: number): string {
  return `${KILL_AUG_PREFIX}${key}:${gain.toFixed(FLAT.has(key) ? 1 : 4)}`;
}

export function parseKillAugment(id: string): KillAugment | null {
  if (!id.startsWith(KILL_AUG_PREFIX)) return null;
  const [key, raw] = id.slice(KILL_AUG_PREFIX.length).split(":");
  if (!key || !KILL_STAT_KEYS.includes(key as InvestedStatKey)) return null;
  const gain = Number(raw);
  return raw !== undefined && Number.isFinite(gain) && gain > 0 ? { key: key as InvestedStatKey, gain } : null;
}

/** The victim's top three investments as options (fewer when it had fewer; none for a victim with nothing invested). */
export function rollKillAugments(victim: ReadableFighter): string[] {
  const out: string[] = [];
  for (const s of combatReadability(victim, { lasting: true }).investedStats) {
    const gain = Number((s.score * UNIT[s.key] * KILL_AUG_SHARE).toFixed(FLAT.has(s.key) ? 1 : 4));
    if (!(gain > 0)) continue;
    out.push(encodeKillAugment(s.key, gain));
    if (out.length >= KILL_AUG_OPTIONS) break;
  }
  return out;
}

/** The killStats key and amount a pick adds. */
export function killAugmentGrant(a: KillAugment): { stat: string; v: number } {
  return { stat: STORE[a.key], v: a.gain };
}

export function killAugmentText(a: KillAugment): { title: string; text: string } {
  const name = NAMES[a.key];
  const amount = FLAT.has(a.key) ? `+${a.gain.toFixed(1)}` : `+${(a.gain * 100).toFixed(1)}%`;
  return { title: `${amount} ${name}`, text: `Take ${Math.round(KILL_AUG_SHARE * 100)}% of your victim's ${name}: ${amount} for the rest of the run.` };
}

const FLAT_STORE = new Set(["ad", "ap", "armor", "shield"]);
/** killStats as fold rows (farm rows: outside the card caps, like mob and trade stats). */
export function killStatEffects(stats: { forEach(cb: (value: number, key: string) => void): void } | undefined): Effect[] {
  const rows: Effect[] = [];
  stats?.forEach((v, key) => {
    if (!Number.isFinite(v) || v === 0) return;
    if (FLAT_STORE.has(key)) rows.push({ k: "flat", stat: key as "ad" | "ap" | "armor" | "shield", v });
    else if (key === "maxHp" || key === "attackSpeed" || key === "moveSpeed" || key === "damage" || key === "lifesteal") rows.push({ k: "stat", stat: key, v });
  });
  return rows;
}
