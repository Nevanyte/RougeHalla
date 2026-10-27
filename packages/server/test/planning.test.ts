// The planning phase (roguelike R3, sim/planning.ts), headless: the flow from the lobby through planning into the run, the
// `plan` inputs and the ready latch, the spawn deal (one tier, two zones, disjoint while the pool allows, private and
// deterministic from the reward stream alone), the taken flow and its same-tick rule, leaving, the first patience timer
// (decision 10) and the config. The Room's part (private messages, the held seat, reconnects) is in planningRoom.test.ts.
import { describe, expect, it } from "vitest";
import {
  campMatchup, FIRST_PATIENCE_SECONDS, generateMap, GV_WIN, MAX_PLAYERS, mapFromTiles, mulberry32, nearestCamps, PLAN_SECONDS, REGION_WEAPONS,
  sameTier, spawnWalks, TICK_MS, TILE, TILE_WALL, WISH_LOCK_SECONDS, type FactionId, type GameMap, type PlanMessage,
} from "@raid/shared";
import { PLAN_CAMPS, planPick, planSpawnScore, useless } from "../src/bots/mobHunt";
import { loadConfig } from "../src/config";
import { applyDamage, markDropped, markReconnected, patienceMs } from "../src/sim/arena";
import { createGameWorld } from "../src/sim/gameplay";
import { enqueueClientMessage } from "../src/sim/inputs";
import { assignSpawns, dealSpawns, planFor } from "../src/sim/planning";
import { abandonPlayer, actionOrder, addPlayer, removePlayer, step } from "../src/sim/step";
import { createWorld, type SimConfig, type SimEvent, type World } from "../src/sim/world";

type EventOf<T extends SimEvent["type"]> = Extract<SimEvent, { type: T }>;

const BASE: SimConfig = {
  minPlayers: 2, lobbySeconds: 15, fillSeconds: 0, patienceSeconds: 60, patienceMinSeconds: 20, suddenDeathSeconds: 60,
};

function makeWorld(seed: number, cfg: Partial<SimConfig> = {}, opts: { rewardSalt?: number; random?: () => number; map?: GameMap } = {}): World {
  let uid = 0;
  return createGameWorld({
    newItemUid: () => `i${++uid}`,
    seed,
    config: { ...BASE, planSeconds: 3, ...cfg },
    random: opts.random ?? mulberry32(seed + 1),
    rewardSalt: opts.rewardSalt ?? seed * 31 + 7,
    ...(opts.map ? { map: opts.map } : {}),
  });
}

/** `n` players joined in order p0, p1, ... */
function join(world: World, n: number, from = 0): string[] {
  const ids: string[] = [];
  for (let i = from; i < from + n; i++) {
    addPlayer(world, `p${i}`, `name${i}`);
    ids.push(`p${i}`);
  }
  return ids;
}

/** Steps until `done` (at most `max` steps) and returns every event of those steps. */
function stepUntil(world: World, done: () => boolean, max = 2000): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < max && !done(); i++) out.push(...step(world, TICK_MS));
  if (!done()) throw new Error("stepUntil: never got there");
  return out;
}

const plans = (events: SimEvent[]): EventOf<"plan">[] => events.filter((e): e is EventOf<"plan"> => e.type === "plan");
const deal = (world: World, id: string) => world.planning!.deals.get(id)!;
const send = (world: World, id: string, msg: unknown): boolean => enqueueClientMessage(world.players.get(id)!.inputs, "plan", msg);
const at = (world: World, id: string) => ({ x: world.state.players.get(id)!.x, y: world.state.players.get(id)!.y });
const poolAt = (world: World, index: number) => ({ x: world.map.spawnPool[index]!.x, y: world.map.spawnPool[index]!.y });

/** Into planning: `n` players join a world whose lobby closes at once (minPlayers n, fillSeconds 0). */
function planning(seed: number, n: number, cfg: Partial<SimConfig> = {}, opts: Parameters<typeof makeWorld>[2] = {}) {
  const world = makeWorld(seed, { minPlayers: n, ...cfg }, opts);
  const ids = join(world, n);
  const events = stepUntil(world, () => world.state.phase !== "lobby");
  return { world, ids, events };
}

/** Replaces the deal of `id` (a test sets up shared options) and forgets what it was sent, so the next tick resends it. */
function handDeal(world: World, id: string, spawns: [number, number]): void {
  const d = deal(world, id);
  d.spawns = spawns;
  d.pick = -1;
  d.sent = "";
}

