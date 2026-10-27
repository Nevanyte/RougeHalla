// Reach is not sight (R2's low ground: lava, fences, crevasses). Low ground stops a body, a swing and a hand; it does not stop a
// look or a shot. The bot must read each with the server's own mask: a melee bot across a fence is not attacking (the server's lock
// walks it round), a weapon on the far side of one is not interactable (the server answers "Can't reach that"), and a straight
// walk for the body is clear only under the move mask. Also the span a walk is scored against, which is the map's own width.
import { describe, expect, it } from "vitest";
import {
  generateMap, hasLineOfSight, INTERACT_RANGE, lockSpacing, mapFromTiles, MASK_MOVE, TILE, TILE_LOW, TILE_WALL, tileToWorldCenter,
  type GameMap, type Vec2, type WeaponId,
} from "@raid/shared";
import { createPathBudget, createPathService } from "../../src/bots/brain/services";
import { createStrategy } from "../../src/bots/brain/strategy";
import { createTactics } from "../../src/bots/brain/tactics";
import { inReach } from "../../src/bots/brain/tactics/fight";
import { createFrameRing } from "../../src/bots/brain/frames";
import { perceive } from "../../src/bots/brain/perception";
import type { BrainConfig, BrainServices, ComposeConfig, Goal, PathService, Percept } from "../../src/bots/brain/types";
import { IN_PROCESS, plainContainer, plainPlayer, plainState, scenarioInputs, type Scenario } from "./fairnessKit";
import { brainConfig, ctx as makeCtx, emptyMemory, features, fighter, hudView, percept, rngs, selfView } from "./fixtures";

// ------------------------------------------------------------------------------------------------------------------ helpers

const W = 64;
const H = 48;
const ME: Vec2 = { x: 1000, y: 760 }; // tile (31, 23)

/** A walled box with a column of `code` at tile x = 32, rows 1..`to` (rows below are the gap), so the foe at tile 33 is across it. */
function column(code: number, to = H - 2): GameMap {
  const tiles = new Uint8Array(W * H);
  for (let i = 0; i < W; i++) { tiles[i] = TILE_WALL; tiles[(H - 1) * W + i] = TILE_WALL; }
  for (let j = 0; j < H; j++) { tiles[j * W] = TILE_WALL; tiles[j * W + W - 1] = TILE_WALL; }
  for (let y = 1; y <= to; y++) tiles[y * W + 32] = code;
  return mapFromTiles(W, H, tiles);
}

const FENCE = column(TILE_LOW);
const WALL = column(TILE_WALL);
const OPEN = column(0);

// ------------------------------------------------------------------------------------------------- the path service's masks

describe("the path service: sight for what is seen, the move mask for where a body can walk", () => {
  const a: Vec2 = { x: 1000, y: 760 };
  const b: Vec2 = { x: 1064, y: 760 };

  it("sees and shoots across low ground, but a straight walk (a retreat point, a waypoint, a step) is not clear across it", () => {
    const paths = createPathService(FENCE, createPathBudget());
    expect(paths.los(a, b)).toBe(true);
    expect(paths.clear(a, b)).toBe(false);
    expect(hasLineOfSight(FENCE, a, b, MASK_MOVE)).toBe(false);
  });

  it("neither sees nor walks through a wall, and both are free in the open", () => {
    const walled = createPathService(WALL, createPathBudget());
    expect([walled.los(a, b), walled.clear(a, b)]).toEqual([false, false]);
    const open = createPathService(OPEN, createPathBudget());
    expect([open.los(a, b), open.clear(a, b)]).toEqual([true, true]);
  });

  it("walks round low ground by path: further than the straight line, and the same under the locked gates", () => {
    // The column stops at row 40: there is a gap below it.
    const gap = column(TILE_LOW, 40);
    const paths = createPathService(gap, createPathBudget());
    const walk = paths.walk(a, b);
    expect(walk?.exact).toBe(true);
    expect(walk!.dist).toBeGreaterThan(8 * TILE);
    expect(paths.path(a, b)).not.toBeNull();
  });
});

// ------------------------------------------------------------------------------------------------------- attacking is reach

