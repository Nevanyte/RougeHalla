// World tactics (docs/BOTS.md 4): the loot sequence, its refusals and limits, roam, hold, idle, and the seeded hold spot.
import { describe, expect, it } from "vitest";
import {
  circleClear, COLISEUM_RING_RADIUS, findPath, hasLineOfSight, INTERACT_RANGE, mapFromTiles, PLAYER_RADIUS, segmentClear, TILE,
  type GameMap, type Vec2,
} from "@raid/shared";
import { createWorldTactics, pickHoldSpot, type WorldGoal, type WorldTactics } from "../../src/bots/brain/tactics/world";
import type {
  BrainConfig, ContainerMemory, ContainerView, FighterView, Intent, MobMemory, MobView, ObservedEvent, PathService, PersonaId,
  SelfView, TacticsOutput,
} from "../../src/bots/brain/types";
import {
  brainConfig, container, ctx, emptyMemory, fighter, mobView, percept, rngs, selfView, testMap, services,
} from "./fixtures";

// ------------------------------------------------------------------------------------------------------------------ helpers

const NOW = 100_000;

/** A walled box of open floor (48 x 48 tiles), optionally with a vertical wall across its middle that leaves two gaps. */
function arena(wall = false): GameMap {
  const w = 48;
  const tiles = new Uint8Array(w * w);
  for (let i = 0; i < w; i++) {
    tiles[i] = 1;
    tiles[(w - 1) * w + i] = 1;
    tiles[i * w] = 1;
    tiles[i * w + w - 1] = 1;
  }
  if (wall) for (let y = 4; y < 41; y++) tiles[y * w + 24] = 1;
  return mapFromTiles(w, w, tiles);
}

function cfgFor(map: GameMap, persona: PersonaId = "hunter", over: Partial<BrainConfig> = {}): BrainConfig {
  return brainConfig("normal", persona, { map, services: services(map), ...over });
}

interface Scene {
  cfg?: BrainConfig;
  me?: Vec2;
  now?: number;
  /** How long the bot has stood still (ms); 0 = it is moving. */
  still?: number;
  weapons?: SelfView["weapons"];
  containers?: ContainerView[];
  fighters?: FighterView[];
  mobs?: MobView[];
  events?: ObservedEvent[];
  memContainers?: ContainerMemory[];
  memMobs?: MobMemory[];
  seed?: number;
}

const ME: Vec2 = { x: 400, y: 640 };

function think(t: WorldTactics, goal: WorldGoal, s: Scene = {}): TacticsOutput {
  const cfg = s.cfg ?? cfgFor(arena());
  const now = s.now ?? NOW;
  const me = s.me ?? ME;
  const base = emptyMemory();
  const mem = emptyMemory({
    self: { ...base.self, stillSince: now - (s.still ?? 0) },
    containers: new Map((s.memContainers ?? []).map((c) => [c.id, c])),
    mobs: new Map((s.memMobs ?? []).map((m) => [m.id, m])),
  });
  const p = percept({
    now,
    self: selfView({ x: me.x, y: me.y, weapons: s.weapons ?? ["axe", null] }),
    containers: s.containers ?? [],
    fighters: s.fighters ?? [],
    mobs: s.mobs ?? [],
    events: s.events ?? [],
  });
  return t.act(ctx({ cfg, p, mem, rng: rngs(s.seed ?? 1) }), goal);
}

const d = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);
const at = (x: number, y: number): Vec2 => ({ x, y });
const loot = (container: string): WorldGoal => ({ kind: "loot", container });
const roam = (to: Vec2): WorldGoal => ({ kind: "roam", to, why: "explore" });
const hold = (where: Vec2, why: "coliseum" | "ambush" | "wait" = "coliseum"): WorldGoal => ({ kind: "hold", at: where, why });
const kinds = (o: TacticsOutput) => o.intents.map((i) => i.kind);

function chest(x: number, y: number, over: Partial<ContainerView> = {}): ContainerView {
  return container({ id: "c1", kind: "ground", x, y, dist: d(ME, at(x, y)), closed: true, weapon: "bow", interactable: false, ...over });
}

function foe(x: number, y: number, over: Partial<FighterView> = {}): FighterView {
  return fighter({ id: "foe", x, y, dist: d(ME, at(x, y)), status: "alive", ...over });
}

