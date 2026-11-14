# P-MAPGEN-SIG-SCALE-4: the Fire volcano is the approved 22 x 22 cone drawing with exactly three lava streams

- **Serves:** owner direction 2026-11-12 late (MIGRATION: the faction landmarks "a lot larger"); owner decision
  2026-11-13 ("Yes, apply them": requirements L1 and L4 of `docs/coordination/LAND_GENERATION_REQUIREMENTS.md`; ADR
  0028 G9); owner decisions 2026-11-14 (below). Last of the four SCALE packets.
- **Implementer tier:** implementer-opus (rh-sim mapgen: the Prefix's camp placement, the legacy landmark stage's
  protection, the Landmarks phase, the terrain gate and the certifier's T5, the signature stream's draws; every
  option-on map moves)
- **Reviewer:** reviewer-opus
- **Integration base:** stacked on `agent/opus/P-MAPGEN-GUARANTEES-1` @ `c64934582`. `scripts/gate.sh --oracle-check
  --base agent/opus/P-MAPGEN-GUARANTEES-1` until GUARANTEES-1 is merged.
- **D-rules touched:** D1: option off byte-identical (G8; its pins stay; the T5 exemption changes no option-off verdict:
  option-off maps have no signature landmark feature); no legacy counterpart (DEV-020) · D2 n/a · no sim tick, wire or
  Unity change (the anchor's entrance grows from 0 to 6 tiles, under `MAX_ANCHOR_ENTRANCE` 16).
- **Status:** oracle written 2026-11-14 (oracle-author, Opus); first implementation `agent/opus/P-MAPGEN-SIG-SCALE-4`
  stopped (no option-on map on seeds 1-64 with the 30 x 30 cone); prototypes measured on
  `agent/opus/P-MAPGEN-SIG-SCALE-4-measure` @ `07ae18e2e` (never merged); the owner decided 2026-11-14; stub, oracle
  and brief amended the same day (commits `stub: ... owner decisions 2026-11-14 ...` and `oracle: ... owner decisions
  2026-11-14 ...` on `packet/P-MAPGEN-SIG-SCALE-4`). Numbers marked PROVISIONAL are not the owner's: the implementer
  measures them and the coordinator finalises them.

## Owner decisions 2026-11-14 (supersede everything below where they differ)

Asked three questions with the prototype measurements and two pictures, the owner answered (land-generation session's
chat, 2026-11-14): **"Yes to all 3. This is just map generation optimization. Once done this is done please push and
merge map generation"**. The three, each worded so that "yes" accepts:

1. **Lava rule:** "a signature landmark's own walled-in lava is exempt from the rule that a lava tile must lie within 4
   tiles of walkable ground." (Terrain rule T5, in the terrain gate and in the certifier.)
2. **Cone size:** "the volcano is **22 across**, and the zone fairness rule (largest zone floor at most 1.15 times the
   smallest) stays as it is. This supersedes the approved 30 x 30 drawing."
3. **Stream lengths:** "middle stream **10 to 14** path tiles, side streams **7 to 10**. This supersedes 14-18 and
   10-14."

Unchanged hard rules: the cone is one fixed drawing; exactly three streams on every map, one per outlet run, two tiles
wide, each ending in a pool, no fords; an attempt that cannot deliver all of it is refused; the middle stream is the
longest.

**What they supersede:** the 30 x 30 drawing (now `docs/landmarks/blueprints/volcano.txt`, 22 x 22, and its crate copy
`signature/volcano.txt`, byte-equal); the lengths 14-18 and 10-14 (now `Definition::outlet_len` `[(7, 10), (10, 14),
(7, 10)]`); "the cone fills the inner rect" (it is centred in it). **The earlier amendment's other rules stand:** one
blueprint, eight orientations, three streams always, guarantees hard and numbers targets, refuse rather than serve
smaller, the Fire land rule left to P-LAND-FIRE-1. **The zone fairness rule is NOT changed:** repair's
`floor_share_max` and the certifier's `zone-floor-share` (`certify::rules::R.floor_share`) stay 1.15; pinned by
`mapgen_signature_volcano.rs` `guard_the_zone_fairness_rule_is_unchanged_and_holds` (and, among every other rule, by
`guard_every_zone_keeps_its_landmark_and_every_map_certifies_clean`).

