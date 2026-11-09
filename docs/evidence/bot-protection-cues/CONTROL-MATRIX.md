# P15 control matrix (DEFINED_NOT_RUN)

One actual-source compiled mutation per semantic decision; comment mutation is provenance-only. Each future
control build uses the same Phase A builder/runtime envelope, fresh PREP/OUT and Root-supplied pins. A
compiler/setup/runtime failure is ERROR, never a semantic KILL; only the actual verifier assertion is a kill.

| id | file | mutation | required actual assertion |
|---|---|---|---|
| remote-lower-guard | bots/brain/perception.ts | left > 0 && left <= 1500 -> left > 0 && left < 1500 | P0 lower remote-boundary sample no longer protected |
| remote-upper-guard | bots/brain/perception.ts | left > 0 && left <= 1500 -> left >= 0 && left <= 1500 | P0 before/expiry sample no longer matches |
| teleport-immunity | sim/arena.ts | immuneUntil = now + TELEPORT_IMMUNITY_MS -> 0 | P0 positive owner deadline/protection guard removed |
| preserve-ranged-cancel | sim/step.ts | cancelLockedWindup(world,c,true) -> false | W1/W2 Move/Stop cancels the real Wand cast |
| different-target-cancel | sim/targeting.ts | remove cancelLockedWindup on differing retarget | W0 actual cancel/observer feint lost |
| bow-stagger-exclusion | sim/weapons.ts | remove draw-only stagger exclusion | B2 paid Sword stagger cancels Bow draw/Arrow |
| comment-provenance | sim/arena.ts | comment-only teleport function marker | NON-KILL semantics; executed provenance changes |

Status: all seven DEFINED_NOT_RUN. No mutation was built, imported, executed or asserted in this code-only
round. Original0.28.2/esbuild and schema5.0.42 pins are the 8151-derived reviewed tool route; no installs.
