// Reproducible observations of the real legacy evaluator, not a second rule implementation.
// Run: node --import tsx tools/persist-fixtures/achievements.ts [--check]
import { readFileSync, writeFileSync } from "node:fs";
import { ACHIEVEMENTS, evaluateAchievements, type AchievementSnapshot } from "../../packages/shared/src/achievements.ts";
import { GOLD_FACTIONS } from "../../packages/shared/src/cosmetics.ts";

const path = new URL("../../crates/rh-persist/tests/fixtures/achievements.json", import.meta.url);
const blank = (): AchievementSnapshot => ({
  stats: { runs: 0, wins: 0, draws: 0, deaths: 0, kills: 0 },
  progress: { qualifiedWins: 0, bountyRuns: 0, bestRunKills: 0, winsByFaction: {}, winsByWeapon: {} },
  gvLifetime: 0,
});
const cases: { label: string; snapshot: AchievementSnapshot; unlocked: Record<string, number>; expected: string[] }[] = [];
function record(label: string, snapshot: AchievementSnapshot, unlocked: Record<string, number> = {}) {
  cases.push({ label, snapshot, unlocked, expected: evaluateAchievements(snapshot, unlocked).map(a => a.id) });
}
record("new profile", blank());
for (const achievement of ACHIEVEMENTS) {
  for (const delta of [-1, 0, 1]) {
    const snapshot = blank();
    const goal = achievement.goal;
    const n = goal.min + delta;
    switch (goal.kind) {
      case "stat": snapshot.stats[goal.stat] = n; break;
      case "progress": snapshot.progress[goal.key] = n; break;
      case "lifetimeGv": snapshot.gvLifetime = n; break;
      case "factionWins": snapshot.progress.winsByFaction[goal.faction] = n; break;
      case "weaponWins": snapshot.progress.winsByWeapon[goal.weapon] = n; break;
      case "everyFactionWins": for (const faction of GOLD_FACTIONS) snapshot.progress.winsByFaction[faction] = n; break;
    }
    record(`${achievement.id} threshold ${delta >= 0 ? "+" : ""}${delta}`, snapshot);
  }
}
const all = blank();
all.stats = { runs: 100, wins: 100, draws: 0, deaths: 0, kills: 100 };
all.progress = {
  qualifiedWins: 100, bountyRuns: 100, bestRunKills: 100,
  winsByFaction: Object.fromEntries(GOLD_FACTIONS.map(id => [id, 100])),
  winsByWeapon: Object.fromEntries(["sword", "axe", "bow", "wand", "shield"].map(id => [id, 100])),
};
all.gvLifetime = 100_000;
record("all goals met in catalog order", all);
record("zero timestamp is already unlocked", all, { first_blood: 0, first_win: 0, win_fire: 17, unknown_future_id: 42 });
record("all already unlocked", all, Object.fromEntries(ACHIEVEMENTS.map(a => [a.id, 0])));
const unqualified = blank();
unqualified.stats = { runs: 100, wins: 100, draws: 0, deaths: 0, kills: 0 };
record("unqualified wins never grant win goals", unqualified);

const text = JSON.stringify({
  format: "rh-achievement-parity/1",
  source: "packages/shared/src/achievements.ts",
  catalog: ACHIEVEMENTS.map(({ id, goal, reward }) => ({ id, goal, reward })),
  cases,
}, null, 2) + "\n";
if (process.argv.includes("--check")) {
  if (readFileSync(path, "utf8") !== text) {
    throw new Error("Legacy achievements changed: reconcile the Rust catalog/evaluator and intentionally regenerate achievements.json");
  }
  console.log(`${cases.length} legacy achievement observations and ${ACHIEVEMENTS.length} catalog entries unchanged`);
} else {
  writeFileSync(path, text);
  console.log(`Recorded ${cases.length} legacy achievement observations`);
}
