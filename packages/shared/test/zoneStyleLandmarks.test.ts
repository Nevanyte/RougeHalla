// The landmark template kit (zoneStyle/landmarks.ts, contract 3.8 and 5.2, WP0k): the five templates of section 5.2 stamp validly
// in all 8 orientations, the stamps agree with an independent grid rotation, and the placement helpers work through the real
// guard (ZoneRuntime.placeFeature), whole or not at all.
import { describe, expect, it, vi } from "vitest";
import { TILE_FLOOR, TILE_WALL } from "../src/map";
import { landmarkCtx } from "../src/zoneStyle/context";
import * as L from "../src/zoneStyle/landmarks";
import type { LandmarkTemplate, Stamp } from "../src/zoneStyle/landmarks";
import type { StyleCaps } from "../src/zoneStyle/types";
import { rig } from "./zoneStyleRig";

const FORGE: LandmarkTemplate = {
  key: "forge", jobs: ["landmark", "lee"],
  rows: ["###dd####", "#c......#", "#.......#", "#..###..#", "#..###..d", "#c......d", "#########"],
};
const GUARD_HOUSE: LandmarkTemplate = {
  key: "guardHouse", jobs: ["landmark", "lee"],
  rows: ["###dd###", "#c....c#", "#......#", "#......#", "#......d", "#c.....d", "########"],
};
const BURROW: LandmarkTemplate = {
  key: "burrow", jobs: ["landmark", "fork"],
  rows: ["__#####__", "_##...##_", "##c....##", "#.......#", "d.......d", "d.......d", "##....c##", "_##...##_", "__#####__"],
};
const WATCHTOWER: LandmarkTemplate = {
  key: "watchtower", jobs: ["landmark", "lee"],
  rows: ["_##dd##_", "##....##", "#c.....#", "#......#", "#.....c#", "##....##", "_##dd##_"],
};
const SHRINE: LandmarkTemplate = {
  key: "shrine", jobs: ["landmark", "rest"],
  rows: ["#########", "#c.....c#", "#..lll..#", "#..lll..#", "#..lll..#", "##.....##", "###ddd###"],
};
const ALL = [FORGE, GUARD_HOUSE, BURROW, WATCHTOWER, SHRINE];

/** Independent oracle: the char grid after an optional mirror and `rot` clockwise quarter turns. */
function turned(rows: readonly string[], rot: number, mirror: boolean): string[][] {
  let g = rows.map((r) => [...r]);
  if (mirror) g = g.map((r) => r.reverse());
  for (let k = 0; k < rot; k++) {
    const H = g.length, W = g[0].length;
    g = Array.from({ length: W }, (_, r) => Array.from({ length: H }, (_, c) => g[H - 1 - c][r]));
  }
  return g;
}

const sorted = (a: readonly number[]): number[] => a.slice().sort((p, q) => p - q);

