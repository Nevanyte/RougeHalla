# P-SIM-REPLAY-LONG-1: a long recorded Brain match replays to its own hash

- **Serves:** C-REPLAY / determinism (AGENTS.md "Determinism"); found by P-BOT-BRAIN-CONTINUITY-1 (2026-11-12) when its
  release matches were lengthened to reach the coliseum. Not in ORDER_OF_OPERATIONS: the coordinator places it.
- **Implementer tier:** implementer-opus (rh-sim state or the headless recorder; replay); `debugger` (Fable) only after
  Opus fails twice, as CLAUDE.md routes a replay divergence
- **Reviewer:** reviewer-opus
- **Integration base:** feature/unity-rework, after P-BOT-BRAIN-CONTINUITY-1 (the repro needs its Brain seats)
- **D-rules touched:** C-TICK, C-RNG, replay determinism

## 1. ID and outcome
Eight `BotKind::Brain` seats on the live source-arena configuration (`crates/rh-headless/tests/brain_bots.rs`
`live_config`, admitted seed1 map), seed 3, recorded for 11,100 ticks: two live runs end on the same state hash, but
`rh_sim::replay::run_replay` of the recording fails with `Diverged { step: 11004, expected: 16912772434412788001, got:
4946499403885021848 }`. Seed 11 replays clean over the same window; every 6,000-tick recording of both seeds replays
clean. Bot commands are recorded as inputs, so the replay is fed the same commands: something the live step depends on
is not in the recording, or the replay does not restore it.

What the live run shows just before (events of ticks 11,000-11,003): a Burn and a Backlash signature hit between seat 3
and a group of four sword mobs (ids 274-277) swinging at it, mob heals, then seat 4's axe hit on seat 7 with a
Sentenced `Mark` signature hit. Ticks 11,004-11,005 carry no events. Nothing here is established as the cause.

When this lands, the recording of that match replays to its own hash.

## 2. Dependencies
- P-BOT-BRAIN-CONTINUITY-1 merged (the Brain seats that reach this state; the repro test lives in its release test).

## 4. New paths
- none expected; a unit test at the first diverging field if the cause is in rh-sim

## 5. Exclusive write scope
- To be set by the coordinator once the cause is located (likely `crates/rh-sim/src/**` replay/state, or
  `crates/rh-headless/src/lib.rs` recording). `crates/rh-headless/tests/brain_bots.rs`: only removing the `#[ignore]` of
  `the_replay_of_a_long_brain_match_verifies` and, if wanted, raising `REPLAY_TICKS` to `MAX_TICKS`.

## 8. Acceptance checks
- `cargo test --release -p rh-headless --test brain_bots -- --ignored the_replay_of_a_long_brain_match_verifies`
  passes (the oracle), with the `#[ignore]` removed.
- The first diverging tick and field are named in the hand-off with the root cause; a smaller unit test pins it.
- Every existing parity fixture and determinism sweep stays green; any new serialized field reaches save, restore and
  the state hash.
- `scripts/gate.sh` full passes.

## Oracle files (read-only for implementers)
- `crates/rh-headless/tests/brain_bots.rs` `the_replay_of_a_long_brain_match_verifies` (exists, ignored)

## 10. Risk and suggested model tier
Opus. Replay divergence that live runs do not show usually means state outside what save/restore or the recorder
carries (a cache, a lazily built structure, an observer side effect, a time-dependent branch). Find the first
diverging tick and field before changing anything.

## 11. Known traps
- The live runs are themselves reproducible: the fault is between the live step and the replay path, not plain
  nondeterminism.
- 11,000 ticks of eight Brain seats take about a minute in release; bisect with a recording that stops just after.

## Notes from previous attempts
