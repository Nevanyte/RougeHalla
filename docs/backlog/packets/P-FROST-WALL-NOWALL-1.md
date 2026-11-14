# P-FROST-WALL-NOWALL-1: a Frost Wall reaches its owner always, and every viewer who sees part of it

- **Serves:** owner beta follow-up decision 2 (MIGRATION, 2026-11-10: "Frost Wall replaces Freeze"), live since
  P-FROST-WALL-3; a defect seen in Web round 13 (2026-11-14)
- **Implementer tier:** implementer-opus (an `rh-sim` observation rule; `observe.rs` is a shared file)
- **Reviewer:** reviewer-opus
- **Integration base:** feature/unity-rework at the coordinator's staged tree `947958208`
- **D-rules touched:** D1 loose proof against the unreleased legacy patch `78dd8bd4`, with a proposed deviation
  (DEV-036, below) · D2 n/a · parity fixtures run `Freeze` (no wall exists) and do not move · D5/D6/D9 none (C-OBS
  kept, see section 6)
- **Amends a pinned oracle (coordinator-approved, flagged to the owner):**
  `crates/rh-sim/tests/frost_wall_observe.rs::the_wall_is_shown_by_its_first_point_as_every_non_trail_field_is` (from
  P-FROST-WALL-2) is renamed `the_wall_is_shown_to_a_viewer_who_sees_any_of_its_tiles`. Its second-end viewer now
  receives the whole wall. The module comment says why. Its other expectations are unchanged: the first-end viewer
  receives the whole wall with no owner, and neither viewer receives the landing centre.

## 1. ID and outcome

What was seen (round 13, solo room, pool seed 263678495, map hash 75bf127e, `--signature-landmarks`): a Frost player
in the Plague bog beside the bog tree cast twice. Each time the aim preview was valid (tiles drawn), the cast effect
and target ring played, and the Wish went on its 45 s cooldown, but no wall ever reached the client. Screenshots:
`dk2-prev.png` (the preview), `dk-sheet.png` and `dk2-sheet.png` (the frames after the clicks).

Root cause (reproduced in the sim, see Established facts): the wall WAS raised. It stood, blocked bodies and spent the
Wish. It was not sent, because the observation shows a wall only when its FIRST end `(x1, y1)` is visible to the viewer
(`crates/rh-sim/src/status_runtime/observe.rs:106-113`; the field's `(x, y)` is the segment's first end,
`crates/rh-sim/src/systems/abilities/effects.rs:332-342`). Beside the bog tree, the trunk and root WALL tiles hide that
end from a caster who sees the rest of the wall. Near the map border the first end can also lie off the map, where
`scene_line_blocked` (`crates/rh-sim/src/vision.rs:303-310`) counts it as unseen. The same rule hides a wall from a
bystander who sees most of it. That viewer is then blocked by ice it was never shown, and its client's walk
prediction rubber-bands against it.

When this lands, a standing wall is in a viewer's observation, with ALL its tiles:
1. always, when the viewer is its owner (`f.owner.id == Some(viewer)`);
2. otherwise, when at least one of its tiles is visible to the viewer (`vision::point_visible` on the tile's centre,
   the same test today applies to the first end);
3. never otherwise.

Every other field kind keeps its rule. The cast-landed centre keeps its own point rule. The client then draws the wall
and predicts against it (`client-unity/RoguehallaNet/Net/Ui/FrostWallAim.cs:80-95` `PlanMap` takes the tiles of every
delivered wall), so no client change is needed.

## 2. Dependencies

None beyond the base. Serial with any packet touching `crates/rh-sim/src/status_runtime/observe.rs`, which is shared.

## 3. Relevant legacy paths (unreleased patch `78dd8bd4`; read with `git show 78dd8bd4:<path>`)

- `packages/server/src/sim/abilities.ts:543-615` `raiseWall`: the wall field gets `x: seg.x1, y: seg.y1`
  (`:596`). A wall left with no tile returns before `addField` (`:551`, `:594`) after the cast has already landed, so
  the Wish is spent. Rust does the same (`effects.rs:303-305`, `:328-330`). This is not the defect, but it is the
  other accepted-but-no-wall case (see Established facts).
- `packages/shared/src/barriers.ts:54-78` `wallCells`: FLOOR (`tiles[i] === TILE_FLOOR`) only, with no terrain test.
  Rust `crates/rh-sim/src/barriers.rs:91-124` and the C# mirror `FrostWallAim.cs:43-66` read the same class.
- `packages/client/src/render/FieldView.ts:151-162` `update`: a field is drawn only when `canSee(centre)` holds, and
  for a wall the centre is `(x, y)`, the first end. Legacy hides an unseen-end wall from every viewer's DRAWING, the
  caster's included.
