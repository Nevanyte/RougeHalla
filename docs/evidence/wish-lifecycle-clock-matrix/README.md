# P-WISH-LIFECYCLE-CLOCK-MATRIX evidence

Bounded test-only matrix for the five admitted faction Wishes. Base private composition `67f8d59c9c27909ffc4a2fd625007984c0634d1a`.
The new target `crates/rh-sim/tests/wish_lifecycle_clock_matrix.rs` drives only admitted public `validate`/`Sim::submit` casts and
actual runtime events. No gameplay/runtime/schema/input/protocol/content/tape/lockfile/shared-status edit was made.

## Test setup (declared, diagnostic only)

Open 40x24 declared map (border walls), placements: caster at (300,320), Holy unit target at (440,320), Holy observer
at (440,420); `abilities = Mode::Full`, `wish_lock_ms = 0`, `lifecycle = ArenaMode::Off` so no lobby/sudden-death clock can
interleave in these bounded cases. Caster factions/abilities are the actual admitted rows: Frost/Freeze, Plague/Swarm,
Sentenced/Trial, Fire/Blaze, Holy/LastStand (from `ability_in_slot(Slot::Wish, faction)`). Unit casts target the real
PlayerId(2) through the normal target gate; no refused cast is bypassed. The only non-source fixture is the diagnostic
map/placements/opening-lock profile, labelled test setup.

## Real clocks and lifecycle distinctions

| Wish | Faction | cast_ms | Normal producer observation | Between-step remove_player | Public terminal observed |
| --- | --- | --- | --- | --- | --- |
| Freeze | Frost | 250 | one CastStarted at its step server_time, one CastLanded at its step server_time; landing-start == cast_ms; no CastEnded | real pending stage; exactly one CastEnded reason Cancelled at the removal server_time, no landing | landing (successful), Cancelled (removal) |
| Swarm | Plague | 250 | same | same | landing, Cancelled |
| Trial | Sentenced | 350 | same | same | landing, Cancelled |
| Blaze | Fire | 0 | instant: one CastLanded in its producer tick; no CastStarted; no CastEnded | after landing, remove_player between steps produces no fabricated cancellation; restored continuation exact | landing only; no pending retained event / no pending-cancellation domain |
| LastStand | Holy | 0 | same instant domain | same | landing only |

- Every asserted CastStarted/CastLanded/CastEnded is filtered to the exact caster id and ability; a missing or
  wrong-ability event fails the assertion. Successful pending casts assert exactly one start and one landing, preserve
  occurrence order/count, and assert the landing producer interval equals `definition(ability).cast_ms`. Successful
  pending casts have no public CastEnded event (their terminal is observed via CastLanded; the internal cast-ended hook is
  not a public event). No Cancelled label is applied to a successful or instant cast.
- Restored offset clock: a valid checkpoint with `server_time += 123.25` (not tick-derived) is restored for all five;
  every start/landing event_time equals that step's producer server_time and differs from `f64::from(tick)*TICK_MS`; the
  landing-start interval still equals cast_ms.
- Pending cancellations (Freeze/Swarm/Trial): after the real start, `remove_player` between steps does not advance the
  clock; the checkpoint's pending CastEnded carries the caster/ability, exact removal server_time and reason "cancelled";
  the restored hash equals the original, the next step delivers exactly that one CastEnded (no landing), and 12
  continuation steps compare full event vectors and state hashes.
- Retained-clock controls on that actual pending event: a finite-past mutation (`cancelled_at - 1`) is admitted and changes
  the hashed state; negative (`-1`) and future (`cancelled_at + 1`) timestamps and a missing `event_time` field are refused by
  `Sim::restore` with a Malformed/event_time error.
- Instant Wishes (Blaze/LastStand): no CastStarted and no retained pending CastEnded/CastStarted event exists after the
  producer tick, so past/future/missing retained-clock controls do not apply (narrower domain recorded, not treated as
  zero telemetry). After landing, removing the caster between steps and restoring/continuing 8 steps never fabricates a
  Cancelled/CastEnded or a second landing.

## Tests and commands

New target tests (all pass):

- all_five_wishes_emit_real_start_landing_and_instant_distinctions
- restored_offset_clock_preserves_all_five_producer_times
- pending_wishes_cancel_between_steps_with_retained_clock_and_controls
- instant_wishes_land_without_pending_cancellation_and_record_the_narrower_domain

Commands and results (own target directory):

    cargo test -p rh-sim --all-features --test wish_lifecycle_clock_matrix   # 4 passed
    cargo test -p rh-sim --all-features --test wish_event_time              # 5 passed (existing Freeze tests unchanged)
    cargo test -p rh-sim --all-features --test wish_spatial_projection      # 7 passed
    cargo fmt --all -- --check                                             # clean
    cargo clippy -p rh-sim --all-targets --all-features -- -D warnings      # clean
    cargo clippy -p rh-sim --all-features -- -D warnings                    # clean

## Compiled producer/retained-clock mutation kills

Three temporary production mutations (compiled, restored, never committed; disposable files restored byte-for-byte
after each run) must fail the new consumer semantically, not at compile time:

1. CastStarted producer time changed from the real producer server_time to tick-derived time -> new target fails.
2. CastLanded producer time changed to tick-derived time -> new target fails.
3. Retained cancellation CastEnded clock changed from the removal server_time to removal time - 1 -> new target fails.

Each run compiled and produced `test result: FAILED` (no `error[E...]` compile failure); after restoring the original file the
unchanged new target passes (4/4). The temporary mutation sources were not committed; the worktree has no production
diff.

## Remaining lifecycle reason-matrix gaps (absence is reported, not zero telemetry)

- Fizzle and Interrupted terminal reasons are not exercised here: the bounded admitted matrix only produces successful
  landings and the real between-step Cancelled path. A malformed/failed landing or stun/silence-interrupted pending case
  would be a separate scenario and is not claimed as covered.
- Successful pending casts have no public CastEnded event; their terminal outcome is the CastLanded event (the internal
  cast-ended hook is not public telemetry).
- Instant Wish casts have no CastStarted and no retained pending event, so the retained timestamp mutation controls and
  pending-cancellation domain do not apply to them (their narrower domain is asserted instead).
- No complete lifecycle reason matrix is claimed; no NPC/full-signature gate, source corpus, recorder or production code
  was changed.

## Coordinator correction and independent check

Review found the finite-past clock control compared its original checkpoint to a live sim already advanced12 steps.
That inequality could pass even if the hash omitted event_time. The control now compares the changed checkpoint with
the saved hash of the same original pre-continuation checkpoint. The ordinary instant case also accumulates later
start/landing occurrences before checking their totals, rather than checking only its first-step landing list.

Root runs the four new tests plus five existing time and seven spatial tests successfully at the composed
checkpoint25/Observation19/content67183626db240b6a prefix. A compiled temporary HashSer mutation omits only event_time
from hashing, leaving checkpoint validation/serialization intact. The old pending-clock test still passes under that
mutation; the corrected test fails specifically at `past clock hashes`. After exact source restoration all16 tests
pass. This proves the repaired control detects the omitted leaf; no production hash or expected corpus is changed.
Raw logs and the exact control sequence are receipted with the native union evidence.
