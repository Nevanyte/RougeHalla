# Zone shapes: as built

The zone-shape rework replaced the R2 generator's random walls with five designed zone shapes on a bigger map. It was built on branch
`claude/zone-shapes` (phase A `76232bc`, the trunk and the feature kit; phase B, the five stylers, the client art, the certifier and
the zone duel harness; phase C1 `4f8c2cb`, the new stylers become the generator and the strict gates go on). Everything below was
checked against the code at `4f8c2cb`. `docs/R2_GENERATOR_AS_BUILT.md` is the history of the generator this one replaced (the cover
pass, the 480 u sight cap, the lane tables, the ruins, the 96x96 map with 20 camps); where the two disagree this note rules.

Numbers marked **PENDING** are still being measured by the integration runs (the merged 2000-seed sweep, the balance runs, the final
benches); the owner's orchestrator fills them in. Numbers marked "phase B baseline" were taken earlier and stay as a reference.

## 1. The rulings, and why

The owner's brief (quoted from `ZONE_SHAPES_OPTIONS.md`, the proposal the picks were made from):

> "The walls and placement of them feel somewhat random and arbitrary, can you give them more of an intentional feel? Frankly there are FAR too many walls that are just placed randomly. I want each zone to have a different navigation feeling."

The audit behind it (40 seeds of the R2 generator): the cover pass cut every sight lane over 15 tiles at the tile on the most lanes, so
about 1,200 loose rocks (68% of the zone walls, 312 of them single tiles) set the total; every zone had the same dose (1,966-2,059 wall
tiles, 8-11% of rays reaching bow range), so zones could not feel different; and 93% of the rocks cost no spawn a tile of walk, so they
cut sight and shaped no route. The rulings that followed:

1. **The 480 u sight cap is dropped.** Owner: "the 480 rule isnt needed anymore. With speed buffs and with attack animations kiting isnt
   fully possible." So `MAX_SIGHT_CORRIDOR`, `SIGHT_CORRIDOR_WIDTH`, the cover pass (`cover.ts`), the rock chunks, the lane tables
   (44 MB per process), `longestLane` and the lane certifier are deleted, and open ground and long sightlines are allowed. The kiting
   guarantee now rests on the windups and the short ranges alone (CLAUDE.md, Known TODOs, weapons); a wall is a design tool.
2. **Every zone gets its own navigation feel, and every wall belongs to a named feature with a job.** A feature that has no job is not
   built, a feature stands whole or not at all, and a leftover wall piece under 6 tiles is dropped (no single-tile rocks). The owner
   picked one shape per zone from three proposals each:

   | Zone | Pick | In one line |
   |---|---|---|
   | The Scorch (Fire, axe) | **Crater Basins** | every camp sits in a basalt crater you enter by named breaches; open ash between; one lava river with fords on the routes |
   | The Gallows (Sentenced, bow) | **The Rows** | long fenced lanes toward the coliseum; you see and shoot across everything and cross only at staggered gates |
   | The Warren (Plague, bow) | **The Barrows** | every road between camps forks round a rock barrow: dry side, bog side, or the tunnel through the big ones |
   | The Rime (Frost, shield) | **The Mere** | open drift with ice lakes; run the lake or hug the shore behind faceted headlands |
   | The Sanctum (Holy, wand) | **The Hypostyle** | a strict grid of square piers fills the heart of the zone; long views only down the aisles; light in the central bays |

   The Rows were approved on one condition: Fire must still beat Sentenced at a fence. It was measured and it holds (section 14).
3. **Ruins: "Keep as landmarks".** The random walled squares are gone. Each zone has one deliberate landmark building, placed up to
   twice, whole or not at all, each with a job: the burnt-out forge, the guard house, the collapsed burrow, the frozen watchtower, the
   shrine (section 5).
4. **Spawn safety is a rule in the pool pick, not rocks.** No two players start within 10 tiles of each other with a clear line
   between them (section 8). The cover used to enforce this by screening pairs within 480 u.
5. **The map is about twice the area.** 136x136 tiles (`MAP_TILES_W`, `MAP_TILES_H`; `WORLD_W`, `WORLD_H` 4352 u; 2.007 times the area
   of 96x96), with the coliseum fixed at the centre. Eight camps per zone, exactly two of them elite: 40 camps a map. The owner wants a
   slower pace with mob farming as the main growth.
6. **Defaults built for the owner's three open questions** (section 16 lists them as still open): two Rime meres of about 350 ice tiles
   each, crates 4-6 and ground spots 30-45 per zone, and the patience timers and the teleport unchanged although the walks are longer
   (spawn to coliseum is about 45-55 tiles, 9-10 s, against 35 tiles and 6.6 s at 96x96).

## 2. What was deleted

