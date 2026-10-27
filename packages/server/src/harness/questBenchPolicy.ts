import {
  buffPower, campMatchup, ELITE_BUFF_STACKS, FACTION_IDS, INTERACT_RANGE, isFactionId, MOB_BUFF_STACKS, PLAYER_SPEED,
  questDefById, stacksIn, TARGET_RANGE, TILE, type CampDef, type FactionId, type Vec2,
} from "@raid/shared";
import type { MobState, PlayerState } from "@raid/shared/schema";
import { enqueueClientMessage } from "../sim/inputs";
import type { PlayerRuntime, World } from "../sim/world";

export type QuestPolicyId = "farm-only" | "quest-greedy" | "mixed";
export const QUEST_POLICY_IDS: readonly QuestPolicyId[] = ["farm-only", "quest-greedy", "mixed"];

export interface QuestDefView {
  id: string;
  name: string;
  kind: "kill" | "collect" | "fetch";
  count: number;
  region?: FactionId;
  elite?: boolean;
  players?: boolean;
  tour?: number;
  objSec: number;
  reward: { stacks: number; buff?: string; stat?: string };
}

export interface QuestStateView {
  id: string;
  def: string;
  x: number;
  y: number;
  known: boolean;
  status: string;
  doneBy: string;
  carrier: string;
  progress: { get(id: string): number | undefined };
}

export interface QuestDecisionView {
  id: string;
  def: QuestDefView;
  s: QuestStateView;
}

export function questStates(world: World): Map<string, QuestStateView> | undefined {
  return (world.state as unknown as { quests?: Map<string, QuestStateView> }).quests;
}

export function visibleQuests(world: World): QuestDecisionView[] {
  const states = questStates(world);
  if (!states) return [];
  const out: QuestDecisionView[] = [];
  for (const [id, s] of states) {
    if (s.status !== "open" || s.known === false) continue;
    const def = questDefById(s.def);
    if (def) out.push({ id, def, s });
  }
  return out;
}

export interface PolicyMemory {
  goal: string;
  movedAt: number;
  pickupAt: number;
  questId: string | null;
  camp: number;
  campOwner: string;
  itemId: string | null;
  mobKills: number;
  lastMobFaction: string;
  tourRegions: Set<string>;
}

interface Target {
  key: string;
  at: Vec2;
  id?: string;
  container?: string;
  faction?: string;
}

const distance = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
const regional = (m: MobState): boolean => m.status === "alive" && (m.kind === "mob" || m.kind === "elite");

function moveTo(world: World, rt: PlayerRuntime, mem: PolicyMemory, target: Target): void {
  const now = world.state.serverTime;
  if (mem.goal !== target.key || now - mem.movedAt >= 500) {
    enqueueClientMessage(rt.inputs, "move", target.at);
    mem.goal = target.key;
    mem.movedAt = now;
  }
}

function engage(world: World, p: PlayerState, rt: PlayerRuntime, mem: PolicyMemory, target: Target): void {
  if (target.id && distance(p, target.at) <= TARGET_RANGE) {
    if (rt.weapon.lock !== target.id) enqueueClientMessage(rt.inputs, "target", { id: target.id });
    mem.goal = `fight:${target.id}`;
    mem.lastMobFaction = target.faction ?? "";
    return;
  }
  moveTo(world, rt, mem, target);
}

function nearestMob(world: World, p: PlayerState, accept: (m: MobState) => boolean = () => true): Target | null {
  let best: { m: MobState; id: string; d: number } | null = null;
  for (const [id, m] of world.state.mobs) {
    if (!regional(m) || !accept(m)) continue;
    const d = distance(p, m);
    if (!best || d < best.d) best = { m, id, d };
  }
  return best ? { key: `mob:${best.id}`, id: best.id, at: best.m, faction: best.m.faction } : null;
}

