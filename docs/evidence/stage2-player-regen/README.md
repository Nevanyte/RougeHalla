# P-MOBS-2 (regen slice): passive player regeneration

## 1. Outcome

Port `packages/server/src/sim/regen.ts` into `rh-sim`: the config-gated passive regeneration system that heals a standing
player below max hp every tick — `PLAYER_REGEN_SHARE_OUT` of max hp a second when no hit has been dealt or taken for
`PLAYER_REGEN_QUIET_MS`, `PLAYER_REGEN_SHARE_IN` while in a fight — through the shared heal funnel (anti-heal and the
heal-taken cards apply), quietly (no fx, no event), with the source's own combat clock fed from the tick's landed rows
(the victim and the attacker) and cleared at `raidStarted`. It is `SimConfig.regen`, default **Off**, so every existing
mode, fixture, parity output and outcome is unchanged; regeneration plays only in a world that asks for it (the
`regen_clock` capture does).

This is a slice of P-MOBS-2. That packet's other pieces — the camp-clear potion reward and its contributor/eligibility
rules (`campHeal.payCampHeal`, which needs the large potion of P-CONS-1), the rest of the `campCleared` chain, and any
remaining elite-chest/ward gaps — are not in this branch and stay Pending. Wards (`CAMP_WARD_MS`, `wardOwner`), camp
respawn and elite chests are already ported at this base (`sim/mob_life.rs`, `sim/camps.rs`, `reward_chests/`).

## 2. Legacy paths verified with `rg`

- `packages/server/src/sim/regen.ts` — `regenPass`, `install`, the `raidStarted` clock clear.
- `packages/server/src/sim/factions.ts` — `heal(world, c, amount, { quiet, ignoreLockout, noBarrier, source })`: the
  lockout only for non-`ignoreLockout` heals, `healFactor`, `healTakenMultOf` for non-lifesteal heals, no `heal` fx when
  quiet, and `standing`/`amount > 0` gates.
- `packages/shared/src/constants.ts` — `PLAYER_REGEN_SHARE_OUT = 0.008`, `PLAYER_REGEN_SHARE_IN = 0.0025`,
  `PLAYER_REGEN_QUIET_MS = 3000`.
- `packages/server/src/sim/gameplay.ts` — the install position: after `installFactions`/terrain, before `installAbilities`
  (the systems row `factions.afterDamage` … `terrainEffects.lightPass` … `regen.regenPass` … `abilities.abilityDotFx`).
- `packages/server/src/config.ts` — the live server's `REGEN` default is on; the Rust live profile keeps it staged Off
  (see the owner question).
- `packages/server/src/sim/world.ts` — `SimConfig.regen?: boolean`, unset = none.

## 3. Write scope

- `crates/rh-sim/src/systems/regen.rs` (new; system + hook link + unit tests), `systems/mod.rs`,
  `src/schedule.rs` (the `regen.regenPass` system row and the `regen.<arrow>` `raidStarted` link, both flipped in place),
  `src/statics.rs` (`SimConfig.regen`), `src/state.rs` (`Player.regen_at`, the readable combat clock), `src/constants.rs`
  (three registered constants, appended), `src/checkpoint.rs` (clock rule + refusal test).
- `crates/rh-parity/src/lib.rs` (`legacyConfig.options.regen`), `crates/rh-parity/tests/regen.rs` (new every-tick restore
  proof), `crates/rh-parity/tests/schedule.rs` (the flipped rows stay ported),
  `crates/rh-headless/tests/regen.rs` (a seeded six-bot match with regeneration on: every-few-tick restores, a full replay
  to the same final hash, and a check that the quiet share really ran).
