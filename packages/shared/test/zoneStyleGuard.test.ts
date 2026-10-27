// The styler guard on hand-built grids: what a write may and may not do. The grid legend is in zoneStyleRig.ts.
import { describe, expect, it } from "vitest";
import { REGION_FACTIONS, TILE_FLOOR, TILE_LOW, TILE_WALL } from "../src/map";
import { TERRAIN_BOG, TERRAIN_FENCE, TERRAIN_ICE, TERRAIN_LAVA } from "../src/terrain";
import { walkField16 } from "../src/gridTopology";
import { STYLE_STREAM, styleRng } from "../src/styler";
import { FEATURE_MIN_PIECE, LANDMARK_CAPS, ZONE_STYLE_CAPS, styleLandmarks, styleZones } from "../src/zoneStyle";
import { makeRouteGuard } from "../src/zoneStyle/features";
import type { FeatureDraft, ZoneStyleState, ZoneStyler } from "../src/zoneStyle";
import { rig } from "./zoneStyleRig";

const floors = (tiles: Uint8Array): number => tiles.reduce((n, t) => n + (t === TILE_FLOOR ? 1 : 0), 0);

describe("blockers: connectivity", () => {
  it("accepts a wall in an open room", () => {
    const r = rig([
      "#########",
      "#.......#",
      "#.......#",
      "#########",
    ]);
    expect(r.shape.canBlock(r.at(4, 1), "wall")).toBe(true);
    expect(r.shape.block(r.at(4, 1), "wall")).toBe(true);
    expect(r.tiles[r.at(4, 1)]).toBe(TILE_WALL);
    expect(r.rt.walls).toBe(1);
    expect(r.rt.refused).toBe(0);
  });

  it("refuses a tile that cuts a corridor in two and leaves everything as it was", () => {
    const r = rig([
      "###########",
      "#.........#",
      "###########",
    ]);
    const before = r.tiles.slice();
    expect(r.shape.canBlock(r.at(5, 1), "wall")).toBe(false);
    expect(r.shape.block(r.at(5, 1), "wall")).toBe(false);
    expect(Array.from(r.tiles)).toEqual(Array.from(before));
    expect(r.rt.refused).toBe(1);
    // but the corridor's end is a leaf: walling it is fine
    expect(r.shape.block(r.at(1, 1), "wall")).toBe(true);
  });

  it("lets a fenced yard close down to one opening, never to zero", () => {
    // a ring of fence (x=3..8, y=2..6) with two doors: (8,4) on the right and (5,6) at the bottom
    const rows = [
      "#############",
      "#...........#",
      "#..FFFFFF...#",
      "#..F....F...#",
      "#..F........#",
      "#..F....F...#",
      "#..FF.FFF...#",
      "#...........#",
      "#############",
    ].map((row) => row.slice(0, 13));
    const r = rig(rows);
    const doorRight = r.at(8, 4), doorBottom = r.at(5, 6);
    expect(r.shape.canBlock(doorRight, "fence")).toBe(true); // the bottom door still joins the yard to the hall
    expect(r.shape.block(doorRight, "fence")).toBe(true);
    expect(r.rt.joinUsed).toBeGreaterThanOrEqual(1); // the simple-point test cannot say, so a join check ran
    expect(r.shape.canBlock(doorBottom, "fence")).toBe(false); // the last opening
    expect(r.shape.block(doorBottom, "fence")).toBe(false);
    expect(r.tiles[doorBottom]).toBe(TILE_FLOOR);
    // the same goes the other way round, and with one door only the yard cannot be closed at all
    const q = rig(rows);
    expect(q.shape.block(doorBottom, "fence")).toBe(true);
    expect(q.shape.canBlock(doorRight, "fence")).toBe(false);
    const single = rig(rows.map((row, y) => (y === 4 ? "#..F....F...#" : row)));
    expect(single.shape.canBlock(single.at(5, 6), "fence")).toBe(false);
  });

  it("accepts a wall-to-wall fence with a ford elsewhere, by the zone-local join check, and refuses it when no ford is left", () => {
    // a fence column x=4 from the top wall to the bottom wall with two fords (y=2 and y=5): closing one is a cut by the
    // simple-point test (its ring has no link round the tile) but the other ford keeps the two banks joined
    const r = rig([
      "#########",
      "#...F...#",
      "#.......#",
      "#...F...#",
      "#...F...#",
      "#.......#",
      "#...F...#",
      "#########",
    ]);
    expect(r.shape.block(r.at(4, 2), "fence")).toBe(true); // ford at y=2 closed, ford at y=5 remains
    expect(r.rt.joinUsed).toBeGreaterThanOrEqual(1);
    expect(r.shape.canBlock(r.at(4, 5), "fence")).toBe(false); // the last ford
    expect(r.tiles[r.at(4, 5)]).toBe(TILE_FLOOR);
  });

  it("refuses a closing write when the only other route leaves the zone, and accepts it when that route is the zone's own", () => {
    const rows = (o: string) => [
      "#############",
      "#...#.......#",
      "#...........#",
      "#...#.......#",
      `#.${o}#######${o}.#`,
      `#${o}${o}${o}${o}${o}${o}${o}${o}${o}${o}${o}#`,
      "#############",
    ];
    // the rooms on both sides of the gap (4,2) are also linked through the row below, which belongs to ANOTHER zone
    const away = rig(rows("o"));
    expect(away.shape.canBlock(away.at(4, 2), "wall")).toBe(false);
    // the same row inside the zone is a second route: the join check finds it
    const own = rig(rows("."));
    expect(own.shape.canBlock(own.at(4, 2), "wall")).toBe(true);
  });

  it("refuses once the join checks are used up, even when a route exists", () => {
    const rows = [
      "#########",
      "#...F...#",
      "#.......#",
      "#...F...#",
      "#...F...#",
      "#.......#",
      "#...F...#",
      "#########",
    ];
    const spent = rig(rows, { caps: { joinChecks: 0 } });
    expect(spent.shape.canBlock(spent.at(4, 2), "fence")).toBe(false);
    const one = rig(rows, { caps: { joinChecks: 1 } });
    expect(one.shape.canBlock(one.at(4, 2), "fence")).toBe(true); // uses the one check
    expect(one.shape.canBlock(one.at(4, 2), "fence")).toBe(false); // exhausted
    expect(one.rt.joinUsed).toBe(1);
  });

  it("refuses a write that would split a territory although the zone's floor stays whole", () => {
    // one open room; territories 1 (left, columns 1-3 and the top row) and 2 (the rest). Walling (3,2) cuts territory 2 off... no:
    // territory 1 is a column that touches territory 2 only through (3,2)
    const rows = [
      "#########",
      "#.......#",
      "#.......#",
      "#.......#",
      "#########",
    ];
    const territory = [
      "000000000",
      "011222220",
      "012222220",
      "011222220",
      "000000000",
    ];
    const r = rig(rows, { territory });
    // (2,2) is the only tile that connects (1,2) to the rest of territory 1 ... (1,1),(2,1),(1,3),(2,3) and (1,2): walling (1,2) is a leaf cut, fine;
    // walling (2,1) splits territory 1 from its top-right part only if the other route is closed, which it is not:
    expect(r.shape.canBlock(r.at(1, 2), "wall")).toBe(false); // would cut (1,1) from (1,3) inside territory 1: the zone stays whole, the territory does not
    expect(r.shape.canBlock(r.at(5, 2), "wall")).toBe(true); // inside territory 2, nothing splits
  });
});

