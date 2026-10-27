// QUESTBENCH report-only balance harness.
// Completion time is seconds from raid start to the automatic turn-in. Power is shared buffPower, not GV or passives.
// The quest/farm ratio compares the median observed one-tick quest reward with the median pure-farm-only power at the
// same elapsed times; it is an opportunity-cost estimate, not a paired counterfactual. Deaths/fights are within eight
// tiles of a giver, quest item, or relevant kill camp and can be attributed to more than one nearby quest.
import { buffPower, FACTION_IDS, mulberry32, TICK_MS, type Vec2 } from "@raid/shared";
import { createGameWorld } from "../sim/gameplay";
import { addPlayer, step } from "../sim/step";
import type { SimConfig, World } from "../sim/world";
import {
  driveQuestPolicy, QUEST_SITE_RADIUS, QUEST_POLICY_IDS,
  type PolicyMemory, type QuestDecisionView, type QuestDefView, type QuestPolicyId,
} from "./questBenchPolicy";

interface QuestOfferView extends QuestDecisionView {
  containers?: string[];
  placement?: { tokens?: Vec2[]; parcel?: Vec2 };
}

interface QuestsRuntimeView {
  quests: Map<string, QuestOfferView>;
}

function questsRuntime(world: World): QuestsRuntimeView | undefined {
  return (world as unknown as { quests?: QuestsRuntimeView }).quests;
}

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
  seconds: number;
  buffBefore: number;
  buffAfter: number;
  buffGain: number;
}

export interface PowerTimeline {
  policy: QuestPolicyId;
  farmReference: boolean;
  duration: number;
  seconds: number[];
  power: number[];
}

export interface QuestRunObservation {
  seed: number;
  scenario: string;
  ticks: number;
  questRuntime: boolean;
  offers: Array<{ defId: string; name: string }>;
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

interface TrackedOffer {
  q: QuestOfferView;
  sites: Vec2[];
  counted: boolean;
}

function offerSites(world: World, q: QuestOfferView): Vec2[] {
  const out: Vec2[] = [{ x: q.s.x, y: q.s.y }];
  for (const id of q.containers ?? []) {
    const box = world.state.containers.get(id);
    if (box) out.push({ x: box.x, y: box.y });
  }
  for (const at of q.placement?.tokens ?? []) out.push(at);
  if (q.placement?.parcel) out.push(q.placement.parcel);
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

function runOne(
  seed: number, scenario: string, lobby: "uniform" | "mixed", policies: readonly QuestPolicyId[], options: QuestBenchOptions,
  factionOffset = 0,
): QuestRunObservation {
  const config: SimConfig & { quests?: boolean } = {
    minPlayers: policies.length,
    lobbySeconds: 0,
    fillSeconds: 0,
    patienceSeconds: 300,
    patienceMinSeconds: 120,
    suddenDeathSeconds: 60,
    firstPatienceSeconds: 300,
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

  const observation: QuestRunObservation = {
    seed, scenario, ticks: 0, questRuntime: !!questsRuntime(world), offers: [], completions: [], sites: {}, timelines: [], mixed: [],
  };
  const offers: TrackedOffer[] = [];
  for (const q of questsRuntime(world)?.quests.values() ?? []) {
    offers.push({ q, sites: offerSites(world, q), counted: false });
    observation.offers.push({ defId: q.def.id, name: q.def.name });
  }
  const memories = new Map<string, PolicyMemory>();
  const timelines = new Map<string, { seconds: number[]; power: number[] }>();
  const previousPower = new Map<string, number>();
  const previousStatus = new Map<string, string>();
  const previousTargets = new Map<string, string>();
  const previousMobModes = new Map<string, string>();
  const startedAt = world.state.raidStartedAt;
  for (const [id, p] of world.state.players) {
    memories.set(id, {
      goal: "", movedAt: -Infinity, pickupAt: -Infinity, questId: null, camp: 0, campOwner: "", itemId: null,
      mobKills: p.mobKills, lastMobFaction: "", tourRegions: new Set(),
    });
    timelines.set(id, { seconds: [0], power: [buffPower(p.buffs)] });
    previousPower.set(id, buffPower(p.buffs));
    previousStatus.set(id, p.status);
    previousTargets.set(id, p.attackTarget);
    if (lobby === "mixed") observation.mixed.push({ id, policy: policyAt(policies, id), win: false });
  }
  const maxTicks = Math.ceil(options.capSeconds * 1000 / TICK_MS);
  for (let tick = 0; tick < maxTicks && world.state.phase === "active"; tick++) {
    for (const [id] of world.players) {
      driveQuestPolicy(world, policyAt(policies, id), id, memories.get(id)!);
      const p = world.state.players.get(id)!;
      previousTargets.set(id, p.attackTarget);
      previousStatus.set(id, p.status);
      previousPower.set(id, buffPower(p.buffs));
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
      const after = player ? buffPower(player[1].buffs) : 0;
      const before = player ? previousPower.get(player[0]) ?? after : after;
      observation.completions.push({
        defId: q.def.id,
        name: q.def.name,
        policy: player ? policyAt(policies, player[0]) : "farm-only",
        seconds: elapsed,
        buffBefore: before,
        buffAfter: after,
        buffGain: after - before,
      });
    }
    for (const [id, p] of world.state.players) {
      if (previousStatus.get(id) === "alive" && p.status !== "alive") noteSite(observation, offers, p, "deaths");
      const target = p.attackTarget;
      if (target !== "" && previousTargets.get(id) !== target) noteSite(observation, offers, p, "fights");
      const timeline = timelines.get(id)!;
      let sample = Math.floor(timeline.seconds[timeline.seconds.length - 1]!) + 1;
      while (elapsed >= sample) {
        timeline.seconds.push(sample);
        timeline.power.push(buffPower(p.buffs));
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
      timeline.power.push(buffPower(p.buffs));
    }
    if (finalSeconds < options.capSeconds) {
      timeline.seconds.push(options.capSeconds);
      timeline.power.push(buffPower(p.buffs));
    }
    observation.timelines.push({
      policy: policyAt(policies, id),
      farmReference: scenario === "farm-only",
      duration: finalSeconds,
      ...timeline,
    });
  }
  return observation;
}

export function runQuestBench(options: QuestBenchOptions): QuestBenchObservation {
  const out: QuestBenchObservation = { options, runs: [], errors: [] };
  for (let seed = 1; seed <= options.seeds; seed++) {
    for (const policy of QUEST_POLICY_IDS) {
      for (let seat = 0; seat < options.players; seat++) {
        const label = `seed ${seed}/${options.seeds} ${policy} seat ${seat + 1}/${options.players}`;
        options.log?.(label);
        try {
          out.runs.push(runOne(seed, policy, "uniform", [policy], options, seat));
        } catch (error) {
          out.errors.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
    const policyOffset = (2 * (seed - 1)) % QUEST_POLICY_IDS.length;
    const policies = Array.from({ length: options.players },
      (_, i) => QUEST_POLICY_IDS[(i + policyOffset) % QUEST_POLICY_IDS.length]!);
    const label = `seed ${seed}/${options.seeds} mixed-lobby`;
    options.log?.(label);
    try {
      out.runs.push(runOne(seed, "mixed-lobby", "mixed", policies, options, (seed - 1) % FACTION_IDS.length));
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

export function questDefName(def: QuestDefView): string {
  return def.name;
}
