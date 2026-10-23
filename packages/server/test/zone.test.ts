import { describe, expect, it } from "vitest";
import {
  TILE,
  isOutside, mulberry32, TICK_MS, ZONE_DPS, ZONE_FINAL_RADIUS, ZONE_STAGES, zoneAt, zoneCircles, zoneDps,
  type FxEvent, type ItemDTO, type ZoneCircle,
} from "@raid/shared";
import type { PlayerState } from "@raid/shared/schema";
import { createGameWorld } from "../src/sim/gameplay";
import { enqueueClientMessage } from "../src/sim/inputs";
import { addPlayer, resolvePlayer, step } from "../src/sim/step";
import { createWorld, type SimConfig, type SimEvent, type World } from "../src/sim/world";
import { install, ZONE_KILLER, zonePlanOf, zoneSystem } from "../src/sim/zone";

type EventOf<T extends SimEvent["type"]> = Extract<SimEvent, { type: T }>;

const TICKS_PER_SEC = 1000 / TICK_MS;
const DT = TICK_MS / 1000;
const STAGES = ZONE_STAGES + 1;
const TOUGH_HP = 1e6;

interface Seat { id: string; name: string; items: ItemDTO[] }
const alice = (items: ItemDTO[] = []): Seat => ({ id: "a", name: "alice", items });
const bob = (items: ItemDTO[] = []): Seat => ({ id: "b", name: "bob", items });
const carol = (items: ItemDTO[] = []): Seat => ({ id: "c", name: "carol", items });
const gear = (...defs: string[]): ItemDTO[] => defs.map((def, i) => ({ uid: `${def}#${i}`, def }));

function makeConfig(seats: number, cfg: Partial<SimConfig> = {}): SimConfig {
  return { minPlayers: seats, lobbySeconds: 15, fillSeconds: 0, raidSeconds: 360, extractSeconds: 5, ...cfg };
}

function newWorld(seats: Seat[], cfg: Partial<SimConfig> = {}, seed = 1234): World {
  let n = 0;
  const world = createGameWorld({
    seed, config: makeConfig(seats.length, cfg), random: mulberry32(seed + 1), newItemUid: () => `L${++n}`,
  });
  for (const s of seats) addPlayer(world, s.id, s.name, s.items);
  return world;
}

/**
 * A started raid on the generated map. Returns the events of the start step too. Everyone is parked
 * on the final extract, which lies inside every circle of the plan, so skipping the clock forward
 * (stepAt) cannot burn anybody before a test has placed them.
 */
function raid(seats: Seat[], cfg: Partial<SimConfig> = {}, seed = 1234) {
  const world = newWorld(seats, cfg, seed);
  const startEvents = step(world, TICK_MS);
  expect(world.state.phase).toBe("active");
  park(world);
  return { world, startEvents };
}

function park(world: World): void {
  const { final } = zonePlanOf(world)!;
  for (const id of world.state.players.keys()) place(world, id, final.x, final.y);
}

const P = (world: World, id: string): PlayerState => world.state.players.get(id)!;
const RT = (world: World, id: string) => world.players.get(id)!;
const plan = (world: World) => zonePlanOf(world)!;
const elapsed = (world: World) => world.state.serverTime - world.state.raidStartedAt;

function place(world: World, id: string, x: number, y: number): void {
  const p = P(world, id);
  p.x = x;
  p.y = y;
  RT(world, id).history = [{ t: world.state.serverTime, x, y }];
}

function run(world: World, ticks: number): SimEvent[] {
  const all: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) all.push(...step(world, TICK_MS));
  return all;
}

/**
 * Skips the clock so the next step lands `elapsedMs` after raid start, then runs that step. The sim
 * only reads `serverTime`, so a jump is just a long gap between two ticks; it saves stepping minutes.
 */
function stepAt(world: World, elapsedMs: number): SimEvent[] {
  world.state.serverTime = world.state.raidStartedAt + elapsedMs - TICK_MS;
  return step(world, TICK_MS);
}

/** A time halfway through stage `stage` (1-based) hold. The circle then is the previous stage's target. */
function holdTime(world: World, stage: number): number {
  const s = plan(world).stages[stage - 1]!;
  return (s.holdStart + s.shrinkStart) / 2;
}