describe("templates of section 5.2", () => {
  it("are valid in all 8 orientations: wall pieces >= 6, doors 2-3 wide with a way through, floor connected, nooks placed (Gallows: two)", () => {
    for (const t of ALL) {
      expect(L.templateProblems(t, { minNooks: t.key === "guardHouse" ? 2 : 1 }), t.key).toEqual([]);
    }
  });

  it("stamp exactly what an independent rotation and mirror of the character grid says, in every orientation", () => {
    for (const t of ALL) {
      const w = 30, h = 30, x0 = 7, y0 = 5;
      for (let o = 0; o < 8; o++) {
        const rot = (o & 3) as 0 | 1 | 2 | 3, mirror = o >= 4;
        const s = L.stampTemplate(t, x0, y0, rot, mirror, w, h)!;
        expect(s, `${t.key} o${o}`).not.toBeNull();
        const g = turned(t.rows, rot, mirror);
        const want: Record<string, number[]> = { "#": [], ".": [], d: [], c: [], l: [] };
        g.forEach((row, y) => row.forEach((ch, x) => { if (ch !== "_") want[ch].push((y0 + y) * w + x0 + x); }));
        expect(sorted(s.walls), `${t.key} o${o} walls`).toEqual(sorted(want["#"]));
        expect(sorted(s.floor), `${t.key} o${o} floor`).toEqual(sorted(want["."]));
        expect(sorted(s.doors), `${t.key} o${o} doors`).toEqual(sorted(want.d));
        expect(sorted(s.nooks), `${t.key} o${o} nooks`).toEqual(sorted(want.c));
        expect(sorted(s.lights), `${t.key} o${o} lights`).toEqual(sorted(want.l));
        expect(s.bbox).toEqual({ x: x0, y: y0, w: g[0].length, h: g.length });
      }
    }
  });

  it("keep template order in every list, whatever the orientation (the same nook is first)", () => {
    const w = 30;
    const base = L.stampTemplate(FORGE, 4, 4, 0, false, w, w)!;
    expect(base.nooks).toEqual([5 * w + 5, 9 * w + 5]); // (1,1) then (1,5)
    expect(base.doors).toEqual([4 * w + 7, 4 * w + 8, 8 * w + 12, 9 * w + 12]); // (3,0) (4,0) (8,4) (8,5)
    for (let o = 0; o < 8; o++) {
      const rot = o & 3, mirror = o >= 4;
      const s = L.stampTemplate(FORGE, 0, 0, rot as 0 | 1 | 2 | 3, mirror, w, w)!;
      // transform the first nook (1,1) and the second (1,5) by hand
      const tw = 9, th = 7;
      const map = (x: number, y: number): [number, number] => {
        const mx = mirror ? tw - 1 - x : x;
        if (rot === 0) return [mx, y];
        if (rot === 1) return [th - 1 - y, mx];
        if (rot === 2) return [tw - 1 - mx, th - 1 - y];
        return [y, tw - 1 - mx];
      };
      const [ax, ay] = map(1, 1), [bx, by] = map(1, 5);
      expect(s.nooks, `o${o}`).toEqual([ay * w + ax, by * w + bx]);
    }
  });

  it("turn a quarter at a time (bbox swaps), a half turn keeps the box, and four turns are the identity", () => {
    const w = 40;
    const dims = ALL.map((t) => [t.rows[0].length, t.rows.length]);
    ALL.forEach((t, k) => {
      const [tw, th] = dims[k];
      expect(L.stampTemplate(t, 2, 3, 0, false, w, w)!.bbox).toEqual({ x: 2, y: 3, w: tw, h: th });
      expect(L.stampTemplate(t, 2, 3, 1, false, w, w)!.bbox).toEqual({ x: 2, y: 3, w: th, h: tw });
      expect(L.stampTemplate(t, 2, 3, 2, true, w, w)!.bbox).toEqual({ x: 2, y: 3, w: tw, h: th });
      expect(L.stampTemplate(t, 2, 3, 3, true, w, w)!.bbox).toEqual({ x: 2, y: 3, w: th, h: tw });
      // the same number of tiles of every kind in all orientations
      const counts = (s: Stamp): number[] => [s.walls.length, s.floor.length, s.doors.length, s.nooks.length, s.lights.length];
      const c0 = counts(L.stampTemplate(t, 2, 3, 0, false, w, w)!);
      for (let o = 1; o < 8; o++) expect(counts(L.stampTemplate(t, 2, 3, (o & 3) as 0 | 1 | 2 | 3, o >= 4, w, w)!)).toEqual(c0);
    });
    // four quarter turns of the oracle return the template; so do two mirrors
    expect(turned(FORGE.rows, 4, false).map((r) => r.join(""))).toEqual(FORGE.rows);
    expect(turned(FORGE.rows, 0, true).map((r) => r.reverse().join(""))).toEqual(FORGE.rows);
    // the forge has no symmetry, so its 8 orientations are 8 different stamps
    const seen = new Set<string>();
    for (let o = 0; o < 8; o++) seen.add(sorted(L.stampTemplate(FORGE, 0, 0, (o & 3) as 0 | 1 | 2 | 3, o >= 4, 30, 30)!.walls).join(","));
    expect(seen.size).toBe(8);
  });

  it("stamp to null when a non-'_' cell leaves the grid; the '_' corners of a burrow may hang off", () => {
    expect(L.stampTemplate(FORGE, 0, 0, 0, false, 9, 7)).not.toBeNull();
    expect(L.stampTemplate(FORGE, 1, 0, 0, false, 9, 7)).toBeNull();
    expect(L.stampTemplate(FORGE, 0, 1, 0, false, 9, 7)).toBeNull();
    expect(L.stampTemplate(FORGE, 0, 0, 1, false, 9, 7)).toBeNull(); // 7 wide, 9 tall when turned
    expect(L.stampTemplate(FORGE, -1, 0, 0, false, 30, 30)).toBeNull();
    expect(L.stampTemplate(BURROW, -2, -2, 0, false, 30, 30)).toBeNull(); // (2,0)... is still off the grid
    // the burrow's top-left 2x2 corner is '_': a stamp whose box hangs one tile off the grid but whose cells do not is fine
    expect(L.stampTemplate({ key: "k", jobs: ["landmark"], rows: ["_##", "#c#", "###"] }, -1, 0, 0, false, 4, 4)).toBeNull();
    expect(L.stampTemplate({ key: "k", jobs: ["landmark"], rows: ["_.#", "#c#", "###"] }, -1, 0, 0, false, 4, 4)).toBeNull();
    expect(L.stampTemplate({ key: "k", jobs: ["landmark"], rows: ["_##", "_c#", "_##"] }, -1, 0, 0, false, 4, 4)).not.toBeNull();
  });

  it("reject malformed templates when they are first turned", () => {
    expect(() => L.stampTemplate({ key: "ragged", jobs: ["landmark"], rows: ["###", "##"] }, 0, 0, 0, false, 9, 9)).toThrow(RangeError);
    expect(() => L.stampTemplate({ key: "alien", jobs: ["landmark"], rows: ["#x#"] }, 0, 0, 0, false, 9, 9)).toThrow(RangeError);
  });
});

