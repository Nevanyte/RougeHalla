# P-SIM-REPLAY-LONG-1: a replay steps exactly as the live room does, so a long recording verifies

- **Serves:** the replay contract (a recorded match re-run from its inputs reaches the same state hashes; C-DET);
  finding of P-BOT-BRAIN-CONTINUITY-1's worker and reviewer-opus (2026-11-13)
- **Implementer tier:** implementer-opus (rh-sim replay and tick path)
- **Reviewer:** reviewer-opus
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1 n/a (no legacy counterpart: legacy has no replay verifier; this is an exact determinism
  contract test, not a loose proof) · D2 n/a · D5/D6/D9 none · no identity should move: live state hashes must be
  byte-identical before and after; say at once if one moves

## 1. ID and outcome
A recorded Brain match on seed 3 fails replay verification at step 11,004 (`Diverged { step: 11004, .. }`); without
the continuity branch's kite fix the same fault fires at step 4,787. The cause, located by reviewer-opus with a
scratch experiment (the recording verifies to its final hash when the event buffer is cleared before each step, and
diverges at 11,004 with 355 stale `Block` events when it is not), and confirmed by the oracle author by reading and by
the tests below:

- `crates/rh-sim/src/systems/mob_ai.rs:228-241` (`think`) scans `for i in 0..cx.ev.len()`: the whole output event
  buffer, not this step's events. For every `Event::Block { id, by, .. }` whose `id` is a mob with a brain in
  `BrainMode::Idle` it calls `aggro(cx.w, id, by, 1.)` (`mob_ai.rs:92-121`: adds threat, and wakes the brain into
  `Fight` when a target is pickable), then `wake_mates` (`mob_ai.rs:122-144`: wakes every idle mate of the camp). Both
  change hashed state.
- `cx.ev` is the caller's buffer itself: `Sim::step_into_with` (`crates/rh-sim/src/sim.rs:512-546`) takes
  `event_start = out.len()` (`sim.rs:519`), appends the leave events that waited in `w.pending_events`
  (`sim.rs:526`), and runs the schedule with `ev: out` (`sim.rs:534`). `step_into` documents that `out` is not
  cleared (`sim.rs:500-502`).
- `mobAI.thinkMobs` runs in `hooks:systems` (`crates/rh-sim/src/schedule.rs:1047`, after `melee` at `:1030` and `ledger:apply` at
  `:1040`; its `mobAI.thinkMobs` row is at `schedule.rs:1152-1156`), after `projectiles:sweep` (reflect pushes `Block`, `crates/rh-sim/src/systems/projectiles.rs:425`)
  and `melee` (`crates/rh-sim/src/systems/melee.rs:183`), so this step's own blocks are in range: those are the only
  two producers of `Event::Block`.
- Who clears the buffer before a step:
  - live room: `self.step_events.clear()` then `step_into` (`crates/rh-server/src/room.rs:1426-1427`; the brief's
    earlier `:1410` has moved);
  - headless runner: `crates/rh-headless/src/lib.rs:368-369`; wirebench `crates/rh-server/src/bin/wirebench.rs:154,301`;
    scalebench `crates/rh-headless/src/bin/scalebench.rs:121,152`; parity bench
    `crates/rh-parity/src/bin/parity_bench.rs:155`; the `HumanBot`/`BrainBot` test loop
    `crates/rh-policy/src/bots/brain_bot.rs:413`;
  - `Sim::step()` (`sim.rs:494-498`) uses a fresh `Vec`: the parity report (`crates/rh-parity/src/lib.rs:1061`),
    the determinism sweep (`crates/rh-headless/src/bin/determinism_sweep_support/mod.rs:1035`), the ability hash
    tape runner (`crates/rh-sim/src/abilities/source_tests/compare.rs:263`) and the recorders all step through it;
  - **does not clear:** `run_replay` (`crates/rh-sim/src/replay.rs:225-238`: one `events` vector for the whole replay,
    `sim.step_into(&mut events)` every step, returned at the end); the trusted probe `Harness::step_into`
    (`crates/rh-sim/src/status_runtime/probe.rs:757-764`) appends its own operation events to `out` before calling
    `step_into_with` (those cannot contain a `Block`: probe operations never reach `melee` or `projectiles`).
  - checkpoint/restore: a restored `Sim` steps through the same `step_into`; `w.pending_events` is saved and restored
    (`crates/rh-sim/src/checkpoint.rs:502`), the caller's buffer is not, so a restore behaves like a clearing caller.

