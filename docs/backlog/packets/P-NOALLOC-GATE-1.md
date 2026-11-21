# P-NOALLOC-GATE-1: the first step after a clone or a restore allocates nothing, and the gate runs the tests that say so

- **Serves:** the zero-warm-allocation contract of `rh-sim` steps (`crates/rh-sim/AGENTS.md`, "Every sim-editing packet
  keeps these green": the `*_no_alloc` suites). A regression found by the coordinator on 2026-11-19 while unblocking a
  rework packet; it takes over parts (a) and (b) of the older brief
  [P-ALLOC-CLONE-WARM-1](P-ALLOC-CLONE-WARM-1.md), which was never dispatched. That brief's second finding (a mob fight
  allocates in steps, `tests/no_alloc_training.rs`, committed `#[ignore]`) stays with it and is not in this packet.
- **Implementer tier:** implementer-opus (rh-sim clone and restore preparation, plus the gate)
- **Reviewer:** reviewer-opus
- **Integration base:** `feature/unity-rework` @ `10001a404`
- **D-rules touched:** D1 n/a (no behaviour change) · D2 n/a · D5/D6/D9 none

## 1. ID and outcome
`cargo test --locked -p rh-sim --test pack_leader_warm` (no features) fails on the integration branch:

```
same-checkpoint warm windows: original=0 clone=1 restore=1 start_tick=115 end_tick=155 actors=9
clone warm window allocations   left: 1  right: 0
```

(`crates/rh-sim/tests/pack_leader_warm.rs:84`, the assertion at line 134). One 32-byte block on the first measured step
of a cloned world and of a restored one; none on the original.

**Cause (diagnosed 2026-11-19).** `fx_report::BuildMarkCache` (`crates/rh-sim/src/fx_report.rs:54`) holds
`rows: Vec<(PlayerId, [Option<KillStatKey>; 2])>` (8 bytes a row). It lives in `Projection::marks`, and every projection
that `Sim::clone` (`impl Clone for Projection`, `fx_report.rs:125`, which calls `empty_at`), `Checkpoint` restore
(`checkpoint.rs:246`) and `Sim::reset_active` (`sim.rs:263`) build comes from `Projection::empty_at`
(`fx_report.rs:100`) with `marks: BuildMarkCache::default()` (`fx_report.rs:107`): an empty `Vec` with no capacity. The
end-of-step `refresh` (`fx_report.rs:59`, called at `fx_report.rs:207`) then pushes the seated players, and the first
push allocates (4 rows x 8 bytes = the 32 bytes measured). The original world allocated the same block during its
warm-up, so its window is clean. The cold preparation `Projection::prepare_mobs` (`fx_report.rs:112`) pre-sizes the mob
buffer but nothing pre-sizes this one.

**First bad commit.** `948064758` (2026-11-10, "Merge rework/wire-facts: ADR 0026 legacy indicator facts…"), through
its side-branch commit `84fd5461b` ("build marks computed once per player per tick at the end of the step"), which
added `BuildMarkCache`.

**Why no gate saw it for nine days.** `pack_leader_warm.rs` and `cards_no_alloc.rs` both start with
`#![cfg(not(feature = "schedule-trace"))]`. `trusted-status-probes` turns `schedule-trace` on
(`crates/rh-sim/Cargo.toml:27`), and every rh-sim step of `scripts/gate.sh` (`sim_tests`, line 108) and of CI
(`.github/workflows/rust.yml`, the `simulation` job, line 49) runs with that feature, so both files compile to nothing
there. CI's `determinism.yml` (line 76) runs `-p rh-sim -p rh-policy -p rh-headless` together, and rh-headless's
dev-dependency (`crates/rh-headless/Cargo.toml:34`) unifies `trusted-status-probes` into rh-sim, so it does not run
them either.

**When this lands:** (a) a projection built by `empty_at` already holds room for a full lobby's mark rows, so the first
step after a clone, a restore or a `reset_active` allocates nothing and `pack_leader_warm` passes in a plain run;
(b) the gate (both modes, wherever `sim_tests` runs) and CI's `simulation` job run every rh-sim test file that compiles
out under `schedule-trace` without features, and `scripts/gate.test.sh` fails when a new such file is not named in both.