describe("templateProblems finds the broken ones", () => {
  const has = (t: LandmarkTemplate, re: RegExp, opts?: { minNooks?: number }): boolean => L.templateProblems(t, opts).some((p) => re.test(p));
  it("a wall piece under 6 tiles", () => {
    const t = { key: "chip", jobs: ["landmark"] as const, rows: ["########", "#c.....#", "#..#...#", "#......d", "#......d", "########"] };
    expect(has(t, /wall piece of 1 tiles/)).toBe(true);
  });
  it("a door that is one tile wide, or four, or bent", () => {
    expect(has({ key: "d1", jobs: ["landmark"], rows: ["#######", "#c....d", "#.....#", "#######"] }, /door of 1 tiles/)).toBe(true);
    expect(has({ key: "d4", jobs: ["landmark"], rows: ["#######", "#c....d", "#.....d", "#.....d", "#.....d", "#######"] }, /door of 4 tiles/)).toBe(true);
    expect(has({ key: "bent", jobs: ["landmark"], rows: ["#########", "#c.....##", "#.....dd#", "#......d#", "#########"] }, /door/)).toBe(true);
  });
  it("floor in two pieces", () => {
    const t = { key: "split", jobs: ["landmark"] as const, rows: ["#########", "#c..#...#", "#...#...d", "#...#...d", "#########"] };
    expect(has(t, /several pieces/)).toBe(true);
  });
  it("a nook beside a door, a nook away from the walls, and too few nooks", () => {
    expect(has({ key: "n1", jobs: ["landmark"], rows: ["###dd###", "#cc....#", "#......#", "#......#", "########"] }, /next to a door/)).toBe(true);
    expect(has({ key: "n2", jobs: ["landmark"], rows: ["#########", "#.......#", "#...c...#", "#.......d", "#.......d", "#########"] }, /not next to a wall/)).toBe(true);
    expect(has({ key: "n3", jobs: ["landmark"], rows: ["#########", "#.......#", "#.......#", "#.......d", "#.......d", "#########"] }, /0 crate nooks/)).toBe(true);
    expect(has({ key: "n4", jobs: ["landmark"], rows: ["#########", "#c......#", "#.......#", "#.......d", "#.......d", "#########"] }, /1 crate nooks \(needs 2\)/, { minNooks: 2 })).toBe(true);
  });
  it("a door with floor on both sides", () => {
    expect(has({ key: "through", jobs: ["landmark"], rows: ["#########", "#c......#", "#...dd..#", "#.......#", "#########"] }, /no way through/)).toBe(true);
  });
});

// ------------------------------------------------------------------------------------------------ through the real guard
/** A zone of open floor `w` x `h` inside a border, the unit of every placement test. `hard` and `ice` list [x, y] tiles. */
function zone(w: number, h: number, opts: { hard?: Array<[number, number]>; ice?: Array<[number, number]>; caps?: Partial<StyleCaps> } = {}) {
  const rows = Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => {
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1) return "#";
    if (opts.hard?.some(([hx, hy]) => hx === x && hy === y)) return ",";
    if (opts.ice?.some(([ix, iy]) => ix === x && iy === y)) return "i";
    return ".";
  }).join(""));
  const g = rig(rows, { caps: opts.caps });
  return { ...g, c: landmarkCtx(g.rt) };
}

