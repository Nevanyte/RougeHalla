// The planning phase (roguelike R3): between the lobby and the run, when SimConfig.planSeconds is above 0.
//
//   - Start (startPlanning, from the lobby): the room locks (the Room does it on `planningStarted`), RaidState.planEndsAt is
//     set, and every player is dealt two spawns from map.spawnPool (dealSpawns), told in a private `plan` message.
//   - Each planning tick (updatePlanning): the players' queued `plan` inputs apply in the tick's secret actionOrder, so the
//     first to pick a spawn holds it and, within one tick, the order (not the join order) decides. Every other input is
//     dropped: nobody moves, attacks or is hurt, and no mob exists yet (they are placed when the run starts). A player whose
//     message changed (an option taken or freed by someone else, their own pick) is sent it again.
//   - End: at planEndsAt, or as soon as every connected player is ready (at least one connected). Players with no pick get
//     their first untaken option, then the other (assignSpawns), everyone is placed there, and the run starts (startRaid:
//     raidStarted, mobs, loot, the first patience timer).
//
// Secrecy: the deal draws only from world.rewardRandom (never world.random, never the public seed), lives in
// world.planning, and reaches a player only in their own `plan` message. The state carries planEndsAt and planReady, nothing
// else. Picks travel as indexes into the player's own two options, so a client can name nothing it was not dealt.
import { sameTier, spawnWalks, type PlanMessage, type Vec2 } from "@raid/shared";
import type { PlanCommand } from "./inputs";
import { emit, type World } from "./world";

/** One player's private deal. */
export interface PlanDeal {
  /** The two dealt spawns, as indexes into map.spawnPool; [-1, -1] on a map with no pool (hand-built test maps). */
  spawns: [number, number];
  /** Their own spawn pick (an index into `spawns`), -1 for none. */
  pick: -1 | 0 | 1;
  /** Start boons (R7); empty until then. */
  boons: string[];
  boon: -1 | 0 | 1;
  /** The last `plan` message sent, serialised, so an unchanged one is not sent again. */
  sent: string;
}

/** How a deal went: which rule it met, for the tests and the measurements. */
export interface DealReport {
  /**
   * "global": every dealt spawn in one walking tier; "pairs": each pair in a tier of its own; "fallback": at least one pair
   * is not a tier pair (the closest walks in different zones were dealt instead); "none": no pool to deal from.
   */
  rule: "global" | "pairs" | "fallback" | "none";
  /** Pairs whose two spawns are one tier, out of `pairs`. */
  tierPairs: number;
  pairs: number;
  /** Pairs whose two spawns share a zone (only when nothing else could be dealt). */
  sameZonePairs: number;
  /** Spawns dealt to more than one player: 0 whenever the pool holds two per player. */
  shared: number;
}

export interface PlanningRuntime {
  deals: Map<string, PlanDeal>;
  /** Pool index -> the player whose pick holds it. */
  holders: Map<number, string>;
  report: DealReport;
}

/** A candidate pair of pool spawns (i < j) and how they compare. */
interface Pair { i: number; j: number; tier: boolean; sameZone: boolean; ratio: number }

/** Most DFS steps one disjoint-pairs search may take before it gives up (the pool is 15 on wedge maps: it never comes close). */
const SEARCH_BUDGET = 20_000;
/** The same for each try at leaving one particular spawn over (up to one try per spawn of the pool). */
const SPARE_BUDGET = 1_500;

/** True while the world has a planning phase to run. */
export function planningEnabled(world: World): boolean {
  return !world.config.training && (world.config.planSeconds ?? 0) > 0;
}

/** The lobby closed: deal, lock, and wait for the picks. */
export function startPlanning(world: World): void {
  const s = world.state;
  s.phase = "planning";
  s.planEndsAt = s.serverTime + (world.config.planSeconds ?? 0) * 1000;
  for (const [id, p] of s.players) {
    p.planReady = false;
    world.players.get(id)?.inputs.drain();
  }
  const ids = [...s.players.keys()];
  const { pairs, report } = dealSpawns(world, ids.length);
  const deals = new Map<string, PlanDeal>();
  ids.forEach((id, k) => deals.set(id, { spawns: pairs[k] ?? [-1, -1], pick: -1, boons: [], boon: -1, sent: "" }));
  world.planning = { deals, holders: new Map(), report };
  emit(world, { type: "planningStarted" });
  sendChanged(world);
}

/** One planning tick: the picks in the tick's secret order, the messages that changed, then the end check. */
export function updatePlanning(world: World, order: readonly string[], startRaid: (world: World, placed: Map<string, Vec2>) => void): void {
  const s = world.state;
  for (const id of order) {
    const rt = world.players.get(id);
    if (!rt) continue;
    for (const cmd of rt.inputs.drain().actions) if (cmd.kind === "plan") applyPlan(world, id, cmd);
  }
  sendChanged(world);
  if (s.serverTime >= s.planEndsAt || everyoneReady(world)) startRaid(world, assignSpawns(world, order));
}

