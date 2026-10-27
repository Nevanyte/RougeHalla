// The three scripted questBench policies. They read what a client sees (world.state, never world.quests) and send ordinary
// client inputs. Farming, which every policy falls back to, is a farmer's, not a brawler's: the pieces are the bots' own
// (bots/mobHunt.ts matchupShare, retreatPoint and pathLength, bots/chestHunt.ts ChestHunter), plus the rules below, so the
// farm-only baseline survives long enough to be a pace and not a death time:
//   - it prices a camp before it pulls it. Camp-wide aggro (D24) wakes every member at the first hit, so a camp is a far
//     bigger fight than the sum of its mobs; matchupShare (one mob, no weapons) misses that by 2-3x for the bow and wand
//     starters, so the price is what bench/campDuel.ts measures in the real sim for the whole camp (campCost). It pulls the
//     nearest camp whose cost fits the hp it has with a margin;
//   - a retreat (hp under 30% with mobs about) or a camp that gives no kill for 14 s bans the camp, and the whole zone for
//     90 s: its mobs share one weapon and one matchup, so a loss to one says what the next will do (Frost's shield against a
//     shield camp, a Holy wand against a sword camp, which matchupShare cannot see);
//   - after a camp falls it takes the camp's chest: a skip heals 15% once the 3 s heal lockout is over (the farmer waits for
//     it when hurt), a pick takes the best passive when it is not;
//   - nothing heals a player otherwise, so with no camp affordable it waits at most 5 s, then pulls the cheapest anyway: the
//     longest stand-still in 15 solo runs was 8 s. A farmer that makes no kill for 75 s is flagged `stalledAt`, which the bench reports as a censored
//     end of the baseline, and the farmer carries on.
import {
  CARD_TIER_RATE, cardDef, cardLive, cardPower, FACTION_IDS, findPath, hasLineOfSight, INTERACT_RANGE, isEliteCamp, isFactionId,
  isWeaponId, PLAYER_RADIUS, PLAYER_SPEED, questDefById, segmentClear, TARGET_RANGE, TILE,
  type CampDef, type CardCounts, type FactionId, type QuestDef, type Vec2,
} from "@raid/shared";
import type { MobState, PlayerState, QuestState } from "@raid/shared/schema";
import { runCampDuel } from "../../bench/campDuel";
import { ChestHunter } from "../bots/chestHunt";
import { pathLength, retreatPoint } from "../bots/mobHunt";
import { enqueueClientMessage } from "../sim/inputs";
import { collisionMap, type PlayerRuntime, type World } from "../sim/world";

/** Power of the cards that apply (the live ones: a card waiting for its hook counts for nothing); policy valuation and the report use only this. */
export function liveCardPower(build: CardCounts | null | undefined): number {
  const live: Record<string, number> = {};
  const add = (count: number, id: string): void => {
    if (count > 0 && cardLive(id)) live[id] = count;
  };
  const forEach = (build as { forEach?: unknown } | null | undefined)?.forEach;
  if (typeof forEach === "function") (build as { forEach(cb: (count: number, id: string) => void): void }).forEach(add);
  else if (build) for (const [id, count] of Object.entries(build as Record<string, number>)) add(count, id);
  return cardPower(live);
}

/** Tier points of an elite camp's chest on average (BALANCE_CONTRACT 8.3): the 10/60/30 odds on one base card and one augment. */
const ELITE_CHEST_TIER_RATE = 2.2;

export type QuestPolicyId = "farm-only" | "quest-greedy" | "mixed";
export const QUEST_POLICY_IDS: readonly QuestPolicyId[] = ["farm-only", "quest-greedy", "mixed"];

export interface QuestDecisionView {
  id: string;
  def: QuestDef;
  s: QuestState;
}

export function questStates(world: World): ReadonlyMap<string, QuestState> {
  return world.state.quests;
}

