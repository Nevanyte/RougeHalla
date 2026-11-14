# Hand-off: P-MAPGEN-SIG-SCALE-4 (implementer-opus, 2026-11-14)

```
PACKET:          P-MAPGEN-SIG-SCALE-4 — serves owner direction 2026-11-12 late (landmarks "a lot larger"), owner
                 decision 2026-11-13 (requirements L1, L4; ADR 0028 G9); last of the four SCALE packets
BRANCH:          agent/opus/P-MAPGEN-SIG-SCALE-4 @ (this commit; implementation 975c23bcc, c6aa171ac, 24914675b,
                 ADR 28f85f186), stacked on agent/opus/P-MAPGEN-GUARANTEES-1 @ 1eeacce97
GATE:            not run by the implementer (the lane's session runs the full gate after the re-pin).
                 STOP CONDITION: no option-on map exists on seeds 1-64 (every seed lost; see "Blocker" below), so the
                 oracle cannot go green and the re-pin has nothing to pin. The packet goes back to the coordinator.
CHANGED:         crates/rh-sim/src/mapgen/landmarks/signature/{spec.rs, mod.rs, volcano.rs, blueprint.rs};
                 docs/adr/0028-signature-landmarks.md (decisions 7, 8, 10, G9); this file
D-RULES:         D1: option off byte-identical (no option-off path touched: the Fire entry, `volcano::streams`,
                 `intact` and the deleted Definition fields run only with `Options::signature`; pinned_off and the
                 *_option_off_* guards: see the test table); no legacy counterpart (DEV-020). D2 n/a. No sim tick,
                 wire or Unity change (the Fire anchor's entrance grows from 0 to 6 tiles, under MAX_ANCHOR_ENTRANCE).
DEVIATIONS:      none (DEV-020 covers the signature landmarks)
SHARED RECORDS:  none
LEGACY DOUBTS:   none (no legacy counterpart)
NOT ESTABLISHED: any property of a finished option-on map (none certifies); the oracle's structural tests have
                 never run against a real volcano; the lava window, the fan and the Fire crater bands on real maps;
                 the other zones' amounts after the change; the time per map after the change.
RISKS:           every option-on seed is lost until the owner decides the blocker; the stream legality drops the
                 legacy landmark protection (camp halos still hold) — a design call the coordinator must confirm.
```

## Blocker: the 30 x 30 cone alone loses every seed (a number for the owner)

Measured on the implementation with the streams switched off (a throwaway local switch, not committed: the stamp
places the cone, nothing else), `report_seeds_1_to_64`, 16 attempts per seed:

| run | maps | refusals over 1,024 attempts |
|---|---|---|
| cone only, no streams | 0 of 64 | `Prefix` 127, `Repair(FloorShare)` 726, `SpawnPool` 171 |
| cone and three streams (this branch) | 0 of 64 | `Prefix` 127, `Signature` 844, `Repair(FloorShare)` 30, `SpawnPool` 23 |
| before (stub: 5 x 5 cone, 2-3 streams) | 64 of 64 | see "Numbers" |

- The stamp itself never refuses: the 30 x 30 drawing fits every Fire site's inner rect under `WallGround` (0
  `Signature` refusals with the streams off).
- `Repair(FloorShare)` (`repair/mod.rs`, `floor_share_max` 1.15: the largest zone's painted floor may be at most 1.15
  times the smallest's) refuses almost every attempt that reaches repair: the cone writes 816 non-floor tiles (656 wall,
  160 lava) into the Fire zone, the streams and pools about 130 more, against roughly 4,000-4,500 painted floor tiles
  per zone; the church, the tree and the cave take far fewer. The rest fail `SpawnPool`.
- This is not the stream code and not a guarantee: it is the drawing's size against a repair rule outside this
  packet's write scope (`repair/`). Options for the owner: lower the cone's solid tile count (a smaller or hollower
  drawing), exclude landmark tiles from the floor-share count (a repair rule change, its own packet, option-on only to
  keep G8), or raise `floor_share_max` with the option on. None was taken here (hard rule 1: the generator is not bent
  to fit a number).

## Second finding: the stream ground in front of the outlets