describe("the planning flow", () => {
  it("unset or 0, planSeconds keeps today's flow: the lobby goes straight to the run, with no deal and no plan message", () => {
    const placements: string[] = [];
    for (const cfg of [{}, { planSeconds: 0 }]) {
      const world = createGameWorld({ seed: 77, config: { ...BASE, minPlayers: 3, ...cfg }, random: mulberry32(78), rewardSalt: 5 });
      join(world, 3);
      const events = stepUntil(world, () => world.state.phase !== "lobby");
      expect(world.state.phase).toBe("active");
      expect(world.state.planEndsAt).toBe(0);
      expect(world.planning).toBeNull();
      expect(events.some((e) => e.type === "plan" || e.type === "planningStarted")).toBe(false);
      expect(events.some((e) => e.type === "raidStarted")).toBe(true);
      placements.push(JSON.stringify([...world.state.players.values()].map((p) => [p.x, p.y])));
    }
    expect(placements[1]).toBe(placements[0]);
  });

  it("a training world never plans, whatever planSeconds says", () => {
    const world = makeWorld(5, { minPlayers: 1, training: true, dummies: true, planSeconds: 12 });
    join(world, 1);
    stepUntil(world, () => world.state.phase !== "lobby");
    expect(world.state.phase).toBe("active");
  });

  it("lobby -> planning -> active at the timeout: one deal per player, mobs only once the run is on, defaults for nobody's picks", () => {
    const { world, ids, events } = planning(11, 3, { planSeconds: 2, mobs: true });
    const s = world.state;
    expect(s.phase).toBe("planning");
    expect(s.planEndsAt).toBe(s.serverTime + 2000);
    expect(events.filter((e) => e.type === "planningStarted")).toHaveLength(1);
    expect(events.some((e) => e.type === "raidStarted")).toBe(false);
    const sent = plans(events);
    expect(sent.map((e) => e.to).sort()).toEqual([...ids].sort());
    for (const e of sent) {
      expect(e.plan).toEqual({ endsAt: s.planEndsAt, spawns: deal(world, e.to).spawns, taken: [false, false], pick: -1, boons: [], boon: -1 });
    }
    expect(s.mobs.size).toBe(0);
    for (const id of ids) expect(s.players.get(id)!.status).toBe("lobby");

    const endsAt = s.planEndsAt;
    const rest = stepUntil(world, () => s.phase !== "planning");
    expect(s.phase).toBe("active");
    expect(s.serverTime).toBe(endsAt);
    expect(s.raidStartedAt).toBe(endsAt);
    expect(s.planEndsAt).toBe(0);
    expect(rest.filter((e) => e.type === "raidStarted")).toHaveLength(1);
    expect(plans(rest)).toEqual([]); // nothing changed, so nothing was resent
    expect(s.mobs.size).toBeGreaterThan(0);
    // Nobody picked: everyone starts at their first option (the deal is disjoint, so it is free).
    for (const id of ids) {
      expect(s.players.get(id)!.status).toBe("alive");
      expect(at(world, id)).toEqual(poolAt(world, deal(world, id).spawns[0]));
    }
    expect(s.patienceEndsAt).toBe(endsAt + patienceMs(world, 3));
  });

  it("nobody moves, fights or is hurt during planning, and nothing they sent then carries into the run", () => {
    const { world, ids } = planning(12, 2, { planSeconds: 1 });
    const [a, b] = ids as [string, string];
    const before = ids.map((id) => at(world, id));
    const qa = world.players.get(a)!.inputs;
    enqueueClientMessage(qa, "move", { x: 1000, y: 1000 });
    enqueueClientMessage(qa, "target", { id: b });
    enqueueClientMessage(qa, "attack", { a: 0 });
    for (let i = 0; i < 5; i++) step(world, TICK_MS);
    expect(ids.map((id) => at(world, id))).toEqual(before);
    expect(world.state.players.get(a)!.attackTarget).toBe("");
    enqueueClientMessage(qa, "move", { x: 1000, y: 1000 });
    stepUntil(world, () => world.state.phase === "active");
    expect(world.players.get(a)!.path).toEqual([]);
    const placed = at(world, a);
    step(world, TICK_MS);
    expect(at(world, a)).toEqual(placed);
  });

  it("starts as soon as every connected player is ready; a dropped one does not hold it up, an unready one does", () => {
    const { world, ids } = planning(13, 3, { planSeconds: 30 });
    const [a, b, c] = ids as [string, string, string];
    send(world, a, { ready: true });
    send(world, b, { ready: true });
    step(world, TICK_MS);
    expect(world.state.phase).toBe("planning");
    expect(world.state.players.get(a)!.planReady).toBe(true);
    expect(world.state.players.get(c)!.planReady).toBe(false);
    markDropped(world, c);
    const events = step(world, TICK_MS);
    expect(world.state.phase).toBe("active");
    expect(events.some((e) => e.type === "raidStarted")).toBe(true);
    // The dropped player is placed like anyone else (the Room holds the seat) and is in the run.
    expect(world.state.players.get(c)!.status).toBe("alive");
    expect(world.state.startedWith).toBe(3);
  });

  it("a room of dropped clients waits for the timer rather than starting at once", () => {
    const { world, ids } = planning(14, 2, { planSeconds: 1 });
    for (const id of ids) markDropped(world, id);
    step(world, TICK_MS);
    expect(world.state.phase).toBe("planning");
    stepUntil(world, () => world.state.phase === "active");
    expect(world.state.serverTime).toBeGreaterThanOrEqual(world.state.raidStartedAt);
  });

  it("the last player in (MAX_PLAYERS) starts planning on the next tick, and every player gets a deal", () => {
    // minPlayers out of reach, so only the full room can close the lobby.
    const world = makeWorld(15, { minPlayers: MAX_PLAYERS + 1, lobbySeconds: 60 });
    const ids = join(world, MAX_PLAYERS - 1);
    step(world, TICK_MS);
    expect(world.state.phase).toBe("lobby");
    ids.push(...join(world, 1, MAX_PLAYERS - 1));
    const events = step(world, TICK_MS);
    expect(world.state.phase).toBe("planning");
    expect(plans(events).map((e) => e.to).sort()).toEqual([...ids].sort());
    // Eight players, a pool of fifteen: every spawn dealt, exactly one of them twice (the extra player's spare).
    const dealt = ids.flatMap((id) => deal(world, id).spawns);
    expect(new Set(dealt).size).toBe(world.map.spawnPool.length);
    expect(dealt.length - new Set(dealt).size).toBe(1);
    expect(world.planning!.report.shared).toBe(1);
  });
});

