# Weapon tuning 9.1

Owner's brief: retune the weapons until every designed weapon edge holds in the real sim, and make a melee faction winner survive the approach at duel pace (k = 2) by stronger ranged penalties, keeping `DUEL_PACE = 2` and every faction number. This file is the change log: one entry per change, with the numbers before and after, and the final results at the end. Phase 10 owns the factions (`factions.ts`, `classes.py`); nothing here touches them.

## Result in one table

| | Before (HEAD `b890462`) | After |
|---|---|---|
| Designed weapon edges that hold (real sim) | 8 of 10: Bow > Sword 9% (Fire 44%, the rest 0%), Wand > Bow 100% against a standing bow and 0% against a strafing or kiting one | **10 of 10 against a straight melee charge, a weave and a jink** (the harness's melee fighters walk straight by default; `weave` and `jink` are the zigzag approaches). After L1-L5 alone it was 9 of 10 against a zigzag: Bow > Axe failed (44% against the jink, 71% against a plain weave); L6 (axe 0.8 -> 0.77) repairs it (82% and 89%; see "Against a weaving melee approach"). Thin cells remain in the Fire column |
| k = 2 kite rows STOLEN (`realtime_report.py <k2.json> kite`) | 7 cells (Fire > Sentenced, Fire > Plague, Sentenced > Plague with both ranged weapons; Holy > Sentenced with the wand) | **0**; tightest cell Fire > Plague with the bow, 1.23 s tolerance (the axe is the weakest melee weapon since L6) against 1.06 s of free fire (ratio 1.16; 1.30 s and 1.22 after L1-L5) |
| Real kiting against the standing-shooter bound (harness KITING) | up to **x2.25** (a kiting bow vs a shield: 5.40 s against 2.40 s) | up to **x1.12** |
| Tests | 2027 pass (`npm test`: 1586 server, 441 shared) | 2040 pass (1592 server, 448 shared) when 9.1 was written; **2733 after the review pass and the merge of main** (2163 server, 570 shared), typecheck clean, `test_rpsls.py` ALL PASS, new `testing/test_kite.py` ALL PASS |

## How to reproduce

```
cd packages/server && npx tsx src/harness/runHarness.ts            # the full report, ~45 s (--core ~30 s, --quick a few seconds)
cd packages/server && npx tsx src/harness/runHarness.ts --core --grid-setups full   # the style grids on all 18 setups (~95 s): the numbers of the weave section
python3 testing/realtime_report.py <k2.json> kite                   # the k = 2 kite table
python3 testing/test_kite.py                                        # the same check as PASS / FAIL lines, ~5 s
python3 testing/test_rpsls.py                                       # the faction oracle, unchanged
python3 testing/weapon_reference.py                                 # regenerates the parity tables (weapons.test.ts, harness/parity.ts)
```

`k2.json` is the k = 2 what-if: `{"name":"k=2","factions":{"Fire":{"hit":300,"params":{"burn":20,"backlash":400}},"Sentenced":{"hit":10,"params":{"mark_ramp":140,"mark_cap":550}},"Plague":{"hit":40,"params":{"plague":80,"execute":4100}},"Frost":{"hit":180},"Holy":{"hit":130}}}`; `test_kite.py` embeds it.

**What "holds" means** (the harness's EDGE VERDICTS section, `HOLD_*` in `report.ts`): the designed winner wins at least 60% of all duels, at least 50% in every faction column of the main matrix (18 setups per cell: start distances 120 / 300 / 450 u, start offsets 0 / 0.35 s for either fighter, two directions), and in every style grid it has a reply that wins at least 50% against each way the loser plays (a ranged loser: `stand`, `strafe`, `kite`; a melee loser: `stand` = a straight charge, `weave`, `jink`; pooled over the factions and 3 start distances, or all 18 setups with `--grid-setups full`). Wins are kills inside the time cap. A verdict also names the factions where a reply is thin (below 50% in that faction's column although the pooled reply passes), e.g. `HOLDS (thin: Frost 22% vs strafe)`; the thresholds did not change. **Every verdict in this file is read against all three ways a melee fighter can approach.** After L1-L5 the "10 of 10" was a statement about a straight charge only; the section "Against a weaving melee approach" has what a zigzag did to it and how L6 repaired it.

## Diagnosis: why the edges failed

Measured on the HEAD numbers with the harness before any change.

- **Bow > Sword (9%).** The sword closes the 420 u gap in about 2.3 s, then wins the close trade: dpsMult 1.0 against 0.8, and every sword hit staggers the archer and restarts its draw (about 70 staggers a duel, each a lost 0.6 s draw). Only Fire's short duels (8 s) let the bow's opening decide it (44%).
- **Wand > Bow against a strafing or kiting bow (0%).** Two problems, the first in the measuring:
  1. *The harness's shooters aimed from the wrong place.* The server looses a projectile from where the shooter's client drew it (the attack's `t`); the policy aimed from where the shooter would be by then. A shooter that moves misses a standing target by its speed times the lag: every arrow of a strafing bow passed a standing wand 19 u off (reach 14 u), so those duels were neither side hitting. Fixed in `policies.ts` (see C1).
  2. *Then the real edge showed.* A strafing bow at 0.75 x speed dodged every ball (0 of 10 hit: the ball takes 0.7 s and the strafe flips every 0.8 s) while its 900 u/s arrows got through (3 of 13 deleted). Ball speed and the arrow-deletion radius could not fix that (see "Rejected levers"); making the bow unable to strafe did.
- **Axe > Wand (91%, Fire 56%).** The wand kites for about 2 s of free fire before the first axe hit (median 2.2 s).
- **Wand > Shield (99%, Fire 94%)** held; **Shield > Sword and Shield > Bow** end at 100% HP (intended, below).

## Change log

Each entry: the lever, where, old -> new, why, and the numbers before and after. The levers L1-L6 are numbers in the order they were applied: every "after" is cumulative (`abl0`..`abl5` runs of `runHarness --core`, and `realtime.py` with the same weapon table; L6 is measured with `--core --grid-setups full`). Interactions between levers matter (L3 alone breaks Axe > Wand; L5 heals it), so the order is part of the record.

### C1. The shooters aim from where the client draws them (measurement, not a weapon number)
`packages/shared/src/policies.ts`, `decide()`. Old: a projectile weapon aimed from the shooter's *projected* position (`selfHit`). New: from `input.self`, the position the policy sees, which is what the sim reads back through the attack's `t` (a unit test pins it: `policies.test.ts`, "aims a projectile from the position it was given").
Effect on the HEAD weapons: Axe > Wand Fire 56% -> 67%, Wand > Bow against a strafing bow went from "nobody hits" to "the bow hits, the wand dies" (still 0%). Bots are unaffected: they aim from their buffered view already.

### C2. The harness reports what it measures (measurement)
`packages/server/src/harness/{report,matrix,kiting,runHarness,parity}.ts`.
- EDGE VERDICTS section: HOLDS / FAILS per edge with the thresholds above (`verdictOf`, exported, unit-tested).
- A style grid for **every** edge with a ranged weapon (it printed three before).
- KITING section (`kiting.ts`): seconds until a melee fighter is in reach of a shooter that starts at the edge of its range, for a shooter that never moves (`post`), stands, strafes or kites, with the standing bound (range - 60) / 170 beside it. Report-only like the rest.
- Time caps raised (`DEFAULT_CAPS`: fire 60 -> 90, sentenced 240 -> 600, plague 60 -> 150, frost 150 -> 240, holy 90 -> 120 s): a ranged fighter that lands a third of its shots needs about three times the mirror duel, and a win that needs 94 s must not count as a timeout. No duel of the main matrix changed result from this.
- `--core` (everything but the client-view and cluttered-arena passes), a `post` style, spacing as shares of the weapon's range (`POLICIES`, `spacingFor`) so a range retune carries the way a weapon is played with it. The parity tables follow the numbers (`weapon_reference.py`).

### C3. Review pass: the melee approach, thin columns, the stagger mark (measurement and readability; no weapon or faction number moved)
- **Melee styles `weave` and `jink`** (`harness/matrix.ts` `WEAVES`; `shared/policies.ts` `SpacingPolicy.weave`, off by default so bots and mobs are unchanged). The melee fighter walks 55 degrees (weave) or 50 degrees (jink) off the line to its target, changing side every 0.4 s or 0.3 s by the world clock, and charges straight within 90 u. They enter every style grid of an edge with a ranged weapon, and the verdict needs a reply of at least 50% against each, as it does against `strafe` and `kite`. Section "Against a weaving melee approach" has the numbers.
- **Thin columns in the verdict** (`report.ts` `thinNote`): a reply whose pooled rate passes but whose rate in some faction's column is below 50% is listed after the verdict. `--grid-setups full` runs each grid cell on the 18 setups of the main matrix instead of three.
- **The stagger mark only means something was cancelled** (`sim/weapons.ts` `stagger()`): the `stagger` fx (the mark and the cancelled telegraph on the client) is now emitted only when a windup or cast was actually cancelled. An archer's draw is not interrupted (L1) and an idle fighter has nothing to lose, so neither shows the mark any more; the 0.5 s immunity starts exactly as before. Tests: `weapons.test.ts` (draw / idle / windup), `melee.test.ts`, `ledger.test.ts`.

### L1. A sword stagger no longer restarts a bow draw
`packages/server/src/sim/weapons.ts`, `stagger()`. Old: `act.startedAt = now` (the draw starts again). New: a draw is left alone; the windup / cast cancellation, the fx and the 0.5 s immunity stay. Tests: `melee.test.ts` (a staggered draw carries on, the immunity starts), `ledger.test.ts`, `weapons.test.ts`.
Why: it cost the archer about 70 draws a duel. Before -> after: **Bow > Sword 10% -> 27%** (Fire 50% -> 78%, Holy 0% -> 56%; the three slower factions stay at 0: the sword still wins the close trade); nothing else moved.

### L2. Ranged movement penalties: draw 0.75 -> 0.1, cast 0.35 -> 0.1, recovery 0.5 -> 0.1
`packages/shared/src/constants.ts` (`BOW_DRAW_MOVE`, `WAND_CAST_MOVE`, `RANGED_RECOVERY_MOVE`). The owner's lever. Why 0.1: the KITING section's worst ratio of a moving shooter's time to a motionless one's, with the HEAD ranges:

| draw / cast / recovery | 0.75 / 0.35 / 0.5 (HEAD) | 0.5 / 0.35 / 0.3 | 0.4 / 0.3 / 0.25 | 0.3 / 0.25 / 0.2 | 0.2 / 0.2 / 0.15 | 0.1 / 0.1 / 0.1 | 0 / 0 / 0.1 |
|---|---|---|---|---|---|---|---|
| worst kite time / standing time | x2.25 | x1.61 | x1.46 | x1.31 | x1.20 | **x1.10** | x1.02 |

0.1 keeps the real-sim excess (x1.12 at the final numbers) below the margin of the model's thinnest cell (x1.22); 0.15 (x1.16) would have been the minimum that fits. A shooter that backs away while firing gets at most 12% more free fire than one that stands. Before -> after (cumulative with L1): **Wand > Bow against a strafing bow 0% -> 60%, against a kiting bow 0% -> 100%**; KITING x2.25 -> x1.10. It also removes what let the bow win Bow > Axe (it backed away from the axe's root): **Bow > Sword 27% -> 7%, Bow > Axe 100% -> 13%**, which L3 repairs. The model's STOLEN count does not move (it assumes a standing shooter); that is what L3-L5 are for.

### L3. Melee damage down to the bow's level: sword 1.0 -> 0.75, axe 0.9 -> 0.8
`packages/shared/src/weapons.ts`. Why: with the bow unable to kite, Bow > Sword and Bow > Axe are a free-fire opening against a close trade, and the bow wins the trade only if the melee weapon does no more damage than it does: sword 0.8 gave 87%, 0.75 gave 98%, 0.7 gave 100% (but broke Sword > Axe at 0.7); the axe is a cliff at the bow's own 0.8 (axe 0.85: Bow > Axe 20%, 0.9: 0%). Before -> after: **Bow > Sword 7% -> 98% (Fire 89%), Bow > Axe 13% -> 84% (Fire 67%)**. Cost: **Axe > Wand 93% -> 64% (Fire 33%)**, because the axe (0.8) no longer outdamages the wand (0.85); L4 and L5 repair it. The model: Fire > Sentenced with the bow 2.00 s -> 1.89 s of tolerance (the sword's weaker kill), still 7 stolen cells.

