# Actual-source walk-hint producer (source-only finite seal)

Status: PASS finite. This is a source-only witness of presentation state from actual post-movement final-system
execution, not movement prediction, game authority, native layout, protocol/publication, or live activation. Networking
owns P15 design/publication; Root owns integration; no native/Rust/Cargo/target was touched.

## Isolation / heads

- Repo/worktree: /Users/nevinmckinnon/Documents/Projects/RogueHalla-bot-own-timings (same clean checkout).
- Preserved sealed prior branch: deepseek/reflex-pure-geometry-repair at 3e9fd3d60c1596161300d891630163efd9f0fd9f.
- Exact public base: db5ed80b2b89a156eae09cd0bd3f4c9e77e9e6de.
- Branch: deepseek/walk-hint-source.
- Code/tool/corpus head: 563eb298a0f8537c8f0af9e783a21a6750641b26.
- Evidence/final head: the branch head containing this README/receipt; reported to Root.
- Clean tree; no merge/push/main edit.

## Actual source producer

- Actual unchanged modules: packages/server/src/sim/walkHint.ts (10,241 B,
  9030f17e7e76a5dda94bba76347e2993a5265d8d36e145b9d1f889f3f988af16), gameplay.ts (70f6f2b6...),
  step.ts (5ff90451...), inputs.ts (47bda82b...), movement.ts (86ebd220...), plus actual shared
  constants/walk/schema; source spans and per-file hashes are in profile.source. package-lock
  991869bd....
- Real createGameWorld with default modules and walkHints:true; one declared roster player p0/holy; declared
  constructor map (64x40, all-floor interior, border walls, two declared spawns, tile hash), declared
  mulberry32 seed 7 random stream and deterministic newItemUid. Real addPlayer and lobby->active start via
  step(world,50ms). Ordinary Move/Stop inputs accepted through enqueueClientMessage; no private
  path/position/HP/status/lock/clock/hint/expected outcome is assigned. Constructor setup is setup, not
  ordinary reward/acquisition.
- Runtime install: actual systems array names recorded; updateWalkHints is last (walkHintSystemLast=true);
  install pushes updateWalkHints and chains teleported/runEnded to zeroAll. Source function spans/order and
  hook/action keys are recorded in the fixture profile.
- Fixed 50 ms steps (actual TICK_MS); actual spawn shuffle draws occur in setup (recorded). Every frame
  preserves positions, full runtime path, weapon runtime, statuses, all synced mirrors/extra (including
  walkDir/walkTicks), server time/tick/phase, ordered returned events and per-frame random draws. RNG is a
  wrapper that forwards each original draw exactly once; an instrumentation-disabled replay used raw
  mulberry32 and matched all 14 gameplay/hint/path/event frames.

## Reached facts (all actual source results)

- 14 captured frames (setup-active + 13 stepped); hint sequence 0,3,3,3,3,0,3,3,3,3,2,1,0,0.
- Real path movement and nonzero encoded direction after the first ordinary Move; initial cap3.
- Small 1-degree re-send keeps walkDir (hysteresis 15 -> 15); a 10-degree turn transitions it (15 -> 22).
- Ordinary Stop zeroes walkTicks and path; a later ordinary waypoint walk counts 3,3,2,1,0 to its end and
  the final frame is zero/path-empty.
- replay.equal=true across 14 frames; no source method wrapper; only the documented random wrapper exists.
- Explicitly unproved: teleported/runEnded zeroAll lifecycle, combat/weapon roots/ice/lock/attack-move,
  and all other branches not reached by this small move/stop slice. They remain separate future work, not
  inferred from this fixture.

## Controls / verification

- Compiled actual-source controls: forced-zero KILL (initial move did not produce hint/path), wrong-cap
  KILL (cap3 not reached), hysteresis-always KILL (small-turn hysteresis not observed); every kill is an
  actual verifier assertion error, not a compiler/setup error. Provenance-only comment NON-KILL; restored
  arm equals pristine and verifier PASS. Full rows/errors in logs/controls.json/log.
- Focused consumer verify.mjs reads only canonical JSON and checks all reached facts and cap/path/event
  shape; it does not recompute source formulas.
- Canonical source.json: 44,372 B sha256
  8cb8b2c24fe0be184e660a4670b0981b946c35782d9e7a47ae1ba3eff567ab77. Capture/check and clean frozen Git
  export of code head 563eb298 all pass byte-identical; raw logs tracked.

## Scope / limits

Only NEW tools/walk-hint-fixtures/**, parity/walk-hint/**, docs/evidence/walk-hint/**. No existing
legacy/Rust/C#/protocol/status/lock/golden/tape file, no Cargo/target/Editor/Web/cloud, no native or
protocol/layout change, no live activation. This fixture is a finite source presentation witness; it is not
an oracle for unperformed branches or ordinary reward/teleport/runEnd. Root owns review/merges.