With the brief's legality (`Site::ground`: off the legacy landmark protection, the halos and every apron), the middle
stream was refused on nearly every attempt: the camps keep only their certifier halo out of the reserved site, and
their landmark protection (clearing grown by `landmark_clearing_margin` 3) reaches 2 tiles further, exactly over the
site's apron ring in front of the outlets (diagnostic: 466 of ~1,100 stream refusals were the first pair, every one on
`protect`). `volcano::free` now asks for Fire floor off the camp halos and every apron, not the protection (commit
c6aa171ac; one line to revert). What still blocks streams, by the first tile a blocked stream could not take
(seeds 1-64, all attempts): a camp's halo (~390), the Fire zone's edge (~210), a legacy building's apron (~175). By
stream (the first stream that failed on an attempt): middle 469, left 252, right 113; floor split 10; of those, 381
were short of their range. Only 53 of 897 attempts that reach the Landmarks phase keep three streams; the in-crate
Landmarks-phase test sees the volcano with its streams on 5 of 72 attempts (seeds 1-12, attempts 0-5). The structural
cause: the Fire camps stand in front of the cone (the site is on the back edge; nothing reserves the stream fan), so
a 14-18 tile middle stream toward the coliseum runs into a camp halo or out of the zone. A fix belongs in the prefix
(reserve the fan in front of the Fire site from camp halos, `zones/camps`), outside this write scope.

## What was built

- `spec.rs`: the Fire entry is the drawing (`Some(d.volcano_grid)`), legend `#`/`X`/`H` wall, `~` lava, `O` lava and a
  mark, all `WallGround`, `.` plain floor; feature Volcano (Landmark, Centre); `Placement::Centre`;
  `EntranceRule::Mark(b'O')`; no doorway; members and by-tile unchanged.
- `blueprint.rs`: `dir16` (largest dot product with `DIR16`, first on a tie).
- `mod.rs`: `place` sends every zone through `stamp`; for Fire it then calls `volcano::streams` with an unconfined
  `Site` (`inner: None`) before the write loop; the `None if zone == Fire` arm and `Site::inner = None` for the cone are
  gone. `intact`'s `door_ok`: an entrance tile is floor or owned by its own zone's landmark. `Definition`: deleted
  `cone_d2`, `crater_d2`, `camp_room`, `site_tries`, `streams`, `spreads`, `stream_len`; `stream_start` 3 -> 1 (now
  steps beyond the outlet run's centre); `lava_budget` (80, 150) -> (240, 310) (PROVISIONAL, the oracle's window);
  `back_slack` stays (the reservation reads it); docs for `volcano_grid`, `outlet_heading`, `outlet_len`.
- `volcano.rs`: `place`/`build`/`ends_well` deleted; `streams` (one length draw per run in grid order before anything
  can refuse; runs from the entrance tiles on the front row; the middle laid first, sides held below its measured
  length; refuses on any missing part, touching bodies, a stray run touch, a broken fan, lava out of budget, or a floor
  split of cone plus streams and pools); `stream` starts so its first pair continues the run's two outlets, grows to
  two tiles past the drawn length and shortens until the oracle's measure (`length`) fits; a band that is not one
  4-connected piece is shortened (no ford); `owned` now lists only the streams and pools (the cone's pairs come from
  the legend). The front bound (`front_max`) reads the drawing's front (`dir16(orientation.front)`), not the centre's
  DIR16 front: the two differ by up to two steps, which would have refused every side heading.
- Draw order on the Fire stream: the stamp's mirror draw, then three length draws (left, middle, right as drawn).
  Nothing else draws. No other stream is touched.
- Unit test `volcano::tests::landmarks_phase_streams_keep_the_volcano_guarantees` (green): on the Landmarks phase,
  wherever the volcano is placed, the frame's feature order, one run per stream, no ford, two wide, lengths in range,
  the middle strictly longest, no bodies touching.

## Test results

- `cargo fmt --all -- --check`: clean. `cargo clippy -p rh-sim --all-targets --features trusted-status-probes -- -D
  warnings`: clean.
- `cargo test -p rh-sim --features trusted-status-probes --lib`: 1,107 green, 4 red, 17 ignored, every red one an option-on
  pipeline test that needs a certified option-on map (`pipeline::guarantee_tests::{the_pipeline_discards_a_finished_map_a_guarantee_refuses_and_never_errs,
  frames_run_in_placement_order_and_each_list_in_its_order}`, `pipeline::style_refusal_tests::{a_landmark_refusal_from_a_styler_refuses_the_attempt_and_the_next_is_tried,
  a_real_styler_fault_still_fails_the_call_with_the_same_error}`). Every option-off pin in the lib is green
  (`all_original_plain_pins_full_maps_and_independent_hard_checks`, `styled::all_original_styled_pins_*`, the stylers'
  captured-callback tests). New `volcano::tests::landmarks_phase_streams_keep_the_volcano_guarantees`: green.
