# Controls rework: windups instead of ranged slows

Owner's brief: right-click moves, a left-click auto-attacks the enemy closest to the cursor (so a near miss does not matter), with an attack animation or just a pause while it swings; the ranged weapon slow was added to stop kiting, and the pause "will suffice". This file is the change log of that rework: what was changed, the numbers before and after in the Python model and in the real sim, what was tried and dropped, and what is left for the owner. The rules as built are in `docs/GAME_DESIGN.md` 9.5 and 14. Nothing here touches a faction number, a weapon's damage, boost, range or floor (Phase 9.1 and 10 own those); the only weapon numbers that moved are the two ranged **windups**, and the ranged move multipliers are gone.

## Result in one table

| | Before (main, `2b698f7`) | After (`1e85912`) |
|---|---|---|
| Ranged movement rule | 0.1x move while drawing, casting and recovering after any ranged shot (`BOW_DRAW_MOVE`, `WAND_CAST_MOVE`, `RANGED_RECOVERY_MOVE`) | **None.** Every attack roots its fighter for a windup, then it walks at full speed. Bow `min(0.6 s, 0.92 x interval)`, wand `min(0.4 s, 0.8 x interval)`, melee unchanged (sword and bash 0.1 s, axe 0.25 s / 25% with a 0.5 s / 50% root) |
| Kite check, `python3 testing/test_kite.py` | 20 of 20 PASS against a **standing** shooter, tightest Fire > Plague with the bow x1.16 (1.23 s tolerance against 1.06 s) | 20 of 20 PASS against an **orb-walking** shooter (rooted for its windup, walks between shots), tightest Fire > Plague with the bow **x1.06** (1.23 s against 1.16 s), then the wand x1.08. The old draw and cast numbers used as windups (bow 0.6 s / 70%, wand 0.2 s / 40%) **steal 7 of 20 cells** |
| Weapon edges, policy matrix (real sim, EDGE VERDICTS) | **10 of 10** hold | **9 of 10**: Wand > Shield fails at **23%** (Fire 33, Sentenced 0, Plague 56, Frost 0, Holy 28). Bow > Sword 98 -> 100%, Bow > Axe 91 -> 96%, Axe > Wand 91 -> 92% |
| Same edges, both fighters click each other (new TARGET LOCK section) | n/a | **10 of 10** (Wand > Shield **100%**, Bow > Sword and Bow > Axe 93% with Fire 67%) |
| Real kiting, harness KITING | worst x1.12 against a motionless shooter (sword vs bow, kite) | worst x1.40 (sword vs wand, **orbwalk**); the bow's worst is x1.06. Absolute: 1.05 s to 1.15 s until in reach of an orb-walking wand, 0.90 s to 1.05 s of a bow |
| Faction cycle, `harness:factions -- --python` | 60 of 60 cells agree with `realtime.py` | 60 of 60, same hp difference (1.0e-6); the file differs from the old one only in its elapsed time |
| Faction cycle, `--mode policy` | mirrors 46 of 50, openings 9 of 10 | the same cells fail (the four shield mirrors, Plague > Frost with bow/shield); Holy > Fire (wand/axe) opening worst hp 64.3 -> 48.4%, Fire > Plague wand mirror 66.3 -> 60.5, the rest within 5.5 points |
| Mob duels (`bench/mobDuel.ts`, default policy style) | normal: 5 pairings under 90%, duels won 83%; elite 19 of 25 pairings, 76% | normal: **3**, **88%**; elite **20 of 25**, **80%** |
| `step()` with 8 players and 60 mobs | avg 0.091 ms, p99 0.183 ms | avg 0.115 ms, p99 0.234 ms (gate 5 / 15 ms) |
| Bandwidth per client | typical 9.94, heavy 15.28, idle 4.06 KB/s | typical **7.34**, heavy **9.98**, idle **3.04** KB/s (gate 20) |
| Tests | n/a | 4200 pass (201 client, 3104 server, 895 shared), typecheck clean, `test_rpsls.py` and `test_kite.py` ALL PASS |

## How to reproduce

```
python3 testing/test_kite.py                       # the kite check against an orb-walking shooter, ~5 s, exits 1 on a FAIL
python3 testing/kite_windup_sweep.py               # which bow and wand windups hold it, ~10 s
python3 testing/realtime_report.py <k2.json> kite  # the same cells with all three melee weapons (k2.json as in TUNING_9_1.md)
npm run harness -w @raid/server                    # the real sim: matrix, grids, EDGE VERDICTS, TARGET LOCK, KITING (~55 s; --core skips the sensitivity passes)
npm run harness:factions -w @raid/server -- --python        # 60 cells against realtime.py (~6 s)
npm run harness:factions -w @raid/server -- --mode policy   # moving fighters (~18 s)
npx tsx packages/server/bench/mobDuel.ts           # a starting player against every region's mob and elite
npx tsx packages/server/bench/bandwidth.ts         # KB/s per client
npx tsx packages/server/bench/stepBench.ts         # ms per step
```

