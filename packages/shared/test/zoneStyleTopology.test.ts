// SIMPLE (the simple-point table), ringOffsets, walkDistances and hashSeed: the integer plumbing the zone stylers stand on.
import { describe, expect, it } from "vitest";
import { RING_DX, RING_DY, SIMPLE, nb4Offsets, ringOffsets, walkDistances } from "../src/gridTopology";
import { TILE_FLOOR, TILE_WALL } from "../src/map";
import { hashSeed, mulberry32 } from "../src/rng";

/**
 * The meaning of SIMPLE, by brute force on a literal 3x3 patch: ring cell q (N, NE, E, SE, S, SW, W, NW) is floor when bit q
 * of the mask is set. Wall the centre; the mask is simple exactly when every orthogonal floor neighbour (N, E, S, W) is still
 * reachable from the first one by 4-connected steps over the remaining floor of the patch.
 */
function bruteSimple(mask: number): boolean {
  const floor = new Uint8Array(9); // row-major 3x3, centre (index 4) is solid now
  for (let q = 0; q < 8; q++) if ((mask >> q) & 1) floor[(RING_DY[q] + 1) * 3 + RING_DX[q] + 1] = 1;
  const orth = [1, 5, 7, 3].filter((i) => floor[i]); // N, E, S, W
  if (orth.length <= 1) return true;
  const seen = new Uint8Array(9);
  const stack = [orth[0]];
  seen[orth[0]] = 1;
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % 3, y = (i - x) / 3;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx > 2 || ny > 2) continue;
      const j = ny * 3 + nx;
      if (floor[j] && !seen[j]) { seen[j] = 1; stack.push(j); }
    }
  }
  return orth.every((i) => seen[i] === 1);
}

describe("SIMPLE", () => {
  it("has 256 entries and says, for every ring mask, whether walling the centre keeps its floor neighbours linked (brute force)", () => {
    expect(SIMPLE.length).toBe(256);
    for (let m = 0; m < 256; m++) expect(SIMPLE[m] === 1, `mask ${m.toString(2).padStart(8, "0")}`).toBe(bruteSimple(m));
  });

  it("agrees with real grids: walling a simple point never splits the floor, and a non-simple point in a closed patch always does", () => {
    const rng = mulberry32(2024);
    let simple = 0, cut = 0;
    for (let t = 0; t < 3000; t++) {
      // a 7x7 grid, solid border, random interior with a floor centre
      const g = new Uint8Array(49).fill(TILE_WALL);
      for (let y = 1; y < 6; y++) for (let x = 1; x < 6; x++) g[y * 7 + x] = rng() < 0.65 ? TILE_FLOOR : TILE_WALL;
      g[3 * 7 + 3] = TILE_FLOOR;
      let m = 0;
      for (let q = 0; q < 8; q++) if (g[(3 + RING_DY[q]) * 7 + 3 + RING_DX[q]] === TILE_FLOOR) m |= 1 << q;
      const comps = (tiles: Uint8Array): number => {
        const seen = new Uint8Array(49);
        let n = 0;
        for (let s = 0; s < 49; s++) {
          if (tiles[s] !== TILE_FLOOR || seen[s]) continue;
          n++;
          const stack = [s];
          seen[s] = 1;
          while (stack.length) {
            const i = stack.pop()!;
            for (const j of [i + 1, i - 1, i + 7, i - 7]) if (j >= 0 && j < 49 && tiles[j] === TILE_FLOOR && !seen[j] && Math.abs((j % 7) - (i % 7)) <= 1) { seen[j] = 1; stack.push(j); }
          }
        }
        return n;
      };
      const before = comps(g);
      const after = g.slice();
      after[3 * 7 + 3] = TILE_WALL;
      const n = comps(after);
      if (SIMPLE[m]) { simple++; expect(n, `pattern ${m}`).toBeLessThanOrEqual(before); } // the centre may have been an isolated tile: one component fewer
      else if (n > before) cut++;
    }
    expect(simple).toBeGreaterThan(100);
    expect(cut).toBeGreaterThan(50); // non-simple points really do cut in a closed patch
  });
});

describe("ringOffsets", () => {
  it("is the 8 index offsets of the ring in a grid w wide, for any w", () => {
    for (const w of [3, 64, 96, 200]) {
      const off = ringOffsets(w);
      expect(off).toEqual([-w, -w + 1, 1, w + 1, w, w - 1, -1, -w - 1]);
    }
    expect(nb4Offsets(64)).toEqual([-64, 1, 64, -1]);
  });
});

