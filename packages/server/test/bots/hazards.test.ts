// The hazards module (brain/modules/hazards.ts, docs/BOTS.md 8): how a bot treats the R2 zone terrain it stands and walks on.
// Pure and synthetic: a hand-built walled box whose terrain layer is painted by the test, plain-data contexts from fixtures.ts, no
// clock. The sim's own effects are tested in test/terrainEffects.test.ts; here only what the bot decides.
import { describe, expect, it } from "vitest";
import {
  mapFromTiles, surfaceAt, terrainAt, TERRAIN_BOG, TERRAIN_EMBER, TERRAIN_ICE, TERRAIN_LIGHT, TILE, tileToWorldCenter, worldToTile,
  type FactionId, type GameMap, type Vec2,
} from "@raid/shared";
import { createBrain } from "../../src/bots/brain/brain";
import { enabledModules } from "../../src/bots/brain/modules/index";
import { bad, burns, HAZARD_RULES, hazardsModule } from "../../src/bots/brain/modules/hazards";
import { PRIORITY, type BrainConfig, type BrainContext, type FeatureModule, type Goal, type Intent, type TimedCommand } from "../../src/bots/brain/types";
import { brainConfig, ctx as makeCtx, emptyMemory, features, hudView, percept, selfView, services } from "./fixtures";

// ------------------------------------------------------------------------------------------------------------------ helpers

const NOW = 100_000;
const SIZE = 40;
const IDLE: Goal = { kind: "idle" };
const centre = (tx: number, ty: number): Vec2 => ({ x: tileToWorldCenter(tx), y: tileToWorldCenter(ty) });

/** A walled SIZE x SIZE box with extra wall rectangles and terrain rectangles, each [x0, y0, x1, y1] in tiles (inclusive). */
function terrainMap(paint: ReadonlyArray<readonly [kind: number, x0: number, y0: number, x1: number, y1: number]>, walls: ReadonlyArray<readonly [number, number, number, number]> = []): GameMap {
  const tiles = new Uint8Array(SIZE * SIZE);
  for (let i = 0; i < SIZE; i++) { tiles[i] = 1; tiles[(SIZE - 1) * SIZE + i] = 1; tiles[i * SIZE] = 1; tiles[i * SIZE + SIZE - 1] = 1; }
  for (const [x0, y0, x1, y1] of walls) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) tiles[y * SIZE + x] = 1;
  const terrain = new Uint8Array(SIZE * SIZE);
  for (const [kind, x0, y0, x1, y1] of paint) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) terrain[y * SIZE + x] = kind;
  return mapFromTiles(SIZE, SIZE, tiles, 0, terrain);
}

/** A 5 x 5 field of `kind` at tiles 8..12, the bot's tile (10, 10) in the middle of it. */
const FIELD = 10;
const fieldMap = (kind: number): GameMap => terrainMap([[kind, 8, 8, 12, 12]]);

interface Scene {
  map: GameMap;
  /** One bot's config across several thinks (the module keeps its state per config); a new one by default. */
  cfg?: BrainConfig;
  faction?: FactionId;
  at?: Vec2;
  hp?: number;
  /** Ms the bot has stood still. */
  still?: number;
  attackTarget?: string | null;
  now?: number;
  inColiseum?: boolean;
  engaged?: boolean;
}

function makeContext(s: Scene): BrainContext {
  const now = s.now ?? NOW;
  const cfg = s.cfg ?? brainConfig("normal", "hunter", { map: s.map, features: features({ hazards: true }) });
  const base = emptyMemory();
  const at = s.at ?? centre(FIELD, FIELD);
  return makeCtx({
    cfg,
    p: percept({
      now,
      self: selfView({ x: at.x, y: at.y, faction: s.faction ?? "sentenced", hp: s.hp ?? 100, maxHp: 100, attackTarget: s.attackTarget ?? null }),
      hud: hudView({ phase: "active", inColiseum: s.inColiseum ?? false }),
    }),
    mem: emptyMemory({ self: { ...base.self, stillSince: now - (s.still ?? 1000) } }),
    engaged: s.engaged ?? false,
  });
}

const run = (c: BrainContext, goal: Goal = IDLE): readonly Intent[] => hazardsModule.intents!(c, goal);
const tileKind = (map: GameMap, p: Vec2): number => terrainAt(map, p.x, p.y);
const moveOf = (i: Intent | undefined): Vec2 => {
  expect(i?.kind).toBe("move");
  return (i as Extract<Intent, { kind: "move" }>).to;
};

