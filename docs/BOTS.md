# Human-like heuristic bots

Bots that fill real lobbies and play like people: three skill tiers mixed in one lobby, four personalities, human
reaction times and misclicks, the screen and minimap a human has and nothing more, and the inputs a human sends and nothing
more. The contract every implementer codes against is `packages/server/src/bots/brain/types.ts`. Section 10 says who
writes what and in which order. Section 11 lists every best guess as an owner question.

Built: the brain and both drivers, the lobby fill, the learning store, the tournament, and the Wishes, planning and chests
modules (section 8). Not built: the quest, Q/E skill, relic and hazard modules (end of section 8). Measured results are in
9.3 and `docs/BOTS_TUNING.md`.

Already built on this branch (commit `febac38`, CLAUDE.md "Bots in the sim"): `PlayerState.bot`, `addPlayer(..., { bot })`,
no kill or bounty GV for a bot victim, `RunResult.kills` without bot kills, the human-only win bonus, `RaidRoom.settle`
dropping a bot's result, and the `[BOT] name` tag in the client. This document builds on that and does not change it.

Numbers marked "measured" were taken on this branch: `npx tsx bench/stepBench.ts` and `bench/bandwidth.ts`, plus a one-off
`findPath` timing (400 random floor pairs, seed 7).

---

## 1. Driver: in-process controllers, with the same brain behind a network adapter

**Decision.** There is one pure brain (`bots/brain/`) and two drivers:
- **`BotManager`** (in-process) runs fill bots inside `RaidRoom`. Each bot is a `PlayerState` with `bot: true` and a
  `PlayerRuntime`. Its commands go through a latency delay line into `enqueueClientMessage(rt.inputs, type, msg)`, the call a
  human's message takes (`RaidRoom.ts:216`).
- **`BotClient`** (network) is the `npm run bots` CLI and the e2e player. It reads the SDK-decoded `room.state` and `fxs`,
  and sends with `room.send`.

Both build their input for the same `perception.ts`, run the same `BotRunner` (`brain/runner.ts`), and differ only in their
`BotAdapter`.

| Criterion | In-process (chosen for fill) | Headless network clients |
|---|---|---|
| Never touches persistence | No profile, token or seat exists. `settle` drops its result (`RaidRoom.ts:430-433`) | Joining needs a profile and token (`checkCredentials`, `RaidRoom.ts:121-127`), a profile per bot, and `recordRun` on every result: exactly what the brief forbids |
| Same validation and timing as a human | Same `enqueueClientMessage`. Arrival between steps is applied by the next step, as a socket message is | Same, plus the Colyseus 100 msg/s guard (`RaidRoom.ts:156`). The humanizer caps bots at 2-3 msg/s anyway |
| Scale | No socket, no per-client patch encode, no downlink | A WebSocket each and a full patch stream each |
| Tick budget | Brain CPU is on the server's event loop: budgeted, see below | Brain CPU in another process |
| CLI shares the brain | Yes: runner + perception | Yes: the same runner |

**Measured budget** (the merged tree, planning and chest modules on; seed 1). `step()` alone with 8 players and 60 mobs
averages 0.45 ms with a p99 of 6.1 ms (`bench/stepBench.ts`; the gate is 5 / 15 ms). With 8 in-process fill bots
(`stepBench.ts --bots 8 --clock cpu`) the whole tick averages 1.28 ms with a p99 of 2.97 ms, and the bots' share (`beforeStep` +
`afterPatch`) averages 0.94 ms with a p99 of 2.55 ms. The first 200 ticks are reported apart: a cold process spikes to 36 ms on
tick 3, in the bots' share (probably the first strategy decisions of eight bots, not profiled; not gated; stagger or warm them at boot if it matters). Typical bandwidth is
7.68 KB/s per client, 4.04 KB/s in the `bots` scenario (`bench/bandwidth.ts`; the gate is 20). One-off timings from the
design phase (not re-run): `findPath` on a 64x64 map averages 0.092 ms (p99 0.307 ms), walks of
300-500 u average 0.025 ms, and line of sight takes 0.4 µs. The brain's own gate is 8 bots ≤ 1.5 ms average and ≤ 6 ms p99 per
tick, kept three ways:
- thinks are staggered (each bot has a phase offset, like `MOB_REPATH_MS`; about 2 tactical thinks per tick for 8 bots);
- a room-wide `BOT_PATH_BUDGET_PER_TICK = 8` `findPath` calls, with a 1 s cache;
- perception is O(bots × entities), about 8 × 110 cheap reads per tick.

Fill bots add no downlink. They never stream `aim`, so they patch `facing` less than humans do.

**Where I differ from the lean.** The brain is a pure `Percept → Command` module with seeded RNG and server time. Agreed. Eight
changes:
1. **Delay perception too, not only commands.** In-process bots would otherwise see the world 100 ms (`INTERP_DELAY_MS`)
   plus the downlink fresher than any human. The runner's frame ring reads the world at `now − worldDelayMs` (100 + 30) and
   the bot itself at `now − selfDelayMs` (30; 0 over the network, whose latency is real).
2. **One frame per patch, not per step.** A Room callback runs up to `MAX_CATCHUP_STEPS` (3) steps and sends one patch
   (`RaidRoom.ts:374-389`). A frame per step would show bots states no client ever receives. Commands still flush before
   every step, because arrival is per step.
3. **`tick(percept) → TimedCommand[]` every frame** replaces `think(percept, now)`. The humanizer releases clicks at their
   own times between thinks, and `now` is in the percept. The think cadence is internal (`TierParams.thinkMs`).
4. **Plain data, not just "no server types".** A `MapSchema` handed over by reference would carry every hidden field.
   Perception copies values out: positions through `Math.fround`, timers truncated, so both drivers produce identical
   percepts from the server's doubles and the client's float32. A structural test enforces it (3.7).
5. **Three RNG streams** (`decide`, `motor`, `lapse`; shared `mulberry32`). Tuning click noise must not reshuffle strategic
   choices, the same reason `world.rewardRandom` is apart from `world.random`.
6. **Injected services.** The brain needs pathfinding. It gets it through a budgeted `PathService` over shared `findPath`.
7. **Fed the same fx as clients.** The in-process driver hands perception the very `FxBatch` the Room broadcasts
   (`RaidRoom.ts:423`), decoded with `unpackFx`/`unpackLaunches` like the client does. A bot can never see an fx no client
   got.
8. **No loopback sockets for fill.** A localhost client would still need a profile, and its near-zero latency would be the
   wrong one anyway.

---

## 2. The human-likeness model

### 2.1 One reaction, end to end

```
event in tick T ──► patch ──► seen by the bot at T + 130 (world: 100 render delay + 30 downlink; self: T + 30)
   ──► noticed (attention) ──► clicked at + reaction ──► arrives + 30 ±8 uplink ──► applied by the next step (≤ 50)
```

A Hard bot answers a new event about 385 ms after it happened on the server, on average. An Easy bot takes about 635 ms. A
human at 60 ms RTT has the same chain. Default latency is 30 ± 8 ms one way (`BotFillConfig.latencyMs`/`jitterMs`). The
delay line never reorders: each arrival is `max(previous arrival, at + latency + jitter)`, as over TCP.

### 2.2 Tier table (`TIERS` in types.ts)

| Parameter | Easy | Normal | Hard |
|---|---|---|---|
| Reaction, ex-Gaussian μ/σ/τ (mean; floor–cap) | 330/60/120 (**450**; 230–1400) | 210/40/70 (**280**; 170–900) | 160/25/40 (**200**; 140–700) |
| Planned next step μ/σ/τ (mean) | 150/40/50 (200) | 100/25/30 (130) | 70/15/20 (90) |
| Coliseum daze (mean) | 1000 | 700 | 500 |
| Refractory gap between independent decisions | 180 ms | 140 ms | 120 ms |
| Tactical think / strategy cadence | 300 ± 100 / 2000 ± 600 ms | 200 ± 60 / 1500 ± 400 | 150 ± 40 / 1200 ± 300 |
| APM sustained / burst / min gap | 60 / 3 / 160 ms | 110 / 4 / 110 ms | 170 / 5 / 80 ms |
| Move click σ = base + k × distance | 14 u + 4% | 9 u + 2.5% | 6 u + 1.5% |
| Target click σ / hand lag / slip (×3 σ) | 26 u / 0.09 s / 4% | 18 u / 0.06 s / 2% | 12 u / 0.035 s / 1% |
| Lock clicks that pick nobody (static target, alone) | ≈7.4% | ≈1.2% | ≈0.2% |
| Off-screen walk: screen-edge clicks vs minimap (σ) | 70% / 40 u | 50% / 28 u | 30% / 20 u |
| Timing error on planned rhythms (σ) | 160 ms | 100 ms | 60 ms |
| Hesitation chance / length | 12% / 0.4–1.2 s | 7% / 0.25–0.8 s | 4% / 0.15–0.5 s |
| Softmax T / lapse (any of top 3) | 0.25 / 8% | 0.12 / 4% | 0.06 / 2% |
| Dodge a visible ball / juke a draw or windup | 15% / 0 | 40% / 20% | 65% / 45% |
| Orb-walk ranged vs melee: chance / step / heading noise | never | 50% / 140 u / ±23° | 85% / 160 u / ±15° |
| Counter-wheel knowledge (per edge) / mob share error | 40% / ±0.15 | 70% / ±0.08 | 95% / ±0.03 |
| Route: camps considered / walk paths / hunt reach | 3 / straight × 1.3 / 500 u | 6 / A* / 700 u | 10 / A* / 900 u |
| Attention: central share / periphery × / engaged × / reconsider | 0.6 / 1.4 / 1.6 / 2.5 s | 0.65 / 1.3 / 1.4 / 2.0 s | 0.7 / 1.25 / 1.3 / 1.5 s |
| Opponent memory span / feint reading | 25 s / 0 | 35 s / 10% | 45 s / 20% |
| Fight appraisal: logit bias / hp-lead weight / third-party weight / hue weight / misjudgement σ (BOTS_TUNING.md 3) | 0.9 / 2 / 0.3 / 1.1 / 0.9 | 0.3 / 3.4 / 0.5 / 0.6 / 0.45 | −0.3 / 4.5 / 0.7 / 0.25 / 0.15 |
| Wariness: a player it does not want to fight is kept away from inside | 0 (never) | 300 u | 450 u |
| Mob caution: matchup share needed (mob / elite) / hp share to start a mob fight | 0.3 / 0.3 / 0.3 | 0.6 / 0.8 / 0.6 | 0.7 / 1.1 / 0.7 |

