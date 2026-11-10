# P-BOT-POTION-FACT-1: accepted owner potion-fact native proof

**Status: test-only evidence, complete for the bounded packet.** The proof lives in the NEW module
`crates/rh-policy/src/bots/potion_fact_tests.rs` and its single NEW `#[cfg(test)]` registration in
`crates/rh-policy/src/bots/mod.rs`. No production code, existing engine/test file, source fixture, dependency/lock,
schema, protocol, Unity, hosting, shared status record or permission was changed. The only runtime artifacts are the
ignored build cache `target/potion-fact-build/` (never sealed) and the console/Git receipts below.

## Start and source identities

- Worktree: `/Users/nevinmckinnon/Documents/Projects/RogueHalla-worktrees/backend-bot-potion-fact`
- Branch: `codex/deepseek-potion-fact`
- Clean start commit: `3e2d902821dc74ba0ebd003f5a3a95c92d2eb5c5` (recorded by Root in the dispatch; confirmed by
  `git rev-parse HEAD` before any edit).
- Toolchain: `cargo 1.97.0 (c980f4866 2026-06-30)`, `rustc 1.97.0 (2d8144b78 2026-07-07)`,
  `rustfmt 1.9.0-stable`, `clippy 0.1.97`, pinned by `rust-toolchain.toml` (`1.97.0`).
- Host: Apple M5 Pro, 18 logical CPUs, macOS 26.6.1 arm64. Isolated ignored target:
  `<worktree>/target/potion-fact-build` (`/target` is git-ignored; no source directory is a target).
- Consumed source predicate: `packages/server/src/bots/brain/runner.ts` (`shouldUsePotion` reads
  `(me.healingUntil ?? 0) <= now` at lines 29-35), sha256
  `345b94151ba4185736269acd782385a66d24cfaa50dafd75900cfad944c66164`, git blob
  `bcdec2aa29c27f99d73f55d42e9bf4e8531f8083`.
- Classification input: `docs/evidence/bot-fair-activation-plan/field-closure.md` row "Owner healing eligibility"
  (same-sample boolean only, non-ended, missing inventory unavailable).
- Native producer read (not modified): `crates/rh-sim/src/systems/potions.rs` (use at `:39-108`, HOT update/clear at
  `:110-145`, `fighterOut` clear at `:146-156`, validator at `:157-204`), `crates/rh-sim/src/potions/mod.rs`
  (`DEFINITION`: cap 5, concurrent 3, heal 5000 ms, step 500 ms), observer inventory projection
  `crates/rh-sim/src/item_view.rs:500-506`, accepted delivery `crates/rh-policy/src/delivery/{session,frame,collections}.rs`.
- Exact hashes of all consumed/observed files and of every sealed file are in `MANIFEST.json` and
  `logs/00-environment-and-identities.log`.

All source identities are at commit `3e2d9028`; this proof was executed at that tree with only the two owned Rust
paths added/changed. **Seal status: the git metadata directory is outside the writable workspace for this session,
so `git add`/`git commit` fail with `Unable to create .../index.lock: Operation not permitted`. No commit was
created, HEAD is unchanged and no permission was changed. `logs/11-git-seal-inaccessible-receipt.log` records the
actual failure, the exact uncommitted file set, the only permitted `index.lock`-free `git` reads, the exact
`git add`/`git add -f` commands and the SHA-256 of every file Root must seal.**

## What was actually run

Every command below was executed in this worktree with `PATH` set to the pinned
`/Users/nevinmckinnon/.rustup/toolchains/1.97.0-aarch64-apple-darwin/bin`, `CARGO_TARGET_DIR` set to the isolated
target above, and `--offline --locked`; raw stdout/stderr and exits are in `logs/`.

