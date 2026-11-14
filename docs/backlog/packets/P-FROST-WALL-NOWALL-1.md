# P-FROST-WALL-NOWALL-1: the caster is always sent its own Frost Wall

- **Serves:** owner beta follow-up decision 2 (MIGRATION, 2026-11-10: "Frost Wall replaces Freeze"), live since
  P-FROST-WALL-3; a defect seen in Web round 13 (2026-11-14)
- **Implementer tier:** implementer-opus (an `rh-sim` observation rule; `observe.rs` is a shared file)
- **Reviewer:** reviewer-opus
- **Integration base:** feature/unity-rework at the coordinator's staged tree `947958208`
- **D-rules touched:** D1 loose proof against the unreleased legacy patch `78dd8bd4`, with a proposed deviation (below) ·
  D2 n/a · parity fixtures run `Freeze` (no wall exists) and do not move · D5/D6/D9 none (C-OBS: the owner already knows
  where its wall stands; no new information reaches anyone else)

## 1. ID and outcome

What was seen (round 13, solo room, pool seed 263678495, map hash 75bf127e, `--signature-landmarks`): a Frost player
in the Plague bog beside the bog tree cast twice. Each time the aim preview was valid (tiles drawn), the cast effect
and target ring played, and the Wish went on its 45 s cooldown, but no wall ever reached the client. Screenshots:
`dk2-prev.png` (the preview), `dk-sheet.png` and `dk2-sheet.png` (the frames after the clicks).

Root cause (reproduced in the sim, see Established facts): the wall WAS raised. It stood, blocked bodies and spent the
Wish. It was not sent to its caster, because the observation shows a wall only when its FIRST end `(x1, y1)` is
visible to the viewer (`crates/rh-sim/src/status_runtime/observe.rs:106-113`; the field's `(x, y)` is the segment's
first end, `crates/rh-sim/src/systems/abilities/effects.rs:332-342`). Beside the bog tree, the trunk and root WALL
tiles hide that end from a caster who sees the rest of the wall. Near the map border the first end can also lie off
the map, where `scene_line_blocked` (`crates/rh-sim/src/vision.rs:303-310`) counts it as unseen.

When this lands, a standing wall is in its owner's observation (with its tiles) whatever the owner can see. Every other
viewer keeps today's first-end rule. The client then both draws the wall and predicts against it
(`client-unity/RoguehallaNet/Net/Ui/FrostWallAim.cs:80-95` `PlanMap` takes the tiles of every delivered wall), so no
client change is needed.

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
  for a wall the centre is `(x, y)`, the first end. Legacy hides an unseen-end wall from its own caster's DRAWING too.
- `packages/client/src/scenes/RaidScene.ts:1012-1029` `planMap`: legacy synced every field to every client
  (`packages/shared/src/schema.ts:374`, `fields: t.map(FieldState)`, unfiltered), and the plan map took the tiles of
  EVERY wall, seen or not. So a legacy caster always predicted against its wall even when it could not see it drawn.
- `packages/client/src/render/RaidVision.ts:60-65` `canSee`: the viewer's line-of-sight memory (plus wards).
- In-repo `packages/server/src/bots/brain/perception.ts:813-816` `seeFields`: bots use the same first-point rule.

Which side is wrong: neither port step differs from legacy's rule. The defect is that Rust made legacy's DRAWING rule
its only DELIVERY rule. Legacy's caster never saw such a wall drawn either (a legacy presentation bug), but its client
knew the wall. The Rust caster's client knows nothing about it. Matching legacy exactly would mean sending the tiles
without drawing them, which is a wire change for no gain. The smallest correct fix is the owner rule below, recorded as
a deviation.

## 4. New paths

- `crates/rh-sim/src/barriers_observe_tests.rs` (oracle)

## 5. Exclusive write scope

- `crates/rh-sim/src/status_runtime/observe.rs` (`project`: a `FieldKind::Wall` field whose `owner.id == Some(viewer)`
  passes the visibility test; nothing else changes)

Nothing else. In particular: no `OBSERVATION_VERSION` bump (the `FieldView` format does not change, only which walls one
viewer is sent; `crates/rh-sim/tests/frost_wall_observe.rs:342-348` pins 30), and no change to
`tests/frost_wall_observe.rs`.

## 6. Contracts and references

- C-OBS: a viewer is sent only what it may see. The owner placed the wall and its aim preview drew every tile, so the
  caster learns nothing new. The `owner` id in the view is already shown to the viewer itself
  (`observe.rs:114-116`).
- C-INPUT, C-TICK, C-RNG: untouched (an observation projection only).
- DEV-029 (Frost Wall in the live game). Proposed DEV-036, below.

## 7. Behaviour to preserve

- Non-owner viewers: the first-end rule exactly as `tests/frost_wall_observe.rs` pins it (a viewer who sees only the
  second end and some tiles receives nothing; the first-end viewer receives all tiles; a far viewer nothing, and no
  landing centre).