describe("attacking is the weapon's reach, as the server's lock decides it", () => {
  function think(map: GameMap, weapon: WeaponId, foeDx: number, locked = true): boolean {
    const cfg = brainConfig("hard", "cautious", { map, services: { paths: createPathService(map, createPathBudget()), log: () => {} } });
    const foePos = { x: ME.x + foeDx, y: ME.y };
    const p = percept({
      now: 100_000,
      self: selfView({ id: "me", x: ME.x, y: ME.y, faction: "fire", weapons: [weapon, null], attackTarget: locked ? "foe" : null }),
      hud: hudView(),
      fighters: [fighter({
        id: "foe", x: foePos.x, y: foePos.y, dist: Math.abs(foeDx), los: hasLineOfSight(map, ME, foePos), inHand: "sword", faction: "frost",
      })],
    });
    const c = makeCtx({ cfg, p, mem: emptyMemory(), rng: rngs(1) });
    const goal: Goal = { kind: "hunt", target: "foe" };
    return createTactics().act(c, goal).attacking;
  }

  it.each(["sword", "axe", "shield"] as const)("a %s bot across a fence is not attacking: a swing does not cross low ground", (weapon) => {
    const dx = 64;
    expect(dx, "in range, so only the fence is in the way").toBeLessThanOrEqual(lockSpacing(weapon).attackRange + 24);
    expect(think(OPEN, weapon, dx), "the control: the same fight in the open").toBe(true);
    expect(think(FENCE, weapon, dx)).toBe(false);
    expect(think(WALL, weapon, dx), "a wall stops a swing too").toBe(false);
  });

  it.each(["bow", "wand"] as const)("a %s bot across a fence is attacking: a shot flies over low ground (but not through a wall)", (weapon) => {
    const dx = 64;
    expect(think(OPEN, weapon, dx)).toBe(true);
    expect(think(FENCE, weapon, dx)).toBe(true);
    expect(think(WALL, weapon, dx)).toBe(false);
  });

  it("is still attacking only while locked and in range", () => {
    expect(think(OPEN, "sword", 64, false), "not locked").toBe(false);
    expect(think(OPEN, "sword", lockSpacing("sword").attackRange + 60), "out of range").toBe(false);
  });

  it("inReach is sight for a ranged weapon and the melee mask for the rest, and false when the foe is not in sight at all", () => {
    const c = (map: GameMap) => makeCtx({
      cfg: brainConfig("hard", "cautious", { map, services: { paths: createPathService(map, createPathBudget()), log: () => {} } }),
      p: percept({ self: selfView({ x: ME.x, y: ME.y }) }),
    });
    const foe = { x: ME.x + 64, y: ME.y, los: true };
    expect([inReach(c(FENCE), foe, "sword"), inReach(c(FENCE), foe, "bow")]).toEqual([false, true]);
    expect(inReach(c(OPEN), foe, "sword")).toBe(true);
    expect(inReach(c(OPEN), { ...foe, los: false }, "bow")).toBe(false);
  });
});

// -------------------------------------------------------------------------------------------- a weapon across low ground

/** n frames of a state with the bot at `self` and one chest holding a bow at `chest`, through the real perception pipeline. */
function seeChest(map: GameMap, self: Vec2, chest: Vec2): Percept {
  const frames = Array.from({ length: 8 }, (_, k) => {
    const state = plainState({ serverTime: 100_000 + k * 50 });
    state.players.set("me", plainPlayer({ name: "Me", ...self, faction: "fire", weapon0: "axe" }));
    state.containers.set("c", plainContainer({ id: "c", kind: "chest", ...chest, items: [{ uid: "1", def: "bow" }] }));
    state.roster = ["me"];
    return { state, events: [], launches: [], toasts: [] };
  });
  const f = features();
  const s: Scenario = {
    seed: 0, map, selfId: "me", features: f, frames,
    roles: { onscreenPlayers: [], onscreenMobs: [], farPlayers: [], farMobs: [], ringPlayers: [], ringMobs: [], hidden: [], farContainers: [], shutChests: [], announced: [] },
  };
  const ring = createFrameRing();
  const cfg: ComposeConfig = { selfDelayMs: IN_PROCESS.selfDelayMs, worldDelayMs: IN_PROCESS.worldDelayMs, map, features: f, attentionCentral: 0.65 };
  let out: Percept | null = null;
  scenarioInputs(s).forEach((input) => {
    ring.push(perceive(input, { selfId: "me", map, features: f, lastMinimap: null }));
    out = ring.compose(cfg) ?? out;
  });
  return out!;
}