### L4. Wand damage 0.85 -> 0.8
`weapons.ts`. Why: Axe > Wand needs the axe's damage at or above the wand's; the kiting model wants the wand lower (it was one of the cells); the wand was kept as high as the rest allow because Holy > Sentenced's signature opening scales with the wand-to-bow ratio (below). Before -> after: **Axe > Wand 64% -> 87% (Fire still 33%)**; the model's STOLEN 7 -> 6 (Holy > Sentenced with the wand cleared; Fire > Sentenced with the wand 1.58 -> 1.74 s); Wand > Bow against a strafing bow 60% -> 53%.

### L5. Ranges: bow 480 -> 240, wand 420 -> 220
`weapons.ts` (the policies and the harness follow). Why: it is the free-fire time a melee winner has to absorb, (range - 60) / 170: 2.47 s -> 1.06 s for the bow, 2.12 s -> 0.94 s for the wand, against tolerances of 1.30 s (Fire > Plague, bow, the weakest melee weapon being the shield) and 1.19-1.34 s (the wand). The owner's levers could not do this alone: the penalties do not enter a standing-shooter model, and damage alone would have needed a bow near 0.5 (see "Rejected levers"). Before -> after: **model STOLEN 6 -> 0**; Axe > Wand 87% -> 91% (Fire 33% -> 56%); Wand > Bow against a strafing bow 53% -> 87%; Bow > Axe Fire 67% -> 56%; **all ten edges hold**; KITING x1.10 -> x1.12 (the standing bound is smaller, so the same walk is a larger share). `MAX_SIGHT_CORRIDOR` stays 480 (see the open questions).