**How the miss rates follow.** A 2D Gaussian misses the 64 u snap disc with chance `exp(−64²/2σ²)`. For Easy that is 4.8%
at σ 26 and 71% at the slipped σ 78, about 7.4% in all. A moving target adds the hand lag (Easy: 0.09 s × 170 u/s = 15 u
behind), and a crowd adds wrong picks.

### 2.3 Clicks go through the client's own picker

- **A lock intent becomes a cursor point**: the target's drawn position at `viewT`, minus its velocity × `lagS`, plus
  scatter. It is resolved with a port of the client's `pickTarget` (`render/targeting.ts:12-25`, `brain/clicks.ts`, pinned
  equal by a test) over the candidates the client offers (`RaidScene.ts:625-636`): other alive players on screen, and mobs
  unless `gatesLocked`, all within `TARGET_SNAP_RADIUS` 64 u.
- **A miss sends nothing.** A click on empty ground does nothing. The miss becomes a `clickMissed` stimulus: the bot notices
  no ring and clicks again after a reaction.
- **A wrong pick sends `target` on the wrong fighter.** It is noticed at the next percept (the ring is on someone else) and
  corrected after a reaction.
- **Clicks stay on screen.** A ground click can only land inside the window. A destination off screen is either an edge
  click toward it (repeated as the bot walks) or a minimap right-click with minimap scatter (`edgeClickP`).
- **The rest has no scatter.** `swap` and `pickup` are keys. `pickup` is pressed only while the percept says the container is
  interactable, as the client gates F. Unit casts resolve like locks, with the ability's snap radius.

### 2.4 What reaction delays, and what it does not

