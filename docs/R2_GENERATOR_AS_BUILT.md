# R2 zone generator: as built

R2 (generator track) built the R1 design (`docs/R1_GENERATOR_NOTE.md`) for real, on branch `claude/r2-zones`:

| commit | what |
|---|---|
| 931a20e | step 1: `mapgen.ts` split into `zones.ts`, `cover.ts` and `mapgen.ts`, byte-identical (legacy hash test green); `generateMap(seed, attempt?)`, `tryAttempt` |
| 9a8d88f | step 2: the zone generator at 96x96, extraction removed, the independent certifier and the 200-seed sharded certification |
| d5e83bb | step 3: speed work (same maps), the ruin-pocket fix, the 1000-seed sweep script |
| e53febb | merge of the zone-terrain foundation (cffb414): R2 moved onto its masks, terrain layer and the single-pass style hook |
| 9f94318 | merge of R0/R3/R4a (eafcc87) |

This note says what differs from the R1 note and why, the parameters finally used, and the measured numbers. The R1 note
stays the design reference for everything not listed here.

## 1. Modules and API

`packages/shared/src`:
- `coliseum.ts`: the fixed layout every map shares, built once per process: border, coliseum footprint, wall ring,
  gates, gate lanes, inner spawns, the 8 pillar variants shifted by `CX - 32`, the ring road, the painted set.
- `zones.ts`: the zone partition (`partitionZones`), the camps and their territories (`placeCamps`), the territory floor
  repair after the cover (`repairTerritories`), the chamfer and heap tools, `MAPGEN_FAILS`.
- `cover.ts`: lane tables anchored at `LATTICE_ORIGIN` (the coliseum centre less (32, 32)), `placeCover` with the
  territory guard, `walkDistances`, `enforceConnectivity`, `longestLane`. Sight reads `MASK_SIGHT`, connectivity
  `MASK_MOVE` (map.ts).
- `styler.ts`: the zone style hook types (`ZoneStyleHook`, `StyleState`, `StyleCamp`), `ZONE_STYLE_HOOK` (null in R2),
  `STYLE_STREAM` (0 shape, 1 decor, 2 surface) and `styleRng(seed, attempt, zone, stream)`, a placeholder whose seed
  becomes zone terrain's `hashSeed` in one line.
- `mapgen.ts`: the attempt pipeline and the public API.

Public API (re-exported by `@raid/shared`):
- `generateMap(seed, attempt?, options?)`: with `attempt`, exactly that attempt, throwing when it does not certify;
  without, attempts 0, 1, 2, ... until one certifies (a guard throws after 64). `options.styleZones` replaces the hook
  (tests only); `options.decor: false` skips the cosmetic props.
- `tryAttempt(seed, attempt, options?)`: one attempt, the map or null. `certifiedMap(seed, options?)`: the first of
  attempts 0..15 that certifies, or null (a pool discards the seed). `MAX_ATTEMPTS` = 16.
- `warmMapgen()`: builds the fixed layout and the four lane tables (about 40 ms, 44 MB).
- `mapHash(map)`: 32-bit FNV-1a, 8 hex digits, over the gameplay layers: seed, attempt, size, tiles, terrain, regionGrid,
  territoryGrid, camps, spawn pool, regions (pole, area, spawns, crates), ruins, spawns, crates and ground spots. Props are
  left out (cosmetic): `generateMap(seed, attempt, { decor: false })`, the server's and the bots' build, hashes the same.
- Constants: `SIGHT_LATTICE`, `LATTICE_ORIGIN`, `CAMPS_PER_ZONE` 4, `CAMP_GAP` 9, `TERRITORY_RADIUS_MAX` 30,
  `RING_CONTACT_MIN` 24, `SLIVER_MAX` 100.
- Bench hooks: `MAPGEN_FAILS` (failures by reason), `MAPGEN_PROFILE` (per-stage time, off by default).