"Before" is main at `2b698f7` (Phase 13) in a copy of the tree; "after" is this branch. The harness runs are the full report (`npm run harness`), not `--core`, with the default 3 setups x 5 factions per style-grid cell. **What "holds" means is unchanged** (TUNING_9_1.md: at least 60% overall, 50% in every faction column of the main matrix, and a reply that wins at least 50% against each way the loser plays).

## What changed and why

**Controls (the mechanism; GAME_DESIGN 9.5, 14).** A left-click sends `target {id}`: the server walks the player into the weapon's range, holds the trigger while the target is in range with a clear line, and aims every attack at it, until the player gives another order (right-click, `S`, another click), the target goes down, walks home or leaves 640 u, or it stays out of sight for 1.5 s after having been seen. A locked attack is aimed again at its target as it lands (a swing) or leaves (a ball or an arrow, led). The client no longer sends `attack` or `release`; mobs, the harness and the weapon policies still use them. The lock plays a weapon with `lockSpacing`: close in, stand, attack, never back off, strafe or weave.

**Windups replace the slows.** Every attack roots its fighter from its start until the swing lands or the projectile leaves, and the fighter then walks freely until the next one. That is the "attack animation or pause" of the brief. Without a slow, a shooter can walk between its shots (an "orb-walk"): fire, walk away at full speed until the cooldown ends, fire again. The chaser closes the gap only while the shooter is rooted, so the free fire a melee winner must absorb is about

```
free fire (orb-walking shooter) ~ free fire (standing shooter) x interval / windup
```

a little less, because the shooter's first windup comes at the start of the approach (Fire's bow at the old 0.6 s / 70%: 1.36 s measured, 1.06 / 0.7 = 1.51 s from the formula). So **the two ranged windups are the anti-kiting lever**, as the 0.1 multipliers were: the share of the interval a shooter spends rooted. The 9.1 numbers that make the kite check pass (ranges 240 / 220 u, damage multipliers 0.8, the melee tolerances) are not touched; the tolerances do not depend on the windups at all (the shooter's cadence is its interval either way), which is why the tuning is two numbers a ranged weapon, a cap and a share, and nothing else.

**Other rules that came with it** (each is a best guess the owner may overrule; GAME_DESIGN 9.5): a windup is committed (moving does not cancel it, as it would in League; a walk ordered during it waits); snap radius 64 u and an empty click does nothing; 640 u is both the accept range and the leash; the lock survives a swap or a pickup; the shield faces the locked enemy, else the cursor; the bow stays immune to stagger; a lock needs no line of sight to be taken (`bcb0453`).

## The kite check against an orb-walking shooter (Python, k = 2)

`testing/realtime.py` `orbwalk_free_fire` is a kinematic model at the sim's DT 0.05 s that mirrors the TS rules: the chaser starts one weapon range away and walks at 170 u/s; the shooter is ready at t = 0, winds up (rooted) for `min(cap, share x interval)`, the shot leaves, it walks straight away at 170 u/s until one interval after the windup's start (where the TS sim sets `readyAt`), and winds up again. The time returned is when the gap is 60 u (melee reach). It ignores arrow flight and attack-speed buffs. A Frost shooter chills the chaser from its first shot: the chaser then walks at `CHILL_MOVE_MULT` 0.7 inside `CHILL_MOVE_RADIUS` 100 u. A Frost chaser's chill on the shooter is not applied (`kite_tolerance` starts the winner's clock at its arrival; the conservative way). `test_kite.py` now requires the weakest melee weapon's tolerance (how late it may arrive and still win half the duels, unchanged by this work) to be at least that time, and prints the standing figure beside it.

**Before** (`test_kite.py` on main, a standing shooter): ALL PASS, tightest Fire > Plague with the bow, axe, 1.23 s against 1.06 s (x1.16). The tolerances (column "tol" below) and the standing times are unchanged by this work.

**After, per cell.** `orb` is the orb-walk free-fire time: at the old draw / cast numbers used as windups (bow 0.6 s cap, share 0.7; wand 0.2 s, 0.4), then at the final ones (bow 0.6 s, 0.92; wand 0.4 s, 0.8). `x` is tolerance / orb at the final numbers. **STOLEN** = the weakest melee tolerance is under the orb time.

