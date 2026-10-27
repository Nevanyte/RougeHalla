// Report interpretation lives both here and in the printed header so a saved report stays self-explanatory.
import { median } from "@raid/shared";
import { QUEST_POLICY_IDS, type QuestPolicyId } from "./questBenchPolicy";
import {
  kaplanMeierMedian, marginalTimeToGain, timelinePowerAt, timeToGain, type PowerTimeline, type QuestBenchObservation,
} from "./questBench";

/** A completion that gained under this much live power has no ratio: the reward is worth nothing to that build (a ratio against ~0 is noise). */
const MIN_GAIN = 0.5;

/** The marginal farm time needs this many farm runs that got as far as the player's power before the quest. */
const MARGINAL_MIN_RUNS = 3;

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

/** Power of the policy's runs that are still going at `seconds` (a run that ended earlier is absent, never carried flat). */
function powerAt(
  timelines: readonly PowerTimeline[], policy: QuestPolicyId, seconds: number,
): { mean: number; median: number; active: number; n: number } {
  const selected = timelines.filter((t) => t.policy === policy);
  const values = selected
    .filter((t) => t.end === "survived" || t.censorAt >= seconds)
    .map((t) => timelinePowerAt(t, seconds))
    .filter((n): n is number => n !== null);
  return {
    mean: values.length ? values.reduce((a, b) => a + b, 0) / values.length : NaN,
    median: values.length ? median(values) : NaN,
    active: values.length,
    n: selected.length,
  };
}

/** The farm-only baseline in numbers, for the report and for tests: how its runs ended. */
export function farmBaselineSummary(timelines: readonly PowerTimeline[]): {
  runs: number; survived: number; died: number; stalled: number; medianEnd: number; medianKills: number;
} {
  const farm = timelines.filter((t) => t.farmReference);
  const count = (end: PowerTimeline["end"]): number => farm.filter((t) => t.end === end).length;
  return {
    runs: farm.length,
    survived: count("survived"),
    died: count("died"),
    stalled: count("stalled"),
    medianEnd: farm.length ? median(farm.map((t) => t.censorAt)) : NaN,
    medianKills: farm.length ? median(farm.map((t) => t.kills)) : NaN,
  };
}

