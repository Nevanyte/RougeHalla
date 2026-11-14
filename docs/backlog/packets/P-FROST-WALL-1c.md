# P-FROST-WALL-1c: Frost Wall, third sim part: eight more body-map readers see a standing wall

- **Serves:** owner beta follow-up decision 2 (MIGRATION, 2026-11-10: "Frost Wall replaces Freeze"); reviewer-opus
  notes on P-FROST-WALL-1b (2026-11-14)
- **Implementer tier:** implementer-opus (`rh-sim` tick code: positions, RNG draw counts, combat reads)
- **Reviewer:** reviewer-opus
- **Integration base:** feature/unity-rework after P-FROST-WALL-1b (staging head `aadff95e3`)
- **D-rules touched:** D1 loose proof against the unreleased legacy patch `78dd8bd4` (read with `git show`; not merged
  into `packages/`) · D2 n/a · no identity moves (content hash stays `4674a176a28e3c7a`; owner decision 2026-11-12) ·
  parity fixtures run with the switch off and stay untouched · no wire change (P-FROST-WALL-2) · D5/D6/D9 none

## Routing
- **Serves:** owner beta follow-up decision 2 (not an ORDER_OF_OPERATIONS item; recorded in MIGRATION 2026-11-10).
- **Tier:** implementer-opus. **Reviewer:** reviewer-opus.
- **D-rules:** D1 loose proof (one red test per reader with a wall standing; one green guard per reader, switch off).
- **Write scope:** section 5.

## 1. ID and outcome
After P-FROST-WALL-1b a standing wall stops bodies, swings, mob paths and blink landings, behind
`SimConfig::frost_wish == Wall` (default `Freeze`; no profile selects `Wall`). Legacy reads the wall
(`collisionMap(world)`, patch `78dd8bd4`) in more places than the two sim parts ported. Before any profile selects
`Wall`, the readers whose miss a player would see must read it too. When this lands, with a wall standing:
1. **A cannon never lands a player in the ice** (`systems/cannons.rs:48-53`, the landing's `circle_clear` with
   `MASK_MOVE`): a landing whose disc touches a wall tile is declined silently, as legacy does (no blast, no reload, the
   player stays).
2. **Plague zombies** are never placed in the ice and never swing across it (`plague_zombies.rs:60`, placement beside
   the owner; `:367-377`, the `can_hit` line with `MASK_MOVE`).
3. **Bruiser passive reach** (Frost's Frozen Justice elite lock) does not cross ice a swing cannot cross
   (`bruiser.rs:69-74`, `reach_mask(weapon)`: MASK_MELEE for an arc weapon; a ranged weapon's MASK_SIGHT still passes).
4. **Wind emblems** never spawn in the ice, with legacy's draw count when a spot is rejected (`wind.rs:108`), and an
   emblem lying under the wall is not picked up from beside it (`wind.rs:61`, the pick-up line with `MASK_MOVE`).
5. **A melee faction's signature** is not "in reach" across the ice (`signatures.rs:344-345`, `reach_mask`-style mask:
   MASK_MELEE for arc weapons; legacy `factions.ts:424,437`).
6. **A swing does not meet a ball across the ice** (`melee.rs:256`, the map passed to `projectiles::meet_balls`, whose
   ray is already MASK_MELEE at `projectiles.rs:606`; legacy `melee.ts:107` and `crossesArc` `:117-127`).
That is eight map reads in six files, each a one-line switch from `k.collision_map(..)` to
`crate::barriers::body_map(k, &crate::barriers::held(w), w.rt.gates_locked)`.
**No content in this packet:** the wall's numbers stay out of `content_hash` until P-FROST-WALL-2 (owner decision
2026-11-12; see "Handed to P-FROST-WALL-2"). The push-out's numbers stay literals in `barriers.rs:183` (`(4., 96.)`)
and `:217` (`PLAYER_RADIUS + 32.`), as part 1b left them.
Readers left as they are (section 3 table; DEV-029 already says pick-ups and interactions across the ice stay possible).

## 2. Dependencies
P-FROST-WALL-1b merged (in `aadff95e3`). Serial with packets touching the six reader files. P-FROST-WALL-2 depends on
this.

## 3. Relevant legacy paths (commit `78dd8bd4`)
`packages/server/src/sim/world.ts:1079` in the patch (`:1072` in-repo), `collisionMap`, gains the barrier overlay. Its
readers are in-repo files the patch does not touch, so their line numbers are the same in both trees. Masks:
`hasLineOfSight` defaults to `MASK_SIGHT` (`shared/src/geometry.ts:83`), `circleClear` to `MASK_MOVE` (`:93`); LOW
(the wall) is in `MASK_MOVE` and `MASK_MELEE`, not in `MASK_SIGHT` (`shared/src/map.ts:18-22`). So only MOVE and MELEE
reads see the wall.