function mob(x: number, y: number, over: Partial<MobView> = {}): MobView {
  return mobView({ id: "mob1", x, y, dist: d(ME, at(x, y)), status: "alive", ...over });
}

function toast(text: string, t: number): ObservedEvent {
  return { kind: "toast", text, t, at: null };
}

function memContainer(over: Partial<ContainerMemory> = {}): ContainerMemory {
  return { id: "c1", kind: "ground", pos: at(900, 640), closed: true, weapon: "bow", seenAt: NOW - 1000, skipped: false, ...over };
}

function memMob(over: Partial<MobMemory> = {}): MobMemory {
  return {
    id: "mob1", kind: "mob", faction: "fire", home: at(600, 640), campId: null, pos: at(600, 640), dotAt: NOW, seenAt: NOW, hpFrac: 1,
    inHand: "axe", awake: false, returning: false, alive: true, ...over,
  };
}

/** The scene of a bot one step from a container that it can take. */
function beside(over: Partial<Scene> = {}): Scene {
  const c = at(ME.x + 30, ME.y);
  return { containers: [chest(c.x, c.y, { interactable: true })], ...over };
}

// ------------------------------------------------------------------------------------------------------------------ loot

describe("world tactics: loot", () => {
  it("walks to the container, halts, presses F once it stands still, and is done when the weapon is in hand", () => {
    const t = createWorldTactics();
    const g = loot("c1");
    const far = at(ME.x + 300, ME.y);

    const walk = think(t, g, { containers: [chest(far.x, far.y)], still: 0 });
    expect(walk.status.state).toBe("running");
    expect(walk.intents).toHaveLength(1);
    expect(walk.intents[0]).toMatchObject({ kind: "move", to: far });

    // In reach and interactable but still walking: hold still first, no pickup yet.
    const halt = think(t, g, beside({ now: NOW + 1000, still: 0 }));
    expect(kinds(halt)).toEqual(["stop"]);
    expect(halt.status.state).toBe("running");

    // The halt is not repeated at once, and no pickup before 150 ms of stillness.
    expect(think(t, g, beside({ now: NOW + 1050, still: 50 })).intents).toEqual([]);
    expect(think(t, g, beside({ now: NOW + 1100, still: 100 })).intents).toEqual([]);

    const press = think(t, g, beside({ now: NOW + 1160, still: 160 }));
    expect(press.intents).toHaveLength(1);
    expect(press.intents[0]).toMatchObject({ kind: "pickup", container: "c1" });

    // At most one press per 400 ms while it is still interactable and not yet taken.
    expect(think(t, g, beside({ now: NOW + 1300, still: 300 })).intents).toEqual([]);
    expect(kinds(think(t, g, beside({ now: NOW + 1600, still: 600 })))).toEqual(["pickup"]);

    // A second weapon in the bag ends it.
    const done = think(t, g, beside({ now: NOW + 1700, still: 700, weapons: ["axe", "bow"] }));
    expect(done.status.state).toBe("done");
    expect(done.intents).toEqual([]);
  });

  it("presses F without a halt when the bot already stands still beside it", () => {
    const t = createWorldTactics();
    expect(kinds(think(t, loot("c1"), beside({ still: 400 })))).toEqual(["pickup"]);
  });

  it("never presses F while the container is not interactable: it keeps walking", () => {
    const t = createWorldTactics();
    const c = at(ME.x + 30, ME.y);
    const o = think(t, loot("c1"), { containers: [chest(c.x, c.y, { interactable: false })], still: 500 });
    expect(kinds(o)).toEqual(["move"]);
  });

  it("is not in reach beyond INTERACT_RANGE - 12 even when the flag says interactable", () => {
    const t = createWorldTactics();
    const c = at(ME.x + INTERACT_RANGE - 4, ME.y);
    const o = think(t, loot("c1"), { containers: [chest(c.x, c.y, { interactable: true })], still: 500 });
    expect(kinds(o)).toEqual(["move"]);
  });

  it("is done when the container no longer holds a weapon", () => {
    const t = createWorldTactics();
    const c = at(ME.x + 100, ME.y);
    expect(think(t, loot("c1"), { containers: [chest(c.x, c.y, { closed: false })] }).status.state).toBe("done");
    const t2 = createWorldTactics();
    expect(think(t2, loot("c1"), { containers: [chest(c.x, c.y, { weapon: null })] }).status.state).toBe("done");
  });

  it("fails at once on 'Nothing there' / 'Nothing to take' after it pressed F", () => {
    for (const text of ["Nothing there", "Nothing to take"]) {
      const t = createWorldTactics();
      const g = loot("c1");
      think(t, g, beside({ still: 500 }));
      const o = think(t, g, beside({ now: NOW + 100, still: 600, events: [toast(text, NOW + 80)] }));
      expect(o.status.state).toBe("failed");
      expect(o.intents).toEqual([]);
    }
  });

  it("fails on the second 'Too far away' / \"Can't reach that\", not the first", () => {
    for (const text of ["Too far away", "Can't reach that"]) {
      const t = createWorldTactics();
      const g = loot("c1");
      think(t, g, beside({ still: 500 }));
      const first = think(t, g, beside({ now: NOW + 100, still: 600, events: [toast(text, NOW + 60)] }));
      expect(first.status.state).toBe("running");
      const second = think(t, g, beside({ now: NOW + 600, still: 1100, events: [toast(text, NOW + 560)] }));
      expect(second.status.state).toBe("failed");
    }
  });

  it("counts a toast once even when it is thought about twice on the same percept", () => {
    const t = createWorldTactics();
    const g = loot("c1");
    think(t, g, beside({ still: 500 }));
    const s = beside({ now: NOW + 100, still: 600, events: [toast("Too far away", NOW + 60)] });
    expect(think(t, g, s).status.state).toBe("running");
    expect(think(t, g, s).status.state).toBe("running");
  });

  it("ignores toasts that are not about its pickup, and other toast texts", () => {
    const t = createWorldTactics();
    const g = loot("c1");
    // Before any F: a stray refusal means nothing.
    expect(think(t, g, beside({ still: 500, events: [toast("Nothing there", NOW)] })).status.state).toBe("running");
    // An older one than the press, and an unrelated text.
    expect(think(t, g, beside({ now: NOW + 100, still: 600, events: [toast("Nothing there", NOW - 500), toast("Welcome", NOW + 90)] })).status.state).toBe("running");
  });

  it("gives up after the 6 s budget", () => {
    const t = createWorldTactics();
    const g = loot("c1");
    const far = at(ME.x + 300, ME.y);
    expect(think(t, g, { containers: [chest(far.x, far.y)] }).status.state).toBe("running");
    expect(think(t, g, { now: NOW + 2000, containers: [chest(far.x, far.y)] }).status.state).toBe("running");
    expect(think(t, g, { now: NOW + 4000, containers: [chest(far.x, far.y)] }).status.state).toBe("running");
    expect(think(t, g, { now: NOW + 5900, containers: [chest(far.x, far.y)] }).status.state).toBe("running");
    const late = think(t, g, { now: NOW + 6100, containers: [chest(far.x, far.y)] });
    expect(late.status.state).toBe("failed");
    expect(late.intents).toEqual([]);
  });

  it("starts a fresh budget when the goal comes back after a pause", () => {
    const t = createWorldTactics();
    const g = loot("c1");
    const far = at(ME.x + 300, ME.y);
    think(t, g, { containers: [chest(far.x, far.y)] });
    expect(think(t, g, { now: NOW + 60_000, containers: [chest(far.x, far.y)] }).status.state).toBe("running");
  });

  it("fails when an enemy stands within 240 u, and goes on when it is farther", () => {
    const g = loot("c1");
    const far = at(ME.x + 300, ME.y);
    const near = think(createWorldTactics(), g, { containers: [chest(far.x, far.y)], fighters: [foe(ME.x, ME.y - 200)] });
    expect(near.status.state).toBe("failed");
    expect(near.intents).toEqual([]);
    const distant = think(createWorldTactics(), g, { containers: [chest(far.x, far.y)], fighters: [foe(ME.x, ME.y - 300)] });
    expect(distant.status.state).toBe("running");
    // A dead one is not an enemy.
    const dead = think(createWorldTactics(), g, { containers: [chest(far.x, far.y)], fighters: [foe(ME.x, ME.y - 100, { status: "dead" })] });
    expect(dead.status.state).toBe("running");
  });

  it("fails when an awake mob stands within 220 u, but not for a sleeping one or a far one", () => {
    const g = loot("c1");
    const far = at(ME.x + 300, ME.y);
    const awake = think(createWorldTactics(), g, {
      containers: [chest(far.x, far.y)], mobs: [mob(ME.x, ME.y + 150)], memMobs: [memMob({ awake: true })],
    });
    expect(awake.status.state).toBe("failed");
    const asleep = think(createWorldTactics(), g, {
      containers: [chest(far.x, far.y)], mobs: [mob(ME.x, ME.y + 150)], memMobs: [memMob({ awake: false })],
    });
    expect(asleep.status.state).toBe("running");
    const distant = think(createWorldTactics(), g, {
      containers: [chest(far.x, far.y)], mobs: [mob(ME.x, ME.y + 260)], memMobs: [memMob({ awake: true })],
    });
    expect(distant.status.state).toBe("running");
  });

  it("fails when the container is in neither the percept nor memory, or memory marks it skipped", () => {
    expect(think(createWorldTactics(), loot("c1"), {}).status.state).toBe("failed");
    const skipped = think(createWorldTactics(), loot("c1"), { memContainers: [memContainer({ skipped: true })] });
    expect(skipped.status.state).toBe("failed");
  });

  it("walks to a container only memory knows, at the position it remembers", () => {
    const o = think(createWorldTactics(), loot("c1"), { memContainers: [memContainer({ pos: at(900, 640) })] });
    expect(o.status.state).toBe("running");
    expect(o.intents[0]).toMatchObject({ kind: "move", to: at(900, 640) });
  });

  it("walks around a wall by its next waypoint, not by the container's own point", () => {
    const map = arena(true);
    const cfg = cfgFor(map);
    const target = at(1200, 640);
    expect(hasLineOfSight(map, ME, target)).toBe(false);
    const o = think(createWorldTactics(), loot("c1"), { cfg, containers: [chest(target.x, target.y)] });
    expect(o.status.state).toBe("running");
    const to = (o.intents[0] as Extract<Intent, { kind: "move" }>).to;
    expect(to).not.toEqual(target);
    expect(findPath(map, ME, target)).toContainEqual(to);
    expect(segmentClear(map, ME, to, PLAYER_RADIUS)).toBe(true);
  });

  it("sends the container's point straight when it is in sight, or close even behind a corner", () => {
    const map = arena(true);
    const cfg = cfgFor(map);
    const open = at(700, 640);
    const o = think(createWorldTactics(), loot("c1"), { cfg, containers: [chest(open.x, open.y)] });
    expect(o.intents[0]).toMatchObject({ kind: "move", to: open });
    // Behind the wall but within 150 u: the server paths it.
    const me = at(24 * TILE - 40, 640);
    const behind = at(25 * TILE + 40, 640);
    expect(hasLineOfSight(map, me, behind)).toBe(false);
    const close = think(createWorldTactics(), loot("c1"), {
      cfg, me, containers: [chest(behind.x, behind.y, { dist: d(me, behind) })],
    });
    expect(close.intents[0]).toMatchObject({ kind: "move", to: behind });
  });

  it("fails when the container cannot be reached at all", () => {
    const map = arena(true);
    // Seal the gaps: the far side is a separate room.
    const w = map.w;
    const tiles = map.tiles.slice();
    for (let y = 0; y < w; y++) tiles[y * w + 24] = 1;
    const sealed = mapFromTiles(w, w, tiles);
    const o = think(createWorldTactics(), loot("c1"), { cfg: cfgFor(sealed), containers: [chest(1200, 640)] });
    expect(o.status.state).toBe("failed");
  });

  it("emits only move, stop and pickup, never attacks, and is never attacking", () => {
    const t = createWorldTactics();
    const g = loot("c1");
    const seen = new Set<string>();
    const outs = [
      think(t, g, { containers: [chest(ME.x + 300, ME.y)] }),
      think(t, g, beside({ now: NOW + 100, still: 0 })),
      think(t, g, beside({ now: NOW + 400, still: 400 })),
    ];
    for (const o of outs) {
      expect(o.attacking).toBe(false);
      for (const i of o.intents) seen.add(i.kind);
    }
    expect([...seen].sort()).toEqual(["move", "pickup", "stop"]);
  });
});