describe("plan inputs", () => {
  it("a pick puts the player at that option when the run starts", () => {
    const { world, ids } = planning(21, 2, { planSeconds: 1 });
    const [a, b] = ids as [string, string];
    send(world, a, { spawn: 1 });
    const events = step(world, TICK_MS);
    expect(deal(world, a).pick).toBe(1);
    expect(plans(events).map((e) => [e.to, e.plan.pick])).toEqual([[a, 1]]); // b's message did not change (disjoint deals)
    stepUntil(world, () => world.state.phase === "active");
    expect(at(world, a)).toEqual(poolAt(world, deal(world, a).spawns[1]));
    expect(at(world, b)).toEqual(poolAt(world, deal(world, b).spawns[0]));
  });

  it("ready latches: later picks are ignored and ready:false does not take it back", () => {
    const { world, ids } = planning(22, 3, { planSeconds: 1 });
    const [a] = ids as [string];
    send(world, a, { spawn: 0, ready: true }); // the pick in the same message still counts: it comes first
    step(world, TICK_MS);
    expect(deal(world, a).pick).toBe(0);
    expect(world.state.players.get(a)!.planReady).toBe(true);
    send(world, a, { spawn: 1 });
    send(world, a, { ready: false });
    const events = step(world, TICK_MS);
    expect(deal(world, a).pick).toBe(0);
    expect(world.state.players.get(a)!.planReady).toBe(true);
    expect(plans(events)).toEqual([]);
  });

  it("only the two dealt options exist: a bad index never reaches the sim, and the boon has nothing to pick before R7", () => {
    const { world, ids } = planning(23, 2);
    const [a] = ids as [string];
    for (const bad of [{ spawn: 2 }, { spawn: -1 }, { spawn: 7 }, { spawn: "0" }, {}, { ready: 1 }]) expect(send(world, a, bad)).toBe(false);
    expect(send(world, a, { boon: 1 })).toBe(true);
    step(world, TICK_MS);
    expect(deal(world, a)).toMatchObject({ pick: -1, boon: -1, boons: [] });
  });

  it("plan inputs outside planning are dropped: in the lobby, and in the run", () => {
    const world = makeWorld(24, { minPlayers: 3 });
    const ids = join(world, 2);
    send(world, ids[0]!, { spawn: 1, ready: true });
    step(world, TICK_MS); // still a lobby: 2 of 3
    join(world, 1, 2);
    stepUntil(world, () => world.state.phase === "planning");
    expect(deal(world, ids[0]!).pick).toBe(-1);
    expect(world.state.players.get(ids[0]!)!.planReady).toBe(false);
    for (const id of world.state.players.keys()) send(world, id, { ready: true });
    stepUntil(world, () => world.state.phase === "active");
    const before = JSON.stringify(world.planning!.deals.get(ids[1]!));
    send(world, ids[1]!, { spawn: 1 });
    const events = step(world, TICK_MS);
    expect(plans(events)).toEqual([]);
    expect(JSON.stringify(world.planning!.deals.get(ids[1]!))).toBe(before);
    expect(planFor(world, ids[1]!)).toBeNull();
  });
});

describe("the spawn deal", () => {
  it("on wedge maps: two zones per pair always, one tier per pair, disjoint while the pool holds two per player", () => {
    for (let seed = 1; seed <= 25; seed++) {
      for (let n = 2; n <= 7; n++) {
        const world = makeWorld(seed, {}, { rewardSalt: seed * 1000 + n });
        const { pairs, report } = dealSpawns(world, n);
        const pool = world.map.spawnPool;
        const walks = spawnWalks(world.map);
        expect(pairs).toHaveLength(n);
        for (const [a, b] of pairs) {
          expect(pool[a]!.zone, `seed ${seed} n ${n}`).not.toBe(pool[b]!.zone);
          if (report.rule !== "fallback") expect(sameTier(walks[a]!, walks[b]!), `seed ${seed} n ${n}: ${walks[a]} / ${walks[b]}`).toBe(true);
        }
        expect(new Set(pairs.flat()).size, `seed ${seed} n ${n}`).toBe(2 * n);
        expect(report.shared).toBe(0);
        expect(report.tierPairs).toBe(pairs.filter(([a, b]) => sameTier(walks[a]!, walks[b]!)).length);
        // Measured over 200 seeds: up to six players every pair is a tier pair (the fallback is a seven- or eight-player thing).
        if (n <= 6) expect(report.rule, `seed ${seed} n ${n}`).not.toBe("fallback");
        if (report.rule === "global") {
          const all = pairs.flat().map((k) => walks[k]!);
          expect(sameTier(Math.min(...all), Math.max(...all))).toBe(true);
        }
      }
    }
  });

  it("is drawn from the reward stream alone: the same salt deals the same, world.random is never drawn, and the salt (not the seed) decides", () => {
    let calls = 0;
    const counted = (seed: number) => { const r = mulberry32(seed); return () => { calls++; return r(); }; };
    const a = makeWorld(31, {}, { rewardSalt: 99, random: counted(1) });
    const callsBefore = calls;
    const dealtA = dealSpawns(a, 5).pairs;
    expect(calls).toBe(callsBefore);
    const b = makeWorld(31, {}, { rewardSalt: 99, random: mulberry32(12345) });
    expect(dealSpawns(b, 5).pairs).toEqual(dealtA);
    const others = [100, 101, 102, 103, 104].map((salt) => JSON.stringify(dealSpawns(makeWorld(31, {}, { rewardSalt: salt }), 5).pairs));
    expect(new Set([JSON.stringify(dealtA), ...others]).size).toBeGreaterThan(1);
  });

  it("is never in the synced state: two worlds dealt differently have identical state, and it names no deal", () => {
    const one = planning(41, 3, {}, { rewardSalt: 1 });
    const two = planning(41, 3, {}, { rewardSalt: 2 });
    const deals = (w: World) => JSON.stringify([...w.planning!.deals.values()].map((d) => d.spawns));
    expect(deals(one.world)).not.toBe(deals(two.world));
    for (const w of [one.world, two.world]) {
      for (const id of w.state.players.keys()) send(w, id, { spawn: 1 });
      step(w, TICK_MS);
    }
    // Camp rosters are rolled from the same private stream on purpose and published (D16): they are not the deal.
    const synced = (w: World) => JSON.stringify({ ...w.state.toJSON(), camps: undefined });
    expect(synced(one.world)).toBe(synced(two.world));
    // As keys: the reward containers' own `takenBy` and `pickers` fields (R5) are no deal.
    expect(synced(one.world)).not.toMatch(/"(spawns|taken|pick|boons?)"/);
    expect(one.world.state.toJSON()).toMatchObject({ phase: "planning", planEndsAt: one.world.state.planEndsAt });
  });

  it("the fallback, with no tier pair on the map: the closest walks in different zones, reported; a same-zone pair only as a last resort", () => {
    // An open room with the coliseum's centre in the middle and four spawns due east at 100, 150, 300 and 600 u: every
    // walk is at least 1.5 times the next (no tier pair: the tier allows 1.17).
    const map = openMap([[100, "fire"], [150, "frost"], [300, "fire"], [600, "holy"]]);
    expect(spawnWalks(map).map(Math.round)).toEqual([100, 150, 300, 600]);
    const one = dealSpawns(makeWorld(1, {}, { map }), 1);
    expect(one.report).toMatchObject({ rule: "fallback", tierPairs: 0, pairs: 1, sameZonePairs: 0 });
    expect([...one.pairs[0]!].sort()).toEqual([0, 1]); // 150 / 100, the closest walks in two zones
    const two = dealSpawns(makeWorld(1, {}, { map }), 2);
    expect(two.pairs.map((p) => [...p].sort()).sort()).toEqual([[0, 1], [2, 3]]);
    expect(two.report).toMatchObject({ rule: "fallback", tierPairs: 0, shared: 0 });
    // Two spawns of one zone: still dealt, and said so.
    const lone = dealSpawns(makeWorld(1, {}, { map: openMap([[100, "fire"], [110, "fire"]]) }), 1);
    expect(lone.report).toMatchObject({ rule: "fallback", sameZonePairs: 1, tierPairs: 0 });
    expect([...lone.pairs[0]!].sort()).toEqual([0, 1]);
  });

  it("a map with no pool deals nothing, and the run falls back to today's spawns", () => {
    const tiles = new Uint8Array(20 * 20);
    const map = mapFromTiles(20, 20, tiles);
    const { world, ids } = planning(51, 2, { planSeconds: 1 }, { map });
    expect(deal(world, ids[0]!).spawns).toEqual([-1, -1]);
    expect(world.planning!.report.rule).toBe("none");
    stepUntil(world, () => world.state.phase === "active");
    expect(assignSpawns(world, ids).size).toBe(0);
  });
});

