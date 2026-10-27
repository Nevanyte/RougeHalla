// The zone duel harness (src/harness/zoneDuel.ts, zone-shapes contract 8.3) and the duel engine's new inputs (src/harness/duel.ts: a
// ready map, explicit starts, the fence-row arenas). Small and fast: the numbers the harness prints are information for the owner and are
// never asserted here, only that the arenas are built by the Gallows' rule, that the setups stand where the condition says, that a fence
// stops what the sim says it stops, and that the default duel path is the one it was before the zone duels existed.
import { describe, expect, it } from "vitest";
import {
  BEATS, circleClear, findPath, hasLineOfSight, mapFromTiles, MASK_SIGHT, PLAYER_RADIUS, SIGNATURE_WEAPONS, TERRAIN_FENCE, TILE, TILE_FLOOR, TILE_LOW,
  TILE_WALL, REGION_IDS, type FactionId, type GameMap,
} from "@raid/shared";
import {
  ARENA_TILES, buildArena, isRowsArena, ROWS_LAYOUTS, ROWS_S_LO, rowsGateOpen, runDuel, startPoints, type RowsArena,
} from "../src/harness/duel";
import {
  nearestGateCentre, parseZoneArgs, proposeMitigation, ROWS_ACROSS, ROWS_ANGLES, ROWS_HOLD, ROWS_LATERAL, rowsReport, rowsSetups, rowsStarts, rowsStats,
  runMapDuels, runRowsDuel, runZoneCli, wilson, zonePairs, PAIR_MAX_TILES, PAIR_MIN_TILES,
} from "../src/harness/zoneDuel";
import { fingerprints } from "./support/duelFingerprint";

// ---------------------------------------------------------------------------------------------------------------- the default path

// Taken from duel.ts BEFORE it learned `map`, `starts` and the rows arenas (see support/duelFingerprint.ts).
const PINNED: ReadonlyArray<readonly [string, string]> = [
  ["holy wand>bow open", "a454c8be4b72b8a9"],
  ["fire bow>wand open", "e5c7fda7bb8af2cc"],
  ["fire sword>axe open", "baa74724795a3b07"],
  ["frost shield mirror capped", "14f56b657b4cdcf6"],
  ["fire sword mirror pillars", "6c92ca1c860022aa"],
  ["plague bow mirror pillars", "d56c1e1ea5b15192"],
  ["fire/sentenced locks signatures", "7f531f367baa0e5f"],
  ["fire bow mirror start offset", "08ff2f5d83035203"],
  ["holy bow>sword stale", "50efcd52cf136489"],
  ["holy bow>sword present", "75cfd8b94af36fcc"],
  ["fire wand>shield buffed", "958fdee85c7601fe"],
];

describe("the default duel path", () => {
  it("gives the same result, to the last number, as before the zone duels (open and pillar arenas, locks, signatures, perceptions, offsets, buffs)", () => {
    expect(fingerprints()).toEqual(PINNED.map(([n, h]) => [n, h]));
  });

  it("builds the open and pillar arenas as it always did, with nothing from the rows arenas in them", () => {
    const starts = startPoints(300, 0.1);
    const open = buildArena("open", starts, 1);
    expect(open.tiles.filter((t) => t === TILE_LOW)).toHaveLength(0);
    expect(open.terrain.every((t) => t === 0)).toBe(true);
    const pillars = buildArena("pillars", starts, 1);
    expect(pillars.tiles.filter((t) => t === TILE_LOW)).toHaveLength(0);
    expect(pillars.tiles.filter((t) => t === TILE_WALL).length).toBeGreaterThan(open.tiles.filter((t) => t === TILE_WALL).length);
  });
});

// ---------------------------------------------------------------------------------------------------------------- the rows arenas

const ROWS: readonly RowsArena[] = ["rows", "rows10", "rows4w", "rows6"];
const idx = (x: number, y: number): number => y * ARENA_TILES + x;

/** The positions along a row (tile y) that are gates, read off the built arena. */
function gatesOf(arena: RowsArena, row: number): number[] {
  const map = buildArena(arena, startPoints(300), 1);
  const x = ROWS_LAYOUTS[arena].xs[row]!;
  const out: number[] = [];
  for (let y = 1; y < ARENA_TILES - 1; y++) if (map.tiles[idx(x, y)] === TILE_FLOOR) out.push(y);
  return out;
}

