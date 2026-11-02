import { describe, expect, it } from "vitest";
import { BUSH_REVEAL_RADIUS, TILE } from "../src/constants";
import { BUSH_MAX_TILES, BUSH_MIN_TILES, BUSH_PATCHES_MAX } from "../src/bushes";
import { generateMap } from "../src/mapgen";
import { TILE_FLOOR, type GameMap } from "../src/map";
import { bushAt, bushConceals } from "../src/vision";

const SEEDS = [1, 2, 3, 7];

describe("elite camp bushes", () => {
  for (const seed of SEEDS) {
    const map = generateMap(seed);
    it(`seed ${seed}: a few small patches in elite territories, clear of the clearing, crates and ground spots`, () => {
      const bushes = map.features.map((f, i) => ({ f, id: i + 1 })).filter((b) => b.f.kind === "bush");
      expect(bushes.length).toBeGreaterThanOrEqual(10);
      const perCamp = new Map<number, number>();
      for (const { f, id } of bushes) {
        const camp = map.camps[f.p[0]!];
        expect(camp.eliteSpot).toBeGreaterThanOrEqual(0);
        expect(camp.zone).toBe(f.zone);
        perCamp.set(f.p[0]!, (perCamp.get(f.p[0]!) ?? 0) + 1);
        expect(f.tiles).toBeGreaterThanOrEqual(BUSH_MIN_TILES);
        expect(f.tiles).toBeLessThanOrEqual(BUSH_MAX_TILES);
        for (let i = 0; i < map.featureGrid.length; i++) {
          if (map.featureGrid[i] !== id) continue;
          expect(map.tiles[i]).toBe(TILE_FLOOR);
          expect(map.terrain[i]).toBe(0);
          const x = (i % map.w + 0.5) * TILE, y = (Math.floor(i / map.w) + 0.5) * TILE;
          expect(Math.hypot(x - camp.x, y - camp.y)).toBeGreaterThan(camp.r + TILE);
          for (const c of map.crateSpots) expect(Math.abs(c.x - x) <= 1.5 * TILE && Math.abs(c.y - y) <= 1.5 * TILE).toBe(false);
          for (const g of map.groundSpots) expect(Math.floor(g.x / TILE) === i % map.w && Math.floor(g.y / TILE) === Math.floor(i / map.w)).toBe(false);
        }
      }
      map.camps.forEach((c, i) => { if (c.eliteSpot < 0) expect(perCamp.has(i)).toBe(false); });
      expect(perCamp.size).toBeGreaterThanOrEqual(8);
      for (const n of perCamp.values()) expect(n).toBeLessThanOrEqual(BUSH_PATCHES_MAX);
    });

    it(`seed ${seed}: patches lean on the architecture and never touch each other`, () => {
      const owner = (x: number, y: number): number => map.featureGrid[y * map.w + x]!;
      let leaning = 0, patches = 0;
      map.features.forEach((f, k) => {
        if (f.kind !== "bush") return;
        patches++;
        let lean = false;
        for (let i = 0; i < map.featureGrid.length; i++) {
          if (map.featureGrid[i] !== k + 1) continue;
          const x = i % map.w, y = Math.floor(i / map.w);
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const j = (y + dy) * map.w + x + dx, o = owner(x + dx, y + dy);
            if (map.tiles[j] !== TILE_FLOOR || map.terrain[j] !== 0 || (o > 0 && map.features[o - 1]!.kind !== "bush")) lean = true;
          }
          for (const [ax, ay] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
            const o = owner(x + ax, y + ay);
            if (o > 0 && o !== k + 1) expect(map.features[o - 1]!.kind).not.toBe("bush");
          }
        }
        if (lean) leaning++;
      });
      expect(leaning / patches).toBeGreaterThan(0.85);
    });

    it(`seed ${seed}: the map without bushes has the same tiles, terrain, props and architecture`, () => {
      const bare = generateMap(seed, map.attempt, { bushes: false });
      expect(bare.tiles).toEqual(map.tiles);
      expect(bare.terrain).toEqual(map.terrain);
      expect(bare.props).toEqual(map.props);
      expect(bare.regionGrid).toEqual(map.regionGrid);
      expect(bare.territoryGrid).toEqual(map.territoryGrid);
      expect(bare.spawnPool).toEqual(map.spawnPool);
      expect(bare.crateSpots).toEqual(map.crateSpots);
      expect(bare.groundSpots).toEqual(map.groundSpots);
      const keyed = (m: GameMap): number[] => Array.from(m.featureGrid, (g) => {
        const f = g > 0 ? m.features[g - 1]! : null;
        return !f || f.kind === "bush" ? 0 : f.ax * 4096 + f.ay * 16 + f.kind.length;
      });
      expect(keyed(map)).toEqual(keyed(bare));
      expect(map.features.filter((f) => f.kind !== "bush").map((f) => [f.kind, f.ax, f.ay, f.tiles]))
        .toEqual(bare.features.map((f) => [f.kind, f.ax, f.ay, f.tiles]));
      expect(bare.features.some((f) => f.kind === "bush")).toBe(false);
    });
  }

  it("is the same with decor on and off", () => {
    const a = generateMap(5), b = generateMap(5, a.attempt, { decor: false });
    expect(b.featureGrid).toEqual(a.featureGrid);
  });

  it("conceals from outside, not from inside, up close or when exposed", () => {
    const map = generateMap(1);
    const id = map.features.findIndex((f) => f.kind === "bush") + 1;
    const i = map.featureGrid.indexOf(id);
    const inside = { x: (i % map.w + 0.5) * TILE, y: (Math.floor(i / map.w) + 0.5) * TILE };
    expect(bushAt(map, inside)).toBe(id);
    const far = { x: inside.x + BUSH_REVEAL_RADIUS * 4, y: inside.y };
    const near = { x: inside.x + BUSH_REVEAL_RADIUS / 2, y: inside.y };
    if (bushAt(map, far) !== id) expect(bushConceals(map, far, inside)).toBe(true);
    expect(bushConceals(map, near, inside)).toBe(false);
    expect(bushConceals(map, far, inside, 5000, 1000)).toBe(false);
    expect(bushConceals(map, inside, { x: 0, y: 0 })).toBe(false);
  });

  it("League rules: sees out of a bush, sees its bush mates, not into a different bush", () => {
    const map = generateMap(1);
    const ids = map.features.map((f, k) => (f.kind === "bush" ? k + 1 : 0)).filter((k) => k > 0);
    const tileOf = (id: number, nth: number): { x: number; y: number } => {
      let seen = 0;
      for (let i = 0; i < map.featureGrid.length; i++) {
        if (map.featureGrid[i] === id && seen++ === nth) return { x: (i % map.w + 0.5) * TILE, y: (Math.floor(i / map.w) + 0.5) * TILE };
      }
      throw new Error("no tile");
    };
    // Two distant patches (different camps, so well beyond the true-sight reach).
    const a = ids[0]!, b = ids.find((k) => map.features[k - 1]!.p[0] !== map.features[a - 1]!.p[0])!;
    const inA = tileOf(a, 0), inA2 = tileOf(a, 1), inB = tileOf(b, 0), open = { x: 0, y: 0 };
    expect(bushConceals(map, inA, open)).toBe(false);          // a bush occupant sees an open-ground actor
    expect(bushConceals(map, open, inA)).toBe(true);           // open ground does not see into the bush
    expect(bushConceals(map, inA2, inA)).toBe(false);          // bush mates see each other (same patch)
    expect(bushConceals(map, inB, inA)).toBe(true);            // a different bush cannot see in
    expect(bushConceals(map, inA, inB)).toBe(true);
  });
});