- `packages/client/src/scenes/RaidScene.ts:1012-1029` `planMap`: legacy synced every field to every client
  (`packages/shared/src/schema.ts:374`, `fields: t.map(FieldState)`, unfiltered), and the plan map took the tiles of
  EVERY wall, seen or not. So every legacy client predicted against every wall, drawn or not.
- `packages/client/src/render/RaidVision.ts:60-65` `canSee`: the viewer's line-of-sight memory (plus wards).
- In-repo `packages/server/src/bots/brain/perception.ts:813-816` `seeFields`: bots use the same first-point rule.

Which side is wrong: the port matches legacy's DRAWING rule but uses it as its only DELIVERY rule. Legacy never drew
such a wall either (a legacy presentation bug), but every legacy client knew it and predicted against it. The Rust
client knows nothing about it. Matching legacy exactly would mean sending every wall to everyone and hiding it, which
leaks walls out of sight (C-OBS) for no gain. The fix sends a wall to whoever can see part of it, and always to its
owner. It is recorded as DEV-036.

## 4. New paths

- `crates/rh-sim/src/barriers_observe_tests.rs` (oracle)

## 5. Exclusive write scope

- `crates/rh-sim/src/status_runtime/observe.rs`, `project` only: for a `FieldKind::Wall` field, replace the first-end
  test with "owner is the viewer, or any tile of its barrier row is `point_visible`". The tiles are indices into the
  arena map, so the centre of `i` is `((i % w) + 0.5) * TILE, ((i / w) + 0.5) * TILE` with `w = sim.k.arena.map.w`.
  Stop at the first visible tile.

Nothing else. Identities: none move. The `FieldView` shape, the field set it carries and the wire encoding are
unchanged. Only WHEN a wall row is present for a viewer changes, which is a projection rule and not a format, so
`OBSERVATION_VERSION` stays 30 (`crates/rh-sim/tests/frost_wall_observe.rs:342-348` and
`crates/rh-policy/tests/frost_wall_delivery.rs:15-26` pin it), and `POLICY_CONTRACT_VERSION` stays 24.

## 6. Contracts and references

- C-OBS: a viewer is sent only what it may see. The owner placed the wall and its aim preview drew every tile. Any
  other recipient sees part of the wall, and a wall is a straight run of at most about 17 tiles along one 224 u segment
  (14 the most seen in the sweeps), so the visible part already implies its extent. A viewer who sees none of it gets
  nothing. The `owner` id stays redacted unless the owner is seen (`observe.rs:114-116`).
- C-INPUT, C-TICK, C-RNG: untouched (an observation projection only).
- DEV-029 (Frost Wall in the live game). Proposed DEV-036, below.

## 7. Behaviour to preserve

- A viewer who sees no tile of the wall and is not its owner receives nothing (`frost_wall_observe.rs`
  `a_viewer_out_of_sight_receives_neither_the_wall_nor_its_landing_centre`; the guard half of
  `the_caster_receives_its_wall_even_when_none_of_it_is_in_sight`).
- The landing centre (`SeenEvent::CastLanded`) keeps its own point rule (`observe.rs` `to_seen`,
  `wish_point_permissions`). The amended test still checks that neither end viewer receives it.
- Every other field kind's rule (Trail needs both points; zone and cloud need `(x, y)`): `observe.rs` unit tests
  `trail_requires_both_endpoints_and_hidden_fields_equal_absence` and the rest, unchanged.
- The sim: wall placement, set-down, gap, cooldown, events, state hash, checkpoint. All parity fixtures (`Freeze`).
- The public snapshot (`observe.rs:120-134`) is unchanged.
- The aim vectors: `protocol/fixtures/frost_wall_aim_v1.json`'s 12 existing cases are byte-identical. This packet
  appends one case (below).
- Allocation: the tile test must allocate nothing (iterate the barrier row; no collected list). No existing oracle
  covers observation with a wall standing. `barrier_observe_no_alloc` concerns the shield vital "barrier", not walls,
  and observing a wall already costs one block per wall per observation today (`FieldView::from_field` clones the
  tiles; measured on the base: 10 blocks for 10 warmed `observe_into` calls with one wall standing). This packet does
  not change that and adds no guard for it.

## 8. Acceptance checks

- `scripts/gate.sh --oracle packet/P-FROST-WALL-NOWALL-1` passes (full).
- `cargo test -p rh-sim --lib barriers::observe_tests`: 5 tests (4 red today on assertions, 1 guard).
- `cargo test -p rh-sim --test frost_wall_observe`: the amended test is red today, the other 7 are green; all 8 green
  after.
