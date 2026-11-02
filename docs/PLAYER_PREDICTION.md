# Predicting players so ping feels faster

Status: **research and plan, with Stage 0 and Stage 1 shipped**. Only what "Shipped in this pass" lists is built.
Local numbers come from `bench/predictBench.ts` bot runs on 2026-11-02 and a plain-JS cost microbenchmark. Sources
are at the end.

The question: can a very light ML model predict a player's next action from state and prior actions, using how
enemies moved, reaction delay and mouse and keyboard habits, so that ping feels faster and combat smoother than
naive "current direction = next direction"?

**The rule this document never bends.** The server is authoritative. A prediction may change what a client DRAWS.
It never changes what HAPPENS. The sim never consumes a predicted input, position, aim or attack. Every hit, root,
kill and order is decided from real inputs, exactly as today. A prediction the server acted on would change outcomes
for the opponent and could be gamed.

## The short answer

1. **A tiny model is cheap.** A 3,100-weight multilayer perceptron (MLP, a small dense neural network) costs about
   1.2 µs per fighter per tick in plain JavaScript. Eight players at 20 Hz is 160 calls a second, under 0.2 ms of
   CPU a second. Compute is not the limit.
2. **The server already knows the near future between orders.** It holds each player's path, held key and windup.
   Walking that path forward ("pathFollow") is off by 0.02 u at 100 ms when no new order arrives. 88-93% of all
   prediction error comes from a new order landing inside the horizon.
3. **What is left to learn is when the next order comes and which way.** Human reaction time, about 220 ms, puts a
   floor under both. No model foresees a choice the player has not made yet.
4. **No shipped game uses a learned input predictor.** Rollback fighting games, Overwatch, Valorant and Rocket
   League repeat the last input when one is missing, and spend their effort removing fixed delay.
5. **The legitimate uses are presentation only.** Draw remote fighters a bounded distance ahead. Let a tiny learned
   gate decide how far to trust that. Draw your own actions at the click. Never feed a guess to the sim.

Your own inputs need no prediction. The client knows them the moment you press, and main already draws their result
at once. The latency you still feel is in the remote picture.

Naive extrapolation feels rubbery because it walks through every turn and stop, then pulls back. In the bot traces a
turn or stop falls inside 100 ms in 14.6% of samples. A wrong 100 ms guess costs 17 u, double for a reversal,
against a 12 u body radius. A smarter model does not cure that alone. A short horizon and corrections that never
swing back do.

## Where the milliseconds are

Main today: the local fighter is predicted (`net/localMotion.ts`). Own attack animations play at the click
(`RaidScene.localAutos`, `FxView.localAuto`). Remote fighters are interpolated behind the adaptive `RenderClock`
(`shared/interp.ts`), 70 to 150 ms in the past, with no extrapolation. Player melee has no windup and lands at once.

| Segment | On main | Lever |
|---|---|---|
| Opponent's uplink, half of an 85-97 ms ping | about 45 ms | routing only |
| Wait for the next 50 ms tick | 0-50 ms, 25 on average | sub-tick timestamps, decision 3 |
| Downlink | about 45 ms | one WebSocket frame per tick, not two: unconfirmed lead |
| Remote interpolation delay | 70-150 ms, adaptive; 70 on a good link since the tick pacer shipped (see "Shipped in this pass") | bounded draw-ahead, Stage 2 |
| Own attack animation | drawn at the click | done |
| Own keyboard walk | sent from the key event since this pass; the server applies it up to a frame sooner (−3.4 ms mean at 144 Hz, −7.4 at 60 Hz); the presser's own picture is unchanged | done |
| Own weapon swap, Wish telegraph, own melee hit | shown at the key or with the state patch since this pass | done |

The research tree's delay floor was 75 ms. Main's is 70 ms.

Own-input delay hurts about twice as much as network delay. Liu et al. tested 68 CS:GO players. Cutting 100 ms of
local latency added 6 accuracy points; the same cut in network latency added 2. Experienced players notice
own-input delay from about 25-60 ms. Main already covers the largest own-input items: the walk is predicted at
the click, attacks are drawn at the click, and since this pass the swap, the Wish telegraph and the potion key follow
the press. The keyboard change moves the server's apply time, not the presser's picture.

## What is physically possible

