# Owner queue

Decisions waiting for the owner, one line each, with the default the coordinator applies until an answer arrives. The
coordinator edits this file in place: a row leaves when the owner answers (the answer is recorded in
[MIGRATION.md](../MIGRATION.md) and indexed in [OWNER_DECISIONS.md](../OWNER_DECISIONS.md)). To answer, name the row
number in chat: "Q3 yes", "Q7 delete it".

Last updated 2026-11-14, integration 41 (`947958208`).

## Changes the schedule

| # | Question | Default in force | Record |
|---|---|---|---|
| Q1 | Does the final combined review and the PR to `main` wait for the map generator session's last landmarks (volcano, Holy hall: about three working days), or open earlier with landmarks behind `--signature-landmarks`? | Wait for them; everything else is finished meanwhile. | MIGRATION "Integrations 35 to 37" (Timing) |

## Looks, to judge from the running Web client

| # | Question | Default in force | Record |
|---|---|---|---|
| Q2 | Frost Wall's colours are stronger than legacy's so that it reads on Frost ground (DEV-035). Accept? | Stronger colours stay; DEV-035 unsigned. | DEVIATIONS DEV-035; Web round 13 shots |
| Q3 | A tree crown goes half-transparent when another actor stands under it, as roofs do; over its dark ground shadow that reads murky. Keep the 50 percent rule on the tree, or keep the crown solid for others (hiding mobs under it)? | The rule stays as it is on roofs. | MIGRATION "Integrations 38 to 40" (Web round 12) |
| Q4 | Sentenced floor's tile variance (DEV-033), as seen in round 11. Sign? | Unsigned; the floor stays. | DEVIATIONS DEV-033 |
| Q5 | "Didn't mind the darker fire zone": darken Fire, or leave it? | Fire unchanged. | memory: zone art contrast |
| Q6 | The weapon range indicator, hit zones and camp patience outlines render lighter than their written colours (the same missing colour-space conversion fixed for the wall). Correct them (their look changes), or leave the look you approved? | Left as they are. | P-ENV-RETRO-1 item 5 |

## Rules and deviations

| # | Question | Default in force | Record |
|---|---|---|---|
| Q7 | Frost Wall is sent to its owner always and to any viewer who sees one of its tiles (legacy sent every wall to everyone and drew it by its first end). Accept as DEV-036? | Fix proceeds; DEV-036 unsigned. | P-FROST-WALL-NOWALL-1 |
| Q8 | DEV-029 (Frost Wall replaces Freeze) was amended after your signature: the live world plays the wall; training-room practice placements do not read it; fill bots rarely use it. Re-confirm? | Text stands; marked "to be confirmed". | DEVIATIONS DEV-029 |
| Q9 | Plague free pools (DEV-034) and the floors the map generator session says you approved in its chat: Plague marsh plus pools at least 80 percent, pools alone 35, barrows 55; Sentenced lanes plus churchyard fence 75, lanes alone 45. Confirm here? | Treated as approved in that lane; DEV-034 unsigned. | DEVIATIONS DEV-034; MIGRATION "Integrations 35 to 37" |

## Tests changed or flagged (yours to approve)

| # | Question | Default in force | Record |
|---|---|---|---|
| Q10 | Allocation tests: keep the `GC.Collect` warm-up fix in `GarbageTests` (it differs from the wording you approved), and what margin for `PlainDecodeAllocatesOnlyTheSnapshotItsSelfAndOneActorArray(68)`? | The fix stays; the margin is unchanged; a red run is re-run alone. | MIGRATION "Owner decisions 2026-11-13 (night)" |
| Q11 | `terrain_no_alloc::warmed_terrain_passes_allocate_nothing` fails rarely under load. Loosen, fix, or leave? | Left; re-run alone when red. | same |
| Q12 | Test amendments made by the coordinator on 2026-11-13 and -14 (each listed in MIGRATION): the landmark roof and bog tree tests, `brain_choices` (a rare event moved to a 24-seed sweep), the mechanical pins the wire and policy-contract packets moved, `tests/content.rs`, the wall's look pins. Approve as a set, or name any to revert? | They stand. | MIGRATION "Integrations 35 to 37", "38 to 40" |
| Q13 | `MapBlobGroundTests.cs:151` pins a stale 5x constant (six planes now). Correct it? | Left. | MIGRATION "Owner decisions 2026-11-13 (night)" |

## Deletions (owner only)

| # | Question | Default in force | Record |
|---|---|---|---|
| Q14 | Delete `crates/rh-sim/tests/mapgen_land_decor_attempts.rs` (covered by a newer sweep) and `crates/rh-sim/src/mapgen/landmarks/signature/bog_tree.rs` (only a comment is left)? | Both files stay. | map generator session, 2026-11-14 |
| Q15 | Twelve older worktrees with uncommitted files (about 19 GiB) under `.claude/worktrees/`. Remove, or keep? | Left alone. | MIGRATION "Owner instruction 2026-11-13 (night)" |

## Yours to edit

| # | Item | Until then | Record |
|---|---|---|---|
| Q16 | `hosting/technical-demo/README.md:199` names the old content hash; the next deploy needs protocol 18 and a rebuilt client. | Untouched until the deploy step. | MIGRATION "Integrations 38 to 40" |
| Q17 | A tuning-lane row in `CLAUDE.md`'s routing table. | Not added; the lane is described in `docs/agent/TUNING_LANE.md`. | MIGRATION "Owner direction 2026-11-14" |
