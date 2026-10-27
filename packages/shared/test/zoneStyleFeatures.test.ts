// The feature kit (zoneStyle/features.ts, contract 3.3-3.7 and 3.9, WP0k): integer geometry, noise, graphs, fields, search and the
// route guard, each checked against a brute-force or independent reference, plus the Math spy over module load and every export.
import { describe, expect, it, vi } from "vitest";
import { fixedLayout } from "../src/coliseum";
import { findPath } from "../src/pathfind";
import { descentPath, segmentBlocked, walkField16 } from "../src/gridTopology";
import { tryAttempt } from "../src/mapgen";
import { MASK_MOVE, TILE_FLOOR, TILE_WALL, mapFromTiles } from "../src/map";
import type { StyleState } from "../src/styler";
import { zoneStylerHook } from "../src/zoneStyle";
import { mulberry32 } from "../src/rng";
import { pseudoAngle as generatorPseudoAngle } from "../src/zones";
import * as F from "../src/zoneStyle/features";
import { flowPath, makeNoise } from "../src/zoneStyle/kit";
import type { Edge, Node } from "../src/zoneStyle/features";
import type { BaseCtx, RouteGuardBuilder } from "../src/zoneStyle/types";
import { rig } from "./zoneStyleRig";

const node = (x: number, y: number, kind: "camp" | "door" = "camp", camp = -1, elite = false): Node => ({ x, y, kind, camp, elite });
const key = (e: Edge): string => `${e[0]}-${e[1]}`;

// ------------------------------------------------------------------------------------------------ 3.3
describe("integer geometry (3.3)", () => {
  it("DIR16 is 16 vectors of length ~1024 at 22.5 degree steps, from +x toward +y", () => {
    expect(F.DIR16.length).toBe(16);
    F.DIR16.forEach(([x, y], k) => {
      expect(Math.abs(Math.sqrt(x * x + y * y) - 1024), `length of ${k}`).toBeLessThan(2);
      const ang = (Math.atan2(y, x) * 180) / Math.PI;
      const want = k * 22.5 > 180 ? k * 22.5 - 360 : k * 22.5;
      expect(Math.abs(ang - want), `angle of ${k}`).toBeLessThan(0.2);
    });
    expect(F.DIR16[4]).toEqual([0, 1024]); // +y is down the screen
  });

  it("dirIndex16 is argmax of the dot product, ties lowest, (0,0) -> 0, and matches the true nearest direction", () => {
    expect(F.dirIndex16(0, 0)).toBe(0);
    for (let k = 0; k < 16; k++) expect(F.dirIndex16(F.DIR16[k][0], F.DIR16[k][1]), `axis ${k}`).toBe(k);
    expect(F.dirIndex16(5, 0)).toBe(0);
    expect(F.dirIndex16(0, 5)).toBe(4);
    expect(F.dirIndex16(-5, 0)).toBe(8);
    expect(F.dirIndex16(0, -5)).toBe(12);
    // a vector halfway between two directions is a tie in the dot products only when the table is symmetric: lowest k wins
    expect(F.dirIndex16(1000, 0)).toBe(0);
    const r = mulberry32(5);
    for (let i = 0; i < 2000; i++) {
      const dx = Math.floor(r() * 401) - 200, dy = Math.floor(r() * 401) - 200;
      if (dx === 0 && dy === 0) continue;
      let best = 0, bd = -Infinity;
      for (let k = 0; k < 16; k++) { const d = dx * F.DIR16[k][0] + dy * F.DIR16[k][1]; if (d > bd) { bd = d; best = k; } }
      expect(F.dirIndex16(dx, dy)).toBe(best);
      // and within half a step (11.25 deg + table rounding) of the true angle
      let ang = (Math.atan2(dy, dx) * 180) / Math.PI;
      if (ang < 0) ang += 360;
      const diff = Math.abs(ang - best * 22.5);
      expect(Math.min(diff, 360 - diff)).toBeLessThan(11.4);
    }
  });

  it("dirSep16 is the circular distance 0..8", () => {
    for (let a = 0; a < 16; a++) {
      for (let b = 0; b < 16; b++) {
        const d = Math.abs(a - b);
        expect(F.dirSep16(a, b)).toBe(Math.min(d, 16 - d));
        expect(F.dirSep16(a, b)).toBe(F.dirSep16(b, a));
      }
    }
    expect(F.dirSep16(0, 8)).toBe(8);
    expect(F.dirSep16(15, 1)).toBe(2);
    expect(F.dirSep16(-1, 1)).toBe(2);
    expect(F.dirSep16(17, 1)).toBe(0);
  });

  it("isqrt is exact: floor(sqrt(n)) for every n up to 20,000 and around large squares", () => {
    for (let n = 0; n <= 20000; n++) {
      const r = F.isqrt(n);
      expect(r * r).toBeLessThanOrEqual(n);
      expect((r + 1) * (r + 1)).toBeGreaterThan(n);
    }
    for (const k of [94906264, 67108864, 12345678, 1, 2, 3]) {
      expect(F.isqrt(k * k)).toBe(k);
      expect(F.isqrt(k * k - 1)).toBe(k - 1);
      expect(F.isqrt(k * k + 2 * k)).toBe(k);
      expect(F.isqrt(k * k + 2 * k + 1)).toBe(k + 1);
    }
    expect(F.isqrt(0)).toBe(0);
    expect(F.isqrt(-4)).toBe(0);
  });

  it("dist2 and segDist2: exact on integers, the point-to-segment distance in every region", () => {
    expect(F.dist2(1, 2, 4, 6)).toBe(25);
    expect(F.segDist2(5, 5, 0, 0, 10, 0)).toBe(25); // above the middle
    expect(F.segDist2(-3, 4, 0, 0, 10, 0)).toBe(25); // past the start: distance to a
    expect(F.segDist2(13, 4, 0, 0, 10, 0)).toBe(25); // past the end: distance to b
    expect(F.segDist2(3, 3, 7, 7, 7, 7)).toBe(32); // a degenerate segment
    expect(F.segDist2(0, 5, 0, 0, 10, 10)).toBe(12.5); // 25 / 2: one division
    const r = mulberry32(8);
    for (let i = 0; i < 500; i++) {
      const p = [0, 1, 2, 3, 4, 5].map(() => Math.floor(r() * 41) - 20);
      const got = F.segDist2(p[0], p[1], p[2], p[3], p[4], p[5]);
      // sample the segment finely: the minimum can not be below the answer by more than the sampling error
      let best = Infinity;
      for (let s = 0; s <= 2000; s++) {
        const t = s / 2000;
        const dx = p[0] - (p[2] + (p[4] - p[2]) * t), dy = p[1] - (p[3] + (p[5] - p[3]) * t);
        best = Math.min(best, dx * dx + dy * dy);
      }
      expect(got).toBeLessThanOrEqual(best + 1e-9);
      expect(got).toBeGreaterThan(best - 0.5);
    }
  });

  it("discOffsets lists the tile centres within r4/4 tiles, in (dy, dx) order, and caches", () => {
    for (const r4 of [0, 1, 3, 4, 7, 10, 13, 20, 26, 30]) {
      const d = F.discOffsets(r4);
      expect(F.discOffsets(r4)).toBe(d);
      const want: Array<[number, number]> = [];
      for (let dy = -10; dy <= 10; dy++) for (let dx = -10; dx <= 10; dx++) if (16 * (dx * dx + dy * dy) <= r4 * r4) want.push([dx, dy]);
      expect(d.map((o) => [o[0], o[1]])).toEqual(want);
    }
    expect(F.discOffsets(0).length).toBe(1);
    expect(F.discOffsets(4).length).toBe(5); // radius 1: the plus
    expect(F.discOffsets(6).length).toBe(9); // 1.5: the 3x3 (corners at 1.414)
    expect(F.discOffsets(-3).length).toBe(0);
  });

  it("inBeam: ahead of the origin and within half4/4 tiles of the ray", () => {
    expect(F.inBeam(10, 0, 1, 0, 8)).toBe(true);
    expect(F.inBeam(10, 2, 1, 0, 8)).toBe(true); // exactly 2 tiles off: 16 * 4 <= 64
    expect(F.inBeam(10, 3, 1, 0, 8)).toBe(false);
    expect(F.inBeam(-10, 0, 1, 0, 8)).toBe(false); // behind
    expect(F.inBeam(0, 5, 1, 0, 8)).toBe(false); // dot = 0 is not ahead
    expect(F.inBeam(0, 0, 1, 0, 8)).toBe(false);
    // a slanted axis, against float geometry
    const r = mulberry32(21);
    for (let i = 0; i < 3000; i++) {
      const dx = Math.floor(r() * 41) - 20, dy = Math.floor(r() * 41) - 20, ux = Math.floor(r() * 21) - 10, uy = Math.floor(r() * 21) - 10;
      if (ux === 0 && uy === 0) continue;
      const half4 = 1 + Math.floor(r() * 12);
      const len = Math.sqrt(ux * ux + uy * uy);
      const along = (dx * ux + dy * uy) / len, across = Math.abs(dx * uy - dy * ux) / len;
      const want = along > 0 && across <= half4 / 4;
      // skip float-borderline cases (the integer test is exact, the float one is not)
      if (Math.abs(across - half4 / 4) < 1e-9 || Math.abs(along) < 1e-9) continue;
      expect(F.inBeam(dx, dy, ux, uy, half4), `(${dx},${dy}) u(${ux},${uy}) half4 ${half4}`).toBe(want);
    }
  });

  it("pseudoAngle agrees with zones.ts on 10,000 vectors and is monotone in the true angle", () => {
    const r = mulberry32(77);
    for (let i = 0; i < 10000; i++) {
      const dx = Math.floor(r() * 301) - 150 + (i % 3 === 0 ? 0.5 : 0), dy = Math.floor(r() * 301) - 150 + (i % 5 === 0 ? 0.5 : 0);
      if (dx === 0 && dy === 0) continue;
      expect(Object.is(F.pseudoAngle(dx, dy), generatorPseudoAngle(dx, dy)), `(${dx},${dy})`).toBe(true);
    }
    let prev = -1;
    for (let a = 0; a < 720; a++) {
      const th = (a * Math.PI) / 360 + 1e-6;
      const p = F.pseudoAngle(Math.cos(th) * 100, Math.sin(th) * 100);
      expect(p).toBeGreaterThan(prev);
      expect(p).toBeLessThan(4);
      prev = p;
    }
  });
});