```
cell                        weapon  weakest melee      tol    standing   orb (old)   orb (final)       x
Fire > Sentenced              bow   sword             1.89 s     1.06 s     1.41 s     1.16 s       x1.631
Fire > Sentenced              wand  shield            1.74 s     0.94 s     2.84 s     1.49 s       x1.164    (old: STOLEN, x0.611)
Fire > Plague                 bow   axe               1.23 s     1.06 s     1.51 s     1.16 s       x1.062    (old: STOLEN, x0.816)
Fire > Plague                 wand  sword             1.23 s     0.94 s     2.34 s     1.14 s       x1.078    (old: STOLEN, x0.526)
Sentenced > Plague            bow   sword             2.09 s     1.06 s     1.51 s     1.16 s       x1.801
Sentenced > Plague            wand  sword             2.09 s     0.94 s     2.34 s     1.14 s       x1.829    (old: STOLEN, x0.892)
Sentenced > Frost             bow   sword            10.68 s     2.65 s     1.70 s     1.70 s       x6.288
Sentenced > Frost             wand  sword            10.48 s     2.35 s      inf       3.03 s       x3.459    (old: STOLEN, x0.000)
Plague > Frost                bow   sword            13.38 s     2.65 s     1.70 s     1.70 s       x7.879
Plague > Frost                wand  sword            13.58 s     2.35 s      inf       3.03 s       x4.481    (old: STOLEN, x0.000)
Plague > Holy                 bow   sword            19.69 s     1.06 s     1.36 s     1.16 s      x16.989
Plague > Holy                 wand  sword            19.49 s     0.94 s     2.74 s     1.44 s      x13.523
Frost > Holy                  bow   sword            21.05 s     1.06 s     1.36 s     1.16 s      x18.165
Frost > Holy                  wand  sword            21.14 s     0.94 s     2.74 s     1.44 s      x14.667
Frost > Fire                  bow   shield            8.75 s     1.06 s     1.36 s     1.36 s       x6.436
Frost > Fire                  wand  shield            8.94 s     0.94 s     4.19 s     2.19 s       x4.081
Holy > Fire                   bow   sword            26.39 s     1.06 s     1.36 s     1.36 s      x19.421
Holy > Fire                   wand  shield           27.05 s     0.94 s     4.19 s     2.19 s      x12.344
Holy > Sentenced              bow   sword             2.83 s     1.06 s     1.41 s     1.16 s       x2.446
Holy > Sentenced              wand  sword             2.83 s     0.94 s     2.84 s     1.49 s       x1.901    (old: STOLEN, x0.998)
tightest cell: Fire > Plague vs bow, margin x1.062          ALL PASS (20 of 20; 7 of 20 stolen at the old numbers)
```

(For a Frost shooter the `standing` column is still the old conservative figure, which divides by the 0.4 attack chill: 2.65 s bow, 2.35 s wand. The kinematic standing figure with the move chill is 1.15 s and 1.02 s, so for those four cells `orb` can print below `standing`.) With all three melee weapons per cell, from `realtime_report.py <k2.json> kite` at the final numbers:

```
  Fire>Sentenced     bow: sw  1.89 ax  1.89 sh  2.00 (Tff 1.06 orb  1.16 x1.631)  wand: sw  2.09 ax  2.04 sh  1.74 (Tff 0.94 orb  1.49 x1.164)
  Fire>Plague        bow: sw  1.34 ax  1.23 sh  1.30 (Tff 1.06 orb  1.16 x1.062)  wand: sw  1.23 ax  1.30 sh  1.34 (Tff 0.94 orb  1.14 x1.078)
  Sentenced>Plague   bow: sw  2.09 ax  2.15 sh  2.09 (Tff 1.06 orb  1.16 x1.801)  wand: sw  2.09 ax  2.15 sh  2.09 (Tff 0.94 orb  1.14 x1.829)
  Holy>Sentenced     bow: sw  2.83 ax  3.14 sh  2.83 (Tff 1.06 orb  1.16 x2.446)  wand: sw  2.83 ax  3.14 sh  2.83 (Tff 0.94 orb  1.49 x1.901)
```

### The windup sweep (`kite_windup_sweep.py`)

Each ranged weapon alone (the other is never in a cell of its own), shares 0.3 to 1.0 and caps 0.2 s to infinity, counting the stolen cells of 10 and the worst margin. Rows are the share, columns the cap; `stolen / worst margin`:

```
bow
   share         0.2         0.4         0.6         0.8         inf
    0.30    6 / 0.000    4 / 0.366    4 / 0.366    4 / 0.366    4 / 0.366
    0.50    5 / 0.000    2 / 0.598    2 / 0.598    2 / 0.598    2 / 0.598
    0.70    5 / 0.000    1 / 0.816    1 / 0.816    1 / 0.816    1 / 0.816     <- the old draw numbers (cap 0.6)
    0.85    5 / 0.000    1 / 0.977    1 / 0.977    1 / 0.977    1 / 0.977
    0.90    5 / 0.000    0 / 1.018    0 / 1.018    0 / 1.018    0 / 1.018
    0.92    5 / 0.000    0 / 1.062    0 / 1.062    0 / 1.062    0 / 1.062     <- chosen (cap 0.6)
    1.00    5 / 0.000    0 / 1.162    0 / 1.162    0 / 1.162    0 / 1.162
wand
    0.40    6 / 0.000    3 / 0.526    3 / 0.526    3 / 0.526    3 / 0.526     <- the old cast numbers (cap 0.2): 6 stolen
    0.70    5 / 0.000    1 / 0.991    1 / 0.991    1 / 0.991    1 / 0.991
    0.75    5 / 0.000    0 / 1.033    0 / 1.033    0 / 1.033    0 / 1.033
    0.80    5 / 0.000    0 / 1.078    0 / 1.078    0 / 1.078    0 / 1.078     <- chosen (cap 0.4)
    0.90    5 / 0.000    0 / 1.164    0 / 1.182    0 / 1.182    0 / 1.182
    1.00    5 / 0.000    0 / 1.164    0 / 1.307    0 / 1.307    0 / 1.307
```