| # | actual command | result |
|---|---|---|
| 04 | `cargo test --offline --locked -j 8 -p rh-policy --lib potion_fact_tests -- --test-threads=1` | exit 0, **5 passed**, 0 failed, 220 filtered out |
| 05 | `cargo test --offline --locked -j 8 -p rh-policy --lib delivery -- --test-threads=1` | exit 0, **33 passed**, 0 failed |
| 06 | `cargo test --offline --locked -j 8 -p rh-policy --lib trade -- --test-threads=1` | exit 0, **6 passed**, 0 failed |
| 07 | `cargo test --offline --locked -j 8 -p rh-policy --lib fair_percept -- --test-threads=1` | exit 0, **9 passed**, 0 failed |
| 08 | `cargo fmt -p rh-policy -- --check` | exit 0 |
| 09 | `cargo clippy --offline --locked -j 8 -p rh-policy --all-targets -- -D warnings` | exit 0 |
| 10 | `cargo clippy --offline --locked -j 8 -p rh-policy --all-targets --all-features -- -D warnings` | exit 0 |

The repository's top-level `.gitignore` ignores `*.log`; the recorded receipts under `logs/` are exact evidence
files and are force-added to the seal commit by explicit path. They are console/Git receipts only — never build
output, a cache or a private transcript of a different tree.

No full-workspace run and no campaign were performed; the focused filter plus the three named overlapping existing
suites are the packet's scoped validation. First failures of the session are preserved honestly in
`logs/01`-`logs/04` (a test-module compile error, a format diff, a strict-Clippy style error and one test-side
sample-clock assertion failure); each is described with its repair in the log. No failure ever implicated the native
producer or the accepted-delivery boundary. No counterexample and no missing public API were found.

## The finite trajectories (all facts below are asserted, not hand-copied)

The owner (seat 1) is observed through a real `ItemObserver::prepare_into` and a real
`DeliverySession::prepare` -> `commit`; only the resulting opaque `AcceptedFrame14` is read. The declared starting
fixture is a valid checkpoint whose declared stock/hp is accepted by `Sim::restore` — an explicit setup baseline, not
an earned gameplay claim. Every producer act after that is an ordinary `validate` + `Sim::submit` command and ordinary
`Sim::step` ticks; the only non-command mutation is the ordinary `Sim::remove_player` leave used by the missing-fact
control.

Shared invariant checked at every accepted sample by `check_healing_fact` (no Ended frame is converted):

- the accepted frame's `tick` and `source_time` bit-equal the trusted serialized checkpoint's `world.tick` and
  `world.server_time` (same sample, exact accepted clock; never `tick*50`, `viewT` or wall time);
- `AcceptedFrame14::frame().inventory()` is `Delivered(Some(inv))`; `inv.potions_healing` equals both the trusted
  owner mirror `players[i].potions_healing` and the trusted `world.potion_healing` HOT-row count;