describe("the fence-row arenas", () => {
  it("are 40x40 with a wall border, rows of fence along y at x = 8, 16, 24, 32 (rows6: 10, 20, 30), and nothing else", () => {
    expect(ROWS_LAYOUTS.rows.xs).toEqual([8, 16, 24, 32]);
    expect(ROWS_LAYOUTS.rows6.xs).toEqual([10, 20, 30]);
    for (const arena of ROWS) {
      const map = buildArena(arena, startPoints(300), 1);
      expect([map.w, map.h]).toEqual([ARENA_TILES, ARENA_TILES]);
      const rowXs = new Set(ROWS_LAYOUTS[arena].xs);
      for (let y = 0; y < ARENA_TILES; y++) {
        for (let x = 0; x < ARENA_TILES; x++) {
          const t = map.tiles[idx(x, y)]!;
          const border = x === 0 || y === 0 || x === ARENA_TILES - 1 || y === ARENA_TILES - 1;
          if (border) expect(t, `border ${x},${y}`).toBe(TILE_WALL);
          else if (rowXs.has(x)) expect([TILE_FLOOR, TILE_LOW], `${arena} row tile ${x},${y}`).toContain(t);
          else expect(t, `${arena} ${x},${y}`).toBe(TILE_FLOOR);
          // Every fence tile is a fence in the terrain layer (the art and the zone rules read that), and nothing else carries terrain.
          expect(map.terrain[idx(x, y)], `${arena} terrain ${x},${y}`).toBe(t === TILE_LOW ? TERRAIN_FENCE : 0);
        }
      }
    }
  });

  it("cut their gates by the Gallows' rule: 3 tiles every 12, phase 2 on even rows and 8 on odd, counted from the first interior tile", () => {
    // Written out by hand (position s = y - 1): even rows open at s = 2, 3, 4 / 14, 15, 16 / ...; odd rows at s = 8, 9, 10 / 20, 21, 22 / ...
    expect(gatesOf("rows", 0)).toEqual([3, 4, 5, 15, 16, 17, 27, 28, 29]);
    expect(gatesOf("rows", 1)).toEqual([9, 10, 11, 21, 22, 23, 33, 34, 35]);
    expect(gatesOf("rows", 2)).toEqual(gatesOf("rows", 0));
    expect(gatesOf("rows", 3)).toEqual(gatesOf("rows", 1));
    expect(gatesOf("rows6", 2)).toEqual(gatesOf("rows", 0));
  });

  it("change one dial each: a gate every 10 (rows10, phases 2 and 7), gates 4 wide (rows4w), three rows (rows6)", () => {
    expect(gatesOf("rows10", 0)).toEqual([3, 4, 5, 13, 14, 15, 23, 24, 25, 33, 34, 35]);
    expect(gatesOf("rows10", 1)).toEqual([8, 9, 10, 18, 19, 20, 28, 29, 30, 38]);
    expect(gatesOf("rows4w", 0)).toEqual([3, 4, 5, 6, 15, 16, 17, 18, 27, 28, 29, 30]);
    expect(gatesOf("rows4w", 1)).toEqual([9, 10, 11, 12, 21, 22, 23, 24, 33, 34, 35, 36]);
    expect(ROWS_LAYOUTS.rows6.xs).toHaveLength(3);
    expect(ROWS_LAYOUTS.rows.xs).toHaveLength(4);
    // The odd row of every layout sits half a period after the even row, so the gates stagger.
    for (const arena of ROWS) {
      const l = ROWS_LAYOUTS[arena];
      expect(l.phases[1]! - l.phases[0]!).toBe(l.period / 2);
    }
  });

  it("use a true modulo, so the lead of a row (before its first gate) has gates too", () => {
    const l = ROWS_LAYOUTS.rows;
    // An odd row (phase 8) has its gates at row positions 8..10, and at -4..-2 before them: the lead of the row, which a bare % would call negative.
    expect(rowsGateOpen(l, 1, ROWS_S_LO + 8 - 12)).toBe(true);
    expect(rowsGateOpen(l, 1, ROWS_S_LO + 10 - 12)).toBe(true);
    expect(rowsGateOpen(l, 1, ROWS_S_LO + 7 - 12)).toBe(false);
    expect(rowsGateOpen(l, 1, ROWS_S_LO + 11 - 12)).toBe(false);
  });

  it("agree with the Gallows' own gate helper when the styler exports one (zoneStyle/gallows.ts gallowsGateOpen)", async () => {
    const mod = (await import("../../shared/src/zoneStyle/gallows")) as Record<string, unknown>;
    const gateOpen = mod.gallowsGateOpen as ((s: number, phase: number, period?: number, width?: number) => boolean) | undefined;
    if (typeof gateOpen !== "function") return; // not exported (yet): the rule stays local to duel.ts
    for (const arena of ROWS) {
      const l = ROWS_LAYOUTS[arena];
      for (let row = 0; row < l.xs.length; row++) {
        for (let s = -20; s < 80; s++) {
          // gallowsGateOpen counts from the row's first tile (sLo); the arena's sLo is its first interior tile.
          expect(rowsGateOpen(l, row, s), `${arena} row ${row} s ${s}`).toBe(gateOpen(s - ROWS_S_LO, l.phases[row % 2]!, l.period, l.width));
        }
      }
    }
  });

  it("stop a walker and a swing but not an arrow or the eye", () => {
    const map = buildArena("rows", startPoints(300), 1);
    const x = ROWS_LAYOUTS.rows.xs[1]!;
    const gate = nearestGateCentre("rows");
    const a = { x: (x - 1.5) * TILE, y: (gate + 6) * TILE };
    const b = { x: (x + 2.5) * TILE, y: (gate + 6) * TILE };
    expect(map.tiles[idx(x, Math.floor(gate + 6))]).toBe(TILE_LOW);
    expect(hasLineOfSight(map, a, b, MASK_SIGHT)).toBe(true); // see-through: shots fly over
    expect(hasLineOfSight(map, a, b, TILE_LOW)).toBe(false); // but there is a fence on the line
    const path = findPath(map, a, b);
    expect(path.length).toBeGreaterThan(1); // a walker goes round, through the gate
    expect(path.some((p) => Math.abs(p.y / TILE - gate) < 2)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------------- the Rows condition

describe("the Rows condition", () => {
  it("is 96 setups: 3 distances x 4 crossings x 4 tilts x each fighter as the one further from the gate (48 in the quick run)", () => {
    const full = rowsSetups();
    expect(full).toHaveLength(96);
    expect(ROWS_ACROSS).toEqual([4, 6, 7.5]);
    expect(ROWS_LATERAL).toEqual([0, 2, 4, 6]);
    expect(new Set(full.map((s) => `${s.across}/${s.lateral}/${s.angle}/${s.furtherIs}`)).size).toBe(96);
    expect(ROWS_ANGLES).toHaveLength(4);
    expect(rowsSetups("quick")).toHaveLength(48);
    expect(ROWS_HOLD).toBe(0.5);
  });

  it("stands the fighters on opposite sides of one row, the stated distance apart, clear of the fence, in all four layouts", () => {
    for (const arena of ROWS) {
      const map = buildArena(arena, startPoints(300), 1);
      const layout = ROWS_LAYOUTS[arena];
      const rowX = layout.xs[1]! + 0.5;
      for (const setup of rowsSetups()) {
        const [fire, sent] = rowsStarts(arena, setup);
        const label = `${arena} ${JSON.stringify(setup)}`;
        expect(Math.hypot(fire.x - sent.x, fire.y - sent.y) / TILE, label).toBeCloseTo(setup.across, 9);
        expect(Math.sign(fire.x / TILE - rowX) * Math.sign(sent.x / TILE - rowX), label).toBe(-1);
        expect(circleClear(map, fire, PLAYER_RADIUS), `${label} fire`).toBe(true);
        expect(circleClear(map, sent, PLAYER_RADIUS), `${label} sentenced`).toBe(true);
        // The line crosses the row `lateral` tiles from the nearest gate's centre, and the one further from the gate has the larger y.
        const further = setup.furtherIs === "fire" ? fire : sent;
        const nearer = setup.furtherIs === "fire" ? sent : fire;
        expect(further.y).toBeGreaterThanOrEqual(nearer.y);
        const crossY = (fire.y + sent.y) / 2 / TILE;
        expect(crossY - nearestGateCentre(arena), label).toBeCloseTo(setup.lateral, 9);
      }
    }
  });

  it("puts a fence between the fighters at every setup of the design (so the open control differs by the row alone)", () => {
    const map = buildArena("rows", startPoints(300), 1);
    for (const setup of rowsSetups()) {
      const [fire, sent] = rowsStarts("rows", setup);
      // The straight line between them is clear through the gate when it crosses at the gate's centre, and meets a fence 4 or more tiles away from it.
      const fenced = !hasLineOfSight(map, fire, sent, TILE_LOW);
      if (setup.lateral === 0) expect(fenced, JSON.stringify(setup)).toBe(false);
      if (setup.lateral >= 4) expect(fenced, JSON.stringify(setup)).toBe(true);
    }
  });

  it("is deterministic, and the same setup differs between the rows and the open floor by the fence alone", () => {
    const setup = { across: 7.5, lateral: 6, angle: 0.6, furtherIs: "fire" as const };
    const starts = rowsStarts("rows", setup);
    const a = runRowsDuel("rows", setup, starts, 5);
    const b = runRowsDuel("rows", setup, starts, 5);
    expect({ ...a, result: { ...a.result, spec: undefined } }).toEqual({ ...b, result: { ...b.result, spec: undefined } });
    const open = runRowsDuel("open", setup, starts, 5);
    // Fire has to walk round: its first axe hit comes later, the static detour is positive, and the open floor has none.
    expect(a.detourStatic!).toBeGreaterThan(0.3);
    expect(open.detourStatic).toBe(0);
    expect(a.firstAxeHit!).toBeGreaterThan(open.firstAxeHit!);
    // Sentenced shoots across the row (arrows fly over a fence) and the report counts them.
    expect(a.arrowsThroughFence).toBeGreaterThan(0);
    expect(open.arrowsThroughFence).toBe(0);
  });

  it("reads the same pooled numbers the stats are built from", () => {
    const setups = rowsSetups("quick").filter((_, i) => i % 8 === 0);
    const outcomes = setups.map((s, i) => runRowsDuel("rows", s, rowsStarts("rows", s), 1 + i));
    const stats = rowsStats("rows", outcomes);
    expect(stats.n).toBe(setups.length);
    expect(stats.fireWins + stats.sentencedWins + stats.noWinner).toBe(stats.n);
    expect(stats.rate).toBeCloseTo(stats.fireWins / stats.n, 12);
    expect(stats.ci[0]).toBeLessThanOrEqual(stats.rate);
    expect(stats.ci[1]).toBeGreaterThanOrEqual(stats.rate - 1e-9);
    expect(stats.arrowsThroughFence).toBeLessThanOrEqual(stats.arrows);
    expect(stats.bowHitsThroughFence).toBeLessThanOrEqual(stats.bowHits);
  });

  it("prints a verdict, holds or fails against the line it is given, and runs the three variants and names a proposal only on a failure", () => {
    const setupList = [
      { across: 6, lateral: 4, angle: 0.3, furtherIs: "fire" as const },
      { across: 4, lateral: 2, angle: 0, furtherIs: "sentenced" as const },
    ];
    const holds = rowsReport({ setupList, hold: 0.01 });
    expect(holds.holds).toBe(true);
    expect(holds.proposal).toBeNull();
    expect(Object.keys(holds.stats).sort()).toEqual(["open", "rows"]);
    expect(holds.text.join("\n")).toContain("The Rows HOLD");
    // An impossible line forces the failure branch: all three variants run, none holds, no proposal is made, nothing is switched.
    const fails = rowsReport({ setupList, hold: 1.01 });
    expect(fails.holds).toBe(false);
    expect(Object.keys(fails.stats).sort()).toEqual(["open", "rows", "rows10", "rows4w", "rows6"]);
    expect(fails.proposal).toBeNull();
    const text = fails.text.join("\n");
    expect(text).toContain("The Rows FAIL");
    expect(text).toContain("PROPOSED MITIGATION");
    expect(text).toContain("Not switched");
    // The variants are forced on request even when the design holds.
    expect(Object.keys(rowsReport({ setupList: setupList.slice(0, 1), hold: 0.01, variants: true }).stats)).toHaveLength(5);
  });

  it("repeats the setups with other seeds on request, in the same order in every arena", () => {
    const setupList = [{ across: 6, lateral: 4, angle: 0.3, furtherIs: "fire" as const }];
    const report = rowsReport({ setupList, hold: 0.01, seedsPerSetup: 3 });
    expect(report.stats.rows!.n).toBe(3);
    expect(report.stats.open!.n).toBe(3);
    expect(report.text.join("\n")).toContain("3 seeds per setup");
    const seeds = report.stats.rows!.outcomes.map((o) => o.result.spec.seed);
    expect(new Set(seeds).size).toBe(3);
    expect(report.stats.open!.outcomes.map((o) => o.result.spec.seed)).toEqual(seeds);
  });

  it("proposes the first mitigation that holds, in the contract's order: gate spacing, gate width, row count", () => {
    expect(proposeMitigation({ rows10: 0.4, rows4w: 0.6, rows6: 0.7 })).toBe("rows4w");
    expect(proposeMitigation({ rows10: 0.5, rows4w: 0.9, rows6: 0.9 })).toBe("rows10");
    expect(proposeMitigation({ rows10: 0.1, rows4w: 0.2, rows6: 0.3 })).toBeNull();
    expect(proposeMitigation({ rows6: 0.8 })).toBe("rows6");
    expect(proposeMitigation({})).toBeNull();
  });

  it("has a Wilson interval that brackets the rate and spans everything for no data", () => {
    expect(wilson(0, 0)).toEqual([0, 1]);
    const [lo, hi] = wilson(48, 96);
    expect(lo).toBeLessThan(0.5);
    expect(hi).toBeGreaterThan(0.5);
    expect(wilson(96, 96)[1]).toBe(1);
    expect(isRowsArena("rows10")).toBe(true);
    expect(isRowsArena("open")).toBe(false);
    expect(isRowsArena("pillars")).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------- a ready map and explicit starts

/** A fire-zone arena split by a wall with one gap: the two ends of a pair on opposite sides have to walk round. */
function walledMap(): GameMap {
  const n = 40;
  const tiles = new Uint8Array(n * n);
  for (let i = 0; i < n; i++) { tiles[i] = tiles[(n - 1) * n + i] = tiles[i * n] = tiles[i * n + n - 1] = TILE_WALL; }
  for (let y = 1; y < 30; y++) tiles[y * n + 20] = TILE_WALL; // a wall from the top, a gap at y = 30..38
  const map = mapFromTiles(n, n, tiles, 77);
  map.regionGrid.fill(REGION_IDS.indexOf("fire"));
  return map;
}

describe("a duel on a ready map, at explicit starts", () => {
  it("fights on the map it is given (used as is, never copied) and starts the fighters where it is told", () => {
    const map = walledMap();
    const starts = [{ x: 18 * TILE, y: 10 * TILE }, { x: 22 * TILE, y: 10 * TILE }] as const;
    const seen: Array<[boolean, number, number]> = [];
    const r = runDuel({
      faction: "fire", factions: ["fire", "sentenced"], weapons: ["axe", "bow"], signatures: true, locks: [true, true], distance: 0,
      map, starts, capSeconds: 30, seed: 3,
      onTick: (world, tick) => { if (tick === 0) seen.push([world.map === map, world.state.players.get("f0")!.x, world.state.players.get("f1")!.x]); },
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]![0]).toBe(true);
    // One tick has run by the time onTick sees it, and the fighters have started walking at each other.
    expect(Math.abs(seen[0]![1] - 18 * TILE)).toBeLessThan(4);
    expect(Math.abs(seen[0]![2] - 22 * TILE)).toBeLessThan(4);
    // With the wall between them Fire walks round it: it takes longer than the same two a wall's width apart on the open floor.
    const open = runDuel({ faction: "fire", factions: ["fire", "sentenced"], weapons: ["axe", "bow"], signatures: true, locks: [true, true], distance: 4 * TILE, capSeconds: 30, seed: 3 });
    expect(r.seconds).toBeGreaterThan(open.seconds);
  });

  it("refuses a start that is not clear floor", () => {
    const map = walledMap();
    expect(() => runDuel({
      faction: "fire", weapons: ["axe", "bow"], distance: 0, map, capSeconds: 2, seed: 1,
      starts: [{ x: 20.5 * TILE, y: 10 * TILE }, { x: 22 * TILE, y: 10 * TILE }],
    })).toThrow(/not both clear floor/);
  });

  it("draws pairs 4 to 7.5 tiles apart in the zone, on floor with room for a body, in one walkable piece, the same every time", () => {
    const map = walledMap();
    const pairs = zonePairs(map, "fire", 60);
    expect(pairs).toHaveLength(60);
    expect(zonePairs(map, "fire", 60)).toEqual(pairs);
    expect(zonePairs(map, "frost", 12)).toHaveLength(0); // no tile of the map belongs to Frost
    for (const p of pairs) {
      expect(p.tiles).toBeGreaterThanOrEqual(PAIR_MIN_TILES);
      expect(p.tiles).toBeLessThanOrEqual(PAIR_MAX_TILES);
      expect(Math.hypot(p.a.x - p.b.x, p.a.y - p.b.y) / TILE).toBeCloseTo(p.tiles, 9);
      expect(circleClear(map, p.a, PLAYER_RADIUS)).toBe(true);
      expect(circleClear(map, p.b, PLAYER_RADIUS)).toBe(true);
    }
    // The wall has a fixed place: some pairs lie across it (obstructed), some do not, and the kinds split them.
    expect(pairs.some((p) => p.obstructed)).toBe(true);
    for (const p of zonePairs(map, "fire", 6, 0, "obstructed")) expect(p.obstructed).toBe(true);
    for (const p of zonePairs(map, "fire", 6, 0, "clear")) expect(p.obstructed).toBe(false);
  });

  it("runs every designed edge on both fighters' signature weapons for every pair, in the zone and on the open floor", () => {
    const map = walledMap();
    const edges = BEATS.slice(0, 3);
    const records = runMapDuels({ seeds: [5], pairsPerZone: 2, zones: ["fire"], edges, capSeconds: 40, pairKind: "obstructed", mapOf: () => map });
    expect(records).toHaveLength(2 * edges.length);
    for (const r of records) {
      const w = r.edge[0] as FactionId, l = r.edge[1] as FactionId;
      expect(r.inZone.spec.weapons).toEqual([SIGNATURE_WEAPONS[w], SIGNATURE_WEAPONS[l]]);
      expect(r.inZone.spec.signatures).toBe(true);
      expect(r.inZone.spec.locks).toEqual([true, true]);
      expect(r.inZone.spec.map).toBe(map);
      expect(r.open.spec.map).toBeUndefined();
      expect(r.obstructed).toBe(true);
      expect(Math.hypot(r.inZone.spec.starts![0].x - r.inZone.spec.starts![1].x, r.inZone.spec.starts![0].y - r.inZone.spec.starts![1].y) / TILE).toBeCloseTo(r.tiles, 6);
    }
    // The wall is in the way of every obstructed pair, so the zone is not the open floor for at least one of these duels.
    expect(records.some((r) => r.inZone.seconds !== r.open.seconds || r.inZone.hp[0] !== r.open.hp[0])).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------------- the CLI

describe("the zone duel CLI", () => {
  it("parses its options and refuses a bad one", () => {
    const cli = parseZoneArgs(["--source", "both", "--variants", "--seeds", "3-5", "--pairs", "4", "--zone", "fire,holy", "--edge", "fire>sentenced,holy>fire", "--cap", "60", "--pair-kind", "obstructed", "--shooter", "orbwalk", "--rows-setups", "quick", "--rows-seeds", "3", "--quiet"]);
    expect(cli).toMatchObject({ source: "both", variants: true, seeds: [3, 4, 5], pairs: 4, zones: ["fire", "holy"], cap: 60, pairKind: "obstructed", shooter: "orbwalk", rowsSetups: "quick", rowsSeeds: 3, quiet: true });
    expect(cli.edges).toEqual([["fire", "sentenced"], ["holy", "fire"]]);
    expect(parseZoneArgs(["--seeds", "2"]).seeds).toEqual([1, 2]);
    expect(parseZoneArgs(["--seeds", "7,9"]).seeds).toEqual([7, 9]);
    expect(parseZoneArgs([]).source).toBe("rows");
    expect(parseZoneArgs(["--shooter", "lock"]).shooter).toBeUndefined();
    for (const bad of [["--source", "elsewhere"], ["--seeds", "0"], ["--zone", "nowhere"], ["--edge", "sentenced>fire"], ["--cap", "-1"], ["--wat"], ["--pairs"], ["--rows-seeds", "0"]]) {
      expect(() => parseZoneArgs(bad), bad.join(" ")).toThrow();
    }
    expect(runZoneCli(["--help"])).toContain("harness:zones");
  });

  it("prints the real-zone report on a generated map", () => {
    const text = runZoneCli(["--source", "map", "--seeds", "1", "--pairs", "1", "--zone", "fire", "--edge", "fire>sentenced", "--cap", "20", "--quiet"]);
    expect(text).toContain("REAL ZONES");
    expect(text).toContain("EVERY PAIR");
    expect(text).toContain("OBSTRUCTED PAIRS ONLY");
    expect(text).toContain("fire > sentenced");
  }, 60_000);
});