// ------------------------------------------------------------------------------------------------------------ ground reading

describe("reading the ground the way the sim acts on it", () => {
  it("is enabled by the map's hazards feature only, and is registered", () => {
    expect(hazardsModule.enabled(features({ hazards: true }))).toBe(true);
    expect(hazardsModule.enabled(features({ hazards: false }))).toBe(false);
    expect(enabledModules(features({ hazards: true })).map((m) => m.id)).toContain("hazards");
    expect(enabledModules(features({ hazards: false })).map((m) => m.id)).not.toContain("hazards");
  });

  it("agrees with the shared surface table for every faction on every kind", () => {
    const map = terrainMap([[TERRAIN_EMBER, 2, 2, 2, 2], [TERRAIN_BOG, 3, 2, 3, 2], [TERRAIN_ICE, 4, 2, 4, 2], [TERRAIN_LIGHT, 5, 2, 5, 2]]);
    for (const f of ["fire", "sentenced", "plague", "frost", "holy"] as const) {
      for (let tx = 2; tx <= 5; tx++) {
        const p = centre(tx, 2);
        const e = surfaceAt(map, p.x, p.y, f);
        expect(burns(map, f, p.x, p.y), `${f} burns on ${tx}`).toBe(e.burnShare > 0);
        expect(bad(map, f, p.x, p.y), `${f} is hurt by ${tx}`).toBe(e.burnShare > 0 || e.speedMult < 1 || e.accel > 0);
      }
    }
    // The home rules: Fire is at home on embers, Plague in bog, Frost on ice; light is never bad.
    const [ember, bog, ice, light] = [2, 3, 4, 5].map((tx) => centre(tx, 2));
    expect([burns(map, "fire", ember!.x, ember!.y), burns(map, "holy", ember!.x, ember!.y)]).toEqual([false, true]);
    expect([bad(map, "plague", bog!.x, bog!.y), bad(map, "fire", bog!.x, bog!.y)]).toEqual([false, true]);
    expect([bad(map, "frost", ice!.x, ice!.y), bad(map, "fire", ice!.x, ice!.y)]).toEqual([false, true]);
    expect(["fire", "plague", "frost", "holy"].some((f) => bad(map, f, light!.x, light!.y))).toBe(false);
  });
});

// ----------------------------------------------------------------------------------------------------------- step off embers

describe("stepping off embers", () => {
  const map = fieldMap(TERRAIN_EMBER);

  it("a bot standing still on embers it is not at home on steps to the nearest ground that does not burn, as a step-timed order", () => {
    const out = run(makeContext({ map }));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: "move", priority: PRIORITY.goal, timing: { kind: "step" } });
    const to = moveOf(out[0]);
    const here = centre(FIELD, FIELD);
    expect(tileKind(map, to)).not.toBe(TERRAIN_EMBER);
    expect(Math.hypot(to.x - here.x, to.y - here.y)).toBeLessThanOrEqual((HAZARD_RULES.stepTiles + 1) * TILE);
    // A click's scatter should stay on good ground too: none of the four neighbours is embers either.
    for (const [dx, dy] of [[TILE, 0], [-TILE, 0], [0, TILE], [0, -TILE]]) expect(tileKind(map, { x: to.x + dx!, y: to.y + dy! })).not.toBe(TERRAIN_EMBER);
    // It is the nearest such tile: 4 tiles from the middle of a 5 x 5 field (2 to its edge, 2 more for the clean margin).
    expect(Math.hypot(to.x - here.x, to.y - here.y)).toBeCloseTo(4 * TILE, 5);
  });

  it("does nothing for Fire, which is at home on embers", () => {
    expect(run(makeContext({ map, faction: "fire" }))).toEqual([]);
  });

  it("does nothing off the embers, while walking, while locked on a target, on a loot goal, in the coliseum, or when down", () => {
    expect(run(makeContext({ map, at: centre(20, 20) })), "off the field").toEqual([]);
    expect(run(makeContext({ map, still: 100 })), "moving: it may be crossing the field").toEqual([]);
    expect(run(makeContext({ map, attackTarget: "foe" })), "the server is fighting for it").toEqual([]);
    expect(run(makeContext({ map }), { kind: "loot", container: "c1" }), "a pickup is a second long").toEqual([]);
    expect(run(makeContext({ map, inColiseum: true }))).toEqual([]);
    const down = makeContext({ map });
    expect(run({ ...down, p: { ...down.p, self: { ...down.p.self, status: "dead" } } })).toEqual([]);
  });

  it("keeps offering the same order while it is on its way (one decision, not one per think), until the bot is there", () => {
    const cfg = brainConfig("normal", "hunter", { map, features: features({ hazards: true }) });
    const first = moveOf(run(makeContext({ map, cfg }))[0]);
    // The very same order again for a while (the humanizer dedupes it), whatever the bot has not yet done about it.
    for (const dt of [50, 200, 599, 1400]) expect(moveOf(run(makeContext({ map, cfg, now: NOW + dt }))[0]), `+${dt}`).toEqual(first);
    // Arrived within 20 u: the order is over, and standing there (off the embers) is not a reason for another step.
    expect(run(makeContext({ map, cfg, now: NOW + 700, at: first }))).toEqual([]);
  });

  it("decides a fresh step only once the old one has lapsed, and never within 600 ms of the last decision", () => {
    expect(HAZARD_RULES.holdMs).toBeGreaterThanOrEqual(HAZARD_RULES.stepEveryMs);
    const cfg = brainConfig("normal", "hunter", { map, features: features({ hazards: true }) });
    const first = moveOf(run(makeContext({ map, cfg }))[0]);
    // The order never took (the bot is still on the embers when it lapses): a fresh one, from where the bot stands.
    const again = run(makeContext({ map, cfg, now: NOW + HAZARD_RULES.holdMs + 1 }));
    expect(moveOf(again[0])).toEqual(first);
    // Another bot's state is its own: a second bot decides at once.
    const other = run(makeContext({ map, now: NOW + 10 }));
    expect(other).toHaveLength(1);
  });
});

