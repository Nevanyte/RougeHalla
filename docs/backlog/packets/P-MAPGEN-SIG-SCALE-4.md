# P-MAPGEN-SIG-SCALE-4: the Fire volcano is the approved 30 x 30 cone drawing with exactly three lava streams

- **Serves:** owner direction 2026-11-12 late (MIGRATION: the faction landmarks "a lot larger"); owner decision
  2026-11-13 ("Yes, apply them": requirements L1 and L4 of `docs/coordination/LAND_GENERATION_REQUIREMENTS.md`; ADR
  0028 G9). Last of the four SCALE packets.
- **Implementer tier:** implementer-opus (rh-sim mapgen: the Landmarks phase, the signature stream's draws, every
  option-on map moves)
- **Reviewer:** reviewer-opus
- **Integration base:** stacked on `agent/opus/P-MAPGEN-LANDMARK-FRAME-1` @ `aeae82456` (gate-green, reviewed, being
  merged into `feature/unity-rework`); the coordinator rebases `packet/P-MAPGEN-SIG-SCALE-4` onto
  P-MAPGEN-GUARANTEES-1 before the implementer starts. Until FRAME-1 is merged, `scripts/gate.sh --oracle` counts
  FRAME-1's own commits as oracle commits (the merge-base is `feature/unity-rework`): run it only after the rebase.