- `cargo test -p rh-policy --test frost_wall_delivery`, `cargo test -p rh-server --test frost_wall_live_room` stay
  green. They state no visibility rule. Checked: neither, nor the C# or JS vector tests, models wall visibility, so
  nothing else states the old rule.
- `cargo run -p rh-parity --bin frost-wall-aim-fixtures -- --check` passes, and so does
  `dotnet test client-unity/RoguehallaNet.Tests --filter FullyQualifiedName~FrostWallAim` (25, green today).

## Oracle files (read-only for implementers)

- `crates/rh-sim/src/barriers_observe_tests.rs` (with its `mod observe_tests` line in `crates/rh-sim/src/barriers.rs`):
  - `the_caster_receives_its_wall_when_a_rock_hides_the_first_end` (red): the round-13 scene in a 40 x 20 room. Rock
    at (8..=9, 11..=13) hides the first end (400, 448) from Frost at (5, 10), and the caster sees rows 7..=10. The wall
    stands on column 12 rows 7..=13, the Wish is spent, and the caster's observation has 0 walls (expects 1, with those
    tiles).
  - `the_caster_receives_its_wall_even_when_none_of_it_is_in_sight` (red): a rock column hides the whole wall from its
    caster, who still receives it (the owner rule, not the tile rule). Its guard half is green today and after: the
    bystander on the caster's side sees no tile and receives nothing.
  - `a_bystander_who_sees_a_middle_tile_but_not_the_first_end_receives_the_whole_wall` (red): a rock screen at columns
    15..=16 with a gap at row 10. The bystander at (20, 10) sees the middle tile (12, 10) but not the first end or the
    end tiles. It must receive all 7 tiles with no owner. Today it gets 0 walls.
  - `guard_on_open_floor_the_caster_and_a_bystander_in_sight_receive_the_wall` (green).
  - `round13_every_wall_cast_by_the_bog_tree_reaches_its_caster_and_the_bystanders_who_see_part_of_it` (red): the
    round-13 map regenerated (`certified_styled(263678495, {decor: false, signature: true})`, as
    `crates/rh-server/src/map_pool.rs:89-114`), in the live content world. Frost stands on a lattice of bog tiles in
    and around the bog tree's footprint (2 tiles of margin), with a Plague bystander 3 tiles away. Frost casts 8
    directions at 160 u and 300 u. Today 119 of 389 raised walls never reach their caster, and 74 of the 76 walls the
    bystander saw in part, without the first end, never reach the bystander. The test also requires at least one wall
    with a hidden first end and at least one partly seen by the bystander, so it keeps testing the defect if the
    generator moves the tree. About 40 s in a debug build.
- `crates/rh-sim/tests/frost_wall_observe.rs`: the amendment above (commit `oracle-amend`).
- `crates/rh-parity/src/frost_wall_goldens.rs`: a new map `bog_tree` (a literal 32 x 28 copy of the round-13 tree,
  map x 106..=137, y 8..=35) and case `bog_tree_past_trunk` (Frost on bog at map (122, 22) aims 160 u south past
  the trunk). Green: the C# mirror gives the server's tiles, map row 27 columns 119..=124, the same six tiles the live
  sim raised for that cast.
- `protocol/fixtures/frost_wall_aim_v1.json`: regenerated inside this packet with
  `cargo run -p rh-parity --bin frost-wall-aim-fixtures`. It is purely additive (932 lines inserted, none changed; the
  12 existing cases, the 5 existing maps and the header are identical).

## 9. Validation commands