So a replay sees, at step k, every event of steps 0..k. A stale `Block` whose holder has since gone back to `Idle`
(chased a target out of its leash, gave up, walked home: `give_up` `mob_ai.rs:214-221`, `home` `:175-213`) is aggro'd again: threat is
added and the mob (and its camp) wake, which the live run never did. The replay diverges on the first step at which a
past `Block`'s holder is idle at `think` time.

Legacy (for reference; not an oracle here): `packages/server/src/sim/mobAI.ts:217-225` (`wakeOnBlocks`) reads
`world.events`, called from `thinkMobs` (`mobAI.ts:229`); `world.events` holds only the current step's events, because
`step` swaps it out and empties it every step (`packages/server/src/sim/step.ts:314-316`) and a leave's out-of-tick
events are flushed at once (`packages/server/src/rooms/RaidRoom.ts:548`). The Rust scan is meant to read "this step's
events"; the live callers make that true by clearing, the replay does not.

When this lands a step reads only the events it produced itself (from its own start index), so a replay sees, at every
step, exactly the events the live step saw, and the sim's behaviour no longer depends on whether its caller cleared the
output buffer.

### Audit: every reader of the output buffer inside a step

Found with `rg` over `crates/rh-sim/src` for reads of `ev`/`cx.ev`/`hx.ev`/`out`/`events` (`len()`, indexing, `iter`,
`last`, `first`, `get`, `is_empty`, `contains`, `truncate`, `drain`, `retain`) and every function taking
`&mut Vec<Event>` (`ev`, `events`, `out`); everything else only pushes.

| Site | What it reads | Result depends on the caller's prefix? |
|---|---|---|
| `systems/mob_ai.rs:228-241` (`think`, Block wake) | every `Event::Block` in `cx.ev[0..len]` | **Yes: the fault.** Changes hashed state (threat, brain mode, camp wake). |
| `schedule.rs:1044` (`ledger:apply`: `Op::InstantFlush(cx.ev.len())`) | the absolute buffer length, recorded as an fx-report marker | No: `finish_fx_report` rebases every marker by `offset = event_start` (`fx_report.rs:355-360`); the fx report is a projection, not hashed state. |
| `systems/signatures.rs:53` (`Op::Reset(hx.ev.len())`) | absolute length, fx marker | No (same rebase). |
| `systems/plague.rs:134` (`Op::Flush(ev.len())`) | absolute length, fx marker | No (same rebase). |
| `systems/status/dot.rs:171` (`Op::AbilityFlush(ev.len())`) | absolute length, fx marker | No (same rebase). |
| `systems/card_bleed_feedback.rs:301` (`Op::CardFlush(ev.len())`), `:750` (`Op::CardReset(h.ev.len())`) | absolute length, fx marker | No (same rebase). |
| `sim.rs:537` / `fx_report.rs:206-360` (`finish_fx_report(&out[event_start..], event_start)`) | the step's own slice, from `event_start` | No: already windowed. |
| `sim.rs:526` (`out.append(&mut self.w.pending_events)`) | appends the world's waiting leave events after `event_start` | No: they are part of this step's window for every caller (keep them in the window: see section 7). |
| `status_runtime/probe.rs:757-764` (probe `step_into`) | appends the probe's own events before `event_start` | Today a clearing probe caller has them in `0..len`; after the fix they sit before the window. They never contain a `Block`, so no hash moves (checked: probe operations do not reach `melee.rs:183` or `projectiles.rs:425`). |
| `sim.rs:327-340` (`with_cx`: submit, leave, abandon) | runs outside a step on `w.pending_events` | No step reads it then; `think` is not reached from these. |

Only `mob_ai::think` has the dependence.

### Fixes

