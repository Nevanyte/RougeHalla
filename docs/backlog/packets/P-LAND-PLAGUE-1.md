# P-LAND-PLAGUE-1: Plague's bog is laid as free pools of overlapping discs, arranged by band from the bog tree

> **Status (oracle author, 2026-11-13): READY, with one flagged number and two decisions for the coordinator.** The
> measurement (section 12) shows the owner's picture fits today's maps if the pools are laid before the barrows and
> the barrows give way (allowed by the requirements: "move only where they would collide with the new arrangement"):
> the budget is then reachable on every seed (a greedy packing reaches 1.12 to 3.78 times today's share). **Flagged:**
> "large near the tree" fits rarely. A 12-across pool with its two-tile ring has room in the near band on 9 of 32
> seeds (1 of 32 if the barrows keep today's places), in the mid band on 12. The oracle therefore asks for size by
> band as a rule on averages and exclusions, not per map: near-band pools average at least twice the far band's area,
> no large pool lies far and no small pool lies near (test 4). **Decisions before dispatch** (section 11, first two
> traps): which feature kind owns a free pool (a new signature kind is outside this write scope), and the reading of
> "Barrows unchanged" (taken here as rock, tunnel and number unchanged, with the crescent turned into free pools).
>
> **Coordinator of the land-generation lane, 2026-11-13, afternoon: HELD for one answer from the landmark lane.** The
> owner answered "Yes to all" in chat to four questions; the two on Plague: the crescents become the free pools and
> barrows keep their rock, tunnel, placement rule and number (the barrow's wet fork is lost; Plague's home advantage
> moves to the pools); "large near the tree, small far" holds as a tendency, as test 4 is written, and is re-measured
> when the tree is enlarged. Still open: the pool's feature kind, asked of the landmark lane's coordinator in
> `docs/coordination/LAND_GENERATION_REQUIREMENTS_ADDENDUM_2.md` section 4. **No implementer starts before that
> answer.** The branch was rebased onto `1032e5bd` (after P-MAPGEN-SIG-RESERVE-1) and re-measured (section 12, last
> subsection): test 8 (the budget) now fails today, the walk test now passes today, and test 9's floor was amended
> from 85% to 70% because the reservation alone takes the barrows from 94% to 79% of option off.
>
> **Coordinator of the land-generation lane, 2026-11-13, evening: READY TO IMPLEMENT.** The landmark lane's
> coordinator answered addendum 2, section 4 (cross-session message, 2026-11-13): **option (b)**. This packet's write
> scope is widened to the six shared files for the new feature kind only, on four conditions; section 5 carries them
> word for word. Read section 5 and the first trap of section 11 before anything else. Two things are known to be
> coming and are not this packet's to solve: P-MAPGEN-SIG-SCALE-1 (the fixed 29 x 29 Frost cave) merges next and
> moves many option-on maps to a later attempt, and P-MAPGEN-SIG-SCALE-2 will also edit `certify/rules.rs` and
> `certify/features.rs` ("whichever of us lands second rebases").

- **Serves:** owner direction 2026-11-12 on generation order and land generation round the landmarks (MIGRATION
  checkpoint, "Owner direction 2026-11-12 (chat, late night)"); the land-generation requirements accepted that night,
  `docs/coordination/LAND_GENERATION_REQUIREMENTS.md` section 3 "Plague" and "Every zone"; ADR 0028 rule G10 (every
  thematic obstacle is placed by a rule that reads the landmark), with G1, G4, G5 and G8. Lane:
  `docs/coordination/LANDMARK_GENERATION_SPEC.md` section 3 (land generation).
- **Replaces:** `P-MAPGEN-SIG-PLAGUE-1` (brief only; no `packet/P-MAPGEN-SIG-PLAGUE-1` branch exists). Its dated note
  is carried over: mud and water are `rh-mapdress` decoration rings (follow-up `P-LAND-PLAGUE-2`), so this packet only
  leaves room for them.
- **Implementer tier:** implementer-opus (rh-sim mapgen: the Plague styler in signature mode; draw order)
- **Reviewer:** reviewer-opus
- **Integration base:** feature/unity-rework (`1032e5bd`: the branch was rebased onto it, after P-MAPGEN-SIG-RESERVE-1)
- **D-rules touched:** D1: option off byte-identical (G8); under the option an intentional difference from legacy
  (a proposed new row in the hand-off, in DEV-028's form, "Inside DEV-020"; the coordinator numbers it) · D2 n/a ·
  no sim tick or wire change

## 1. ID and outcome
Today, with `pipeline::Options::signature` on, the Landmarks phase places the bog tree
(`mapgen/landmarks/signature/bog_tree.rs:10` `place`: a 13-tile trunk, a dry ring, two bands of its own bog, one
`BogTree` feature) but the Plague styler (`mapgen/style_warren/`) lays its bog exactly as legacy does, without reading
the landmark: one crescent beside each barrow.

**How today's bog is laid** (legacy `packages/shared/src/zoneStyle/warren.ts:1-20`, Rust `style_warren/`):
1. Barrows are sited on the roads between camps (`shape.rs:103` `shape`, `planning.rs:384` `site_of`): up to
   `barrows_per_ref` (6) per reference zone area, about 12 per Plague zone.
2. Each barrow's crescent is the half-annulus on its "wet" flank, radius `R + 0.8` to `R + 4.5` tiles (`R = r4/4`, 2.75
   to 4.5), along the road at most `R + 1.5` (`planning.rs:231` `crescent_of`; `rules.rs:78-80`): a band about 3.7 tiles
   thick. Tiles must pass `bog_at` (`planning.rs:75`): off the route guard's corridor, free, outside every camp's
   clearing grown by `bog_camp_gap` (3); pieces under `bog_min_piece` (8) are dropped. The wet side is a noise coin
   (`planning.rs:431-449`) unless the other flank holds more bog.
3. The crescent is part of the barrow's feature floor (`shape.rs:36-37`), so the `Barrow` feature owns its bog; the
   surface pass paints it (`mod.rs:213` `surface`: owned crescent tiles become `SurfaceKind::Bog`, which the runtime
   keeps off the guard corridor, `style_runtime/mod.rs:874`).
4. No callback draws from an RNG: every variation is stateless noise (`style_warren/README.md:14`).
5. On a finished map: styler bog = bog terrain (5) owned by a `Barrow`; the tree's bog = bog owned by the `BogTree`.

**When this lands, in signature mode** (the Plague zone holds a `BogTree` feature; the styler finds it with
`BaseContext::zone_features()` as `style_rime/mod.rs:319` `signature_anchor` finds the cave, no new styler input):
1. **Free pools.** All styler bog is laid as pools: each pool is two to four overlapping rough-edged discs of one of
   three sizes, about 5, 8 and 12 tiles across (owner: "appear more natural but with some size variance,
   overlapping"). No barrow owns bog; barrows keep their rock, tunnel and today's siting rule, and move only where they
   would collide with a pool (requirements, "Every zone").
2. **By band** (`signature::band`, `landmarks/signature/mod.rs:186`, bands `[2, 6, 14]`): large pools near the tree,
   small far. A pool's band is the band of its tile nearest the tree.
3. **Spacing.** Two pools are merged (one 4-connected body) or at least 8 tiles apart (Chebyshev).
4. **Keep-clear.** No styler bog in the tree's footprint or apron (core band), on a spawn pad, in a camp halo or across
   a spawn route; every pool leaves a two-tile ring of plain floor round it, inside the Plague zone, outside every camp
   halo, owned by no feature (for `rh-mapdress`'s water and mud rings).
5. **Budget.** About today's (option off) share of the zone's free ground as bog, within about a fifth.

Out of this packet: `P-LAND-PLAGUE-2` (the water and mud decoration rings in `rh-mapdress`, laid round each pool;
`rules/zones.json` `terrainRings`); the tree's own marsh (L3, coordinator's `P-MAPGEN-SIG-SCALE-3`).

## 2. Dependencies
- P-MAPGEN-SIG-RESERVE-1 (a 34-tile reserved site) is merged and under this branch. P-MAPGEN-SIG-SCALE-3 (a 29-tile
  tree) will change every option-on map while this packet is open: every check is a property measured from the anchor,
  never a pinned map, hash, attempt number or tile position.
- **Settled** (section 11): the pool's feature kind is added by this packet under the widened scope of section 5
  (the landmark lane's coordinator, 2026-11-13). The reading of "Barrows unchanged" is settled by the owner (status
  note above).

## 3. Relevant legacy paths (verified with `rg`)
- `packages/shared/src/zoneStyle/warren.ts:1-20` (the design: "go left on dry ground, right through the bog crescent on
  the barrow's wet flank, or straight through the 3-wide tunnel"; "Plague is exempt from the bog (x0.7 for everyone
  else), so the wet fork is its home advantage"), `:110-112` (`BOG_MIN_PIECE` 8, `BOG_CAMP_GAP` 3), `:197` `bogAt`,
  `:306` `crescentOf`, `:392` `siteOf`. Option off keeps all of it byte for byte. Legacy has no bog tree and no pools.

## 4. New paths
- `crates/rh-sim/tests/mapgen_land_plague.rs` (the oracle)
- any new file under `crates/rh-sim/src/mapgen/style_warren/` the signature-mode path needs (for example `pools.rs`)

## 5. Exclusive write scope
- `crates/rh-sim/src/mapgen/style_warren/**` (the signature-mode path, beside the legacy path)
- `crates/rh-sim/tests/content.rs`: only one `NON_GAMEPLAY` row registering this packet's own tunables definition (as
  `signature::DEFAULT_DEFINITION` is at `tests/content.rs:46`)
- `crates/rh-mapdress/tests/anchor.rs` `NO_ANCHOR_GOLDEN` and `crates/rh-mapdress/tests/marsh.rs` `SIG_GOLDEN`: only if
  they move (section 11), re-measured as their comments say ("measured on the tree before the change": run the test,
  take the value the failed assertion prints for each seed), constants only, in one separate last commit whose
  message starts `P-LAND-PLAGUE-1 re-pin:`, with the old and new values listed in the hand-off
- **Widened by the landmark lane's coordinator (2026-11-13), for the new feature kind only:**
  `crates/rh-sim/src/mapdata/model.rs`, `crates/rh-sim/src/mapdata/validate.rs`,
  `crates/rh-sim/src/mapgen/certify/rules.rs` (`SIGNATURE_KINDS`), `crates/rh-sim/src/mapgen/certify/features.rs`,
  `crates/rh-sim/src/mapgen/certify/diagnostics.rs` and `crates/rh-sim/src/mapgen/map_hash/mod.rs`. The conditions,
  as the coordinator wrote them:
  - "(i) `BogPool` is APPENDED after the last existing `FeatureKind` variant, never inserted (ordinals and serialized
    names of existing kinds must not move);"
  - "(ii) it is one commit of its own on the packet or agent branch, separate from the styler work, so it can be read
    alone;"
  - "(iii) it follows `LavaPool`'s commit (aa22573a6) file for file and you state in the hand-off, having checked
    rather than assumed, that option-off maps stay byte-identical, that the map export format string, the map blob,
    the checkpoint format, the content hash and the map hash of every option-off map do not move;"
  - "(iv) nothing else in those six files changes."
  The kind commit goes on the agent branch, first, with a message starting `P-LAND-PLAGUE-1 kind:`. Of `aa22573a6`
  only its edits to these six files are the pattern; its other four files (`landmarks/signature/`, `pipeline/mod.rs`,
  `style_scorch/`) are not in this scope.
- Not yours: `mapgen/landmarks/**`, `mapgen/pipeline/`, `mapgen/style_runtime/`, the rest of `mapgen/certify/` and
  anything else in the six files above, the coordinator's tests `crates/rh-sim/tests/mapgen_signature_*.rs` (leave
  them; report the values that move). If the kind turns out to need an edit anywhere else (a decoder, a table, a
  `match` without a wildcard arm, `rh-protocol`, `rh-server`, `rh-mapdress` rules, the C# or JS side), stop and
  report it; do not make it.

## 6. Contracts and references
- ADR 0028 (G1, G4, G5, G8, G10; decision on masks and the end-of-attempt discard).
- `docs/coordination/LANDMARK_GENERATION_SPEC.md` section 4 ("What must hold"); `LAND_GENERATION_REQUIREMENTS.md`
  sections 1 (the two standing rules: guarantees are hard, numbers are targets) and 3.
- `crates/rh-sim/AGENTS.md` (determinism; draws are behaviour).
- The certifier's rules a pool meets: `feature-hazards` (hazard floor in a strict zone must be owned,
  `certify/features.rs:222`), `spawn-walk-hazards` (at most `walk_hazards` 8 hazard tiles on each spawn's walk,
  `certify/mod.rs:909-930`), `terrain-protected` and the camp clearing (+1) hazard rule (`certify/terrain.rs:28-51`,
  `certify/terrain.rs:368`); the style contract (every terrain change owned by a feature of the zone,
  `pipeline/style_contract.rs:64-72`).

