# Backend/Unity union merge evidence

Branch `integration/backend-unity-union` (worktree `RogueHalla-worktrees/backend-unity-union`).

- Unity primary: `feature/unity-rework` `fbf6bb20` (protocol 16, OBS 23, checkpoint 30, replay 24, policy 17, content `06e2cdab2889abc5`).
- Backend tip: `codex/backend-gameplay-quests` `40999db1` (protocol 14 wire shape, OBS 22, checkpoint 30, replay 24, policy 16, content `fa16f195dc22ef69`).
- Merge base: `61f9f15f`. Command: `git merge --no-ff codex/backend-gameplay-quests`.
- Cargo.lock and Cargo.toml: no conflict and no change against `fbf6bb20` (no new dependencies).

## Conflicts and resolutions

| File | Resolution |
|---|---|
| `crates/rh-headless/examples/source_soak.rs` (add/add) | Unity side taken whole. It is a strict superset (adds the `[legacy|archetypes]` hitbox argument); checked by diffing stage 2 vs stage 3. |
| `crates/rh-headless/tests/source_arena_soak.rs` (add/add) | Unity side taken whole (adds the archetype-hitbox soak; backend's single legacy test is the same code). |
| `crates/rh-policy/src/lib.rs` | `POLICY_CONTRACT_VERSION` = 18 with doc history for 16/17/18, and the assertion in the test. |
| `crates/rh-sim/src/observe.rs` | `OBSERVATION_VERSION` = 24. Mob visibility hunk combines backend's `TileVisionCache` branch (`tiles.sees` / `point_visible`) with Unity's `mob_view(&sim.w, mob, now)` signature. |
| `crates/rh-sim/src/replay.rs` | Doc comment rewritten; `REPLAY_FORMAT` = `rh-replay/25` (the constant itself had auto-merged to 24). |
| `crates/rh-sim/src/reward_chests/trophy_observer_tests.rs` | Assertion `OBSERVATION_VERSION == 24`. |
| `crates/rh-sim/tests/content.rs` | `GOLDEN_CONTENT_HASH` rebound to the merged build's value (below), neither side's. |
| `parity/abilities/hash-tape.json` | Not hand-picked; regenerated (below). |

`crates/rh-sim/src/systems/frost.rs` auto-merged without conflict to Unity's `a1f1d129` form: direct `cx.s.attack_started[i]` with the sizing comment, no bounds-tolerant `.get(i)` read from `4151b3af`. Backend's unrelated `after_damage` reorder (`structural_source` evaluated last) is retained. The ledger/`weapons::update` fix and `fighter_churn_tests` are intact and pass.

## Auto-merge audit

Compared `mod` declarations of every changed file in `crates/` against both parents: no module registration was dropped (the two reported differences were visibility only, `fx_projector::exact` and `lib.rs checkpoint`, both still declared). `systems/mod.rs`, `checkpoint.rs`, `fighter.rs`, `content.rs` carry both sides.

## Build breakage fixed after the textual merge

1. `crates/rh-sim/src/fx_projector/card.rs:169`: Card bleed `SeenEvent::Hit` lacked Unity's new `critical` field. Set `critical: false` (a bleed tick is never a crit); wire shape unchanged.
2. `crates/rh-sim/src/systems/card_bleed_feedback/tests.rs` (~1302): expected `Hit` gets `critical: false`.
3. `crates/rh-sim/src/systems/card_bleed_feedback/source_tests.rs:156`: the source-capture `SimConfig` literal gets `hitboxes: LegacyCircle, mob_spacing: Default::default()` (Card captures are legacy-circle runs).
4. `crates/rh-parity/tests/schedule.rs`: allow-list gets `TraceEntry::Hook("runEnded", "cardHooks.flushBleeds")`. Backend ported that link, and neither parent edited this test; Unity still had it pending, so the test only fails in the union. By inspection this gap also exists on the backend parent (not rerun there).
5. `crates/rh-sim/src/systems/mob_spacing_tests.rs:383` `LEGACY_FOLD` rebound `0xc55c39b6e2f4f9aa` to `0xe39fef7e8f1748b7`. It is a fold of per-tick `state_hash` values. Correction (independent reviewer of `1319260b`): the earlier explanation that the content/statics digest seeds the hash was wrong; `state_hash` is `hash_of(self.k.digest, &self.w)` with `digest = hash_of(0, &(config, arena))`, so the content hash is not the seed. The real cause is that `World` now serializes the backend's `card_bleed` field. The reviewer verified empirically that with `World.card_bleed` set to `#[serde(skip)]` in a scratch copy the old fold `0xc55c39b6e2f4f9aa` is reproduced and `the_legacy_circle_trajectory_is_the_pre_spacing_one` passes, so the trajectory is bit-identical and only the hash layout changed.

## Identity changes

| Identity | Value | Location |
|---|---|---|
| Checkpoint | `rh-checkpoint/31` | `crates/rh-sim/src/checkpoint.rs:23`; asserts in `crates/rh-sim/tests/checkpoint.rs` (lines ~103, 154-158 now refuses 30 as immediate predecessor, 189/206, 271, 337, 352), `systems/sentenced/npc_tests.rs` (~463, refusal list gains `/30`), `fighter.rs:7`, `crates/rh-sim/README.md:71` |
| Replay | `rh-replay/25` | `crates/rh-sim/src/replay.rs:12`; `crates/rh-sim/tests/replay.rs` (assert, refusal list gains `/24`, immediate-predecessor control now `/24`) |
| Observation | 24 | `crates/rh-sim/src/observe.rs:20`; `trophy_observer_tests.rs:259` |
| Policy contract | 18 | `crates/rh-policy/src/lib.rs:42` and its test assertion |
| Wire PROTOCOL_VERSION | 16 (unchanged) | `crates/rh-protocol/src/lib.rs:191` |
| Content hash | `a2d1022ebe713382` | `crates/rh-sim/tests/content.rs:552` |

Everything else reads these symbolically (`POLICY_CONTRACT_VERSION`, `OBSERVATION_VERSION`, `CHECKPOINT_FORMAT`).

## Regenerated derived files

- `parity/abilities/hash-tape.json`: `cargo test --offline -p rh-sim --lib record_ability_hash_tape -- --ignored` (recorder in `crates/rh-sim/src/abilities/source_tests/hash_tape.rs`). Now `rh-checkpoint/31`, contentHash `a2d1022ebe713382`, observationVersion 24; all 63 folds re-recorded, tick counts unchanged. No captured legacy source file touched.
- `protocol/fixtures/archetypes_v1.json`: `cargo run -p rh-parity --bin hitbox-fixtures`; the only diff is `contentHash` `06e2cdab2889abc5` to `a2d1022ebe713382` (it records the content hash; the C# tests still pass). `pathfinding_v2.json` and `server_walk_v2.json` unchanged.
- Wire golden `protocol/fixtures/v16.json`: regenerated by `cargo run -p rh-protocol --bin protocol-fixtures`, no diff.

## Gates (all with `CARGO_TARGET_DIR=target-union CARGO_INCREMENTAL=0`, `LC_ALL=en_US.UTF-8`)

Postgres: `PGBIN=/opt/homebrew/bin RH_PGTEST_STATE=<scratch> tools/pgtest/start.sh` (needs `LC_ALL` set on this macOS or the postmaster fails "became multithreaded"); PG 16.15, so Postgres tests ran (not skipped).

| Gate | Result |
|---|---|
| `cargo build --workspace --all-targets` | first failures: the three `rh-sim` compile errors above (E0063). Clean after the fixes. |
| `cargo test --workspace --no-fail-fast` (first run, before items 4 and 5) | exit 101: 2457 passed, 2 failed, 21 ignored. Failures: `rh-parity --test schedule a_match_runs_its_ported_rows_in_table_order` ("axe_shred_stack: hook runEnded link cardHooks.flushBleeds is not ported") and `rh-sim --lib mob_spacing_tests::the_legacy_circle_trajectory_is_the_pre_spacing_one`. |
| Re-run after fixes 4 and 5 | `cargo test -p rh-parity --test schedule`: 14 passed. `cargo test -p rh-sim --lib the_legacy_circle_trajectory`: 1 passed. The rest of the workspace was not re-run in full after these two test-only edits. |
| `cargo run -p rh-parity --bin parity-report` | exit 0; 111 MATCH lines, 14 capture-only (not in Rust slice), no mismatch; hitbox goldens current. |
| `cargo clippy --workspace --all-targets -- -D warnings` | exit 0. |
| `cargo fmt --check` | exit 1, only `crates/rh-sim/src/systems/mob_spacing.rs` (two `sorted(vec![entry..])` calls). Pre-existing: that file is byte-identical to `fbf6bb20`. Not fixed here. |
| `cargo run -p rh-protocol --bin protocol-fixtures`, `git diff --stat protocol/fixtures` | `v16.json` no diff (wire unchanged). |
| `dotnet test client-unity/RoguehallaNet.Tests` | Passed 1241, Failed 0. |
| `node tools/protocol-js/check-vectors.mjs` | exit 0: v16, 70 server vectors, 272 malformed, 25 chains, 54205 checks. |
| `node tools/protocol-js/check-first-playable.mjs` | passes 60 focused checks then throws `Error: bad projectile`. Pre-existing: identical output on the primary checkout at `fbf6bb20`. |
| `cargo test --release -p rh-headless --test source_arena_soak -- --ignored` | 2 passed (archetype-hitbox and zombie-churn soaks), 19.55 s. |

Named suites, all in the passing workspace run: `abilities::source_tests::frozen_full_source_all_63_cases` and `admitted_coupled_source_cases_reproduce_their_real_producers`; `card_bleed_feedback::source_tests::the_seven_immutable_source_histories_reproduce_trusted_rows_and_cadence` (const `SOURCE_ORDINARY_STEPS = 390`); `systems::mob_checkpoint::bleed_tests::*` (5 earned-bleed NPC checkpoint tests); `room::quest_bridge_tests::*` (5); `runtime::tests::{which_runtimes_default_to_which_hitbox_mode, live_runtimes_follow_the_live_default_and_both_overrides_work, hitboxes_take_effect_on_the_core_path_too}`; `fighter_churn_tests` (both a1f1d129 regressions).

## Not done / for Root

- `docs/MIGRATION.md` and `docs/CONTRACTS.md` still carry the backend lane's identity text (14/30/24/22/16, `fa16f195dc22ef69`) and Unity's; those are coordinator-owned status records and were not edited.
- The `fmt` failure and the `check-first-playable` failure are inherited from the Unity branch.

## Second integration round: private Brain, host bundle, fmt, Archetypes composition proofs

Same environment as above (`CARGO_TARGET_DIR=target-union CARGO_INCREMENTAL=0`, `LC_ALL=en_US.UTF-8`, PG 16.15 from `tools/pgtest/start.sh`).

### Merges

| Merge | Result |
|---|---|
| `codex/deepseek-private-brain` `15b41709` (`--no-ff`) | Clean, no conflicts. Follow-up doc-only commit: `ReplayedOp.trace_exact` in `crates/rh-policy/src/bots/temporal_percept/brain/tests.rs` now describes the exact global ordered transcript comparator and keeps only the declared plain-object key-order limitation. After it: `cargo test -p rh-policy --lib` 440 passed / 0 failed (176 s); `temporal_percept::brain` filter 38 passed. |
| `codex/morning-host-bundle` `1f15f608` (`--no-ff`) | Clean, no conflicts. `docs/evidence/morning-host-bundle/manifest.json`: only the README row was stale (of 8 rows, the other 7 matched bytes and SHA-256); that row is now 5199 bytes with the on-disk SHA-256. `python3 -B -m unittest discover -s hosting/technical-demo -p 'test_*.py'`: 27 tests OK. |
| `cargo fmt` on `crates/rh-sim/src/systems/mob_spacing.rs` | Formatting only (8 insertions, 2 deletions). `cargo fmt --check` exit 0 workspace-wide. |

Also corrected above: the `LEGACY_FOLD` rebind explanation (cause is `World` now serializing `card_bleed`, not a content-hash seed; reviewer's scratch `#[serde(skip)]` run reproduced the old fold).

### Archetypes composition proofs (spec: P-BACKEND-UNITY-PREFLIGHT-1, "Minimal producer-composition proof")

Mode is selected in the config before the Sim/Room is constructed; LegacyCircle cases keep their names and behavior. No status row installed, no direct flush, no teleports, no legacy numbers used as oracles for the Archetypes runs.

1. `crates/rh-sim/src/systems/mob_checkpoint/bleed_tests.rs`: `earned_hemorrhage_bleed_on_regional_npc_restores_and_continues_under_archetypes`. The existing body was factored into `earned_bleed_restores_and_continues(hitboxes)`; the original test is a LegacyCircle wrapper. Asserts the ordinary Attack lands a weapon hit in Archetypes (`weapon_hit_rows > 0`) before the bleed assertions, then the full producer-field checks, checkpoint/restore equality, and 60 steps of original/Clone/restored equality of events, state hash and checkpoints, plus expiry. Passes; `place_attacker` needed no change (no reach gap).
2. `crates/rh-sim/src/systems/card_bleed_feedback/source_tests.rs`: `archetypes_first_use_case_delivers_a_real_public_card_hit_without_leaking_raw_reports`, via `config_with_hitboxes` / `construct_with_hitboxes` / `run_case_with_hitboxes` (the old `config`/`construct` wrappers were removed as dead code; `run_case` is still the LegacyCircle wrapper, the seven source histories / 390 steps untouched). Uses only the `first-use-clock-periodic-and-empty-interval` `input`. Asserts a real weapon hit lands, processed Card DoT contributions exist (victim p1, by p0), the periodic flush produced trusted `CardBleedHit` rows, public `SeenEvent::Hit` rows reached viewers whose sealed sight masks see the victim (finite, positive amounts), and every projected row is a non-passive public Hit. A first draft contained an extra assertion of mine that the raw report is gone after the run; it failed because it was a wrong expectation (a pending window can legitimately remain), not a reach gap, and it was removed rather than the others weakened.
3. `crates/rh-server/src/quest_bridge_tests.rs`: body shared as `quest_room_earned_shards_completion(hitboxes)`; `quest_room_earned_shards_completion_delivers_exact_owner_and_foreign_toasts` is the LegacyCircle wrapper, `..._under_archetypes` the new one (mode set on genesis Sim, `RoomConfig.sim`, and the active `reset_active` Sim). Observed completion ticks: LegacyCircle native tick 1386 (69300 ms); Archetypes native tick 1386 (69300 ms) (accept at tick 3, pickups 677/679/700 in both). Identical ticks are plausible (no combat in the run) and the test asserts `config().hitboxes == hitboxes`. Owner 4 / foreign 1 toast vectors, handles [18,19,20], Done/credit and the frozen oracle checks all pass in both.

### Gates on the final tree

| Gate | Command | Result |
|---|---|---|
| Workspace tests (Postgres up) | `cargo test --workspace --no-fail-fast` | exit 0: 2505 passed, 0 failed, 21 ignored |
| Parity | `cargo run -p rh-parity --bin parity-report` | exit 0: 111 MATCH lines; "109 slice scenarios + 13 capture-only, 300 pathfinding queries: all MATCH"; hitbox goldens current |
| Clippy | `cargo clippy --workspace --all-targets -- -D warnings` | exit 0 |
| Format | `cargo fmt --check` | exit 0 |
| Source arena soak (release), run twice | `cargo test --release -p rh-headless --test source_arena_soak -- --ignored --nocapture` | both exit 0: 2 passed / 0 failed (28.15 s, 25.37 s); the zombie-churn test runs seeds 6, 17, 28, 42, 62 twice each inside the test and compares; outputs identical between the two runs |
| Bounded soak example, run twice per mode | `cargo run --release -p rh-headless --example source_soak -- crates/rh-sim/src/mapdata/fixtures/seed1.map.json 6 11 6000 <legacy\|archetypes>` | all four runs exit 0, no panic; legacy run1 == run2 and archetypes run1 == run2 byte-for-byte (e.g. Archetypes seed 6: 1583 ticks, hash `841901b2fcb46326`; seed 8 truncated at 6000) |
| C# | `dotnet test client-unity/RoguehallaNet.Tests` (dotnet at `~/.dotnet`) | Passed 1241, Failed 0 |
| JS decoder | `node tools/protocol-js/check-vectors.mjs` | exit 0: v16, 70 server vectors, 272 malformed, 25 chains, 54205 checks; `git diff protocol/` empty: wire unchanged |

`cargo run -p rh-protocol --bin protocol-fixtures` was not re-run this round (no rh-protocol change); only the JS vector check was.