The cover pass (`cover.ts`, 903 lines), the rock chunks, the ruins (`carveBuilding`, `ruinGrid`, the ruin quotas), the lane tables and
every helper of the lane certificate (`getLaneTable`, `longestFatLane`, `SIGHT_LATTICE`, `LATTICE_ORIGIN`, the lane checks, strips and
discs of `test/mapCertify.ts`), `MAX_SIGHT_CORRIDOR`, `freezeClearGround` (it used to ice the Rime's leftover clear ground), `maxWallRun`
and `wallDetour` in the styler caps (the cover's lane bound and its short-wall detour), `breakLowRuns`, the old five stylers' recipes and
the wedge-era types they left behind, and the 5/7-contour post check of the pool. Three small modules took over what `cover.ts` also
held: `gridOps.ts` (the grid tables `NB4`, `RING_DX`, `RING_DY`, `RING_OFF`, `SIMPLE` at the map's size, and `enforceConnectivity`, which can
log the tiles it walls), `detMath.ts` (`detSin`, `detCos`, `TWO_PI`, moved verbatim) and `gridTopology.ts` (the size-free versions).
`warmMapgen()` keeps its name and now builds only the fixed layout and the zone layout (7 ms measured; it built four lane tables, 35-75
ms and 44 MB, before).

`geometry.ts` now computes `Math.sqrt(dx * dx + dy * dy)` where it used `Math.hypot` (three sites), and `pathLength` in `pathfind.ts`
(re-exported by `planning.ts` as `walkLength`) likewise. The generator now calls `findPath`, whose `segmentClear` and `raycast` use
those, and `hypot` is on the determinism test's forbidden list because engines may differ in its last bit; a borderline 1.2 spawn ratio
could otherwise certify on the server and not on a client. The sim's lengths change by at most one ulp.

## 3. The pipeline

`generateMap(seed, attempt?, options)` and its siblings keep the R2 API (`tryAttempt`, `certifiedMap`, `MAX_ATTEMPTS` 16, no relaxed
attempt). One attempt, in `mapgen.ts` `buildMap` (the names in brackets are the `MAPGEN_PROFILE` stages `mapBench` prints):

| # | Stage | What it does | Fails |
|---|---|---|---|
| 1 | | the stream, the coliseum's pillar variant, the faction order | |
| 2 | `zones` | `partitionZones`, then `placeCamps`: 8 camps a zone, 2 elite, territories (up to `LAYOUT_TRIES` 4 zone sets) | `A:zones`, `A:camps` |
| 3 | | the fixed walls and the open gates | |
| 4 | `landmarks` | the landmark hook: each zone's styler places up to 2 landmarks through the guard, on stream 3 | `A:styleBreach` |
| 5 | `spawns` | `walkField16` to the centre; the pool pick (section 8) | `A:spawnNone`, `A:spawnPool` |
| 6 | `styler` | the style hook: each zone's shape, surface and props, on streams 0 to 2; hazards cleared from the pool members' 5x5s (T8) | `A:styleBreach` |
| 7 | `nets` | lane floors, camp clearings, `enforceConnectivity` (walls it adds on zone tiles become each zone's `infill` feature), `clearBuried`, the region grid | `A:campCut`, `A:poolCut` |
| 8 | `crates` | camp spots (3-5 each; an elite camp's sorted so spot 0 is nearest the centre), then 4-6 crates a zone (section 9) | `A:crates` |
| 9 | `post` | territory repair, rezone guards, floor share 1.15, area spread, ring contact, slivers, zone floor one piece, territory radius 30 | `A:rezone*`, `A:floorShare`, `A:areaPost`, `A:ringPost`, `A:sliverPost`, `A:zoneFloorSplit`, `A:radiusPost` |
| 10 | `terrain` | `clearBuried`, `clearIceBesideSolid` (a net that should clear nothing; noted when it does), the prop filter | |
| 11 | `records` | ground spots 30-45, the prop filter, then `records()`: camps in contract order, features renumbered by zone, `featureGrid`, `buildings` | `A:ground` |
| 12 | `spawnGate` | the real-`findPath` fairness gate on the finished tiles (section 8) | `A:spawnWalk`, `A:spawnRatio` |
| 13 | `gates` | `SHAPE_GATES` (every zone WALL or LOW tile owned, no zone wall piece under 6 tiles, at most 250 features), then `validateTerrain` T1-T11 | `A:unowned`, `A:wallPiece`, `A:features`, `A:terrain` |

The main stream is drawn only at stages 1, 2, 5, 8 and 11, in that order (changing the order moves every map). Each zone's styler draws
from streams of its own: `styleRng(seed, attempt, zone, stream)` = `mulberry32(hashSeed(...))`, `STYLE_STREAM` = `{ shape: 0, decor: 1,
surface: 2, landmark: 3 }`, and its value noise is salted `stream + 100`. The landmark stage runs whatever the style hook is (the plain
generator `styleZones: null` keeps its landmarks, so crates still have walls); `MAP_STYLERS` only switches the style hook.

The hook position moved: the landmarks and the pool are placed before the stylers (the pool before them since ZT-6, the landmarks at the
old ruins' place), the cover and the chunks are gone, and the crates are picked after the stylers on the finished ground (they used to
come before the cover). The generator checks each hook after it runs (`A:styleBreach`, never seen on a swept seed): only FLOOR may turn to
WALL or LOW, only on painted tiles outside `protect`; with the shape gates on, every tile whose class or terrain kind the hook changed
is owned by a feature of that tile's zone; the landmark stage may only turn zone floor outside the landmark protect to WALL, each tile
owned by a landmark of its zone.

Protected ground. The landmark stage keeps off the border, the coliseum, the ring road and two tiles beyond it, the gate lanes and a
tile round them, every camp clearing grown by 3 tiles, and the 4x4 map corners. The style pass (`styleProtect`) keeps off the border,
the coliseum, the ring road plus one tile, the gate lanes plus one, the camp halos (clearing plus one), the ring round each landmark box
(the box's own tiles are the landmark's feature, so its props and light may stand there), the corners and the pool members' 3x3s. The
styler adds a 3-tile rim from its zone's edge (`rimTiles`).

Determinism is as in R2: only `+ - * /`, `sqrt`, `floor`, `ceil`, `round`, `abs`, `min`, `max`, `sign`, `imul` and bit operations (the
test spies on 23 `Math` functions through a generation, `findPath`, the stylers and the landmarks); integer value noise, integer
distance fields and heap keys; total comparators. The zone heap key `KEY` is 32768 (tile < 18496 at 136x136).

## 4. Map size, camps, elites, territories

| Constant | Value | Where |
|---|---|---|
| map | 136 x 136 tiles, centre (68, 68), `R0` 68; zones about 3,534 painted tiles each, spread <= 8 | `constants.ts`, `zones.ts` |
| camps | `CAMPS_PER_ZONE` 8, `ELITES_PER_ZONE` 2, `CAMP_GAP` 9, `ELITE_MIN_SEP` 16 | `zones.ts` |
| clearing | `CAMP_R` 2.5 tiles (80 u), halo = clearing + 1, 3-5 spots, chest at the centre tile | `zones.ts` |
| territory | the part of the zone nearer to a camp by path cost; floor one piece; radius <= `TERRITORY_RADIUS_MAX` 30 tiles | `zones.ts` |
| unchanged from R2 | `RING_CONTACT_MIN` 24, `SLIVER_MAX` 100, `AREA_TOLERANCE` 8, `STRAY_MAX` 40, `WALL_UP_MAX` 120, `ZONE_TRIES` 8, `CAMP_TRIES` 2 | `zones.ts` |

The two elite camps of a zone are its two farthest from the coliseum centre, the second at least `ELITE_MIN_SEP` (16) tiles from the
first (else the zone's next farthest that is; else its second farthest, noted as `eliteNear`; 70 of 70 seeds seated a second elite 16 or more
tiles from the first in the contract's measurement). Both have `eliteSpot` 0 (the spot nearest the camp centre). `map.camps` has 40
entries in `REGION_FACTIONS` order then camp index, ids `fire-1` to `fire-8` and so on; `regions[].mobCamps` is a view, eight a zone with
`elite` true on two; `territoryGrid` holds 1 to 40. Same-zone nearest neighbours are 11.7-44 tiles apart (p50 19.2), measured. `CAMP_GAP`
stays 9: a gap of 12 seated too but doubled the zone stage's tail. A map has about 160 mobs (40 camps x 3-5 spots; 166 on the bench map).

Territories keep their size (p50 439 tiles, radius at most 29.8 tiles), so the mob leash (`MOB_LEASH_CAP` 12 tiles, the territory) is
unchanged. A crater (radius 5-7.5) sits inside it: mobs chase out through the breaches.

## 5. Landmarks

A landmark is a small hand-drawn building stamped whole into a zone in any of 8 orientations (4 quarter turns, with or without a
mirror), through the guard's `placeFeature` with `LANDMARK_CAPS` (a budget of its own, 4% of the zone). Templates are rows of
characters in `zoneStyle/landmarks.ts` terms: `#` wall, `.` owned floor, `d` door (owned floor, reserved, 2-3 wide), `c` crate nook,
`l` owned floor the surface pass may light, `_` not part of it. Each zone's module owns one template (`FORGE`, `GUARD_HOUSE`, `BURROW`,
`WATCHTOWER`, `SHRINE`); `templateProblems(t)` checks all 8 orientations (every 8-connected wall piece at least 6 tiles, doors 2-3 wide
with a way through, all owned floor 4-connected, at least one nook). Up to `LANDMARKS_PER_ZONE` = 2 a zone (`round(areaScale)`; fewer
when nothing fits), at least `LANDMARK_GAP` 3 tiles from another landmark's box.

| Zone | Landmark (variant) | Jobs | Where |
|---|---|---|---|
| Scorch | burnt-out forge, 9x7 (`forge`) | landmark, lee | at least `R_est` + 3 tiles from every camp centre (+2 when that leaves no room), scored toward the middle 40% of the zone's depth, a door side facing the nearest camp, the second 12 tiles from the first |
| Gallows | guard house, 8x7 (`guardHouse`) | landmark, lee | the first nearest the zone's pole, the second nearest the front door and at least 14 tiles from the first; a house across a territory boundary is scored last |
| Warren | collapsed burrow, 9x9 (`burrow`) | landmark, fork | on the longest Gabriel roads (at least 18 tiles), centred at 0.4-0.6 along the road, doors on the road's axis; it is that road's barrow |
| Rime | frozen watchtower, 8x7 (`watchtower`) | landmark, lee | one beside each lake, 3 tiles beyond the lake's clearance radius, doors toward the lake |
| Sanctum | shrine, 9x7 (`shrine`) | landmark, rest | round the hall's estimated centre at `R + 4`, ends of the hall's axis first, doors toward the hall; the lit nave is `l` |

A landmark is recorded as a feature (kind `landmark`, `variant` the template key, `p = [rot, mirror, ...door tiles ascending]`, anchor the
template origin) and as a rectangle in `map.buildings` (the field kept its pre-landmark name; it is the landmark boxes now). The client
shades a landmark's box as indoors, the pole and the ground spots keep out of the boxes, the pool candidates keep one tile off a box, and
crates may stand inside: each landmark's nooks (owned floor with walls of its own on two orthogonal sides, no door within a tile) are tried
first. Landmarks cost about 2 ms a map in `mapBench` (the contract's target was 1 ms; section 16).

## 6. The feature system

Every wall and LOW tile a styler writes goes through `ShapeCtx.placeFeature(spec)` (`zoneStyle/context.ts`, types in `zoneStyle/types.ts`).
A `FeatureSpec` names the `kind`, the `jobs`, the anchor, kind-specific integer `params`, the `blocks` in write order (tile, wall or
lava or fence or crevasse), optional `groups` and the `floor` tiles it owns without writing (a crater's bowl, a tunnel, a lake, a landmark's
interior). It is a transaction over `ZoneRuntime`'s guarded writes: each write is logged, and a feature that does not stand is rolled
back in reverse order with its counters. Three modes:

- `whole`: every block is written or nothing is (and nothing is recorded);
- `trim`: the guard may refuse blocks; every 8-connected WALL (or LOW) piece holding a tile written here with fewer than `minPiece`
  (default `FEATURE_MIN_PIECE` 6, counting walls already on the map) gives those tiles back; the feature is kept only if at least
  `minSharePermille` (default 600) of its blocks stand;
- `groups`: each group (a pier) is whole; the feature is kept if at least `minGroups` stand.

The guard (`canBlock`) refuses a tile unless it is FLOOR of the zone's own mask, not `hard` (protect), not reserved, not owned by
a feature, at least `rimTiles` 3 from the zone edge and not on the grid's edge, not beside ICE, within the footprint budget, a fence
tile must keep the fence detour (a pair of floor tiles it stands between must still walk within `2k + fenceDetour` steps, `fenceDetour`
10), every LOW tile keeps floor within Manhattan 2, and the zone's floor and the territory's floor stay 4-connected (the simple-point
test, then a bounded join check). Caps: `ZONE_STYLE_CAPS = { joinChecks: 512, footprintPct: 13, rimTiles: 3, fenceDetour: 10 }`, and
`LANDMARK_CAPS = { joinChecks: 128, footprintPct: 4, ... }`. A wall and a LOW tile both cost 1.0 in the footprint (the cover era
counted a wall as 0.35 because it saved the cover's rocks). Because every write is checked against its zone alone, a zone's output does
not depend on the order zones are styled in (zone isolation is a test).

**Ownership.** First owner wins; a later feature never takes an owned tile. `GameMap.features: MapFeature[]` (`kind`, `variant`, `zone`,
`jobs`, `ax`, `ay`, `p`, `bbox`, `tiles`) and `GameMap.featureGrid` (row-major, 0 = none, else 1 + the feature's index) are built by
`records()` and are in `mapHash` (`featureGrid` bytes, the count, then each feature's fields): quests, bots and art may read them, and a
mismatch shows as a desync. They come from the shape and landmark streams, so they are identical with decor on or off. Cosmetic detail
stays in `props` (not hashed). Features are ordered by zone in `REGION_FACTIONS` order; within a zone landmarks first, then the shape
pass's features in placement order, then the zone's one `infill`. `mapFromTiles` gives `features: []` and an all-zero `featureGrid`.

Hazards are owned too: the generator's hook check rejects a terrain kind on a tile no feature of the zone owns, so each zone's surface sits
on owned floor (the Scorch river owns its ember bank, a barrow its bog crescent, a mere its lake, the hall its aisles and light bays,
a shrine its lit nave).

**Kinds and jobs** (`FEATURE_KINDS` and `FEATURE_JOBS` in `map.ts`, append only):

| Kind | Jobs | Writes | `p` |
|---|---|---|---|
| `landmark` | landmark, plus lee, fork or rest | walls, floor | `[rot, mirror, ...doors]` |
| `crater` | pen | walls (the rim), floor (the bowl) | `[camp index in map.camps, radius in quarter tiles, breach count, ...breach DIR16]` |
| `lavaRiver` | crossing | LOW (lava), floor (fords, ember bank) | `[width x 2, ford count, ...ford centre tiles]` |
| `fenceRow` | lane | LOW (fence), floor (gates) | `[axis 0 = along x, row index, gate phase]` |
| `gallows` | landmark | walls (one 3x3) | `[]` |
| `barrow` | fork, plus choke for a tunnel barrow | walls, floor (tunnel slot, bog crescent) | `[radius in quarter tiles, tunnel 0/1, road DIR16, wet side -1/+1]` |
| `mere` | crossing | floor (the lake) | `[lake index, ICE tiles]` (the generator fills the count) |
| `headland` | lee | walls (a faceted shelf) | `[outward DIR16]` |
| `spire` | landmark | walls | `[]` |
| `causeway` | crossing | floor (the lake lane kept plain) | `[]` |
| `hall` | cover, rest | walls (3x3 piers), floor (aisles, light bays) | `[axis, 6, radius, piers, light bays]` |
| `infill` | seal | walls the safety nets added | `[]` |

**Shape gates** (`SHAPE_GATES`, `mapgen.ts`, on since phase C1; `MapgenOptions.shapeGates` overrides it for a custom test hook that
writes tiles without features, which is what the certifier's demo hook passes): every zone WALL or LOW tile owned (`A:unowned`), no
8-connected zone wall piece under 6 tiles (`A:wallPiece`), at most 250 features (`A:features`, `FEATURES_MAX`, one byte per tile of
`featureGrid`).

## 7. The kit

`zoneStyle/features.ts` (integer geometry and tools; a styler imports from it and never from the generator):

- directions and maths: `DIR16` (16 integer vectors of length about 1024, 22.5 degree steps from +x toward +y), `dirIndex16`,
  `dirSep16`, `isqrt`, `dist2`, `segDist2`, `discOffsets(r4)` (a disc in quarter tiles), `inBeam` (a breach's test), `pseudoAngle`;
- noise: `noiseQ`, `fbmQ` (0..1023 integers from the context's noise);
- graphs over the camps: `campNodes` (the zone's camps and its front door), `primMST`, `gabrielEdges`, `rngEdges`, `addShortcuts`
  (Brogue's loop test; it appends in place and returns only what it added), `cyclomatic`;
- fields and shapes: `chamferFrom` (3-4 chamfer in thirds of a tile), `argmaxIn` (the largest empty circle), `majoritySmooth`,
  `componentsOf`, `pruneSmall`, `floodAbove`, `tauForArea` (a binary search on an integer threshold);
- search: `noisyPath` (a noisy cheapest path with an optional integer cost map), `viterbiRows`, `viterbiPath`;
- the route guard: `makeRouteGuard` (below).

`zoneStyle/landmarks.ts`: `stampTemplate`, `stampFits`, `placeLandmark`, `bestLandmark` (scores every fitting origin, every second tile
of the zone's box, in all 8 orientations, and places the best the guard accepts within 12 tries; about 0.1-0.35 ms a call), the optional
`bound` and `search` extras that only change the cost, `templateProblems`. `gridTopology.ts`: `walkField16`, `descentPath`,
`segmentBlocked`, and the size-free `SIMPLE`, `walkDistances` (5/7). `zoneStyle/scale.ts`: `areaScale` (painted / 1710), `lenScale` (its
square root) and `LANDMARKS_PER_ZONE` 2.

`walkField16` is a Dijkstra on the 16-neighbourhood (orthogonal 5, diagonal 7, knight move 11, in fifths of a tile; no corner cutting)
over FLOOR only. Its error against the true walk is about 2%, against 7.7% for the 5/7 chamfer, which is why the pool is picked on it. It
can take seed values and a scope mask (the route guard uses both).

**The route guard** (`ShapeCtx.routeGuard()`, built before a zone's first write on the ground the pool was picked on). It protects the
pool members' walks to the coliseum, so a zone's walls cannot stretch them: `corridor` marks the 3-wide band along each member's baseline
walk (the steepest descent on the pick-time field, string-pulled straight, which covers about 74% of the tiles the real walks take inside
their zone against about 50% for the raw descent), `touches(tiles)` is the cheap filter, and `worstStretch(extraWallTiles?)` runs one
zone-scoped `walkField16` (about 0.25 ms) and returns the worst member's walk as permille of its baseline (1000 = none,
`ROUTE_CUT_OFF` 1,000,000 = a member is shut in); with a tile list it asks as if those tiles were walls, touching nothing. The styler
threshold is `ROUTE_STRETCH_MAX` 1030 (the Scorch accepts a crater at up to 1050 when it cannot do better; the Rime keeps its
headlands off the real routes altogether). The guard reads only its own zone's tiles and the fixed pick-time ground around it, so
another zone's writes never change a result. The surface guard also keeps bog and ice off a corridor tile.

## 8. Spawn pool and fairness

The pool is picked at stage 5, after the landmarks and before the stylers (a pool picked after them lost half its candidates). It has
24 to 32 members (`POOL_MIN`, `POOL_PICK_TARGET`) in at least 4 zones, each with a plain 3x3 of floor.

- **Candidates**: a painted zone tile with a plain 3x3, one tile off every landmark box, on the ring 0.5-0.95 of `R0` from the centre (34
  to 64.6 tiles), at least `SPAWN_CAMP_PICK` 7 tiles from every camp centre (the certifier guarantees 5), and reachable on the
  `walkField16` to the coliseum centre.
- **Contour**: for seven levels at the 20th to 80th percentile of the candidates' walks, a band of +-3% (`POOL_PICK_BAND`) of the level;
  farthest-point packing in the band, the first member drawn from the main stream. The level that packs the most members wins (score =
  members x 8 + zones). It stops early at 26 members in 4 zones and tries up to `SPAWN_TRIES` 4 rounds.
- **The 10-tile rule** (owner ruling): a member is admissible only if every chosen member is at least `SPAWN_SAFE_SEP` 10 tiles away, or at
  least `SPAWN_SEPARATION` 5 tiles away with a wall on the straight line between the two centres (`segmentBlocked` under `MASK_SIGHT`).
  Later walls only add, so it stays true. At 96x96 this rule would cap the pool at 15-18 members; at 136x136 it gives 25-32, which is why the
  map grew before the rule did.
- **The fairness gate** (stage 12, `spawnGate`): the real `findPath` walk of every member to the coliseum centre; a member whose walk
  crosses more than `HAZARD_WALK_MAX` 8 floor-hazard tiles (ember, bog, ice; light is no hazard) goes first; then, while max/min exceeds
  `SPAWN_WALK_RATIO_MAX` 1.2 and more than `POOL_MIN` remain, the extreme member whose removal leaves the smaller ratio is dropped (ties:
  the longer walk, then the higher tile). Under 24 members or 4 zones, or an unmet ratio, fails the attempt (`A:spawnRatio`). The kept
  walks are primed into the planning cache (`primeSpawnWalks`), so the server's map worker ships them with the map. The R3 deal reads
  the same `spawnPool`; its tier rule (`PLAN_WALK_TOLERANCE` 8%) is unchanged.
- **The route guard keeps the pick true.** On open ground at 136x136 the ratio is 1.08-1.15, so the stylers have about 4% of headroom;
  every styler runs the route guard so its walls and hazards stay inside it.

The 1.2 spawn ratio is therefore a certificate on real walks inside the generator (it used to be a report-only owner target that one seed
in a few thousand missed), re-checked by the independent certifier on every seed.

## 9. Crates and ground spots

Crates: 4 to 6 a zone (`CRATES_MIN`, `CRATES_MAX`), against a WALL (4-neighbour), a plain 3x3 (no terrain within a tile), at least 2
tiles from a pool member or a camp centre, 1 from a camp spot or a door tile, and apart (4, then 2, tiles). A landmark's nooks are tried
first. A zone that is short of wall (a plain zone with its landmarks off) places crates on open floor instead (noted `crateOpen`); fewer
than 4 fails the attempt. Ground spots: 30 to 45 a map, on tiles with floor on all eight sides unless fewer than 90 qualify, outside
landmark boxes, hazards' neighbourhoods, camp clearings and crate neighbours. These scale with the square root of the area (the 96x96
map had 3-4 crates a zone and 20-30 spots); the density is 0.72 of before and the nearest loot about 17% farther (owner question 2).

## 10. The five zones

Each zone is a module `zoneStyle/<zone>.ts` exporting its `ZoneStyler` (`landmark`, `shape`, `surface`, `props`, `version` 400, bumped on
any output change), its plan type and its landmark template. Counts that were per zone at 1710 tiles scale with the area (`areaScale`
2.07 at 136); sizes tied to a fighter or a weapon stay fixed (a pier is 3x3 with a 6 pitch, a gate is 3 wide every 12, a barrow radius
2.6-4.6, the bow's 7.5 tiles); zone-spanning lengths scale with the square root (`lenScale` 1.44). "Dials" below are named constants in
the module.

The mean values are over 200 seeds in the phase C1 sweep; the windows are the contract's report windows in `ZONE_WINDOWS`
(`test/mapCertify.ts`). **PENDING**: the merged 2000-seed sweep table replaces these means.

| Measure | Scorch | Gallows | Warren | Rime | Sanctum |
|---|---|---|---|---|---|
| rays reaching 7.5 tiles (window) | 62.9% (48-64) | 85.3% (72-88) | 70.8% (60-74) | **81.7%** (62-78) | 70.8% (60-74) |
| engagement pairs wall-blocked | 21.8% (>= 18) | 4.3% (<= 8) | 11.4% (>= 8) | 5.15% | 13.4% (>= 10) |
| engagement pairs LOW-separated | 2.9% | 22.6% (>= 18) | 0 | 0 | 0 |
| camp-graph loops | 5.04 (>= 1) | | | | |
| footprint (walls + LOW, of painted) | 9.7% (<= 13) | | | | |
| landmarks a zone | 1.93 | | | | |

(Rays: 24 directions from the centre of every even-even floor tile of the zone, capped at 40 tiles. Pairs: 2,500 fixed-seed random floor
pairs 3 to 7.5 tiles apart, classified by `raycast`.)

### 10.1 The Scorch: Crater Basins (`scorch.ts`)

Feel: every camp sits in a basalt crater; you pick a breach, fight inside a pen or hop rim to rim. Jobs: crater `pen`, river `crossing`,
forge `landmark` + `lee`. Fire is exempt from ember, so the fords are its home ground.

- **Skeleton.** The MST of the zone's camps and its front door (Prim, rooted at the door), plus Brogue shortcuts: up to `round(areaScale)`
  (2 at 136) extra edges where the tree walk is at least 1.8 times the straight line and the edge is at most 30 tiles.
- **Craters.** One per camp, radius `clamp(nearest camp / 2 - 0.8, 5.0, 6.5)` tiles, an elite camp up to 7.5 (the options doc's 5.5-8 was
  retuned for the larger camp spacing; a smaller radius wins if its ring is 30 permille freer). The rim is a one-tile jagged ring (a second
  tile on about 30%), opened by 2 to 3 breaches 4.5 tiles wide, each aimed at a skeleton neighbour at least 3 `DIR16` steps apart, plus
  one more wherever the rim would cut a pool member's corridor while the crater keeps 60% of its rim. A crater by the zone edge counts the
  frontier as a breach. The bowl is owned floor. A crater that would stretch a member's walk past 1050 permille is left out and the camp
  stays open. 7.5 craters a zone on average.
- **The lava river.** One stretch of about 54 x `lenScale` (78) path steps at 45-75% of the zone's depth, the depth that spares the most
  spawn walks, 2-3 tiles wide, never within a crater plus 2.5 tiles. Fords (4 path steps each) are planned per candidate stretch: one
  over every pool member's corridor and one per camp route that crosses it, at least 2. 70-160 lava tiles.
- **Ember** on every free floor tile 8-adjacent to lava, the fords' sides included, except bank tiles on a corridor that are no ford's;
  the river owns its bank as floor.
- **Props**: `crater_lip`, `glow_crack`, `ember_vent`, `ash_drift`; `anvil` and `slag_heap` in a forge.

### 10.2 The Gallows: The Rows (`gallows.ts`)

Feel: free lanes toward the coliseum, fences you shoot across and cross only at gates. Fences (`TILE_LOW` + `TERRAIN_FENCE`) stop bodies and
melee swings but not sight, arrows or balls. Jobs: fenceRow `lane`, gallows `landmark`, guard house `landmark` + `lee`.

- Rows run along the axis from the coliseum to the zone's centroid, snapped to x or y. Row positions come from a 1-D Viterbi
  (`viterbiRows`) over the open runs of at least 8 tiles, rows 7-9 apart (target 8); each row's path is a second Viterbi with one-tile
  jogs. About 9.8 rows a zone, 226 fence tiles.
- **Gates**: `gallowsGateOpen(s, phase)`, a true modulo, 3 tiles every 12 (`GATE_PERIOD`, `GATE_W`), phase 2 for even rows and 8 for odd,
  so every fence tile lies within 5 tiles of a gate and a crosser detours at most 10 tiles (the guard's `fenceDetour`). The zone duel
  harness builds its arena from the same function.
- **The square**: a 9-tile window nearest the zone's centroid is left open on both bounding rows and the 3x3 wall gallows stands in it.
- **Route guard**: the fence is written whole, then the worst member's corridor is opened and rechecked (up to 6 checks) until no walk is
  stretched past 1030 permille; a row the repair empties stays recorded, owning its gate floor only.
- Props: `chain`, `gate_post` and `lantern` at gates, `banner` and `stocks` in a guard house, `gallows`.

### 10.3 The Warren: The Barrows (`warren.ts`)

Feel: every road between camps forks round a rock barrow: left on dry ground, right through the bog, or straight through the 3-wide
tunnel bored into the biggest barrows. Jobs: barrow `fork` (+ `choke` for a tunnel barrow), burrow `landmark` + `fork`. Plague is exempt
from bog, so the wet fork is its ground.

- Roads are the edges of the Gabriel graph over the zone's camps and front door that are at least 15 tiles long, longest first, up to
  `round(6 x areaScale)` barrows (12). Radius `clamp(0.2 x road length, 2.6, 4.6)` tiles, shrunk in half-tile steps until it fits; the
  centre is searched along the road (0.35-0.65) and up to 3 tiles across for a disc that is at least 62% open. The rock is a noisy disc,
  written centre-out. The `round(2 x areaScale)` (4) largest barrows (radius at least 3.5) get a 3-wide tunnel slot.
- **Bog**: a crescent on one flank (the noise coin, unless the other keeps more bog off the corridors), 0.8 to 4.5 tiles beyond the rock,
  in pieces of 8 or more, kept off the corridors and 3 tiles from a camp clearing.
- **Deviation from the contract, measured**: a barrow may not stand on a member's walk line (the middle row of a corridor) and may clip at
  most 3 tiles of it; it may overlap the corridor's fringe. Keeping every barrow off the whole 3-wide corridor left 6.1 barrows a zone and
  20% of seeds at 8 or more; with this rule it is 8.4 and about 72.5%, and the worst stretch stays at 1000-1028 permille. A barrow also
  stands 2 tiles beyond its radius from every pool member.
- 8.4 barrows, 3.8 tunnels, 199 bog tiles a zone; bog on a member's walk 0.2 tiles on average.

### 10.4 The Rime: The Mere (`rime.ts`)

Feel: open drift; the camps look at each other across a sheet of ice. Run the lake (fast, exposed, slippery for everyone but Frost, who
keeps full grip) or hug the shore behind faceted headlands. Jobs: mere `crossing`, headland `lee`, spire `landmark`, causeway
`crossing`, watchtower `landmark` + `lee`. `freezeClearGround` is gone: the Rime's ice is the lakes and nothing else.

- **Lakes**: two meres on a zone of 2,600 or more painted tiles (one below), each grown from the largest empty circle of a clearance field
  (distance from camps 5.6 tiles, the zone edge 4, the ring road 5.5, spawn pads 3.6, landmarks 3, and the pool members' corridors with no
  margin) by a binary search on an integer threshold to `LAKE_GROW` 400 tiles (the contract's 450; `ICE_WANT` 820 lets the first mere grow
  again when the lanes and shelves take too much), smoothed by two 3x3 majority passes. Roughly 17.4% of the zone's floor is ice, 589
  ice tiles on average (459-670).
- **Headlands** (3 a lake) and a **spire** (an island of 8-11 tiles where the clearance is at least 4.5 tiles) are faceted shelves
  (`facetShelfCells`), whole or not at all, never on a real member route or its band. The Rime does not call `worstStretch` after them: the
  members whose way passes near a lake get their real `findPath` route, and no shelf stands on it.
- **Causeway lanes**: lake tiles within a tile of a member's route stay plain ground, owned by a `causeway` feature (packed snow in the
  art), so no spawn walk crosses ice.
- ICE goes on the lake tiles that pass `canSurface("ice")` (eight plain neighbours, T11), off the lanes, and never within `RING_ROAD + 2`
  of the coliseum. The generator writes the ICE count into the mere's `p[1]`.
- Props: `ice_spire`, `icicle`, `snow_drift`, `frost_sparkle`, `ice_crack`, `tower_frost`.

### 10.5 The Sanctum: The Hypostyle (`sanctum.ts`)

Feel: a pillared hall at the heart of the zone; long views only down the aisles; light in the central bays. Jobs: hall `cover` + `rest`,
shrine `landmark` + `rest`. Holy heals twice as much on light, so Holy rests in the bays, where a bow's long lines are cut every 6 tiles.

- A lattice of 3x3 piers on a 6-tile pitch (pier offset 2 + 6i; aisles 3 wide), on the zone's main axis, inside a radius of
  `clamp(round(13 x lenScale), 11, 19)` (19 at 136) round the centre where the most piers fit whole, minus the distance to the pole, plus
  a bonus on the line through the two shrines. Each pier is one `placeFeature` group, so it stands whole or not at all; piers that touch a
  corridor are pre-emptively dropped and the worst stretch is measured (at most 6 measurements). The feature owns the aisles within the
  radius. About 22 piers a zone (windows: 18-30).
- **Light bays**: the 3x3 aisle crossings at multiples of 6 from the centre along the axes (5 bays, 9 when the radius is 16 or more); the
  surface pass lights those and the shrine's nave. About 82 light tiles a zone.
- The shrine's slot search tries the axis ends first and then the cheapest slot that fits (a deviation from the contract's three slots,
  which left a shrine off 1 seed in 3: the zones are wedges or Ls about 60 tiles across).
- Props: `column_cap`, `candelabra`, `stained_glass`, `altar`, `brazier`, `banner_red`.

## 11. Certification

**Hard** (a failure rejects the attempt in the generator, and `certifyMap(...).failures` rejects a map): connectivity with the gates open
and sealed with them closed; the clearings; zones (areas within 8, ring contact >= 24, slivers <= 100, zone floor one piece); territories
(one piece each, radius <= 30); floor share <= 1.15; the pool (24-32, >= 4 zones, the 10-tile rule, >= 5 tiles from camp centres); the
findPath ratio <= 1.2 and hazard tiles <= 8 on every member's walk; crates 4-6 and ground spots 30-45; `validateTerrain` T1-T11; and, in
strict mode (`zone && SHAPE_GATES`), ownership of every WALL, LOW and floor-hazard tile, no wall piece under 6 tiles, tile classes and
terrain kinds that fit the feature kind, per-feature sizes and jobs, no feature on a camp clearing or a spawn pad, landmarks (one zone,
doors at least 2 wide, interior at least 60% floor, 3 tiles from camp halos), whole gallows and piers. The certifier re-declares every
constant it checks and imports nothing from the generator.

**Report-only** (`stats.zones[z]`, judged against `ZONE_WINDOWS` and `SWEEP_THRESHOLDS`; a breach is investigated, never an automatic
failure): the ray profile, engagement pairs, the camp graph (stretch of each camp-to-camp edge as findPath length over straight length, and
loops = E - V + C over the traversable edges), wall pieces and singles, footprint, terrain and feature counts, landmark counts, elite
separation. Across a sweep: attempts per seed <= 1.10, discards 0, findPath ratio p90 <= 1.17, hazards on walks p90 <= 6. The loops window is
relaxed to at least 4.5: a Gabriel graph of 9 nodes has 13 edges, so E - V + 1 is 5.

**Scripts.**

- `npx tsx packages/shared/scripts/mapSweep.ts <count> [from=] [styler=default|none|zone|demo] [strict=auto|0|1|fire,...] [decor=10] [table=stderr|stdout|off]`
  runs the certifier on every seed's pool map and prints one JSON line (shardable: run ranges in parallel, then `merge=a.json,b.json`)
  and a readable table on stderr (hard checks, thresholds, a per-zone matrix with `!` outside its window, window breaches). Every
  multiple of `decor` is also built with decor off and must hash equal. A non-empty `failed` list is a broken guarantee though the script
  exits 0.
- `npx tsx packages/shared/scripts/mapBench.ts [seeds] [from=] [styler=default|none|zone] [landmarks=default|none] [yard=]` prints the
  cost per raw seed, attempts, failures by reason, the time per stage against the contract's targets, the styler's time per zone by faction
  and the landmark stage.
- `npx tsx packages/shared/scripts/pinMaps.ts [final] > packages/shared/test/mapPins.ts` re-pins seeds 0-199: `PINNED_MAPS` (the stylers
  on), `PINNED_PLAIN` (`styleZones: null`) and `OPEN_PINNED` (each styler's output on the synthetic open fixture), plus
  `PIN_STYLER_VERSIONS`. Run it in its own process: the pins that the certification shards compare against then also prove the generator
  is deterministic across processes. Without `final` it writes a PROVISIONAL line. **While any registered styler's `version` differs from
  `PIN_STYLER_VERSIONS`, `pinsApply()` is false and the pin tests skip** (so a styler under construction does not turn the generator's
  tests red for everybody). The file at `4f8c2cb` is provisional (versions 1, stylers 400): **PENDING**, the final pins are recorded
  after the merged sweep.
- `printMap.ts <seed> [attempt]` (zones, territories, camps, chests, crates, landmarks, features, the pool) and `printZone.ts <seed> [zone]
  [--plain] [--props] [--features]` (`--features` draws every owned tile as its feature kind's letter).

**Tests.** `mapgen.cert.0..7.test.ts` (seeds 0-199 in 8 shards from `mapCertifyShards.ts`: certify, assert the findPath ratio and
the hazards on every seed, print a stats line per shard, compare the pins), `mapgen.test.ts` (API, determinism, the Math spy, the hooks and
their breach rules, decor, the shape gates), `mapgen.perf.test.ts` (the cost gate), `mapStyler.test.ts` (the demo hook),
`zoneStyleGen.test.ts`, `zoneStyleGuard.test.ts`, `zoneStyleKit.test.ts`, `zoneStyleFeatures.test.ts`, `zoneStyleLandmarks.test.ts`,
`zoneStyleTopology.test.ts`, `gridTopology16.test.ts`, `zoneStyleOpen.test.ts` (the stylers on a synthetic open fixture,
`zoneStyleOpen.ts`: size-free, rim, footprint, isolation, determinism, pins) and one `zoneStyle.<zone>.test.ts` per zone.

**Results at phase C1** (1000 seeds, strict certifier): 0 failures, 0 decor mismatches, 0 discards, attempts per seed 1.005-1.011, findPath
ratio at most 1.172, hazard tiles on a member's walk at most 8. **PENDING**: the merged 2000-seed sweep table (per-zone matrix and the
threshold breaches).

The cost gate is `max(60, 1.5 x median)` styled and `max(45, 1.5 x median)` plain, scaled by a yardstick (`YARDSTICK_QUIET_MS` 5 on an
Apple M5 Pro): `STYLED_GATE_MS` 93 and `PLAIN_GATE_MS` 48 as set in phase A (the stylers have changed since). **PENDING**: the final
thresholds.

## 12. Performance

Generation (`mapBench`, per raw seed, every attempt until one certifies, Node 25.8, Apple M5 Pro, a shared machine):

| | mean | p99 | attempts a seed | note |
|---|---|---|---|---|
| contract targets | <= 45 ms | <= 120 ms | <= 1.10 | stage targets: zones+camps 14, landmarks 1, spawns 3, styler 10, nets+crates+post+terrain+records 6, spawn gate 8 |
| phase C1, 200 seeds | about 35 ms | | 1.005 | styler about 11 ms a map, landmarks about 2, spawn gate about 4; the plain generator about 27 ms |
| 100 seeds while other agents ran | 44.4 ms | 88.9 ms | 1.010 | styler 14.0, zones 14.8, spawn gate 4.4, landmarks 2.8, spawns 3.4 ms a map |
| final | **PENDING** | **PENDING** | **PENDING** | |

R2's targets were a mean of 40 and a p99 of 120 at 96x96 with the cover (the cover was 54% of its time). Per-zone styler time at phase C1
(loaded machine): Scorch 4.3 ms, Gallows 3.2, Rime 2.9, Sanctum 1.6, Warren 1.4; the contract allowed 2.0 ms a zone (2.5 for the Rime).
A map is about 110 KB by structured clone to and from the pool worker (the five 136x136 layers are 92 KB); the worker was 44 MB heavier
with the lane tables and no longer is.

`PULL_WINDOW` (string-pulling candidates in `findPath`) went from 32 to 96 because open maps have hops longer than 32 candidates: on 40
open 136x136 maps (2,000 path pairs each) 11.1% of paths were over 1% longer than the unbounded pull at 32, 4.2% at 48, 1.3% at 64 and
0.06% at 96 (max ratio 1.062), for 7.5% more cost per path at p99 than 32. On the final maps `bench/pullWindow.ts` read 0.02% over 1%,
max 1.0632, p99 cost 0.99x the unbounded pull. The generator's gate depends on it, so changing it re-pins every map.

## 13. Client

- **Bake budget.** The floor alone is 64.9 MB at scale 1 on a 136x136 map (81 chunks of 17x17 tiles, 4352 x 3482 px and the overlap)
  against the old 48 MB budget; `TEXTURE_BUDGET_BYTES` is now 64 MB and `FLOOR_SCALES` is `[1, 0.75, 0.625, 0.5]`, so a map bakes its floors
  at 0.75 (36.7 MB) and the wall pages (10-15 MB) fit with room to spare. Bake 86-104 ms (Chrome, 1x CPU), 770-980 scene children
  (R2: 612).
- **Feature art** (`render/zoneArt/artBase.ts`, `featureArt.ts`, `featureStyle.ts`) is keyed on `map.features` and `map.featureGrid`, never
  inferred from tile shapes: crater rims (a lip lit toward the camp centre) and their ash bowl, barrow mounds (rounded top, moss) and
  shadowed tunnels, fence rows and the gallows, the shore of a mere, causeways (packed snow), shards for headlands and spires, hall piers
  (a column with a capital) over aisle paving, fords, door tiles, and masonry per landmark variant (forge basalt with an ember glow, guard
  house stone and bars, burrow earth and timber, watchtower ice-stone, shrine marble), with the landmark's interior shaded as indoors
  through `buildings`. A map with no features paints exactly as before. `shared/src/propKinds.ts` gained 12 prop kinds appended in the
  contract's order (`crater_lip`, `anvil`, `slag_heap`, `gate_post`, `stocks`, `tunnel_beam`, `burrow_rubble`, `reed`, `tower_frost`,
  `ice_crack`, `altar`, `brazier`).
- **Map screens** for 40 camps: the planning screen, the hold-Tab map and the minimap cull overlapping marks (`ui/planningMath.ts`: a
  matchup chip hides when its box meets another mark and returns on hover or focus; a zone label moves to the nearest free spot inside
  its zone), show two elite crowns a zone, and the minimap caps its dots and chest blips for up to about 200 mobs.
- **Worker**: `mapTransferables` includes `featureGrid`. The dev page `packages/client/test/dev/zoneart.html` (with `zoneart.ts`) and
  `shots.mjs` take three screenshots per zone (game view, minimap, hold-Tab map) through a headless Chrome. **PENDING**: the screenshots
  and the in-browser frame numbers on the final maps.

## 14. The zone duel harness and the Rows condition

`npm run harness:zones -w @raid/server [-- --source rows|map|both] [--variants] [--seeds N] [--pairs P] [--zone a,b] [--edge a>b,..]
[--cap S] [--rows-setups full|quick] [--quiet]` (`server/src/harness/zoneDuel.ts`, report only, about 5-15 s). It fights duels where the
terrain is, in the real sim with signatures on and both fighters locking each other.

- **The Rows condition**: Fire (axe) against Sentenced (bow), starting on opposite sides of one row 4, 6 and 7.5 tiles apart, the line
  crossing the row 0, 2, 4 and 6 tiles from the nearest gate, four tilts, each fighter as the one further from the gate: 96 setups, the
  same 96 on open floor as the control. It holds when Fire wins at least half. **It holds: Fire wins 96 of 96 in the rows and 96 of 96 in
  the open**, with an hp margin of +50 points in the rows against +63 in the open, the detour 0.50 s on average (1.54 s at worst), and
  the closest win leaving Fire 21% of its hp; 13% of Sentenced's arrows crossed a fence. The variants (`rows10`, `rows4w`, `rows6`) also
  hold at 100%.
- **Headroom is thin in the worst pocket.** A sweep of only the worst pocket (the crossing 6 tiles from a gate) over the gate period read
  100% at 12 (built), 92% at 16 and 25% at 20 (reported by the phase C run; that sweep is not in the harness). Do not widen the gate
  period without rerunning the condition.
- `--source map` fights every designed edge inside the real zones of generated maps, pairs of floor tiles 4 to 7.5 apart, against the same
  duels on open floor. **PENDING**: the numbers on the final maps.

The harness also drives `duel.ts` with `Arena` "rows" (a 40x40 arena with fence rows at x = 8, 16, 24, 32 and the gate rule of
section 10.2) and `map`/`starts` options; every existing report is unchanged byte for byte.

## 15. Server, bots, benches and the code sites that assumed the old map

- **The map pool and encoder.** `MapPool` and its worker are unchanged in shape (structured clone of about 110 KB, the walks shipped with the
  map, the backoff and watchdog). The synced state at 136x136 (the camps, the roster, about 160 mobs placed in one tick) is larger: a
  joiner's first full sync is about 23 KB, so `server/src/index.ts` sets `Encoder.BUFFER_SIZE` to 64 KB (`ENCODER_BUFFER_BYTES`; the
  default is 16 KB, and the encoder grows past it with a logged warning in every room).
- **Generic by construction** (read the map through `camps`, masks and `findPath`; no change needed): `mobAI`, `mobLife`, the lock chase,
  `planning.ts` (`isEliteCamp`, `campMatchup`), `sim/camps.ts` and the schema (`camp` is a uint8, up to 255), the bots' brain (their budgets
  scale with `WORLD_W`), `campDuel --map`, the quest placement (it reads only the map contract). Rosters: `rollZoneTypes` still draws a
  zone's 3 normal types shuffled and repeats them for camps past the third, and `campMobs` puts the zone's one elite *type* at every camp
  with an `eliteSpot`, so a zone's 8 camps hold each normal type two or three times and its 2 elite camps both hold the zone's elite
  type. More mob types per zone are the mob session's change.
- **Stale statements and comments found at `4f8c2cb`** (not edited here): `server/src/index.ts:272` ("the main thread's lane tables"),
  `server/src/sim/mobLife.ts:7` and `shared/src/mobs.ts:63` ("the zone's one elite" / "exactly one elite per zone": they mean one elite
  type), `server/src/bots/brain/strategy.ts:108` and `services.ts:3` (96x96 figures), `shared/src/zoneStyle/scorch.ts:15` (says
  `worstStretch()` is not called; `placeCraters` calls it), and in the client `render/MapView.ts:65`, `zoneArt/palette.ts:151` and
  `zoneArt/bake.ts:110, 396, 449` (the cover pass and "ruins", which are landmark boxes now). `docs/R1_GENERATOR_NOTE.md`, `docs/BOTS.md`
  and `docs/BOTS_TUNING.md` still describe the 96x96 maps in their measurements, labelled as such.
- **Bots and quests** read the map through the masks and `findPath` and place by `camps`, `spawnPool` and `regions[].pole`; poles avoid
  landmark boxes, and landmarks are good giver spots (`features` of kind `landmark`). Their measurements on 136x136 maps are in their own
  reports (`docs/BOTS_TUNING.md`, `docs/quests.md`): **PENDING**, the phase C tournament and `questBench` runs.

## 16. Balance and bench baselines

Taken at phase B (`76232bc`, 166 mobs) unless marked; **PENDING** rows are the phase C runs on the final maps.

| Measure | Phase B baseline | Gate or target | Final |
|---|---|---|---|
| `stepBench` (8 players, 166 mobs) avg / p99 | 0.38 / 0.66 ms; `--stress` 0.53 / 1.25; `--bots 8 --clock cpu` 0.91 / 1.83 | avg < 5 ms, p99 < 15 | **PENDING** |
| `bandwidth` typical / heavy / idle, per client | 7.74 / 10.93 / 3.31 KB/s; a joiner's first sync 23.1 KB | < 20 KB/s | **PENDING** |
| `campDuel --map`, camp pull, size 4: normal / elite camps cleared (of 25) | 21 / 9 | at least 20 (normal) | **PENDING** |
| `mobDuel --style stand`: normal / elite cleared (of 25) | 24 / 22 | | **PENDING** |
| bot tournament (lineup E,E,N,N,H,H) | games about twice as long (mean about 370 s against 173 s; the teleport fires in 100% against 50%) | | **PENDING** |
| weapon harness, `harness:factions`, `test_kite.py` | no map input (they run on bare floor) | | **PENDING** (rerun) |
| `harness:zones --source map` | not run | | **PENDING** |

## 17. Known limits and open owner numbers

- **The Rime's rays reach bow range in 81.7% of cases** against the contract's window of 62-78%. The window was the contract's own
  estimate, not an owner number; the lakes make the zone the most open. The 30-seed sweep flags it. Open owner question: accept it, or
  fill the lakes' shores with more headlands.
- **Small meres.** The second mere grows from the clearance left by the first and the camps, so on some seeds it is small (the first can
  grow to `ICE_WANT`); a small lake (under `LAKE_MIN` 40 tiles) gets no headlands, spire or tower, so a Rime has fewer than 2 watchtowers
  on about 3 seeds in 10 (1.57 a zone in 30 seeds).
- **Barrows**: 8 or more on 72.5% of seeds, not 95% (section 10.3); the window judges the mean (8.2-8.4).
- **Loops** window at least 4.5 (section 11).
- **Landmark pass cost**: about 2 ms a map, 2.8 under load, against a target of 1.
- **Pool headroom is thin on open ground**: the ratio is 1.08-1.15 against a gate of 1.2. A styler that stretches walks costs attempts;
  the route guard exists for this. About 1 attempt in 100 fails `A:spawnRatio` or `A:camps`.
- **Joiner's first sync is 23 KB** with a 64 KB encoder buffer; a bigger roster or more mobs would grow it (interest management,
  `StateView`, is still the real fix).
- **Owner questions with their defaults built** (GAME_DESIGN 18): two Rime meres of about 350 ice tiles, or one grown toward 700; loot at
  4-6 crates and 30-45 ground spots, or the old density (6-8 crates, 40-60 spots); longer spawn walks (9-10 s) with the patience timers
  (300 s first, 120-300 s scaled) and the teleport unchanged.
- **The kiting guarantee has no maps behind it any more.** Walls cap nothing; the Sentenced and Plague bows and the Holy wand see more of
  a zone than before (rays at bow range went from about 11% of rays to 63-85%). The weapon harness and `test_kite.py` never read a map, so
  they are unchanged; the zone duel harness covers the one condition the owner made conditional.

## 18. How to add or change a zone shape

1. Write or edit the zone's module in `zoneStyle/` as a `ZoneStyler`: `landmark` (before the pool), `shape` (walls and LOW features only
   through `placeFeature`, never `block()` directly), `surface` (hazards through `canSurface`), `props`. Ask `routeGuard()` before the first
   write and honour `corridor` and `worstStretch`. Own nothing without a job. Draw only from `c.rng` and the kit's noise, never from the
   generator's stream; use no `Math` function the determinism test forbids. Keep every piece at 6 tiles or more.
2. A new feature kind or job is appended to `FEATURE_KINDS` / `FEATURE_JOBS` (`map.ts`) and to the certifier's re-declared tables
   (`CERT_FEATURE_KINDS`, `KIND_WRITES`, `KIND_JOBS` in `test/mapCertify.ts`), plus the client's look tables
   (`render/zoneArt/featureArt.ts`). A new prop kind is appended to `shared/src/propKinds.ts`. These are wire and hash order: never
   reorder.
3. Bump the styler's `version`. The pin tests skip until the pins are recorded again.
4. Add the zone's window in `ZONE_WINDOWS` and its own `zoneStyle.<zone>.test.ts` (ownership, pieces, the windows over seeds, isolation,
   determinism, the landmark in all 8 orientations).
5. Run `mapSweep.ts` over a few hundred seeds (strict on), `mapBench.ts` for the cost, then `pinMaps.ts final > test/mapPins.ts` in its own
   process, then the suite.
6. If the shape changes what a faction edge needs (fences, cover, ice), rerun `npm run harness:zones -w @raid/server` and the edge that
   zone is for; the Rows condition is the model.
7. Update this note, CLAUDE.md (the zone stylers rule and the layout) and GAME_DESIGN 5.
