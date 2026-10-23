import { describe, expect, it } from "vitest";
import { mulberry32, TICK_MS, type ExtractZoneDef, type FxEvent, type ItemDTO } from "@raid/shared";
import type { PlayerState } from "@raid/shared/schema";
import { extractionSystem, handleExtract } from "../src/sim/extraction";
import { createGameWorld } from "../src/sim/gameplay";
import { enqueueClientMessage } from "../src/sim/inputs";
import { addPlayer, resolvePlayer, step } from "../src/sim/step";
import { createWorld, type SimConfig, type SimEvent, type World } from "../src/sim/world";

type EventOf<T extends SimEvent["type"]> = Extract<SimEvent, { type: T }>;

const TICKS_PER_SEC = 1000 / TICK_MS;

interface Seat { id: string; name: string; items: ItemDTO[] }
const alice = (items: ItemDTO[] = []): Seat => ({ id: "a", name: "alice", items });
const bob = (items: ItemDTO[] = []): Seat => ({ id: "b", name: "bob", items });
const gear = (...defs: string[]): ItemDTO[] => defs.map((def, i) => ({ uid: `${def}#${i}`, def }));

/** A started raid on the generated map (so the extract zones are the real ones). Returns the events of the start step too. */
function raid(seats: Seat[], cfg: Partial<SimConfig> = {}, seed = 1234) {
  let n = 0;
  const config: SimConfig = {
    minPlayers: seats.length, lobbySeconds: 15, fillSeconds: 0, raidSeconds: 360, extractSeconds: 5, ...cfg,
  };
  const world = createGameWorld({ seed, config, random: mulberry32(seed + 1), newItemUid: () => `L${++n}` });
  for (const s of seats) addPlayer(world, s.id, s.name, s.items);
  const startEvents = step(world, TICK_MS);
  expect(world.state.phase).toBe("active");
  return { world, startEvents };
}

const P = (world: World, id: string): PlayerState => world.state.players.get(id)!;
const RT = (world: World, id: string) => world.players.get(id)!;
const zoneOf = (world: World, i = 0): ExtractZoneDef => world.map.extracts[i]!;

function place(world: World, id: string, x: number, y: number): void {
  const p = P(world, id);
  p.x = x;
  p.y = y;
  RT(world, id).history = [{ t: world.state.serverTime, x, y }];
}

/** Puts the player on the centre of extract zone `i`, offset by (dx, dy). */
function placeInZone(world: World, id: string, i = 0, dx = 0, dy = 0): ExtractZoneDef {
  const z = zoneOf(world, i);
  place(world, id, z.x + dx, z.y + dy);
  return z;
}

function run(world: World, ticks: number): SimEvent[] {
  const all: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) all.push(...step(world, TICK_MS));
  return all;
}

/** Queues a client message and runs the step that handles it. */
function send(world: World, id: string, type: string, msg: unknown = {}): SimEvent[] {
  expect(enqueueClientMessage(RT(world, id).inputs, type, msg)).toBe(true);
  return step(world, TICK_MS);
}

const startExtract = (world: World, id: string) => send(world, id, "extract");

function ofType<T extends SimEvent["type"]>(events: SimEvent[], type: T): Array<EventOf<T>> {
  return events.filter((e): e is EventOf<T> => e.type === type);
}

const toasts = (events: SimEvent[], to: string) => ofType(events, "toast").filter((t) => t.to === to).map((t) => t.text);
const fxKinds = (events: SimEvent[]): FxEvent["kind"][] => ofType(events, "fx").map((e) => e.fx.kind);
const dto = (items: Iterable<{ uid: string; def: string }>): ItemDTO[] => Array.from(items, (i) => ({ uid: i.uid, def: i.def }));

describe("install", () => {
  it("is part of createGameWorld", () => {
    const { world } = raid([alice()], { minPlayers: 1 });
    expect(world.actions.extract).toBe(handleExtract);
    expect(world.systems.filter((s) => s === extractionSystem)).toHaveLength(1);
  });

  it("a bare world has no extraction", () => {
    const world = createWorld({
      seed: 1, config: { minPlayers: 1, lobbySeconds: 15, fillSeconds: 0, raidSeconds: 360, extractSeconds: 5 }, random: mulberry32(2),
    });
    expect(world.actions.extract).toBeUndefined();
    expect(world.systems).toEqual([]);
  });
});

