# Counter Review: v2 faction cycle

Written for the author of `CLASS_SHEET.md`. It checks the v2 numbers in `classes.py` against `engine.py`, then checks how the cycle survives the move to a 20 Hz game with weapons.

Status when written: `python3 test_rpsls.py` prints ALL PASS (graph at four timesteps, scaling, jitter, purity audit, and the nine identity tests). The TypeScript port in `packages/shared` passes its 226 tests. Every engine number below was computed by script against the current engine at dt = 0.002 unless a different dt is named. The real-time numbers come from a separate 20 Hz simulation that I re-ran for this review; its output matched the figures quoted here.

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
| 1 | Fire > Sentenced | Burst vs ramp | Fire starts at 194 DPS and is done in 3.6 s, when the mark has reached 127 of its 275; Sentenced averages 30 DPS against Fire's 500 HP. | 3.6 s | 78% | 2.18 |
| 2 | Fire > Plague | Damage type vs defense | Plague has no shield, so Fire's magic lands at 100%, and Plague's 1.85 swings per second feed a 388-per-second backlash; 490 DPS removes 1000 HP in 2.0 s, before the execute can open. | 2.0 s | 72% | 2.15 |
| 3 | Sentenced > Plague | Damage type vs defense | The mark lands at 100% on a target with no shield and averages 135 DPS; Plague's mostly physical damage is cut to 53% by Sentenced's defenses and comes to 41 DPS. | 7.4 s | 56% | 1.38 |
| 4 | Sentenced > Frost | Rate vs flat | The mark is flat, so the slow cancels only 1% of Sentenced's potential damage; it averages 106 DPS against Frost's 21, and Frost's 1750 HP only stretches the fight to 16.6 s. | 16.6 s | 51% | 2.02 |
| 5 | Plague > Frost | Rate vs flat | 84% of Plague's damage is flat (disease 42%, execute 42%), so the slow trims only the 16% that is swings; the execute opens once Frost is under 50% and ends the fight at 37 s. | 37.0 s | 40% | 1.67 |
| 6 | Plague > Holy | Damage type vs defense | Plague's 80% physical share lands at 86% on Holy's zero armor (105 DPS average) while Holy's all-physical damage is cut to 33% by Plague's 200 armor (21 DPS); Holy's 250 shield is spent on a mostly physical attacker. | 15.8 s | 67% | 3.07 |
| 7 | Frost > Holy | Rate vs flat | Holy has no flat damage, so the slow removes 60% of its swings (969 of 1,615 HP) and the lifesteal that rides on them; Holy deals 12 DPS to Frost's 38. | 52.3 s | 63% | 2.71 |
| 8 | Frost > Fire | HP pool | 1750 HP against 500 decides it: with every signature stripped Frost still wins with 66% left, and at equal HP Fire wins; the slow and the starved backlash hold Fire to 55 DPS. | 13.1 s | 59% | 2.44 |
| 9 | Holy > Fire | Damage type vs defense | Holy's 250 shield cuts Fire's magic to 29% (86 DPS against 1450 HP) while Holy's physical damage lands at 100% on zero armor (62 DPS against 500 HP); with all armor and shield stripped Fire wins. | 8.1 s | 68% | 5.43 |
| 10 | Holy > Sentenced | HP pool and lifesteal | Holy's shield cuts the mark to 29%, so Sentenced deals 1,502 damage over 22.7 s, but lifesteal returns 447 HP of it and Holy's own 31 DPS finishes Sentenced's 700 HP; without lifesteal Holy loses by about 3 points. | 22.7 s | 27% | 1.35 |

What to take from it:

- All ten edges hold and every winner keeps at least 27% HP. The spread is wide: Fire's two wins keep 72-78% and finish in under 4 seconds; Holy over Sentenced keeps 27% after 22.7 seconds.
- Softest edge: Holy > Sentenced. Holy's hit or attack rate falling 20% (65 to 52 hit) flips it, and Sentenced needs only 1.29x damage. Hardest: Fire > Sentenced (Sentenced needs 4.59x damage) and Holy > Fire (Fire needs 5.43x HP). Section 3 has all ten.
- Fights are long. Median 14.5 s, mean 17.9 s. The four fights that involve Frost average 29.7 s; the other six average 10.0 s.
- Two signatures break ties instead of driving fights. Without Plague's execute, Plague loses to Frost by about 3 points. Without Holy's lifesteal, Holy loses to Sentenced by about 3 points. Fire's burn is cosmetic (at most 3.7 points of margin).
- In the 20 Hz game, the plan as drawn keeps 48 of 50 mirror-weapon cells. Both failures are Holy > Sentenced, and the cause is that weapon dpsMult scales hits but not signature bonus damage. Section 5 lists the rules that fix it.

## 2. Faction cards

Each table lists a faction's four matchups: DPS each way (open / avg), who has what HP left, and what the two signatures were doing in that fight. The "slow" entries give the share of the foe's potential damage (damage dealt plus damage the slow prevented) that the slow cancelled.

### Fire (500 HP, glass cannon)

| Matchup | Length | HP left | Fire DPS to foe (open / avg) | Foe DPS to Fire (open / avg) | Fire signature at work | Foe signature at work |
|---|---|---|---|---|---|---|
| **beats** Sentenced | 3.6 s | Fire 78% | 194 / 194 | 2 / 30 | backlash 65% + burn 3% of its damage | mark 93% of its damage |
| **beats** Plague | 2.0 s | Fire 72% | 490 / 490 | 68 / 68 | backlash 79% + burn 2% of its damage | disease 52% of its damage, execute never opens |
| **loses to** Frost | 13.1 s | Frost 59% | 55 / 55 | 38 / 38 | backlash 57% + burn 9% of its damage | slow cancels 33% of the foe's potential damage (359 HP) |
| **loses to** Holy | 8.1 s | Holy 68% | 86 / 86 | 62 / 62 | backlash 66% + burn 3% of its damage | lifesteal returns 232 HP (33% of damage taken) |