// ------------------------------------------------------------------------------------------------ 3.4
describe("quantized noise (3.4)", () => {
  const ctx = { noise: makeNoise(0x1234abcd) };
  it("noiseQ and fbmQ are floor(noise * 1024) in 0..1023 and deterministic", () => {
    const seen = new Set<number>();
    for (let y = -5; y < 60; y += 3) {
      for (let x = -5; x < 60; x += 3) {
        const q = F.noiseQ(ctx, x, y, 5, 41);
        expect(q).toBe(Math.floor(ctx.noise.value(x, y, 5, 41) * 1024));
        expect(Number.isInteger(q) && q >= 0 && q <= 1023).toBe(true);
        expect(F.noiseQ(ctx, x, y, 5, 41)).toBe(q);
        const f = F.fbmQ(ctx, x, y, 9, 3, 7);
        expect(f).toBe(Math.floor(ctx.noise.fbm(x, y, 9, 3, 7) * 1024));
        expect(Number.isInteger(f) && f >= 0 && f <= 1023).toBe(true);
        seen.add(q);
      }
    }
    expect(seen.size).toBeGreaterThan(100); // it varies
    expect(F.noiseQ({ noise: makeNoise(1) }, 10, 10, 5, 41)).not.toBe(F.noiseQ({ noise: makeNoise(2) }, 10, 10, 5, 41) + 100000);
  });
});

