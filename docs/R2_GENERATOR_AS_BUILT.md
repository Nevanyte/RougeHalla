# R2 zone generator: as built

R2 (generator track) built the R1 design (`docs/R1_GENERATOR_NOTE.md`) for real, on branch `claude/r2-zones`:

| commit | what |
|---|---|
| 931a20e | step 1: `mapgen.ts` split into `zones.ts`, `cover.ts` and `mapgen.ts`, byte-identical (legacy hash test green); `generateMap(seed, attempt?)`, `tryAttempt` |
| 9a8d88f | step 2: the zone generator at 96x96, extraction removed, the independent certifier and the 200-seed sharded certification |
| d5e83bb | step 3: speed work (same maps), the ruin-pocket fix, the 1000-seed sweep script |
| e53febb | merge of the zone-terrain foundation (cffb414): R2 moved onto its masks, terrain layer and the single-pass style hook |
| 9f94318 | merge of R0/R3/R4a (eafcc87) |
| fa7cf35, 30b8df5 | ZT-6: the zone stylers wired into the generator's hook, the themes on (section 6) |

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
- `styler.ts`: the zone style hook types (`ZoneStyleHook`, `StyleState`, `StyleCamp`), `ZONE_STYLE_HOOK` (the zone stylers'
  adapter while `MAP_STYLERS` is on, null when it is off), `STYLE_STREAM` (0 shape, 1 decor, 2 surface) and
  `styleRng(seed, attempt, zone, stream)` = `mulberry32(hashSeed(...))` (shared/rng.ts). `zoneStyle/hook.ts` is the adapter.
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
- `options.styleZones: null` builds the plain map with no stylers (the `styler=none` of the scripts and the plain pins).
- Constants: `SIGHT_LATTICE`, `LATTICE_ORIGIN`, `CAMPS_PER_ZONE` 4, `CAMP_GAP` 9, `TERRITORY_RADIUS_MAX` 30,
  `RING_CONTACT_MIN` 24, `SLIVER_MAX` 100.