- **Smallest share that holds all 10 cells** (cap 0.4 s or more): bow 0.89 at margin 1.0, 0.91 at 1.05; wand 0.75 at 1.0, 0.77 at 1.05. A cap of 0.2 s holds nothing, for either weapon (below). Binding cells: Fire > Plague with the bow (the axe is that cell's weakest melee weapon; at the shield's 1.30 s the share needed would be 0.81) and with the wand (sword 1.23 s; at 1.30 s the share would be 0.68), then Fire > Sentenced with the wand (x1.164, limited by the 0.4 s cap).
- **Chosen: bow share 0.92, cap 0.6 s (unchanged); wand share 0.8, cap 0.4 s (from 0.2 s).** Both clear 1.05 with one step to spare: the tolerances step in whole hits at a 0.025 s bisection, so a margin within a few percent of 1.0 is one hit from flipping. The bow's cap needs no change (any cap from 0.4 s up gives the same margins); the wand's share rises from 0.4 to 0.8 and its cap doubles.
- **Plague's bow** (0.277 s interval) is rooted for 0.255 s of every cycle at 0.92, so a Plague archer hardly walks at all. Frost's bow (1.14 s) is rooted for the 0.6 s cap, 53% of it.

### The Frost chill-kite: the wand cap has a floor

A Frost shooter slows its chaser to 0.7 inside 100 u, and walks at full speed itself. So after every shot the gap regrows to 100 u, and the chaser has to cover the last 40 u (100 minus the 60 u reach) inside ONE windup:

```
(100 - 60) / (0.7 x 170) = 0.336 s   (7 ticks = 0.35 s on the 20 Hz grid)
```

A Frost windup shorter than that keeps the chaser out of reach for good, whatever the share (`orbwalk_free_fire` returns inf). The smallest windup that lets the chaser arrive is **0.31 s** (found on a 0.01 s grid, bow and wand alike). At the old wand cap of 0.2 s the two Frost-loser wand cells (Sentenced > Frost, Plague > Frost) are infinite; the bow's Frost windup is 0.6 s and nowhere near it. **So the wand's cap must stay at or above about 0.35 s**, whatever the other cells would allow; this is why 0.2 s is not an option even at share 1.0. It relies on the sim doing what the model does while a Frost shooter is engaged (`CHILL_MOVE_MULT` and `CHILL_MOVE_RADIUS`); the weapon harness runs with signatures off, so Frost's chill is not in its KITING section (open question 6).

## Real sim, before and after

Main matrix, the designed winner's win% over 5 factions x 18 setups (before = main; after = final), with Fire / Sentenced / Plague / Frost / Holy:

```
before (main)
bow > sword           89%/8.8s   100%/146.2s    100%/36.7s    100%/54.6s    100%/15.4s     98%/36.7s
bow > axe             56%/8.8s   100%/146.2s    100%/36.7s    100%/54.6s    100%/15.4s     91%/36.7s
wand > shield        100%/7.8s   100%/146.2s    100%/36.6s    100%/54.5s    100%/15.3s    100%/36.6s
axe > wand            56%/8.8s   100%/152.4s    100%/39.0s    100%/57.3s    100%/16.6s     91%/39.0s
after (final)
bow > sword          100%/8.8s   100%/146.3s    100%/36.8s    100%/54.7s    100%/15.6s    100%/36.8s
bow > axe             78%/8.8s   100%/146.3s    100%/36.8s    100%/54.7s    100%/15.6s     96%/36.8s
wand > shield         33%/8.9s     0%/172.3s     56%/39.5s      0%/65.6s     28%/17.5s     23%/39.5s
axe > wand           67%/14.1s   100%/175.9s    100%/39.1s     94%/114.4s   100%/16.7s     92%/39.1s
```

The other six rows (sword > axe, sword > wand, wand > bow, shield > sword, shield > bow, axe > shield) are 100% in both runs. Sword > wand wins with much more hp (mean 47% -> 71%, worst 16 -> 48): the longer cast gets staggered more (27.8 -> 59.5 staggers a duel) and the balls that land fall from 50.7 to 26.8 a duel. The wand's hit rate over the main pass falls from 83% to 63%.

**EDGE VERDICTS, before** (main; `HOLDS (thin: ...)` names the faction columns under 50%):