describe("stampFits, placeLandmark and bestLandmark (through ZoneRuntime.placeFeature)", () => {
  it("stampFits: walls need open ground, the rest must be unprotected zone floor, and landmarks keep a 3-tile gap", () => {
    const z = zone(40, 30);
    expect(L.stampFits(z.c, L.stampTemplate(FORGE, 5, 5, 0, false, 40, 30)!)).toBe(true);
    // a hard tile under a wall cell and under a floor cell both refuse it
    const hardWall = zone(40, 30, { hard: [[5, 5]] });
    expect(L.stampFits(hardWall.c, L.stampTemplate(FORGE, 5, 5, 0, false, 40, 30)!)).toBe(false); // (0,0) of the forge is a wall
    const hardFloor = zone(40, 30, { hard: [[8, 8]] });
    expect(L.stampFits(hardFloor.c, L.stampTemplate(FORGE, 5, 5, 0, false, 40, 30)!)).toBe(false); // (3,3) of the forge is the hearth: a wall
    const hardInterior = zone(40, 30, { hard: [[7, 6]] });
    expect(L.stampFits(hardInterior.c, L.stampTemplate(FORGE, 5, 5, 0, false, 40, 30)!)).toBe(false); // (2,1) is floor
    // another zone's tile under the box
    const edge = zone(40, 30);
    expect(L.stampFits(edge.c, L.stampTemplate(FORGE, 31, 5, 0, false, 40, 30)!)).toBe(false); // runs into the border
    // the gap rule: place one, then 2 tiles away is too close, 3 tiles of space is fine
    const first = L.placeLandmark(z.c, FORGE, L.stampTemplate(FORGE, 2, 2, 0, false, 40, 30)!, 0, false);
    expect(first).not.toBeNull();
    expect(L.stampFits(z.c, L.stampTemplate(FORGE, 13, 2, 0, false, 40, 30)!)).toBe(false);
    expect(L.stampFits(z.c, L.stampTemplate(FORGE, 14, 2, 0, false, 40, 30)!)).toBe(true); // 11, 12, 13 free
    expect(L.stampFits(z.c, L.stampTemplate(FORGE, 2, 11, 0, false, 40, 30)!)).toBe(false); // y: the box ends at row 8, origin 11 leaves rows 9, 10
    expect(L.stampFits(z.c, L.stampTemplate(FORGE, 2, 12, 0, false, 40, 30)!)).toBe(true);
    // diagonal neighbours count too
    expect(L.stampFits(z.c, L.stampTemplate(FORGE, 13, 11, 0, false, 40, 30)!)).toBe(false);
    expect(L.stampFits(z.c, L.stampTemplate(FORGE, 14, 12, 0, false, 40, 30)!)).toBe(true);
  });

  it("placeLandmark records the feature (kind, variant, jobs, anchor, params), owns walls and floor, reserves the doors, and writes the walls", () => {
    const z = zone(40, 30);
    const s = L.stampTemplate(FORGE, 6, 5, 1, true, 40, 30)!;
    const placed = L.placeLandmark(z.c, FORGE, s, 1, true)!;
    expect(placed).not.toBeNull();
    expect(placed.id).toBe(0);
    expect(sorted(placed.written)).toEqual(sorted(s.walls));
    expect(placed.refused).toBe(0);
    const f = z.rt.init.features;
    expect(f.length).toBe(1);
    expect(f[0].kind).toBe("landmark");
    expect(f[0].variant).toBe("forge");
    expect(f[0].jobs).toEqual(["landmark", "lee"]);
    expect([f[0].ax, f[0].ay]).toEqual([6, 5]);
    expect(f[0].p).toEqual([1, 1, ...sorted(s.doors)]);
    expect(f[0].bbox).toEqual(s.bbox);
    expect(f[0].tiles).toBe(s.walls.length + s.floor.length + s.doors.length + s.nooks.length + s.lights.length);
    for (const i of s.walls) { expect(z.tiles[i]).toBe(TILE_WALL); expect(z.c.isOwned(i)).toBe(true); }
    for (const i of [...s.floor, ...s.doors, ...s.nooks]) { expect(z.tiles[i]).toBe(TILE_FLOOR); expect(z.c.isOwned(i)).toBe(true); }
    for (const i of s.doors) expect(z.c.isReserved(i)).toBe(true);
    expect(z.c.zoneFeatures().length).toBe(1);
    // the same landmark can be recovered from the record alone (what the generator's crates do)
    const again = L.stampTemplate(FORGE, f[0].ax, f[0].ay, f[0].p[0] as 0 | 1 | 2 | 3, f[0].p[1] === 1, 40, 30)!;
    expect(again).toEqual(s);
  });

  it("every template stands through the real guard in all 8 orientations: floor stays one piece, no wall piece under 6, doors open", () => {
    for (const t of ALL) {
      for (let o = 0; o < 8; o++) {
        const rot = (o & 3) as 0 | 1 | 2 | 3, mirror = o >= 4;
        const w = 36, h = 30;
        const z = zone(w, h);
        const s = L.stampTemplate(t, 10, 8, rot, mirror, w, h)!;
        expect(L.stampFits(z.c, s), `${t.key} o${o} fits`).toBe(true);
        const placed = L.placeLandmark(z.c, t, s, rot, mirror);
        expect(placed, `${t.key} o${o} stands`).not.toBeNull();
        for (const i of s.doors) expect(z.tiles[i], `${t.key} o${o} door`).toBe(TILE_FLOOR);
        // the zone's floor (doors, interior, outside) is one 4-connected piece
        const floor = z.tiles.map((v) => (v === TILE_FLOOR ? 1 : 0));
        const first = floor.indexOf(1);
        const seen = new Uint8Array(w * h);
        const stack = [first];
        seen[first] = 1;
        let reached = 0;
        while (stack.length) {
          const i = stack.pop()!;
          reached++;
          for (const j of [i + 1, i - 1, i + w, i - w]) if (floor[j] && !seen[j]) { seen[j] = 1; stack.push(j); }
        }
        expect(reached, `${t.key} o${o} floor in one piece`).toBe(floor.reduce((a, b) => a + b, 0));
        // 8-connected wall pieces inside the zone (the border is its own piece and is left out)
        const wallSeen = new Uint8Array(w * h);
        for (let s0 = 0; s0 < w * h; s0++) {
          if (z.tiles[s0] !== TILE_WALL || wallSeen[s0] || !z.c.mask[s0]) continue;
          const st = [s0];
          wallSeen[s0] = 1;
          let size = 0;
          while (st.length) {
            const i = st.pop()!;
            size++;
            for (const d of [1, -1, w, -w, w + 1, w - 1, -w + 1, -w - 1]) if (z.tiles[i + d] === TILE_WALL && !wallSeen[i + d] && z.c.mask[i + d]) { wallSeen[i + d] = 1; st.push(i + d); }
          }
          expect(size, `${t.key} o${o} wall piece at ${s0}`).toBeGreaterThanOrEqual(6);
        }
      }
    }
  });

  it("placeLandmark is whole or nothing: one refused wall puts everything back", () => {
    const z = zone(40, 30, { ice: [[20, 12]] });
    const before = z.tiles.slice();
    // a forge whose bottom wall row passes next to the ICE tile: canBlock refuses a wall beside ICE
    const s = L.stampTemplate(FORGE, 16, 6, 0, false, 40, 30)!;
    expect(L.stampFits(z.c, s)).toBe(true); // static rules do not see ICE
    expect(L.placeLandmark(z.c, FORGE, s, 0, false)).toBeNull();
    expect(Array.from(z.tiles)).toEqual(Array.from(before));
    expect(z.rt.init.features.length).toBe(0);
    for (const i of s.walls) expect(z.c.isOwned(i)).toBe(false);
    for (const i of s.doors) expect(z.c.isReserved(i)).toBe(false);
    // and a footprint cap that cannot hold it
    const small = zone(40, 30, { caps: { footprintPct: 1 } });
    const t = L.stampTemplate(FORGE, 6, 5, 0, false, 40, 30)!;
    expect(L.placeLandmark(small.c, FORGE, t, 0, false)).toBeNull();
    expect(small.rt.init.features.length).toBe(0);
  });

  it("bestLandmark takes the best-scoring (origin, orientation): higher first, ties the lower origin, then the lower orientation", () => {
    const w = 44, h = 32;
    const make = () => zone(w, h, { hard: [[22, 16], [23, 16], [22, 17]] });
    // reference: enumerate by hand with stampTemplate + stampFits, the same candidate set and tie rules
    const target = [30, 20];
    const score = (s: Stamp): number => -(Math.abs(s.bbox.x + (s.bbox.w >> 1) - target[0]) + Math.abs(s.bbox.y + (s.bbox.h >> 1) - target[1]));
    const z0 = make();
    const zb = z0.c.zone.bbox;
    let best: { sc: number; origin: number; o: number } | null = null;
    for (let y = zb.y; y < zb.y + zb.h; y += 2) {
      for (let x = zb.x; x < zb.x + zb.w; x += 2) {
        for (let o = 0; o < 8; o++) {
          const s = L.stampTemplate(FORGE, x, y, (o & 3) as 0 | 1 | 2 | 3, o >= 4, w, h);
          if (!s || !L.stampFits(z0.c, s)) continue;
          const sc = score(s), origin = y * w + x;
          if (!best || sc > best.sc || (sc === best.sc && (origin < best.origin || (origin === best.origin && o < best.o)))) best = { sc, origin, o };
        }
      }
    }
    expect(best).not.toBeNull();
    const z = make();
    const seenRots: Array<[number, boolean]> = [];
    const placed = L.bestLandmark(z.c, FORGE, (s, rot, mirror) => { seenRots.push([rot, mirror]); return score(s); })!;
    expect(placed).not.toBeNull();
    const f = z.rt.init.features[0];
    expect(f.ay * w + f.ax).toBe(best!.origin);
    expect([f.p[0], f.p[1]]).toEqual([best!.o & 3, best!.o >= 4 ? 1 : 0]);
    expect(f.variant).toBe("forge");
    // score saw all 8 orientations
    expect(new Set(seenRots.map(([r, m]) => r + (m ? 4 : 0))).size).toBe(8);
    // determinism: the same call again on a fresh zone
    const z2 = make();
    L.bestLandmark(z2.c, FORGE, (s) => score(s));
    expect(z2.rt.init.features[0]).toEqual(f);
  });

  it("bestLandmark scores exactly the (origin, orientation) pairs stampFits accepts, for templates with and without '_' cells", () => {
    const w = 46, h = 34;
    const make = () => zone(w, h, { hard: [[10, 8], [11, 8], [30, 20], [31, 20], [31, 21], [20, 26]] });
    for (const t of [FORGE, BURROW, WATCHTOWER, SHRINE]) {
      const z = make();
      const want = new Set<string>();
      const zb = z.c.zone.bbox;
      for (let y = zb.y; y < zb.y + zb.h; y += 2) {
        for (let x = zb.x; x < zb.x + zb.w; x += 2) {
          for (let o = 0; o < 8; o++) {
            const s = L.stampTemplate(t, x, y, (o & 3) as 0 | 1 | 2 | 3, o >= 4, w, h);
            if (s && L.stampFits(z.c, s)) want.add(`${x},${y},${o & 3},${o >= 4}`);
          }
        }
      }
      expect(want.size, t.key).toBeGreaterThan(100);
      const got = new Set<string>();
      L.bestLandmark(z.c, t, (s, rot, mirror) => { got.add(`${s.bbox.x},${s.bbox.y},${rot},${mirror}`); return 0; }, 0);
      expect(got, t.key).toEqual(want);
    }
  });

  it("bestLandmark falls through to the next candidate when the guard refuses one, within `tries`, and keeps the gap for a second landmark", () => {
    // ICE beside the top candidate's wall: the guard refuses that spot, so the next-best stands
    const w = 44, h = 32;
    const prefer = (s: Stamp): number => -(Math.abs(s.bbox.x - 21) + Math.abs(s.bbox.y - 11)) * 10 - (s.bbox.w === 9 ? 0 : 1);
    const first = (() => { const z = zone(w, h); L.bestLandmark(z.c, FORGE, prefer); return z.rt.init.features[0]; })();
    expect([first.ax, first.ay]).toEqual([21, 11]);
    // put ICE one tile outside the preferred spot's top wall row
    const ice = zone(w, h, { ice: [[first.ax + 1, first.ay - 1]] });
    expect(L.bestLandmark(ice.c, FORGE, prefer, 1)).toBeNull(); // the single try is the refused one
    expect(ice.rt.init.features.length).toBe(0);
    // the twelve best candidates are all beside the ICE (neighbouring origins and the 8 orientations of the same spot)
    expect(L.bestLandmark(ice.c, FORGE, prefer, 12)).toBeNull();
    expect(ice.rt.init.features.length).toBe(0);
    const moved = L.bestLandmark(ice.c, FORGE, prefer, 80)!;
    expect(moved).not.toBeNull();
    const m = ice.rt.init.features[0];
    expect(m.ax === first.ax && m.ay === first.ay && m.p[0] === first.p[0] && m.p[1] === first.p[1]).toBe(false);
    // a second landmark of the zone keeps LANDMARK_GAP from the first
    const second = L.bestLandmark(ice.c, GUARD_HOUSE, prefer)!;
    expect(second).not.toBeNull();
    const [a, b] = ice.rt.init.features.map((f) => f.bbox);
    const sepX = Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w)), sepY = Math.max(a.y - (b.y + b.h), b.y - (a.y + a.h));
    expect(Math.max(sepX, sepY)).toBeGreaterThanOrEqual(L.LANDMARK_GAP);
    // nothing fits in a zone that is too small
    const tiny = zone(10, 8);
    expect(L.bestLandmark(tiny.c, FORGE, () => 0)).toBeNull();
    expect(L.bestLandmark(zone(44, 32).c, FORGE, () => 0, 0)).toBeNull();
  });

  it("every landmark placed through the guard leaves the zone's floor in one piece", () => {
    const z = zone(60, 40);
    for (const t of [FORGE, GUARD_HOUSE, BURROW, WATCHTOWER, SHRINE]) L.bestLandmark(z.c, t, (s) => -(s.bbox.x * 3 + s.bbox.y));
    expect(z.rt.init.features.length).toBeGreaterThanOrEqual(4);
    const { tiles } = z;
    const seen = new Uint8Array(tiles.length);
    let first = tiles.findIndex((v) => v === TILE_FLOOR);
    const stack = [first];
    seen[first] = 1;
    let reached = 0;
    while (stack.length) {
      const i = stack.pop()!;
      reached++;
      for (const j of [i + 1, i - 1, i + 60, i - 60]) if (tiles[j] === TILE_FLOOR && !seen[j]) { seen[j] = 1; stack.push(j); }
    }
    expect(reached).toBe(tiles.filter((v) => v === TILE_FLOOR).length);
  });
});

