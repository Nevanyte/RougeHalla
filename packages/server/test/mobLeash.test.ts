import { describe, expect, it } from "vitest";
import {
  generateMap, leashOk, mapFromTiles, MOB_GIVE_UP_SECONDS, MOB_LEASH_CAP, MOB_LEASH_RADIUS, mulberry32, POLICIES, TICK_MS, TILE, TILE_FLOOR, TILE_WALL,
  type CampDef, type FactionId, type GameMap, type Vec2, type WeaponId,
} from "@raid/shared";
import { combatant } from "../src/sim/combatant";
import { createGameWorld } from "../src/sim/gameplay";
import { enqueueClientMessage } from "../src/sim/inputs";
import { aggro } from "../src/sim/mobAI";
import { placeMob, type MobCombatant } from "../src/sim/mobLife";
import { addPlayer, step } from "../src/sim/step";
import type { SimConfig, World } from "../src/sim/world";

// The territory leash (ROGUELIKE_PLAN D15, mobAI.ts): a mob of a camp with a territory gives up when it leaves the camp's
// cells of `map.territoryGrid` or goes farther than min(camp.radius, MOB_LEASH_CAP) from its spot; a mob with no territory
// (a hand-built map, no camp) keeps the circle of MOB_LEASH_RADIUS. The rig is the one of mobAI.test.ts in small:
// an open hand-built arena, passive players with huge hp, and the AI woken by `aggro`.

const TILES = 64;
const tile = (tx: number, ty: number): Vec2 => ({ x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 });
const HOME = tile(32, 32);
const MOB_SPEED = 170;
const STEP = (MOB_SPEED * TICK_MS) / 1000;
const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);

/** An open arena with a wall border; `sealed` are single floor tiles walled off on all eight sides (a target nobody can reach). */
function arena(sealed: Array<{ tx: number; ty: number }> = []): GameMap {
  const tiles = new Uint8Array(TILES * TILES).fill(TILE_FLOOR);
  for (let i = 0; i < TILES; i++) {
    tiles[i] = TILE_WALL;
    tiles[(TILES - 1) * TILES + i] = TILE_WALL;
    tiles[i * TILES] = TILE_WALL;
    tiles[i * TILES + TILES - 1] = TILE_WALL;
  }
  for (const c of sealed) {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx !== 0 || dy !== 0) tiles[(c.ty + dy) * TILES + c.tx + dx] = TILE_WALL;
  }
  return { ...mapFromTiles(TILES, TILES, tiles), spawns: [tile(6, 6), tile(8, 6), tile(10, 6)] };
}

/** One camp at HOME on the arena. Its territory is the tiles from tx0..tx1, ty0..ty1 (inclusive); `radius` in tiles. */
function campMap(
  territory: { tx0: number; tx1: number; ty0: number; ty1: number }, radiusTiles: number, zone: FactionId = "plague",
  sealed: Array<{ tx: number; ty: number }> = [],
): GameMap {
  const map = arena(sealed);
  let area = 0;
  for (let ty = territory.ty0; ty <= territory.ty1; ty++) {
    for (let tx = territory.tx0; tx <= territory.tx1; tx++) {
      map.territoryGrid[ty * TILES + tx] = 1;
      area++;
    }
  }
  const camp: CampDef = {
    id: `${zone}-1`, zone, x: HOME.x, y: HOME.y, r: 2.5 * TILE, spots: [HOME], eliteSpot: -1, chest: HOME, area, radius: radiusTiles * TILE,
  };
  map.camps = [camp];
  return map;
}

/** The small territory: 13 x 13 tiles around HOME, so its edge is 6.5 tiles (208 u) from HOME, inside the 9-tile circle. */
const SMALL = { tx0: 26, tx1: 38, ty0: 26, ty1: 38 };
const SMALL_EDGE = 6.5 * TILE;
/** The whole arena floor. */
const BIG = { tx0: 1, tx1: TILES - 2, ty0: 1, ty1: TILES - 2 };

interface Rig { world: World; mob: MobCombatant }