`GameMap` (map.ts) as it stands: `tiles` (FLOOR / WALL / LOW), `terrain`, `props`, `regionGrid` (every tile off the border
is a zone or the coliseum; no ridges), `attempt`, `territoryGrid` (1 + camp index; a zone's territories partition all its
painted tiles), `camps` (4 per zone, REGION_FACTIONS order), `spawnPool` (24-32, zone-tagged), `regions` (pole, painted
`area`, and the views `spawns` and `mobCamps`), `spawns` (the pool interleaved by zone), `crateSpots`, `groundSpots`,
`buildings`, `coliseum`. `extracts`, `ExtractZoneDef`, `EXTRACT_RADIUS` and `regions[].anchor` are gone (nothing outside
shared read `anchor`).

Scripts: `printMap.ts <seed> [attempt]` (zones, territory edges, camps, chests, crates, the pool, low ground);
`mapBench.ts [n] [from=] [yard=]` (cost per raw seed, attempts, failures, stage times, a load yardstick);
`mapSweep.ts <n> [from=] [styler=demo]` (the independent certifier on every seed, plus exact strips, discs, the findPath
walking ratio and hazard exposure); `pinMaps.ts` (re-pins `test/mapPins.ts`).

## 2. What differs from the R1 note, and why

1. **Territory radius gate: 30 tiles, met by where the camp stands.** R1 measured territories per camp: p50 17.5, p90
   25 tiles. The gate applies to the worst of a map's 20 territories, whose median was 32 and p90 45 tiles, so as a plain
   filter 30 would have rejected about 65% of camp layouts. The worst cases were not thin arms: they were territories
   fat at one end, whose pole sat at that end, far from the other. So the camp still stands at its territory's pole, but
   the pole is searched only among cells within 30 tiles of every tile of the territory (a test against the territory's
   convex hull). Three supporting changes:
   - camp seeds are placed for coverage (k-center): the first by best-candidate sampling, each next at the open site nearest
     the zone tile farthest from the seeds so far;
   - the Lloyd step is repeated (up to 4 partitions) until every pole is in reach;
   - a zone set whose camps cannot be seated (a long arm too thin for a camp halo) is drawn again inside the attempt
     (`LAYOUT_TRIES` 4, `CAMP_TRIES` 2), so it costs a 3-6 ms redraw, not an attempt.
   The 30 comes from R1's data: it sits above the per-territory p90 (25), so it trims only the tail. Result on 1000 maps:
   p50 17.2, p90 22.8, p99 29.4, max 30.0 tiles; first-attempt share 90.9% (R1: 92.3%).
2. **A prototype bug, fixed.** R1's `markRect(grid, tp(t), m)` passed a point with no `w`/`h`, so it marked nothing.
   Ruins could stand on camp clearings + 2, crates got no soft margin, and ground spots were not kept off crates'
   neighbours. The typechecker caught it.
3. **Ruin pockets, fixed (inherited from the wedge cover code).** When a rock sealed a small dead end, `place()` walled
   up the pocket with it, past the ruin's rock quota and its row/column rule: one styled map left a ruin interior 60%
   walkable. A pocket that holds ruin tiles is no longer walled up. 10 of the 200 pinned maps changed.
4. **Rezoning guard.** The territory repair may move a cut-off piece of up to 40 tiles to another zone. An attempt now
   fails if such a piece takes a crate with it, reaches into a ruin's margin, or leaves the pool short of 4 zones (seed 115
   moved a crate into another zone; about 0.4% of attempts).
5. **Zone pole.** It is the zone's floor tile outside ruins with the largest chamfer distance (R1 allowed any painted
   tile, which could be a rock). It is the zone's label point.
6. **The style hook follows the zone-terrain contract.** One pass with the whole zone grid (`StyleState`: w, h, seed,
   attempt, tiles, terrain, props, zone, zoneFaction, protect, territoryGrid, camps `{site, r, territory}`, keepLow),
   replacing R1's per-zone callback. Rules:
   - the generator checks the tiles and terrain written against the contract and throws on a breach;
   - spawn-pool members (5x5), crates (3x3) and ground spots need tiles with no terrain;
   - a floor kind under any wall is cleared, while a LOW kind under a rock stays (as decor);
   - props whose tile changed class are dropped;
   - `validateTerrain(map, { styled: true })` gates a styled attempt.
   R2 ships no hook; the default maps have no LOW tiles, no terrain and no props.