/** A plain copy of the synced zone: schema fields are accessors, so spreading the instance copies nothing. */
function zoneNow(world: World) {
  const z = world.state.zone;
  return { x: z.x, y: z.y, r: z.r, stage: z.stage, shrinking: z.shrinking };
}

/** A point just beyond the edge of `c`. */
const beyond = (c: ZoneCircle, by = 20) => ({ x: c.x + c.r + by, y: c.y });
const within = (c: ZoneCircle, by = 20) => ({ x: c.x + c.r - by, y: c.y });

function ofType<T extends SimEvent["type"]>(events: SimEvent[], type: T): Array<EventOf<T>> {
  return events.filter((e): e is EventOf<T> => e.type === type);
}

const fxOf = (events: SimEvent[]): FxEvent[] => ofType(events, "fx").map((e) => e.fx);
const dto = (items: Iterable<{ uid: string; def: string }>): ItemDTO[] => Array.from(items, (i) => ({ uid: i.uid, def: i.def }));

/** Effectively immortal: the zone still hurts (hp visibly drops) but never kills. */
function toughen(world: World, ...ids: string[]): void {
  for (const id of ids) { P(world, id).hp = TOUGH_HP; P(world, id).maxHp = TOUGH_HP; }
}

describe("install", () => {
  it("is part of createGameWorld", () => {
    const { world } = raid([alice()]);
    expect(world.systems.filter((s) => s === zoneSystem)).toHaveLength(1);
    expect(typeof world.hooks.raidStarted).toBe("function");
  });

  it("a bare world has no zone: it stays at stage 0 for the whole raid", () => {
    const world = createWorld({ seed: 1, config: makeConfig(1), random: mulberry32(2) });
    addPlayer(world, "a", "alice", []);
    step(world, TICK_MS);
    run(world, 10);
    expect(world.state.phase).toBe("active");
    expect(world.state.zone.stage).toBe(0);
    expect(world.state.zone.r).toBe(0);
    expect(zonePlanOf(world)).toBeUndefined();
  });

  it("keeps an earlier raidStarted hook running", () => {
    const world = createWorld({ seed: 1, config: makeConfig(1), random: mulberry32(2) });
    const calls: string[] = [];
    world.hooks.raidStarted = () => { calls.push("earlier"); };
    install(world);
    addPlayer(world, "a", "alice", []);
    step(world, TICK_MS);
    expect(calls).toEqual(["earlier"]);
    expect(world.state.zone.stage).toBe(1);
  });

  it("a map without extracts gets no zone and no damage (nothing to collapse onto)", () => {
    const world = newWorld([alice()]);
    world.map = { ...world.map, extracts: [] };
    step(world, TICK_MS);
    expect(world.state.phase).toBe("active");
    place(world, "a", -500, -500);
    run(world, 30);
    expect(world.state.zone.stage).toBe(0);
    expect(P(world, "a").hp).toBe(100);
    expect(zonePlanOf(world)).toBeUndefined();
  });
});

describe("lobby", () => {
  it("has no zone and hurts nobody, however far out a player stands", () => {
    const world = newWorld([alice(), bob()], { minPlayers: 3 }); // never reaches the minimum
    place(world, "a", -1e6, 1e6);
    P(world, "a").status = "alive";
    const events = run(world, 40);
    expect(world.state.phase).toBe("lobby");
    expect(events).toEqual([]);
    expect(world.state.zone.stage).toBe(0);
    expect(world.state.zone.r).toBe(0);
    expect(world.state.zone.shrinking).toBe(false);
    expect(P(world, "a").hp).toBe(100);
    expect(zonePlanOf(world)).toBeUndefined();
  });

  it("the system itself does nothing outside an active raid (direct call)", () => {
    const world = newWorld([alice(), bob()]);
    place(world, "a", -1e6, 1e6);
    P(world, "a").status = "alive";
    zoneSystem(world, TICK_MS);
    expect(P(world, "a").hp).toBe(100);
    expect(world.state.zone.stage).toBe(0);
    expect(world.events).toEqual([]);
  });
});

