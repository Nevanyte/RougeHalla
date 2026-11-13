# P-LAND-SENTENCED-1: Sentenced's fence rows run square to the church, on one gate grid (revision 2, "lanes")

> **Status (oracle author, 2026-11-13): READY, flagged BUDGET SHORT.** The oracle is written to the lanes rule (owner
> decision 2026-11-13, "Option 1: churchyard plus lanes"). The owner's fence target ("about today's share, within a
> fifth": on/off share ratio in [0.8, 1.2]) cannot be asserted with any margin: on seeds 1-32 the most fence the lane
> lattice can hold is 0.81 of option off's share (median), 0.78 after the detour rule. The budget test's lower bound is
> therefore **0.6** (section 12). The coordinator takes the figure to the owner; the packet can be implemented now.
> Revision 1 (two enclosures round the church, held) is superseded; its measurement is kept in section 12.

- **Serves:** owner decision 2026-11-13 (land generation, Sentenced: "Option 1, churchyard plus lanes"; the churchyard
  fence round the church and graveyard with its 5-wide gate is the church blueprint's, in the coordinator's lane,
  P-MAPGEN-SIG-SCALE-2; this packet lays no enclosure; the outer enclosure is dropped); ADR 0028 rules G1, G3, G5, G7,
  G8; proposed core rule G10 (every thematic obstacle is placed by a rule that reads the landmark). Lane:
  `docs/coordination/LANDMARK_GENERATION_SPEC.md` section 3 (land generation).
- **Implementer tier:** implementer-opus (rh-sim mapgen: the Sentenced styler in signature mode; draw order; plan
  validation)
- **Reviewer:** reviewer-opus
- **Integration base:** feature/unity-rework (`566841f4` or later)
- **D-rules touched:** D1: option off byte-identical (G8); under the option an intentional difference from legacy (row
  to propose in the hand-off: an amendment of DEV-020 or a new row) · D2 n/a · no sim tick, wire or content-hash change

## 1. ID and outcome
Today, with `pipeline::Options::signature` on, the church stands round the far elite camp
(`mapgen/landmarks/signature/church.rs:29` `place`; door `:184-189`, graveyard piece `:204-209`) but the Sentenced
styler (`mapgen/style_gallows/`) still lays legacy fence rows: their axis comes from the zone centroid against the map
centre (`shape.rs:137-142`), their lines from `viterbi_rows` with gaps 7-9 (`shape.rs:191-198`, `rules.rs:26-28`), each
row may jog up to 3 tiles (`rows.rs:150-161`, `Definition::wiggle` 3), and the 3-wide gates every 12 tiles alternate
phase 2/8 by row, counted from the zone's bounding box (`rows.rs:87` `gate_open(s - grid.s_lo, ...)`, `rules.rs:30-32`).
Measured (section 12): the door axis is today's row axis on 15 of 32 seeds, and almost no fence stands on the lanes.

When this lands, in signature mode (the Sentenced zone holds a `Church` feature; nothing else is new input):

1. **Spine.** The door axis: the line through the middle tile of the church's entrance, pointing out of the door. In the
   door frame `along` is the signed distance from the door line (positive out through the door) and `across` the other
   coordinate; `d = across - spine`.
2. **Lane lines.** Every styler fence row runs parallel to the spine and stands only on a line with `|d| mod 8 == 4`
   (d = ±4, ±12, ±20 ...). The lattice is symmetric about the spine, which is an open lane 7 wide. No jogs: a row breaks
   where it is blocked and never leaves its line.
