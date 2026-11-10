# Retained first failures (private tactics native closure)

These are the actual in-order failures observed while building the replay; they are retained unchanged as history, not
as current status. The current green receipts are in `README.md`.

## 1. Harness intake: expected-row channel decoded as tagged

`cargo test -p rh-policy --lib private_tactics_source_parity -- --nocapture`
(f268b869-era WIP harness)

```
thread '...private_tactics_source_parity' panicked at tactics/source_tests.rs:70:37:
strict corpus decode: corpus payload: missing $ tag
```

Cause: `drawCounts`/`thrown` are plain untagged JSON objects in the corpus rows; the generic expected-value decoder
only accepted tagged MethodValue objects. Fix: only treat an object as tagged when it actually carries `$` (other
plain objects recurse). No fixture/source change.

## 2. Harness dispatch: module goal mis-routed to World

```
thread '...private_tactics_source_parity' panicked at tactics.rs:113:48:
non-combat goal is a world goal
```

Cause: the private `createTactics` dispatcher's catch-all swallowed `Goal::Module`; the source returns its failed
"module goal ... is run by its module" output before world dispatch. Fix: explicit Module arm matching the source string.
No source/fixture change.

## 3. First real source mismatch (12 channels / 720 methods)

```
PARITY_TOTAL private-tactics source parity: 154 cases / 720 operations / 12 failures
MISMATCH hold-crowded-spot-stale[1] act callbacks: event count expected 29 actual 28
MISMATCH hold-crowded-spot-stale[5] act callbacks: event count expected 28 actual 27
MISMATCH hold-generated-coliseum-inside[1] act callbacks: event count expected 29 actual 28
MISMATCH loot-real-detour[1] act callbacks: callbacks[2].result[2]: missing field id
... (8 field diffs on the same route element: expected the caller's ContainerView object, actual a plain point)
```

Two real findings, both fixed in the private implementation:
1. `actHold`'s crowded coliseum branch evaluates `ctx.svc.paths.collisionMap().coliseum.centre` for the argument (one
   recorded call) and `pickHoldSpot` then reads the collision map again (a second recorded call). The first call was
   missing; added it (world.rs), keeping the source order.
2. `paths.path` can return the caller's own target object as its last waypoint when the goal position is unchanged; the
   RecordedPaths route reconstruction only preserved that identity for single-element routes. Fixed to preserve the
   target-object identity on the final element (source_trace.rs), so the subsequent `paths.clear(self, Foe/Container)`
   and the emitted `move.to` keep the source object identity.

After both fixes, the same unmodified corpus is green: the current receipt records 0 failures over 154/720.

## Round 2 — retained first failures of the HOLD repair (Root review `a54533b8`)

1. Non-advance snapshot reused the same reached runner across mutations: after the first mutation's successful
   continuation the runner was already at the end of the case, so later pre/post snapshots compared different states
   (`assertion left == right failed: control self.readyAt missing: rejected intake advanced ...`). Fix: one fresh reached
   runner per injected malformed operation, each snapshot taken on that runner before injection, then resumed through the
   same checked entry.
2. Adding ordered tagged comparison at specialized boundaries immediately turned the immutable compatibility corpora RED
   (first messages: `directFight result: result: object entry 0 order/name expected attacking actual intents`;
   `arm-other-slot[0] result: ... expected attacking actual intents`; `result.intent: object entry 1 order/name expected
   priority actual to`; 28/99/141 mismatched channels). Root cause: those legacy corpora are plain JSON serialized with
   canonical **sorted keys**, so their property order is not carried source insertion order. Fix: gate ordered checks on
   `CompareCtx.ordered`, keep them ON for the frozen tagged MethodValue witness, and document the separate
   sorted-key plain-JSON compatibility exclusion; the frozen witness stayed 154/720 / 0 failures with ordered boundaries.
3. Clippy `items_after_test_module`: the new checked-intake helper was appended after the decoder's `#[cfg(test)]`
   module. Fix: moved the helper before the test module (no behavior change).
These are retained as history; the final post-repair receipts are green and no comparison was weakened to obtain it.