**Reaction time is the wall.** Simple visual reaction time is about 213-231 ms (Woods 2015, n = 1,469) and about
220 ms for gamers (Xu & Claypool 2025). Corrections to a hand already in motion start at about 110 ms (Brenner &
Smeets). An opponent's reaction to something the server did at time T0 reaches the server no earlier than about
T0 + 365-450 ms.

| Horizon | What happens | Who can know it |
|---|---|---|
| under about 110 ms | the next move is already decided | the server: path, held key, windup |
| 110-250 ms | fast corrections and planned rhythms such as jinks and kiting cadence | a model can learn the rhythm |
| beyond about 250 ms | new choices dominate | nobody |

**The error-latency trade.** A player walks 170 u/s. A wrong guess costs speed times horizon: 8.5 u at 50 ms and
17 u at 100 ms, double for a reversal. Shipped systems predict far less than the full latency: Chrome 24 ms of
pointer movement, rollback games a few frames, Source at most 0.25 s.

**Measured on this game.** `predictBench` plays headless bot runs, traces every standing player each tick and scores
four predictors. `hold` stays put. `constantVelocity` keeps the last 100 ms of velocity; this dead reckoning is all
a remote client can compute today from synced positions. `holdLastSteer` walks straight at the last move order's
point, and `pathFollow` walks the server's path in hand, both with the known roots. Those two read orders and paths
that only the server holds. They show what a client could reach with a synced walk hint, not what it reaches today.

Mean / p95 error in world units, where p95 is the 95th percentile. Three runs of 4 bots, 7,249 rows. A tile is 32 u.

| Predictor | 50 ms | 100 ms | 150 ms | 200 ms | 250 ms | 300 ms |
|---|---|---|---|---|---|---|
| hold | 3.6 / 8.5 | 7.0 / 17.0 | 10.3 / 25.5 | 13.4 / 34.0 | 16.4 / 42.5 | 19.3 / 51.0 |
| constantVelocity | 1.3 / 8.5 | 3.2 / 17.0 | 5.4 / 25.5 | 7.8 / 34.0 | 10.3 / 42.7 | 12.9 / 51.0 |
| holdLastSteer | 2.0 / 9.8 | 4.3 / 18.3 | 6.8 / 27.8 | 9.4 / 36.2 | 12.1 / 45.6 | 15.0 / 54.0 |
| **pathFollow** | **0.5 / 5.1** | **1.5 / 16.7** | **2.8 / 24.6** | **4.5 / 33.7** | **6.3 / 39.6** | **8.3 / 48.5** |
| pathFollow, no new order in the horizon (mean) | | 0.02 | | 0.04 | | 0.05 |

A turn over 45 degrees or a stop falls inside the horizon in 9.4% of samples at 50 ms, 14.6% at 100 ms, 22.7% at
200 ms and 29.8% at 300 ms. A new walk order lands in 12% of 100 ms horizons and 31% of 300 ms horizons, and those
samples carry 88% and 93% of the error. The p95 values are whole ticks of walking: a guess that is right but one
tick late still costs 8.5 u.

Read these numbers with care.

- **They are bot traces.** The bots in them never steer with the keyboard and re-plan on a 250 ms clock. Humans do
  neither.
- **Splits move between run sets.** The first analysis found the bow hardest, with a new order in 16% of 100 ms
  horizons, and in this run ranged weapons are harder than melee for pathFollow: 2.1 u against 1.1 u at 100 ms. A
  second set of three runs, 10,176 rows, flips that: 1.5 u against 1.7 u. pathFollow overall stays at 1.5 u at
  100 ms in both sets; constantVelocity moves from 3.2 u to 3.6 u. Read the shape, not the decimals.

The literature agrees. On NBA tracking, constant velocity beats every neural model up to 0.12 s, and learned models
win only past 0.3-0.4 s (Schelenz). Constant velocity also beats neural pedestrian predictors (Schöller 2020). In
Walker 2023 every method is accurate at 200 ms and below. Input-aware extrapolation beats position-only (Pantel &
Wolf 2002); pathFollow is the input-aware kind.

## What shipped games do

