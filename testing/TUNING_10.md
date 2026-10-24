# Phase 10 tuning log

One change, 2026-10-24, approved by the owner ("edges that don't hold get retuned; log each change with before/after numbers"): Holy's Radiant lifesteal is stronger.

| Parameter | Before | After |
|---|---|---|
| `ls0` (share of damage healed at full HP) | 0.25 | 0.25 (unchanged) |
| `ls1` (extra share per unit of missing HP) | 1.25 | 1.75 |
| `ls_cap` (largest share healed) | 1.00 | 1.50 |

Radiant now heals `0.25 + 1.75 x missing HP` of the damage Holy deals, capped at 150%. It reaches 100% at about 43% missing HP (was 60%) and the 150% cap at about 71% missing. Nothing else moved: no HP, rate, hit, share, armor, shield or other faction number, and no weapon number.

Applied in `testing/classes.py`, `packages/shared/src/factions.ts`, the identity expectations in `testing/test_rpsls.py`, `packages/shared/test/factions.test.ts` and the regenerated `packages/server/test/fixtures/realtime-paced.json`. The design sheet and counter review were synced from this log (`CLASS_SHEET.md`, `docs/GAME_DESIGN.md` 8 and 10, a dated note at the top of `COUNTER_REVIEW.md`).

Sections 3.4 to 3.6 and 4 were measured before Phase 9.1's final weapon numbers were merged (3.5 and 3.6 on the pre-9.1 table, 3.4 on a preview merge with the axe still at 0.8). Section 8 re-measures them on the merged branch; where they differ, section 8 is the current value.

## 1. Why

Phase 10's policy-mode harness (`npm run harness:factions -w @raid/server -- --mode policy`) plays the real sim with both fighters following the shared weapon policies like the bots, 18 starting setups per cell, duel pace k = 2. On the Phase 9.1 weapon numbers (sword dpsMult 0.75, axe 0.8, wand 0.8, bow range 240, wand range 220, ranged move penalties 0.1) one designed edge failed in a cell the design engine says is safe: **Holy > Sentenced with both on swords won 0%.** Sentenced ended every duel on about 3% HP, about 20 HP short.

Cause: each Sentenced sword hit staggers Holy and cancels its windup, so Holy lands about 30 of its 37 swings. About 19% of its damage is lost, and the lifesteal that rides on that damage with it. Sentenced's damage is almost all the mark, a damage over time that a stagger does not touch. Before 9.1 the same cell held with 8.1% worst HP left.

Holy > Sentenced is the design's tightest edge (27% HP left in the engine; "Holy's hit or attack rate falling 20% flips it" in `COUNTER_REVIEW.md`). The weapon layer took away exactly what the edge hangs on, so the faction layer was retuned to give it back. A lifesteal change keeps Holy's identity (lifesteal decides more, not less) and targets what the stagger removes.

## 2. Levers measured

Policy cell Holy(sword) > Sentenced(sword): win % / worst Holy HP %.

| Lever | Result | Verdict |
|---|---|---|
| none | 0% / 0.0 | fails |
| `ls0` 0.25 to 0.30 or 0.35 | 0% | no effect: the 100% cap binds in the deciding phase |
| `ls_cap` 1.0 to 1.25 or 1.5 alone | 0% | no effect |
| `ls1` 1.5 and `ls_cap` 1.5 | 100% / 3.5 | holds, thin |
| **`ls1` 1.75 and `ls_cap` 1.5 (chosen)** | **100% / 6.9** | holds |
| Holy HP 1450 to 1500 / 1550 | 0% / 100% at 2.2 | rejected: at 1550 Holy beats Sentenced even without lifesteal, which breaks the identity rule (Holy's main signature must decide an edge) |
| Sentenced `mark_cap` 275 to 250 | 100% / 6.4 | rejected: lifesteal then decides no edge (the identity test "remove lifesteal" flips nothing) |
| Rule: a stagger pauses the staggered fighter's damage over time for one attack interval | Holy > Sentenced 100% / 74.9, but the Fire > Plague and Sentenced > Plague sword mirrors flip to 0% (Plague's 0.25 s sword staggers almost continuously) | rejected |

## 3. Results

### 3.1 Design engine (`engine.py`, k = 1, dt 0.002)

Winner, fight length, winner HP left. Only the four edges that involve Holy moved.