- Bench hooks: `MAPGEN_FAILS` (failures by reason), `MAPGEN_NOTES` (ice cleared and frozen, rezoned pieces), `MAPGEN_PROFILE`
  (per-stage time, off by default), `STYLER_STATS` (the styler passes' ms, blocked and refused tiles).

`GameMap` (map.ts) as it stands: `tiles` (FLOOR / WALL / LOW), `terrain`, `props`, `regionGrid` (every tile off the border
is a zone or the coliseum; no ridges), `attempt`, `territoryGrid` (1 + camp index; a zone's territories partition all its
painted tiles), `camps` (4 per zone, REGION_FACTIONS order), `spawnPool` (24-32, zone-tagged), `regions` (pole, painted
`area`, and the views `spawns` and `mobCamps`), `spawns` (the pool interleaved by zone), `crateSpots`, `groundSpots`,
`buildings`, `coliseum`. `extracts`, `ExtractZoneDef`, `EXTRACT_RADIUS` and `regions[].anchor` are gone (nothing outside
shared read `anchor`).

Scripts: `printMap.ts <seed> [attempt]` (zones, territory edges, camps, chests, crates, the pool, low ground);
`mapBench.ts [n] [from=] [styler=] [yard=]` (cost per raw seed, attempts, failures, notes, stage times, a load yardstick);
`mapSweep.ts <n> [from=] [styler=default|none|zone|demo]` (the independent certifier on every seed, plus exact strips, discs,
the findPath walking ratio, hazard exposure and the themes' presence); `pinMaps.ts` (re-pins `test/mapPins.ts`: themed and
plain); `printZone.ts <seed> [zone]` (a zone as ASCII).

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
   - the generator checks the tiles and terrain written against the contract and fails the attempt on a breach
     (`A:styleBreach`; it threw before ZT-6, which would have crashed a room);
   - spawn-pool members (5x5), crates (3x3) and ground spots need tiles with no terrain;
   - a floor kind under any wall is cleared, while a LOW kind under a rock stays (as decor);
   - props whose tile changed class are dropped;
   - `validateTerrain(map, { styled: true })` gates a styled attempt.
   R2 shipped no hook; ZT-6 wired it (section 6). With `styleZones: null` a map has no LOW tiles, no terrain and no props.
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
| spawn pool | 24-32 members, 4+ zones, 0.5-0.95 R0, 7 tiles from camps when picked (guarantee 5), separation 5; picked BEFORE the stylers at ±4.5% (up to 40), trimmed to 32 after the cover, certified at ±8% | mapgen.ts |
| crates | 3-4 per zone against a wall | mapgen.ts |
| cover | pre-lattices 8:2 and 16:1, coarse 32:0.5, fine 48:0.25 (certifying), target 14.98 tiles | cover.ts |
| floor share | max/min <= 1.15 | mapgen.ts |
| attempts | 16 for a pool; stream `seed + attempt * 0x9e3779b1` | mapgen.ts |

## 4. Measured (the plain generator, before ZT-6; section 6 has the themed numbers)

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

The walk ratio maxima are those of the seeds swept (0..2199). A later review found 1.202 on seed 5920, just over the
owner's 1.2 target (report-only; it is not a certification check), so 1.198 is not a bound over all seeds.

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
maps (the wedge maps gave 95.8% at 8 players). There are no same-zone pairs and no shared spawns. With the walks cached, a
deal at 8 players takes 0.3 ms at p50, 2.5 ms at p90 and about 7 ms at p99 (mean 0.85 ms). `spawnWalks` costs about 4 ms
per map (30 paths; 16 ms for the first call in a process), so the map worker computes it after certifying and ships it with
the map (`primeSpawnWalks`), and the room build computes it for a map certified on the main thread: the planning-start tick
at 8 players (200 maps) went from a mean of 6.1 ms (p50 4.9) to a mean of 0.8 ms (p50 0.4, p99 5.4). The whole pool fits in
one findPath tier on 147 of 200 maps.

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
- `styleRng` is `hashSeed`'s stream since ZT-6 (every styled map moved then).
- Rock density is about 2040 wall tiles per map in the zones with the stylers on (1880 without): the stylers' walls did
  not bring it down.
- Lane tables: 44 MB per process (4 tables, Float64 edges).

## 6. ZT-6: the zone stylers at the hook, the themes on

ZT-6 (zone terrain's integration, `fa7cf35` and `30b8df5`) called `styleZones` from the hook, turned `MAP_STYLERS` on, deleted the
dev adapter (`zoneStyle/finishedMap.ts`, `gameMapBuild.ts`, the wedge suites) and re-pinned the maps. Every map the pool, the bots and
the clients build is themed: Scorch lava, embers and obsidian; Gallows fences and cell blocks; Warren bog and tunnels; Rime ice shelves
and crevasses; Sanctum colonnades and light shafts. All five themes are on every one of 1000 swept maps (a test asks 90% of 200).

**The adapter** (`zoneStyle/hook.ts`). R2's `StyleState` and zone terrain's `ZoneStyleState` differ in four small ways, and the adapter
maps them: `territoryGrid` (always there) is the stylers' `territory` (null on a synthetic fixture); `decor` is a state field here and an
option of `styleZones`; the hook returns nothing where `styleZones` returns a `StyleResult[]` (kept as telemetry in `STYLER_STATS`); and
`camps[].r` is in tiles on both sides (`CAMP_R`), so it passes unchanged. The generator's `protect` is the stylers' `hard`; it adds no
`noBlock`/`noProp`. The stylers' own state type is renamed `ZoneStyleState`, so the shared barrel has one `StyleState` (the generator's).
`styleRng` is `mulberry32(hashSeed(seed, attempt, zone, stream))`: the one stream function.

**What changed in the generator, and why** (each one measured on `mapBench`, attempts per seed and failures by reason):
1. *The spawn pool is picked before the stylers.* After them, their walls and hazards left 1090 candidates against 2425 on the plain
   map, the pool came out at 19-23 against a minimum of 24 on a third of the attempts (2.4 attempts a seed against 1.1); the cover
   then shifts a spawn's walking distance by 3% to 100%, so even a full pool lost members. Now the pool is picked on the open ground (up to 40 members within 4.5% of
   a contour), its 3x3s are `protect`ed from the stylers, hazards are cleared from its 5x5s afterwards (T8) and, after the cover and the
   territory repair, the longest run within 8% is kept and trimmed to 32 from its extremes. (Picking it after the coarse cover failed
   96% of seeds: the cover leaves too few plain 3x3s.) The contract wanted the hook first, to measure the contour on styled ground;
   the post-cover check is the same certificate, so nothing weaker is certified.
