# P-WISH-TERMINAL-PRODUCERS evidence

Bounded source/native coverage of the Fizzle and Interrupted Wish terminal producers, from private composition
8ce885aa601a82aa76cdc0c968e9ff82162ed5c2. Successful landings and caster-removal Cancelled were already covered by the
clock-matrix packet and are not duplicated here. No production/runtime/source corpus/capture/lockfile/shared status was
changed; existing source payloads are read-only.

## Source witness

- parity/wish-terminal/source.json (format rh-wish-terminal/1, sha256
  a5a925ba170169e6dd52845d82baff8cb342d1228ffb9a55b66f85da91c85722, 42,334 bytes, 5 cases) is captured by
  tools/wish-terminal-fixtures/capture.mts through the existing actual-source tools/ability-fixtures/engine.mts
  (real enqueueClientMessage, ordinary 50 ms steps). Pinned profile: official
  node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292, linux/amd64,
  package-lock.json sha256, a sha256 inventory of the packages/shared/src + packages/server/src/sim TS closure and
  package files, and a harness inventory including the capture tool, engine and seed inputs. The --check corpus is
  byte-exact and each action frame keeps the relevant events, producer hook arguments (castAccepted/castEnded with
  reason and stock clocks), pending cast and player stock state.
- Declared setup: open 40x24 room map, player factions/positions/loadouts, zero opening lock, and the action list.
  Method-level source-rig/trusted-setup limits: the legacy engine is driven directly (no Room/browser/DOM/Unity claim);
  castAccepted/castEnded hooks are server-only producer evidence; private setup is declared, actual outputs are
  source-returned.
- Capture commands: bash tools/wish-terminal-fixtures/capture.sh and ... --check (own RH_WISH_TERMINAL_OUTPUT).
  Tool hashes: capture.mts fd591d18f5b6cc9714ad78537d2fc7cf2ca709722bcc4a4e6c1cc833c8bc821c, capture.sh
  2fd1c6c3e4af71474031e92c39578595891e410a5221d02581a9ba928892a746, run-mutants.sh
  4bc41e73dae02ae9613f4be10e27872318ec5a8824660663a2cb9996ac62aa22, mutants/mutate.py
  81e7f29ca0df0a265912f9c02ea3bded5d17d27f7cf83f955e41878c6d173acb.

## Actual producer matrix (source == native replay)

Case | Real producer | Start clock | Terminal clock/reason | Stock/refund | Ordering / later events
- fizzle-freeze-target-removed | caster removes the Holy target between steps; the real Freeze unit-target check fails
  at landing | p0 cast t=100 tick2, ms250 | t=350 tick7 fizzle | p0 wishReadyAt/wishFullAt 45100/45100 (was 50/50):
  spent, no refund | castEnd only; no CastLanded for p0/freeze, no later own cast/land/terminal
- fizzle-trial-target-removed | same real target removal; Trial unit-target check fails | p0 cast t=100 tick2, ms350 |
  t=450 tick9 fizzle | p0 180100/180100: spent, no refund | castEnd only; no later own cast/land/terminal
- interrupted-freeze-by-freeze | real p0 Freeze landing applies a real Stun to p1 while p1's Freeze is pending |
  p0 start t=100 tick2; p1 start t=150 tick3 | p1 t=350 tick7 interrupted; p0 landing same t=350 tick7 |
  p1 45150/45150: spent, no refund | status(stun p1 by p0) -> castEnd(p1) -> castLand(p0); no p1 landing
- interrupted-swarm-by-freeze | same real Freeze/Stun disrupter while p1's Swarm is pending | p0 start t=100 tick2;
  p1 start t=150 tick3 (ms250) | p1 t=350 tick7 interrupted; p0 landing same t=350 tick7 | p1 120150/120150: spent,
  no refund | status -> castEnd(p1) -> castLand(p0); no p1 landing
- interrupted-trial-by-freeze | same real Freeze/Stun disrupter while p1's Trial is pending | p0 start t=100 tick2;
  p1 start t=150 tick3 (ms350) | p1 t=350 tick7 interrupted; p0 landing same t=350 tick7 | p1 180150/180150: spent,
  no refund | status -> castEnd(p1) -> castLand(p0); no p1 landing

- Instant Blaze/LastStand have no pending-cast domain and are excluded from Fizzle/Interrupted coverage; no fabricated
  cancellation is asserted for them (their instant landing behavior is the clock-matrix packet's domain).
- Every asserted start, terminal and disrupter landing is filtered to the exact caster/ability, with exact source
  producer time on every event/frame, actual reason, canonical stock/refund (start == terminal frame, terminal hook
  stock), exactly one own terminal, no later own landing/regrant/double terminal, and unchanged occurrence order.
- The native test replays the declared actions with public validate/Sim::submit casts and real remove_player / real
  Freeze landing. It compares the full relevant event vector and stock/pending-cast frame for every action against the
  source corpus, so a missing own event or a mismatched reason/time/order/stock fails.
- Retained-event controls: these terminal events are produced immediately in the landing/status phase and are not
  retained in pending_events; the tests assert no own retained CastStarted/CastEnded exists at the terminal checkpoint.
  No one-field retained hash mutation is claimed for this domain (absence reported, not zero telemetry; no fabricated
  queued event). The earlier finite-past control lesson was not applicable because no retained event exists.
- Restored continuation: at the terminal boundary the test restores the same checkpoint (state_hash equal) and drives
  the remaining source actions through both the original and restored Sim, comparing full event vectors and state hashes
  at every continuation boundary.

## Tests and checks

New target: source_fizzle_interrupted_terminal_matrix_matches_native_and_continues (5 cases, 1 test) over
crates/rh-sim/tests/wish_terminal_producers.rs.

    cargo test -p rh-sim --all-features --test wish_terminal_producers
    cargo test -p rh-sim --all-features --test wish_event_time
    cargo test -p rh-sim --all-features --test wish_spatial_projection
    cargo test -p rh-sim --all-features --test wish_lifecycle_clock_matrix
    cargo test -p rh-sim --all-features --test abilities_no_alloc
    cargo fmt --all -- --check
    cargo clippy -p rh-sim --all-targets --all-features -- -D warnings
    cargo clippy -p rh-sim --all-features -- -D warnings

## Compiled semantic mutations (actual new consumer)

tools/wish-terminal-fixtures/run-mutants.sh applies four temporary production mutations, compiles and runs the new
target, requires a semantic test result: FAILED (never a compile error), restores the file byte-for-byte, and finally
requires the unchanged target to pass. All four killed the consumer:

1. Fizzle terminal reason changed Fizzle -> Interrupted -> source/native event mismatch.
2. Fizzle cancellation refunded (false -> true) -> stock-frame mismatch (unlawful regrant).
3. Retained cancellation producer clock w.server_time changed to -1 -> terminal time mismatch.
4. Fizzle cancellation made unlawful to fire (if !ok -> if !ok && false) -> a late landing/no terminal mismatch.

Result: killed reason, killed refund, killed clock, killed landing; control passes. No mutation or production diff is
committed; the runner restores every file.

## Remaining gaps / limits

- No complete reason matrix is claimed: this packet covers the previously open Fizzle and Interrupted producers for the
  reachable pending Wishes (Freeze, Swarm, Trial). Cancelled by caster removal and successful landings are the prior
  clock-matrix packet; instant Blaze/LastStand have no pending-cancellation domain.
- Source capture is a method-level actual-source rig over a declared room/positions/zero-lock profile, not a live
  Room/browser/Unity run; source hooks are server-only evidence. No production change was needed and no source/native
  mismatch was found in the bounded cases.