// ------------------------------------------------------------------------------------------------ 3.5
describe("graphs over nodes (3.5)", () => {
  const randomNodes = (seed: number, n: number): Node[] => {
    const r = mulberry32(seed);
    const out: Node[] = [];
    while (out.length < n) {
      const x = Math.floor(r() * 60), y = Math.floor(r() * 60);
      if (!out.some((p) => p.x === x && p.y === y)) out.push(node(x, y));
    }
    return out;
  };
  const weight = (nodes: Node[], edges: readonly Edge[]): number => edges.reduce((s, [a, b]) => s + Math.sqrt(F.dist2(nodes[a].x, nodes[a].y, nodes[b].x, nodes[b].y)), 0);

  it("primMST spans, is minimal (checked against Kruskal), starts at the root and breaks ties by (d2, a, b)", () => {
    for (let g = 0; g < 40; g++) {
      const nodes = randomNodes(300 + g, 5 + (g % 6));
      const mst = F.primMST(nodes, g % nodes.length);
      expect(mst.length).toBe(nodes.length - 1);
      expect(mst.every(([a, b]) => a < b)).toBe(true);
      expect(F.cyclomatic(nodes.length, mst)).toBe(0);
      // Kruskal
      const all: Edge[] = [];
      for (let a = 0; a < nodes.length; a++) for (let b = a + 1; b < nodes.length; b++) all.push([a, b]);
      all.sort((p, q) => F.dist2(nodes[p[0]].x, nodes[p[0]].y, nodes[p[1]].x, nodes[p[1]].y) - F.dist2(nodes[q[0]].x, nodes[q[0]].y, nodes[q[1]].x, nodes[q[1]].y) || p[0] - q[0] || p[1] - q[1]);
      const parent = nodes.map((_, i) => i);
      const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
      const kr: Edge[] = [];
      for (const [a, b] of all) if (find(a) !== find(b)) { parent[find(a)] = find(b); kr.push([a, b]); }
      expect(weight(nodes, mst)).toBeCloseTo(weight(nodes, kr), 9);
    }
    const square = [node(0, 0), node(1, 0), node(1, 1), node(0, 1)];
    expect(F.primMST(square, 0).map(key)).toEqual(["0-1", "0-3", "1-2"]);
    // the root decides the insertion order, a < b stays
    expect(F.primMST(square, 2).map(key)).toEqual(["1-2", "0-1", "0-3"]);
    expect(F.primMST([], 0)).toEqual([]);
    expect(F.primMST([node(3, 3)], 0)).toEqual([]);
  });

  it("gabrielEdges and rngEdges follow their definitions; MST is inside RNG is inside Gabriel", () => {
    const square = [node(0, 0), node(1, 0), node(1, 1), node(0, 1)];
    expect(F.gabrielEdges(square).map(key)).toEqual(["0-1", "0-2", "0-3", "1-2", "1-3", "2-3"]); // cocircular: kept
    expect(F.rngEdges(square).map(key)).toEqual(["0-1", "0-3", "1-2", "2-3"]);
    // a point inside the diametral circle removes the edge
    const tri = [node(0, 0), node(10, 0), node(5, 1)];
    expect(F.gabrielEdges(tri).map(key)).toEqual(["0-2", "1-2"]);
    for (let g = 0; g < 40; g++) {
      const nodes = randomNodes(900 + g, 6 + (g % 5));
      const gg = new Set(F.gabrielEdges(nodes).map(key)), rr = new Set(F.rngEdges(nodes).map(key));
      for (const e of rr) expect(gg.has(e), `RNG edge ${e} in Gabriel (graph ${g})`).toBe(true);
      for (const e of F.primMST(nodes, 0)) expect(rr.has(key(e)), `MST edge ${key(e)} in RNG (graph ${g})`).toBe(true);
      // the definition, by float geometry
      for (let a = 0; a < nodes.length; a++) {
        for (let b = a + 1; b < nodes.length; b++) {
          const mx = (nodes[a].x + nodes[b].x) / 2, my = (nodes[a].y + nodes[b].y) / 2, rad2 = F.dist2(nodes[a].x, nodes[a].y, nodes[b].x, nodes[b].y) / 4;
          const inside = nodes.some((k, i) => i !== a && i !== b && (k.x - mx) ** 2 + (k.y - my) ** 2 < rad2);
          expect(gg.has(`${a}-${b}`)).toBe(!inside);
        }
      }
    }
  });

  it("addShortcuts adds, in place, the pair with the largest graph/straight ratio over minRatio, recomputing after each", () => {
    const nodes = [node(0, 0), node(10, 0), node(20, 0), node(20, 10), node(10, 10), node(0, 10)];
    const path: Edge[] = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5]];
    const edges = path.slice();
    const added = F.addShortcuts(nodes, edges, 5, 1.8, 30);
    expect(added.map(key)).toEqual(["0-5", "1-4"]); // ratios 5 and then 3; the rest are below 1.8
    expect(edges.map(key)).toEqual([...path.map(key), "0-5", "1-4"]);
    expect(F.cyclomatic(6, edges)).toBe(2);
    // max, ratio and length limits
    expect(F.addShortcuts(nodes, path.slice(), 1, 1.8, 30).map(key)).toEqual(["0-5"]);
    expect(F.addShortcuts(nodes, path.slice(), 5, 1.8, 8)).toEqual([]);
    expect(F.addShortcuts(nodes, path.slice(), 5, 6, 30)).toEqual([]);
    expect(F.addShortcuts(nodes, path.slice(), 0, 1.8, 30)).toEqual([]);
    // a disconnected pair has an infinite ratio and is joined first
    const split = F.addShortcuts(nodes, [[0, 1], [3, 4]], 1, 1.8, 30);
    expect(split.length).toBe(1);
  });

  it("cyclomatic is E - V + C", () => {
    expect(F.cyclomatic(0, [])).toBe(0);
    expect(F.cyclomatic(3, [])).toBe(0);
    expect(F.cyclomatic(3, [[0, 1], [1, 2]])).toBe(0);
    expect(F.cyclomatic(3, [[0, 1], [1, 2], [0, 2]])).toBe(1);
    expect(F.cyclomatic(4, [[0, 1], [2, 3]])).toBe(0);
    expect(F.cyclomatic(5, [[0, 1], [1, 2], [0, 2], [2, 3], [3, 4], [2, 4]])).toBe(2);
  });

  it("campNodes: the camps in order with their elite flags, then the front door in the ring band nearest the centroid", () => {
    const W = 136, H = 136, n = W * H;
    const fl = fixedLayout();
    const mask = new Uint8Array(n), tiles = new Uint8Array(n);
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) if (!fl.fp[y * W + x]) mask[y * W + x] = 1;
    const camps = [{ x: 20, y: 30, elite: true, index: 7 }, { x: 50, y: 40, elite: false, index: 9 }, { x: 30, y: 100 }];
    const centroid = { x: 30.25, y: 50.75 };
    const c = { w: W, h: H, mask, tiles, zone: { bbox: { x: 1, y: 1, w: W - 2, h: H - 2 }, centroid }, camps };
    const nodes = F.campNodes(c);
    expect(nodes.length).toBe(4);
    expect(nodes.slice(0, 3).map((p) => [p.x, p.y, p.kind, p.camp, p.elite])).toEqual([[20, 30, "camp", 7, true], [50, 40, "camp", 9, false], [30, 100, "camp", 2, false]]);
    const door = nodes[3];
    expect(door.kind).toBe("door");
    expect(door.camp).toBe(-1);
    expect(door.elite).toBe(false);
    // brute force: among zone floor tiles with 4 < distFp <= 7 the one nearest the centroid, ties lowest index
    let best = -1, bd = Infinity;
    for (let i = 0; i < n; i++) {
      if (!mask[i] || tiles[i] !== TILE_FLOOR || fl.distFp[i] <= 4 || fl.distFp[i] > 7) continue;
      const x = i % W, y = (i - x) / W, d = (x + 0.5 - centroid.x) ** 2 + (y + 0.5 - centroid.y) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    expect(best).toBeGreaterThanOrEqual(0);
    expect(door.y * W + door.x).toBe(best);
    expect(fl.distFp[door.y * W + door.x]).toBeGreaterThan(4);
    // no floor in the band: no door; a grid that is not the generator's size: no door
    const walled = tiles.slice();
    for (let i = 0; i < n; i++) if (fl.distFp[i] > 4 && fl.distFp[i] <= 7) walled[i] = TILE_WALL;
    expect(F.campNodes({ ...c, tiles: walled }).length).toBe(3);
    const small = F.campNodes({ w: 40, h: 40, mask: new Uint8Array(1600).fill(1), tiles: new Uint8Array(1600), zone: { bbox: { x: 0, y: 0, w: 40, h: 40 }, centroid: { x: 20, y: 20 } }, camps: [{ x: 5, y: 5 }, { x: 10, y: 12 }, { x: 30, y: 30 }] });
    expect(small.length).toBe(3);
    expect(F.campNodes({ ...c, camps: [] }).length).toBe(1);
    // the context's camps list every camp of the map: the ones whose centre is outside the zone are left out, the rest keep their order
    const everyCamp = [{ x: 68, y: 68, elite: true, index: 1 }, camps[0], { x: -3, y: 4, index: 5 }, { x: 500, y: 2 }, camps[1], { x: 0, y: 0, index: 8 }, camps[2]];
    const filtered = F.campNodes({ ...c, camps: everyCamp });
    expect(filtered.map((p) => [p.x, p.y, p.kind, p.camp, p.elite])).toEqual(nodes.map((p) => [p.x, p.y, p.kind, p.camp, p.elite]).map((row, i) => (i === 2 ? [30, 100, "camp", 6, false] : row)));
    expect(F.campNodes({ ...c, camps: [camps[0], camps[1], camps[2]] })).toEqual(nodes);
  });
});