| Game | Late or missing input | Where the effort went |
|---|---|---|
| GGPO, rollback fighting games | repeat the last input, rewind on error | cheap resimulation; one developer said even a 10% wrong-guess rate would feel worse |
| Overwatch, GDC 2017 | the server repeats the last input | the client runs ahead by half the round-trip time (RTT) plus a frame; redundant inputs; time dilation. Damage is never predicted, hit effects not above about 220 ms RTT. |
| Valorant | the server assumes held keys stay held | 128 Hz tick, a minimal input queue, Riot Direct routing |
| Rocket League, GDC 2018 | the previous input when the buffer is empty | input-buffer throttling; the ball is predicted, other cars are not |
| Halo: Reach, GDC 2011 | none | predicting Armor Lock's invulnerability was pulled from the game |
| League of Legends | none | optional "movement prediction", off by default, stutters at low ping |

Learned predictors appear only in research and patents. Outatime (Microsoft) masks about 120 ms of cloud streaming
with an order-1 Markov model per input axis. Halbhuber 2021 and 2022 found dense neural nets improved scores and
mood, but compared against no constant-velocity baseline. Valve and Microsoft patents describe per-input confidence
thresholds, a repeat-last fallback and smoothed corrections. Stadia's "negative latency" was never published. None
of this work measures a gain over an intent-aware baseline like pathFollow.

## Methods that fit a 20 Hz TypeScript server

Costs per inference in plain JS on node with `Float32Array` weights. The load is 160 calls a second.

| Model | Size | Cost per call | Fit |
|---|---|---|---|
| Alpha-beta or double-exponential smoothing | 2 gains | 0.02 µs | smoothing aim or corrections |
| Logistic hazard: P(order change within k ticks) | about 20-70 weights | 0.014 µs | the first learned rung |
| Contextual semi-Markov table over the 9 WASD states | about 650 numbers | 0.009 µs | the next direction |
| MLP 66-32-16-27 | 3.1k | 1.2 µs | only if the tables leave error |
| GRU-16 / GRU-64 | 1.3k / 14k | 0.6 / 7.7 µs | no evidence of a gain below 300 ms |
| LSTM-128 / a 330k dense net | 71k / 330k | 40 / 201 µs | oversized |

A hazard is the probability that an event happens within the next k ticks. A semi-Markov table gives the odds of the
next state from the current one and how long it has lasted. A gated recurrent unit (GRU) and a long short-term
memory (LSTM) are recurrent networks that carry a hidden state from tick to tick.

**The right shape is a deterministic core with a tiny learned gate on top**, not a trajectory regressor.

1. **Core:** pathFollow with the known roots of windups, stuns and casts, clipped at walls. On main player melee has
   no windup, so melee gives the core no committed root to read. Ranged windups still do.
2. **Hazard heads:** P(new walk order within 1, 2, 4 or 6 ticks) and P(attack press within 1, 2 or 4 ticks).
3. **Direction head:** given a change, which of 9 states comes next, 8 directions or stop. This splits "when" from
   "what" (Ehlert). Order-1 models suffice (Outatime).

The owner's ideas become features.

- **How an enemy has moved:** closing and lateral speed toward the nearest enemy, in-range flags, a kite or chase
  score, and whether that enemy is winding up while aimed at this player.
- **Delayed reaction speed:** time since the newest salient event could have reached this player's screen: an enemy
  windup, an incoming projectile, a hit. A change before that is rhythm, not a dodge.
- **Keyboard:** dwell time per direction, changes in the last 2 s, rhythm variance.
- **Mouse:** aim angular speed, aim against walk angle, aim against enemy bearing. A pointing movement is predictable
  near its end, within 39-83 px (Pasqual & Wobbrock). Nothing predicts when a click starts.

Most of these features live on the server, which sees orders, key timing and aim. A remote client sees synced
positions and facing. A gate that reads keyboard rhythm therefore runs on the server and only sets the walk hint it
publishes, within the hint's cap.

**Rubbery against bounded.** Rubbery means the drawn fighter blends between guesses, or its corrections swing back
and forth. Bounded, single-direction means a guess is wrong by at most the draw-ahead budget, and each correction
moves the drawn fighter toward the truth and never past it. The rules:

- Draw the most likely outcome, the walk continuing. Never draw a blend of probabilities.
- Never draw a predicted turn, stop or attack.
- Let the hazard only lengthen or shorten how far ahead continuation is trusted.
- Correct with a decaying offset that never alternates direction. Outatime calls the alternating kind "shake".
- Snap past about 32 u. Kenny et al. rated snaps no worse than blends, so calibrate the threshold.

