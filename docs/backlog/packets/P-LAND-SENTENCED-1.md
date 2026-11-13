# P-LAND-SENTENCED-1: Sentenced's fences are two enclosures round the church, with gates that line up

> **Status (oracle author, 2026-11-13): HELD for the owner.** The oracle is written to the rules below, unweakened. The
> measurement (section 12) shows that item 7 (the front spine gate of each enclosure flanked by fence) can be built on
> about one accepted attempt in five today (25 of 115 accepted attempts; 13 of the 64 maps seeds 1-64 certify on),
> because the flanks fall in other camps' halos or outside the zone, which the styler cannot move (G1). Refusing the
> other attempts cannot plausibly keep the worst attempt index on seeds 1-32 at 8 (expected about 4-7 seeds over 8 and
> 1-2 seeds with no map in the 16-attempt limit). Separately, two enclosures can carry at most about a fifth of
> today's fence (median 20%, range 4-34%), not "about today's share". Both are owner questions; see section 12.
> Do not dispatch an implementer until the owner has answered.

- **Serves:** owner direction 2026-11-12 (land-generation requirements, `docs/coordination/LAND_GENERATION_REQUIREMENTS.md`
  section 3, Sentenced: that file is not in the tree at `566841f4`; the rules here come from the coordinator's prompt;
  proposed core rule G10: every thematic obstacle is placed by a rule that reads the landmark);
  ADR 0028 rules G1, G3, G5, G7, G8. Lane: `docs/coordination/LANDMARK_GENERATION_SPEC.md` section 3 (land generation).
- **Implementer tier:** implementer-opus (rh-sim mapgen: the Sentenced styler in signature mode; draw order)
- **Reviewer:** reviewer-opus
- **Integration base:** feature/unity-rework (`566841f4` or later)
- **D-rules touched:** D1: option off byte-identical (G8); under the option an intentional difference from legacy
  (row to propose in the hand-off: an amendment of DEV-020 or a new row) · D2 n/a · no sim tick or wire change

## 1. ID and outcome
Today, with `pipeline::Options::signature` on, the church stands round the far elite camp
(`mapgen/landmarks/signature/church.rs:29` `place`; the graveyard piece `:204-209`) but the Sentenced styler
(`mapgen/style_gallows/`: `shape.rs:133` `shape`, `rows.rs:136` `row_plans`, `detours.rs`) still lays legacy fence
rows: parallel lanes across the zone's long axis (`shape.rs:137-142`, from the zone centroid), a 3-wide gate every 12
tiles (`rules.rs:24` `default_dials`: `period: 12`, `width: 3`), as if the church were not there. Measured (section
12): on seeds 1-32 almost none of today's fence lies on the enclosure lines.

When this lands, in signature mode (the Sentenced zone holds a `Church` feature; the styler finds it with
`BaseContext::zone_features()` (`style_runtime/contexts.rs:34`), the way `style_scorch/mod.rs:373` and
`style_rime/mod.rs:319` `signature_anchor` do, with no new styler input; the `Graveyard` feature is found the same
way):

1. **The yard box** is the bounding box of the church anchor's footprint together with every `Graveyard` feature in
   the zone. (When the coordinator's SCALE-2 puts the graveyard inside the landmark's footprint the two are the same
   box and nothing here changes.)
2. **Two enclosures.** The inner line is the ring of tiles at Chebyshev distance exactly 5 from the yard box, the
   outer line at exactly 12. Every fence tile of the Sentenced zone (LOW with the fence terrain, `FenceRow`-owned) lies
   on one of the two lines. No other fence.
3. **The spine** is the door axis: the line through the middle tile of the anchor's `entrance`, pointing out of the
   door (the dominant axis of `DIR16[front]`, as `church.rs:42-48` builds the door).