function campTarget(
  world: World, p: PlayerState, mem: PolicyMemory, owner: string, accept: (m: MobState) => boolean = () => true,
  acceptCamp?: (camp: CampDef) => boolean,
): Target | null {
  if (mem.campOwner !== owner) {
    mem.campOwner = owner;
    mem.camp = 0;
  }
  if (mem.camp > 0 && ![...world.state.mobs.values()].some((m) => regional(m) && m.camp === mem.camp && accept(m))) {
    mem.camp = 0;
  }
  if (mem.camp === 0) {
    let best = -1;
    let bestDistance = Infinity;
    world.map.camps.forEach((camp, i) => {
      if (acceptCamp && !acceptCamp(camp)) return;
      const alive = [...world.state.mobs.values()].some((m) => regional(m) && m.camp === i + 1 && accept(m));
      if (!alive) return;
      const d = distance(p, camp);
      if (d < bestDistance) { best = i + 1; bestDistance = d; }
    });
    mem.camp = best;
  }
  if (mem.camp > 0) return nearestMob(world, p, (m) => m.camp === mem.camp && accept(m));
  return acceptCamp ? null : nearestMob(world, p, accept);
}

function questReady(q: QuestDecisionView, playerId: string): boolean {
  return q.def.kind === "fetch"
    ? q.s.carrier === playerId
    : (q.s.progress.get(playerId) ?? 0) >= q.def.count;
}

function giverTarget(q: QuestDecisionView): Target {
  return { key: `giver:${q.id}`, at: q.s };
}

function nearestQuestItem(world: World, p: PlayerState, q: QuestDecisionView): Target | null {
  const suffix = `:${q.id}`;
  let best: { id: string; at: Vec2; d: number } | null = null;
  for (const [id, box] of world.state.containers) {
    if (box.kind !== "quest") continue;
    const item = box.items.at(0);
    if (!item || !item.def.endsWith(suffix)) continue;
    const d = distance(p, box);
    if (!best || d < best.d) best = { id, at: box, d };
  }
  return best ? { key: `item:${best.id}`, at: best.at, container: best.id } : null;
}

function questItem(world: World, p: PlayerState, mem: PolicyMemory, q: QuestDecisionView): Target | null {
  if (mem.itemId) {
    const box = world.state.containers.get(mem.itemId);
    const item = box?.items.at(0);
    if (box?.kind === "quest" && item?.def.endsWith(`:${q.id}`)) {
      return { key: `item:${box.id}`, at: box, container: box.id };
    }
    mem.itemId = null;
  }
  const target = nearestQuestItem(world, p, q);
  mem.itemId = target?.container ?? null;
  return target;
}

function acceptKillMob(q: QuestDecisionView, mem: PolicyMemory): (m: MobState) => boolean {
  const def = q.def;
  return (m) => {
    if (def.elite && m.kind !== "elite") return false;
    if (def.region && m.faction !== def.region) return false;
    if (def.tour && mem.tourRegions.has(m.faction)) return false;
    return true;
  };
}

function killTarget(world: World, playerId: string, p: PlayerState, mem: PolicyMemory, q: QuestDecisionView): Target | null {
  if (q.def.players) return nearestPlayer(world, playerId, p);
  let target = campTarget(world, p, mem, `quest:${q.id}`, acceptKillMob(q, mem));
  if (!target && q.def.tour) {
    const progress = q.s.progress.get(playerId) ?? 0;
    const region = FACTION_IDS[progress % FACTION_IDS.length]!;
    target = campTarget(world, p, mem, `quest:${q.id}:fallback`, (m) => m.faction === region);
  }
  return target;
}

function carrierTarget(world: World, q: QuestDecisionView): Target | null {
  if (q.s.carrier === "") return null;
  const carrier = world.state.players.get(q.s.carrier);
  return carrier?.status === "alive"
    ? { key: `carrier:${q.s.carrier}`, id: q.s.carrier, at: carrier }
    : null;
}

function questTarget(
  world: World, playerId: string, p: PlayerState, mem: PolicyMemory, q: QuestDecisionView,
): Target | null {
  if (questReady(q, playerId)) return giverTarget(q);
  if (q.def.kind === "kill") return killTarget(world, playerId, p, mem, q);
  if (q.def.kind === "fetch") return carrierTarget(world, q) ?? questItem(world, p, mem, q);
  return questItem(world, p, mem, q);
}