## Legitimate uses and cheating

| Use | Verdict |
|---|---|
| Apply a predicted move, aim, attack, target or cast in the sim | **No.** It changes outcomes and can be gamed. |
| Server keeps walking a late keyboard order | **Already safe.** The keyboard goal is at most 64 u ahead, about 376 ms of held key: Valorant's held-key rule. Never walk past the client's goal. |
| Predicted positions in hit tests, rewind, homing or tie-breaks | **No.** That is a balance change. |
| Draw remote fighters slightly ahead of the newest sample | **Yes, the main payoff.** Presentation only and bounded. The attack's `t` stays inside published history. |
| A hazard model sets each remote fighter's draw-ahead | **Yes.** It moves only pixels, within a budget. |
| My own windup or cast drawn at the click, keyed by `seq`, removed if refused | **Yes.** Unreal's prediction keys, Halo's muzzle flash first. Main does this for auto attacks and, since this pass, for the Wish telegraph. Never show immunity, Last Stand or the hiding itself early. |
| Date a windup's start to the order's arrival inside its tick | **The owner's call.** A bounded rule favouring the sender, like Outatime's time-shifting and Counter-Strike 2's sub-tick input. It saves 0-50 ms using only the server clock. |
| Precompute paths for the likely next order | **No payoff.** Keyboard goals skip A*. |

One interaction matters on main. A click attack with any weapon but the wand sends `attack` with `t` set to the
render time, and the server rewinds melee to that `t`. If remote fighters are drawn ahead while `t` stays at the
interpolated time, the player aims at a spot ahead of the one the server tests: 8.5 u for each 50 ms of draw-ahead.
Projectiles fly in present time, so a fresher picture helps a bow shot. Decision 5 covers melee.

## Staged plan

**Stage 0: remove fixed delay, no prediction.** Confirm each lead in code first.

- Own attacks drawn at the click: done on main. Any other own telegraph that still waits for the server follows the
  same pattern, keyed by `seq` and dropped on a refusal or `cancel`.
- Send the keyboard order on keydown, and read the aim as late as possible: both shipped in this pass.
- Fix the room clock: patches really did arrive 51 ms apart with a two-tick patch every few seconds; the tick pacer
  shipped in this pass fixes it.
- Keep delay changes slow. Main's `RenderClock` already slews rather than steps. Steady ±50 ms jitter is harmless;
  step changes are not (Schmid 2023; Halbhuber 2022).

**Stage 1: data and harness.** The trace harness is on main since this pass. `TRACE_INPUTS=<path>` appends every arena
run's movement trace (`sim/trace.ts`) as JSONL. `bench/predictBench.ts` runs headless bot rooms, traces them and
scores the baselines in `sim/predictBaselines.ts` at 50-300 ms. It reports and never fails. Extend it with:

- splits by weapon, faction, input mode, combat, RTT bucket, and bot or human;
- mean, p95 and p99 error, and turn and stop precision and recall;
- the hazard's Brier skill, its gain over always guessing the base rate; its expected calibration error (ECE, the
  average gap between predicted probability and observed frequency); a "shake" count;
- a client-view replay through the real `EntityInterpolator` under stable, spike and stall network profiles.
  `bench/netProbe.ts` already runs the client's own net code headless on main.

Add RTT, arrival time and steer heading to the trace rows.

**Bot traces are not enough.** A model trained on bot traces learns the bots' 250 ms re-plan clock and nothing about
humans. A toy logistic hazard on them, held out by run, scored an AUC of 0.72-0.82 (the area under the ROC curve:
0.5 is chance, 1 is perfect), and what it learned was that clock. Collect human traces with consent, and hold out
whole runs and whole players. Raw traces cost about 288 MB/h at 8 players.

**Stage 2: deterministic draw-ahead, no ML.**

- Append two presentation mirrors per player. `walkDir` is the heading as a uint8. `walkTicks` is the committed ticks
  left, capped at 3 so a destination never leaks, and 0 while hidden. On main, new per-player synced fields go in
  `PlayerState.extra`, past Colyseus's 63-field limit.
- The client draws up to min(cap, RTT/2) past the newest sample and stops at the roots it knows from fx.
- It corrects with a decaying, speed-capped offset, the `localMotion.ts` pattern, and snaps past about 32 u.
- This reverses the documented "no extrapolation" decision for remote fighters.

