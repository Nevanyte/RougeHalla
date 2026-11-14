# P-FROST-WALL-1c: Frost Wall, third sim part: the remaining body-map readers, and the wall's numbers in content

- **Serves:** owner beta follow-up decision 2 (MIGRATION, 2026-11-10: "Frost Wall replaces Freeze"); reviewer-opus
  notes on P-FROST-WALL-1b (2026-11-14)
- **Implementer tier:** implementer-opus (`rh-sim` state and tick code; content registry)
- **Reviewer:** reviewer-opus
- **Integration base:** feature/unity-rework after P-FROST-WALL-1b (staging head `aadff95e3`)
- **D-rules touched:** D1 loose proof against the unreleased legacy patch `78dd8bd4` (read with `git show`; not merged
  into `packages/`) · D2 n/a · the content hash MOVES (the wall's numbers enter content) · parity fixtures run with the
  switch off and stay untouched · no wire change (P-FROST-WALL-2) · D5/D6/D9 none

## Routing
- **Serves:** owner beta follow-up decision 2 (not an ORDER_OF_OPERATIONS item; recorded in MIGRATION 2026-11-10).
- **Tier:** implementer-opus. **Reviewer:** reviewer-opus.
- **D-rules:** D1 loose proof (one test per reader, wall standing; one guard per reader, switch off).
- **Write scope:** section 5 (exact files). Needs, before dispatch, the coordinator's yes to the two items in
  "Approvals needed" (an existing test's rows and value; one capture file).

## 1. ID and outcome
After P-FROST-WALL-1b a standing wall stops bodies, swings, mob paths and blink landings, behind
`SimConfig::frost_wish == Wall` (default `Freeze`; no profile selects `Wall`). Legacy reads the wall
(`collisionMap(world)`, patch `78dd8bd4`) in more places than the two sim parts ported. Before any profile selects
`Wall`, the readers whose miss a player would see must read it too. When this lands, with a wall standing:
1. **A cannon never lands a player in the ice** (`crates/rh-sim/src/systems/cannons.rs:48-53`, the landing's
   `circle_clear` with `MASK_MOVE`): a landing whose disc touches a wall tile is declined silently, as legacy does (no
   blast, no reload, the player stays).
2. **Plague zombies** are never placed in the ice and never swing across it (`plague_zombies.rs:60` placement beside
   the owner; `:369-376` the `can_hit` line with `MASK_MOVE`).
3. **Bruiser passive reach** (Frost's Frozen Justice elite lock) does not cross ice a swing cannot cross
   (`bruiser.rs:69-74`, `reach_mask(weapon)`: MASK_MELEE for an arc weapon; a ranged weapon's MASK_SIGHT still passes).
4. **Wind emblems** never spawn in the ice, with legacy's draw count when a candidate is rejected (`wind.rs:108`), and
   an emblem lying under the wall is not picked up across the ice (`wind.rs:61`, the pick-up line with `MASK_MOVE`).
5. **The wall's numbers are content.** None of the wall's numbers is in the content registry today: the six cast numbers
   (`abilities/mod.rs:272-278`) and the two tile numbers (`barriers.rs:20,22`) are `NON_GAMEPLAY` rows in
   `tests/content.rs:31-38` ("staged out of content_hash until P-FROST-WALL-2"), and the push-out's three numbers are
   literals (`barriers.rs:183` `(4., 96.)`, `:217` `PLAYER_RADIUS + 32.`). All eleven become rows of the `content!`
   registry in `crates/rh-sim/src/constants.rs`, with these names and values:
   `FROST_WALL_RANGE` 450, `FROST_WALL_MIN_RANGE` 64, `FROST_WALL_LENGTH` 224, `FROST_WALL_MS` 4000,
   `FROST_WALL_CAST_MS` 250, `FROST_WALL_COOLDOWN_MS` 45000, `WALL_CELL_REACH` `TILE * 0.75` (24),
   `WALL_END_SLACK` `TILE / 4.` (8), `WALL_PUSH_STEP` 4, `WALL_PUSH_MAX` 96 (legacy's own names, `abilities.ts:532-533`),
   `WALL_GAP_REACH` `PLAYER_RADIUS + 32.` (44; legacy's unnamed `:585`). The content hash moves once, here, and every
   pinned copy moves with it in this branch.
Readers left as they are (section 3 table; DEV-029 already says pick-ups and interactions across the ice stay possible).

## 2. Dependencies
P-FROST-WALL-1b merged (in `aadff95e3`). Serial with any packet touching `constants.rs`, `content.rs`, `tests/content.rs`,
the hash tape, `protocol/fixtures/archetypes_v1.json` or the reload-proof scripts. P-FROST-WALL-2 depends on this.

## 3. Relevant legacy paths (commit `78dd8bd4`)
`packages/server/src/sim/world.ts:1079` (`collisionMap`, `:1072` in-repo) gains the barrier overlay; its readers are
in-repo files the patch does not touch (their line numbers are the same in both trees). Masks: `hasLineOfSight`
defaults to `MASK_SIGHT` (`shared/src/geometry.ts:83`), `circleClear` to `MASK_MOVE` (`:93`); LOW (the wall) is in
`MASK_MOVE` and `MASK_MELEE`, not in `MASK_SIGHT` (`shared/src/map.ts:18-22`). So only MOVE/MELEE reads see the wall.

| Legacy reader | Mask | Rust counterpart | This packet | A player would see, if left |
|---|---|---|---|---|
| `consumables.ts:107` useCannon landing | MOVE | `systems/cannons.rs:48-53` | **ports** | a cannon drops them inside the ice |
| `consumables.ts:159` wind pick-up line | MOVE | `systems/wind.rs:61,69` | **ports** | an emblem under the wall taken from beside it |
| `consumables.ts:172-177` wind spawn | MOVE | `systems/wind.rs:108-114` | **ports** | an emblem spawned in the ice |
| `plagueZombies.ts:25` placement | MOVE | `systems/plague_zombies.rs:59-78` | **ports** | a zombie raised inside the ice |
| `plagueZombies.ts:138` canHit | MOVE | `systems/plague_zombies.rs:367-377` | **ports** | a zombie standing still swinging into the ice |
| `bruiserPassives.ts:48` lockedElite | reachMask | `systems/bruiser.rs:69-74` | **ports** | Frozen Justice armour up against an elite across the ice |
| `loot.ts:146` pick-up reach | MOVE | `systems/items.rs:297` (`item_view.rs:111` `pickup_reach`) | leaves (DEV-029) | loot picked up across the ice |
| `plagueCorpses.ts:51`, `:86` consume | MOVE | `systems/plague_corpses.rs:101-106` (one check, manual and auto) | leaves (DEV-029) | a corpse eaten across the ice |
| `traders.ts:65` trade reach | MOVE | `traders/runtime.rs:241-248` | leaves (DEV-029) | trading across the ice |
| `traders.ts:103` visitor / walker | MOVE | `traders/runtime.rs:99-105`, `:124` (walker), `:62` (destinations at install: no wall then) | leaves (DEV-029) | a trader stops for a visitor across the ice |
| `quests.ts:201` accept | SIGHT | `quests/live.rs:594-595` | nothing to port | none (sight passes) |
| `quests.ts:422` quest system | SIGHT reads | `quests/live.rs:865-866` | nothing to port | none |
| `training.ts:198,222,307` practice placements | floor (`circleClear` MOVE) | `systems/training.rs:227`, `training/console.rs:331`, `:384` | leaves (training console only) | a practice camp or chest set on a wall tile |
| `walkHint.ts:167,192` | SIGHT (wand) | `systems/walk_hint/queries.rs:81`, `:143` | nothing to port | none |
| `projectiles.ts:211` | sight/ray (shots fly over) | `systems/projectiles.rs:256,397,562` | nothing to port | none |

Further legacy readers not in the reviewer's list (found here; NOT in this packet, the coordinator decides):
- `factions.ts:424,437` signature reach: `hasLineOfSight(map, c, t, reachMask(weapon))` (MELEE for arc weapons) →
  `systems/signatures.rs:345`. Left, a melee faction's signature stays "in reach" (engaged, pulses) across the ice.
  The same one-line change as the bruiser's; it deserves the same treatment before a profile selects the wall.
- `melee.ts:107` ball interception on the swing's arc → `systems/melee.rs:256` (`projectiles::meet_balls`). Left, a
  swing can intercept a ball across the ice.
- `chests.ts:137`, `targeting.ts:46,97,159,203`, `abilities.ts:123`, `vision.ts`: SIGHT, nothing to port.
  `mobs.ts:115` spawnTraining: floor at install (no wall). `movement.ts`, `mobAI.ts`, `melee.ts:46`: parts 1 and 1b.

Wind's draw rule (`consumables.ts:170-177`): one timer draw when due (before the cap check), then up to 40 attempts of
two draws each (`x` then `y`), breaking at the first candidate whose disc is clear on `collisionMap(world)` and three
tiles from every emblem. A candidate on a wall tile is rejected and the stream draws again: the Rust loop
(`wind.rs:109-124`) already has this shape, so reading the body map at `:108` gives legacy's draw count exactly.

## 4. New paths
- `crates/rh-sim/src/barriers_readers_tests.rs`, `crates/rh-sim/tests/frost_wall_content.rs` (oracle; committed).

## 5. Exclusive write scope
- `crates/rh-sim/src/systems/cannons.rs`, `plague_zombies.rs`, `bruiser.rs`, `wind.rs`: only the map reads named in
  section 1 (each takes `crate::barriers::body_map(k, &crate::barriers::held(w), w.rt.gates_locked)`).
- `crates/rh-sim/src/constants.rs`: the eleven `content!` rows (a "Frost Wall" block; units `u`/`ms`).
- `crates/rh-sim/src/abilities/mod.rs`: delete the six `pub const FROST_WALL_*` (lines 272-278) and re-export them,
  `pub use crate::constants::{FROST_WALL_*};` (the oracles of parts 1 and 1b use `rh_sim::abilities::FROST_WALL_*` and
  `a::FROST_WALL_*`). Fix the comment at `:271` and the `visit_content` comment at `:552` ("not folded yet").
- `crates/rh-sim/src/barriers.rs`: delete `WALL_CELL_REACH`/`WALL_END_SLACK` (`:20,22`), re-export them; read
  `WALL_PUSH_STEP`, `WALL_PUSH_MAX` in `set_down` (`:183`) and `WALL_GAP_REACH` in `keep_gap` (`:217`); fix the comment
  at `:128-132`. Leave the `#[cfg(test)]` module lines.
- `crates/rh-sim/src/content.rs`: only if a doc line needs it (the registry is folded by `content_hash_of_definitions`
  `h.str("registry")` already; no new fold is needed).
- **Existing test, needs approval:** `crates/rh-sim/tests/content.rs`: remove the eight `NON_GAMEPLAY` rows `:31-38`
  (required: `every_const_in_the_source_tree_is_registered_or_explained` refuses a name both registered and listed, and
  a stale exemption), and set `GOLDEN_CONTENT_HASH` (`:570`) to the new value. Nothing else in that file.
- The carry of the content hash (the full list is in "Identities"): `parity/abilities/hash-tape.json` (by its recorder;
  **needs approval**, see below), `protocol/fixtures/archetypes_v1.json` (by its generator, gate flag
  `--regen-fixtures`), `tools/unity-browser-reload-proof/check.mjs:8` and `normal-companion.mjs:7` (the constant only).
- Not: `observe.rs`, the protocol, `statics.rs` (`live_content()` is P-FROST-WALL-2's flip), `systems/signatures.rs`,
  `systems/melee.rs`, any reader marked "leaves", the Unity client, `docs/MIGRATION.md`, `hosting/`.

### Approvals needed before dispatch (coordinator; recorded here as the packet's own scope)
1. `crates/rh-sim/tests/content.rs`: the eight `NON_GAMEPLAY` rows go, `GOLDEN_CONTENT_HASH` changes value (as
   4c9a5c50 and 00f422d49 did). This edits an existing test file; the owner/coordinator approves.
2. `parity/abilities/hash-tape.json`: only its `contentHash` changes, written by the recorder. `scripts/gate.sh
   --oracle` refuses any changed `parity/*.json` (`gate.sh:101,127-129`; `--regen-fixtures` lets only
   `protocol/fixtures/` through), so the implementer's final gate WILL name this one file. Either the coordinator
   accepts that one named refusal (the oracle `the_carry_changes_only_the_content_hash_field_of_the_tape_and_the_archetype_golden`
   proves nothing else in the tape moved), or the coordinator re-records the tape at merge as 00f422d49 did (then
   `ability_hash_tape_matches_the_base` and two oracle tests stay red on the implementer branch). Recommended: the
   first.

## 6. Contracts and references
- C-TICK: no row moves. C-RNG: no wind draw added or removed with the switch off; with it on, the count follows legacy.
- C-PARITY: every parity fixture runs with `Freeze` and is untouched.
- Content identity: `content_hash` (`content.rs:454`) folds `REGISTRY` by name and value in declaration order
  (`content.rs:1341-1346`); Welcome, `/info`, checkpoints and replays carry it; a client with another hash is refused.

## 7. Behaviour to preserve
- Switch off: byte-identical. Every parity fixture, the ability hash tape's cases, `step_event_window`, the
  no-allocation oracles and the replay tests stay green without re-recording any case. A reader takes
  `barriers::body_map` (the plain map, no allocation, when no wall stands).
- No RNG draw added or removed with the switch off; with it on, Wind's draw count follows legacy.
- Protocol 17, observation 29, policy contract 23, checkpoint 32, replay 25 unchanged. Only the content hash moves.

## 8. Acceptance checks
- The oracle files pass. `scripts/gate.sh --oracle packet/P-FROST-WALL-1c --regen-fixtures` passes except, under
  approval 2 option 1, its one named refusal of `parity/abilities/hash-tape.json`.
- `git diff packet/P-FROST-WALL-1c -- parity protocol tools` is the `contentHash`/constant line of each of the four
  carried files and nothing else.

## Established facts (oracle author, 2026-11-14, verified on `aadff95e3`)

### Today's readers (all `cx.k.collision_map(..)` / `k.collision_map(..)`, the arena map without the wall)
- `cannons.rs:48-53`: `circle_clear(collision_map, landing, PLAYER_RADIUS, MASK_MOVE)`; blocked → silent `return`.
- `plague_zombies.rs:59-78` `beside_owner`: distances 32/24/16 × turns pi, pi/2, -pi/2, 0 off the owner's facing,
  `circle_clear` and `has_line_of_sight` (MOVE) on `collision_map` (`:60`). Called at raise (`:148`), revive (`:178`),
  after the owner is displaced (`:318`) and at `:563`.
- `plague_zombies.rs:367-377` `can_hit`: `distance <= 66 && has_line_of_sight(collision_map, zpos, target, MASK_MOVE)`.
- `bruiser.rs:69-74` `locked_elite`: `has_line_of_sight(collision_map, from, to, reach_mask(weapon))`.
- `wind.rs:61,69` pick-up; `wind.rs:108-114` spawn.
- `barriers::body_map` (`barriers.rs:343-353`) and `barriers::held` (`:337-339`) are what part 1b's readers use
  (`mob_ai.rs:296`, `movement.rs:69`, `inputs.rs:108`, `melee.rs:118`, `abilities/mod.rs:62`).

### Every place the repository pins `4674a176a28e3c7a` (or derives from it)
The oracle `tests/frost_wall_content.rs` makes a missed one fail: `every_pinned_copy_of_the_content_hash_names_the_golden_value`
checks each copy below against `GOLDEN_CONTENT_HASH`, and `no_source_script_or_golden_still_names_the_pre_wall_content_hash`
scans `crates`, `tools`, `protocol`, `parity/abilities` and the C#/Unity source and test folders for the old value in
hex, underscored hex and decimal. Today the scan finds exactly the five files below.
| Copy | How it moves | Checked by |
|---|---|---|
| `crates/rh-sim/tests/content.rs:570` `GOLDEN_CONTENT_HASH` | **the ONE named place**: write the value `hash_golden` prints | `hash_golden`, and the oracle checks every copy against it |
| `parity/abilities/hash-tape.json:258` `contentHash` | `cargo test --locked -p rh-sim --features trusted-status-probes --lib record_ability_hash_tape -- --ignored` (one-line diff; verified) | `ability_hash_tape_matches_the_base` (`abilities/source_tests/hash_tape.rs:49-52`) |
| `protocol/fixtures/archetypes_v1.json:300` `contentHash` | `cargo run -p rh-parity --bin hitbox-fixtures` (`hitbox_goldens.rs:88`; also rewrites `pathfinding_v2.json`, `server_walk_v2.json` identically; one-line diff; verified) | `crates/rh-parity/tests/pnet2_goldens.rs`, `hitbox-fixtures --check`; read by C# `HitboxPredictionTests`, Unity `HitboxPresentationEditModeTests` and `hitbox-proof-steps.cjs` (they do not read `contentHash`) |
| `tools/unity-browser-reload-proof/check.mjs:8` `CONTENT` | hand edit of the constant | `check.test.mjs` (imports it), the gate's reload-proof step |
| `tools/unity-browser-reload-proof/normal-companion.mjs:7` `EXPECTED_CONTENT_HASH` | hand edit of the constant | `normal-companion.test.mjs` |
Not pinned to the current value, left alone:
- `client-unity/UnityProject/Assets/Scripts/BakedContent.cs:6` holds `0x7d2d84b827af3ddc` (stale long before this
  packet). It is generated at build time by `client-unity/UnityProject/Tools/build-web.sh` from the server's `/info`
  and restored after a Web round (`docs/unity/WEB_ROUND.md:64-84`); `tools/release/check-identity.mjs` compares it at
  release. No C# test pins the hash (`ProtocolVectorTests.cs:80,238` use synthetic values); `crates/rh-server` reads
  `rh_sim::content::content_hash()` and pins nothing; the JS protocol vectors (`protocol/fixtures/v17.json`) carry no
  content hash; no checkpoint or replay fixture stores it.
- Docs: `docs/MIGRATION.md:110` (current identities: coordinator records the new value), `hosting/technical-demo/README.md:199`
  (an example log line; protected path, owner approval, optional), and history (`DEVIATIONS.md:53` DEV-027 evidence,
  packets, hand-offs, evidence folders): leave.
A dry run of the whole carry (trial registration, then the four commands/edits above, reverted before commit) moved the
hash to `af50dbaf140e4cc0` with the rows placed after `CANNON_COOLDOWN_MS`; `tests/content.rs`, all six
`frost_wall_content` tests, the hash tape, `pnet2_goldens` and the 33 reload-proof node tests passed. The value depends
on where the rows go: the implementer pins whatever `hash_golden` prints.

### Identities
- Content hash `4674a176a28e3c7a` → new (implementer's). Protocol 17, observation 29, policy 23, checkpoint
  `rh-checkpoint/32`, replay `rh-replay/25` unchanged (the state hash does not fold the content hash; no serialized
  field is added).

## Oracle files (read-only for implementers)
- `crates/rh-sim/src/barriers_readers_tests.rs` (13 tests: 6 red, 7 green guards)
- `crates/rh-sim/tests/frost_wall_content.rs` (6 tests: 4 red, 2 green guards)
- `docs/backlog/packets/P-FROST-WALL-1c.md`
Stub (the implementer's): the `#[cfg(test)] #[path = "barriers_readers_tests.rs"] mod readers_tests;` lines in
`crates/rh-sim/src/barriers.rs`. No signature was stubbed: the oracle drives only existing APIs.

## Baseline (on `packet/P-FROST-WALL-1c`, before any implementation)
`cargo test --locked -p rh-sim --features trusted-status-probes --lib barriers::readers_tests`: 6 red, on assertions:
- `a_cannon_whose_landing_is_on_a_standing_wall_does_not_fire`: "the shot never lands a player in the ice" (it lands
  at (400, 336), on column 12).
- `a_zombie_raised_beside_an_owner_against_the_wall_is_not_placed_in_the_ice`: "the zombie is not on a wall tile"
  ((400, 336)).
- `a_zombie_whose_hit_line_crosses_the_wall_does_not_swing_through_it`: "no swing held across the ice" (zombie
  (370, 336), target (430, 336)).
- `the_bruiser_passive_does_not_reach_across_a_wall_a_swing_cannot_cross`: "Frozen Justice's elite lock reads the
  wall as the swing does".
- `wind_emblems_never_spawn_in_the_ice_and_a_rejected_candidate_draws_again`: "the spawn is legacy's on the map with
  the wall": (400, 432) (a wall tile) where legacy re-draws and takes (336, 432).
- `a_wind_emblem_in_the_ice_is_not_picked_up_from_beside_it`: the emblem was taken (0 left, legacy 1).
Green guards: `guard_switch_off_*` (cannon lands exactly on its target with the reload stamped; zombie raised 32 u
behind; zombie in reach holds its swing; bruiser guard up; 80 forced Wind spawns equal to legacy's rule on the open map,
positions and stream state; emblem picked up) and `the_bruiser_passive_with_a_ranged_weapon_still_sees_over_the_wall`.
`--test frost_wall_content`: 4 red: `every_frost_wall_number_is_a_named_registry_row` (all eleven missing),
`the_push_out_reads_its_named_numbers_not_literals` (no `WALL_GAP_REACH` read), `the_content_hash_moved_off_the_pre_wall_value`
(equal), `no_source_script_or_golden_still_names_the_pre_wall_content_hash` (the five files above). Green:
`every_pinned_copy_of_the_content_hash_names_the_golden_value`, `the_carry_changes_only_the_content_hash_field_of_the_tape_and_the_archetype_golden`.
Satisfiability: with each of the six reads switched to `barriers::body_map` (a dry run, reverted) all 13 reader tests
pass; with the trial registration and carry, all 6 content tests pass.

## 9. Validation commands
`export PATH="$HOME/.cargo/bin:$PATH"`, then:
- `cargo test --locked -p rh-sim --features trusted-status-probes --lib barriers`
- `cargo test --locked -p rh-sim --features trusted-status-probes --test frost_wall_content --test content --test frost_wall_replay --test frost_wall_no_alloc --test frost_wall_push_no_alloc --test no_alloc --test step_event_window --test hash_coverage`
- `cargo test --locked -p rh-sim --features trusted-status-probes --lib ability_hash_tape_matches_the_base`
- `cargo test --locked -p rh-parity --test pnet2_goldens`; `cargo run -p rh-parity --bin hitbox-fixtures -- --check`
- `node --test tools/unity-browser-reload-proof/*.test.mjs`
- `cargo run -p rh-parity --bin parity-report` (all MATCH)
- `scripts/gate.sh --quick`; `scripts/gate.sh --oracle packet/P-FROST-WALL-1c --regen-fixtures`

## 10. Risk and suggested model tier
Opus. The content hash is an identity: client and server must agree, so every pinned copy moves in this packet; the
carry touches a capture file the gate protects.

## 11. Known traps
- `tests/content.rs` counts every `const` in `rh-sim` source: a registered name may not be declared anywhere else
  (`is_stray`), so the old `pub const`s go and `pub use crate::constants::…` keeps the paths the oracles of parts 1 and
  1b use (`rh_sim::abilities::FROST_WALL_CAST_MS`, `a::FROST_WALL_RANGE`, ...). A re-export is not a declaration.
- Sight and shots are NOT stopped by the wall (legacy: "shots fly over it"): readers using `MASK_SIGHT` stay as they
  are. Only body and reach reads change. `reach_mask` for a ranged weapon stays MASK_SIGHT (a guard test pins it).
- `beside_owner` borrows `w` immutably while the caller holds `&w.players[owner_ix]`: take `barriers::held(w)` (an
  `Arc` clone, no allocation) first.
- The cannon declines silently: no event, no reload stamp (`consumables.ts:107`).
- Wind: keep the arm draw before the cap check and the per-attempt `x` then `y` draws; only the map changes.

## Legacy doubts (pinned as legacy; flag, do not fix)
- `consumables.ts:107`: a cannon whose landing is under a wall does nothing and says nothing; the shot is simply lost
  until the wall falls. Pinned (no blast, no reload).
- `plagueZombies.ts:25`: if every candidate is blocked the zombie is placed ON the owner (`return from`). Not pinned.

## Not established by this oracle
- Revive and the after-displacement re-place of a zombie (`plague_zombies.rs:178`, `:318`, `:563`) individually: they call the
  same `beside_owner` the raise test drives. A diagonal (staircase) wall. Gates locked with a wall standing.
- That the client and server agree on the new hash end to end (no Web round; BakedContent is regenerated at build).
- The readers this packet leaves (section 3), including the signature reach and ball interception found here.

## Notes from previous attempts
2026-11-14 (oracle author): brief checked against `aadff95e3`. Corrections: `collisionMap` is `world.ts:1079` in
78dd8bd4 (`:1072` in-repo); the readers are in-repo files, unchanged by the patch. The wall's existing numbers are not
in content (NON_GAMEPLAY rows, an owner decision of 2026-11-12 staged them out "until P-FROST-WALL-2"; this packet
brings that forward per the coordinator's brief: flag for the owner). The Rust pick-up line `wind.rs:61` is a separate
read from the spawn `:108` (both ported, both tested). Two LOW-sensitive legacy readers missing from the reviewer's list
(`factions.ts:424,437` → `signatures.rs:345`; `melee.ts:107` → `melee.rs:256`). The hash carry cannot pass
`gate.sh --oracle` as written (the tape is a `parity/*.json`): see "Approvals needed".