// ------------------------------------------------------------------------------------------------ 3.6
describe("fields, smoothing and components (3.6)", () => {
  const randomSet = (seed: number, w: number, h: number, p: number): Uint8Array => {
    const r = mulberry32(seed);
    const s = new Uint8Array(w * h);
    for (let i = 0; i < s.length; i++) s[i] = r() < p ? 1 : 0;
    return s;
  };

  it("chamferFrom is the 3-4 chamfer distance (3 * max + min of the offsets) to the nearest source, in thirds of a tile", () => {
    const w = 31, h = 23;
    for (let g = 0; g < 8; g++) {
      const r = mulberry32(60 + g);
      const sources: number[] = [];
      for (let k = 0; k < 1 + (g % 4); k++) sources.push(Math.floor(r() * w * h));
      const d = F.chamferFrom(sources, w, h);
      for (let i = 0; i < w * h; i++) {
        let want = Infinity;
        for (const s of sources) {
          const dx = Math.abs((i % w) - (s % w)), dy = Math.abs(Math.floor(i / w) - Math.floor(s / w));
          want = Math.min(want, 3 * Math.max(dx, dy) + Math.min(dx, dy));
        }
        if (d[i] !== want) throw new Error(`grid ${g} tile ${i}: ${d[i]} against ${want}`);
      }
    }
    expect(Array.from(F.chamferFrom([], 4, 3))).toEqual(new Array(12).fill(F.CHAMFER_FAR));
    expect(F.chamferFrom([5, 999, -2], 4, 3)[5]).toBe(0);
  });

  it("argmaxIn: the largest value inside the mask and range, ties lowest, -1 when empty", () => {
    const field = Int32Array.from([5, 9, 9, 2, 9, 1, 7, 7]);
    const mask = Uint8Array.from([1, 0, 1, 1, 1, 1, 1, 1]);
    expect(F.argmaxIn(field, mask)).toBe(2);
    expect(F.argmaxIn(field, mask, 3)).toBe(4);
    expect(F.argmaxIn(field, mask, 5)).toBe(6);
    expect(F.argmaxIn(field, mask, 0, 2)).toBe(0);
    expect(F.argmaxIn(field, mask, 1, 2)).toBe(-1);
    expect(F.argmaxIn(field, new Uint8Array(8))).toBe(-1);
    expect(F.argmaxIn(Int32Array.from([-5, -3, -9]), Uint8Array.from([1, 1, 1]))).toBe(1);
    expect(F.argmaxIn(field, mask, 0, 99)).toBe(2);
  });

  it("majoritySmooth is the 3x3 majority (self included), limited to allow, repeated, on a new array", () => {
    const w = 23, h = 17;
    for (let g = 0; g < 8; g++) {
      const set = randomSet(200 + g, w, h, 0.5);
      const allow = randomSet(250 + g, w, h, 0.85);
      const orig = set.slice();
      for (const passes of [0, 1, 2, 3]) {
        for (const threshold of [undefined, 3, 7]) {
          let cur = set.map((v) => (v ? 1 : 0)) as Uint8Array;
          for (let p = 0; p < passes; p++) {
            const next = new Uint8Array(w * h);
            for (let y = 0; y < h; y++) {
              for (let x = 0; x < w; x++) {
                let c = 0;
                for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
                  const nx = x + dx, ny = y + dy;
                  if (nx >= 0 && ny >= 0 && nx < w && ny < h) c += cur[ny * w + nx];
                }
                next[y * w + x] = allow[y * w + x] && c >= (threshold ?? 5) ? 1 : 0;
              }
            }
            cur = next;
          }
          const got = F.majoritySmooth(set, allow, w, h, passes, threshold);
          expect(Array.from(got), `grid ${g} passes ${passes} threshold ${threshold}`).toEqual(Array.from(cur));
          expect(got).not.toBe(set);
        }
      }
      expect(Array.from(set)).toEqual(Array.from(orig));
    }
  });

  it("componentsOf labels in row-major order of each first tile, sizes in label order, 4 or 8 connected; pruneSmall clears the small ones", () => {
    const w = 12, h = 8;
    const rows = [
      "##..........",
      "#.....#.....",
      "....#.#.##..",
      "......#.##..",
      ".####...##..",
      "...#....#...",
      "..#.....#.#.",
      "............",
    ];
    const set = new Uint8Array(w * h);
    rows.forEach((row, y) => [...row].forEach((ch, x) => { set[y * w + x] = ch === "#" ? 1 : 0; }));
    const four = F.componentsOf(set, w, h, false);
    const eight = F.componentsOf(set, w, h, true);
    // reference: flood in test code
    const reference = (conn: number[][]): number[] => {
      const lab = new Int32Array(w * h).fill(-1);
      const sizes: number[] = [];
      for (let s = 0; s < w * h; s++) {
        if (!set[s] || lab[s] >= 0) continue;
        const stack = [s];
        lab[s] = sizes.length;
        let n = 0;
        while (stack.length) {
          const i = stack.pop()!;
          n++;
          for (const [dx, dy] of conn) {
            const x = (i % w) + dx, y = Math.floor(i / w) + dy;
            if (x < 0 || y < 0 || x >= w || y >= h) continue;
            const j = y * w + x;
            if (set[j] && lab[j] < 0) { lab[j] = sizes.length; stack.push(j); }
          }
        }
        sizes.push(n);
      }
      return sizes;
    };
    expect(four.sizes).toEqual(reference([[1, 0], [-1, 0], [0, 1], [0, -1]]));
    expect(eight.sizes).toEqual(reference([[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]));
    expect(eight.sizes.length).toBeLessThan(four.sizes.length);
    for (let i = 0; i < w * h; i++) expect(four.label[i] >= 0).toBe(set[i] === 1);
    // labels are in order of first tile
    let seen = -1;
    for (let i = 0; i < w * h; i++) if (four.label[i] > seen) { expect(four.label[i]).toBe(seen + 1); seen = four.label[i]; }
    // prune
    const copy = set.slice();
    const cleared = F.pruneSmall(copy, w, h, 4, false);
    const small = four.sizes.filter((s) => s < 4).reduce((a, b) => a + b, 0);
    expect(cleared).toBe(small);
    for (let i = 0; i < w * h; i++) expect(copy[i] === 1).toBe(set[i] === 1 && four.sizes[four.label[i]] >= 4);
    const copy8 = set.slice();
    expect(F.pruneSmall(copy8, w, h, 4, true)).toBe(eight.sizes.filter((s) => s < 4).reduce((a, b) => a + b, 0));
    expect(F.pruneSmall(copy8, w, h, 4, true)).toBe(0);
    expect(F.pruneSmall(new Uint8Array(w * h), w, h, 4, true)).toBe(0);
  });

  it("floodAbove fills {value >= tau} 4-connected from the seed within allow; empty when the seed fails", () => {
    const w = 20, h = 14;
    for (let g = 0; g < 6; g++) {
      const r = mulberry32(400 + g);
      const value = new Int32Array(w * h);
      for (let i = 0; i < w * h; i++) value[i] = Math.floor(r() * 100);
      const allow = randomSet(450 + g, w, h, 0.9);
      const seed = Math.floor(r() * w * h);
      for (const tau of [0, 30, 50, 70]) {
        const got = F.floodAbove(value, tau, seed, allow, w, h);
        // reference flood
        const lab = new Uint8Array(w * h);
        let size = 0;
        if (allow[seed] && value[seed] >= tau) {
          const stack = [seed];
          lab[seed] = 1;
          while (stack.length) {
            const i = stack.pop()!;
            size++;
            const x = i % w, y = Math.floor(i / w);
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
              const nx = x + dx, ny = y + dy;
              if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
              const j = ny * w + nx;
              if (!lab[j] && allow[j] && value[j] >= tau) { lab[j] = 1; stack.push(j); }
            }
          }
        }
        expect(got.size).toBe(size);
        expect(Array.from(got.set)).toEqual(Array.from(lab));
      }
    }
    expect(F.floodAbove(new Int32Array(4), 1, 0, new Uint8Array(4).fill(1), 2, 2).size).toBe(0);
    expect(F.floodAbove(new Int32Array(4), 0, 9, new Uint8Array(4).fill(1), 2, 2).size).toBe(0);
  });

  it("tauForArea returns the largest tau whose flood still has the target size, or the whole region when it never does", () => {
    const w = 24, h = 18;
    for (let g = 0; g < 12; g++) {
      const r = mulberry32(520 + g);
      // a smooth-ish field with a peak: value = 1000 - distance * 40 + a little noise
      const px = 4 + Math.floor(r() * 16), py = 3 + Math.floor(r() * 12);
      const value = new Int32Array(w * h);
      for (let i = 0; i < w * h; i++) {
        const x = i % w, y = Math.floor(i / w);
        value[i] = 1000 - 40 * Math.floor(Math.sqrt((x - px) ** 2 + (y - py) ** 2)) + Math.floor(r() * 30);
      }
      const allow = randomSet(560 + g, w, h, 0.93);
      allow[py * w + px] = 1;
      const seed = py * w + px;
      const sizeAt = (tau: number): number => F.floodAbove(value, tau, seed, allow, w, h).size;
      const lo = Math.min(...Array.from(value)), hi = value[seed];
      const maxSize = sizeAt(lo - 1);
      for (const target of [1, 5, 30, 120, 300, maxSize, maxSize + 40]) {
        const tau = F.tauForArea(value, seed, allow, w, h, target);
        if (maxSize < target) {
          expect(sizeAt(tau), `grid ${g} target ${target}`).toBe(maxSize);
        } else {
          // the largest tau (scanning every integer) with size >= target
          let want = lo - 1;
          for (let t = hi; t >= lo - 1; t--) if (sizeAt(t) >= target) { want = t; break; }
          expect(tau, `grid ${g} target ${target}`).toBe(want);
          expect(sizeAt(tau)).toBeGreaterThanOrEqual(target);
          expect(sizeAt(tau + 1)).toBeLessThan(target);
        }
      }
    }
    // a seed outside allow: an empty flood at its own value
    expect(F.tauForArea(Int32Array.from([5, 6]), 0, Uint8Array.from([0, 1]), 2, 1, 1)).toBe(5);
  });
});