describe("starting an extraction", () => {
  it("inside a zone: records the zone and start time, progress 0", () => {
    const { world } = raid([alice()], { minPlayers: 1 });
    const z = placeInZone(world, "a", 1, 10, -10);
    const events = startExtract(world, "a");
    expect(RT(world, "a").extracting).toEqual({ zoneId: z.id, startedAt: world.state.serverTime });
    expect(P(world, "a").extractProgress).toBe(0);
    expect(P(world, "a").status).toBe("alive");
    expect(events).toEqual([]);
  });

  it("works in every zone of the map", () => {
    const { world } = raid([alice()], { minPlayers: 1 });
    for (let i = 0; i < world.map.extracts.length; i++) {
      const z = placeInZone(world, "a", i);
      startExtract(world, "a");
      expect(RT(world, "a").extracting?.zoneId).toBe(z.id);
      RT(world, "a").extracting = null;
    }
  });

  it("the zone edge counts as inside; just past it does not", () => {
    const { world } = raid([alice()], { minPlayers: 1 });
    const z = zoneOf(world);
    place(world, "a", z.x + z.r, z.y);
    expect(toasts(startExtract(world, "a"), "a")).toEqual([]);
    expect(RT(world, "a").extracting?.zoneId).toBe(z.id);

    RT(world, "a").extracting = null;
    place(world, "a", z.x + z.r + 0.001, z.y);
    expect(toasts(startExtract(world, "a"), "a")).toEqual(["Not in an extraction zone"]);
    expect(RT(world, "a").extracting).toBeNull();
  });

  it("outside every zone: toasts the player and starts nothing", () => {
    const { world } = raid([alice(), bob()]);
    const spawn = { x: P(world, "a").x, y: P(world, "a").y };
    expect(world.map.extracts.every((z) => Math.hypot(z.x - spawn.x, z.y - spawn.y) > z.r)).toBe(true);
    const events = startExtract(world, "a");
    expect(toasts(events, "a")).toEqual(["Not in an extraction zone"]);
    expect(toasts(events, "b")).toEqual([]);
    expect(RT(world, "a").extracting).toBeNull();
    expect(P(world, "a").extractProgress).toBe(0);
  });

  it("picks the nearest zone when circles overlap", () => {
    const { world } = raid([alice()], { minPlayers: 1 });
    world.map = {
      ...world.map,
      extracts: [
        { id: "n1", name: "n1", x: 500, y: 500, r: 100 },
        { id: "n2", name: "n2", x: 560, y: 500, r: 100 },
      ],
    };
    place(world, "a", 545, 500);
    startExtract(world, "a");
    expect(RT(world, "a").extracting?.zoneId).toBe("n2");
  });

  it("pressing extract again does not restart the countdown", () => {
    const { world } = raid([alice()], { minPlayers: 1, extractSeconds: 2 });
    placeInZone(world, "a");
    startExtract(world, "a");
    const startedAt = RT(world, "a").extracting!.startedAt;
    run(world, 10);
    const before = P(world, "a").extractProgress;
    expect(before).toBeCloseTo(0.25);
    const events = startExtract(world, "a");
    expect(RT(world, "a").extracting!.startedAt).toBe(startedAt);
    expect(P(world, "a").extractProgress).toBeGreaterThan(before);
    expect(toasts(events, "a")).toEqual([]);
  });

  it("stops a walk that was already queued, so the player stays put", () => {
    const { world } = raid([alice()], { minPlayers: 1, extractSeconds: 2 });
    const z = placeInZone(world, "a", 0, -20, 0);
    RT(world, "a").path = [{ x: z.x + 40, y: z.y }];
    startExtract(world, "a");
    expect(RT(world, "a").path).toEqual([]);
    run(world, 5);
    expect(P(world, "a").x).toBe(z.x - 20);
    expect(RT(world, "a").extracting).not.toBeNull();
  });
});