## 7. Behaviour to preserve
- **Option off: byte-identical**, draw for draw. The signature-mode path is a branch beside the legacy path. Guards:
  `mapgen_signature_core.rs` `g8_signature_off_is_todays_generator`, `mapgen_signature_fire.rs` and
  `mapgen_signature_frost.rs` `g8_option_off_maps_are_todays`, `style_warren/tests.rs`
  `captured_callbacks_match_complete_plans_states_and_streams` (the legacy capture, which compares complete `Plan`s),
  and this oracle's `option_off_maps_are_todays`.
- Option on: every seed keeps its volcano, church, bog tree (with its own bog) and cave; every accepted map certifies
  with zero failures under the strict certifier; no styler feature owns an apron tile.
- The content hash does not move: new tunables are a separate `pub const` definition registered in `tests/content.rs`
  `NON_GAMEPLAY` (outside the content hash while the option is off by default), **not** new fields of
  `style_warren::Definition`: it is folded by `style_warren::visit_content` (`rules.rs:97`, from
  `src/content.rs:766`/`:975`), and `style_warren/tests.rs:784` `every_numeric_field_drives_content` requires every field to
  drive it.
- Attempts stay bounded: worst attempt index on seeds 1-32 at most 8 (today 3).

## 8. Acceptance checks
Oracle `crates/rh-sim/tests/mapgen_land_plague.rs`, seeds 1 to 32, option on, the server's options (no decor);
definitions in its file comment (pool = 4-connected piece of styler bog; styler bog = bog not owned by the `BogTree`;
size class = the largest full disc the pool holds: small r2 >= 5 (a whole 5-across disc, 21 tiles), medium r2 >= 9 (7
across), large r2 >= 25 (11 across)). Today = `1032e5bd` (on the reserved sites), debug build; the figures on
`b3a8fb516`, before the reservation, are in section 12's first table.