// ------------------------------------------------------------------------------------------------------------------ redirect

describe("a walk's destination on bad ground", () => {
  const far = (from: Vec2, dx: number): Vec2 => ({ x: from.x + dx, y: from.y });
  const me = centre(30, 30);
  const walk = (to: Vec2, over: Partial<Extract<Intent, { kind: "move" }>> = {}): Intent => ({
    kind: "move", to, priority: PRIORITY.goal, timing: { kind: "step" }, why: "roam", ...over,
  });

  function adjust(map: GameMap, faction: FactionId, intents: readonly Intent[], at: Vec2 = me): readonly Intent[] {
    return hazardsModule.adjust!(makeContext({ map, faction, at }), IDLE, intents);
  }

  it("is moved onto the nearest good ground within 3 tiles when it is embers for the bot", () => {
    const map = terrainMap([[TERRAIN_EMBER, 8, 8, 10, 10]]);
    const to = centre(9, 9);
    const [out] = adjust(map, "sentenced", [walk(to)], centre(30, 9));
    const moved = moveOf(out);
    expect(tileKind(map, moved)).toBe(0);
    expect(Math.hypot(moved.x - to.x, moved.y - to.y)).toBeLessThanOrEqual((HAZARD_RULES.redirectTiles + 1) * TILE);
    expect(out).toMatchObject({ priority: PRIORITY.goal, timing: { kind: "step" } });
    expect(out!.why).toContain("roam");
  });

  it("is left alone for Fire (at home on embers), for good ground, for a short step, and for anything that is not a walk", () => {
    const map = terrainMap([[TERRAIN_EMBER, 8, 8, 10, 10]]);
    const onEmber = walk(centre(9, 9));
    const intents = [onEmber];
    expect(adjust(map, "fire", intents, centre(30, 9))).toBe(intents);
    const plain = [walk(centre(20, 20))];
    expect(adjust(map, "sentenced", plain, centre(30, 9))).toBe(plain);
    // A dodge or a juke lands within a few tiles of the bot: never detoured.
    const dodge = [walk(centre(9, 9), { priority: PRIORITY.reflex })];
    expect(adjust(map, "sentenced", dodge, centre(11, 9))).toBe(dodge);
    const others: Intent[] = [{ kind: "stop", priority: PRIORITY.goal, timing: { kind: "step" }, why: "x" }, { kind: "swap", slot: 1, priority: PRIORITY.combat, timing: { kind: "step" }, why: "x" }];
    expect(adjust(map, "sentenced", others, centre(30, 9))).toBe(others);
  });

  it("treats bog and ice as bad for those who are not at home on them, and leaves light alone", () => {
    const map = terrainMap([[TERRAIN_BOG, 6, 6, 8, 8], [TERRAIN_ICE, 14, 14, 16, 16], [TERRAIN_LIGHT, 22, 6, 24, 8]]);
    const bog = centre(7, 7);
    const ice = centre(15, 15);
    const light = centre(23, 7);
    expect(tileKind(map, moveOf(adjust(map, "fire", [walk(bog)])[0]))).toBe(0);
    expect(tileKind(map, moveOf(adjust(map, "fire", [walk(ice)])[0]))).toBe(0);
    const plague = [walk(bog)];
    expect(adjust(map, "plague", plague)).toBe(plague);
    const frost = [walk(ice)];
    expect(adjust(map, "frost", frost)).toBe(frost);
    const lit = [walk(light)];
    expect(adjust(map, "fire", lit)).toBe(lit);
  });

  it("is left as it was when there is no good ground within 3 tiles, and when the bot has no faction yet", () => {
    const map = terrainMap([[TERRAIN_EMBER, 4, 4, 16, 16]]);
    const intents = [walk(centre(10, 10))];
    expect(adjust(map, "sentenced", intents, centre(30, 30))).toBe(intents);
    const c = makeContext({ map: terrainMap([[TERRAIN_EMBER, 8, 8, 10, 10]]), at: centre(30, 9) });
    const blank = { ...c, p: { ...c.p, self: { ...c.p.self, faction: null } } };
    const single = [walk(centre(9, 9))];
    expect(hazardsModule.adjust!(blank, IDLE, single)).toBe(single);
  });

  it("never picks a tile a body cannot stand on (a wall) for the new destination", () => {
    // Embers beside a wall: the nearest good tile by distance is in the wall's lee; it must be floor.
    const map = terrainMap([[TERRAIN_EMBER, 8, 8, 10, 10]], [[11, 5, 11, 12]]);
    const [out] = adjust(map, "sentenced", [walk(centre(10, 9))], centre(30, 9));
    const moved = moveOf(out);
    expect(map.tiles[worldToTile(moved.y) * SIZE + worldToTile(moved.x)]).toBe(0);
  });
});