```
edge              overall  weakest faction       best reply to each style of the loser                           verdict
sword > axe          100%  fire 100%             -                                                               HOLDS
sword > wand         100%  fire 100%             stand: 100% (stand)  strafe: 100% (stand)  kite: 100% (stand)   HOLDS
bow > sword           98%  fire 89%              stand: 100% (stand)  weave: 87% (stand)  jink: 87% (stand)      HOLDS (thin: Fire 33% vs weave; Fire 33% vs jink)
bow > axe             91%  fire 56%              stand: 93% (stand)  weave: 87% (stand)  jink: 80% (stand)       HOLDS (thin: Fire 33% vs weave; Fire 0% vs jink)
wand > bow           100%  fire 100%             stand: 100% (stand)  strafe: 87% (strafe)  kite: 100% (stand)   HOLDS (thin: Frost 33% vs strafe)
wand > shield        100%  fire 100%             stand: 100% (stand)  weave: 87% (kite)  jink: 87% (stand)      HOLDS (thin: Fire 33% vs weave; Fire 33% vs jink)
shield > sword       100%  fire 100%             -                                                               HOLDS
shield > bow         100%  fire 100%             stand: 100% (stand)  strafe: 100% (stand)  kite: 100% (stand)   HOLDS
axe > wand            91%  fire 56%              stand: 100% (weave)  strafe: 100% (weave)  kite: 100% (weave)   HOLDS
axe > shield         100%  fire 100%             -                                                               HOLDS
10 of 10 edges hold
```

**EDGE VERDICTS, after** (final):

```
edge              overall  weakest faction       best reply to each style of the loser                           verdict
sword > axe          100%  fire 100%             -                                                               HOLDS
sword > wand         100%  fire 100%             stand: 100% (stand)  strafe: 100% (stand)  kite: 100% (stand)   HOLDS
bow > sword          100%  fire 100%             stand: 100% (stand)  weave: 93% (stand)  jink: 100% (stand)     HOLDS
bow > axe             96%  fire 78%              stand: 93% (stand)  weave: 100% (stand)  jink: 93% (kite)       HOLDS
wand > bow           100%  fire 100%             stand: 100% (stand)  strafe: 87% (kite)  kite: 80% (strafe)     HOLDS (thin: Frost 33% vs strafe; Frost 0% vs kite)
wand > shield         23%  sentenced 0%          stand: 27% (stand)  weave: 20% (strafe)  jink: 13% (stand)      FAILS (matrix) (styles) (thin: Fire 33%, Sentenced 0%, Frost 0%, Holy 33% vs stand; Fire 0%, Sentenced 0%, Frost 0%, Holy 0% vs weave; Fire 0%, Sentenced 0%, Frost 0%, Holy 0% vs jink)
shield > sword       100%  fire 100%             -                                                               HOLDS
shield > bow         100%  fire 100%             stand: 100% (stand)  strafe: 100% (stand)  kite: 100% (stand)   HOLDS
axe > wand            92%  fire 67%              stand: 100% (weave)  strafe: 100% (stand)  kite: 100% (weave)   HOLDS
axe > shield         100%  fire 100%             -                                                               HOLDS
9 of 10 edges hold
```