- Every other field kind's rule (Trail needs both points; the rest need `(x, y)`).
- The sim: wall placement, set-down, gap, cooldown, events, state hash, checkpoint. All parity fixtures (`Freeze`).
- The public snapshot (`observe.rs:120-134`) is unchanged.
- The aim vectors: `protocol/fixtures/frost_wall_aim_v1.json`'s 12 existing cases are byte-identical. This packet
  appends one case (below).

## 8. Acceptance checks

- `scripts/gate.sh --oracle packet/P-FROST-WALL-NOWALL-1` passes (full).
- `cargo test -p rh-sim --lib barriers::observe_tests`: 4 tests (3 red today on assertions, 1 guard).
- `cargo test -p rh-sim --test frost_wall_observe` stays green, unchanged.
- `cargo run -p rh-parity --bin frost-wall-aim-fixtures -- --check` passes, and so does
  `dotnet test client-unity/RoguehallaNet.Tests --filter FullyQualifiedName~FrostWallAim` (25, green today).

## Oracle files (read-only for implementers)

- `crates/rh-sim/src/barriers_observe_tests.rs`:
  - `the_caster_receives_its_wall_when_a_rock_hides_the_first_end` (red): the round-13 scene in a 40 x 20 room. Rock
    at (8..=9, 11..=13) hides the first end (400, 448) from Frost at (5, 10), and the caster sees rows 7..=10. The wall
    stands on column 12 rows 7..=13, the Wish is spent, and the caster's observation has 0 walls (expects 1, with those
    tiles).
  - `the_caster_receives_its_wall_even_when_none_of_it_is_in_sight` (red): a rock column hides the whole wall. The
    owner still receives it, and the bystander on the same side (not the owner, sees nothing) receives nothing (the
    guard half, green today).
  - `guard_on_open_floor_the_caster_and_a_bystander_in_sight_receive_the_wall` (green).
  - `round13_every_wall_cast_from_the_bog_by_the_tree_reaches_its_caster` (red): the round-13 map regenerated
    (`certified_styled(263678495, {decor: false, signature: true})`, as `crates/rh-server/src/map_pool.rs:89-114`).
    Frost stands on a lattice of bog tiles in and around the bog tree's footprint (with 2 tiles of margin) in the live
    content world, and casts 8 directions at 160 u and 300 u. Today: 119 of 389 raised walls never reach their caster.
    The test also requires at least one raised wall whose first end is out of the caster's sight, so it keeps testing
    the defect if the generator moves the tree. About 20 s in a debug build.
  - The `mod observe_tests` line in `crates/rh-sim/src/barriers.rs` (with the tests).
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
- `cargo run -p rh-parity --bin frost-wall-aim-fixtures -- --check`
- `dotnet test client-unity/RoguehallaNet.Tests --filter FullyQualifiedName~FrostWallAim`
- `scripts/gate.sh --quick --regen-fixtures`, then the full gate with `--oracle packet/P-FROST-WALL-NOWALL-1`

## 10. Risk and suggested model tier

Opus: `observe.rs` is shared and C-OBS sensitive. The change is a few lines in `project`: `f.kind == FieldKind::Wall &&
f.owner.id == Some(viewer)` short-circuits the visibility test. The risk is widening the rule by accident (any viewer,
or every field kind), which the existing `frost_wall_observe.rs` tests catch.

## 11. Known traps

- Do not change `scene_line_blocked` or `point_visible`. Vision serves actors, props, and every other field kind.
- Do not move the field's `(x, y)` to the wall's centre. That changes legacy's field geometry, the wire's `x, y`, and
  the existing pinned first-end tests.
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

## Proposed deviation (owner signs)

DEV-036 (proposed): legacy 78dd8bd4 draws a Frost Wall for a viewer only when the wall's first end is in the viewer's
sight, the caster included (`FieldView.ts:161-162`), but syncs every wall's tiles to every client for walk prediction
(`RaidScene.ts:1012-1029`). The port sends a wall only through the viewer's observation. The owner of a wall is always
sent it, with its tiles. Other viewers keep the first-end rule. Reason: Web round 13, a caster beside the bog tree
spent the Wish on walls it never saw and could not predict against.

## Not established

- Bystanders: a non-owner who cannot see the first end is still sent nothing. A Rust client then neither draws nor
  predicts a wall that blocks it (a rubber-band at the ice), where legacy predicted but did not draw. A rule such as
  "any of its tiles in sight" would fix that, but it contradicts the pinned
  `tests/frost_wall_observe.rs::the_wall_is_shown_by_its_first_point_as_every_non_trail_field_is` (the second-end
  viewer receives nothing). Changing that existing test needs the owner's approval, so it is left out of this packet.
- The exact positions of the two round-13 casts are unknown. The sweep shows the scene is common there, but which of
  the hidden-end classes each click hit is not established.
- The HUD's SLOWED status plays no part in the cause.

## Notes from previous attempts