// ------------------------------------------------------------------------------------------------------------------- light

describe("looking for light when hurt", () => {
  const map = terrainMap([[TERRAIN_LIGHT, 15, 10, 16, 11]]);
  const ambush: Goal = { kind: "hold", at: centre(10, 10), why: "ambush" };

  it("a hurt bot lying low walks to light within 8 tiles", () => {
    const out = run(makeContext({ map, hp: 40 }), ambush);
    expect(out).toHaveLength(1);
    const to = moveOf(out[0]);
    expect(tileKind(map, to)).toBe(TERRAIN_LIGHT);
    expect(to).toEqual(centre(15, 10));
    expect(out[0]).toMatchObject({ priority: PRIORITY.goal, timing: { kind: "step" } });
  });

  it("does not for a healthy bot, a bot already in the light, a bot fighting, another goal, or light that is out of reach", () => {
    expect(run(makeContext({ map, hp: 90 }), ambush), "healthy").toEqual([]);
    expect(run(makeContext({ map, hp: 40, at: centre(15, 10) }), { ...ambush, at: centre(15, 10) }), "already there").toEqual([]);
    expect(run(makeContext({ map, hp: 40, engaged: true }), ambush), "in a fight").toEqual([]);
    expect(run(makeContext({ map, hp: 40 }), { kind: "farm", mob: "m", camp: null }), "has something to do").toEqual([]);
    expect(run(makeContext({ map, hp: 40, at: centre(30, 30) }), ambush), "more than 8 tiles").toEqual([]);
    const walled = terrainMap([[TERRAIN_LIGHT, 15, 10, 16, 11]], [[13, 5, 13, 15]]);
    expect(run(makeContext({ map: walled, hp: 40 }), ambush), "no straight walk").toEqual([]);
  });

  it("waits in the light for a 'wait' hold as well, and keeps its order until it arrives", () => {
    const wait: Goal = { kind: "hold", at: centre(10, 10), why: "wait" };
    const cfg = brainConfig("normal", "hunter", { map, features: features({ hazards: true }) });
    const first = moveOf(run(makeContext({ map, cfg, hp: 40 }), wait)[0]);
    expect(moveOf(run(makeContext({ map, cfg, hp: 40, now: NOW + 300 }), wait)[0])).toEqual(first);
    expect(run(makeContext({ map, cfg, hp: 40, now: NOW + 900, at: first }), { kind: "hold", at: first, why: "wait" })).toEqual([]);
  });
});