export function buildQuestBenchReport(observation: QuestBenchObservation): string {
  const runs = observation.runs;
  const offers = runs.flatMap((r) => r.offers);
  const attempts = runs.flatMap((r) => r.attempts);
  const completions = runs.flatMap((r) => r.completions);
  const timelines = runs.flatMap((r) => r.timelines);
  const farm = timelines.filter((t) => t.farmReference);
  const farmMaxSeconds = farm.length ? Math.max(...farm.map((t) => t.censorAt)) : NaN;
  const names = new Map<string, string>();
  const pvp = new Set<string>();
  for (const offer of offers) {
    names.set(offer.defId, offer.name);
    if (offer.needsAnotherPlayer) pvp.add(offer.defId);
  }
  for (const attempt of attempts) names.set(attempt.defId, attempt.name);
  for (const completion of completions) names.set(completion.defId, completion.name);
  const questRuntime = runs.some((r) => r.questRuntime);
  const lobbies = observation.options.seeds * (3 * observation.options.players + 1);
  const lines = [
    "# QUESTBENCH — real-sim, report only",
    "",
    "READ THIS.",
    "RATIO = the quest's own seconds / the farm-only seconds to gain the same power. BELOW 1: the quest is FASTER than",
    "farming (too generous); ABOVE 1: it costs more than farming. The balance target is 1.0-1.35 (a quest never beats mobs).",
    "- Quest's own seconds (cost s): from the player's first choice of the quest to the turn-in. The walk to it is charged;",
    "  farming before the choice is not. A completion by a player who never chose the quest (kills passing by, a rival's",
    "  race) has no cost and is left out of the ratio.",
    "- Farm seconds: the solo farm-only runs' time to reach the same live-power gain from the start, as the Kaplan-Meier median",
    "  of all farm-only runs (all factions, all seeds). A run that DIED, STALLED (no mob kill for 75 s) or hit the cap before",
    "  reaching it is censored at that moment, never carried flat. The ratio is cost / farm s per completion, the cell the",
    "  median. Where the median rests on under 30% of the runs still in observation the farm time is unknown: farm s shows",
    "  '>' the longest run seen and the ratio an upper bound '<'; 'cens' counts those completions over the ones with a gain of 0.5 or more.",
    "- A completion that gained under 0.5 power ('no Δ'; e.g. Plague Rat on a build it does not work with) has no ratio: the reward",
    "  is worth about nothing to that seat, which is the finding, and a ratio against it would be noise.",
    "- Marginal: the same ratio with the farm time measured from the moment each farm run reached the power the player already",
    "  had before the quest (a quest done late in a build gains its Δ where the S-curve and the camps are different); farm runs",
    "  that never got that far are left out and it needs 3 of them. The two agree for a quest done from nothing.",
    "- Power is live buffPower: shared buffPower leaving out every buff whose buffDef(id).needs is set (Chain Warden,",
    "  Inquisitor, Bloatfly, Rot Monk, Frost Wisp, Glacial Warden: main never applies them) from every figure, the policies'",
    "  valuations included. Passives and GV are not power. Quest Δ is the change on the completion tick (median before → after).",
    "- Completion rate = completions by the player who chose the quest / first choices of it (one per player and quest). Farm-only",
    "  seats never choose a quest and the lobby that merely offered it is not counted; a kill-a-player quest (†) needs another",
    "  standing player, so only mixed lobbies can attempt it. 'seeds' is the distinct map seeds among the attempts: the policies",
    "  are deterministic, so seats of one seed differ by faction alone.",
    "- Deaths and fights are within 8 tiles of a giver, quest item or relevant kill camp (fights: new locks and idle-mob",
    "  engagements); one event can count for overlapping quests.",
    "- Seats: each solo seat plays FACTION_IDS[(seat + seed - 1 + 2 x policy index) mod 5], so five seats cover all five factions;",
    "  the mixed lobby seats consecutive factions. The farm-only baseline farms by the cost of a whole camp as measured by",
    "  bench/campDuel.ts, retreats only when it is losing, waits out the heal lockout to skip a camp chest, and with no camp it",
    "  can afford waits at most 5 s before it pulls the cheapest (questBenchPolicy.ts).",
    "- Patience and sudden death: patienceSeconds, patienceMinSeconds, firstPatienceSeconds and suddenDeathSeconds are 1e6 s, so",
    "  no coliseum teleport (which closes every quest and seals the gates) falls inside the cap: the policies measure farming and",
    "  questing, not the endgame, and the 5 min column and win rate are not the endgame's. A lobby with no winner by the cap has",
    "  no win.",
    "- Win rate = mixed-lobby wins / seats. Failures are printed, never gated.",
    "",
    `Configuration: ${observation.options.seeds} seed(s), ${observation.options.players} seats per policy and mixed-lobby players, ${observation.options.capSeconds}s cap;`,
    `${runs.length}/${lobbies} lobbies completed, ${runs.reduce((n, r) => n + r.ticks, 0)} active ticks.`,
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
    const tried = attempts.filter((a) => a.defId === defId);
    const done = completions.filter((c) => c.defId === defId);
    const doneByChooser = done.filter((c) => c.costSeconds !== null);
    const priced = doneByChooser.filter((c) => c.buffGain >= MIN_GAIN);
    const worthless = doneByChooser.length - priced.length;
    const farmTimes: number[] = [];
    const ratios: number[] = [];
    const marginalRatios: number[] = [];
    const upperBounds: number[] = [];
    for (const completion of priced) {
      const atRisk = farm.map((t) => marginalTimeToGain(t, completion.buffBefore, completion.buffGain)).filter((o) => o !== null);
      const marginal = atRisk.length >= MARGINAL_MIN_RUNS ? kaplanMeierMedian(atRisk) : null;
      if (marginal !== null && marginal > 0) marginalRatios.push(completion.costSeconds! / marginal);
      const farmSeconds = kaplanMeierMedian(farm.map((t) => timeToGain(t, completion.buffGain)));
      if (farmSeconds !== null && farmSeconds > 0) {
        farmTimes.push(farmSeconds);
        ratios.push(completion.costSeconds! / farmSeconds);
      } else if (farmSeconds === null && farmMaxSeconds > 0) {
        upperBounds.push(completion.costSeconds! / farmMaxSeconds);
      }
    }
    const censored = priced.length - ratios.length;
    const gains = done.map((c) => c.buffGain);
    const costs = doneByChooser.map((c) => c.costSeconds!);
    const before = done.length ? median(done.map((c) => c.buffBefore)) : NaN;
    const after = done.length ? median(done.map((c) => c.buffAfter)) : NaN;
    const site = runs.reduce((cell, r) => {
      const value = r.sites[defId];
      cell.deaths += value?.deaths ?? 0;
      cell.fights += value?.fights ?? 0;
      return cell;
    }, { deaths: 0, fights: 0 });
    const completed = doneByChooser.length;
    const rate = tried.length ? `${completed}/${tried.length} (${percent(completed / tried.length)})` : pvp.has(defId) ? "0/0 (mixed only)" : "0/0";
    const farmCell = farmTimes.length ? number(median(farmTimes), 1) : upperBounds.length ? `>${number(farmMaxSeconds, 0)}` : "-";
    const ratioCell = ratios.length ? number(median(ratios))
      : upperBounds.length ? `<${number(median(upperBounds))}`
      : worthless > 0 ? "no Δ" : "-";
    return [
      pvp.has(defId) ? `${name} †` : name,
      rate,
      String(new Set(tried.map((a) => a.seed)).size),
      number(done.length ? median(done.map((c) => c.seconds)) : NaN, 1),
      number(percentile(done.map((c) => c.seconds), 0.9), 1),
      number(costs.length ? median(costs) : NaN, 1),
      `${number(gains.length ? median(gains) : NaN)} (${number(before)}→${number(after)})`,
      farmCell,
      ratioCell,
      marginalRatios.length ? number(median(marginalRatios)) : worthless > 0 && priced.length === 0 ? "no Δ" : "-",
      `${censored}/${priced.length}${worthless > 0 ? ` +${worthless} no Δ` : ""}`,
      String(site.deaths),
      String(site.fights),
    ];
  });
  lines.push("## Per quest (ratio: below 1 = quest faster than farming, target 1.0-1.35)", "");
  lines.push(...table(
    ["quest", "done/attempts", "seeds", "median s", "p90 s", "cost s", "quest Δ (before→after)", "farm s", "ratio", "marginal", "cens", "deaths", "fights"],
    questRows.length ? questRows : [["(no quest observations)", "-", "-", "-", "-", "-", "-", "-", "-", "-", "-", "-", "-"]],
  ));
  if (pvp.size > 0) lines.push("", "† needs another standing player: solo seats cannot attempt it.");
  const incidental = completions.filter((c) => c.costSeconds === null).length;
  lines.push("", `Completions by a player who never chose the quest (left out of rate and ratio): ${incidental}.`);

  const base = farmBaselineSummary(timelines);
  lines.push("", "## Farm-only baseline (the reference for farm s)", "");
  lines.push(
    `${base.runs} solo runs: ${base.survived} reached the end of the run, ${base.died} died, ${base.stalled} stalled (no kill for 75 s).`,
    `Still going (not dead, not stalled) at 1/2/3/5 min: ${[60, 120, 180, 300].map((s) => s > observation.options.capSeconds ? "-" : `${farm.filter((t) => t.censorAt >= s).length}/${farm.length}`).join(", ")}; earliest end ${number(farm.length ? Math.min(...farm.map((t) => t.censorAt)) : NaN, 0)} s.`,
    `Median end of the curve ${number(base.medianEnd, 0)} s (a death or stall censors the run there, it is not carried flat); median kills ${number(base.medianKills, 0)}.`,
    "",
  );
  const factions = [...new Set(farm.map((t) => t.faction))].sort();
  lines.push(...table(["faction", "runs", "survived", "died (median s)", "stalled", "median kills", "median end power"], factions.map((faction) => {
    const mine = farm.filter((t) => t.faction === faction);
    const died = mine.filter((t) => t.end === "died");
    return [
      faction,
      String(mine.length),
      String(mine.filter((t) => t.end === "survived").length),
      `${died.length}${died.length ? ` (${number(median(died.map((t) => t.censorAt)), 0)})` : ""}`,
      String(mine.filter((t) => t.end === "stalled").length),
      number(median(mine.map((t) => t.kills)), 0),
      number(median(mine.map((t) => t.power[t.power.length - 1]!)), 1),
    ];
  })));

  lines.push("", "## Policy live buffPower", "");
  lines.push("Mean (median; runs still going / runs). A run that ended earlier is absent from later columns, never carried flat.", "");
  lines.push(...table(["policy", "1 min", "2 min", "3 min", "5 min"], QUEST_POLICY_IDS.map((policy) => {
    const cells = [60, 120, 180, 300].map((seconds) => {
      const sample = powerAt(timelines, policy, seconds);
      return `${number(sample.mean, 1)} (${number(sample.median, 1)}; ${sample.active}/${sample.n})`;
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