/** The first horizontal run floor, one LOW tile, floor in the map, as a pair of points at the near edges of the two floor tiles. */
function fencePair(map: GameMap): { self: Vec2; chest: Vec2 } | null {
  for (let ty = 2; ty < map.h - 2; ty++) {
    for (let tx = 2; tx < map.w - 3; tx++) {
      const row = (x: number): number => map.tiles[ty * map.w + x]!;
      if (row(tx) === 0 && row(tx + 1) === TILE_LOW && row(tx + 2) === 0 && row(tx - 1) === 0 && row(tx + 3) === 0) {
        return { self: { x: tileToWorldCenter(tx) + 12, y: tileToWorldCenter(ty) }, chest: { x: tileToWorldCenter(tx + 2) - 12, y: tileToWorldCenter(ty) } };
      }
    }
  }
  return null;
}

describe("a weapon across low ground is not interactable", () => {
  it("on a hand-built map: the same two points are interactable in the open and not across a fence", () => {
    const self = { x: 31 * TILE + 30, y: 23 * TILE + 16 };
    const chest = { x: 33 * TILE + 2, y: 23 * TILE + 16 };
    expect(Math.hypot(self.x - chest.x, self.y - chest.y)).toBeLessThanOrEqual(INTERACT_RANGE);
    expect(hasLineOfSight(FENCE, self, chest), "sight alone says yes").toBe(true);
    const open = seeChest(OPEN, self, chest).containers.find((c) => c.id === "c")!;
    expect(open).toMatchObject({ interactable: true, weapon: "bow" });
    const across = seeChest(FENCE, self, chest).containers.find((c) => c.id === "c")!;
    expect(across).toMatchObject({ interactable: false, closed: true });
    expect(across.weapon).toBeUndefined();
    const walled = seeChest(WALL, self, chest).containers.find((c) => c.id === "c")!;
    expect(walled.interactable).toBe(false);
  });

  it("on a generated map: a fence or stream of one tile between two floor tiles keeps a chest out of reach too", () => {
    // Any of the first seeds' maps that has a one-tile-wide low strip with floor all round it will do.
    let tried = 0;
    for (let seed = 1; seed <= 40 && tried === 0; seed++) {
      const map = generateMap(seed);
      const pair = fencePair(map);
      if (!pair) continue;
      tried++;
      expect(Math.hypot(pair.self.x - pair.chest.x, pair.self.y - pair.chest.y)).toBeLessThanOrEqual(INTERACT_RANGE);
      expect(hasLineOfSight(map, pair.self, pair.chest), `seed ${seed}: sight crosses the strip`).toBe(true);
      const c = seeChest(map, pair.self, pair.chest).containers.find((x) => x.id === "c");
      expect(c, `seed ${seed}`).toBeDefined();
      expect(c!.interactable, `seed ${seed}: the server refuses a pickup across it`).toBe(false);
    }
    expect(tried, "no generated map in seeds 1..40 has such a strip").toBe(1);
  });
});

// ----------------------------------------------------------------------------------------------------------------- map span

describe("the span a walk is scored against is the map's own width", () => {
  /** The roam-to-a-camp candidate of the nearest camp, for an open-field service whose every walk is `distance` u. */
  function campUtility(map: GameMap, distance: number): number {
    const flat: PathService = {
      walk: () => ({ dist: distance, exact: true }), path: (_a, b) => [b], los: () => true, clear: () => true, collisionMap: () => map,
    };
    const services: BrainServices = { paths: flat, log: () => {} };
    const cfg: BrainConfig = brainConfig("hard", "farmer", { map, services });
    const strategy = createStrategy();
    const here = selfView({ faction: "fire", weapons: ["sword", null] });
    strategy.decide(makeCtx({ cfg, p: percept({ self: here, hud: hudView() }), rng: rngs(1) }), { kind: "idle" }, { state: "running", why: "" });
    const camps = strategy.state.candidates.filter((c) => c.goal.kind === "roam" && (c.goal.why === "explore" || c.goal.why === "camp") && c.choice !== undefined);
    expect(camps.length).toBeGreaterThan(0);
    return camps[0]!.utility;
  }

  it("a 136-tile map scores a walk by 4352 u, not by the 2000 u of the old 64-tile one", () => {
    const map = generateMap(7);
    expect(map.w).toBe(136);
    const span = map.w * TILE;
    // value falls linearly with the walk up to the span: the drop from 0 to 1000 u over the drop from 0 to the span is 1000 / span.
    const u0 = campUtility(map, 0);
    const u1000 = campUtility(map, 1000);
    const uSpan = campUtility(map, span);
    expect(uSpan).toBeLessThan(u0);
    expect((u0 - u1000) / (u0 - uSpan)).toBeCloseTo(1000 / span, 6);
    // And a walk longer than the span costs no more than the span does.
    expect(campUtility(map, 2 * span)).toBeCloseTo(uSpan, 9);
  });
});