// ------------------------------------------------------------------------------------------------ 3.7
describe("search (3.7)", () => {
  const zoneRows = (seed: number, w: number, h: number): string[] => {
    const r = mulberry32(seed);
    return Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => {
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) return "#";
      const v = r();
      return v < 0.12 ? "W" : v < 0.2 ? "," : ".";
    }).join(""));
  };

  it("noisyPath is kit.flowPath with typed arrays: the same path for a callback cost and for a cost map", () => {
    let found = 0;
    for (let g = 0; g < 12; g++) {
      const w = 40, h = 32;
      const { shape: c } = rig(zoneRows(2000 + g, w, h));
      const floor: number[] = [];
      for (let i = 0; i < w * h; i++) if (c.mask[i] && c.tiles[i] === TILE_FLOOR) floor.push(i);
      const r = mulberry32(3000 + g);
      const costMap = new Int32Array(w * h);
      for (let i = 0; i < w * h; i++) costMap[i] = Math.floor(r() * 25) * (i % 7 === 0 ? 4 : 1);
      for (let k = 0; k < 6; k++) {
        const a = floor[Math.floor(r() * floor.length)], b = floor[Math.floor(r() * floor.length)], salt = 11 + k;
        const want = flowPath(c, a, b, salt, (j) => costMap[j]);
        expect(F.noisyPath(c, a, b, salt, (j) => costMap[j])).toEqual(want);
        expect(F.noisyPath(c, a, b, salt, costMap)).toEqual(want);
        expect(F.noisyPath(c, a, b, salt)).toEqual(flowPath(c, a, b, salt));
        if (want.length > 1) {
          found++;
          expect(want[0]).toBe(a);
          expect(want[want.length - 1]).toBe(b);
          for (let s = 1; s < want.length; s++) {
            expect(Math.max(Math.abs((want[s] % w) - (want[s - 1] % w)), Math.abs(Math.floor(want[s] / w) - Math.floor(want[s - 1] / w)))).toBe(1);
            expect(c.mask[want[s]] === 1 && c.tiles[want[s]] === TILE_FLOOR).toBe(true);
          }
        }
      }
    }
    expect(found).toBeGreaterThan(30);
  });

  it("noisyPath: [a] for a === b, empty when unreachable, and a penalty steers it", () => {
    const { shape: c } = rig([
      "#########",
      "#.......#",
      "#.......#",
      "#.......#",
      "#########",
    ]);
    const at = (x: number, y: number): number => y * 9 + x;
    expect(F.noisyPath(c, at(2, 2), at(2, 2), 1)).toEqual([at(2, 2)]);
    const wall = rig(["#######", "#..W..#", "#..W..#", "#..W..#", "#######"]).shape;
    expect(F.noisyPath(wall, 1 * 7 + 1, 1 * 7 + 5, 1)).toEqual([]);
    // a heavy penalty on the middle row sends the path along the top or bottom row
    const mid = new Int32Array(9 * 5);
    for (let x = 0; x < 9; x++) mid[2 * 9 + x] = 5000;
    const path = F.noisyPath(c, at(1, 1), at(7, 1), 3, mid);
    expect(path.every((i) => i < 2 * 9 || i >= 3 * 9)).toBe(true);
  });

  /** Brute force over every chain for small inputs. */
  const bestChain = (value: number[], gmin: number, gmax: number, target: number, pen: number): number => {
    let best = -Infinity;
    const go = (t: number, total: number): void => {
      best = Math.max(best, total);
      for (let g = gmin; g <= gmax; g++) if (t + g < value.length) go(t + g, total + value[t + g] - pen * Math.abs(g - target));
    };
    for (let t = 0; t < value.length; t++) go(t, value[t]);
    return best;
  };

  it("viterbiRows returns the best chain (brute force), ascending, with gaps in range; [] when nothing scores above 0", () => {
    for (let g = 0; g < 60; g++) {
      const r = mulberry32(700 + g);
      const n = 6 + Math.floor(r() * 14);
      const value = Array.from({ length: n }, () => Math.floor(r() * 30) - 10);
      const gmin = 2 + (g % 3), gmax = gmin + 1 + (g % 3), target = gmin + 1, pen = g % 4;
      const got = F.viterbiRows(Int32Array.from(value), 100, gmin, gmax, target, pen);
      const best = bestChain(value, gmin, gmax, target, pen);
      if (best <= 0) { expect(got).toEqual([]); continue; }
      let total = 0;
      got.forEach((t, k) => {
        total += value[t - 100];
        if (k > 0) {
          expect(t - got[k - 1]).toBeGreaterThanOrEqual(gmin);
          expect(t - got[k - 1]).toBeLessThanOrEqual(gmax);
          total -= pen * Math.abs(t - got[k - 1] - target);
        }
      });
      expect(total, `case ${g}`).toBe(best);
    }
    expect(F.viterbiRows(new Int32Array(0), 0, 7, 9, 8, 2)).toEqual([]);
    expect(F.viterbiRows(Int32Array.from([-3, -1, -2]), 0, 1, 2, 1, 0)).toEqual([]);
    expect(F.viterbiRows(Int32Array.from([0, 0, 0]), 0, 1, 2, 1, 0)).toEqual([]);
    // ties: the lowest end position; the lowest earlier position
    expect(F.viterbiRows(Int32Array.from([4, 4, 0]), 10, 5, 6, 5, 1)).toEqual([10]);
    expect(F.viterbiRows(Int32Array.from([3, 0, 0, 3, 0, 5]), 20, 2, 3, 2, 0)).toEqual([20, 23, 25]);
    expect(F.viterbiRows(Int32Array.from([1, 1, 1, 1, 1, 1, 1, 1, 1]), 0, 1, 1, 1, 0)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    // a gap penalty pulls rows to the target gap
    const ones = new Int32Array(28).fill(1);
    expect(F.viterbiRows(ones, 0, 7, 9, 9, 5)).toEqual([0, 9, 18, 27]);
    expect(F.viterbiRows(ones, 0, 7, 9, 7, 5)).toEqual([0, 7, 14, 21]); // starts 0..6 tie: the lowest end wins
  });

  it("viterbiPath is the cheapest path with at most one state change per step (brute force); ties go to the smaller |offset|, then the lower", () => {
    for (let g = 0; g < 40; g++) {
      const r = mulberry32(1300 + g);
      const n = 3 + Math.floor(r() * 4), half = 1 + (g % 2);
      const W = 2 * half + 1;
      const cost = Array.from({ length: n }, () => Array.from({ length: W }, () => Math.floor(r() * 12)));
      const jog = Math.floor(r() * 6);
      const total = (p: number[]): number => p.reduce((s, o, k) => s + cost[k][o + half] + (k > 0 && o !== p[k - 1] ? jog : 0), 0);
      let best = Infinity;
      const walk = (p: number[]): void => {
        if (p.length === n) { best = Math.min(best, total(p)); return; }
        for (let o = -half; o <= half; o++) if (p.length === 0 || Math.abs(o - p[p.length - 1]) <= 1) walk([...p, o]);
      };
      walk([]);
      const calls: number[] = [];
      const got = Array.from(F.viterbiPath(n, half, (s, dt) => { calls.push(s * 100 + dt); return cost[s][dt + half]; }, jog));
      expect(got.length).toBe(n);
      for (let k = 1; k < n; k++) expect(Math.abs(got[k] - got[k - 1])).toBeLessThanOrEqual(1);
      expect(total(got), `case ${g}`).toBe(best);
      expect(new Set(calls).size).toBe(calls.length); // every state read once
    }
    expect(Array.from(F.viterbiPath(5, 2, () => 0, 3))).toEqual([0, 0, 0, 0, 0]);
    expect(Array.from(F.viterbiPath(1, 2, (_, dt) => (dt === 0 ? 5 : 1), 3))).toEqual([-1]); // |1| ties, the lower offset
    expect(Array.from(F.viterbiPath(0, 2, () => 0, 3))).toEqual([]);
  });
});

