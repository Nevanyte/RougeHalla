# Wishes against the kiting and escape checks

Report only. **Nothing was retuned**: no faction, weapon or Wish number moved because of this file, and neither the weapon harness (`npm run harness -w @raid/server`) nor `python3 testing/test_kite.py` casts a Wish, so both are unchanged (`test_kite.py` still prints ALL PASS: 20 of 20 cells, the tightest Fire > Plague with the bow at x1.062). This file reasons about what each Wish does to them. The Wish rules are in `docs/GAME_DESIGN.md` 8.8, the numbers in `packages/shared/src/abilities.ts`; every one of them is a best guess.

## What the checks assume, and what a Wish breaks

`test_kite.py` (GAME_DESIGN 9.5) judges one approach at duel pace (`DUEL_PACE` 2): a melee winner starts one weapon range from an orb-walking shooter (it roots for its windup at each shot and walks away between them) and closes at 170 u/s to 60 u of reach. The cell passes if the weakest melee weapon's tolerance (how late it may arrive and still win half the duels) is at least the **orb-walk free fire**: the time the shooter fires before contact. Standing, that gap is 180 u for the bow (1.06 s) and 160 u for the wand (0.94 s). The ranged windups are the anti-kiting lever. Three premises sit under it: both sides walk at the same speed, nothing can stop a fighter mid-walk, and every edge is fought to the end (nobody leaves). The Wishes are the first tools that break them, one use per run (locked 45 s, then 300 s). They are flat, so `DUEL_PACE` does not scale them, unlike every faction damage number.

The numbers below are 170 u/s times the Wish's times. The rest comes from the same k = 2 what-if `test_kite.py` loads (method at the end).

| Wish | Time or distance it buys | Where it matters in the 20 cells | Verdict |
|---|---|---|---|
| Freeze | A 0.25 s cast (the caster does not move) then 1.25 s of stun: 212 u of chase for a stunned shooter, **170 u net** against one that keeps walking | Frost as chaser (Frost > Holy, Frost > Fire): the kite is cancelled. Frost as the shooter (Sentenced > Frost, Plague > Frost): at most 1.25 s more free fire | Cannot flip a cell. Frost's cells have tolerances of 8.75 s or more |
| Blaze Step | 300 u at once, no cast, through walls (1.76 s of walking) | Fire as chaser (Fire > Sentenced, Fire > Plague, the two tightest): free fire for that use goes to 0. Fire as the shooter (Frost > Fire, Holy > Fire): a delay of 1.76 s or more, not extra shots | Cannot flip a cell |
| Last Stand | +30% speed for 5 s: 221 u/s against 170 | Holy as chaser (Holy > Fire, Holy > Sentenced): free fire falls by a quarter to a half. Holy as the shooter: almost no extra free fire, but 255 u of separation by the end of the 5 s | Cannot flip a cell; widens Holy > Sentenced |
| Swarm | The chase is broken for up to 8 s (the lock drops and the chaser stops where it stands) | Plague as the shooter (Fire > Plague, Sentenced > Plague): none, a shooting Plague is revealed | Out of the model |
| Trial | x1.2 against the caster's damage, x0.8 on the subject's, for a 5 s ring; a 1 s stun if the subject leaves it | Sentenced as the shooter against Fire and Holy | **Can flip Fire > Sentenced** (what-if, below) |

## Freeze

The stun cancels the shooter's windup, so an orb-walk cannot continue through it: nothing leaves the bow or the wand and nothing walks away for 1.25 s. A chaser that casts from the shooter's own range (240 u bow, 220 u wand) closes 170 to 212 u of a 180 u (bow) or 160 u (wand) gap in that time, so one Freeze all but ends the approach. It is castable from 450 u (plus 32 u of slack), but a cast from far out only starts the approach: after the 0.25 s cast and the 1.25 s stun the chaser is still 240 to 280 u from a shooter that had been 450 u away. A shooter that keeps its distance does not escape it either: the cast is not a projectile, only range and line of sight stop it. Frost shooters use it the other way: 1.25 s of stunned chaser is 1.25 s of unanswered fire. The two Frost-loser cells then read 10.68 s / 10.48 s (Sentenced) and 13.38 s / 13.58 s (Plague) of tolerance against at most 1.70 + 1.25 s (bow) and 3.03 + 1.25 s (wand) of free fire: margins of x3.6, x2.4, x4.5 and x3.2, none close to 1.

## Blaze Step

A blink toward the cursor, up to 300 u, with no cast and no root. For a Fire chaser it lands next to, or on, a shooter at 240 u: the free fire of that approach is zero, whatever the windups. The blink is an order of its own, so it drops the lock: the Fire clicks its target again and the server walks and attacks from there. As an escape it buys 300 u, which an equal-speed chaser needs 1.76 s to re-cover, plus the detour when the line crosses a wall. It adds distance, not shots: a Fire that blinks away from Frost or Holy and then shoots still has the free fire it had (1.36 s bow, 2.19 s wand). The trail (30 true damage a second, lingering 2 s, about 60 for a crossing) is 3 to 4% of a Frost or Holy chaser's hp. It is true damage at a flat rate, so `DUEL_PACE` leaves it at what it is, while Fire's own damage doubled.

## Last Stand

`test_kite.py` and `kite_windup_sweep.py` assume equal speed; Last Stand adds 0.3 x 170 = 51 u/s for 5 s, which breaks it for the Holy only, for that long. With Holy as the chaser against a kiter at 170 u/s (the same orb-walk loop with the chaser at 221 u/s, no Frost chill):