const LEGACY_REWARD_BUFF: Readonly<Record<string, string>> = {
  attackSpeed: "plagueRat",
  hp: "iceGolem",
  moveSpeed: "cinderHound",
};

function rewardBuffId(q: QuestDecisionView): string | undefined {
  const id = q.def.reward.buff ?? q.def.reward.stat;
  return id ? LEGACY_REWARD_BUFF[id] ?? id : undefined;
}

export function questRewardPower(p: PlayerState, q: QuestDecisionView): number {
  const id = rewardBuffId(q);
  if (!id) return 0;
  const before = stacksIn(p.buffs, id);
  return buffPower({ [id]: before + q.def.reward.stacks }) - buffPower({ [id]: before });
}

function nearestQuest(world: World, p: PlayerState): QuestDecisionView | null {
  let best: { q: QuestDecisionView; d: number } | null = null;
  for (const q of visibleQuests(world)) {
    const d = distance(p, q.s);
    if (!best || d < best.d) best = { q, d };
  }
  return best?.q ?? null;
}

function nearestCampMob(world: World, p: PlayerState): Target | null {
  let camp = -1;
  let campDistance = Infinity;
  world.map.camps.forEach((c, i) => {
    const alive = [...world.state.mobs.values()].some((m) => regional(m) && m.camp === i + 1);
    if (!alive) return;
    const d = distance(p, c);
    if (d < campDistance) { camp = i; campDistance = d; }
  });
  if (camp >= 0) return nearestMob(world, p, (m) => m.camp === camp + 1);
  return nearestMob(world, p);
}

function campValueRate(world: World, p: PlayerState): number {
  const target = nearestCampMob(world, p);
  if (!target?.id) return 0;
  const first = world.state.mobs.get(target.id);
  if (!first) return 0;
  const camp = first.camp;
  const mates = [...world.state.mobs.values()].filter((m) => regional(m) && (camp > 0 ? m.camp === camp : m === first));
  const grants = new Map<string, number>();
  for (const m of mates) {
    if (!m.type) continue;
    const stacks = m.kind === "elite" ? ELITE_BUFF_STACKS : MOB_BUFF_STACKS;
    grants.set(m.type, (grants.get(m.type) ?? 0) + stacks);
  }
  let value = 0;
  for (const [id, stacks] of grants) {
    const before = stacksIn(p.buffs, id);
    value += buffPower({ [id]: before + stacks }) - buffPower({ [id]: before });
  }
  const seconds = distance(p, first) / PLAYER_SPEED + 12 * mates.length;
  return seconds > 0 ? value / seconds : 0;
}

function estimatePoint(world: World, playerId: string, p: PlayerState, q: QuestDecisionView): Vec2 {
  if (questReady(q, playerId)) return q.s;
  if (q.def.kind === "fetch") return carrierTarget(world, q)?.at ?? nearestQuestItem(world, p, q)?.at ?? q.s;
  if (q.def.kind === "collect") return nearestQuestItem(world, p, q)?.at ?? q.s;
  if (q.def.players) return nearestPlayer(world, playerId, p)?.at ?? q.s;
  const visited = new Set<string>(FACTION_IDS.slice(0, q.s.progress.get(playerId) ?? 0));
  return nearestMob(world, p, (m) => {
    if (q.def.elite && m.kind !== "elite") return false;
    if (q.def.region && m.faction !== q.def.region) return false;
    if (q.def.tour && visited.has(m.faction)) return false;
    return true;
  })?.at ?? q.s;
}