describe("progress and completion", () => {
  it("progress follows elapsed server time over extractSeconds", () => {
    const { world } = raid([alice()], { minPlayers: 1, extractSeconds: 2 });
    placeInZone(world, "a");
    startExtract(world, "a");
    run(world, 5);
    expect(P(world, "a").extractProgress).toBeCloseTo(5 / 40);
    run(world, 15);
    expect(P(world, "a").extractProgress).toBeCloseTo(20 / 40);
    run(world, 19);
    expect(P(world, "a").extractProgress).toBeCloseTo(39 / 40);
    expect(P(world, "a").status).toBe("alive");
  });

  it("completes on exactly the tick extractSeconds have elapsed, not before", () => {
    const { world } = raid([alice(gear("rifle", "gold"))], { minPlayers: 1, extractSeconds: 1 });
    placeInZone(world, "a");
    startExtract(world, "a");
    const early = run(world, TICKS_PER_SEC - 1);
    expect(ofType(early, "resolved")).toEqual([]);
    expect(P(world, "a").status).toBe("alive");
    expect(P(world, "a").extractProgress).toBeCloseTo(0.95);

    const last = run(world, 1);
    expect(ofType(last, "resolved")).toHaveLength(1);
    expect(P(world, "a").status).toBe("extracted");
  });

  it("emits the extracted fx before resolving, then a result carrying everything held", () => {
    const items = gear("rifle", "gold", "bandage");
    const { world } = raid([alice(items)], { minPlayers: 1, extractSeconds: 1 });
    placeInZone(world, "a");
    startExtract(world, "a");
    const events = run(world, TICKS_PER_SEC);

    const fx = ofType(events, "fx").map((e) => e.fx);
    expect(fx).toEqual([{ kind: "extracted", id: "a" }]);
    const resolved = ofType(events, "resolved");
    expect(resolved).toHaveLength(1);
    expect(events.indexOf(ofType(events, "fx")[0]!)).toBeLessThan(events.indexOf(resolved[0]!));

    const { id, result } = resolved[0]!;
    expect(id).toBe("a");
    expect(result).toMatchObject({ outcome: "extracted", profile: "alice", killedBy: null, kills: 0, lost: [] });
    expect(result.extracted).toEqual(items);
    expect(result.broughtIn).toEqual(items);
    expect(P(world, "a").inventory.length).toBe(0);
    expect(P(world, "a").extractProgress).toBe(0);
    expect(RT(world, "a").extracting).toBeNull();
    expect(RT(world, "a").resolved).toBe(true);
  });

  it("extracts what was picked up and leaves out what was dropped", () => {
    const items = gear("knife", "bandage", "watch");
    const { world } = raid([alice(items)], { minPlayers: 1, extractSeconds: 1 });
    const crate = [...world.state.containers.values()].find((c) => c.kind === "crate" && c.items.length > 0)!;
    const loot = dto(crate.items)[0]!;
    place(world, "a", crate.x, crate.y);
    send(world, "a", "take", { containerId: crate.id, uid: loot.uid });
    expect(dto(P(world, "a").inventory)).toContainEqual(loot);
    send(world, "a", "drop", { uid: "watch#2" });
    expect(dto(P(world, "a").inventory).map((i) => i.uid)).not.toContain("watch#2");

    placeInZone(world, "a");
    startExtract(world, "a");
    const [resolved] = ofType(run(world, TICKS_PER_SEC), "resolved");
    const { result } = resolved!;
    expect(result.outcome).toBe("extracted");
    expect(result.extracted.map((i) => i.uid).sort()).toEqual(["bandage#1", "knife#0", loot.uid].sort());
    expect(result.broughtIn).toEqual(items);
    expect(result.lost).toEqual([{ uid: "watch#2", def: "watch" }]);
  });

  it("an extracted player is out: later input does nothing and the body stays empty", () => {
    const { world } = raid([alice(gear("gold")), bob()], { extractSeconds: 1 });
    placeInZone(world, "a");
    startExtract(world, "a");
    run(world, TICKS_PER_SEC);
    expect(P(world, "a").status).toBe("extracted");
    const containers = world.state.containers.size;
    expect(send(world, "a", "extract")).toEqual([]);
    expect(send(world, "a", "attack", { x: 10, y: 10 })).toEqual([]);
    expect(world.state.containers.size).toBe(containers);
    expect(RT(world, "a").extracting).toBeNull();
  });

  it("two players extract independently and each gets their own result", () => {
    const { world } = raid([alice(gear("gold")), bob(gear("rifle"))], { extractSeconds: 1 });
    placeInZone(world, "a", 0);
    placeInZone(world, "b", 1);
    startExtract(world, "a");
    run(world, 10);
    startExtract(world, "b");
    expect(P(world, "b").extractProgress).toBe(0);
    expect(P(world, "a").extractProgress).toBeCloseTo(11 / 20);

    const first = ofType(run(world, 9), "resolved");
    expect(first.map((e) => e.id)).toEqual(["a"]);
    expect(first[0]!.result.extracted).toEqual(gear("gold"));
    expect(P(world, "b").status).toBe("alive");

    const second = ofType(run(world, 11), "resolved");
    expect(second.map((e) => e.id)).toEqual(["b"]);
    expect(second[0]!.result.extracted).toEqual(gear("rifle"));
    expect(world.state.phase).toBe("ended"); // nobody left alive
  });

  it("players in the same zone starting together finish together", () => {
    const { world } = raid([alice(gear("gold")), bob(gear("rifle"))], { extractSeconds: 1 });
    placeInZone(world, "a", 0, -10, 0);
    placeInZone(world, "b", 0, 10, 0);
    enqueueClientMessage(RT(world, "a").inputs, "extract", {});
    enqueueClientMessage(RT(world, "b").inputs, "extract", {});
    step(world, TICK_MS);
    const events = run(world, TICKS_PER_SEC);
    expect(ofType(events, "resolved").map((e) => e.id).sort()).toEqual(["a", "b"]);
    expect(fxKinds(events).filter((k) => k === "extracted")).toHaveLength(2);
  });

  // 8.05 and 16.1 are the kind of values where seconds * 1000 is not exact in floating point (8050.000000000001).
  it.each([0.05, 0.1, 0.15, 0.35, 0.5, 1, 2.05, 5, 8.05, 12.5, 16.1])(
    "extractSeconds=%d completes after exactly that many seconds of ticks",
    (extractSeconds) => {
      const { world } = raid([alice(gear("gold"))], { minPlayers: 1, extractSeconds });
      placeInZone(world, "a");
      startExtract(world, "a");
      const ticks = Math.round(extractSeconds * TICKS_PER_SEC);
      expect(ofType(run(world, ticks - 1), "resolved")).toEqual([]);
      expect(P(world, "a").status).toBe("alive");
      expect(ofType(run(world, 1), "resolved")).toHaveLength(1);
      expect(P(world, "a").status).toBe("extracted");
    },
  );

  it("extractSeconds of 0 extracts on the same step", () => {
    const { world } = raid([alice(gear("gold"))], { minPlayers: 1, extractSeconds: 0 });
    placeInZone(world, "a");
    const events = startExtract(world, "a");
    expect(ofType(events, "resolved")).toHaveLength(1);
    expect(P(world, "a").status).toBe("extracted");
  });

  it("reads the duration from the world's config every step", () => {
    const { world } = raid([alice()], { minPlayers: 1, extractSeconds: 10 });
    placeInZone(world, "a");
    startExtract(world, "a");
    run(world, 10);
    world.config.extractSeconds = 1; // 20 ticks have not passed yet, 10 of them have
    expect(ofType(run(world, 9), "resolved")).toEqual([]);
    expect(ofType(run(world, 1), "resolved")).toHaveLength(1);
  });
});