### L6. Axe damage 0.8 -> 0.77 (Bow > Axe against a weaving or jinking melee approach)
`packages/shared/src/weapons.ts`, with `testing/realtime.py`, the parity tables (`weapons.test.ts`, `harness/parity.ts`, from `weapon_reference.py`) and the exact numbers in `melee.test.ts` (Fire's axe: 171.43 -> 165 raw, 85.71 -> 82.5 against Frost's shield). Nothing else moved: arrow speed stays 900 u/s, the axe's root, windup and reach are as they were.
Why: a zigzag approach takes the free fire away (most arrows loosed on the way in miss: 0.6-0.8 landed before the first swing, against 2.0 for a straight charge), so the bow has to win the close trade, and at equal dpsMult (0.8 against 0.8) the axe and the bow trade evenly: the long columns (Sentenced, Plague, Frost, Holy; 15-146 s duels) were decided by who landed more of their shots, and the axe, which cannot miss once it is in reach, took half of them. A 3.75% cut of the axe's damage per second is enough to tilt a long trade to the bow, and it is a weapon number, not a policy.
Before -> after (`--core --grid-setups full`, 18 setups x 5 factions per cell; per faction fire / sentenced / plague / frost / holy):

```
Bow > Axe, the bow's best reply      axe stand               axe weave               axe jink
  before (L5)                    84% (kite) 67/89/89/100/78   71% (kite) 33/78/89/89/67   44% (stand) 0/56/44/89/33
  after  (L6)                    93% (kite) 67/100/100/100/100  89% (stand) 44/100/100/100/100  82% (kite) 11/100/100/100/100
  verdict                        FAILS (styles)  ->  HOLDS (thin: Fire 44% vs weave; Fire 11% vs jink)
main matrix, straight charge     82% (56/89/89/100/78)  ->  91% (56/100/100/100/100)
```