What moved, besides Wand > Shield:
- **Bow > Sword and Bow > Axe got better, not worse.** The bow can walk between shots again, and looses at full damage on every shot; the Fire column's thin cells (33% against the weave and the jink for Bow > Sword, 0% against the jink for Bow > Axe) are gone (Bow > Sword 100% in every Fire cell; Bow > Axe Fire 56 -> 78%). The policy bow's arrow is led for its lags only: `decide` no longer adds the bow's windup (`1e85912`).
- **Wand > Bow** holds as before, but a kiting bow is now a thin cell in the Frost column (0%) as a strafing one already was (33%): the wand's best replies are 87% (kite) and 80% (strafe).
- **Axe > Wand** holds with the axe at 0.77 untouched (Fire 56 -> 67%, Frost 100 -> 94%).
- **Weave and jink**: with the controls in, the zigzag approach no longer breaks anything beyond Wand > Shield. (Bow > Axe: weave 87 -> 100%, jink 80 -> 93%.)
- **Client view** (`WHAT THE CLIENT SEES`): bow > axe 93% in all three views (bots' stale view was 40% before: bots no longer aim, they click); axe > wand 87% / 40% / 93% (client / stale / present) against 87 / 87 / 87 before. **Cluttered arena**: bow > axe 90 -> 97% open, 90 -> 100% among pillars; axe > wand 90 -> 93% and 90 -> 87%; wand > shield 33% / 30%.

### TARGET LOCK (new section): the same edges when both fighters click each other

Both fighters send `target` (again whenever it is not locked) and nothing else: the server chases, attacks and aims. 3 setups x 5 factions pooled, the main matrix on the same setups in the last column.

```
edge              overall  weakest faction       by faction (fire/sentenced/plague/frost/holy)  main matrix
sword > axe          100%  fire 100%             100/100/100/100/100                            100%
sword > wand         100%  fire 100%             100/100/100/100/100                            100%
bow > sword           93%  fire 67%              67/100/100/100/100                             100%
bow > axe             93%  fire 67%              67/100/100/100/100                             93%
wand > bow           100%  fire 100%             100/100/100/100/100                            100%
wand > shield        100%  fire 100%             100/100/100/100/100                            27%
shield > sword       100%  fire 100%             100/100/100/100/100                            100%
shield > bow         100%  fire 100%             100/100/100/100/100                            100%
axe > wand           100%  fire 100%             100/100/100/100/100                            87%
axe > shield         100%  fire 100%             100/100/100/100/100                            100%
10 of 10 edges keep 60% overall and 50% in every faction when both fighters lock each other
```

This is the pass that stands for what players will do with these controls: a locked fighter walks in, stands and trades; it never backs off, strafes or weaves, so none of the style grids' replies exist. All ten edges hold, Wand > Shield at 100%, and the ranged-over-melee edges (Bow > Sword, Bow > Axe) are 93% with Fire the thin column at 67%, the same hit-count cliff TUNING_9_1.md describes.

### KITING

Seconds until a melee fighter is in reach of a shooter that starts at the edge of its range, median over the five factions, and the shooter's hits before then (% of hp).

**Before** (main; the shooter never moves, stands, strafes or kites):

```
standing-shooter bound (range - 60 u) / 170 u/s: bow 1.06 s, wand 0.94 s
                            post         stand        strafe          kite
  sword vs bow       0.85s    2%   0.90s    2%   0.90s    2%   0.95s    2%
  axe vs bow         0.90s    2%   0.90s    2%   0.90s    2%   1.00s    2%
  shield vs bow      1.00s    0%   1.00s    0%   1.00s    0%   1.10s    0%
  sword vs wand      0.75s    2%   0.60s    2%   0.60s    2%   0.65s    2%
  axe vs wand        0.80s    2%   0.65s    2%   0.65s    2%   0.70s    2%
  shield vs wand     0.85s    2%   0.75s    2%   0.75s    2%   0.80s    2%
  worst time against a shooter that moves, over the time against one that never does: x1.12 (sword vs bow, kite)
```

**After** (two new columns: `orbwalk`, the perfect kiter, which walks straight away whenever its target is inside its attack range while it holds the trigger, so it stands only for its windups; `lock`, a shooter that clicks its chaser and lets the server fight):

```
standing-shooter bound (range - 60 u) / 170 u/s: bow 1.06 s, wand 0.94 s
                            post         stand        strafe          kite       orbwalk          lock
  sword vs bow       0.85s    2%   0.85s    2%   0.85s    2%   0.90s    2%   0.90s    2%   0.85s    2%
  axe vs bow         0.90s    2%   0.90s    2%   0.90s    2%   0.95s    2%   0.95s    2%   0.90s    2%
  shield vs bow      1.00s    0%   1.00s    0%   1.00s    0%   1.05s    0%   1.05s    0%   1.00s    0%
  sword vs wand      0.75s    0%   0.90s    2%   0.90s    2%   0.90s    2%   1.05s    2%   0.70s    2%
  axe vs wand        0.80s    2%   0.95s    2%   0.95s    2%   0.95s    2%   1.10s    2%   0.75s    2%
  shield vs wand     0.85s    2%   1.00s    2%   1.00s    2%   1.00s    2%   1.15s    2%   0.80s    2%
  worst time against a shooter that moves, over the time against one that never does: x1.40 (sword vs wand, orbwalk)
  worst time against the perfect kiter (orbwalk: rooted only for its windups), over the time against one that never moves: x1.40 (sword vs wand)
```

Reading it: the bow stays within x1.06 of a motionless one (0.90 s against 0.85 s; its windup is 92% of every cycle). The wand is the loose one, as the model says: x1.40 against `post`, and 1.05 s to 1.15 s in absolute terms, about what the model gives for its tightest wand cell (1.14 s of orb-walk free fire against 1.23 s of tolerance, Fire > Plague). The two are not the same measurement: the harness counts a chaser in reach at the swing's reach plus a body radius (76 u for the sword, the model's is 60 u), starts the shooter 20 u inside its range, and takes the median over the five factions. A shooter that **locks** its chaser gets no more than the standing one (0.70 s to 1.00 s), and the shooter's own hits before contact stay at 2% of hp everywhere. The perfect kiter is an upper bound a human cannot reach with these controls: a right-click drops the lock, so every orb-walk step costs a right-click, a left-click to lock again, and a windup that starts at the click.

## What was tried and dropped

**Aiming (the first real-sim runs).** The first TS cut aimed a locked attack at its target as it lands or leaves, and an unlocked one where it was aimed when it started. With the tuned windups, in order:

| Run | Arrow aims at | Ball aims at | Policy matrix | Fails | TARGET LOCK |
|---|---|---|---|---|---|
| 1 | the start of the draw | the start of the cast | **7 of 10** | Bow > Sword 76% (Frost 0%), Bow > Axe 69% (Frost 0%), Wand > Shield 23% | 10 of 10 |
| 2 | release | release | **8 of 10** | Wand > Shield 22%, Axe > Wand 33% (Fire 0%, Sentenced 0%, Frost 0%) | 10 of 10 |
| 3 (final) | **release** | **the start of the cast** | **9 of 10** | Wand > Shield 23% | 10 of 10 |