function mixedQuest(world: World, playerId: string, p: PlayerState): QuestDecisionView | null {
  const farmRate = campValueRate(world, p);
  let best: { q: QuestDecisionView; rate: number; d: number } | null = null;
  for (const q of visibleQuests(world)) {
    const seconds = distance(p, estimatePoint(world, playerId, p, q)) / PLAYER_SPEED + q.def.objSec;
    const rate = seconds > 0 ? questRewardPower(p, q) / seconds : 0;
    const d = distance(p, q.s);
    if (rate > farmRate && (!best || rate > best.rate || (rate === best.rate && d < best.d))) best = { q, rate, d };
  }
  return best?.q ?? null;
}

function nearestPlayer(world: World, playerId: string, p: PlayerState): Target | null {
  const chosen = [...world.state.players.entries()]
    .filter(([id, other]) => id !== playerId && other.status === "alive")
    .sort((a, b) => distance(p, a[1]) - distance(p, b[1]))[0];
  return chosen ? { key: `player:${chosen[0]}`, id: chosen[0], at: chosen[1] } : null;
}

function farm(world: World, playerId: string, p: PlayerState, rt: PlayerRuntime, mem: PolicyMemory): void {
  let target: Target | null = null;
  if (!world.state.gatesLocked) {
    const normal = (camp: CampDef): boolean => camp.eliteSpot < 0;
    const faction = isFactionId(p.faction) ? p.faction : null;
    target = campTarget(world, p, mem, "farm-safe", () => true,
      (camp) => normal(camp) && !!faction && campMatchup(faction, camp) > 0);
    if (!target) target = campTarget(world, p, mem, "farm-normal", () => true, normal);
    if (!target && buffPower(p.buffs) >= 3) {
      target = campTarget(world, p, mem, "farm-elite", () => true,
        (camp) => !!faction && campMatchup(faction, camp) > 0);
    }
  }
  const endgame = target ?? nearestPlayer(world, playerId, p);
  if (endgame) engage(world, p, rt, mem, endgame);
}

function selectQuest(mem: PolicyMemory, q: QuestDecisionView): void {
  if (mem.questId === q.id) return;
  mem.questId = q.id;
  mem.camp = 0;
  mem.campOwner = "";
  mem.itemId = null;
  mem.tourRegions = new Set();
}

function clearQuest(mem: PolicyMemory): void {
  mem.questId = null;
  mem.camp = 0;
  mem.campOwner = "";
  mem.itemId = null;
  mem.tourRegions.clear();
}

/** One honest scripted client's orders for this tick. It reads visible state and sends ordinary client inputs only. */
export function driveQuestPolicy(
  world: World, policy: QuestPolicyId, playerId: string, mem: PolicyMemory,
): void {
  const p = world.state.players.get(playerId);
  const rt = world.players.get(playerId);
  if (!p || !rt || p.status !== "alive" || world.state.phase !== "active") return;
  const visible = visibleQuests(world);
  let q = visible.find((offer) => offer.id === mem.questId) ?? null;
  if (p.mobKills > mem.mobKills && q?.def.tour && mem.lastMobFaction) mem.tourRegions.add(mem.lastMobFaction);
  mem.mobKills = p.mobKills;
  if (world.state.gatesLocked && mem.questId) clearQuest(mem);
  if (!world.state.gatesLocked && policy !== "farm-only") {
    if (!q) {
      q = policy === "quest-greedy" ? nearestQuest(world, p) : mixedQuest(world, playerId, p);
      if (q) selectQuest(mem, q);
    }
  } else if (policy === "farm-only" || world.state.gatesLocked) {
    q = null;
  }
  const target = q ? questTarget(world, playerId, p, mem, q) : null;
  if (q && !target) {
    clearQuest(mem);
    mem.camp = 0;
  }
  if (!target) { farm(world, playerId, p, rt, mem); return; }
  if (target.container && distance(p, target.at) <= INTERACT_RANGE - 4) {
    const now = world.state.serverTime;
    if (now - mem.pickupAt >= 250) {
      enqueueClientMessage(rt.inputs, "pickup", { containerId: target.container });
      mem.pickupAt = now;
    }
    return;
  }
  if (target.id) engage(world, p, rt, mem, target);
  else moveTo(world, rt, mem, target);
}

export const QUEST_SITE_RADIUS = 8 * TILE;
