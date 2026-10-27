// What the terrain layers hold while nothing writes them: a generated map with the zone stylers off has an all-zero `terrain`, no
// `props` and only floor and wall tiles, and a hand-built one gets the same defaults from mapFromTiles. A guard for the flag-off
// promise of zone terrain: a map that no styler touched is the map it always was.
import { describe, expect, it } from "vitest";
import { generateMap } from "../src/mapgen";
import { mapFromTiles, TILE_FLOOR, TILE_LOW, TILE_WALL, withGates } from "../src/map";

describe("generated maps with nothing writing the terrain layers", () => {
  const SEEDS = Array.from({ length: 60 }, (_, i) => i + 1);

  it("seeds 1..60 with the stylers off: terrain is all zero, props is empty, tiles are only floor and wall", () => {
    for (const seed of SEEDS) {
      const m = generateMap(seed, undefined, { styleZones: null });
      expect(m.terrain.length, `seed ${seed}`).toBe(m.w * m.h);
      expect(m.terrain.some((k) => k !== 0), `seed ${seed} terrain`).toBe(false);
      expect(m.props, `seed ${seed} props`).toEqual([]);
      expect(m.tiles.length, `seed ${seed}`).toBe(m.w * m.h);
      expect(m.tiles.every((t) => t === TILE_FLOOR || t === TILE_WALL), `seed ${seed} tiles`).toBe(true);
      expect(m.tiles.some((t) => t === TILE_LOW), `seed ${seed} LOW`).toBe(false);
    }
  }, 120_000);

  it("the layers are separate arrays: writing the terrain leaves the tiles alone, and the gated copy shares the terrain", () => {
    const m = generateMap(SEEDS[0]!, undefined, { styleZones: null });
    expect(m.terrain.buffer).not.toBe(m.tiles.buffer);
    const tilesBefore = Array.from(m.tiles);
    m.terrain.fill(7);
    expect(Array.from(m.tiles)).toEqual(tilesBefore);
    expect(withGates(m).terrain).toBe(m.terrain);
    m.terrain.fill(0);
  });
});

describe("mapFromTiles defaults", () => {
  const room = (w: number, h: number): Uint8Array => new Uint8Array(w * h).fill(TILE_FLOOR);

  it("a zeroed terrain layer and no props when none are given", () => {
    const tiles = room(5, 4);
    const m = mapFromTiles(5, 4, tiles);
    expect(m.terrain).toBeInstanceOf(Uint8Array);
    expect(m.terrain.length).toBe(20);
    expect(m.terrain.some((k) => k !== 0)).toBe(false);
    expect(m.props).toEqual([]);
    expect(m.tiles).toBe(tiles); // used as is, not copied
  });

  it("every call makes its own terrain and props (nothing is shared between maps)", () => {
    const a = mapFromTiles(5, 4, room(5, 4));
    const b = mapFromTiles(5, 4, room(5, 4));
    expect(a.terrain).not.toBe(b.terrain);
    expect(a.props).not.toBe(b.props);
    a.terrain[0] = 3;
    a.props.push({ kind: 1, x: 1, y: 1, v: 0 });
    expect(b.terrain[0]).toBe(0);
    expect(b.props).toEqual([]);
  });

  it("a given terrain layer is used as is", () => {
    const terrain = new Uint8Array(20);
    terrain[7] = 2;
    const m = mapFromTiles(5, 4, room(5, 4), 9, terrain);
    expect(m.terrain).toBe(terrain);
    expect(m.seed).toBe(9);
    expect(m.attempt).toBe(0);
  });

  it("a tile or terrain layer of the wrong size is refused", () => {
    expect(() => mapFromTiles(5, 4, room(5, 3))).toThrow(RangeError);
    expect(() => mapFromTiles(5, 4, room(5, 4), 0, new Uint8Array(19))).toThrow(RangeError);
  });
});