- `potions_healing > 0` iff the trusted mirror `healing_until > source_time`;
- with HOT rows: every last-known `next > source_time`, and `healing_until == last.next + (left-1) * 500` (the
  validator's stored-deadline identity; 500 is the actual `DEFINITION.step_ms`);
- with no HOT row: `potions_healing == 0` and `healing_until == 0`;
- an Ended frame (`phase == 2`) is refused even when the boolean happens to agree; a missing/unavailable inventory is
  refused, never converted to `false`.

| trajectory | accepted samples (tick @ source_time) | asserted facts |
|---|---|---|
| `accepted_use_overlap_final_expiry_and_mid_hot_restore_continuation` | 1@50; 2@100; 3@150; 4@200; 10@500; 102@5100; 103@5150; 104@5200 | fresh false (count 0) -> real first use true (count 1, deadline 5100); real second/third uses reach overlapping HOTs (counts 2, 3; deadlines 5150, 5200; each HOT's final expiry equals its use source_time + `DEFINITION.heal_ms`); at the first HOT's final expiry (102@5100) two HOT rows survive and the predicate is still true; at 103@5150 the second HOT's final expiry leaves the last row and the predicate is still true (one accepted tick before the last expiry); at 104@5200 the last HOT expires and the predicate is false (count 0, both mirrors 0). A real mid-HOT checkpoint at 10@500 is serialized from the exact accepted sample, `Sim::restore` accepts it, and the restored continuation reproduces the same counts, deadlines and final expiry `source_time` at the same absolute clocks. |
| `real_non_ended_fighter_out_cleanup_clears_live_hot_mirrors_and_inventory` | 1@50; 2@100; 3@150; 4@200 | declared owner hp 1; real use makes healing true (count 1, admitted deadline 5100); a real adjacent seat's validated sword swing downs the owner; the accepted frame at 3@150 is still phase **Active** (one), the owner status is `Dead`, inventory count is 0 and the trusted HOT rows/deadline/count are all cleared by the real `fighterOut` hook; the next accepted sample 4@200 persists false in the same non-Ended run. |
| `ended_phase_elapses_the_hot_deadline_outside_the_predicate_contract_and_restores` | 2@100; 3@150; 103@5150 | declared baseline: owner hp 500, victim hp 1, stock 1; real use is true (count 1, deadline 5100); the owner's real validated swing ends the two-player run at 3@150 (phase **Ended**). Right after the end the retained row still makes the boolean agree, but the comparator refuses the frame because the producer no longer updates it. At 103@5150 the retained `healing_until` (5100) is already in the past while `potions_healing` is still 1, so the conversion would be wrong — the explicit Ended refusal is required. The genuine Ended checkpoint with this elapsed HOT is still accepted by `Sim::restore` (restore admission is not narrowed). |
| `removed_owner_missing_inventory_stays_unavailable_and_mirrors_clear` | 2@100; 3@150 | real use is true (count 1) in a three-player run; the real active-run leave `Sim::remove_player(1)` (MIA) cleans the HOT row; the accepted frame for the removed owner at 3@150 is still non-Ended (phase Active) and its `inventory()` is `Delivered(None)`; the comparator refuses it as unavailable/missing, never false; the trusted mirror has no owner row and no HOT row. |
| `comparator_controls_reject_wrong_count_deadline_and_sample_time_pairing` | 2@100; 3@150 | on already-captured accepted facts only (no gameplay mutation, no expected answer fed to the sim or frame): a wrong HOT count, a wrong tick, a wrong source clock, a wrong admitted deadline and a real later accepted frame paired with the earlier sample are each rejected; the same later frame with its own same-sample mirror passes, so the rejection is the pairing, not a changed producer. |

## What is and is not claimed

- The proof covers the source runner's consumed healing boolean only: at an accepted non-Ended (validated Active)
  sample, `potions_healing > 0` is exactly `healing_until > source_time` at the accepted `source_time`.
- It does not reconstruct an absolute deadline from the boolean, implement a potion retry clock, implement a runner,
  claim adapter queue acceptance versus a later simulation refusal, add a public/wire fact, or activate live bot
  behavior. The declared baseline stock/hp is setup, not an earned looting/combat claim.
- The ended domain is deliberately excluded and nothing here narrows restore admission; an Ended checkpoint with an
  elapsed retained HOT still restores.
- Missing inventory (no owner row / `Delivered(None)`) is unavailable, not "not healing".
- No clone/hash campaign was run: the one checkpoint continuation is the explicit mid-HOT restore above.
- No production/other-file/protocol/Unity/shared-status edit, no dependency or `Cargo.lock` edit, and no permission
  change was made. Nothing under `target/` is sealed.

## Files sealed by this packet

1. NEW `crates/rh-policy/src/bots/potion_fact_tests.rs`
2. `crates/rh-policy/src/bots/mod.rs` — exactly one added registration: `#[cfg(test)] mod potion_fact_tests;`
3. NEW `docs/evidence/bot-potion-fact-native/**` (this README, `MANIFEST.json`, preserved first-failure excerpts and
   the recorded command logs)

`MANIFEST.json` binds SHA-256 and byte sizes for the owned source files, the preserved command logs 00-10, this
README and each consumed file. `logs/11-git-seal-inaccessible-receipt.log` is the post-manifest seal receipt: it
lists the final SHA-256 of every exact file, the unchanged HEAD, the actual sandbox denial and the exact commands
Root must run (including `git add -f` for the gitignored `*.log` receipts). Nothing under `target/` is included.