describe("taken", () => {
  it("the first pick holds the spawn; everyone else dealt it is told at once, cannot take it, and is told again when it is let go", () => {
    const { world, ids } = planning(61, 2, { planSeconds: 2 });
    const [a, b] = ids as [string, string];
    handDeal(world, a, [5, 6]);
    handDeal(world, b, [7, 5]);
    step(world, TICK_MS);
    send(world, a, { spawn: 0 });
    let events = step(world, TICK_MS);
    expect(plans(events).map((e) => [e.to, e.plan.pick, e.plan.taken])).toEqual([[a, 0, [false, false]], [b, -1, [false, true]]]);
    send(world, b, { spawn: 1 });
    events = step(world, TICK_MS);
    expect(deal(world, b).pick).toBe(-1);
    expect(plans(events)).toEqual([]);
    // a changes its mind: spawn 5 is free again, and b hears it.
    send(world, a, { spawn: 1 });
    events = step(world, TICK_MS);
    expect(plans(events).map((e) => [e.to, e.plan.pick, e.plan.taken])).toEqual([[a, 1, [false, false]], [b, -1, [false, false]]]);
    send(world, b, { spawn: 1 });
    step(world, TICK_MS);
    expect(deal(world, b).pick).toBe(1);
    expect(planFor(world, a)).toMatchObject({ pick: 1, taken: [true, false] }); // b holds a's first option now
    stepUntil(world, () => world.state.phase === "active");
    expect(at(world, a)).toEqual(poolAt(world, 6));
    expect(at(world, b)).toEqual(poolAt(world, 5));
  });

  it("within one tick the secret actionOrder decides, so the same world always gives the same winner and join order wins only by chance", () => {
    const race = (seed: number): { winner: string; first: string } => {
      const { world, ids } = planning(62, 2, { planSeconds: 2 }, { random: mulberry32(seed) });
      const [a, b] = ids as [string, string];
      handDeal(world, a, [3, 4]);
      handDeal(world, b, [3, 8]);
      send(world, a, { spawn: 0 });
      send(world, b, { spawn: 0 });
      const first = actionOrder(world, world.state.tick + 1)[0]!;
      step(world, TICK_MS);
      const winner = world.planning!.holders.get(3)!;
      return { winner, first };
    };
    let joinerWins = 0;
    const trials = 200;
    for (let seed = 1; seed <= trials; seed++) {
      const r = race(seed);
      expect(r.winner).toBe(r.first);
      expect(race(seed).winner).toBe(r.winner);
      if (r.winner === "p0") joinerWins++;
    }
    expect(joinerWins).toBeGreaterThan(trials * 0.3);
    expect(joinerWins).toBeLessThan(trials * 0.7);
  });

  it("at the end: picks stand, the rest take their first free option, then the other, then the free spawn whose walk is nearest", () => {
    const { world, ids } = planning(63, 3, { planSeconds: 1 });
    const [a, b, c] = ids as [string, string, string];
    handDeal(world, a, [1, 2]);
    handDeal(world, b, [3, 1]);
    handDeal(world, c, [1, 3]);
    send(world, a, { spawn: 0 }); // holds 1
    send(world, b, { spawn: 0 }); // holds 3
    step(world, TICK_MS);
    expect(planFor(world, c)).toMatchObject({ taken: [true, true], pick: -1 });
    stepUntil(world, () => world.state.phase === "active");
    expect(at(world, a)).toEqual(poolAt(world, 1));
    expect(at(world, b)).toEqual(poolAt(world, 3));
    const walks = spawnWalks(world.map);
    const want = (walks[1]! + walks[3]!) / 2;
    const free = world.map.spawnPool.map((_, k) => k).filter((k) => k !== 1 && k !== 3);
    const nearest = free.reduce((x, y) => (Math.abs(walks[y]! - want) < Math.abs(walks[x]! - want) ? y : x));
    expect(at(world, c)).toEqual(poolAt(world, nearest));
  });

  it("two players who picked nothing and share a dealt option: the secret order at the final tick decides who gets it, never the join order", () => {
    const { world, ids } = planning(66, 2, { planSeconds: 2 });
    const [a, b] = ids as [string, string];
    handDeal(world, a, [3, 4]);
    handDeal(world, b, [3, 4]);
    // The function itself: whoever is first in the order it is handed takes the shared option, whichever joined first.
    expect(assignSpawns(world, [a, b]).get(a)).toEqual(poolAt(world, 3));
    expect(assignSpawns(world, [a, b]).get(b)).toEqual(poolAt(world, 4));
    expect(assignSpawns(world, [b, a]).get(b)).toEqual(poolAt(world, 3));
    expect(assignSpawns(world, [b, a]).get(a)).toEqual(poolAt(world, 4));
    // And the planning tick hands it the tick's own actionOrder: over many salts the join-order player wins about half.
    let joinerFirst = 0;
    const trials = 120;
    for (let seed = 1; seed <= trials; seed++) {
      const t = planning(67, 2, { planSeconds: 1 }, { random: mulberry32(seed) });
      const [x, y] = t.ids as [string, string];
      handDeal(t.world, x, [3, 4]);
      handDeal(t.world, y, [3, 4]);
      stepUntil(t.world, () => t.world.state.serverTime + TICK_MS >= t.world.state.planEndsAt);
      const order = actionOrder(t.world, t.world.state.tick + 1);
      step(t.world, TICK_MS);
      expect(t.world.state.phase).toBe("active");
      expect(at(t.world, order[0]!), `seed ${seed}`).toEqual(poolAt(t.world, 3));
      expect(at(t.world, order[1]!), `seed ${seed}`).toEqual(poolAt(t.world, 4));
      if (order[0] === x) joinerFirst++;
    }
    expect(joinerFirst).toBeGreaterThan(trials * 0.3);
    expect(joinerFirst).toBeLessThan(trials * 0.7);
  });

  it("leaving during planning frees what the leaver held and tells whoever was dealt it (and goes MIA: see the next block)", () => {
    const { world, ids } = planning(64, 3, { planSeconds: 2 });
    const [a, b] = ids as [string, string];
    const c = ids[2]!;
    handDeal(world, a, [9, 10]);
    handDeal(world, b, [11, 9]);
    handDeal(world, c, [12, 13]);
    send(world, a, { spawn: 0 });
    step(world, TICK_MS);
    expect(planFor(world, b)!.taken).toEqual([false, true]);
    removePlayer(world, a);
    const events = world.events.splice(0);
    expect(plans(events).map((e) => [e.to, e.plan.taken])).toEqual([[b, [false, false]]]);
    expect(world.planning!.holders.size).toBe(0);
    stepUntil(world, () => world.state.phase === "active");
    expect(world.state.startedWith).toBe(3); // the leaver still started: they went MIA
  });
});

