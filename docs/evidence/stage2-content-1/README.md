# P-CONTENT-1: the five Wishes as definition rows and one verb interpreter

## 0. Revisions

- Base: `856618eb` (`origin/optimization_port`), the five-Wish casting checkpoint.
- Toolchain: `cargo 1.97.0`; no container needed (no new sources). Branch: `deepseek/p-content-1`.

**Phase/item.** Serves the content architecture of §6A of the completion prompt (Phase 1 foundation): new content becomes a
row and a verb, never a special case. The packet is byte-identical, so it adds no `DEVIATIONS.md` row.

## 1. Outcome

The five Wishes stop being hand-written `match` arms with per-ability code. Each is a typed definition row — id, slot,
cast/cooldown/charges, target, own-order/drops-lock and an **ordered list of effect steps** — executed by one exhaustive
verb interpreter. The cast pipeline resolves a slot through the table, not through a Wish-specific branch. A sixth,
test-only ability row made only of existing verbs runs through the same interpreter with zero system code.

## 2. Legacy paths

`packages/shared/src/abilities.ts` (`AbilityDef`/`AbilityRank`/`AbilityEffect`, `effectSide`), the five Wish rank rows and
constants, and `packages/server/src/sim/abilities.ts` (the single cast pipeline and its verb switch).

## 3. Write scope

- `crates/rh-sim/src/abilities/mod.rs`: `Side`, the closed `Effect` verb enum, `effect_side`, the row `Definition`
  (`slot`, `effects`), the five rows, `ability_in_slot`, the test-only six-row sample and the row validator.
- `crates/rh-sim/src/systems/abilities/effects.rs`: one interpreter over the verbs; `self_pass`/`target_pass` and the
  test-only `run_row`; the row harness tests.
- `crates/rh-sim/src/systems/abilities/mod.rs`: the generic slot path.
- `crates/rh-sim/src/sim.rs`: `with_cx` visibility for the test-only harness.
- `crates/rh-sim/src/abilities/source_tests/{runner,hash_tape}.rs`: the per-tick tape driver and test.
- `parity/abilities/hash-tape.json`, `tools/content-fixtures/mutants/**` and `run-mutants.sh`, this README, the ledger.

## 4. Contracts

- **C-TICK/C-PARITY:** the two landing passes and their order are unchanged; the existing source tests and the new per-tick
  hash tape prove byte identity.
- **C-DET:** `content_hash` and `CHECKPOINT_VERSION` are **unchanged** (the numbers are still the registered constants;
  the rows are slices of them, so `visit_content` is unchanged).
- **C-OBS/C-NET:** no new field or protocol change; ability ids already travel in cast/field events.
- **Data rule:** no system code branches on a specific ability id; `definition(id)` only selects a row.

## 5. Behaviour to preserve

Freeze = target stun 1250 ms. Swarm = self hidden 8 s + a 72 u following cloud that replaces the caster's old one. Trial =
target zone with the convicted radius (the caster's mark ≥ 3), the zoned payload and the field removed when the status is
refused. Blaze = blink to the cursor + the trail between the ends. Last Stand = the hp floor with the payback and its
taken reset, then the haste. Plus the row numbers and the self/target pass order.

## 6. Acceptance checks

- [x] **Byte-identical at the frame level:** `cargo test -p rh-sim --lib abilities` — **17 passed** (the frozen source
  corpus, including the two admitted full-source cases).
- [x] **Byte-identical at the hash level:** `parity/abilities/hash-tape.json` recorded at the base `856618eb` (53
  admitted source cases, FNV-folded over every stepped tick's state hash); `ability_hash_tape_matches_the_base` passes
  on the branch (the 10 named outstanding prerequisite cases are not admitted at either revision).
- [x] Full sim lib **447 passed**; parity **29/29**; schedule **14/14**; content **21/21** (including the unregistered-const
  scan, which forced the row numbers to stay the registered constants).
- [x] `cargo run -p rh-parity --bin parity-report` — **97 slice + 13 capture-only, 300 pathfinding queries: all MATCH**.
- [x] Sixth test-only row: a `#[cfg(test)]` `Definition` (Haste + Cloud, no production table entry) passes the generic
  harness: row validity, execution through the interpreter, determinism on an identical world, and checkpoint restore.
  The harness also pins the Trial convicted radius (mark tier 3 vs 2), the refused-zone field removal, and the Last Stand
  row numbers.
- [x] Negative controls: **8/8 mutants killed** (Freeze side, Swarm cloud radius, Trial convicted radius, Last Stand
  heal-back, Blaze trail, refused-zone removal, DeathFloor taken reset, Last Stand haste value); unchanged control passes.
- [x] `cargo fmt --all --check`; both strict Clippy workspace modes.
- [ ] `cargo test --workspace --all-features --locked` (throwaway PostgreSQL) — RUNNING.

## 7. Commands

```sh
cargo test -p rh-sim --lib abilities
cargo test -p rh-sim --lib ability_hash_tape
cargo test -p rh-sim --lib row_harness
cargo test -p rh-sim --lib
cargo test -p rh-parity --test parity
cargo test -p rh-parity --test schedule
cargo test -p rh-sim --test content
cargo run -p rh-parity --bin parity-report
tools/content-fixtures/run-mutants.sh
cargo fmt --all --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo clippy --workspace --all-targets -- -D warnings
eval "$(PGBIN=/opt/homebrew/opt/postgresql@16/bin bash tools/pgtest/start.sh)"
cargo test --workspace --all-features --locked
```

## 8. Traps

- The effect slice literals must be typed `as &[Effect]`: the match's tuple needs one type for every row.
- The content test scans `const`/static declarations: the rows are inline `&[...]` slices, not named arrays, so the
  numbers stay the registered constants and `content_hash` does not move.
- `definition` cannot be `const fn` with slice coercion; it is a plain function (the rows are promoted constants).
- The self pass runs before the target pass for all due casts; `effect_side` is the only switch the passes use.
- `run_row`/`with_cx`/the sample are `#[cfg(test)]` only; the production table has exactly five rows.
- The hash tape is recorded at the base in a scratch worktree with the same test-only driver; never re-record it on the
  packet's branch.
