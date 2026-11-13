# P-MAPGEN-SIG-RESERVE-1: each landmark's site is reserved before the camps are placed

- **Serves:** owner direction 2026-11-12 late (MIGRATION): the faction landmarks "a lot larger, maybe just a little
  smaller than the temple"; owner rule G1 (2026-11-12: zones, then each zone's landmark place, then everything else
  arranged round it). Coordinator decision 2026-11-12 on P-MAPGEN-SIG-SCALE-1's measurements: reservation first, the
  SCALE packets follow it at the full target; other camps stay out of the church and the cave.
- **Implementer tier:** implementer-opus (rh-sim mapgen: the Prefix, camp placement, the Landmarks phase, the certifier)
- **Reviewer:** reviewer-opus
- **Integration base:** feature/unity-rework (`c9c87aac`; rh-sim identical to the base of P-MAPGEN-SIG-SCALE-1)
- **D-rules touched:** D1: option off byte-identical (G8) and not one main-stream draw added, removed or reordered; no
  legacy counterpart for the option-on behaviour (DEV-020; the elite rule change below is inside it) · D2 n/a · no
  sim tick or wire change; the map export format and the content hash do not move

## 1. ID and outcome
With `pipeline::Options::signature` on (styled attempts), the Prefix (`attempt::assemble`, after each round's
partition and before `place_camps`) reserves one square site per styled zone, `site_side` = 34 tiles: the landmark's
target footprint (30) plus its apron (2) on each side. Fire, Sentenced and Frost: on the zone's back edge (the site's
centre at least 2 tiles beyond the zone centroid's distance from the map centre); Plague: beyond the outer-third line
+ 2 where a site fits there, else the zone's deepest free site. Holy keeps today's hall rule until
P-MAPGEN-SIG-HOLY-1. Camp placement then keeps every camp's halo out of every site, except that the Sentenced and Frost
zones' first elite camp is placed inside its site, on the site's centre line 9 tiles from its far edge (the edge away
from the coliseum), its halo inside; the zone keeps its 10 camps (that one plus 9 placed by today's Lloyd process round
the reserved sites). The legacy landmark stage keeps out of every site. The Landmarks phase builds each landmark at
today's shapes and sizes inside its site (the SCALE packets then grow them to the target): the church and the cave
round the site's camp, wholly inside the site's inner rect (the site less its apron); the bog tree wholly inside it;
the volcano's cone inside it with today's back-edge rule (its streams and pools leave the site as today). With the
option off nothing changes: byte-identical maps, the prefix equal to `begin_attempt`'s.

## 2. Dependencies
- none merged-wise. P-MAPGEN-SIG-SCALE-1..4 depend on this packet (their briefs are amended on
  `packet/P-MAPGEN-SIG-SCALE-1`). P-MAPGEN-SIG-SENTENCED-1 and -PLAGUE-1 are re-measured after the SCALE packets.

## 3. Relevant legacy paths
- `packages/shared/src/zones.ts:38-41` (`ELITE_MIN_SEP`: the elite camps are the zone's camp farthest from the
  coliseum centre and the next farthest at least 16 tiles from it), `:869-879` (the selection). Mirrored in Rust by
  `zones/camps/mod.rs:436-454` and checked by the certifier's `elite-selection` rule (`certify/mod.rs:791-828`).
  **This packet changes that rule under the option** (owner decision 1 below): legacy behaviour is untouched with the
  option off.
- Rust: `attempt/mod.rs:110-199` (`begin_attempt`, `assemble`: pillar variant, faction order, then per round
  `partition_zones` and `place_camps`, all on the attempt's main stream); `zones/camps/mod.rs:263-467` (`place_camps`:
  per zone `first_candidate`, Lloyd steps with `PoleSearch`, the elites); `landmarks/stage/mod.rs:105`
  (`landmark_protect`: what the legacy landmark recipes keep out of); `landmarks/signature/{mod.rs,volcano.rs,
  church.rs,bog_tree.rs,cave.rs}` (site rules, `Site::floor`); `pipeline/mod.rs:293-297` (`begin_attempt`);
  `repair/mod.rs:355-485, 851-858` (territories; `Refusal::RadiusPost`).