const resolved = (events: SimEvent[]): EventOf<"resolved">[] => events.filter((e): e is EventOf<"resolved"> => e.type === "resolved");

describe("leaving during planning (owner ruling: a loss)", () => {
  it("is MIA: one result (a run lost, no GV, no kills), the starters counted, and the others told what was freed", () => {
    const { world, ids } = planning(101, 3, { planSeconds: 5 });
    const [a, b, c] = ids as [string, string, string];
    handDeal(world, a, [9, 10]);
    handDeal(world, b, [11, 9]);
    handDeal(world, c, [12, 13]);
    send(world, a, { spawn: 0 });
    step(world, TICK_MS);
    expect(planFor(world, b)!.taken).toEqual([false, true]);
    const rt = world.players.get(a)!;
    const containers = world.state.containers.size;
    world.events.splice(0);

    removePlayer(world, a);
    const events = world.events.splice(0);
    expect(resolved(events)).toEqual([{
      type: "resolved", id: a,
      result: {
        outcome: "mia", profile: "name0", durationSec: 0, kills: 0, killedBy: null, place: 3, players: 3,
        gv: { kills: 0, mobs: 0, bounty: 0, win: 0, total: 0 }, winBonusWithheld: false,
      },
    }]);
    expect(rt.resolved).toBe(true);
    expect(plans(events).map((e) => [e.to, e.plan.taken])).toEqual([[b, [false, false]]]);
    expect(world.planning!.holders.size).toBe(0);
    expect(world.state.players.has(a)).toBe(false);
    expect(world.players.has(a)).toBe(false);
    // The room's own onLeave comes after: nothing is produced a second time.
    removePlayer(world, a);
    expect(world.events.splice(0)).toEqual([]);
    // Nothing else came of it: no body, no chest, nothing of the run (it has not started).
    expect(world.state.containers.size).toBe(containers);
    expect(world.state.phase).toBe("planning");
  });

  it("counts the leaver among the starters: the run goes on with the rest, startedWith unchanged", () => {
    const { world, ids } = planning(102, 4, { planSeconds: 1 });
    removePlayer(world, ids[3]!);
    const events = stepUntil(world, () => world.state.phase === "active");
    expect(world.state.startedWith).toBe(4);
    expect(world.arena.startedWith).toBe(4);
    expect(world.planning!.starters).toBe(4);
    expect(events.filter((e) => e.type === "raidStarted")).toHaveLength(1);
    step(world, TICK_MS);
    expect(world.state.phase).toBe("active"); // three standing: a contested run goes on
    expect([...world.state.players.values()].map((p) => p.status)).toEqual(["alive", "alive", "alive"]);
  });

  it("places the leavers as it does in the run: with the players still in the room, the first of three to go is third", () => {
    const { world, ids } = planning(103, 3, { planSeconds: 30 });
    const [a, b, c] = ids as [string, string, string];
    removePlayer(world, b);
    removePlayer(world, a);
    const results = resolved(world.events.splice(0));
    expect(results.map((e) => [e.id, e.result.outcome, e.result.place, e.result.players])).toEqual([[b, "mia", 3, 3], [a, "mia", 2, 3]]);
    expect(world.state.players.has(c)).toBe(true);
  });

  it("the last one left in a room of two or more starts the run at once, and wins it on the next tick with no win bonus", () => {
    const { world, ids } = planning(104, 3, { planSeconds: 30 });
    const [a, b, c] = ids as [string, string, string];
    removePlayer(world, a);
    removePlayer(world, b);
    world.events.splice(0);
    let events = step(world, TICK_MS);
    expect(world.state.phase).toBe("active"); // not at the timer, and c never pressed ready
    expect(events.some((e) => e.type === "raidStarted")).toBe(true);
    expect(world.state.players.get(c)!.status).toBe("alive");
    events = step(world, TICK_MS);
    expect(world.state.phase).toBe("ended");
    expect(world.state.winner).toBe("name2");
    expect(resolved(events)).toEqual([{
      type: "resolved", id: c,
      result: {
        outcome: "won", profile: "name2", durationSec: 0, kills: 0, killedBy: null, place: 1, players: 3,
        gv: { kills: 0, mobs: 0, bounty: 0, win: 0, total: 0 }, winBonusWithheld: true,
      },
    }]);
  });

  it("7 of 8 leave: each of the seven has a result, the last wins with nothing paid, and nobody got a solo run", () => {
    const { world, ids } = planning(105, MAX_PLAYERS, { planSeconds: 30 });
    const leavers = ids.slice(0, -1);
    const last = ids.at(-1)!;
    for (const id of leavers) removePlayer(world, id);
    const out = resolved(world.events.splice(0));
    expect(out.map((e) => e.id)).toEqual(leavers);
    expect(out.every((e) => e.result.outcome === "mia" && e.result.players === 8 && e.result.gv.total === 0)).toBe(true);
    expect(out.map((e) => e.result.place)).toEqual([8, 7, 6, 5, 4, 3, 2]);
    const events = stepUntil(world, () => world.state.phase === "ended");
    expect(world.state.startedWith).toBe(8);
    const won = resolved(events);
    expect(won).toHaveLength(1);
    expect(won[0]!.id).toBe(last);
    expect(won[0]!.result).toMatchObject({ outcome: "won", players: 8, gv: { win: 0, total: 0 }, winBonusWithheld: true });
  });

  it("a room that started with one stays a solo run: no early start for the lone player, and leaving is MIA", () => {
    const { world, ids } = planning(106, 1, { planSeconds: 30, minPlayers: 1 });
    const a = ids[0]!;
    for (let i = 0; i < 5; i++) step(world, TICK_MS);
    expect(world.state.phase).toBe("planning");
    removePlayer(world, a);
    const out = resolved(world.events.splice(0));
    expect(out).toHaveLength(1);
    expect(out[0]!.result).toMatchObject({ outcome: "mia", players: 1, place: 1, winBonusWithheld: false });
  });

  it("a leaver no longer holds up the early start: the rest being ready is enough, and an unready one still holds it", () => {
    const { world, ids } = planning(107, 4, { planSeconds: 30 });
    const [a, b, c, d] = ids as [string, string, string, string];
    send(world, a, { ready: true });
    send(world, b, { ready: true });
    send(world, c, { ready: true });
    step(world, TICK_MS);
    expect(world.state.phase).toBe("planning"); // d is not ready
    removePlayer(world, d);
    expect(world.state.phase).toBe("planning");
    const events = step(world, TICK_MS);
    expect(world.state.phase).toBe("active");
    expect(events.some((e) => e.type === "raidStarted")).toBe(true);
    expect(world.state.startedWith).toBe(4);
    expect(world.state.players.size).toBe(3);
  });

  it("a ready player who leaves takes their ready with them: the others are still waited for", () => {
    const { world, ids } = planning(108, 3, { planSeconds: 30 });
    const [a, b, c] = ids as [string, string, string];
    send(world, a, { ready: true });
    send(world, b, { ready: true });
    step(world, TICK_MS);
    removePlayer(world, a);
    step(world, TICK_MS);
    expect(world.state.phase).toBe("planning"); // c is not ready
    send(world, c, { ready: true });
    step(world, TICK_MS);
    expect(world.state.phase).toBe("active");
  });

  it("a dropped client whose grace runs out in planning is MIA; one that came back in time is still in and in the run", () => {
    const { world, ids } = planning(109, 3, { planSeconds: 2 });
    const [a, b, c] = ids as [string, string, string];
    markDropped(world, a);
    markDropped(world, b);
    step(world, TICK_MS);
    expect(resolved(world.events.splice(0))).toEqual([]); // held: nothing is recorded for a blip
    markReconnected(world, b);
    removePlayer(world, a); // the grace ran out
    const out = resolved(world.events.splice(0));
    expect(out.map((e) => [e.id, e.result.outcome, e.result.players])).toEqual([[a, "mia", 3]]);
    stepUntil(world, () => world.state.phase === "active");
    expect(world.state.players.get(b)!.status).toBe("alive");
    expect(world.state.players.get(c)!.status).toBe("alive");
    expect(world.state.startedWith).toBe(3);
  });

  it("the lobby stays free: a leave before planning has no result and the run starts with the players who are left", () => {
    const lobby = makeWorld(111, { minPlayers: 3, lobbySeconds: 60, planSeconds: 1 });
    join(lobby, 2);
    step(lobby, TICK_MS);
    expect(lobby.state.phase).toBe("lobby");
    removePlayer(lobby, "p1");
    expect(lobby.events.splice(0)).toEqual([]);
    join(lobby, 2, 2);
    stepUntil(lobby, () => lobby.state.phase === "planning");
    expect(lobby.planning!.starters).toBe(3);
    stepUntil(lobby, () => lobby.state.phase === "active");
    expect(lobby.state.startedWith).toBe(3);
  });

  it("a void run (abandonPlayer, the server's shutdown) in planning leaves no result, and frees what the player held", () => {
    const { world, ids } = planning(112, 3, { planSeconds: 5 });
    const [a, b] = ids as [string, string];
    handDeal(world, a, [9, 10]);
    handDeal(world, b, [11, 9]);
    send(world, a, { spawn: 0 });
    step(world, TICK_MS);
    world.events.splice(0);
    expect(abandonPlayer(world, a)).toBe(0);
    const events = world.events.splice(0);
    expect(resolved(events)).toEqual([]);
    expect(plans(events).map((e) => [e.to, e.plan.taken])).toEqual([[b, [false, false]]]);
  });

  it("a void in planning is sticky: abandoning all but one with a tick between never starts the run or wins it for the last player", () => {
    for (const n of [2, 3, MAX_PLAYERS]) {
      const { world, ids } = planning(130 + n, n, { planSeconds: 5 });
      world.events.splice(0);
      const events: SimEvent[] = [];
      for (const id of ids.slice(0, -1)) {
        expect(abandonPlayer(world, id)).toBe(0);
        events.push(...world.events.splice(0), ...step(world, TICK_MS));
      }
      // The last player is alone in a room that started with two or more: lastOneStanding would start the run now.
      for (let i = 0; i < 4; i++) events.push(...step(world, TICK_MS));
      expect(world.arena.voided, `${n} players`).toBe(true);
      expect(world.state.phase, `${n} players`).toBe("planning");
      expect(world.state.players.size).toBe(1);
      expect(events.some((e) => e.type === "raidStarted" || e.type === "resolved")).toBe(false);
      // Not even at the timer.
      stepUntil(world, () => world.state.serverTime >= world.state.planEndsAt + TICK_MS);
      expect(world.state.phase).toBe("planning");
      expect(world.state.players.get(ids.at(-1)!)!.status).toBe("lobby");
    }
  });

  it("without the void the same leaves do start the run at once (what the sticky void guards against)", () => {
    const { world, ids } = planning(140, 3, { planSeconds: 5 });
    removePlayer(world, ids[0]!);
    removePlayer(world, ids[1]!);
    world.events.splice(0);
    const events = step(world, TICK_MS);
    expect(world.arena.voided).toBe(false);
    expect(events.some((e) => e.type === "raidStarted")).toBe(true);
  });

  it("keeps the win bonus gate as it was: 3+ starters and damage on 2+ opponents, whoever left in planning", () => {
    const fight = (starters: number, leavers: number, victims: number) => {
      const { world, ids } = planning(120 + starters * 10 + leavers, starters, { planSeconds: 1 });
      for (const id of ids.slice(starters - leavers)) removePlayer(world, id);
      world.events.splice(0);
      stepUntil(world, () => world.state.phase === "active");
      const [a, ...rest] = ids.slice(0, starters - leavers);
      const alice = { id: a!, p: world.state.players.get(a!)!, rt: world.players.get(a!)! };
      for (const v of rest.slice(0, victims)) applyDamage(world, world.state.players.get(v)!, world.players.get(v)!, 1e9, alice);
      const events = step(world, TICK_MS);
      expect(world.state.phase).toBe("ended");
      return resolved(events).find((e) => e.id === a)!.result;
    };
    // Four started, one left: three fight, the winner downs two of them: paid.
    expect(fight(4, 1, 2)).toMatchObject({ outcome: "won", players: 4, gv: { win: GV_WIN }, winBonusWithheld: false });
    // Three started, one left: a duel, the winner damaged one opponent: not paid.
    expect(fight(3, 1, 1)).toMatchObject({ outcome: "won", players: 3, gv: { win: 0 }, winBonusWithheld: true });
    // Two started, one left: the other wins the run at once: not paid.
    expect(fight(2, 1, 0)).toMatchObject({ outcome: "won", players: 2, gv: { win: 0 }, winBonusWithheld: true });
  });
});