| Edge | Before | After |
|---|---|---|
| Plague > Holy | 15.8 s, 67% | 16.7 s, 66% |
| Frost > Holy | 52.3 s, 63% | 61.5 s, 57% |
| Holy > Fire | 8.1 s, 69% | 8.1 s, 72% |
| Holy > Sentenced | 22.7 s, 27% | 22.7 s, 34% |

The other six edges are unchanged: Fire > Sentenced 3.7 s 77%, Fire > Plague 2.1 s 71%, Sentenced > Plague 7.4 s 56%, Sentenced > Frost 16.6 s 51%, Plague > Frost 37.0 s 40%, Frost > Fire 13.1 s 49%. Holy > Sentenced stays the tightest edge (34%); the longest fight is still Frost > Holy, now 61.5 s (k = 2: about 31 s).

Holy deals and takes the same damage as before; it gets more of it back once it is hurt. Where Holy is the winner (Holy > Sentenced, Holy > Fire) it finishes with more HP. Where Holy is the loser (Plague > Holy, Frost > Holy) the fight lasts longer and the winner finishes lower. Frost > Holy pays most: 6 points and 9 s.

### 3.2 Design oracle (`python3 testing/test_rpsls.py`)

ALL PASS: the 10/10 graph at dt 0.01, 0.005, 0.002 and 0.001; each power beats exactly two; scale invariance (0.25x to 20x); relabeling; jitter of +-5% and +-10% (30/30 perfect draws each); purity audit. Identity table (flips and largest margin shift, in points), the four rows that changed:

| Power | Remove | Before | After |
|---|---|---|---|
| Plague | The flat disease (sub) | flips Plague > Frost, 114 | flips Plague > Frost **and Plague > Holy**, 114 |
| Frost | The slow (main) | flips Frost > Holy, 103 | flips Frost > Holy, 108 |
| Holy | Lifesteal (main) | flips Holy > Sentenced, 30 | flips Holy > Sentenced, 37 |
| Holy | Flat lifesteal, no missing-HP scaling (sub) | flips none, 19 | flips none, 26 |

Lifesteal still decides an edge and the missing-HP scaling still moves a margin by more than 15 points, so both rules hold. The other five rows are unchanged.

### 3.3 Sensitivity (engine, dt 0.002 unless noted)