**Stage 3: the tiny learned gate.** Climb a ladder, shipping each rung only if it beats the previous one on held-out
human traces: a logistic hazard; then a semi-Markov table mixed with pathFollow in the style of an interacting
multiple model filter (IMM, which weights several motion models by how well each explained recent motion); then the
3k MLP. Train offline in numpy, generate a TS weights file, and pin a Python/TS parity test. The hazard sets each
fighter's draw-ahead: long when steady, short when a change is likely.

**Stage 4: online adaptation.** Feed per-player running statistics, such as dwell time, jink rate and reaction lag,
into the model as features. At most, add a per-player bias to the hazard, decayed over time and reset each run.
Never update the shared weights online.

### What each step buys

| Change | Gain | Error cost | Confidence |
|---|---|---|---|
| Own attack drawn at the click | own-attack feedback from about 150-250 ms to one frame | a refused animation vanishes | shipped on main for auto attacks |
| Keyboard order on keydown | key to send 2.5-3.0 ms to 0.2 ms at 144 Hz, 7.5-8.0 to 0.6 at 60 Hz | up to 8.5 u for one tick on a chord or turn; +0.1 / +0.6 orders a second | shipped, measured |
| Steadier patch clock | remote render delay 79 to 70 ms at RTT 0, 87 to 77 at 30 ms, 106 to 96 at 60 ms (means); two-tick patches 1.4-2.6% to 0% | none | shipped, measured |
| Sub-tick windup start | 25 ms on average, 50 ms at most | a rule change | the owner's call |
| Stage 2 draw-ahead | remote fighters 50-75 ms fresher | toward 0.5 u mean, 5.1 u p95 with the hint; 1.3 u and 8.5 u without | bots only |
| Stage 3 gate | target: 15% less error than Stage 2 at 100-200 ms | gated | unknown |

The Stage 2 error figures are pathFollow and constantVelocity at 50 ms, computed on the server. No client
draw-ahead has been measured yet.

### Acceptance tests

| Gate | Pass condition |
|---|---|
| No outcome change | Same seed and inputs with the predictor on and off: every field but the new mirrors is identical tick for tick. |
| Displayed age | Mean remote-fighter age drops by at least 50 ms on the stable profile. |
| Fabrication error | mean ≤ 1.5 u, p95 ≤ 8.5 u, p99 ≤ 17 u |
| Visible corrections | A jump over 4 u in one frame on at most 2% of combat frames; no snaps under 32 u. |
| Cost | At most 5k parameters and 10 µs per fighter per tick. The stepBench and bandwidth gates hold; the mirrors add under 0.3 KB/s. |
| Learned gate | On held-out human runs: at least 15% lower mean error, p95 at most 2% worse, no split worse by over 5%, Brier skill ≥ 0.10, ECE ≤ 0.03. |
| Feel | A blind A/B test at an emulated 90 ms RTT, counting snaps per minute plus a forced choice, reported per RTT bucket. |

## Shipped in this pass

Merged into main from branch `claude/netcode-latency` on 2026-11-02. Every item is presentation or scheduling, except
two changes that are not: the hit fx carries a new passive flag bit (wire, append-only) and the server's
`MAX_MESSAGES_PER_SECOND` rose from 100 to 200. No hit, root, kill or order is decided differently. Numbers are from
`bench/netProbe.ts` and `netProbeMatrix.ts` runs on private ports, or from the real-sim harness where said; before and
after are means unless marked p95.

