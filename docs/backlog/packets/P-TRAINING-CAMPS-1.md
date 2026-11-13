# P-TRAINING-CAMPS-1: practice camps count as legacy counts them, and the console's clear resets camp progress

- **Serves:** owner decision 7 (2026-11-10: same information as legacy) and the balance lane (the training room is
  where a player checks a build); reviewer-opus note 3 on P-MECHANICS-SALVAGE-3 (2026-11-12); screenshot round 8
  (the practice panel read "Kills 0" after a console-spawned camp was killed)
- **Implementer tier:** implementer-opus (rh-sim training systems; state)
- **Reviewer:** reviewer-opus
- **Integration base:** feature/unity-rework, after P-MECHANICS-SALVAGE-3
- **D-rules touched:** D1 loose proof (read the legacy training code; one test per rule) · D2 n/a

## 1. ID and outcome
Two things about the practice room's camps differ from legacy or are unverified:
1. **The console's clear does not reset camp progress.** `crates/rh-sim/src/systems/training/console.rs` `clear` does
   not zero the player's camp-clear count or the camps' contributors; legacy `trainClear` does
   (`packages/server/src/sim/training.ts:343-344`). Since P-MECHANICS-SALVAGE-3 the camp-clear count is read through
   the Bruiser mirror, which is on in training, so a Holy player keeps earned camp lifesteal after a clear.
2. **What a practice camp kill counts toward.** In the running client, killing a console-spawned camp left the
   practice panel at "Kills 0" and showed no kill toast. Establish from legacy (`training.ts`, `mobLife.ts`,
   `campHeal.ts`, the practice HUD in `packages/client/src/ui`) what a practice kill and a practice camp clear do:
   kill stacks and the toast, the camp-clear count (Holy lifesteal, Pack Leader), the panel's Kills and GV lines.
   Where the Rust training room differs, make it match; where legacy itself shows 0, say so and change nothing.
When this lands the practice room behaves as legacy's in both respects, each proven by one test.

## 2. Dependencies
- P-MECHANICS-SALVAGE-3 merged (the mirror read).

## 5. Exclusive write scope
- `crates/rh-sim/src/systems/training/**`, and the kill or camp-clear hook only where training gates it (the oracle
  author names the files)
- no wire change expected; if the practice panel's numbers are not delivered, that is a separate wire packet: say so

## 7. Behaviour to preserve
- The arena (non-training) kill, camp-clear and reward paths; parity all MATCH; no identity moves unless a
  serialized field changes (say which).

## 8. Acceptance checks
- A Holy player clears a practice camp, then uses the console's clear: camp-clear count and contributors are zero
  and the earned camp lifesteal is gone (legacy `training.ts:343-344`).
- Each legacy rule found in step 2, one test with the legacy line and the expected number.
- `scripts/gate.sh --quick --oracle packet/P-TRAINING-CAMPS-1` passes (the coordinator runs the full gate).

## Oracle files (read-only for implementers)
- listed by the oracle author on `packet/P-TRAINING-CAMPS-1`

## 10. Risk and suggested model tier
Opus. The training room has its own gates (`Gates::TRAINING`): a fix that reaches the arena path changes parity.

## 11. Known traps
- Console-spawned camps do not respawn; the room's fixed practice camps may: say which the tests use.
- A test-file `const` in `rh-sim` is rejected by `crates/rh-sim/tests/content.rs`: use functions.

## Notes from previous attempts