describe("blockers: where they may stand", () => {
  const open = [
    "###########",
    "#.........#",
    "#.........#",
    "#.........#",
    "#.........#",
    "###########",
  ];

  it("refuses protected tiles, tiles of other zones, walls and the grid edge", () => {
    const r = rig([
      "###########",
      "#...,.....#",
      "#.........#",
      "#....W....#",
      "#.........#",
      "###########",
    ]);
    expect(r.shape.canBlock(r.at(4, 1), "wall")).toBe(false); // protected
    expect(r.shape.canBlock(r.at(5, 3), "wall")).toBe(false); // already a wall
    expect(r.shape.canBlock(r.at(0, 0), "wall")).toBe(false); // the border
    expect(r.shape.canBlock(r.at(9, 2), "wall")).toBe(true);
    expect(r.shape.canBlock(-1, "wall")).toBe(false);
  });

  it("keeps a margin from the zone's rim: no blocker within 3 tiles of a tile outside the zone", () => {
    const r = rig([
      "#############",
      "#...........#",
      "#...........#",
      "#...........#",
      "#...........#",
      "#...........#",
      "#...........#",
      "#...........#",
      "#############",
    ], { caps: { rimTiles: 3 } });
    // the zone is 11x7: a tile is 3 tiles from the rim only when its chamfer distance is 9+ (three steps from outside)
    expect(r.shape.canBlock(r.at(1, 1), "wall")).toBe(false);
    expect(r.shape.canBlock(r.at(2, 3), "wall")).toBe(false);
    expect(r.shape.canBlock(r.at(3, 3), "wall")).toBe(true);
    expect(r.shape.canBlock(r.at(6, 4), "wall")).toBe(true);
    expect(r.shape.canBlock(r.at(6, 1), "wall")).toBe(false);
    expect(r.shape.open(r.at(6, 4))).toBe(true);
    expect(r.shape.open(r.at(1, 1))).toBe(false);
  });

  it("never stands beside another zone's floor (a seam), even with no rim margin", () => {
    const r = rig([
      "#########",
      "#...oooo#",
      "#...oooo#",
      "#...oooo#",
      "#########",
    ]);
    expect(r.shape.canBlock(r.at(3, 2), "wall")).toBe(false); // its east neighbours are another zone's floor
    expect(r.shape.canBlock(r.at(1, 2), "wall")).toBe(true);
  });

  it("refuses a reserved tile, then takes it back never", () => {
    const r = rig(open);
    r.shape.reserve(r.at(4, 2));
    expect(r.shape.isReserved(r.at(4, 2))).toBe(true);
    expect(r.shape.canBlock(r.at(4, 2), "wall")).toBe(false);
    expect(r.shape.canBlock(r.at(5, 2), "wall")).toBe(true);
  });

  it("places straight wall runs of any length (the cover's 14-tile run cap is retired with the cover)", () => {
    const w = 20;
    const mid = "#" + ".".repeat(w - 2) + "#";
    const rows = ["#".repeat(w), mid, mid, mid, mid, mid, "#".repeat(w)];
    const r = rig(rows);
    const y = 3;
    for (let x = 2; x <= 17; x++) expect(r.shape.block(r.at(x, y), "wall"), `x=${x}`).toBe(true); // 16 tiles in a row
    // the row may reach one side but never close: walling both ends would cut the room in two
    expect(r.shape.block(r.at(1, y), "wall")).toBe(true);
    expect(r.shape.canBlock(r.at(18, y), "wall")).toBe(false);
  });

  it("keeps LOW features thin: every LOW tile keeps floor within 2 tiles, so a band is at most 4 thick and its core is refused", () => {
    const rows = ["#".repeat(13)];
    for (let y = 1; y <= 11; y++) rows.push("#" + ".".repeat(11) + "#");
    rows.push("#".repeat(13));
    const r = rig(rows);
    // a 6x5 lava lake at x=4..9, y=4..8, stamped from its edge inwards
    const band: Array<[number, number, number]> = [];
    for (let y = 4; y <= 8; y++) for (let x = 4; x <= 9; x++) band.push([x, y, Math.min(x - 4, 9 - x, y - 4, 8 - y)]);
    band.sort((a, b) => a[2] - b[2] || a[1] - b[1] || a[0] - b[0]);
    let accepted = 0;
    for (const [x, y] of band) if (r.shape.block(r.at(x, y), "lava")) accepted++;
    expect(accepted).toBeGreaterThan(18);
    expect(accepted).toBeLessThan(band.length); // the core of a lake this thick cannot all be LOW
    for (let y = 1; y <= 11; y++) {
      for (let x = 1; x <= 11; x++) {
        if (r.tiles[r.at(x, y)] !== TILE_LOW) continue;
        let ok = false;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (Math.abs(dx) + Math.abs(dy) <= 2 && r.tiles[r.at(x + dx, y + dy)] === TILE_FLOOR) ok = true;
        expect(ok, `LOW tile ${x},${y} keeps a floor tile within 2`).toBe(true);
      }
    }
  });

  it("will not wall the one floor tile that LOW tiles around it rely on", () => {
    const rows = ["#####", "#VVV#", "#V.V#", "#####"];
    const r = rig(rows);
    expect(r.shape.canBlock(r.at(2, 2), "wall")).toBe(false);
    // the same grid with walls in place of the LOW tiles has nothing to strand
    const w = rig(["#####", "#WWW#", "#W.W#", "#####"]);
    expect(w.shape.canBlock(w.at(2, 2), "wall")).toBe(true);
  });

  it("stays out of ICE's 8-neighbourhood, and puts ICE only where all eight neighbours are floor", () => {
    const r = rig([
      "###########",
      "#.........#",
      "#....i....#",
      "#.........#",
      "#.........#",
      "###########",
    ]);
    expect(r.shape.canBlock(r.at(4, 1), "wall")).toBe(false); // diagonal neighbour of the ice
    expect(r.shape.canBlock(r.at(6, 3), "wall")).toBe(false);
    expect(r.shape.canBlock(r.at(7, 2), "wall")).toBe(true); // two tiles away
    expect(r.surf.canSurface(r.at(7, 3), "ice")).toBe(true);
    expect(r.surf.canSurface(r.at(1, 1), "ice")).toBe(false); // against the wall ring
    const w = rig([
      "###########",
      "#.........#",
      "#....W....#",
      "#.........#",
      "#.........#",
      "###########",
    ]);
    expect(w.surf.canSurface(w.at(5, 1), "ice")).toBe(false);
    expect(w.surf.canSurface(w.at(6, 2), "ice")).toBe(false);
    expect(w.surf.canSurface(w.at(8, 2), "ice")).toBe(true);
    expect(w.surf.canSurface(w.at(9, 2), "ice")).toBe(false); // the border wall is one tile away
  });

  it("holds the footprint budget: 1.0 per wall and per LOW tile alike, at most 13% of the zone", () => {
    const r = rig(open, { caps: { footprintPct: 13 } });
    // 9x4 = 36 zone tiles: the budget is 4.68 tiles, so 4 walls fit and the 5th does not
    const free = [[1, 1], [3, 1], [5, 1], [7, 1], [1, 3], [3, 3], [5, 3], [7, 3], [9, 1], [9, 3]];
    let placed = 0;
    for (const [x, y] of free) if (r.shape.block(r.at(x, y), "wall")) placed++;
    expect(placed).toBe(4);
    const lowRig = rig(open, { caps: { footprintPct: 13 } });
    expect(lowRig.shape.block(lowRig.at(3, 2), "lava")).toBe(true); // 1 of 4.68
    expect(lowRig.shape.block(lowRig.at(6, 2), "lava")).toBe(true);
    expect(lowRig.shape.block(lowRig.at(1, 1), "wall")).toBe(true);
    expect(lowRig.shape.block(lowRig.at(9, 4), "wall")).toBe(true); // 4 of 4.68
    expect(lowRig.shape.canBlock(lowRig.at(8, 3), "lava")).toBe(false); // 5 > 4.68
    expect(lowRig.shape.canBlock(lowRig.at(1, 4), "wall")).toBe(false);
  });

  it("has the contract's caps: 13% and 512 join checks for the shape pass, 4% and 128 for the landmarks, fence detour 10, rim 3", () => {
    expect(ZONE_STYLE_CAPS).toEqual({ joinChecks: 512, footprintPct: 13, rimTiles: 3, fenceDetour: 10 });
    expect(LANDMARK_CAPS).toEqual({ joinChecks: 128, footprintPct: 4, rimTiles: 3, fenceDetour: 10 });
    expect(FEATURE_MIN_PIECE).toBe(6);
  });
});