- `cargo test -p rh-sim --lib barriers::observe_tests`
- `cargo test -p rh-sim --test frost_wall_observe`
- `cargo test -p rh-sim --lib status_runtime::observe` (the other field kinds' rules)
- `cargo test -p rh-sim --test barrier_observe_no_alloc` and `--test frost_wall_no_alloc` (stay green; see section 7
  for what they do and do not cover)
- `cargo test -p rh-policy --test frost_wall_delivery`; `cargo test -p rh-server --test frost_wall_live_room`
- `cargo run -p rh-parity --bin frost-wall-aim-fixtures -- --check`
- `dotnet test client-unity/RoguehallaNet.Tests --filter FullyQualifiedName~FrostWallAim`
- `scripts/gate.sh --quick --regen-fixtures`, then the full gate with `--oracle packet/P-FROST-WALL-NOWALL-1`

## 10. Risk and suggested model tier

Opus: `observe.rs` is shared and C-OBS sensitive. The change is a few lines in `project`. The risks are widening the
rule by accident (every field kind; or sending a wall to a viewer who sees no tile) and allocating per tile. The
existing `frost_wall_observe.rs` and `observe.rs` unit tests and the guards here catch the first.

## 11. Known traps

- Do not change `scene_line_blocked` or `point_visible`. Vision serves actors, props, and every other field kind.
- Do not move the field's `(x, y)` to the wall's centre. That changes legacy's field geometry, the wire's `x, y`, and
  the landing tests.
- Keep the first-end test as well, or make sure it is implied. A first end always lies within a tile of the wall's
  tiles, but a wall whose first end is visible and none of whose tiles is visible can exist (tiles on the far side of
  a corner). The amended test's first-end viewer also sees two tiles, so either form passes. "Owner, or first end
  visible, or any tile visible" is the safe reading.
- A test fighter's first sight memory comes from its dealt spawn (round-robin), and it lasts 30 s
  (`VISION_TRAIL_MS`). The room tests step 640 ticks before casting for that reason (as `frost_wall_observe.rs` does).
- The owner may die while its wall stands (the wall outlives its caster). `observe` returns early for an unseated
  viewer (`observe.rs:101`); what a dead owner is sent is not pinned here.

## Established facts (the investigation)

- (c), the cause, was reproduced in the live content world on the round-13 map (hash checked: 75bf127e). Sweep: every
  floor tile on a 2-tile lattice within 6 tiles of the bog tree's footprint, rows 5 and below, 16 directions x
  {160, 300, 440} u. Of 29 232 accepted casts that spent the Wish, 7 177 raised a wall that its caster's observation
  did not carry: 3 982 with the first end behind WALL, 2 354 with the first end on a WALL tile, and 841 with it off the
  map. In 4 182 of those, at least one of the wall's tiles was in the caster's line of sight. With the caster on bog
  tiles only: 1 828 of 4 992. The example in the vector: caster on bog at (122, 22), cursor 160 u south. The wall
  stands on (119..=124, 27), the first end (3808, 880) is behind the trunk at (120..=122, 25..=26), and the caster is
  sent 0 fields.
- Bystanders: in the oracle's lattice, 74 of the 76 walls a bystander 3 tiles from the caster saw in part, without the
  first end, were not sent to it.
- (a) ruled out: bog is a FLOOR tile (class 0) with terrain code 5 (`crates/rh-sim/tests/mapgen_land_plague.rs:19`).
  The sim, legacy and the C# mirror all take FLOOR by class, and the Welcome blob's classes are the arena's
  (`crates/rh-server/src/room.rs:373`, `public_ground.rs` `encode_landmark_map` passes `&map.tiles`). The new vector
  shows the mirror equal to Rust on the tree. Marsh, ember, ice, lava and crevasse are terrain codes on FLOOR, and
  LOW/fence tiles are class 2. Both sides skip class 2 and take class 0.
- (b) the no-tile case exists and matches legacy: a cast whose wall has no FLOOR tile (for example aimed into the
  border) lands, spends the Wish and raises nothing (`effects.rs:303-305`; legacy `abilities.ts:551`). In the sweep,
  1 036 of 29 232 casts, all aimed into rock or off the map. The mirror shows those previews as invalid (no tiles),
  which is not what round 13 showed. Not changed here. If the owner wants a refund, that is its own packet.
- (d) ruled out at the tile level: the tree's tiles reach the client as the same classes the sim blocks on. Dressing is
  not an input to placement on either side.
- (e) not reached: the wall never left the server.

## Proposed deviation (the coordinator adds the row; the owner signs)

DEV-036 (proposed): a standing Frost Wall is sent to its owner always, and to any other viewer who can see at least
one of its tiles, with all its tiles. Legacy `78dd8bd4` syncs every wall to every client, predicts walks against all
of them (`RaidScene.ts:1012-1029`), and draws a wall only when its first end is visible (`FieldView.ts:161-162`).
Rust's first port sent a wall only when its first end was visible, so a caster or bystander could be blocked by ice
that was never drawn. Evidence: on the round-13 map, 7 177 of 29 232 accepted casts around the bog tree (1 828 of
4 992 from bog tiles) raised a wall that never reached its caster, and 74 of 76 walls a nearby bystander saw in part
never reached the bystander. Reversible (a projection rule).

## Not established

- The exact positions of the two round-13 casts are unknown. The sweep shows the scene is common there, but which of
  the hidden-end classes each click hit is not established.
- Bots (`rh-policy`) read the same observation, so they now see walls they see part of. No bot test pins the old
  delivery, and how the Brain uses that is not checked here.
- The HUD's SLOWED status plays no part in the cause.

## Notes from previous attempts