- Beats Sentenced and Plague because it deals 194 and 490 DPS from the first tick and both targets feed its backlash with their own swing rate: Sentenced's 0.9/s is 189 raw damage per second, Plague's 1.85/s is 388. Backlash is 65% and 79% of Fire's damage in those fights; burn is 3% and 2%.
- At 3.6 s, when Fire kills Sentenced, the mark is at 127 of its 275 cap (46%), which is why Sentenced averages 30 DPS. Plague never gets its execute: Fire ends the fight at 72% HP, above the 50% line.
- Loses to Frost because Frost starves the backlash (Frost swings 0.3/s, so 63 raw per second instead of 189-388) and cuts Fire's own swings from 0.3 to 0.12 per second. Fire's output falls to 55 DPS against a 1750 HP pool. Had Fire survived it would have needed 31.9 s to kill Frost; Frost needed 13.1 s to kill Fire (loser's TTK ratio 2.44).
- Loses to Holy because the 250 shield cuts Fire's magic to 29% (86 DPS against 1450 HP) while Holy's physical damage lands at 100% on Fire's zero armor. Below 40% HP Holy's lifesteal returns everything it deals, about 62 of Fire's 86 DPS, so Fire would have needed 44.0 s to kill Holy; Holy needed 8.1 s (ratio 5.43).

### Sentenced (700 HP, patient executioner)

| Matchup | Length | HP left | Sentenced DPS to foe (open / avg) | Foe DPS to Sentenced (open / avg) | Sentenced signature at work | Foe signature at work |
|---|---|---|---|---|---|---|
| **beats** Plague | 7.4 s | Sentenced 56% | 4 / 135 | 41 / 41 | mark 97% of its damage | disease 52% of its damage, execute never opens |
| **beats** Frost | 16.6 s | Sentenced 51% | 1 / 106 | 21 / 21 | mark 99% of its damage | slow cancels 1% of the foe's potential damage (22 HP) |
| **loses to** Fire | 3.6 s | Fire 78% | 2 / 30 | 194 / 194 | mark 93% of its damage | backlash 65% + burn 3% of its damage |
| **loses to** Holy | 22.7 s | Holy 27% | 1 / 66 | 31 / 31 | mark 98% of its damage | lifesteal returns 447 HP (30% of damage taken) |

- Beats Plague and Frost with the mark, which is 97% and 99% of its damage. Against Plague the mark lands at 100% and Plague's mostly physical damage is cut to 53% (41 DPS). Against Frost the slow cancels 1% of Sentenced's potential damage, so Frost's 1750 HP only stretches the fight to 16.6 s.
- Sentenced's own hit (5) and swing rate are close to dead stats: swings are 1-7% of its damage (7% against Fire, 1-3% elsewhere). The rate matters mainly as a backlash feed for Fire (section 6).
- Loses to Fire because 194 DPS arrives while the mark is at 46% strength. Loses to Holy because the 250 shield cuts the mark to 29% (66 DPS average against 1450 HP plus 447 HP of lifesteal) while Holy's 31 DPS finishes 700 HP. This is the closest loss: Sentenced needs only 1.35x as long.

### Plague (1000 HP, attrition swarm)

| Matchup | Length | HP left | Plague DPS to foe (open / avg) | Foe DPS to Plague (open / avg) | Plague signature at work | Foe signature at work |
|---|---|---|---|---|---|---|
| **beats** Frost | 37.0 s | Plague 40% | 27 / 47 | 16 / 16 | disease 42% + execute 42% of its damage | slow cancels 19% of the foe's potential damage (411 HP) |
| **beats** Holy | 15.8 s | Plague 67% | 66 / 105 | 21 / 21 | disease 33% + execute 37% of its damage | lifesteal returns 207 HP (12% of damage taken) |
| **loses to** Fire | 2.0 s | Fire 72% | 68 / 68 | 490 / 490 | disease 52% of its damage, execute never opens | backlash 79% + burn 2% of its damage |
| **loses to** Sentenced | 7.4 s | Sentenced 56% | 41 / 41 | 4 / 135 | disease 52% of its damage, execute never opens | mark 97% of its damage |

- Beats Frost on flat damage: 84% of its damage is disease (42%) and execute (42%), and the slow trims only the 16% that is swings. It averages 47 DPS against Frost's 16 and wins in 37 s.
- Beats Holy because Holy has no armor: Plague's 80% physical share lands at 86% (105 avg DPS), while Holy's all-physical damage is cut to 33% by Plague's 200 armor (21 DPS). Holy's lifesteal returns 207 HP, 12% of what it takes.
- Loses to Fire and Sentenced, which both deal 100% magic. Plague has no shield, so their damage lands at 100%, and its 200 armor is wasted. In both fights the execute never opens, because Plague's execute reads the foe's HP and the foe finishes above 50% (72% and 56%).
- Plague's armor only works against the two physical attackers, Holy (0.33) and Frost (0.40). Those are exactly the two edges it wins.

### Frost (1750 HP, control bruiser)

| Matchup | Length | HP left | Frost DPS to foe (open / avg) | Foe DPS to Frost (open / avg) | Frost signature at work | Foe signature at work |
|---|---|---|---|---|---|---|
| **beats** Holy | 52.3 s | Frost 63% | 38 / 38 | 12 / 12 | slow cancels 60% of the foe's potential damage (969 HP) | lifesteal returns 517 HP (26% of damage taken) |
| **beats** Fire | 13.1 s | Frost 59% | 38 / 38 | 55 / 55 | slow cancels 33% of the foe's potential damage (359 HP) | backlash 57% + burn 9% of its damage |
| **loses to** Sentenced | 16.6 s | Sentenced 51% | 21 / 21 | 1 / 106 | slow cancels 1% of the foe's potential damage (22 HP) | mark 99% of its damage |
| **loses to** Plague | 37.0 s | Plague 40% | 16 / 16 | 27 / 47 | slow cancels 19% of the foe's potential damage (411 HP) | disease 42% + execute 42% of its damage |

- Beats Holy because Holy has no flat damage: the slow removes 969 of Holy's 1615 potential HP of damage (60%) and the lifesteal that rides on it. Holy deals 12 DPS to Frost's 38, and the fight lasts 52.3 s, the longest in the system.
- Beats Fire mostly on HP pool. With every signature stripped from both, Frost still wins with 66% left. With signatures on but both at 1000 HP, Fire wins with 30% left. The slow (359 HP of Fire's damage cancelled) and the starved backlash widen the gap Frost already has.
- Loses to Sentenced and Plague because the slow has almost nothing to grab. The slow cancels 1% of Sentenced's potential damage and 19% of Plague's (411 HP). Against Plague that is still worth 15.8 points of margin, so "slowing them achieves little" is true of the mark but not of Plague.
- Frost's own damage has no signature part at all, so its "signature share of the kill" is only the cancelled damage in the table.

### Holy (1450 HP, sustain juggernaut)

| Matchup | Length | HP left | Holy DPS to foe (open / avg) | Foe DPS to Holy (open / avg) | Holy signature at work | Foe signature at work |
|---|---|---|---|---|---|---|
| **beats** Fire | 8.1 s | Holy 68% | 62 / 62 | 86 / 86 | lifesteal returns 232 HP (33% of damage taken) | backlash 66% + burn 3% of its damage |
| **beats** Sentenced | 22.7 s | Holy 27% | 31 / 31 | 1 / 66 | lifesteal returns 447 HP (30% of damage taken) | mark 98% of its damage |
| **loses to** Plague | 15.8 s | Plague 67% | 21 / 21 | 66 / 105 | lifesteal returns 207 HP (12% of damage taken) | disease 33% + execute 37% of its damage |
| **loses to** Frost | 52.3 s | Frost 63% | 12 / 12 | 38 / 38 | lifesteal returns 517 HP (26% of damage taken) | slow cancels 60% of the foe's potential damage (969 HP) |

- Beats Fire: the shield cuts Fire to 29% while Holy's physical damage lands at 100% on zero armor (62 DPS against 500 HP). Lifesteal returns 232 HP, but removing it does not flip this edge (Holy keeps 52% instead of 68%).
- Beats Sentenced: lifesteal returns 447 HP, 30% of the 1502 damage Sentenced deals. Without it Holy loses by about 3 points. Lifesteal here is a threshold, not a slider: a cap of only 10% still wins (1.2% left); a cap of 50% leaves 17%; the designed 100% leaves 27%.
- Loses to Plague because zero armor lets 86% through while Holy's own damage is cut to 33%. Loses to Frost because every point of Holy's damage and healing is paid per swing, and the slow takes 60% of the swings (lifesteal returns 517 HP, 26% of what it takes, but Frost's 38 DPS outruns it).

## 3. Margins

One stat of one fighter is changed at a time, and the smallest relative change that stops the required winner from winning is found by bisection on the engine. Stats tried: HP, attack rate, hit, armor, shield, and every signature number, on both fighters. "Loser needs" scales only the loser: HP x multiplies max HP; damage x multiplies its hit and every flat bonus (burn, backlash, disease, execute, mark ramp and cap). "Winner's damage can fall to" is the same scaling on the winner. Rows run softest first.

| Rank | Edge | HP left | Smallest single-stat change that flips it | Loser needs: HP x | Loser needs: damage x | Winner's damage can fall to |
|---|---|---|---|---|---|---|
| 1 | Holy > Sentenced | 27% | Holy hit or attack rate -20.0% (hit 65 to 52) | 1.35x | 1.29x | 0.80x |
| 2 | Sentenced > Plague | 56% | Sentenced HP -27.3% (700 to 509) | 1.78x | 1.38x | 0.56x |
| 3 | Plague > Frost | 40% | Plague HP -40.0% (1000 to 600), or Frost hit, rate or HP +66.7% | 1.67x | 1.67x | 0.60x |
| 4 | Frost > Holy | 63% | Frost hit or attack rate -40.7% (hit 135 to 80; the fight passes 120 s, Holy wins at -45.4%) | 2.29x (fight passes 120 s); Holy wins at 2.71x | 1.83x | 0.59x |
| 5 | Sentenced > Frost | 51% | Sentenced HP -50.5% (700 to 346) | 2.34x | 2.02x | 0.43x |
| 6 | Fire > Plague | 72% | Fire HP -53.5% (500 to 233) | 2.15x | 2.15x | 0.47x |
| 7 | Frost > Fire | 59% | Frost hit or HP -59.1% (hit 135 to 55, or HP 1750 to 716) | 2.44x | 2.44x | 0.41x |
| 8 | Holy > Fire | 68% | Holy hit -62.3% (hit 65 to 24.5) | 5.43x | 2.65x | 0.38x |
| 9 | Plague > Holy | 67% | Plague HP -67.4% (1000 to 326) | 3.07x | 2.23x | 0.45x |
| 10 | Fire > Sentenced | 78% | Fire HP -78.2% (500 to 109) | 2.18x | 4.59x | 0.46x |

Notes on the table:

- The two multipliers differ where the winner's pressure ramps. The mark grows with time, so extra HP on the loser also buys more mark. That is why Sentenced > Plague needs 1.78x HP but only 1.38x damage. Where the winner's damage is steady, the loser's HP multiplier equals its TTK ratio from section 1.
- Frost > Holy stalls before it flips. At Frost hit -40.7% (hit 80) the fight runs past 120 s and Frost still wins at about 121 s; Holy actually wins at -45.4% (hit 74), or at Holy HP x2.71, or when the slow drops below 0.27 (from 0.60). The table shows the 120 s version because that is what the test suite measures.
- The ten edges fall into three groups by slack. Soft: Holy > Sentenced, Sentenced > Plague, Plague > Frost, Frost > Holy (flip at 20-41% on one stat, loser needs 1.3-1.8x damage). Middle: Sentenced > Frost, Fire > Plague, Frost > Fire (50-59%). Hard: Holy > Fire, Plague > Holy, Fire > Sentenced (62-78%).
- Fire > Sentenced is hard against extra damage (4.59x) but needs only 2.18x HP. Sentenced's best lever against Fire is HP (700 to 1,528): it needs about 7.9 s to kill Fire's 500 HP, and Fire's burst does not depend on time.
- The four soft edges are the ones that hang on a threshold mechanic: Holy's lifesteal (Holy > Sentenced), Plague's 50% execute line (Sentenced > Plague, Plague > Frost) and the slow against Holy's per-swing healing (Frost > Holy).

Detail on the three softest:

- Holy > Sentenced has several independent weak points. Holy hit 55 holds with 7.6% left and 50 flips; Holy attack rate 0.80 holds with 7.0% left and 0.75 flips. Holy shield 175 holds with 1.9% left and 150 flips (-31.7% is the threshold). Sentenced mark cap 375 holds with 2.2% left and 400 flips. Moving 10 points of Sentenced's damage to physical holds (4.1% left); 20 points flips (threshold 11.7 points). Sentenced armor 125 holds (13.8%), 150 flips.
- Sentenced > Plague finishes 6.4 points above the 50% line where Plague's execute opens. Sentenced HP 550 holds with 37.5% left and 500 flips; the threshold is HP 509 (-27.3%).
- Plague > Frost sits exactly on grid points: Plague HP 600 wins with 0.0% left and Frost hit 225 wins with 0.0% left. One step further (Plague HP 550, Frost hit 230) flips it.

Ways to widen Holy > Sentenced without breaking another edge (all keep the full ten-edge graph; checked on the engine):

| Change | Holy > Sentenced HP left | Sentenced damage needed to flip | Holy hit drop that flips |
|---|---|---|---|
| v2 as written (shield 250) | 27.1% | 1.29x | -20.0% |
| Holy shield 275 | 32.9% | 1.39x | -24.7% |
| Holy shield 300 | 37.8% | 1.48x | -29.0% |
| Sentenced mark cap 250 | 33.7% | 1.40x | -25.7% |
| Holy HP 1550 | 31.1% | 1.36x | -23.4% |

Side effects on the other edges: shield 275 touches only Holy > Fire (68% to 71%). Mark cap 250 lowers Sentenced > Frost from 51% to 48%. HP 1550 lowers Plague > Holy from 67% to 65% and Frost > Holy from 63% to 61%. The shield change is the cleanest.

## 4. Identity tests

Rule from the sheet: a main signature must flip at least one of the owner's four edges and move a margin by 20 points or more; a sub-mechanic must flip an edge or move a margin by 15 points or more. Margins below are at dt = 0.002; `test_rpsls.py` (dt = 0.005) prints the same shifts within 0.1.

| Owner | Removed | Kind | Edges that flip (margin before to after) | Largest shift | Sheet |
|---|---|---|---|---|---|
| Fire | burn and backlash | main | Fire > Sentenced 78.2 to -31.2; Fire > Plague 72.0 to -59.9 | 131.9 | 132 |
| Fire | backlash only | sub | Fire > Sentenced 78.2 to -23.7; Fire > Plague 72.0 to -55.5 | 127.5 | 127 |
| Sentenced | the mark | main | Sentenced > Plague 56.4 to -95.4; Sentenced > Frost 50.5 to -98.3 | 151.8 | 152 |
| Sentenced | the ramp (mark at full strength from t=0) | sub | none (largest mover Fire > Sentenced, 78.2 to 10.2) | 68.0 | 68 |
| Plague | the execute | main | Plague > Frost 40.0 to -3.3 | 43.4 | 43 |
| Plague | the flat disease | sub | Plague > Frost 40.0 to -73.9 | 113.9 | 114 |
| Frost | the slow | main | Frost > Holy 63.1 to -39.7 | 102.8 | 103 |
| Holy | lifesteal | main | Holy > Sentenced 27.1 to -2.9 | 30.0 | 30 |
| Holy | the missing-health scaling (flat 25% lifesteal) | sub | none (largest mover Holy > Sentenced, 27.1 to 8.3) | 18.7 | 19 |

Findings:

- All nine rows reproduce the sheet within 0.5 point, with identical flipped-edge sets, and pass the sheet's main/sub rule. The TypeScript port runs the same nine tests and measures the same shifts (131.9, 127.5, 151.8, 68.0, 43.4, 113.9, 102.8, 30.0, 18.7).
- Three sizes of effect. Fire's pair and Sentenced's mark reverse their edges by 100+ points: the owner goes from winning to being destroyed. Plague's disease and Frost's slow are next (about 100). Plague's execute and Holy's lifesteal are different: without the execute Plague loses Plague > Frost by only 3.3 points, and without lifesteal Holy loses Holy > Sentenced by only 2.9. Those two edges become coin flips rather than reversals. The two mechanics decide the finish; they do not drive the fight.
- Plague's labels are reversed in effect. The execute is labelled main and moves margins 43 points; the flat disease is labelled sub and moves them 114. On Plague > Holy it is 27.6 against 51.3. Both halves matter, which the sheet says, but disease is the bigger half.
- Fire's burn on its own fails the sheet's own bar. Removing only the burn moves the largest margin by 3.7 points and flips nothing (the bar for a sub-mechanic is a flip or 15 points). Measured as the sheet defines it (margin with burn minus margin with burn removed), burn reaches 15 points of shift at about 40 per second, four times today's 10.
- Sentenced's ramp is the thing Fire exploits. With the mark at full strength from t=0, no edge flips, but Fire > Sentenced drops from 78% to 10%. The 7.9 s build-up is worth 68 points of margin on that one edge.
- Frost's slow matters in one edge outright (Frost > Holy flips by 103 points) and partly in two: Frost > Fire loses 20.5 points without it, and Plague > Frost moves 15.8 points in Plague's favour. Against Sentenced it is worth 0.5 points.

## 5. In the game (real time)

### The model

A 20 Hz discrete duel that keeps the engine's damage laws exactly (mitigation, shares, the five mechanics, Frost's slow as a multiplier on the opponent's cooldown progress). Weapons replace continuous attacks. The plan simulated:

| Weapon | Base cooldown | Anim floor | dpsMult | Range |
|---|---|---|---|---|
| sword | 0.50 | 0.50 | 1.00 | 60 |
| axe | 0.90 | 0.50 | 0.90 | 60 |
| bow | 0.60 | 0.25 | 0.80 | 480 |
| wand | 0.70 | 0.30 | 0.85 | 420 |
| shield | 0.80 | 0.30 | 0.60 | 60 |

A fighter's swing cooldown is `max(floor, base x 0.86 / faction rate)`, where 0.86 is the mean of the five faction rates. Damage per hit is `rate x hit x cooldown x dpsMult`, so continuous DPS times dpsMult is preserved. Resulting cooldowns in seconds (* means clamped to the anim floor):

| Faction (rate) | sword | axe | bow | wand | shield |
|---|---|---|---|---|---|
| Fire, Frost (0.30) | 1.43 | 2.58 | 1.72 | 2.01 | 2.29 |
| Sentenced (0.90) | 0.50* | 0.86 | 0.57 | 0.67 | 0.76 |
| Plague (1.85) | 0.50* | 0.50* | 0.28 | 0.33 | 0.37 |
| Holy (0.95) | 0.50* | 0.81 | 0.54 | 0.63 | 0.72 |

Bonus damage and Frost's chill start at first contact. Every pair of first-swing phases is swept, and a result is the share of phase pairs in which the intended winner wins ("win rate") and its worst HP left. Geometry, projectile flight time and knockback are not modelled. Check: with a near-continuous weapon (3 ms cooldown, dt = 1 ms) and Fire's backlash scaled per enemy swing by the enemy's cooldown (rule 2), the model matches `engine.duel` on all ten edges to within 0.1 points. With the plan's flat 210 per swing, a near-continuous enemy weapon would hand Fire runaway backlash, so the check needs rule 2.

### What the plan gets right and wrong

Mirror fights (both fighters use the same weapon), plan as drawn. Cell is worst HP left across all phase pairs. Every cell is a 100% win except Holy > Sentenced on bow (23%) and shield (0%). Bold marks the problems: those two cells, and the Frost > Fire cells eroded by backlash.

| Edge (designed HP left) | sword | axe | bow | wand | shield |
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
2. Fire's backlash is a flat 210 per enemy swing in the plan. Identity cadences swing more often than the faction rate, so the designed backlash is inflated by the enemy's weapon: sword 2.33x, bow 1.94x, wand 1.66x, shield 1.45x, axe 1.29x. Where the enemy's cadence is clamped at the anim floor the figure is different (Sentenced 2.22x and Holy 2.11x on sword, Plague 1.08x on sword and axe). Frost > Fire drops to 15-17% on the sword, bow and shield mirrors (designed 59%), and Holy > Fire to 28-37%. Neither flips, but the signature pairing Frost(shield) vs Fire(axe) keeps only 9.1% worst HP and flips if Fire has 16% more HP.

### Rules that keep the cycle

| # | Rule | Evidence |
|---|---|---|
| 1 | Multiply every signature bonus (burn, backlash, disease, execute, mark) by the attacker's weapon dpsMult. | Fixes the Holy > Sentenced mirror failures. Mixed-weapon failures on that edge drop from 10 of 25 pairs to 5 (Holy shield against any non-shield weapon, Holy bow against Sentenced sword). |
| 2 | Per enemy swing, backlash = 210 x enemy faction rate x enemy cooldown. That is 90 on sword, 163 axe, 108 bow, 126 wand, 144 shield, and 194 for Plague on sword or axe. | Restores Frost > Fire to 51-54% and Holy > Fire to 64-67% in the mirrors. |
| 3 | Shield dpsMult 0.60 to 0.75. Start Sentenced with the bow (or Holy with the sword). | Signature Frost(shield) vs Holy(wand) goes from 102 s with 36% worst HP to 72 s with 55%. Signature Holy(wand) vs Sentenced goes from 6.4% worst HP to 29.2% with the bow. Raising the wand to 0.95 also fixes that pair (21%) but breaks a kiting limit (below). |
| 4 | Ranged weapons: no movement during the anim floor, then 50% move speed until the cooldown ends. Frost's chill slows only inside melee reach. | Today attacking does not slow movement, so at equal 170 u/s a bow or wand user who backs away is never caught. Rooting only during the anim floor still leaves Fire and Frost kiters 14-17 s of free fire. With the 50% rule free fire is at most 4.3 s (bow) and 3.7 s (wand). |
| 5 | "Engaged" means the target is inside the bonus owner's own weapon range with line of sight, plus a 1.25 s linger. | If line of sight alone starts the bonus clock, Fire, Sentenced and Plague win all six of their edges from 420-480 u without swinging (tolerance over 90 s). |
| 6 | Buff caps from the table below. | Section 5, buffs. |
| 7 | Heal lockout 3 s, with Holy's lifesteal exempt. | Section 5, healing. |

With rules 1 and 2 and the shield at 0.75 (worst HP left, mirror fights). All 50 cells are 100% wins:

| Edge | sword | axe | bow | wand | shield |
|---|---|---|---|---|---|
| Fire > Sentenced | 73.2 | 60.7 | 65.0 | 68.9 | 64.7 |
| Fire > Plague | 65.4 | 65.3 | 69.1 | 69.4 | 69.1 |
| Sentenced > Plague | 56.0 | 58.0 | 60.6 | 59.4 | 61.2 |
| Sentenced > Frost | 48.6 | 51.4 | 50.6 | 49.0 | 48.6 |
| Plague > Frost | 39.6 | 36.1 | 37.6 | 39.2 | 38.7 |
| Plague > Holy | 66.0 | 66.8 | 66.9 | 66.7 | 66.5 |
| Frost > Holy | 62.1 | 61.2 | 62.4 | 62.0 | 61.7 |
| Frost > Fire | 51.3 | 52.7 | 53.3 | 53.7 | 53.3 |
| Holy > Fire | 66.1 | 64.4 | 67.0 | 64.0 | 66.7 |
| Holy > Sentenced | 26.4 | 26.1 | 23.2 | 23.7 | 23.5 |

Mixed weapons under rules 1 and 2 with the shield at 0.75: every edge holds at 60% or better in all 25 pairs except Holy > Sentenced, which fails in two (Holy bow against Sentenced sword, 6%; Holy shield against Sentenced sword, 0%). With the shield left at 0.60 it fails in five. Both remaining failures involve a Sentenced sword, which is one reason rule 3 also moves Sentenced's starting weapon.

### Signature-weapon openings

Signature weapons: Fire axe, Sentenced sword, Plague bow, Frost shield, Holy wand. Both fighters in range and trading. "Flip x" is the multiplier on the loser's total damage (hits and bonus) that makes the intended winner win less than half the phase pairs; it shows how far the faction loop favours the winner before weapon counters. Every pair is a 100% win for the intended winner in both columns.

| Pair | Plan: worst HP left / fight time | Flip x, plan | Flip x, normalized backlash | After rules 1-3, Sentenced on bow: worst HP left / fight time |
|---|---|---|---|---|
| Fire(axe) > Sentenced(sword) | 89.1 / 1.9 s | never (12x tested) | 4.01 | 65.0 / 4.0 s |
| Fire(axe) > Plague(bow) | 82.4 / 1.2 s | 4.04 | 2.33 | 70.2 / 2.2 s |
| Sentenced(sword) > Plague(bow) | 60.2 / 7.5 s | 1.51 | 1.51 | 60.6 / 8.4 s |
| Sentenced(sword) > Frost(shield) | 67.1 / 16.6 s | 3.47 | 3.47 | 53.7 / 19.8 s |
| Plague(bow) > Frost(shield) | 59.9 / 39.0 s | 2.64 | 2.64 | 41.5 / 46.4 s |
| Plague(bow) > Holy(wand) | 69.0 / 17.2 s | 2.37 | 2.37 | 64.5 / 20.2 s |
| Frost(shield) > Holy(wand) | 36.3 / **102.2 s** | 1.30 | 1.30 | 55.3 / 72.3 s |
| Frost(shield) > Fire(axe) | **9.1** / 21.9 s | **1.18** | 1.52 | 47.3 / 17.2 s |
| Holy(wand) > Fire(axe) | 38.1 / 9.9 s | 1.52 | 2.21 | 62.9 / 9.9 s |
| Holy(wand) > Sentenced(sword) | **6.4** / 27.0 s | **1.06** | 1.06 | 29.2 / 27.0 s |

On stats alone the loop always picks the intended winner. Fire's two wins and Sentenced > Frost are lopsided (3.5x or more). Holy > Sentenced (1.06x), Frost > Fire (1.18x) and Frost > Holy (1.30x) are thin enough that a weapon choice or one buff decides them. The "never" for Fire > Sentenced under the plan is an artifact of the flat backlash: a Sentenced sword swings twice a second, which triggers 420 backlash per second against a designed 189.

### Kiting

Free fire is the time a ranged fighter shoots before a melee chaser reaches 60 u (both move at 170 u/s). One approach with the shooter standing still gives (480 - 60) / 170 = 2.47 s for the bow and (420 - 60) / 170 = 2.12 s for the wand. Backing away while firing is the problem:

| Kiter | Standing, bow / wand | Rule A: root during anim floor only | Rule B: root, then 50% speed until the cooldown ends |
|---|---|---|---|
| Fire, Frost | 2.47 / 2.12 | 17.0 / 14.2 s | 4.31 / 3.69 s |
| Sentenced | 2.47 / 2.12 | 5.67 / 4.72 s | 3.44 / 2.92 s |
| Holy | 2.47 / 2.12 | 5.37 / 4.47 s | 3.38 / 2.88 s |
| Plague | 2.47 / 2.12 | 2.76 / 2.30 s | 2.61 / 2.20 s |

If Frost's chill slows a chaser at range, a Frost kiter stands for 6.18 / 5.29 s and under rule A is never caught. Without any movement penalty, a bow or wand user who backs away at equal speed is never caught.

"Tolerance" is the number of seconds of the loser's full unanswered output (hits plus bonus, mark clock running) the winner can absorb before it falls below a 50% win rate. Mirror-weapon tolerance is 17 s or more on every edge except five: Fire > Sentenced 4.75-5.78 s, Fire > Plague 2.33-3.65 s, Sentenced > Plague 2.83-4.94 s, Frost > Fire 7.93-18.19 s and Holy > Sentenced 0-6.94 s (zero for bow and shield, the two failing cells). Ranged loser against a melee winner, worst case over sword, axe and shield, plan rules:

| Edge | Tolerance, bow / wand loser | Stolen on one approach? | Stolen under rule A? | Max dpsMult that keeps the edge, bow / wand |
|---|---|---|---|---|
| Fire > Sentenced | 5.34 / 4.99 s | no | yes, bow against sword or shield Fire | no limit (mark-driven) |
| Fire > Plague | 3.54 / 3.30 s | no | no | 1.41 / 1.45 |
| Sentenced > Plague | 3.74 / 3.47 s | no | no | 1.07 / 1.15 |
| Sentenced > Frost | 25.5 / 22.5 s | no | only if Frost's chill slows the chaser at range | 1.50 / 1.51 |
| Plague > Frost | 35.3 / 32.0 s | no | only if Frost's chill slows the chaser at range | 1.28 / 1.34 |
| Plague > Holy | 41.3 / 37.8 s | no | no | 1.72 / 1.74 |
| Frost > Holy | 31.1 / 26.0 s | no | no | 1.08 / 1.08 (against shield Frost) |
| Frost > Fire | 5.89 / 6.28 s | no | yes, against sword or shield Frost | 1.05 / 1.06 (against shield Frost) |
| Holy > Fire | 20.1 / 17.6 s | no | no | 1.68 / 1.63 |
| Holy > Sentenced | 4.13 / 4.13 s (against axe Holy) | only against shield Holy, already lost at T = 0 | yes, against axe Holy | 3.73 / 4.0+ (against sword and axe Holy) |

Recommended ranged dpsMult:

- On the plan rules, bow up to 1.05 and wand up to 1.06 keep every edge after one approach, so today's 0.80 and 0.85 have about 25% headroom.
- Under rule A, Frost > Fire needs Fire's bow at 0.43-0.53 or wand at 0.48-0.61, and Fire(sword or shield) > Sentenced and Holy(axe) > Sentenced cannot be saved by any dpsMult because the free damage is the mark. This is why rule 4 in the table above is written as rule B (50% speed), not rule A.
- Under rule B on the plan rules, nothing is stolen at base speed; the tightest case there is a Sentenced bow against axe Holy (3.44 s of free fire against 4.13 s of tolerance). Under the recommended package (rules 1 and 2, shield 0.75) plus rule B, the tightest case is Fire(shield) > Plague(bow): 2.61 s of free fire against about 2.71 s of tolerance, and that cell holds in only 68-81% of swing-phase pairs at base speed.
- With rules 1 and 2 and shield 0.75 (the bonus now scales with the ranged weapon too), the binding limits are Fire(shield) > Plague (bow at most 0.82, wand 0.89) and Holy(shield) > Sentenced (bow 0.86, wand 0.87). Against sword and axe winners every limit is 0.95 or higher. Keep the bow at 0.80 and the wand at 0.85. For a shooter standing still the ceilings are 0.82 and 0.87, but a kiter backing away under rule B gets more free fire (Plague bow 2.61 s, Sentenced wand 2.92 s), which lowers them to about 0.80-0.81 (bow) and 0.854 (wand). Both values sit on the ceiling, so treat them as maximums, not starting points with headroom. A wand at 0.95 would let a Plague wand beat a Fire shield on one approach (1.85 s tolerance against 2.12 s of free fire).

### Buff caps

Assumed drops: +10% max HP, +10% attack speed, +8% move speed. The cell is the smallest multiplier on the loser that flips an edge (below 50% win rate), over every mirror weapon and the signature pairings. Attack speed cannot push a cadence under its anim floor.

| Stat | On the plan numbers | After rules 1-3 (Sentenced on bow) | Cap I would set |
|---|---|---|---|
| Max HP | Holy > Sentenced is already flipped on bow and shield and flips at x1.07 on wand and signature (axe x1.16). No cap is safe. | 1.29 (Holy > Sentenced, shield mirror); Holy > Sentenced 1.30-1.43 elsewhere; Plague > Frost 1.65-1.76; Frost > Fire signature 1.97 | +20% (two drops) |
| Attack speed | 1.30 (Frost > Holy, signature); 1.63 (Frost > Fire, signature) | 1.63 (Frost > Holy, signature); 1.65 (Plague > Frost); Sentenced > Frost 2.03 or more | +30% (three drops) |
| Move speed | Rule A: Frost > Fire and Holy > Sentenced are already stolen at base speed. Rule B: 1.36 (Frost > Fire, bow), 1.43 (Holy axe > Sentenced bow), 1.91 (Fire > Sentenced, bow) | 1.18 (Holy(shield) > Sentenced(wand)); Fire(shield) > Plague(bow) is model-sensitive (1.22 here, about 1.7 in the verifier's model; the real headroom is 0.03-0.1 s of free fire, not 22%); 1.38 and 1.48 (Fire(shield) > Sentenced, bow and wand); all others 1.95 or more. Valid only with rule 4. | +16% (two drops) |

- Stacked on the loser with rules 1-3: HP x1.2 and attack speed x1.3 hold every edge at 60% or better. HP x1.3 with attack speed x1.2 fails the Holy > Sentenced shield mirror. HP x1.3 with attack speed x1.3 fails Plague > Frost on every weapon (and Holy > Sentenced on the shield mirror).
- On the plan numbers, HP x1.2 with attack speed x1.2 already fails Frost > Holy (signature), Frost > Fire (shield mirror and signature) and Holy > Sentenced (five settings).
- Attack speed is worth nothing to cadences pinned at the floor. Plague gains nothing on sword or axe and at most +12% on bow, +8% on wand, +24% on shield. Holy and Sentenced gain nothing on sword. Either convert attack speed above the floor into per-hit damage, or document it.
- Attack speed on Fire's opponent raises the backlash Fire takes, so no attack-speed buff can flip a Fire win.
- Plague > Frost has the same threshold for HP and attack speed (1.65-1.68). Plague's damage is absolute HP per second, so Frost's survival time scales linearly with its HP.

### Healing

The 3 s out-of-combat lockout never opens inside a duel. Longest stretch with no combat event, across every edge, 25 weapon pairs and all phase pairs (same under plan and package):

| What counts as combat | Longest gap | Where |
|---|---|---|
| Any damage dealt or taken (DoT ticks count) | 2.05 s | Frost(shield) against Holy(axe) |
| Damage taken only | 2.60 s | Frost or Fire at axe cadence (2.58 s) |
| Weapon hits only | 2.60 s | Frost or Fire at axe cadence |

- 0 of about 30,000 heal opportunities fired with the lockout, and outcomes were identical to the no-heal runs. The margin is 0.4 s on the hits-only reading. Keep weapon base cooldowns at 1.0 s or less (Fire and Frost cadence is base x 2.87), or count DoT and linger ticks as combat.
- Holy's lifesteal must be exempt from the lockout. Blocking it flips Holy > Sentenced in all six settings (Holy > Fire, Frost > Holy and Plague > Holy hold).
- Without a lockout, one instant heal at 35% HP: a loser-only medkit (60%) drops 15 plan-rule setting-edges under 60% (Plague > Frost sword and axe; Frost > Fire sword, bow, wand, shield and signature; Holy > Fire bow and shield; Holy > Sentenced in all six). A loser-only bandage (25%) drops Frost > Fire signature and Holy > Sentenced axe, wand, signature. When both fighters heal, nothing new fails.
- Disengage, wait out the 1.25 s linger plus the 3 s lockout, heal, re-engage. If both heal, the fixed rules keep every edge (the plan reproduces only the existing Holy > Sentenced failures). If only the loser heals, Sentenced > Plague flips even with a bandage, because the mark restarts at 0 at re-contact, and Holy > Sentenced flips too. These are item advantages plus the mark-reset weakness. Consider keeping the mark clock running, or decaying it, through breaks of up to about 5 s.

## 6. Sheet notes

### Statements the engine contradicts or only partly supports

Everything else numeric in the sheet checked out: the section 2 stats and damage mixes, every figure in the section 3 cards (rows 3 to 5 below are wording issues, not number errors), all nine rows of section 4 (within 0.5), all twenty cells of the section 5 matrix, the section 6 table (lengths and HP left), the section 7 scaling claim and all eleven rows of the knob table (each re-measured and within 0.5 points of the sheet's figure).

| # | Where | The sheet says | The engine gives | Suggested wording |
|---|---|---|---|---|
| 1 | Section 7, tuning knobs | "No single +-25% change to any knob flips an edge, so the design has slack." | True for the eleven listed knobs. Not true of the core stats: Holy's hit or attack rate at -25% flips Holy > Sentenced, and the threshold is -20.0% (hit 52, rate 0.76). A -25% move on every other stat, and +25% on all of them, flips nothing. | "...to any listed knob. Holy's hit and attack rate are the exception: -20% flips Holy > Sentenced." |
| 2 | Section 8, verification | Robustness to random jitter "on every numeric field". | The test jitters HP, rate, hit, armor, shield and the signature numbers, but not the damage shares (phys and true). A separate run jittering each physical share by +-10 points holds the graph in 40 of 40 draws; +-15 points breaks Holy > Sentenced in 3 of 40. | "...on every numeric field except the damage shares" (or add shares to the test). |
| 3 | Section 3, Fire | Fire wins against Sentenced "before the mark... has built". | At 3.6 s the mark is at 127 of 275 (46%), and averages 63 raw per second over the fight. | "while the mark is under half strength". |
| 4 | Section 3, Plague | The Plague > Frost fight is "a fight the execute decides". | The execute is 42% of Plague's damage there, equal to the disease. Without the execute Plague loses by 3.3 points; without the disease it loses by 73.9. | "a fight the execute finishes". |
| 5 | Section 3, Frost | Slowing the mark and Plague's flat damage "achieves little". | True for the mark (cancels 1%, worth 0.5 points on Sentenced > Frost). Not for Plague: the slow cancels 19% of its potential damage (411 HP) and is worth 15.8 points on Plague > Frost. | "achieves nothing against the mark and about a sixth of the margin against Plague". |
| 6 | Section 1, rulebook | Six laws; rule 6 says a mechanic may read elapsed time, "Nothing else". | Fire's backlash reads the target's current attack rate (`foe_rate`). None of the six laws covers that. The audit passes because it only checks mechanic signatures. | Add a seventh law: "A mechanic may read the opponent's current attack rate (backlash)." |
| 7 | Section 2, stat table | Base DPS 92 / 4 / 37 / 40 / 62. | Exact values are 91.5 / 4.5 / 37 / 40.5 / 61.75. The sheet rounds half to even (91.5 up, 4.5 and 40.5 down). | Show one decimal, or round half up (92 / 5 / 37 / 41 / 62). |
| 8 | Section 4, main/sub labels | Execute is "main", disease is "sub". | Disease moves margins 114 points, execute 43. | Call both main, or swap the labels. The pass rule is unaffected. |

### Design observations

- Fire's burn is cosmetic, as the sheet says, and here are the numbers. Burn is 2-9% of Fire's damage (3% in Fire > Sentenced, 2% in Fire > Plague, 9% in the Frost loss, 3% in the Holy loss). Removing it moves the biggest margin by 3.7 points. Options: raise it to about 40 and retune, or drop it, or give it another job.
- Sentenced's hit (5) and attack rate are nearly dead stats. Swings are 1-7% of its damage. The rate matters for one reason: it is what Fire's backlash feeds on (189 raw per second, 65% of Fire's damage in that fight). Halving it to 0.45 moves Fire > Sentenced from 78% HP left in 3.6 s to 54% in 5.4 s; 0.30 gives 36% in 6.4 s. The other nine edges move by at most one point (Sentenced > Frost 51 to 50, Holy > Sentenced 27 to 28). It is a clean lever if Fire's win over Sentenced is too easy.
- Fights are long, as the sheet notes. Median 14.5 s; Frost's four fights are 13.1, 16.6, 37.0 and 52.3 s. In the weapon plan the signature Frost > Holy fight is 102 s (72 s with the shield at 0.75). A 120 s cap would make the Frost > Holy edge stall under small drops of Frost damage (section 3).
- Holy's lifesteal has slack. Holy > Sentenced is a coin flip without it, but a flat 10% lifesteal (cap 0.10) already keeps the win. The numbers can move a long way before the edge changes, which the sheet's slider table also shows (ls1 and ls0 worth only 4 and 2 points).
- Holy > Sentenced is the one edge that is soft in four independent ways (Holy hit, Holy shield, Sentenced mark cap, Sentenced damage mix) and it is also the edge the real-time plan breaks. Widening it in the engine (shield 275 or 300, section 3) helps: it fixes the bow mirror and the signature pairing (14-21% worst HP). It does not replace weapon rule 1 or a shield dpsMult of at least about 0.75, because the shield-weapon mirror still loses at shield 0.60 even with the wider edge.
- Sentenced > Plague finishes 6.4 points above Plague's 50% execute line, which is why it is the second-softest edge. Cut Sentenced's HP by 14% (to 600) and the execute starts to open at the end of the fight, but the edge still holds (49% left); it flips at -27%.
- Plague's 200 armor only does work against Holy and Frost. Fire and Sentenced do 100% magic and Plague has no shield. If you want Plague to resist anything else, the shield is the stat to raise, but the room is small: Sentenced > Plague flips at Plague shield 78 and Fire > Plague at 115.
- In the weapon plan the signature Frost(shield) > Holy(wand) fight runs 102 s (72 s with shield 0.75). Anything with a fight timer near two minutes will cut it off.

Suggested order of changes, if you take any: (1) widen Holy > Sentenced (Holy shield 275); (2) adopt the weapon rules 1 and 2 before any weapon numbers are final; (3) set the ranged movement penalty to rule B; (4) cap buffs at +20% HP, +30% attack speed, +16% move speed; (5) decide what "engaged" means for bonus damage before building the bonus-damage code.