describe("blockers: footprint accounting with LOW tiles the pass did not write", () => {
  const river = [
    "###########",
    "#.........#",
    "#.FFFFFFF.#",
    "#.........#",
    "###########",
  ];

  it("walls a pre-existing LOW tile as a new wall: no refund, no negative LOW count, the wall cost is checked", () => {
    const r = rig(river, { caps: { footprintPct: 100 } });
    expect(r.shape.canBlock(r.at(4, 2), "wall")).toBe(true);
    expect(r.shape.block(r.at(4, 2), "wall")).toBe(true);
    expect(r.tiles[r.at(4, 2)]).toBe(TILE_WALL);
    expect(r.terrain[r.at(4, 2)]).toBe(TERRAIN_FENCE); // the kind stays: a pillar in the feature
    expect(r.rt.lows).toBe(0); // it was never ours to give back
    expect(r.rt.walls).toBe(1);
    // the same tile cannot be taken twice, and it cannot be released (the pass did not lay the LOW tile)
    expect(r.shape.canBlock(r.at(4, 2), "wall")).toBe(false);
    expect(r.shape.release(r.at(4, 2))).toBe(false);
  });

  it("charges the wall cost for it: a budget of three tiles refuses the fourth pillar in somebody else's river", () => {
    // 9x3 = 27 zone tiles at 13%: 3.51 tiles, so 3 walls fit, the 4th does not
    const r = rig(river, { caps: { footprintPct: 13 } });
    const river4 = [3, 5, 7, 2].map((x) => r.at(x, 2));
    let placed = 0;
    for (const i of river4) if (r.shape.block(i, "wall")) placed++;
    expect(placed).toBe(3);
    expect(r.rt.walls).toBe(3);
    expect(r.rt.lows).toBe(0);
    expect(r.shape.canBlock(river4[3], "wall")).toBe(false);
    // while a LOW tile the pass wrote itself turns into a pillar for free (it is already in the footprint)
    const own = rig(["###########", "#.........#", "#.........#", "#.........#", "###########"], { caps: { footprintPct: 13 } });
    expect(own.shape.block(own.at(3, 2), "lava")).toBe(true); // 1 of 3.51
    expect(own.shape.block(own.at(5, 2), "lava")).toBe(true); // 2
    expect(own.shape.block(own.at(7, 2), "lava")).toBe(true); // 3
    expect(own.shape.canBlock(own.at(1, 1), "lava")).toBe(false); // 4 would pass the cap
    expect(own.shape.canBlock(own.at(3, 2), "wall")).toBe(true);
    expect(own.shape.block(own.at(3, 2), "wall")).toBe(true);
    expect(own.rt.lows).toBe(2);
    expect(own.rt.walls).toBe(1);
  });

  it("keeps the pass's own footprint under the cap when it walls a generator-made river (styleZones, the review's scenario)", () => {
    const W = 40, H = 40, n = W * H;
    const tiles = new Uint8Array(n), zone = new Uint8Array(n);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; if (!x || !y || x === W - 1 || y === H - 1) tiles[i] = TILE_WALL; else zone[i] = 1; }
    for (let x = 4; x < W - 4; x++) if (x % 6) tiles[20 * W + x] = TILE_LOW;
    const st: ZoneStyleState = {
      w: W, h: H, seed: 5, attempt: 0, tiles, terrain: new Uint8Array(n), props: [], zone, zoneFaction: REGION_FACTIONS.slice(0, 1),
      protect: new Uint8Array(n), territory: null, camps: [], keepLow: new Uint8Array(n),
    };
    const before = tiles.slice();
    // walls every LOW tile, then fills floor with walls until the guard refuses
    const greedy: ZoneStyler<null> = {
      id: "scorch", faction: "fire", version: 0,
      shape: (ctx) => {
        for (let i = 0; i < n; i++) if (ctx.tiles[i] === TILE_LOW) ctx.block(i, "wall");
        for (let i = 0; i < n; i += 3) ctx.block(i, "wall");
        return null;
      },
    };
    const [res] = styleZones(st, { stylers: { fire: greedy } });
    let painted = 0, fromFloor = 0, fromLow = 0;
    for (let i = 0; i < n; i++) {
      if (zone[i]) painted++;
      if (before[i] === TILE_FLOOR && tiles[i] === TILE_WALL) fromFloor++;
      if (before[i] === TILE_LOW && tiles[i] === TILE_WALL) fromLow++;
    }
    expect(fromLow, "the greedy styler walled the river").toBeGreaterThan(10);
    expect(res.low, "no LOW was written, so none is counted").toBe(0);
    expect(res.walls).toBe(fromFloor + fromLow);
    expect(res.blocked).toBe(res.walls);
    const effective = (fromFloor + fromLow) / painted;
    expect(effective, "the footprint of the pass stays under the 13% cap").toBeLessThanOrEqual(0.13 + 1e-9);
    expect(effective, "and the budget was the binding limit, not the styler's patience").toBeGreaterThan(0.12);
  });
});

