# Counter Review: v3 faction cycle

**Phase 10 retune note (2026-10-24).** Holy's Radiant lifesteal changed after this review was written: `ls1` 1.25 to 1.75 and `ls_cap` 1.0 to 1.5, so it heals `0.25 + 1.75 x missing health` of the damage it deals, capped at 150% (it reaches 100% at about 43% missing health). The body below is the v3 analysis before that change. Engine results (dt = 0.002) that moved, before to after:

| Edge | Before | After |
|---|---|---|
| Plague > Holy | 15.8 s, 67% | 16.7 s, 66% |
| Frost > Holy | 52.3 s, 63% | 61.5 s, 57% |
| Holy > Fire | 8.1 s, 69% | 8.1 s, 72% |
| Holy > Sentenced | 22.7 s, 27% | 22.7 s, 34% |

The other six edges are unchanged. Every Holy figure below (fight lengths, HP left, lifesteal returns, flip distances, buff caps, the mixed-weapon failures of Holy > Sentenced, the kiting tolerances, the identity-test shifts) is the v3 value. The new values, the levers that were tried and the reason are in `testing/TUNING_10.md`.

Written for the author of `CLASS_SHEET.md`. It checks the v3 numbers in `classes.py` against `engine.py`, then checks how the cycle survives the move to a 20 Hz game with weapons.

