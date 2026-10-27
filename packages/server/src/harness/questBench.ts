// QUESTBENCH report-only balance harness. See the printed READ THIS header for metric definitions.
import { FACTION_IDS, mulberry32, TICK_MS, type Vec2 } from "@raid/shared";
import { createGameWorld } from "../sim/gameplay";
import { addPlayer, step } from "../sim/step";
import type { SimConfig, World } from "../sim/world";
import {
  driveQuestPolicy, liveCardPower, newPolicyMemory, QUEST_SITE_RADIUS, QUEST_POLICY_IDS,
  type PolicyMemory, type QuestPolicyId,
} from "./questBenchPolicy";

export interface QuestBenchOptions {
  seeds: number;
  players: number;
  capSeconds: number;
  log?: (line: string) => void;
}

export interface QuestCompletionSample {
  defId: string;
  name: string;
  policy: QuestPolicyId;
  seed: number;
  /** Raid start to the turn-in. */
  seconds: number;
  /** The quest's own seconds: first selection by the player who finished it to the turn-in; null when that player never chose it (finished by passing kills, or by a rival's race). */
  costSeconds: number | null;
  powerBefore: number;
  powerAfter: number;
  powerGain: number;
}

/** A policy choosing a quest for the first time (one per player and quest: a re-pick after a detour is not a new attempt). */
export interface QuestAttemptSample {
  defId: string;
  name: string;
  policy: QuestPolicyId;
  playerId: string;
  seed: number;
  atSeconds: number;
  /** The lobby had no other player: a quest that needs a second one cannot be done. */
  solo: boolean;
}

/** How a run's power curve ends: it died, it made no kill for 75 s (stalled), or it was still going at the end of the run. */
export type TimelineEnd = "died" | "stalled" | "survived";

export interface PowerTimeline {
  policy: QuestPolicyId;
  faction: string;
  farmReference: boolean;
  duration: number;
  seconds: number[];
  power: number[];
  end: TimelineEnd;
  /** Seconds after which the curve says nothing about what a competent farmer would have gained: the death, the stall, or the run's end. */
  censorAt: number;
  kills: number;
}

export interface QuestRunObservation {
  seed: number;
  scenario: string;
  ticks: number;
  questRuntime: boolean;
  offers: Array<{ defId: string; name: string; needsAnotherPlayer: boolean }>;
  attempts: QuestAttemptSample[];
  completions: QuestCompletionSample[];
  sites: Record<string, { deaths: number; fights: number }>;
  timelines: PowerTimeline[];
  mixed: Array<{ id: string; policy: QuestPolicyId; win: boolean }>;
}

export interface QuestBenchObservation {
  options: QuestBenchOptions;
  runs: QuestRunObservation[];
  errors: string[];
}

type QuestRuntimeOf = NonNullable<World["quests"]>["quests"] extends Map<string, infer Q> ? Q : never;

interface TrackedOffer {
  q: QuestRuntimeOf;
  sites: Vec2[];
  counted: boolean;
}

function offerSites(world: World, q: TrackedOffer["q"]): Vec2[] {
  const out: Vec2[] = [{ x: q.s.x, y: q.s.y }];
  for (const id of q.containers) {
    const box = world.state.containers.get(id);
    if (box) out.push({ x: box.x, y: box.y });
  }
  for (const at of q.placement.tokens ?? []) out.push(at);
  if (q.placement.parcel) out.push(q.placement.parcel);
  const def = q.def;
  if (def.kind === "kill" && !def.players) {
    world.map.camps.forEach((camp) => {
      if (def.tour || (!def.region && def.elite) || camp.zone === def.region) out.push(camp);
    });
  }
  return out;
}

function nearOffer(offer: TrackedOffer, at: Vec2): boolean {
  return offer.sites.some((site) => Math.hypot(site.x - at.x, site.y - at.y) <= QUEST_SITE_RADIUS);
}

function noteSite(
  observation: QuestRunObservation, offers: readonly TrackedOffer[], at: Vec2, key: "deaths" | "fights",
): void {
  for (const offer of offers) {
    if (!nearOffer(offer, at)) continue;
    const defId = offer.q.def.id;
    const cell = observation.sites[defId] ?? (observation.sites[defId] = { deaths: 0, fights: 0 });
    cell[key]++;
  }
}