describe("blockers: writes", () => {
  it("writes a wall (clearing a floor kind), a LOW kind, and keeps the LOW kind under a pillar", () => {
    const r = rig([
      "#########",
      "#.......#",
      "#.......#",
      "#.......#",
      "#########",
    ]);
    r.terrain[r.at(3, 2)] = TERRAIN_ICE; // a floor kind that a wall wipes
    expect(r.shape.block(r.at(3, 2), "wall")).toBe(true);
    expect(r.tiles[r.at(3, 2)]).toBe(TILE_WALL);
    expect(r.terrain[r.at(3, 2)]).toBe(0);
    expect(r.shape.block(r.at(5, 2), "lava")).toBe(true);
    expect(r.tiles[r.at(5, 2)]).toBe(TILE_LOW);
    expect(r.terrain[r.at(5, 2)]).toBe(TERRAIN_LAVA);
    expect(r.shape.block(r.at(5, 2), "wall")).toBe(true); // a pillar in the river
    expect(r.tiles[r.at(5, 2)]).toBe(TILE_WALL);
    expect(r.terrain[r.at(5, 2)]).toBe(TERRAIN_LAVA);
    expect(r.rt.walls).toBe(2);
    expect(r.rt.lows).toBe(0);
    // a protected LOW tile is not a pillar site
    const p = rig(["#####", "#,.V#", "#####"]);
    expect(p.shape.canBlock(p.at(3, 1), "wall")).toBe(true);
    const hard = rig(["#####", "#.,.#", "#####"]);
    hard.tiles[hard.at(2, 1)] = TILE_LOW;
    expect(hard.shape.canBlock(hard.at(2, 1), "wall")).toBe(false);
  });

  it("leaves the floor in one piece whatever order a hundred random writes arrive in", () => {
    // random open rooms with random write attempts: the guard alone keeps the floor connected
    for (let seed = 1; seed <= 30; seed++) {
      const w = 18, h = 14;
      const rows: string[] = [];
      let s = seed * 7919;
      const rnd = () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return (s >>> 8) / 16777216; };
      for (let y = 0; y < h; y++) rows.push([...Array(w)].map((_, x) => (x === 0 || y === 0 || x === w - 1 || y === h - 1 ? "#" : rnd() < 0.12 ? "W" : ".")).join(""));
      const r = rig(rows, { caps: { joinChecks: 500, footprintPct: 100 } });
      const compsBefore = components(r.tiles, w, h);
      for (let k = 0; k < 400; k++) {
        const x = 1 + Math.floor(rnd() * (w - 2)), y = 1 + Math.floor(rnd() * (h - 2));
        r.shape.block(r.at(x, y), rnd() < 0.5 ? "wall" : "fence");
      }
      expect(components(r.tiles, w, h), `seed ${seed}`).toBeLessThanOrEqual(compsBefore);
      expect(floors(r.tiles)).toBeGreaterThan(0);
    }
  });
});