| Legacy reader | Mask | Rust counterpart | This packet | A player would see, if left |
|---|---|---|---|---|
| `consumables.ts:107` useCannon landing | MOVE | `systems/cannons.rs:48-53` | **ports** | a cannon drops them inside the ice |
| `consumables.ts:159` wind pick-up line | MOVE | `systems/wind.rs:61,69` | **ports** | an emblem under the wall taken from beside it |
| `consumables.ts:172-177` wind spawn | MOVE | `systems/wind.rs:108-114` | **ports** | an emblem spawned in the ice |
| `plagueZombies.ts:25` placement | MOVE | `systems/plague_zombies.rs:59-78` | **ports** | a zombie raised inside the ice |
| `plagueZombies.ts:138` canHit | MOVE | `systems/plague_zombies.rs:367-377` | **ports** | a zombie standing still swinging into the ice |
| `bruiserPassives.ts:48` lockedElite | reachMask | `systems/bruiser.rs:69-74` | **ports** | Frozen Justice armour up against an elite across the ice |
| `factions.ts:424,437` signature inReach | reachMask | `systems/signatures.rs:340-345` | **ports** | a melee signature engaged (pulses, trade window) across the ice |
| `melee.ts:107` crossesArc (ball meets swing) | reachMask (MELEE for sword/axe) | `systems/melee.rs:256` → `projectiles.rs:580-628` | **ports** | an axe destroys (a sword halves) a ball on the far side of the ice |
| `loot.ts:146` pick-up reach | MOVE | `systems/items.rs:297` (`item_view.rs:111` `pickup_reach`) | leaves (DEV-029) | loot picked up across the ice |
| `plagueCorpses.ts:51`, `:86` consume | MOVE | `systems/plague_corpses.rs:101-106` (one check, manual and auto) | leaves (DEV-029) | a corpse eaten across the ice |
| `traders.ts:65` trade reach | MOVE | `traders/runtime.rs:241-248` | leaves (DEV-029) | trading across the ice |
| `traders.ts:103` visitor / walker | MOVE | `traders/runtime.rs:99-105`, `:124` (walker), `:62` (destinations at install: no wall then) | leaves (DEV-029) | a trader stops for a visitor across the ice |
| `quests.ts:201` accept | SIGHT | `quests/live.rs:594-595` | nothing to port | none (sight passes) |
| `quests.ts:422` quest system | SIGHT reads | `quests/live.rs:865-866` | nothing to port | none |
| `training.ts:198,222,307` practice placements | floor (`circleClear` MOVE) | `systems/training.rs:227`, `training/console.rs:331`, `:384` | leaves (training console only) | a practice camp or chest set on a wall tile |
| `walkHint.ts:167,192` | SIGHT (wand) | `systems/walk_hint/queries.rs:81`, `:143` | nothing to port | none |
| `projectiles.ts:211` | sight/ray (shots fly over) | `systems/projectiles.rs:256,397,562` | nothing to port | none |
Also SIGHT, nothing to port: `chests.ts:137` (`reward_chests/mod.rs:231-236`), `targeting.ts:46,97,159,203`,
`abilities.ts:123`, `vision.ts`. `mobs.ts:115` spawnTraining reads floor at install (no wall then). `movement.ts`,
`mobAI.ts`, `melee.ts:46`: parts 1 and 1b.

Wind's draw rule (`consumables.ts:170-177`): one timer draw when due (before the cap check), then up to 40 attempts of
two draws each (`x` then `y`), breaking at the first candidate whose disc is clear on `collisionMap(world)` and three
tiles from every emblem. A candidate on a wall tile is rejected and the stream draws again. The Rust loop
(`wind.rs:109-124`) already has this shape, so reading the body map at `:108` gives legacy's draw count exactly.

Ball rule (`melee.ts:117-127`): for each sample of the ball's sweep this tick (step `BALL_SAMPLE_STEP`), it meets the
swing if the sample is in the arc and `raycast(map, origin, p, reachMask(weapon))` is clear. The Rust copy
(`projectiles.rs:600-607`) already uses MASK_MELEE on the map it is handed, so no new mask is needed: only the map at
`melee.rs:256` changes.

## 4. New paths
- `crates/rh-sim/src/barriers_readers_tests.rs` (oracle; committed).