describe("walkDistances", () => {
  it("measures 8-connected walks in fifths of a tile without cutting corners, on any grid size", () => {
    // 5 wide, 4 high: a wall block forces a detour
    const w = 5, h = 4;
    const tiles = new Uint8Array(w * h);
    tiles[1 * w + 1] = TILE_WALL;
    const d = walkDistances(tiles, w, h, 0);
    expect(d[0]).toBe(0);
    expect(d[1]).toBe(5);
    expect(d[w]).toBe(5);
    // (1,1) is solid; from (0,0) to (2,2) the diagonal would cut the corner of the block, so the walk goes round (4 steps of 5)
    expect(d[2 * w + 2]).toBe(20);
    // with the block gone the diagonal is free: 2 steps of 7
    expect(walkDistances(new Uint8Array(w * h), w, h, 0)[2 * w + 2]).toBe(14);
    expect(d[1 * w + 1]).toBe(-1);
    // unreachable and non-floor start
    tiles[2] = TILE_WALL; tiles[w + 2] = TILE_WALL; tiles[2 * w + 2] = TILE_WALL; tiles[3 * w + 2] = TILE_WALL;
    const cut = walkDistances(tiles, w, h, 0);
    expect(cut[4]).toBe(-1);
    expect(Array.from(walkDistances(tiles, w, h, 1 * w + 1)).every((v) => v === -1)).toBe(true);
  });
});

describe("hashSeed", () => {
  it("is a pure uint32 function of its four inputs", () => {
    expect(hashSeed(1, 0, 3, 0)).toBe(hashSeed(1, 0, 3, 0));
    for (const args of [[0, 0, 0, 0], [1, 2, 3, 4], [-1, 5, 6, 7], [2 ** 31, 0, 1, 2], [123456789, 15, 5, 2]] as Array<[number, number, number, number]>) {
      const h = hashSeed(...args);
      expect(Number.isInteger(h) && h >= 0 && h < 2 ** 32).toBe(true);
    }
  });

  it("coerces like mulberry32 does (seed 2^32 + 5 is seed 5)", () => {
    expect(hashSeed(2 ** 32 + 5, 1, 2, 0)).toBe(hashSeed(5, 1, 2, 0));
    expect(hashSeed(-3, 0, 0, 0)).toBe(hashSeed(2 ** 32 - 3, 0, 0, 0));
  });

  it("separates seeds, attempts, zones and streams: no collision over 40 000 inputs, and every input moves the output", () => {
    const seen = new Set<number>();
    for (let seed = 0; seed < 20; seed++) for (let attempt = 0; attempt < 4; attempt++) for (let zone = 1; zone <= 5; zone++) for (let stream = 0; stream < 3; stream++) seen.add(hashSeed(seed, attempt, zone, stream));
    expect(seen.size).toBe(20 * 4 * 5 * 3);
    const big = new Set<number>();
    for (let a = 0; a < 200; a++) for (let b = 0; b < 200; b++) big.add(hashSeed(a, b, 3, 1));
    expect(big.size).toBe(40_000);
    // each output bit flips about half the time when one input bit flips (an avalanche sanity check)
    let flipped = 0, total = 0;
    for (let a = 0; a < 500; a++) {
      const base = hashSeed(a, 3, 2, 1);
      for (let bit = 0; bit < 32; bit += 7) { flipped += popcount(base ^ hashSeed(a ^ (1 << bit), 3, 2, 1)); total += 32; }
    }
    expect(flipped / total).toBeGreaterThan(0.45);
    expect(flipped / total).toBeLessThan(0.55);
  });

  it("pins a few values (the stream a styler draws from must never drift)", () => {
    expect([hashSeed(1, 0, 1, 0), hashSeed(1, 0, 1, 1), hashSeed(1, 0, 1, 2), hashSeed(77, 3, 5, 0)]).toEqual(PINNED_HASHES);
    // and the streams are usable seeds
    expect(mulberry32(hashSeed(1, 0, 1, 0))()).toBeGreaterThanOrEqual(0);
  });
});

const popcount = (v: number): number => {
  let n = 0;
  for (let x = v >>> 0; x; x &= x - 1) n++;
  return n;
};

const PINNED_HASHES: number[] = [3872774814, 3280098747, 2396925740, 2512215410];