- **Run 1.** An arrow aimed at the start of a 0.6 s draw leaves 0.6 s later along a line the charging melee fighter has already left (it walks 100 u in that time): the Frost column is 0% for Bow > Sword and Bow > Axe, Fire 78% and 44%. The bow's windup is long for Fire and Frost (0.6 s cap) and short for Plague (0.255 s), which is why only those columns break.
- **Run 2.** An arrow aimed when the draw ends (the old rule: the bow was aimed at release) restores both bow edges (100% and 96%), but a ball aimed when it leaves lands on a charging axe far more often (the likely reason: it is aimed at point-blank range): Axe > Wand falls from 92% to 33%. 9.1 tuned the wand with a ball aimed at the start of its cast, so the ball keeps that.
- **Run 3 (final)**, `1e85912`: **an unlocked arrow leaves along the aim held when its draw ends (as the bow loosed on release); a cast keeps the angle it started with.** A locked attack ignores both and is led at its target as it leaves. `decide` leads the bow for the lags alone, without its windup, since the arrow is aimed as it leaves.

**Longer wand windups (both against the final run, `--core`).** Wand > Shield was the one failing edge, so the wand windup was lengthened:

| Wand cap / share | Policy matrix | Wand > Shield | Axe > Wand | TARGET LOCK | orbwalk worst |
|---|---|---|---|---|---|
| 0.4 s / 0.8 (final) | 9 of 10 | 23% | 92% (Fire 67%) | 10 of 10 | x1.40 |
| 0.6 s / 0.8 | 9 of 10 | 20% (Fire 0%) | 90% (Fire 50%) | 10 of 10 | x1.19 (axe vs wand) |
| 1.0 s / 0.95 | 8 of 10 | 76% (Frost 0%) | **73% (Frost 0%)** | 9 of 10 (Axe > Wand 87%, Fire 33%) | x1.06 |

At 0.6 s the edge does not move (20%) and the orbwalk worst comes down from x1.40 to x1.19. At a nearly full-interval root (1.0 s cap, 0.95 share) Wand > Shield rises to 76% but the Frost column falls to 0% there and in Axe > Wand (73%), and Axe > Wand's Fire column is 33% even with locks: a wand that is rooted almost all the time stops being a ranged weapon. Both rejected; the wand stays at 0.8 / 0.4 s.

**The slows stay out.** Putting a move slow back would close Wand > Shield but undo the brief ("the attack animation will suffice"): the edge holds at 100% in the TARGET LOCK pass, where nobody backs away. See the next section.

## The one edge the windup cannot hold: Wand > Shield, policy matrix

The policy wand loses to the policy shield, 23% (Fire 33, Sentenced 0, Plague 56, Frost 0, Holy 28; by start distance 20% / 27% / 23%; 100% before). Per duel the shield lands 82.0 hits for 1067 damage to the wand's 58.1 hits for 769. What is known:

- **It is not the aim.** The result is 22% to 23% with the ball and arrow aimed at the start, at release, or mixed (runs 1 to 3), and 20% with a 0.6 s cap.
- **It is not the lock.** Both fighters clicking each other give 100% (Fire 100% too), the same weapons, the same windups.
- **It looks like the policy wand's back-off** (not isolated). The shared `POLICIES.wand` backs away when the foe is closer than 84 u (`retreatBelow`) and stands at about 147 to 176 u. Before, that retreat was near-impossible (0.1x while casting and recovering), so the wand stood and cast; now it walks, wastes casts and is rooted for 0.4 s of every cycle when the shield arrives. The harness's wand also sits against a wall more (`ticks stuck` 1.19%, 0.00% before) and hits less (63% of its balls, 83% before). A longer wand windup helps (76% at 1.0 s / 0.95: it stops walking), which points the same way.
- **The other wand edges are fine.** Wand > Bow 100%, and Sword > Wand and Axe > Wand are untouched.

Why not fix it here: the harness's policy wand is not what a player of these controls does (a locked wand never backs off; walking away is a right-click that drops the lock), the model and the lock pass both say the weapons are right, and the only levers that move the policy matrix are a move slow (which the owner replaced with windups), a longer wand root (rejected, above) or a different policy. **Reported, not changed.**

## Faction cycle and benches, before and after