describe("cancelling", () => {
  function extracting(cfg: Partial<SimConfig> = {}, seats: Seat[] = [alice(gear("gold"))]) {
    const ctx = raid(seats, { minPlayers: seats.length, extractSeconds: 2, ...cfg });
    const z = placeInZone(ctx.world, "a");
    startExtract(ctx.world, "a");
    run(ctx.world, 10);
    expect(P(ctx.world, "a").extractProgress).toBeGreaterThan(0.1);
    return { ...ctx, z };
  }

  it("leaving the zone cancels it and says so", () => {
    const { world, z } = extracting();
    place(world, "a", z.x + z.r + 1, z.y);
    const events = run(world, 1);
    expect(RT(world, "a").extracting).toBeNull();
    expect(P(world, "a").extractProgress).toBe(0);
    expect(toasts(events, "a")).toEqual(["Extraction cancelled"]);
    expect(ofType(events, "resolved")).toEqual([]);
    expect(P(world, "a").status).toBe("alive");
  });

  it("is quiet afterwards: no repeated toasts, and it never completes", () => {
    const { world, z } = extracting();
    place(world, "a", z.x + z.r + 1, z.y);
    const events = run(world, 1 + TICKS_PER_SEC * 3);
    expect(toasts(events, "a")).toEqual(["Extraction cancelled"]);
    expect(ofType(events, "resolved")).toEqual([]);
  });

  it("starting again after a cancel restarts the countdown from zero", () => {
    const { world, z } = extracting();
    place(world, "a", z.x + z.r + 1, z.y);
    run(world, 1);
    place(world, "a", z.x, z.y);
    startExtract(world, "a");
    expect(P(world, "a").extractProgress).toBe(0);
    expect(RT(world, "a").extracting!.startedAt).toBe(world.state.serverTime);
    run(world, 19);
    expect(P(world, "a").status).toBe("alive");
    expect(ofType(run(world, 21), "resolved")).toHaveLength(1);
  });

  it("walking cancels it (a move command) and says so", () => {
    const { world, z } = extracting();
    const events = send(world, "a", "move", { x: z.x + 30, y: z.y });
    expect(RT(world, "a").extracting).toBeNull();
    expect(P(world, "a").extractProgress).toBe(0);
    expect(ofType(events, "resolved")).toEqual([]);
    expect(RT(world, "a").path.length).toBeGreaterThan(0);
    expect(toasts(events, "a")).toEqual(["Extraction cancelled"]);
  });

  it("a stop command cancels it too, and says so", () => {
    const { world } = extracting();
    const events = send(world, "a", "stop");
    expect(RT(world, "a").extracting).toBeNull();
    expect(P(world, "a").extractProgress).toBe(0);
    expect(toasts(events, "a")).toEqual(["Extraction cancelled"]);
  });

  it("attacking cancels it, even a swing that hits nothing, and says so", () => {
    const { world, z } = extracting();
    const events = send(world, "a", "attack", { x: z.x + 30, y: z.y });
    expect(RT(world, "a").extracting).toBeNull();
    expect(P(world, "a").extractProgress).toBe(0);
    expect(toasts(events, "a")).toEqual(["Extraction cancelled"]);
  });

  it("says it once per cancel, however many things cancel it in the same step", () => {
    const { world, z } = extracting();
    expect(enqueueClientMessage(RT(world, "a").inputs, "move", { x: z.x + 30, y: z.y })).toBe(true);
    expect(enqueueClientMessage(RT(world, "a").inputs, "attack", { x: z.x + 30, y: z.y })).toBe(true);
    const events = step(world, TICK_MS);
    expect(RT(world, "a").extracting).toBeNull();
    expect(toasts(events, "a")).toEqual(["Extraction cancelled"]);
    expect(toasts(send(world, "a", "stop"), "a")).toEqual([]); // nothing left to cancel
  });

  it("walking or attacking with no extraction running stays silent", () => {
    const { world } = raid([alice(gear("gold"))], { minPlayers: 1 });
    const z = placeInZone(world, "a");
    const moved = send(world, "a", "move", { x: z.x + 30, y: z.y });
    const stopped = send(world, "a", "stop");
    const swung = send(world, "a", "attack", { x: z.x + 30, y: z.y });
    expect([moved, stopped, swung].map((e) => toasts(e, "a"))).toEqual([[], [], []]);
  });

  it("only the player whose extraction was cancelled is told", () => {
    const { world, z } = extracting({}, [alice(gear("gold")), bob(gear("gold"))]);
    const events = send(world, "a", "stop");
    expect(toasts(events, "a")).toEqual(["Extraction cancelled"]);
    expect(toasts(events, "b")).toEqual([]);
  });

  it("an attack on cooldown is ignored and leaves the extraction running", () => {
    const { world, z } = extracting();
    RT(world, "a").nextAttackAt = world.state.serverTime + 10_000;
    send(world, "a", "attack", { x: z.x + 30, y: z.y });
    expect(RT(world, "a").extracting).not.toBeNull();
  });

  it("taking damage does not cancel it", () => {
    const { world, z } = extracting({ extractSeconds: 3 }, [alice(gear("gold")), bob(gear("pistol"))]);
    place(world, "b", z.x + 30, z.y);
    run(world, 1);
    const events = send(world, "b", "attack", { x: z.x, y: z.y });
    expect(P(world, "a").hp).toBeLessThan(100);
    expect(P(world, "a").status).toBe("alive");
    expect(RT(world, "a").extracting).not.toBeNull();
    expect(toasts(events, "a")).toEqual([]);
    expect(RT(world, "b").extracting).toBeNull();

    const done = ofType(run(world, TICKS_PER_SEC * 3), "resolved").find((e) => e.id === "a");
    expect(done?.result.outcome).toBe("extracted");
  });

  it("dying mid-extraction resolves as died, never as extracted", () => {
    const { world, z } = extracting({ extractSeconds: 3 }, [alice(gear("gold")), bob(gear("rifle"))]);
    place(world, "b", z.x + 30, z.y);
    P(world, "a").hp = 1;
    run(world, 1);
    const events = send(world, "b", "attack", { x: z.x, y: z.y });
    const resolved = ofType(events, "resolved");
    expect(resolved.map((e) => [e.id, e.result.outcome])).toEqual([["a", "died"]]);
    expect(resolved[0]!.result.extracted).toEqual([]);
    expect(RT(world, "a").extracting).toBeNull();
    expect(P(world, "a").extractProgress).toBe(0);
    expect(fxKinds(run(world, TICKS_PER_SEC * 4))).not.toContain("extracted");
  });
});