3. **Cross lanes.** One gate grid for every row: a tile with `(along - 8).rem_euclid(12) < 3` (`along mod 12` in {8, 9,
   10}, counted from the entrance's door line, `rem_euclid` behind it) is never fence. The bands are fence-free cross
   lanes; period 12 minus gate 3 leaves runs of at most 9, the certifier's `fence-run`.
4. **Apron.** No styler fence within Chebyshev distance 2 of the yard box (the bounding box of the church's footprint
   and every Sentenced `Graveyard` feature's bbox).
5. **Amount.** The styler's fence share of the zone's free ground (definition below) stays near option off's: median
   on/off ratio over seeds 1-32 in [0.6, 1.2] (owner target [0.8, 1.2]; BUDGET SHORT, section 12), and no seed below
   0.3.
6. **Kept as today.** The gallows square (today's base rows and centroid window, `shape.rs:11-131, 191-203`), the guard
   houses, route repair (`shape.rs:266-291`), detour trimming (`detours.rs:165` `plan_detours`, `:351` `relax_rows`)
   and `min_piece` (`rules.rs:154`, 6). Moving the square onto the spine is P-LAND-SENTENCED-2. `Dials::min_run` (10,
   the shortest legacy stretch, `rows.rs:82`) is the implementer's choice: keeping it costs about 0.05 of the ratio
   (section 12).

**Free ground** (one definition for both maps, computed live by the oracle): a Sentenced tile that is floor (0) or a
`FenceRow` tile, owned by no other feature, outside every camp halo and every spawn pad of the pool (the certifier's
`protected` rule, `certify/mod.rs:160-188`: the halo, and the 3x3 pad `R.spawn_pad` 1, `certify/rules.rs:26`). Share =
`FenceRow` tiles / free ground tiles. The church's future churchyard fence is the church blueprint's, not a `FenceRow`,
and is not counted.

## 2. Dependencies
- None to start. P-MAPGEN-SIG-RESERVE-1 and the SCALE packets (coordinator's lane) will change every option-on map while
  this packet is open: every check is a property measured from the anchor, never a pinned map, hash, attempt or tile.
- P-MAPGEN-SIG-SCALE-2 adds the churchyard fence (church blueprint). This packet's apron and lanes do not depend on it.
- Supersedes the styler half of P-MAPGEN-SIG-SENTENCED-1 (its branch and oracle are left untouched).

## 3. Relevant legacy paths (verified with `rg`)
- `packages/shared/src/zoneStyle/gallows.ts:38-39` (`GATE_PERIOD` 12, `GATE_W` 3), `:73` `gallowsGateOpen`: the rows
  option off keeps laying. Legacy has no church; nothing in legacy lays lanes round one.

## 4. New paths
- `crates/rh-sim/tests/mapgen_land_sentenced.rs` (the oracle, rewritten for revision 2)
- any new file under `crates/rh-sim/src/mapgen/style_gallows/` the signature-mode path needs (e.g. `lanes.rs`)

## 5. Exclusive write scope
- `crates/rh-sim/src/mapgen/style_gallows/**` (the signature-mode path beside the legacy path, and `validate_plan`).
- `crates/rh-sim/tests/content.rs`: exactly one `NON_GAMEPLAY` row for this packet's tunables, verified still the right
  mechanism (`tests/content.rs:26-30` and `:977-1010`: every struct-typed `const` under `src/` must be registered or
  listed, and every listed entry must match a declaration the scan finds). The tunables are a separate `pub const`
  (e.g. `LANES` in `style_gallows/lanes.rs`: spacing 8, offset 4, gate period 12, width 3, phase 8, apron 2), never a
  field of `Definition` or `Dials` (both are folded into the content hash by `style_gallows::visit_content`,
  `rules.rs:176`, called from `content.rs:1488`; `style_gallows/tests.rs:830` `all_definition_and_factory_fields_drive_content`
  requires every field to drive it). The row, by the precedent at `tests/content.rs:46`:
  `("mapgen/style_gallows/lanes.rs", "LANES", "Sentenced lane rules (line spacing and offset, gate period, width and phase, apron) read only when the zone holds a signature Church (pipeline::Options::signature, default off); not folded into content_hash until the owner decides (P-LAND-SENTENCED-1)")`
  (file and name to match what the implementer declares).
- This brief.
- The oracle file is read-only for implementers.
- Shared, **ask in the hand-off before editing**: `mapgen/style_runtime/`, `mapgen/style_zones/`, `mapgen/certify/`,
  `docs/adr/0028-signature-landmarks.md`, `docs/DEVIATIONS.md`.
- Not yours: `mapgen/landmarks/**`, `mapgen/pipeline/`, the coordinator's tests `crates/rh-sim/tests/mapgen_signature_*.rs`,
  and the `rh-mapdress` goldens (section 11: no documented regeneration command exists, so they are not in scope).

## 6. Contracts and references
- ADR 0028 (G1-G8; decisions 2, 5, 6). `docs/coordination/LANDMARK_GENERATION_SPEC.md` section 4.
- `crates/rh-sim/AGENTS.md` (determinism; draws are behaviour).
- Certifier fence rules: `fence-detour` and `fence-run` (`certify/features.rs:371-462`; `R.fence_detour` 10,
  `R.fence_reach` 3, `R.fence_run` 9, `certify/rules.rs:31`), `terrain-protected` (`certify/mod.rs:160` `protected`).
- Runtime placement (`style_runtime/mod.rs:562` `open`: zone mask, `hard`, `no_block`, floor, unreserved, unowned, edge
  distance at least `rim_tiles * 3` = 9 thirds; `:583` `can_block`: footprint limit, ice ring, fence detour 10, low
  support, topology join).

## 7. Behaviour to preserve
- **Option off: byte-identical**, draw for draw. The signature path is taken only when the zone holds a `Church`
  feature, which never exists with the option off. Guards: `mapgen_signature_core.rs:271`
  `g8_signature_off_is_todays_generator`, `mapgen_signature_fire.rs:325` and `mapgen_signature_frost.rs:376`
  `g8_option_off_maps_are_todays`, `mapgen_signature_frost_lake.rs:346` `option_off_maps_are_todays`,
  `style_gallows/tests.rs:645` `captured_callbacks_match_complete_plans_states_and_streams` (the legacy capture), and
  this oracle's `option_off_maps_are_todays`.
- Option on: every seed keeps its church and gallows square; every accepted map certifies with zero failures under the
  strict certifier; no styler feature owns an apron tile (the landmark lane's `SignatureContext::intact`).
- The content hash does not move (section 5).
- Attempts stay bounded: worst attempt index on seeds 1-32 at most 8 (today 3).
- Decor on (`Options::default()` plus `signature`) still makes the map: the props callback validates the plan (section 11).

## 8. Acceptance checks
Oracle `crates/rh-sim/tests/mapgen_land_sentenced.rs`, seeds 1-32, option on with the server's options (no decor);
definitions in its file comment.

| Test | Checks | Today |
|---|---|---|
| `every_lane_fence_tile_stands_on_a_lane_line` | rules 1-2 (`|d| mod 8 == 4`) | FAIL, 32 of 32 seeds ("lane fence off the lane lines: 32 findings") |
| `no_lane_fence_tile_stands_in_a_cross_lane_band` | rule 3 | FAIL, 32 of 32 seeds ("lane fence in a cross-lane band: 32 findings") |
| `no_lane_fence_tile_stands_within_two_of_the_yard_box` | rule 4 | FAIL, 5 seeds (1, 5, 15, 23, 28: "lane fence in the yard box's apron: 5 findings") |
| `lane_fence_share_stays_near_option_off` | rule 5, median in [0.6, 1.2]; the non-triviality guard of the three above | PASS (today 0.92) |
| `every_seed_keeps_its_lanes` | rule 5, every seed at least 0.3 | PASS (today min 0.73) |
| `fence_runs_stay_within_nine_and_pieces_keep_the_minimum` | runs at most 9, pieces at least `min_piece` | PASS |
| `maps_certify_clean_and_keep_the_church_and_the_gallows_square` | section 7 | PASS |
| `the_worst_attempt_over_seeds_1_to_32_is_at_most_eight` | section 7 | PASS (today 3) |
| `option_on_with_decor_keeps_the_lane_fence` | seeds 1-8 with decor: map made at the same attempt, same lane fence | PASS |
| `option_off_maps_are_todays` | G8 (seeds 1-8 map hashes; decor does not move the fence) | PASS |
| `report_lanes_seeds_1_to_32` (`#[ignore]`) | section 12's M1-M5, per seed and summary | report |
| `sheet_dump_seeds_1_to_8` (`#[ignore]`) | the zone as text, option on and off, for tile pictures | report |

The three red tests are the whole change; the green ones guard it. Together, rules 1-4 with the budget mean: rows on
the lattice, cut on one grid, clear of the yard, and about as much fence as a real attempt can hold.

Sheet dump format: one header `SHEET <on|off> seed=<n> attempt=<i> x0=<x> y0=<y> w=<w> h=<h>` (option on adds
`entrance=<x>,<y> facing=<N|E|S|W>`, the middle entrance tile), then `h` lines `SHEET|` + one character per tile of the
zone's bounding box: ` ` outside the zone, `#` wall, `.` floor, `:` floor in a camp halo, `p` floor on a spawn pad (3x3),
`f` `FenceRow` fence, `o` other LOW, `C` a tile owned by the church (its walls: the church's interior floor shows as `.`
or `:`), `g` graveyard, `S` gallows square, `H` guard house, `+` the middle entrance tile. A tile owned by any other
feature shows its ground (`#`, `.`, `o`).

## 9. Validation commands
- `CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 cargo test -p rh-sim --test mapgen_land_sentenced`
- `cargo test -p rh-sim --test mapgen_land_sentenced -- --ignored --nocapture report_lanes_seeds_1_to_32`
- `cargo test -p rh-sim --test mapgen_land_sentenced -- --ignored --nocapture sheet_dump_seeds_1_to_8`
- `cargo test -p rh-sim --lib style_gallows`; `cargo test -p rh-sim --test content`
- the six `mapgen_signature_*` tests and `cargo test -p rh-mapdress` (expected to move, section 11; report the values)
- `scripts/gate.sh --quick`, then `scripts/gate.sh --oracle packet/P-LAND-SENTENCED-1`

## 10. Risk and suggested model tier
Opus. The rows are today's cover between Sentenced camps and part of what the route guard and the certifier measure;
replacing them changes which attempts are accepted. Size estimate within scope: about 200-300 changed lines (door frame
and yard box from the zone's features, the lattice as the row lines of a second grid in the door orientation, straight
paths, the entrance-anchored gate test, the apron, a signature branch of `validate_plan`, the tunables `const`). No cut
proposed.

## 11. Known traps
- **Reaching the church from the styler.** `c.base().zone_features()` (`style_runtime/contexts.rs:34`) as
  `style_rime::signature_anchor` (`style_rime/mod.rs:319-349`) and `style_scorch/mod.rs:373` do. The `Church` feature's
  `bbox` is the wall ring (and the anchor's footprint: `landmarks/signature/mod.rs:381`); `ax, ay` is the camp tile;
  `front` is `landmarks::signature::front(ax, ay)` (`signature/mod.rs:685`, `pub(crate)`); the door side is the
  dominant axis of `DIR16[front]` (`church.rs:42-48`). The entrance is 3 floor tiles in the front wall line
  (`church.rs:184-189`: `tile(r.df, ax + c)` where that `ax` is the chosen door offset, **not** the camp's coordinate):
  re-derive it as the floor tiles on the bbox edge on the door side; the spine is the middle one, the door line is that
  edge. `Graveyard` features come from the same iterator. The finished map's `anchors` are not visible to the styler.
- **Axis and grid.** Today's grid is built along the zone bbox in the centroid orientation (`shape.rs:143-175`) and
  `plan.axis` follows it. The lattice needs the door orientation: on 17 of 32 seeds it differs from today's. Seams:
  axis selection (`shape.rs:137-148`), `viterbi_rows` (`shape.rs:191-198`) replaced by the lattice lines inside the bbox,
  `viterbi_path` with `wiggle` (`rows.rs:150-161`) replaced by a straight path, the gate test (`rows.rs:87`) counted from
  the door line with one phase instead of `row_phase` (`rows.rs:149`), and the apron closed in the grid.
- **The square reads today's base rows.** `square` (`shape.rs:11-131`) chooses its window between two of today's base
  rows in today's orientation, and `flush` skips the window on rows `k` and `k + 1` (`rows.rs:88-92`). Keep today's
  rule: compute today's grid, base rows and square first (it marks its tiles closed, `shape.rs:117-121`, and owns them,
  so `c.open` is false there), then build the lanes grid; never apply `win` to lattice rows (their indices mean other
  rows).
- **`validate_plan` (decor on only).** `props` validates the plan (`mod.rs:172-224`): base-row gaps within
  `[gap_min, gap_max]` = [7, 9], `rows[i].t0 == base_rows[index]`, `rows[i].phase == row_phase(index, [2, 8])`, the
  square's `k + 1 < base_rows.len()`, all against `plan.axis`. A lattice with a skipped line (gap 16), one phase for all
  rows, or a square indexed into today's rows fails with `Error::Feature`, a generator error, only with decor on (the
  oracle's maps are made without decor; `option_on_with_decor_keeps_the_lane_fence` catches it). `props` also reads
  `plan.axis` for the lantern side (`mod.rs:241`).
- **No refusal path for a styler.** `shape` returns `Result<Plan, Error>`; an `Err` is a generator error
  (`pipeline/mod.rs:406`), not a refused attempt. Nothing in this revision needs a refusal.
- **RNG.** The Sentenced `shape` draws nothing today (its only stream use is `props`' `noise_hash`, `mod.rs:228`). The
  lanes path must draw nothing either; the legacy path's calls (including `c.route_guard()` at `shape.rs:154-159`)
  stay in order.
- **Removal only after the plan.** `plan_detours`, `relax_rows`, `open_around` and `give_back` (`detours.rs`) only drop
  tiles, so no tile leaves its line; keep it so (no re-planning that lays a row elsewhere). `Mode::Trim` placement may
  refuse tiles (`shape.rs:226-250`); the holes feed `relax_rows`.
- **Route repair.** With `Route::Repair` (default, `rules.rs:35`) routes are not kept clear up front (only `Route::Open`
  excludes the corridor, `shape.rs:154-159`); repair opens fence near the worst corridor afterwards. Lanes run roughly
  toward the coliseum, like the routes; the oracle does not model repair (section 12).
- **Option off byte-identical**; the content hash does not move (section 5).
- **Tests that pin option-on output and will move** (do not edit; run them and report the new values in the hand-off):
  - `crates/rh-sim/tests/mapgen_signature_frost_lake.rs` (coordinator's): `seeds_with_the_lake_at_the_mouth_keep_their_maps`
    (`unchanged()`, attempt and `map_hash` of 30 seeds), `seeds_17_and_18_land_on_the_next_attempt_with_the_lake_at_the_mouth`
    (`moved()`, attempt and `map_hash`): every option-on map hash moves; `the_worst_attempt_stays_within_the_measured_margin`
    (at most 5) may move. Regenerated by hand from the assertion messages (no command).
  - `crates/rh-mapdress/tests/anchor.rs` `a_signature_map_stripped_of_its_anchors_is_dressed_as_today`
    (`NO_ANCHOR_GOLDEN`, seeds 1-4) and `crates/rh-mapdress/tests/marsh.rs` `every_zone_other_than_plague_is_dressed_as_before`
    (`SIG_GOLDEN`, 4 seeds x 4 zones): the dressing is seeded by the map hash (`tests/common/mod.rs:36`), so every value
    moves. These are hand-measured constants ("measured on the tree before the change"), with no documented
    regeneration command: not in this write scope. The implementer reports the new values; the coordinator updates
    them or widens the scope.
  - Comments naming seeds and attempts: `mapgen_signature_aprons.rs:201-202`, `mapgen_signature_frost_lake.rs`.
- Stylers share one runtime (`mapgen/style_runtime/`): a changed Sentenced result can change the zones styled after it
  and later stages (spawns, crates, repair), hence the moved hashes above.
- `crates/rh-sim/tests/content.rs` scans `src/` only (`:363-406`); a `const` in a test file is not seen by it. The
  oracle uses functions anyway.

## 12. Measurement (oracle author, 2026-11-13, `566841f4`, debug build, macOS arm64)

### Revision 1 (two enclosures; why it was dropped)
Two Chebyshev rings at 5 and 12 from the yard box, gated every 12, could hold at most a fifth of today's fence (ceiling
4% / 20% / 34% of option off's fence, min / median / max), and the 5-wide front spine gate flanked by fence was possible
on one accepted attempt in five (25 of 115; 13 of the 64 maps of seeds 1-64), the flanks falling in other camps' halos
or off the zone. Refusing the rest would have pushed 4-7 of seeds 1-32 past attempt 8. The owner chose the churchyard
(in the church blueprint) plus lanes instead.

### Revision 2 (lanes), `report_lanes_seeds_1_to_32`
Shares are of free ground (section 1). "x off" = a share divided by option off's share on the same seed. Strict ceiling:
fenceable tiles (free ground inside the styler's rim, `edge_dist >= 9`, and off an approximate route band: steepest
descent from each Sentenced spawn to the coliseum, grown by 1) on a lane line, off the bands, more than 2 from the yard
box, in straight runs of at least `min_piece`. Loose ceiling: the same without the route band. Kept: the loose ceiling
laid on the map in place of today's fence, then every tile failing the fence detour (`R.fence_reach` pairs, a walk of
at most `2k + 10`) dropped and pieces under 6 removed, repeated to a fixed point. Model check: every tile of today's
fence is fenceable by this model on every seed (0 exceptions); 12% of today's fence (median, 3-32%) stands on the
route band, so the route band is not a planner constraint and the strict ceiling understates.

Per seed (lattice offset 4, phase 8):

| seed | att | facing | M1 same axis | fence on / off | share on / off (%) | on/off | strict ceiling (x off) | loose ceiling (x off) | kept (x off) | today's fence on route band | M5 sides - / + |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 0 | W | yes | 296 / 324 | 7.04 / 7.59 | 0.93 | 181 (0.57) | 283 (0.89) | 267 (0.84) | 82 | 0 / 283 |
| 2 | 0 | W | yes | 257 / 305 | 6.09 / 7.12 | 0.86 | 220 (0.73) | 290 (0.97) | 281 (0.94) | 20 | 0 / 290 |
| 3 | 0 | E | yes | 305 / 355 | 7.23 / 8.26 | 0.87 | 267 (0.77) | 294 (0.84) | 294 (0.84) | 58 | 32 / 262 |
| 4 | 0 | E | no | 335 / 327 | 7.88 / 7.64 | 1.03 | 196 (0.60) | 271 (0.83) | 235 (0.72) | 13 | 71 / 200 |
| 5 | 0 | W | yes | 288 / 323 | 6.86 / 7.62 | 0.90 | 169 (0.53) | 238 (0.74) | 229 (0.72) | 29 | 0 / 238 |
| 6 | 0 | W | no | 329 / 354 | 7.84 / 8.32 | 0.94 | 229 (0.66) | 308 (0.88) | 291 (0.83) | 33 | 62 / 246 |
| 7 | 0 | W | yes | 306 / 324 | 7.26 / 7.61 | 0.95 | 213 (0.66) | 270 (0.84) | 270 (0.84) | 56 | 0 / 270 |
| 8 | 2 | E | no | 274 / 308 | 6.52 / 7.16 | 0.91 | 212 (0.71) | 260 (0.86) | 247 (0.82) | 35 | 207 / 53 |
| 9 | 2 | W | no | 291 / 298 | 6.93 / 7.03 | 0.99 | 177 (0.60) | 235 (0.80) | 218 (0.74) | 35 | 182 / 53 |
| 10 | 0 | E | no | 313 / 361 | 7.40 / 8.46 | 0.88 | 145 (0.41) | 249 (0.70) | 223 (0.62) | 33 | 196 / 53 |
| 11 | 1 | S | yes | 343 / 363 | 8.16 / 8.53 | 0.96 | 145 (0.40) | 251 (0.70) | 242 (0.68) | 58 | 6 / 245 |
| 12 | 0 | E | no | 264 / 356 | 6.24 / 8.32 | 0.75 | 144 (0.41) | 198 (0.56) | 188 (0.53) | 76 | 41 / 157 |
| 13 | 0 | E | no | 336 / 336 | 7.92 / 7.85 | 1.01 | 77 (0.23) | 222 (0.67) | 222 (0.67) | 54 | 222 / 0 |
| 14 | 0 | E | no | 301 / 329 | 7.17 / 7.79 | 0.92 | 132 (0.40) | 278 (0.85) | 272 (0.83) | 59 | 180 / 98 |
| 15 | 0 | E | yes | 297 / 302 | 7.09 / 7.16 | 0.99 | 233 (0.78) | 297 (0.99) | 281 (0.94) | 94 | 35 / 262 |
| 16 | 1 | E | no | 281 / 338 | 6.67 / 8.00 | 0.83 | 130 (0.39) | 264 (0.78) | 255 (0.76) | 30 | 199 / 65 |
| 17 | 1 | E | yes | 249 / 286 | 5.92 / 6.76 | 0.88 | 212 (0.75) | 239 (0.84) | 231 (0.81) | 18 | 0 / 239 |
| 18 | 3 | N | yes | 252 / 306 | 6.10 / 7.21 | 0.85 | 207 (0.69) | 240 (0.81) | 234 (0.79) | 54 | 40 / 200 |
| 19 | 0 | W | yes | 229 / 316 | 5.45 / 7.43 | 0.73 | 188 (0.60) | 287 (0.92) | 287 (0.92) | 60 | 24 / 263 |
| 20 | 0 | W | no | 257 / 286 | 6.07 / 6.71 | 0.90 | 106 (0.37) | 232 (0.82) | 226 (0.80) | 74 | 199 / 33 |
| 21 | 0 | W | yes | 350 / 332 | 8.33 / 7.76 | 1.07 | 160 (0.49) | 252 (0.77) | 243 (0.74) | 106 | 8 / 244 |
| 22 | 0 | E | no | 335 / 277 | 7.88 / 6.49 | 1.22 | 226 (0.82) | 323 (1.17) | 309 (1.12) | 32 | 77 / 246 |
| 23 | 0 | W | yes | 340 / 418 | 8.11 / 9.79 | 0.83 | 130 (0.32) | 271 (0.66) | 256 (0.62) | 55 | 254 / 17 |
| 24 | 0 | W | no | 306 / 354 | 7.24 / 8.31 | 0.87 | 129 (0.37) | 241 (0.69) | 232 (0.66) | 9 | 150 / 91 |
| 25 | 0 | E | yes | 322 / 366 | 7.62 / 8.57 | 0.89 | 210 (0.58) | 266 (0.73) | 249 (0.69) | 14 | 0 / 266 |
| 26 | 0 | E | no | 264 / 318 | 6.30 / 7.44 | 0.85 | 131 (0.42) | 225 (0.72) | 223 (0.72) | 17 | 180 / 45 |
| 27 | 0 | E | yes | 318 / 339 | 7.57 / 7.95 | 0.95 | 74 (0.22) | 204 (0.61) | 190 (0.57) | 40 | 178 / 26 |
| 28 | 0 | W | no | 310 / 334 | 7.35 / 7.81 | 0.94 | 243 (0.74) | 262 (0.80) | 256 (0.78) | 35 | 228 / 34 |
| 29 | 0 | E | yes | 330 / 329 | 7.80 / 7.78 | 1.00 | 194 (0.59) | 265 (0.81) | 265 (0.81) | 34 | 265 / 0 |
| 30 | 0 | E | no | 314 / 337 | 7.43 / 7.88 | 0.94 | 257 (0.77) | 306 (0.92) | 284 (0.85) | 32 | 263 / 43 |
| 31 | 0 | W | no | 359 / 312 | 8.48 / 7.45 | 1.14 | 162 (0.51) | 263 (0.83) | 245 (0.78) | 27 | 33 / 230 |
| 32 | 1 | W | no | 293 / 336 | 6.98 / 7.87 | 0.89 | 182 (0.55) | 255 (0.77) | 255 (0.77) | 31 | 61 / 194 |

Summary (min / median / max):

| | value |
|---|---|
| M1 door axis = today's row axis (`FenceRow` params[0]) | 15 of 32 seeds |
| M2 strict ceiling, tiles | 74 / 181.5 / 267 |
| M2 strict ceiling, x off share | 0.22 / 0.57 / 0.82 |
| M2 loose ceiling, tiles | 198 / 262.5 / 323 (86% of today's option-on fence, 80% of option-off fence, medians) |
| M2 loose ceiling, x off share | 0.56 / **0.81** / 1.17 |
| M2 kept after detours, x off share | 0.53 / **0.78** / 1.12 |
| M2 with `min_run` 10 kept: loose ceiling / kept, x off share (medians) | 0.75 / 0.73 |
| M4 fence share, option on / option off (%) | 5.45 / 7.24 / 8.48 and 6.49 / 7.77 / 9.79 |
| M4 free ground, option on / option off (tiles) | 4129-4249 / 4190-4303 |
| M4 ratio on/off today | 0.73 / 0.92 / 1.22 |
| M5 sides of the spine, smaller / larger (loose ceiling) | 0.00 / 0.15 / 0.61 |
| attempt index today | 0 / 0 / 3 (refusals before: 4 `Repair(RadiusPost)`, 4 `Signature`, 3 `SignatureDiscarded`) |

M3 (median over seeds; loose ceiling / kept, x off share). Offset 4, phases 0-11: 0.77/0.72, 0.74/0.70, 0.73/0.70,
**0.73/0.67 (phase 3)**, 0.72/0.69, 0.73/0.70, 0.76/0.74, 0.77/0.77, **0.81/0.78 (phase 8)**, 0.83/0.79, 0.81/0.78,
0.80/0.77. Phase 8 against phase 3, per seed (kept): better on 24 seeds, worse on 8, median +0.05 (more than a tenth
on the median ratio: 0.78 against 0.67). Phase 9 is no better than 8 per seed (16 better, 15 worse). Offsets 3-8 at
phase 8: 0.85/0.80, **0.81/0.78 (4)**, 0.82/0.78, 0.80/0.76, 0.72/0.66, 0.79/0.75; offset 3 is better on 19 seeds and
worse on 13 (median +0.03, within the noise) and breaks the even 8-tile spacing across the spine (6), offset 8 puts a
row on the spine. **Chosen: offset 4, phase 8.** The phase gain depends on where today's graveyard ends and is not
expected to survive SCALE-2's church unchanged: re-measure then.

What it implies:
- **BUDGET SHORT.** The loose ceiling just clears 0.8 (median 0.81) and the detour rule alone takes it to 0.78; route
  repair, relaxation and the runtime's placement checks (`can_block`: low support, topology join, footprint) are not
  modelled and only remove. The owner's [0.8, 1.2] cannot be asserted. The budget test asserts [0.6, 1.2], leaving 0.18
  under the kept estimate (0.13 if `min_run` is kept), and every seed at least 0.3 (kept minimum 0.53).
- **Lopsided.** The church stands round the far elite camp, usually near a map edge or a zone side, so the lattice is
  symmetric about the spine but the fence is not: on the median seed one side holds 15% of the other's lane fence, and
  on 8 seeds one side holds none.
- The prompt's M2 definition left routes out; the planner does not (above), so the decision uses the loose ceiling and
  states the strict one.

## Oracle files (read-only for implementers)
- `crates/rh-sim/tests/mapgen_land_sentenced.rs`
- this brief

## Notes from previous attempts
- Revision 1 (commit `2ac5380b6`, two enclosures) was held for the owner and is superseded by this revision.