**The geometry the build keeps** (the prototype's, because that is what was measured):
- The Fire site is unchanged: 34 a side (`site_side`), inner rect 30 x 30 (apron `bands[0]` = 2).
- The cone drawing is 22 x 22, centred in the inner rect: 4 tiles between the cone's box and the inner rect's edge on
  every side (`Placement::Centre` already centres; 30 - 22 is even, so no odd spare tile).
- **The fan:** a rectangle in front of the Fire site's inner rect (toward the coliseum, along the front axis: the
  dominant axis, x on a tie, of `front` read at the site's centre tile), `fan_depth` = 14 tiles deep and as wide as the
  inner rect plus `fan_side` = 14 tiles on each side, clipped to the map. For front (0, 1) and inner rect (x0, y0)-(x1,
  y1): x0 - 14 ..= x1 + 14 by y1 + 1 ..= y1 + 14. Camp halos stay out of it (the Prefix's camp placement treats it as
  reserved) and so do the legacy landmark stage's buildings (their protection). Nothing else is forbidden there: the
  streams and their pools run in it, and the stylers' later work is unchanged.
- **The T5 exemption:** a LOW lava tile owned by a signature landmark feature (`Volcano`, `LavaStream`, `LavaPool`,
  `Church`, `Graveyard`, `BogTree`, `Cave`) is not counted by T5, in the terrain gate (`terrain_gate::validate`) and in
  the certifier (`certify/terrain.rs`). Every other far LOW tile still fails, with the option on or off.

**Measurements behind the decisions** (prototypes on `agent/opus/P-MAPGEN-SIG-SCALE-4-measure` @ `07ae18e2e`, knobs in
`crates/rh-sim/src/mapgen/proto.rs`; seeds 1-64, 16 attempts each, option on):

| run | maps | worst attempt | attempts (1-64) | notes |
|---|---|---|---|---|
| before (stub: 5 x 5 rule-drawn cone, 2-3 streams) | 64 / 64 | 4 | 111 | Fire lava 80-114 |
| approved 30 x 30 cone, as first built | 0 / 64 | - | - | blockers: floor share (the cone takes 816 floor tiles); T5 (the crater lake, 136-140 tiles far from floor; 112 at 22 across); nothing reserves the ground in front of the cone (streams hit camp halos, the zone edge, legacy buildings' aprons) |
| **chosen**: `RH_PROTO_CONE=22 RH_PROTO_FAN=14 RH_PROTO_FAN_WIDE=14 RH_PROTO_MID=10,14 RH_PROTO_SIDE=7,10 RH_PROTO_T5=1 RH_PROTO_NOBUDGET=1` | 64 / 64 | 10 | 210 | Prefix refusals 12.4% of attempts (unchanged); refusals Signature 41, Prefix 26, FloorShare 13; largest / smallest zone floor 1.11-1.15; Fire's floor 0.88-0.92 of the others' mean; lava per map 221-244; stream lengths left 7-10 (mean 8.4), middle 10-14 (12.1), right 7-10 (8.3) |

The prototype's drawing (`volcano22_proto.txt`, the approved one with four outer rings trimmed: a plain square, 484
non-floor tiles, 136 lava) is NOT the shipped drawing. The shipped 22 x 22 drawing keeps the same lava and outlets (136
lava: 130 `~` and 6 `O`; outlets on the front row y = 21 at x = 3-4, 10-11, 17-18) and the approved look: cut corners
with floor (26 `.`), a foot ring `#` (146), a slope ring `X` (96), a rim `H` (80) round the lake. It has 458 non-floor
tiles where the prototype had 484, so its floor share can only be easier than the measured one.

**Not set by the owner (PROVISIONAL; the implementer measures, the coordinator finalises):**
- the lava window `Definition::lava_budget`: the oracle takes **(200, 270)** for now (prototype 221-244);
  `mapgen_signature_volcano.rs` `provisional_lava_window`, pinned by `the_fire_lava_lies_in_the_provisional_window`;
- the attempt bounds: the oracle takes **worst attempt <= 12** and **attempts over seeds 1-32 <= 137** (the
  prototype's 210 over seeds 1-64, halved for 32 seeds, plus about 30%); `worst_attempt_allowed`, `attempts_allowed`,
  pinned by `guard_the_worst_attempt_stays_within_the_provisional_bound`,
  `guard_the_attempts_used_stay_within_the_provisional_bound`.

Process the owner asked for: "just map generation optimization": build it, re-pin, gate, review, push, and request the
merge. The lane's session sends the owner a picture of the real build for the record; it does not wait for another
approval round.

## Amendments after the build (2026-11-14)

Test-side changes taken on the build (`agent/opus/P-MAPGEN-SIG-SCALE-4` @ `c62867ea4`, hand-off
`docs/coordination/HANDOFF_P-MAPGEN-SIG-SCALE-4_2026-11-14.md`), each its own `oracle:` commit; no source file changed.
Numbers the owner never set are re-taken from the build with headroom ("this is just map generation optimization").

1. **The orientation helper** (`mapgen_signature_volcano.rs` `orientation`). The owner's 22 x 22 drawing is
   mirror-symmetric (every row reads the same reversed; the outlet runs mirror onto each other), so a faithful stamp
   equals it under both mirror states of its front and the old "exactly one orientation" failed seven tests. Now: at
   least one orientation matches; every matching one lands the same tiles (wall glyphs and lava glyphs on the same map
   tiles); the one used (outlet order, the side of each stream, the fan) is the Fire frame's landing, which must be one
   of them. The ignored report uses the same helper. The church drawing is mirror-symmetric too, and its helper already
   accepted both mirror states; the bog tree and cave drawings are not (208 and 322 tiles differ from their mirror
   images by glyph class), so their helpers are unchanged.
2. **`mapgen_signature_fire.rs` `volcano_on_the_back_edge_with_streams_toward_the_front`.** The back-edge half is
   unchanged (seeds 1-16). The stream half required every stream's end nearer the coliseum than the volcano centre;
   the fan's side streams run 45 degrees off a front axis that is itself up to 45 degrees off the true direction
   (seed 7: 76.6 against 73.6). Now, seeds 1-32: every stream ends in front of the cone's box along the cone's own
   front axis (the Fire anchor's `front`, dominant axis), and the middle stream (the one leaving the middle outlet run)
   ends nearer the coliseum than the volcano centre. New `a_stream_behind_the_cone_fails_the_stream_check`: on seed 1,
   any one stream moved to a strip behind the box is reported.
3. **Attempt bounds** re-taken to the volcano oracle's figures (measured on the build, seeds 1-32: 89 attempts, worst
   attempt index 9; seeds 1-64: 192 and 10), all on seeds 1-32 with each test's own counting (no scaling needed):

   | test file | worst (old -> new) | attempts (old -> new) |
   |---|---|---|
   | `mapgen_signature_bog_tree.rs` | 4 -> 12 | 59 -> 137 |
   | `mapgen_signature_church.rs` | 5 -> 12 | 57 -> 137 |
   | `mapgen_signature_reserve.rs` | 7 -> 12 | 70 -> 137 |
   | `mapgen_signature_scale.rs` | 7 -> 12 | 70 -> 137 |
   | `mapgen_signature_frost_lake.rs` | 8 -> 12 | - |
   | `mapgen_land_plague.rs` | 8 -> 12 | - |
   | `mapgen_land_sentenced.rs` | 8 -> 12 | - |

   `mapgen_signature_table.rs` `each_landmark_placed_alone_equals_it_placed_with_the_others`: accepted Landmarks phases
   floor 28 -> 20 (measured 25 of 32: the volcano's signature step refuses 5; crossings still 0). The test names
   `the_worst_attempt_over_seeds_1_to_32_is_at_most_eight` keep their old wording.
4. **Two guards that are not owner figures.** `mapgen_land_sentenced.rs` `seed_floor` 0.30 -> 0.25 (seed 6 measures
   0.29: 97 / 4060 lane fence on, 354 / 4253 off; the owner's floors are the medians, which pass).
   `mapgen_land_plague.rs`: `pools_are_large_near_the_tree_and_small_far` keeps its per-pool rule (no Large pool far,
   no Small pool near) and compares the band means only when both bands hold pools (measured near 0, far 32 of mean
   area 67.2: the 29 x 29 tree and its apron fill the near band; the large bog near the tree is the tree's own marsh);
   `all_three_sizes_occur_and_maps_with_three_pools_mix_sizes` asks for at least two size classes over seeds 1-32
   (measured Small 51, Medium 15, Large 0), was all three.
5. **Re-pins (done), constants only, from the build:**
   - `tests/support/signature_pins.rs` `pinned_on_maps` (32 rows; attempts now 1, 0, 1, 0, 0, 0, 2, 1, 2, 0, 0, 1, 3, 1,
     0, 2, 2, 7, 0, 0, 1, 9, 4, 4, 1, 7, 0, 2, 1, 4, 1, 0) and `pinned_landmarks` (32 rows; five now refused by the
     signature step: 7/0, 9/1, 12/0, 13/0, 16/0); `pinned_off` unchanged (green).
   - `mapgen_guarantees.rs` `pinned_labels` (57 refusals over seeds 1-32: Signature 18, SpawnRatio 14, Prefix 9,
     lake-at-mouth 6, RadiusPost 5, SignatureDiscarded 2, SpawnPool 2, FloorShare 1; three label constants added) and
     the lake-at-mouth count in `a_lake_failure_is_refused_after_records_as_the_frost_guarantee` 11 -> 6.
   - `rh-mapdress` `anchor.rs` `NO_ANCHOR_GOLDEN`, `marsh.rs` `SIG_GOLDEN`, `sentenced_rings.rs` `NO_ORIGIN_GOLDEN`;
     both `OFF_GOLDEN` unchanged (green).

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

On option-on maps the Fire volcano is the approved drawing `docs/landmarks/blueprints/volcano.txt` (22 x 22, front =
the bottom edge; `#`, `X`, `H` wall; `~` lava; `O` the six outlet tiles, three runs of two on the front row (gy 21) at
gx 3-4, 10-11, 17-18; `.` floor in the four cut corners), placed by the generic stamp from its table entry, centred in
the Fire site's 30 x 30 inner rect in one of eight orientations, its front toward the coliseum. Exactly three lava
streams leave it, one from each outlet run, in a fan toward the coliseum: the middle one straight ahead, 10-14 path
tiles and strictly the longest; the side ones 45 degrees left and right, 7-10 path tiles; natural bends; two lava tiles
wide; no ford; each ends in its own pool; no stream or pool touches another. An attempt that cannot deliver all of it
is refused (`Refusal::Signature`); it is never served with two streams, a short stream or a smaller cone. The Prefix
keeps camp halos out of the Fire fan and the legacy landmark stage keeps its buildings out of it; T5 exempts a
signature landmark's own lava (the crater lake), in the terrain gate and the certifier; the zone fairness rule is
unchanged.

## 2. Dependencies
- P-MAPGEN-SIG-BLUEPRINT-1/-2 and P-MAPGEN-LANDMARK-FRAME-1 (the table, the stamp, the frame): in the base.
- P-MAPGEN-GUARANTEES-1 lands first (it edits `pipeline/mod.rs`, `pipeline/plague_pools*.rs`, `style_zones/`,
  `style_rime/`, `style_warren/`, and in `signature/` only `intact` (the Frost lake rule leaves it) and `cave.rs`).
  This packet must also edit `intact` (design item 6): one hunk, after the rebase.

## 3. Relevant paths (on `aeae82456`; the 2026-11-14 additions at the end)

The first implementation (`agent/opus/P-MAPGEN-SIG-SCALE-4`: `975c23bcc`, `c6aa171ac`, `24914675b`, ADR `28f85f186`;
read with `git show`, do not merge it) has the stamp continuation, `volcano::streams`, `dir16`, `intact`'s `door_ok`
and the Fire table entry: they stay the basis of the build (its hand-off,
`docs/coordination/HANDOFF_P-MAPGEN-SIG-SCALE-4_2026-11-14.md` on that branch, "What was built"). The prototype branch
shows where the three new rules go (`git diff cef560b6a 07ae18e2e`): its env knobs are measurement only; the build
writes each rule plainly, with no knob and no `proto.rs`.

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
  (`Placement::Centre`: 22 in 30 leaves 4 spare tiles a side, so the box is the inner rect shrunk by 4), the stub's
  `dir16`.
- `crates/rh-sim/src/mapgen/landmarks/signature/frame.rs`: no field needed (landing, marks with grid tiles, `heading`).
- `crates/rh-sim/src/mapgen/style_scorch/` (`signature_anchor`, `craters.rs::lava_apron`): read the anchor's footprint
  and the `LavaStream`/`LavaPool` features; the bands move outward with the bigger footprint.
- (2026-11-14) `crates/rh-sim/src/mapgen/terrain_gate/mod.rs` (`validate_with_definition`, the `far` filter: T5) and
  `crates/rh-sim/src/mapgen/certify/terrain.rs` (`errors`, `group(m, 5, ...)`: T5; the certifier reports it only as the
  `terrain-validator` rule).
- (2026-11-14) `crates/rh-sim/src/mapgen/attempt/mod.rs` `assemble_with`: the reserved sites become `Reserve` rects
  passed to `zones::camps::place_camps_reserving` (the prototype pushed the fan there as `Reserve { zone: 0, camp:
  None, .. }`); `signature::reserve` chooses the sites (the fan follows from the Fire site and its front).
- (2026-11-14) `crates/rh-sim/src/mapgen/landmarks/stage/mod.rs` `apply_with`: `recipe_protect`, the legacy recipes'
  protection with every reserved site marked; the fan is marked the same way.
- (2026-11-14) `signature/mod.rs` `Definition::fan_depth`, `fan_side` (the stub's, 14 and 14; not read yet).

## 4. The design (the coordinator's plan of 2026-11-14, items 1-8, corrected by the oracle author)

1. **The Fire entry gets its drawing** (`spec.rs`): `drawing: Some(d.volcano_grid)`; legend `#`, `X`, `H`
   `Write::Wall` and `~` `Write::Low(codes.lava)`, owned by `Volcano`; `O` the same as `~` and a mark; all five
   `Legality::WallGround`; `.` plain floor (`Legality::Floor`). **Why `WallGround`:** it is the rule today's cone keeps
   (`s.wall && s.ground`, `volcano.rs:73`), so the cone stays off the legacy landmark protection and the legacy
   buildings' aprons (`near1` before the volcano holds only those: the volcano is placed first), as the bog tree, the
   other centred landmark, does; `Wall` would let a 484-tile cone abut legacy buildings, which no volcano does today.
   `features: [Volcano, job Landmark, anchor Centre]`; `placement: Placement::Centre`; `entrance:
   EntranceRule::Mark(b'O')` (the six outlets; the Unity volcano art expects them); `doorway: false`; members and
   by-tile unchanged. Pinned by `the_fire_entry_is_the_volcano_drawing_with_its_legend`.
2. **The anchor's centre: no new centre rule (changed from the plan).** The plan proposed `Spec.centre:
   Centre::Facing | Centre::Grid(cell)` because an even box has no centre tile. On this drawing it is not needed: the
   site's centre tile (`inner.x + 15, inner.y + 15`, the tile `stamp` already uses as `t`; the box starts at
   `inner + 4`, so it is box tile 11) lands on one of the four middle grid tiles (10|11, 10|11) under every orientation,
   and all four are `~` (2026-11-14 drawing; was (14|15, 14|15) of the 30 x 30). So `t` keeps its three jobs (the
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
   `d.outlet_len[run]` (left 7-10, middle 10-14, right 7-10: owner decision 2026-11-14). A stream that cannot reach its range's minimum
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

Items 9-12 come from the owner decisions of 2026-11-14 and correct the plan above:

9. **The cone is 22 x 22, centred** in the unchanged 34 site's 30 x 30 inner rect (`Placement::Centre`, the generic
   rule; no new centre rule). The site search, `site_side` and the reservation are unchanged. The cone writes 458
   tiles (322 wall, 136 lava). Pinned by `the_volcano_is_the_blueprint_under_one_of_eight_orientations`,
   `the_fire_anchor_is_the_box_the_crater_centre_and_the_six_outlets`, and the blueprint file's box rule
   (`the_box_rule_matches_todays_tree_centres_the_volcano_and_fills_the_hall_rect`).
10. **The T5 exemption** (terrain gate and certifier, one rule each, no knob): a LOW tile whose terrain is lava and
    which a signature landmark feature owns (kinds `Volcano`, `LavaStream`, `LavaPool`, `Church`, `Graveyard`,
    `BogTree`, `Cave`; by the feature grid) is not counted by T5. Nothing else is exempt: an unowned far lava tile,
    or one owned by a styler's feature (a crater, the legacy `LavaRiver`), still fails, with the option on or off.
    Option-off maps have no signature feature, so no option-off verdict changes (G8). Both readers take the same
    definition of "signature landmark feature"; keep it in one place (a function beside the kinds, e.g. in
    `signature`, read by `terrain_gate` and `certify`), not two lists. Pinned by
    `every_low_tile_far_from_floor_is_a_signature_landmarks_own_lava`,
    `far_lava_no_signature_landmark_owns_still_fails_t5_option_on`,
    `far_lava_on_doctored_ground_still_fails_t5_option_on_and_off`.
11. **The fan** (`Definition::fan_depth`, `fan_side`): the rectangle of section "Owner decisions", derived from the
    Fire `ReservedSite` alone (front read at the site's centre tile with `signature::front`, its axis with
    `signature::axis`). Two readers: (a) the Prefix's camp placement (`attempt::assemble_with`): the fan joins the
    `Reserve` list given to `place_camps_reserving`, so no camp's halo enters it; (b) the legacy landmark stage
    (`stage::apply_with`): the fan is marked in `recipe_protect` like the sites, so no legacy building enters it. One
    function computes the rectangle (e.g. `signature::fan(&ReservedSite, &Definition) -> Option<(x0, y0, x1, y1)>`,
    `None` for a zone other than Fire); both readers call it. The fan forbids nothing else: the streams and pools run in
    it; the stylers are unchanged. It exists with the option on only (the reserved sites do). Pinned by
    `the_fire_fan_holds_no_camp_halo_and_no_legacy_building` (the oracle's own rectangle; its doc says how the front
    axis is taken).
12. **The streams' ground (decided here):** streams and pools keep the first build's `volcano::free` (commit
    `c6aa171ac`): this zone's free floor (`Site::floor`, unconfined) off the camp halos and every apron marked so far,
    NOT off the legacy landmark protection (the camp clearings grown by `landmark_clearing_margin`). Why: the prototype
    measured the chosen combination with that `free` (64 of 64 seeds); with the fan reserved the halos are out of the
    fan, but the camps' protection still reaches the site's apron ring in front of the outlets, where the streams must
    start, so restoring `Site::ground` would refuse the middle stream again. The halo, which the certifier asks for,
    still holds everywhere. Pinned by `no_stream_or_pool_tile_lies_in_a_camp_halo` (the halo side; entering the
    protection is a permission, not a duty, so it has no test of its own).
13. **Fairness unchanged:** no change to `repair/` (`floor_share_max`) or the certifier's `zone-floor-share`. A floor
    share that fails on the real build is a number for the coordinator, not a rule change.
14. **Lava budget:** `Definition::lava_budget` becomes the measured window (provisional (200, 270) in the oracle; the
    coordinator finalises it). The build must not refuse within the prototype's 221-244.

## 5. Exclusive write scope
- `crates/rh-sim/src/mapgen/landmarks/signature/**` except the drawings (`spec.rs`, `mod.rs`, `volcano.rs`,
  `blueprint.rs`, `frame.rs`, `reserve` and the fan function; `mod.rs`: `Definition`'s volcano fields, `place`, `stamp`
  doc, `intact`'s `door_ok`, `from_definition`; `frame.rs` docs only, no field). `signature/volcano.txt` stays
  byte-equal to the approved file (not edited).
- `crates/rh-sim/src/mapgen/terrain_gate/mod.rs` and `crates/rh-sim/src/mapgen/certify/terrain.rs`: the T5 exemption
  only (design item 10).
- `crates/rh-sim/src/mapgen/attempt/mod.rs`: the Prefix's camp placement reads the fan (design item 11 a) only.
  `zones/camps/` is not in scope: if `place_camps_reserving` cannot keep halos out of a camp-less `Reserve` as it
  is, stop and report.
- `crates/rh-sim/src/mapgen/landmarks/stage/mod.rs`: the fan in `recipe_protect` (design item 11 b) only.
- `crates/rh-sim/src/mapgen/style_scorch/` only as far as design item 7 forces.
- `docs/adr/0028-signature-landmarks.md`: decision 10 (the volcano as the 22 x 22 drawing with three streams, the fan,
  the T5 exemption, fairness unchanged), decision 8's note on the bands, G9's "not yet built" note (the volcano built;
  the Holy hall left).
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
  7 / 70, `_frost_lake`): a failure is a number for the owner. **Expected to fail (2026-11-14):** the prototype's
  worst attempt was 10 and it used 210 attempts over seeds 1-64 (about 105 over 1-32), above all of these. They are
  not this packet's oracle files and are not edited here: the implementer reports each one's measured worst / total
  on the build, and the coordinator takes the new bounds to the owner (or to a follow-up `re-pin` approved by the
  owner). This packet's own provisional bounds (12 / 137) are in `mapgen_signature_volcano.rs`.

## 8. Acceptance checks (all in the oracle files; seeds 1-32, option on, no decor, `certified_styled`)
Hard (no tolerance):
- the volcano equals the 22 x 22 drawing under exactly one orientation, its box centred in the Fire site's 30 x 30
  inner rect (the inner rect shrunk by 4), owning nothing else; both mirror states and every front direction the
  sites produce occur;
- the Fire anchor: footprint the 22 x 22 landing box; centre the site's centre tile, a middle crater tile (grid
  (10|11, 10|11); LOW lava of the volcano) and the volcano feature's anchor point; front `front(centre)`, its axis the
  orientation's front; entrance the six `O` tiles, row-major;
- exactly three streams and three pools; each stream's lava touches exactly one outlet run (one stream per run) and
  exactly one pool (one per stream); two tiles wide; no ford (one 4-connected band); each pool at least 4 lava tiles
  with a 2x2 block; no stream or pool touches another's lava;
- length = 1 + the fewest 8-connected steps through the stream's own lava from a tile touching its run to a tile
  touching its pool's lava (a straight stream of n path tiles measures n): left and right 7-10, middle 10-14 and
  strictly greater than both;
- the streams' spread, in grid coordinates from the run's centre to the pool lava's centroid: every dy > 0; left
  dx < 0; right dx > 0; middle |dx| <= dy; pool columns ascend left, middle, right;
- the frame (accepted attempt's Landmarks phase): landing = the map's orientation, box = footprint; marks = the six
  `O` in grid order with their grid tiles; `heading((0, 1))` the front, `heading` turns the outlet headings; features
  Volcano, then stream and pool per run in grid order, the i-th written stream leaving run i;
- `blueprint::dir16` and the turned outlet headings (front index, +-2);
- the Fire entry of `specs` (section 4 item 1);
- the drawing and `Definition` are the owner's: 22 x 22, glyph counts `#` 146, `X` 96, `H` 80, `~` 130, `O` 6, `.` 26;
  outlet headings and lengths; `fan_depth` 14, `fan_side` 14;
- the lava rule (design item 10): on every map every LOW tile far from floor is a signature landmark's lava, every map
  has some (the crater lake), and the terrain gate reports no T5; on seeds 1-8 the crater lake's far tiles, unowned or
  owned by a non-signature feature, fail the terrain gate (a T5 line) and the certifier (`terrain-validator`); on seeds
  1-4, option on and off, one lava tile on doctored far ground, unowned or owned by a non-signature feature (option off:
  `LavaRiver`), fails both;
- the fan (design item 11): no tile of it in any camp's halo or owned by a `Landmark` feature;
- the streams' ground (design item 12): no stream or pool tile in any camp's halo;
- fairness unchanged: `R.floor_share == 1.15` and no map fails `zone-floor-share`.
PROVISIONAL (not set by the owner; the tests use exactly these values until the coordinator finalises them):
- `Definition::lava_budget == (200, 270)` and every map's Fire lava inside it (prototype 221-244);
- worst attempt over seeds 1-32 <= 12, attempts used over seeds 1-32 <= 137 (prototype: worst 10, 210 over 1-64).

## Oracle files (read-only for implementers)
- `crates/rh-sim/tests/mapgen_signature_volcano.rs` (new)
- `crates/rh-sim/tests/mapgen_signature_fire.rs` (amended, section 12)
- `crates/rh-sim/tests/mapgen_signature_blueprint.rs` (amended, section 12)
- `crates/rh-sim/tests/mapgen_signature_table.rs` (amended, section 12)
- `crates/rh-sim/tests/mapgen_landmark_frame.rs` (amended, section 12)
- Amended after the build ("Amendments after the build"): `mapgen_signature_bog_tree.rs`, `_church.rs`,
  `_reserve.rs`, `_scale.rs`, `_frost_lake.rs`, `mapgen_land_plague.rs`, `mapgen_land_sentenced.rs`,
  `mapgen_guarantees.rs`, `tests/support/signature_pins.rs` (all under `crates/rh-sim/tests/`);
  `crates/rh-mapdress/tests/{anchor.rs, marsh.rs, sentenced_rings.rs}` (golden constants)
- `docs/landmarks/blueprints/volcano.txt` (the owner's 22 x 22 drawing, 2026-11-14)
- `docs/backlog/packets/P-MAPGEN-SIG-SCALE-4.md` (this brief)
- Stub files (editable): `signature/volcano.txt` (do not edit: the guards pin it byte-equal to the docs copy),
  `signature/mod.rs` (`Definition`: `volcano_grid`, `outlet_heading`, `outlet_len`, `fan_depth`, `fan_side`),
  `signature/blueprint.rs` (`dir16`).

## 9. Validation commands
```
cd <worktree> && export PATH="$HOME/.cargo/bin:$PATH"
# optimised test builds run the map tests about eight times faster (debug assertions stay on):
export CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 CARGO_PROFILE_DEV_OPT_LEVEL=2 CARGO_PROFILE_TEST_OPT_LEVEL=2
cargo test -p rh-sim --features trusted-status-probes --test mapgen_signature_volcano
cargo test -p rh-sim --features trusted-status-probes --test mapgen_signature_volcano report_seeds_1_to_64 -- --ignored --nocapture
cargo test -p rh-sim --features trusted-status-probes --test mapgen_signature_fire --test mapgen_signature_fire_bands \
  --test mapgen_signature_blueprint --test mapgen_signature_table --test mapgen_landmark_frame \
  --test mapgen_land_sentenced --test mapgen_land_plague
cargo test -p rh-sim --features trusted-status-probes --no-fail-fast
cargo test -p rh-mapdress && cargo test -p rh-server --test map_anchor_seeds --test map_anchors
cargo fmt --all -- --check && cargo clippy -p rh-sim --all-targets --features trusted-status-probes -- -D warnings
scripts/gate.sh --quick --oracle packet/P-MAPGEN-SIG-SCALE-4
```

## 10. Numbers to measure and report (the implementer, on the real build, in the hand-off; the coordinator finalises)
Run `report_seeds_1_to_64` (above) on the build ("after"); "before" is the first hand-off's (stub `fb6b9dc51`: 111
attempts over 1-64, worst 4) and the prototype's (section "Owner decisions"). Quote both.
1. **Attempts per seed** 1-64: the attempt each lands on; max and mean; totals over 1-32 and 1-64 against this oracle's
   provisional 12 / 137 and every existing oracle's bound (section 7); seeds lost.
2. **Refusals by reason** over 1-64 (the report prints them by `Refusal` variant). For `Refusal::Signature` at Fire,
   split by cause (a stream short of its range; no pool; the middle not the longest; touching bodies; spread; floor
   split; lava out of budget) with a throwaway counter in a local run, not committed. Prefix refusals as a share of
   attempts (prototype 12.4%).
3. **Lava per map** and its range over 1-64: cone (fixed: 136), streams, pools, total; against the provisional window
   200-270. Propose the final window (about 10% headroom each side of the measured range).
4. **The three stream lengths** per map (the oracle's measure): range and mean per run (prototype left 7-10 / 8.4,
   middle 10-14 / 12.1, right 7-10 / 8.3).
5. **Floor share:** largest / smallest zone floor per map (prototype 1.11-1.15) and Fire's floor against the others'
   mean (0.88-0.92).
6. **Fire crater counts:** per map, option on, and option off; the `mapgen_signature_fire_bands.rs` near/far means
   and the count floor (P-LAND-FIRE-1 needs them).
7. **The Sentenced and Plague amounts against their owner-set floors:** what `mapgen_land_sentenced.rs`
   (`report_lanes_seeds_1_to_32`) and `mapgen_land_plague.rs` (`report_seeds_1_to_32`) print, before and after,
   against the floors in section 7. A floor that fails is reported with its measurement; it is not changed here.
8. **Time per map** (the optimised test build above), before and after.

The cone's lava from the drawing: 130 `~` (the crater lake and its three channels) + 6 `O` = 136. The streams
2 x (7..10 + 10..14 + 7..10) = 48-68 path-tile lava, the pools and widening the rest; the prototype measured 221-244 in
all.

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
`mapgen_signature_fire_bands.rs` (crater bands, the count floor, streams two wide).

Amended again for the owner decisions of 2026-11-14 (a second `oracle:` commit):
5. `docs/landmarks/blueprints/volcano.txt`: the owner's 22 x 22 drawing replaces the 30 x 30 one.
6. `mapgen_signature_volcano.rs`: re-aimed at the 22 x 22 drawing centred in the 30 x 30 inner rect (box = inner rect
   shrunk by 4; outlets row 21 at 3-4, 10-11, 17-18; centre grid tiles (10|11, 10|11); glyph counts); lengths 7-10 /
   10-14 / 7-10 (`the_middle_stream_is_14_to_18_...` renamed `the_middle_stream_is_10_to_14_and_the_longest_the_sides_
   7_to_10`); provisional window 200-270 and bounds 12 / 137; new tests
   `every_low_tile_far_from_floor_is_a_signature_landmarks_own_lava`,
   `far_lava_no_signature_landmark_owns_still_fails_t5_option_on`,
   `far_lava_on_doctored_ground_still_fails_t5_option_on_and_off` (green on the stub: a guard),
   `the_fire_fan_holds_no_camp_halo_and_no_legacy_building`, `no_stream_or_pool_tile_lies_in_a_camp_halo` (green on
   the stub: a guard), `guard_the_zone_fairness_rule_is_unchanged_and_holds` (green on the stub); the drawing guard
   also pins `fan_depth` and `fan_side`.
7. `mapgen_signature_blueprint.rs`: the volcano's size (22, 22), its outlets (row 21: 3, 4, 10, 11, 17, 18) in
   `the_marks_and_the_entrances_are_found` and `the_volcanos_outlets_and_headings_mirror_onto_each_other`; the box rule
   renamed `the_box_rule_matches_todays_tree_centres_the_volcano_and_fills_the_hall_rect`: the volcano's box is its
   inner rect shrunk by 4. Green on the stub (the reader and the landing are generic).
8. `mapgen_signature_fire.rs`, `mapgen_signature_table.rs`, `mapgen_landmark_frame.rs`: comments only (the cone's 136
   lava; the 22 x 22 drawing; `marks_keep_grid_order_and_headings_turn_with_the_drawing`'s doc now includes the
   volcano).

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
Opus. Four areas of rh-sim mapgen (the Prefix, the legacy landmark stage, the Landmarks phase, the terrain gate and
the certifier), each a small change, and every option-on map moves. The prototype shows the combination works (64 of
64 seeds) but roughly doubles the attempts (111 -> 210 over 1-64), so every existing signature oracle's attempt bound
is expected to go red (section 7: a number for the coordinator). The Fire bands move outward by about 8 tiles
(the 22 box against the old 5 x 5 cone). The T5 exemption must not leak to option-off maps or to styler lava.

## 15. Known traps
- `intact`'s `door_ok` (design item 6): without the change every option-on map is discarded and every seed is lost.
- `Site::inner`: the stamp confines the drawing by its landing anyway (22 in 30); if Fire's `Site` gets `inner` for the
  stamp, the streams' `free` is confined too and no stream can leave the inner rect: the continuation needs an
  unconfined `Site` (the first build's) or its own test.
- The continuation runs before `write`: the cone's apron is not in `near1` yet, but its tiles are not in
  `stage.state.tiles` either; mark the cone's cells (as `build` marks `mark[i] = 1`) so the streams keep off it.
- The outlet runs are on the box's front row, 4 tiles inside the inner rect's edge (was: on it): a stream crosses
  those 4 tiles, then the site's 2-tile apron ring, then leaves the site into the fan. A middle stream of 10-14 path
  tiles ends 4-8 tiles beyond the inner rect: inside the 14-deep fan.
- `ends_well`'s "nearest tile touches the cone" reads a disc today; with the drawing, "touches its run".
- The oracle's length is a map measure, not `path.len()`: measure the stream as laid (after `widen`) with the same
  definition and refuse or shorten when it leaves the range; a diagonal path's tiles and its 8-connected steps agree,
  a bend's fill tiles do not add steps.
- "Strictly the longest": the ranges meet at 10 (side 7-10, middle 10-14); draw or trim so the middle exceeds both
  sides.
- **The first build's `volcano::free` change** (commit `c6aa171ac` on `agent/opus/P-MAPGEN-SIG-SCALE-4`) let streams
  enter the legacy landmark protection. Decided here (design item 12): keep it; streams keep off camp halos and aprons
  only. Pinned by `no_stream_or_pool_tile_lies_in_a_camp_halo`. Do not restore `Site::ground` for the streams.
- **The front bound** (the first hand-off, "What the brief got wrong" 3): `front_max` must read the drawing's front
  (`dir16(orientation.front)`), not `signature::front(centre)`; with the latter every side heading of an off-axis centre
  is refused.
- **The fan and the in-site camps:** the church's and the cave's elite camps are placed inside their own sites, which
  the Prefix fixes before the fan exists. If a neighbouring zone's site lies in the Fire fan, that camp's halo can lie
  in it too, and `the_fire_fan_holds_no_camp_halo_and_no_legacy_building` counts every camp of every zone (the owner's
  words: "camp halos stay out of it"). Whether this happens on seeds 1-32 is not known (the prototype did not test it):
  if it does, the attempt is refused or the sites are chosen so the fan is clear; report which, do not narrow the test.
- **The fan's front axis** is read at the Fire site's centre tile (`signature::front`, then `signature::axis`, x on a
  tie): the same tile and rule as the volcano's anchor, so the fan and the drawing's front row always agree. The Prefix
  has no anchor yet: compute it from the `ReservedSite`.
- **T5 in two places:** `terrain_gate` (the pipeline's acceptance gate) and `certify/terrain.rs` (the certifier, seen
  only as `terrain-validator`). Change both with one shared predicate; changing one alone refuses every option-on map
  (`Refusal::Terrain` or `SignatureDiscarded`).
- **The lava budget:** the prototype ran with the budget check off (`RH_PROTO_NOBUDGET=1`). The provisional window
  (200, 270) contains its 221-244; if the build's lava leaves it, report the measured range, do not drop the check.
- The mirror sends the left run to the map's right: draw in grid order, never in map order.
- `stamp`'s floor-split check sees the cone only; re-run it with the streams and pools (as `build` did).
- Fire's frame `features` are written in the write loop's order: write the volcano, then stream and pool per run.
- `Placed::landed()` now has four entries: readers that assumed three (none outside the tests found) must not break.

## Notes from previous attempts
- Attempt 1 (implementer-opus, `agent/opus/P-MAPGEN-SIG-SCALE-4`, 2026-11-14): stopped, not a failure of the code.
  The 30 x 30 cone lost every option-on seed 1-64 (`Repair(FloorShare)`, T5 on the crater lake, streams blocked in
  front of the cone). Its stamp continuation, `volcano::streams`, `dir16`, the Fire entry and `door_ok` are the basis
  of the next build (read them with `git show`; build on `packet/P-MAPGEN-SIG-SCALE-4`, not on that branch).
- Prototypes (`agent/opus/P-MAPGEN-SIG-SCALE-4-measure` @ `07ae18e2e`, never merged): the measurements of section
  "Owner decisions"; their env knobs and `proto.rs` are not to be copied.
