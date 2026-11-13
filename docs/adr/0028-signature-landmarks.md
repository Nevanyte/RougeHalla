# ADR0028: Signature landmarks

Status: **Proposed.** Owner beta-follow-up decisions 5 and 6 (MIGRATION, 2026-11-10); owner direction 2026-11-12 (the
generation order and the core rules G1-G8 below). Packets P-SIGNATURE-1, P-SIGNATURE-1-fix (the server post-pass) and
P-MAPGEN-SIGNATURE-CORE-1 (the generator step), P-MAPGEN-SIG-FIRE-1 (the Fire volcano in the generator),
P-MAPGEN-SIG-FIRE-2 (craters sized by band, streams two tiles wide), P-MAPGEN-SIG-FROST-1 (the Frost cave in the
generator; the server post-pass deleted). The `DEVIATIONS.md` row (DEV-020) is proposed in the hand-off; the owner
signs.

**Per-operation checklist.** D1: new terrain with no legacy counterpart, an intentional difference (DEV-020); with the
option off every map is byte-identical (G8). D2: n/a. No sim tick, wire or protocol change; the map export format stays
`rh-map/2`; the content hash does not move (the signature tables are listed as non-gameplay while the option is off by
default; the owner may promote them).

## Context

Each zone should be recognisable at a glance: a volcano with lava (Fire), a church with a graveyard (Sentenced), a giant
bog tree (Plague), a frozen cave (Frost), the temple hall (Holy). P-SIGNATURE-1 added them in `rh-server` after the whole
map was generated, squeezed into leftover floor: wrong order, 9 to 16 of 16 maps per zone, and the stylers knew nothing
of them. On 2026-11-12 the owner set the order and rules that tie generation together.

## The core rules (owner direction 2026-11-12; binding for all generation work)

| # | Rule |
|---|---|
| G1 | **Order.** (1) zones (partition, coliseum, camps); (2) one landmark per zone; (3) thematic obstacles (the zone styler); (4) decoration (`rh-mapdress`). No step moves what an earlier step placed. |
| G2 | **One landmark per zone, placed by a site rule**, before any obstacle: Fire volcano on the zone's back edge; Sentenced church around the far elite camp; Plague bog tree in the outer third; Frost cave on the back edge around the far elite camp; Holy the temple hall. Where the zone exists, the landmark exists. |
| G3 | **The landmark is the zone's anchor** (centre, footprint, facing: toward the coliseum is "front"). Steps 3 and 4 arrange the zone around it and nothing else. |
| G4 | **Bands.** Chebyshev distance from the anchor's footprint: core, near, mid, far (one table). Each zone gives each band an obstacle family and a decoration family; density falls with distance; far blends into the neighbour. |
| G5 | **Keep-clear outranks theme.** Camps, spawns and their walks, routes, gate lanes, crate and ground spots stay free. The generator's own checks and the certifier judge: a failing map is discarded, never repaired by removing the landmark. |
| G6 | **Seeded, local randomness.** Every choice is drawn from a stream of (map seed, attempt, zone, step). |
| G7 | **Clusters and edges, not scatter.** |
| G8 | **Legacy stays reachable.** With the option off the generator's output is byte-identical to today's. |

## Decision

1. **Where.** `rh_sim::mapgen::landmarks::signature`, a step inside the Landmarks phase: `pipeline::build_attempt`
   runs it right after the legacy landmark stage and before the spawn preparation, only when
   `pipeline::Options::signature` (serde default `false`) and the attempt is styled. Zones in order Fire, Sentenced,
   Plague, Frost; each keeps out of the aprons marked before it. All four landmarks are generator-placed; nothing is
   added after generation. Not a landmark recipe: the legacy
   stage admits only floor-to-wall writes owned by `FeatureKind::Landmark`, whose certifier rules and `map.buildings`
   records belong to the legacy buildings.