/** A player's message as it stands, or null outside a deal (the Room resends it on a reconnect during planning). */
export function planFor(world: World, id: string): PlanMessage | null {
  const deal = world.planning?.deals.get(id);
  if (!deal || world.state.phase !== "planning") return null;
  const holders = world.planning!.holders;
  const takenBy = (k: 0 | 1): boolean => {
    const h = holders.get(deal.spawns[k]);
    return h !== undefined && h !== id;
  };
  return {
    endsAt: world.state.planEndsAt,
    spawns: [deal.spawns[0], deal.spawns[1]],
    taken: [takenBy(0), takenBy(1)],
    pick: deal.pick,
    boons: deal.boons.slice(),
    boon: deal.boon,
  };
}

/** A player left during planning: what they held is free again, and whoever was dealt it is told. */
export function leavePlanning(world: World, id: string): void {
  const plan = world.planning;
  if (!plan || world.state.phase !== "planning") return;
  plan.deals.delete(id);
  for (const [index, holder] of plan.holders) if (holder === id) plan.holders.delete(index);
  sendChanged(world);
}

function applyPlan(world: World, id: string, cmd: PlanCommand): void {
  const p = world.state.players.get(id);
  const deal = world.planning?.deals.get(id);
  if (!p || !deal || p.planReady) return;
  const holders = world.planning!.holders;
  if (cmd.spawn !== undefined && deal.pick !== cmd.spawn) {
    const want = deal.spawns[cmd.spawn];
    const holder = holders.get(want);
    if (want >= 0 && (holder === undefined || holder === id)) {
      const had = pickedSpawn(deal);
      if (had >= 0 && holders.get(had) === id) holders.delete(had);
      holders.set(want, id);
      deal.pick = cmd.spawn;
    }
  }
  if (cmd.boon !== undefined && cmd.boon < deal.boons.length) deal.boon = cmd.boon;
  if (cmd.ready === true) p.planReady = true;
}

/** Sends `plan` to every player whose message differs from the last one they were sent. */
function sendChanged(world: World): void {
  const plan = world.planning;
  if (!plan) return;
  for (const [id, deal] of plan.deals) {
    const msg = planFor(world, id);
    if (!msg) continue;
    const key = JSON.stringify(msg);
    if (key === deal.sent) continue;
    deal.sent = key;
    emit(world, { type: "plan", to: id, plan: msg });
  }
}

/** Every connected player is ready, and somebody is connected (a room of dropped clients waits out the timer). */
function everyoneReady(world: World): boolean {
  let connected = 0;
  for (const [id, p] of world.state.players) {
    if (world.players.get(id)?.droppedAt !== null) continue;
    if (!p.planReady) return false;
    connected++;
  }
  return connected > 0;
}

/**
 * Where everyone starts. A pick stands (it is held by its picker alone). The others, in the tick's secret order, take their
 * first option nobody holds or was given, then the other; with both gone, the free pool spawn whose walk is nearest their
 * options' (the pool is short only on small hand-built maps), and with none free, their first option (shared). A world
 * with no pool places nobody here: startRaid falls back to today's shuffled spawns.
 */
export function assignSpawns(world: World, order: readonly string[]): Map<string, Vec2> {
  const out = new Map<string, Vec2>();
  const plan = world.planning;
  const pool = world.map.spawnPool;
  if (!plan || pool.length === 0) return out;
  const used = new Set<number>();
  const give = (id: string, index: number): void => {
    used.add(index);
    out.set(id, { x: pool[index]!.x, y: pool[index]!.y });
  };
  for (const id of order) {
    const deal = plan.deals.get(id);
    const had = deal ? pickedSpawn(deal) : -1;
    if (had >= 0 && plan.holders.get(had) === id) give(id, had);
  }
  const free = (index: number): boolean => index >= 0 && !used.has(index) && !plan.holders.has(index);
  const walks = spawnWalks(world.map);
  for (const id of order) {
    const deal = plan.deals.get(id);
    if (!deal || out.has(id)) continue;
    const [a, b] = deal.spawns;
    if (free(a)) { give(id, a); continue; }
    if (free(b)) { give(id, b); continue; }
    const want = (finite(walks[a]) + finite(walks[b])) / 2;
    let best = -1;
    for (let k = 0; k < pool.length; k++) {
      if (!free(k)) continue;
      if (best < 0 || Math.abs(finite(walks[k]) - want) < Math.abs(finite(walks[best]) - want)) best = k;
    }
    if (best >= 0) give(id, best);
    else if (a >= 0) give(id, a);
  }
  return out;
}