// ------------------------------------------------------------------------------------------------------------------ roam

describe("world tactics: roam", () => {
  it("moves toward the point every think, with the same destination", () => {
    const t = createWorldTactics();
    const to = at(900, 700);
    const a = think(t, roam(to));
    const b = think(t, roam(to), { now: NOW + 200, me: at(ME.x + 30, ME.y) });
    for (const o of [a, b]) {
      expect(o.status.state).toBe("running");
      expect(o.intents).toHaveLength(1);
      expect(o.intents[0]).toMatchObject({ kind: "move", to });
      expect(o.attacking).toBe(false);
    }
  });

  it("is done within 48 u, and not before", () => {
    const t = createWorldTactics();
    const to = at(900, 700);
    expect(think(t, roam(to), { me: at(to.x - 47, to.y) })).toMatchObject({ status: { state: "done" }, intents: [] });
    expect(think(t, roam(to), { me: at(to.x - 60, to.y) }).status.state).toBe("running");
  });

  it("is done when the bot has stood still close to the point (the hand landed short)", () => {
    const t = createWorldTactics();
    const to = at(900, 700);
    expect(think(t, roam(to), { me: at(to.x - 90, to.y), still: 1500 }).status.state).toBe("done");
    expect(think(t, roam(to), { me: at(to.x - 90, to.y), still: 300 }).status.state).toBe("running");
    expect(think(t, roam(to), { me: at(to.x - 400, to.y), still: 5000 }).status.state).toBe("running");
  });

  it("fails when there is no walk to the point", () => {
    const map = arena();
    const none: PathService = { ...services(map).paths, walk: () => null };
    const cfg = cfgFor(map, "hunter", { services: { paths: none, log: () => {} } });
    const o = think(createWorldTactics(), roam(at(900, 700)), { cfg });
    expect(o.status.state).toBe("failed");
    expect(o.intents).toEqual([]);
  });

  it("fails for a point sealed off from the bot", () => {
    const w = 48;
    const tiles = arena(true).tiles.slice();
    for (let y = 0; y < w; y++) tiles[y * w + 24] = 1;
    const o = think(createWorldTactics(), roam(at(1200, 640)), { cfg: cfgFor(mapFromTiles(w, w, tiles)) });
    expect(o.status.state).toBe("failed");
  });
});

