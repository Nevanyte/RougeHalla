# ADR0028: Signature landmarks

Status: **Proposed.** Owner beta-follow-up decisions 5 and 6 (MIGRATION, 2026-11-10); owner direction 2026-11-12 (the
generation order and the core rules G1-G8 below). Packets P-SIGNATURE-1, P-SIGNATURE-1-fix (the server post-pass) and
P-MAPGEN-SIGNATURE-CORE-1 (the generator step), P-MAPGEN-SIG-FIRE-1 (the Fire volcano in the generator),
P-MAPGEN-SIG-FIRE-2 (craters sized by band, streams two tiles wide), P-MAPGEN-SIG-FROST-1 (the Frost cave in the
generator; the server post-pass deleted), P-MAPGEN-SIG-RESERVE-1 (each landmark's site reserved in the Prefix before
the camps; decision 12), P-MAPGEN-SIG-SCALE-1 (the Frost cave is the approved blueprint; the site's territory relabel). The `DEVIATIONS.md` row (DEV-020) is proposed in the hand-off; the owner signs. DEV-028
(proposed, unsigned) is the elite rule under the option (decision 12).

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
| G9 | **A landmark is a fixed blueprint** (owner decision 2026-11-12, requirements L1-L6 in `docs/coordination/LAND_GENERATION_REQUIREMENTS.md`): one size and one layout per landmark, all five. Between maps only its place within its site rule, its rotation and its mirror vary. A site that cannot hold the blueprint discards the attempt; a landmark is never served smaller or with fewer parts (the volcano always has three streams). Built for the Frost cave (P-MAPGEN-SIG-SCALE-1, decision 11: `docs/landmarks/blueprints/cave.txt`). Not yet built: decisions 4, 5 and 10 below describe today's variable shapes until P-MAPGEN-SIG-SCALE-2 to -4 and P-MAPGEN-SIG-HOLY-1 land. |
| G10 | **Every thematic obstacle is placed by a rule that reads the landmark** (its anchor, bands and front). No styler lays its obstacles as if the landmark were not there. Built for Fire's craters and Frost's first lake; the rest is the land-generation task (`P-LAND-*`). |

## Decision

1. **Where.** `rh_sim::mapgen::landmarks::signature`, a step inside the Landmarks phase: `pipeline::build_attempt`
   runs it right after the legacy landmark stage and before the spawn preparation, only when
   `pipeline::Options::signature` (serde default `false`) and the attempt is styled. Zones in order Fire, Sentenced,
   Plague, Frost; the volcano and the bog tree keep out of the aprons marked before them, and the end-of-attempt
   discard keeps every landmark out of every other's apron (decision 6). Each landmark's site is reserved earlier, in
   the Prefix before the camps (decision 12); the step builds inside it. All four landmarks are generator-placed; nothing is
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
   4 bushes). The attempt's main stream and every styler stream draw exactly what they drew before. The stream's first
   draws are the Prefix's site choices (decision 12, one per prefix round that reaches the zone); the Landmarks phase
   continues the stream after them (`ReservedSite::stream`), never re-using a draw. With the option on the main stream
   draws what the Prefix's own steps draw (its camps are placed round the sites, so later draws move with them).