describe("the plan", () => {
  it("is made when the raid starts, from the world's random and the configured raid length", () => {
    const { world } = raid([alice()], { raidSeconds: 120 });
    const p = plan(world);
    expect(p.raidMs).toBe(120_000);
    expect(world.map.extracts.map((e) => e.id)).toContain(p.extractId);
    expect(p.final.r).toBe(ZONE_FINAL_RADIUS);
    expect(p.stages).toHaveLength(STAGES);
  });

  it("is the same for two worlds built the same way, and not shared between worlds", () => {
    const a = raid([alice()]).world;
    const b = raid([alice()]).world;
    expect(plan(a)).toEqual(plan(b));
    expect(plan(a)).not.toBe(plan(b));

    const seen = new Set<string>();
    for (let seed = 1; seed <= 12; seed++) seen.add(JSON.stringify(zoneCircles(plan(raid([alice()], {}, seed).world))));
    expect(seen.size).toBeGreaterThan(8);
  });

  it("is not redrawn after the start", () => {
    const { world } = raid([alice()]);
    const first = plan(world);
    toughen(world, "a");
    run(world, 40);
    expect(plan(world)).toBe(first);
  });
});

describe("state.zone", () => {
  it("shows the opening circle on the very tick the raid starts", () => {
    const { world, startEvents } = raid([alice()]);
    expect(ofType(startEvents, "raidStarted")).toHaveLength(1);
    const z = world.state.zone;
    const p = plan(world);
    expect(z.stage).toBe(1);
    expect(z.shrinking).toBe(false);
    expect([z.x, z.y, z.r]).toEqual([p.start.x, p.start.y, p.start.r]);
    expect([z.nextX, z.nextY, z.nextR]).toEqual([p.stages[0]!.target.x, p.stages[0]!.target.y, p.stages[0]!.target.r]);
    expect(z.changeAt).toBe(world.state.raidStartedAt + p.stages[0]!.shrinkStart);
  });

  it("is rewritten every step to match the plan at the current time, with stage >= 1 throughout", () => {
    const { world } = raid([alice()], { raidSeconds: 40 });
    toughen(world, "a");
    const p = plan(world);
    let last = world.state.zone.stage;
    while (world.state.phase === "active") {
      step(world, TICK_MS);
      if (world.state.phase !== "active") break;
      const z = world.state.zone;
      const want = zoneAt(p, elapsed(world));
      expect(z.stage).toBeGreaterThanOrEqual(1);
      expect(z.stage).toBeGreaterThanOrEqual(last);
      last = z.stage;
      expect([z.x, z.y, z.r, z.nextX, z.nextY, z.nextR, z.stage, z.shrinking]).toEqual(
        [want.x, want.y, want.r, want.nextX, want.nextY, want.nextR, want.stage, want.shrinking],
      );
      expect(z.changeAt).toBe(world.state.raidStartedAt + want.changeAtElapsed);
    }
    expect(last).toBe(STAGES);
  });

  it("holds, then shrinks, then holds the final circle on an extract until the raid ends", () => {
    const { world } = raid([alice()], { raidSeconds: 60 });
    toughen(world, "a");
    const p = plan(world);
    const radii: number[] = [];
    const flags = new Set<boolean>();
    while (world.state.phase === "active") {
      step(world, TICK_MS);
      if (world.state.phase !== "active") break;
      radii.push(world.state.zone.r);
      flags.add(world.state.zone.shrinking);
    }
    expect(flags).toEqual(new Set([true, false]));
    for (let i = 1; i < radii.length; i++) expect(radii[i]!).toBeLessThanOrEqual(radii[i - 1]! + 1e-9);

    const z = world.state.zone;
    expect(z.r).toBe(ZONE_FINAL_RADIUS);
    expect(world.map.extracts.some((e) => e.x === z.x && e.y === z.y)).toBe(true);
    expect([z.x, z.y]).toEqual([p.final.x, p.final.y]);
    expect(z.stage).toBe(STAGES);
    expect(z.shrinking).toBe(false);
    expect(z.changeAt).toBe(world.state.raidEndsAt);
  });

  it("does not change at all during a hold", () => {
    const { world } = raid([alice()]);
    toughen(world, "a");
    step(world, TICK_MS);
    const before = { ...world.state.zone.toJSON() };
    step(world, TICK_MS);
    expect(world.state.zone.toJSON()).toEqual(before);
  });
});