Slider table of `CLASS_SHEET.md` section 7 (each knob +-25%, points of the winner's HP): changed rows only. Rows are "most moved edge, second"; the same method reproduces the old table's figures.

| Knob | Before | After |
|---|---|---|
| Frost slow | Frost > Holy 22, Plague > Frost 6 | Frost > Holy 38, Plague > Frost 6 |
| Holy shield | Holy > Sentenced 20, Holy > Fire 8 | Holy > Sentenced 17, Holy > Fire 8 |
| Sentenced `mark_cap` | Holy > Sentenced 18, Sentenced > Frost 10 | Holy > Sentenced 16, Sentenced > Frost 10 |
| Plague `plague` | Plague > Frost 12, Sentenced > Plague 6 | Plague > Frost 12, Plague > Holy 6 |
| Plague armor | Plague > Frost 9, Plague > Holy 8 | Plague > Holy 9, Plague > Frost 9 |
| Holy `ls1` | Holy > Sentenced 4, Holy > Fire 2 | Holy > Sentenced 5, Frost > Holy 3 |
| Holy `ls_cap` (new row) | Holy > Sentenced 4, Frost > Holy 2 | Frost > Holy 4, Holy > Sentenced 2 |

Unchanged: Fire backlash 9 and 8, Sentenced `mark_ramp` 7 and 5, Plague execute 2 and 1, Holy `ls0` 2 and 2, Fire burn 1 and 0, Fire rate 0, Frost rate 8 (Frost > Fire).

- **No single +-25% change to any knob or core stat flips an edge** (HP, rate, hit, armor, shield and every signature parameter of every power, checked at dt 0.005). Before the retune Holy's hit or rate at -25% flipped Holy > Sentenced; it now holds, with 2.8% left.
- Frost > Holy gets the largest slider in the sheet: Frost's slow at -25% (0.45) still wins but takes 83.5 s with 19% left. Frost's hit or rate at -25% wins in 106.8 s with 24.7% left, close to the engine's 120 s cap.

Distance to a flip, Holy > Sentenced:

| Change that flips it | Before | After |
|---|---|---|
| Holy hit or attack rate falls by | 20.0% (hit 65 to 52) | 26.5% (hit 65 to 48; rate 0.95 to 0.70) |
| Sentenced's total damage (hits and bonus) rises by | x1.29 | x1.42 |
| Sentenced's HP rises by | x1.35 | x1.64 |
| Holy shield falls by | 31.7% (250 to 171) | 41.1% (250 to 147) |
| Sentenced `mark_cap` rises to | 385 | 434 |

Distance to a flip, Frost > Holy (the engine's 120 s cap counts a fight that is not over as no win; the second figure lets the fight run to the end):

| Change that flips it | Before | After |
|---|---|---|
| Frost hit or attack rate falls by | 40.7% (fight passes 120 s); Holy wins at 45.4% | 28.6% (hit 90 to 64); Holy wins at 32.9% (hit 60) |
| Holy HP rises by | x2.29 (passes 120 s); Holy wins at x2.71 | x1.95 (passes 120 s); Holy wins at x2.30 |
| Frost's slow falls from 0.60 to | 0.27 | 0.40 |
| Holy's total damage rises by (120 s cap) | x1.83 | x1.49 |

### 3.4 Policy mode (real sim, k = 2, 18 setups per cell)

Measured on a preview merge with the Phase 9.1 weapon numbers (this branch still has the pre-9.1 table). Designed winner's worst HP %, both fighters on the same weapon, before to after:

| Edge | sword | axe | bow | wand | Signature opening |
|---|---|---|---|---|---|
| Holy > Sentenced | 0 (0% win) to **6.9** | 28.6 to 36.2 | 23.6 to 32.2 | 22.6 to 31.8 | 24.7 to 33.4 (wand/bow) |
| Plague > Holy | 80.3 to 80.3 | 67.8 to 65.3 | 66.2 to 64.4 | 64.3 to 62.2 | 43.3 to 37.0 (bow/wand) |
| Frost > Holy | 63.7 to 54.7 | 61.8 to 57.6 | 61.9 to 55.8 | 60.4 to 55.0 | 56.8 to 49.6 (shield/wand) |
| Holy > Fire | 68.0 to 70.7 | 69.8 to 72.2 | 69.8 to 72.8 | 68.7 to 71.8 | 62.7 to 65.5 (wand/axe) |

Every other cell is unchanged. The Holy > Sentenced sword mirror now wins 100% with 6.9% worst HP: it holds, thinly.

### 3.5 Trades mode (faction rules alone, against `realtime.py`, k = 2)

Run on this branch, which still has the **pre-9.1 weapon table**, so these numbers are not comparable cell by cell with section 3.4. Superseded by 8.2.

```
npm run harness:factions -w @raid/server -- --python
Mirror: 50/50 cells at 100%; lowest worst hp 31.7% (Holy > Sentenced, bow)
Signature openings: 10/10 cells at 100%; lowest worst hp 27.9% (Frost > Fire, shield/axe)
Pairs with the same winner: 7370/7370; largest hp fraction difference: 3.00e-5
Verdict: agrees with realtime.py on 60/60 cells (same winner on every pair and hp within 1e-4)
```

Before the change the lowest mirror cell was the same one, Holy > Sentenced on bows, at 22.8%. Holy rows, mirror matrix, worst winner HP % (every cell 100% win before and after), before to after:

| Edge | sword | axe | bow | wand | shield |
|---|---|---|---|---|---|
| Plague > Holy | 65.7 to 63.7 | 66.6 to 63.8 | 66.2 to 64.4 | 66.5 to 64.3 | 65.5 to 63.4 |
| Frost > Holy | 62.0 to 55.1 | 59.4 to 54.6 | 61.9 to 55.8 | 61.7 to 56.0 | 61.7 to 54.7 |
| Holy > Fire | 66.2 to 68.9 | 68.1 to 70.3 | 66.3 to 69.0 | 65.3 to 68.1 | 66.0 to 68.7 |
| Holy > Sentenced | 25.0 to 33.2 | 26.0 to 34.5 | 22.8 to 31.7 | 25.9 to 34.1 | 24.4 to 33.0 |

Holy rows, signature openings (all 100% wins), worst HP % / mean HP % / median fight, before to after (the "before" values come from `realtime.py`, which the harness matches to 0.1 s):

| Pair | Weapons | Worst % | Mean % | Median t |
|---|---|---|---|---|
| Plague > Holy | bow/wand | 64.3 to 62.1 | 64.8 to 62.5 | 10.2 s to 10.8 s |
| Frost > Holy | shield/wand | 54.1 to 44.5 | 56.1 to 47.0 | 36.7 s to 44.2 s |
| Holy > Fire | wand/axe | 62.8 to 65.7 | 66.0 to 68.7 | 4.8 s to 4.8 s |
| Holy > Sentenced | wand/bow | 31.2 to 38.5 | 32.5 to 39.3 | 13.2 s to 13.2 s |

### 3.6 20 Hz weapon model (`realtime.py`, k = 1 unless noted)

Pre-9.1 weapon table; the merged values are in 8.4.

- **Mixed weapons.** Before: Holy > Sentenced failed in two of the 25 weapon pairs (Holy bow against Sentenced sword won 27% of phase pairs, Holy shield against Sentenced sword 0%). Now both win 100% (worst HP 11.0% and 3.4%; at k = 2: 9% and 0% to 100% with 10.2% and 4.4%). All 25 pairs of all four Holy edges hold at 60% or better.
- **Signature opening Holy(wand) > Sentenced(bow):** worst HP 30.4% to 37.3%. With Sentenced on the sword (the opening the design avoided): 8.1% to 18.8%, and the smallest HP buff on Sentenced that flips it goes from x1.08 to x1.25.
- **Kiting.** Holy(shield) > Sentenced, the binding cell: tolerance against a ranged Sentenced 5.65 s (bow) and 3.30 s (wand) to 10.9 s and 8.0 s; the largest ranged dpsMult that keeps the edge 0.87 (bow) and 0.88 (wand) to 0.96 and 0.97. Fire > Plague still binds the ranged damage numbers (0.846 bow, 0.878 wand).
- **Buff caps** (smallest multiplier on the losing side that flips an edge, minimum over the five mirrors and the signature opening; `realtime_report.py buff`):

| Stat | Edge | Before | After |
|---|---|---|---|
| HP | Holy > Sentenced | x1.31 | x1.59 |
| HP | Frost > Holy | x2.28 | x1.86 |
| HP | Plague > Holy | x2.84 | x2.69 |
| HP | Holy > Fire | x5.09 | never within x8 |
| Attack speed | Frost > Holy | x1.63 | **x1.32** |
| Attack speed | Plague > Holy | x2.09 | x1.88 |
| Attack speed | Holy > Fire | x6.25 | x6.94 |

The overall softest HP edge is now Holy > Sentenced and Frost > Fire together (x1.59, was Holy > Sentenced at x1.31). The overall softest attack-speed edge is now Frost > Holy (x1.32, was x1.63). All other edges are unchanged.

## 4. Side effect to watch: Frost > Holy is softer against buffs

Probable cause: Holy's swings are both its damage and its healing, so a stronger lifesteal makes an attack-speed buff worth more to it, while Frost's slow still takes 60% of the swings. Stacked buffs on the loser, cells that fall under 60% wins (k = 1, same method as `COUNTER_REVIEW.md` section 5):

| HP x / attack speed x | Before | After |
|---|---|---|
| 1.2 / 1.2 | holds every edge | holds every edge |
| 1.2 / 1.3 | holds every edge | **Frost > Holy signature opening (Holy wand, Frost shield) 0%** |
| 1.3 / 1.2 | Holy > Sentenced bow 45%, shield 52% | **Frost > Holy signature opening 0%** |
| 1.3 / 1.3 | Plague > Frost on all five mirrors (0-13%); Holy > Sentenced bow 27%, shield 29% | Plague > Frost on all five mirrors (0-13%); **Frost > Holy signature opening 0%** |

So the review's recommended caps (+20% max HP, +30% attack speed, `COUNTER_REVIEW.md` section 5) still hold one at a time (x1.59 and x1.32) but no longer hold stacked on a Holy facing Frost. In the S-curve of `docs/GAME_DESIGN.md` 12.2, x1.32 attack speed is four stacks (+34%). This is reported to the owner, not retuned. With Phase 9.1's weapon numbers merged it is gone: the wand's cut from 0.85 to 0.8 puts the stacked cells back above 60% (8.4). Related: Frost > Holy fights get longer. Frost(shield) > Holy(sword) in the 20 Hz model has a median length of 106 s at k = 1 and 52 s at k = 2 (was 79 s and 40 s), and Frost keeps 24% in the worst case there (was 43%).

## 5. Still failing at the weapon layer (reported, not retuned)

Policy mode, Phase 9.1 weapon numbers. These are not faction-rule problems and a lifesteal change does not reach them:

- **The four shield mirrors** Frost > Holy, Frost > Fire, Holy > Fire and Holy > Sentenced win 0%. Two shields facing each other block every bash, so only damage over time lands: the damage-over-time factions win, and Frost against Holy is a draw.
- **The Plague(bow) > Frost(shield) opening** wins 0%. The shield reflects every arrow back into Plague. Phase 9.1 records Shield > Bow as intended to have no counterplay inside the matchup; the answer is the second weapon slot.

## 6. Not re-run

Section 8 re-ran the trades and policy modes, the design oracle, the kiting check, the mixed-weapon pairs, the buff caps and the stacked buffs on the merged branch. Of the 20 Hz tables in `COUNTER_REVIEW.md`, still not re-run: the kiting tables other than the pass/fail check of `test_kite.py` (including rule B's free-fire ceilings, where the wand ceiling of 0.86 was set by Holy(shield) > Sentenced and should have risen), the heal-item and disengage runs, the v2-plan subsection and the move-speed caps. The weapon tuning of Phase 9.1 itself is unchanged.

## 7. Reproduce

```
python3 testing/test_rpsls.py                                      # design oracle, identity table (ALL PASS)
python3 testing/realtime_report.py engine                           # engine table of 3.1 (dt 0.002)
python3 testing/realtime_report.py buff                             # buff caps of 3.6 and 8.4 (about 15 s, needs numpy)
python3 testing/test_kite.py                                        # kiting check of 8.1 (k = 2, a few seconds)
npm run harness:factions -w @raid/server -- --python               # trades mode against realtime.py (~5 s, needs python3 with numpy)
npm run harness:factions -w @raid/server -- --mode policy          # policy mode (about 20 s)
```

To get a "before" number, set `ls1` 1.25 and `ls_cap` 1.0 for Holy in `testing/classes.py` (or pass `realtime_report.py` a what-if file with those two Holy params) and run the same command. The sensitivity, flip-distance, stacked-buff and kiting figures of 3.3, 3.6 and 4 are ad hoc scripts over `engine.duel` and `realtime.duel` using the definitions in `CLASS_SHEET.md` section 7 and `COUNTER_REVIEW.md` sections 3 and 5; the same scripts reproduce the old figures in those documents (the engine rows, the x1.31 and x1.63 buff caps, the 5.65 s and 3.30 s kiting tolerances, the 27% and 0% mixed-weapon cells), which is how the "before" columns were checked.

## 8. After merging Phase 9.1

Phase 9.1's weapon tuning is merged on top of the lifesteal retune: bow range 240 u and wand range 220 u, damage multipliers sword 0.75, axe 0.77, wand 0.8, bow 0.8 and shield 0.75, draw, cast and recovery move speed 0.1, at most two arrow reflections, and a sword stagger no longer resets a bow draw (`testing/TUNING_9_1.md`). The merge changed no number; this section re-measures sections 3 and 4 on the merged branch. Duel pace (k = 2) unless it says k = 1.

### 8.1 Design oracle and kiting

- `python3 testing/test_rpsls.py`: ALL PASS. The identity rows are the "after" rows of 3.2.
- `python3 testing/test_kite.py` (k = 2): ALL PASS. The weakest melee faction winner's tolerance stays above the free fire a ranged loser gets on the approach (1.06 s bow, 0.94 s wand) in all 20 cells (10 edges, bow and wand). Holy > Sentenced: 5.45 s against the bow and the wand. Fire > Plague with the bow is still the tightest, 1.23 s against 1.06 s.

### 8.2 Trades mode (faction rules alone, against `realtime.py`)

```
npm run harness:factions -w @raid/server -- --python
Mirror: 50/50 cells at 100%; lowest worst hp 31.7% (Holy > Sentenced, wand; bow level)
Signature openings: 10/10 cells at 100%; lowest worst hp 31.6% (Holy > Sentenced, wand/bow)
Pairs with the same winner: 7370/7370; largest hp fraction difference: 3.00e-5
Verdict: agrees with realtime.py on 60/60 cells (same winner on every pair and hp within 1e-4)
```

Mirror matrix, worst winner HP % (every cell wins 100%):

| Edge | sword | axe | bow | wand | shield |
|---|---|---|---|---|---|
| Fire > Sentenced | 67.5 | 49.8 | 65.2 | 62.7 | 62.4 |
| Fire > Plague | 65.6 | 67.4 | 63.2 | 64.0 | 65.2 |
| Sentenced > Plague | 61.0 | 59.7 | 60.8 | 60.3 | 61.5 |
| Sentenced > Frost | 49.0 | 48.9 | 50.9 | 48.5 | 50.2 |
| Plague > Frost | 39.7 | 36.6 | 38.0 | 37.2 | 39.3 |
| Plague > Holy | 65.2 | 64.2 | 64.4 | 64.3 | 63.4 |
| Frost > Holy | 55.9 | 55.1 | 55.8 | 55.0 | 54.7 |
| Frost > Fire | 45.2 | 39.2 | 40.7 | 40.3 | 42.3 |
| Holy > Fire | 69.1 | 70.0 | 69.0 | 69.5 | 68.7 |
| Holy > Sentenced | 32.2 | 32.5 | 31.7 | 31.7 | 33.0 |

Signature openings (each faction on its starting weapon, all 100% wins):

| Pair | Weapons | Worst % | Mean % | Median t |
|---|---|---|---|---|
| Fire > Sentenced | axe/bow | 57.0 | 65.3 | 2.5 s |
| Fire > Plague | axe/bow | 63.2 | 66.1 | 1.5 s |
| Sentenced > Plague | bow/bow | 60.8 | 60.8 | 4.2 s |
| Sentenced > Frost | bow/shield | 50.2 | 55.4 | 9.9 s |
| Plague > Frost | bow/shield | 42.6 | 43.7 | 23.3 s |
| Plague > Holy | bow/wand | 64.3 | 65.4 | 10.6 s |
| Frost > Holy | shield/wand | 49.6 | 52.3 | 42.3 s |
| Frost > Fire | shield/axe | 38.4 | 43.2 | 9.1 s |
| Holy > Fire | wand/axe | 70.8 | 73.4 | 4.8 s |
| Holy > Sentenced | wand/bow | 31.6 | 32.8 | 14.4 s |

### 8.3 Policy mode (real sim, 18 setups per cell)

```
npm run harness:factions -w @raid/server -- --mode policy
Mirror: 46/50 cells at 100%; lowest worst hp 0.0% (Frost > Holy, shield)
Signature openings: 9/10 cells at 100%; lowest worst hp 0.0% (Plague > Frost, bow/shield)
```

Mirror matrix, worst winner HP % (a cell below 100% wins is marked with its win rate):

| Edge | sword | axe | bow | wand | shield |
|---|---|---|---|---|---|
| Fire > Sentenced | 72.1 | 69.9 | 71.3 | 69.0 | 42.0 |
| Fire > Plague | 70.7 | 70.7 | 64.3 | 66.3 | 81.3 |
| Sentenced > Plague | 60.7 | 59.7 | 60.8 | 58.8 | 79.7 |
| Sentenced > Frost | 49.0 | 48.9 | 50.9 | 48.5 | 100.0 |
| Plague > Frost | 47.3 | 40.6 | 38.0 | 37.2 | 100.0 |
| Plague > Holy | 80.3 | 64.2 | 64.4 | 62.2 | 100.0 |
| Frost > Holy | 54.7 | 57.1 | 55.8 | 55.0 | **0 (wins 0%)** |
| Frost > Fire | 45.6 | 44.6 | 41.1 | 40.7 | **0 (wins 0%)** |
| Holy > Fire | 70.7 | 73.0 | 72.8 | 71.8 | **0 (wins 0%)** |
| Holy > Sentenced | **6.9** | 35.0 | 32.2 | 31.8 | **0 (wins 0%)** |

The lowest holding cell is the Holy > Sentenced sword mirror, 6.9% in the worst case (0% win before the lifesteal retune). Against 3.4, the Holy rows differ only where the axe is involved, because 3.4 was measured with the axe at 0.8 and the last 9.1 cut (0.77) came after: Holy > Sentenced axe 36.2 to 35.0, Plague > Holy axe 65.3 to 64.2, Frost > Holy axe 57.6 to 57.1, Holy > Fire axe 72.2 to 73.0, and the Holy > Fire opening (wand/axe) 65.5 to 67.0. Every other Holy cell is as in 3.4.

Signature openings (win % / worst HP % / mean HP % / median fight):

| Pair | Weapons | Win | Worst % | Mean % | Median t |
|---|---|---|---|---|---|
| Fire > Sentenced | axe/bow | 100% | 42.8 | 60.0 | 3.8 s |
| Fire > Plague | axe/bow | 100% | 52.8 | 57.1 | 2.7 s |
| Sentenced > Plague | bow/bow | 100% | 60.8 | 60.8 | 5.0 s |
| Sentenced > Frost | bow/shield | 100% | 47.4 | 52.6 | 10.8 s |
| Plague > Frost | bow/shield | **0%** | 0.0 | 0.0 | 29.4 s |
| Plague > Holy | bow/wand | 100% | 37.0 | 41.2 | 19.1 s |
| Frost > Holy | shield/wand | 100% | 49.6 | 50.0 | 43.8 s |
| Frost > Fire | shield/axe | 100% | 43.7 | 43.7 | 9.6 s |
| Holy > Fire | wand/axe | 100% | 67.0 | 74.3 | 6.2 s |
| Holy > Sentenced | wand/bow | 100% | 33.4 | 34.4 | 15.3 s |

### 8.4 20 Hz model (`realtime.py`)

**Mixed weapons.** All 250 cells (10 edges x 25 weapon pairs) win every phase pair, at k = 1 and at k = 2. The thinnest are Holy's sword against Sentenced's wand (worst HP 26.3% at k = 1, 27.0% at k = 2), Plague's sword against Frost's wand (33.7% at k = 2) and Frost's shield against Fire's bow (38.0% at k = 2).

**Longest stretch with no swing from either fighter** (`realtime_report.py gap`): 1.60 s (Frost > Holy, axe/axe), the same as in `docs/GAME_DESIGN.md` 10.2.

**Holy(wand) > Sentenced, worst HP % at k = 1**, by what Sentenced holds, through the changes:

| Sentenced on | Before both changes | 9.1 only | Lifesteal only (3.6) | Merged |
|---|---|---|---|---|
| Bow | 30.4 | 23.6 | 37.3 | 31.8 |
| Sword | 8.1 | 29.4 | 18.8 | 36.6 |

Merged, the other three: axe 34.7, wand 31.8, shield 36.6.

**Buff caps** (smallest multiplier on the losing side that flips an edge, below 50% wins; minimum over the five mirrors and the signature opening; `python3 testing/realtime_report.py buff`, k = 1). "Never" is no flip within x8:

| Edge | HP | Attack speed |
|---|---|---|
| Fire > Sentenced | x1.82 (signature) | never |
| Fire > Plague | x2.04 (signature) | x3.60 (sword) |
| Sentenced > Plague | x2.00 (bow) | x2.29 (bow) |
| Sentenced > Frost | x2.38 (bow) | x2.11 (bow) |
| Plague > Frost | x1.66 (bow) | x1.66 (bow) |
| Plague > Holy | x2.89 (axe) | x1.99 (axe) |
| Frost > Holy | x2.08 (signature) | **x1.41** (signature) |
| Frost > Fire | x1.90 (wand) | x4.24 (wand) |
| Holy > Fire | never | x7.22 (sword) |
| Holy > Sentenced | **x1.58** (axe) | never |

The softest HP edge is Holy > Sentenced (x1.58; x1.60 on the signature opening), about five stacks in the S-curve of `docs/GAME_DESIGN.md` 12.2 (+58%). The softest attack-speed edge is Frost > Holy (x1.41, the signature opening; x1.50 on the five mirrors), about five stacks (+42%). Plague > Frost is next on both (x1.66). With the lifesteal alone (3.6) the softest were x1.59 HP (Holy > Sentenced and Frost > Fire together) and x1.32 attack speed (Frost > Holy); with 9.1 alone, x1.30 HP (Holy > Sentenced) and x1.66 attack speed (Plague > Frost). Frost > Fire moved from x1.59 to x1.90 HP and its signature opening from 34% to 44% HP left (k = 1).

**Stacked buffs on the loser** (cells under 60% wins, k = 1, the method of section 4):

| HP x / attack speed x | Lifesteal alone (section 4) | Merged |
|---|---|---|
| 1.2 / 1.2 | holds every edge | holds every edge |
| 1.2 / 1.3 | Frost > Holy signature opening 0% | holds every edge |
| 1.3 / 1.2 | Frost > Holy signature opening 0% | holds every edge |
| 1.3 / 1.3 | Plague > Frost on all five mirrors (0-13%); Frost > Holy signature opening 0% | Plague > Frost on all five mirrors (0%); Frost > Holy signature opening 0% |

The review's caps (+20% max HP, +30% attack speed) hold one at a time and together; only both at +30% breaks edges. The side effect of section 4 is gone. Putting only the wand's damage multiplier back to 0.85 brings the Frost > Holy opening back to 0% at 1.2 / 1.3 (0.1% at 1.3 / 1.2), so the wand's cut to 0.8 is what repairs it (the wand is Holy's weapon in that opening).

### 8.5 Still failing at the weapon layer (reported, not retuned)

The same as section 5, unchanged by the merge:

- **The four shield mirrors** Frost > Holy, Frost > Fire, Holy > Fire and Holy > Sentenced win 0%. Two shields facing each other block every bash, so only damage over time lands.
- **The Plague(bow) > Frost(shield) opening** wins 0%. The shield reflects every arrow back; Phase 9.1 records Shield > Bow as having no counterplay inside the matchup.
- **Thin but holding:** the Holy > Sentenced sword mirror (6.9% worst HP) and the Fire > Sentenced opening (42.8% worst HP, axe/bow).

### 8.6 Sentenced's signature weapon

Phase 9.1 flagged that, in `realtime.py`, the Holy > Sentenced opening was healthier with Sentenced on the sword (29.4%) than on the bow (23.6%), and left `SIGNATURE_WEAPONS.sentenced` to this phase. Sentenced's weapon takes part in four openings (Fire > Sentenced, Sentenced > Plague, Sentenced > Frost, Holy > Sentenced), so each weapon was tried in all four: trades mode (k = 2, against `realtime.py`) and policy mode (real sim). "Contested" means the weapon edge opposes the faction edge, "both" that the weapon edge also favours the faction winner, "neutral" a mirror. Designed winner's win % / worst HP %:

| Sentenced on | Opening | Kind | Trades | Policy |
|---|---|---|---|---|
| Sword | Fire(axe) > Sentenced | contested | 100 / 67.5 | 100 / 66.0 |
| | Sentenced > Plague(bow) | contested | 100 / 58.8 | 100 / 52.1 |
| | Sentenced > Frost(shield) | contested | 100 / 50.2 | 100 / 48.7 |
| | Holy(wand) > Sentenced | contested | 100 / 36.4 | **0 / 0.0** |
| Axe | Fire(axe) > Sentenced | neutral | 100 / 49.8 | 100 / 69.9 |
| | Sentenced > Plague(bow) | contested | 100 / 59.0 | 100 / 52.1 |
| | Sentenced > Frost(shield) | both | 100 / 50.2 | 100 / 50.2 |
| | Holy(wand) > Sentenced | contested | 100 / 34.5 | 100 / 13.8 |
| **Bow (current)** | Fire(axe) > Sentenced | contested | 100 / 57.0 | 100 / 42.8 |
| | Sentenced > Plague(bow) | neutral | 100 / 60.8 | 100 / 60.8 |
| | Sentenced > Frost(shield) | contested | 100 / 50.2 | 100 / 47.4 |
| | Holy(wand) > Sentenced | both | 100 / 31.6 | 100 / 33.4 |

The wand and the shield give three "both" openings and one neutral (6 of 10 contested in the game). In trades mode: wand 62.7, 60.8, 50.2 and 31.7% worst HP; shield 62.4, 58.8, 50.2 and 36.4%. The sword would make 10 of 10 openings contested on paper; the axe and the bow leave 8 of 10.

**Decision (a best guess, logged for the owner to overrule): keep Sentenced on the bow.**

- **The sword is contested everywhere and still wrong.** In the real sim Sword > Wand decides Holy > Sentenced outright: the sword closes the 220 u gap and staggers the wand's casts, and Holy wins 0 of 18 setups. The weapon edge overrides the faction edge, so the opening would be settled on the pick screen. `realtime.py` has no stagger and says 36.4%.
- **The axe is contested against Holy and holds, but at 13.8% worst HP it is the thinnest opening in the game.** It also un-contests two other Sentenced openings (Fire vs Sentenced becomes an axe mirror; Sentenced vs Frost becomes Axe > Shield, which favours Sentenced on both loops), so the game stays at 8 of 10 contested.
- **The bow keeps all four openings holding with the healthiest minimum** (31.6% in trades mode, 33.4% in policy mode).
- **The owner's original reason still holds.** Keep Holy vs Sentenced healthy, favouring Holy on both loops on purpose (Wand > Bow). Once signatures and real weapon interactions are measured, the bow serves it; 9.1's model-only reading (sword 29.4% against bow 23.6%, before the lifesteal retune) does not survive the real sim.

To retry another weapon, set `SIGNATURE_WEAPONS.sentenced` (`packages/shared/src/weapons.ts`) and run both harness commands of 8.2 and 8.3.