describe("blockers: detours", () => {
  it("holds fences to the cap too, on pairs up to 3 steps either side, and measures the extra steps", () => {
    // a fence at (4,2) with a free row above: tiles either side walk round it in 2 extra steps whatever their distance
    const rows = [
      "#########",
      "#.......#",
      "#.......#",
      "#...W...#",
      "#.......#",
      "#.......#",
      "#########",
    ];
    const two = rig(rows, { caps: { fenceDetour: 2 } });
    expect(two.shape.canBlock(two.at(4, 2), "fence")).toBe(true);
    const one = rig(rows, { caps: { fenceDetour: 1 } });
    expect(one.shape.canBlock(one.at(4, 2), "fence")).toBe(false);
    expect(one.shape.fenceDetourOk(one.at(4, 2))).toBe(false); // the same test, on a tile that is not LOW yet
    // a long wall: a fence in the middle of a corridor-wide gap whose far side is 3 steps off needs a longer walk at k = 3
    const gap = rig([
      "#############",
      "#...........#",
      "#.WWWW.WWWW.#",
      "#...........#",
      "#############",
    ], { caps: { fenceDetour: 10 } });
    expect(gap.shape.canBlock(gap.at(6, 2), "fence")).toBe(true); // the way round is 5 + 2 + 5 = 12 = 2 + 10 steps, and exactly that
    const tight = rig([
      "#############",
      "#...........#",
      "#.WWWW.WWWW.#",
      "#...........#",
      "#############",
    ], { caps: { fenceDetour: 9 } });
    expect(tight.shape.canBlock(tight.at(6, 2), "fence")).toBe(false);
  });

  it("gives back only LOW tiles this pass wrote", () => {
    const r = rig([
      "###########",
      "#.........#",
      "#....F....#",
      "#.........#",
      "###########",
    ]);
    expect(r.shape.release(r.at(5, 2))).toBe(false); // not written by this pass
    expect(r.shape.block(r.at(2, 2), "fence")).toBe(true);
    expect(r.shape.release(r.at(2, 2))).toBe(true);
    expect(r.tiles[r.at(2, 2)]).toBe(TILE_FLOOR);
    expect(r.terrain[r.at(2, 2)]).toBe(0);
    expect(r.rt.lows).toBe(0);
    expect(r.shape.release(r.at(2, 2))).toBe(false);
    expect(r.shape.release(r.at(3, 2))).toBe(false); // plain floor
  });
});