2. *A styler breach fails the attempt* (`A:styleBreach`, never seen on a swept seed) instead of throwing.
3. *ICE.* Contract 0.11's first choice, keeping rocks off the ICE's neighbourhood, makes 70% of attempts fail (the cover cannot cut a
   lane through a lake: `A:coverPre`). Keeping them off as a last resort (`soft` ground) worked but, because the cover's last-resort
   level skips the territory guard, split the Rime's territories and cost 1.34 attempts per seed (a variant that kept the guard:
   1.22). So the cover ignores ICE; a rock clears the ICE on its 8 neighbours (`clearIceBesideSolid`, the second choice), and the
   Rime then freezes every clear tile it has left (`freezeClearGround`). The result is about 41 ICE tiles a map (13 that survive and 28
   frozen), 3% of the Rime's floor, where the recipe laid about 280: the 480 u cap puts a rock in nearly every 3x3 of the Rime. See
   CLAUDE.md Known TODOs for the levers.
4. *The territory repair walls up small cut-off pieces* (at most `WALL_UP_MAX` 120 tiles, holding no crate, pool member, camp ground
   or ruin, and not a bridge: the floor stays one piece) instead of giving them to another zone; a piece of at most 40 tiles that
   cannot be walled still changes zone, its hazards cleared (T6), and fails the attempt if it holds low ground (`A:rezoneLow`). The
   area balance no longer aborts when a trade gets stuck (the 8-tile spread check judges the result), and trades make partial
   progress. These took `A:areaPost` from 19% of the themed attempts that reached the repair (21 of 109) to 2.2% of all of them (24 of 1104), and from about 5% to 2.1% on the plain generator.
