# P-ALLOC-CLONE-WARM-1: the first step after a clone or a restore allocates nothing, and the test that says so runs

- **Serves:** the zero-warm-allocation contract of `rh-sim` steps (the `no_alloc` suites); finding of
  P-TRAINING-CAMPS-1's implementer and reviewer-opus (2026-11-13)
- **Implementer tier:** implementer-opus (rh-sim state, clone and restore)
- **Reviewer:** reviewer-opus
- **Integration base:** feature/unity-rework, after P-TRAINING-CAMPS-1
- **D-rules touched:** D1 n/a · no behaviour change: no hash, checkpoint, replay or wire identity moves

## 1. ID and outcome
`cargo test -p rh-sim --test pack_leader_warm` (default features) fails on the integration branch:
`clone warm window allocations left: 1 right: 0`: one 32-byte block at tick 116 on a cloned world and on a restored
one, none on the original (window ticks 115-155, 9 actors). It is a real one-time allocation on the first step after
a copy: some buffer whose capacity `Clone` drops and restore does not re-reserve (reviewer-opus, read; not located).
Nobody saw it because the file is `#![cfg(not(feature = "schedule-trace"))]` and both the gate and CI run rh-sim only
with `--features trusted-status-probes`, which turns `schedule-trace` on, so the test compiles to nothing.
When this lands: (a) the buffer is found and keeps its capacity across clone and restore (as P-TRAINING-CAMPS-1 did
for the practice contributors), so the test passes; (b) the test runs where the gate runs: either it no longer needs
`schedule-trace` off (say why it was gated and whether that reason still holds), or the gate gains a default-features
run of that one test (an edit to `scripts/gate.sh` and `.github/workflows/rust.yml`: owner approval, named in the
hand-off, not made by the implementer).

## Second finding (2026-11-13, P-TRAINING-CAMPS-1's implementer): a fight against mobs allocates in steps

Measured with `crates/rh-sim/tests/no_alloc_training.rs` (committed `#[ignore]` by P-TRAINING-CAMPS-1; `RH_TRACE_ALLOC=1`
prints each allocating step): a seated Holy player with a wand fighting a console Ember Imp camp to its clear
allocates 29 blocks over 165 measured steps on the original world and 39 on a clone and on a restore; identical on
the sources before P-TRAINING-CAMPS-1, so the practice contributors add none. The existing `no_alloc` fixtures never
reach these sites: they are arena worlds where no mob is fought or killed. The sites (a throwaway probe, since
deleted):

| Blocks | Site |
|---|---|
| 15 x 32 B | `World::actor_label` building an `Arc<str>` from `cards::on_hit::run_on_hit`, on every player hit on a mob |
| 3 x 544 B | `ledger::apply_victim` collecting `OverkillHit`s |
| 3 x 64 B | `mob_ai::add_threat` |
| 3 x 16 B | the threat clone on a lethal hit in `mob_life::hurt` (the shared kill path, arena included) |
| 2 x 16 B | `mob_life::reap` |
| 3 x 64 B | `Path::set_from` from the wand lock |

This is larger than the clone-and-restore finding above and is the same contract: split it into its own packet
(`P-ALLOC-MOB-FIGHT-1`) if the oracle author finds it does not fit one change. Its oracle is that ignored test with
the `#[ignore]` removed and all three windows at zero. No behaviour, hash or draw may change: every fix is a buffer
kept, a label interned once, or a scratch vector reused.

## 5. Exclusive write scope
- `crates/rh-sim/tests/pack_leader_warm.rs`, and the state type that owns the buffer (the oracle author names it)

## 7. Behaviour to preserve
- Every state hash, checkpoint and replay byte; parity all MATCH; the existing `no_alloc` suites.

## 8. Acceptance checks
- `cargo test -p rh-sim --test pack_leader_warm` passes in the feature set the gate uses, with original, clone and
  restore all at zero; a second window on another seed or actor count is also zero.
- `scripts/gate.sh --quick --oracle packet/P-ALLOC-CLONE-WARM-1` passes.

## Oracle files (read-only for implementers)
- listed by the oracle author on `packet/P-ALLOC-CLONE-WARM-1` (the existing test is the oracle if it can be made to
  run under the gate's features without changing what it asserts)

## 10. Risk and suggested model tier
Opus: capacity must never reach serde or `PartialEq`.

## Notes from previous attempts