describe("surfaces", () => {
  it("puts EMBER only beside lava, never on a protected tile, and refuses tiles that already carry a kind", () => {
    const r = rig([
      "###########",
      "#.........#",
      "#..VV.....#",
      "#...,.....#",
      "#.........#",
      "###########",
    ]);
    expect(r.surf.canSurface(r.at(5, 1), "ember")).toBe(true); // diagonal to (4,2)
    expect(r.surf.canSurface(r.at(8, 1), "ember")).toBe(false); // nowhere near lava
    expect(r.surf.canSurface(r.at(4, 3), "ember")).toBe(false); // protected
    expect(r.surf.surface(r.at(5, 1), "ember")).toBe(true);
    expect(r.surf.surface(r.at(5, 1), "ember")).toBe(false); // already carries a kind
    expect(r.surf.canSurface(r.at(3, 2), "bog")).toBe(false); // lava, not floor
    expect(r.surf.canSurface(r.at(8, 3), "bog")).toBe(true);
    expect(r.surf.canSurface(r.at(8, 3), "light")).toBe(true);
    expect(r.rt.surfaced).toBe(1);
  });

  it("lets the ring road's outer band take LIGHT only, and a margin take any hazard", () => {
    const rows = ["#######", "#.....#", "#.....#", "#######"];
    const r = rig(rows);
    const band = r.rt.init.noBlock;
    band[r.at(2, 1)] = 1; // the ring band
    band[r.at(4, 1)] = 2; // a ruin's ring
    expect(r.surf.canSurface(r.at(2, 1), "bog")).toBe(false);
    expect(r.surf.canSurface(r.at(2, 1), "light")).toBe(true);
    expect(r.surf.canSurface(r.at(4, 1), "bog")).toBe(true);
    expect(r.shape.canBlock(r.at(2, 1), "wall")).toBe(false);
    expect(r.shape.canBlock(r.at(4, 1), "wall")).toBe(false);
  });
});

function components(tiles: Uint8Array, w: number, h: number): number {
  const seen = new Uint8Array(w * h);
  let n = 0;
  for (let s = 0; s < w * h; s++) {
    if (tiles[s] !== TILE_FLOOR || seen[s]) continue;
    n++;
    const stack = [s];
    seen[s] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % w;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) if (j >= 0 && j < w * h && tiles[j] === TILE_FLOOR && !seen[j]) { seen[j] = 1; stack.push(j); }
    }
  }
  return n;
}