describe("ended raids and ineligible players", () => {
  it("the raid ending mid-extraction makes the player MIA, not extracted", () => {
    const { world } = raid([alice(gear("gold"))], { minPlayers: 1, extractSeconds: 5, raidSeconds: 2 });
    placeInZone(world, "a");
    startExtract(world, "a");
    const events = run(world, TICKS_PER_SEC * 3);
    const resolved = ofType(events, "resolved");
    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.result.outcome).toBe("mia");
    expect(resolved[0]!.result.extracted).toEqual([]);
    expect(fxKinds(events)).not.toContain("extracted");
    expect(world.state.phase).toBe("ended");
    expect(RT(world, "a").extracting).toBeNull();
  });

  it("extract after the raid ended does nothing", () => {
    const { world } = raid([alice(), bob()], { raidSeconds: 1 });
    run(world, TICKS_PER_SEC * 2);
    expect(world.state.phase).toBe("ended");
    expect(P(world, "a").status).toBe("mia");
    placeInZone(world, "a");
    expect(send(world, "a", "extract")).toEqual([]);
    expect(RT(world, "a").extracting).toBeNull();
    expect(P(world, "a").status).toBe("mia");
  });

  it("extract in the lobby does nothing", () => {
    const world = createGameWorld({
      seed: 1234,
      config: { minPlayers: 2, lobbySeconds: 15, fillSeconds: 0, raidSeconds: 360, extractSeconds: 5 },
      random: mulberry32(1),
    });
    addPlayer(world, "a", "alice", []);
    const z = zoneOf(world);
    P(world, "a").x = z.x;
    P(world, "a").y = z.y;
    expect(send(world, "a", "extract")).toEqual([]);
    expect(world.state.phase).toBe("lobby");
    expect(RT(world, "a").extracting).toBeNull();
  });

  it("a dead player cannot extract", () => {
    const { world } = raid([alice(gear("gold")), bob()], { extractSeconds: 1 });
    placeInZone(world, "a");
    resolvePlayer(world, P(world, "a"), RT(world, "a"), "died");
    world.events.length = 0;
    expect(send(world, "a", "extract")).toEqual([]);
    expect(RT(world, "a").extracting).toBeNull();
    expect(run(world, TICKS_PER_SEC * 2).filter((e) => e.type === "resolved")).toEqual([]);
    expect(P(world, "a").status).toBe("dead");
  });

  it("the system ignores a player who stopped being alive mid-extraction", () => {
    const { world } = raid([alice(gear("gold")), bob()], { extractSeconds: 1 });
    placeInZone(world, "a");
    startExtract(world, "a");
    P(world, "a").status = "mia"; // e.g. removed by some other module this very tick
    const events = run(world, TICKS_PER_SEC * 2);
    expect(ofType(events, "resolved")).toEqual([]);
    expect(fxKinds(events)).not.toContain("extracted");
  });
});

describe("client message", () => {
  it("is accepted from any state; the sim decides", () => {
    const { world } = raid([alice(), bob()]);
    expect(enqueueClientMessage(RT(world, "a").inputs, "extract", {})).toBe(true);
    expect(enqueueClientMessage(RT(world, "a").inputs, "extract", undefined)).toBe(true);
    expect(enqueueClientMessage(RT(world, "a").inputs, "extract", { zone: "x1", x: 5 })).toBe(true);
  });

  it("extra payload fields cannot choose the zone or the time", () => {
    const { world } = raid([alice()], { minPlayers: 1 });
    const z = zoneOf(world, 1);
    expect(toasts(send(world, "a", "extract", { zoneId: z.id, startedAt: -1e9 }), "a")).toEqual(["Not in an extraction zone"]);
    expect(RT(world, "a").extracting).toBeNull();
  });
});
