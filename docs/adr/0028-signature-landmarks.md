# ADR0028: Signature landmarks

Status: **Proposed.** Owner beta-follow-up decisions 5 and 6 (MIGRATION, 2026-11-10); owner direction 2026-11-12 (the
generation order and the core rules G1-G8 below). Packets P-SIGNATURE-1, P-SIGNATURE-1-fix (the server post-pass) and
P-MAPGEN-SIGNATURE-CORE-1 (the generator step). The `DEVIATIONS.md` row (DEV-020) is proposed in the hand-off; the owner
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
   `pipeline::Options::signature` (serde default `false`) and the attempt is styled. Not a landmark recipe: the legacy
   stage admits only floor-to-wall writes owned by `FeatureKind::Landmark`, whose certifier rules and `map.buildings`
   records belong to the legacy buildings.
2. **How later steps see it.** The step writes the stage's tiles, features and feature owners, marks each landmark's
   footprint in `masks.boxes` (repair's keep mask, the ground spots, the region pole) and the footprint grown by the
   core band (2 tiles, the apron) in `masks.near1` (the spawn pool keeps off it; the stylers' `protect`/`no_block`
   covers its unowned tiles; owned tiles are refused by `feature_owner`). Its terrain (the bog) is the attempt's
   starting terrain layer.
3. **Randomness.** One stream per zone: `Mulberry32(hash_seed(seed, attempt, zone slot, 5))` (0-2 stylers, 3 recipes,
   4 bushes). The attempt's main stream and every styler stream draw exactly what they drew before.
4. **Plague, the bog tree** (`FeatureKind::BogTree`, job landmark): a 13-tile trunk (wall, squared distance <= 4 from
   the centre tile) with dry ground to squared distance 10, and bog floor in the bands 13-21 and 36-56; the centre stands
   at least 2 tiles beyond the start of the outer third of the Plague zone's radial extent from the map centre, at least
   60 bog tiles survive, with bog in all four quadrants. The site is a uniform draw over every legal centre.
5. **Sentenced, the church and graveyard** (`Church`, job landmark; `Graveyard`, job cover). Around the far elite camp
   (the zone's elite camp farthest from the map centre). A rectangular wall ring: each wall line 4-7 tiles from the camp
   tile (the certifier's camp halo reaches 3), or the side leans on the map border when the border is at most 9 away; a
   side whose own wall would leave under 2 tiles to the border must lean on it. So the church may be off-centre. The
   3-tile door is on the side of the dominant axis of the front (DIR16 toward the coliseum), its axis up to 5 tiles off
   the camp's axis. Beyond the door, at least four 2x3 headstones mirrored about the door axis, every stone starting 3
   tiles past the door line; layouts in order: two rows of two wide, two rows of two narrow, one row of four. Choice:
   the first layout, then the door axis nearest the camp, admitting any rectangle; a uniform draw among those
   rectangles. A choice that splits the zone's floor or leaves a wall piece under 6 tiles is redrawn.
6. **Refusal.** A zone with no legal site refuses the attempt (`Refusal::Signature`); the pipeline tries the next one.
   After records, a signature map is also refused unless every signature tile is still as placed, no styler feature
   owns a tile of an apron (styler floor claims do not read `no_block`), and the strict certifier (every zone) finds zero
   failures.
7. **Anchors (G3).** `GameMapData.anchors` only, zone-code order, omitted from JSON when empty. They are not on the
   sim's `LayerData` (checkpointed state, whose layout rule forbids skipped fields; serializing them always would move
   every checkpoint and state hash); `MapExport::validate` carries them on `ValidatedMap` for the export, and the
   decoration bake reads them from the generator's map at pool-build time. Sentenced the church (centre the camp tile, the door as entrance), Plague the tree, Holy the largest `Hall` (written
   when the map is finished: the hall is placed by the Holy styler in step 3). Not in the map hash (they restate hashed
   features). `rh-map/2` does not move: older readers refuse a document with anchors, which exists only inside an
   option-on server.
8. **Bands (G4).** `signature::band(anchor, x, y)`: Chebyshev distance from the footprint, core <= 2, near <= 6,
   mid <= 14, far beyond. Stylers and `rh-mapdress` use it from `P-MAPGEN-SIG-STYLE-1` on.
9. **Server.** `--map-pool --signature-landmarks` sets the option; the `rh-server` post-pass now builds only the Fire
   volcano and the Frost cave (`P-MAPGEN-SIG-FIRE-1`, `P-MAPGEN-SIG-FROST-1` move them into the generator; then the pass
   is deleted).

## Measurements (seeds 1-16, `decor: false`, debug test build, macOS arm64)

Option off: one attempt on every seed, 260-370 ms per certified map. Option on: every seed gives a map with one tree,
one church and one graveyard, certified with zero failures; 13 seeds at attempt 0, seeds 9 and 16 at attempt 1, seed 8
at attempt 2; 470-680 ms per map at attempt 0 (the step plus the in-pipeline certification), up to about 1 s at
attempt 2. The refused first attempts of seeds 8, 9 and 16 put the far elite camp in a 9-11 tile strip of the zone along
the map edge, where the door side points into a neighbouring zone or any church would seal the strip from the zone.

## Consequences

- The Holy hall is an anchor only after step 3. Moving it into the Landmarks phase means porting the hall's placement
  out of the Holy styler (`style_sanctum`) into this step, publishing it to the styler (which then builds round it
  instead of placing it), and re-pinning the option-on Holy layouts: a styler packet.
- Fire and Frost anchors are absent until their packets. The stylers do not yet arrange bands round the anchors
  (`P-MAPGEN-SIG-STYLE-1`).
- Elite bushes read the stylers' `protect` and stay out of every apron. Repair's walls (the safety net's connectivity
  fill and `wall-far`/`wall-stray`, recorded as `Infill`) keep off the footprint (`masks.boxes`) but not the rest of the
  apron; the intact check allows them there.