const finite = (v: number | undefined): number => (v !== undefined && Number.isFinite(v) ? v : 0);

/** The pool index a player's own pick names, or -1. */
function pickedSpawn(deal: PlanDeal): number {
  return deal.pick === -1 ? -1 : deal.spawns[deal.pick];
}

/**
 * Deals `n` players two spawns each from map.spawnPool, drawing only from world.rewardRandom. The rules, strongest first:
 *   1. The two spawns of a pair lie in different zones and in one walking tier (sameTier: within PLAN_WALK_TOLERANCE either
 *      side of one shared contour value of the walk to the coliseum, spawnWalks).
 *   2. While the pool holds two spawns per player, no spawn is dealt twice; beyond that, the extra players' pairs reuse as
 *      few dealt spawns as they can.
 *   3. Preferred, not required: every dealt spawn in ONE tier, so the players also start about as far from the centre as
 *      each other ("global").
 * When rule 1 cannot hold for every pair, the deal keeps as many tier pairs as it can and fills the rest with the pairs in
 * different zones whose walks are closest ("fallback"); pairs in one zone are the last resort. Pairs go to players in a
 * random order, and which spawn of a pair is option 0 is random too, so neither the join order nor the pool order shows.
 */
export function dealSpawns(world: World, n: number): { pairs: Array<[number, number]>; report: DealReport } {
  const map = world.map;
  const pool = map.spawnPool;
  const rand = world.rewardRandom;
  const empty: DealReport = { rule: "none", tierPairs: 0, pairs: 0, sameZonePairs: 0, shared: 0 };
  if (n <= 0) return { pairs: [], report: empty };
  if (pool.length === 0) return { pairs: Array.from({ length: n }, () => [-1, -1] as [number, number]), report: empty };
  if (pool.length === 1) {
    return { pairs: Array.from({ length: n }, () => [0, 0] as [number, number]), report: { ...empty, rule: "fallback", pairs: n, shared: n > 1 ? 1 : 0 } };
  }
  const walks = spawnWalks(map);
  const all: Pair[] = [];
  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      const lo = Math.min(walks[i]!, walks[j]!);
      const hi = Math.max(walks[i]!, walks[j]!);
      all.push({
        i, j, tier: sameTier(walks[i]!, walks[j]!), sameZone: pool[i]!.zone === pool[j]!.zone,
        ratio: Number.isFinite(lo) && lo > 0 && Number.isFinite(hi) ? hi / lo : Infinity,
      });
    }
  }
  const disjoint = Math.min(n, Math.floor(pool.length / 2));
  const tierPairs = shuffle(all.filter((p) => p.tier && !p.sameZone), rand);

  let chosen: Pair[] | null = null;
  let rule: DealReport["rule"] = "pairs";
  // 3: one tier for everyone. Each window starts at one spawn's walk and spans the tier ratio; a random feasible one is dealt.
  const windows: Pair[][] = [];
  const seen = new Set<string>();
  for (let k = 0; k < pool.length; k++) {
    if (!Number.isFinite(walks[k]!)) continue;
    const inside = (x: number): boolean => walks[x]! >= walks[k]! && sameTier(walks[k]!, walks[x]!);
    const key = pool.map((_, x) => (inside(x) ? "1" : "0")).join("");
    if (seen.has(key)) continue;
    seen.add(key);
    const inWindow = tierPairs.filter((p) => inside(p.i) && inside(p.j));
    if (inWindow.length >= disjoint) windows.push(inWindow);
  }
  for (const w of shuffle(windows, rand)) {
    chosen = findDisjoint(w, disjoint, pool.length);
    if (chosen) { rule = "global"; break; }
  }
  // 1 and 2: a tier of its own for each pair. With more players than the pool can give two each, one spawn is left over
  // for the extra player, who is dealt it with a partner: it is left over only if it has a tier partner in another zone.
  if (!chosen && n > disjoint && pool.length % 2 === 1) {
    const partnered = shuffle(pool.map((_, k) => k).filter((k) => tierPairs.some((p) => p.i === k || p.j === k)), rand);
    for (const spare of partnered) {
      const taken = new Uint8Array(pool.length);
      taken[spare] = 1;
      chosen = findDisjoint(tierPairs, disjoint, pool.length, { taken, budget: SPARE_BUDGET });
      if (chosen) break;
    }
  }
  if (!chosen) chosen = findDisjoint(tierPairs, disjoint, pool.length);
  // Fallback: as many tier pairs as there can be (the fewest others, `c`), the others the closest walks in different
  // zones, and pairs in one zone only when nothing else completes the deal.
  if (!chosen) {
    rule = "fallback";
    const near = shuffle(all.filter((p) => !p.tier && !p.sameZone), rand).sort((a, b) => a.ratio - b.ratio);
    const last = shuffle(all.filter((p) => p.sameZone), rand).sort((a, b) => a.ratio - b.ratio);
    const list = tierPairs.concat(near);
    for (let c = 1; c <= disjoint && !chosen; c++) {
      chosen = findDisjoint(list, disjoint, pool.length, { secondaryFrom: tierPairs.length, maxSecondary: c });
    }
    for (let c = 1; c <= disjoint && !chosen; c++) {
      chosen = findDisjoint(list.concat(last), disjoint, pool.length, { secondaryFrom: list.length, maxSecondary: c });
    }
    chosen ??= findDisjoint(all.slice().sort((a, b) => a.ratio - b.ratio), disjoint, pool.length) ?? [];
  }

  // 2, beyond the pool: each extra player gets the pair that reuses the fewest dealt spawns (so one of its options, the
  // spawn left over, is never anyone else's), then the best by rule 1.
  const uses = new Array<number>(pool.length).fill(0);
  for (const p of chosen) { uses[p.i]!++; uses[p.j]!++; }
  const extra: Pair[] = [];
  while (chosen.length + extra.length < n) {
    let best: Pair | null = null;
    let bestKey: number[] = [];
    for (const p of shuffle(all, rand)) {
      const key = [uses[p.i]! + uses[p.j]!, p.sameZone ? 1 : 0, p.tier ? 0 : 1, p.ratio];
      if (!best || lexLess(key, bestKey)) { best = p; bestKey = key; }
    }
    extra.push(best!);
    uses[best!.i]!++;
    uses[best!.j]!++;
  }
  const dealt = shuffle(chosen.concat(extra), rand);
  const pairs = dealt.map((p): [number, number] => (rand() < 0.5 ? [p.i, p.j] : [p.j, p.i]));
  const tierCount = dealt.filter((p) => p.tier && !p.sameZone).length;
  return {
    pairs,
    report: {
      rule: tierCount < dealt.length && rule !== "fallback" ? "fallback" : rule,
      tierPairs: tierCount,
      pairs: dealt.length,
      sameZonePairs: dealt.filter((p) => p.sameZone).length,
      shared: uses.filter((u) => u > 1).length,
    },
  };
}