## 4. New paths
- none in `src` (the stub added `ReservedSite`, `AttemptState::reserved`, `attempt::begin_attempt_signature`).

## 5. Exclusive write scope
- `crates/rh-sim/src/mapgen/attempt/mod.rs` (stub: `AttemptState::reserved`, `begin_attempt_signature`; `assemble`)
- `crates/rh-sim/src/mapgen/zones/camps/mod.rs` (placement round the sites; `place_camps` itself stays as it is for
  the option-off path) and `zones/camps/README.md`
- `crates/rh-sim/src/mapgen/landmarks/signature/{mod.rs,volcano.rs,church.rs,bog_tree.rs,cave.rs}` (stub:
  `ReservedSite`; the site choice; each landmark inside its site)
- `crates/rh-sim/src/mapgen/landmarks/stage/mod.rs` (the legacy recipes keep out of the sites; `LandmarkStage::protect`
  stays today's camp protection, which the signature step reads)
- `crates/rh-sim/src/mapgen/pipeline/mod.rs` (the styled pipeline calls `begin_attempt_signature`)
- `crates/rh-sim/src/mapgen/certify/mod.rs` (`elite-selection` with anchors: decision 1)
- `docs/adr/0028-signature-landmarks.md` (decisions 1, 3, 4, 5, 10, 11 and a new decision for the reservation)

## 6. Contracts and references
- ADR 0028 G1-G8; C-PARITY (option off byte-identical); C-RNG and the `rh-sim` determinism rules (draws only from the
  zones' signature streams; ordered iteration; no wall clock).

## 7. Behaviour to preserve
- Option off: byte-identical maps (the `g8`/`option_off` guards in five files) and `begin_attempt_signature(.., false)
  == begin_attempt(..)` (the new oracle's guard). `place_camps` with no reservation must draw exactly what it draws
  today: keep it as the option-off path and add the reserving path beside it.
- **Draws.** The main stream draws, under the option, only what the prefix's own steps draw (the reservation draws
  nothing from it). The reservation's choice among candidate squares is the first draw of the zone's signature stream
  `hash_seed(seed, attempt, zone slot, 5)` (one draw per zone and per prefix round that reaches it); the Landmarks
  phase continues that stream after the reservation's draws (re-create it and skip them, or carry its state in the
  frame), never re-using them.
- Option on: every zone keeps its landmark; every map certifies clean; the lake and apron rules hold; camps per zone
  stay 10; the elite camps per zone stay 2.

## 8. Acceptance checks
- `cargo test -p rh-sim --features trusted-status-probes --test mapgen_signature_reserve` green (4 tests red today),
  and every other `mapgen_signature_*` target green (amended ones included).
- `scripts/gate.sh --quick --oracle packet/P-MAPGEN-SIG-RESERVE-1` passes (the coordinator runs the full gate).

## Oracle files (read-only for implementers)
- `crates/rh-sim/tests/mapgen_signature_reserve.rs` (new)
- `crates/rh-sim/tests/mapgen_signature_core.rs`, `mapgen_signature_fire.rs`, `mapgen_signature_frost.rs`,
  `mapgen_signature_frost_lake.rs` (amended; see "Existing oracles changed")
- `docs/backlog/packets/P-MAPGEN-SIG-RESERVE-1.md`
- The stub commit's files (`attempt/mod.rs`, `landmarks/signature/mod.rs`) are the implementer's.

## Owner decisions (the coordinator should put these to the owner)

1. **The elite rule under the option (required).** Legacy (and the certifier) make the zone's first elite the camp
   farthest from the coliseum centre (`packages/shared/src/zones.ts:869-879`). A camp drawn inside a reserved site is
   that camp only if every other camp of the zone is kept nearer the centre. Measured (table B, "elite rule kept"):
   that crowds the Sentenced and Frost camps toward the coliseum (mean spread 27.0 against 30.4-32.0 today, mean
   nearest-neighbour 16.9-17.6 against 20.3), gives the inside camp a territory over the zone's whole far rim
   (`Repair(RadiusPost)` 58-67 against 18 today) and doubles the attempts (worst index 10-14). Proposed: under the
   option the Sentenced and Frost first elite is the camp the church or cave stands round (the zone anchor's centre),
   the second elite as today (the farthest camp at least 16 from it); the certifier's `elite-selection` reads the
   anchor (option off there are no anchors: the legacy rule, unchanged). A deviation inside DEV-020; the owner signs.
2. **Plague's site.** A 34-tile site beyond the outer-third line fits on 24 of 64 seeds; elsewhere the zone's deepest
   free square is used (its centre still beyond the zone's centroid). Accept, or give Plague a smaller site (28: 43 of
   64), or relax the outer third to the outer half.

## The rule (what to build)

1. **Sites.** Per styled zone (Fire, Sentenced, Plague, Frost, in that order, the order of `AttemptState::reserved`):
   the candidate squares are the `site_side` x `site_side` squares of the zone's tiles, off the border, coliseum, road
   and lanes (`SignatureContext::hard`) and off the open map corners (`spawns::DEFAULT_DEFINITION.corner_open`),
   whose centre is beyond the zone's line (Fire, Sentenced, Frost: the zone centroid's distance + 2, the
   `back_slack`; Plague: the outer-third line + 2, the `outer_slack`). One uniform draw among them (the first draw of
   the zone's signature stream). No candidate: the deepest free square (largest centre distance, first in row order).
   No free square at all: the prefix round fails (as a camp failure: the next round redraws the partition; the main
   stream draws only what that round's own steps draw). New `Definition` fields (no new `const`): `site_side` 34 and
   the camp's depth 9.
2. **The inside camp (Sentenced, Frost).** On the site's centre line along the dominant axis from the site's centre to
   the coliseum centre, 9 tiles from the far edge (so its halo, 4, and the church's or cave's back wall line, 4-7 from
   it today, stay inside the site's inner rect). It is placed first in its zone, counts in the spacing of every later
   camp (`placed`), seeds its own territory label in every Lloyd step, never moves, and is the zone's first elite.
3. **The other camps.** Today's process (9 camps in a zone with an inside camp, 10 elsewhere) with every candidate and
   pole whose halo meets any site refused (the `halo_ok` mask with the sites removed). The second elite: today's rule
   against the first.
4. **Legacy buildings.** The legacy landmark recipes treat every site tile as protected.
5. **Landmarks inside.** `Site::floor` (and with it `wall`, `ground`) is confined to the zone's site inner rect for the
   church, the cave and the tree; the cave and church pick the elite camp inside the site; the tree drops the
   outer-third test (the site carries it); the volcano's cone stands in the inner rect and keeps its back-edge test
   (its streams and pools are not confined).
6. **The certifier** (decision 1).
7. **Not in this packet:** the territory rule of P-MAPGEN-SIG-SCALE-1's prototype. With sites reserved and decision 1,
   `Repair(RadiusPost)` falls to 7 on seeds 1-64 (today 18) at today's landmark sizes; whether the full-size church
   and cave walls inside a site cut territories again is measured in SCALE-1, which keeps that rule as its fallback.

## Measurements (seeds 1-64, option on, first accepted attempt; release-built throwaway probe on macOS arm64; the
prototype is reverted)

The prototype: the rule above with uniform site draws, the inside camp at depth 9, decision 1 in the certifier. Its
variants: "elite rule kept" (the certifier unchanged; the inside camp's site chosen as deep as possible and every other
camp kept nearer the centre than it, the only way to satisfy legacy's rule).

### A. Site availability (how many of 64 seeds take a site of each size on the zone's rule)

| site side (landmark after apron) | Fire (back edge) | Sentenced (back edge) | Plague (outer third; else deepest) | Frost (back edge) |
|---|---|---|---|---|
| 28 (24) | 64 | 64 | 43 (21 deepest) | 64 |
| 30 (26) | 64 | 64 | 35 (29) | 64 |
| 32 (28) | 64 | 64 | 27 (37) | 64 |
| 34 (30) | 64 | 64 | 24 (40) | 64 |
| 36 (32) | 64 | 64 | 13 (51) | 64 |

No seed lost a map at any size; a prefix round without room (`Refusal::Prefix` when every round fails) is in table B.

### B. End to end

| run | no map | attempts | worst (1-32 / 1-64) | Prefix / RadiusPost / no-site / discarded / other | camp NN mean Fi/Se/Pl/Fr/Ho | camp NN min | camp spread mean Se (min) / Fr (min) | spawn to nearest camp mean / min | s per seed |
|---|---|---|---|---|---|---|---|---|---|
| today (no reservation) | 0 | 104 | 3 / 7 | 0 / 18 / 12 / 10 / 0 | 20.5/20.4/20.4/20.3/20.3 | 9.8 | 32.0 (27.2) / 30.4 (27.2) | 9.4 / 7.0 | 0.07 |
| site 30, elite rule kept | 0 | 216 | 12 / 14 | 39 / 67 / 4 / 42 / 0 | 19.1/17.5/19.4/17.6/20.4 | 9.0 | 27.0 (23.3) / 27.2 (24.5) | 9.6 / 7.0 | 0.17 |
| site 34, elite rule kept | 1 | 234 | 10 / 10 | 97 / 58 / 0 / 16 / 0 | 18.7/16.9/18.7/17.1/20.4 | 9.0 | 27.0 (23.8) / 27.4 (23.9) | 9.9 / 7.0 | 0.19 |
| site 28 | 0 | 120 | 4 / 6 | 6 / 5 / 2 / 43 / 0 | 19.3/19.7/19.8/19.9/20.3 | 9.0 | 31.3 (25.5) / 31.6 (25.4) | 9.6 / 7.0 | 0.13 |
| site 30 | 0 | 113 | 4 / 4 | 6 / 11 / 4 / 28 / 0 | 19.2/19.6/19.3/19.8/20.3 | 9.0 | 30.2 (22.4) / 31.0 (25.2) | 9.7 / 7.0 | 0.12 |
| site 32 | 0 | 122 | 4 / 12 | 17 / 14 / 0 / 27 / 0 | 18.7/19.5/19.2/19.5/20.2 | 9.0 | 31.4 (25.1) / 31.1 (24.8) | 9.9 / 7.0 | 0.14 |
| site 34 | 0 | 115 | 4 / 4 | 15 / 7 / 0 / 29 / 0 | 18.6/19.6/18.7/19.3/20.3 | 9.0 | 31.6 (27.0) / 30.7 (25.9) | 10.0 / 7.0 | 0.13 |
| site 36 | 0 | 122 | 3 / 5 | 25 / 10 / 0 / 23 / 0 | 17.9/19.0/18.1/18.8/20.1 | 9.0 | 31.7 (23.1) / 31.0 (25.8) | 10.4 / 7.0 | 0.13 |
| **site 34, chosen** (volcano keeps its back-edge test) | 0 | 113 | 4 / 4 | 14 / 7 / 1 / 27 / 0 | 18.7/19.6/18.7/19.3/20.3 | 9.0 | 31.6 (24.4) / 30.9 (25.9) | 10.0 / 7.0 | 0.10 |

Seeds 1-32 of the chosen run: 54 attempts (today 43), worst index 4 (today 3), pooled camp nearest-neighbour means
18.6-20.4 (today 20.3-20.5), spread means 30.4-34.5 (today 30.4-32.8). Columns: "camp NN" the distance from each camp
to the nearest camp of its zone (tiles); "spread" the root mean square distance of a zone's camps from their mean
point (one value per map; mean over maps, smallest in brackets); "s per seed" the probe's release-build wall time per
seed with its refused attempts (the probe also rebuilds each landed prefix; today's is 0.07 on the same probe).

Reading B:
- **Camps per zone:** 10 in every zone on every accepted map (a squeezed zone never loses a camp; when its 9 other
  camps cannot be placed round the sites the round fails and the partition is redrawn: the `Prefix` column, 14 rounds
  that failed all their tries over 64 seeds, each costing one attempt).
- **Fairness:** with decision 1 the camps keep their spacing (nearest-neighbour means 1-2 tiles closer, spreads equal
  or wider than today; no zone crowds into a strip). Without it (elite rule kept) the Sentenced and Frost camps crowd
  toward the centre (spread 27).
- **Far elite position:** inside its site by construction, on the centre line 9 tiles from the far edge, in the far
  half (the oracle checks the far half and that the church or cave stands round it); church and cave footprints inside
  their sites on every seed.
- **Certifier:** zero failures on every accepted map (spawn-walk ratio and route checks included); no attempt was
  refused for the spawn-walk ratio in the chosen run.
- **Refusals by reason** (chosen run): 14 `Prefix`, 7 `Repair(RadiusPost)`, 1 `Signature` (a volcano with no
  back-edge cone site inside its site), 27 `SignatureDiscarded` (the lake and styler-apron rules, as today).
- **Territory (`Repair(RadiusPost)`):** 7, below today's 18: reserving does not create the problem at today's sizes;
  keeping legacy's elite rule does (58-67), because the inside camp then inherits the zone's far rim.

### Numbers for the SCALE packets
**Landmark target side 30, floor 28.** The site (34) is the target plus the apron and is reserved on every seed, so
every landmark can take its target; the floor (28) leaves room for a shape that cannot fill the square (the church's
door and graveyard, a cave mouth's forecourt, the bog rings round halos at the site's edge). "A little smaller than the
temple" (38-39): 30 is the largest site whose costs stay at today's level (table B: 36 adds 10 failed prefix rounds and
a camp-spacing loss for 2 tiles more).

## Existing oracles changed (in the oracle commit)

- `mapgen_signature_frost_lake.rs`: the same amendment as on `packet/P-MAPGEN-SIG-SCALE-1` (byte-identical file):
  the option-on (attempt, map hash) pins of seeds 1-32 (`unchanged()`, `moved()`,
  `seeds_with_the_lake_at_the_mouth_keep_their_maps`, `seeds_17_and_18_land_on_the_next_attempt_with_the_lake_at_the_mouth`)
  replaced by `certified_styled_serves_the_first_attempt_that_meets_the_rule`; `worst_attempt_allowed` 5 to 8.
  Moving camps moves every option-on map.
- `mapgen_signature_core.rs`: `far_elite` (used by `shape_church_encloses_the_far_elite_camp_with_a_door_to_the_front`)
  is the Sentenced elite camp at the Sentenced anchor's centre (was: the elite farthest from the map centre; under
  decision 1 the church's camp need not be the farthest). `shape_bog_tree_stands_in_the_outer_third_ringed_by_bog`: where
  the attempt's prefix reserves a Plague site the tree's centre must lie in it (was: beyond the outer-third line, which a
  34-tile site cannot keep on 40 of 64 seeds); without a site, the old rule.
- `mapgen_signature_frost.rs`: `far_elite` (used by the cave tests) is the Frost elite camp at the Frost anchor's
  centre, same reason.
- `mapgen_signature_fire.rs`: `note2_refusals_tell_no_site_from_a_discarded_map` requires only discards among seeds
  6-10, attempts 0-3 (was: both kinds); site refusals become rare (1 in seeds 1-64) once sites are reserved; any that
  occurs is still checked to stop at `Prefix`.
- Unchanged and passing under the prototype: `mapgen_signature_fire_bands.rs` (the per-camp crater statistics: near-band
  craters still 15 % larger than far-band ones, the count floor holds), the other Fire tests, `mapgen_signature_aprons.rs`.
  `mapgen_signature_sentenced` is not merged (P-MAPGEN-SIG-SENTENCED-1 is re-measured after SCALE-2).

## The oracle (`crates/rh-sim/tests/mapgen_signature_reserve.rs`, seeds 1-32, first accepted attempt)

Red today (fail on the assertion that the four sites are there):
- `every_styled_zone_reserves_a_site_on_its_rule` (side >= 34, wholly in the zone, back edge or beyond the centroid,
  a camp for the church and cave only);
- `no_camp_halo_touches_a_site_but_its_own_camp`;
- `the_church_and_cave_camp_is_an_elite_in_the_far_half_of_its_site` (a map camp, elite, far half, the anchor's centre);
- `each_landmark_footprint_lies_inside_its_site` (inside the site's inner rect).

Guards (green today and under the prototype):
- `the_map_is_built_on_the_reserving_prefix` (the map's camps are the prefix's);
- `camps_per_zone_keep_todays_count_and_spread` (10 a zone; pooled nearest-neighbour mean >= 17, spread mean >= 29,
  no pair closer than the camp gap);
- `every_zone_keeps_its_landmark_and_every_map_certifies_clean`;
- `the_lake_and_apron_rules_hold`;
- `option_off_is_todays_generator` (seeds 1-8 byte-identical; the flag-off prefix equals `begin_attempt`'s, seeds 1-8,
  attempts 0-2, with no site);
- `the_worst_attempt_stays_within_the_bound` (<= 7; prototype 4, today 3);
- `the_attempts_used_stay_within_the_bound` (<= 70; prototype 54, today 43).
Every test of this file and every amended test passed under the prototype (release build).

Not proved: that the site draw is uniform among the candidates, or the depth of the inside camp (only the far half);
the Plague rule beyond "at least the centroid" (the outer third where it fits: the report shows the sites); seeds beyond
32 (the ignored report covers 1-64); that a map export or the client reads anything new (nothing new is exported: the
sites live in the prefix only); full-size landmarks (the SCALE packets).

## 9. Validation commands
- `cargo test -p rh-sim --features trusted-status-probes --test mapgen_signature_reserve`
- `cargo test -p rh-sim --features trusted-status-probes --test mapgen_signature_core --test mapgen_signature_fire --test mapgen_signature_fire_bands --test mapgen_signature_frost --test mapgen_signature_frost_lake --test mapgen_signature_aprons`
- `cargo test -p rh-sim --features trusted-status-probes --test mapgen_signature_reserve -- --ignored --nocapture report_seeds_1_to_64`
- `scripts/gate.sh --quick --oracle packet/P-MAPGEN-SIG-RESERVE-1`

## 10. Risk and suggested model tier
Opus: the Prefix is the root of every map; the option-off path must stay draw for draw identical (keep `place_camps`
untouched and add the reserving path beside it); the camp process's labels and `placed` order carry the inside camp; the
certifier change is a legacy rule changed under the option.

## 11. Known traps
- The partition is redrawn per prefix round: reserve per round, after `partition_zones`.
- `PoleSearch` and the candidate filter both read the halo mask: both need the sites removed, or Lloyd moves a camp
  into a site.
- The inside camp's territory label must be seeded in every Lloyd step (it never moves), or its site becomes another
  camp's territory.
- `LandmarkStage::protect` is read by the signature step (`Site::ground`): marking the sites there for the legacy
  recipes would refuse every bog tree and volcano; keep the sites in the recipes' protection only.
- Anchors live on `GameMapData.anchors`, never on `LayerData`; the sites are not exported (nothing reads them after the
  Landmarks phase; `AttemptState::reserved` is the only record).

## Notes from previous attempts