7. **Masks.** After the merge of cffb414, `cover.ts`, the territory repair and the certifier read `MASK_SIGHT` for
   lanes, cones and the spawn screen, and `MASK_MOVE` for connectivity, sealing, the ring road, the guard and walking
   distances. Probes restore the byte they saved (contract 0.2 b), so a probed LOW tile never comes back as floor.
8. **Speed, with maps unchanged** (pins identical after each change):
   - the corridor scan only moves a start index per entry and walks a stretch only once it reaches 11 tiles;
   - `wall()` skips the lane geometry of strips with no long corridor;
   - `firstAfter` starts from an interpolated guess;
   - the camp stage tests "halo inside the region" with an exact chamfer (the halo is exactly the chamfer-19 ball), and
     computes spacing and territory hulls once per partition.
   - Hot imports are copied to module constants, because vitest's module runner made each use of an import a property
     read (30% slower under test).
   Together: about 30% less time per map than step 2.
9. **No relaxed attempt anywhere**; `generateMap(seed)` without an attempt runs past 16 for a seed a pool would discard.

Kept as in R1: the noise, the arcs and spines, the quotas and balance, the sliver measure, the Voronoi territories with
their guard, the spawn contour (picked at ±4.5%, certified at ±8% on BFS 5/7 after the cover), crates, rock chunks
scaled by area, the four lattices, the anchor, `strayMax` 40.

## 3. Parameters

| name | value | where |
|---|---|---|
| map | 96 x 96 tiles; centre (48, 48); R0 48 | constants, coliseum.ts |
| zones | 5; painted area 1710-1711 each; spread <= 8 | zones.ts |
| growth cost | 12 + noise * 36 / 256; noise cells 24 and 9 | zones.ts |
| ring arcs | at least 36 tiles, 6 trimmed per end; contact F >= 24 | zones.ts |
| zone seeds | annulus 0.55-0.9 R0, 10 candidates | zones.ts |
| slivers | S <= 100 per zone (core = chamfer >= 15) | zones.ts |
| zone tries | 8 per zone set; 4 zone sets per attempt | zones.ts, mapgen.ts |
| camps | 4 per zone, one elite (farthest from the centre); gap 9 map-wide; 2 tries per zone set; up to 4 partitions | zones.ts |
| territory radius | <= 30 tiles to any territory floor tile | zones.ts, mapgen.ts |
| clearing | radius 2.5; halo = clearing + 1; 3-5 spots; chest at the centre; elite at spot 0 | zones.ts, mapgen.ts |
| ruins | 0-2 per zone, 7-9 a side, margin 2 in one zone, 2 from clearings, gap 2 | mapgen.ts |
| rock chunks | 34-69 (64x64 density scaled by area) | mapgen.ts |
| spawn pool | 24-32 members, 4+ zones, 0.5-0.95 R0, 7 tiles from camps when picked (guarantee 5), separation 5; picked at ±4.5%, certified at ±8% | mapgen.ts |
| crates | 3-4 per zone against a wall | mapgen.ts |
| cover | pre-lattices 8:2 and 16:1, coarse 32:0.5, fine 48:0.25 (certifying), target 14.98 tiles | cover.ts |
| floor share | max/min <= 1.15 | mapgen.ts |
| attempts | 16 for a pool; stream `seed + attempt * 0x9e3779b1` | mapgen.ts |

## 4. Measured

