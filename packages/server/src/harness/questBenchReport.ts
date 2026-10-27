// Report interpretation lives both here and in the printed header so a saved report stays self-explanatory.
import { median } from "@raid/shared";
import { QUEST_POLICY_IDS, type QuestPolicyId } from "./questBenchPolicy";
import { timelinePowerAt, type QuestBenchObservation, type PowerTimeline } from "./questBench";

const number = (n: number, digits = 2): string => Number.isFinite(n) ? n.toFixed(digits) : "-";
const percent = (n: number): string => `${(n * 100).toFixed(1)}%`;

function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)]!;
}

function table(header: readonly string[], rows: ReadonlyArray<readonly string[]>): string[] {
  return [`| ${header.join(" | ")} |`, `| ${header.map(() => "---").join(" | ")} |`, ...rows.map((r) => `| ${r.join(" | ")} |`)];
}

function powerAt(
  timelines: readonly PowerTimeline[], policy: QuestPolicyId, seconds: number,
): { mean: number; median: number; active: number; n: number } {
  const selected = timelines.filter((t) => t.policy === policy);
  const values = selected.map((t) => timelinePowerAt(t, seconds)).filter((n): n is number => n !== null);
  return {
    mean: values.length ? values.reduce((a, b) => a + b, 0) / values.length : NaN,
    median: values.length ? median(values) : NaN,
    active: selected.filter((t) => t.duration >= seconds && timelinePowerAt(t, seconds) !== null).length,
    n: values.length,
  };
}

function farmEquivalent(farm: readonly PowerTimeline[], seconds: number): number {
  const values = farm.map((t) => timelinePowerAt(t, seconds)).filter((n): n is number => n !== null);
  return values.length ? median(values) : NaN;
}

export function buildQuestBenchReport(observation: QuestBenchObservation): string {
  const runs = observation.runs;
  const offers = runs.flatMap((r) => r.offers);
  const completions = runs.flatMap((r) => r.completions);
  const timelines = runs.flatMap((r) => r.timelines);
  const farm = timelines.filter((t) => t.farmReference);
  const names = new Map<string, string>();
  for (const offer of offers) names.set(offer.defId, offer.name);
  for (const completion of completions) names.set(completion.defId, completion.name);
  const questRuntime = runs.some((r) => r.questRuntime);
  const lines = [
    "# QUESTBENCH — real-sim, report only",
    "",
    "READ THIS: completion rate = completions / offered quests across all lobbies. Time is raid-start to automatic",
    "turn-in; median and p90 include completions only. Power is shared buffPower (not GV/passives). Quest Δ is the",
    "observed buffPower change on the completion tick, shown with median before → after. Farm equivalent is the",
    "median pure-farm-only power at those same elapsed times; ratio = median quest Δ / median farm equivalent.",
    "This is an opportunity-cost estimate, not a paired counterfactual. Deaths/fights are within 8 tiles of a",
    "giver, quest item, or relevant kill camp; fights are new player locks and idle-mob engagements, not re-aggro.",
    "One event can count for overlapping quest sites. Each policy/seat also runs solo so another player's death",
    "cannot truncate its curve. Policy cells are mean (median; active/samples), combining solo and mixed seats.",
    "After an early end, final power carries flat to later marks (no imagined post-run gains), making farm equivalents",
    "conservative. Mixed policy compares nominal reward / (straight-line walk + catalog objective time) with",
    "the nearest camp at 12 s/mob. Mixed lobbies rotate policy seats by 2 and faction seats by 1 per seed,",
    "independently, to reduce faction/policy confounding. Win rate = wins / seats; no winner by the cap counts",
    "as no win. Failures are printed, never gated.",
    "",
    `Configuration: ${observation.options.seeds} seed(s), ${observation.options.players} seats/policy and mixed-lobby players, ${observation.options.capSeconds}s cap;`,
    `${runs.length}/${observation.options.seeds * (3 * observation.options.players + 1)} lobbies completed, ${runs.reduce((n, r) => n + r.ticks, 0)} active ticks.`,
    "",
  ];
  if (!questRuntime) {
    lines.push(
      "QUEST RUNTIME UNAVAILABLE: this checkout has no installed quest module. Policy/farm rows are real-sim",
      "measurements; quest rows are empty. Run again after K1 installs and enables its quest runtime.",
      "",
    );
  }

  const questRows = [...names.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([defId, name]) => {
    const offered = offers.filter((o) => o.defId === defId).length;
    const done = completions.filter((c) => c.defId === defId);
    const gains = done.map((c) => c.buffGain);
    const equivalents = done.map((c) => farmEquivalent(farm, c.seconds)).filter(Number.isFinite);
    const gain = gains.length ? median(gains) : NaN;
    const equivalent = equivalents.length ? median(equivalents) : NaN;
    const before = done.length ? median(done.map((c) => c.buffBefore)) : NaN;
    const after = done.length ? median(done.map((c) => c.buffAfter)) : NaN;
    const site = runs.reduce((cell, r) => {
      const value = r.sites[defId];
      cell.deaths += value?.deaths ?? 0;
      cell.fights += value?.fights ?? 0;
      return cell;
    }, { deaths: 0, fights: 0 });
    return [
      name,
      `${done.length}/${offered} (${offered ? percent(done.length / offered) : "-"})`,
      number(done.length ? median(done.map((c) => c.seconds)) : NaN, 1),
      number(percentile(done.map((c) => c.seconds), 0.9), 1),
      `${number(gain)} (${number(before)}→${number(after)})`,
      number(equivalent),
      equivalent > 0 ? number(gain / equivalent) : "-",
      String(site.deaths),
      String(site.fights),
    ];
  });
  lines.push("## Per quest", "");
  lines.push(...table(
    ["quest", "done/offered", "median s", "p90 s", "quest Δ (before→after)", "farm equiv", "ratio", "deaths", "fights"],
    questRows.length ? questRows : [["(no quest observations)", "-", "-", "-", "-", "-", "-", "-", "-"]],
  ));

  lines.push("", "## Policy buffPower", "");
  lines.push(...table(["policy", "1 min", "2 min", "3 min", "5 min"], QUEST_POLICY_IDS.map((policy) => {
    const cells = [60, 120, 180, 300].map((seconds) => {
      const sample = powerAt(timelines, policy, seconds);
      return `${number(sample.mean, 1)} (${number(sample.median, 1)}; ${sample.active}/${sample.n} active)`;
    });
    return [policy, ...cells];
  })));

  const mixed = runs.flatMap((r) => r.mixed);
  lines.push("", "## Mixed-lobby wins", "");
  lines.push(...table(["policy", "wins/seats", "win rate"], QUEST_POLICY_IDS.map((policy) => {
    const seats = mixed.filter((r) => r.policy === policy);
    const wins = seats.filter((r) => r.win).length;
    return [policy, `${wins}/${seats.length}`, seats.length ? percent(wins / seats.length) : "-"];
  })));

  lines.push("", "## Harness failures", "");
  if (observation.errors.length === 0) lines.push("None.");
  else for (const error of observation.errors) lines.push(`- ${error}`);
  return lines.join("\n");
}