describe("damage", () => {
  it("nobody is outside the opening circle: it covers the whole map", () => {
    const { world } = raid([alice(), bob()]);
    for (const c of [{ x: 0, y: 0 }, { x: 2048, y: 0 }, { x: 0, y: 2048 }, { x: 2048, y: 2048 }]) {
      place(world, "a", c.x, c.y);
      const events = stepAt(world, holdTime(world, 1));
      expect(P(world, "a").hp).toBe(100);
      expect(events).toEqual([]);
    }
  });

  it("no damage inside the circle, not even a hair from its edge", () => {
    const { world } = raid([alice(), bob()]);
    stepAt(world, holdTime(world, 2));
    const circle = world.state.zone;
    const edge = within(circle, 0.01);
    place(world, "a", circle.x, circle.y);
    place(world, "b", edge.x, edge.y);
    run(world, 10);
    expect(P(world, "a").hp).toBe(100);
    expect(P(world, "b").hp).toBe(100);
  });

  it("outside the circle: hp falls by dps x dt every step, and only for those outside", () => {
    const { world } = raid([alice(), bob()]);
    stepAt(world, holdTime(world, 2));
    const circle = zoneNow(world);
    expect(circle.stage).toBe(2);
    place(world, "a", beyond(circle, 0.01).x, circle.y);
    place(world, "b", circle.x, circle.y);

    for (let i = 1; i <= 10; i++) {
      step(world, TICK_MS);
      expect(P(world, "a").hp).toBeCloseTo(100 - i * zoneDps(2) * DT, 9);
      expect(P(world, "b").hp).toBe(100);
    }
    expect(P(world, "a").status).toBe("alive");
  });

  it.each(Array.from({ length: STAGES }, (_, i) => i + 1))("stage %d burns ZONE_DPS x stage per second", (stage) => {
    const { world } = raid([alice(), bob()]);
    stepAt(world, holdTime(world, stage));
    const circle = world.state.zone;
    expect(circle.stage).toBe(stage);
    place(world, "a", beyond(circle).x, circle.y);
    step(world, TICK_MS);
    expect(100 - P(world, "a").hp).toBeCloseTo(ZONE_DPS * stage * DT, 9);
    expect(100 - P(world, "a").hp).toBeCloseTo(zoneDps(stage) * DT, 9);
  });

  it("scales with the step length it is given", () => {
    const { world } = raid([alice(), bob()]);
    stepAt(world, holdTime(world, 3));
    place(world, "a", beyond(world.state.zone).x, world.state.zone.y);
    const before = P(world, "a").hp;
    zoneSystem(world, 200);
    expect(before - P(world, "a").hp).toBeCloseTo(zoneDps(3) * 0.2, 9);
  });

  it("hurts a player the shrinking edge sweeps past, from the first step they are outside", () => {
    const { world } = raid([alice(), bob()], { raidSeconds: 120 });
    toughen(world, "a", "b");
    const p = plan(world);
    // Stand in a corner: inside the opening circle, outside the final one.
    const corner = { x: 60, y: 60 };
    expect(isOutside(p.final, corner.x, corner.y)).toBe(true);
    place(world, "a", corner.x, corner.y);
    place(world, "b", p.final.x, p.final.y);

    let swept = false;
    while (world.state.phase === "active") {
      const hpA = P(world, "a").hp;
      const hpB = P(world, "b").hp;
      step(world, TICK_MS);
      if (world.state.phase !== "active") break;
      const z = world.state.zone;
      const out = isOutside(z, corner.x, corner.y);
      expect(hpA - P(world, "a").hp).toBeCloseTo(out ? zoneDps(z.stage) * DT : 0, 6);
      expect(P(world, "b").hp).toBe(hpB);
      if (out) swept = true;
    }
    expect(swept).toBe(true);
    expect(P(world, "b").hp).toBe(TOUGH_HP);
  });

  it("does not hurt the dead, the extracted or the MIA", () => {
    const world = newWorld([alice(), bob(), carol(), { id: "d", name: "dave", items: [] }]);
    step(world, TICK_MS);
    park(world);
    toughen(world, "a", "b", "c", "d");
    stepAt(world, holdTime(world, 2));
    const out = beyond(world.state.zone);
    for (const id of ["a", "b", "c", "d"]) place(world, id, out.x, out.y);
    P(world, "a").status = "extracted";
    P(world, "b").status = "mia";
    P(world, "c").status = "dead";
    run(world, 10);
    for (const id of ["a", "b", "c"]) expect(P(world, id).hp).toBe(TOUGH_HP);
    expect(P(world, "d").hp).toBeLessThan(TOUGH_HP); // the one still alive does burn
  });
});