describe("Wishes and planning", () => {
  it("a cast sent during planning is dropped (free: no cast, no cooldown, no fx), and the 45 s lock starts when the run does", () => {
    const { world, ids } = planning(31, 3, { planSeconds: 3 });
    const s = world.state;
    const closedAt = s.serverTime;
    for (const id of ids) expect(s.players.get(id)!.wishReadyAt).toBe(0);
    const casts: SimEvent[] = [];
    for (let i = 0; i < 20 && s.phase === "planning"; i++) {
      for (const id of ids) enqueueClientMessage(world.players.get(id)!.inputs, "cast", { slot: "wish", x: 500, y: 500, seq: 3 });
      casts.push(...step(world, TICK_MS));
    }
    expect(s.phase).toBe("planning");
    expect(casts.some((e) => e.type === "fx" && (e.fx.kind === "cast" || e.fx.kind === "castLand" || e.fx.kind === "castEnd"))).toBe(false);
    for (const id of ids) {
      expect(world.players.get(id)!.cast ?? null).toBeNull();
      expect(s.players.get(id)!.wishReadyAt).toBe(0);
      expect(s.players.get(id)!.moveSeq).toBe(0); // dropped before handleCast: not even its seq is echoed
    }
    stepUntil(world, () => s.phase === "active");
    expect(s.raidStartedAt).toBeGreaterThan(closedAt);
    for (const id of ids) expect(s.players.get(id)!.wishReadyAt).toBe(s.raidStartedAt + WISH_LOCK_SECONDS * 1000);
  });

  it("a planning leave fires fighterOut on a fighter with no statuses, no cast and no world.abilities, and nothing throws", () => {
    const { world, ids } = planning(32, 3, { planSeconds: 3 });
    expect(world.abilities).toBeNull();
    const out: string[] = [];
    const prev = world.hooks.fighterOut;
    world.hooks.fighterOut = (w, id, cause) => { out.push(`${id}:${cause}`); prev?.(w, id, cause); };
    removePlayer(world, ids[0]!);
    expect(abandonPlayer(world, ids[1]!)).toBe(0);
    expect(out).toEqual([`${ids[0]}:removed`, `${ids[1]}:removed`]);
    // The abandon voided the room: it stays in planning (see "a void in planning is sticky"), and nothing throws ticking on.
    for (let i = 0; i < 10; i++) step(world, TICK_MS);
    expect(world.state.phase).toBe("planning");
    // A plain leave lets the run start with the player who is left.
    const other = planning(33, 3, { planSeconds: 3 });
    removePlayer(other.world, other.ids[0]!);
    stepUntil(other.world, () => other.world.state.phase !== "planning");
    expect(other.world.state.phase).not.toBe("planning");
  });
});