| Stimulus (memory.ts) | Delay before the answering click |
|---|---|
| `newThreat`: an enemy enters the window, or a hidden one is revealed | reaction × periphery (outside the central share) × engaged (while fighting) |
| `incoming` (a ball on a hitting course), `windupAtMe`, `drawAtMe` | reaction, then a feasibility check (2.6) |
| `hpLoss` (a hit on self), `lowHp` (crossed `fleeHp`) | reaction |
| `lockLost`, `targetDown`, `orderFailed` (no move 400 ms after a walk order), `clickMissed`, `foeSwapped` | reaction |
| `teleport` | daze |
| `announcement` (bounty, a death by name), `chestUp`, `planOffer` | reaction × 1.5 (reading text) |
| Next step of a plan (walk off after own shot, F on arrival, re-lock after a dodge) | step |
| Rhythms (re-lock as the cooldown ends, juke at a draw's end) | due time ± timing σ |

**Not delayed, because the server does it for every player:** the lock's chase, re-path and re-aim, the auto-attacks, path
following, the bow's release aim. **Not delayed either:** reading the bot's own HUD, though acting on it is a decision.
Independent decisions are spaced by the refractory gap, so two simultaneous threats are answered one after the other.

### 2.5 Rate, hesitation and lapses

- **APM.** A token bucket per bot (rate `apm/60` per second, size `burst`, `minGapMs` between commands). Channels are
  `order` (move, stop, target), `swap`, `pickup`, `cast` and `menu`, with one pending intent each. Priorities run reflex >
  combat > goal > chore. A starved intent waits (dropped after 1.5 s), and a newer one on its channel replaces it (`HumanizerStats.throttled` and
  `superseded`).
- **Hesitation.** A per-decision chance of one pause, drawn from the `lapse` stream.
- **Lapses.** Every option choice (goal, target, weapon slot, loot) is a softmax over utilities (scale about 0..1) at
  temperature T. With chance `lapseP` the bot takes a uniformly random option from the top three.

### 2.6 Dodging, juking, kiting

**Balls dodge from their launch.** A ball flies at 380 u/s for at most 220 u, so at most 579 ms (`weapons.ts:50-53`). Seen
130 ms late, a sidestep of 26 u (`RANGED_HIT_REACH` 14 + `PLAYER_RADIUS` 12) at 170 u/s also takes 153 ms:
- Hard: 130 + 200 + 30 + 25 + 153 = 538 ms, so it can dodge balls loosed from near maximum range;
- Normal (618 ms) and Easy cannot dodge from the launch.

A dodge is a `move` and drops the lock, so it costs a re-lock (step + click).

**Arrows can only be juked.** An arrow flies 240 u at 900 u/s, so 267 ms, which nobody can react to. A locked arrow is aimed
at release with `leadAim` on the target's present velocity (`policies.ts:156`). The only counter is a direction change that
lands just after the release. The bot reads `drawStartedAt` and the bow windup (`min(0.6 s, 0.92 × interval)`,
`weapons.ts:135-136`) and times a juke there with chance `jukeP` ± timing σ. Wand windups (0.4 s) are juked the same way, on
the `windup` fx.

**The orb-walk cycle**, for a ranged bot against a melee chaser, with chance `orbwalk.p × persona.kite`:
1. Locked: the server shoots.
2. On its own launch (or the `readyAt` jump), it walks `stepU` straight away from the chaser, ± heading noise. The target is
   checked with `PathService.clear`, and the walk drops the lock.
3. It re-locks, timed, at `readyAt − 100 ms` ± timing σ.

Two commands per shot (about 80-120 APM) means Normal's APM cap thins its orb-walk on its own.

### 2.7 Knowledge and routing

**The wheels.** A bot knows each of the 10 faction and 10 weapon edges with chance `knowledge` (fixed at creation, from
`decide`). An unknown edge reads 0. Every bot reads the matchup tint the UI shows every human (`matchupTint`, in sight within
`MATCHUP_RANGE` 450, `signatures.ts:113-127`). Knowledge therefore matters beyond 450 u or out of sight: whom to hunt from
afar, which second weapon to pick up, which camps to route through.

**The rules.** A bot knows the sudden-death rule (`suddenDeathShare` burns every hp pool at the same share, so the lower
hp share falls first, `rules.ts:31`) with chance `knowledge`, drawn once per bot. The Wish rules are not gated that way: memory
counts a landing it saw as unavailable for `WISH_COOLDOWN_SECONDS` (300 s) for every tier, nothing reads that guess yet (section
8), and the 45 s Wish lock is not modelled (owner question 16).

**Routes.** Easy picks the nearest of 3 camps by straight line. Hard compares 10 by walking distance, weighs the matchup
share. (It used to prefer camps whose `REGION_BUFF` matched the stat it was stacking toward a 3-stack combo; the combos are gone with
the per-mob-type buffs of R4a, and weighing which buff a camp's mobs give is for a later pass.)

### 2.8 Why Hard is beatable

Hard matches a good human's reflexes and loses on reads. Every point below is meant to be exploited (9.3 lists the exploit scenarios, which are not written yet):
1. **A fixed reaction floor.** Nothing answers faster than the 140 ms floor plus 160 ms of view and uplink delay. A bait
   draws a predictable answer.
2. **Feints work.** 80% of cancelled windups still draw a dodge. Each dodge drops the bot's lock and costs about 0.3-0.5 s of
   attacks.
3. **Predictable kiting.** It always steps straight away, ±15°, 160 u per step, re-locking on the cooldown. A chaser can cut
   the line or herd it into a wall. It never uses walls to break sight.
4. **Tunnel vision.** While fighting, a new threat is seen at about 1.6× reaction in the periphery, and the fight is
   reconsidered only every 1.5 s. A third party gets one or two free hits.
5. **Serial attention.** Two threats at once are answered 120 ms apart, at best.
6. **Readable thresholds.** It flees at the persona's `fleeHp` every time, along `retreatPoint`'s pattern.
7. **Nothing off screen.** No minimap peeking, and no memory past 45 s. An ambush from off screen always lands first.
8. **Greedy, repeatable routes and commitment to mobs.** It leaves an elite only at `retreatHp`, so it can be third-partied
   at the camp the route says it will visit next.

The micro is the server's lock for everyone, so a human out-plays a Hard bot on decisions, not on aim.

---

## 3. Perception: the fair-information contract

### 3.1 The window

`computeLayout` (`client/src/view/viewport.ts:82-107`) fixes the world height every player sees at `REF_VIEW_H` = 900
projected px (`:9`). That is 900 / `Y_SCALE` 0.8 = 1125 world units. The width follows the aspect: 4:3 shows 1200 u, 16:9
1600 u, and 21:9 is the cap at 2100 u. The camera centres on the drawn player (`RaidScene.ts:321`).

**Bots assume 16:9**, the common monitor: `BOT_VIEW = { halfW: 800, halfH: 562.5 }`. An entity is on screen when its
centre's `|dx| ≤ 800` and `|dy| ≤ 562.5` from the bot's position at `now − selfDelay`. On a 64 × 64 map (2048 u) that is 43%
of the map; on the planned 96 × 96 map, 19%.

**No fog of war.** The client draws everything in the camera rectangle; walls do not hide fighters. The window has no line
of sight test. Line of sight matters only where the UI uses it: the tint, interactability, and the lock's own rules.

### 3.2 The minimap (`ui/minimap.ts`)

**It shows** walls and region tints, the closed gates, every living regional mob as a dot (faction colour, gold rim for an
elite; dummies and the dead are skipped, `:158-179`), the camera rectangle, and **the local player only** (`:324-378`).
**It shows no other player.** The Wishes contract keeps it that way for hidden players.

**So the percept gets** every living mob's dot map-wide: position rounded to 16 u, refreshed every 100 ms (its repaint
rate), with faction and elite; no hp, no weapon. **Dots carry ids**: a human tells dots apart by continuity and dots never
swap, so ids stand for that and let memory tie a dot to its camp spot. A dot leaving its spot, and a camp's dots vanishing,
are legitimately "awake" and "cleared". Since R5 it also draws each camp's reward chest as a gold blip with its seconds left,
and the percept carries those map-wide too (`extras.chests`); the cards inside are shown only by the chest panel (8).

### 3.3 Percept fields

| Field | Source | Limit |
|---|---|---|
| `self` | `players[selfId]`: position, facing, status, hp, maxHp, barrier, faction, both weapons, slot, attackTarget, drawStartedAt, readyAt, immuneUntil, sig, brand, stacks (the build strip's power: shared `buffPower` over the buffs held, in stacks at the quoted value), mirrors (`decodeMirrors`), kills, mobKills, gv, bounty, moveSeq | Exact: the HUD shows it (buff rows, bars, lock ring) |
| `hud` | `RaidState` phase, training, lobbyEndsAt, raidStartedAt, patienceEndsAt, suddenDeathAt, inColiseum, gatesLocked, startedWith, minPlayers, winner; `alive` counts all players alive | Exact (`ui/hud.ts:146-150` counts the whole room) |
| `fighters[]` | Other players on screen: name, bot, position, facing, status, hp share, barrier share, faction, **weapon in hand only** (`FighterArt.ts:35-37`), drawStartedAt (the pull), bounty (the crown, `PlayerView.ts:209`), immune, sig, brand, targetable | Window. Hp at 5% steps (a bar, not a number). Never `weapon1`, stacks, kills, gv, readyAt, attackTarget, mirrors, moveSeq or look |
| `fighters[]` (computed) | `vx`, `vy` from frames 100 ms apart; `dist`; `los`; `tint` (the UI's hue); `central` | 0 velocity if not on screen in both frames |
| `mobs[]` | kind, name, faction, position, facing, status, hp share, weapon in hand, drawStartedAt, sig, brand | Window |
| `minimap` | Living mob dots and `gatesLocked` | Whole map, 16 u, 10 Hz |
| `containers[]` | kind, position, a body's label, closed or open. Weapon: a ground weapon's icon always (`ContainerView.ts:83-125`); a weapon chest's or body's only while `canInteract` (56 u and line of sight, `interact.ts:9-11`), as the weapon bar shows. A camp's reward chest is not a weapon target: its place and expiry are in `extras.chests` map-wide, its cards only within 88 u with a clear line | Window |
| `projectiles[]` | `fxs` launch tuples flown to `viewT`; `from` = the visible fighter nearest the origin within 56 u (`FxView.ts:60,513`) | Its position at `viewT` is in the window |
| `events[]` | Decoded `fxs` + toasts to self + the result + private messages | 3.4 |
| `extras` | Per feature (8) | Per feature |

**Never in a percept:**
- `RaidState.tick` (`noSync`) and the roster, which is used only to decode;
- anything off screen except dots and announcements;
- a weapon chest's or body's contents out of interact range, and a reward chest's cards out of its panel range (88 u, clear line);
- off-screen mob hp;
- hidden fighters;
- anything from `World` (paths, other players' locks, mob brains and threat tables, loot rolls, `rewardRandom`, "?" rewards).

### 3.4 Which fx a bot observes (`ObservedEvent`)

| Fx | Observed when | Masked |
|---|---|---|
| windup, swing, cancel, stagger, heal, buff | The subject (`by`/`id`) is on screen, or it is self | – |
| hit, block | The victim is on screen, or the victim is self | `by` is null unless the attacker is visible |
| projEnd | Its (x, y) is on screen | – |
| death of a player | Always: the "X was killed" announcement (`FxView.ts:359-369`) | `at` and `by` only when on screen |
| death of a mob | On screen | – |
| bounty, teleport, victory | Always: announcements | – |
| toast, result, private (`plan`, `reveal`) | Addressed to this bot | Never another player's |
| `ext` (Wishes' cast, castLand, castEnd, status) | Subject on screen or self; never from a hidden caster | – |

World fx are composed with the world delay. Toasts, results and private messages use the self delay.

**Hidden and untargetable** (Wishes, once `Features.statusEffects` is on):
- A fighter with `EFFECT_HIDDEN` (256) is dropped from `fighters`, from projectile credit and from every fx, until the bit
  clears (it attacks or casts, Wishes D11). Memory keeps the spot where it vanished: a human saw that.
- A fighter with `EFFECT_UNTARGETABLE` (128) stays visible with `targetable: false`, and the picker skips it, as the
  client's `targetable(effects)` does.

### 3.5 Memory (memory.ts, `MemoryView`)

| What | Kept | Decay |
|---|---|---|
| Each opponent: faction, weapons seen, the believed other slot (the last different in-hand weapon), last position and velocity, hp share, bounty, alive or dead, hits on me and mine on it, engaged with whom, chasing me, feints | Whole run | Position: `whereabouts` radius grows at 0.6 × 170 u/s; forgotten after `memorySpanMs` (25/35/45 s). Hp forgotten after 20 s. Deaths are permanent |
| Wish seen cast (`ext` castLand) | Until seen + 300 s | A human's "about five minutes". No guess is made before a first cast (the 45 s lock is not modelled), and nothing reads the guess yet |
| Mobs: home spot, camp, last dot, last hp seen, awake, returning | Whole run | Hp held at the last value seen, never refilled while off screen |
| Camps: living dots, cleared at, contested at, visited at | Whole run | – |
| Containers seen: position, closed, weapon, skipped | Whole run | A loose weapon unseen for 60 s is assumed taken |
| Self: hits taken (last 3 s), last hit by a player, last damage dealt, last order, standing still since | Rolling | – |
| Bounties announced, choices made | Whole run | – |

### 3.6 Feeding mobHunt from the percept

`MobHunter` (`bots/mobHunt.ts`) stays as it is, pure and unchanged. `brain/huntAdapter.ts` builds its `HuntInput`
(`mobHunt.ts:216-236`):

| HuntInput field | Built from |
|---|---|
| `self` | `SelfView` |
| `playerDistance` | The nearest visible enemy, doubled when out of sight |
| `players` | Visible enemies plus `whereabouts` younger than 5 s |
| `mobs` | `MobMemory` as `MobLike`. `maxHp = mobFaction(region, elite).hp`, which is what `mobLife.ts` sets. `hp` = the last hp share seen × maxHp, so a mob that leaves the screen never "heals", which `MobTracker` would read as walking home |
| `walk` | `PathService.walk` |
| `attacking` | Tactics' last output |
| `shotByPlayerAt` | `mem.self.lastHitByPlayerAt` |

Each bot gets its own config: `killGoal`, `retreatHp` and `playerThreat` from its persona, and `reach`, `firstReach` (1.6 ×
reach) and `maxCandidates` from its tier route. The hunt's answer is one candidate in the strategy's scoring:
- `mob` becomes a farm goal;
- `retreat` becomes a flee goal;
- `player` means no mob candidate this think.

### 3.7 How fairness is enforced by tests

| Test (`packages/server/test/bots/`) | Asserts |
|---|---|
| `boundary.test.ts` (static) | Every file under `bots/brain/` and `bots/mobHunt.ts` imports only `@raid/shared` (not `/schema`), its siblings and `../mobHunt`; `perception.ts` alone may `import type` the schema. None contains `Math.random`, `Date.now`, `performance.now`, `setTimeout`, `setInterval` or `process.` |
| `perception.test.ts`, field allowlist | Perception runs over a Proxy-wrapped state that logs every property read. It never reads `tick`. For a player off screen it reads only `x`, `y`, `status`, `name`; for a mob off screen, `x`, `y`, `status`, `kind`, `faction`. It never reads `weapon1`, `stacks*`, `kills`, `gv`, `readyAt`, `attackTarget`, `moveSeq` or `look` of another player |
| `perception.test.ts`, plain data | Every object in a Percept has `Object.prototype` or `Array.prototype`, every leaf is a primitive, and `structuredClone(p)` deep-equals `p` |
| `perception.test.ts`, window edge | Fighters, mobs, containers and projectiles at `halfW ± 0.5` and `halfH ± 0.5` on each side are in and out exactly. `BOT_VIEW` equals `computeLayout({cssW: 1920, cssH: 1080, dpr: 1, hiDpi: false})` divided by `Y_SCALE` (the client's pure `viewport.ts` imported by relative path) |
| `perception.test.ts`, parity | A server `RaidState` and the same state round-tripped through the real encoder and decoder give identical Frames |
| `fairness.test.ts`, metamorphic | Over 200 seeded states, each perturbed in hidden information only: off-screen players (anything, moved anywhere off screen); on-screen `weapon1`, stacks, kills, gv, readyAt, attackTarget; off-screen container items; out-of-range chest contents; off-screen mob hp; fx off screen; hidden players (anything, anywhere); every `bot` flag flipped. The Percept is byte-identical (JSON) and, from the same seed and memory, the brain's commands over a scripted 10 s are identical |
| `fairness.test.ts`, never seen | Across a whole tournament game, a fighter that was never on screen and never announced never appears (id or name) in any Percept, MemoryView or command |
| `humanizer.test.ts` | Every command passes `enqueueClientMessage` (returns true); never aim, attack or release; per-bot rate ≤ the tier's APM and burst, ≥ `minGapMs` between commands, never > 100 in 1 s; lock clicks resolve exactly as `render/targeting.ts` `pickTarget` (client file imported by path) |

---

## 4. The brain's layers

```
tick(p):  stim = memory.observe(p)                                    // MemoryView + Stimulus[]
          modules.observe
          if strategy due || salient(stim) || status ≠ running:
              decision = strategy.decide(ctx, goal, status)           // + module goal candidates
          if think due || stim || goal changed:
              out = goal.kind == "module" ? module.act : tactics.act  // Intent[] + GoalStatus
              humanizer.submit(out.intents ∪ modules.intents)
          return humanizer.release(ctx)                               // TimedCommand[], noted back into memory
```

**Strategy** (`strategy.ts`, `StrategyLayer`) picks one `Goal`: farm, hunt, fight, loot, flee, roam, hold, idle or module.
1. **Score.** Each candidate's utility is the persona weight × the base value, plus `LEARN.weight` × the learned bias:
   - farm: from mobHunt's pick and the reward curve (`rewardCurve(feed)`);
   - hunt: the bot sizes the fight up (`appraise`: a logit of the hp lead on the bars, a third fighter already trading with
     the foe, the matchup the wheels or the hue give, and a misjudgement held per foe for 5 s, each weighted by the tier) and
     opens it only above the persona's margin (`engageEdge`, + `bountyCaution` while it carries a bounty, less the bounty on the
     foe); nothing is offered below it. The first minute asks for up to 3.5 more (`OPENING_LOGIT`, fading out, and gone when the
     patience timer is nearly out). Restraint is the skill the tournaments reward most (BOTS_TUNING.md 3);
   - evade: a player it does not want to fight that is walking at it, or close, is kept away from for 1.8 s (the tier's `wary`);
   - loot: a weapon that covers counters to the factions and weapons memory has seen;
   - roam: toward remembered whereabouts, a bounty, unexplored camps (the one seen longest ago when nothing else), or the
     coliseum when the patience timer is low; a hurt bot lies low (`hold ambush`) instead;
   - hold: the coliseum, with a patience that runs out 12 to 48 s after the teleport (the bolder personas first);
   - wait: only when there is nothing else.
2. **Pick.** A softmax at the tier's T, with lapses.
3. **Keep or switch.** The current goal is kept unless beaten by 0.1 utility. A fight is reconsidered no sooner than
   `attention.reconsiderMs`.
4. **Re-decide** every `strategyMs`, on salient stimuli (newThreat, lowHp, teleport, targetDown, announcement, chestUp,
   planOffer), and whenever tactics reports done, failed or blocked.

The old BotClient's pursuit-ring breaker lives here. A hunt that has not closed 40 u in
`persona.chaseGiveUpMs` drops its target, which is then avoided for 6 s unless it comes within 150 u or hits the bot.

**Tactics** (`tactics.ts`, `TacticsLayer`) executes the goal as intents, with `Knowledge` and the shared policies:
- **Approach and lock.** Walk until the target is within `TARGET_RANGE − 40`, then lock and leave the chase to the server.
- **Spacing and kiting** by matchup, with `matchupScore`, `factionEdge`, `weaponEdge` and `lockSpacing`.
- **Swaps.** `bestSlot`, and `bestSlotVsMob` against a mob. Never mid-draw, at most every 2-4 s, and only after seeing the
  foe's weapon (a `newThreat` or `foeSwapped` reaction).
- **Pickups.** Hold still, then press F only while interactable.
- **Dodges and jukes** (2.6).
- **The bounty.** A carrier plays safer; a hunter roams to the bounty's whereabouts.
- **The coliseum.**
  - After the daze, a bot with `coliseum` < 0.5 holds a spot on the ring away from the others. It waits for two others to
    engage (an Opportunist third-parties then).
  - A bot with `coliseum` ≥ 0.5 opens on the weakest visible enemy.
- **Sudden death.** A bot ahead on hp share avoids trades if it knows the rule, and fights otherwise.

Tactics returns `attacking` (the stall watch's "busy") and a `GoalStatus`.

**Humanizer** (`humanizer.ts`) turns intents into `TimedCommand`s (2.2-2.5). It owns:
- reaction sampling and the refractory gap;
- the click model;
- channels and the APM bucket;
- re-send rules: an unconfirmed `target` again after 300 ms + a reaction, as `TARGET_RESEND_MS` does today;
- dedupe: an intent equal to a pending one keeps its scheduled time, so tactics can repeat itself every think without
  restarting the clock.

**Arbitration.** Strategy owns the one goal, tactics owns how it is played, and the humanizer owns when anything happens.
- Reflex intents (dodge, the first flee step) pre-empt everything on their channel and set status `blocked`, so strategy
  re-decides (to flee) on the same frame.
- A pending intent is replaced only by one of the same or higher priority, or after 500 ms.
- Modules' intents merge by the same rules on their own channels (`cast`, `menu`), so a cast never fights an order.

---

## 5. Personalities (`PERSONAS`)

| | Farmer | Hunter | Opportunist | Cautious |
|---|---|---|---|---|
| pve / pvp / loot / bounty / third-party weights | 1 / .3 / .7 / .2 / .2 | .35 / 1 / .3 / 1 / .5 | .6 / .7 / 1 / .6 / 1 | .7 / .4 / .5 / .2 / .4 |
| Open a fight at a win logit ≥ (+ while bountied) | 1.3 (+0.5): 79% | 0.3 (0): 57% | 0.8 (+0.3): 69% | 1.6 (+0.6): 83% |
| Flee below / re-engage above hp share | 0.40 / 0.75 | 0.20 / 0.50 | 0.35 / 0.70 | 0.55 / 0.90 |
| Kite multiplier | 0.4 | 0.2 | 0.5 | 1.0 |
| Chase give-up | 4 s | 9 s | 5 s | 3 s |
| Mob kill goal / player threat radius | 9 / 250 u | 3 / 400 u | 6 / 300 u | 7 / 320 u |
| Elite appetite / coliseum aggression | .8 / .3 | .3 / 1 | .5 / .5 | .4 / .2 |

**Composition.** The tier is execution: perception, timing, accuracy, knowledge, route quality. The persona is preference:
weights and thresholds.
- They never multiply. Strategy and tactics read thresholds from the persona, and evaluate them through the tier's
  knowledge, timing and noise.
- An Easy Hunter is aggressive and sloppy: it engages at −0.3 on odds it half-knows, and decides through a T = 0.25 softmax.
- A Hard Cautious bot kites well and flees early.
- The one coupling is the orb-walk: `TierParams.orbwalk.p × PersonaParams.kite`.

**Assignment.** Personas are drawn by `personaMix`, uniform by default; tiers by `tierMix`, 30/45/25 by default. Both use
the manager's seeded stream.

---

## 6. Learning

### 6.1 Within a match

Memory (3.5) is the match model:
- opponents' factions and weapons (the believed other slot included);
- Wish cooldowns as a human counts them;
- whereabouts with growing uncertainty;
- cleared and contested camps;
- seen containers;
- feints per opponent (`feintRead`);
- who is fighting whom.

### 6.2 Across matches: `bots/learning/BotStatsStore.ts`

**File.** `bot-stats.json`, next to the profile file: `path.dirname(config.stashFile)`, so `data/` in dev. `BOT_STATS_FILE`
overrides it and `off` disables it. The store refuses a path equal to the stash file, never imports
`persistence/ProfileStore`, and is not reachable from it (the boundary test covers `bots/learning/`).

```json
{ "version": 1, "updatedAt": 1767000000000,
  "baseline": { "easy": { "n": 210.4, "s": 71.2 }, "normal": { "n": 260.0, "s": 131.9 }, "hard": { "n": 160.2, "s": 102.0 } },
  "entries": { "faction|hunter|fire": { "n": 12.3, "s": 7.1 }, "second|frost|bow": { "n": 5.0, "s": 3.2 } } }
```

**Keys** (`ChoiceKey`) are `domain|context|option`. On this branch:
- `faction|<persona>|<faction>`;
- `opener|<faction>|<region of the first camp farmed>`;
- `second|<faction>|<second weapon taken>`.

Also read, never written yet: `spawn|<faction>|<zone>` and `boon|<faction>|<boon>` (the planning module adds their bias to its
choice, but a module cannot record one: that needs an optional `choice?: ChoiceKey` on `Intent`, as `GoalDecision` has). Later:
`skill|<faction>|<skill>`, `relic|<faction>|<relic>`, `camp|<faction>|<mob type>`. The brain records a key (`recordChoice`) when a
goal decision that carries one is taken; the faction key is added by `BotManager.onResult`, because the faction was the manager's
pick, not a brain decision.

**Score.** Per resolved run, the placement score is `s = (players − place) / (players − 1)`; a draw counts as place 1. Tiers
are confounders (a Hard bot places well whatever it picked), so each key gets the residual
`r = clamp(0.5 + s − baseline[tier], 0, 1)`, where the baseline is that tier's own decayed mean.

**Smoothing and bias** (`LEARN` in types.ts):
- update `n ← 0.99 n + 1` and `sum ← 0.99 sum + r`;
- `m = (sum + 0.5 × 8) / (n + 8)`;
- `bias = clamp(m − 0.5, −0.25, +0.25)`;
- strategy adds `0.3 × bias` to the option's utility: at most ±0.075, against Easy's T of 0.25.

**Why it cannot lock in.**
- The prior is worth 8 runs.
- The decay half-life is about 69 updates.
- The softmax keeps every option alive, with a 5% uniform exploration floor.
- Entries are capped at 2000; the smallest `n` goes first.

**Writes.** Coalesced, at most every 10 s plus on room dispose and shutdown. Atomic: temp file, fsync, rename, directory
fsync, the `ProfileStore.ts:428` pattern copied rather than imported. An unparsable file is moved aside to `.bad-<ts>` and the
store starts empty: bots are never worth stopping the server for.

**Who reads and writes.**
- Each bot reads a `LearnedBias` snapshot at join.
- `BotManager.onResult` calls `brain.end(result)` and `store.record(summary)`. A run voided by the room closing is recorded
  nowhere.
- CLI bots learn only with `--stats <file>`.
- Tournaments write a per-run temp file, unless told otherwise.

---

## 7. Lobby fill, anti-farming and the UI

### 7.1 Built (`febac38`)

**The sim.** `addPlayer(..., { bot: true })` sets `PlayerState.bot` and `PlayerRuntime.bot` (`step.ts:26-53`,
`schema.ts:20`). In `arena.ts`:
- `creditKill` pays a bot victim's killer no kill GV and no bounty GV, counts `botKills`, and still runs the bounty hook
  (the buff transfer, when the victim carried a bounty);
- `updateBounty` reads `kills − botKills`, so a kill of a bot does not climb the killer's bounty ladder (owner question 1,
  adopted: a bounty cannot be built on bots and cashed by an alt);
- `RunResult.kills` is `p.kills − botKills` (`:316`), and `killedByBot` is set (`:140`, `:318`);
- the win bonus reads `arena.startedHumans` and `damagedHumans` (`:65`, `:124`, `:412-413`);
- a bot's `resolved` event carries `bot: true` (`:324`).

**The Room.** `RaidRoom.settle` returns before `recordRun`, the registry and `pendingResults` for a bot (`:430-433`).

**The client.** `render/displayName.ts` draws `[BOT] name` on nameplates, announcements, the winner line and the results
killer. `test/botSeat.test.ts` (sim) and `test/botRoom.test.ts` (a real Room) pin all of it.

### 7.2 Built (the fill)

**`sim/step.ts`.**
- `updateLobby` (`:136-145`): the `minPlayers` shortening to `fillSeconds` counts **humans** only, so filler never cuts a
  human's countdown. `MAX_PLAYERS` still counts everyone.
- A new chainable hook, `WorldHooks.lobbyClosing?(world)`, called in `updateLobby` right before `startRaid`. It is the
  manager's last top-up; `addPlayer` inside the step is safe there because `startRaid` places everyone next.

**`rooms/RaidRoom.ts`.**
- `buildWorld` creates a `BotManager` for an arena room with `fillTo > 0`.
- `tick()` calls `bots.beforeStep(serverTime + TICK_MS)` before each `step`, and `bots.afterPatch(batches)` once after
  `broadcastPatch`, with the batches `handleEvents` broadcast in that callback.
- `handleEvents` routes a toast or gv event addressed to a bot to `bots.onToast`.
- `settle`: `if (bot) { this.bots?.onResult(sessionId, result); return; }` (learning gets the result; nothing else changes).
- `onJoin`: if `state.players.size >= MAX_PLAYERS`, call `bots.yieldSeat()` first. It removes the newest lobby bot, and a
  lobby leave costs nothing. Colyseus `maxClients` still counts humans.
- `handleEvents` sends a bot's private `plan` message to `bots.onPrivate` instead of a socket.
- `onDispose` calls `bots.dispose()`, which flushes the stats.

**`BotManager` API** (`bots/BotManager.ts`; the Room's only bot surface):

```ts
constructor(world: World, cfg: BotFillConfig, deps: { store: BotStatsStoreApi | null; isNameTaken(name: string): boolean; seed: number })
lobbyTick(): void; lobbyClosing(): void; yieldSeat(): boolean; isBot(id: string): boolean;
beforeStep(stepT: number): void; afterPatch(batches: readonly FxBatch[]): void;
onToast(id: string, text: string): void; onPrivate(id: string, type: string, msg: unknown): void;
onResult(id: string, result: RunResult): void; dispose(): void;
```

**Arrival timing.**
1. Once at least one human client is in the lobby and `lobbyEndsAt − now ≤ arrivalSeconds` (12 s), the manager draws
   `fillTo − players` arrival times, uniform over the rest of the countdown minus 1 s.
2. It adds each bot between steps, so the HUD's "Waiting for players n/m" ticks up like a queue.
3. A human joining cancels the latest pending arrival.
4. `lobbyClosing` adds any shortfall at once.
5. The countdown is never extended: a lone human still waits `LOBBY_SECONDS` (30 s), then plays with 5 bots.

**Names** (`bots/callsigns.ts`).
- The pool is about 64 human-looking callsigns that pass `PROFILE_RE` (Wren, Kestrel_7, mossy, Varga...).
- A name is skipped when it equals any name in the room (case-insensitive), or when `isNameTaken` says so. The Room passes
  `(n) => store.get(n) !== undefined`, a read-only lookup.
- Fallback: two digits appended.
- Ids are `bot~<n>`; `~` never appears in a session id.
- Factions come from a softmax over `faction|<persona>|*` biases at T 0.3, at most 2 of a faction per lobby.
- `look` is 0.

**Edge cases.**
- **Never a lobby of bots alone.** Bots arrive only while a human client is in the room, and when the last client leaves,
  Colyseus `autoDispose` disposes the room. Lobby or run, nothing was recorded for the bots, and no learning happens: void.
- **All humans dead but still connected.** The run plays out (they spectate), and the bots' results feed learning.
- **Training rooms never fill.**

### 7.3 Config (`config.ts`, `ServerConfig.bots: BotFillConfig`)

| Env | Default |
|---|---|
| `BOTS_FILL_TO` | 6 (0 = off) |
| `BOTS_ARRIVAL_SECONDS` | 12 |
| `BOTS_TIER_MIX` | `easy:30,normal:45,hard:25` |
| `BOTS_PERSONA_MIX` | `farmer:1,hunter:1,opportunist:1,cautious:1` |
| `BOTS_LATENCY_MS` / `BOTS_JITTER_MS` | 30 / 8 |
| `BOT_STATS_FILE` | `<dir of STASH_FILE>/bot-stats.json`; `off` disables |
| `BOTS_SEED` | unset = crypto random per room |

Tests that start a Room pass `BOTS_FILL_TO: "0"` to `loadConfig` (e2e, room, metaRoom, shopApi, botRoom, shutdown, api), so
their lobbies stay as they are. With the default on, `npm run bots -- 3` on a dev server also gets 3 fill bots; set
`BOTS_FILL_TO=0` to avoid it.

**The hosting guards (playtest, CLAUDE.md "Hosting guards sit at the network edge").** A fill bot passes none of them and counts in none: the
room caps (`MAX_*_ROOMS`) count rooms, never players, and `maxClients` counts clients, so a lobby of one human and bots is open
to the next human (the newest bot yields at `MAX_PLAYERS`, `RaidRoom.onJoin`); the new-callsign caps and the passcode gate sit on
the profile route and the static `onAuth`, which a bot never reaches (it has no profile, token or address); the order budget is
spent in the Room's message handler for a real client's message, while a bot's command goes from `BotManager.beforeStep` straight to
`enqueueClientMessage` (its own pace is the humanizer's cap, 60-170 APM), so it neither spends a bucket nor is refused for one.
`test/botGuards.test.ts` runs all of that on a real server with every guard on.

---

## 8. The feature seam

Wishes, the planning screen and chests are merged and have their modules. Q/E skills, relics and zone terrain are not on
main yet. The brain grows with them without naming a symbol this branch lacks.

**Detection** (`perception.ts` `detectFeatures`, once per room; fills `Features`):
- `CLIENT_MESSAGE_TYPES.includes(type)` at runtime;
- schema fields by `key in instance`. Prototype accessors answer: checked here, `"barrier" in new PlayerState()` and
  `"wishReadyAt"` are both true since Wishes merged. `skills` also needs an ability to be returned for the q or e slot
  (`abilityInSlot`), which none is yet, so it is false though the schema carries `qReadyAt`/`eReadyAt`;
- shared exports by `(shared as unknown as Record<string, unknown>)["ABILITIES"]` after `import * as shared`;
- new fx kinds: `unpackFx` decodes whatever the shared codec knows, and perception passes kinds it does not name through as
  `ext`;
- the map's hazard field by presence.

**Enforcement.** A `Command` whose type is not in `Features.messageTypes` is refused by the adapter (`supports`). A module
whose `enabled(features)` is false is never called. A test runs a whole game with every feature off, and one with a faked
Wishes feature (`ext` fx and `extras.wish`).

**Modules** (`brain/modules/`, `FeatureModule`). Each has `observe`, `goals` (candidates scored with the rest), `intents`
(merged into tactics' output), `adjust` (corrects the merged intents of a tactics goal: hazards only) and `act` (for its own `module` goals).

| Module | Percept extras | Behaviour |
|---|---|---|
| `wishes` (and R6 `skills`, same code for the q/e slots) | `wish`, `skills`, `effects`, `fields`; `ext` cast, castLand, castEnd, status | Builds the contract's `CastSituation` from the percept: me (hp share, effect bits, hit within 1.5 s), foe (the goal's target if visible), threat (the nearest visible enemy, "chasing" = velocity toward me with cos > 0.7 and closing). Calls the shared `decideCast` and emits a `cast` intent, timed as a reaction to the stimulus or a step. Never while casting, before `readyAt`, or (for units) on an untargetable foe. Memory turns `castLand` by X into `wishSeenAt`/`wishReadyGuess`. Built: see below |
| `planning` (R3, built) | `plan` (private message, read from the percept's events) | See below |
| `chests` (R5, built; relics R7) | `camps`, `chests` (place and expiry map-wide, as the minimap draws them; the cards only within `CHEST_RANGE − 8` with line of sight, as the panel shows) | See below |
| `hazards` (R2 zone terrain, built) | The map's `terrain` (seed-derived), through the shared `surfaceAt` | See below |

**Planning (built, `modules/planning.ts`).** `detectFeatures` reports `planning` true on the merged schema (`plan` in
`CLIENT_MESSAGE_TYPES`). The deal reaches the brain as a private `plan` message (the Room routes a bot's to `bots.onPrivate`), and
both drivers run a bot's frames in `planning` as well as `active` (its status is still the lobby's there). `Brain.tick` has a planning
branch with no goal and no tactics: only the modules' `intents` run, and the humanizer releases clicks for a lobby-status player in that
phase. The module, as a person at the planning screen:
- **Reads first.** Nothing for 2-4 s (Hard), 3-6 s (Normal) or 4-8 s (Easy) after the deal arrives, scaled down for a window shorter than
  `PLAN_SECONDS` and never more than 55% of it; the clicks themselves get the humanizer's step delay and hesitation.
- **Picks a spawn** by `planSpawnScore` (the matchup of the two camps nearest each, `mobHunt.ts`) plus the `spawn|<faction>|<zone>` bias,
  through the tier's softmax and lapse (`pickOption`), so Hard takes the better one nearly always and Easy sometimes the worse.
  Only the free options (`taken`); with none free it skips the pick. A pick the next message does not show is sent again after 400 ms
  plus the tier's reaction, up to 3 times, and for the other spawn when the first was taken meanwhile.
- **A boon** (R7: `boons` is empty today) by the `boon|<faction>|<id>` bias through the same softmax, after the spawn.
- **Ready** a last look after the choices stood (Hard 0.3-0.8 s, Normal 0.5-1.4 s, Easy 0.8-2.2 s), and in any case before the last
  `min(2.5 s, 30% of the window)`. With no deal at all it presses Ready about a second in. A bot that never readies is covered by the
  server's planning timer, which places it on its first free option.
The write side of the `spawn|…`/`boon|…` keys (recording the choice for the stats file) waits for an optional `choice?:
ChoiceKey` on `Intent`: a module cannot call `recordChoice` today. `mobHunt.ts` `planPick` is the pure argmax of the same score,
kept for the tests; the module picks through the softmax.

**Chests (built, `modules/chests.ts`).** `perception.ts` fills `extras.chests` for every reward chest in the state (the minimap draws each
one wherever it stands, with its seconds left) and `extras.camps` from `RaidState.camps`. `options` is null, and `takenBy` empty, unless the
bot is alive within `CHEST_RANGE − CHEST_PANEL_SLACK` of the chest with a clear line (the rule of `ui/chestMath.ts` `pickReward`); another
player's pick reads "?". The module reuses `chestHunt.ts` (`ChestHunter` for the walk, `chooseOption` for the card):
- **Walk.** A module goal `chests/{chest}` offered when the hunt would walk (reachable in the chest's remaining life at 85% of speed, only
  a chest within twelve tiles while fighting or with an awake mob within 220 u, none while fleeing or below `fleeHp`), scored at
  `0.9 × (0.25 + 0.75 × persona.loot)`, plus a crowd bonus (`× persona.thirdParty`) when another player stands within 3 pick ranges of the
  chest, plus up to 0.2 for nearness, capped at 0.84 (a committed fight, 0.85, is never left for one). The walk decision never reads a
  card: from afar every chest is "a skill". Tiers that do not path (Easy) walk a straight line × 1.3. A walk that gains less than 24 u in
  3 s of walking is given up.
- **Pick.** In reach, a `choose` for the best free card the bot can use, else a skip, goes out whatever the bot is doing, once per chest
  (a card lost to a faster hand is asked for again on another, 3 at most, inside 4 s), timed as the humanizer times a reading reaction to
  the panel opening (Hard is quick, Easy slow). A bot that has walked out of reach by the click time clicks nothing. It waits out a stun or a
  cast, and the goal keeps it at the chest until the pick shows.
- **Birth hold.** A chest born in a ledger pass (every camp's) is refused a pick until the second tick after it ("Chest gone"; `holdBirth`,
  `sim/loot.ts`), and the bot's one try must not be spent on that. The module sends no `choose` for a chest younger than
  `CHEST_HUNT.holdMs` (3 ticks: the hold and one more for a message that overtakes its patch), by the chest's own clock (`CHEST_SECONDS` less
  its time left), so a chest first seen old is picked at once and a young one in reach is stood at and waited for. An old chest in reach
  comes before a nearer young one. The bot's own perception delay (`INTERP_DELAY_MS` plus the downlink) already puts its first look at a
  chest past the hold; the rule keeps that true whatever a tier's reaction time becomes.
- It keeps its own record of the skills it took (the HUD's passives row) to leave a card it holds at rank 2.

**Hazards (built, `modules/hazards.ts`).** The bot reads the tile under a fighter's centre through the shared `surfaceAt`, the table the sim burns and slows by (a fighter's home faction is exempt), and:
- **Steps off embers.** Standing still (250 ms) on ground that burns it, with nothing locked and no loot goal, it sends a `move` to the nearest clean tile within 6 tiles (the tile and its four neighbours are not bad, so a click's scatter stays on good ground; else any tile that is not bad) that it can walk to in a straight line. Timed as a step, priority `goal`; a new decision at most every 600 ms, the same order offered again while it is on its way (up to 1.5 s or 20 u from arrival) so a hold's `stop` does not undo it. A walk in progress is left to finish: it may be crossing the field.
- **Redirects a long walk (`adjust`).** A `move` of 4+ tiles whose destination is bad ground for the bot (embers; bog or ice when not at home on them) is moved onto the nearest clean tile within 3 tiles. A dodge, a juke or an orb-walk step is shorter and never detoured. The server's A* still routes through hazards: `findPath` has no terrain cost, and none was added.
- **Looks for light** when hurt (below `persona.reengageHp`), lying low (`hold` ambush or wait) and not engaged: a `move` to the nearest light tile within 8 tiles it can walk to in a line.
Reach is read with the server's own masks elsewhere (`fight.ts` `inReach`, `perception.ts` `seeContainers`, `PathService.clear`): see CLAUDE.md "The bots on the R2 zone maps".

**Adopting `decideCast` (built).** Wishes is merged, so `brain/modules/wishes.ts` calls the shared `decideCast` / `hidesCaster`
(`bots/abilityPolicy.ts`, pure and shared-only) directly: the one import outside the brain's folder, allowed for that file alone
(`boundary.test.ts`). It is registered in `modules/index.ts`, so every driver that asks `enabledModules(features)` gets it; the
`registerCastPolicy` seam stays for a module that wants its policy injected. What the module does:
- **Casting.** Builds the policy's `CastSituation` from the percept and memory only (the bot's hp share, bits and hit within 1.5 s;
  the goal's target if drawn; the nearest drawn enemy player, "chasing" = walking at the bot, cos > 0.7 and closing, or hit it
  within 1.5 s and stands within 150 u), and emits a `cast` intent once `now >= wish.readyAt`, not casting, at most every 1000 ms.
  A unit cast carries `target`, `at` and the def's `snapRadius` and is resolved like a lock click (it can miss); a point or self
  cast carries the cursor point (a self cast, the bot's own position). Timing: a reaction to the first of lowHp, hpLoss, windupAtMe,
  drawAtMe, newThreat, incoming in this percept, else a step. Priority reflex below 55% hp, else combat.
- **Tiers.** Hard and Normal use every intent. Easy keeps only escape and sustain (a panic button; Freeze and Trial never fire for
  it), and remembers it 60% of the times the Wish becomes available (one `rng.decide` draw per availability).
- **Swarm.** A cast whose def hides its caster arms a slip: from the decision until its click was sent plus the cast time plus
  700 ms (or 2.5 s if it was never sent), and while the bot's own bits say hidden or casting, strategy is offered a module goal
  `wishes/slip` at utility 1.4, and the module's reflex `move` away from the nearest enemy takes the order channel from any lock
  that tactics asks for in the meantime. A hidden bot locks nobody: a swing would reveal it.
- **Opponents' Wishes.** Memory counts a landing seen (`castLand`'s `by`) as `wishSeenAt` and guesses it ready 300 s on. Not used
  for a goal penalty yet: a module can only add goal candidates (strategy keeps the best utility per key), so lowering a hunt of a
  Frost player whose Freeze is up needs a hook in strategy. The client shows every fighter's Wish icon coloured when ready
  (PlayerView), so perception could carry a plain `wishReady` per drawn fighter instead of a guess.

**Not built** (CLAUDE.md "Known TODOs" has the same list):
- the quest decision module (deferred by the owner);
- the penalty for hunting an opponent whose Wish is ready: an additive `FighterSeen.wishReady` plus a strategy hook (above);
- the write side of the `spawn|…`/`boon|…` learning keys (needs `choice?: ChoiceKey` on `Intent`, 6.2);
- `FighterSeen.displaceSeq` and `drawFullMs`: neither is in the percept;
- the Q/E skill and relic modules (`detectFeatures` reports `relics` true because `PlayerState.build` exists, with no module
  behind it, and `skills` false);

---

## 9. Tests and measurement

### 9.1 Unit and contract tests (each owner, in `test/bots/`)

| Test | Covers |
|---|---|
| boundary, perception, fairness, humanizer | 3.7 |
| `humanizer.test.ts` | Reaction samples over 2000 stimuli: mean within ±10% of the tier's, none below floor; refractory spacing; dedupe; lock misclick rates within ±1.5 points of 2.2 |
| `memory.test.ts` | Stimuli; whereabouts growth and expiry; the other-slot belief; Wish guess; camp cleared from dots; mob hp never refilled off screen |
| `strategy.test.ts` | Personas order goals as in 5; hysteresis; softmax and lapse frequencies; learned bias bounded; the pursuit-ring breaker (ports `botOrbit.test.ts`) |
| `tactics.test.ts` | One lock click, re-sent only when not taken, never aim, attack or release (ports `botLock.test.ts`); orb-walk cycle timing; dodge feasibility and juke timing (2.6); swaps by edge; pickups only when interactable; coliseum hold; sudden-death avoidance |
| `learning.test.ts` | Round trip; version; atomic write (crash between write and rename leaves the old file); bad file moved aside; refuses the stash path; bias within ±0.25 after 1000 identical wins; decay |
| `hazards.test.ts`, `reachSight.test.ts` | The hazards module on a hand-built terrain map (step off, redirect, light, a whole brain, the `adjust` seam); reach is not sight: a melee bot across low ground is not attacking, a weapon across it is not interactable, `clear` is the move mask, the span is the map's width |
| `wishes.test.ts`, `planningModule.test.ts`, `chestsModule.test.ts` | The three modules on synthetic percepts, through a whole brain, and in whole headless games. `test/botPlanning.test.ts` (the room never waits out the planning timer for bots) and `test/botChests.test.ts` (the pure chest policy) sit beside them |
| `botManager.test.ts` | Arrival schedule and HUD count; `lobbyClosing` top-up; a human join yields a seat; callsign collisions; the delay line (arrival = at + latency, monotonic, applied at the next step); results never banked and no profile created (spy on `store`); dispose flushes |

The two old BotClient internals tests (`botLock`, `botOrbit`) move to the brain tests above. `mobHunt.test.ts`'s BotClient
fx case moves to memory (`lastHitByPlayerAt`).

### 9.2 Gates

- **e2e stays green.**
  - `BotClient` is rewritten as the network adapter, keeping its public surface: `connect`, `run`, `roomId`, `token`,
    `resultsSeen`, `teleports`, `sent`, `stats` (`BrainStats` includes `mobTargets`, `mobDrops`, `retreats`, `mobFocusMs`,
    `grabs`, `maxStallMs`), `sessionId`, `seed`, the private field `room` (the e2e reads `bot["room"]`, `e2e.test.ts:118`),
    the `BotOptions` fields, and new `tier`, `persona`, `seed`.
  - The e2e pins tier `hard` and personas `[hunter, hunter, farmer, opportunist]` (index 1 is the bot that quits a second into
    the run) so kills and mob kills keep their odds. Every run is planned first through the planning module, and when a camp was
    cleared some bot must have taken a chest option (a replay criterion beside the kill, the signature hit, the mob kill and the
    landed Wish).
  - Hesitations (≤ 1.2 s) stay far under its 8 s stall bound.
- **New `e2eFill.test.ts`.**
  - One SDK human client with `BOTS_FILL_TO=4` gets 3 fill bots, flagged `bot`, inside the last 12 s.
  - The run completes.
  - No profile exists for any bot name.
  - `bot-stats.json` is written.
  - The human's result has no GV from bot kills, and `kills` excludes them.
- **Tick budget.** `perf.test.ts` gains 8 in-process bots + 60 mobs.
  - (`step` + `beforeStep` + `afterPatch`) per tick: average < 5 ms, p99 < 15 ms;
  - the bots' share alone: average < 1.5 ms, p99 < 6 ms;
  - `stepBench.ts --bots 8` reports it.
- **Bandwidth.** `bandwidth.ts` and the test gain a "bots" scenario (7 fill bots + 1 measured client): < 20 KB/s.

### 9.3 Tournament harness (`bots/tournament/runTournament.ts`)

```
npm run tournament -w @raid/server -- --games 400 --workers 6 --lineup E,E,N,N,H,H --seed 1 [--learn off] [--persona mix]
```

More flags: `--faction`, `--patience S`, `--sudden S` and `--max-minutes M` (the tuning log plays the real timers, `--patience 300
--sudden 60 --max-minutes 15`), `--latency`, `--jitter`, `--json FILE`, `--tune JSON|@file` (patches the TIERS / PERSONAS tables for
a diagnostic) and `--quiet`.

**One game.**
- Headless, with no Room: `createGameWorld` + `step` + `FxChannel` in the Room's order, and the `BotManager` delay line and
  runners.
- Six bots join and `startRaid` runs at once; mobs are on.
- Shortened timers by default: patience 120 s scaling to 48 s, sudden death 30 s; a game is capped at 12 simulated minutes.
- The games have no planning phase (`planSeconds` is unset in `HEADLESS_CONFIG`), so the planning module is registered but never
  acts in a tournament; the chests module does.
- Measured (real timers, 8 workers): 400 games in 47 s, about 0.85 s of worker time and 174 simulated seconds per game.

**Deterministic per seed.** One game replays byte for byte from its seed (tested). With learning on the stats store lives in
memory per worker, so a game also depends on the games before it in its worker; the split is fixed (game g goes to worker g mod
W), so the same seed and worker count replay. `--learn off` makes every game a pure function of its seed.

**Report.**
- Per tier: wins per bot with Wilson 95% intervals, mean placement, kills and deaths, damage dealt, mob kills, how the bots
  died (to a bot, a mob, sudden death);
- reaction-time p10, p50, p90 and mean, per tier and stimulus;
- lock misclick and wrong-pick rates; move scatter RMS;
- APM mean and peak;
- dodges and jukes attempted;
- orb-walk cycles;
- per persona and per faction.

**Pass criteria (the tuning target, not CI).**
- Mean placement and win share order **Hard > Normal > Easy**, with non-overlapping 90% intervals at 400 games.
- Per-bot win share: Hard ≤ 0.40 (not untouchable), Easy ≥ 0.03.
- Starting bands to tune toward: Hard 0.25-0.35, Normal 0.13-0.20, Easy 0.04-0.10.
- Measured reaction means within ±10% of the table. Zero commands refused by `enqueueClientMessage`. Zero APM breaches. Zero
  brain errors, no game at the 12-minute cap, and no bot standing still over 8 s.

**Measured at the merge** (real timers, lineup E,E,N,N,H,H, 400 games, seed 3; the table is in `docs/BOTS_TUNING.md`, "State at
the merge"): per-bot win share Hard 19.9%, Normal 15.3%, Easy 14.9%; mean placement 3.36, 3.57, 3.56. Hard is separated from the
other two; Normal and Easy are not (their placement intervals overlap). Only Normal is inside its starting band, Hard is under
0.25 and Easy over 0.10. The tuning that got here is `docs/BOTS_TUNING.md`; tuning stopped at this point by owner decision.

**Exploit scenarios** (planned: `test/bots/exploits.test.ts` does not exist yet; scripted opponents in the real sim, one Hard
bot), each to pass against its baseline over 50 seeds:
- **Feint.** A feinting wand forces significantly more dodge-drops than an honest one.
- **Third party.** A third party from off screen lands its first hit before the Hard bot turns, in ≥ 60% of seeds.
- **Kite-cutting.** A chaser that leads the straight-away kite catches it in fewer seconds than a plain chaser.

A CI smoke (`test/bots/tournament.test.ts`) plays a game and checks that it replays byte for byte. The full tournament is a report command, like the harness.

**Humans.** The owner plays 10 runs against 5 Hard bots. Target: a competent player wins at least 1 in 4, and every
weakness in 2.8 is felt (owner question 13).

---

## 10. Layout, ownership, integration order

```
packages/server/src/bots/
  brain/types.ts            contract (done)                                         architect
  brain/perception.ts       state + fx -> Frame; detectFeatures (only schema reader) P
  brain/frames.ts           FrameRing, compose (delay, interpolation, window)        P
  brain/memory.ts           MemoryApi, stimuli                                       M
  brain/knowledge.ts        Knowledge (masked wheels, mobShare, odds)                S
  brain/strategy.ts         StrategyLayer, pursuit-ring breaker                      S
  brain/huntAdapter.ts      Percept + memory -> HuntInput, per-bot MobHunter         S
  brain/tactics.ts          TacticsLayer: lock, kite, dodge, swap, pickup, coliseum   T
  brain/humanizer.ts        Humanizer: delays, channels, APM, re-sends               H
  brain/clicks.ts           pickTarget port, scatter, edge/minimap clicks            H
  brain/random.ts           ex-Gaussian, Gaussian, softmax on an Rng                 H
  brain/services.ts         PathService (budget, cache)                              I
  brain/brain.ts            createBrain: the tick loop of 4                          I
  brain/runner.ts           BotRunner: perceive -> ring -> brain -> adapter          I
  brain/modules/*.ts        index (registry), wishes, planning, chests, hazards              W (as each feature lands)
  learning/BotStatsStore.ts the stats file                                           L
  BotManager.ts, callsigns.ts   in-process driver, fill, delay line                  D1
  BotClient.ts (rewrite), runBots.ts (--tier --persona --seed --stats)  network adapter, CLI  D2
  tournament/runTournament.ts, tournament/worker.ts                                  Q
  mobHunt.ts                the mob hunt, plus planSpawnScore and planPick for the planning module
  chestHunt.ts              pure chest policy (walk or pick), the chests module's engine
sim/step.ts, rooms/RaidRoom.ts, config.ts: 7.2 and 7.3                               R
```

Every owner writes against `types.ts` alone. Perception is written against the schema. D1, D2 and Q write against
`brain/runner.ts`'s `BotRunnerApi`, which I stubs first in phase B with the real signature. Stub `Knowledge`, `PathService`
and `Percept` builders live in `test/bots/fixtures.ts` (P owns them), so S, T, H and M can test without the others.

**Order.**
1. **Phase A, in parallel.** P, M, S, T, H, L, R (no BotManager yet: the lobby rule, the hook, config). Gates: the fairness
   suite once P lands, and each owner's unit tests.
2. **Phase B.** I composes `brain.ts`, `runner.ts` and `services.ts`. D2 rewrites `BotClient`. Gate 1: the existing e2e green
   through the new brain.
3. **Phase C.** D1 builds `BotManager`, and R wires it into the Room. Gate 2: `e2eFill`, perf and bandwidth with 8 bots,
   botRoom and botSeat still green.
4. **Phase D.** Q builds the tournament; tuning only changes `TIERS` and `PERSONAS`. Gate 3: the ranking criteria.
5. **Phase E.** W adds feature modules as Wishes, R3, R5, R6, R7 and zone terrain merge, starting with `wishesAdapter.ts`.
6. **Docs, last.** CLAUDE.md:
   - a "Bots" architecture rule: the percept boundary, the delay line, `enqueueClientMessage`, the fill rules;
   - the Commands block: `npm run tournament`, the new `npm run bots` flags;
   - the env list.
   README: how to turn fill off.

---

## 11. Owner questions

Every best guess in the bots, one list, each with the default the code uses. All are easy to change. The numbers are stable
(other documents cite them); 21 and up are the guesses the implementers added after the first twenty.

1. **Bot kills and the bounty ladder: ADOPTED.** Killing a bot pays no GV and does not climb the killer's bounty ladder
   (`updateBounty` reads `kills − botKills`), so an alt cannot cash a bounty built on bots. The alternative was to keep it
   for gameplay (bots chase bountied humans).
2. **The buff transfer from a bot's death** (half of a bountied victim's buffs go to the killer) runs as for humans. The kill
   combos no longer exist.
3. **Stats from runs with bots.** `RunResult.kills` excludes bot kills. A win against bots counts in `stats.wins` but is not
   `winQualified` (fewer than 3 human starters). Should such a win count at all?
4. **Fill to 6, arriving over the last 12 s** (decided), bots never shorten the countdown, and a human who joins a full lobby
   takes the newest bot's seat.
5. **Tier mix 30/45/25 (decided), personas uniform.** Should the mix adapt to the humans' skill (no rating exists)?
6. **The assumed screen is 16:9** (decided; 800 × 562.5 u half-extents). The bots read the minimap's mob dots and chest blips
   map-wide but it shows no player, so they never peek at one, as a human cannot.
7. **Callsigns.** Human-looking names, checked read-only against existing profiles. Or no lookup, and let `[BOT]`
   disambiguate?
8. **Bots ignore the `[BOT]` flag** when choosing whom to fight (tested). Should they prefer humans, or avoid ganging up on them?
9. **A run with only bots left standing** plays out while humans spectate. Fast-forward or void it instead?
10. **Latency emulation** is 30 ± 8 ms each way, the same for all tiers. Should it vary per bot, like real players?
11. **The humanizer's numbers** (2.2): reaction means 450/280/200 ms (ex-Gaussian), APM 60/110/170 with bursts 3/4/5, hesitation
    12/7/4%, the misclick rates (a lone Easy bot misses a lock click 7.4% of the time, Normal 1.2%, Hard 0.2%), and the
    dodge and juke chances.
12. **Bots never stream `aim`.** A shield bot without a lock faces its walk direction, a slight handicap. Allow a 5 Hz aim
    toward the main threat?
13. **What "Hard is beatable" means.** The tournament bands in 9.3 and the human target of at least 1 win in 4 against 5 Hard
    bots. At the merge the bands are not met (9.3: Hard 19.9%, Normal 15.3%, Easy 14.9%) and tuning stopped there; keep the
    bands as the target, or take these as the tiers?
14. **Learning** is on by default, half-life about 69 runs, bias at most ±0.075 utility. CLI bots learn only with `--stats`.
    The file sits next to the profile file.
15. **The minimap ids shortcut** (3.2), standing for tracking dots by continuity.
16. **Rule knowledge.** A bot knows the sudden-death rule with chance `knowledge` (drawn once per bot). Wish memory is not
    gated by it: every tier counts a Wish it saw land as unavailable for 300 s, and no tier models the 45 s Wish lock; nothing
    reads the guess yet. Gate both by `knowledge` as 2.7 once said, or leave them?
17. **Bots in training rooms:** never, for now. A sparring partner later?
18. **Bot cosmetics:** `look` is 0, so bots wear none.
19. **Fill in `npm run dev`** is on by default (6). Should the dev script set it to 0?
20. **The lobby line** could also say how many bots are present, e.g. "Waiting for players 4/2 (3 bots)". Wanted?
21. **Easy and its Wish.** Easy only casts escape and sustain Wishes (never Freeze or Trial) and remembers its Wish 60% of the
    times it becomes available; Normal and Hard use every intent.
22. **A mob's windup counts as a `windupAtMe` stimulus,** answered like a player's (reaction, then the feasibility check of 2.6).
23. **A remembered opponent's hp resets to full after 20 s unseen,** and its whereabouts are forgotten after 25/35/45 s
    (Easy/Normal/Hard).
24. **Fight appraisal, wariness and mob caution** (`docs/BOTS_TUNING.md` 3). The tiers differ by the quality of their choices:
    how a bot sizes up a fight (the hp lead decides, the hue hardly does), how far it keeps from a player it does not want to
    fight (0/300/450 u), and which mobs it takes (matchup share and hp). A first-minute opening penalty (up to +3.5 logit,
    fading over 60 s) holds fights back early. This rests on the sim's currency: hp does not regenerate and the patience timer
    sends everyone to the coliseum, so the player who spends least hp wins. Execution (reaction, accuracy, APM) separates the
    tiers hardly at all, because the server plays the fight for everyone.
25. **Planning and chest timing.** The planning module reads the screen 2-4 s (Hard), 3-6 s (Normal) or 4-8 s (Easy) after the
    deal, scaled down in a short window and never over 55% of it, then readies 0.3-0.8, 0.5-1.4 or 0.8-2.2 s after its last
    choice. Chest walks and picks are answered as a reading reaction (1.5 × the tier's reaction), not as a 1.5-4 s dwell, and
    its spawn pick goes through the tier's softmax (Easy sometimes takes the worse start).
26. **The e2e persona order** is `[hunter, hunter, farmer, opportunist]` at Hard, index 1 being the bot that quits a second in,
    so the farmer's seat stays and the mob kills lean on it.
27. **The faction pick** is the manager's, not the brain's: a softmax (T 0.3) over the learned `faction|<persona>|<faction>`
    biases with a 5% uniform floor and at most 2 of a faction per lobby, recorded as a learning key by `BotManager.onResult`.
28. **Chest visibility.** Every chest is known map-wide from the minimap (place and seconds left); its cards are read only within
    88 u with a clear line, as the client's panel shows them. The walk never looks at a card: from afar every chest is "a skill".
29. **Chest value and picks.** A walk is worth 0.9 × (0.25 + 0.75 × loot weight), more with a crowd at the chest and nearness,
    capped at 0.84 so a committed fight is never left for one. The best free card the bot can use is taken, else a skip; a card
    lost to a faster hand is asked for again on another, 3 asks inside 4 s at most.
30. **Jukes stay in** although they are a small net loss (`docs/BOTS_TUNING.md` 4): they are the documented exploit (2.8). The
    orb-walk almost never fires with the paced numbers; the code and the tables stay for a Fire or Frost bow.
31. **Persona numbers** (section 5): the fight edge, flee and re-engage hp, kite factor, chase give-up, mob kill goal, threat
    radius, elite appetite, and how long a bot holds in the coliseum (12 to 48 s after the teleport, the bolder personas
    first).
