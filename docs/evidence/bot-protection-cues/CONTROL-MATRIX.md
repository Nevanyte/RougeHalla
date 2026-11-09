# P15 control matrix (DEFINED_NOT_RUN)

One actual-source mutation is defined per semantic decision; none is compiled. The pristine builder refuses
changed application bodies. Future variant preparation requires a separate Root lease, fresh PREP/OUT and pins. A
compiler/setup/runtime failure is ERROR, never a semantic KILL; only the actual verifier assertion is a kill.

| id | file | mutation | required actual assertion |
|---|---|---|---|
| remote-lower-guard | bots/brain/perception.ts | left > 0 -> left >= 0, named upper constant unchanged | P0 exact-expiry U+100 wrongly remains protected |
| remote-upper-guard | bots/brain/perception.ts | remove left <= TELEPORT_IMMUNITY_MS, lower guard unchanged | P0 T/T+50 wrongly protected before the source100ms delay |
| teleport-immunity | sim/arena.ts | immuneUntil = now + TELEPORT_IMMUNITY_MS -> 0 | P0 positive owner deadline/protection guard removed |
| preserve-ranged-cancel | sim/step.ts | cancelLockedWindup(world,c,true) -> false | W1/W2 Move/Stop cancels the real Wand cast |
| different-target-cancel | sim/targeting.ts | remove cancelLockedWindup on differing retarget | W0 actual cancel/observer feint lost |
| bow-stagger-exclusion | sim/weapons.ts | remove draw-only stagger exclusion | B2 paid Sword stagger cancels Bow draw/Arrow |
| comment-provenance | sim/arena.ts | comment-only teleport function marker | NON-KILL semantics; executed provenance changes |

Status: all seven DEFINED_NOT_RUN. No mutation was built, imported, executed or asserted in this code-only
round. Original0.28.2/esbuild and schema5.0.42 pins are the 8151-derived reviewed tool route; no installs.
