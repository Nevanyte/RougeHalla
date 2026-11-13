# Quest value model

Status: design draft (owner discussion 2026-11-13). A rough pricing model, not a contract. The numbers come from one
`camp_bench --quick` run (seed 1, level 1, no cards) and a straight-line pass over
`crates/rh-sim/src/mapdata/fixtures/seed1.map.json`. They are an order-of-magnitude calibration, to be replaced by
P-BALANCE-3 and fuller bench runs.

## 1. Premise

The game has no gold, and its only currency is stats. Every match ends in the coliseum fight, which is the single
payout. So every reward is priced in **camp-equivalents (CE) at coliseum time**: how many camps of farming it is worth.
A quest is a trade. You give up the camps you could have farmed during the quest in exchange for the reward.

## 2. Symbols

| Symbol | Meaning | Rough value (calibration) |
|---|---|---|
| `t` | current match time (min) | |
| `T` | coliseum start (min) | design choice |
| `R = T − t` | remaining farm time (min) | |
| `s` | stacks per camp (4 normal mobs × `kill_stacks` 3; elites give none) | 12 |
| `w` | walk seconds per camp (greedy whole-map tour, ×1.3 path detour, 170 u/s) | ≈ 6 |
| `k_t` | kill seconds per camp | 9.5 (sword) – 16.5 (wand) |
| `o` | overhead seconds per camp (aggro, reposition) | ≈ 2 |
| `h` | heal-up downtime seconds per camp | unmeasured (0 in the table) |
| `cyc = w + k_t + o + h` | seconds per camp | 17.5 – 24.5 |
| `c = 60 / cyc` | solo camps per minute | ≈ 2.45 – 3.43 (use 2.9) |
| `κ = k_t / cyc` | kill share of the cycle | ≈ 0.54 – 0.67 (use 0.6) |
| `N, ρ, n` | camp count, respawns per camp per minute, players competing | 50 on seed 1, unknown, ≤ 29 |
| `π` | quest premium over break-even | 1.15 (legacy `STACK_PREMIUM`) |

**Effective rate (supply cap):** `c_eff = min(c, cap)` with `cap = (N·ρ + N/T_0) / n`, the camps available per player per minute.
Here `T_0` (min) is how long the initial camps last, i.e. the spawn-to-coliseum window. Once camps run short, `c_eff` falls, and every quest gets cheaper. That makes scarcity a design
lever: crowded maps push players toward quests.

## 3. Cost of a quest

A quest attempt takes `τ` minutes, succeeds with probability `p`, and a failure costs `L` CE beyond the lost time (death
timer, lost HP, lost position). Assume the player retries until it succeeds, and that attempts are independent. The
expected number of attempts is `1/p` and the expected number of failures is `(1−p)/p`:

```
E[C] = c_eff · τ / p  +  L · (1 − p) / p                          (CE)
L    = c_eff · downtime_min        (death timer + heal-up after failing, in minutes)
```

Failures usually end early, so charge a failed attempt `f·τ` (with `0 < f ≤ 1`) instead of `τ`:
`E[C] = c_eff·τ + (1−p)/p · (c_eff·f·τ + L)`. With `f = 1` this reduces to the formula above.

If the player abandons the quest after one failure instead of retrying, the cost is `c_eff·τ + (1−p)·L`, and the value
is multiplied by `p`, so `E[V] = p·V`.

**The three difficulty dials** each move a different term:
- **Time** `τ` scales cost linearly and is the same for every player. It is the fair dial.
- **Risk** `p` scales cost as `1/p`. Since `p` rises with stats, a risky quest is cheaper for the player who is already
  ahead, so it snowballs.
- **Skill** also moves `p`, but by player rather than by stats. It is the only dial that rewards play over farming.

## 4. Value of a reward

### 4.1 Permanent buff: a perpetuity that compounds
It has a direct stat worth `b` CE (stacks given ÷ `s`, for stats that camps also give; otherwise use duel equivalence,
§4.4). It also has a farming dividend when it speeds the cycle up. A damage bonus `d` (fraction) cuts kill time by the
factor `1/(1+d)`, so:

```
g(d)  = cyc / (cyc − k_t·d/(1+d)) = 1 / (1 − κ·d/(1+d))                (rate multiplier)
V_P   = b + (min(g·c, cap) − c_eff) · (R − τ)                          (CE)
```

The reward arrives after the quest, so the dividend runs over `R − τ`. Under the supply cap a faster cycle earns no
extra camps, so the dividend goes to about 0. On crowded maps, quests get cheaper but buffs are also worth less. With
no cap this is `b + (g − 1)·c·(R − τ)`. `κ` is an upper bound: part of the kill time (aggro, gaps between mobs) is not
limited by damage.

A move-speed bonus `m` gives `g = 1 / (1 − (w/cyc)·m/(1+m))` instead. With `w/cyc ≈ 0.3`, that is about half as
strong as damage early on. The dividend is first-order only: stats from the extra camps would also compound, but that
term is ignored here.

### 4.2 Single-use spell: an option
It gives no farming dividend and all its value lands in the coliseum. Find the stat gap `Δ` (in CE) at which a fighter
**without** the spell wins as often as one **with** it, using paired duels or a cheap estimate:

```
V_S = Δ_S                                                               (CE, flat in t)
```

### 4.3 Cooldown spell: an annuity
It pays in every fight and on every camp:

```
V_CD = Δ_CD  +  (min(g_CD·c, cap) − c_eff) · (R − τ)
g_CD = 1 / (1 − κ · e · min(1, D / cd))
```

Here `Δ_CD` is its coliseum duel equivalence, `e` is the kill-time fraction saved during one use window of length `D`,
and `cd` is the cooldown. Since `D/cd` is the uptime, `κ · e · uptime` is the cycle fraction saved, which matches the
logic of `g(d)`.

### 4.4 Duel equivalence (shared by 4.2 and 4.3)
Run `Δ` as a step search. Give the spell-less fighter `+x` CE of stats, raising `x` until the win rate is 50%. That `x` is
`Δ`. It is one search per spell, not a proof.

## 5. Slots

You can hold at most two spells, swapped and dropped at will. Permanent buffs take no slot, and slots only hold
single-use and cooldown spells. With both slots full, the marginal value of a new spell `X` is:

```
V_marg(X) = max(0, V(X) − min(V(held_1), V(held_2)))
```

Full slots shrink quest value automatically, which pushes players back to camps. That is intended. A single-use spell
that has been spent frees its slot.

## 6. Balance condition and the two knobs

```
V(reward, t)  =  π · E[C](τ, p, L, t)
```

Strength and difficulty are dual: either side can be moved. The rule is to **fix the reward by design intent** (what it
should feel like in the coliseum) and **tune the quest** (`τ` first, then `p`) to price it. Change reward strength only
when a spell's coliseum effect is wrong, not when it is mispriced.

**Indexing.** `V_P` and `V_CD` decay as `R` shrinks, but `E[C]` does not. To keep one quest fair throughout the match,
scale its time with the clock:

```
τ(t) = p · ( V(t)/π − L·(1−p)/p ) / c_eff
```

This is the time-only form. Alternatively, accept the decay and let players choose the timing themselves.

## 7. Crossover (the intended choice)

`V_P` and the dividend part of `V_CD` fall linearly with `R`, while `V_S` is flat. The crossover with a single-use spell
is at:

```
R* = τ + (Δ_S − b) / ((g − 1) · c_eff)    (buff vs single-use, uncapped)
```

While `R > R*` (early), take the buff. Once `R < R*` (late), take the spell. The design target is `R*` inside the match, so that both choices
make sense at some point.

## 8. Worked example (c_eff = 2.9 camps/min, κ = 0.6, s = 12, π = 1.15)

**Permanent +10% damage** (10 stacks of 1%, so `b = 10/12 = 0.83` CE):
`g = 1/(1 − 0.6·0.0909) = 1.0577`, giving a dividend of `0.0577 · 2.9 = 0.167` CE per remaining minute.

| R (min left) | V_P (CE) |
|---|---|
| 8 | 0.83 + 0.167·7.25 = **2.04** |
| 4 | 0.83 + 0.167·3.25 = **1.38** |
| 1 | 0.83 + 0.167·0.25 = **0.88** |

(These use quest time τ = 0.75 min, uncapped.)

**Quest A, time only:** `τ = 0.75` min, `p = 1`, `E[C] = 2.9·0.75 = 2.18` CE, so it needs `V ≥ 2.50`.
→ The quest is **overpriced for its reward even at R = 8** (2.04 < 2.50), so nobody should take it. Fix: about a 37 s
quest (solve `0.83 + 0.167(8 − τ) = 1.15·2.9·τ`, which gives τ ≈ 0.62 min), a bigger buff, or indexing.

**Quest B, risky:** `τ = 0.75`, `p = 0.8`, death costs 15 s, so `L = 2.9·0.25 = 0.725` CE.
`E[C] = 2.72 + 0.725·0.25 = 2.90` CE, so it needs `V ≥ 3.34` CE.

**Single-use spell, Δ_S = 2.5 CE** (to be measured): crossover with the +10% buff at
`R* = 0.75 + (2.5 − 0.83)/0.167 ≈ 10.7` min left. With more time left than that the buff is better, and with less the
spell is. If the farm phase is shorter than about 10.7 min the buff never wins, so lower `Δ_S` or strengthen the buff.

## 9. What this model leaves out
- Coliseum value is not linear in CE: a damage stack and an HP stack differ, and `Δ` depends on the opponent's
  stats. Measure `Δ` against a typical opponent at the expected `T`.
- Second-order compounding (stats from the extra camps also grow farming).
- PvP interruption while farming or questing, and contested camps.
- Variance: two quests with the same `E[C]` and different `p` are priced the same, but risk-averse players will prefer
  high `p`.
- Heal-up downtime `h` was not measured. If it is large, `c` roughly halves and every quest gets about 2× cheaper.
- Calibration comes from one map, level 1 and no cards.

## 10. Relation to legacy constants
`crates/rh-sim/src/constants.rs`: `FARM_SECONDS_PER_MOB = 12`, `CAMP_SECONDS = 48`, `TRAVEL_RATE_SHARE = 0.4`,
`STACK_PREMIUM = 1.15`, `QUEST_STAT_STACKS_PER_FARM_EQUIVALENT = 2.5`, plus `parity_gv()` in
`crates/rh-sim/src/quests/rules.rs`. These already price quests as farming time. This model extends that to spells,
with compounding, risk and slots. The legacy 48 s per camp is about 2× the measured 17–25 s solo cycle, which is
plausible once `h`, contention and travel share are included. Re-tune it once those are measured.