// ------------------------------------------------------------------------------------------------ 3.9
describe("route guard (3.9)", () => {
  /** Two zones either side of a free central column. Zone A is x in 1..37, zone B x in 42..78, the column 38..41 belongs to neither (`adjacent`: B starts at 38). */
  function world(seed: number, wallsA: number, wallsB: number, members = 5, adjacent = false) {
    const w = 80, h = 50, n = w * h;
    const r = mulberry32(seed);
    const tiles = new Uint8Array(n);
    const maskA = new Uint8Array(n), maskB = new Uint8Array(n);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1) { tiles[i] = TILE_WALL; continue; }
        if (x <= 37) { maskA[i] = 1; if (r() < wallsA) tiles[i] = TILE_WALL; }
        else if (x >= (adjacent ? 38 : 42)) { maskB[i] = 1; if (r() < wallsB) tiles[i] = TILE_WALL; }
      }
    }
    const centre = 25 * w + 40;
    const centreWalk = walkField16(tiles, w, h, [centre]);
    const spawns: number[] = [];
    const far = (i: number): boolean => maskA[i] === 1 && tiles[i] === TILE_FLOOR && centreWalk[i] > 150;
    for (let tries = 0; spawns.length < members && tries < 5000; tries++) {
      const i = Math.floor(r() * n);
      if (far(i) && !spawns.includes(i)) spawns.push(i);
    }
    return { w, h, n, tiles, maskA, maskB, centre, centreWalk, spawns };
  }

  it("starts at exactly 1000 on untouched tiles and reports a base, members and corridors", () => {
    const g = world(1, 0.1, 0.1);
    const guard = F.makeRouteGuard({ w: g.w, h: g.h, mask: g.maskA, tiles: g.tiles, spawns: g.spawns, centreWalk: g.centreWalk });
    expect(guard.members).toEqual(g.spawns);
    expect(Array.from(guard.base)).toEqual(g.spawns.map((m) => g.centreWalk[m]));
    expect(guard.worstMember()).toBe(-1);
    expect(guard.worstStretch()).toBe(1000);
    expect(guard.worstMember()).toBeGreaterThanOrEqual(0);
    expect(guard.worstMember()).toBeLessThan(g.spawns.length);
    // corridors: inside the zone, the union of corridorOf, the Chebyshev-1 band of the member's string-pulled descent
    const union = new Uint8Array(g.n);
    const ground = g.tiles.map((v, i) => (g.maskA[i] ? v : g.centreWalk[i] >= 0 ? TILE_FLOOR : TILE_WALL)) as Uint8Array;
    g.spawns.forEach((m, k) => {
      const mine = guard.corridorOf(k);
      expect(mine[0]).toBe(m);
      expect(new Set(mine).size).toBe(mine.length);
      expect(new Set(mine)).toEqual(new Set(pulledBand(ground, g.maskA, g.centreWalk, g.w, g.h, m)));
      for (const i of mine) union[i] = 1;
    });
    expect(Array.from(guard.corridor)).toEqual(Array.from(union));
    for (let i = 0; i < g.n; i++) if (guard.corridor[i]) expect(g.maskA[i]).toBe(1);
    expect(guard.corridorOf(99)).toEqual([]);
  });

  /** The corridor of one member, independently: pull the descent straight over `ground`, sample each segment, dilate by 1, keep the zone. */
  function pulledBand(ground: Uint8Array, mask: Uint8Array, walk: Int32Array, w: number, h: number, member: number): number[] {
    const raw = descentPath(walk, ground, w, h, member);
    const pts = [raw[0]];
    for (let a = 0; a < raw.length - 1;) {
      let j = raw.length - 1;
      while (j > a + 1 && segmentBlocked(ground, w, h, raw[a] % w, Math.floor(raw[a] / w), raw[j] % w, Math.floor(raw[j] / w), MASK_MOVE)) j--;
      pts.push(raw[j]);
      a = j;
    }
    const out = new Set<number>([pts[0]]);
    for (let k = 0; k < pts.length; k++) {
      const q = pts[Math.min(k + 1, pts.length - 1)];
      const ax = pts[k] % w, ay = Math.floor(pts[k] / w), bx = q % w, by = Math.floor(q / w);
      const steps = Math.max(Math.abs(bx - ax), Math.abs(by - ay)) * 2 || 1;
      for (let t = 0; t <= steps; t++) {
        const x = Math.round(ax + ((bx - ax) * t) / steps), y = Math.round(ay + ((by - ay) * t) / steps);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (mask[(y + dy) * w + x + dx]) out.add((y + dy) * w + x + dx);
      }
    }
    return [...out].filter((i) => mask[i] === 1);
  }

  it("a straight walk over open ground has the straight line as its corridor (the raw descent bows off it)", () => {
    const w = 80, h = 50, n = w * h;
    const tiles = new Uint8Array(n);
    const maskA = new Uint8Array(n);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) tiles[y * w + x] = TILE_WALL;
      else if (x <= 37) maskA[y * w + x] = 1;
    }
    const centreWalk = walkField16(tiles, w, h, [25 * w + 40]);
    const west = 25 * w + 5, northWest = 8 * w + 6;
    const guard = F.makeRouteGuard({ w, h, mask: maskA, tiles, spawns: [west, northWest], centreWalk });
    // the raw steepest descent from the west member does bow off row 25 (knight moves first)
    const raw = descentPath(centreWalk, tiles, w, h, west);
    expect(raw.some((i) => Math.floor(i / w) !== 25)).toBe(true);
    // its corridor is exactly rows 24-26 from the tile west of the member to the zone's last column
    const want = new Set<number>();
    for (let y = 24; y <= 26; y++) for (let x = 4; x <= 37; x++) want.add(y * w + x);
    expect(new Set(guard.corridorOf(0))).toEqual(want);
    // the sloped one: every corridor tile lies within a tile and a half (a diagonal of the 3x3 dilation, 2.2 tiles) of the straight line from the member to the centre, and the line is covered
    const c1 = guard.corridorOf(1);
    const inSet = new Set(c1);
    for (const i of c1) {
      const x = (i % w) + 0.5, y = Math.floor(i / w) + 0.5;
      expect(F.segDist2(x, y, 6.5, 8.5, 40.5, 25.5)).toBeLessThanOrEqual(5);
    }
    for (let x = 6; x <= 37; x++) {
      const y = Math.round(8 + ((x - 6) * (25 - 8)) / (40 - 6));
      expect(inSet.has(y * w + x), `line tile ${x},${y}`).toBe(true);
    }
    const perColumn = new Map<number, number>();
    for (const i of c1) perColumn.set(i % w, (perColumn.get(i % w) ?? 0) + 1);
    expect(Math.max(...perColumn.values())).toBeLessThanOrEqual(5);
  });

  it("the corridors cover at least 65% of the tiles of the members' real findPath walks in their own zone, on 8 generated maps (old stylers)", () => {
    let on = 0, tot = 0, cap = 0;
    const tilesOf = (W: number, from: { x: number; y: number }, path: Array<{ x: number; y: number }>): number[] => {
      const out: number[] = [];
      let a = from;
      for (const p of path) {
        const L = Math.sqrt((p.x - a.x) ** 2 + (p.y - a.y) ** 2);
        for (let k = 0; k <= L; k += 4) out.push(Math.floor((a.y + ((p.y - a.y) * k) / L) / 32) * W + Math.floor((a.x + ((p.x - a.x) * k) / L) / 32));
        a = p;
      }
      return out;
    };
    for (let seed = 0; cap < 8 && seed < 40; seed++) {
      let pre: Uint8Array | null = null;
      let state: StyleState | null = null;
      tryAttempt(seed, 0, { styleZones: (st) => { pre = st.tiles.slice(); zoneStylerHook(st); state = st; } });
      if (!state || !pre) continue;
      const st = state as StyleState;
      cap++;
      const { w, h } = st;
      const corridor = new Uint8Array(w * h);
      for (let z = 1; z <= 5; z++) {
        const mask = st.zone.map((v) => (v === z ? 1 : 0)) as Uint8Array;
        const guard = F.makeRouteGuard({ w, h, mask, tiles: pre, spawns: st.spawns.filter((i) => mask[i] === 1), centreWalk: st.centreWalk });
        for (let i = 0; i < w * h; i++) if (guard.corridor[i]) corridor[i] = 1;
      }
      const view = mapFromTiles(w, h, st.tiles.slice());
      const centre = { x: 68 * 32 + 16, y: 68 * 32 + 16 };
      for (const m of st.spawns) {
        const from = { x: (m % w) * 32 + 16, y: Math.floor(m / w) * 32 + 16 };
        const seen = new Set<number>();
        for (const i of tilesOf(w, from, findPath(view, from, centre))) {
          if (seen.has(i) || st.zone[i] !== st.zone[m]) continue;
          seen.add(i);
          tot++;
          if (corridor[i]) on++;
        }
      }
    }
    expect(cap).toBe(8);
    expect(tot).toBeGreaterThan(5000);
    expect(on / tot).toBeGreaterThanOrEqual(0.65);
  });

  it("the zone field equals the whole-map walk field of the current tiles when only this zone changed (random walls, cut-offs included)", () => {
    let cut = 0, stretched = 0;
    for (let t = 0; t < 14; t++) {
      const g = world(100 + t, 0.06, 0.1, 4);
      const guard = F.makeRouteGuard({ w: g.w, h: g.h, mask: g.maskA, tiles: g.tiles, spawns: g.spawns, centreWalk: g.centreWalk });
      const r = mulberry32(900 + t);
      const p = 0.04 + 0.02 * t;
      for (let i = 0; i < g.n; i++) if (g.maskA[i] && g.tiles[i] === TILE_FLOOR && r() < p) g.tiles[i] = TILE_WALL;
      const now = walkField16(g.tiles, g.w, g.h, [g.centre]);
      const got = guard.worstStretch();
      if (g.spawns.some((m) => now[m] < 0)) {
        cut++;
        expect(got).toBe(F.ROUTE_CUT_OFF);
        expect(now[g.spawns[guard.worstMember()]]).toBe(-1);
        continue;
      }
      let worst = 1000;
      g.spawns.forEach((m, k) => { worst = Math.max(worst, Math.floor((now[m] * 1000) / guard.base[k])); });
      expect(got, `world ${t}`).toBe(worst);
      if (worst > 1000) stretched++;
      const k = guard.worstMember();
      expect(Math.floor((now[g.spawns[k]] * 1000) / guard.base[k])).toBe(worst);
    }
    expect(cut).toBeGreaterThan(0);
    expect(stretched).toBeGreaterThan(2);
  });

  it("a wall across the zone with a gap far off stretches the walk; walling the zone off reports 1_000_000 and names the member", () => {
    const g = world(7, 0.05, 0.05, 5);
    const guard = F.makeRouteGuard({ w: g.w, h: g.h, mask: g.maskA, tiles: g.tiles, spawns: g.spawns, centreWalk: g.centreWalk });
    const saved = g.tiles.slice();
    for (let y = 1; y < g.h - 1; y++) if (y !== 2 && y !== 3) g.tiles[y * g.w + 30] = TILE_WALL;
    const stretched = guard.worstStretch();
    expect(stretched).toBeGreaterThan(1030);
    expect(stretched).toBeLessThan(F.ROUTE_CUT_OFF);
    const worstK = guard.worstMember();
    expect(worstK).toBeGreaterThanOrEqual(0);
    // closing the gap cuts every member off (they all stand west of the wall)
    for (let y = 1; y < g.h - 1; y++) g.tiles[y * g.w + 30] = TILE_WALL;
    expect(guard.worstStretch()).toBe(F.ROUTE_CUT_OFF);
    expect(guard.worstMember()).toBe(0);
    // taking the walls back restores exactly 1000: the guard keeps no state about tiles
    g.tiles.set(saved);
    expect(guard.worstStretch()).toBe(1000);
  });

  it("isolation: another zone's tiles never change a result, and a guard built after they changed has the same corridors", () => {
    const g = world(21, 0.1, 0.1, 5, true);
    const mk = (tiles: Uint8Array) => F.makeRouteGuard({ w: g.w, h: g.h, mask: g.maskA, tiles, spawns: g.spawns, centreWalk: g.centreWalk });
    const before = mk(g.tiles);
    // damage zone A the same way in both worlds, then rewrite zone B (all but its 3-tile rim next to A, which no styler writes)
    const other = g.tiles.slice();
    const r = mulberry32(5150);
    for (let i = 0; i < g.n; i++) {
      if (g.maskA[i] && g.tiles[i] === TILE_FLOOR && r() < 0.07) { g.tiles[i] = TILE_WALL; other[i] = TILE_WALL; }
    }
    const live = mk(other);
    for (let i = 0; i < g.n; i++) if (g.maskB[i] && i % g.w >= 41 && i !== g.centre) other[i] = r() < 0.5 ? TILE_WALL : TILE_FLOOR;
    const a = mk(g.tiles), b = mk(other);
    expect(Array.from(b.corridor)).toEqual(Array.from(a.corridor));
    expect(before.corridor.some((v) => v === 1)).toBe(true);
    expect(a.members).toEqual(b.members);
    const sa = a.worstStretch(), sb = b.worstStretch();
    expect(sb).toBe(sa);
    expect(b.worstMember()).toBe(a.worstMember());
    // a guard that existed before zone B was rewritten reads the live array and agrees
    expect(live.worstStretch()).toBe(sa);
    // a corridor reads this zone's tiles and the pick-time walk outside it: rewriting every tile of zone B, the seam included, changes nothing
    const all = g.tiles.slice();
    for (let i = 0; i < g.n; i++) if (g.maskB[i] && i !== g.centre) all[i] = r() < 0.5 ? TILE_WALL : TILE_FLOOR;
    expect(Array.from(mk(all).corridor)).toEqual(Array.from(a.corridor));
    expect(mk(all).corridorOf(2)).toEqual(a.corridorOf(2));
    expect(sa).toBeGreaterThanOrEqual(1000);
  });

  it("touches is a corridor filter; no members or no walk field means no stretch and no corridor", () => {
    const g = world(3, 0.1, 0.1);
    const guard = F.makeRouteGuard({ w: g.w, h: g.h, mask: g.maskA, tiles: g.tiles, spawns: g.spawns, centreWalk: g.centreWalk });
    const on = guard.corridorOf(1)[3], off = Array.from({ length: g.n }, (_, i) => i).find((i) => !guard.corridor[i])!;
    expect(guard.touches([off, on])).toBe(true);
    expect(guard.touches([off])).toBe(false);
    expect(guard.touches([])).toBe(false);
    for (const empty of [F.makeRouteGuard({ w: g.w, h: g.h, mask: g.maskA, tiles: g.tiles, spawns: [], centreWalk: g.centreWalk }), F.makeRouteGuard({ w: g.w, h: g.h, mask: g.maskA, tiles: g.tiles, spawns: g.spawns, centreWalk: null })]) {
      expect(empty.members).toEqual([]);
      expect(empty.worstStretch()).toBe(1000);
      expect(empty.worstMember()).toBe(-1);
      expect(empty.corridor.some((v) => v === 1)).toBe(false);
    }
  });

  it("worstStretch(extra) asks about walls that are not written: the same answer as writing them, and c.tiles is never touched", () => {
    let stretched = 0, cut = 0;
    for (let t = 0; t < 12; t++) {
      const g = world(300 + t, 0.05, 0.1, 5);
      const guard = F.makeRouteGuard({ w: g.w, h: g.h, mask: g.maskA, tiles: g.tiles, spawns: g.spawns, centreWalk: g.centreWalk });
      const r = mulberry32(8800 + t);
      const extra: number[] = [];
      for (let i = 0; i < g.n; i++) if (g.maskA[i] && g.tiles[i] === TILE_FLOOR && r() < 0.04 + 0.02 * t) extra.push(i);
      const before = g.tiles.slice();
      const asked = guard.worstStretch(extra);
      const askedMember = guard.worstMember();
      expect(Array.from(g.tiles), "tiles untouched").toEqual(Array.from(before));
      const typed = guard.worstStretch(Int32Array.from(extra));
      expect(typed).toBe(asked);
      expect(guard.worstStretch(), "the plain call is unaffected").toBe(1000);
      for (const i of extra) g.tiles[i] = TILE_WALL;
      const written = guard.worstStretch();
      expect(asked, `world ${t}`).toBe(written);
      expect(askedMember).toBe(guard.worstMember());
      if (written === F.ROUTE_CUT_OFF) cut++; else if (written > 1000) stretched++;
      g.tiles.set(before);
    }
    expect(stretched).toBeGreaterThan(1);
    expect(cut).toBeGreaterThan(0);
    // none, an empty list and indices off the grid change nothing
    const g = world(5, 0.05, 0.05);
    const guard = F.makeRouteGuard({ w: g.w, h: g.h, mask: g.maskA, tiles: g.tiles, spawns: g.spawns, centreWalk: g.centreWalk });
    expect(guard.worstStretch([])).toBe(1000);
    expect(guard.worstStretch(undefined)).toBe(1000);
    expect(guard.worstStretch([-5, g.n, g.n + 40])).toBe(1000);
    // a wall across the zone with a gap: stretched; the gap closed too: cut off
    const column: number[] = [];
    for (let y = 1; y < g.h - 1; y++) column.push(y * g.w + 30);
    expect(guard.worstStretch(column.filter((i) => ![2, 3].includes(Math.floor(i / g.w))))).toBeGreaterThan(1030);
    expect(guard.worstStretch(column)).toBe(F.ROUTE_CUT_OFF);
    expect(guard.worstMember()).toBe(0);
    expect(guard.worstStretch()).toBe(1000);
    // a guard without members answers 1000 whatever it is asked
    const none = F.makeRouteGuard({ w: g.w, h: g.h, mask: g.maskA, tiles: g.tiles, spawns: [], centreWalk: g.centreWalk });
    expect(none.worstStretch(column)).toBe(1000);
  });

  it("a member the field never reached, or outside the zone, is not a member", () => {
    const g = world(4, 0.1, 0.1);
    const outside = 5 * g.w + 40;
    const guard = F.makeRouteGuard({ w: g.w, h: g.h, mask: g.maskA, tiles: g.tiles, spawns: [outside, ...g.spawns, -4, 99999999], centreWalk: g.centreWalk });
    expect(guard.members).toEqual(g.spawns);
  });
});