/** A quest this player could do now: a kill of a player needs another one standing; kinds the policies do not know are skipped. */
export function feasible(world: World, playerId: string, def: QuestDef): boolean {
  if (def.kind !== "kill" && def.kind !== "collect" && def.kind !== "fetch") return false;
  if (!def.players) return true;
  for (const [id, other] of world.state.players) if (id !== playerId && other.status === "alive") return true;
  return false;
}

export function visibleQuests(world: World, playerId?: string): QuestDecisionView[] {
  const out: QuestDecisionView[] = [];
  for (const [id, s] of questStates(world)) {
    if (s.status !== "open") continue;
    const def = questDefById(s.def);
    if (def && (playerId === undefined || feasible(world, playerId, def))) out.push({ id, def, s });
  }
  return out;
}

export const FARM = {
  /** Under this hp share, with mobs about, the farmer runs. */
  retreatHp: 0.3,
  retreatMs: 5000,
  /**
   * A camp is pulled when its estimated cost, times `riskFactor` (a pull costs up to twice the table's cost on a real map),
   * plus `hpMargin` fits the hp.
   */
  hpMargin: 0.08,
  riskFactor: 2.2,
  powerRelief: 0.02,
  powerReliefMax: 0.4,
  campStallMs: 14_000,
  campBanMs: 45_000,
  zoneBanMs: 90_000,
  idleMaxMs: 5000,
  stallMs: 75_000,
  /** Hurt below this share, a chest is skipped (heals 15%); above it, a passive is taken. */
  healBelow: 0.8,
  /** The server's heal lockout is 3 s after the last damage dealt or taken. */
  lockoutMs: 3300,
  chestHoldMs: 9000,
} as const;

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
  /** Quests given up on for lack of a target, with the server time they may be tried again. */
  skipQuests: Map<string, number>;
  farmCampAt: number;
  farmCampKills: number;
  farmRetreatUntil: number;
  farmBanned: Map<number, number>;
  zoneBans: Map<string, number>;
  chests: ChestHunter;
  chestHoldFrom: number;
  hp: number;
  combatAt: number;
  lastKillAt: number;
  idleSince: number;
  /** Server time of the first 75 s without a kill, or null. Only the farm-only baseline reads it (as a censored end). */
  stalledAt: number | null;
  /** The engaged camp's total mob hp and the farmer's own hp, every 400 ms for 4 s: what the fight is doing, to judge a retreat. */
  trend: Array<{ t: number; camp: number; mine: number; mobs: number }>;
}

