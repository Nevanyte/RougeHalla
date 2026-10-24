// Achievements: pure rules that the server evaluates against a profile after every banked run. A goal reads only
// counters the server keeps (stats, progress, lifetime GV), never anything a client reports. Each achievement unlocks
// once and grants cosmetics (titles, exclusive colours, golden variants) that are also listed in cosmetics.ts.
import { WIN_BONUS_MIN_OPPONENTS, WIN_BONUS_MIN_PLAYERS } from "./constants";
import { GOLD_FACTIONS, GOLD_WEAPONS, type GoldFaction, type GoldWeapon } from "./cosmetics";
import type { ProfileProgress, ProfileStats } from "./messages";

/**
 * Every win goal counts only wins that pass the win-bonus gate (ProfileProgress.qualifiedWins), so a second profile that
 * joins and leaves can't hand out titles and golden variants that the win bonus itself would refuse to pay for.
 */
const QUALIFIED = `Counts only in runs of ${WIN_BONUS_MIN_PLAYERS}+ players where you damaged ${WIN_BONUS_MIN_OPPONENTS}+ of them.`;

export type AchievementGoal =
  /** A lifetime stat reached `min`. */
  | { kind: "stat"; stat: keyof ProfileStats; min: number }
  /** A ProfileProgress counter reached `min`. */
  | { kind: "progress"; key: "qualifiedWins" | "bountyRuns" | "bestRunKills"; min: number }
  | { kind: "lifetimeGv"; min: number }
  | { kind: "factionWins"; faction: GoldFaction; min: number }
  | { kind: "weaponWins"; weapon: GoldWeapon; min: number }
  /** At least `min` wins with every one of the five factions. */
  | { kind: "everyFactionWins"; min: number };

export interface AchievementDef {
  id: string;
  name: string;
  desc: string;
  goal: AchievementGoal;
  /** Cosmetic ids granted on unlock. Granting an item already owned changes nothing. */
  reward: readonly string[];
}

/** What goals read. A profile record has all of it. */
export interface AchievementSnapshot {
  stats: ProfileStats;
  progress: ProfileProgress;
  gvLifetime: number;
}

const FACTION_TITLE: Record<GoldFaction, [id: string, name: string, title: string]> = {
  fire: ["win_fire", "Pyre", "title-pyre-lord"],
  sentenced: ["win_sentenced", "Verdict", "title-the-judge"],
  plague: ["win_plague", "Infestation", "title-rat-king"],
  frost: ["win_frost", "Deep Freeze", "title-ice-wall"],
  holy: ["win_holy", "Blood Rite", "title-demon-blood"],
};
const FACTION_NAME: Record<GoldFaction, string> = {
  fire: "Fire", sentenced: "Sentenced", plague: "Plague", frost: "Frost", holy: "Demon Blood",
};
const WEAPON_NAME: Record<GoldWeapon, string> = { sword: "sword", axe: "axe", bow: "bow", wand: "wand", shield: "shield" };