- **(a)** `run_replay` clears `events` before each step (and keeps the last step's, or collects them separately).
  Replays verify, but the sim still behaves differently for a caller that does not clear (any future caller, a test,
  the probe), which is the contract this packet closes. **Not sufficient for the oracle.**
- **(b)** the step reads only the events it produced itself: `think` scans from the step's own start index, taken at
  step entry (`event_start` in `step_into_with`, before the pending events are appended, so they stay in the window as
  today). **The oracle requires (b)**: its sim-level tests call `step_into` directly with an uncleared buffer, so no
  change to `run_replay` alone can turn them green.
  - (b) cannot change any hash for a caller that clears the buffer: for such a caller `event_start == 0`, so the scan
    covers exactly `0..len`, the same range as today. The pinned-fold guard below checks it. (The probe exception is in
    the audit table.)
  - Carry the index without allocating (`tests/no_alloc.rs`): e.g. a `usize` on `TickScratch`
    (`crates/rh-sim/src/scratch.rs`, never serialized, not hashed) written in `step_into_with`, or a field on `Cx`
    (`crates/rh-sim/src/systems/mod.rs:66`, but `Cx` is built in about 30 places, many of them tests: prefer the
    scratch field). Moving the prefix out of `out` with `std::mem::take` works semantically (the oracle author checked
    all four tests green with it, then reverted) but allocates per step: do not ship that.
  - (a) may be added on top (a replay's returned events then become "the last step's" or need a second vector);
    not required. `run_replay`'s returned `Vec<Event>` is read by callers: keep its meaning or say so.

## 2. Dependencies
- none. P-BOT-BRAIN-CONTINUITY-1's oracle (`crates/rh-headless/tests/brain_bots.rs`, `REPLAY_TICKS`, on another
  branch) shortens its replay check because of this fault; after this packet that check can go back to the long window
  (a note for that file's owner, not an edit here).

## 3. Relevant legacy paths
- `packages/server/src/sim/mobAI.ts:217-225` (`wakeOnBlocks`), `:229` (called from `thinkMobs` when
  `world.events.length > 0`): reads only the current step's events.
- `packages/server/src/sim/step.ts:314-316`: `world.events` is handed out and replaced by `[]` every step.
- `packages/server/src/rooms/RaidRoom.ts:548`: out-of-tick (leave) events are flushed at once.

## 4. New paths
- `crates/rh-sim/tests/step_event_window.rs` (oracle)

## 5. Exclusive write scope
- `crates/rh-sim/src/systems/mob_ai.rs` (the scan)
- `crates/rh-sim/src/sim.rs` (`step_into_with`: record the step's start index)
- `crates/rh-sim/src/scratch.rs` (the index's home, if on `TickScratch`)
- `crates/rh-sim/src/replay.rs` (optional: clear per step on top of (b), doc comment)
- `crates/rh-sim/src/status_runtime/probe.rs` (only if the implementer chooses to place the window before the probe's
  own events; not needed for the oracle)
- not `crates/rh-server/`, not `crates/rh-headless/`: every runner there already clears its buffer (section 1).

## 6. Contracts and references
- C-DET (replays verify; `crates/rh-sim/tests/replay.rs`), C-TICK (no reordering: `think` stays where it is), ADR 0007.
- `tests/no_alloc.rs` and the other `*_no_alloc.rs`: zero allocations per step.

## 7. Behaviour to preserve
- Every live state hash: parity all MATCH, the ability hash tape unchanged
  (`crates/rh-sim/src/abilities/source_tests/hash_tape.rs`, `ability_hash_tape_matches_the_base`), the determinism
  sweep unchanged. A caller that clears the buffer each step (the live room) must see no difference at all.
- The pending leave events (`sim.rs:526`) stay inside the step's window (start index taken before the append), as for a
  clearing caller today.
- Checkpoint, replay, observation and protocol identities do not move (`CHECKPOINT_FORMAT`, `REPLAY_FORMAT`
  `rh-replay/25`, `OBSERVATION_VERSION`, `PROTOCOL_VERSION`, content hash): nothing serialized changes. If the fix
  changes what a step with an uncleared buffer computes, that is the point; if it changes what a step with a cleared
  buffer computes, stop.

## 8. Acceptance checks
- `crates/rh-sim/tests/step_event_window.rs`, all four green (three are red today):
  - `a_step_behaves_the_same_whatever_events_its_caller_left_in_the_buffer` (sim level, no bots): a practice room, a
    Glacial Warden (shield) blocks the player's sword, the player runs out of its leash, the warden gives up and walks
    home; the same inputs run twice from the same state, one caller clearing its buffer and one never: equal state
    hashes and equal appended events at every step. **Red today:** `step 250 (tick 251): the state after a step depends
    on the 55 stale events its caller left in the output buffer`.
  - `a_stale_block_left_in_the_buffer_does_not_wake_an_idle_shield_mob`: a freshly dropped (idle) warden, one step
    with a `Block { id: warden, by: player }` already in the buffer versus an empty buffer. **Red today:** `step 0
    after the drop: a Block event the caller left in the buffer woke the idle warden`.
  - `a_recording_in_which_a_shield_mob_blocks_then_goes_home_replays_to_its_final_hash`: the same scenario recorded with
    `Recorder` (`Sim::step`, a clearing caller), JSON round trip, `run_replay` must verify every step and reach the
    final hash. **Red today:** `the recording verifies at every step: Diverged { step: 250, expected:
    10019198520245217419, got: 18371663658764791642 }` (300 steps, 0.1 s in debug: fit for the quick gate).
  - `a_caller_that_clears_its_buffer_sees_the_pinned_hashes` (guard, **green today**, with and without
    `trusted-status-probes`): the fold of the scenario's 300 state hashes for a clearing caller is `fb59e066ff3cfeaa`.
    It also asserts the scenario really blocks, chases and returns home, so the three red tests are not vacuous.
- Existing guards stay green unchanged: `crates/rh-sim/tests/replay.rs`, the parity report (all MATCH),
  `ability_hash_tape_matches_the_base`, `tests/no_alloc.rs`.
- `scripts/gate.sh --quick --oracle packet/P-SIM-REPLAY-LONG-1` passes.

## Oracle files (read-only for implementers)
- `crates/rh-sim/tests/step_event_window.rs`
- `docs/backlog/packets/P-SIM-REPLAY-LONG-1.md`

The `stub:` commit is empty: the oracle uses only the public API (`Sim::step_into`, `Recorder`, `run_replay`,
`Event::Block`), so nothing needs stubbing.

## 9. Validation commands
- `cargo test -p rh-sim --features trusted-status-probes --test step_event_window`
- `cargo test -p rh-sim --test step_event_window`
- `cargo test -p rh-sim --features trusted-status-probes` (whole crate: the hash tape, no_alloc, replay)
- `scripts/gate.sh --quick --oracle packet/P-SIM-REPLAY-LONG-1`

## 10. Risk and suggested model tier
Opus. The tempting fix (clear the buffer in `run_replay`) leaves the sim dependent on its caller and does not pass the
oracle; the robust one (a step reads from its own start index) must not move one live hash and must not allocate.

## 11. Known traps
- Take the start index before `out.append(&mut self.w.pending_events)`: a leave's waiting events belong to this step's
  window today for a clearing caller.
- In-crate tests that loop `step_into` without clearing (if any) were relying on the prefix being visible; a test whose
  outcome changes after (b) is reporting this very bug: list it in the hand-off, do not edit it.
- No `const`/`static` in rh-sim test files (`tests/content.rs` scans them): the oracle uses functions.
- Separate finding, **not this packet**: a practice (training) room started with `ReplayStart::Active` does not replay:
  `Recorder::new` (`crates/rh-sim/src/replay.rs:124-145`) records every container with `id > initial_birth_serial` as a
  `WeaponRack` setup input, which includes the five practice racks the room spawns itself, so `run_replay` seeds them a
  second time and diverges at step 0. The oracle avoids it with a lobby start. Whether the live room records practice
  rooms is not established here; a follow-up packet should decide.
- No long `#[ignore]` recording is added: the hand-made scenario reaches the fault in 250 steps, and the seed-3 Brain
  recording needs `rh-policy`/`rh-headless`, outside this crate's tests.

## Notes from previous attempts
<!-- Coordinator appends on escalation: tier, branch, the gate's failure block. Nothing else. -->
