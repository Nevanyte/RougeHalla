import { describe, expect, it } from "vitest";
import {
  mapFromTiles, mulberry32, REGION_COLISEUM, TARGET_RANGE, TICK_MS, TILE, TILE_FLOOR, TILE_WALL, VISION_RADIUS, VISION_TRAIL_MS,
  type CampDef, type FactionId, type GameMap, type Vec2,
} from "@raid/shared";
import { combatant } from "../src/sim/combatant";
import { createGameWorld } from "../src/sim/gameplay";
import { enqueueClientMessage } from "../src/sim/inputs";
import { addPlayer, step } from "../src/sim/step";
import { validUnitTarget } from "../src/sim/abilities";
import { canPlayerSee, getVisionMemory } from "../src/sim/vision";
import type { World } from "../src/sim/world";
import { CampState } from "@raid/shared/schema";

const W = 80;
const H = 60;
const at = (x: number, y: number): Vec2 => ({ x: x * TILE + TILE / 2, y: y * TILE + TILE / 2 });
const LEFT: Vec2 = { x: 18 * TILE + 16, y: 3 * TILE + 16 };
const RIGHT: Vec2 = { x: 23 * TILE + 16, y: 3 * TILE + 16 };

function arenaMap(withWard = false): GameMap {
  const tiles = new Uint8Array(W * H).fill(TILE_FLOOR);
  for (let x = 0; x < W; x++) { tiles[x] = TILE_WALL; tiles[(H - 1) * W + x] = TILE_WALL; }
  for (let y = 0; y < H; y++) { tiles[y * W] = TILE_WALL; tiles[y * W + W - 1] = TILE_WALL; }
  for (let y = 1; y <= 16; y++) tiles[y * W + 20] = TILE_WALL;
  const spawns = Array.from({ length: 8 }, (_, i) => at(3 + i * 4, 18));
  const camps: CampDef[] = withWard ? [{
    id: "ward-test", zone: "fire", x: RIGHT.x, y: RIGHT.y, r: 96,
    spots: [at(22, 2), at(24, 2), at(23, 4)], eliteSpot: -1,
    chest: at(23, 5), area: 0, radius: 288,
  }] : [];
  return { ...mapFromTiles(W, H, tiles, 71), spawns, camps };
}

function world(options: { ward?: boolean; training?: boolean } = {}): World {
  const w = createGameWorld({
    seed: 71,
    config: {
      minPlayers: 3, lobbySeconds: 15, fillSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600,
      suddenDeathSeconds: 3600, mobs: false, training: options.training,
    },
    random: mulberry32(72), map: arenaMap(options.ward),
  }, { signatures: false });
  (["plague", "frost", "holy"] as FactionId[]).forEach((faction, i) => {
    const player = addPlayer(w, `p${i}`, `player${i}`, { faction });
    player.weapon0 = "wand";
  });
  step(w, TICK_MS);
  expect(w.state.phase).toBe("active");
  place(w, 0, LEFT);
  place(w, 1, RIGHT);
  place(w, 2, RIGHT);
  // Drop spawn-time discoveries so each test begins with only its explicitly seeded trail or ward.
  for (const id of ["p0", "p1", "p2"]) getVisionMemory(w, id)?.clear();
  return w;
}

function place(w: World, i: number, point: Vec2): void {
  const p = w.state.players.get(`p${i}`)!;
  p.x = point.x;
  p.y = point.y;
  const runtime = w.players.get(`p${i}`)!;
  runtime.path = [];
  runtime.history = [{ t: w.state.serverTime, x: point.x, y: point.y }];
}

function seedTrail(w: World, point: Vec2, ttl = VISION_TRAIL_MS): void {
  const memory = getVisionMemory(w, "p0")!;
  memory.clear(); // force this update past the normal 100 ms refresh throttle
  memory.update(w.map, point, w.state.serverTime, ttl, VISION_RADIUS);
}

function target(w: World, id = "p1"): void {
  expect(enqueueClientMessage(w.players.get("p0")!.inputs, "target", { id })).toBe(true);
}