describe("determinism", () => {
  it("never calls Math.random or an engine-approximated Math function: module load and every export of the landmark kit", async () => {
    const names = [
      "random", "sin", "cos", "tan", "asin", "acos", "atan", "atan2", "sinh", "cosh", "tanh", "asinh", "acosh", "atanh",
      "exp", "expm1", "log", "log1p", "log2", "log10", "pow", "hypot", "cbrt",
    ] as const;
    // fixtures first: the rig is test scaffolding
    const z = zone(50, 36);
    const calls: Record<string, number> = {};
    const spies = names.map((nm) => vi.spyOn(Math, nm));
    const driven = new Set<string>();
    const undriven: string[] = [];
    try {
      vi.resetModules();
      const lm = await import("../src/zoneStyle/landmarks");
      const s = lm.stampTemplate(SHRINE, 4, 4, 3, true, 50, 36)!; driven.add("stampTemplate");
      lm.stampFits(z.c, s); driven.add("stampFits");
      lm.placeLandmark(z.c, SHRINE, s, 3, true); driven.add("placeLandmark");
      lm.bestLandmark(z.c, FORGE, (st, rot) => st.bbox.x + rot); driven.add("bestLandmark");
      lm.templateProblems(BURROW); driven.add("templateProblems");
      driven.add("LANDMARK_GAP"); driven.add("LANDMARK_TRIES");
      void lm.LANDMARK_GAP; void lm.LANDMARK_TRIES;
      for (const [name] of Object.entries(lm)) if (!driven.has(name)) undriven.push(name);
      names.forEach((nm, i) => { calls[`Math.${nm}`] = spies[i].mock.calls.length; });
    } finally {
      for (const sp of spies) sp.mockRestore();
    }
    expect(calls).toEqual(Object.fromEntries(names.map((nm) => [`Math.${nm}`, 0])));
    expect(undriven, "exports the spy test never drove").toEqual([]);
  });
});