function policyAt(policies: readonly QuestPolicyId[], playerId: string): QuestPolicyId {
  return policies[Number(playerId.slice(1))] ?? "farm-only";
}

/**
 * One lobby, `policies.length` seats (seat i plays FACTION_IDS[(i + factionOffset) % 5]). Patience, sudden death and the
 * first patience timer are 1e6 s so no teleport into the sealed coliseum ends the measure inside the cap: every seat farms
 * or quests until it dies or the cap, and the policies never see the endgame.
 */
export function runQuestLobby(
  seed: number, scenario: string, lobby: "uniform" | "mixed", policies: readonly QuestPolicyId[], options: QuestBenchOptions,
  factionOffset = 0,
): QuestRunObservation {
  const config: SimConfig = {
    minPlayers: policies.length,
    lobbySeconds: 0,
    fillSeconds: 0,
    patienceSeconds: 1_000_000,
    patienceMinSeconds: 1_000_000,
    suddenDeathSeconds: 1_000_000,
    firstPatienceSeconds: 1_000_000,
    mobs: true,
    planSeconds: 0,
    quests: true,
  };
  const world = createGameWorld({
    seed,
    random: mulberry32((seed ^ 0x5142454e) >>> 0),
    rewardSalt: (seed ^ 0x52535451) >>> 0,
    config,
  });
  for (let i = 0; i < policies.length; i++) {
    addPlayer(world, `p${i}`, `bench-${i}`, { faction: FACTION_IDS[(i + factionOffset) % FACTION_IDS.length] });
  }
  step(world, TICK_MS);
  if (world.state.phase !== "active") throw new Error(`seed ${seed} ${scenario}: raid did not start`);

  const solo = policies.length === 1;
  const observation: QuestRunObservation = {
    seed, scenario, ticks: 0, questRuntime: world.quests !== null, offers: [], attempts: [], completions: [], sites: {},
    timelines: [], mixed: [],
  };
  const offers: TrackedOffer[] = [];
  for (const q of world.quests?.quests.values() ?? []) {
    offers.push({ q, sites: offerSites(world, q), counted: false });
    observation.offers.push({ defId: q.def.id, name: q.def.name, needsAnotherPlayer: q.def.players === true });
  }
  const memories = new Map<string, PolicyMemory>();
  const timelines = new Map<string, { seconds: number[]; power: number[] }>();
  const previousPower = new Map<string, number>();
  const previousStatus = new Map<string, string>();
  const previousTargets = new Map<string, string>();
  const previousMobModes = new Map<string, string>();
  const diedAt = new Map<string, number>();
  const attemptedAt = new Map<string, number>();
  const selectedQuests = new Map<string, string | null>();
  const startedAt = world.state.raidStartedAt;
  for (const [id, p] of world.state.players) {
    memories.set(id, newPolicyMemory(p, world.state.serverTime));
    timelines.set(id, { seconds: [0], power: [liveCardPower(p.build)] });
    previousPower.set(id, liveCardPower(p.build));
    previousStatus.set(id, p.status);
    previousTargets.set(id, p.attackTarget);
    selectedQuests.set(id, null);
    if (lobby === "mixed") observation.mixed.push({ id, policy: policyAt(policies, id), win: false });
  }
  const maxTicks = Math.ceil(options.capSeconds * 1000 / TICK_MS);
  for (let tick = 0; tick < maxTicks && world.state.phase === "active"; tick++) {
    const sinceStart = (world.state.serverTime - startedAt) / 1000;
    for (const [id] of world.players) {
      driveQuestPolicy(world, policyAt(policies, id), id, memories.get(id)!);
      const selected = memories.get(id)!.questId;
      if (selected !== selectedQuests.get(id)) {
        selectedQuests.set(id, selected);
        const q = selected ? world.quests?.quests.get(selected) : undefined;
        if (q && !attemptedAt.has(`${id}:${q.def.id}`)) {
          attemptedAt.set(`${id}:${q.def.id}`, sinceStart);
          observation.attempts.push({
            defId: q.def.id, name: q.def.name, policy: policyAt(policies, id), playerId: id, seed, atSeconds: sinceStart, solo,
          });
        }
      }
      const p = world.state.players.get(id)!;
      previousTargets.set(id, p.attackTarget);
      previousStatus.set(id, p.status);
      previousPower.set(id, liveCardPower(p.build));
    }
    for (const [id, rt] of world.mobs) previousMobModes.set(id, rt.brain?.mode ?? "");

    const events = step(world, TICK_MS);
    observation.ticks++;
    const elapsed = (world.state.serverTime - startedAt) / 1000;

    for (const offer of offers) {
      const q = offer.q;
      if (offer.counted || q.s.status !== "done") continue;
      offer.counted = true;
      const player = [...world.state.players.entries()].find(([, p]) => p.name === q.s.doneBy);
      const after = player ? liveCardPower(player[1].build) : 0;
      const before = player ? previousPower.get(player[0]) ?? after : after;
      const startedQuestAt = player ? attemptedAt.get(`${player[0]}:${q.def.id}`) : undefined;
      observation.completions.push({
        defId: q.def.id,
        name: q.def.name,
        policy: player ? policyAt(policies, player[0]) : "farm-only",
        seed,
        seconds: elapsed,
        costSeconds: startedQuestAt === undefined ? null : elapsed - startedQuestAt,
        powerBefore: before,
        powerAfter: after,
        powerGain: after - before,
      });
    }
    for (const [id, p] of world.state.players) {
      if (previousStatus.get(id) === "alive" && p.status !== "alive") {
        noteSite(observation, offers, p, "deaths");
        if (!diedAt.has(id)) diedAt.set(id, elapsed);
      }
      const target = p.attackTarget;
      if (target !== "" && previousTargets.get(id) !== target) noteSite(observation, offers, p, "fights");
      const timeline = timelines.get(id)!;
      let sample = Math.floor(timeline.seconds[timeline.seconds.length - 1]!) + 1;
      while (elapsed >= sample) {
        timeline.seconds.push(sample);
        timeline.power.push(liveCardPower(p.build));
        sample++;
      }
    }
    for (const [id, rt] of world.mobs) {
      if (rt.brain?.mode === "fight" && previousMobModes.get(id) === "idle") {
        const m = world.state.mobs.get(id);
        if (m) noteSite(observation, offers, m, "fights");
      }
    }
    if (lobby === "mixed") {
      for (const event of events) {
        if (event.type === "resolved" && event.result.outcome === "won") {
          const result = observation.mixed.find((r) => r.id === event.id);
          if (result) result.win = true;
        }
      }
    }
  }
  const finalSeconds = Math.min(options.capSeconds, (world.state.serverTime - startedAt) / 1000);
  for (const [id, p] of world.state.players) {
    const timeline = timelines.get(id)!;
    if (timeline.seconds[timeline.seconds.length - 1] !== finalSeconds) {
      timeline.seconds.push(finalSeconds);
      timeline.power.push(liveCardPower(p.build));
    }
    const died = diedAt.get(id);
    const stalledMs = memories.get(id)!.stalledAt;
    const stalled = stalledMs === null ? undefined : Math.max(0, (stalledMs - startedAt) / 1000);
    // The earlier of the two ends the curve's meaning; a run still going at the cap is censored there.
    const end: TimelineEnd = died !== undefined && (stalled === undefined || died <= stalled)
      ? "died" : stalled !== undefined ? "stalled" : "survived";
    observation.timelines.push({
      policy: policyAt(policies, id),
      faction: p.faction,
      farmReference: scenario === "farm-only",
      duration: finalSeconds,
      ...timeline,
      end,
      censorAt: end === "died" ? died! : end === "stalled" ? Math.min(stalled!, finalSeconds) : finalSeconds,
      kills: p.mobKills,
    });
  }
  return observation;
}