describe("features (placeFeature, contract 3.1)", () => {
  const room = [
    "##############",
    "#............#",
    "#............#",
    "#............#",
    "#............#",
    "#............#",
    "#............#",
    "##############",
  ];
  const line = (r: ReturnType<typeof rig>, y: number, x0: number, x1: number): Array<[number, "wall"]> => {
    const out: Array<[number, "wall"]> = [];
    for (let x = x0; x <= x1; x++) out.push([r.at(x, y), "wall"]);
    return out;
  };

  it("whole: writes every block, owns them and the floor it lists, and records the feature with its box and tile count", () => {
    const r = rig(room);
    const placed = r.shape.placeFeature({ kind: "crater", jobs: ["pen"], anchor: [2, 2], params: [3, 20], blocks: line(r, 2, 2, 8), floor: [r.at(4, 3), r.at(5, 3), r.at(5, 2)], mode: "whole" });
    expect(placed).not.toBeNull();
    expect(placed!.id).toBe(0);
    expect(placed!.written).toEqual(line(r, 2, 2, 8).map(([i]) => i));
    expect(placed!.refused).toBe(0);
    const f = r.rt.init.features[0];
    expect(f).toMatchObject({ kind: "crater", variant: "", zone: "fire", jobs: ["pen"], ax: 2, ay: 2, p: [3, 20], tiles: 9, bbox: { x: 2, y: 2, w: 7, h: 2 } });
    // the floor tile (5, 2) was written as a block first, so only the two real floor tiles are owned as floor
    for (let x = 2; x <= 8; x++) expect(r.rt.init.featureOwner[r.at(x, 2)]).toBe(1);
    expect(r.rt.init.featureOwner[r.at(4, 3)]).toBe(1);
    expect(r.tiles[r.at(4, 3)]).toBe(TILE_FLOOR);
    expect(r.shape.isOwned(r.at(4, 3))).toBe(true);
    expect(r.shape.zoneFeatures()).toHaveLength(1);
    expect(r.rt.walls).toBe(7);
  });

  it("whole: one refused block rolls everything back (tiles, kinds, counters) and records nothing", () => {
    const r = rig(room);
    r.shape.reserve(r.at(9, 4));
    const before = r.tiles.slice(), terr = r.terrain.slice();
    const blocks: Array<[number, "lava" | "wall"]> = [[r.at(3, 4), "lava"], [r.at(4, 4), "lava"], [r.at(9, 4), "wall"]];
    expect(r.shape.placeFeature({ kind: "lavaRiver", jobs: ["crossing"], anchor: [3, 4], blocks, mode: "whole" })).toBeNull();
    expect(Buffer.from(r.tiles).equals(Buffer.from(before))).toBe(true);
    expect(Buffer.from(r.terrain).equals(Buffer.from(terr))).toBe(true);
    expect([r.rt.walls, r.rt.lows]).toEqual([0, 0]);
    expect(r.rt.init.features).toHaveLength(0);
    expect(r.rt.init.featureOwner.every((v) => v === 0)).toBe(true);
    expect(r.rt.init.wrote.every((v) => v === 0)).toBe(true);
  });

  it("first owner wins: a later feature never takes an owned tile (block or floor), and open() refuses owned tiles", () => {
    const r = rig(room);
    expect(r.shape.placeFeature({ kind: "mere", jobs: ["crossing"], anchor: [6, 4], blocks: [], floor: [r.at(6, 4), r.at(7, 4)], mode: "whole" })).not.toBeNull();
    expect(r.shape.open(r.at(6, 4))).toBe(false);
    expect(r.shape.canBlock(r.at(6, 4), "wall")).toBe(false);
    expect(r.shape.placeFeature({ kind: "headland", jobs: ["lee"], anchor: [6, 4], blocks: [[r.at(6, 4), "wall"]], mode: "whole" })).toBeNull();
    const second = r.shape.placeFeature({ kind: "causeway", jobs: ["crossing"], anchor: [7, 4], blocks: [], floor: [r.at(7, 4), r.at(8, 4)], mode: "whole" });
    expect(second!.id).toBe(1);
    expect(r.rt.init.features[1].tiles).toBe(1); // (7, 4) was the mere's
    expect(r.rt.init.featureOwner[r.at(7, 4)]).toBe(1);
    expect(r.rt.init.featureOwner[r.at(8, 4)]).toBe(2);
    // a feature that would own nothing is not recorded
    expect(r.shape.placeFeature({ kind: "causeway", jobs: ["crossing"], anchor: [7, 4], blocks: [], floor: [r.at(7, 4)], mode: "whole" })).toBeNull();
    expect(r.rt.init.features).toHaveLength(2);
  });

  it("trim: keeps what the guard allows, gives back the pieces under minPiece, and drops the feature under its share", () => {
    const r = rig(room);
    r.shape.reserve(r.at(6, 3));
    // a row of 9 with a reserved hole at x=6: pieces of 4 (x 2..5) and 4 (x 7..10) ... both under 6 -> all given back, share 0
    const row = line(r, 3, 2, 10);
    expect(r.shape.placeFeature({ kind: "fenceRow", jobs: ["lane"], anchor: [2, 3], blocks: row, mode: "trim" })).toBeNull();
    expect(r.tiles.every((t, i) => t === TILE_FLOOR || r.rt.init.mask[i] === 0)).toBe(true);
    expect(r.rt.walls).toBe(0);
    // move the hole to x=9: a piece of 7 (x 2..8) stands, the piece of 1 (x 10) goes back; 7 of 9 = 778 permille >= 600
    const r2 = rig(room);
    r2.shape.reserve(r2.at(9, 3));
    const p = r2.shape.placeFeature({ kind: "fenceRow", jobs: ["lane"], anchor: [2, 3], blocks: line(r2, 3, 2, 10), mode: "trim" });
    expect(p!.written).toEqual(line(r2, 3, 2, 8).map(([i]) => i));
    expect(p!.refused).toBe(2);
    expect(r2.tiles[r2.at(10, 3)]).toBe(TILE_FLOOR);
    expect(r2.rt.walls).toBe(7);
    expect(r2.rt.init.features[0].tiles).toBe(7);
    // the same with a share of 800 permille: 778 is too little, everything goes back
    const r3 = rig(room);
    r3.shape.reserve(r3.at(9, 3));
    expect(r3.shape.placeFeature({ kind: "fenceRow", jobs: ["lane"], anchor: [2, 3], blocks: line(r3, 3, 2, 10), mode: "trim", minSharePermille: 800 })).toBeNull();
    expect(r3.rt.walls).toBe(0);
  });

  it("trim: a piece counts the walls already on the map", () => {
    const r = rig([
      "##############",
      "#............#",
      "#.WWW........#",
      "#............#",
      "#............#",
      "##############",
    ]);
    // 3 new tiles next to 3 old walls make a piece of 6: it stands
    const p = r.shape.placeFeature({ kind: "barrow", jobs: ["fork"], anchor: [5, 2], blocks: line(r, 2, 5, 7), mode: "trim", minSharePermille: 1000 });
    expect(p!.written).toHaveLength(3);
  });

  it("groups: each group stands whole or not at all; the feature needs minGroups of them", () => {
    const r = rig(room);
    r.shape.reserve(r.at(10, 5));
    const blocks: Array<[number, "wall"]> = [], groups: number[] = [];
    const pier = (x0: number, y0: number, g: number): void => { for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) { blocks.push([r.at(x0 + dx, y0 + dy), "wall"]); groups.push(g); } };
    pier(2, 2, 0); pier(6, 2, 1); pier(9, 4, 2); // the third pier holds the reserved tile
    const p = r.shape.placeFeature({ kind: "hall", jobs: ["cover", "rest"], anchor: [6, 3], blocks, groups, mode: "groups", minGroups: 2 });
    expect(p!.written).toHaveLength(8);
    expect(p!.refused).toBe(4);
    for (const [x, y] of [[9, 4], [10, 4], [9, 5]]) expect(r.tiles[r.at(x, y)]).toBe(TILE_FLOOR);
    expect(r.rt.walls).toBe(8);
    const r2 = rig(room);
    r2.shape.reserve(r2.at(10, 5));
    r2.shape.reserve(r2.at(6, 2));
    expect(r2.shape.placeFeature({ kind: "hall", jobs: ["cover"], anchor: [6, 3], blocks, groups, mode: "groups", minGroups: 2 })).toBeNull();
    expect(r2.rt.walls).toBe(0);
    expect(r2.tiles.filter((t) => t === TILE_WALL).length).toBe(room.join("").split("#").length - 1);
  });
});