4. **Gates.** On the sides that cross the spine (front and back), gates are centred at offsets 0, ±12, ±24 … across
   from the spine. On the sides that run along the spine, gates are centred at offsets 0, ±12, ±24 … along from the
   middle of the yard box, `(a0 + a1).div_euclid(2)` in the door frame (when the box's length along the spine is even,
   the middle tile toward the church; this rounding is the oracle author's choice, the owner named no rounding). Both
   enclosures use the same origins, so their gates line up into straight lanes. A gate is 3 tiles of floor; the gate
   on the spine in each front side is 5 (the back side's spine gate is 3). A gate with a tile on a corner or next to
   one is not cut (corners are closed).
5. **Runs and pieces.** No straight run of fence (along x or along y) is longer than 9 tiles: this is already the
   certifier's `fence-run` rule (`certify/features.rs:437-460`, `R.fence_run` 9, `certify/rules.rs:31`); a corner tile
   counts in both of its runs. No fence piece (8-connected) is smaller than the styler's existing `min_piece`
   (`style_gallows::Definition::min_piece`, `rules.rs:122`, default 6 at `:154`; the same 6 as the certifier's
   `R.piece_min`, `certify/rules.rs:24`). `Dials::min_run` (10) is a different number (the shortest legacy row).
6. **Keep-clear outranks theme (G5).** A line tile is left open where it is not the zone's free floor: a camp
   clearing or halo, a spawn corridor or route the guard protects, an apron, another feature's tile, a wall, the
   zone's edge. The fence breaks there; nothing is moved to make room for it.
7. **The enclosure exists.** On every accepted map the spine gate of each enclosure's front side has fence on both
   sides of it (the line tile just beyond each end of the 5-tile gate is fence). An attempt where that cannot be built
   is refused, not served without it. **See section 12 and Known traps: a styler has no refusal path today.**

Out of this packet (follow-ups, briefs to be written from this packet's measurements): P-LAND-SENTENCED-2 (the
gallows square on the spine beyond the outer gate; guard houses relative to the inner enclosure),
P-LAND-SENTENCED-3 (a lantern post at each gate; fence props). In this packet the gallows square and the guard houses
keep today's rules and the fence breaks round them like any other feature. Today's gallows square is placed between
two of the legacy base rows (`shape.rs:191-203`, `square` `:11-131`, the window nearest the zone centroid); with no
rows in signature mode, "today's rules" means: compute the base rows and the square exactly as today, then lay no row
fence. The square is placed before any fence (`shape.rs:203`), so it may stand on a line.

## 2. Dependencies
- None to start. P-MAPGEN-SIG-RESERVE-1 and the SCALE packets (coordinator's lane) will change every option-on map
  while this packet is open: every check here is a property measured from the anchor, never a pinned map, hash,
  attempt number or tile position.
- Supersedes the styler half of P-MAPGEN-SIG-SENTENCED-1 (its branch and oracle are left untouched).
- **Owner answers needed first** (section 12): item 7 against the attempt bound, and the fence share.

## 3. Relevant legacy paths (verified with `rg`)
- `packages/shared/src/zoneStyle/gallows.ts:38-39` (`GATE_PERIOD` 12, `GATE_W` 3), `:73` `gallowsGateOpen`: the fence
  rows option off must keep laying. Nothing in legacy places fence round a church: there is none.

## 4. New paths
- `crates/rh-sim/tests/mapgen_land_sentenced.rs` (the oracle)
- any new file under `crates/rh-sim/src/mapgen/style_gallows/` the signature-mode path needs

## 5. Exclusive write scope
- `crates/rh-sim/src/mapgen/style_gallows/**` (the signature-mode path, beside the legacy path)
- `crates/rh-sim/tests/content.rs`: only one `NON_GAMEPLAY` row registering this packet's own tunables definition
  (as `signature::DEFAULT_DEFINITION` is at `tests/content.rs:46`)
- Shared, **ask in the hand-off before editing**: `mapgen/style_runtime/`, `mapgen/style_zones/`, `mapgen/certify/`,
  `docs/adr/0028-signature-landmarks.md`, `docs/DEVIATIONS.md`.
- Not yours: `mapgen/landmarks/**`, `mapgen/pipeline/`, the coordinator's tests
  `crates/rh-sim/tests/mapgen_signature_*.rs`.
- **Item 7 cannot be done inside this scope** (Known traps): the refusal needs either a predicate in
  `SignatureContext::intact` (`landmarks/signature/mod.rs:411`, coordinator's lane) or a refusal path through
  `style_zones`/`pipeline`. The coordinator decides which, and widens the scope or makes that edit.

## 6. Contracts and references
- ADR 0028 (G1 to G8; decisions 2, 5 and 6: masks, the church, the end-of-attempt discard).
- `docs/coordination/LANDMARK_GENERATION_SPEC.md` section 4 ("What must hold").
- `crates/rh-sim/AGENTS.md` (determinism; draws are behaviour).
- The certifier's fence rules: `fence-detour` and `fence-run` (`certify/features.rs:371-462`), `terrain-protected`
  (no fence terrain in a camp clearing or halo, `certify/mod.rs:160` `protected`).

## 7. Behaviour to preserve
- **Option off: byte-identical**, draw for draw. The signature-mode path is a branch beside the legacy path. Guards:
  `mapgen_signature_core.rs` `g8_signature_off_is_todays_generator`, `mapgen_signature_fire.rs` and
  `mapgen_signature_frost.rs` `g8_option_off_maps_are_todays`, `mapgen_signature_frost_lake.rs`
  `option_off_maps_are_todays`, `style_gallows/tests.rs` `captured_callbacks_match_complete_plans_states_and_streams`
  (the legacy capture), and this oracle's `option_off_maps_are_todays`.
- Option on: every seed still has its volcano, church with graveyard, bog tree and cave; every accepted map
  certifies with zero failures under the strict certifier; 10 camps and 2 elites per zone; no styler feature owns an
  apron tile; the gallows square exists on every seed.
- The content hash does not move: new tunables are a separate definition registered the way
  `signature::DEFAULT_DEFINITION` is (a `pub const`, listed in `tests/content.rs` `NON_GAMEPLAY`, outside the content
  hash while the option is off by default). **Not** new fields of `style_gallows::Definition` or `Dials`: both are
  folded into the content hash by `style_gallows::visit_content` (`rules.rs:176`, called from `content.rs:1488`), and
  `style_gallows/tests.rs:830` `all_definition_and_factory_fields_drive_content` requires every field to drive it.
- Attempts stay bounded: worst attempt index on seeds 1 to 32 at most 8.

## 8. Acceptance checks
Oracle `crates/rh-sim/tests/mapgen_land_sentenced.rs`, seeds 1 to 32, option on (definitions in its file comment):

| Test | Checks | Today |
|---|---|---|
| `every_sentenced_fence_tile_lies_on_the_inner_or_the_outer_enclosure` | items 1, 2 | FAIL, 32 of 32 seeds |
| `no_gate_tile_is_fence` | item 4 (gates off the corners, both enclosures) | FAIL, 29 gates |
| `the_front_spine_gate_of_each_enclosure_is_five_wide_and_flanked_by_fence` | items 4, 7 | FAIL, 64 of 64 front sides |
| `each_enclosure_has_at_least_two_openings` | both enclosures stand, each with two openings | FAIL, 61 of 64 |
| `gates_line_up_from_the_inner_to_the_outer_enclosure` | item 4 (an open inner gate with a free lane meets an open outer gate) | PASS (vacuous today: few inner gates are openings) |
| `fence_runs_stay_within_nine_and_pieces_keep_the_minimum` | item 5 | PASS (the certifier enforces it today) |
| `maps_certify_clean_and_keep_the_church_and_the_gallows_square` | section 7 | PASS |
| `the_worst_attempt_over_seeds_1_to_32_is_at_most_eight` | section 7 | PASS (today 3) |
| `option_off_maps_are_todays` | G8 (seeds 1-8 map hashes; decor does not move the fence) | PASS |
| `report_seeds_1_to_32` (`#[ignore]`) | the report: per seed attempt and refusals, yard box, per line: tiles, zone, free (halo / spawn pad / route band), fence standing and its share, clear tiles off the gates; front spine gate classes; fence on and off | report |
| `report_spine_gate_room_on_accepted_attempts` (`#[ignore]`) | section 12's room for item 7, strict and loose | report |

Not checked by the oracle (a finished map cannot tell a keep-clear break from a missing fence): that corners are
closed, and how much of each line stands. The reviewer checks corners in code; the report measures the share.

## 9. Validation commands
- `cargo test -p rh-sim --features trusted-status-probes --test mapgen_land_sentenced`
- `cargo test -p rh-sim --features trusted-status-probes --test mapgen_land_sentenced -- --ignored --nocapture report_seeds_1_to_32`
- `cargo test -p rh-sim --lib style_gallows`
- the six existing `mapgen_signature_*` tests (command in `LANDMARK_GENERATION_SPEC.md` section 7)
- `scripts/gate.sh --quick --oracle packet/P-LAND-SENTENCED-1` (the coordinator runs the full gate at merge)

## 10. Risk and suggested model tier
Opus. The fence rows are today's cover between Sentenced camps and part of what the route guard and the certifier
measure; replacing them changes which attempts are accepted. Size estimate within scope: about 300-350 changed lines
(frame and yard box, ring and gates, laying pieces with `Mode::Trim`, corner arms, the tunables definition); the
refusal (item 7) is outside the scope. No cut proposed.

## 11. Known traps
- **No refusal path for a styler.** `shape` returns `Result<Plan, Error>`; an `Err` is a generator error
  (`pipeline/mod.rs:406` `result.map_err(Error::Style)?`), not a refused attempt. Refusals after the styler are
  `Refusal::StyleBreach` (`style_contract::check`, `pipeline/mod.rs:412-427`) and `Refusal::SignatureDiscarded`
  (`SignatureContext::intact`, `signature/mod.rs:411`; the Frost lake rule `cave::lake_at_mouth` is the precedent: a
  pure predicate on the finished map). Item 7 needs one of these, outside this scope.
- **Corners against the certifier's fence detour.** `fence-detour` (`certify/features.rs:383-435`, `R.fence_detour`
  10, `R.fence_reach` 3) and the runtime's placement check (`style_runtime/mod.rs:616`, `fence_detour` 10 at
  `style_runtime/rules.rs:27`) allow a pair of floor tiles either side of a fence tile to be at most `2k + 10` steps
  apart. By the oracle author's count (floor inside the corner) a closed corner's two arms may each run at most 5
  tiles past the corner tile; the 9-tile runs between 3-wide gates pass exactly (`2*5 + 2 = 12`). With gates every 12
  from origins the corners do not choose, only 5 of the 12 positions of the last gate before a corner (its centre 3-7
  tiles from the corner) give a closed corner with both arms to the rhythm; on the other 7 the arm must stop short of
  the next gate, an opening that is not a gate. The rules do not forbid that opening; they do not name it either.
- **Existing tests pin option-on output** (the coordinator's lane; a changed Sentenced styler moves them; do not
  edit, list them in the hand-off):
  - `crates/rh-sim/tests/mapgen_signature_frost_lake.rs`: `seeds_with_the_lake_at_the_mouth_keep_their_maps`
    (`unchanged()`: attempt and `map_hash` of 30 seeds), `seeds_17_and_18_land_on_the_next_attempt_with_the_lake_at_the_mouth`
    (`moved()`: attempt and `map_hash`), `the_worst_attempt_stays_within_the_measured_margin` (worst attempt at most
    5, stricter than this brief's 8).
  - `crates/rh-mapdress/tests/anchor.rs` `a_signature_map_stripped_of_its_anchors_is_dressed_as_today`
    (`NO_ANCHOR_GOLDEN`: dressing hashes of signature seeds 1-4).
  - `crates/rh-mapdress/tests/marsh.rs` `every_zone_other_than_plague_is_dressed_as_before` (`SIG_GOLDEN`: per-zone
    dressing hashes of signature seeds 1-4, Sentenced among them).
  - Comments (not assertions) naming seeds and attempts: `mapgen_signature_aprons.rs:202`, `mapgen_signature_frost_lake.rs`.
- Stylers share one runtime state across zones (`mapgen/style_runtime/`): a changed Sentenced result can change the
  zones styled after it and every later stage.
- Tunables are data, not new fields of the folded definitions (section 7). `crates/rh-sim/tests/content.rs` scans
  `src/` only (`sources`, `:385-404`), so it does not see test files; the oracle has no `const` anyway.
- The signature-mode path draws only from the styler's own streams; the legacy path's draws are untouched.
- Anchors are on `GameMapData.anchors` only, never on `LayerData`. Inside the styler the church's `Feature` gives the
  centre (`ax, ay` = the camp tile, `church.rs:201`), the box (`bbox`) and `front` (`signature::front(ax, ay)`); the
  entrance must be re-derived (the floor tiles on the box edge facing the door side), as `style_rime::signature_anchor`
  does for the cave mouth.
- The gallows square is placed before the fence and keeps legacy's centroid rule; it can land on a line or in a gate.

## 12. Measurement (oracle author, 2026-11-13, `566841f4`, debug build, macOS arm64)
Today's generator, option on, seeds 1-32, the attempt each seed certifies on (`report_seeds_1_to_32`). Line tiles are
classed `o` off the zone or map, `w` wall or another feature's tile, `h` in a camp halo (the certifier's), `s` in a
spawn's 5x5, `r` on an approximate spawn route band (steepest descent of the walk to the coliseum from each Sentenced
spawn, grown by 1; the guard's real corridor is string-pulled), `F` clear free floor (or today's fence). "free" =
`F`+`h`+`s`+`r`. "ceiling" = clear (`F`) tiles of both lines not on a gate position: an upper bound on the fence two
enclosures can hold before corners, detours and pieces. Spine: the front spine gate as `flank|5 tiles|flank`.

| seed | att | box (along x across) | inner line/zone/free | h/s/r | clear off gates | inner spine | outer line/zone/free | h/s/r | clear off gates | outer spine | fence on | fence off | ceiling/off |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 0 | 20x11 | 98/29/29 | 7/0/0 | 16 | `o\|ooooo\|o` | 154/33/33 | 0/0/0 | 24 | `o\|ooooo\|o` | 296 | 324 | 12% |
| 2 | 0 | 21x14 | 106/80/73 | 7/0/0 | 49 | `h\|hhhFF\|F` | 162/66/66 | 5/2/0 | 44 | `F\|FFFFF\|F` | 257 | 305 | 30% |
| 3 | 0 | 19x13 | 100/100/98 | 7/0/0 | 78 | `F\|FFFFF\|F` | 156/69/69 | 7/5/0 | 42 | `F\|FFFFF\|F` | 305 | 355 | 33% |
| 4 | 0 | 22x12 | 104/16/15 | 0/0/0 | 10 | `F\|FFFFF\|F` | 160/16/16 | 0/0/0 | 11 | `F\|FFFFF\|F` | 335 | 327 | 6% |
| 5 | 0 | 20x11 | 98/66/63 | 7/0/0 | 42 | `F\|FFFFF\|h` | 154/83/76 | 7/0/0 | 57 | `o\|ooooo\|F` | 288 | 323 | 30% |
| 6 | 0 | 20x13 | 102/48/47 | 7/0/0 | 33 | `F\|Fhhhh\|h` | 158/62/58 | 7/10/8 | 26 | `F\|FFFFw\|w` | 329 | 354 | 16% |
| 7 | 0 | 16x13 | 94/37/36 | 7/0/0 | 21 | `o\|FFFFF\|h` | 150/48/47 | 0/0/0 | 36 | `o\|oooFF\|F` | 306 | 324 | 17% |
| 8 | 2 | 22x12 | 104/42/41 | 7/0/0 | 28 | `h\|hhhhh\|F` | 160/43/43 | 5/10/2 | 21 | `F\|FFFFF\|F` | 274 | 308 | 15% |
| 9 | 2 | 22x13 | 106/72/72 | 0/5/0 | 51 | `F\|FFFFF\|F` | 162/79/72 | 12/0/3 | 42 | `h\|hhhFF\|F` | 291 | 298 | 31% |
| 10 | 0 | 21x11 | 100/48/48 | 9/0/0 | 28 | `F\|FFFFF\|F` | 156/55/55 | 0/0/0 | 41 | `F\|FFFFF\|F` | 313 | 361 | 19% |
| 11 | 1 | 18x14 | 100/44/44 | 7/5/3 | 26 | `h\|hhhhh\|h` | 156/40/40 | 7/5/3 | 20 | `o\|ooooo\|o` | 343 | 363 | 12% |
| 12 | 0 | 19x15 | 104/46/46 | 7/0/0 | 34 | `h\|hhhFF\|F` | 160/20/20 | 0/0/0 | 12 | `F\|FFFFF\|F` | 264 | 356 | 12% |
| 13 | 0 | 19x9 | 92/12/12 | 0/0/0 | 7 | `F\|FFFFF\|F` | 148/24/24 | 0/0/0 | 16 | `F\|FFFFF\|F` | 336 | 336 | 6% |
| 14 | 0 | 21x14 | 106/82/82 | 7/5/12 | 41 | `r\|sssss\|F` | 162/74/65 | 7/5/3 | 35 | `F\|FFFFF\|F` | 301 | 329 | 23% |
| 15 | 0 | 20x11 | 98/87/87 | 0/5/0 | 63 | `F\|FFFFs\|s` | 154/70/63 | 11/0/5 | 31 | `F\|FFFFF\|r` | 297 | 302 | 31% |
| 16 | 1 | 23x12 | 106/69/69 | 5/0/0 | 48 | `F\|FFFFF\|F` | 162/71/71 | 12/0/0 | 46 | `h\|hhhhF\|F` | 281 | 338 | 27% |
| 17 | 1 | 21x14 | 106/21/21 | 0/0/0 | 15 | `o\|ooooo\|o` | 162/18/18 | 5/0/0 | 7 | `o\|ooooo\|o` | 249 | 286 | 7% |
| 18 | 3 | 22x14 | 108/84/75 | 7/0/2 | 47 | `F\|FFFFw\|w` | 164/98/92 | 21/10/19 | 28 | `F\|FFFFF\|F` | 252 | 306 | 24% |
| 19 | 0 | 18x14 | 100/100/91 | 9/0/0 | 71 | `F\|FFFFF\|F` | 156/69/69 | 5/5/6 | 39 | `F\|FFFFF\|F` | 229 | 316 | 34% |
| 20 | 0 | 22x14 | 108/22/22 | 7/2/0 | 13 | `h\|hhhhh\|F` | 164/22/22 | 0/0/0 | 15 | `F\|FFFFF\|F` | 257 | 286 | 9% |
| 21 | 0 | 23x12 | 106/106/105 | 9/0/0 | 72 | `F\|FFFFF\|F` | 162/69/62 | 5/10/6 | 31 | `F\|FFFFF\|F` | 350 | 332 | 31% |
| 22 | 0 | 19x12 | 98/12/12 | 0/0/0 | 7 | `F\|FFFFF\|F` | 154/12/11 | 0/0/0 | 6 | `F\|FFFFF\|F` | 335 | 277 | 4% |
| 23 | 0 | 19x12 | 98/46/46 | 0/0/0 | 38 | `F\|FFFFF\|F` | 154/60/56 | 14/0/0 | 31 | `h\|hhhhF\|F` | 340 | 418 | 16% |
| 24 | 0 | 18x11 | 94/63/63 | 9/0/0 | 45 | `F\|FFFFF\|F` | 150/76/76 | 0/5/3 | 50 | `F\|FFFFF\|F` | 306 | 354 | 26% |
| 25 | 0 | 18x14 | 100/82/80 | 6/0/0 | 60 | `F\|FFFFF\|F` | 156/58/58 | 0/0/0 | 41 | `F\|FFFFF\|F` | 322 | 366 | 27% |
| 26 | 0 | 21x12 | 102/90/90 | 5/5/2 | 59 | `F\|Fhhhh\|h` | 158/72/64 | 7/5/2 | 34 | `F\|FFFFF\|F` | 264 | 318 | 29% |
| 27 | 0 | 18x12 | 96/45/44 | 0/0/0 | 36 | `F\|FFFFF\|F` | 152/59/52 | 14/0/0 | 29 | `h\|hhhFF\|F` | 318 | 339 | 19% |
| 28 | 0 | 20x15 | 106/74/67 | 7/0/0 | 53 | `F\|hhhhh\|h` | 162/66/66 | 7/10/10 | 28 | `F\|FFFFF\|F` | 310 | 334 | 24% |
| 29 | 0 | 22x13 | 106/32/32 | 0/0/0 | 26 | `o\|ooooo\|o` | 162/41/37 | 7/0/0 | 23 | `o\|ooooo\|o` | 330 | 329 | 14% |
| 30 | 0 | 21x14 | 106/49/48 | 7/0/0 | 27 | `F\|FFFFF\|F` | 162/63/63 | 7/0/3 | 41 | `h\|hhhhh\|F` | 314 | 337 | 20% |
| 31 | 0 | 22x14 | 108/49/49 | 5/0/0 | 31 | `F\|FFFFh\|h` | 164/63/60 | 7/0/0 | 39 | `F\|FFFFF\|F` | 359 | 312 | 22% |
| 32 | 1 | 20x12 | 100/38/37 | 7/0/0 | 27 | `F\|hhhhh\|h` | 156/26/26 | 0/0/0 | 18 | `F\|FFFFF\|F` | 293 | 336 | 13% |

Summary (min / median / max): yard box area 171 / 260 / 308; inner line free 12 / 48 / 105 of about 100 line tiles;
outer line free 11 / 58 / 92 of about 156; today's fence option on 229 / 306 / 359, option off 277 / 329 / 418;
ceiling 13 / 69 / 120 tiles = 4% / 20% / 34% of the option-off fence. Attempt index 0 / 0 / 3; refusals before the
accepted attempt: 4 `Repair(RadiusPost)`, 4 `Signature`, 3 `SignatureDiscarded`. Fence on the lines today: 0-19
tiles per line (it is legacy's rows crossing them), up to 109 tiles out from the yard box.

Room for item 7 (`report_spine_gate_room_on_accepted_attempts`; 115 accepted attempts: the certifying one of seeds
1-64 and every other accepted attempt 0-3 of seeds 1-32):

| | inner | outer | both |
|---|---|---|---|
| strict: gate walkable, both flanks clear zone floor | 53 | 62 | 25 (22%) |
| loose: a clear tile somewhere on each side of the gate on the front side | 97 | 88 | 83 (72%) |
| certifying maps of seeds 1-64, strict | | | 13 of 64 (20%) |

Why the strict test fails (per enclosure, 115 attempts): inner (62): a flank in another camp's halo 44, the whole gate
off the zone 7, a flank off the zone 5, a spawn pad or route band 5, a wall 1; outer (53): off the zone 26 (the whole
gate in 22), a flank in a halo 17, another feature's tile (gallows square or guard house) 6, a spawn pad or route
band 4. Halos,
zones and spawns are fixed by the Prefix and the Landmarks phase; the styler can move none of them (G1).

What it implies:
- **Item 7 against the attempt bound.** If only about one attempt in five can hold both front spine gates, and today
  about three in four attempts are otherwise accepted, an attempt succeeds with probability about 0.15-0.2 (attempts are
  independent: the Prefix redraws the camps each attempt): about 4-7 of 32 seeds would land beyond attempt 8
  (`0.8^9` to `0.85^9` per seed), and 1-2 of 32 would find no map within the 16-attempt limit (`0.8^16` to
  `0.85^16`; a seed with no map, which G2/G5 forbid). The rule cannot plausibly hold with the attempt bound as written. The loose
  reading (fence on each side of the spine gate, not at its edge) would hold on about 72% of attempts; that is a
  weaker rule, not adopted here. Options for the owner: accept the loose reading; let the Prefix or the church
  placement keep camp halos off the front lines (coordinator's lane; P-MAPGEN-SIG-RESERVE-1 keeps halos off a 34-tile
  site, which may help the inner line but not the 26 off-zone outer fronts); raise the attempt bound; or drop item 7.
- **Fence share.** Even if every clear line tile off the gates stood, two enclosures at 5 and 12 hold about a fifth
  of today's fence (median 20%, best seed 34%). "About today's share, within a fifth" cannot hold together with "no
  fence outside the enclosures". The zone extends up to about 110 tiles from the yard box; the enclosures cover its
  neighbourhood only.
- After RESERVE-1 and SCALE-2 (a 28-30 church on the back edge) the yard box grows to about 30 a side: the lines get
  longer but more of them fall off the zone at the back and sides; none of this was measurable here.

## Oracle files (read-only for implementers)
- `crates/rh-sim/tests/mapgen_land_sentenced.rs`
- this brief

## Notes from previous attempts
