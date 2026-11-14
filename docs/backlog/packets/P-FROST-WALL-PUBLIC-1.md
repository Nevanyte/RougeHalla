# P-FROST-WALL-PUBLIC-1: a standing Frost Wall is temporary terrain, sent to every seated viewer

- **Serves:** owner beta follow-up decision 2 (MIGRATION, 2026-11-10: "Frost Wall replaces Freeze"; DEV-029), and the
  owner's answer of 2026-11-14 (chat) to "a Frost Wall is sent to its owner always and to any viewer who sees one of its
  tiles; legacy sent every wall to everyone. Accept as DEV-036?": **"to avoid bugs and stay consistent please send to
  everyone, it effectively should be a temp wall within the engine"**
- **Implementer tier:** implementer-opus (an `rh-sim` observation rule in a shared file; its oracle spans `rh-sim` and
  `rh-policy`)
- **Reviewer:** reviewer-opus
- **Integration base:** `coord/int-43` (the coordinator's staging head; holds P-FROST-WALL-NOWALL-1, `b87d88fb6`), for
  `feature/unity-rework` (`docs/agent/INTEGRATION_BRANCH`)
- **D-rules touched:** D1 loose proof against the unreleased legacy patch `78dd8bd4` (delivery now matches legacy's
  "every wall to every client"; the one remaining difference is the owner id, section 6) · D2 n/a · parity fixtures run
  `Freeze` (no wall exists) and do not move · D5/D6/D9 none (C-OBS: the wall is classified as public terrain, the owner
  stays hidden; proposed C-OBS sentence below)
- **Amends pinned oracles (owner-directed by the decision above):** two existing tests expected a viewer who sees none of
  the wall to be sent nothing; both now expect the wall (commits `oracle-amend:`). Listed in "Oracle files".

## 1. ID and outcome

A standing Frost Wall is temporary terrain: public like the map. When this lands, `project` in
`crates/rh-sim/src/status_runtime/observe.rs` puts every standing wall (`FieldKind::Wall`), whole (kind, ability, both
ends `x, y, x2, y2`, `r`, `started_at`, `ends_at`, every tile of its barrier row), into the observation of every
**seated** viewer (`sim.player(viewer)` is `Some`), alive or dead, wherever it stands and whatever it sees.

Unchanged:
- The owner (`FieldView.owner`) is named only to the owner itself and to a viewer whose observation carries the owner
  as a visible actor (the `seen` closure passed to `FieldView::from_field`, `observe.rs:152-154`). A far or dead viewer is
  sent the wall with `owner: None`. `subject` keeps the same rule.
- Zone and cloud fields need `(x, y)` visible; a trail needs both ends visible (`observe.rs:137-138`).
- An unseated viewer gets no field at all (`observe.rs:100-103`).
- `public()` (`observe.rs:165-179`, spectators, replays, results) is unchanged: it already carries every wall with its
  owner.
- The landing centre (`SeenEvent::CastLanded`) keeps its own point rule (`observe.rs` `to_seen`,
  `wish_point_permissions`): a viewer that does not see the centre is not sent it, even though it is now sent the wall.
- A warmed observation with a wall standing allocates nothing (the tile copy reuses the slot's buffer,
  `observe.rs:143-155`); pinned now by `tests/frost_wall_observe_no_alloc.rs`.

The world under `SimConfig::default()` (`frost_wish: Freeze`) never holds a wall, so every parity fixture is untouched.

## 2. Dependencies

P-FROST-WALL-NOWALL-1 (merged in `coord/int-43`, `b87d88fb6`): this packet replaces its tile-sight rule. Serial with any
packet touching `crates/rh-sim/src/status_runtime/observe.rs` (a shared file).

## 3. Relevant legacy paths (unreleased patch `78dd8bd4`; read with `git show 78dd8bd4:<path>`)

- `packages/shared/src/schema.ts:374` `fields: t.map(FieldState)`: every field, wall included, is synced to every client
  unfiltered, with its `owner` id. This packet matches that for walls, except the owner id (section 6).
- `packages/client/src/scenes/RaidScene.ts:1012-1029` `planMap`: every client's walk prediction takes the tiles of
  every wall, drawn or not. With every wall delivered, the Rust client's `FrostWallAim.PlanMap`
  (`client-unity/RoguehallaNet/Net/Ui/FrostWallAim.cs:80-95`) does the same.
- `packages/client/src/render/FieldView.ts:151-162` `update`: legacy DRAWS a field only when `canSee(centre)` holds;
  for a wall the centre is its first end. Drawing is the client's business and out of scope here (NOT ESTABLISHED).
- In-repo `packages/server/src/bots/brain/perception.ts:813-825` `seeFields`: legacy bots keep a field only when
  `s.canSee(f)` (its first point; trail: both points) holds AND it is in the frame box (`fieldInView`). See section 11
  for the Rust composer, which keeps only the box test.

## 4. New paths

- `crates/rh-sim/src/barriers_public_tests.rs` (oracle; its `mod public_tests` line in `crates/rh-sim/src/barriers.rs`)
- `crates/rh-sim/tests/frost_wall_observe_no_alloc.rs` (oracle, a guard)
- `crates/rh-policy/tests/frost_wall_public_delivery.rs` (oracle)

## 5. Exclusive write scope

- `crates/rh-sim/src/status_runtime/observe.rs`, `project` only (and its comment): for `FieldKind::Wall`, `shown` is
  `true`. Keep the early return for an unseated viewer, the owner/subject redaction, the other three kinds' arms, and the
  slot-buffer reuse for the tiles. `tile_centre`, `w` and the per-tile sight test become dead: remove them (clippy
  `-D warnings`).

Nothing else. The amended and new oracle files are read-only. If a release test in section 8 moves, stop and report
it; do not edit it.

## 6. Contracts and references

- C-OBS (`docs/CONTRACTS.md` "C-OBS: views and leaks"): a viewer is sent only what it may see. The owner's decision
  classifies a standing wall as temporary terrain, which every viewer may know as it knows the map (the Welcome's map
  blob is sent to everyone, `crates/rh-server/src/room.rs:373`). The actor stays hidden: **the one remaining difference
  from legacy** is that legacy synced the wall's `owner` id to every client (`schema.ts:374`), and Rust names the owner
  only to the owner and to a viewer who sees the owner. That keeps C-OBS for actors and is not changed here.
- C-INPUT, C-TICK, C-RNG: untouched (an observation projection only; no sim state, no draw).
- DEV-029 (Frost Wall in the live game), DEV-036 (rewritten below).

### Version rulings (from the code's own histories)

- `OBSERVATION_VERSION` stays **30**. The written rules tie a bump to the observation's format: `crates/rh-sim/AGENTS.md`
  ("Bump the identity whose format changed"), `docs/CONTRACTS.md` C-OBS ("Any new observation field ... bumps
  `OBSERVATION_VERSION`"). This packet adds no field and changes no shape or value range: a seat under 30 can already
  be sent a wall none of whose tiles it sees (its own, by P-FROST-WALL-NOWALL-1's owner rule), so a policy built for 30
  already handles every row it can now receive. P-FROST-WALL-NOWALL-1 widened the same rule without a bump.
  Counter-precedents exist and are stated so the reviewer can weigh them: observation 18 -> 19 (`f61faa566`, redacting
  private Trophy offers) and 21 -> 22 with policy 15 -> 16 (`37a025420`, "reserves the observation-knowledge change of the
  Card bleed public `Hit` projection") bumped for knowledge changes. Both introduced or removed a kind of knowledge no
  version-matched policy had; this one does not. Pinned (unchanged): `crates/rh-sim/tests/frost_wall_observe.rs`
  `the_observation_identity_moves_for_the_wall` and `crates/rh-policy/tests/frost_wall_delivery.rs`
  `identities_move_for_the_wall`.
- `POLICY_CONTRACT_VERSION` stays **25**. Its doc (`crates/rh-policy/src/lib.rs:26-27`) defines it as "observation +
  command shapes + cadence rules"; none moves. Pinned by the same `identities_move_for_the_wall`.

### Proposed shared-record edits (coordinator; the owner's words above are the signature)

`docs/DEVIATIONS.md`, the DEV-036 row, replaced by:

> | DEV-036 | observation | Every Frost Wall is synced to every client with its owner id (`RaidState.fields`,
> unreleased legacy `78dd8bd4` `schema.ts:374`); the client draws one only when its first end is visible
> (`FieldView.ts:161-162`) and predicts walks against all of them (`RaidScene.ts:1012-1029`). | A standing Frost Wall is
> temporary terrain: every seated viewer, alive or dead, is sent every standing wall, whole (both ends, tiles, start and
> end times, ability), wherever it stands (`crates/rh-sim/src/status_runtime/observe.rs` `project`). The owner is named
> only to the owner and to a viewer who sees the owner, so a viewer who does not see the caster is sent the wall without
> its owner; legacy sent the owner id to everyone. Zone, cloud and trail fields keep their sight rules; an unseated
> viewer gets nothing. | Owner decision 2026-11-14 (chat): "to avoid bugs and stay consistent please send to everyone,
> it effectively should be a temp wall within the engine". The first port's first-end rule left casters blocked by ice
> they were never sent (Web round 13: 7,177 of 29,232 wall casts by the bog tree never reached their caster), and the
> interim tile-sight rule (P-FROST-WALL-NOWALL-1) still left a viewer blocked by ice it could not see. The owner id stays
> hidden by C-OBS (actors are seen only in sight). | `crates/rh-sim/src/barriers_public_tests.rs` (room and round-13
> map: every wall reaches every seated viewer, far and dead included; other field kinds withheld),
> `crates/rh-sim/tests/frost_wall_observe.rs`, `crates/rh-policy/tests/frost_wall_public_delivery.rs`;
> P-FROST-WALL-PUBLIC-1 | reversible (one rule) | signed by the owner 2026-11-14 (chat, the words above); the owner-id
> difference from legacy is C-OBS, not part of the signature |

`docs/CONTRACTS.md`, "C-OBS: views and leaks", one sentence appended to the first bullet (after "`observe` wraps it)."):

> A standing Frost Wall (`FieldKind::Wall`) is temporary terrain, public like the map: every seated viewer's observation
> carries every standing wall whole, whatever it sees; its owner is named only to a viewer who sees the owner
> (owner decision 2026-11-14, DEV-036).

## 7. Behaviour to preserve

- The sim: wall placement, set-down, gap, cooldown, events, state hash, checkpoint, replay. All parity fixtures
  (`Freeze`).
- `observe.rs` unit tests (`cargo test -p rh-sim --lib status_runtime::observe`), especially
  `trail_requires_both_endpoints_and_hidden_fields_equal_absence` and `source_departure_keeps_trail_geometry_but_redacts_owner`.
- `frost_wall_observe.rs`: the landing-centre expectations, `an_unseated_viewer_receives_no_wall_and_no_landing_centre`,
  `the_public_snapshot_carries_the_standing_wall`, `the_wall_leaves_every_observation_when_it_falls` (a fallen wall is in
  no observation), `guard_with_freeze_no_observation_contains_a_wall`.
- `barriers_observe_tests.rs`: every test (the round-13 caster/bystander test stays green under the wider rule).
- `frost_wall_delivery.rs`, `frost_wall_live_room.rs`: green, no edit.
- The aim vectors `protocol/fixtures/frost_wall_aim_v1.json` (no regeneration: no case in it models delivery or
  visibility; `bog_tree_past_trunk` is an aim case, the caster's own tiles).
- Allocation: `tests/frost_wall_observe_no_alloc.rs` (0 blocks per warmed observation for the caster, a viewer in
  sight and a viewer behind a screen, through the live `ItemObserver` + `SightCache` path), and the other `*_no_alloc.rs`.

## 8. Acceptance checks

- `scripts/gate.sh --oracle packet/P-FROST-WALL-PUBLIC-1` passes (full).
- `cargo test -p rh-sim --lib barriers::public_tests`: 3 tests, red today, green after.
- `cargo test -p rh-sim --lib barriers::observe_tests`: 5 tests; the amended one is red today, all green after.
- `cargo test -p rh-sim --test frost_wall_observe`: the amended test is red today, the other 7 green; all 8 after.
- `cargo test -p rh-sim --test frost_wall_observe_no_alloc`: green today and after.
- `cargo test -p rh-policy --test frost_wall_public_delivery`: red today, green after; `--test frost_wall_delivery` green.
- `cargo test -p rh-server --test frost_wall_live_room`: green (unchanged; its second client stands in sight).
- Release tests, which must stay green and were not run by the oracle author (a full gate was running on the machine):
  `cargo test --release -p rh-headless --test frost_wall_bots --test frost_wall_live --test brain_choices`. None pins a
  delivered-wall count: `frost_wall_bots` needs `peel_walls >= 1` over seeds 2, 3, 6 and no stall; `frost_wall_live` is a
  no-stall smoke; `brain_choices` checks choice kinds and byte-identical stores between two runs of the same build.
  HumanBot does not read delivered walls at all (its `wall_between`, `crates/rh-policy/src/bots/wish/source_core.rs:197`,
  places a wall from the foe's position). The Brain composer does (`compose14.rs:988-1003`, the frame-box filter), so a
  Brain may now see a wall behind cover inside its frame box and choose differently. If a count moves, the expected
  amendment is the coordinator's to approve, with this reason; do not loosen the test.

## Oracle files (read-only for implementers)

New (commit `oracle:`):
- `crates/rh-sim/src/barriers_public_tests.rs` (with `mod public_tests` in `crates/rh-sim/src/barriers.rs`):
  - `every_seated_viewer_far_or_dead_receives_the_whole_wall_and_only_a_viewer_who_sees_the_caster_is_told_the_owner`
    (red): a 40 x 20 room with a full rock screen on columns 20..=21. Frost at (5, 10) raises its wall on column 12,
    rows 7..=13. A viewer at (8, 4) sees it and the caster; a viewer at (30, 10) behind the screen sees no tile, no end
    and not the caster; a viewer at (6, 16) is killed after the wall rises. Each must be sent the public row, with the
    owner only where the caster is in its observation (caster, near: named; far, dead: `None`). Today the far and dead
    viewers get 0 walls.
  - `zone_cloud_and_trail_fields_are_still_withheld_from_a_viewer_who_cannot_see_them` (red): the same room with the
    wall standing, plus a zone, a cloud and a trail west of the screen. The near viewer gets all four kinds (guard); the
    far and dead viewers must get exactly `[Wall]`. Today they get `[]`. The zone/cloud/trail half is green today and
    must stay green.
  - `round13_every_wall_cast_by_the_bog_tree_reaches_every_seated_viewer_far_or_dead` (red): the Web round 13 map
    (`certified_styled(263678495, {decor: false, signature: true})`, as P-FROST-WALL-NOWALL-1), live content world. Frost
    on bog at map (122, 22) (the aim vector `bog_tree_past_trunk`'s spot) casts in 8 directions at 160 and 300 u; seated
    with it: a viewer 3 tiles away, a viewer on the floor tile farthest from the caster, and a viewer 3 tiles away who is
    dead when observed. Every raised wall must reach all four, whole, owner as above, and the far viewer is never told
    the owner. The scene asserts that the far viewer sees none of any raised wall (`vision::point_visible`, the rule
    `project` uses today). Today: 35 problems over 16 raised walls. About 15 s in a debug build.
- `crates/rh-sim/tests/frost_wall_observe_no_alloc.rs`:
  `warmed_observations_with_a_frost_wall_standing_allocate_no_blocks_for_any_viewer` (green guard; measured `[0, 0, 0]`
  today).
- `crates/rh-policy/tests/frost_wall_public_delivery.rs`:
  `a_bot_seat_behind_a_rock_screen_receives_the_standing_wall_in_key_3_without_its_owner` (red): the room with the
  screen; the bot-seated viewer at (30, 10) must get one key-3 kind-3 row with all 7 tiles and `owner: None` through
  `CollectionPublisher`, and its `CollectionView` must hold the same rows. Today key 3 has no wall.

Amended (commits `oracle-amend:`, owner-directed by the 2026-11-14 decision):
- `crates/rh-sim/src/barriers_observe_tests.rs` `the_caster_receives_its_wall_even_when_none_of_it_is_in_sight`: its
  guard half ("a viewer who is not the owner and sees nothing of the wall is sent nothing") now expects the bystander,
  who sees none of the wall, to be sent the whole wall, with the owner named (it sees the caster on its side of the
  rock). Red today on `left: 0, right: 1`. The module comment says why.
- `crates/rh-sim/tests/frost_wall_observe.rs` `a_viewer_out_of_sight_receives_neither_the_wall_nor_its_landing_centre`,
  renamed `a_viewer_out_of_sight_receives_the_wall_but_neither_its_owner_nor_its_landing_centre`: the far viewer now
  receives the wall (tiles, both ends, no owner) and still never the landing centre. Red today on `left: 0, right: 1`.

Surveyed and left unchanged (they pin nothing about a viewer who sees none of the wall):
`crates/rh-sim/src/barriers_observe_tests.rs` (the other 4 tests), `crates/rh-sim/tests/frost_wall_observe.rs` (the other
7), `crates/rh-policy/tests/frost_wall_delivery.rs` (its viewer stands in sight), `crates/rh-server/tests/frost_wall_live_room.rs`
(its second client stands in sight), `crates/rh-server/tests/frost_wall_{cap,welcome}.rs`,
`crates/rh-protocol/tests/frost_wall_wire.rs`, `crates/rh-parity/tests/frost_wall_aim_golden.rs` and
`protocol/fixtures/frost_wall_aim_v1.json` (aim cases only; no per-viewer case, so no regeneration),
`crates/rh-policy/src/bots/frost_wall_bots_tests.rs`, `brain/frost_wall_brain_tests.rs`, the C# `FrostWall*Tests.cs`
and `tools/protocol-js/check-frost-wall.mjs` (codec and client state, not delivery).

## 9. Validation commands

- `cargo test -p rh-sim --lib barriers::public_tests` and `barriers::observe_tests`
- `cargo test -p rh-sim --test frost_wall_observe --test frost_wall_observe_no_alloc --test frost_wall_no_alloc --test barrier_observe_no_alloc`
- `cargo test -p rh-sim --lib status_runtime::observe`
- `cargo test -p rh-policy --test frost_wall_public_delivery --test frost_wall_delivery`
- `cargo test -p rh-server --test frost_wall_live_room`
- `cargo test --release -p rh-headless --test frost_wall_bots --test frost_wall_live --test brain_choices`
- `scripts/gate.sh --quick`, then the full gate with `--oracle packet/P-FROST-WALL-PUBLIC-1`

## 10. Risk and suggested model tier

Opus: `observe.rs` is shared and C-OBS sensitive. The code change is a few lines; the risks are widening it (every
field kind public, or naming the owner to everyone, or sending fields to an unseated viewer) and allocating. The new
zone/cloud/trail test, the owner assertions, `an_unseated_viewer_receives_no_wall_and_no_landing_centre` and the
no-alloc guard catch each.

## 11. Known traps

- Do not route walls through `public()` or `FieldView::from_field(f, &a.barriers, ...)` with a `seen` that names every
  player: the owner must stay redacted, and `from_field` with barrier rows clones the tiles (one block per wall per
  observation; the slot-buffer copy exists to avoid it).
- Do not skip the early return for an unseated viewer, and do not special-case dead viewers: a dead seated viewer gets
  walls (and, through the existing redaction, no owner, since a dead viewer sees no actor).
- `CastLanded`'s centre is not a field: its rule stays, so a far viewer is sent a wall but not where it landed.
- The Brain composer (`crates/rh-policy/src/bots/temporal_percept/brain/compose14.rs:988-1003`) filters fields by the
  frame box on the first point only; legacy's `seeFields` (`perception.ts:816`) also required `canSee` of that point.
  Rust relied on delivery for the sight half. After this packet a Brain can be handed a wall whose first point is in its
  frame box but behind cover, which legacy's Brain would not have been. The coordinator directed: leave that filter.
  Flagged under LEGACY DOUBTS; any fix is its own packet in `rh-policy`.
- The far viewers' setups step 640 ticks first so the dealt spawn's 30 s sight memory (`VISION_TRAIL_MS`) has expired,
  as the other barrier tests do.

## Not established

- Whether the Unity client should draw a wall whose tiles are all under fog. The client already draws and predicts
  every wall it is sent (P-UNITY-FROST-WALL-1); legacy drew only walls whose first end was visible
  (`FieldView.ts:161-162`). That is a Web-round check, not this packet.
- Whether a Brain's choices move (section 8 release tests were not run by the oracle author).
- The wire budget: every Frost player has at most one wall standing (45 s cooldown, 4 s standing), so a room carries at
  most one wall row per Frost seat, far under `MAX_VISIBLE_FIELDS` (512, `crates/rh-protocol/src/state.rs:16`); each row
  is at most 64 tiles (`MAX_WALL_TILES`). Not measured in a full room.

## Notes from previous attempts