/** A raid in progress on `map` with one passive player `p0` and one mob of `region` at HOME, belonging to camp 1 unless `camp` says otherwise. */
function makeRig(map: GameMap, region: FactionId, camp: number | null = 0): Rig {
  const config: SimConfig = {
    minPlayers: 1, lobbySeconds: 15, fillSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600, suddenDeathSeconds: 60,
  };
  const world = createGameWorld({ config, random: mulberry32(99), map });
  addPlayer(world, "p0", "player0", { faction: "holy" }); // passive: Holy's signature deals no damage, unlike a burning or marking faction
  step(world, TICK_MS);
  expect(world.state.phase).toBe("active");
  const p = world.state.players.get("p0")!;
  p.weapon0 = "";
  p.hp = p.maxHp = 1e9;
  put(world, 200, 200);
  const mob = combatant(world, placeMob(world, { region, elite: false, at: HOME, facing: 0, camp: camp ?? undefined })) as MobCombatant;
  return { world, mob };
}

function put(world: World, x: number, y: number): void {
  const p = world.state.players.get("p0")!;
  const rt = world.players.get("p0")!;
  p.x = x;
  p.y = y;
  rt.path = [];
  rt.history = [{ t: world.state.serverTime, x, y }];
}

const mode = (rig: Rig) => rig.mob.rt.brain!.mode;

/** Wakes the mob onto `p0`, who stands at `at` the whole time, and runs `ticks`. Returns the farthest the mob got from HOME and the positions. */
function chase(rig: Rig, at: Vec2, ticks: number): { farthest: number; trail: Vec2[]; giveUpAt: Vec2 | null } {
  put(rig.world, at.x, at.y);
  aggro(rig.world, rig.mob, "p0", 10);
  let farthest = 0;
  const trail: Vec2[] = [];
  let giveUpAt: Vec2 | null = null;
  for (let i = 0; i < ticks; i++) {
    step(rig.world, TICK_MS);
    const here = { x: rig.mob.s.x, y: rig.mob.s.y };
    trail.push(here);
    farthest = Math.max(farthest, dist(here, HOME));
    if (giveUpAt === null && mode(rig) === "return") giveUpAt = here;
  }
  return { farthest, trail, giveUpAt };
}