describe("dying to the zone", () => {
  /** Stage 2 hold (12 dps): `hp` left, standing outside. `bob` stays safe at the centre. */
  function nearDeath(hp: number, items: ItemDTO[] = gear("rifle", "gold")) {
    const ctx = raid([alice(items), bob(gear("knife"))]);
    const { world } = ctx;
    stepAt(world, holdTime(world, 2));
    const circle = zoneNow(world);
    place(world, "b", circle.x, circle.y);
    place(world, "a", beyond(circle).x, circle.y);
    P(world, "a").hp = hp;
    return { ...ctx, circle };
  }

  it("is a death by 'the zone': killedBy, a death fx with no killer, outcome died", () => {
    const { world, circle } = nearDeath(0.5);
    const at = { x: P(world, "a").x, y: P(world, "a").y };
    const events = step(world, TICK_MS); // 12 dps x 0.05 s = 0.6 hp
    const a = P(world, "a");
    expect(a.hp).toBe(0);
    expect(a.status).toBe("dead");
    expect(RT(world, "a").killedBy).toBe(ZONE_KILLER);
    expect(ZONE_KILLER).toBe("the zone");

    expect(fxOf(events)).toEqual([{ kind: "death", id: "a", x: at.x, y: at.y, by: null }]);
    const resolved = ofType(events, "resolved");
    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.id).toBe("a");
    expect(resolved[0]!.result).toMatchObject({
      outcome: "died", profile: "alice", killedBy: "the zone", kills: 0, extracted: [],
    });
    expect(resolved[0]!.result.lost).toEqual(gear("rifle", "gold"));
    expect(events.indexOf(ofType(events, "fx")[0]!)).toBeLessThan(events.indexOf(resolved[0]!));
    expect(circle.stage).toBe(2);
  });

  it("is nobody's kill", () => {
    const { world } = nearDeath(0.5);
    P(world, "b").kills = 0;
    step(world, TICK_MS);
    expect(P(world, "a").kills).toBe(0);
    expect(P(world, "b").kills).toBe(0);
    expect(P(world, "b").status).toBe("alive");
  });

  it("leaves a lootable body with everything carried, on the spot", () => {
    const items = gear("rifle", "gold", "bandage");
    const { world } = nearDeath(0.5, items);
    const at = { x: P(world, "a").x, y: P(world, "a").y };
    const containersBefore = world.state.containers.size;
    step(world, TICK_MS);
    expect(world.state.containers.size).toBe(containersBefore + 1);
    const body = [...world.state.containers.values()].find((c) => c.kind === "body")!;
    expect([body.x, body.y, body.label]).toEqual([at.x, at.y, "alice"]);
    expect(dto(body.items)).toEqual(items);
    expect(P(world, "a").inventory.length).toBe(0);
  });

  it("dies exactly on the step that takes hp to zero or below, never earlier", () => {
    const { world } = nearDeath(1.3); // 0.6 per step: 0.7, 0.1, then dead
    step(world, TICK_MS);
    step(world, TICK_MS);
    expect(P(world, "a").status).toBe("alive");
    expect(P(world, "a").hp).toBeCloseTo(0.1, 9);
    step(world, TICK_MS);
    expect(P(world, "a").status).toBe("dead");
    expect(P(world, "a").hp).toBe(0);
  });

  it("hp is clamped at zero, never negative", () => {
    const { world } = nearDeath(0.01);
    step(world, TICK_MS);
    expect(P(world, "a").hp).toBe(0);
  });

  it("happens once: no more damage, fx, results or bodies afterwards", () => {
    const { world } = nearDeath(0.5);
    step(world, TICK_MS);
    const containers = world.state.containers.size;
    const events = run(world, 30);
    expect(events.filter((e) => e.type === "resolved")).toEqual([]);
    expect(fxOf(events).filter((f) => f.kind === "death")).toEqual([]);
    expect(world.state.containers.size).toBe(containers);
    expect(P(world, "a").hp).toBe(0);
    expect(P(world, "a").status).toBe("dead");
  });

  it("two players dying on the same step each get their own death and result", () => {
    const world = newWorld([alice(gear("gold")), bob(gear("rifle")), carol()]);
    step(world, TICK_MS);
    park(world);
    stepAt(world, holdTime(world, 2));
    const circle = zoneNow(world);
    place(world, "a", beyond(circle).x, circle.y);
    place(world, "b", beyond(circle, 50).x, circle.y);
    place(world, "c", circle.x, circle.y);
    P(world, "a").hp = 0.1;
    P(world, "b").hp = 0.1;
    const events = step(world, TICK_MS);
    expect(ofType(events, "resolved").map((e) => [e.id, e.result.outcome, e.result.killedBy])).toEqual([
      ["a", "died", "the zone"],
      ["b", "died", "the zone"],
    ]);
    expect(fxOf(events)).toEqual([
      { kind: "death", id: "a", x: P(world, "a").x, y: P(world, "a").y, by: null },
      { kind: "death", id: "b", x: P(world, "b").x, y: P(world, "b").y, by: null },
    ]);
    expect(P(world, "c").status).toBe("alive");
    expect(world.state.phase).toBe("active");
  });

  it("the last player dying to the zone ends the raid, and the result stays 'died' (not MIA)", () => {
    const { world } = raid([alice(gear("gold"))]);
    stepAt(world, holdTime(world, 2));
    const circle = zoneNow(world);
    place(world, "a", beyond(circle).x, circle.y);
    P(world, "a").hp = 0.1;
    const events = step(world, TICK_MS);
    expect(ofType(events, "resolved").map((e) => e.result.outcome)).toEqual(["died"]);
    expect(ofType(events, "raidEnded")).toHaveLength(1);
    expect(world.state.phase).toBe("ended");
  });

  it("at the last stage (30 dps) a full-health player outside lasts 3.3 seconds", () => {
    const { world } = raid([alice(), bob()]);
    stepAt(world, holdTime(world, STAGES));
    const circle = zoneNow(world);
    place(world, "b", circle.x, circle.y);
    place(world, "a", beyond(circle).x, circle.y);
    expect(circle.stage).toBe(STAGES);
    expect(zoneDps(STAGES)).toBe(30);

    const early = run(world, 66); // 66 x 1.5 = 99 damage
    expect(P(world, "a").status).toBe("alive");
    expect(P(world, "a").hp).toBeCloseTo(1, 6);
    expect(ofType(early, "resolved")).toEqual([]);
    expect(ofType(run(world, 1), "resolved").map((e) => e.result.outcome)).toEqual(["died"]);
  });

  it("a player who dies to the zone mid-extraction is dead, never extracted", () => {
    const { world } = raid([alice(gear("gold")), bob()], { extractSeconds: 5 });
    stepAt(world, holdTime(world, 5));
    const circle = zoneNow(world);
    const outside = world.map.extracts.find((e) => Math.hypot(e.x - circle.x, e.y - circle.y) > circle.r + e.r)!;
    expect(outside).toBeDefined();
    place(world, "a", outside.x, outside.y);
    place(world, "b", circle.x, circle.y);
    enqueueClientMessage(RT(world, "a").inputs, "extract", {});
    step(world, TICK_MS);
    expect(RT(world, "a").extracting).not.toBeNull();

    const events = run(world, TICKS_PER_SEC * 6);
    const resolved = ofType(events, "resolved").filter((e) => e.id === "a");
    expect(resolved.map((e) => e.result.outcome)).toEqual(["died"]);
    expect(fxOf(events).some((f) => f.kind === "extracted")).toBe(false);
    expect(RT(world, "a").extracting).toBeNull();
    expect(P(world, "a").extractProgress).toBe(0);
  });
});