describe("the route guard in the style pass", () => {
  it("keeps bog and ice off the corridors of the zone's pool members (the guard is built before the shape pass)", () => {
    const W = 40, H = 40, n = W * H;
    const tiles = new Uint8Array(n), zone = new Uint8Array(n);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; if (!x || !y || x === W - 1 || y === H - 1) tiles[i] = TILE_WALL; else if (x >= 4) zone[i] = 1; }
    // the "coliseum": the walk field is seeded at (1, 20), outside the zone; one member at (30, 20)
    const centreWalk = walkField16(tiles, W, H, [20 * W + 1]);
    const member = 20 * W + 30;
    const st: ZoneStyleState = {
      w: W, h: H, seed: 5, attempt: 0, tiles, terrain: new Uint8Array(n), props: [], zone, zoneFaction: ["plague"],
      protect: new Uint8Array(n), territory: null, camps: [], spawns: [member], centreWalk,
    };
    const mask = zone.slice();
    const guard = makeRouteGuard({ w: W, h: H, mask, tiles: tiles.slice(), spawns: [member], centreWalk });
    const bogAll: ZoneStyler<null> = {
      id: "warren", faction: "plague", version: 0,
      shape: () => null,
      surface: (ctx) => { for (let i = 0; i < n; i++) ctx.surface(i, "bog"); },
    };
    styleZones(st, { stylers: { plague: bogAll } });
    let onCorridor = 0, bog = 0;
    for (let i = 0; i < n; i++) {
      if (guard.corridor[i]) onCorridor++;
      if (st.terrain[i] === TERRAIN_BOG) { bog++; expect(guard.corridor[i], `bog on the corridor at ${i % W},${Math.floor(i / W)}`).toBe(0); }
    }
    expect(onCorridor).toBeGreaterThan(20);
    expect(bog).toBeGreaterThan(500);
  });
});

describe("the landmark stage (styleLandmarks)", () => {
  it("runs each zone's landmark() on stream 3 with the landmark caps, and records what it places", () => {
    const W = 30, H = 20, n = W * H;
    const tiles = new Uint8Array(n), zone = new Uint8Array(n);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; if (!x || !y || x === W - 1 || y === H - 1) tiles[i] = TILE_WALL; else zone[i] = 1; }
    const features: FeatureDraft[] = [];
    const featureOwner = new Uint16Array(n);
    let seen: { caps: unknown; first: number; spawns: number; walk: unknown } | null = null;
    const stub: ZoneStyler<null> = {
      id: "scorch", faction: "fire", version: 0,
      landmark: (c) => {
        seen = { caps: c.caps, first: c.rng(), spawns: c.spawns.length, walk: c.centreWalk };
        const walls: Array<[number, "wall"]> = [];
        for (let x = 10; x <= 15; x++) walls.push([c.at(x, 8), "wall"]);
        c.placeFeature({ kind: "landmark", variant: "forge", jobs: ["landmark", "lee"], anchor: [10, 8], params: [0, 0], blocks: walls, floor: [c.at(12, 9)], mode: "whole" });
      },
      shape: () => null,
    };
    const res = styleLandmarks(
      { w: W, h: H, seed: 9, attempt: 2, tiles, zone, zoneFaction: ["fire"], protect: new Uint8Array(n), territoryGrid: new Uint8Array(n), camps: [], features, featureOwner },
      { stylers: { fire: stub } },
    );
    expect(seen!.caps).toEqual(LANDMARK_CAPS);
    expect(seen!.first).toBe(styleRng(9, 2, 1, STYLE_STREAM.landmark)());
    expect([seen!.spawns, seen!.walk]).toEqual([0, null]);
    expect(res).toEqual([{ index: 1, faction: "fire", landmarks: 1, walls: 6, ms: res[0].ms }]);
    expect(features).toHaveLength(1);
    expect(features[0]).toMatchObject({ kind: "landmark", variant: "forge", jobs: ["landmark", "lee"], tiles: 7, p: [0, 0] });
    expect(featureOwner[12 + 9 * W]).toBe(1);
  });
});