// ------------------------------------------------------------------------------------------------ the Math spy
describe("determinism", () => {
  it("never calls Math.random or an engine-approximated Math function: module load and every export of the kit and the topology", async () => {
    const names = [
      "random", "sin", "cos", "tan", "asin", "acos", "atan", "atan2", "sinh", "cosh", "tanh", "asinh", "acosh", "atanh",
      "exp", "expm1", "log", "log1p", "log2", "log10", "pow", "hypot", "cbrt",
    ] as const;
    // Fixtures are test scaffolding: build them before the spies.
    const w = 136, h = 136, n = w * h;
    const tiles = new Uint8Array(n);
    const mask = new Uint8Array(n), hard = new Uint8Array(n);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x === 0 || y === 0 || x === w - 1 || y === h - 1) tiles[y * w + x] = TILE_WALL;
    for (let y = 10; y < 50; y++) for (let x = 10; x < 60; x++) { mask[y * w + x] = 1; if ((x * 7 + y * 3) % 23 === 0) tiles[y * w + x] = TILE_WALL; }
    hard[20 * w + 20] = 1;
    const noise = makeNoise(99);
    const nodes = [node(5, 5), node(40, 8), node(20, 30), node(50, 45), node(12, 44)];
    const calls: Record<string, number> = {};
    const spies = names.map((nm) => vi.spyOn(Math, nm));
    const exercised = new Set<string>();
    const undriven: string[] = [];
    try {
      vi.resetModules();
      const topo = await import("../src/gridTopology");
      const kit = await import("../src/zoneStyle/features");
      const use = <T>(name: string, v: T): T => { exercised.add(name); return v; };
      // gridTopology
      const walk = use("walkField16", topo.walkField16(tiles, w, h, [30 * w + 30, 31 * w + 31], [0, 12], mask));
      use("descentPath", topo.descentPath(walk, tiles, w, h, 40 * w + 40));
      use("segmentBlocked", topo.segmentBlocked(tiles, w, h, 11, 11, 50, 40));
      // geometry
      use("DIR16", kit.DIR16);
      use("dirIndex16", kit.dirIndex16(3, -7)); use("dirSep16", kit.dirSep16(2, 13)); use("isqrt", kit.isqrt(12345));
      use("dist2", kit.dist2(1, 2, 3, 4)); use("segDist2", kit.segDist2(3, 3, 0, 0, 9, 1)); use("discOffsets", kit.discOffsets(26));
      use("inBeam", kit.inBeam(5, 1, 3, 0, 8)); use("pseudoAngle", kit.pseudoAngle(-3, -5));
      // noise
      const ctx = { noise, w, h, mask, hard, tiles };
      use("noiseQ", kit.noiseQ(ctx, 3, 4, 5, 6)); use("fbmQ", kit.fbmQ(ctx, 3, 4, 9, 3, 6));
      // graphs
      use("campNodes", kit.campNodes({ w, h, mask, tiles, zone: { bbox: { x: 10, y: 10, w: 50, h: 40 }, centroid: { x: 35, y: 30 } }, camps: [{ x: 20, y: 20, elite: true, index: 0 }] }));
      const mst = use("primMST", kit.primMST(nodes, 0));
      use("gabrielEdges", kit.gabrielEdges(nodes)); use("rngEdges", kit.rngEdges(nodes));
      use("addShortcuts", kit.addShortcuts(nodes, mst.slice(), 2, 1.2, 60)); use("cyclomatic", kit.cyclomatic(5, mst));
      // fields
      const chamfer = use("chamferFrom", kit.chamferFrom([30 * w + 30], w, h));
      use("CHAMFER_FAR", kit.CHAMFER_FAR);
      use("argmaxIn", kit.argmaxIn(chamfer, mask));
      const smooth = use("majoritySmooth", kit.majoritySmooth(mask, mask, w, h, 2));
      use("componentsOf", kit.componentsOf(smooth, w, h, true)); use("pruneSmall", kit.pruneSmall(smooth.slice(), w, h, 9, false));
      use("floodAbove", kit.floodAbove(chamfer, 10, 30 * w + 30, mask, w, h)); use("tauForArea", kit.tauForArea(chamfer, 30 * w + 30, mask, w, h, 200));
      // search
      use("noisyPath", kit.noisyPath(ctx, 12 * w + 12, 45 * w + 55, 3, (j) => j % 5));
      use("viterbiRows", kit.viterbiRows(Int32Array.from([1, 5, 2, 7, 3, 9, 1, 4, 6, 2, 8, 3]), 0, 2, 4, 3, 1));
      use("viterbiPath", kit.viterbiPath(20, 3, (s, dt) => (s * 7 + dt * dt) % 11, 4));
      // the route guard
      const centreWalk = topo.walkField16(tiles, w, h, [30 * w + 60]);
      const guard = use("makeRouteGuard", kit.makeRouteGuard({ w, h, mask, tiles, spawns: [12 * w + 12, 45 * w + 14], centreWalk }));
      guard.worstStretch(); guard.touches([1, 2, 3]); guard.corridorOf(0); guard.worstMember();
      use("ROUTE_STRETCH_MAX", kit.ROUTE_STRETCH_MAX); use("ROUTE_CUT_OFF", kit.ROUTE_CUT_OFF);
      // every export of the kit and of the topology was driven (checked after the spies are off)
      topo.walkDistances(tiles, w, h, 30 * w + 30); topo.ringOffsets(w); topo.nb4Offsets(w);
      const driven = new Set([...exercised, "walkDistances", "ringOffsets", "nb4Offsets"]);
      for (const mod of [kit, topo] as Array<Record<string, unknown>>) {
        for (const [name, v] of Object.entries(mod)) if (typeof v === "function" && !driven.has(name)) undriven.push(name);
        for (const [name, v] of Object.entries(mod)) if (typeof v !== "function" && !driven.has(name) && !["SIMPLE", "RING_DX", "RING_DY"].includes(name)) undriven.push(name);
      }
      names.forEach((nm, i) => { calls[`Math.${nm}`] = spies[i].mock.calls.length; });
    } finally {
      for (const sp of spies) sp.mockRestore();
    }
    expect(calls).toEqual(Object.fromEntries(names.map((nm) => [`Math.${nm}`, 0])));
    expect(undriven, "exports the spy test never drove").toEqual([]);
  });

  it("the same inputs give the same outputs on every run (a second module copy agrees, byte for byte)", async () => {
    const run = async (): Promise<string> => {
      vi.resetModules();
      const topo = await import("../src/gridTopology");
      const kit = await import("../src/zoneStyle/features");
      const w = 60, h = 40;
      const r = mulberry32(2468);
      const tiles = new Uint8Array(w * h);
      for (let i = 0; i < w * h; i++) tiles[i] = r() < 0.2 ? TILE_WALL : TILE_FLOOR;
      tiles[5 * w + 5] = TILE_FLOOR;
      const f = topo.walkField16(tiles, w, h, [5 * w + 5]);
      const mask = tiles.map((v) => (v === TILE_FLOOR ? 1 : 0)) as Uint8Array;
      const sm = kit.majoritySmooth(mask, mask, w, h, 2);
      const tau = kit.tauForArea(f, 5 * w + 5, mask, w, h, 300);
      const path = topo.descentPath(f, tiles, w, h, 30 * w + 50);
      return JSON.stringify([Array.from(f.slice(0, 400)), Array.from(sm.slice(0, 400)), tau, path, kit.discOffsets(11), kit.viterbiRows(Int32Array.from(f.slice(0, 60)), 3, 7, 9, 8, 2)]);
    };
    expect(await run()).toBe(await run());
  });
});

// A real context is accepted by every kit function that takes one, and the builder fits the runtime's slot: checked by tsc.
export const _kitAcceptsBaseCtx = (c: BaseCtx): number => {
  const builder: RouteGuardBuilder = F.makeRouteGuard;
  return F.campNodes(c).length + F.noisyPath(c, 0, 0, 0).length + builder(c).members.length + F.noiseQ(c, 0, 0, 1, 0);
};