describe("extraction", () => {
  it("still works while standing outside the zone, as long as the player survives the wait", () => {
    const { world } = raid([alice(gear("gold")), bob()], { extractSeconds: 1 });
    stepAt(world, holdTime(world, 5));
    const circle = zoneNow(world);
    const away = world.map.extracts.find((e) => Math.hypot(e.x - circle.x, e.y - circle.y) > circle.r + e.r)!;
    expect(away).toBeDefined();
    place(world, "a", away.x, away.y);
    place(world, "b", circle.x, circle.y);
    expect(isOutside(circle, away.x, away.y)).toBe(true);

    enqueueClientMessage(RT(world, "a").inputs, "extract", {});
    step(world, TICK_MS);
    const events = run(world, TICKS_PER_SEC);
    const resolved = ofType(events, "resolved").filter((e) => e.id === "a");
    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.result).toMatchObject({ outcome: "extracted", killedBy: null, extracted: gear("gold") });
    expect(fxOf(events)).toContainEqual({ kind: "extracted", id: "a" });
    expect(P(world, "a").status).toBe("extracted");
    // It burned at 30 dps on 20 steps (the completing step extracts before the zone runs).
    expect(P(world, "a").hp).toBeCloseTo(100 - 20 * zoneDps(STAGES) * DT, 6);
  });

  it("the extraction that completes on the same step the zone would kill wins (extraction runs first)", () => {
    const { world } = raid([alice(gear("gold")), bob()], { extractSeconds: 1 });
    stepAt(world, holdTime(world, 5));
    const circle = zoneNow(world);
    const away = world.map.extracts.find((e) => Math.hypot(e.x - circle.x, e.y - circle.y) > circle.r + e.r)!;
    place(world, "a", away.x, away.y);
    place(world, "b", circle.x, circle.y);
    enqueueClientMessage(RT(world, "a").inputs, "extract", {});
    step(world, TICK_MS);
    run(world, TICKS_PER_SEC - 1);
    P(world, "a").hp = 0.01; // the next step both completes the extraction and would burn this away
    const events = step(world, TICK_MS);
    expect(ofType(events, "resolved").filter((e) => e.id === "a").map((e) => e.result.outcome)).toEqual(["extracted"]);
    expect(fxOf(events).some((f) => f.kind === "death")).toBe(false);
  });

  it("inside the final circle on its extract, a full-length extraction costs nothing", () => {
    const { world } = raid([alice(gear("gold")), bob()]);
    stepAt(world, holdTime(world, 5));
    const p = plan(world);
    place(world, "a", p.final.x, p.final.y);
    place(world, "b", p.final.x + 30, p.final.y);
    enqueueClientMessage(RT(world, "a").inputs, "extract", {});
    step(world, TICK_MS);
    const events = run(world, TICKS_PER_SEC * 5);
    expect(ofType(events, "resolved").filter((e) => e.id === "a").map((e) => e.result.outcome)).toEqual(["extracted"]);
    expect(P(world, "a").hp).toBe(100);
    expect(P(world, "b").hp).toBe(100);
  });
});