**v3 revision.** Fire now swings 0.6 times a second for 150 (was 0.3 for 305; DPS 91.5 to 90) and Frost 0.45 times for 90 (was 0.3 for 135; DPS 40.5, unchanged). Fire's backlash drops from 210 to 200. In the 20 Hz model a weapon is now a % boost on the faction's attack speed, replacing `max(anim floor, base cooldown x 0.86 / rate)`. v3 also adopts animation timings that shrink with the interval and a 0.5 s stagger immunity; the 20 Hz model does not include them. Re-run for v3: the four Fire edges (Fire > Sentenced, Fire > Plague, Frost > Fire, Holy > Fire) in sections 1 to 4 and 6, and section 5 except the parts marked v2 or not re-run (the v2-plan subsection, rule 5's line-of-sight run, the move-speed caps, and the heal-item and disengage runs). The six edges without Fire do not move in the engine (Frost's DPS is unchanged and Fire's backlash is the only mechanic that reads an attack rate); only the Frost hit values quoted in section 3 change (90 instead of 135, same percentages). The cost: a faster Frost feeds Fire's backlash, so Frost > Fire keeps 49% HP instead of 59%. It never flips. Figures marked v2 are kept for comparison.

Status (v3): `python3 test_rpsls.py` prints ALL PASS (graph at four timesteps, scaling, jitter, purity audit, and the nine identity tests). The TypeScript port in `packages/shared` passes its 226 tests. Every engine number below was computed by script against the current engine at dt = 0.002 unless a different dt is named. The real-time numbers come from `realtime.py` (`python3 realtime_report.py` prints the main tables in about a minute) and from scripts run against it for this review.

Terms used throughout:

| Term | Meaning |
|---|---|
| Edge | "A > B" means A beats B in a 1v1 at full HP, in contact from the first tick. |
| HP left | The winner's remaining HP as a share of its max HP. |
| Effective DPS | Damage per second after armor, shield and Frost's slow. "Open" is the first tick. "Avg" is total damage dealt divided by fight length. Lifesteal is not netted out. |
| Loser's TTK ratio | How long the loser would need to kill the winner, as a multiple of the winner's own kill time. Measured by letting the loser's HP floor at 0 and keep fighting until the winner dies. A ratio of 2.0 means twice as long. |
| Margin | Winner's HP-left minus loser's HP-left, in points (the sheet's definition). |
| Flip | The required winner no longer wins inside the engine's 120 s cap, the same rule `test_rpsls.py` uses. |

## 1. One-minute summary

The cycle runs on four axes. Each faction is strong on one and weak to the axis that attacks it.

| Axis | What it compares | Edges it decides |
|---|---|---|
| Damage type vs defense | Each attacker's phys/magic/true split against the defender's armor and shield (the sheet's section 5 matrix). | Fire > Plague, Sentenced > Plague, Plague > Holy, Holy > Fire |
| Rate vs flat | Frost's slow cuts anything paid per swing (hits, and the lifesteal that rides on them) and nothing that is flat (mark, disease, execute). | Frost > Holy, Sentenced > Frost, Plague > Frost |
| Burst vs ramp | Damage in the first 4 seconds against damage that grows with time (the mark reaches its cap at 7.9 s). | Fire > Sentenced |
| HP pool | 1750 and 1450 HP against 500 and 700, plus lifesteal. | Frost > Fire, Holy > Sentenced |

| # | Edge | Axis | Deciding factor | Length | HP left | Loser's TTK ratio |
|---|---|---|---|---|---|---|
| 1 | Fire > Sentenced | Burst vs ramp | Fire starts at 187 DPS and is done in 3.7 s, when the mark has reached 131 of its 275; Sentenced averages 31 DPS against Fire's 500 HP. | 3.7 s | 77% | 2.10 |
| 2 | Fire > Plague | Damage type vs defense | Plague has no shield, so Fire's magic lands at 100%, and Plague's 1.85 swings per second feed a 370-per-second backlash; 470 DPS removes 1000 HP in 2.1 s, before the execute can open. | 2.1 s | 71% | 2.06 |
| 3 | Sentenced > Plague | Damage type vs defense | The mark lands at 100% on a target with no shield and averages 135 DPS; Plague's mostly physical damage is cut to 53% by Sentenced's defenses and comes to 41 DPS. | 7.4 s | 56% | 1.38 |
| 4 | Sentenced > Frost | Rate vs flat | The mark is flat, so the slow cancels only 1% of Sentenced's potential damage; it averages 106 DPS against Frost's 21, and Frost's 1750 HP only stretches the fight to 16.6 s. | 16.6 s | 51% | 2.02 |
| 5 | Plague > Frost | Rate vs flat | 84% of Plague's damage is flat (disease 42%, execute 42%), so the slow trims only the 16% that is swings; the execute opens once Frost is under 50% and ends the fight at 37 s. | 37.0 s | 40% | 1.67 |
| 6 | Plague > Holy | Damage type vs defense | Plague's 80% physical share lands at 86% on Holy's zero armor (105 DPS average) while Holy's all-physical damage is cut to 33% by Plague's 200 armor (21 DPS); Holy's 250 shield is spent on a mostly physical attacker. | 15.8 s | 67% | 3.07 |
| 7 | Frost > Holy | Rate vs flat | Holy has no flat damage, so the slow removes 60% of its swings (969 of 1,615 HP) and the lifesteal that rides on them; Holy deals 12 DPS to Frost's 38. | 52.3 s | 63% | 2.71 |
| 8 | Frost > Fire | HP pool | 1750 HP against 500 decides it: with every signature stripped Frost still wins with 66% left, and at equal HP Fire wins; the slow holds Fire to 68 DPS, though Frost's 0.45 swings per second still feed 90 raw backlash per second. | 13.1 s | 49% | 1.97 |
| 9 | Holy > Fire | Damage type vs defense | Holy's 250 shield cuts Fire's magic to 29% (83 DPS against 1450 HP) while Holy's physical damage lands at 100% on zero armor (62 DPS against 500 HP); with all armor and shield stripped Fire wins. | 8.1 s | 69% | 6.09 |
| 10 | Holy > Sentenced | HP pool and lifesteal | Holy's shield cuts the mark to 29%, so Sentenced deals 1,502 damage over 22.7 s, but lifesteal returns 447 HP of it and Holy's own 31 DPS finishes Sentenced's 700 HP; without lifesteal Holy loses by about 3 points. | 22.7 s | 27% | 1.35 |

What to take from it:

- All ten edges hold and every winner keeps at least 27% HP. The spread is wide: Fire's two wins keep 71-77% and finish in under 4 seconds; Holy over Sentenced keeps 27% after 22.7 seconds. v3 took 10 points off Frost > Fire (59% to 49%), because Frost's faster swings feed Fire's backlash.
- Softest edge: Holy > Sentenced. Holy's hit or attack rate falling 20% (65 to 52 hit) flips it, and Sentenced needs only 1.29x damage. Hardest: Fire > Sentenced (Sentenced needs 4.28x damage) and Holy > Fire (Fire needs 6.09x HP). Section 3 has all ten.
- Fights are long. Median 14.5 s, mean 17.9 s. The four fights that involve Frost average 29.7 s; the other six average 10.0 s.
- Two signatures break ties instead of driving fights. Without Plague's execute, Plague loses to Frost by about 3 points. Without Holy's lifesteal, Holy loses to Sentenced by about 3 points. Fire's burn is cosmetic (at most 3.7 points of margin).
- In the 20 Hz game the v3 model, which builds in rules 1 to 3 from section 5, keeps all 50 mirror-weapon cells and every signature opening. The weak spots are Holy > Sentenced in two mixed-weapon pairs (a Sentenced sword against a Holy bow or shield) and Frost > Fire, whose signature opening now keeps 34% worst HP (v2: 47%). The v2 plan as first drawn kept only 48 of 50 mirror cells, because weapon dpsMult scaled hits but not signature bonus damage.

## 2. Faction cards

Each table lists a faction's four matchups: DPS each way (open / avg), who has what HP left, and what the two signatures were doing in that fight. The "slow" entries give the share of the foe's potential damage (damage dealt plus damage the slow prevented) that the slow cancelled.

### Fire (500 HP, glass cannon)

| Matchup | Length | HP left | Fire DPS to foe (open / avg) | Foe DPS to Fire (open / avg) | Fire signature at work | Foe signature at work |
|---|---|---|---|---|---|---|
| **beats** Sentenced | 3.7 s | Fire 77% | 187 / 187 | 2 / 31 | backlash 64% + burn 4% of its damage | mark 94% of its damage |
| **beats** Plague | 2.1 s | Fire 71% | 470 / 470 | 68 / 68 | backlash 79% + burn 2% of its damage | disease 52% of its damage, execute never opens |
| **loses to** Frost | 13.1 s | Frost 49% | 68 / 68 | 38 / 38 | backlash 66% + burn 7% of its damage | slow cancels 28% of the foe's potential damage (353 HP) |
| **loses to** Holy | 8.1 s | Holy 69% | 83 / 83 | 62 / 62 | backlash 66% + burn 3% of its damage | lifesteal returns 227 HP (34% of damage taken) |

- Beats Sentenced and Plague because it deals 187 and 470 DPS from the first tick and both targets feed its backlash with their own swing rate: Sentenced's 0.9/s is 180 raw damage per second, Plague's 1.85/s is 370. Backlash is 64% and 79% of Fire's damage in those fights; burn is 4% and 2%.
- At 3.7 s, when Fire kills Sentenced, the mark is at 131 of its 275 cap (48%), which is why Sentenced averages 31 DPS. Plague never gets its execute: Fire ends the fight at 71% HP, above the 50% line.
- Loses to Frost because Frost feeds the backlash only lightly (Frost swings 0.45/s, so 90 raw per second instead of 180-370) and cuts Fire's own swings from 0.6 to 0.24 per second. Fire's output falls to 68 DPS against a 1750 HP pool. Had Fire survived it would have needed 25.7 s to kill Frost; Frost needed 13.1 s to kill Fire (loser's TTK ratio 1.97). In v2 Frost swung 0.3/s and fed only 63 raw per second, so Fire managed 55 DPS and Frost kept 59%.
- Loses to Holy because the 250 shield cuts Fire's magic to 29% (83 DPS against 1450 HP) while Holy's physical damage lands at 100% on Fire's zero armor. Below 40% HP Holy's lifesteal returns everything it deals, about 62 of Fire's 83 DPS, so Fire would have needed 49.3 s to kill Holy; Holy needed 8.1 s (ratio 6.09).

### Sentenced (700 HP, patient executioner)

| Matchup | Length | HP left | Sentenced DPS to foe (open / avg) | Foe DPS to Sentenced (open / avg) | Sentenced signature at work | Foe signature at work |
|---|---|---|---|---|---|---|
| **beats** Plague | 7.4 s | Sentenced 56% | 4 / 135 | 41 / 41 | mark 97% of its damage | disease 52% of its damage, execute never opens |
| **beats** Frost | 16.6 s | Sentenced 51% | 1 / 106 | 21 / 21 | mark 99% of its damage | slow cancels 1% of the foe's potential damage (22 HP) |
| **loses to** Fire | 3.7 s | Fire 77% | 2 / 31 | 187 / 187 | mark 94% of its damage | backlash 64% + burn 4% of its damage |
| **loses to** Holy | 22.7 s | Holy 27% | 1 / 66 | 31 / 31 | mark 98% of its damage | lifesteal returns 447 HP (30% of damage taken) |

- Beats Plague and Frost with the mark, which is 97% and 99% of its damage. Against Plague the mark lands at 100% and Plague's mostly physical damage is cut to 53% (41 DPS). Against Frost the slow cancels 1% of Sentenced's potential damage, so Frost's 1750 HP only stretches the fight to 16.6 s.
- Sentenced's own hit (5) and swing rate are close to dead stats: swings are 1-6% of its damage (6% against Fire, 1-3% elsewhere). The rate matters mainly as a backlash feed for Fire (section 6).
- Loses to Fire because 187 DPS arrives while the mark is at 48% strength. Loses to Holy because the 250 shield cuts the mark to 29% (66 DPS average against 1450 HP plus 447 HP of lifesteal) while Holy's 31 DPS finishes 700 HP. This is the closest loss: Sentenced needs only 1.35x as long.

### Plague (1000 HP, attrition swarm)

| Matchup | Length | HP left | Plague DPS to foe (open / avg) | Foe DPS to Plague (open / avg) | Plague signature at work | Foe signature at work |
|---|---|---|---|---|---|---|
| **beats** Frost | 37.0 s | Plague 40% | 27 / 47 | 16 / 16 | disease 42% + execute 42% of its damage | slow cancels 19% of the foe's potential damage (411 HP) |
| **beats** Holy | 15.8 s | Plague 67% | 66 / 105 | 21 / 21 | disease 33% + execute 37% of its damage | lifesteal returns 207 HP (12% of damage taken) |
| **loses to** Fire | 2.1 s | Fire 71% | 68 / 68 | 470 / 470 | disease 52% of its damage, execute never opens | backlash 79% + burn 2% of its damage |
| **loses to** Sentenced | 7.4 s | Sentenced 56% | 41 / 41 | 4 / 135 | disease 52% of its damage, execute never opens | mark 97% of its damage |

- Beats Frost on flat damage: 84% of its damage is disease (42%) and execute (42%), and the slow trims only the 16% that is swings. It averages 47 DPS against Frost's 16 and wins in 37 s.
- Beats Holy because Holy has no armor: Plague's 80% physical share lands at 86% (105 avg DPS), while Holy's all-physical damage is cut to 33% by Plague's 200 armor (21 DPS). Holy's lifesteal returns 207 HP, 12% of what it takes.
- Loses to Fire and Sentenced, which both deal 100% magic. Plague has no shield, so their damage lands at 100%, and its 200 armor is wasted. In both fights the execute never opens, because Plague's execute reads the foe's HP and the foe finishes above 50% (71% and 56%).
- Plague's armor only works against the two physical attackers, Holy (0.33) and Frost (0.40). Those are exactly the two edges it wins.

### Frost (1750 HP, control bruiser)

| Matchup | Length | HP left | Frost DPS to foe (open / avg) | Foe DPS to Frost (open / avg) | Frost signature at work | Foe signature at work |
|---|---|---|---|---|---|---|
| **beats** Holy | 52.3 s | Frost 63% | 38 / 38 | 12 / 12 | slow cancels 60% of the foe's potential damage (969 HP) | lifesteal returns 517 HP (26% of damage taken) |
| **beats** Fire | 13.1 s | Frost 49% | 38 / 38 | 68 / 68 | slow cancels 28% of the foe's potential damage (353 HP) | backlash 66% + burn 7% of its damage |
| **loses to** Sentenced | 16.6 s | Sentenced 51% | 21 / 21 | 1 / 106 | slow cancels 1% of the foe's potential damage (22 HP) | mark 99% of its damage |
| **loses to** Plague | 37.0 s | Plague 40% | 16 / 16 | 27 / 47 | slow cancels 19% of the foe's potential damage (411 HP) | disease 42% + execute 42% of its damage |

- Beats Holy because Holy has no flat damage: the slow removes 969 of Holy's 1615 potential HP of damage (60%) and the lifesteal that rides on it. Holy deals 12 DPS to Frost's 38, and the fight lasts 52.3 s, the longest in the system.
- Beats Fire mostly on HP pool. With every signature stripped from both, Frost still wins with 66% left. With signatures on but both at 1000 HP, Fire wins with 44% left. The slow cancels 353 HP of Fire's damage, but Fire's backlash and burn add more than that, so with signatures on Frost keeps 49% rather than 66%.
- Loses to Sentenced and Plague because the slow has almost nothing to grab. The slow cancels 1% of Sentenced's potential damage and 19% of Plague's (411 HP). Against Plague that is still worth 15.8 points of margin, so "slowing them achieves little" is true of the mark but not of Plague.
- Frost's own damage has no signature part at all, so its "signature share of the kill" is only the cancelled damage in the table.

### Holy (1450 HP, sustain juggernaut)

| Matchup | Length | HP left | Holy DPS to foe (open / avg) | Foe DPS to Holy (open / avg) | Holy signature at work | Foe signature at work |
|---|---|---|---|---|---|---|
| **beats** Fire | 8.1 s | Holy 69% | 62 / 62 | 83 / 83 | lifesteal returns 227 HP (34% of damage taken) | backlash 66% + burn 3% of its damage |
| **beats** Sentenced | 22.7 s | Holy 27% | 31 / 31 | 1 / 66 | lifesteal returns 447 HP (30% of damage taken) | mark 98% of its damage |
| **loses to** Plague | 15.8 s | Plague 67% | 21 / 21 | 66 / 105 | lifesteal returns 207 HP (12% of damage taken) | disease 33% + execute 37% of its damage |
| **loses to** Frost | 52.3 s | Frost 63% | 12 / 12 | 38 / 38 | lifesteal returns 517 HP (26% of damage taken) | slow cancels 60% of the foe's potential damage (969 HP) |

- Beats Fire: the shield cuts Fire to 29% while Holy's physical damage lands at 100% on zero armor (62 DPS against 500 HP). Lifesteal returns 227 HP, but removing it does not flip this edge (Holy keeps 54% instead of 69%).
- Beats Sentenced: lifesteal returns 447 HP, 30% of the 1502 damage Sentenced deals. Without it Holy loses by about 3 points. Lifesteal here is a threshold, not a slider: a cap of only 10% still wins (1.2% left); a cap of 50% leaves 17%; the designed 100% leaves 27%.
- Loses to Plague because zero armor lets 86% through while Holy's own damage is cut to 33%. Loses to Frost because every point of Holy's damage and healing is paid per swing, and the slow takes 60% of the swings (lifesteal returns 517 HP, 26% of what it takes, but Frost's 38 DPS outruns it).

## 3. Margins

One stat of one fighter is changed at a time, and the smallest relative change that stops the required winner from winning is found by bisection on the engine. Stats tried: HP, attack rate, hit, armor, shield, and every signature number, on both fighters. "Loser needs" scales only the loser: HP x multiplies max HP; damage x multiplies its hit and every flat bonus (burn, backlash, disease, execute, mark ramp and cap). "Winner's damage can fall to" is the same scaling on the winner. Rows run softest first.

| Rank | Edge | HP left | Smallest single-stat change that flips it | Loser needs: HP x | Loser needs: damage x | Winner's damage can fall to |
|---|---|---|---|---|---|---|
| 1 | Holy > Sentenced | 27% | Holy hit or attack rate -20.0% (hit 65 to 52) | 1.35x | 1.29x | 0.80x |
| 2 | Sentenced > Plague | 56% | Sentenced HP -27.3% (700 to 509) | 1.78x | 1.38x | 0.56x |
| 3 | Plague > Frost | 40% | Plague HP -40.0% (1000 to 600), or Frost hit, rate or HP +66.7% | 1.67x | 1.67x | 0.60x |
| 4 | Frost > Holy | 63% | Frost hit or attack rate -40.7% (hit 90 to 53; the fight passes 120 s, Holy wins at -45.4%) | 2.29x (fight passes 120 s); Holy wins at 2.71x | 1.83x | 0.59x |
| 5 | Frost > Fire | 49% | Frost hit or HP -49.2% (hit 90 to 46, or HP 1750 to 889) | 1.97x | 1.97x | 0.51x |
| 6 | Sentenced > Frost | 51% | Sentenced HP -50.5% (700 to 346) | 2.34x | 2.02x | 0.43x |
| 7 | Fire > Plague | 71% | Fire HP -51.5% (500 to 243) | 2.06x | 2.06x | 0.49x |
| 8 | Holy > Fire | 69% | Holy hit -63.7% (hit 65 to 23.6) | 6.09x | 2.75x | 0.36x |
| 9 | Plague > Holy | 67% | Plague HP -67.4% (1000 to 326) | 3.07x | 2.23x | 0.45x |
| 10 | Fire > Sentenced | 77% | Fire HP -76.6% (500 to 117) | 2.10x | 4.28x | 0.48x |

Notes on the table:

- The two multipliers differ where the winner's pressure ramps. The mark grows with time, so extra HP on the loser also buys more mark. That is why Sentenced > Plague needs 1.78x HP but only 1.38x damage. Where the winner's damage is steady, the loser's HP multiplier equals its TTK ratio from section 1.
- Frost > Holy stalls before it flips. At Frost hit -40.7% (hit 53) the fight runs past 120 s and Frost still wins at about 121 s; Holy actually wins at -45.4% (hit 49), or at Holy HP x2.71, or when the slow drops below 0.27 (from 0.60). The table shows the 120 s version because that is what the test suite measures.
- Frost's attack rate is no longer interchangeable with its hit on Frost > Fire: a slower Frost also feeds less backlash, so the rate has to fall 74.1% to flip it against 49.2% for the hit.
- The ten edges fall into three groups by slack. Soft: Holy > Sentenced, Sentenced > Plague, Plague > Frost, Frost > Holy (flip at 20-41% on one stat, loser needs 1.3-1.8x damage). Middle: Frost > Fire, Sentenced > Frost, Fire > Plague (49-52%). Hard: Holy > Fire, Plague > Holy, Fire > Sentenced (64-77%). v3 moved Frost > Fire from 59% to 49%, the bottom of the middle group.
- Fire > Sentenced is hard against extra damage (4.28x) but needs only 2.10x HP. Sentenced's best lever against Fire is HP (700 to 1,473): it needs about 7.9 s to kill Fire's 500 HP, and Fire's burst does not depend on time.
- The four soft edges are the ones that hang on a threshold mechanic: Holy's lifesteal (Holy > Sentenced), Plague's 50% execute line (Sentenced > Plague, Plague > Frost) and the slow against Holy's per-swing healing (Frost > Holy).

Detail on the three softest:

- Holy > Sentenced has several independent weak points. Holy hit 55 holds with 7.6% left and 50 flips; Holy attack rate 0.80 holds with 7.0% left and 0.75 flips. Holy shield 175 holds with 1.9% left and 150 flips (-31.7% is the threshold). Sentenced mark cap 375 holds with 2.2% left and 400 flips. Moving 10 points of Sentenced's damage to physical holds (4.1% left); 20 points flips (threshold 11.7 points). Sentenced armor 125 holds (13.8%), 150 flips.
- Sentenced > Plague finishes 6.4 points above the 50% line where Plague's execute opens. Sentenced HP 550 holds with 37.5% left and 500 flips; the threshold is HP 509 (-27.3%).
- Plague > Frost sits exactly on grid points: Plague HP 600 wins with 0.0% left and Frost hit 150 wins with 0.0% left. One step further (Plague HP 550, Frost hit 155) flips it.

Ways to widen Holy > Sentenced without breaking another edge (all keep the full ten-edge graph; checked on the engine):

| Change | Holy > Sentenced HP left | Sentenced damage needed to flip | Holy hit drop that flips |
|---|---|---|---|
| As written (shield 250) | 27.1% | 1.29x | -20.0% |
| Holy shield 275 | 32.9% | 1.39x | -24.7% |
| Holy shield 300 | 37.8% | 1.48x | -29.0% |
| Sentenced mark cap 250 | 33.7% | 1.40x | -25.7% |
| Holy HP 1550 | 31.1% | 1.36x | -23.4% |

Side effects on the other edges: shield 275 touches only Holy > Fire (69% to 72%). Mark cap 250 lowers Sentenced > Frost from 51% to 48%. HP 1550 lowers Plague > Holy from 67% to 65% and Frost > Holy from 63% to 61%. The shield change is the cleanest.

## 4. Identity tests

Rule from the sheet: a main signature must flip at least one of the owner's four edges and move a margin by 20 points or more; a sub-mechanic must flip an edge or move a margin by 15 points or more. Margins below are at dt = 0.002; `test_rpsls.py` (dt = 0.005) prints the same shifts within 0.1.

| Owner | Removed | Kind | Edges that flip (margin before to after) | Largest shift | Sheet |
|---|---|---|---|---|---|
| Fire | burn and backlash | main | Fire > Sentenced 76.6 to -32.4; Fire > Plague 70.9 to -60.5 | 131.4 | 131 |
| Fire | backlash only | sub | Fire > Sentenced 76.6 to -24.8; Fire > Plague 70.9 to -56.1 | 127.0 | 127 |
| Sentenced | the mark | main | Sentenced > Plague 56.4 to -95.4; Sentenced > Frost 50.5 to -98.3 | 151.8 | 152 |
| Sentenced | the ramp (mark at full strength from t=0) | sub | none (largest mover Fire > Sentenced, 76.6 to 6.9) | 69.8 | 70 |
| Plague | the execute | main | Plague > Frost 40.0 to -3.3 | 43.4 | 43 |
| Plague | the flat disease | sub | Plague > Frost 40.0 to -73.9 | 113.9 | 114 |
| Frost | the slow | main | Frost > Holy 63.1 to -39.7 | 102.8 | 103 |
| Holy | lifesteal | main | Holy > Sentenced 27.1 to -2.9 | 30.0 | 30 |
| Holy | the missing-health scaling (flat 25% lifesteal) | sub | none (largest mover Holy > Sentenced, 27.1 to 8.3) | 18.7 | 19 |

Findings:

- All nine rows reproduce the sheet within 0.5 point, with identical flipped-edge sets, and pass the sheet's main/sub rule. The TypeScript port runs the same nine tests and measures the same shifts (131.4, 127.0, 151.8, 69.8, 43.4, 113.9, 102.8, 30.0, 18.7).
- Three sizes of effect. Fire's pair and Sentenced's mark reverse their edges by 100+ points: the owner goes from winning to being destroyed. Plague's disease and Frost's slow are next (about 100). Plague's execute and Holy's lifesteal are different: without the execute Plague loses Plague > Frost by only 3.3 points, and without lifesteal Holy loses Holy > Sentenced by only 2.9. Those two edges become coin flips rather than reversals. The two mechanics decide the finish; they do not drive the fight.
- Plague's labels are reversed in effect. The execute is labelled main and moves margins 43 points; the flat disease is labelled sub and moves them 114. On Plague > Holy it is 27.6 against 51.3. Both halves matter, which the sheet says, but disease is the bigger half.
- Fire's burn on its own fails the sheet's own bar. Removing only the burn moves the largest margin by 3.7 points and flips nothing (the bar for a sub-mechanic is a flip or 15 points). Measured as the sheet defines it (margin with burn minus margin with burn removed), burn reaches 15 points of shift at about 40 per second, four times today's 10.
- Sentenced's ramp is the thing Fire exploits. With the mark at full strength from t=0, no edge flips, but Fire > Sentenced drops from 77% to 7%. The 7.9 s build-up is worth 70 points of margin on that one edge.
- Frost's slow matters in one edge outright (Frost > Holy flips by 103 points) and partly in two: Frost > Fire loses 20.2 points without it, and Plague > Frost moves 15.8 points in Plague's favour. Against Sentenced it is worth 0.5 points.

## 5. In the game (real time)

### The model

A 20 Hz discrete duel (`realtime.py`) that keeps the engine's damage laws exactly (mitigation, shares, the five mechanics, Frost's slow as a multiplier on the opponent's cooldown progress). Weapons replace continuous attacks. A weapon is a % boost on the faction's base attack speed, so the speed ratios between factions hold on every weapon:

| Weapon | Speed boost | Floor | dpsMult | Range |
|---|---|---|---|---|
| sword | +115% | 0.25 | 1.00 | 60 |
| axe | +40% | 0.35 | 0.90 | 60 |
| bow | +95% | 0.25 | 0.80 | 480 |
| wand | +65% | 0.30 | 0.85 | 420 |
| shield | +60% | 0.30 | 0.75 | 60 |

*History: this is the v3 weapon table before the 9.1 weapon tuning (`testing/TUNING_9_1.md`), which changed the sword dpsMult to 0.75, the axe's to 0.80 and the wand's to 0.80, and the bow and wand ranges to 240 and 220. The damage-per-hit table below carries the old multipliers too; `python3 testing/weapon_reference.py` prints the current ones.*

Attacks per second = faction rate x (1 + boost) x attack-speed buffs. The interval between attacks is 1 / that, never below the weapon's floor. Damage per hit = faction rate x faction hit x dpsMult x buffs x interval, which is faction hit x dpsMult / (1 + boost) with no buff. So every faction keeps its DPS times dpsMult on every weapon, and faster weapons hit proportionally lighter. The floor is the shortest interval. It binds only under attack-speed buffs, and attack speed past it turns into damage per hit. Resulting intervals and damage per hit at duel pace k = 1 (no floor binds without a buff; k = 2 doubles every hit):

| Faction (rate) | sword | axe | bow | wand | shield |
|---|---|---|---|---|---|
| Fire (0.60) | 0.78 s / 69.8 | 1.19 s / 96.4 | 0.85 s / 61.5 | 1.01 s / 77.3 | 1.04 s / 70.3 |
| Sentenced (0.90) | 0.52 s / 2.3 | 0.79 s / 3.2 | 0.57 s / 2.1 | 0.67 s / 2.6 | 0.69 s / 2.3 |
| Plague (1.85) | 0.25 s / 9.3 | 0.39 s / 12.9 | 0.28 s / 8.2 | 0.33 s / 10.3 | 0.34 s / 9.4 |
| Frost (0.45) | 1.03 s / 41.9 | 1.59 s / 57.9 | 1.14 s / 36.9 | 1.35 s / 46.4 | 1.39 s / 42.2 |
| Holy (0.95) | 0.49 s / 30.2 | 0.75 s / 41.8 | 0.54 s / 26.7 | 0.64 s / 33.5 | 0.66 s / 30.5 |

Against v2, Fire's axe went from one swing every 2.58 s to 1.19 s and Frost's shield from 2.29 s to 1.39 s. The slowest combination is now Frost's axe at 1.59 s (v2: Fire or Frost on the axe, 2.58 s). Sentenced, Plague and Holy keep their signature cadences (bow 0.57 s, bow 0.28 s, wand 0.64 s against 0.63 s). Plague's sword and axe got faster (0.50 s to 0.25 s and 0.39 s), because v2's 0.5 s animation floors are gone. Plague's sword (0.2514 s) sits just above its 0.25 s floor, so any attack-speed buff on it turns into damage per hit at once.

Fire's backlash per enemy swing is 200 x enemy faction rate x the enemy's unbuffed interval (rule 2 below) = 200 / (1 + enemy weapon boost), fixed per weapon: 93 on sword, 103 bow, 121 wand, 125 shield, 143 axe. Attack-speed buffs on the enemy do not shrink it, so they raise backlash per second until the enemy's floor binds. Every signature bonus is multiplied by the attacker's dpsMult (rule 1). Bonus damage and Frost's chill start at first contact. Every pair of first-swing phases is swept, and a result is the share of phase pairs in which the intended winner wins ("win rate") and its worst HP left. Geometry, projectile flight time, knockback, stagger, roots, bow draw and the v3 animation timings are not modelled. Check: with a near-continuous weapon (a x300 speed boost with no floor, dt = 1 ms) the model matches `engine.duel` on all ten edges to within 0.1 points (0.02 at most). A flat backlash per swing would hand Fire runaway backlash against such a weapon, so the check needs rule 2.

### What the v2 plan got right and wrong

This subsection is v2 history and was not re-run for v3. It tested the weapon plan as first drawn: v2 stats and cadences (`max(anim floor, base cooldown x 0.86 / rate)`), Sentenced on the sword, shield dpsMult 0.60, weapon dpsMult on hits only, and a flat 210 backlash per enemy swing. Rules 1 to 3 below came out of it and are now part of the v3 model. Every number in this subsection is a v2 number.

Mirror fights (both fighters use the same weapon), plan as drawn. Cell is worst HP left across all phase pairs. Every cell is a 100% win except Holy > Sentenced on bow (23%) and shield (0%). Bold marks the problems: those two cells, and the Frost > Fire cells eroded by backlash.

| Edge (designed HP left, v2) | sword | axe | bow | wand | shield |
|---|---|---|---|---|---|
| Fire > Sentenced (78) | 89.1 | 80.0 | 86.2 | 81.1 | 76.3 |
| Fire > Plague (72) | 65.4 | 67.1 | 82.4 | 78.8 | 79.2 |
| Sentenced > Plague (56) | 56.0 | 58.1 | 60.2 | 59.2 | 63.8 |
| Sentenced > Frost (51) | 48.6 | 51.4 | 58.9 | 54.1 | 67.1 |
| Plague > Frost (40) | 39.6 | 43.6 | 48.7 | 44.7 | 59.9 |
| Plague > Holy (67) | 66.0 | 68.3 | 71.4 | 70.1 | 76.7 |
| Frost > Holy (63) | 62.1 | 61.2 | 62.4 | 62.0 | 62.4 |
| Frost > Fire (59) | **17.1** | 41.3 | **17.1** | 29.6 | **15.4** |
| Holy > Fire (68) | 36.0 | 52.1 | 28.7 | 37.5 | 28.1 |
| Holy > Sentenced (27) | 26.4 | 15.9 | **0.0 (23% win)** | 6.8 | **0.0 (0% win)** |

Mixed weapons (25 weapon pairs per edge): every edge holds at 60% or better in all 25 pairs except Holy > Sentenced, which holds in 15.

Two causes:

1. Weapon dpsMult scales only the hit. Sentenced's output is about 98% mark (its hits are 2.7-4.5 DPS), so Holy's weapon discount is paid in full while Sentenced's is not. Holy needs dpsMult of at least about 0.80 (0.795 to 0.803 depending on cadence). This is the same cliff as the continuous engine, where Holy's hit falling 20% flips the edge. The bow at 0.80 sits on it and the shield at 0.60 is far below it. The axe (16% left) and wand (7%) hold with almost no margin.
2. Fire's backlash is a flat 210 per enemy swing in the plan. Identity cadences swing more often than the faction rate, so the designed backlash is inflated by the enemy's weapon: sword 2.33x, bow 1.94x, wand 1.66x, shield 1.45x, axe 1.29x. Where the enemy's cadence is clamped at the v2 anim floor the figure is different (Sentenced 2.22x and Holy 2.11x on sword, Plague 1.08x on sword and axe). Frost > Fire drops to 15-17% on the sword, bow and shield mirrors (designed 59%), and Holy > Fire to 28-37%. Neither flips, but the signature pairing Frost(shield) vs Fire(axe) keeps only 9.1% worst HP and flips if Fire has 16% more HP.

### Rules that keep the cycle

Rules 1 to 3 are built into the v3 model and into `docs/GAME_DESIGN.md`; every table after this one assumes them.

| # | Rule | Evidence |
|---|---|---|
| 1 | Multiply every signature bonus (burn, backlash, disease, execute, mark) by the attacker's weapon dpsMult. | Fixes the Holy > Sentenced mirror failures. Mixed-weapon failures on that edge drop from 10 of 25 pairs to 5 (v2 plan, shield 0.60: Holy shield against any non-shield weapon, Holy bow against Sentenced sword; the v3 model with the shield at 0.60 gives the same five). |
| 2 | Per enemy swing, backlash = 200 x enemy faction rate x enemy unbuffed interval = 200 / (1 + enemy weapon boost), fixed per weapon: 93 on sword, 143 axe, 103 bow, 121 wand, 125 shield. (v2, at 210 and the old cadences: 90, 163, 108, 126, 144, and 194 for Plague on sword or axe.) | In the v3 mirrors Frost > Fire keeps 43-48% and Holy > Fire 68-69% (v2 with this rule: 51-54% and 64-67%; v2 plan with the flat 210: 15-41% (15-17% on the sword, bow and shield mirrors) and 28-52%). |
| 3 | Shield dpsMult 0.60 to 0.75. Start Sentenced with the bow (or Holy with the sword). | Signature Frost(shield) vs Holy(wand) goes from 102 s with 36% worst HP (v2 plan) to 73 s with 55% (v3). Signature Holy(wand) vs Sentenced goes from 6.4% worst HP with Sentenced on the sword (v2 plan) to 30.4% with the bow (v3). Raising the wand to 0.95 also fixed that pair in v2 (21%) but breaks a kiting limit (below). |
| 4 | Ranged weapons: a short root on each shot (0.25 s bow, 0.30 s wand in this model), then 50% move speed until the next shot is ready. Frost's chill slows only inside melee reach. | Without a movement penalty, at equal 170 u/s a bow or wand user who backs away is never caught. Rooting only on the shot still leaves Fire and Frost kiters 7.1-11.3 s of free fire. With the 50% rule free fire is at most 4.1 s (bow) and 3.5 s (wand). |
| 5 | "Engaged" means the target is inside the bonus owner's own weapon range with line of sight, plus a 1.25 s linger. | If line of sight alone starts the bonus clock, Fire, Sentenced and Plague win all six of their edges from 420-480 u without swinging (tolerance over 90 s; v2 run, not repeated). |
| 6 | Buff caps from the table below. | Section 5, buffs. |
| 7 | Heal lockout 3 s, with Holy's lifesteal exempt. | Section 5, healing. |

Mirror fights in the v3 model (rules 1 and 2, shield 0.75), worst HP left. All 50 cells are 100% wins:

| Edge | sword | axe | bow | wand | shield |
|---|---|---|---|---|---|
| Fire > Sentenced | 71.2 | 66.4 | 65.0 | 68.9 | 62.1 |
| Fire > Plague | 66.8 | 66.4 | 69.5 | 69.3 | 68.5 |
| Sentenced > Plague | 55.9 | 57.8 | 60.1 | 59.3 | 61.5 |
| Sentenced > Frost | 47.5 | 48.8 | 50.9 | 52.1 | 53.3 |
| Plague > Frost | 39.7 | 37.5 | 39.4 | 38.8 | 39.2 |
| Plague > Holy | 66.7 | 66.6 | 67.1 | 66.5 | 66.5 |
| Frost > Holy | 62.0 | 61.8 | 62.7 | 62.7 | 61.7 |
| Frost > Fire | 47.6 | 42.6 | 45.1 | 45.3 | 47.2 |
| Holy > Fire | 68.2 | 68.5 | 68.9 | 68.5 | 68.1 |
| Holy > Sentenced | 26.3 | 25.1 | 23.8 | 25.0 | 23.8 |

Against v2 under the same rules, Frost > Fire fell from 51-54% to 43-48% (Frost's faster swings feed the backlash), Holy > Fire rose from 64-67% to 68-69%, and the Fire > Sentenced axe mirror and the Sentenced > Frost wand and shield mirrors gained 3-6 points. No other cell moved more than 3 points.

Mixed weapons in the v3 model: every edge holds at 60% or better in all 25 pairs except Holy > Sentenced, which fails in two (Holy bow against Sentenced sword wins 27% of phase pairs; Holy shield against Sentenced sword, 0%; v2: 6% and 0%). With the shield left at 0.60 Holy > Sentenced fails in five, and Plague > Frost fails one (Plague shield against Frost sword, 22%). Both remaining failures involve a Sentenced sword, which is one reason rule 3 also moves Sentenced's starting weapon.

### Signature-weapon openings

Signature weapons: Fire axe, Sentenced bow, Plague bow, Frost shield, Holy wand. Both fighters in range and trading. "Flip x" is the multiplier on the loser's total damage (hits and bonus) that makes the intended winner win less than half the phase pairs; it shows how far the faction loop favours the winner before weapon counters. Every pair is a 100% win for the intended winner in both versions. The v2 columns use the same rules and starting weapons.

| Pair | v2: worst HP left / fight time | v3: worst HP left / fight time | Flip x, v2 | Flip x, v3 |
|---|---|---|---|---|
| Fire(axe) > Sentenced(bow) | 65.0 / 4.0 s | 72.5 / 4.2 s | 4.78 | 4.52 |
| Fire(axe) > Plague(bow) | 70.2 / 2.2 s | 72.4 / 2.5 s | 2.67 | 2.35 |
| Sentenced(bow) > Plague(bow) | 60.6 / 8.4 s | 60.1 / 8.4 s | 1.54 | 1.54 |
| Sentenced(bow) > Frost(shield) | 53.7 / 19.8 s | 53.3 / 19.8 s | 2.16 | 2.29 |
| Plague(bow) > Frost(shield) | 41.5 / 46.4 s | 42.6 / 46.4 s | 1.79 | 1.80 |
| Plague(bow) > Holy(wand) | 64.5 / 20.2 s | 64.3 / 20.2 s | 2.10 | 2.08 |
| Frost(shield) > Holy(wand) | 55.3 / 72.3 s | 55.0 / 73.0 s | 1.62 | 1.62 |
| Frost(shield) > Fire(axe) | 47.3 / 17.2 s | **34.3** / 17.4 s | 1.92 | **1.59** |
| Holy(wand) > Fire(axe) | 62.9 / 9.9 s | 65.5 / 9.3 s | 2.38 | 2.60 |
| Holy(wand) > Sentenced(bow) | 29.2 / 27.0 s | 30.4 / 26.6 s | 1.32 | 1.34 |

On stats alone the loop always picks the intended winner. Fire > Sentenced is lopsided (4.5x). The thinnest are Holy > Sentenced (1.34x), Sentenced > Plague (1.54x), Frost > Fire (1.59x) and Frost > Holy (1.62x); none is near the v2 plan's 1.06x for Holy against a Sentenced sword. Frost > Fire is the one that v3 moved: it keeps 34% worst HP instead of 47%, and a 1.59x damage edge instead of 1.92x.

### Kiting

*These are the v3 numbers at duel pace k = 1, with the old weapon table. The 9.1 weapon tuning (testing/TUNING_9_1.md) re-ran the check at k = 2 and changed the ranges, the damage multipliers and the ranged movement penalties; read this section as history.*

Free fire is the time a ranged fighter shoots before a melee chaser reaches 60 u (both move at 170 u/s). One approach with the shooter standing still gives (480 - 60) / 170 = 2.47 s for the bow and (420 - 60) / 170 = 2.12 s for the wand. Backing away while firing is the problem:

| Kiter | Standing, bow / wand | Rule A: root 0.25 s (bow) or 0.30 s (wand) per shot only | Rule B: root, then 50% speed until the next shot is ready |
|---|---|---|---|
| Frost | 2.47 / 2.12 | 11.26 / 9.51 s | 4.05 / 3.46 s |
| Fire | 2.47 / 2.12 | 8.45 / 7.13 s | 3.82 / 3.27 s |
| Sentenced | 2.47 / 2.12 | 5.63 / 4.75 s | 3.43 / 2.93 s |
| Holy | 2.47 / 2.12 | 5.33 / 4.50 s | 3.38 / 2.88 s |
| Plague | 2.47 / 2.12 | 2.74 / 2.31 s | 2.60 / 2.21 s |

v2's Fire and Frost kiters had 17.0 / 14.2 s under rule A and 4.31 / 3.69 s under rule B, because they fired less often (v2: a bow shot every 1.72 s and a wand shot every 2.01 s for both; v3: Fire every 0.85 s and 1.01 s, Frost every 1.14 s and 1.35 s). If Frost's chill slows a chaser at range, a Frost kiter stands for 6.18 / 5.29 s and under rule A is never caught. Without any movement penalty, a bow or wand user who backs away at equal speed is never caught.

"Tolerance" is the number of seconds of the loser's full unanswered output (hits plus bonus, mark clock running) the winner can absorb before it falls below a 50% win rate. Mirror-weapon tolerance is 16.9 s or more on every edge except four: Fire > Sentenced 4.00-4.24 s, Fire > Plague 2.20-2.94 s, Sentenced > Plague 2.83-5.03 s and Holy > Sentenced 6.90-8.24 s. Frost > Fire, the fifth short edge under the v2 plan (7.93-18.19 s), is now 16.90-22.70 s (v2 under the same rules: 19.60-26.35 s; Frost's faster swings feed the backlash, so v3 costs this edge about 3-4 s of tolerance). Ranged loser against a melee winner, worst case over sword, axe and shield, v3 model:

| Edge | Tolerance, bow / wand loser | Stolen on one approach? | Stolen under rule A? | Max dpsMult that keeps the edge, bow / wand |
|---|---|---|---|---|
| Fire > Sentenced | 3.89 / 3.45 s | no | yes: the bow against any Fire weapon, the wand against axe or shield Fire | 1.11 / 1.17 |
| Fire > Plague | 2.79 / 2.33 s | no | no, but only just (2.74 / 2.31 s of free fire) | 0.846 / 0.878 |
| Sentenced > Plague | 4.17 / 3.43 s | no | no | 0.92 / 0.95 |
| Sentenced > Frost | 20.8 / 19.0 s | no | only if Frost's chill slows the chaser at range | 1.22 / 1.31 |
| Plague > Frost | 27.4 / 22.6 s | no | only if Frost's chill slows the chaser at range | 1.11 / 1.12 |
| Plague > Holy | 39.2 / 35.2 s | no | no | 1.58 / 1.59 |
| Frost > Holy | 42.3 / 37.4 s | no | no | 1.34 / 1.35 |
| Frost > Fire | 19.3 / 16.7 s | no | no (v2 plan: yes, against sword or shield Frost) | 1.31 / 1.33 |
| Holy > Fire | 53.6 / 49.2 s | no | no | 1.89 / 1.91 |
| Holy > Sentenced | 5.65 / 3.30 s (against shield Holy) | no | the wand against shield Holy; the bow against shield Holy is level (5.63 s against 5.65 s) | 0.870 / 0.878 |

Every limit in the last column is set by a shield-wielding winner, the melee weapon with the lowest dpsMult.

Recommended ranged dpsMult:

- With the shooter standing still, the ceilings are 0.846 for the bow and 0.878 for the wand (bow about 0.84 and wand about 0.87 keep every edge after one approach). The binding cells are Fire(shield) > Plague and Holy(shield) > Sentenced; against sword and axe winners every limit is 0.90 or higher. Today's 0.80 and 0.85 sit under both (v2 under the same rules: 0.82 and 0.87).
- Under rule A, Fire > Sentenced needs Sentenced's bow at 0.60 or less (wand 0.66, both against shield Fire), and Holy(shield) > Sentenced needs the bow at 0.80 and the wand at 0.82, so the wand is stolen at today's 0.85. Frost > Fire is no longer at risk: Fire's faster cadence gives a Fire kiter only 8.45 / 7.13 s of free fire against 16.7 s or more of tolerance. This is why rule 4 in the table above is written as rule B (50% speed), not rule A.
- Under rule B nothing is stolen at base speed. The tightest case is Fire(shield) > Plague: 2.60 s of free fire against 2.79 s of tolerance with the bow, 2.21 s against 2.33 s with the wand. At base speed those cells hold in 93% and 84% of swing-phase pairs (v2 bow cell: 68-81%).
- A kiter backing away under rule B gets more free fire than a shooter standing still, which lowers the ceilings to about 0.82 for the bow (Fire(shield) > Plague, 2.60 s) and 0.86 for the wand (Holy(shield) > Sentenced, 2.93 s). Keep the bow at 0.80 and the wand at 0.85. Both sit just under the ceiling, so treat them as maximums, not starting points with headroom. A wand at 0.95 would let a Plague wand beat a Fire shield on one approach (1.74 s tolerance against 2.12 s of free fire).

### Buff caps

Assumed drops: +10% max HP, +10% attack speed, +8% move speed. The cell is the smallest multiplier on the loser that flips an edge (below 50% win rate), over every mirror weapon and the signature pairings. Attack speed past a weapon's floor turns into damage per hit.

| Stat | On the v2 plan numbers (not re-run) | v3 model (rules 1-3 built in) | Cap I would set |
|---|---|---|---|
| Max HP | Holy > Sentenced is already flipped on bow and shield and flips at x1.07 on wand and signature (axe x1.16). No cap is safe. | 1.31 (Holy > Sentenced; axe, bow and shield mirrors); Holy > Sentenced 1.32-1.44 elsewhere; Frost > Fire signature 1.59 (v2 1.97); Plague > Frost 1.65-1.79 | +20% (two drops) |
| Attack speed | 1.30 (Frost > Holy, signature); 1.63 (Frost > Fire, signature) | 1.63 (Frost > Holy, signature); 1.65 (Plague > Frost, wand mirror); 1.90 (Sentenced > Plague, sword mirror); Sentenced > Frost 2.03 or more; Frost > Fire 3.34 (signature) | +30% (three drops) |
| Move speed | Rule A: Frost > Fire and Holy > Sentenced are already stolen at base speed. Rule B: 1.36 (Frost > Fire, bow), 1.43 (Holy axe > Sentenced bow), 1.91 (Fire > Sentenced, bow) | Not re-run for v3. v2 with rules 1-3: 1.18 (Holy(shield) > Sentenced(wand)); Fire(shield) > Plague(bow) model-sensitive (1.22 here, about 1.7 in the verifier's model; the real headroom is 0.03-0.1 s of free fire, not 22%); 1.38 and 1.48 (Fire(shield) > Sentenced, bow and wand); all others 1.95 or more. The v3 base kiting check (one approach, shooter standing) has 0 stolen cells. Valid only with rule 4. | +16% (two drops) |

- Stacked on the loser in the v3 model: HP x1.2 with attack speed x1.2 or x1.3 holds every edge at 60% or better. HP x1.3 with attack speed x1.2 fails the Holy > Sentenced bow and shield mirrors (45% and 52%). HP x1.3 with attack speed x1.3 fails Plague > Frost on every mirror weapon (0-13%) and Holy > Sentenced on the bow and shield mirrors.
- On the v2 plan numbers, HP x1.2 with attack speed x1.2 already failed Frost > Holy (signature), Frost > Fire (shield mirror and signature) and Holy > Sentenced (five settings).
- Floors bind only under attack-speed buffs. Plague reaches them first: its sword (0.2514 s) sits just above the 0.25 s floor, and its other weapons reach theirs within +9% to +13%. Holy has +96% or more of headroom, Sentenced +107%, Fire +210% and Frost +313%. Because attack speed past the floor turns into damage per hit, a buff is worth its full DPS on every weapon.
- Attack speed on Fire's opponent raises the backlash Fire takes until the floor binds. Fire > Sentenced never flips on attack speed. Fire > Plague flips only at x3.65 or more, far past every Plague floor, where extra speed adds damage per hit but no extra swings to feed the backlash.
- Plague > Frost has the same threshold for HP and attack speed (1.65-1.79, setting by setting). Plague's damage is absolute HP per second, so Frost's survival time scales linearly with its HP.

### Healing

The 3 s out-of-combat lockout never opens inside a duel. Longest stretch with no combat event, across every edge, 25 weapon pairs and all phase pairs, v3 model:

| What counts as combat | Longest gap | Where |
|---|---|---|
| Any damage dealt or taken (DoT ticks count) | 1.60 s | Frost(axe) against Holy(axe) |
| Damage taken only | 1.90 s | Frost against Holy(axe), whose 0.75 s interval Frost's chill stretches to 1.88 s |
| Weapon hits only | 1.60 s | Frost at axe cadence (1.59 s), against Sentenced, Holy or Fire |

- v2 read 2.05 s, 2.60 s and 2.60 s. Every v3 gap is under 2 s, so the lockout cannot open inside a duel; the margin is 1.1 s on the damage-taken reading and 1.4 s on hits only (v2: 0.4 s). The v2 run, in which 0 of about 30,000 heal opportunities fired with the lockout, was not repeated. The slowest chilled interval is Fire's axe against Frost (1.19 s / 0.4 = 2.98 s); it opens no gap only because Frost keeps swinging and Fire's burn keeps ticking. Keep chilled intervals under 3 s before slowing any weapon, or count DoT and linger ticks as combat.
- Holy's lifesteal must be exempt from the lockout. Blocking it flips Holy > Sentenced in all five mirrors; in the signature opening (Sentenced on the bow) Holy still wins about 58% of phase pairs (57.7% on the report's sub=2 sweep; 62% on the coarser 156-pair grid) but with 0.0% worst HP. Holy > Fire, Frost > Holy and Plague > Holy hold (49% worst HP or more).
- Without a lockout, one instant heal at 35% HP (v2 plan rules, not re-run): a loser-only medkit (60%) dropped 15 plan-rule setting-edges under 60% (Plague > Frost sword and axe; Frost > Fire sword, bow, wand, shield and signature; Holy > Fire bow and shield; Holy > Sentenced in all six). A loser-only bandage (25%) dropped Frost > Fire signature and Holy > Sentenced axe, wand, signature. When both fighters heal, nothing new fails.
- Disengage, wait out the 1.25 s linger plus the 3 s lockout, heal, re-engage (v2 run, not repeated). If both heal, the fixed rules keep every edge (the plan reproduces only the existing Holy > Sentenced failures). If only the loser heals, Sentenced > Plague flips even with a bandage, because the mark restarts at 0 at re-contact, and Holy > Sentenced flips too. These are item advantages plus the mark-reset weakness. Consider keeping the mark clock running, or decaying it, through breaks of up to about 5 s.

## 6. Sheet notes

### Statements the engine contradicts or only partly supports

Everything else numeric in the v3 sheet checked out: the section 2 stats and damage mixes, every figure in the section 3 cards (rows 3 to 5 below are wording issues, not number errors), all nine rows of section 4 (within 0.5), all twenty cells of the section 5 matrix, the section 6 table (lengths and HP left), the section 7 scaling claim and all thirteen rows of the knob table, including the two new rate rows (each matches the v3 re-measure).

| # | Where | The sheet says | The engine gives | Suggested wording |
|---|---|---|---|---|
| 1 | Section 7, tuning knobs | (adopted in v3) "No single +-25% change to any knob in this table flips an edge, so the design has slack. The core stats have one exception: Holy's hit or attack rate at -25% flips Holy > Sentenced." | Confirmed: across every core stat and parameter at +-25%, only Holy hit -25% and Holy rate -25% flip an edge (threshold -20.0%: hit 52, rate 0.76). | No change needed. |
| 2 | Section 8, verification | Robustness to random jitter "on every numeric field". | The test jitters HP, rate, hit, armor, shield and the signature numbers, but not the damage shares (phys and true). A separate run, re-drawn for v3, jittering each physical share by +-10 points holds the graph in 40 of 40 draws; +-15 points breaks Holy > Sentenced, and only that edge, in 6 of 40 (the same draws give the same result on v2). | "...on every numeric field except the damage shares" (or add shares to the test). |
| 3 | Section 3, Fire | Fire wins against Sentenced "before the mark... has built". | At 3.7 s the mark is at 131 of 275 (48%), and averages 66 raw per second over the fight. | "while the mark is under half strength". |
| 4 | Section 3, Plague | The Plague > Frost fight is "a fight the execute decides". | The execute is 42% of Plague's damage there, equal to the disease. Without the execute Plague loses by 3.3 points; without the disease it loses by 73.9. | "a fight the execute finishes". |
| 5 | Section 3, Frost | Slowing the mark and Plague's flat damage "achieves little". | True for the mark (cancels 1%, worth 0.5 points on Sentenced > Frost). Not for Plague: the slow cancels 19% of its potential damage (411 HP) and is worth 15.8 points on Plague > Frost. | "achieves nothing against the mark and about a sixth of the margin against Plague". |
| 6 | Section 1, rulebook | Six laws; rule 6 says a mechanic may read elapsed time, "Nothing else". | Fire's backlash reads the target's current attack rate (`foe_rate`). None of the six laws covers that. The audit passes because it only checks mechanic signatures. | Add a seventh law: "A mechanic may read the opponent's current attack rate (backlash)." |
| 7 | Section 2, stat table | Base DPS 90 / 4 / 37 / 40 / 62. | Exact values are 90 / 4.5 / 37 / 40.5 / 61.75. The sheet rounds half to even (4.5 and 40.5 down). | Show one decimal, or round half up (90 / 5 / 37 / 41 / 62). |
| 8 | Section 4, main/sub labels | Execute is "main", disease is "sub". | Disease moves margins 114 points, execute 43. | Call both main, or swap the labels. The pass rule is unaffected. |

### Design observations

- Fire's burn is cosmetic, as the sheet says, and here are the numbers. Burn is 2-7% of Fire's damage (4% in Fire > Sentenced, 2% in Fire > Plague, 7% in the Frost loss, 3% in the Holy loss). Removing it moves the biggest margin by 3.7 points. Options: raise it to about 40 and retune, or drop it, or give it another job.
- Sentenced's hit (5) and attack rate are nearly dead stats. Swings are 1-6% of its damage. The rate matters for one reason: it is what Fire's backlash feeds on (180 raw per second, 64% of Fire's damage in that fight). Halving it to 0.45 moves Fire > Sentenced from 77% HP left in 3.7 s to 51% in 5.5 s; 0.30 gives 32% in 6.6 s. The other nine edges move by at most one point (Sentenced > Frost 51 to 50, Holy > Sentenced 27 to 28). It is a clean lever if Fire's win over Sentenced is too easy.
- Frost's attack rate is now a live lever too, and v3 pulled it. Against v3 Fire, Frost's move from 0.3 to 0.45 alone takes Frost > Fire from 60% to 49%; Fire's own changes give about 1 point back. The knob table puts Frost's rate at 8 points of that edge per 25% at equal DPS, and it moves no other edge. Fire's own rate moves nothing in the engine (no mechanic reads it), so Fire's cadence can be tuned for feel freely.
- Fights are long, as the sheet notes. Median 14.5 s; Frost's four fights are 13.1, 16.6, 37.0 and 52.3 s. In the v3 weapon model the signature Frost > Holy fight runs about 73 s (v2 plan: 102 s). A 120 s cap would make the Frost > Holy edge stall under small drops of Frost damage (section 3).
- Holy's lifesteal has slack. Holy > Sentenced is a coin flip without it, but a flat 10% lifesteal (cap 0.10) already keeps the win. The numbers can move a long way before the edge changes, which the sheet's slider table also shows (ls1 and ls0 worth only 4 and 2 points).
- Holy > Sentenced is the one edge that is soft in four independent ways (Holy hit, Holy shield, Sentenced mark cap, Sentenced damage mix), and it is also the edge the v3 model still loses in two mixed-weapon pairs (a Sentenced sword against a Holy bow or shield). Under the v2 plan, widening it in the engine (shield 275 or 300, section 3) fixed the bow mirror and the signature pairing (14-21% worst HP) but did not replace weapon rule 1 or a shield dpsMult of at least about 0.75; that was not re-run for v3.
- Sentenced > Plague finishes 6.4 points above Plague's 50% execute line, which is why it is the second-softest edge. Cut Sentenced's HP by 14% (to 600) and the execute starts to open at the end of the fight, but the edge still holds (49% left); it flips at -27%.
- Plague's 200 armor only does work against Holy and Frost. Fire and Sentenced do 100% magic and Plague has no shield. If you want Plague to resist anything else, the shield is the stat to raise, but the room is small: Sentenced > Plague flips at Plague shield 78 and Fire > Plague at 107.
- The signature Frost(shield) > Holy(wand) fight runs about 73 s in the v3 model (102 s under the v2 plan). Any fight timer has to leave room for it.

Suggested order of changes, if you take any: (1) widen Holy > Sentenced (Holy shield 275); it is still the softest edge in v3. (2) Weapon rules 1 to 3, (3) a ranged movement penalty (half speed after each shot) and (5) the meaning of "engaged" are now in the v3 model or `docs/GAME_DESIGN.md`. (4) Caps of +20% HP and +30% attack speed still hold in v3; +16% move speed was not re-run. (6) If Frost > Fire needs room back, the knob table's direct levers on it are Frost's attack rate (8 points per 25% at equal DPS, no other edge) and Fire's backlash (8 points, but also 9 on Fire > Sentenced).