| Change | Where | Measured |
|---|---|---|
| Grid-locked tick pacer replaces core's `setInterval` plus the integer accumulator | `rooms/tickPacer.ts`, `RaidRoom` | two-tick patches 1.4-2.6% to 0%; patch gap p50 51.1 to 50.0 ms; remote render delay 79 to 70 ms at RTT 0, 87 to 77 at 30 ms, 106 to 96 at 60 ms (p95 95 to 71, 106 to 85, 137 to 110); the wake counters are on `/readyz` |
| Trace harness for Stage 1 | `TRACE_INPUTS`, `sim/trace.ts`, `sim/predictBaselines.ts`, `bench/predictBench.ts` | refused while hosting, file capped; bot movement only (scripted A* paths, no WASD), on main, 3 runs, 21,490 rows: at 100 ms over all samples pathFollow 1.0 u mean / 8.5 p95 and constant velocity 1.8 / 14.4 (the bench's own report of that run, which is not in the repository; the tables above are an earlier set of runs), and over the moving samples, as `ce2abe1` records, mean error hold 16.8 u, constant velocity 2.2, pathFollow 1.2 |
| WASD orders leave from the key event; `orderMove` sends before it plans the path | `RaidScene`, `net/keyboardMovement.ts` | key to send 2.5-3.0 to 0.2 ms at 144 Hz, 7.5-8.0 to 0.6 at 60 Hz; the server applies the order −3.4 ms (144 Hz) and −7.4 ms (60 Hz) sooner on average; the presser's own picture is unchanged |
| Optimistic weapon swap, the swap rule shared with the server | `net/localHand.ts`, `shared/interactions.ts` | first patch showing the new hand p50 27-36 ms (ping 0-1) to 275-276 ms (ping 252) before; the predicted hand shows on the probe's next 144 Hz loop frame (7 ms, a property of the probe's model, not a scene frame); clicks inside the round trip routed by the wrong weapon 31-84% before, 0 by construction after |
| The caster's own Wish telegraph at the key press; the potion key checked locally against the server's refusal list | `RaidScene`, `render/WishFx.ts` | Freeze, Trial and Swarm telegraphs 139-334 ms after the press (RTT 0-120) to the press frame; a refusal ends it at the `seq` echo |
| Own melee hits and blocks presented with their state patch | `render/FxView.ts`, `RaidScene` | 90-142 ms mean wait to 3.5 ms; returned damage (a riposte, a reflected arrow) is flagged on the hit fx so it is never drawn as an own blow |
| Tick-phase-aligned aim stream and held right button | `net/uplinkPace.ts` | sim model (45 ms each way, 144 fps, grid tick): mean aim age 72 ms old gate, 59 floor, 53-57 aligned at ±0-6 ms, no gain at ±10 ms or at 60 fps; against a real server (before the pacer) the probe measured the floor only (mean 129 / 140 / 147 to 116-120 / 124-128 / 132-135 ms); the aligned gate is active only on a grid-waking server above about 67 fps, else the floor |

Not done, by the owner's decision list below: the remote draw-ahead of Stage 2, the walk hint, sub-tick windup
starts, and a fresher melee `t`.

### Follow-ups from the deploy review

The deploy-risk review passed the pass (SHIP) and listed three things it did not fix. They are fixed on
`claude/netcode-followups`, each with a test; none changes a hit, a root, a kill or an order.

- **Overkill's spill-over is returned damage on the wire.** The splash entry (`sim/cardHooks.ts`) names the holder's
  weapon and lands on a third fighter, so it is now `passive` like a riposte: its hit fx carries the +128 flag and the
  holder's client draws it at render time, not as its own swing with the patch and the screen shake. Pinned in
  `cardHooks.test.ts` and `confirmedDamage.test.ts`.
- **A stalled upload pauses the continuous streams.** `net/uplinkPace.ts` `StallWatch` fed with the socket's
  `bufferedAmount` (`net/connection.ts` `socketBufferedBytes`) stops the aim, the held right button's re-sends and the
  keyboard repeat while the socket has held unsent bytes for a tick, so the burst after a stall is orders only. In the
  `uplinkBudget.test.ts` model the stall that gets a client closed by `MAX_MESSAGES_PER_SECOND` moves from 2 to 3 s out
  to about 29 s.

## Decisions for the owner

1. Should remote fighters be drawn up to one tick past the newest real sample? This reverses "no extrapolation".
2. Should the walk hint be capped at 3 ticks, 2 ticks, or not exist? Without a hint a client has only constant
   velocity.
3. Should windup starts be dated within their tick, sub-tick timing? It saves 25 ms on average and changes a rule.
4. Should playtests collect human traces, with consent? Raw traces take about 288 MB/h at 8 players.
5. Should melee `t` follow the fresher drawn time, clamped to the newest published tick? Melee hit rates would need
   a re-check.
6. Do you want an aim helper from the same model? That is aim assist, a balance feature, not netcode.

## Sources

The Overwatch details are secondhand, and several papers were read only from their abstracts. Counter-Strike 2's
sub-tick input is not in the retrieved sources.

