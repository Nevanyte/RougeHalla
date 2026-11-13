# P-SIM-REPLAY-LONG-1: a replay steps exactly as the live room does, so a long recording verifies

- **Serves:** the replay contract (a recorded match re-run from its inputs reaches the same state hashes); finding of
  P-BOT-BRAIN-CONTINUITY-1's worker and reviewer-opus (2026-11-13)
- **Implementer tier:** implementer-opus (rh-sim replay and tick path)
- **Reviewer:** reviewer-opus
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1 n/a (no legacy counterpart: legacy has no replay verifier) · no identity should move: live
  state hashes must be byte-identical before and after; say at once if one moves

## 1. ID and outcome
A recorded Brain match on seed 3 fails replay verification at step 11,004 (`Diverged { step: 11004, .. }`); without
the continuity branch's kite fix the same fault fires at step 4,787. The cause, located by reviewer-opus with a
scratch experiment (the recording verifies to its final hash when the event buffer is cleared before each step, and
diverges at 11,004 with 355 stale `Block` events when it is not):
- `crates/rh-sim/src/systems/mob_ai.rs:228` scans `0..cx.ev.len()`: the whole output event buffer, not this step's
  events;
- `run_replay` (`crates/rh-sim/src/replay.rs:226-238`) never clears that buffer between steps, so old `Block` events
  wake idle shield mobs again during a replay;
- the live room clears its buffer every step (`crates/rh-server/src/room.rs:1410`) and so does the headless runner,
  so live play is right and only replay verification is wrong. The code dates from 2026-11-06/08.
When this lands a replay sees, at every step, exactly the events the live step saw, and the sim's behaviour no
longer depends on whether its caller cleared the output buffer: a step reads only the events it produced itself.

## 2. Dependencies
- none. P-BOT-BRAIN-CONTINUITY-1's oracle (`brain_bots.rs`, `REPLAY_TICKS`) shortens its replay check because of
  this fault; after this packet that check can go back to the long window (a note for that file's owner, not an edit
  here).

## 5. Exclusive write scope
- `crates/rh-sim/src/replay.rs`, `crates/rh-sim/src/systems/mob_ai.rs` (the scan), and the step's event-buffer
  bookkeeping where the oracle author finds it (name the file); a new test file
- not `crates/rh-server/`, not `crates/rh-headless/` unless the oracle author shows their runners need the same fix

## 7. Behaviour to preserve
- Every live state hash: parity all MATCH, the ability hash tape unchanged, the determinism sweep unchanged. A caller
  that clears the buffer each step (the live room) must see no difference at all.
- Checkpoint, replay, observation and protocol identities do not move. If the fix changes what a step with an
  uncleared buffer computes, that is the point; if it changes what a step with a cleared buffer computes, stop.

## 8. Acceptance checks
- A sim-level test with no bots: a shield mob, a `Block` event produced in step n, and steps n+1.. run twice, once
  with the caller clearing the output buffer and once without: equal state hashes at every step (red today).
- A replay of a recording long enough to hit the fault verifies to its final hash (the oracle author finds the
  shortest reproducible case; a seed-3 Brain recording reaches it at 4,787 to 11,004 steps, which is too slow for
  the quick gate: prefer the sim-level case and keep a long one `#[ignore]`).
- An audit, written into the brief: every other reader of the output event buffer inside a step (`grep` for scans
  over `ev`), with whether it has the same dependence on the caller.
- `scripts/gate.sh --quick --oracle packet/P-SIM-REPLAY-LONG-1` passes.

## Oracle files (read-only for implementers)
- listed by the oracle author on `packet/P-SIM-REPLAY-LONG-1`

## 10. Risk and suggested model tier
Opus. The tempting fix (clear the buffer in `run_replay`) leaves the sim dependent on its caller; the robust one
(a step reads from its own start index) must not move one live hash.

## Notes from previous attempts