describe("after the raid", () => {
  it("the zone and everyone's hp freeze once the raid has ended", () => {
    const { world } = raid([alice(), bob()], { raidSeconds: 10 });
    toughen(world, "a", "b");
    place(world, "a", -1e5, -1e5);
    run(world, TICKS_PER_SEC * 12);
    expect(world.state.phase).toBe("ended");
    expect(P(world, "a").status).toBe("mia");

    const hp = P(world, "a").hp;
    const zone = world.state.zone.toJSON();
    const events = run(world, 40);
    expect(events).toEqual([]);
    expect(P(world, "a").hp).toBe(hp);
    expect(world.state.zone.toJSON()).toEqual(zone);
  });

  it("calling the system directly on an ended raid does nothing", () => {
    const { world } = raid([alice(), bob()], { raidSeconds: 10 });
    toughen(world, "a", "b");
    run(world, TICKS_PER_SEC * 12);
    expect(world.state.phase).toBe("ended");
    place(world, "a", -1e5, -1e5);
    P(world, "a").status = "alive";
    const hp = P(world, "a").hp;
    zoneSystem(world, TICK_MS);
    expect(P(world, "a").hp).toBe(hp);
    expect(world.events).toEqual([]);
  });

  it("a raid that ends before anyone dies to the zone makes the survivors MIA, as before", () => {
    const { world } = raid([alice(gear("gold")), bob()], { raidSeconds: 20 });
    toughen(world, "a", "b");
    const events = run(world, TICKS_PER_SEC * 21);
    expect(ofType(events, "resolved").map((e) => e.result.outcome).sort()).toEqual(["mia", "mia"]);
    expect(world.state.phase).toBe("ended");
  });
});

describe("a short raid", () => {
  it("plays every stage within 20 seconds and a player in the open still dies to it", () => {
    const { world } = raid([alice(gear("gold")), bob()], { raidSeconds: 20 });
    const p = plan(world);
    place(world, "a", 60, 60);
    place(world, "b", p.final.x, p.final.y);
    toughen(world, "b");
    const stages = new Set<number>();
    const events: SimEvent[] = [];
    while (world.state.phase === "active") {
      events.push(...step(world, TICK_MS));
      if (world.state.phase === "active") stages.add(world.state.zone.stage);
    }
    expect([...stages].sort()).toEqual(Array.from({ length: STAGES }, (_, i) => i + 1));
    const a = ofType(events, "resolved").find((e) => e.id === "a")!;
    expect(a.result).toMatchObject({ outcome: "died", killedBy: "the zone" });
    expect(ofType(events, "resolved").find((e) => e.id === "b")!.result.outcome).toBe("mia");
  });
});