// ------------------------------------------------------------------------------------------------------------------ hold

describe("world tactics: hold", () => {
  const map = testMap();
  const centre = map.coliseum.centre;
  const ring = (deg: number): Vec2 => ({
    x: centre.x + Math.cos((deg * Math.PI) / 180) * COLISEUM_RING_RADIUS,
    y: centre.y + Math.sin((deg * Math.PI) / 180) * COLISEUM_RING_RADIUS,
  });
  const cfg = (persona: PersonaId) => brainConfig("normal", persona);

  it("walks to the coliseum point, and halts there once", () => {
    const t = createWorldTactics();
    const goal = hold(centre);
    const far = at(map.spawns[0]!.x, map.spawns[0]!.y);
    const walk = think(t, goal, { cfg: cfg("hunter"), me: far });
    expect(walk.status.state).toBe("running");
    expect(walk.intents[0]).toMatchObject({ kind: "move", to: centre });

    const arrive = think(t, goal, { cfg: cfg("hunter"), me: at(centre.x + 10, centre.y), now: NOW + 2000, still: 0 });
    expect(kinds(arrive)).toEqual(["stop"]);
    expect(arrive.status.state).toBe("running");
    // Standing there: nothing more to say.
    expect(think(t, goal, { cfg: cfg("hunter"), me: at(centre.x + 10, centre.y), now: NOW + 2200, still: 200 }).intents).toEqual([]);
    expect(think(t, goal, { cfg: cfg("hunter"), me: at(centre.x + 10, centre.y), now: NOW + 4000, still: 2000 }).intents).toEqual([]);
  });

  it("halts where the hand landed short of the point once it has stood still", () => {
    const t = createWorldTactics();
    const o = think(t, hold(centre), { cfg: cfg("hunter"), me: at(centre.x + 80, centre.y), still: 1000 });
    expect(kinds(o)).toEqual(["stop"]);
  });

  it("repeats the halt only if the bot keeps moving long after it", () => {
    const t = createWorldTactics();
    const goal = hold(centre);
    const here = at(centre.x + 5, centre.y);
    expect(kinds(think(t, goal, { cfg: cfg("hunter"), me: here, still: 0 }))).toEqual(["stop"]);
    expect(think(t, goal, { cfg: cfg("hunter"), me: here, now: NOW + 300, still: 0 }).intents).toEqual([]);
    expect(kinds(think(t, goal, { cfg: cfg("hunter"), me: here, now: NOW + 1000, still: 0 }))).toEqual(["stop"]);
  });

  it("a timid bot picks a ring spot once when the coliseum point is crowded, and keeps it", () => {
    const t = createWorldTactics();
    const goal = hold(centre);
    const far = at(map.spawns[0]!.x, map.spawns[0]!.y);
    const crowd = [foe(centre.x + 60, centre.y), foe(centre.x - 50, centre.y + 40, { id: "foe2" })];
    const first = think(t, goal, { cfg: cfg("cautious"), me: far, fighters: crowd });
    const spot = (first.intents[0] as Extract<Intent, { kind: "move" }>).to;
    expect(first.intents[0]!.kind).toBe("move");
    expect(d(spot, centre)).toBeCloseTo(COLISEUM_RING_RADIUS, 3);
    expect(circleClear(map, spot, PLAYER_RADIUS)).toBe(true);
    // The crowd leaves or moves: the choice stays.
    const again = think(t, goal, { cfg: cfg("cautious"), me: far, now: NOW + 200, fighters: [] });
    expect(again.intents[0]).toMatchObject({ kind: "move", to: spot });
    // It stops at that spot, not at the middle.
    const arrive = think(t, goal, { cfg: cfg("cautious"), me: spot, now: NOW + 2000, still: 0 });
    expect(kinds(arrive)).toEqual(["stop"]);
  });

  it("walks to the point whatever the crowd for a bot that opens fights, and when it is not crowded", () => {
    const far = at(map.spawns[0]!.x, map.spawns[0]!.y);
    const crowd = [foe(centre.x + 60, centre.y)];
    const bold = think(createWorldTactics(), hold(centre), { cfg: cfg("hunter"), me: far, fighters: crowd });
    expect(bold.intents[0]).toMatchObject({ kind: "move", to: centre });
    const calm = think(createWorldTactics(), hold(centre), { cfg: cfg("cautious"), me: far, fighters: [foe(centre.x + 400, centre.y)] });
    expect(calm.intents[0]).toMatchObject({ kind: "move", to: centre });
  });

  it("an ambush or a wait stands still: one halt, no walking", () => {
    for (const why of ["ambush", "wait"] as const) {
      const t = createWorldTactics();
      const goal = hold(at(1500, 1500), why);
      const first = think(t, goal, { cfg: cfg("hunter"), still: 0 });
      expect(kinds(first)).toEqual(["stop"]);
      expect(first.status.state).toBe("running");
      expect(think(t, goal, { cfg: cfg("hunter"), now: NOW + 300, still: 300 }).intents).toEqual([]);
    }
  });

  it("fails when the coliseum point cannot be reached", () => {
    const m = arena();
    const none: PathService = { ...services(m).paths, walk: () => null };
    const o = think(createWorldTactics(), hold(at(900, 700)), {
      cfg: cfgFor(m, "hunter", { services: { paths: none, log: () => {} } }),
    });
    expect(o.status.state).toBe("failed");
  });

  describe("pickHoldSpot", () => {
    function best(others: Vec2[]): number {
      let top = 0;
      for (let deg = 0; deg < 360; deg++) {
        const p = ring(deg);
        if (!circleClear(map, p, PLAYER_RADIUS)) continue;
        top = Math.max(top, Math.min(...others.map((o) => d(o, p))));
      }
      return top;
    }

    it("lands on the ring, on walkable floor", () => {
      for (let seed = 1; seed <= 20; seed++) {
        const c = ctx({ p: percept({ fighters: [] }), rng: rngs(seed) });
        const spot = pickHoldSpot(c, centre, COLISEUM_RING_RADIUS);
        expect(d(spot, centre)).toBeCloseTo(COLISEUM_RING_RADIUS, 3);
        expect(circleClear(c.svc.paths.collisionMap(), spot, PLAYER_RADIUS)).toBe(true);
      }
    });

    it("is far from the fighters in sight", () => {
      const others = [ring(0), ring(60), ring(120)];
      const fighters = others.map((p, i) => foe(p.x, p.y, { id: `f${i}` }));
      for (let seed = 1; seed <= 10; seed++) {
        const c = ctx({ p: percept({ fighters }), rng: rngs(seed) });
        const spot = pickHoldSpot(c, centre, COLISEUM_RING_RADIUS);
        const nearest = Math.min(...others.map((o) => d(o, spot)));
        expect(nearest).toBeGreaterThan(best(others) - 70);
        expect(nearest).toBeGreaterThan(150);
      }
    });

    it("ignores the dead", () => {
      const live = foe(ring(0).x, ring(0).y);
      const corpse = foe(ring(180).x, ring(180).y, { id: "corpse", status: "dead" });
      const c = ctx({ p: percept({ fighters: [live, corpse] }), rng: rngs(3) });
      const spot = pickHoldSpot(c, centre, COLISEUM_RING_RADIUS);
      expect(d(spot, ring(0))).toBeGreaterThan(200);
    });

    it("is the same for the same seed and varies with it", () => {
      const fighters = [foe(ring(0).x, ring(0).y)];
      const run = (seed: number) => pickHoldSpot(ctx({ p: percept({ fighters }), rng: rngs(seed) }), centre, COLISEUM_RING_RADIUS);
      expect(run(5)).toEqual(run(5));
      const spots = new Set<string>();
      for (let seed = 1; seed <= 30; seed++) spots.add(JSON.stringify(run(seed)));
      expect(spots.size).toBeGreaterThan(1);
    });
  });
});