## 5. Exclusive write scope
- `crates/rh-sim/src/systems/cannons.rs`, `plague_zombies.rs`, `bruiser.rs`, `wind.rs`, `signatures.rs`, `melee.rs`:
  only the eight map reads named in section 1. `beside_owner` borrows `w` while the caller holds `&w.players[..]`: take
  `barriers::held(w)` (an `Arc` clone, no allocation) inside it.
- `crates/rh-sim/src/barriers.rs`: only the `#[cfg(test)] #[path = "barriers_readers_tests.rs"] mod readers_tests;`
  lines (the stub's); nothing else (the push-out literals stay).
- `docs/DEVIATIONS.md` DEV-029: propose the edit in the hand-off (the "Not yet: cannon landings, Plague zombies, bruiser
  passive reach and Wind emblem spawns do not read the wall" sentence; add the signature reach and the ball meeting).
- Not: `constants.rs`, `content.rs`, `abilities/mod.rs`, `tests/content.rs`, `parity/**`, `protocol/**`, `tools/**`,
  `observe.rs`, the protocol, `statics.rs`, any reader marked "leaves", the Unity client.

## 6. Contracts and references
- C-TICK: no row moves. C-RNG: no Wind draw added or removed with the switch off; with it on, the count follows legacy.
- C-PARITY: every parity fixture runs with `Freeze` and is untouched.

## 7. Behaviour to preserve
- Switch off: byte-identical. Every parity fixture, the ability hash tape, `step_event_window`, the no-allocation
  oracles and the replay tests stay green without re-recording. `barriers::body_map` is the plain map, with no
  allocation, when no wall stands.
- Identities: none move. Content hash `4674a176a28e3c7a` (pinned by the guard
  `guard_the_content_hash_does_not_move_in_this_packet`), protocol 17, observation 29, policy contract 23, checkpoint
  `rh-checkpoint/32`, replay `rh-replay/25`.

## 8. Acceptance checks
- The oracle file passes; `scripts/gate.sh --oracle packet/P-FROST-WALL-1c` passes (full). No `parity/**`,
  `protocol/fixtures/**` or `tools/**` file changes.

## Established facts (oracle author, 2026-11-14, verified on `aadff95e3`)
- Today every one of the eight reads takes `k.collision_map(gates_locked)`, the arena map without the wall:
  `cannons.rs:49`; `plague_zombies.rs:60` (`beside_owner`, called at raise `:148`, revive `:178`, after the owner is
  displaced `:318` and at `:563`); `plague_zombies.rs:371`; `bruiser.rs:70`; `wind.rs:61`, `:108`;
  `signatures.rs:345`; `melee.rs:256`.
- `barriers::body_map` (`barriers.rs:343-353`) and `barriers::held` (`:337-339`) are what part 1b's readers use
  (`mob_ai.rs:296`, `movement.rs:69`, `inputs.rs:108`, `melee.rs:118`, `abilities/mod.rs:62`).
- Satisfiable: with each of the eight reads switched to `barriers::body_map` (a dry run, reverted before commit) all 19
  tests in the oracle pass, and `tests/no_alloc.rs`, `frost_wall_no_alloc`, `frost_wall_push_no_alloc`,
  `frost_wall_replay`, `step_event_window` and `ability_hash_tape_matches_the_base` stay green.

## Oracle files (read-only for implementers)
- `crates/rh-sim/src/barriers_readers_tests.rs` (19 tests: 8 red, 11 green guards)
- `docs/backlog/packets/P-FROST-WALL-1c.md`
Stub (the implementer's): the `mod readers_tests` lines in `crates/rh-sim/src/barriers.rs`. No signature was stubbed:
the oracle drives only existing APIs.

## Baseline (on `packet/P-FROST-WALL-1c`, before any implementation)
`cargo test --locked -p rh-sim --features trusted-status-probes --lib barriers::readers_tests`: 8 red, on assertions:
- `a_cannon_whose_landing_is_on_a_standing_wall_does_not_fire`: "the shot never lands a player in the ice" (it lands
  at (400, 336), on column 12).
- `a_zombie_raised_beside_an_owner_against_the_wall_is_not_placed_in_the_ice`: "the zombie is not on a wall tile"
  ((400, 336)).
- `a_zombie_whose_hit_line_crosses_the_wall_does_not_swing_through_it`: "no swing held across the ice" (zombie
  (370, 336), target (430, 336)).
- `the_bruiser_passive_does_not_reach_across_a_wall_a_swing_cannot_cross`: "Frozen Justice's elite lock reads the
  wall as the swing does".
- `wind_emblems_never_spawn_in_the_ice_and_a_rejected_candidate_draws_again`: "the spawn is legacy's on the map with
  the wall": (400, 432), a wall tile, where legacy draws again and takes (336, 432).
- `a_wind_emblem_in_the_ice_is_not_picked_up_from_beside_it`: the emblem was taken (0 left, legacy 1).
- `a_melee_signature_is_not_in_reach_across_the_wall`: "the signature's reach reads the wall as the swing does".
- `a_swing_does_not_meet_a_ball_across_the_wall`: "the axe destroyed the ball across the ice at (442, 336)".
Green guards (11): `guard_switch_off_*` for the cannon (lands exactly on its target, reload stamped), the zombie raise
(32 u behind), the zombie swing (holds it at once), the bruiser (guard up), Wind spawns (80 forced spawns equal to
legacy's rule on the open map, positions and stream state), the Wind pick-up, the signature (in reach) and the ball (met
at x 442); `the_bruiser_passive_with_a_ranged_weapon_still_sees_over_the_wall`,
`a_ranged_signature_still_reaches_over_the_wall`, `guard_the_content_hash_does_not_move_in_this_packet`.

## 9. Validation commands
`export PATH="$HOME/.cargo/bin:$PATH"`, then:
- `cargo test --locked -p rh-sim --features trusted-status-probes --lib barriers`
- `cargo test --locked -p rh-sim --features trusted-status-probes --test no_alloc --test frost_wall_no_alloc --test frost_wall_push_no_alloc --test frost_wall_replay --test step_event_window --test hash_coverage --test content`
- `cargo test --locked -p rh-sim --features trusted-status-probes --lib ability_hash_tape_matches_the_base`
- `cargo run -p rh-parity --bin parity-report` (all MATCH)
- `scripts/gate.sh --quick`; `scripts/gate.sh --oracle packet/P-FROST-WALL-1c`

## 10. Risk and suggested model tier
Opus: eight reads inside the tick (placement, AI decisions, a passive, a combat interaction, an RNG loop); the default
config must stay byte-identical.

## 11. Known traps
- Sight and shots are NOT stopped by the wall (legacy: "shots fly over it"): readers using `MASK_SIGHT` stay as they
  are. `reach_mask` for a ranged weapon stays MASK_SIGHT (two guard tests pin it: bruiser and signature with a bow).
- The cannon declines silently: no event, no reload stamp (`consumables.ts:107`).
- Wind: keep the arm draw before the cap check and the per-attempt `x` then `y` draws; only the map changes.
- `meet_balls` runs once per melee request: `barriers::held` is an `Arc` clone (no allocation); take it once.

## Legacy doubts (pinned as legacy; flag, do not fix)
- `consumables.ts:107`: a cannon whose landing is under a wall does nothing and says nothing; the shot is simply lost
  until the wall falls. Pinned (no blast, no reload).
- `plagueZombies.ts:25`: if every candidate is blocked the zombie is placed ON the owner (`return from`). Not pinned.

## Not established by this oracle
- Revive and the after-displacement re-place of a zombie (`plague_zombies.rs:178`, `:318`, `:563`) individually: they
  call the same `beside_owner` the raise test drives. A diagonal (staircase) wall. Gates locked with a wall standing.
- The sword's halving of a ball (the same `crosses` test as the axe's destroy; only the axe is driven).
- The readers this packet leaves (section 3).

## Handed to P-FROST-WALL-2 (owner decision 2026-11-12)
The wall's numbers enter content in P-FROST-WALL-2, with the wire, so the content hash and the protocol number move in
the same packet and deploy. The first version of this oracle (branch `oracle-draft/P-FROST-WALL-2-content` @
`465426198`, file `crates/rh-sim/tests/frost_wall_content.rs`, and that commit's version of this brief) is the draft
for P-FROST-WALL-2's oracle author. Facts established on `aadff95e3`:
- **None of the wall's numbers is in content today.** The six cast numbers (`abilities/mod.rs:272-278`) and the two
  tile numbers (`barriers.rs:20,22`) are `NON_GAMEPLAY` rows in `crates/rh-sim/tests/content.rs:31-38` ("staged out of
  content_hash until P-FROST-WALL-2"); the push-out's three numbers are literals (`barriers.rs:183` `(4., 96.)`, `:217`
  `PLAYER_RADIUS + 32.`; legacy `abilities.ts:532-533` `WALL_PUSH_STEP`/`WALL_PUSH_MAX`, `:585`).
- **Proposed registration:** eleven `content!` rows in `crates/rh-sim/src/constants.rs`: `FROST_WALL_RANGE` 450,
  `FROST_WALL_MIN_RANGE` 64, `FROST_WALL_LENGTH` 224, `FROST_WALL_MS` 4000, `FROST_WALL_CAST_MS` 250,
  `FROST_WALL_COOLDOWN_MS` 45000, `WALL_CELL_REACH` `TILE * 0.75`, `WALL_END_SLACK` `TILE / 4.`, `WALL_PUSH_STEP` 4,
  `WALL_PUSH_MAX` 96, `WALL_GAP_REACH` `PLAYER_RADIUS + 32.`. The old `pub const`s go (a registered name declared
  elsewhere is a stray, `tests/content.rs` `is_stray`) and `pub use crate::constants::…` keeps the paths the part 1 and
  1b oracles use (`rh_sim::abilities::FROST_WALL_CAST_MS`, `a::FROST_WALL_RANGE`). The eight `NON_GAMEPLAY` rows must
  go (`every_const_in_the_source_tree_is_registered_or_explained` refuses a name both registered and listed, and a
  stale exemption): an edit to an existing test, for approval. (The registry is folded by `content.rs:1341-1346`; also
  `abilities::visit_content`'s comment at `abilities/mod.rs:552` says the wall row is "not folded yet".)
- **Every pinned copy of `4674a176a28e3c7a`** (a scan of `crates`, `tools`, `protocol`, `parity/abilities` and the
  C#/Unity source and test folders finds exactly these five):
  | Copy | How it moves | Checked by |
  |---|---|---|
  | `crates/rh-sim/tests/content.rs:570` `GOLDEN_CONTENT_HASH` | the one named place: write what `hash_golden` prints | `hash_golden` |
  | `parity/abilities/hash-tape.json:258` `contentHash` | `cargo test --locked -p rh-sim --features trusted-status-probes --lib record_ability_hash_tape -- --ignored` | `ability_hash_tape_matches_the_base` (`abilities/source_tests/hash_tape.rs:49-52`) |
  | `protocol/fixtures/archetypes_v1.json:300` `contentHash` | `cargo run -p rh-parity --bin hitbox-fixtures` (`hitbox_goldens.rs:88`) | `crates/rh-parity/tests/pnet2_goldens.rs`, `hitbox-fixtures --check` |
  | `tools/unity-browser-reload-proof/check.mjs:8` `CONTENT` | hand edit | `check.test.mjs` |
  | `tools/unity-browser-reload-proof/normal-companion.mjs:7` `EXPECTED_CONTENT_HASH` | hand edit | `normal-companion.test.mjs` |
  Not pinned to the current value: `client-unity/UnityProject/Assets/Scripts/BakedContent.cs:6` (`0x7d2d84b827af3ddc`,
  stale; generated at build time by `client-unity/UnityProject/Tools/build-web.sh` from `/info`; checked at release by
  `tools/release/check-identity.mjs`). No C# test, `crates/rh-server` file, JS protocol vector, checkpoint or replay
  fixture pins it. Docs: `docs/MIGRATION.md:110` (coordinator), `hosting/technical-demo/README.md:199` (protected),
  history (leave). This packet's guard `guard_the_content_hash_does_not_move_in_this_packet` must move with them.
- **The gate and the hash tape:** `scripts/gate.sh --oracle` refuses any changed `parity/*.json`
  (`gate.sh:101,127-129`); `--regen-fixtures` lets only `protocol/fixtures/` through. So re-recording the tape's
  `contentHash` is refused by name. Two ways through: the coordinator accepts that one named refusal (the draft oracle
  pins a digest of the tape and of `archetypes_v1.json` without `contentHash`, so nothing else may move), or the
  coordinator re-records the tape at merge as `00f422d49` did (then `ability_hash_tape_matches_the_base` stays red on
  the implementer branch).
- **Trial:** registering the eleven rows after `CANNON_COOLDOWN_MS` and carrying the four copies gave
  `af50dbaf140e4cc0`; each carried file changed by one line; `tests/content.rs`, the draft oracle, the hash tape,
  `pnet2_goldens` and the 33 reload-proof node tests passed. The value depends on where the rows go.

## Notes from previous attempts
2026-11-14 (oracle author): brief checked against `aadff95e3`. Corrections: `collisionMap` is `world.ts:1079` in
78dd8bd4 (`:1072` in-repo); the readers are in-repo files, unchanged by the patch. `wind.rs:61` (pick-up) is a separate
read from the spawn at `:108`. Two LOW-sensitive legacy readers missing from the reviewer's list were added on the
coordinator's instruction (`factions.ts:424,437` → `signatures.rs:345`; `melee.ts:107` → `melee.rs:256`); both are
one-line reads of the wall-aware map. The content half (outcome 5 of the first brief) was moved to P-FROST-WALL-2 on
the coordinator's decision (owner decision 2026-11-12 stands).