describe("the territory leash", () => {
  it("a mob chased out of its territory gives up at the border (inside the old circle), then walks home whole", () => {
    const rig = makeRig(campMap(SMALL, 20), "sentenced");
    // The player stands 10 tiles east: past the territory's edge (6.5 tiles) and past the 9-tile circle too.
    const { farthest, giveUpAt } = chase(rig, tile(42, 32), 80);
    expect(giveUpAt).not.toBeNull();
    // It turned back on the first tick it stood outside the territory: at most one step past the border.
    expect(farthest).toBeGreaterThan(SMALL_EDGE);
    expect(farthest).toBeLessThan(SMALL_EDGE + STEP + 1);
    expect(farthest).toBeLessThan(MOB_LEASH_RADIUS);
    rig.mob.s.hp = 1; // evading: nothing hurts it on the way, and it is whole when it arrives
    for (let i = 0; i < 200; i++) step(rig.world, TICK_MS);
    expect(mode(rig)).toBe("idle");
    expect({ x: rig.mob.s.x, y: rig.mob.s.y }).toEqual(HOME);
    expect(rig.mob.s.hp).toBe(rig.mob.s.maxHp);
  });

  it("a mob chasing a target inside its territory keeps chasing and fighting for as long as it likes", () => {
    const rig = makeRig(campMap(SMALL, 20), "sentenced");
    // Four tiles north and four west: inside the territory (6 tiles each way from the centre tile) and the cap.
    const { farthest, trail } = chase(rig, tile(28, 28), 400);
    expect(mode(rig)).toBe("fight");
    expect(farthest).toBeLessThan(SMALL_EDGE);
    // It walked up to the player and stayed there, swinging: the give-up timer is restarted by every hit it lands.
    expect(dist(trail[trail.length - 1]!, tile(28, 28))).toBeLessThan(POLICIES.sword.attackRange);
    expect(rig.world.state.players.get("p0")!.hp).toBeLessThan(1e9);
  });

  it("inside its territory a mob that cannot reach its target still gives up after MOB_GIVE_UP_SECONDS: the leash adds to the timer, it does not replace it", () => {
    const cell = { tx: 35, ty: 32 }; // three tiles east of HOME, inside the territory, walled in
    const rig = makeRig(campMap(SMALL, 20, "plague", [cell]), "sentenced");
    put(rig.world, tile(cell.tx, cell.ty).x, tile(cell.tx, cell.ty).y);
    // Off its spot, so giving up is a walk home and not an instant rest.
    rig.mob.s.x = HOME.x - 100;
    rig.mob.rt.history = [{ t: rig.world.state.serverTime, x: HOME.x - 100, y: HOME.y }];
    aggro(rig.world, rig.mob, "p0", 10);
    const steps = (MOB_GIVE_UP_SECONDS * 1000) / TICK_MS;
    for (let i = 0; i < steps - 1; i++) step(rig.world, TICK_MS);
    expect(mode(rig)).toBe("fight");
    step(rig.world, TICK_MS);
    expect(mode(rig)).toBe("return");
    for (let i = 0; i < 120; i++) step(rig.world, TICK_MS);
    expect(mode(rig)).toBe("idle");
    expect({ x: rig.mob.s.x, y: rig.mob.s.y }).toEqual(HOME);
  });

  it("is capped at MOB_LEASH_CAP from the spot when the territory is bigger", () => {
    const rig = makeRig(campMap(BIG, 25), "sentenced");
    expect(MOB_LEASH_CAP).toBeGreaterThan(MOB_LEASH_RADIUS);
    // 18 tiles east, inside the territory but past the 12-tile cap.
    const { farthest, giveUpAt } = chase(rig, tile(50, 32), 120);
    expect(farthest).toBeGreaterThan(MOB_LEASH_CAP);
    expect(farthest).toBeLessThan(MOB_LEASH_CAP + STEP + 1);
    expect(giveUpAt).not.toBeNull();
  });

  it("is the camp's radius when that is below the cap (the leash is min(radius, cap))", () => {
    const rig = makeRig(campMap(BIG, 5), "sentenced");
    const { farthest, giveUpAt } = chase(rig, tile(44, 32), 80);
    expect(farthest).toBeGreaterThan(5 * TILE);
    expect(farthest).toBeLessThan(5 * TILE + STEP + 1);
    expect(giveUpAt).not.toBeNull();
  });

  it("keeps the 9-tile circle when the map has no territory at all (a hand-built map)", () => {
    for (const map of [arena(), { ...arena(), camps: campMap(SMALL, 20).camps }]) {
      // Both have a territoryGrid of zeros: with or without a CampDef listed, the mob's camp holds no cells.
      const rig = makeRig(map, "sentenced");
      const { farthest, giveUpAt } = chase(rig, tile(46, 32), 80);
      expect(farthest).toBeGreaterThan(MOB_LEASH_RADIUS);
      expect(farthest).toBeLessThan(MOB_LEASH_RADIUS + STEP + 1);
      expect(giveUpAt).not.toBeNull();
    }
  });

  it("keeps the circle for a camp with no area, for a mob with no camp, and for a mob that was put outside its territory", () => {
    const noArea = campMap(SMALL, 20);
    noArea.camps[0]!.area = 0;
    const cases: Array<[string, GameMap, number | null]> = [
      ["a camp with no area", noArea, 0],
      ["a mob with no camp", campMap(SMALL, 20), null],
      ["a camp index the map does not have", campMap(SMALL, 20), 7],
    ];
    for (const [name, map, camp] of cases) {
      const rig = makeRig(map, "sentenced", camp);
      const { farthest } = chase(rig, tile(46, 32), 80);
      expect(farthest, name).toBeGreaterThan(MOB_LEASH_RADIUS);
      expect(farthest, name).toBeLessThan(MOB_LEASH_RADIUS + STEP + 1);
    }
    // A mob whose own spot is outside the camp's cells has no territory to keep to.
    const elsewhere = campMap({ tx0: 2, tx1: 6, ty0: 2, ty1: 6 }, 20);
    expect(leashOk(elsewhere, 1, HOME, { x: HOME.x + MOB_LEASH_RADIUS - 1, y: HOME.y })).toBe(true);
    expect(leashOk(elsewhere, 1, HOME, { x: HOME.x + MOB_LEASH_RADIUS + 1, y: HOME.y })).toBe(false);
  });

  it.each([["plague", "bow"], ["holy", "wand"]] as const)(
    "a %s mob (%s) chased by a melee player inside a small territory stays inside it and keeps fighting",
    (region, weapon: WeaponId) => {
      for (const back of [0, 150]) {
        const map = campMap(SMALL, 20, region);
        const rig = makeRig(map, region);
        rig.mob.s.x = HOME.x - back;
        rig.mob.rt.history = [{ t: rig.world.state.serverTime, x: HOME.x - back, y: HOME.y }];
        const p = rig.world.state.players.get("p0")!;
        put(rig.world, rig.mob.s.x + 150, HOME.y);
        aggro(rig.world, rig.mob, "p0", 10);
        const modes = new Set<string>();
        let hits = 0;
        let rightWeapon = true;
        for (let i = 0; i < 600; i++) {
          if (i % 4 === 0) {
            const d = dist(rig.mob.s, p) || 1;
            // The chaser runs at the mob and stops 40 u short of it.
            enqueueClientMessage(rig.world.players.get("p0")!.inputs, "move", {
              x: rig.mob.s.x + ((p.x - rig.mob.s.x) / d) * 40, y: rig.mob.s.y + ((p.y - rig.mob.s.y) / d) * 40,
            });
          }
          for (const e of step(rig.world, TICK_MS)) {
            if (e.type !== "fx" || e.fx.kind !== "hit" || e.fx.id !== "p0" || e.fx.by !== rig.mob.id) continue;
            hits++;
            rightWeapon = rightWeapon && e.fx.weapon === weapon;
          }
          // Always on a cell of its own territory (the retreat keeps clear of the edge), never past the cap.
          expect(leashOk(map, 1, HOME, rig.mob.s), `${region} back ${back} tick ${i}`).toBe(true);
          modes.add(mode(rig));
        }
        expect([...modes]).toEqual(["fight"]);
        expect(hits).toBeGreaterThanOrEqual(10);
        expect(rightWeapon).toBe(true);
      }
    },
  );
});