- **`harness:factions -- --python`**: 60 of 60 cells agree with `realtime.py`, 7370 of 7370 pairs the same winner, largest hp fraction difference 1.00e-6. The output is identical to main's apart from the elapsed time (5.6 s -> 6.1 s). The chill still stretches the bow's draw and cooldown the way `realtime.py` says (the TS cycle under chill stays interval / m).
- **`--mode policy`** (moving fighters, 18 setups): mirrors 46 of 50 cells at 100% before and after (the four shield mirrors fail on both sides: Frost > Holy, Frost > Fire, Holy > Fire, Holy > Sentenced with the shield, 0%); signature openings 9 of 10 before and after (Plague > Frost with bow / shield 0% on both sides: `TUNING_10.md` section 6). Changed cells, worst hp of the designed winner before -> after: Fire > Plague wand mirror 66.3 -> 60.5, Holy > Fire wand 68.7 -> 71.0 and bow 69.8 -> 67.5, Fire > Sentenced bow 71.3 -> 72.8, Frost > Holy wand 60.4 -> 58.6; openings: Fire > Sentenced 42.8 -> 47.6, Fire > Plague 52.8 -> 47.4, **Holy > Fire (wand / axe) 64.3 -> 48.4** (the biggest), Holy > Sentenced (wand / bow) 24.7 -> 24.4 (still the thinnest opening).
- **Mob duels** (`bench/mobDuel.ts`, one scripted player per duel on the default policy style, 3 seeds): normal mobs (k 0.45) 83% -> 88% of duels won, 5 -> 3 pairings under 90% (Sentenced > Frost and Plague > Frost are won now, not isolated: the shooters are no longer near-rooted; still not won: Frost > Frost, Holy > Sentenced, Holy > Frost), mean hp left 67% -> 72%; elites 76% -> 80%, 19 -> 20 of 25 pairings (Fire > Holy, Plague > Frost, Frost > Frost, Holy > Sentenced, Holy > Frost not won; Sentenced > Frost is). The `--style stand` numbers CLAUDE.md quotes (24 of 25 normal) were not re-run.
- **`stepBench`** (8 players, 60 mobs): avg 0.091 -> 0.115 ms, p99 0.183 -> 0.234 ms.
- **Bandwidth** (per client, ws payload): typical 9.94 -> 7.34 KB/s (patch 7.62 -> 4.89), heavy 15.28 -> 9.98 (patch 11.30 -> 6.24), idle 4.06 -> 3.04. The drop is all in the patch, and probably the roots: a fighter that is winding up does not move, so its position does not change (not isolated). The `fx` share is within 0.25 KB/s. The margin to 20 KB/s grew from about 5 to about 10 KB/s.

## Open questions for the owner

1. **Wand > Shield in the policy matrix (23%).** Accept it (the harness wand is not how a player plays these controls: it holds at 100% in the TARGET LOCK pass), or give the harness wand a `stand`-only spacing (no `retreatBelow`), which the shared `POLICIES.wand` also hands to the wand mobs. Bringing a slow back would close it but contradicts the brief.
2. **The wand's cap (0.4 s).** The real-sim orbwalk worst is x1.40, against x1.06 for the bow, all of it the wand: a perfect kiter gets about 1.05 s to 1.15 s of free fire from a wand. Every Python cell holds with margin 1.08 or more, and a much longer wand root (1.0 s / 0.95) loses Axe > Wand and the Frost wand, while 0.6 s buys nothing for Wand > Shield (above). The cap cannot go under about 0.35 s (the Frost chill-kite).
3. **Committed windups.** Moving does not cancel an attack that has started (League's does), because mobs and the harness hold the trigger while moving. Letting a move cancel a player's windup is possible for locked players, but it changes what the kite model assumes (a shooter that cancels instead of finishing its shot).
4. **Click and lock guesses**: snap 64 u, an empty click does nothing (no attack-move), `TARGET_RANGE` 640 u as both accept range and leash, a 1.5 s line-of-sight grace counted from the last time the target was seen, a lock that survives a swap or a pickup, the shield facing the locked enemy, a locked shot that flies straight.
5. **The margin is a few percent.** Bow Fire > Plague x1.062 and wand Fire > Plague x1.078 are one hit of tolerance each from flipping (the same cell as 9.1's x1.16). A longer bow or wand range, a lower melee number or an attack-speed buff would be tested against `test_kite.py` first. The model assumes no attack-speed buffs; a buff shortens the interval and the windup together (share), so the rooted share of the cycle does not fall, but the chill-kite floor and the share-versus-cap crossovers were not re-run with buffs.
6. **Not re-measured.** Frost's axe against a chilled shooter (`TUNING_10.md` sections 4 and 8): the chill no longer has a recovery to leave out, but the weapon harness runs with signatures off and no `--python` cell covers it, so the old "2.7% hp in the worst case" number has no counterpart yet. The sight-corridor cap (480 u) is still twice the bow's range; mapgen was not touched.
7. **Bots** now play with locks only (`7e58dfc`, `BotClient` sends `target`, `move`, `stop`, `swap`, `pickup`, never `aim`, `attack` or `release`), so the e2e runs exercise the new controls; the old "bots aim with no lead" row of the client-view pass no longer describes anything but the harness's `stale` column.

## Tests

`npm test` on `1e85912`: 201 client, 3104 server (35 files, 31 s, the e2e bot runs included) and 895 shared, 4200 in all; `npm run typecheck` clean; `python3 testing/test_rpsls.py` ALL PASS (untouched); `python3 testing/test_kite.py` ALL PASS (it exits 1 at the old draw and cast windups, on purpose: that is its check).