// ------------------------------------------------------------------------------------------------------------------ idle

describe("world tactics: idle", () => {
  it("halts once and then says nothing", () => {
    const t = createWorldTactics();
    const g: WorldGoal = { kind: "idle" };
    const first = think(t, g, { still: 0 });
    expect(kinds(first)).toEqual(["stop"]);
    expect(first.status.state).toBe("running");
    expect(first.attacking).toBe(false);
    expect(think(t, g, { now: NOW + 200, still: 0 }).intents).toEqual([]);
    expect(think(t, g, { now: NOW + 600, still: 400 }).intents).toEqual([]);
  });

  it("halts again if the bot is still moving a good while after the first halt", () => {
    const t = createWorldTactics();
    const g: WorldGoal = { kind: "idle" };
    think(t, g, { still: 0 });
    expect(kinds(think(t, g, { now: NOW + 1000, still: 0 }))).toEqual(["stop"]);
  });

  it("halts again when it comes back after other goals", () => {
    const t = createWorldTactics();
    const g: WorldGoal = { kind: "idle" };
    think(t, g, { still: 500 });
    expect(kinds(think(t, g, { now: NOW + 30_000, still: 500 }))).toEqual(["stop"]);
  });
});

// ------------------------------------------------------------------------------------------------------------ determinism