| # | Test | Checks | Today |
|---|---|---|---|
| 1 | `every_styler_pool_holds_a_full_five_across_disc` | bodies, not crescents | FAIL: 302 of 303 pieces (crescents hold at most r2 4; median 3) |
| 2 | `pool_area_lies_between_two_small_discs_and_four_large_discs` | 21 <= area <= 565 (one full 5-disc; five 12-discs) | FAIL: 158 pieces under 21 |
| 3 | `distinct_pools_are_at_least_eight_tiles_apart` | gap >= 8 | FAIL: 151 pairs (median nearest gap 6) |
| 4 | `pools_are_large_near_the_tree_and_small_far` | pooled mean area near >= 2 x far; no large far, no small (or thin) near | FAIL: near mean 29.1, far 23.6 (ratio 1.2); all 57 near-band pieces are below medium |
| 5 | `all_three_sizes_occur_and_maps_with_three_pools_mix_sizes` | small, medium, large all occur on seeds 1-32; a map with 3+ pools has 2+ classes | FAIL: no medium or large pool; 31 maps all thin |
| 6 | `every_pool_has_a_two_tile_ring_of_plain_floor_in_the_zone_off_camp_halos` | ring of Chebyshev width 2: floor, no terrain, Plague, unowned, off halos | FAIL: 288 pieces (barrow rock and owned floor beside each crescent) |
| 7 | `no_styler_bog_in_the_tree_footprint_or_its_apron` | no styler bog in the core band | PASS (keep) |
| - | `pools_keep_off_spawn_walks_spawn_pads_and_camp_halos` | each Plague spawn's 4-connected walk to the coliseum grows at most 2 steps when styler bog is avoided; no styler bog on a spawn pad (5x5) or in a camp halo | PASS (keep; largest growth today 2 steps. Before the reservation: FAIL on seed 25, 3 steps) |
| 8 | `bog_share_of_free_ground_stays_within_a_fifth_of_todays` | median over seeds of (on share / off share) in [0.8, 1.2] | **FAIL: median 0.74** (per seed 0.27 to 1.43; today's crescents fall short on the reserved sites. Before the reservation: PASS, 0.96) |
| 9 | `barrows_keep_their_rock_and_their_number` | every Plague barrow owns >= `piece_min` (6) walls; option-on barrows >= 70% of option-off over seeds 1-32 (amended from 85% after the rebase) | PASS (312 / 397 = 79%; keep. Before the reservation 372 / 397 = 94%) |
| 9b | `no_barrow_owns_bog` | the pools are free | FAIL: 287 barrows own bog |
| 10 | `maps_certify_clean_and_keep_the_tree` | strict certifier, zero failures; one `BogTree` with its own bog | PASS (keep) |
| 10 | `the_worst_attempt_over_seeds_1_to_32_is_at_most_eight` | attempts bounded | PASS (today 1) |
| 10 | `option_off_maps_are_todays` | G8, seeds 1-8 map hashes; decor does not move the bog | PASS (keep) |
| 11 | `report_seeds_1_to_32` (`#[ignore]`) | the per-seed table M1-M9 of section 12 | report |
| 11 | `sheet_seeds_1_to_8` (`#[ignore]`) | tile pictures of the Plague zone for the owner, option on and off | report |

Every red test fails on an assertion, with every finding listed (first 40). Messages before the rebase (first line
each; the counts on the reserved sites are in the table above, and test 8 now prints `median on/off bog-share ratio
0.740 outside [0.8, 1.2]`):
- 1: `thin pools: 346 findings` / `seed 1: pool at (13, 136) of 44 tiles (6x11 box, 84% in a 3x3 block) holds no full
  5-across disc (inscribed r2 3)`
- 2: `pool areas: 171 findings` / `seed 1: pool at (23, 105) has 8 tiles, outside [21, 565]`
- 3: `pools too close: 203 findings` / `seed 1: pools at (23, 105) (8 tiles) and (29, 102) (16 tiles) are 4 apart`
- 4: `pool size by band: 33 findings` / `seed 1: a Thin pool of 8 tiles at (23, 105) in the Near band` ... `near-band
  pools: 32 of mean area 38.9; far-band pools: 251 of mean area 23.8 (want near >= 2 x far, both present)`
- 5: `pool sizes: 30 findings` / `seed 1: 12 pools, all {Thin}` ... `no Medium pool on seeds 1-32 (classes seen:
  {Thin: 346, Small: 6})`
- 6: `pool rings: 339 findings` / `seed 1: pool at (13, 136) (44 tiles): ring tiles {"camp halo": (5, (11, 134)), "not
  floor": (12, (12, 139)), "owned": (18, (11, 137))}`
- walks: `pools on routes or clearings: 1 findings` / `seed 25: the walks of the Plague spawns to the coliseum grow by
  [0, 3, 0, 0, 0, 0] steps when bog is avoided`
- 9b: `barrows owning bog: 336 findings` / `seed 1: barrow feature 52 owns 17 bog tiles`

Thresholds and why: the disc sizes are the owner's (5, 8, 12 across, r2 = (D/2)^2). The class cores allow a rough rim
of about one tile on the 8 and 12 discs; the 5-disc must keep its whole 21-tile core (a rough edge may only grow it),
because a 5-across body less one tile is a crescent's thickness (today's crescents hold r2 3-4). Area: at least one
whole small disc; at most five large discs (four plus a fifth's worth of rough rim). Gap 8 and ring 2 are the owner's.
Near >= 2 x far: the nominal discs differ by about 5 in area; 2 leaves room for clipped and fallback pools. Walk
allowance 2 steps: the oracle author's, because the route guard's corridor is string-pulled and today's corridor-aware
crescents still lengthen one 4-connected walk by 3. Barrows 70%: on the reserved sites today's option-on maps hold 79%
of the option-off barrows (94% before the reservation, when the floor was 85%); the margin, about a tenth of today's
barrows, is for barrows that give way to pools. Budget [0.8, 1.2] on the median: the owner's "within about a
fifth"; per seed today's option-on ratio already ranges 0.57-1.55.

Not checked by the oracle (a finished map cannot say it): that each pool is made of two to four discs (only its core,
area and spacing are visible), that edges are "rough", which pools merged. The reviewer checks these in code.

## 9. Validation commands
- `cargo test -p rh-sim --features trusted-status-probes --test mapgen_land_plague`
- `cargo test -p rh-sim --features trusted-status-probes --test mapgen_land_plague -- --ignored --nocapture report_seeds_1_to_32`
- `cargo test -p rh-sim --features trusted-status-probes --test mapgen_land_plague -- --ignored --nocapture sheet_seeds_1_to_8 2>/dev/null | grep '^SHEET'`
  (header `SHEET <on|off> seed=<n> attempt=<i> x0= y0= w= h=`, then `h` rows `SHEET|...`; characters: space outside
  Plague, `#` wall, `.` floor, `:` floor in a camp halo, `p` floor on a spawn's 5x5 pad, `b` styler bog, `B` the tree's
  bog, `T` the rest of the tree's footprint (its trunk walls and dry ring), `r` barrow rock, `o` any LOW tile. The pad is
  the certifier's 5x5 hazard square, not the 3x3 terrain pad.)
- `cargo test -p rh-sim --lib style_warren` and `cargo test -p rh-sim --features trusted-status-probes --test content`
- the coordinator's `mapgen_signature_*` tests (command in `LANDMARK_GENERATION_SPEC.md` section 7); `cargo test -p rh-mapdress`
- `scripts/gate.sh --quick --oracle packet/P-LAND-PLAGUE-1` (the coordinator runs the full gate at merge)

## 10. Risk and suggested model tier
Opus, reviewer-opus. The pools replace the barrows' wet flank, change which attempts are accepted and every option-on
map. Seams (paths and lines at `b3a8fb516`):
- `style_warren/shape.rs:103` `shape`: in signature mode find the tree (`zone_features()`, kind `BogTree`), lay the
  pools first, then site the barrows with today's code on what is left, with no crescent: `planning.rs:443-449`
  (`crescent_of` both sides) and `shape.rs:36-37` (the crescent in the barrow's floor), `:220` (`plan.crescent`).
  Barrows must also keep their rock off each pool's ring (the ring must stay unowned floor).
- `planning.rs:69-91` `Ground` (`free_at`, `bog_at`, `take`): the masks a pool must respect are there (corridor, camps
  with `bog_camp_gap`); the ring, the camp halo (`certify` `protected`) and the apron (`signature::band` core, also in
  `no_block`) need adding.
- `mod.rs:213` `surface`: it paints owned `plan.crescent` tiles; in signature mode the pool tiles. `Plan` is
  `deny_unknown_fields` and the legacy capture compares `json!(plan)` (`tests.rs:574`, `:588`): either reuse
  `plan.crescent` for the pool tiles or add a field with `#[serde(default, skip_serializing_if = "Vec::is_empty")]`.
- `mod.rs:222` `props`: reeds on `plan.bog`; unchanged.
- Tunables (disc sizes and how each band chooses, pool count, gap, ring, budget): a new `pub const` in `style_warren/`
  (for example `pools.rs` `POOLS`) and its `NON_GAMEPLAY` row.
- **Randomness:** by precedent the signature path may draw from the styler's own shape stream, `c.streams.rng` =
  `Mulberry32(hash_seed(seed, attempt, zone index, shape_stream 0))` (`style_runtime/mod.rs:505-520`,
  `style_runtime/rules.rs:34`), and stateless `c.streams.noise` (offset 100) for rough edges. The legacy Warren path
  draws nothing from the stream, so option off cannot move; under the option draw order is behaviour (a reordered draw
  is a different map). Never the attempt's main stream or the landmark stream (id 5).
Size estimate: 250-400 changed lines in the styler (pool planner, masks, barrow seam, surface, tunables); the feature
kind is a separate first commit under the widened scope (section 5), about 20 lines by `LavaPool`'s precedent. No cut
proposed.

## 11. Known traps
- **No feature kind for a free pool (settled 2026-11-13: this packet adds `BogPool` under section 5's conditions; the
  hand-off must state, each one checked and not assumed, that option-off maps are byte-identical and that the map
  export format string, the map blob, the checkpoint format, the content hash and the map hash of every option-off
  map do not move, and say how each was checked).** Bog floor in a strict zone must be owned by a feature
  (`certify/features.rs:222` `feature-hazards`) of the zone (`pipeline/style_contract.rs:64-72`). Today the `Barrow`
  owns its crescent; test 9b forbids that for pools. No existing kind fits: `Barrow` and `Landmark` need wall pieces or
  template params, `Mere` is Frost's lake (its params count ice), `Causeway` and `Bush` mean other things. The clean way
  is a signature kind (for example `BogPool`: no params, no wall, no LOW, terrain 0, job `Crossing`) added like
  `LavaPool` in FIRE-1's stub (`aa22573a6`: `mapdata/model.rs`, `mapdata/validate.rs`, `certify/rules.rs`
  `SIGNATURE_KINDS`, `certify/features.rs`, `certify/diagnostics.rs`, `map_hash/mod.rs`). Those files are shared
  (`LANDMARK_GENERATION_SPEC.md` section 3): the landmark lane's coordinator widened this scope to them for the kind
  only. The certifier caps a map at 250 features (`R.features`) and `feature_grid` is `u8`; today's option-on maps
  hold 77-95 (section 12, M9).
- **"Barrows unchanged" (owner reading needed).** Legacy's barrow is a three-way fork: dry flank, wet crescent, tunnel
  (`warren.ts:2-5`, "the wet fork is its home advantage"). This oracle reads the requirement as: rock, tunnel, siting
  rule and number unchanged; the crescent becomes free pools (all of today's styler bog is crescent; with crescents
  kept, "today's share within a fifth" would leave the pools at most a fifth of today's bog). The barrow's wet fork is
  lost; its `Fork` job stays (dry flank, tunnel). If the owner meant the crescent to stay, tests 1-3, 6 and 9b change.
- **Large near the tree is rare (flagged number).** M5: a 12-across pool with its ring fits with its nearest tile in
  the near band on 9 of 32 seeds when barrows give way, 1 of 32 when they stay; mid band 12 / 2. The near band today
  is a 4-tile ring round a 13x15 footprint at the zone's outer edge, often off the map or the zone. The size rule is
  therefore pooled (test 4), and each band must fall back to the next size that fits (near 12 then 8; mid 12, 8 then 5;
  far 8 then 5; never large far or small near). Report the per-band sizes in the hand-off.
- **Pools before barrows.** If barrows are sited first (today's order) the measured capacity is 0.33-2.33 (median 0.76)
  times the target with the strict size per band, 0.40-2.33 (median 0.93) with fallback sizes: the median budget might
  pass while some maps carry a third of today's bog. Laying pools first gives 1.12-3.78. Barrows then give way; test 9
  holds them at 70% of option off (section 12, last subsection: the reservation alone takes them to 79%).
- **The walk test is an approximation of "off spawn routes".** The guard corridor is not on the finished map. Keeping
  pools off `corridor` (as `bog_at` does) is necessary, not sufficient: seed 25 shows a 3-step growth today. The
  implementer may need the zone's walk field (BFS to the coliseum) to keep a pool off every shortest walk.
- **Existing tests pin option-on output** (coordinator's lane; a changed Plague styler moves them; do not edit, list the
  new values in the hand-off):
  - `crates/rh-sim/tests/mapgen_signature_frost_lake.rs`: `seeds_with_the_lake_at_the_mouth_keep_their_maps`
    (`unchanged()`: attempt and `map_hash` of 30 seeds), `seeds_17_and_18_land_on_the_next_attempt_with_the_lake_at_the_mouth`
    (`moved()`: attempt and `map_hash`), and possibly `the_worst_attempt_stays_within_the_measured_margin` (worst attempt
    at most 5, stricter than this brief's 8).
  - `crates/rh-mapdress/tests/anchor.rs` `a_signature_map_stripped_of_its_anchors_is_dressed_as_today`
    (`NO_ANCHOR_GOLDEN`: whole-map dressing hashes of signature seeds 1-4): moves with any Plague change.
  - `crates/rh-mapdress/tests/marsh.rs` `every_zone_other_than_plague_is_dressed_as_before` (`SIG_GOLDEN`: other zones'
    dressing of signature seeds 1-4): moves if `dress` seeds from the map hash or reads Plague (likely). Both goldens are
    this lane's; regenerate as section 5 says and name them.
  - Comments naming option-on seeds and attempts: `mapgen_signature_aprons.rs:202`, `mapgen_signature_frost_lake.rs`.
- Stylers share one runtime state across zones (`mapgen/style_runtime/`): a changed Plague result changes the zones
  styled after it and every later stage.
- `crates/rh-sim/tests/content.rs` scans `src/` only (`sources`, `:383`); the oracle holds no `const` anyway.
- Option-on budget today is already uneven (on/off share ratio 0.57-1.55 per seed): crescents near the tree are clipped.

## 12. Measurement (oracle author, 2026-11-13, `b3a8fb516`, debug build, macOS arm64)
`report_seeds_1_to_32`, seeds 1-32, the attempt each seed certifies on. Free ground: Plague floor (bog included)
outside the tree's footprint and apron; option off all Plague floor. Share = styler bog / free ground. Room (M5): a
disc centre counts when every disc tile is Plague floor, unowned or today's styler bog, outside the apron, every camp
halo, every spawn's 5x5 pad and an approximate route band (steepest descent of each Plague spawn's walk, grown by 1),
and every ring tile (width 2) is Plague floor, unowned or styler bog, outside every halo; "give way" also counts barrow
tiles as free. Band of a disc = band of its tile nearest the tree. Capacity: a greedy packing of pools of two to four
discs of one size, 8 apart, rings clear, near band 12-across, mid 8, far 5 ("strict"; "fallback" adds smaller sizes),
over the target `off share x free ground on`.

| seed | att | styler bog on / off | share on / off % | ratio | pieces on / off | 12 room n/m/f (stay) | 8 room n/m/f (give way) | 12 room n/m/f (give way) | capacity stay strict / fallback | capacity give way strict / fallback | walk +steps | barrows on / off |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 0 | 210 / 284 | 4.91 / 6.21 | 0.79 | 12 / 12 | 0/0/0 | 3/8/130 | 0/0/0 | 1.03 / 1.03 | 2.07 / 2.27 | 0 | 9 / 11 |
| 2 | 0 | 313 / 404 | 7.51 / 9.14 | 0.82 | 11 / 12 | 0/0/0 | 9/0/96 | 0/0/3 | 0.54 / 0.54 | 1.22 / 1.42 | 0 | 11 / 13 |
| 3 | 0 | 220 / 396 | 5.15 / 8.87 | 0.58 | 8 / 11 | 0/0/0 | 44/24/87 | 0/0/0 | 0.93 / 1.14 | 1.56 / 1.93 | 0 | 10 / 12 |
| 4 | 0 | 370 / 405 | 9.21 / 9.55 | 0.96 | 15 / 14 | 0/0/0 | 13/24/93 | 0/0/1 | 0.55 / 0.56 | 1.59 / 1.85 | 0 | 13 / 15 |
| 5 | 0 | 389 / 355 | 9.21 / 7.84 | 1.17 | 11 / 11 | 0/0/0 | 13/35/257 | 0/7/51 | 0.99 / 1.10 | 1.90 / 2.15 | 0 | 11 / 12 |
| 6 | 0 | 229 / 270 | 5.45 / 5.90 | 0.92 | 8 / 9 | 0/7/1 | 0/46/58 | 0/13/1 | 1.49 / 1.49 | 2.04 / 2.14 | 0 | 9 / 10 |
| 7 | 0 | 258 / 266 | 6.05 / 5.84 | 1.04 | 6 / 8 | 0/0/3 | 19/29/152 | 1/0/17 | 1.07 / 1.20 | 1.98 / 2.31 | 0 | 8 / 9 |
| 8 | 2 | 329 / 245 | 8.12 / 5.35 | 1.52 | 12 / 6 | 0/0/0 | 36/61/60 | 6/1/0 | 0.41 / 0.64 | 2.74 / 3.11 | 0 | 12 / 10 |
| 9 | 2 | 195 / 332 | 4.59 / 7.34 | 0.63 | 14 / 8 | 0/0/0 | 0/33/157 | 0/0/30 | 0.71 / 0.71 | 1.75 / 1.99 | 0 | 13 / 12 |
| 10 | 0 | 350 / 376 | 8.50 / 8.49 | 1.00 | 10 / 11 | 0/20/23 | 14/62/173 | 0/41/27 | 0.62 / 0.93 | 1.62 / 1.80 | 0 | 14 / 13 |
| 11 | 1 | 245 / 366 | 5.84 / 8.32 | 0.70 | 13 / 9 | 0/0/0 | 1/8/115 | 0/0/2 | 0.63 / 0.85 | 1.31 / 1.85 | 0 | 11 / 13 |
| 12 | 0 | 314 / 459 | 7.57 / 10.67 | 0.71 | 11 / 12 | 0/0/0 | 0/22/64 | 0/4/0 | 0.40 / 0.40 | 1.12 / 1.10 | 0 | 12 / 14 |
| 13 | 0 | 363 / 443 | 8.90 / 10.14 | 0.88 | 10 / 11 | 0/0/0 | 11/77/357 | 0/22/37 | 0.70 / 0.88 | 1.67 / 1.97 | 0 | 13 / 14 |
| 14 | 0 | 247 / 357 | 5.74 / 7.89 | 0.73 | 8 / 11 | 0/0/0 | 10/14/60 | 0/0/0 | 0.94 / 1.05 | 1.65 / 1.77 | 0 | 10 / 11 |
| 15 | 0 | 263 / 323 | 6.20 / 7.19 | 0.86 | 9 / 12 | 0/0/0 | 0/0/113 | 0/0/2 | 0.94 / 0.94 | 1.76 / 1.80 | 0 | 10 / 11 |
| 16 | 1 | 249 / 364 | 5.98 / 8.23 | 0.73 | 12 / 15 | 0/0/0 | 42/85/39 | 7/18/0 | 0.64 / 1.05 | 1.65 / 2.02 | 0 | 13 / 15 |
| 17 | 1 | 270 / 297 | 6.47 / 6.41 | 1.01 | 12 / 8 | 0/0/0 | 0/9/16 | 0/0/0 | 0.78 / 0.97 | 1.56 / 2.00 | 0 | 13 / 9 |
| 18 | 3 | 390 / 358 | 9.37 / 8.23 | 1.14 | 11 / 11 | 0/0/0 | 10/65/133 | 1/8/1 | 0.66 / 0.88 | 1.73 / 1.74 | 0 | 13 / 13 |
| 19 | 0 | 212 / 386 | 4.94 / 8.64 | 0.57 | 10 / 10 | 0/0/1 | 26/12/271 | 2/0/72 | 0.75 / 0.98 | 1.40 / 1.94 | 0 | 10 / 14 |
| 20 | 0 | 259 / 285 | 6.22 / 6.43 | 0.97 | 10 / 11 | 0/0/0 | 0/31/267 | 0/11/62 | 0.50 / 0.65 | 1.72 / 2.27 | 0 | 12 / 12 |
| 21 | 0 | 289 / 325 | 7.04 / 7.34 | 0.96 | 11 / 9 | 0/0/0 | 40/38/155 | 14/0/7 | 0.46 / 0.62 | 1.53 / 1.84 | 0 | 13 / 14 |
| 22 | 0 | 305 / 405 | 7.43 / 9.26 | 0.80 | 13 / 14 | 0/0/0 | 12/31/53 | 2/0/0 | 0.75 / 0.75 | 1.35 / 1.46 | 0 | 14 / 15 |
| 23 | 0 | 229 / 204 | 5.35 / 4.48 | 1.19 | 8 / 9 | 3/0/0 | 25/63/206 | 3/21/31 | 2.33 / 2.33 | 3.78 / 4.36 | 0 | 9 / 11 |
| 24 | 0 | 427 / 451 | 10.62 / 10.52 | 1.01 | 12 / 13 | 0/0/0 | 61/115/159 | 18/44/35 | 0.33 / 0.48 | 1.53 / 1.66 | 0 | 14 / 15 |
| 25 | 0 | 332 / 419 | 7.96 / 9.56 | 0.83 | 12 / 12 | 0/0/0 | 0/17/109 | 0/0/8 | 0.77 / 0.87 | 1.34 / 1.59 | 3 | 13 / 14 |
| 26 | 0 | 234 / 239 | 5.49 / 5.30 | 1.04 | 12 / 13 | 0/0/0 | 0/13/347 | 0/0/107 | 1.55 / 1.92 | 2.65 / 3.11 | 0 | 10 / 12 |
| 27 | 0 | 264 / 287 | 6.10 / 6.36 | 0.96 | 12 / 10 | 0/0/0 | 9/12/133 | 0/0/1 | 1.50 / 1.51 | 2.19 / 2.23 | 0 | 10 / 11 |
| 28 | 0 | 164 / 237 | 3.79 / 5.33 | 0.71 | 11 / 12 | 0/0/8 | 0/0/154 | 0/0/23 | 1.07 / 1.59 | 2.08 / 2.88 | 0 | 10 / 12 |
| 29 | 0 | 291 / 284 | 6.98 / 6.35 | 1.10 | 12 / 12 | 0/0/0 | 0/0/159 | 0/0/11 | 0.77 / 0.77 | 1.45 / 1.91 | 0 | 14 / 13 |
| 30 | 0 | 318 / 329 | 7.55 / 7.37 | 1.02 | 14 / 15 | 0/0/0 | 9/6/281 | 0/0/74 | 0.95 / 1.07 | 1.71 / 1.77 | 0 | 13 / 13 |
| 31 | 0 | 206 / 222 | 4.92 / 4.98 | 0.99 | 10 / 10 | 0/0/0 | 1/37/318 | 0/10/104 | 1.64 / 1.86 | 2.60 / 3.72 | 0 | 11 / 11 |
| 32 | 1 | 474 / 322 | 11.48 / 7.38 | 1.55 | 12 / 10 | 0/0/0 | 12/0/250 | 0/0/55 | 0.60 / 0.73 | 1.90 / 2.37 | 0 | 14 / 13 |

Summary (min / median / max over seeds 1-32):
- **M1** styler bog option on 164 / 267 / 474, option off 204 / 330.5 / 459; the tree's own bog 60 / 72.5 / 100; free
  ground on 4019 / 4178.5 / 4330, off 4239 / 4460.5 / 4630; share on 3.79 / 6.35 / 11.48%, off 4.48 / 7.38 / 10.67%;
  on/off ratio 0.57 / 0.96 / 1.55.
- **M2** pieces per map on 6 / 11 / 15 (352 in all), off 6 / 11 / 15 (351); area on 1 / 21 / 90, off 1 / 28 / 142; box
  long side on 1 / 8 / 21; share of tiles in a full 3x3 block on 0 / 61 / 100%; inscribed r2 on 0 / 3 / 7. Thickness:
  the 3x3 share does not separate a crescent from a disc (a 5-across disc scores 100%, crescents score up to 100% too);
  the inscribed disc does: 346 of 352 option-on pieces hold no whole 5-across disc (r2 5), the other 6 are merged
  crescents (r2 7).
- **M3** nearest gap between distinct pieces on 1 / 5 / 32; pairs closer than 8: 203 on, 191 off.
- **M4** pieces by band (option on): near 32 (mean area 38.9), mid 69 (28.8), far 251 (23.8); core 0.
- **M5** room for one disc with its ring, seeds with at least one centre (of 32), near / mid / far: barrows stay: 5
  across 24 / 28 / 32, 8 across 4 / 8 / 28, 12 across 1 / 2 / 5; barrows give way: 5 across 31 / 32 / 32, 8 across 22
  / 27 / 32, 12 across 9 / 12 / 24. Capacity over target: barrows stay strict 0.33 / 0.76 / 2.33, fallback 0.40 / 0.93
  / 2.33; give way strict 1.12 / 1.69 / 3.78, fallback 1.10 / 1.95 / 4.36. Where the near-band 12 disc fails (centres
  near the tree, first failing tile in row order): its ring on barrow rock, other features' floor, camp halos or off
  the zone; the disc on the route band; the near band off the map (the tree stands at the zone's outer edge).
- **M6** attempt index option on 0 / 0 / 3 (11 refused attempts: 4 `Repair(RadiusPost)`, 4 `Signature`, 3
  `SignatureDiscarded`), option off 0 / 0 / 0.
- **M7** largest growth of a Plague spawn's walk when bog is avoided: on 0 / 0 / 3 (seed 25), off 0 / 0 / 7.
- **M8** Plague barrows on 8 / 12 / 14 (372), off 9 / 12.5 / 15 (397).
- **M9** features per map option on 77 / 86 / 95 (certifier cap 250), of which Plague 15 / 20 / 23: room for a few
  pool features per map.

What it implies:
- The owner's picture fits today's maps with the pools laid first: budget, gap, ring, keep-clear and all three sizes
  are reachable on every seed (large pools fit somewhere on 24-28 of 32 seeds when barrows give way). READY.
- **Flagged: "large near the tree".** A large pool fits in the near band on 9 of 32 seeds (1 with today's barrows). The
  oracle asks for it on average (near mean >= 2 x far mean), never per map. Measured alternative for the owner: count
  the mid band as "near" for the large size (12 of 32 seeds), or let the near band take medium pools (22 of 32).
- Barrows give way to pools: the number of barrows may drop (test 9 allows 15%); not measured, since no pool exists yet.

### Re-measured on `1032e5bd` (after P-MAPGEN-SIG-RESERVE-1), 2026-11-13, same report, seeds 1-32
The tree (still 13 x 15) now stands in a reserved 34-tile site that no camp halo touches; the other camps stand round
the site. The per-seed table above is the old base; rerun the report for the new one.

| | before (`b3a8fb516`) | now (`1032e5bd`) |
|---|---|---|
| M1 styler bog, option on | 164 / 267 / 474 | 105 / 238 / 358 |
| M1 share of free ground, option on (%) | 3.79 / 6.35 / 11.48 | 2.38 / 5.66 / 8.85 |
| M1 on/off share ratio (test 8) | 0.57 / 0.96 / 1.55 | **0.27 / 0.74 / 1.43** |
| M1 free ground, option on | 4019 / 4178.5 / 4330 | 4045 / 4252.5 / 4406 |
| M2 pieces, option on | 352 (346 hold no 5-across disc) | 303 (302) |
| M3 pairs of pieces closer than 8, option on | 203 | 151 |
| M4 pieces by band, near / mid / far (mean area) | 32 (38.9) / 69 (28.8) / 251 (23.8) | 57 (29.1) / 63 (20.5) / 183 (23.6) |
| M5 seeds with room for a 12-across pool and its ring, near / mid / far, barrows give way | 9 / 12 / 24 | **25 / 16 / 17** |
| M5 the same, barrows stay | 1 / 2 / 5 | 10 / 4 / 6 |
| M5 seeds with room for an 8-across pool, near / mid / far, barrows give way | 22 / 27 / 32 | 32 / 32 / 32 |
| M5 capacity over target, barrows give way, strict | 1.12 / 1.69 / 3.78 | 1.10 / 1.65 / 3.86 |
| M5 capacity over target, barrows give way, fallback | 1.10 / 1.95 / 4.36 | 1.48 / 2.08 / 3.87 |
| M5 capacity over target, barrows stay, strict / fallback (medians) | 0.76 / 0.93 | 0.93 / 1.29 (minimum 0.39 / 0.52) |
| M6 attempt index, option on | 0 / 0 / 3 | 0 / 0 / 1 (refusals before: 3 `Prefix`, 1 `Repair(RadiusPost)`, 5 `SignatureDiscarded`) |
| M7 largest walk growth when bog is avoided, option on | 0 / 0 / 3 | 0 / 0 / 2 |
| M8 Plague barrows, option on (total; option off 397) | 8 / 12 / 14 (372, 94%) | **6 / 9.5 / 13 (312, 79%)** |
| M9 features per map, option on (Plague) | 77 / 86 / 95 (15 / 20 / 23) | 71 / 82 / 88 (14 / 17 / 22) |

- **The budget is now a failing test, for the right reason.** Fewer barrows carry fewer crescents: today's option-on
  maps hold 0.74 of option off's bog share (median). With the pools laid first the target is reachable on every seed
  (capacity at least 1.10 times the target).
- **Large near the tree fits far more often for now** (25 of 32 seeds against 9): the site round the small tree is
  empty ground. SCALE-3's 29-tile tree fills the site, so this does not last; test 4 stays a rule on averages.
- **Barrows:** the reservation, not this packet, removes a fifth of them (397 to 312 over 32 maps). Test 9's floor is
  amended to 70% of option off, the same allowance as before (about a tenth of today's barrows may give way).

## NOT ESTABLISHED
- Nothing here is measured on a 29-tile tree (SCALE-3). After it the near and mid bands
  move outward and "far" nearly disappears (`LANDMARK_GENERATION_SPEC.md` section 2); tests 4 and 5 need near-band and
  far-band pools, so the band table `[2, 6, 14]` will need re-measuring then. The tree's own marsh (L3) is SCALE-3.
- M5's room and capacity are estimates on today's finished maps (a greedy packing, an approximate route band); the
  real implementation's barrows, attempt index and bog may differ.
- The look of the pools and the water and mud rings (P-LAND-PLAGUE-2) are not seen by the owner yet: the sheet of seeds
  1-8 is the first picture.

## Oracle files (read-only for implementers)
- `crates/rh-sim/tests/mapgen_land_plague.rs`
- this brief

## Notes from previous attempts