describe("the first patience timer (decision 10)", () => {
  it("firstPatienceSeconds is armed flat when planning ends; a timer after a death scales as before", () => {
    const { world, ids } = planning(71, 3, { planSeconds: 1, firstPatienceSeconds: 300, patienceSeconds: 60, patienceMinSeconds: 20 });
    stepUntil(world, () => world.state.phase === "active");
    const s = world.state;
    expect(s.patienceEndsAt).toBe(s.raidStartedAt + 300_000);
    const victim = ids[0]!;
    applyDamage(world, s.players.get(victim)!, world.players.get(victim)!, 1e9, "a test");
    step(world, TICK_MS);
    expect(s.patienceEndsAt).toBe(s.serverTime + patienceMs(world, 2));
    expect(patienceMs(world, 2)).toBe(20_000);
  });

  it("unset, the first timer scales with the players as it always did, planning or not", () => {
    for (const planSeconds of [0, 1]) {
      const world = makeWorld(72, { minPlayers: 3, planSeconds, patienceSeconds: 60, patienceMinSeconds: 20 });
      join(world, 3);
      stepUntil(world, () => world.state.phase === "active");
      expect(world.state.patienceEndsAt).toBe(world.state.raidStartedAt + patienceMs(world, 3));
    }
  });
});

describe("planFor (what a reconnecting client is sent)", () => {
  it("is the player's current message during planning, and null for anyone else or at any other time", () => {
    const { world, ids } = planning(81, 2, { planSeconds: 1 });
    const [a] = ids as [string];
    send(world, a, { spawn: 1 });
    step(world, TICK_MS);
    const msg = planFor(world, a) as PlanMessage;
    expect(msg).toEqual({ endsAt: world.state.planEndsAt, spawns: deal(world, a).spawns, taken: [false, false], pick: 1, boons: [], boon: -1 });
    expect(planFor(world, "nobody")).toBeNull();
    stepUntil(world, () => world.state.phase === "active");
    expect(planFor(world, a)).toBeNull();
    expect(createWorld({ seed: 1, config: BASE, random: mulberry32(1) }).planning).toBeNull();
  });
});