5. *Zone floor.* The cover treats a rock that would split its zone's floor locally (`guardLevel` in `cover.ts`) as a last resort, level 3 like
   a rock on a spawn's soft ground (`ZONE_GUARD_LEVEL`); as a level-2 preference zone floors split in about one attempt in ten, and with
   them territories, the pool and the area: attempts per seed fell from 1.10 to 1.04 (and the plain generator's from 1.056 to 1.018) when
   it became a last resort, and `A:zoneFloorSplit` from 13 per 1000 seeds to none seen. The generator checks that each zone's floor is one
   4-connected piece anyway (`A:zoneFloorSplit`) and the certifier checks it too.
6. *The walking contour is judged after the repair*, which can wall up floor: a pool that had passed the 8% check before the repair
   failed the independent certifier's at 1.23 once a wall moved a walk.
7. Decor stays off spawns, crates and ground spots; a `validateTerrain` failure fails the attempt (`A:terrain`, about 1 in 1000).

**Tests.** `mapStyler.test.ts` (the demo hook, with its ice back: a 6x6 sheet on plain floor), `zoneStyleGen.test.ts` (each theme's
terrain on 90% of 200 seeds, every kind in its home zone, `validateTerrain` clean on 200 maps, the styler's net never used, the adapter
equal to a direct `styleZones` call, zone isolation: a no-op styler in one zone leaves the others byte-identical), the hook tests in
`mapgen.test.ts` (a breach fails the attempt; no LOW tile ends as floor; the pool's 3x3s are plain and its 5x5s hazard-free; the
`decor: false` guard over 60 seeds of the game's own hook; `styleRng` is `hashSeed`'s), the pins (`PINNED_MAPS` themed, recorded in
another process; `PINNED_PLAIN` for `styleZones: null`), and the certifier's `styler=zone` mode.

**Measured** (Node 25.8, Apple M5 Pro, shared machine at load 8-9; the plain generator was run in the same windows):

| 1000 seeds (0..999) | mean | p50 | p90 | p99 | max | attempts per seed | certified at attempt 0/1/2 | discarded |
|---|---|---|---|---|---|---|---|---|
| themed | 39.0 ms | 36.5 | 43.5 | 79.3 | 175.6 | 1.041 | 960 / 39 / 1 | 0 |
| themed, with the plain yardstick interleaved | 37.8 ms | 35.0 | 44.0 | 79.5 | 121.6 | 1.041 | 960 / 39 / 1 | 0 |
| plain (`styler=none`) | 30.4 ms | 28.7 | 35.7 | 56.3 | 81.5 | 1.018 | 982 / 18 / 0 | 0 |

The interleaved plain generator read 31.5 ms mean and 67.2 p99 over 300 maps in the second row's windows: the themed generator costs
about 1.2 to 1.4 times the plain one. Extra attempts over the plain generator: +2.3% (the contract asked for 2%). The targets (mean 40 ms,
p99 120 on a quiet machine) are met at load 8-13; scaled by the R2 doc's 0.75 for a quiet machine the means are about 28-30 ms. The
styler stage costs 5.6-5.9 ms per attempt (the gate is 8). Time per attempt by stage, in ms: zones 5.81, ruins 0.31, spawn pool 1.15,
styler 5.88, crates 0.67, pre-lattices 3.51, coarse 5.76, fine 10.66, post 1.20, records 1.16. The cost gate (`mapgen.perf.test.ts`)
is 60 ms scaled with the stylers and 45 without. Failures per 1041 attempts (themed; plain per 1018): pool after the cover 8 (0),
territory radius 9 (0), area 9 (5), stray piece 4 (2), crate in a rezoned piece 7 (7), fine cover 4 (2), zone floor split 0 (2).

**Certification** (the independent certifier in `styler=zone` mode: every plain check plus `validateTerrain` T1-T11, each zone's
floor 4-connected, every kind in its home zone, ICE with plain floor on all eight sides, no kind on a spawn 3x3, no hazard on a
spawn 5x5 or a ground spot's 3x3, no kind on a crate 3x3 or a camp clearing + halo):

| sweep | seeds | failures | discarded | lane max | exact strip max | disc max | floor share max | walk ratio BFS 5/7 | findPath walk ratio mean / p90 / max |
|---|---|---|---|---|---|---|---|---|---|
| default (themed) | 0..499 | 0 | 0 | 479.4 u | 465.0 u | 447.7 u | 1.109 | 1.174 | 1.169 / 1.191 / 1.200 |
| default (themed) | 500..999 | 0 | 0 | 479.4 u | 464.4 u | 447.7 u | 1.102 | 1.174 | 1.168 / 1.191 / 1.201 |
| default (themed), a fresh range | 40000..40199 | 0 | 0 | 479.4 u | 461.7 u | 441.8 u | 1.122 | 1.174 | 1.167 / 1.180 / 1.190 |

The 480 u cap is certified with the stylers' walls counted (a wall cuts a lane, LOW does not: sight reads `MASK_SIGHT`). The sealed
coliseum lane is 418 u, ring contact at least 29, slivers at most 100, territory radius at most 30.0 tiles, the pool 24-32. The
independent certifier found no failure and no discard (1200 seeds; attempts 1155 / 44 / 1 at 0 / 1 / 2). Themes present (lava, fence,
bog, ice, light): on every map of all three sweeps. Mean tiles of each kind per map: lava 62, ember 68, fence 50, bog 97, ice 42
(crevasse 20), light 18; rock tiles 2007. Hazard exposure (report only, contract 0.8): 35% of pool members cross at least one terrain
tile on their walk to the centre; mean 1.3 over all members, p90 5, max 20. The findPath walk ratio reaches 1.201 on one seed (the
owner's report-only target is 1.2).

**Determinism.** The pins were recorded by `scripts/pinMaps.ts` in its own process and are compared in the shards and in a fresh-module
rebuild (50 seeds); the Math spy runs through a generation with the stylers on. In headless Chrome 155, five seeds (5:1, 123:0,
777:1, 40010:0 and 2^32 + 5:1) built with decor on in the page hash exactly as Node's `decor: false` build does, and a room served by
the server's pool worker reported a `mapHash` equal to Node's rebuild of its (seed, attempt). The client bakes a themed map in 59 ms
(36 floor chunks, 576 strips, 3 pages, 45.2 MB of the 48 MB budget, 612 images) and draws at 144 fps (p99 frame 8.7 ms) walking from
the Scorch into the Gallows in the browser pane.