- `mapgen_signature_volcano`: green `the_fire_entry_is_the_volcano_drawing_with_its_legend`,
  `the_heading_helper_turns_the_outlet_headings_into_dir16`, `guard_the_drawing_and_the_outlet_table_are_the_owners`;
  the other 11 red, all on `seed 1: no map with the option on`, not on a structural assertion.
- Integration targets (`--no-fail-fast` run, saved by the implementer outside the repo): every target that builds
  option-on maps is expected red for the same reason (no map), so none of them is "red by design, to re-pin" yet; the
  option-off guards do not move (no option-off code path changed). The coordinator's full gate is the record.
- Not run: `cargo test -p rh-mapdress`, `cargo test -p rh-server --test map_anchor_seeds --test map_anchors` (they
  read option-on maps; nothing to measure until the blocker is decided).

## Numbers for the owner (section 10)

### Before (stub `fb6b9dc51`: 5 x 5 cone, two or three streams)

- Attempts: 54 over seeds 1-32, 111 over 1-64; worst attempt 4 (seed 2); no seed lost. Per seed (1-64): 1, 4, 0, 0, 1,
  0, 2, 1, 1, 0, 0, 3, 1, 0, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 1, 1, 1, 0, 1, 0, 0, 0 | 0, 1, 0, 0, 2, 0, 1, 1, 0, 0, 1, 0,
  2, 2, 0, 3, 0, 1, 0, 0, 1, 0, 2, 0, 2, 0, 1, 0, 0, 1, 2, 2.
- Refusals: `Guarantee { Frost, lake-at-mouth }` 21, `Prefix` 10, `SpawnRatio` 7, `SignatureDiscarded` 5,
  `Repair(RadiusPost)` 4.
- Fire lava per map: 80-114 (cone 5, streams 47-82, pools 17-38).
- Stream lengths: n/a (not the drawing).
- Fire craters, option on: 7-10 per map (10 on 45, 9 on 13, 8 on 5, 7 on 1 of 64); option off: 8-10 (10 on 57). `mapgen_signature_fire_bands.rs`: all 5
  green.
- Sentenced (`report_lanes_seeds_1_to_32`) and Plague (`report_seeds_1_to_32`): printed and green before; the after
  run has no map to measure.

### After (this branch)

- Attempts: no map on any seed 1-64 (16 attempts each). Refusals over 1,024 attempts: `Signature` 844, `Prefix` 127,
  `Repair(FloorShare)` 30, `SpawnPool` 23. Split of `Signature` at Fire (local throwaway counters): the cone never;
  a stream short of its range or without a pool 834 (middle 469, left 252, right 113), floor split 10; touching bodies,
  fan, lava budget: 0 observed.
- Lava by part, stream lengths, Fire craters, the other zones' amounts, time per map: not measurable (no finished
  map). Report runtime 31.5 s for 64 seeds x 16 attempts (before: 13.3 s for 111 attempts).

## What `style_scorch/` needed

Nothing was changed. Whether the crater bands round the 30 x 30 footprint hold (`craters_are_arranged_by_band_round_the_volcano`,
the three crater tests of `mapgen_signature_fire_bands.rs`) cannot be measured until a map certifies.

## What the brief got wrong

1. Section 14 expected "refusals and attempts will rise"; in fact the cone alone loses every seed (`Repair(FloorShare)`),
   which no implementation inside the write scope can change.
2. Section 3/4 keep `free` (`Site::ground`, with the legacy protection) for the streams; the camps' protection covers
   the apron ring in front of the outlets, so the streams cannot start (measured above).
3. The front bound: the brief has the side headings at "the front's index +-2", true for the drawing's front
   (`dir16(u)`), not for `signature::front(centre)`, which `front_max` read before; with the latter every side heading
   of a centre whose DIR16 front is off-axis would exceed `front_max`.

## Re-pin

Not done and not possible: no option-on map exists to pin. The digest guards are red, but not "by design": they are
red because every option-on seed is lost.

## What the next packets should know

- The coordinator decides the blocker first (the owner's call: cone size, the floor-share rule with the option on, or
  reserving the stream fan in the prefix). Until then P-LAND-FIRE-1 has no map to work on.
- `volcano::streams` is a self-contained continuation: it reads the landed outlet runs from the entrance rule, the
  headings and lengths from `Definition`, and refuses rather than serve fewer streams. Its legality is one function
  (`free`).
- P-LAND-FIRE-1: the streams now run from the cone's front edge through the camp field (halos only kept); craters
  clear of the streams will compete with them for that ground.
- Holy hall (HOLY-1): every table entry now has a drawing; `Spec::drawing: None` only refuses.