describe("the territory leash on generated maps", () => {
  it.each([1, 2])("seed %i: a mob of every camp, woken onto a far player, never leaves its camp's territory by more than a step and gets home", (seed) => {
    const map = generateMap(seed);
    expect(map.camps).toHaveLength(20);
    const config: SimConfig = {
      minPlayers: 1, lobbySeconds: 15, fillSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600, suddenDeathSeconds: 60,
    };
    map.camps.forEach((camp, ci) => {
      const world = createGameWorld({ seed, config, random: mulberry32(5), map });
      addPlayer(world, "p0", "player0");
      step(world, TICK_MS);
      const p = world.state.players.get("p0")!;
      p.weapon0 = "";
      p.hp = p.maxHp = 1e9;
      // The player stands on the nearest other camp's centre: a reachable floor tile outside this territory.
      const other = map.camps.filter((_, i) => i !== ci).reduce((a, b) => (dist(a, camp) < dist(b, camp) ? a : b));
      p.x = other.x;
      p.y = other.y;
      world.players.get("p0")!.history = [{ t: world.state.serverTime, x: p.x, y: p.y }];
      const spot = camp.spots[0]!;
      const mob = combatant(world, placeMob(world, { region: camp.zone, elite: false, at: spot, facing: 0, camp: ci })) as MobCombatant;
      expect(leashOk(map, ci + 1, spot, spot), camp.id).toBe(true);
      aggro(world, mob, "p0", 10);
      let farthest = 0;
      let gaveUp = false;
      for (let i = 0; i < 700; i++) {
        step(world, TICK_MS);
        if (mob.rt.brain!.mode === "return") gaveUp = true;
        else if (!gaveUp) {
          // The AI thinks after the tick's movement: a mob still fighting at the end of a tick stands inside its leash.
          expect(mob.rt.brain!.mode === "fight" ? leashOk(map, ci + 1, spot, mob.s) : true, `${camp.id} tick ${i}`).toBe(true);
        }
        farthest = Math.max(farthest, dist(mob.s, spot));
      }
      expect(gaveUp, `${camp.id} gave up`).toBe(true);
      expect(farthest, camp.id).toBeLessThan(MOB_LEASH_CAP + STEP + 1);
      expect(mob.rt.brain!.mode, camp.id).toBe("idle");
      expect(dist(mob.s, spot), camp.id).toBeLessThan(1);
    });
  });
});