describe("world tactics: determinism", () => {
  it("answers the same inputs with the same outputs from the same seed", () => {
    const map = testMap();
    const centre = map.coliseum.centre;
    const run = () => {
      const t = createWorldTactics();
      const cfg = brainConfig("normal", "cautious");
      const out: TacticsOutput[] = [];
      const me = at(map.spawns[0]!.x, map.spawns[0]!.y);
      const crowd = [foe(centre.x + 60, centre.y)];
      out.push(think(t, hold(centre), { cfg, me, fighters: crowd, seed: 9 }));
      out.push(think(t, hold(centre), { cfg, me, fighters: crowd, now: NOW + 200, seed: 9 }));
      out.push(think(t, roam(at(900, 700)), { cfg, me, now: NOW + 400, seed: 9 }));
      out.push(think(t, { kind: "idle" }, { cfg, me, now: NOW + 600, seed: 9 }));
      return JSON.stringify(out);
    };
    expect(run()).toBe(run());
  });

  it("does not mutate the percept or the memory it is handed", () => {
    const t = createWorldTactics();
    const c = at(ME.x + 30, ME.y);
    const cx = ctx({
      cfg: cfgFor(arena()),
      p: percept({ self: selfView({ x: ME.x, y: ME.y }), containers: [chest(c.x, c.y, { interactable: true })] }),
    });
    const before = JSON.stringify([cx.p, [...cx.mem.containers]]);
    t.act(cx, loot("c1"));
    expect(JSON.stringify([cx.p, [...cx.mem.containers]])).toBe(before);
  });
});