## 2. Dependencies
None.

## 3. Relevant legacy paths
None: no gameplay behaviour changes. The build marks themselves port legacy indicator facts (ADR 0026); this packet
only sizes the buffer that caches them.

## 4. New paths
- `docs/backlog/packets/P-NOALLOC-GATE-1.md` (this file)

## 5. Exclusive write scope
- `crates/rh-sim/src/fx_report.rs` (`Projection::empty_at` and `BuildMarkCache` only)
- `scripts/gate.sh` (`sim_tests` only; protected: owner approval before it leaves the machine, `--allow-protected`)
- `.github/workflows/rust.yml` (the `simulation` job only; protected, same approval)
- `docs/agent/README.md` (the gate table's quick and full rows), `CONTRIBUTING.md` if it lists the rh-sim test commands
- this file (hand-off section)

## 6. Contracts and references
- `crates/rh-sim/AGENTS.md`: zero allocations per step; the cache stays derived (never hashed, checkpointed or
  compared).
- ADR 0007 (determinism), ADR 0026 (indicator facts: the build marks).
- C-TICK, C-RNG: untouched.

## 7. Behaviour to preserve
- Every state hash, checkpoint and replay byte; parity report all MATCH; every existing `*_no_alloc` suite.
- `BuildMarkCache` semantics: rows ascend by player id; `of` serves a row only when `tick` matches and otherwise computes
  directly; a fresh projection still has `tick: None` (observers compute directly until the next step), so a clone or
  restore never serves rows copied from another world.
- The cache never reaches serde, `PartialEq` or the state hash (it has none of those derives today; keep it so).

## 8. Acceptance checks
- `cargo test --locked -p rh-sim --test pack_leader_warm --test cards_no_alloc` (no features): both pass, original,
  clone and restore windows all at zero.
- `bash scripts/gate.test.sh`: all checks pass, including the new "rh-sim test files that compile out under
  schedule-trace run without features in the gate and in CI".
- `scripts/gate.sh --quick --allow-protected --oracle packet/P-NOALLOC-GATE-1` passes, and its log shows the new step
  green.

## Oracle files (read-only for implementers)
- `crates/rh-sim/tests/pack_leader_warm.rs` (existing, unchanged: red in a plain run on the base)
- `scripts/gate.test.sh` (the new check, committed on `packet/P-NOALLOC-GATE-1`: red on the base)

`scripts/gate.sh --oracle-check` does not apply: it reads cargo targets with `trusted-status-probes`, under which this
oracle compiles to nothing, and the packet branch changes no crate. Both oracles were confirmed red by hand (section 9).

## 9. Validation commands
- `cargo test --locked -p rh-sim --test pack_leader_warm --test cards_no_alloc`
- `bash scripts/gate.test.sh`
- `scripts/gate.sh --quick --allow-protected --oracle packet/P-NOALLOC-GATE-1`

## 10. Risk and suggested model tier
Opus: the change sits in the projection that every clone, restore and reset builds. Low risk: a capacity reservation on
a derived buffer. The new gate step rebuilds rh-sim once more without features (a few minutes in quick and full mode,
and in CI's `simulation` job, which has 60 minutes and used about 31 at `b01fc9e2`).

## 11. Known traps
- `Vec::clone` keeps values, not spare capacity; `Projection::clone` builds a fresh projection rather than cloning, so
  the reservation must be in `empty_at` (or in a preparation every caller runs), not in a `Clone` impl of the cache.
- A world past the lobby cap (`Sim::synthetic`, the `bench` feature) can still grow the buffer once, as every other
  `MAX_PLAYERS`-sized buffer does; no gated test measures such a world.
- dhat's profiler is process-global: the two files are separate test binaries with one test each, so they need no
  `--test-threads=1`.

## Notes from previous attempts
<!-- Coordinator appends on escalation: tier, branch, the gate's failure block. Nothing else. -->