2. **How later steps see it.** The step writes the stage's tiles, features and feature owners, marks each landmark's
   footprint in `masks.boxes` (repair's keep mask, the ground spots, the region pole) and the footprint grown by the
   core band (2 tiles, the apron) in `masks.near1` (the spawn pool keeps off it; the stylers' `protect`/`no_block`
   covers its unowned tiles; owned tiles are refused by `feature_owner`). A lava stream's or pool's box is a long
   diagonal, so its keep mask is its own tiles and its apron those tiles grown by the core band. Its terrain (the bog,
   the lava and ember, the cave's ice) is the attempt's starting terrain layer.
3. **Randomness.** One stream per zone: `Mulberry32(hash_seed(seed, attempt, zone slot, 5))` (0-2 stylers, 3 recipes,
   4 bushes). The attempt's main stream and every styler stream draw exactly what they drew before.
4. **Plague, the bog tree** (`FeatureKind::BogTree`, job landmark): a 13-tile trunk (wall, squared distance <= 4 from
   the centre tile) with dry ground to squared distance 10, and bog floor in the bands 13-21 and 36-56; the centre stands
   at least 2 tiles beyond the start of the outer third of the Plague zone's radial extent from the map centre, at least
   60 bog tiles survive, with bog in all four quadrants. Trunk and bog stay out of every apron marked before the step
   (`masks.near1`: the legacy buildings grown by one tile, and the volcano's). The site is a uniform draw over every
   legal centre.
5. **Sentenced, the church and graveyard** (`Church`, job landmark; `Graveyard`, job cover). Around the far elite camp
   (the zone's elite camp farthest from the map centre). A rectangular wall ring: each wall line 4-7 tiles from the camp
   tile (the certifier's camp halo reaches 3), or the side leans on the map border when the border is at most 9 away; a
   side whose own wall would leave under 2 tiles to the border must lean on it. So the church may be off-centre. The
   3-tile door is on the side of the dominant axis of the front (DIR16 toward the coliseum), its axis up to 5 tiles off
   the camp's axis. Beyond the door, at least four 2x3 headstones mirrored about the door axis, every stone starting 3
   tiles past the door line; layouts in order: two rows of two wide, two rows of two narrow, one row of four. Choice:
   the first layout, then the door axis nearest the camp, admitting any rectangle; a uniform draw among those
   rectangles. A choice that splits the zone's floor or leaves a wall piece under 6 tiles is redrawn.
6. **Refusal.** A zone with no legal site refuses the attempt in the Landmarks phase (`Refusal::Signature`); the
   pipeline tries the next one. After records, a signature map is discarded (`Refusal::SignatureDiscarded`) unless
   every signature tile is still as placed (the cave: walls, and floor carrying its ice), every entrance tile is still
   floor, no styler feature owns a tile of an apron (styler floor claims do not read
   `no_block`), no landmark's tiles lie in another landmark's apron, the Frost zone's largest ice body outside the cave
   is at the cave's mouth (decision 11), and the strict certifier (every zone) finds zero failures. The landmark-apron
   rule (P-MAPGEN-SIG-FROST-2) is symmetric: for every ordered pair of the five landmarks (the volcano, whose streams
   and pools count as its tiles while its apron is the cone's box grown by the core band; the church with its
   graveyard; the bog tree; the cave; the Holy hall on the Holy anchor's footprint), no tile of one lies in the other's
   boxes grown by the core band. Placement keeps each landmark's walls out of the aprons marked before it, never the
   earlier landmarks out of its own, so only the discard makes the rule independent of the placement order.
7. **Anchors (G3).** `GameMapData.anchors` only, zone-code order, omitted from JSON when empty. They are not on the
   sim's `LayerData` (checkpointed state, whose layout rule forbids skipped fields; serializing them always would move
   every checkpoint and state hash); `MapExport::validate` carries them on `ValidatedMap` for the export, and the
   decoration bake reads them from the generator's map at pool-build time. Fire the volcano (centre the cone's centre,
   footprint the cone's box), Sentenced the church (centre the camp tile, the door as entrance), Plague the tree, Holy
   the largest `Hall` (written when the map is finished: the hall is placed by the Holy styler in step 3), Frost the
   cave (centre the camp tile, footprint the chamber's box, the mouth as entrance). Not in the
   map hash (they restate hashed features). `rh-map/2` does not move: older readers refuse a document with anchors, which exists only inside an
   option-on server.
8. **Bands (G4).** `signature::band(anchor, x, y)`: Chebyshev distance from the footprint, core <= 2, near <= 6,
   mid <= 14, far beyond. The Fire styler uses it for its craters (decision 10), the Frost styler for its mere
   (decision 11); the other stylers and `rh-mapdress` from `P-MAPGEN-SIG-STYLE-1` on.
9. **Server.** `--map-pool --signature-landmarks` sets the generator option and nothing else: the served map is the
   generator's own map, exported. The `rh-server` post-pass (`signature.rs`, which last built the Frost cave as a rock
   arch on 9 of 16 maps) is deleted (P-MAPGEN-SIG-FROST-1).
10. **Fire, the volcano** (`Volcano`, job landmark; `LavaStream` and `LavaPool`, job crossing; certifier rows in
   `SIGNATURE_KINDS`). A cone of wall (squared distance <= 6 from the centre tile: a 5x5 box) round a lava crater
   (squared distance <= 1), its centre at least 2 tiles farther from the map centre than the Fire zone's centroid (the
   back edge). Two or three streams, two lava tiles wide, start beside the cone and run toward the coliseum: headings
   fanned within 67.5 degrees of the front (DIR16 steps -2/+2, -3/+1, -1/+3 for two; -3/0/+3 and neighbours for three),
   15-22 path tiles each for two streams, 9-14 for three. A stream is a line through free ground (Fire floor outside
   the legacy landmark protection, which holds the camp clearings, the camp halos and every apron); where blocked it
   bends one direction step at a time (at most two from its own heading, three from the front) or stops. Each path
   tile is paired with the 4-neighbour across the heading it was entered with, and a neck left at a turn (a tile whose
   run of the stream's lava is 1 along one axis and 3 or more along the other, or a tile in no 2x2 window of 3) is
   filled beside it where free; a stream that cannot be made two tiles wide so is cut a tile shorter
   (P-MAPGEN-SIG-FIRE-2). It ends in a lava pool (squared radius 4, else 2; at least 6 lava tiles with a 2x2 block) touching its last tile, which is
   nearer the coliseum than the volcano centre. Streams and pools keep 3 tiles from each other except beside the cone.
   Ember floor edges every stream and pool, owned by it. A site is used only with at least two streams, total lava
   (crater, streams, pools) within 80-150 tiles (the legacy river held 107-158), and the zone's floor unsplit. Site
   choice: the back-edge centres whose cone fits, in tiers by the cone's distance from every Fire camp (at least 12,
   9, 6 tiles), 24 uniform draws per tier. The Fire styler (`style_scorch`) learns signature mode from the `Volcano`
   feature in its zone (no new styler input): it places no lava river, and a crater (a camp's pen; it cannot move)
   takes its size from its camp's band, fixed before any pen is drawn (P-MAPGEN-SIG-FIRE-2): the band of
   `dc - ceil(R / 4)`, `dc` the camp tile's distance from the footprint and `R` its largest radius option (the radius
   options are R, R - 4, R - 8 quarter tiles, those at least the minimum). Near takes the largest option, mid the
   second (the smallest when there is one), far the smallest; a core camp takes the largest option that keeps every
   tile out of the core band. Legacy's freer-share choice is skipped. A camp whose band's option the route-stretch,
   rim or core checks refuse has no crater. No crater bowl claims floor in a stream's or pool's apron.
11. **Frost, the cave** (`Cave`, job landmark; certifier row in `SIGNATURE_KINDS`: wall, no LOW). Around the far elite
   camp, as the church: a rectangular wall ring whose interior holds the camp's halo, each wall line 4-7 tiles from the
   camp tile or the side leaning on the map border (within 9 tiles; a side whose own wall would leave under 2 tiles to
   the border must lean). Closed except for one 3-tile mouth in the wall facing the coliseum (the dominant axis of the
   front, else the other axis toward the coliseum), its axis up to 5 tiles off the camp's, nearer the coliseum than the
   camp, with 2 tiles of free Frost floor beyond it. A mouth is first sought with a forecourt (a 9x9 square of Frost
   just beyond it, room for the lake), then without. The cave owns its walls and its ice: every interior tile with
   interior floor on all eight sides, off every camp halo and off the map corners the spawn rules keep open; at least 8.
   Choice as the church's: the mouth axis nearest the camp admitting any chamber, one uniform draw among those
   chambers, redrawn while it would split the zone's floor or leave a wall piece under 6. The Frost styler
   (`style_rime`) learns signature mode from the `Cave` feature in its zone (`signature_anchor`; the mouth is the floor
   on the box's edge with floor just outside it): no lake tile in the cave's core band; the first lake (the mere) is
   seeded at the allowed tile within 8 floor steps of the mouth with the most clearance and grown round its seed (value
   falling with chamfer distance, plus the styler's noise), off the route guard's corridor; while a spawn route crosses
   it, it is regrown off the routes (at most 3 times); the second lake grows to at most 75% of the mere's area. Spires
   and headlands keep their placement rules, which already keep them off the cave's apron (`no_block`). The mouth
   faces the lake (P-MAPGEN-SIG-FROST-2, G5): when the finished map's Frost zone holds ice the cave does not own, its
   largest 4-connected body (the first in row order on a size tie) must lie within `lake_reach + lake_slack` (8 + 2 =
   10) walked floor steps of the mouth (any floor, any zone, from the Frost anchor's `entrance`), else the attempt is
   discarded (`Refusal::SignatureDiscarded`) and the next one is tried; the styler is not changed. A Frost zone with no
   ice outside the cave is kept (the styler may place none).

## Measurements (seeds 1-16, `decor: false`, debug test build, macOS arm64)

Option off: one attempt on every seed, 260-370 ms per certified map. Option on: every seed gives a map with one tree,
one church and one graveyard, certified with zero failures; 13 seeds at attempt 0, seeds 9 and 16 at attempt 1, seed 8
at attempt 2; 470-680 ms per map at attempt 0 (the step plus the in-pipeline certification), up to about 1 s at
attempt 2. The refused first attempts of seeds 8, 9 and 16 put the far elite camp in a 9-11 tile strip of the zone along
the map edge, where the door side points into a neighbouring zone or any church would seal the strip from the zone.

With the cave (P-MAPGEN-SIG-FROST-1; four landmarks): seeds 1-32 refuse exactly the attempts they refused with three
(worst attempt index 2, seed 8); the cave itself refuses no attempt. Seeds 1-16 generate in about 12 s in all (about
0.75 s per certified map with its refused attempts). Every cave holds 8-65 ice tiles. On seeds 1-16 and on 30 of seeds
1-32 the zone's largest ice body outside the cave is 3-5 floor steps from the mouth, its nearest tile in the near band;
on seeds 17 and 18 the far camp sits in a 12-14 tile strip of the zone along the edge with another camp within 15
tiles, so no lake fits within reach of the mouth by the styler's clearance rules and the mere grows where it does today.

With the end-of-attempt lake and landmark-apron rules (P-MAPGEN-SIG-FROST-2): on seeds 1-64 the largest ice body
outside the cave was 3 floor steps from the mouth on 61 seeds (seed 25: 5) and 98, 102 and 20 steps on seeds 17, 18
and 34; every cave found its mouth with the forecourt, so the far lakes are not fallback cases. Under the rules seed 17
lands on attempt 1 (was 0), 18 on 3 (was 0; attempt 1 refused `Repair(RadiusPost)`, 2 `Signature`), 34 on 1 (was 0:
far lake, and bog tree and cave in each other's aprons), 46 on 1 (was 0: volcano and cave in each other's aprons) and
49 on 4 (was 0: bog tree and cave; attempts 1-3 refused by the existing rules); every other seed lands on the same
attempt with the same map, each moved seed's lake is 3 steps from the mouth, and no accepted attempt of seeds 1-40
breaches an apron. Worst attempt index: 3 on seeds 1-32 (seed 18), 7 on 1-64 (seed 51, unchanged), against the limit
16. About 0.67 s per certified map on seeds 1-40 with its refused attempts (0.64 s before; seed 17 1.05 s, 18 1.3 s).
The two checks are one flood fill, one bounded walk and one scan of the landmarks' grown boxes per finished map.

## Consequences

- The Holy hall is an anchor only after step 3. Moving it into the Landmarks phase means porting the hall's placement
  out of the Holy styler (`style_sanctum`) into this step, publishing it to the styler (which then builds round it
  instead of placing it), and re-pinning the option-on Holy layouts: a styler packet.
- The Fire and Frost stylers arrange round their anchors; the others wait for `P-MAPGEN-SIG-STYLE-1`.
- On a seed whose far Frost camp sits in a narrow strip of the zone (seeds 17 and 18 of 1-32) there is no room for a
  lake within reach of the mouth; such an attempt is discarded (P-MAPGEN-SIG-FROST-2) and the seed lands on a later
  attempt whose cave has its lake at the mouth, at the cost of one to three extra attempts on those seeds. A seed whose
  every attempt put the lake far would exhaust its attempts; none of seeds 1-64 comes near (worst 7 of 16).
- Landmarks crowding each other's aprons (seen as the bog tree or the volcano against the cave) are discarded, not
  kept apart at placement: the placement rules, and so every kept map, are unchanged. Moving the guard into placement
  would change site choices and every pinned option-on map.
- The Frost spires and headlands are not arranged to flank the approach in the near band: only the core band is
  enforced (the lake's `allow` and the apron discard); spires follow the mere and headlands its shore.
- The Fire craters stay camp pens: size and presence are their only levers, and both now follow the camp's band
  (seeds 1-32: near-band craters 136 tiles on average against 90 far). Density does not yet fall with distance: far
  pens are not thinned (a rule that drops them on purpose meets the count floor of option-off minus two; owner
  question).
- Elite bushes read the stylers' `protect` and stay out of every apron. Repair's walls (the safety net's connectivity
  fill and `wall-far`/`wall-stray`, recorded as `Infill`) keep off the footprint (`masks.boxes`) but not the rest of the
  apron; the intact check allows them there.