describe("server visibility for target validation", () => {
  it("reveals the whole large coliseum across walls but not the outer world", () => {
    const w = world();
    w.map.coliseum.rect = { x: 10, y: 10, w: 50, h: 35 };
    for (let y = 10; y < 45; y++) {
      for (let x = 10; x < 60; x++) w.map.regionGrid[y * w.map.w + x] = REGION_COLISEUM;
      w.map.tiles[y * w.map.w + 32] = TILE_WALL;
    }
    place(w, 0, at(20, 25));
    place(w, 1, at(50, 25));
    place(w, 2, at(65, 25));
    for (const id of ["p0", "p1", "p2"]) getVisionMemory(w, id)?.clear();
    expect(canPlayerSee(w, "p0", at(50, 25))).toBe(true); // 960 units, across the arena wall
    expect(canPlayerSee(w, "p0", at(65, 25))).toBe(false);
    place(w, 0, at(2, 25));
    getVisionMemory(w, "p0")?.clear();
    expect(canPlayerSee(w, "p0", at(50, 25))).toBe(false);
  });

  it("refuses an unseen player through a wall, while a fresh private trail admits the lock without permitting a wall hit", () => {
    const w = world();
    const self = combatant(w, "p0")!;
    const foe = combatant(w, "p1")!;
    expect(Math.hypot(foe.s.x - self.s.x, foe.s.y - self.s.y)).toBeLessThan(TARGET_RANGE);
    expect(canPlayerSee(w, "p0", foe.s)).toBe(false);
    expect(validUnitTarget(w, self, foe, TARGET_RANGE, false)).toBe(false);
    target(w);
    step(w, TICK_MS);
    expect(w.players.get("p0")!.weapon.lock).toBeNull();

    seedTrail(w, RIGHT);
    expect(canPlayerSee(w, "p0", foe.s)).toBe(true);
    expect(validUnitTarget(w, self, foe, TARGET_RANGE, false)).toBe(true);
    expect(validUnitTarget(w, self, foe, TARGET_RANGE, true)).toBe(false);
    target(w);
    step(w, TICK_MS);
    expect(w.players.get("p0")!.weapon.lock).toBe("p1");
    expect(w.players.get("p0")!.weapon.lockSeen).toBe(false);
    expect(w.players.get("p0")!.weapon.action).toBeNull();
    expect(foe.s.hp).toBe(foe.s.maxHp); // private trail permits pursuit, but the wall still prevents damage
  });

  it("drops a lock at the exclusive expiry of the target's trail", () => {
    const w = world();
    seedTrail(w, RIGHT, 2 * TICK_MS);
    target(w);
    step(w, TICK_MS);
    expect(w.players.get("p0")!.weapon.lock).toBe("p1");
    expect(canPlayerSee(w, "p0", combatant(w, "p1")!.s)).toBe(true);
    step(w, TICK_MS);
    expect(canPlayerSee(w, "p0", combatant(w, "p1")!.s)).toBe(false);
    expect(w.players.get("p0")!.weapon.lock).toBeNull();
    expect(w.state.players.get("p0")!.attackTarget).toBe("");
  });

  it("shares a camp ward with its owner alone", () => {
    const w = world({ ward: true });
    place(w, 1, at(18, 5));
    getVisionMemory(w, "p1")?.clear();
    const camp = new CampState();
    w.state.camps.push(camp);
    camp.wardOwner = "p0";
    camp.wardExpiresAt = w.state.serverTime + 10_000;
    const point = at(24, 3);
    expect(canPlayerSee(w, "p0", point)).toBe(true);
    expect(canPlayerSee(w, "p1", point)).toBe(false);
  });

  it("bypasses vision gating in training", () => {
    const w = world({ training: true });
    const self = combatant(w, "p0")!;
    const foe = combatant(w, "p1")!;
    expect(canPlayerSee(w, "p0", foe.s)).toBe(true);
    expect(validUnitTarget(w, self, foe, TARGET_RANGE, false)).toBe(true);
  });
});