export function newPolicyMemory(p: PlayerState, now: number): PolicyMemory {
  return {
    goal: "", movedAt: -Infinity, pickupAt: -Infinity, questId: null, camp: 0, campOwner: "", itemId: null,
    mobKills: p.mobKills, lastMobFaction: "", tourRegions: new Set(), skipQuests: new Map(),
    farmCampAt: now, farmCampKills: p.mobKills, farmRetreatUntil: 0, farmBanned: new Map(), zoneBans: new Map(),
    chests: new ChestHunter(), chestHoldFrom: 0, hp: p.hp, combatAt: -Infinity, lastKillAt: now, idleSince: 0, stalledAt: null, trend: [],
  };
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

// --- Camps: what a pull costs ------------------------------------------------------------------------------------------

interface CampView {
  index: number;
  camp: CampDef;
  mobs: MobState[];
  risk: number;
  d: number;
}

const CAMP_COSTS = new Map<string, number>();

/**
 * What a whole camp of four costs a starter, as a share of max hp: bench/campDuel.ts's `camp` pull in the real sim (a
 * starting player on its signature weapon against one mono-type camp, every member waking at the first hit), the worse of
 * two seeds, measured once per process (about 0.8 s). 9 = it did not clear (it lost, or the shields stalled): the farmer
 * will not pull that camp until it has no other.
 */
function campCost(faction: FactionId, zone: FactionId, elite: boolean): number {
  const key = `${faction}/${zone}/${elite}`;
  let cost = CAMP_COSTS.get(key);
  if (cost === undefined) {
    cost = 0;
    for (const seed of [1, 2]) {
      const r = runCampDuel({ player: faction, zone, elite, pull: "camp", seed });
      cost = Math.max(cost, r.outcome === "cleared" ? 1 - Math.min(r.hpLeft, r.minHp) : 9);
    }
    CAMP_COSTS.set(key, cost);
  }
  return cost;
}

/**
 * Estimated share of max hp a pull of these mobs costs this player: the table above for four mobs, scaled to the mobs still
 * standing by N(N+1)/20 (the kills come one by one while the rest still hit, so a camp costs about N(N+1)/2 of one duel),
 * and cut 2% per point of live power (at most 40%). 1 when the faction is unknown.
 */
export function campRisk(faction: FactionId | null, mobs: readonly MobState[], power: number): number {
  if (mobs.length === 0) return 0;
  const zone = mobs[0]!.faction;
  if (!faction || !isFactionId(zone)) return 1;
  const base = campCost(faction, zone, mobs.some((m) => m.kind === "elite"));
  const relief = base >= 9 ? 1 : 1 - Math.min(FARM.powerReliefMax, FARM.powerRelief * power);
  return base * ((mobs.length * (mobs.length + 1)) / 20) * relief;
}

function campViews(world: World, p: PlayerState): CampView[] {
  const groups = new Map<number, MobState[]>();
  for (const m of world.state.mobs.values()) {
    if (!regional(m) || m.camp < 1) continue;
    const list = groups.get(m.camp);
    if (list) list.push(m);
    else groups.set(m.camp, [m]);
  }
  const faction = isFactionId(p.faction) ? p.faction : null;
  const power = liveCardPower(p.build);
  const out: CampView[] = [];
  for (const [camp, mobs] of groups) {
    const def = world.map.camps[camp - 1];
    if (def) out.push({ index: camp, camp: def, mobs, risk: campRisk(faction, mobs, power), d: distance(p, def) });
  }
  return out;
}

/**
 * Whether the farmer should finish the camp it is fighting rather than run: from the last 4 s it reads how fast the mobs'
 * hp falls and how fast its own does, and presses on when it expects to still stand (at 5% or more) once the mobs left are
 * dead, counting their damage as falling with each kill (a 0.6 share of the current rate). Running from awake mobs costs hp
 * too: they chase to the leash. True when it cannot tell (no dealt damage yet reads as losing).
 */
function pressOn(mem: PolicyMemory, p: PlayerState, view: CampView | undefined, now: number): boolean {
  if (!view) return false;
  const mobs = view.mobs.reduce((n, m) => n + m.hp, 0);
  const last = mem.trend[mem.trend.length - 1];
  if (!last || last.camp !== view.index) mem.trend = [];
  if (!last || now - last.t >= 400 || last.camp !== view.index) mem.trend.push({ t: now, camp: view.index, mine: p.hp, mobs });
  while (mem.trend.length > 1 && now - mem.trend[0]!.t > 4000) mem.trend.shift();
  const first = mem.trend[0]!;
  const dt = (now - first.t) / 1000;
  if (dt < 1.5) return false;
  const dealt = Math.max(0, first.mobs - mobs) / dt;
  const taken = Math.max(0, first.mine - p.hp) / dt;
  if (dealt <= 0) return false;
  return p.hp - taken * (mobs / dealt) * 0.6 >= 0.05 * p.maxHp;
}

function campBanned(mem: PolicyMemory, v: CampView, now: number): boolean {
  return (mem.farmBanned.get(v.index) ?? 0) > now || (mem.zoneBans.get(v.camp.zone) ?? 0) > now;
}

/** The nearest camp whose cost fits the hp (margin first, then none), or null: the farmer then waits. */
function affordableCamp(views: readonly CampView[], mem: PolicyMemory, hp: number, now: number): CampView | null {
  for (const margin of [FARM.hpMargin, 0]) {
    let best: CampView | null = null;
    for (const v of views) {
      if (campBanned(mem, v, now) || v.risk * FARM.riskFactor > hp - margin) continue;
      if (!best || v.d < best.d) best = v;
    }
    if (best) return best;
  }
  return null;
}

/** Camp-clearing seconds the mixed policy prices a farm option at: the walk plus 12 s a mob (FARM_SECONDS_PER_MOB). */
function campValueRate(world: World, p: PlayerState, mem: PolicyMemory): number {
  const hp = p.maxHp > 0 ? p.hp / p.maxHp : 1;
  const now = world.state.serverTime;
  const view = affordableCamp(campViews(world, p), mem, hp, now);
  if (!view) return 0;
  // What the camp's chest is worth: its average tier points, one pick (BALANCE_CONTRACT 8.3).
  const value = isEliteCamp(view.camp) ? ELITE_CHEST_TIER_RATE : CARD_TIER_RATE;
  const seconds = view.d / PLAYER_SPEED + 12 * view.mobs.length;
  return seconds > 0 ? value / seconds : 0;
}

// --- Quests ------------------------------------------------------------------------------------------------------------

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

/** The nearest camp that still holds a mob the quest counts, then its nearest such mob. */
function questCampTarget(
  world: World, p: PlayerState, mem: PolicyMemory, owner: string, accept: (m: MobState) => boolean,
): Target | null {
  if (mem.campOwner !== owner) {
    mem.campOwner = owner;
    mem.camp = 0;
  }
  if (mem.camp > 0 && ![...world.state.mobs.values()].some((m) => regional(m) && m.camp === mem.camp && accept(m))) mem.camp = 0;
  if (mem.camp === 0) {
    let best = 0;
    let bestDistance = Infinity;
    world.map.camps.forEach((camp, i) => {
      if (![...world.state.mobs.values()].some((m) => regional(m) && m.camp === i + 1 && accept(m))) return;
      const d = distance(p, camp);
      if (d < bestDistance) { best = i + 1; bestDistance = d; }
    });
    mem.camp = best;
  }
  if (mem.camp > 0) return nearestMob(world, p, (m) => m.camp === mem.camp && accept(m));
  return nearestMob(world, p, accept);
}

function killTarget(world: World, playerId: string, p: PlayerState, mem: PolicyMemory, q: QuestDecisionView): Target | null {
  if (q.def.players) return nearestPlayer(world, playerId, p);
  let target = questCampTarget(world, p, mem, `quest:${q.id}`, acceptKillMob(q, mem));
  if (!target && q.def.tour) {
    const progress = q.s.progress.get(playerId) ?? 0;
    const region = FACTION_IDS[progress % FACTION_IDS.length]!;
    target = questCampTarget(world, p, mem, `quest:${q.id}:fallback`, (m) => m.faction === region);
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

/** Live power the nominal reward adds to this player: its card's tier (the server's feed brake is not priced in). */
export function questRewardPower(_p: PlayerState, q: QuestDecisionView): number {
  const def = cardDef(q.def.reward.card);
  return def && cardLive(def) ? def.tier : 0;
}

function nearestQuest(world: World, p: PlayerState, mem: PolicyMemory, playerId: string): QuestDecisionView | null {
  const now = world.state.serverTime;
  let best: { q: QuestDecisionView; d: number } | null = null;
  for (const q of visibleQuests(world, playerId)) {
    if ((mem.skipQuests.get(q.id) ?? 0) > now) continue;
    const d = distance(p, q.s);
    if (!best || d < best.d) best = { q, d };
  }
  return best?.q ?? null;
}

function nearestPlayer(world: World, playerId: string, p: PlayerState): Target | null {
  const chosen = [...world.state.players.entries()]
    .filter(([id, other]) => id !== playerId && other.status === "alive")
    .sort((a, b) => distance(p, a[1]) - distance(p, b[1]))[0];
  return chosen ? { key: `player:${chosen[0]}`, id: chosen[0], at: chosen[1] } : null;
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

function mixedQuest(world: World, playerId: string, p: PlayerState, mem: PolicyMemory): QuestDecisionView | null {
  const now = world.state.serverTime;
  const farmRate = campValueRate(world, p, mem);
  let best: { q: QuestDecisionView; rate: number; d: number } | null = null;
  for (const q of visibleQuests(world, playerId)) {
    if ((mem.skipQuests.get(q.id) ?? 0) > now) continue;
    const seconds = distance(p, estimatePoint(world, playerId, p, q)) / PLAYER_SPEED + q.def.objSec;
    const rate = seconds > 0 ? questRewardPower(p, q) / seconds : 0;
    const d = distance(p, q.s);
    if (rate > farmRate && (!best || rate > best.rate || (rate === best.rate && d < best.d))) best = { q, rate, d };
  }
  return best?.q ?? null;
}

// --- Farming -----------------------------------------------------------------------------------------------------------

const asWeapon = (def: string) => (isWeaponId(def) ? def : null);

/**
 * The housekeeping the farmer does about a cleared camp's chest: a skip once the heal lockout is over when hurt, else a
 * passive. Returns where to walk, or "hold" while it waits out the lockout beside the chest.
 */
function chestStep(
  world: World, playerId: string, p: PlayerState, rt: PlayerRuntime, mem: PolicyMemory, fighting: boolean,
): Vec2 | "hold" | null {
  const chests = [...world.state.containers.values()].filter((c) => c.kind === "reward");
  if (chests.length === 0) return null;
  const now = world.state.serverTime;
  const map = collisionMap(world);
  const hurt = p.maxHp > 0 && p.hp / p.maxHp < FARM.healBelow;
  const near = chests.some((c) => distance(p, c) <= 88 && hasLineOfSight(map, p, c));
  if (hurt && near && now - mem.combatAt < FARM.lockoutMs) {
    if (mem.chestHoldFrom === 0) mem.chestHoldFrom = now;
    if (now - mem.chestHoldFrom < FARM.chestHoldMs) return "hold";
  } else mem.chestHoldFrom = 0;
  const d = mem.chests.decide({
    now,
    serverTime: now,
    self: {
      id: playerId, x: p.x, y: p.y, faction: p.faction, weapons: [asWeapon(p.weapon0), asWeapon(p.weapon1)], build: p.build,
    },
    chests,
    walk: (to) => {
      const path = findPath(map, p, to);
      return path.length === 0 ? null : pathLength(p, path);
    },
    sight: (to) => hasLineOfSight(map, p, to),
    fighting,
    retreating: false,
    inColiseum: world.state.gatesLocked,
  });
  if (d.kind === "pick") {
    enqueueClientMessage(rt.inputs, "choose", { chest: d.chest, pick: hurt ? -1 : d.option });
    return null;
  }
  return d.kind === "walk" ? d.to : null;
}

function farm(world: World, playerId: string, p: PlayerState, rt: PlayerRuntime, mem: PolicyMemory): void {
  const now = world.state.serverTime;
  const hp = p.maxHp > 0 ? p.hp / p.maxHp : 1;
  const views = campViews(world, p);
  const threats = [...world.state.mobs.values()].filter((m) => regional(m) && distance(p, m) < 12 * TILE);

  if (now - mem.lastKillAt >= FARM.stallMs && mem.stalledAt === null) mem.stalledAt = now;

  // A kill resets the camp's stall clock; 14 s at a camp without one bans the camp and its zone.
  if (p.mobKills > mem.farmCampKills) {
    mem.farmCampKills = p.mobKills;
    mem.farmCampAt = now;
  } else if (mem.camp > 0 && now - mem.farmCampAt >= FARM.campStallMs) {
    banCamp(world, mem, now);
  }

  const engagedView = mem.camp > 0 ? views.find((v) => v.index === mem.camp) : undefined;
  const finishIt = pressOn(mem, p, engagedView, now);
  if (hp < FARM.retreatHp && threats.length > 0 && now >= mem.farmRetreatUntil && !finishIt) {
    mem.farmRetreatUntil = now + FARM.retreatMs;
    banCamp(world, mem, now);
  }
  if (now < mem.farmRetreatUntil && threats.length > 0) {
    const at = retreatPoint(p, threats, (a, b) => segmentClear(collisionMap(world), a, b, PLAYER_RADIUS));
    if (at) {
      moveTo(world, rt, mem, { key: `farm-retreat:${Math.round(at.x)}:${Math.round(at.y)}`, at });
      return;
    }
  }

  const engaged = threats.some((m) => m.hp < m.maxHp);
  const chest = world.state.gatesLocked ? null : chestStep(world, playerId, p, rt, mem, engaged);
  if (chest === "hold") return;
  if (chest) { moveTo(world, rt, mem, { key: `chest:${Math.round(chest.x)}:${Math.round(chest.y)}`, at: chest }); return; }

  let view: CampView | null = null;
  if (!world.state.gatesLocked) {
    const current = mem.camp > 0 ? views.find((v) => v.index === mem.camp) : undefined;
    // A camp already in a fight is finished unless the hp makes the farmer run (above): switching strands the wake.
    view = current && !campBanned(mem, current, now) ? current : affordableCamp(views, mem, hp, now);
    if (!view) {
      if (mem.idleSince === 0) mem.idleSince = now;
      if (now - mem.idleSince >= FARM.idleMaxMs) {
        // Nothing heals the farmer, so waiting is not a plan: pull the cheapest camp anyway and forget the zone bans.
        mem.zoneBans.clear();
        view = views.filter((v) => (mem.farmBanned.get(v.index) ?? 0) <= now).sort((a, b) => a.risk - b.risk)[0] ?? null;
      }
    }
    if (view) mem.idleSince = 0;
  }
  if (view && view.index !== mem.camp) {
    mem.camp = view.index;
    mem.campOwner = "farm";
    mem.farmCampAt = now;
  }
  const target = view
    ? nearestMob(world, p, (m) => m.camp === view.index)
    : world.state.gatesLocked ? nearestPlayer(world, playerId, p) : null;
  if (target) engage(world, p, rt, mem, target);
}

function banCamp(world: World, mem: PolicyMemory, now: number): void {
  if (mem.camp > 0) {
    mem.farmBanned.set(mem.camp, now + FARM.campBanMs);
    const zone = world.map.camps[mem.camp - 1]?.zone;
    if (zone) mem.zoneBans.set(zone, now + FARM.zoneBanMs);
  }
  mem.camp = 0;
  mem.farmCampAt = now;
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
  const now = world.state.serverTime;
  if (p.hp < mem.hp - 0.01 || p.attackTarget !== "") mem.combatAt = now;
  mem.hp = p.hp;
  if (p.mobKills > mem.mobKills) mem.lastKillAt = now;
  const visible = visibleQuests(world, playerId);
  let q = visible.find((offer) => offer.id === mem.questId) ?? null;
  if (p.mobKills > mem.mobKills && q?.def.tour && mem.lastMobFaction) mem.tourRegions.add(mem.lastMobFaction);
  mem.mobKills = p.mobKills;
  if (mem.questId && !q) clearQuest(mem);
  if (world.state.gatesLocked && mem.questId) clearQuest(mem);
  if (!world.state.gatesLocked && policy !== "farm-only") {
    if (!q) {
      q = policy === "quest-greedy" ? nearestQuest(world, p, mem, playerId) : mixedQuest(world, playerId, p, mem);
      if (q) selectQuest(mem, q);
    }
  } else if (policy === "farm-only" || world.state.gatesLocked) {
    q = null;
  }
  const target = q ? questTarget(world, playerId, p, mem, q) : null;
  if (q && !target) {
    mem.skipQuests.set(q.id, now + 20_000);
    clearQuest(mem);
  }
  if (!target) { farm(world, playerId, p, rt, mem); return; }
  if (target.container && distance(p, target.at) <= INTERACT_RANGE - 4) {
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