| Cell | Free fire at 170 | At 221 | Tolerance (as is) |
|---|---|---|---|
| Holy > Sentenced, bow | 1.16 s | 0.85 s | 2.83 s (x2.45, then x3.3) |
| Holy > Sentenced, wand | 1.49 s | 0.95 s | 2.83 s (x1.90, then x3.0) |
| Holy > Fire, bow | 1.36 s | 1.05 s | 26.39 s |
| Holy > Fire, wand | 2.19 s | 1.22 s | 27.05 s |

With Holy as the shooter against a chaser at 170 u/s, the bow is rooted for 92% of its cycle and the wand for 63%, so there is hardly a walk to speed up: free fire 1.16 to 1.19 s (bow) and 1.44 to 1.59 s (wand) in Plague > Holy and Frost > Holy, whose tolerances are 19.5 to 21.1 s. As an escape the same 51 u/s opens 255 u over the 5 s against an equal-speed chaser, so one that started in reach (60 u) ends about 315 u away, past the bow's 240 u range and the wand's 220 u. The floor of 1 hp is what the model cannot see: it holds a fighter alive for 5 s whatever the free fire, and 30% of what it took comes back.

## Swarm

A hidden fighter cannot be locked (a lock on it drops the same tick and the chaser stops where it stands) and the browser cannot click it, so a chase ends. The model has no such event. What it does show is that a shooter cannot stay hidden: a fighter's own attack reveals it from the start of the windup until 0.5 s after it lands, and the Plague's bow cycles every 0.277 s (windup 0.255 s) and its wand every 0.328 s (0.262 s), so a shooting Plague is revealed from its first shot to its last. The kite cells (Fire > Plague, Sentenced > Plague) are unchanged: the shooter in them fires continuously. Swarm is an escape, not a kiting aid. One thing to watch in playtests: a Plague that shoots about once a second is hidden for a part of every cycle (0.76 s revealed, the rest hidden), which a human chaser may not be able to lock in time.

## Trial

Two things change. The **geometry**: the ring is 300 u, wider than the bow's 240 u and the wand's 220 u. A chaser that closes a retreating Sentenced covers 1.16 s x 170 = 197 u (bow) or 1.49 s x 170 = 253 u (wand) from where it stood when the ring landed, so it is 103 u or 47 u short of the edge on arrival; a Sentenced that keeps backing away drags it out, and leaving stuns it for 1 s (170 u of chase). The **damage**: the subject deals x0.8 and takes x1.2 from the caster, signatures included. Run through `kite_tolerance` with every Sentenced number x1.2 and the chaser's x0.8 for the whole duel (a what-if, in the loop of the method below):

| Cell (weakest melee weapon) | Tolerance as is | With Trial | Orb-walk free fire | Margin |
|---|---|---|---|---|
| Fire > Sentenced, bow | 1.89 s | 0.88 s | 1.16 s | x1.63 to **x0.76** |
| Fire > Sentenced, wand | 1.74 s | 0.83 s | 1.49 s | x1.16 to **x0.56** |
| Holy > Sentenced, bow / wand | 2.83 s | 0.00 s | 1.16 s / 1.49 s | x2.45 / x1.90 to 0 |

The Fire edge is a duel of 2.4 to 2.7 s, inside the 5 s ring, so the what-if is close to the real thing there: **a Sentenced that lands Trial on a charging Fire flips Fire > Sentenced in the model**. Two costs are not charged and pull the other way: the 0.35 s cast roots the Sentenced (no shot, and the chaser closes 60 u), which brings the bow cell back to about x1.1 and leaves the wand cell stolen (about x0.7); and the ring needs line of sight and 432 u at both the press and the landing. Holy > Sentenced is a 15 s duel, so a 5 s ring covers a third of it and the 0 s is an overstatement; how much is left needs a harness that casts. If the owner wants Fire > Sentenced kept, the levers to try are smaller multipliers (`TRIAL_DEALT_MULT`, `TRIAL_TAKEN_MULT`), a ring shorter than the duel (`TRIAL_MS`) or a longer cast (`TRIAL_CAST_MS`); none was measured.

## What is not covered

- Nothing here is a real-sim measurement. The harness would need a policy that casts (`decideCast` in `packages/server/src/bots/abilityPolicy.ts` already picks by intent) and a column for each Wish; until then the real-sim weapon edges and the KITING section are the pre-Wish ones.
- No attack-speed buff, relic or chill on the chaser is modelled, as in `test_kite.py`. A Frost chaser's chill on the shooter is left out, the conservative way.
- Freeze and Trial can also be cast on regional mobs, and a mob's inputs and AI stop while it is stunned. `bench/mobDuel.ts` does not cast.

## Method

- Free fire: `realtime.orbwalk_free_fire`'s loop copied with the chaser's speed as a parameter (221 u/s for Last Stand) and, for the Holy shooter, the shooter at 221 u/s for the first 5 s. Chill is not applied, as in `orbwalk_free_fire`.
- Tolerances: `realtime.kite_tolerance` after `test_kite.load_k2()`. For Trial, a copy of the k = 2 what-if with Sentenced's `hit`, `mark_ramp` and `mark_cap` x1.2 and the chaser's `hit`, `burn` and `backlash` x0.8 (Holy: `hit` only), taking the weakest of sword, axe and shield.
- Fight lengths: `realtime.duel` on time (`act_start` 0), median `t`: Fire > Sentenced 2.4 to 2.7 s, Holy > Sentenced 14.7 to 15.0 s, Sentenced > Plague 4.3 s, Sentenced > Frost 10.2 to 10.5 s.
- Closed forms: 170 u/s times 0.25 s, 1.25 s, 1 s, 5 s and 8 s; 300 u / 170 u/s = 1.76 s. The scratch scripts are not kept in the repo.