- Two structural schedule expectations that every row flip updates, with no oracle value changed:
  `crates/rh-sim/src/schedule.rs`'s `a_plan_is_the_tables_resolved_for_its_gates` gains `regen.regenPass` in its
  expected live systems list, and `crates/rh-sim/src/systems/planning/source_tests.rs` adds `regen` to the
  "installers the core source profile omits, whose native callbacks are inert" filter (the legacy `parity/arena`
  capture's `raidStarted` trace really has only terrain/abilities/vision; its source world never installs regen).
- `crates/rh-sim/tests/no_alloc.rs` (regen exercised in the warmed gate), `crates/rh-sim/tests/content.rs` (the content
  golden, an intentional registry change `e95d55ba96b2feca` → `898f82bbb6215c5b`).
- Every exhaustive `SimConfig` literal in `rh-server`, `rh-headless` and `rh-load` gains `regen: false` (the field has
  `#[serde(default)]`; the literals are exhaustive, so the new field is one line each).
- `parity/legacy-capture/{capture.ts,scenarios/regen.ts}`, `parity/fixtures/regen_clock.json`,
  `tools/regen-fixtures/{capture.sh,run-mutants.sh,source-manifest.json,mutants/*.patch}`, this README and the progress
  ledger.

## 4. Contracts

- **C-TICK:** the system keeps its recorded position (SYSTEMS row 10, after `terrainEffects.lightPass`) and the
  `raidStarted` link its recorded position (RAID_STARTED link 5, after terrain's, before `abilities.armWishes`). The
  schedule tables are unchanged in order and `crates/rh-parity/tests/schedule.rs` passes.
- **C-INPUT:** no new command.
- **C-RNG:** no random stream.
- **C-NUM:** f64 in the source's order (`maxHp * share * (dtMs / 1000)`); the share constants are the registered rows.
- **C-OBS:** no public field: a quiet heal emits no event and no fx, so observations, protocol (`PROTOCOL_VERSION` 8),
  golden vectors and the C#/JS decoders are untouched.
- **C-DET:** `Player.regen_at` is a `World` leaf (hashed, checkpointed, no side table); a restored checkpoint continues
  identically at every captured tick.
- **C-PARITY:** the new `regen_clock` scenario is `parity: "slice"` and compares at every tick.

## 5. Behaviour to preserve

- `config.regen == false`: the system returns before touching anything (the staged default; the whole existing gate is
  byte-identical in outcomes).
- The clock is stamped for each landed row's victim and attacker, in ledger order, before the `gates_locked` early
  return. Only players are stamped: legacy keeps a map keyed by every fighter id but reads only players, and ids are never
  reused, so the readable state is per player.
- No clock entry = out of combat at once. `now - last >= PLAYER_REGEN_QUIET_MS` is the out share; anything closer is in.
- A locked coliseum (sudden death) regenerates nobody, but its hits still stamp the clock.
- Death/leave: a non-standing player is skipped (the funnel would refuse the heal anyway); `raidStarted` clears every
  clock.
- The heal goes through the same funnel as every other heal (status `healFactor`, the heal-taken multiplier for
  non-lifesteal, the standing/positive-amount gates, the max-hp clamp) and is quiet: no `heal` event, no `heal` fx, no
  Second Skin barrier (legacy `noBarrier`; the barrier producer is P-CARDS-1 and does not exist yet).

## 6. Acceptance checks

- [x] The pinned-container capture `parity/fixtures/regen_clock.json` compares at every tick through
      `every_slice_fixture_matches_legacy` (200 ticks, 3 events, 0 results, max hp err 4.47e-7).
- [x] `crates/rh-parity/tests/regen.rs` re-checks the two shares and the untouched fighter, then restores from a
      checkpoint at every one of the 200 ticks and continues with identical events and state hash.
- [x] `cargo test -p rh-headless --test regen` — 1 passed: a seeded six-bot match with `regen: true` restores at every
      seventh tick, the quiet share is observed, and `run_replay` reproduces the final state hash.
- [x] Unit tests: off unless configured; out share with no clock and a quiet heal; victim+attacker stamped (and a third
      fighter untouched); the exact 3 s boundary; locked coliseum; down player; `raidStarted` clears.
- [x] Checkpoint rule + refusal test for a future/negative `regen_at`.
- [x] `cargo test -p rh-sim --test hash_coverage` — 6 tests, every serialized leaf perturbs the hash (the new `regen_at`
      leaf is covered).
- [x] `cargo test -p rh-sim --test no_alloc -- --nocapture` — `regen_clock: 160 measured steps, 0 allocations`.
- [x] `cargo test -p rh-sim --test content` — 21 tests (golden updated to `898f82bbb6215c5b`).
- [x] `cargo test -p rh-parity --test schedule` — 14 tests; `regen.regenPass` and `regen.<arrow>` are asserted ported.
- [x] `cargo run -p rh-parity --bin parity-report` — 98 slice scenarios + 13 capture-only, 300 pathfinding queries: all
      MATCH.
- [x] Six-plus negative controls: eight committed mutants, 8/8 killed by semantic test failures (never a compile error),
      tree restored after each, unchanged control passes (`tools/regen-fixtures/run-mutants.sh`).
- [x] Strict Clippy in both workspace modes (`--all-features` and default) is clean; `cargo fmt --all --check` is clean.
- [x] `cargo test --workspace --all-features --locked` with the throwaway PostgreSQL cluster: **1,389 passed, 0
      failed, 2 ignored, 151 test binaries, exit 0** on the head tree.
- [x] `node tools/browser-proof/proof.mjs` after `cargo build -p rh-server` — 15/15 checks PASS, 4 Full + 415 delta
      snapshots, no page errors; the server advertises the new `contentHash 898f82bbb6215c5b` (protocol unchanged at 6).
- [x] `cargo test -p rh-sim --test schedule` was not needed: the `rh-parity` schedule test (`14 passed`) is the
      legacy-record conformance gate.
- [ ] Live server: keeps `regen: false` in its staged profile (owner question 1).

## 7. Commands

Toolchain: `cargo 1.97.0 (c980f4866 2026-06-30)` from `rust-toolchain.toml` (`channel = "1.97.0"`), pinned
`CARGO_HOME=~/.codex/tools/rougehalla-stage2/cargo`, `RUSTUP_HOME=~/.codex/tools/rougehalla-stage2/rustup`,
`CARGO_INCREMENTAL=0`. Capture container: `node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292`,
linux/amd64, Node v22.23.4.

```sh
tools/regen-fixtures/capture.sh --check                       # byte-for-byte regen_clock.json
cargo test -p rh-sim systems::regen --lib                     # 7 passed
cargo test -p rh-sim checkpoint::tests::a_future_dated_regeneration_clock_is_refused --lib  # 1 passed
cargo test -p rh-parity --test parity every_slice_fixture_matches_legacy -- --nocapture      # regen_clock 200 ticks OK
cargo test -p rh-parity --test regen                          # 1 passed (200 restores)
cargo test -p rh-headless --test regen                        # 1 passed (seeded restore + replay)
cargo test -p rh-parity --test schedule                       # 14 passed
cargo test -p rh-sim --test no_alloc -- --nocapture           # 1 passed; regen_clock 160 measured, 0 allocations
cargo test -p rh-sim --test hash_coverage                     # 6 passed
cargo test -p rh-sim --test content                           # 21 passed
cargo test -p rh-protocol                                     # all suites passed
cargo run -p rh-parity --bin parity-report                    # 98 + 13, 300 queries, all MATCH
tools/regen-fixtures/run-mutants.sh                           # 8/8 killed; unchanged control passes
cargo fmt --all --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo clippy --workspace --all-targets -- -D warnings
eval "$(PGBIN=/opt/homebrew/opt/postgresql@16/bin bash tools/pgtest/start.sh)" && cargo test --workspace --all-features --locked
# 1,389 passed, 0 failed, 2 ignored, 151 test binaries, exit 0
```

## 8. Shared-file hunks

- `crates/rh-sim/src/schedule.rs`: the `regen.regenPass` SYSTEMS row and the `regen.<arrow>` RAID_STARTED link, both
  flipped from `pending` to `ported` in place; nothing moved.
- `crates/rh-sim/src/statics.rs`: `SimConfig.regen: bool` (`#[serde(default)]`, default false). The statics digest and
  therefore every state hash move — an intentional, declared fold change (see the PR's
  `Perf-Allow-Fingerprint: stateHashFold`).
- `crates/rh-sim/src/state.rs`: `Player.regen_at: Option<f64>` (`#[serde(default)]`), a hashed/checkpointed leaf.
- `crates/rh-sim/src/checkpoint.rs`: the clock rule and its refusal test.
- `crates/rh-sim/src/constants.rs`: three registry rows appended (declaration order is part of the content hash).
- `crates/rh-sim/tests/content.rs`: `GOLDEN_CONTENT_HASH` `0xe95d_55ba_96b2_feca` → `0x898f_82bb_b621_5c5b`.
- `crates/rh-parity/src/lib.rs`: the `regen` option accepted from `legacyConfig.options`.
- `crates/rh-sim/tests/no_alloc.rs`: maps `options.regen` and counts `regen_clock`.
- The exhaustive `SimConfig` literals (one `regen: false` line each): `rh-server/src/{main,room,director}.rs`,
  `rh-server/src/bin/densitybench/engine.rs`, `rh-server/examples/connheap.rs`,
  `rh-server/tests/{account_api,account_api_memory,control,density,equivalence,lifecycle,live,pg_e2e,publish,result_recovery,transport}.rs`,
  `rh-load/tests/smoke.rs`, `rh-headless/src/bin/determinism_sweep_support/mod.rs`.

## 9. Traps

- The capture's `attack` trigger stays held until a `release` that carries an angle (`{a}`); `release: {}` is refused and
  a scenario that means to stop one swing keeps swinging. The first capture of `regen_clock` did exactly that and was
  replaced (the checked-in fixture is the second capture, byte-checked).
- The quiet window is measured against the tick's `server_time` and the source's `>=`, so the boundary tick is the first
  out-of-combat one; an off-by-one there is visible immediately in the captured hp trace (one of the mutants).
- The attacker must be stamped too: a fighter that only deals damage would otherwise be out of combat at once. That is
  why `regen_clock`'s attacker (`p0`) is below max hp and `p1` never attacks.
- The `rh-parity` harness refuses an unported `legacyConfig.options` key, so the option mapping is part of the packet, not
  a test helper.
- The first full workspace gate failed `result_recovery`'s restart test because the shell had not **exported** `PGBIN`
  for that test's own `tools/pgtest/start.sh` child on macOS — environmental, not a code failure. With `PGBIN` exported
  the test and the whole suite pass.

## 10. Owner questions

1. **When does the Rust live profile turn `regen` on?** Legacy's live server has it on by default (`REGEN !== "0"`); the
   Rust live profile is still staged (`hazards`, `abilities`, `lifecycle` and the faction set are Off there too), and this
   packet keeps `regen: false` to leave every existing live/headless expectation unchanged. Flipping it is a product
   decision the coordinator should take with the rest of the staged profile.
2. **State-hash fold change.** Adding the config field and the player leaf moves every state hash, so the PR must declare
   `Perf-Allow-Fingerprint: stateHashFold`; the recorded replay inputs are still compared, as the perf tool's
   `--rerecord` path does for a declared fold change.