describe("the bots' planning", () => {
  it("planPick takes the untaken option whose nearest camps the bot's faction and weapon fare better against", () => {
    const map = generateMap(91);
    const scores = map.spawnPool.map((_, k) => planSpawnScore(map, k, "holy", "sword"));
    const lo = scores.indexOf(Math.min(...scores));
    const hi = scores.indexOf(Math.max(...scores));
    expect(scores[hi]!).toBeGreaterThan(scores[lo]!);
    expect(planPick(map, { spawns: [lo, hi], taken: [false, false] }, "holy", "sword")).toBe(1);
    expect(planPick(map, { spawns: [hi, lo], taken: [false, false] }, "holy", "sword")).toBe(0);
    expect(planPick(map, { spawns: [lo, hi], taken: [false, true] }, "holy", "sword")).toBe(0);
    expect(planPick(map, { spawns: [lo, hi], taken: [true, true] }, "holy", "sword")).toBe(-1);
    expect(planPick(map, { spawns: [-1, -1], taken: [false, false] }, "holy", "sword")).toBe(-1);
    // The score is the matchup of the PLAN_CAMPS nearest camps (a weapon useless against a camp's counts a quarter).
    const camps = nearestCamps(map, map.spawnPool[hi]!, PLAN_CAMPS);
    expect(scores[hi]).toBeCloseTo(camps.reduce((s, c) => s + campMatchup("holy", c) * (useless("sword", REGION_WEAPONS[c.zone]) ? 0.25 : 1), 0), 12);
  });
});

describe("loadConfig planning settings", () => {
  it("defaults to the live design: PLAN_SECONDS of planning and a flat FIRST_PATIENCE_SECONDS first timer", () => {
    expect(loadConfig({})).toMatchObject({ planSeconds: PLAN_SECONDS, firstPatienceSeconds: FIRST_PATIENCE_SECONDS });
    expect([PLAN_SECONDS, FIRST_PATIENCE_SECONDS]).toEqual([12, 300]);
  });

  it("PATIENCE_SECONDS alone also sets the flat first timer (a dev shortening a run); FIRST_PATIENCE_SECONDS wins when both are set", () => {
    expect(loadConfig({ PATIENCE_SECONDS: "20" })).toMatchObject({ patienceSeconds: 20, firstPatienceSeconds: 20 });
    expect(loadConfig({ PATIENCE_SECONDS: "20", FIRST_PATIENCE_SECONDS: "45" })).toMatchObject({ patienceSeconds: 20, firstPatienceSeconds: 45 });
    expect(loadConfig({ PATIENCE_SECONDS: "20", FIRST_PATIENCE_SECONDS: "0" })).toMatchObject({ firstPatienceSeconds: 0 });
  });

  it("honours PLAN_SECONDS and FIRST_PATIENCE_SECONDS; 0 turns either off, and nonsense falls back or clamps", () => {
    expect(loadConfig({ PLAN_SECONDS: "5", FIRST_PATIENCE_SECONDS: "90" })).toMatchObject({ planSeconds: 5, firstPatienceSeconds: 90 });
    expect(loadConfig({ PLAN_SECONDS: "0", FIRST_PATIENCE_SECONDS: "0" })).toMatchObject({ planSeconds: 0, firstPatienceSeconds: 0 });
    expect(loadConfig({ PLAN_SECONDS: "-3", FIRST_PATIENCE_SECONDS: "soon" })).toMatchObject({ planSeconds: 0, firstPatienceSeconds: 300 });
  });
});

/** An open square room (walls on the border) whose coliseum centre is the middle tile, with `spawns` due east of it. */
function openMap(spawns: Array<[number, FactionId]>): GameMap {
  const w = 48;
  const tiles = new Uint8Array(w * w);
  for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) if (x === 0 || y === 0 || x === w - 1 || y === w - 1) tiles[y * w + x] = TILE_WALL;
  const map = mapFromTiles(w, w, tiles);
  const c = map.coliseum.centre;
  map.spawnPool = spawns.map(([d, zone]) => ({ x: c.x + d, y: c.y, zone }));
  map.spawns = map.spawnPool.map(({ x, y }) => ({ x, y }));
  expect(c.x + Math.max(...spawns.map(([d]) => d))).toBeLessThan((w - 1) * TILE);
  return map;
}