Netcode practice:

- Infil, rollback netcode, repeat-last-input: https://words.infil.net/w02-netcode-p5.html
- GGPO, the rollback library: https://en.wikipedia.org/wiki/GGPO
- Overwatch, run-ahead and what is never predicted: https://gdcvault.com/play/1024001/-Overwatch-Gameplay-Architecture-and
  and https://edgegap.com/blog/game-backend-deep-dive-overwatch-2016-netcode-architecture-rollback
- Valorant, held keys and 128 Hz: https://www.riotgames.com/en/news/peeking-valorants-netcode
- Rocket League, input buffers: https://media.gdcvault.com/gdc2018/presentations/Cone_Jared_It_Is_Rocket.pdf
- Halo: Reach, muzzle flash first and Armor Lock: https://slidetodoc.com/i-shot-you-first-gameplay-networking-in-halo/
- League of Legends, the movement prediction setting: https://wiki.leagueoflegends.com/en-us/Settings
- Gambetta, entity interpolation: https://gabrielgambetta.com/entity-interpolation.html
- Chromium, the pointer-prediction horizon: https://chromium.googlesource.com/chromium/src/+/f70d1235c9adeb9bfcdc40b1e60cff1247d81e76/content/renderer/input/input_event_prediction.cc
- Unreal, prediction keys for own actions: https://dev.epicgames.com/documentation/unreal-engine/API/Plugins/GameplayAbilities/FPredictionKey
- Latency-compensation survey, techniques and limits: https://web.cs.wpi.edu/~claypool/papers/lag-taxonomy/paper.pdf

Prediction research:

- Outatime, order-1 Markov, time-shifting, "shake": https://www.cs.princeton.edu/courses/archive/fall15/cos518/papers/outatime.pdf
- Halbhuber 2021, neural input prediction: https://epub.uni-regensburg.de/54944/1/3474710.pdf
- Halbhuber 2022, its follow-up: https://epub.uni-regensburg.de/53767/1/3543758.3543767.pdf
- Walker 2023, short horizons are easy: https://ece.uwaterloo.ca/~sl2smith/papers/2023TOG-Predictive_Dead_Reckoning.pdf
- Pantel & Wolf 2002, input-aware extrapolation: https://svn.sable.mcgill.ca/sable/courses/COMP763/oldpapers/pantel-02-suitability.pdf
- Schöller 2020, constant velocity against neural pedestrians: https://arxiv.org/abs/1903.07933
- Schelenz, constant velocity on NBA tracking: https://arxiv.org/pdf/2605.14855
- Ehlert, "when" apart from "what": https://www.diva-portal.org/smash/get/diva2:1560069/FULLTEXT01.pdf
- Pasqual & Wobbrock, pointing endpoints: https://depts.washington.edu/acelab/proj/ktm
- Kenny et al., snaps against blends: https://mural.maynoothuniversity.ie/id/eprint/1348/1/TWISSC_2006.pdf
- Valve patent, confidence thresholds and fallbacks: https://patents.google.com/patent/US11717748B2/en
- Stadia, "negative latency" claimed: https://www.engadget.com/2019-10-10-google-stadia-negative-latency.html

Human factors:

- Woods 2015, simple reaction time: https://www.frontiersin.org/journals/human-neuroscience/articles/10.3389/fnhum.2015.00131/full
- Xu & Claypool 2025, gamers' reaction time: https://web.cs.wpi.edu/~claypool/papers/reflex-qomex-25/paper.pdf
- Brenner & Smeets, fast hand corrections: https://research.vu.nl/en/publications/fast-responses-of-the-human-hand-to-changes-in-target-position/
- Liu et al., local against network latency: https://web.cs.wpi.edu/~claypool/papers/csgo-net-local-21/paper.pdf
- Schmid 2023, latency variation: https://epub.uni-regensburg.de/55003/1/schmid_halbhuber_latency_variation_2023.pdf
- Halbhuber 2022, latency switching: https://epub.uni-regensburg.de/53769/1/3549492.pdf

Local: `bench/predictBench.ts` on the branch where the harness was written, before its port to main, 2026-11-02.
The cited set is 3 runs of 4 bots, 7,249 rows; the second set is 3 runs, 10,176 rows. The cost figures come from a
plain-JS microbenchmark. Neither report is in the repository.