const factionWinAchievements: AchievementDef[] = GOLD_FACTIONS.map((faction) => {
  const [id, name, title] = FACTION_TITLE[faction];
  return { id, name, desc: `Win a run as ${FACTION_NAME[faction]}. ${QUALIFIED}`, goal: { kind: "factionWins", faction, min: 1 }, reward: [title] };
});
const factionGoldAchievements: AchievementDef[] = GOLD_FACTIONS.map((faction) => ({
  id: `gild_${faction}`,
  name: `Gilded ${FACTION_NAME[faction]}`,
  desc: `Win 3 runs as ${FACTION_NAME[faction]}. ${QUALIFIED}`,
  goal: { kind: "factionWins", faction, min: 3 },
  reward: [`gilded-${faction}`],
}));
const weaponGoldAchievements: AchievementDef[] = GOLD_WEAPONS.map((weapon) => ({
  id: `gild_${weapon}`,
  name: `Golden ${WEAPON_NAME[weapon][0]!.toUpperCase()}${WEAPON_NAME[weapon].slice(1)}`,
  desc: `Win 5 runs holding the ${WEAPON_NAME[weapon]}. ${QUALIFIED}`,
  goal: { kind: "weaponWins", weapon, min: 5 },
  reward: [`gilded-${weapon}`],
}));

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  { id: "first_blood", name: "First Blood", desc: "Kill another player.", goal: { kind: "stat", stat: "kills", min: 1 }, reward: ["title-bloodied"] },
  { id: "slayer", name: "Slayer", desc: "Kill 10 players.", goal: { kind: "stat", stat: "kills", min: 10 }, reward: ["title-slayer"] },
  { id: "reaper", name: "Reaper", desc: "Kill 50 players.", goal: { kind: "stat", stat: "kills", min: 50 }, reward: ["title-reaper"] },
  { id: "rampage", name: "Rampage", desc: "Kill 5 players in a single run.", goal: { kind: "progress", key: "bestRunKills", min: 5 }, reward: ["title-rampage", "trail-comet"] },
  { id: "bounty_hunter", name: "Bounty Hunter", desc: "End a rampage and claim the bounty.", goal: { kind: "progress", key: "bountyRuns", min: 1 }, reward: ["title-bounty-hunter", "outline-bounty"] },
  { id: "first_win", name: "First Win", desc: `Be the last one standing. ${QUALIFIED}`, goal: { kind: "progress", key: "qualifiedWins", min: 1 }, reward: ["title-victor", "skin-laurel"] },
  { id: "champion", name: "Champion", desc: `Win 5 runs. ${QUALIFIED}`, goal: { kind: "progress", key: "qualifiedWins", min: 5 }, reward: ["title-champion"] },
  { id: "warlord", name: "Warlord", desc: `Win 20 runs. ${QUALIFIED}`, goal: { kind: "progress", key: "qualifiedWins", min: 20 }, reward: ["title-warlord"] },
  { id: "veteran", name: "Veteran", desc: "Play 25 runs.", goal: { kind: "stat", stat: "runs", min: 25 }, reward: ["title-veteran", "skin-ghost"] },
  { id: "glorious", name: "Glorious", desc: "Earn 1,000 GV in total.", goal: { kind: "lifetimeGv", min: 1000 }, reward: ["title-glorious"] },
  ...factionWinAchievements,
  { id: "cycle_breaker", name: "Cycle Breaker", desc: `Win a run as every faction. ${QUALIFIED}`, goal: { kind: "everyFactionWins", min: 1 }, reward: ["title-cycle-breaker"] },
  ...factionGoldAchievements,
  ...weaponGoldAchievements,
];

const BY_ID: ReadonlyMap<string, AchievementDef> = new Map(ACHIEVEMENTS.map((a) => [a.id, a]));

export function achievementById(id: unknown): AchievementDef | undefined {
  return typeof id === "string" ? BY_ID.get(id) : undefined;
}

/** A count from a dictionary keyed by an id: own keys only, so "__proto__" and friends read as 0. */
function countOf(dict: Readonly<Record<string, number>>, key: string): number {
  const n = Object.hasOwn(dict, key) ? dict[key] : 0;
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

/** How far along a goal is: `have` is capped at `need`, so a bar never overflows. */
export function goalProgress(goal: AchievementGoal, s: AchievementSnapshot): { have: number; need: number } {
  let have: number;
  let need: number;
  switch (goal.kind) {
    case "stat": have = s.stats[goal.stat] ?? 0; need = goal.min; break;
    case "progress": have = s.progress[goal.key] ?? 0; need = goal.min; break;
    case "lifetimeGv": have = s.gvLifetime; need = goal.min; break;
    case "factionWins": have = countOf(s.progress.winsByFaction, goal.faction); need = goal.min; break;
    case "weaponWins": have = countOf(s.progress.winsByWeapon, goal.weapon); need = goal.min; break;
    case "everyFactionWins":
      have = GOLD_FACTIONS.filter((f) => countOf(s.progress.winsByFaction, f) >= goal.min).length;
      need = GOLD_FACTIONS.length;
      break;
  }
  return { have: Number.isFinite(have) ? Math.min(Math.max(have, 0), need) : 0, need };
}

export function isGoalMet(goal: AchievementGoal, s: AchievementSnapshot): boolean {
  const { have, need } = goalProgress(goal, s);
  return have >= need;
}

/**
 * The achievements `s` has just earned: goals that are met and not yet in `unlocked` (id → unlock time), in catalog
 * order. The caller records them; this never mutates.
 */
export function evaluateAchievements(s: AchievementSnapshot, unlocked: Readonly<Record<string, number>>): AchievementDef[] {
  return ACHIEVEMENTS.filter((a) => !Object.hasOwn(unlocked, a.id) && isGoalMet(a.goal, s));
}