/**
 * Seats rotate through all five factions: a solo seat of policy P on seed S plays faction (seat + S - 1 + 2 x P's index) mod 5,
 * so five seats cover every faction on any seed and fewer seats still shift by seed and policy. The mixed lobby seats consecutive
 * factions from (S - 1) mod 5.
 */
export function runQuestBench(options: QuestBenchOptions): QuestBenchObservation {
  const out: QuestBenchObservation = { options, runs: [], errors: [] };
  for (let seed = 1; seed <= options.seeds; seed++) {
    QUEST_POLICY_IDS.forEach((policy, policyIndex) => {
      for (let seat = 0; seat < options.players; seat++) {
        const label = `seed ${seed}/${options.seeds} ${policy} seat ${seat + 1}/${options.players}`;
        options.log?.(label);
        try {
          out.runs.push(runQuestLobby(seed, policy, "uniform", [policy], options, seat + seed - 1 + 2 * policyIndex));
        } catch (error) {
          out.errors.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    });
    const policyOffset = (2 * (seed - 1)) % QUEST_POLICY_IDS.length;
    const policies = Array.from({ length: options.players },
      (_, i) => QUEST_POLICY_IDS[(i + policyOffset) % QUEST_POLICY_IDS.length]!);
    const label = `seed ${seed}/${options.seeds} mixed-lobby`;
    options.log?.(label);
    try {
      out.runs.push(runQuestLobby(seed, "mixed-lobby", "mixed", policies, options, (seed - 1) % FACTION_IDS.length));
    } catch (error) {
      out.errors.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return out;
}

export function timelinePowerAt(timeline: PowerTimeline, seconds: number): number | null {
  const i = timeline.seconds.findIndex((t) => t >= seconds);
  if (i < 0) return null;
  if (i === 0 || timeline.seconds[i] === seconds) return timeline.power[i]!;
  const a = i - 1;
  const span = timeline.seconds[i]! - timeline.seconds[a]!;
  const share = span > 0 ? (seconds - timeline.seconds[a]!) / span : 0;
  return timeline.power[a]! + (timeline.power[i]! - timeline.power[a]!) * share;
}

/** First interpolated crossing, or null when this run ended (death, stall, cap) below the requested live-power gain. */
export function farmSecondsForGain(timeline: PowerTimeline, gain: number): number | null {
  if (!(gain > 0)) return 0;
  for (let i = 0; i < timeline.seconds.length; i++) {
    const power = timeline.power[i]!;
    if (power < gain) continue;
    if (i === 0) return timeline.seconds[i]!;
    const before = timeline.power[i - 1]!;
    const span = power - before;
    const share = span > 0 ? (gain - before) / span : 0;
    return timeline.seconds[i - 1]! + (timeline.seconds[i]! - timeline.seconds[i - 1]!) * share;
  }
  return null;
}

/** One farm-only run's answer to "when did you gain `gain`": the crossing, or the moment the run stopped being informative. */
export interface TimeToGain {
  t: number;
  /** True: the run reached the gain at `t`. False: right-censored, it was dead, stalled or over at `t` without having. */
  reached: boolean;
}

export function timeToGain(timeline: PowerTimeline, gain: number): TimeToGain {
  const at = farmSecondsForGain(timeline, gain);
  if (at !== null && at <= timeline.censorAt) return { t: at, reached: true };
  return { t: timeline.censorAt, reached: false };
}

/**
 * The same measured from the moment the run reached `before` (the power the quest's player already had): how long the
 * farmer needs for the NEXT `gain` at that stage of a build. Null when the run never got as far as `before` (it is not at
 * risk of this question), 0 start when `before` is nothing.
 */
export function marginalTimeToGain(timeline: PowerTimeline, before: number, gain: number): TimeToGain | null {
  let start = 0;
  if (before > 0) {
    const at = farmSecondsForGain(timeline, before);
    if (at === null || at > timeline.censorAt) return null;
    start = at;
  }
  const done = timeToGain(timeline, before + gain);
  return { t: Math.max(0, done.t - start), reached: done.reached };
}

/**
 * Kaplan-Meier median of right-censored times: the first time the share still waiting drops to a half or below, or null
 * when that is never observed, or only with under `minShare` of the runs still in observation (a death is not independent
 * of being slow, so a median that rests on the last few survivors would read the baseline faster than it was). Plain
 * medians of the runs that reached the gain would read fast too, since the runs that died are exactly the slow ones.
 */
export function kaplanMeierMedian(samples: readonly TimeToGain[], minShare = 0.3): number | null {
  const sorted = [...samples].sort((a, b) => a.t - b.t || Number(b.reached) - Number(a.reached));
  let atRisk = sorted.length;
  let survival = 1;
  for (let i = 0; i < sorted.length;) {
    const t = sorted[i]!.t;
    let events = 0;
    let leaving = 0;
    while (i < sorted.length && sorted[i]!.t === t) {
      if (sorted[i]!.reached) events++;
      leaving++;
      i++;
    }
    if (events > 0) {
      const watching = atRisk / sorted.length;
      survival *= 1 - events / atRisk;
      if (survival <= 0.5) return watching >= minShare ? t : null;
    }
    atRisk -= leaving;
  }
  return null;
}