4. **Plague, the bog tree** (`FeatureKind::BogTree`, job landmark): a 13-tile trunk (wall, squared distance <= 4 from
   the centre tile) with dry ground to squared distance 10, and bog floor in the bands 13-21 and 36-56; the centre stands
   at least 2 tiles beyond the start of the outer third of the Plague zone's radial extent from the map centre, at least
   60 bog tiles survive, with bog in all four quadrants. Trunk and bog stay out of every apron marked before the step
   (`masks.near1`: the legacy buildings grown by one tile, and the volcano's). The site is a uniform draw over every
   legal centre. With a reserved site (decision 12) the tree stands wholly in the site's inner rect and the site
   carries the outer-third rule: a Plague site lies beyond the outer-third line + 2 where one fits (20 of seeds 1-64 at
   34 tiles, on each seed's accepted attempt), else it is the zone's deepest free square (the other 44), its centre still beyond the zone's centroid (coordinator
   decision 2026-11-12: keep the 34-tile site rather than a smaller one or the outer half).
5. **Sentenced, the church and graveyard** (`Church`, job landmark; `Graveyard`, job cover). Around the far elite camp
   (the zone's elite camp farthest from the map centre; with a reserved site, decision 12, the site's camp, the zone's
   first elite, the church and graveyard wholly inside the site's inner rect). A rectangular wall ring: each wall line 4-7 tiles from the camp
   tile (the certifier's camp halo reaches 3), or the side leans on the map border when the border is at most 9 away; a
   side whose own wall would leave under 2 tiles to the border must lean on it. So the church may be off-centre. The
   3-tile door is on the side of the dominant axis of the front (DIR16 toward the coliseum), its axis up to 5 tiles off
   the camp's axis. Beyond the door, at least four 2x3 headstones mirrored about the door axis, every stone starting 3
   tiles past the door line; layouts in order: two rows of two wide, two rows of two narrow, one row of four. Choice:
   the first layout, then the door axis nearest the camp, admitting any rectangle; a uniform draw among those
   rectangles. A choice that splits the zone's floor or leaves a wall piece under 6 tiles is redrawn.
6. **Refusal.** A zone with no legal site refuses the attempt in the Landmarks phase (`Refusal::Signature`); the
   pipeline tries the next one. A styler that cannot build round a landmark in its zone (a landmark precondition, such
   as the Sentenced church's door not reading as three open tiles in one run; never lack of room) returns
   `style_runtime::Error::Landmark`, and the attempt is refused in the Styler phase (`Refusal::StyleLandmark`, the next
   one tried); any other styler error still fails the call. After records, a signature map is discarded (`Refusal::SignatureDiscarded`) unless
   every signature tile is still as placed (the cave: walls, and floor carrying its ice), every entrance tile is still
   floor, no styler feature owns a tile of an apron (styler floor claims do not read
   `no_block`), no landmark's tiles lie in another landmark's apron, the Frost zone's largest ice body outside the cave
   is at the cave's mouth (decision 11), and the strict certifier (every zone) finds zero failures. The landmark-apron
   rule (P-MAPGEN-SIG-FROST-2) is symmetric: for every ordered pair of the five landmarks (the volcano, whose streams
   and pools count as its tiles while its apron is the cone's box grown by the core band; the church with its
   graveyard; the bog tree; the cave; the Holy hall on the Holy anchor's footprint), no tile of one lies in the other's
   boxes grown by the core band. At placement only the volcano and the bog tree keep out of the aprons marked before
   them (`Site::ground`); the church and the cave read no apron (`Site::wall` only; seed 46's cave stood in the
   volcano's apron), and no landmark keeps the earlier ones out of its own. The end-of-attempt discard is the rule for
   all five, independent of the placement order.
7. **Anchors (G3).** `GameMapData.anchors` only, zone-code order, omitted from JSON when empty. They are not on the
   sim's `LayerData` (checkpointed state, whose layout rule forbids skipped fields; serializing them always would move
   every checkpoint and state hash); `MapExport::validate` carries them on `ValidatedMap` for the export, and the
   decoration bake reads them from the generator's map at pool-build time. Fire the volcano (centre the cone's centre,
   footprint the cone's box), Sentenced the church (centre the camp tile, the door as entrance), Plague the tree, Holy
   the largest `Hall` (written when the map is finished: the hall is placed by the Holy styler in step 3), Frost the
   cave (centre the camp tile, footprint the blueprint's 29 x 29 box, the mouth as entrance). Not in the
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
   choice: the back-edge centres whose cone fits (with a reserved site, decision 12, a cone wholly in the site's inner
   rect; the streams and pools are not confined), in tiers by the cone's distance from every Fire camp (at least 12,
   9, 6 tiles), 24 uniform draws per tier. The Fire styler (`style_scorch`) learns signature mode from the `Volcano`
   feature in its zone (no new styler input): it places no lava river, and a crater (a camp's pen; it cannot move)
   takes its size from its camp's band, fixed before any pen is drawn (P-MAPGEN-SIG-FIRE-2): the band of
   `dc - ceil(R / 4)`, `dc` the camp tile's distance from the footprint and `R` its largest radius option (the radius
   options are R, R - 4, R - 8 quarter tiles, those at least the minimum). Near takes the largest option, mid the
   second (the smallest when there is one), far the smallest; a core camp takes the largest option that keeps every
   tile out of the core band. Legacy's freer-share choice is skipped. A camp whose band's option the route-stretch,
   rim or core checks refuse has no crater. No crater bowl claims floor in a stream's or pool's apron.
11. **Frost, the cave** (`Cave`, job landmark; certifier row in `SIGNATURE_KINDS`: wall, no LOW). The owner-approved
   blueprint (G9; P-MAPGEN-SIG-SCALE-1): `docs/landmarks/blueprints/cave.txt`, 29 x 29 tiles, carried byte-equal in
   the crate as `signature/cave.txt` (`Definition::cave_grid`, `include_str!`; the server image's build context holds
   no `docs/`) and parsed once per context. `#` wall and `R` rock are wall tiles owned by the cave (terrain 0); `=` is
   the cave's ice (floor with the `ice` terrain, owned by the cave: 226 of the drawing's 627 floor tiles, each with
   floor on all eight sides and off the camp's halo); `.`, the camp tile `E` and the 3-tile mouth `D` stay unwritten
   floor. It stands round the Frost site's camp (decision 12: the zone's first elite), the drawing's `E` on the camp
   tile, in one of eight orientations: the mouth faces the dominant axis of DIR16 from the camp toward the coliseum
   (front direction u; unmirrored the drawing's +x goes to (u.y, -u.x)), mirrored or not by the cave's one draw on the
   Frost stream (after the reservation's draw; option on only). The box then lies inside the site's inner rect, its
   offset from the site's corner (2, 3) with the mouth toward +x, (3, 3) toward -x, (3, 2) toward +y, (3, 3) toward
   -y; 3 floor tiles (one row of the inner rect and the apron) lie between the mouth and the site's edge. The attempt is
   refused (`Refusal::Signature`) when a wall or rock tile is not free Frost floor off every halo inside the inner
   rect, any other tile is not free Frost floor inside it, the 2 tiles beyond each mouth tile are not open floor, a wall
   piece is under `piece_min`, or the walls split the zone's floor; the cave is never served smaller. No size search,
   no forecourt (there is one placement). Without a reserved site (a `begin_attempt` prefix, which only tests feed the
   step) the earlier rule-drawn chamber round the far elite camp remains (P-MAPGEN-SIG-FROST-1: a rectangular ring
   4-7 tiles from the camp, one 3-tile mouth toward the coliseum, interior ice, a forecourt preferred). The Frost styler
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
12. **Sites reserved before the camps** (P-MAPGEN-SIG-RESERVE-1; G1: zones, then each zone's landmark place, then
   everything round it). With the option on a styled attempt, the Prefix (`attempt::begin_attempt_signature`) reserves,
   in every round after the partition and before the camps, one square site per zone (Fire, Sentenced, Plague, Frost;
   `AttemptState::reserved`), `site_side` 34 tiles: the SCALE packets' landmark target (30) plus the apron on each
   side. Candidates: the squares wholly of the zone's tiles, off the border, coliseum, road and lanes and off the open
   map corners, whose centre lies beyond the zone's line (Fire, Sentenced, Frost: the centroid's distance + 2; Plague:
   decision 4). One uniform draw on the zone's signature stream; a zone without a square fails the round as a camp
   failure does, and the next round redraws the partition (a zone never loses a camp). The Sentenced and Frost sites
   carry their camp: on the site's centre line along the door axis, `site_depth` 9 tiles from the far edge. A square
   whose camp tile would turn the door axis is refused, a guard only: moving the camp deeper along the axis that already
   dominates cannot turn it, and at these numbers it refuses 0 of the 16,129 square positions on the 160x160 map
   (reviewer's model), so it is not a filter on where sites go. Camp placement (`place_camps_reserving`) then refuses
   every candidate and Lloyd pole whose halo meets a site; a site's camp is placed first in its zone, counts in the
   spacing of the others, keeps its own territory label in every Lloyd step, never moves, and is the zone's first
   elite; the zone's other 9 camps follow the legacy process. The reservation keeps the other camps' halos out of a
   site, not their territories: on an option-on attempt, after the Landmarks phase and before the stylers and repair
   read the territory grid, every tile of the Frost site takes its inside camp's territory label (the camp's index + 1;
   P-MAPGEN-SIG-SCALE-1, coordinator decision 2026-11-13; the Sentenced site joins with its church, SCALE-2). Without
   it the blueprint cave's walls cut neighbouring Frost territories and repair hands the pieces to camps beyond the
   30-tile territory radius (`Repair(RadiusPost)`: 247 refusals and 7 seeds without a map on seeds 1-64). No draw;
   option off has no sites, so nothing is relabelled. **The elite rule (coordinator decision put to the owner, not yet ruled on; DEV-028, proposed):**
   legacy makes the camp farthest from the coliseum the first elite (`packages/shared/src/zones.ts:38-41, 869-879`);
   under the option the Sentenced and Frost first elite is the camp the church or cave stands round, the second the
   legacy rule against it, and the certifier's `elite-selection` reads the Church or Cave anchor's centre (a map
   without one, every option-off map, keeps the legacy rule). Keeping legacy's rule would crowd those zones' camps
   toward the coliseum (spread 27 against 30-32). The legacy landmark recipes treat every site tile as protected
   (`LandmarkStage::protect` itself is unchanged: the signature step reads it). The sites are generator working state
   only: not on `LayerData`, not exported, not hashed. Option off: the Prefix is `begin_attempt`'s, draw for draw.

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

The two paragraphs above measured the rule-drawn cave (8-65 ice tiles, chambers 9-15 tiles a side). With the blueprint
cave and the Frost site's territory relabel (P-MAPGEN-SIG-SCALE-1, decisions 11 and 12; `mapgen_signature_scale`'s
`report_seeds_1_to_64`, debug test build): every seed of 1-64 gives a map; the cave is the 29 x 29 drawing on 64 of
64, its box at the offsets of decision 11, both mirror states and all four front directions occur, and 3 floor tiles
lie between the mouth and the site's edge on every seed. Attempts used: 59 on seeds 1-32 (41 before), worst index 4
(seed 14; 1 before); 132 on seeds 1-64 (101 before), worst index 9 (seed 33; 5 before). Refusals on seeds 1-64: 12
`Prefix`, 8 `Repair(RadiusPost)`, 48 `SignatureDiscarded` (the oracle author's split: 26 for the lake, which the Frost
styler does not yet build at the mouth, 21 for the landmark-intact / styler-apron checks, 1 by the certifier, seed 19
attempt 1, the Frost styler's mere owning a wall tile), 0 `Signature`: the cave refused no attempt. The largest
unowned ice body is 3-9 walked floor steps from the mouth on the accepted maps. The blueprint without the relabel
cost 396 attempts on seeds 1-64 and lost 7 seeds (247 `Repair(RadiusPost)`).

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
  (seeds 1-32: near-band craters 134 tiles on average against 90 far; 136 before P-MAPGEN-SIG-FROST-2 moved seeds
  17 and 18 to later attempts). Density does not yet fall with distance: far
  pens are not thinned (a rule that drops them on purpose meets the count floor of option-off minus two; owner
  question).
- Elite bushes read the stylers' `protect` and stay out of every apron. Repair's walls (the safety net's connectivity
  fill and `wall-far`/`wall-stray`, recorded as `Infill`) keep off the footprint (`masks.boxes`) but not the rest of the
  apron; the intact check allows them there.