- **D-rules touched:** D1: option off byte-identical (G8; its pins stay); no legacy counterpart (DEV-020) · D2 n/a · no
  sim tick, wire or Unity change (the anchor's entrance grows from 0 to 6 tiles, under `MAX_ANCHOR_ENTRANCE` 16).
- **Status:** oracle written 2026-11-14 (oracle-author, Opus) on `packet/P-MAPGEN-SIG-SCALE-4`: commits
  `stub: ...` and `oracle: ...`. Numbers marked PROVISIONAL go to the owner after the implementation measures them.

## From P-MAPGEN-SIG-SCALE-1's oracle (2026-11-13)

- The drawing is read through SCALE-1's placement rule (`signature/mod.rs`). Its copy: `include_str!` of `docs/`
  breaks the server image (`hosting/Dockerfile` copies only `crates/`; `.dockerignore` excludes `docs`), so the crate
  carries `signature/volcano.txt`, byte-equal to `docs/landmarks/blueprints/volcano.txt`, in a `Definition` field; the
  oracle checks the equality. A volcano site has no inside camp: if the cone cuts neighbouring territories, measure
  `Repair(RadiusPost)` before assuming SCALE-1's relabel covers it.

## Amendment 2026-11-13 (owner decision "Yes, apply them": requirements L1 and L4; supersedes everything below where they differ)

Source: `docs/coordination/LAND_GENERATION_REQUIREMENTS.md` on the integration branch; MIGRATION, "Owner decision
2026-11-12 (chat, midnight)"; ADR 0028 rule G9.

- **The cone is one blueprint** (L1): a solid stepped cone with its crater lake, one size (the site's inner rect, 30 x
  30 target). "Target 30, floor 28" is withdrawn.
- **Exactly three streams on every map, never two** (L4). They leave the rim in a fan toward the coliseum: one down
  the middle, one each side. The middle stream is the longest, about 14-18 path tiles; the side streams about 10-14.
  Natural bends (the streams' paths are the random part); two lava tiles wide; each ends in a pool; no fords (lava is
  LOW: walkers go round the pool). A site that cannot hold three discards the attempt. In `Definition`: `streams`
  becomes exactly three, with one heading set and the two length ranges.
- **Lava budget:** re-measured by the oracle author for the crater lake plus three streams and three pools (the
  streams alone are 68-92 lava tiles at these lengths); today's 80-150 ceiling does not hold.
- `style_scorch/` stays in this packet's scope (agreed: the land-generation session rebases after it). Its own rule
  for Fire, decided by the owner: every Fire camp keeps its crater, craters keep clear of all three streams, size
  falls with distance and none is dropped.
- **Guarantees are hard, numbers are targets** (same owner decision): an attempt that cannot deliver the blueprint is
  refused (`Refusal::Signature`) and the next is tried; nothing is served smaller or with a part missing. If the fixed
  size pushes seeds 1-64 past the attempt bounds, the measurement goes to the owner; the size is not changed quietly.
- **The blueprint is drawn first.** The coordinator drafts it as a tile grid and the owner approves it before the
  oracle is written or amended. It is data (a grid in `signature::Definition` or a table beside it, no new `const`),
  placed in one of eight orientations (four rotations by the front's dominant axis, mirrored or not: the mirror is one
  draw of the zone's signature stream).
- **The oracle** then pins equality: on every seed of 1-32 the landmark's tiles equal the blueprint under one of the
  eight orientations, inside the site's inner rect, front toward the coliseum; plus the attempt bounds, measured once.

(The owner's Fire land rule in the fourth bullet is now the next packet, P-LAND-FIRE-1, by the coordinator's plan of
2026-11-14; here `style_scorch/` changes only as far as the bigger cone forces: design item 7.)

## 1. ID and outcome

On option-on maps the Fire volcano is the approved drawing `docs/landmarks/blueprints/volcano.txt` (30 x 30, front =
the bottom edge; `#`, `X`, `H` wall; `~` lava; `O` the six outlet tiles, three runs of two on the front row at gx 7-8,
14-15, 21-22; `.` floor in the four cut corners), placed by the generic stamp from its table entry, filling the Fire
site's 30 x 30 inner rect in one of eight orientations, its front toward the coliseum. Exactly three lava streams
leave it, one from each outlet run, in a fan toward the coliseum: the middle one straight ahead, 14-18 path tiles and
strictly the longest; the side ones 45 degrees left and right, 10-14 path tiles; natural bends; two lava tiles wide;
no ford; each ends in its own pool; no stream or pool touches another. An attempt that cannot deliver all of it is
refused (`Refusal::Signature`); it is never served with two streams, a short stream or a smaller cone.

## 2. Dependencies
- P-MAPGEN-SIG-BLUEPRINT-1/-2 and P-MAPGEN-LANDMARK-FRAME-1 (the table, the stamp, the frame): in the base.
- P-MAPGEN-GUARANTEES-1 lands first (it edits `pipeline/mod.rs`, `pipeline/plague_pools*.rs`, `style_zones/`,
  `style_rime/`, `style_warren/`, and in `signature/` only `intact` (the Frost lake rule leaves it) and `cave.rs`).
  This packet must also edit `intact` (design item 6): one hunk, after the rebase.

## 3. Relevant paths (on `aeae82456`)
- `crates/rh-sim/src/mapgen/landmarks/signature/volcano.rs`: today's rule-drawn cone (`place`: back-edge centres in
  `camp_room` tiers, `site_tries` uniform draws; `build`: a `cone_d2` disc with a `crater_d2` crater, a stream count
  drawn from `streams: (2, 3)`, a spread from `spreads`, one length per stream from `stream_len`; `lava_budget`
  80-150). Keep: `stream` (`:251`), `widen` (`:404`), `first_thin`, `pool` (`:471`), `ends_well` (`:505`), `free`,
  `side`, `turn`, the ember edging (`:168-197`).
- `crates/rh-sim/src/mapgen/landmarks/signature/mod.rs` (line numbers on the stub commit): `Definition` (`:44-141`;
  the stub's new fields `volcano_grid`, `outlet_heading`, `outlet_len` at the end), `place` (`:722`: the
  `None if zone == Zone::Fire` arm at `:771`, `Site::inner = None` for Fire), `write` (`:805`), `intact` (`:892`:
  `door_ok` requires every entrance tile to be floor), `stamp` (`:1068`), `from_definition` (`:424`:
  `volcano::owned`).
- `crates/rh-sim/src/mapgen/landmarks/signature/spec.rs:110-124`: the Fire entry without a drawing.
- `crates/rh-sim/src/mapgen/landmarks/signature/blueprint.rs`: `Orientation::turn`, `Blueprint::land`
  (`Placement::Centre`: 30 in 30 leaves no spare tile, so the box is the inner rect), the stub's `dir16`.
- `crates/rh-sim/src/mapgen/landmarks/signature/frame.rs`: no field needed (landing, marks with grid tiles, `heading`).
- `crates/rh-sim/src/mapgen/style_scorch/` (`signature_anchor`, `craters.rs::lava_apron`): read the anchor's footprint
  and the `LavaStream`/`LavaPool` features; the bands move outward with the bigger footprint.

## 4. The design (the coordinator's plan of 2026-11-14, items 1-8, corrected by the oracle author)

1. **The Fire entry gets its drawing** (`spec.rs`): `drawing: Some(d.volcano_grid)`; legend `#`, `X`, `H`
   `Write::Wall` and `~` `Write::Low(codes.lava)`, owned by `Volcano`; `O` the same as `~` and a mark; all five
   `Legality::WallGround`; `.` plain floor (`Legality::Floor`). **Why `WallGround`:** it is the rule today's cone keeps
   (`s.wall && s.ground`, `volcano.rs:73`), so the cone stays off the legacy landmark protection and the legacy
   buildings' aprons (`near1` before the volcano holds only those: the volcano is placed first), as the bog tree, the
   other centred landmark, does; `Wall` would let a 900-tile cone abut legacy buildings, which no volcano does today.
   `features: [Volcano, job Landmark, anchor Centre]`; `placement: Placement::Centre`; `entrance:
   EntranceRule::Mark(b'O')` (the six outlets; the Unity volcano art expects them); `doorway: false`; members and
   by-tile unchanged. Pinned by `the_fire_entry_is_the_volcano_drawing_with_its_legend`.
2. **The anchor's centre: no new centre rule (changed from the plan).** The plan proposed `Spec.centre:
   Centre::Facing | Centre::Grid(cell)` because an even box has no centre tile. On this drawing it is not needed: the
   site's centre tile (`inner.x + 15, inner.y + 15`, the tile `stamp` already uses as `t`) lands on one of the four
   middle grid tiles (14|15, 14|15) under every orientation, and all four are `~`. So `t` keeps its three jobs (the
   tile the front is read from, the anchor's centre, `FeatureAnchor::Centre`), the centre is always crater-lake lava,
   and `front == signature::front(centre)` keeps holding for every anchor (`mapgen_landmark_frame.rs` and
   `mapgen_signature_fire.rs` assert it). A fixed grid tile would split the centre from the facing tile and break that
   invariant whenever the two tiles straddle a DIR16 boundary. Say in the `ZoneAnchor` (or `stamp`) doc comment that
   the volcano's centre is the site's centre tile, a middle crater tile whose grid tile varies with the orientation.
   Pinned by `the_fire_anchor_is_the_box_the_crater_centre_and_the_six_outlets`.
3. **The streams are a continuation after the stamp**, in `place`, between `stamp` and the write loop (after the
   write, `near1` holds the cone's own apron and would block them). Shape:
   `volcano::streams(site, rng, blueprint, landing, &mut built) -> Option<()>` (or a free function of the same
   inputs). For each outlet run in a FIXED order by grid position (left, middle, right: ascending gx; under the
   mirror they land right, middle, left on the map, and the draw order follows the drawing): start beyond the run's
   two landed tiles and lay a stream with today's machinery (`stream`, `widen`, `pool`, `ends_well`), heading =
   `blueprint::dir16(landing.orientation.turn(d.outlet_heading[run]))` (the stub's helper: the DIR16 index of a map
   direction, largest dot product, first on a tie; side headings are the front's index +-2), length drawn from
   `d.outlet_len[run]` (left 10-14, middle 14-18, right 10-14). A stream that cannot reach its range's minimum
   **as the oracle measures it** (section 8), cannot end in a pool, or would leave the middle stream not strictly the
   longest, refuses the attempt: never two streams. Then the floor-split check runs again on the cone plus all
   streams and pools, and the lava budget check. Delete what only the rule-drawn cone reads: the site search
   (`camp_room`, `site_tries`, the uniform site draw, `back_slack` if nothing else reads it), `cone_d2`, `crater_d2`,
   `streams`, `spreads`, `stream_len`; keep `stream_min`, `stream_start` (re-read: the start is now beyond the run),
   `stream_bend`, `front_max`, `stream_gap`, `start_d2` (re-read: "beside the cone" is now beside the outlets),
   `pool_d2`, `lava_budget`.
4. **Draw order** on the Fire signature stream: the stamp's one mirror draw, then the streams' draws in outlet order.
   No draw on any other stream. Every option-on map moves; option off does not (G8).
5. **The frame:** Fire's frame now has a landing, the six `O` marks with their grid tiles, `heading()`; `features` =
   Volcano, then (LavaStream, LavaPool) for the left, middle, right run in that order. No new `LandmarkFrame` field
   (so the struct-literal helpers in `mapgen_landmark_frame.rs` and `mapgen_style_refusal.rs` stay where they are).
6. **Membership and `intact`:** members `{Volcano, LavaStream, LavaPool}`, by-tile `{LavaStream, LavaPool}`. The
   volcano's owned-tile pairs now come from its legend (wall/0, LOW/lava: today's pairs); streams and pools keep their
   pairs (lava LOW, ember floor) from a by-tile list (what is left of `volcano::owned`; the debug check in
   `from_definition` fires if a member kind has no rule). **`intact`'s `door_ok` must change** (not in the plan): it
   requires every anchor entrance tile to be `TILE_FLOOR`, and the volcano's six entrance tiles are LOW lava, so every
   option-on map would be discarded. Make it: an entrance tile is floor, or is owned by its zone's landmark (its value
   is then `owned_ok`'s). This is a hunk in `intact`, which P-MAPGEN-GUARANTEES-1 also edits: rebase first.
7. **`style_scorch/`:** only what the bigger cone forces. The crater bands follow the new footprint by themselves
   (`signature::band` reads `frame.anchor.footprint`); `craters.rs::lava_apron` keeps reading the stream and pool
   features. The owner's Fire land rule is P-LAND-FIRE-1: do not start it. If the bigger cone makes today's crater
   tests fail (`mapgen_signature_fire.rs` `craters_are_arranged_by_band_round_the_volcano`,
   `mapgen_signature_fire_bands.rs` the three crater tests), measure it, report it under "Numbers for the owner", and
   do not weaken the test.
8. **Guarantees** (`style_zones::guarantee`): none added. "Exactly three streams, each ending in its pool" is a
   property of the landmark as placed (the stamp plus the continuation refuse otherwise), covered by `intact`'s
   owned-tile check and by the oracle on the finished map.

## 5. Exclusive write scope
- `crates/rh-sim/src/mapgen/landmarks/signature/{spec.rs, mod.rs, volcano.rs, blueprint.rs, frame.rs}` (`mod.rs`:
  `Definition`'s volcano fields, `place`, `stamp` doc, `intact`'s `door_ok`, `from_definition`; `frame.rs` docs only,
  no field). `signature/volcano.txt` stays byte-equal to the approved file (not edited).
- `crates/rh-sim/src/mapgen/style_scorch/` only as design item 7 says.
- `docs/adr/0028-signature-landmarks.md`: decision 10 (the volcano as the drawing with three streams), decision 8's
  note on the bands, G9's "not yet built" note (the volcano built; the Holy hall left).
- A separate `re-pin:` commit, constants only: `crates/rh-sim/tests/support/signature_pins.rs` (`pinned_on_maps`,
  `pinned_landmarks`) and `crates/rh-mapdress/tests/{anchor.rs, marsh.rs, sentenced_rings.rs}` (section 13).
- Not: the wire, Unity, `docs/landmarks/blueprints/**`, any oracle file below, any other test.

## 6. Contracts and references
- ADR 0028 G1-G10, decisions 8, 10; C-PARITY (option off byte-identical, G8); `rh-sim` determinism rules (ordered
  iteration, the signature stream only, draw order is behaviour); `tests/content.rs` (no new `const`: the new numbers
  are `Definition` fields; `DEFAULT_DEFINITION` is a `NON_GAMEPLAY` row).
- Hand-offs `docs/coordination/HANDOFF_P-MAPGEN-SIG-BLUEPRINT-1_2026-11-14.md` ("What the stamp does not yet cover";
  its statement that the site's centre tile is not a crater tile under every orientation does not hold for the
  approved drawing: design item 2), `..._BLUEPRINT-2_...` ("SCALE-4"), `..._LANDMARK-FRAME-1_...` ("What the next
  packets should know").

## 7. Behaviour to preserve
- Option off byte-identical: `pins::pinned_off()` and every `*_option_off_*` guard green unchanged.
- The church, the bog tree and the cave land as today (their own oracles, unchanged); every zone keeps its landmark;
  every map certifies clean (strict, every zone); every Fire camp is reachable from a spawn without crossing lava
  (`mapgen_signature_fire.rs`); the apron rule; each landmark placed alone equals it placed with the others
  (`mapgen_signature_table.rs`: streams stay in the Fire zone, so they cannot enter another zone's site).
- The other zones' owner-set floors on the moved maps: `mapgen_land_sentenced.rs` (combined 0.75, lanes alone 0.45),
  `mapgen_land_plague.rs` (marsh plus pools 0.8, pools alone 0.35, barrows 55%). Not yours to change: a floor that
  fails because the maps moved goes to the owner (via the coordinator), not into a re-pin or an edit.
- The attempt bounds of every existing signature oracle (`_bog_tree` 4 / 59, `_church` 5 / 57, `_scale` and `_reserve`
  7 / 70, `_frost_lake`): a failure is a number for the owner.

## 8. Acceptance checks (all in the oracle files; seeds 1-32, option on, no decor, `certified_styled`)
Hard (no tolerance):
- the volcano equals the drawing under exactly one orientation, its box the Fire site's inner rect, owning nothing
  else; both mirror states and every front direction the sites produce occur;
- the Fire anchor: footprint the 30 x 30 inner rect; centre the site's centre tile, a middle crater tile (LOW lava of
  the volcano) and the volcano feature's anchor point; front `front(centre)`, its axis the orientation's front;
  entrance the six `O` tiles, row-major;
- exactly three streams and three pools; each stream's lava touches exactly one outlet run (one stream per run) and
  exactly one pool (one per stream); two tiles wide; no ford (one 4-connected band); each pool at least 4 lava tiles
  with a 2x2 block; no stream or pool touches another's lava;
- length = 1 + the fewest 8-connected steps through the stream's own lava from a tile touching its run to a tile
  touching its pool's lava (a straight stream of n path tiles measures n): left and right 10-14, middle 14-18 and
  strictly greater than both;
- the fan, in grid coordinates from the run's centre to the pool lava's centroid: every dy > 0; left dx < 0; right
  dx > 0; middle |dx| <= dy; pool columns ascend left, middle, right;
- the frame (accepted attempt's Landmarks phase): landing = the map's orientation, box = footprint; marks = the six
  `O` in grid order with their grid tiles; `heading((0, 1))` the front, `heading` turns the outlet headings; features
  Volcano, then stream and pool per run in grid order, the i-th written stream leaving run i;
- `blueprint::dir16` and the turned outlet headings (front index, +-2);
- the Fire entry of `specs` (section 4 item 1).
PROVISIONAL (numbers for the owner; the tests use exactly these values until the owner amends them):
- `Definition::lava_budget == (240, 310)` and every map's Fire lava inside it;
- worst attempt over seeds 1-32 <= 4, attempts used <= 57 (the strictest bounds already on these maps).

## Oracle files (read-only for implementers)
- `crates/rh-sim/tests/mapgen_signature_volcano.rs` (new)
- `crates/rh-sim/tests/mapgen_signature_fire.rs` (amended, section 12)
- `crates/rh-sim/tests/mapgen_signature_blueprint.rs` (amended, section 12)
- `crates/rh-sim/tests/mapgen_signature_table.rs` (amended, section 12)
- `crates/rh-sim/tests/mapgen_landmark_frame.rs` (amended, section 12)
- `docs/backlog/packets/P-MAPGEN-SIG-SCALE-4.md` (this brief)
- Stub files (editable): `signature/volcano.txt` (do not edit: the guard pins it), `signature/mod.rs`,
  `signature/blueprint.rs`.

## 9. Validation commands
```
cd <worktree> && export PATH="$HOME/.cargo/bin:$PATH"
cargo test -p rh-sim --features trusted-status-probes --test mapgen_signature_volcano
cargo test -p rh-sim --features trusted-status-probes --test mapgen_signature_volcano report_seeds_1_to_64 -- --ignored --nocapture
cargo test -p rh-sim --features trusted-status-probes --test mapgen_signature_fire --test mapgen_signature_fire_bands \
  --test mapgen_signature_blueprint --test mapgen_signature_table --test mapgen_landmark_frame \
  --test mapgen_land_sentenced --test mapgen_land_plague
cargo test -p rh-sim --features trusted-status-probes --no-fail-fast
cargo test -p rh-mapdress && cargo test -p rh-server --test map_anchor_seeds --test map_anchors
cargo fmt --all -- --check && cargo clippy -p rh-sim --all-targets --features trusted-status-probes -- -D warnings
scripts/gate.sh --quick --oracle packet/P-MAPGEN-SIG-SCALE-4    # after the rebase onto GUARANTEES-1
```

## 10. Numbers for the owner (the implementer measures them on the real implementation and reports them in the hand-off)
Run `report_seeds_1_to_64` (above) on `packet/P-MAPGEN-SIG-SCALE-4` (today's volcano: "before") and on the
implementation ("after"); quote both.
1. **Attempts:** per seed 1-64, the attempt each lands on; max and mean; totals over 1-32 and 1-64 against the
   provisional 4 / 57 and every existing oracle's bound; seeds lost.
2. **Refusals by reason:** the report prints them by `Refusal` variant. For `Refusal::Signature` at Fire, split it by
   cause (the cone does not fit; a stream short of its range; no pool; the middle not the longest; floor split; lava
   out of budget) with a throwaway counter in a local run, not committed.
3. **Lava by part** per map and its range over 1-64: cone (fixed: 160), streams, pools, total; against the provisional
   window 240-310. Propose the window round the measured range for the owner.
4. **The three stream lengths** per map (the oracle's measure), and how often the drawn length had to be shortened or
   refused to keep the middle strictly longest.
5. **Fire craters:** count per map, option on, before and after, and option off; the `mapgen_signature_fire_bands.rs`
   near/far means and the count floor (P-LAND-FIRE-1 needs them).
6. **Other zones against their floors:** the amounts `mapgen_land_sentenced.rs` (`report_lanes_seeds_1_to_32`) and
   `mapgen_land_plague.rs` (`report_seeds_1_to_32`) print, before and after, against the floors in section 7.
7. **Time per map** (debug test build), before and after, if it changed visibly.

Worked arithmetic behind the provisional window (from the drawing, not measured): 154 `~` (crater lake 96 in rows
10-19, channels 58) + 6 `O` = 160 in the cone; streams 2 x (10..14 + 14..18 + 10..14) = 68-92; three pools of 9-13
(squared radii 4 and 2) = 27-39; about 255-291 before widening fills. Today: two streams on 25 of seeds 1-32, three
on 7 (measured on the stub by the oracle's red message).

## 11. The owner's picture
Before the merge request, real generator output on eight seeds (1-8, option on, the accepted attempt) goes to the
owner. The implementer lists the seeds and attempts in the hand-off; the land-generation lane's session renders them.

## 12. Existing oracles amended (in the `oracle:` commit)
1. `mapgen_signature_fire.rs`: removed `volcano_has_two_or_three_streams_each_ending_in_a_pool` (replaced by the new
   file's three-stream tests) and the helpers only it used; `no_lava_river_and_lava_within_the_rivers_budget` renamed
   `no_lava_river_and_every_lava_tile_is_the_volcanos`, its 70-160 budget removed (the cone alone holds 160; the
   window is the new file's); `fire_maps_certify_clean_and_carry_the_volcano_anchor`: "a volcano has no door" is now
   "six entrance tiles". Green on the stub? The first two yes; the third is red on the stub (empty entrance).
2. `mapgen_signature_blueprint.rs`: `the_table_has_one_entry_per_landmark_and_its_legends_match_the_drawings`: the
   Fire entry's drawing is `Some(d.volcano_grid)` (was `None`); `placed_landed_rederives_every_written_cell`: the
   landed landmarks are Fire, Sentenced, Plague, Frost (was without Fire), so the generic checks (landing, centre,
   entrance, marks, features, every written tile) now cover the volcano. Both red on the stub.
3. `mapgen_signature_table.rs` `guard_every_shipped_drawing_is_the_approved_file`: Fire's approved file added. Green
   on the stub (no Fire drawing yet), red if the shipped copy ever differs.
4. `mapgen_landmark_frame.rs` `one_frame_per_reserved_zone_in_placement_order`: every frame, the volcano's included,
   has a landing (was: the volcano has none). Red on the stub.
Left unchanged on purpose: `mapgen_signature_fire.rs` `craters_are_arranged_by_band_round_the_volcano`,
`volcano_on_the_back_edge_with_streams_toward_the_front`, `every_fire_camp_is_reachable_...`; all of
`mapgen_signature_fire_bands.rs` (crater bands, the count floor, streams two wide); `mapgen_landmark_frame.rs`
`marks_keep_grid_order_and_headings_turn_with_the_drawing` (its generic branch covers the volcano once it has a
landing; its doc still says the volcano has none).

## 13. Re-pin (a separate commit, `re-pin: P-MAPGEN-SIG-SCALE-4 ...`, constants only, after everything else is green)
Structural tests, not digests, are this packet's proof. Every option-on map moves, so re-take:
- `crates/rh-sim/tests/support/signature_pins.rs` `pinned_on_maps()` and `pinned_landmarks()` with the values
  `cargo test -p rh-sim --features trusted-status-probes --test mapgen_signature_blueprint print_signature_pins --
  --ignored --nocapture` prints; update the file's header line naming the commit pinned on, and the
  `pinned_landmarks` doc line if attempts are now refused by the step (3). `pinned_off()` is NOT touched.
- `crates/rh-mapdress/tests/anchor.rs` `NO_ANCHOR_GOLDEN`, `crates/rh-mapdress/tests/marsh.rs` `SIG_GOLDEN`,
  `crates/rh-mapdress/tests/sentenced_rings.rs` `NO_ORIGIN_GOLDEN`: the actual values of the failing assertions of
  `cargo test -p rh-mapdress`. Their `OFF_GOLDEN` constants are NOT touched (option off).
- Any other digest the full gate finds red goes back to the coordinator; it is not re-pinned in this packet.

## 14. Risk and suggested model tier
Opus. The cone takes the whole inner rect (900 tiles, 816 of them written), so the site must be free zone floor off
the halos, the legacy protection and the legacy aprons everywhere: refusals and attempts will rise, and the three
streams must all fit on the coliseum side. Every option-on map moves; the Fire bands move outward by about 12 tiles.

## 15. Known traps
- `intact`'s `door_ok` (design item 6): without the change every option-on map is discarded and every seed is lost.
- `Site::inner`: the stamp confines the drawing by its landing anyway (30 in 30); if Fire's `Site` gets `inner` for the
  stamp, the streams' `free` (`Site::ground` -> `Site::floor`) is confined too and no stream can leave the box: the
  continuation needs an unconfined `Site` (today's Fire one) or its own test.
- The continuation runs before `write`: the cone's apron is not in `near1` yet, but its tiles are not in
  `stage.state.tiles` either; mark the cone's cells (as `build` marks `mark[i] = 1`) so the streams keep off it.
- The outlet runs are on the box's front row, which is the inner rect's edge: the first stream tile is in the site's
  2-tile apron ring, then beyond the site.
- `ends_well`'s "nearest tile touches the cone" reads a disc today; with the drawing, "touches its run".
- The oracle's length is a map measure, not `path.len()`: measure the stream as laid (after `widen`) with the same
  definition and refuse or shorten when it leaves the range; a diagonal path's tiles and its 8-connected steps agree,
  a bend's fill tiles do not add steps.
- "Strictly the longest": the ranges meet at 14; draw or trim so the middle exceeds both sides.
- The mirror sends the left run to the map's right: draw in grid order, never in map order.
- `stamp`'s floor-split check sees the cone only; re-run it with the streams and pools (as `build` did).
- Fire's frame `features` are written in the write loop's order: write the volcano, then stream and pool per run.
- `Placed::landed()` now has four entries: readers that assumed three (none outside the tests found) must not break.

## Notes from previous attempts
None (first implementation).