/**
 * `need` pairs out of `pairs` (tried in their order) with no spawn twice and none in `taken`, or null; at most
 * `maxSecondary` of them from index `secondaryFrom` on. A depth-first search over combinations in list order, bounded by
 * SEARCH_BUDGET steps.
 */
function findDisjoint(
  pairs: readonly Pair[], need: number, poolSize: number,
  opts: { taken?: Uint8Array; secondaryFrom?: number; maxSecondary?: number; budget?: number } = {},
): Pair[] | null {
  const budget = opts.budget ?? SEARCH_BUDGET;
  if (need <= 0) return [];
  const used = opts.taken ? opts.taken.slice() : new Uint8Array(poolSize);
  const secondaryFrom = opts.secondaryFrom ?? pairs.length;
  const maxSecondary = opts.maxSecondary ?? 0;
  let free = 0;
  for (let k = 0; k < poolSize; k++) if (!used[k]) free++;
  const out: Pair[] = [];
  let secondary = 0;
  let steps = 0;
  const dfs = (from: number): boolean => {
    if (out.length === need) return true;
    if (free < 2 * (need - out.length) || ++steps > budget) return false;
    for (let k = from; k < pairs.length; k++) {
      if (pairs.length - k < need - out.length) return false;
      const late = k >= secondaryFrom;
      if (late && secondary >= maxSecondary) return false;
      const p = pairs[k]!;
      if (used[p.i] || used[p.j]) continue;
      used[p.i] = 1; used[p.j] = 1; free -= 2; out.push(p);
      if (late) secondary++;
      if (dfs(k + 1)) return true;
      if (late) secondary--;
      used[p.i] = 0; used[p.j] = 0; free += 2; out.pop();
      if (steps > budget) return false;
    }
    return false;
  };
  return dfs(0) ? out.slice() : null;
}

function lexLess(a: readonly number[], b: readonly number[]): boolean {
  for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) return a[k]! < b[k]!;
  return false;
}

/** A Fisher-Yates shuffle of a copy, from `rand`. */
function shuffle<T>(xs: readonly T[], rand: () => number): T[] {
  const out = xs.slice();
  for (let k = out.length - 1; k > 0; k--) {
    const j = Math.floor(rand() * (k + 1));
    [out[k], out[j]] = [out[j]!, out[k]!];
  }
  return out;
}