describe("resolvePlayer interplay", () => {
  it("a player already resolved by something else is left alone", () => {
    const { world } = raid([alice(gear("gold")), bob()]);
    stepAt(world, holdTime(world, 2));
    const circle = zoneNow(world);
    place(world, "a", beyond(circle).x, circle.y);
    P(world, "a").hp = 0.1;
    resolvePlayer(world, P(world, "a"), RT(world, "a"), "died");
    world.events.length = 0;
    const events = step(world, TICK_MS);
    expect(events.filter((e) => e.type === "resolved")).toEqual([]);
    expect(fxOf(events).filter((f) => f.kind === "death")).toEqual([]);
  });
});

describe("zone vs combat vs raid end in the same step", () => {
  /** Same map, but open floor inside the border, so a punch across the zone edge is never walled off. */
  function openFloor(world: World): void {
    const m = world.map;
    const tiles = new Uint8Array(m.tiles.length);
    for (let ty = 0; ty < m.h; ty++) {
      for (let tx = 0; tx < m.w; tx++) {
        tiles[ty * m.w + tx] = tx === 0 || ty === 0 || tx === m.w - 1 || ty === m.h - 1 ? 1 : 0;
      }
    }
    world.map = { ...m, tiles };
  }

  /** Points just inside and just outside `c`, on the side facing the map centre (always in the world). */
  function acrossEdge(world: World, c: ZoneCircle, by = 10) {
    const cx = (world.map.w * TILE) / 2 - c.x;
    const cy = (world.map.h * TILE) / 2 - c.y;
    const len = Math.hypot(cx, cy) || 1;
    const ux = cx / len;
    const uy = cy / len;
    return {
      inn: { x: c.x + ux * (c.r - by), y: c.y + uy * (c.r - by) },
      out: { x: c.x + ux * (c.r + by), y: c.y + uy * (c.r + by) },
    };
  }
  it("lets the zone finish a player that combat left alive, without crediting the shooter", () => {
    const { world } = raid([alice(), bob()]);
    openFloor(world);
    const c = plan(world).stages[1]!.target; // the circle during stage 3's hold
    const { inn, out } = acrossEdge(world, c);
    place(world, "a", inn.x, inn.y);
    place(world, "b", out.x, out.y);
    P(world, "b").hp = 8.2; // fists take 8; the zone takes the rest
    enqueueClientMessage(RT(world, "a").inputs, "attack", { x: out.x, y: out.y });
    const events = stepAt(world, holdTime(world, 3));
    expect(P(world, "b").status).toBe("dead");
    expect(RT(world, "b").killedBy).toBe("the zone");
    expect(P(world, "a").kills).toBe(0);
    expect(ofType(events, "resolved").map((e) => e.id)).toEqual(["b"]);
  });

  it("does not resolve a player twice when combat kills them outside the zone", () => {
    const { world } = raid([alice(), bob()]);
    openFloor(world);
    const c = plan(world).stages[1]!.target;
    const { inn, out } = acrossEdge(world, c);
    place(world, "a", inn.x, inn.y);
    place(world, "b", out.x, out.y);
    P(world, "b").hp = 5;
    enqueueClientMessage(RT(world, "a").inputs, "attack", { x: out.x, y: out.y });
    const events = stepAt(world, holdTime(world, 3));
    expect(RT(world, "b").killedBy).toBe("alice");
    expect(P(world, "a").kills).toBe(1);
    expect(ofType(events, "resolved").map((e) => [e.id, e.result.outcome])).toEqual([["b", "died"]]);
  });

  it("keeps a zone death on the raid's last step a death, while the others go MIA", () => {
    const { world } = raid([alice(), bob()]);
    const { final } = plan(world);
    const out = beyond(final, 40);
    place(world, "b", out.x, out.y);
    P(world, "b").hp = 0.1;
    const events = stepAt(world, world.config.raidSeconds * 1000);
    expect(world.state.phase).toBe("ended");
    const outcomes = Object.fromEntries(ofType(events, "resolved").map((e) => [e.id, e.result.outcome]));
    expect(outcomes).toEqual({ a: "mia", b: "died" });
  });
});
