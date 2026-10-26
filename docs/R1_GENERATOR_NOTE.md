# R1 generator spike: paint-bucket zone maps at 96x96

**Verdict: GO for R2 with the paint-bucket design, with two caveats.**
1. On the client, the first attempt in a fresh page meets the 60 ms mean only if the worker runs one throwaway warm-up attempt at boot, and even then it measured 67 ms on a loaded machine.
2. The Node mean of 40 ms holds on the 1000-seed sweep (36.9 ms) but sat at 42 to 46 ms in two of three 200-seed windows on the loaded machine.

Plan B is not needed. It is still sketched in section 9.

Every hard guarantee holds on 1000 of 1000 seeds, with 0 discards. That is checked by an independent certifier with no relaxed path.

Everything below is at **96x96** (the owner's new size) unless marked 64.

## 1. The algorithm, one attempt (`gen/zonegen.ts`, `generateZoneMap(seed, attempt)`)

Each attempt has one mulberry32 stream: `seed` for attempt 0, otherwise `seed + attempt * 0x9e3779b1`. The math is integer or exact IEEE only:
- allowed: `+ - * /`, `sqrt`, `floor`/`round`, `min`/`max`;
- not used: `pow`, `exp`, `log`, `atan2`, `hypot`, `sin`, `cos`, `random`. The certifier spies on these Math functions during generation and sees none.
- Sorts use total comparators: value, then tile index.

### 1.1 Fixed geometry (built once per process)
- Coliseum footprint, its walls, the 4 gates, the gate lanes and the inner spawns, centred at (48, 48).
- The ring road: the 252 tiles within Chebyshev distance 1 to 3 of the footprint.
- The 8 pillar variants, shifted by +16 tiles. Section 5 covers the lattice anchor that keeps them certified.
- The painted set: 8552 tiles, everything off the border and outside the footprint.
- The camp-site mask: the halo stays off the ring road + 1 and 3 tiles from the border.

### 1.2 Zones (retry budget 8 inside the attempt; each retry costs about 3 ms)
1. **Noise.** Two octaves of bilinear lattice value noise, integer only, with cells of 24 and 9 tiles.
   - The cost of entering a tile is `12 + noise * 36 / 256`, so between 12 and 48.
2. **Ring arcs.** The ring road is sorted by a rational pseudo-angle (no atan2) and cut into 5 arcs.
   - Each arc has at least 36 tiles; the remaining 72 are split randomly.
   - Each arc's core (6 tiles trimmed off each end) is pre-claimed by its zone, so **ring contact holds by construction**.
3. **Outer seeds and spines.**
   - 5 seeds are picked by best-candidate sampling (Mitchell, 10 candidates each) in the annulus 0.55 to 0.9 x R0, i.e. 26 to 43 tiles from the centre.
   - Seeds are paired with arcs in angular order, using the cyclic shift with the least total turn.
   - Each seed is joined to its arc by the cheapest path, the zone's "spine", which is pre-claimed.
4. **Equal-quota growth from arc and spine.**
   - Smallest zone first; each zone pops its own heap of cheapest frontier tiles by path cost; each stops at quota (1710 or 1711 tiles).
   - Leftovers go to whichever zone can reach them.
   - Two majority-smoothing passes follow (simple points only).
   - **Balance:** the zone furthest over quota peels boundary tiles down the shortest chain of neighbouring zones to the one furthest under. The peel uses a heap ordered by neighbour count and moves simple points only, so the donor stays 4-connected.
   - Result: painted areas are equal within 1 tile, by construction.
5. **Certify:**
   - spread of painted areas <= 8;
   - ring contact >= F per zone;
   - sliver tiles <= S per zone, using one labelled 5/7 chamfer distance transform for all zones plus a dilation of the core tiles.

### 1.3 Territories and camps (retry budget 4)
For each zone, in order:
1. Pick k seed sites by best-candidate sampling among cells whose halo (the clearing grown by one tile, 45 tiles) fits in the zone. Each site stays 9 tiles from every camp already placed, map-wide.
2. Pre-claim the halos and build a **path-cost Voronoi partition** of the zone (multi-source Dijkstra). Every tile takes its parent's label, so each territory is a 4-connected tree that holds its halo.
3. Lloyd step: move each camp to the best open cell near its territory's pole, then re-partition.
   - The pole is found with a labelled 5/7 chamfer, one per zone.
   - The new cell must keep its halo inside its own territory and 9 tiles from every placed camp and every pending site.
   - The old site is always a valid fallback, so "no pole" cannot happen.
4. Final camp sites are the poles of the final territories.
5. The elite camp is the zone's camp farthest from the centre.
6. Spots: 3 to 5 inside the clearing, never the centre. The chest tile is the clearing centre. The elite stands at spot 0, the spot nearest the centre.

### 1.4 Ruins, styler, obstacles
- **Ruins:** 0 to 2 per zone (random). Each is 7 to 9 tiles a side, with a margin of 2 inside one zone, off the ring road, off camp clearings + 2, and with a gap of 2 between ruins. A ruin that does not fit is skipped; it is optional.
- **Styler hook (zone-terrain):** section 7.
- **Obstacles:** rock chunks at the 64x64 density scaled by area (34 to 69 chunks). They avoid the ring road + 1, ruins + 1, camp halos and non-floor tiles.
- Then the safety nets (gate lanes and clearings forced to floor) and connectivity enforcement (unreachable floor becomes wall). A camp clearing that ends up cut off fails the attempt.

### 1.5 Spawn pool (retry budget 4)
1. Compute BFS 5/7 walking distance from the centre over the styled, pre-cover ground, gates open.
2. Candidates have:
   - a clear 3x3, outside ruins;
   - a radius between 0.5 and 0.95 x R0;
   - at least 7 tiles from every camp centre (the guarantee is 5; the extra 2 leave cuttable ground between a spawn and a halo, which fixed every spawn-screen failure).
3. For contour levels at the 20th to 80th percentiles of the candidates' walk: farthest-point packing within ±4.5% of the level, with 5-tile separation, up to 32 members. Keep the level that packs the most members (ties go to more zones).

### 1.6 Weapon crates
3 or 4 per zone, against a wall, as today. The rule of one crate indoors per region is dropped (D19).

### 1.7 Cover
Protected (`prot`) tiles:
- border, coliseum, 4x4 corners, gate lanes;
- camp halos;
- spawn 3x3s (with a soft 5x5 around them);
- crates (with a soft 3x3);
- ruin doors;
- styler `keepLow` tiles.

Passes, all with the existing `placeCover` (copied into `gen/coverlib.ts`, with the changes listed in section 5):
1. **Pre-lattices** 8 dirs x step 2 and 16 x 1 (new: section 4).
2. Coarse lattice, 32 x 1/2.
3. Fine lattice, 48 x 1/4: the certifying pass. It also screens every spawn pair within 480 u.

A rock that would split a territory's floor locally is a last-resort placement (the territory guard, used as a preference, not a ban).

### 1.8 After cover
1. **Walking contour re-check (BFS 5/7):**
   - Keep the longest window of the sorted pool that fits ±8% of one value.
   - Fail the attempt if fewer than 24 members or fewer than 4 zones remain.
2. **Territory floor repair:**
   - A cut-off floor piece joins the same-zone territory it touches.
   - If it only touches other zones and has <= 40 tiles, it changes zone.
   - Bits of painted area cut off by that move join the zone they touch.
   - Painted area is then rebalanced exactly by moving boundary **wall** tiles only.
   - Ring contact and slivers are re-checked on the final partition.
3. **Final checks:**
   - floor share max/min <= 1.15;
   - painted spread <= 8;
   - 20 or more ground spots.

Parameters: k = 4, area tolerance 8, F = 24, S = 100, annulus 0.55 to 0.9 x R0, camp gap 9, spawn band ±8% (picked at ±4.5%), pool 24 to 32, strayMax 40, guard on.

**F = 24 ring tiles.**
- The ring road has 252 tiles, so the fair share is 50.
- 24 is about half of it: a frontage of at least 8 tiles along the 3-deep road.
- The arcs give at least 30 by construction. Observed minimum: 30; p10: 38.

**S = 100 sliver tiles per zone (5.8% of a 1710-tile zone).**
- The worst zone per map has p50 58 and p90 84 sliver tiles.
- S = 100 rejects the jaggiest zone sets (156 zone retries in 1087 attempts) at about 3 ms each.
- The r = 2.5 opening does **not** catch long arms 5 or more tiles wide; see section 8.

## 2. Measured (Node 25.8, Apple M5 Pro, **shared machine, load average 7 to 14**)

The current wedge generator (64x64) was run in the same windows as a yardstick: mean 18.4 ms at the start of the session, 20 to 23 ms in these windows, and 60 ms in one bad window.

Per certified seed: a raw seed runs through every attempt until one certifies, failed attempts counted, lane tables warm.

| run | mean | p50 | p90 | p99 | max | attempts/seed | first-attempt share | discarded | yardstick (64 wedge) mean / p99 |
|---|---|---|---|---|---|---|---|---|---|
| 1000 seeds (0..999) | **36.9** | 32.8 | 47.4 | **91.6** | 163.1 | 1.09 | 92.3% | **0 (0%)** | 23.4 / 54.7 → 20.3 / 46.2 |
| 200 seeds, run 1 | 45.6 | 40.1 | 59.6 | 113.1 | 170.9 | 1.08 | 93.5% | 0 | 23.4 / 54.7 |
| 200 seeds, run 2 | 56.4 | 42.2 | 90.3 | 189.4 | 226.2 | — | — | 0 | 59.7 / 187 (bad window) |
| 200 seeds, run 3 | 42.0 | 36.0 | 60.9 | 118.7 | 186.6 | — | — | 0 | 20.7 / 51.8 |
| k = 3, 200 seeds | 44.9 | 39.0 | 69.2 | 100.6 | 107.6 | 1.09 | 91% | 0 | |
| k = 5, 200 seeds | 43.2 | 35.9 | 66.7 | 107.4 | 122.8 | 1.13 | 88.5% | 0 | |
| 64x64 comparison (k = 3, pool 16, untuned) | 48.9 | 36.2 | 98.2 | 135.3 | 143.4 | 6.18 | 18% | **11%** | |

**Normalised to the unloaded yardstick (x 18.4 / 20.7):** about 33 to 37 ms mean and about 80 to 105 ms p99 per certified seed. So mean <= 40 and p99 <= 120 hold at 96x96. Re-run `node gen/build/bench.mjs 200` on a quiet machine to confirm.

**Attempts histogram (1000 seeds):** attempt 0: 923, 1: 68, 2: 8, 3: 1; none later.

**Failure reasons, per 1087 attempts:**

| reason | count | cost |
|---|---|---|
| zone sliver | 156 | stage retry |
| areaPost (wall-only rebalance could not even the area) | 56 | full attempt |
| terrStray (cut-off piece over 40 tiles) | 22 | full attempt |
| sliverPost | 4 | full attempt |
| cover fine pass: 3 dead stretches, 1 cut | 4 | full attempt |
| spawnWalkPost | 1 | full attempt |

**Time per attempt by stage (1000-seed run):**

| stage | ms |
|---|---|
| zones | 2.7 |
| camps | 1.6 |
| terrain | 0.3 |
| spawn pool | 1.2 |
| crates | 0.5 |
| cover: pre-lattices | 4.0 |
| cover: coarse | 7.1 |
| cover: fine | 14.3 |
| post + records | 2.0 |

- **Cover is 25.4 of about 34 ms.**
- Inside the cover, the line SCAN is 16.6 ms (the fine lattice alone is 12 ms: 22,968 lines, 2.16 M tile entries) and the CUTS are 8.7 ms.
- Rocks per map: about 1415, about 16.5% of the ground. The spawn screen costs 0.2 ms: the rocks are already dense by then.

**Cover pass cost by pre-lattice choice (12-seed probes):**

| setup | cover ms per attempt |
|---|---|
| no pre-lattice | 42 (coarse 29 + fine 13) |
| pre 12:1.5 | 28 |
| pre 8:2 + 16:1 (chosen) | 25 to 30 |
| pre 8:2 + 16:1, coarse pass off | 41 (the fine pass then cuts 13.9k corridors) |

**Lane tables at 96x96** (`gen/ltmem.ts`):

| table | memory | build |
|---|---|---|
| 8:2 | 0.7 MB | 5 ms |
| 16:1 | 2.6 MB | 4 ms |
| 32:0.5 | 10.2 MB | 10 ms |
| 48:0.25 | 30.6 MB | 21 ms |
| **total** | **44.0 MB** | **about 40 to 75 ms, fixed geometry included** |

- The same four tables at 64x64 take 19.2 MB; today's two take about 18 MB.
- The Float64 `edge` array is two thirds of each table. Float32 would halve it, but changes lane lengths in the last bits: R2 must re-certify if it tries that.

## 3. Client (headless Chrome 155 over CDP, same loaded machine; `gen/cdp.mjs`)
Pages load `build/bench.html` with the browser bundle `build/r1.js` (98 KB). The 100 published (seed, attempt) pairs are certified in Node.

| measurement | x1 CPU | x4 CPU throttle | target |
|---|---|---|---|
| lane tables + fixed geometry, fresh page | mean 36, p99 41 ms | mean 131, p99 135 ms | <= 200 ms ✓ |
| one published attempt, fresh page (cold JIT) | mean **85**, p50 83, p99 113 ms | mean 312, p99 **332** ms | mean <= 60 ✗, p99 <= 150 ✓; x4 p99 <= 500 ✓ |
| the same after one throwaway warm-up attempt at boot | mean **67**, p99 78 ms | mean 244, p99 257 ms | mean just over 60 (loaded machine) |
| 100 attempts in one page (warm) | mean 39, p50 34, p99 62 ms | mean 169, p99 284 ms | |

- Measured on the main thread; a Web Worker uses the same V8, so the costs carry over.
- **Recommendation:** at app boot the worker builds the tables and generates one warm-up map. That takes about 130 ms, off the main thread, in the hub. The worker then generates the real (seed, attempt) as soon as the lobby publishes it.

## 4. Camp count: recommend 4 per zone (20 camps, about 80 mobs)
Data: 60 seeds each in the certifier, 200 in the bench.

| k | camps/map | territory radius p50 / p90 / max (tiles) | share of territory floor within the 12-tile leash cap (p10 / p50) | full-attempt failures per 200 seeds |
|---|---|---|---|---|
| 3 | 15 | 21.0 / 30.7 / 64 | 0.55 / 0.70 | 18 |
| **4** | **20** | **17.5 / 25.0 / 54** | **0.67 / 0.83** | 16 |
| 5 | 25 | 15.3 / 21.2 / 52 | 0.75 / 0.90 | 26 |

- Four always fit: adaptive mode (try 4, else 3) chose 4 on 60 of 60 maps.
- Five also certify. It costs 25% more mobs (about 100) and more area-repair failures.
- Mobs: spots are uniform over 3 to 5, so about 4 per camp: **about 80 mobs per map** at k = 4, against about 39 on today's wedge maps and 60 in the bandwidth bench.
- Ranged mobs: Plague (bow) and Holy (wand) are 2 of 5 zones, so about 32 ranged mobs. Projectiles in flight scale with engaged ranged camps only. Expect the bench's "8 camps fought at once" case to stay similar; the idle and typical cases grow with mob count. That is +33% mob state over the bench's 60 if every mob patches.
- `StateView` interest management becomes more valuable on a 96x96 map with 80 mobs.
- The bandwidth bench was **not** run (as instructed).

## 5. What changed in the shared cover code, and what depends on 64

### Cover code changes (`gen/coverlib.ts` against `mapgen.ts`)
1. **Lattice anchor.** Lines run through `LATTICE_ORIGIN = (W/2 − 32, H/2 − 32)`.
   - At 96x96 the fixed coliseum then sits on the lattice exactly as it did at 64x64, where the pillar layouts were certified.
   - Without the anchor, some pillar variants have a 15.5-tile lane inside the footprint: an uncuttable dead stretch.
   - `longestLane`, the mapgen tests' `fatLane` and every certifier must use the same anchor.
   - With the corner anchor, the 1/4-tile lanes measure 885 to 1031 u, but those are sub-tile slivers. The exact 32 u strip check over 96 angles (lattice and in-between) is 465 u at most, so the 480 u guarantee holds.
2. **TILE_LOW = 2** (blocks movement, not sight). `openMask` (lanes) is now `tile !== TILE_WALL`. The connectivity tests (`SIMPLE`, `sealed`, `ringKeeps`, `walkDistances`, `enforceConnectivity`) keep using `=== TILE_FLOOR`.
   - A rock may stand on a TILE_LOW tile: no connectivity test is needed, and the ring-road count only drops for floor.
   - The spawn screen may also place rocks on TILE_LOW.
   - The repo's `findPath` already walks only TILE_FLOOR, and `raycast`/`isWallTile` block only on TILE_WALL, so both behave correctly unchanged.
   - **Movement collision** (`pathfind.ts` lines 180 to 183 and the server's movement) uses `isWallTile` and would let a body overlap a TILE_LOW tile. R2/zone-terrain must make movement treat TILE_LOW as solid.
3. A territory-guard preference in `levelOf`, pre-lattice support, and the per-line `subarray` copies in the scan replaced by buffer swaps (about 20% off the fine scan).

### Constants that depend on 64
- `MAP_TILES_W/H` (96).
- `CX`, `CY` (48), `R0` (48): every fraction of R0 rescales (annulus 26 to 43 tiles; spawn band 24 to 46).
- `PILLAR_LAYOUTS`: absolute 64x64 coordinates, shifted by `CX − 32`.
- The lattice origin (above).
- Lane table capacity: the formula scales; checked at 96.
- Uint16 tile and line indices: 9216 tiles and 22,968 lines, both under 65,535.
- `LANE_POS` 4096 / `LANE_BIAS` 128: the largest position at 96 is (136 + 128) x 4 = 1056, below 4096.
- `LANE_SLOTS` 10: a strip is now up to 136 tiles long, so at most 8 long corridors at once. Still fits, with less margin.
- The heap key `cost * KEY + tile` needs KEY >= 9216; it uses 16384.
- Noise cells: 16 and 6 at 64, scaled to 24 and 9.
- Obstacle count, scaled by area.
- `EDGE_CLEAR` 3, `CAMP_GAP` 9, spawn separation 5 and the leash cap 12: kept in tiles, not scaled.
- `GROUND_OPEN_MIN` and `pickGroundSpots`' 20 to 30 spots, crates at 3 or 4 per zone: **not scaled**; an owner call for loot density.
- The plan's "3 to 6 ms local retry" budgets: at 96 a zone retry costs about 3 ms and a camp retry about 1.5 ms. The cover is what costs a full attempt (about 25 ms).

## 6. Spawn pool (1000 seeds)
- Size: mean 29.9, minimum 24 (target 24 to 32). The certified minimum is 4 zones represented; all 12 rendered maps have all 5.
- Every member has a member of another zone.
- Separation of 5 tiles or more and 5 tiles or more from camps both hold. The screening fan plus the exact cone holds both ways for every pair within 480 u.
- **Walking ratio across the pool (max/min):**

| metric | mean | p90 | max |
|---|---|---|---|
| BFS 5/7, after cover (certified: ±8%, so 1.174 or less) | 1.163 | | 1.174 |
| findPath | 1.167 | 1.186 | 1.206 |

- Against the owner's 1.2 target: met on average. findPath exceeds 1.2 only marginally on a few maps (1000-seed sweep).
- The spawn screen needs no extra rocks; it takes 11 per map, because the cover's rocks are already dense.

## 7. Styler hook: what the contract needs from the generator
Implemented in `gen/styler.ts`; `styler=demo` exercises it.

**When it runs.** After zones, territories, camps and the generator's ruins. Before obstacles, the spawn pool, crates and the cover pass. That way:
- the walking contour is measured on the styled ground;
- spawns and crates pick from styled floor;
- the cover certifies the styled map.

**Inputs:**
- the zone's faction and index;
- `zoneMask` (its painted tiles);
- `protect`: border, coliseum, ring road + 1, gate lanes ± 1, camp halos (clearing + 1), ruins + 1, the 4x4 map corners;
- `tiles` (writeable);
- an rng stream of its own, derived from (seed, attempt, zone), so styler draws never shift the generator's stream;
- `keepLow` (output).

**What it may change.** Only FLOOR → WALL (blocks movement and sight) or FLOOR → TILE_LOW (fence or lava: blocks movement, not sight). Only inside `zoneMask` and outside `protect`. It never opens a wall. Decoration and hazard layers are its own and are not tiles.

**What must stay open:**
- its zone's walkable floor must stay 4-connected. A cut-off camp clearing fails the attempt; small sealed pockets are walled up.
- Floor share max/min across zones must stay at or below 1.15 after its walls, so each zone's styler should keep its WALL + LOW footprint within a similar budget, for example 8% or less of the zone.
- Territory floor is repaired afterwards. A cut-off piece over 40 tiles fails the attempt.

**How the cover sees it:**
- WALL is cover: it cuts lanes and blocks shots.
- TILE_LOW is open for lanes and shots. The cover pass may put a sight-blocking rock on a TILE_LOW tile; it renders as a basalt column in lava or a solid fence post. A tile listed in `keepLow` is exempt.
- A straight run of `keepLow` tiles longer than 14.98 tiles cannot be cut and fails the attempt. Stylers should break straight LOW features at 12 tiles or less with a wall or a bend.
- Tall WALL structures (cell blocks, colonnades, ruins) reduce the about 1400 scattered rocks the cover otherwise places on a bare map, and make it cheaper.

**Certification takes two masks.** Movement is `tile === TILE_FLOOR` and sight is `tile !== TILE_WALL`.
- Movement is used for connectivity, sealing, territories, walking distance and findPath.
- Sight is used for lattice lanes, the exact strip check and spawn screening (raycast fan and exact cone).

**Demo styler, 200 seeds.** Each zone gets a 2-wide, 24-tile meandering lava river, 3 fences and 2 wall blocks. Result: ALL PASS, 0 discards, the same cost.

## 8. Risks and open points for R2
- **Long arms.** A zone can grow a long arm 5 to 7 tiles wide along the map edge (seed 104 before the guard tweak).
  - The territory there reaches up to 60 tiles from its camp (final code, 1000 seeds; up to 86 before the guard tweak).
  - The leash cap of 12 makes this harmless in play, but it looks odd.
  - The r = 2.5 sliver metric does not see it; an r = 3.5 opening flags it only partly.
  - Proposal: certify territory radius <= about 30 tiles (p90 is 25), or add a 5th camp where a Voronoi cell's farthest tile exceeds that.
- **Rock density.** About 16% of the ground is single rocks: the 480 u cap at 32 u strips on open ground, with no ridges.
  - It is the dominant cost, and visually busy (see the renders).
  - zone-terrain's tall structures are the way to lower it.
- **The client cold attempt** needs the warm-up attempt (section 3).
- **Measurement noise.** The machine was loaded throughout. The 200-seed means are 42 to 56 ms raw and about 35 ms normalised.

## 9. Plan B (not needed; sketch only)
"Warped wedges":
- Keep today's certified pipeline, with the 5 sector rays displaced by integer noise (the `detSin` wobble is already in place, with bigger amplitude) and the ridges dropped.
- Add the same territories (path-cost Voronoi + Lloyd), the global camp spacing, the spawn contour and the repair from this spike.
- Equal area comes from moving each ray's base angle by bisection until the 5 sector areas are within 8 tiles of each other (about 10 sector rasterisations, about 1 ms).
- About 6 to 8 engineer-days. It reuses `coverlib` unchanged and most of this spike's stages 1.3 to 1.8.

## 10. Map pool design (server)
- **Worker.** One `worker_thread` per process loads the generator and lane tables (44 MB). It certifies seeds from a server-private counter and posts certified maps to the main thread: the full GameMap as transferable typed arrays plus JSON, about 30 KB.
  - The main thread then needs no lane tables and does no generation.
  - Throughput is about 25 certified maps per second.
- **Queue.**
  - Target size 8; refill when at or below 6. Rooms are created a few per minute, and a worker refills 8 in about 0.3 s.
  - On a burst, the queue drains and the worker keeps refilling.
  - Training rooms draw from the same queue.
- **Empty queue.** One synchronous in-process certification: 37 ms mean, p99 about 90 to 120 ms, which blocks the event loop. It needs the lane tables on the main thread, built lazily on first fallback. Each fallback is logged with its duration and the queue depth.
- **Published state:** `seed`, `attempt` and `mapHash` (FNV-1a over tiles, regionGrid, territoryGrid and the camps/spawnPool JSON).
  - Clients and bots run exactly that attempt and compare the hash.
  - A seed that fails all 16 attempts is skipped by the worker: 0 in 1000 so far.
- **Startup.** The worker warms its tables (about 75 ms) and fills the queue before the first room. The main thread falls back only if a room comes first.

## 11. Changes to the plan's map contract (section 3.2)
1. **TILE_LOW = 2** in `map.ts`. Document "walkable = `=== TILE_FLOOR`" and "sight-blocking = `=== TILE_WALL`". Make movement collision treat TILE_LOW as solid; today it uses `isWallTile`.
2. **`SIGHT_LATTICE.origin`.** The lattice is anchored at the coliseum centre − (32, 32). `longestLane` and the tests' `fatLane` take it. The alternative is re-certifying the pillar layouts for a corner anchor at 96.
3. **`CampDef`:**
   - `chest` is the clearing centre (the camp tile), which spots never take.
   - `eliteSpot` is 0, the spot nearest the centre.
   - `radius` (farthest territory floor tile) is 17.5 tiles at the median, beyond the 12-tile leash cap. Leash = territory ∩ disc(12): the planning UI should draw that intersection, not the whole territory. Alternatively raise the cap to about 16, or use k = 5.
4. **`regions[]`:** `area` is the **painted** area (certified equal within 8); `pole` is the zone's chamfer pole. The spike returns these as `zones[]`; fold them into `regions[]`.
5. **`spawnPool`:** 24 to 32 members, one contour. The certified metric is **BFS 5/7 walking distance** (the generator's `walkDistances`); the findPath ratio is reported (max 1.21). `map.spawns` stays a view, interleaved by zone.
6. **New `generateMap(seed, attempt)` semantics:** it returns null when that attempt does not certify. Certification lives inside the attempt; the server only loops attempts. The client trusts the published attempt and `mapHash`.
7. `extracts` is always empty: delete it in R2. Scale the ground spots and crates for 96x96 (owner).
8. **Proposed additional gate:** territory radius <= 30 tiles (section 8).

## 12. Files
- `gen/zonegen.ts`: the generator. `generateZoneMap(seed, attempt)` runs one attempt; `certifiedMap(seed)` loops attempts; `warm()` builds the tables.
- `gen/coverlib.ts`: the cover library (from `mapgen.ts`, with the section 5 changes).
- `gen/consts.ts`: the 96 shim.
- `gen/styler.ts`: the styler hook and the demo styler.
- `gen/certify.ts <n> [from=] [styler=demo]`: the independent pass/fail table.
- `gen/bench.ts <n> [from=] [k=v]`: timing, attempts, failures and stage times.
- `gen/render.ts <dir> <seeds...>`: ASCII and SVG renders.
- `gen/cdp.mjs`, `gen/cdp_warmup.mjs`, `gen/chrome.ts`: the Chrome measurement.
- `gen/ltmem.ts`: lane table memory.
- `gen/run.sh <script.ts> args`: esbuild + node.
- `renders/seedNN.txt|svg`: seeds 0 to 5, plus 8, 47, 95, 104, 122 and 186 (the worst by floor share, sliver, pool size, territory radius, walk ratio and attempts under the pre-guard code).
- `logs/`: every run quoted here.