// ----------------------------------------------------------------------------------------------------------- in a whole brain

describe("in a whole brain", () => {
  /** Ticks a brain on `map` with the bot standing still where `at` says, `frames` percepts 50 ms apart; returns every command. */
  function play(map: GameMap, faction: FactionId, at: Vec2, frames: number, modules: readonly FeatureModule[]): TimedCommand[] {
    const f = features({ hazards: true });
    const cfg = brainConfig("hard", "hunter", { map, features: f, modules });
    const brain = createBrain(cfg);
    const out: TimedCommand[] = [];
    for (let i = 0; i < frames; i++) {
      const now = NOW + i * 50;
      out.push(...brain.tick(percept({ now, self: selfView({ x: at.x, y: at.y, faction, maxHp: 100, hp: 100 }), hud: hudView({ phase: "active" }), features: f })));
    }
    return out;
  }

  // The field is round the map's middle, so the strategy has nowhere to roam to (it is within two arrival radii of the "centre" goal):
  // whatever order the bot sends, the hazards module sent.
  const middle = centre(SIZE / 2, SIZE / 2);
  const middleField = terrainMap([[TERRAIN_EMBER, SIZE / 2 - 2, SIZE / 2 - 2, SIZE / 2 + 2, SIZE / 2 + 2]]);

  it("a bot left standing on embers asks to walk off them within a second or two; an at-home bot, or one without the module, stays put", () => {
    const moves = play(middleField, "sentenced", middle, 80, [hazardsModule]).filter((c) => c.cmd.type === "move");
    expect(moves.length).toBeGreaterThan(0);
    const first = (moves[0]!.cmd as Extract<TimedCommand["cmd"], { type: "move" }>).msg;
    expect(Math.hypot(first.x - middle.x, first.y - middle.y)).toBeGreaterThan(2 * TILE);
    expect(moves[0]!.at - NOW).toBeLessThan(2500);
    expect(play(middleField, "sentenced", middle, 80, []).filter((c) => c.cmd.type === "move")).toEqual([]);
    expect(play(middleField, "fire", middle, 80, [hazardsModule]).filter((c) => c.cmd.type === "move")).toEqual([]);
  });

  it("a module whose adjust throws is logged once and switched off, and the brain goes on", () => {
    const boom: FeatureModule = { id: "boom", enabled: () => true, adjust() { throw new Error("boom"); } };
    const logs: string[] = [];
    const f = features({ hazards: true });
    const map = fieldMap(TERRAIN_EMBER);
    const cfg = brainConfig("hard", "hunter", { map, features: f, modules: [boom], services: { paths: services(map).paths, log: (m) => logs.push(m) } });
    const brain = createBrain(cfg);
    const at = centre(30, 30);
    for (let i = 0; i < 100; i++) brain.tick(percept({ now: NOW + i * 50, self: selfView({ x: at.x, y: at.y }), hud: hudView({ phase: "active" }), features: f }));
    expect(logs.filter((m) => m.includes("module boom: adjust threw (boom)"))).toHaveLength(1);
  });

  it("a module's adjust sees the merged intents of the goal, and what it returns is what the humanizer is given", () => {
    const seen: Intent[][] = [];
    const redirect: FeatureModule = {
      id: "redirect", enabled: () => true,
      adjust(_c, _g, intents) {
        seen.push([...intents]);
        return intents.map((i) => (i.kind === "move" ? { ...i, to: { x: middle.x + 77, y: middle.y }, why: "redirected" } : i));
      },
    };
    const moves = play(terrainMap([]), "sentenced", centre(5, 5), 120, [redirect]).filter((c) => c.cmd.type === "move");
    expect(seen.some((intents) => intents.some((i) => i.kind === "move"))).toBe(true);
    expect(moves.length).toBeGreaterThan(0);
    for (const m of moves) {
      const to = (m.cmd as Extract<TimedCommand["cmd"], { type: "move" }>).msg;
      expect(Math.hypot(to.x - (middle.x + 77), to.y - middle.y)).toBeLessThan(80); // the click's own scatter only
    }
  });
});
