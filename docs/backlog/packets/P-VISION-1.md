# P-VISION-1: private vision and concealment

## Implemented prerequisite (Stage 2)

The actual legacy constant is **30,000 ms**, with a 100 ms refresh and 900-unit radius
(`packages/shared/src/constants.ts`, `vision.ts`; `packages/server/src/sim/vision.ts`). Older inventory and packet text
said 120 seconds. Source wins; this is a documentation correction, not an intentional gameplay change.

`rh-sim/src/vision.rs` implements the private trail on immutable collision maps, first wall-face/corner behavior,
exclusive expiry, coliseum membership/rectangle reveals, bush concealment, same-bush and 64-unit exceptions, and
attack exposure with the actual fractional deadline. It records bounded authoritative refresh origins rather than
remembering actors. Fixed-step/lifecycle hooks change private memory; public reads do not. Restore validates sample
ordering, cadence, bounds and exposure state, including valid historical deadlines after a match ends.

All point/actor, event, prop and pickup projections use this visibility boundary. Policy and headless observers retain
an exact derived memo outside serialized state. The current v5 room publisher still uses disposable observers; it has
no claimed benefit from the retained memo. Two real reference fixtures cover 720 ticks, including a generated full map
with bushes and coliseum metadata. See [evidence](../../evidence/stage2-vision-map/README.md).

## Remaining scope and dependencies

Owned ward and hunter producers, training behavior, ability-cast exposure producers and dynamic gate/teleport behavior
remain open. The compact origin representation relies on immutable sight geometry: a future gate change must retain
the geometry against which each old reveal occurred, or replace the representation with equivalent expiry data.
Do not re-evaluate old reveals against changed geometry. No Unity gameplay implementation is permitted.

Target locking must use legitimate public target records before resolving a private actor. In the legacy implementation
target lookup can trigger a private vision refresh. Independent paired-world reproduction found 33 differing tile
deadlines after an unsuccessful hidden-ID guess and 13 differing visible cells almost 30 seconds later. Attack-move
autonomous scanning reproduced the leak too. Hidden and absent guesses must not create different refresh cadence.

The reviewed C3 correction computes one prospective due pre-movement self-origin view independently of candidate
existence. Fully hidden/missing candidates never commit an early refresh. A legitimately visible candidate commits
the due sample at the source sight-check position, even if range, weapon, re-click or path throttling later refuses it.
This deliberately corrects the concealed-candidate side effect; it does not claim identical private trail tapes for that
legacy defect. Autonomous acquisition uses authoritative prospective sight independently of delivered public records.
Explicit public commands require the last successfully delivered actor record and current visibility. Preserve normal
budgeting and record resolved misses for replay; zero remains an invalid ID rather than a budgeted miss.

## Acceptance for later producers

Capture actual reference behavior, including hidden/missing targets, first-wall and expiry boundaries, reconnects,
ward ownership/lifetime, hunter reveals and geometry changes. Public sampling schedules must leave authoritative state,
events and replay identical. Add checkpoint continuation and malformed-state tests when new private state is introduced.
No widened parity tolerance or synthetic stand-in for a missing source mechanic is acceptable.