The whole weave box now holds (the one-off sweep of "How sensitive it is", the bow's best of `stand` and `kite`; before -> after): 45 degrees 47 / 64 / 69 / 69% -> **82 / 87 / 91 / 91%**, 50 degrees 44 / 60 / 64 / 80% -> **82 / 87 / 91 / 93%**, 55 degrees 60 / 71 / 69 / 82% -> **82 / 89 / 93 / 93%**, 60 degrees 58 / 84 / 89 / 87% -> **87 / 91 / 98 / 93%** (periods 0.3 / 0.4 / 0.5 / 0.6 s); the Fire column is 11-89% (before 0-89%), no 0% in any best reply. 160 setups per cell (8 start distances x 5 offsets x 4 directions, open arena): Bow > Axe straight 89% -> 94%, against the jink 47% -> 82% (kiting bow 43% -> 82%; Fire 8%, the other four factions 100%), against a kiting bow's weave 78% -> 87%.
The Fire column is a hit-count cliff, not a damage race: Fire's 500 HP and 125 shield make the axe need 7 hits for any dpsMult from 0.75 to 0.875 and the bow 10, so Bow > Axe in Fire is decided by how many arrows land on the way in and no axe number in the allowed range moves it (11% against the jink, 44% against the weave, 56% against a straight charge: the Fire column of every grid is identical at 0.80, 0.79, 0.78 and 0.77). Below 0.75 the axe needs 8 hits and Axe > Wand loses its Fire column.
Why 0.77 and not another value (bow's best reply against the jink, pooled / worst non-Fire column; Axe > Wand on the 160-setup pass):

| axe | Bow > Axe vs jink | Bow > Axe vs weave | Axe > Wand (160 setups, stand) |
|---|---|---|---|
| 0.80 (L5) | 44% / 33% (Holy) | 71% | 87% (Fire 33, rest 100) |
| 0.79 | 64% / 33% (Holy) | 78% | 87% |
| 0.78 | 78% / 89% (Frost) | 84% | 87% |
| **0.77** | **82% / 100%** | **89%** | **87%** |
| 0.76 | not run in the grid | not run | 87% |
| 0.75 | not run in the grid | not run | 84% (Frost 87) |
| 0.74 | not run in the grid | not run | 77% (Fire 3, Frost 87) |
| 0.72 / 0.70 | not run in the grid | not run | 73% / 60% (Frost 63 / 16) |

0.77 is one of the two values (0.76 and 0.77) at which both edges have every non-Fire column at 100%, and the one that moves the axe least; the cliffs are at 0.78 (Frost, Bow > Axe side) and 0.75 (Frost, Axe > Wand side). The test pins the window (`weapons.test.ts`: the bow at least 0.03 over the axe, the wand at most 0.04 over it, the axe not under the shield), replacing the L3/L4-era "axe at least the wand's", which the sweep shows is not a law: Axe > Wand holds with the axe up to 4% below the wand.
Side effects, measured:
- **Axe > Wand** main matrix unchanged at 91% (Fire 56%, the rest 100%; median seconds 37.5 -> 39.0); the style grid is unchanged (100% against every shooter style when the axe weaves or jinks, 87% straight); the axe wins with less to spare (mean HP left 17% -> 14%, worst 5% -> 0%, in the Frost column) but still wins every non-Fire duel on 160 setups.
- **Axe > Shield, Sword > Axe** unchanged (100%); the sword wins with a little more HP. **Bow > Sword, Wand > Bow, Wand > Shield, Shield > Bow, Shield > Sword, Sword > Wand:** identical to L5 to the percent (the full harness diff against the L5 run changes only the axe's rows).
- **KITING** (real sim): unchanged, worst x1.12.
- **The model's kite check still passes, with less to spare.** `test_kite.py` ALL PASS, no STOLEN, but the tightest cell, Fire > Plague with the bow, now has the axe as its weakest melee weapon: 1.54 s (axe) and 1.30 s (shield) before, **1.23 s** now, against 1.06 s of free fire: ratio **1.16**, down from 1.22 (the kill needs one hit more; the tolerance steps from 1.49 s at 0.79 to 1.23 s at 0.78 and stays there down to 0.75). The real-sim excess for a moving shooter is x1.11 against the axe (x1.12 worst, sword against the bow), so it still fits under 1.16. Other cells that moved: Sentenced > Plague bow/axe 2.24 -> 2.15 s, Sentenced > Frost 11.21 -> 10.90, Plague > Frost 14.94 -> 14.04, Plague > Holy 20.48 -> 20.00, Frost > Holy 22.28 -> 21.64, Holy > Sentenced 4.00 -> 3.14, Holy > Fire 27.95 -> 27.88; Fire > Plague with the bow is the only cell where the axe is now the weakest melee weapon.
- **Faction model (k = 1)**: every mirror, signature opening and all 25 weapon pairings still hold; signature openings, worst HP of the winner, before -> after: Fire > Plague 69.5 -> 66.3 (axe against bow), Frost > Fire 41.6 -> 43.8, Holy > Fire 68.4 -> 69.8, the rest unchanged; the buff caps are unchanged (Holy > Sentenced x1.30 HP, Plague > Frost x1.66 attack speed). `test_rpsls.py` ALL PASS.

### Cumulative record

| after | edges holding | failing | KITING worst | model STOLEN (tolerance / free fire, worst cell) |
|---|---|---|---|---|
| HEAD numbers, corrected harness (`abl0`) | 8 | Bow > Sword 10%, Wand > Bow (strafe 0%, kite 0%) | x2.25 | 7 (0.52, Fire > Plague bow) |
| + L1 stagger | 8 | Bow > Sword 27%, Wand > Bow | x2.25 | 7 |
| + L2 penalties | 8 | Bow > Sword 7%, Bow > Axe 13% | x1.10 | 7 |
| + L3 sword 0.75, axe 0.8 | 9 | Axe > Wand 64% (Fire 33%) | x1.10 | 7 |
| + L4 wand 0.8 | 9 | Axe > Wand 87% (Fire 33%) | x1.10 | 6 |
| + L5 ranges 240 / 220 (against a straight charge) | 10 (9 against a weave or jink) | Bow > Axe 44% against the jink, 71% against the weave | x1.12 | **0** (1.22, Fire > Plague bow) |
| + L6 axe 0.77 (**final**) | **10** (also against a weave and a jink) | none | x1.12 | **0** (1.16, Fire > Plague bow) |

## Rejected levers (measured, not adopted)

| Lever | What it did | Why not |
|---|---|---|
| Ball speed 380 -> 500 / 700 / 900 u/s (with the 0.3 / 0.2 penalties) | Wand > Bow against a strafing bow 0% -> 7% / 27% / 33% | Not enough, and a different weapon |
| `BALL_ARROW_RADIUS` 28 -> 40 / 60 | No change at 40; at 60 every arrow is deleted but the balls still miss: a stalemate (40 s, nobody dead) | The edge needs the wand to win, not to tie |
| Leading a strafer by its velocity averaged over 0.4-1.6 s (harness policy only) | strafe column 0% -> 7% (0.4 s) to 40-47% (0.8-1.6 s) | Needless once the bow cannot strafe; it would have made the winner's policy cleverer than the loser's |
| Flat ranged damage cut | model, old melee numbers: the bow needs 0.55 at 480 u (margin 1.0), 0.5 for x1.1 | Loses every close trade |
| Distance falloff on ranged damage (full to 100-160 u, then 0.5 / 0.2 / 0 of the damage at the far end) | model: 4-5 of the 7 cells stay stolen; with the falloff reaching 0 at 480 u Fire > Plague with the bow is still short (1.99 s against 2.47 s) and Fire > Sentenced stays stolen | The mark and the disease run on clocks, not on distance; the last 100 u are full damage |
| Signature bonuses only within 130-200 u for ranged weapons | model: 1-2 stolen cells left | It would turn the ranged-against-ranged signature openings (Sentenced > Plague bow/bow, Plague > Holy, Holy > Sentenced) into plain weapon fights at their natural 200-440 u |
| Melee approach speed x1.25 / x1.35 | model: 3 cells stolen at x1.25; at x1.35 the bow still needs a range near 340 u | A global rule for a few cells |
| Ranges alone (old damage numbers) | bow / wand 400 / 340: 3 stolen; 320 / 280: 2 stolen (Fire > Plague by 0.1 s); at about 280 / 250 and below it passes | Kept as part of L5, but L3 and L4 buy the margin |
| Wand 0.75 instead of 0.8 | Axe > Wand Fire 100%, Wand > Shield Fire 67% | Holy > Sentenced opening 16.4% against 23.6% (and flips at x1.21 HP against x1.30) |
| A sword 0.8 instead of 0.75 | Bow > Sword 87% (Fire 78%) | 0.75 costs nothing in the model (the shield, at 0.75, is the weakest melee weapon) |
| **Against a zigzag approach (the Bow > Axe jink, 44% at L5); `--core --grid-setups full`, the bow's best reply against the jink / the Fire column of that reply** | | |
| Arrow speed 900 -> 1100 u/s (axe 0.8) | Bow > Axe jink 44% -> 53% (Fire 0%, Holy 22%), weave 71% -> 76%; Wand > Bow against a strafing bow 84% -> 80%, Frost column 22% -> 0% | Passes 50% barely and leaves Fire at 0%; costs Wand > Bow (the mechanism was not isolated) |
| Arrow speed 1300 u/s (axe 0.8) | jink 58% (Fire 0%, Holy 44%), weave 78%; Wand > Bow against a strafing bow 80%, Frost 0% | Same, with a 2.2x arrow. A faster arrow only shortens the flight (0.27 s -> 0.18 s over 240 u); the other 150 ms between what the shooter sees and where the arrow lands (100 ms render delay, one 50 ms tick) do not change, and a jink flips side every 0.3 s |
| Arrow speed 1100 with the axe at 0.77 | Bow > Axe grid identical to 900 u/s in every cell (jink 82%, Fire 0% standing, 11% kiting); with 1300, Fire (the only column it can move) kiting 11% -> 22% | Nothing to gain once L6 is in, and it still costs Wand > Bow; kept at 900 |
| Axe root 0.5 -> 0.8 s (share of the interval 0.5 -> 0.7), axe 0.77, Fire column | Bow > Axe 56 / 44 / 11% (stand / weave / jink) and Axe > Wand 56%: identical to the 0.5 s root | The bow cannot move (0.1 while drawing, 0.1 in recovery), so the root costs the axe nothing against it; the root does not touch the approach |
| Axe 0.79 | Bow > Axe jink 64% (Holy 33%), weave 78% | Short of the window; Holy still thin |
| Axe 0.78 | jink 78% (Frost 89% against the jink, 67% against the weave with the bow standing), weave 84% | Holds, but the Frost column sits right at the cliff; 0.77 puts every non-Fire column at 100% |
| Axe 0.75 and below | Axe > Wand: the Frost column drops from 100% to 87% at 0.75 (160 setups) and the Fire column from 33% to 3% at 0.74 (Fire's axe then needs 8 hits, the same as the wand, and swings slower); 0.70: 60% pooled, Frost 16% | Axe > Wand needs the axe within about 0.04 of the wand's 0.8; the wand's own cut was rejected before (Holy > Sentenced) |
| A bow minimum-draw tweak (`BOW_MIN_DRAW_SHARE`, `BOW_MIN_DRAW_DAMAGE`) | Not run | The harness's bow policy looses only at full draw (`policies.ts`, `release`), so no draw number can move a harness duel; letting the policy loose early would be a smarter shooter, not a weapon number |
| A shooter that leads a jink by its average velocity | Not run | Rejected before (the winner's policy gets cleverer than the loser's); L6 did not need it |

## Side effects on the faction model (`realtime_report.py`, k = 1, unchanged factions)

These are the L1-L5 numbers. L6 (axe 0.77) moved three signature openings (Fire > Plague 69.5 -> 66.3, Frost > Fire 41.6 -> 43.8, Holy > Fire 68.4 -> 69.8) and nothing else here; see its entry.

- Cycle and openings: every mirror, every signature opening and **all 25 weapon pairings hold** (before: Holy > Sentenced lost with the bow (27%) or the shield (0%) against a sword). Signature openings, worst HP of the winner, before -> after: Fire > Sentenced 72.5 -> 65.0, Fire > Plague 72.4 -> 69.5, Plague > Holy 64.3 -> 66.4, Frost > Holy 55.0 -> 58.6, Frost > Fire 34.3 -> 41.6, Holy > Fire 65.5 -> 68.4, **Holy > Sentenced 30.4 -> 23.6** (the one that got thinner: the wand's multiplier is now level with the bow's; the wand's arrow deletion in the real sim helps Holy on top), the rest unchanged.
- Buff caps: Holy > Sentenced flips at x1.30 HP on the losing side (x1.31 before), the softest attack-speed edge is Plague > Frost with the bow at x1.66 (x1.63 before). HP x1.2 with attack speed x1.3 still holds every edge; HP x1.3 with attack speed x1.2 now also fails Holy > Sentenced with swords (0%) and axes (12%), as well as the bows (45%) and shields (52%) it failed before. The recommended caps (+20% HP, +30% attack speed) are unchanged.
- [kite] at k = 1 is far from the limit now (Fire > Plague bow 2.64 s against 1.06 s).

## How each style plays, and the two edges with no counterplay

- **stand** (the shared policy): a ranged fighter walks to its sweet spot (about 0.83 x the bow's range, 0.67 x the wand's), shoots whenever it is ready, and backs off when the foe is closer than about half its range. **strafe** sidesteps every 0.8 s. **kite** keeps a longer distance (1.04 x / 0.79 x the range) and backs off sooner. Since the ranged move multipliers are 0.1, the three look alike for the bow (it cannot walk while drawing); the wand's strafe is its best reply to a strafing bow (87%).
- The melee fighters charge straight by default (`stand`), which is what the main matrix, the "10 of 10" and everything above measure. They have two more styles since the review pass, `weave` and `jink` (a zigzag approach, section "Against a weaving melee approach"). A designed winner is never helped by a loser that plays badly on purpose: the losing policies are the same ones the winners face in every row, and the corrected aim only removed a handicap on the shooters.
- **Shield > Sword and Shield > Bow end at 100% HP with no counterplay inside the matchup. That is intended:** the shield turns the hit back (the riposte, the reflected arrow) and the sword and the bow have no way through it. The counterplay is the second weapon slot (the axe or the wand), which section 9.3 already makes the decision of the game; the harness duels give each fighter one weapon.
- **Bots** aim with no lead (the "stale" row of WHAT THE CLIENT SEES), so their bows win Bow > Axe 40% (27% before L6) and Bow > Sword 87%: informational, not a criterion.

## Final results

Harness, final numbers (L1-L6), `runHarness` (full report), main matrix: the designed winner's win % / median seconds. (The three axe rows are the ones L6 moved.)

```
edge                      fire     sentenced        plague         frost          holy           all
sword > axe          100%/8.9s   100%/156.2s    100%/39.6s    100%/58.0s    100%/16.4s    100%/39.6s
sword > wand        100%/10.0s   100%/161.3s    100%/41.1s    100%/58.4s    100%/17.2s    100%/41.1s
bow > sword           89%/8.8s   100%/146.2s    100%/36.7s    100%/54.6s    100%/15.4s     98%/36.7s
bow > axe             56%/8.8s   100%/146.2s    100%/36.7s    100%/54.6s    100%/15.4s     91%/36.7s
wand > bow            100%/8.6s   100%/146.7s    100%/37.2s    100%/55.4s    100%/15.9s    100%/37.2s
wand > shield         100%/7.8s   100%/146.2s    100%/36.6s    100%/54.5s    100%/15.3s    100%/36.6s
shield > sword        100%/6.5s   100%/104.7s    100%/26.8s    100%/38.8s    100%/11.1s    100%/26.8s
shield > bow          100%/4.8s    100%/76.1s    100%/19.6s    100%/28.4s     100%/8.4s    100%/19.6s
axe > wand            56%/8.8s   100%/152.4s    100%/39.0s    100%/57.3s    100%/16.6s     91%/39.0s
axe > shield          100%/8.4s   100%/152.1s    100%/38.6s    100%/56.9s    100%/16.3s    100%/38.6s
```

Style grids of the edges that changed or that involve a ranged weapon (the designed winner's win %, pooled over 3 start distances x 5 factions; per faction in brackets: fire / sentenced / plague / frost / holy):

```
bow > sword     rows: how the bow plays; columns: how the sword plays
                          sword stand
  bow stand               100% (100/100/100/100/100)
  bow strafe              100% (100/100/100/100/100)
  bow kite                100% (100/100/100/100/100)
bow > axe
  bow stand/strafe/kite    93% (67/100/100/100/100)       (all three alike: the bow cannot move while it draws; 87% (67/100/100/100/67) before L6)
wand > bow      rows: how the wand plays; columns: how the bow plays
                      bow stand                  bow strafe                   bow kite
  wand stand      100% (100/100/100/100/100)    80% (100/100/100/0/100)    100% (100/100/100/100/100)
  wand strafe     100% (100/100/100/100/100)    87% (100/100/100/33/100)   100% (100/100/100/100/100)
  wand kite       100% (100/100/100/100/100)    80% (100/100/100/0/100)    100% (100/100/100/100/100)
wand > shield   100% for every way the wand plays
shield > bow    100% for every way the bow plays
axe > wand      rows: the axe; columns: how the wand plays
                      wand stand                 wand strafe                  wand kite
  axe stand        87% (33/100/100/100/100)      87% (33/100/100/100/100)    87% (33/100/100/100/100)
sword > wand    100% for every way the wand plays
```

Robustness at L5 (a one-off script over the same `runMatrix`, not in the repo; the L6 re-run is in its entry: Bow > Axe 94%, nothing else moved): 160 setups per cell (8 start distances 100-500 u x 5 start offsets x 4 directions), open and pillared arena. Every edge scores the same in both arenas to within a point: sword > axe, sword > wand, wand > bow, shield > sword, shield > bow, axe > shield 100%; bow > sword 97-98%; wand > shield 100%; axe > wand 91%; bow > axe 86%. Weakest faction columns: Fire, 56% (axe > wand) to 63% (bow > axe). By start distance the ranged edges are weakest when the start is inside the weapons' own reach (bow > axe 48% from 100 u, 68% from 150 u, 88-100% from 200 u up): with no range to use, parity decides.

EDGE VERDICTS of the report as first written, with melee fighters that charge straight: all ten HOLD (`10 of 10 edges hold`). With the weave and jink styles added in the review pass it read 9 of 10 at L5 (Bow > Axe 44% against the jink); with L6 it reads **10 of 10** again, against all three approaches (the verdict block in "Against a weaving melee approach"). Weakest cells: Bow > Axe Fire 56% (11% against the jink, 44% against the weave) and Axe > Wand Fire 56% (the short Fire duels are decided by how many hits each side needs and who lands first), Wand > Bow against a strafing bow in the Frost column (22% best reply: Frost's slow wand, 1.35 s a cast against 1.14 s an arrow, covers fewer arrows than the bow throws).

Harness KITING (the real sim; a shooter that starts at the edge of its range; seconds until the melee fighter is in reach, and the shooter's hits before then as a share of HP; standing bound bow 1.06 s, wand 0.94 s):

```
                         post         stand        strafe          kite
  sword vs bow       0.85s    2%   0.90s    2%   0.90s    2%   0.95s    2%
  axe vs bow         0.90s    2%   0.90s    2%   0.90s    2%   1.00s    2%
  shield vs bow      1.00s    0%   1.00s    0%   1.00s    0%   1.10s    0%
  sword vs wand      0.75s    2%   0.60s    2%   0.60s    2%   0.65s    2%
  axe vs wand        0.80s    2%   0.65s    2%   0.65s    2%   0.70s    2%
  shield vs wand     0.85s    2%   0.75s    2%   0.75s    2%   0.80s    2%
  worst time against a shooter that moves, over the time against one that never does: x1.12 (sword vs bow, kite)
```
(Before: bow rows `2.30 / 3.70 / 3.70 / 5.05 s` for the sword, worst x2.25.)

Cluttered arena (ten 2x2 pillars, 6 setups x 5 factions; re-run at L6): every edge scores the same as in the open arena (Bow > Axe 90%, Axe > Wand 90%, the rest 100%). Client views (3 start distances x 5 factions; re-run at L6): `client` and `present` aim agree on every edge (Bow > Axe 93%, Axe > Wand 87%, the rest 100%); the `stale` (no lead) column is the bots' aim and only Bow > Sword 87% and Bow > Axe 40% (27% at L5) move.

The k = 2 kite table at the final numbers, L6 included (`python3 testing/realtime_report.py k2.json kite`; seconds the melee winner can arrive late and still win >= 50%, by melee weapon: sword / axe / shield, against the free-fire time of a standing shooter; no cell prints STOLEN; L6 changed only the axe column, e.g. Fire > Plague with the bow 1.54 -> 1.23, which makes the axe that cell's weakest melee weapon, where it had been the shield's 1.30 s):

```
  Fire>Sentenced     bow: sw  1.89 ax  1.89 sh  2.00 (Tff 1.06)  wand: sw  2.09 ax  2.04 sh  1.74 (Tff 0.94)
  Fire>Plague        bow: sw  1.34 ax  1.23 sh  1.30 (Tff 1.06)  wand: sw  1.23 ax  1.30 sh  1.34 (Tff 0.94)
  Sentenced>Plague   bow: sw  2.09 ax  2.15 sh  2.09 (Tff 1.06)  wand: sw  2.09 ax  2.15 sh  2.09 (Tff 0.94)
  Sentenced>Frost    bow: sw 10.68 ax 10.90 sh 10.68 (Tff 2.65)  wand: sw 10.48 ax 10.70 sh 10.48 (Tff 2.35)
  Plague>Frost       bow: sw 13.38 ax 14.04 sh 13.38 (Tff 2.65)  wand: sw 13.58 ax 14.24 sh 13.58 (Tff 2.35)
  Plague>Holy        bow: sw 19.69 ax 20.00 sh 19.69 (Tff 1.06)  wand: sw 19.49 ax 19.80 sh 19.49 (Tff 0.94)
  Frost>Holy         bow: sw 21.05 ax 21.64 sh 21.14 (Tff 1.06)  wand: sw 21.14 ax 21.69 sh 21.18 (Tff 0.94)
  Frost>Fire         bow: sw  9.69 ax  8.99 sh  8.75 (Tff 1.06)  wand: sw  9.03 ax  9.10 sh  8.94 (Tff 0.94)
  Holy>Fire          bow: sw 26.39 ax 27.88 sh 26.43 (Tff 1.06)  wand: sw 27.14 ax 27.88 sh 27.05 (Tff 0.94)
  Holy>Sentenced     bow: sw  2.83 ax  3.14 sh  2.83 (Tff 1.06)  wand: sw  2.83 ax  3.14 sh  2.83 (Tff 0.94)
```

Before (HEAD numbers, same what-if), the cells that printed STOLEN:

```
  Fire>Sentenced     bow: sw  2.59 ax  2.33 sh  2.00 (Tff 2.47 STOLEN)  wand: sw  2.29 ax  2.40 sh  1.58 (Tff 2.12 STOLEN)
  Fire>Plague        bow: sw  1.65 ax  1.54 sh  1.30 (Tff 2.47 STOLEN)  wand: sw  1.54 ax  1.49 sh  1.19 (Tff 2.12 STOLEN)
  Sentenced>Plague   bow: sw  2.70 ax  2.50 sh  2.09 (Tff 2.47 STOLEN)  wand: sw  2.31 ax  2.09 sh  1.69 (Tff 2.12 STOLEN)
  Holy>Sentenced     bow: sw  7.10 ax  5.78 sh  2.83 (Tff 2.47)          wand: sw  6.00 ax  4.68 sh  1.69 (Tff 2.12 STOLEN)
```

## Against a weaving melee approach

Added in the review pass. Nothing was retuned for it at the time, so the grid, the verdicts and the sensitivity sweep below are the **L5 numbers (axe 0.8)**; L6 (axe 0.77) then repaired the one edge that failed, and "After L6" at the end of this section has the same three blocks again. Every number in L1-L5 and the diagnosis is measured against a melee fighter that walks straight at its target, and a straight charge is the easiest thing for a shooter to hit. The harness now plays the melee weapons two more ways (`harness/matrix.ts`, `WEAVES`): **weave**, 55 degrees off the line to the target with a new side every 0.4 s, and **jink**, 50 degrees and every 0.3 s; both charge straight within 90 u. They run off the world clock, so a report repeats exactly. Nothing else about the fighter changes (same weapon, same timings).

**Why it moves the edges.** The ranged edges are won by the free fire on the way in, and a zigzag approach takes that away without costing the melee fighter much. One-off count, Bow > Axe, 450 u start, no start offsets, 5 factions x 2 directions: the axe first hits at 2.05 s going straight, 3.10 s weaving and 2.80 s jinking, so the shooter has about a second more to shoot, yet it lands **2.0 arrows before that first swing going straight, 0.6 weaving and 0.8 jinking**. Most of the arrows loosed on the way in miss. The likely reason: the side changes every 0.3-0.4 s, an arrow takes up to 0.25 s to fly and the client sees its target 100 ms late, so the lead aim points where the axe was going rather than where it goes. After contact the arrows hit as before (95-100% of all arrows landed). The bow cannot answer by moving (0.1 move speed while drawing), so the only reply it has is a different spacing.

**The grid** (`runHarness --core --grid-setups full`: 18 setups x 5 factions = 90 duels a cell; the designed winner's win %, per faction in brackets: fire / sentenced / plague / frost / holy). The first column of every block is the straight charge, the numbers the rest of this file reports.

```
bow > sword     rows: how the bow plays; columns: how the sword plays
                         sword stand                sword weave                 sword jink
  bow stand         98% (89/100/100/100/100)    89% (44/100/100/100/100)    87% (33/100/100/100/100)
  bow strafe        98% (89/100/100/100/100)    89% (44/100/100/100/100)    84% (22/100/100/100/100)
  bow kite          98% (89/100/100/100/100)    93% (67/100/100/100/100)    82% (11/100/100/100/100)
bow > axe
                           axe stand                  axe weave                   axe jink
  bow stand           82% (56/89/89/100/78)      64% (44/67/89/67/56)        44% (0/56/44/89/33)
  bow strafe          82% (56/89/89/100/78)      62% (44/67/89/56/56)        42% (0/56/44/78/33)
  bow kite            84% (67/89/89/100/78)      71% (33/78/89/89/67)        31% (11/67/44/22/11)
wand > shield
                       shield stand               shield weave                shield jink
  wand stand       100% (100/100/100/100/100)   82% (11/100/100/100/100)    84% (22/100/100/100/100)
  wand strafe      100% (100/100/100/100/100)   82% (11/100/100/100/100)    84% (22/100/100/100/100)
  wand kite        100% (100/100/100/100/100)   82% (11/100/100/100/100)    71% (11/100/100/100/44)
axe > wand      rows: how the axe plays; columns: how the wand plays (the weave is the melee winner's own approach here)
                           wand stand                 wand strafe                  wand kite
  axe stand           91% (56/100/100/100/100)    91% (56/100/100/100/100)    89% (44/100/100/100/100)
  axe weave          100% (100/100/100/100/100)  100% (100/100/100/100/100)  100% (100/100/100/100/100)
  axe jink           100% (100/100/100/100/100)  100% (100/100/100/100/100)   98% (89/100/100/100/100)
sword > wand and shield > bow: 100% for every approach and every way the shooter plays.
```

**Verdicts** (the same run; best reply to each way the loser plays, then the thin faction columns):

```
bow > sword      stand 98% (stand)   weave 93% (kite)   jink 87% (stand)    HOLDS (thin: Fire 33% vs jink)
bow > axe        stand 84% (kite)    weave 71% (kite)   jink 44% (stand)    FAILS (styles) (thin: Fire 33% vs weave; Fire 0%, Plague 44%, Holy 33% vs jink)
wand > bow       stand 100%  strafe 84% (kite)  kite 100%                    HOLDS (thin: Frost 22% vs strafe)
wand > shield    stand 100% (stand)  weave 82% (stand)  jink 84% (stand)    HOLDS (thin: Fire 11% vs weave; Fire 22% vs jink)
sword > wand, shield > bow, sword > axe, shield > sword, axe > wand, axe > shield: HOLD, nothing thin    (9 of 10 edges hold)
```

**What it says, edge by edge.**
- **Bow > Axe fails against a jink: 44% with the bow standing, and the best reply (standing) is no better; kiting is worse (31%).** Against a weave it holds (64% standing, 71% kiting). In the Fire column it is 0% against a jink and 33-44% against a weave: Fire's 500 HP leave no room for the arrows lost on the way in. The straight charge it was tuned against gave 82%.
- **Bow > Sword holds against both (93% weave, 87% jink),** but Fire is the thin column (33% against a jink with the bow standing, 11% with it kiting).
- **Wand > Shield holds (82% weave, 84% jink)** from 100% against a straight charge, and Fire is again the thin column (11% weave, 22% jink): its 500 HP leave it the least room for the extra seconds.
- **Melee winners are not hurt:** Axe > Wand is *better* weaving (100%, up from 91%; Fire 56% -> 100%), probably because the wand's slower balls (380 u/s against 900 u/s) miss a zigzag even more than arrows do. Sword > Wand and Shield > Bow stay at 100%.
- The 3-setup grid that `--core` prints by default reads the same way but coarser (Bow > Axe: weave 47%, jink 53%; the verdict is also FAILS): use `--grid-setups full` for the numbers above.

**How sensitive it is** (one-off sweep, the same 18 setups, seeds and caps as the harness, the loser playing a weave of the given angle and period; the designed winner's best of `stand` and `kite`, and its Fire column in brackets; Bow > Axe is the only edge that crosses 50%):

```
Bow > Axe, bow's best reply          0.3 s        0.4 s        0.5 s        0.6 s
  45 degrees                      47% (F 0)    64% (F 11)   69% (F 33)   69% (F 56)
  50 degrees                      44% (F 0)    60% (F 33)   64% (F 56)   80% (F 67)
  55 degrees                      60% (F 11)   71% (F 33)   69% (F 44)   82% (F 44)
  60 degrees                      58% (F 33)   84% (F 44)   89% (F 89)   87% (F 67)
Bow > Sword, best reply:  87-100% in the whole box (Fire 33-100%; lowest 87% at 50 degrees, 0.3 s)
Wand > Shield, best reply: 82-96% in the whole box (Fire 11-78%; 82-84% for 45-55 degrees, 91-96% at 60)
```

A quick, tight weave (0.3 s at 45-50 degrees) is what breaks Bow > Axe; the harness's `jink` sits on that corner on purpose, so its verdict is the conservative one. A slower or wider weave leaves the edge standing, thin in the Fire column.

**What this does not say.** The harness fighters are policies, not players: a human who zigzags will also lose closing time and mis-time swings, and a human bow will lead differently. The weave here is one rhythm (a metronome); a shooter that aimed at the average of the last second of movement would hit more of it (the earlier "lead by averaged velocity" row in the rejected levers is the same idea). It is a measurement of how much of the edge is the straight charge, not a prediction of play.

### After L6 (axe 0.77)

The same run (`runHarness --core --grid-setups full`, 18 setups x 5 factions a cell). Only the axe's rows move; every other block of the grid is identical to the one above (including Axe > Wand: 91% straight, 100% when the axe weaves or jinks).

```
bow > axe
                           axe stand                  axe weave                   axe jink
  bow stand           91% (56/100/100/100/100)    89% (44/100/100/100/100)    80% (0/100/100/100/100)
  bow strafe          91% (56/100/100/100/100)    89% (44/100/100/100/100)    80% (0/100/100/100/100)
  bow kite            93% (67/100/100/100/100)    87% (33/100/100/100/100)    82% (11/100/100/100/100)

bow > sword      stand 98% (stand)   weave 93% (kite)   jink 87% (stand)    HOLDS (thin: Fire 33% vs jink)
bow > axe        stand 93% (kite)    weave 89% (stand)  jink 82% (kite)     HOLDS (thin: Fire 44% vs weave; Fire 11% vs jink)
wand > bow       stand 100%  strafe 84% (kite)  kite 100%                    HOLDS (thin: Frost 22% vs strafe)
wand > shield    stand 100% (stand)  weave 82% (stand)  jink 84% (stand)    HOLDS (thin: Fire 11% vs weave; Fire 22% vs jink)
sword > wand, shield > bow, sword > axe, shield > sword, axe > wand, axe > shield: HOLD, nothing thin    (10 of 10 edges hold)

Bow > Axe, bow's best reply          0.3 s        0.4 s        0.5 s        0.6 s
  45 degrees                      82% (F 11)   87% (F 33)   91% (F 56)   91% (F 56)
  50 degrees                      82% (F 11)   87% (F 33)   91% (F 56)   93% (F 67)
  55 degrees                      82% (F 11)   89% (F 44)   93% (F 67)   93% (F 67)
  60 degrees                      87% (F 33)   91% (F 56)   98% (F 89)   93% (F 67)
```

Bow > Axe now holds with a margin against every zigzag of the box (82% at the worst corner, no 0% in the Fire column of any best reply); the four non-Fire columns are at 100% against all three approaches, and what remains thin is Fire alone: 11% against the jink (0% when the bow stands, 11% when it kites) and 44% against the weave, the cliff described in L6. The sweep is a re-implementation of the L5 one (the bow's best of `stand` and `kite` against a weave of the given angle and period, 18 setups, the harness's seeds and caps); at 50 degrees and 0.3 s it reproduces the harness's own jink cell (82%, Fire 11%).

## Open questions for the owner

1. **Short ranges.** Bow 240 u and wand 220 u are about half the old ones. Every length below roughly 280 u passes the k = 2 check with the old damage numbers; 240 / 220 bought a 1.22 margin on the tightest cell, and L6 (axe 0.77) brought it to 1.16 (Fire > Plague with the bow, the axe now its weakest melee weapon). The real-sim excess for a moving shooter is x1.12 at most, so the check still passes, but a bow range above 240 u or a further axe cut would be tested against that margin. `MAX_SIGHT_CORRIDOR` (mapgen's cover, certified for 480 u) is now twice the bow's range: it could be relaxed, which would give the map more open floor, but that is a mapgen change and was not touched.
2. **Near-root shooting (0.1).** It is the strongest reading of "stronger ranged penalties". 0.15 would still pass (x1.16 real kiting against the 1.22 margin) and feels less like a root. At 0.1 the bow's three styles play the same; at 0.2 and above they differ a little.
3. **Sword 1.0 -> 0.75 and axe 0.9 -> 0.8 -> 0.77 are the price of Bow > Sword and Bow > Axe** at the bow's 0.8: the bow wins both on its opening, so it cannot also out-trade them (and against a zigzag it has no opening, so the axe has to sit a little further under). Fire (the axe's faction) and the mobs that carry swords (the Sentenced region's) lose output; the faction cycle itself is unchanged or better.
4. **Holy > Sentenced** (wand / bow signature opening) is 23.6% worst HP, 30.4% before. It stays inside the owner's own limit but is the one faction-model number this moved the wrong way; Phase 10 should look at it when the factions get their picker. **The reason Sentenced starts on the bow is now backwards:** at the old numbers the Holy wand against a Sentenced sword left Holy 8.1% (the thinnest opening), and against the bow 30.4%; now it is 29.4% against the sword and 23.6% against the bow (`testing/realtime.py`, worst HP Holy keeps). `SIGNATURE_WEAPONS` (`shared/src/weapons.ts`) is for Phase 10 to revisit; it was not touched.
5. **Thin cells:** Bow > Axe and Axe > Wand in the Fire column (56%): Fire's 500 HP and 8 s duels turn on who lands first; and Wand > Bow against a strafing bow in the Frost column (0%).
6. **Phase 10 hook:** the kite model's tolerance for Fire > Plague with the bow did not move when the shield's damage went from 0.75 to 0.8, which suggested it is set by Plague's execute bringing Fire under half HP rather than by the melee weapon. L6 shows it also steps with the axe: 1.49 s at 0.79, 1.23 s from 0.78 down to 0.75 (one more hit to kill), so it is a hit-count threshold; Fire's HP (a faction number) bounds it from the other side, and the Fire column is where every thin cell of this file is.
7. **The weave (settled by L6, owner's call to keep or revert).** After L1-L5 Bow > Axe failed against a quick, tight weave (44% against the harness's jink, best reply no better). L6, the axe at 0.77, makes it hold against the straight charge, the weave and the jink (93% / 89% / 82%, the whole 45-60 degree x 0.3-0.6 s box at 82-98%) and changes no other verdict; arrow speed, the axe's root and the bow's draw were measured and left alone (rejected levers). What is left is the Fire column: 11% against the jink and 44% against the weave for Bow > Axe, 33% against the jink for Bow > Sword, 11-22% for Wand > Shield. Those are hit-count cliffs of a 500-HP faction, not damage races; the levers that remain are a faction number (Phase 10) or a projectile that leads (a short server-side lead assist, at the cost of a new rule). If the owner prefers the axe at 0.8, revert `dpsMult` and the tables (`weapon_reference.py`) and accept 9 of 10 against a zigzag.