Node 25.8 on an Apple M5 Pro (6 Super + 12 Performance cores), shared with other agents (load average 9-19). Each
number comes with the 64x64 wedge generator run in the same windows as a yardstick (R1's quiet-machine yardstick: 18.4 ms).

**1000 seeds (0..999), raw seed through every attempt, tables warm** (code at d5e83bb; the merged code costs the same,
A/B ratio 0.93-1.01):

| mean | p50 | p90 | p99 | max | attempts per seed | certified at attempt 0/1/2 | discarded | yardstick mean |
|---|---|---|---|---|---|---|---|---|
| 32.8 ms | 28.7 | 44.3 | 70.4 | 99.9 | 1.097 | 909 / 85 / 6 | 0 (0%) | 24.5 ms |

Scaled to the quiet yardstick: a mean of about 25 ms and a p99 of about 53 ms, against hard targets of 40 and 120.

Time per attempt by stage, in ms:

| stage | zones and camps | terrain | spawn pool | crates | pre-lattices | coarse | fine | post | records |
|---|---|---|---|---|---|---|---|---|---|
| ms | 5.85 | 0.35 | 1.01 | 0.43 | 3.90 | 5.93 | 10.37 | 1.14 | 0.73 |

The cover is 20.2 of about 30 ms.

Failures per 1097 attempts:
- whole attempts: area after repair 66, stray territory piece 17, rezone took a crate 4, territory radius after the cover 4,
  fine cover 3, sliver after repair 2, spawn walk after the cover 1;
- stage retries: zone sliver 180, camp reach 312 (156 zone sets redrawn).

**Certification sweeps** (independent certifier, every check on every seed; exact strips on every 5th seed, discs on
every 10th):

| sweep | seeds | failures | discarded | exact strip max | lattice lane max | findPath walk ratio mean / p90 / max |
|---|---|---|---|---|---|---|
| plain | 0..999 | 0 | 0 | 464.4 u | 479.4 u | 1.168 / 1.186 / 1.198 |
| plain | 1000..1999 | 0 | 0 | 464.4 u | 479.4 u | 1.167 / 1.187 / 1.197 |
| demo hook | 2000..2199 | 0 | 0 | 454.6 u | 479.4 u | 1.161 / 1.178 / 1.184 |

Also from the plain sweeps:
- sealed coliseum lane 418 u;
- floor share max 1.064;
- ring contact min 30;
- sliver max 100;
- pool mean 29.8 (min 24, max 32);
- BFS 5/7 walk ratio max 1.174;
- longest outdoor wall run 12.

With the demo hook, 3.2% of pool members' routes to the centre cross any hazard tile (max 5 tiles); this is
report-only, per the zone-terrain contract 0.8.

**R3 deal** on 200 R2 maps (server `dealSpawns`): for 2 to 8 players, every dealt spawn is in one walking tier on 100% of
maps (the wedge maps gave 95.8% at 8 players). There are no same-zone pairs and no shared spawns, and a deal takes under
0.9 ms. `spawnWalks` costs 3.5 ms per map (30 paths). The whole pool fits in one findPath tier on 147 of 200 maps.

**Tests** (`packages/shared`, 1023 tests, about 13 s wall):
- the 200-seed certification in 8 shards, about 5 s, with pinned hashes (`test/mapPins.ts`, recorded in another
  process);
- determinism across fresh module loads (50 seeds) and the Math spy (23 functions);
- the API tests;
- the demo hook on 24 seeds;
- the cost gate (`mapgen.perf.test.ts`): the median of 7 batches of 8 seeds, each map timed between two short
  yardsticks and scaled to the quiet reference machine, must be <= 45 ms. It measures 31-39 ms in the full parallel suite
  at load average up to 29 (raw batches up to 191 ms).

## 5. Open points

- The client side was not re-measured: R1's cold Chrome attempt (85 ms, 67 ms with a warm-up attempt) predates the
  30% speed-up. The pool, the worker and the `mapHash` mismatch path belong to the pool and client tracks.
- `styleRng` is a placeholder for zone terrain's `hashSeed(seed, attempt, zoneIndex, stream)` (shared/rng.ts); the swap
  is one line and changes every styled map.
- Rock density is about 1880 wall tiles per map in the zones, with ruins and chunks included; zone-terrain's tall
  walls are the lever to bring it down.
- Lane tables: 44 MB per process (4 tables, Float64 edges).
