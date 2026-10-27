// The styler toolkit: noise, tile geometry, distance fields, flow paths and the connectivity safety net.
import { describe, expect, it } from "vitest";
import { TILE_FLOOR, TILE_LOW, TILE_WALL } from "../src/map";
import { mulberry32 } from "../src/rng";
import {
  chamfer, flowPath, floorComponents, hash2, largestFreeRect, lineTiles, makeNoise, nearHard,
  pickTile, placeRing, repairConnectivity, ringTiles, shuffle, sideDoors, vnoise,
} from "../src/zoneStyle/kit";
import { rig } from "./zoneStyleRig";

describe("noise", () => {
  it("hash2 and vnoise are pure, in [0, 1) and depend on every input", () => {
    for (let i = 0; i < 200; i++) {
      const h = hash2(i, i * 3 - 100, 7);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(1);
      const v = vnoise(i * 0.37, i * 0.11, 6.5, 3);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(hash2(3, 4, 5)).toBe(hash2(3, 4, 5));
    expect(hash2(3, 4, 5)).not.toBe(hash2(4, 3, 5));
    expect(hash2(3, 4, 5)).not.toBe(hash2(3, 4, 6));
    // roughly uniform
    let sum = 0;
    for (let x = 0; x < 100; x++) for (let y = 0; y < 100; y++) sum += hash2(x, y, 1);
    expect(sum / 10_000).toBeGreaterThan(0.48);
    expect(sum / 10_000).toBeLessThan(0.52);
  });

  it("vnoise is continuous: neighbouring samples differ by little", () => {
    let worst = 0;
    for (let x = 0; x < 60; x += 0.25) for (let y = 0; y < 60; y += 0.25) worst = Math.max(worst, Math.abs(vnoise(x, y, 8, 2) - vnoise(x + 0.25, y, 8, 2)));
    expect(worst).toBeLessThan(0.12);
  });

  it("a noise kit is mixed with its stream seed: two streams disagree, one stream repeats", () => {
    const a = makeNoise(11), b = makeNoise(12), a2 = makeNoise(11);
    let same = 0;
    for (let i = 0; i < 100; i++) {
      expect(a.hash(i, 2, 3)).toBe(a2.hash(i, 2, 3));
      expect(a.value(i, 2, 5, 1)).toBe(a2.value(i, 2, 5, 1));
      expect(a.fbm(i, 2, 8, 3, 1)).toBe(a2.fbm(i, 2, 8, 3, 1));
      if (a.hash(i, 2, 3) === b.hash(i, 2, 3)) same++;
      expect(a.fbm(i, 5, 8, 3, 1)).toBeGreaterThanOrEqual(0);
      expect(a.fbm(i, 5, 8, 3, 1)).toBeLessThanOrEqual(1);
    }
    expect(same).toBe(0);
  });
});

describe("tile geometry", () => {
  it("lineTiles walks one tile per step of the longer axis, endpoints included, 8-connected", () => {
    const t = lineTiles(2, 3, 9, 6);
    expect(t[0]).toEqual([2, 3]);
    expect(t[t.length - 1]).toEqual([9, 6]);
    expect(t.length).toBe(8);
    for (let i = 1; i < t.length; i++) expect(Math.max(Math.abs(t[i][0] - t[i - 1][0]), Math.abs(t[i][1] - t[i - 1][1]))).toBe(1);
    expect(lineTiles(4, 4, 4, 4)).toEqual([[4, 4]]);
    expect(lineTiles(0, 5, 0, 0).length).toBe(6);
  });

  it("ringTiles is the perimeter once round, clockwise from the top-left, each step to a neighbour", () => {
    for (const [w, h] of [[3, 3], [8, 6], [10, 10], [5, 9]] as const) {
      const r = ringTiles(2, 3, w, h);
      expect(r.length).toBe(2 * (w + h) - 4);
      expect(new Set(r.map(([x, y]) => `${x},${y}`)).size).toBe(r.length);
      expect(r[0]).toEqual([2, 3]);
      for (let i = 0; i < r.length; i++) {
        const a = r[i], b = r[(i + 1) % r.length];
        expect(Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1])).toBe(1);
      }
    }
  });

  it("placeRing skips the door windows and starts just after the first door", () => {
    const ring = ringTiles(0, 0, 8, 6);
    const placed: Array<[number, number]> = [];
    const n = placeRing(ring, [4, 17], 2, (x, y) => { placed.push([x, y]); return true; });
    expect(n).toBe(ring.length - 4);
    const keys = new Set(placed.map(([x, y]) => `${x},${y}`));
    for (const d of [4, 5, 17, 18]) expect(keys.has(`${ring[d][0]},${ring[d][1]}`)).toBe(false);
    expect(placed[0]).toEqual(ring[6]);
    // a put that refuses is not counted
    expect(placeRing(ring, [4], 2, () => false)).toBe(0);
    // no doors: the whole ring
    expect(placeRing(ring, [], 2, () => true)).toBe(ring.length);
  });

  it("sideDoors puts one door per listed side, away from the corners, on that side's stretch of the ring", () => {
    const rng = mulberry32(5);
    for (let t = 0; t < 100; t++) {
      const w = 8 + (t % 3), h = 7 + (t % 4);
      const ring = ringTiles(0, 0, w, h);
      const doors = sideDoors(rng, w, h, [0, 1, 2, 3], 2);
      doors.forEach((pos, side) => {
        const [ax, ay] = ring[pos], [bx, by] = ring[(pos + 1) % ring.length];
        const onSide = (x: number, y: number) => (side === 0 ? y === 0 : side === 1 ? x === w - 1 : side === 2 ? y === h - 1 : x === 0);
        expect(onSide(ax, ay) && onSide(bx, by), `side ${side} door at ${ax},${ay}`).toBe(true);
        for (const [x, y] of [[ax, ay], [bx, by]]) expect(((x === 0 || x === w - 1) && (y === 0 || y === h - 1))).toBe(false);
      });
    }
  });

  it("shuffle is a deterministic permutation", () => {
    const a = shuffle(mulberry32(3), [1, 2, 3, 4, 5, 6, 7, 8]);
    const b = shuffle(mulberry32(3), [1, 2, 3, 4, 5, 6, 7, 8]);
    expect(a).toEqual(b);
    expect([...a].sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(a).not.toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

describe("chamfer", () => {
  it("is the 3-4 chamfer distance, in thirds of a tile, from the mask's edge", () => {
    const w = 9, h = 9;
    const mask = new Uint8Array(w * h);
    for (let y = 1; y < 8; y++) for (let x = 1; x < 8; x++) mask[y * w + x] = 1;
    const d = chamfer(mask, w, h);
    expect(d[0]).toBe(0);
    expect(d[1 * w + 1]).toBe(3); // a corner of the mask touches the outside
    expect(d[4 * w + 4]).toBe(12); // the middle of a 7x7 block: 4 steps from outside
    expect(d[1 * w + 4]).toBe(3);
    expect(d[2 * w + 2]).toBe(6);
    // a mask that fills the whole grid: the edge of the grid counts as outside
    const full = chamfer(new Uint8Array(w * h).fill(1), w, h);
    expect(full[0]).toBe(3);
    expect(full[4 * w]).toBe(3);
    expect(full[4 * w + 4]).toBe(15); // 4 tiles in from the nearest edge tile, which is 1 step from outside
    expect(full.every((v) => v < 100)).toBe(true);
  });
});

describe("largestFreeRect", () => {
  it("finds the largest-area rectangle with both sides at least minSide, ties first in row-major order (vs brute force)", () => {
    const rng = mulberry32(17);
    for (let t = 0; t < 80; t++) {
      const w = 14, h = 11;
      const free = new Uint8Array(w * h);
      for (let i = 0; i < free.length; i++) free[i] = rng() < 0.82 ? 1 : 0;
      const minSide = 2 + (t % 3);
      let best = 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let rh = minSide; y + rh <= h; rh++) for (let rw = minSide; x + rw <= w; rw++) {
        let ok = true;
        for (let yy = y; yy < y + rh && ok; yy++) for (let xx = x; xx < x + rw; xx++) if (!free[yy * w + xx]) { ok = false; break; }
        if (ok && rw * rh > best) best = rw * rh;
      }
      const r = largestFreeRect(free, w, h, minSide);
      if (best === 0) { expect(r).toBeNull(); continue; }
      expect(r, `run ${t}`).not.toBeNull();
      expect(r!.w * r!.h, `run ${t}`).toBe(best);
      expect(r!.w).toBeGreaterThanOrEqual(minSide);
      expect(r!.h).toBeGreaterThanOrEqual(minSide);
      for (let yy = r!.y; yy < r!.y + r!.h; yy++) for (let xx = r!.x; xx < r!.x + r!.w; xx++) expect(free[yy * w + xx]).toBe(1);
    }
  });
});

describe("flowPath", () => {
  it("runs from a to b over this zone's floor, 8-connected, around walls, the same every time", () => {
    const r = rig([
      "#############",
      "#...........#",
      "#.....W.....#",
      "#.....W.....#",
      "#.....W.....#",
      "#...........#",
      "#############",
    ]);
    const a = r.at(1, 3), b = r.at(11, 3);
    const p = flowPath(r.shape, a, b, 11);
    expect(p[0]).toBe(a);
    expect(p[p.length - 1]).toBe(b);
    for (let k = 1; k < p.length; k++) {
      const dx = Math.abs((p[k] % r.w) - (p[k - 1] % r.w)), dy = Math.abs(Math.floor(p[k] / r.w) - Math.floor(p[k - 1] / r.w));
      expect(Math.max(dx, dy)).toBe(1);
      expect(r.tiles[p[k]]).toBe(TILE_FLOOR);
    }
    expect(flowPath(r.shape, a, b, 11)).toEqual(p);
    // a different salt wobbles the route
    expect(flowPath(r.shape, a, b, 12).length).toBeGreaterThan(0);
    // sealed off: no path
    const s = rig(["#######", "#..W..#", "#..W..#", "#######"]);
    expect(flowPath(s.shape, s.at(1, 1), s.at(5, 1), 1)).toEqual([]);
    // a penalty steers it
    const open = rig(["###########", "#.........#", "#.........#", "#.........#", "###########"]);
    const straight = flowPath(open.shape, open.at(1, 2), open.at(9, 2), 1);
    const avoid = flowPath(open.shape, open.at(1, 2), open.at(9, 2), 1, (j) => (Math.floor(j / open.w) === 2 && j % open.w > 2 && j % open.w < 8 ? 500 : 0));
    expect(avoid.some((j) => Math.floor(j / open.w) !== 2)).toBe(true);
    expect(straight.length).toBeLessThanOrEqual(avoid.length);
  });
});

describe("zone helpers", () => {
  it("nearHard sees protected tiles within a Chebyshev radius, pickTile draws only from allowed tiles", () => {
    const r = rig([
      "#########",
      "#.......#",
      "#...,...#",
      "#.......#",
      "#.......#",
      "#########",
    ]);
    expect(nearHard(r.shape, 3, 1, 1)).toBe(true);
    expect(nearHard(r.shape, 1, 4, 1)).toBe(false);
    expect(nearHard(r.shape, 1, 4, 3)).toBe(true);
    for (let t = 0; t < 50; t++) {
      const p = pickTile(r.shape, 60);
      expect(p).not.toBeNull();
      expect(r.rt.init.hard[r.at(p![0], p![1])]).toBe(0);
    }
  });
});

describe("floorComponents and repairConnectivity", () => {
  it("counts 4-connected floor components and sizes them", () => {
    const r = rig([
      "#######",
      "#..W..#",
      "#..W..#",
      "#######",
    ]);
    const { comp, sizes } = floorComponents(r.tiles, r.w, r.h);
    expect(sizes).toEqual([4, 4]);
    expect(comp[r.at(1, 1)]).toBe(0);
    expect(comp[r.at(5, 2)]).toBe(1);
    expect(comp[r.at(3, 1)]).toBe(-1);
    // a diagonal link is not a link
    const d = rig(["#####", "#.W.#", "#W.W#", "#.W.#", "#####"]);
    expect(floorComponents(d.tiles, d.w, d.h).sizes.length).toBe(5);
  });

  it("gives back the tiles THIS pass wrote to rejoin a split floor, and never opens a wall it did not write", () => {
    const r = rig([
      "#######",
      "#..W..#",
      "#..W..#",
      "#..W..#",
      "#######",
    ]);
    const wrote = new Uint8Array(r.w * r.h);
    // (3,2) was a styler's wall: the middle of the divider; (3,1) and (3,3) are the generator's
    wrote[r.at(3, 2)] = 1;
    r.terrain[r.at(3, 2)] = 0;
    expect(repairConnectivity(r.tiles, r.terrain, wrote, r.w, r.h)).toBe(1);
    expect(r.tiles[r.at(3, 2)]).toBe(TILE_FLOOR);
    expect(r.tiles[r.at(3, 1)]).toBe(TILE_WALL);
    expect(floorComponents(r.tiles, r.w, r.h).sizes.length).toBe(1);
    // nothing to give back: the split stays
    const q = rig(["#######", "#..W..#", "#######"]);
    expect(repairConnectivity(q.tiles, q.terrain, new Uint8Array(q.w * q.h), q.w, q.h)).toBe(0);
    expect(floorComponents(q.tiles, q.w, q.h).sizes.length).toBe(2);
  });
});

describe("the guard on random organic zones (200 masks)", () => {
  it("keeps the whole floor in one piece and never writes a protected, seam or rim tile, whatever the write order", () => {
    let written = 0, refused = 0, joins = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const rng = mulberry32(seed * 31337);
      const w = 30, h = 24;
      // a blobby zone from two noise octaves, other-zone floor around it, a solid border; some protected spots and rocks
      const rows: string[] = [];
      for (let y = 0; y < h; y++) {
        let row = "";
        for (let x = 0; x < w; x++) {
          if (x === 0 || y === 0 || x === w - 1 || y === h - 1) { row += "#"; continue; }
          const v = vnoise(x, y, 9, seed) * 0.7 + vnoise(x, y, 4, seed + 1) * 0.3;
          if (v > 0.45) row += rng() < 0.05 ? "," : rng() < 0.08 ? "W" : ".";
          else row += rng() < 0.2 ? "#" : "o";
        }
        rows.push(row);
      }
      const r = rig(rows, { caps: { rimTiles: 3, footprintPct: 30, joinChecks: 200 } });
      const before = r.tiles.slice();
      const comps = floorComponents(r.tiles, w, h).sizes.length;
      for (let k = 0; k < 500; k++) {
        const x = 1 + Math.floor(rng() * (w - 2)), y = 1 + Math.floor(rng() * (h - 2));
        const q = rng();
        r.shape.block(r.at(x, y), q < 0.45 ? "wall" : q < 0.7 ? "fence" : q < 0.85 ? "lava" : "crevasse");
      }
      written += r.rt.walls + r.rt.lows; refused += r.rt.refused; joins += r.rt.joinUsed;
      expect(floorComponents(r.tiles, w, h).sizes.length, `mask ${seed}`).toBeLessThanOrEqual(comps);
      for (let i = 0; i < w * h; i++) {
        if (r.tiles[i] === before[i]) continue;
        expect(r.rt.init.mask[i], `mask ${seed} tile ${i}: written outside the zone`).toBe(1);
        expect(r.rt.init.hard[i], `mask ${seed} tile ${i}: written on a protected tile`).toBe(0);
        expect(r.rt.init.edgeDist[i], `mask ${seed} tile ${i}: written inside the rim`).toBeGreaterThanOrEqual(9);
        expect(before[i] === TILE_FLOOR || before[i] === TILE_LOW, `mask ${seed} tile ${i}`).toBe(true);
      }
      // every straight run of wall through a tile this pass wrote is at most 14
      for (let i = 0; i < w * h; i++) {
        if (r.tiles[i] !== TILE_WALL || before[i] === TILE_WALL) continue;
        const x = i % w, y = (i - x) / w;
        let run = 1;
        for (let k = x - 1; k >= 0 && r.tiles[y * w + k] === TILE_WALL; k--) run++;
        for (let k = x + 1; k < w && r.tiles[y * w + k] === TILE_WALL; k++) run++;
        expect(run, `mask ${seed}: horizontal wall run through ${x},${y}`).toBeLessThanOrEqual(14);
        run = 1;
        for (let k = y - 1; k >= 0 && r.tiles[k * w + x] === TILE_WALL; k--) run++;
        for (let k = y + 1; k < h && r.tiles[k * w + x] === TILE_WALL; k++) run++;
        expect(run, `mask ${seed}: vertical wall run through ${x},${y}`).toBeLessThanOrEqual(14);
      }
    }
    // not vacuous: the guard accepted thousands of writes, refused thousands, and ran join checks
    expect(written).toBeGreaterThan(2000);
    expect(refused).toBeGreaterThan(2000);
    expect(joins).toBeGreaterThan(100);
  }, 60_000);
});
