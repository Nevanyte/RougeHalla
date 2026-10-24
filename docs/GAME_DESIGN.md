# RougeHalla: Game Design Document

*Working title. Version 1 of this document, written from the owner's design board, the class sheet in `testing/`, and the approved build plan.*

*Revision v3 (attack speed). Fire attacks at 0.60/s (hit 305 to 150, base DPS 91.5 to 90, backlash 210 to 200) and Frost at 0.45/s (hit 135 to 90, DPS unchanged at 40.5). A weapon is now a % boost on the faction's base attack speed, so the speed ratios between factions hold on every weapon. Fire's axe swings every 1.19 s (was 2.58 s) and the slowest combo in the game, Frost's axe, every 1.59 s (was 2.58 s). The cost: Fire's backlash reads the foe's attack rate, so a faster Frost feeds it and Frost over Fire gets thinner (59% to 49% HP left). It never flips. Fixed animation timings now scale down with the interval, and a staggered target is immune to stagger for 0.5 s (sections 9.1 and 10.3).*

---

## 1. The game in one paragraph

RougeHalla is a top-down, League-of-Legends-angled **roguelike battle arena**. You pick one of five factions, step out of the hub into an arena with up to seven other players, and start with almost nothing: your faction's signature weapon and your wits. You build a run by looting chests, fighting the neutral creatures of five regions (each region drops its own weapon and stat buffs), and picking fights you can win. Two counter loops decide every fight: **faction against faction** and **weapon against weapon**. There is no shrinking zone. Instead, the impatient host of the Arena runs a visible **patience timer**. If nobody dies before it runs out, everyone is teleported into the central coliseum and locked in until someone falls. The last player standing earns **Glorious Victory (GV)**. Everything you found during the run is gone when it ends. GV, cosmetics, titles and achievements are what you keep.

---

## 2. Scope

### 2.1 First playable (the target)
**Hub (menu) → pick faction → arena with weapons, mobs, patience timer and coliseum → last one standing → GV → back to the hub.**

| Area | In the first playable |
|---|---|
| Players per arena | Up to 8 |
| Factions | All 5 (Fire, Sentenced, Plague, Frost, Holy / "Demon Blood") with their signature mechanics |
| Weapons | All 5 (Sword, Bow, Wand, Shield, Axe) with their counters and interactions; 2 weapon slots |
| Map | 5 faction regions around a central coliseum with lockable gates |
| PvE | Neutral regional mobs that fight back and drop GV, a stat buff and their weapon; chests |
| Pressure | Patience timer → coliseum teleport → gates locked → sudden death |
| Snowballing | Feed score, S-curve buffs with combo thresholds, falling mob rewards, bounties |
| Persistence | Profile with GV, stats, cosmetics (shop), achievements, titles, monthly GV leaderboard |
| Hub | Menu-based hub (GV, faction pick, counter wheel, shop, leaderboard), then a walkable hub with training grounds |

### 2.2 Later (designed, not in the first playable)
- **Quest NPCs.** Unique arena NPCs each offer a simple quest. The first player to finish it gets that NPC's unique reward (items, armor, sometimes abilities).
- **Raid-boss mobs.** Some neutral creatures reach raid-boss strength.
- **Secrets and lore.** Hidden spots for rare loot, cosmetics and lore snippets that point to deeper secrets.
- **Social.** Friends list, hosting 1v1s, private matches, text chat.
- **Hub NPCs** that exist only in the hub.

### 2.3 Out of scope for now
- **Real-money purchases.** The shop design allows them (cosmetics only), but no payments are built.
- **Accounts with passwords.** Profiles are callsigns tied to a token on the device.
- **Matchmaking by skill, ranked play, multiple servers.**

---

## 3. A run, start to finish

1. **Hub.** You see your GV balance, titles and leaderboard position. You pick a **faction** for this run; your **signature weapon** comes with it. A counter wheel shows both loops and where your pick sits.
2. **Enter the Arena.** You climb the stairs (in the menu hub: press *Enter Arena*). You join a lobby of up to 8. The lobby starts the run when enough players are in or a short timer runs out.
3. **Spawn.** Players spawn spread out at the edges of the five regions.
4. **Early run.** Loot chests, hunt neutral mobs for buffs, GV and weapons, and route toward the region whose weapon counters what you're seeing.
5. **Mid run.** Fights break out. Every death resets the patience timer. Fed players gain bounties and get marked on everyone's minimap.
6. **Patience runs out.** If nobody dies for the full timer, the host teleports everyone alive into the **coliseum** and locks the gates. The gates open again as soon as someone dies.
7. **Endgame.** As players die, the patience timer shortens. With few players left, fights happen often, in the open or in the coliseum.
8. **Glorious Victory.** The last one standing wins and gets the win bonus. Everyone keeps the GV they earned during the run. Run gear (weapons, buffs) is gone.
9. **Results → hub.** The results screen shows kills, GV earned, bounties claimed and time survived. Then you're back in the hub.

---

## 4. The hub

| Hub feature | What it does | When |
|---|---|---|
| GV balance and titles | Shows your currency and equipped title | First playable |
| Faction picker | Choose a faction; shows its card and signature weapon | First playable |
| Counter wheel | Both pentagrams (factions, weapons) with your pick highlighted | First playable |
| Cosmetics shop | Spend GV on colours, trails, titles and golden weapon variants. Cosmetics only. | First playable |
| Leaderboard | Monthly GV ranking | First playable |
| Achievements | e.g. 5 wins holding the same weapon unlocks its golden variant | First playable |
| Training grounds | Try any weapon combination; spar with training mobs (no GV) | Walkable hub phase |
| Stairs to the Arena | The physical entrance to matchmaking | Walkable hub phase |
| Hub NPCs | Characters who never appear in the Arena | Later |
| Social | Friends, 1v1s, private matches, chat | Later |

---

## 5. The arena map

The map is generated from a seed. The server and every client build the same map from that seed, so the layout itself never travels over the network.

- **Five regions** surround the centre, one per faction:

  | Region | Faction | Mobs carry |
  |---|---|---|
  | Under the mountain | Fire | Axes |
  | Haunted farmland (the Cult) | Sentenced | Swords |
  | The forgotten city | Plague | Bows |
  | The frozen plains | Frost | Shields |
  | The desert | Holy / Demon Blood | Wands |

  Because each region's mobs always carry the same weapon, **the map is a shopping list for counters**. If you're Plague and keep running into shields, you go where the axes are.
- **The coliseum** sits in the centre, with 4 gates. The gates are wall tiles that close on command. Inside are spawn spots for the teleport.
- **Cover.** Walls and obstacles keep sight lines short: with the gates open, no straight one-tile-wide (32 u) strip of open floor is longer than a bow's 480-unit range, at any angle. That holds in every region, inside the coliseum and through its gates. Narrower gaps are not guaranteed.
- **Chests and mob camps** are spread per region; players spawn at the region edges.

The coliseum always has pillars. With the gates open or closed, no 32 u-wide corridor inside or through it is longer than 480 units, so archers can't kite across the final arena.

---

## 6. Pressure: patience timer, coliseum, sudden death

There is **no shrinking zone**. Pressure comes from the Arena's host losing patience.

| Rule | Detail |
|---|---|
| Patience timer | Visible to all. Resets every time a **player** dies (mobs don't count). |
| Timer length scales with players alive | 5:00 with 8 alive, shrinking linearly to 2:00 at 3 or fewer. Each reset uses the current count. |
| Expiry | Everyone alive is teleported to the coliseum and the gates lock. A 30-second warning precedes it. |
| Teleport safety | 1.5 s of immunity after arriving (no damage taken or dealt); arrows and balls in flight are cleared. |
| Gates reopen | The moment any player dies. The timer resets and players can roam again. |
| Sudden death | After 60 s locked in with no kill, everyone in the coliseum takes damage that ramps every second until someone falls. |
| Simultaneous deaths | If the last two die in the same tick, the one with the higher HP fraction at the start of that tick wins; an exact tie is a draw. |
| Disconnects | A disconnected player who doesn't return within the grace period counts as a death (it resets the timer). During the grace period they count as alive. |

---

## 7. Winning, dying, and what persists

| Event | What happens |
|---|---|
| You die | Your run ends. Your weapons and buffs are gone. You keep the GV you earned this run. |
| You win | +50 GV win bonus on top of what you earned. |
| Solo run (fewer than 2 humans) | No win bonus. |
| Persists between runs | GV, cosmetics owned and equipped, titles, achievements, stats (wins, kills, per-weapon and per-faction records), monthly GV total |
| Never persists | Weapons, buffs, feed score, bounty |

---

## 8. Factions

Five factions form a closed loop: **each beats exactly two and loses to exactly two.** The numbers come from the owner's design engine (`testing/engine.py`, `testing/classes.py`). The game's TypeScript copy is tested against it so they can't drift apart.

### 8.1 The rulebook (identical for every fight)
1. **Attack.** Each second a fighter deals `rate × hit` raw damage plus its signature bonus.
2. **Three damage shares.** Every hit is split into physical, magic and true damage; the shares belong to the attacker.
3. **Defense.** Armor cuts the physical share and shield cuts the magic share; true damage ignores both. Reduction is `1 / (1 + stat/100)`: 100 means half damage, 300 means a quarter.
4. **Rate effects.** One aura exists (Frost's slow). It multiplies an opponent's attack rate. It slows `rate × hit` only, not flat bonuses.
5. **Health effects.** Mechanics may read health fractions (the target's for execute, your own for lifesteal), never an opponent's identity.
6. **Time effects.** A mechanic may read time spent in the fight (the mark ramp).

No rule mentions a faction by name. Every counter falls out of the numbers.

### 8.2 Stat sheet (v3)

| Faction | Role | HP | Attack rate | Hit | Base DPS | Damage mix (phys / magic / true) | Armor | Shield |
|---|---|---|---|---|---|---|---|---|
| Fire | Glass-cannon duelist | 500 | 0.60/s | 150 | 90 | 0 / 100 / 0 | 0 | 125 |
| Sentenced | Patient executioner | 700 | 0.90/s | 5 | 4.5 | 0 / 100 / 0 | 100 | 50 |
| Plague | Attrition swarm | 1000 | 1.85/s | 20 | 37 | 80 / 20 / 0 | 200 | 0 |
| Frost | Control bruiser | 1750 | 0.45/s | 90 | 40.5 | 90 / 10 / 0 | 100 | 100 |
| Holy (Demon Blood) | Sustain juggernaut | 1450 | 0.95/s | 65 | 62 | 100 / 0 / 0 | 0 | 250 |

Attack rate is the faction's base. Each weapon boosts it by a percentage (section 10.2).

### 8.3 Signatures

| Faction | Signature | What it does | How it feels |
|---|---|---|---|
| Fire | **Dragonslayer** | 10 burn per second, plus **200 backlash for each attack the engaged enemy makes at its base rate** (per real swing 93 to 143 depending on its weapon, section 10.3) | Punishes fast attackers. Against Plague's flurry it's over in seconds. |
| Sentenced | **Marked** | Bonus damage ramping +35/s for every second in the fight, capped at 275/s (7.9 s to full). The mark is tied to the **weapon the target is holding**; swapping weapons resets it. | Gets worse for the opponent every second. Its own hits barely matter (5 damage). |
| Plague | **Rat King** | 40 disease per second, plus an execute adding up to 1025/s as the target falls from 50% to 0 HP | A slow squeeze that collapses into a kill |
| Frost | **Living Wall of Ice** | Anyone engaged with Frost has their **attack rate cut to 40%** and their **movement slowed** | The fight slows down and Frost sets the pace |
| Holy | **Radiant** | Heals a share of damage dealt equal to `0.25 + 1.25 × missing HP`, capped at 100% | Hardest to finish when nearly dead |

### 8.4 Who beats whom, and why

| Winner | Loser | Deciding factor | Fight length | Winner HP left |
|---|---|---|---|---|
| Fire | Sentenced | Fire's burst ends the fight before the mark builds | 3.7 s | 77% |
| Fire | Plague | Plague's 1.85 swings/s feed Fire's backlash (about 370 damage per second) | 2.1 s | 71% |
| Sentenced | Plague | The mark lands at 100% on Plague's zero shield; Plague's physical damage is cut to 53% | 7.4 s | 56% |
| Sentenced | Frost | The flat mark ignores Frost's slow; armor halves Frost's hits | 16.6 s | 51% |
| Plague | Frost | Disease and execute are flat, so the slow barely matters; the execute decides it | 37.0 s | 40% |
| Plague | Holy | 86% of Plague's damage gets through Holy's zero armor | 15.8 s | 67% |
| Frost | Holy | The slow cuts Holy's swings, and with them its healing, from 0.95 to 0.38/s | 52.3 s | 63% |
| Frost | Fire | Frost's 0.45/s feeds the backlash only 90 damage per second (its shield cuts half), and the slow cuts Fire to 0.24 swings/s | 13.1 s | 49% |
| Holy | Fire | A 250 shield cuts Fire's all-magic damage to 29% | 8.1 s | 69% |
| Holy | Sentenced | The shield cuts the mark to 29%; lifesteal decides it | 22.7 s | 27% (tightest) |

**The main axis is damage type against defense type.** Magic damage (Fire, Sentenced) crushes the shieldless (Plague) and bounces off the heavily shielded (Holy). Physical damage (Plague, Frost, Holy) punishes zero armor. On top of that sit rate against flat damage (Frost's slow only hurts rate-based attackers), burst against ramp (Fire ends fights before the mark or execute come online) and HP pool (Holy and Frost win long fights).

### 8.5 How much of a hit survives (attacker → defender)

| attacker \ defender | Fire | Sentenced | Plague | Frost | Holy |
|---|---|---|---|---|---|
| **Fire** | – | 0.67 | 1.00 | 0.50 | 0.29 |
| **Sentenced** | 0.44 | – | 1.00 | 0.50 | 0.29 |
| **Plague** | 0.89 | 0.53 | – | 0.50 | 0.86 |
| **Frost** | 0.94 | 0.52 | 0.40 | – | 0.93 |
| **Holy** | 1.00 | 0.50 | 0.33 | 0.50 | – |

### 8.6 Identity test: every signature must matter
Remove a signature and the class must visibly lose: a main signature has to flip at least one required win, a sub-mechanic at least has to move a margin a lot.

| Faction | Removed | Wins lost | Largest margin swing |
|---|---|---|---|
| Fire | Burn and backlash | vs Sentenced, vs Plague | 131 points |
| Fire | Backlash only | vs Sentenced, vs Plague | 127 |
| Sentenced | The mark | vs Plague, vs Frost | 152 |
| Sentenced | The ramp (mark full from t = 0) | none | 70 |
| Plague | Execute | vs Frost | 43 |
| Plague | Flat disease | vs Frost | 114 |
| Frost | The slow | vs Holy | 103 |
| Holy | Lifesteal | vs Sentenced | 30 |
| Holy | Missing-HP scaling | none | 19 |

### 8.7 Design notes on the factions
- **Fire's burn (10/s) is nearly cosmetic.** Backlash does the work: 64% to 79% of Fire's damage against Sentenced, Plague and Frost, against 2% to 7% for burn. If burn should matter, raise it and retune.
- **Frost over Fire got thinner** (59% to 49% HP left). Fire's backlash reads the foe's attack rate, so a faster Frost feeds it: 90 backlash per second against Frost, up from 63. It never flips. In the 20 Hz check the smallest HP buff on Fire that flips it is now ×1.59 (it was ×1.97). Raising Fire's own rate is free: at equal damage per second it moves no engine result (and at most 3 points in the 20 Hz duels).
- **Holy beats Sentenced is the tightest edge** (27% HP left); lifesteal decides it.
- **Fights are long in places** (Frost over Holy is 52 s). Duels are being sped up for the arena (section 10.2).
- **Robustness.** The engine checks pass with every stat randomly jittered by ±10%, at any global power level, and with names shuffled (proving no matchup is hard-coded).

---

## 9. Weapons

Five weapons form a second closed loop; again **each beats two and loses to two.** They are hard counters, not impossible matchups. You carry **two**, so what you hold, and what you go and get, matters.

### 9.1 How each weapon works

| | Sword | Bow | Wand | Shield | Axe |
|---|---|---|---|---|---|
| Shape | Quarter-circle (90°) swing, reach 64 | Arrow, fast (900 u/s), range 480 | Magic ball, medium speed (380 u/s), range 420 | Barrier always raised toward the cursor (±60° front); click to bash like a swinging door (120°, reach 44) | Half-circle (180°) swing, reach 60 |
| Input | Click | Click and hold to draw, release to fire | Click | Shield follows the cursor; click to bash | Click |
| When damage lands | 0.1 s into the swing | On release | Ball leaves 0.2 s after the click (at most 40% of the interval) | 0.1 s into the bash | 0.25 s into the swing (at most 25% of the interval) |
| Attack speed boost | +115% | +95% | +65% | +60% | +40% |
| Movement | Unaffected | Slowed to 75% while drawing; after release, half speed until the cooldown ends | Slowed to 35% for 0.4 s per cast (at most 45% of the interval); then half speed until the cooldown ends | Unaffected | Rooted for the 0.5 s swing (at most 50% of the interval) |
| Damage multiplier | 1.0 | 0.8 | 0.85 | 0.75 | 0.9 |
| Special | A hit that isn't blocked **staggers**: cancels the target's windup and resets a bow draw. A staggered target can't be staggered again for 0.5 s. | Draw time (0.15–0.6 s) scales damage from 40% to 100%. Full draw is at most 70% of the interval, and the minimum draw shrinks with it. | The ball **deletes arrows** within 28 units and **pierces shields** | Blocks frontal hits, **reflects arrows** back (the shield holder owns them), **negates a frontal sword hit and ripostes** 50% of it | **Pierces shields**, **destroys magic balls** its swing meets |

The interval is the time between attacks (section 10.2). The axe, bow and wand animation times above shrink with it, so fast cadences are never rooted or slowed for good.

Ranged weapons can kite, so three things hold them back:
- Damage starts slightly lower: bow 0.8, wand 0.85. These are maximums on the 0.05 grid: in the real-time check, bow 0.85 or wand 0.90 lets the ranged loser out-kite (Fire over Plague, and Holy over Sentenced on the wand).
- Movement slows while drawing and casting.
- After each ranged attack you move at half speed until the cooldown ends, so a ranged player backing away while shooting can still be caught.

### 9.2 The weapon loop

| Weapon | Beats | Why | Loses to | Why |
|---|---|---|---|---|
| **Sword** | Axe | Faster swings (+115% against +40%) and stagger: it weaves in more attacks | Bow | Range |
| | Wand | Its swing halves the damage of balls it meets | Shield | Blocked and riposted |
| **Bow** | Sword | Range | Shield | Arrows reflected back |
| | Axe | Huge range gap; the axe roots to swing | Wand | Balls delete arrows |
| **Wand** | Bow | Balls delete arrows | Sword | Swings cut ball damage |
| | Shield | Balls pierce shields | Axe | Swings destroy balls |
| **Shield** | Sword | Blocks and ripostes | Wand | Balls pierce it |
| | Bow | Reflects arrows | Axe | Axe pierces it |
| **Axe** | Wand | Destroys balls | Bow | Range |
| | Shield | Pierces it | Sword | Out-swung |

### 9.3 Inventory and pickups
- **Two weapon slots.** Swap between them. Swapping shares the attack cooldown, adds 0.25 s, and cancels your current action, so it can't be used to cut animations short.
- **Pick up** a weapon from a chest or the ground by pressing F near it. If both slots are full, the weapon in your active slot is dropped.
- **Mob drops.** A mob drops the weapon it carried, unless the killer already holds that weapon type.
- **Swapping is skill expression.** Changing to the counter weapon mid-fight is the big play. Swapping also **resets a Sentenced mark** on you, so it's the counterplay to Sentenced.

---

## 10. How factions and weapons combine (class scaling)

### 10.1 The two loops together
- **Rule of thumb: weapons decide reach; factions decide trades.**
  - Who can hit whom, from where, is the weapon's job: range, blocks, interceptions.
  - Once two players are trading blows, the faction loop decides who outlasts whom.
- **Signature weapons keep almost every opening matchup contested.** Mostly, each faction starts with the weapon that **loses** the weapon edge against the factions it beats on stats:

  | Faction | Starts with | Beats (faction) | Weapon matchup in that opening |
  |---|---|---|---|
  | Fire | Axe | Sentenced (Bow), Plague (Bow) | Bow > Axe in both: contested |
  | Sentenced | **Bow** | Plague (Bow), Frost (Shield) | Bow vs Bow mirror: neutral; Shield > Bow: contested |
  | Plague | Bow | Frost (Shield), Holy (Wand) | Shield > Bow, Wand > Bow: contested |
  | Frost | Shield | Holy (Wand), Fire (Axe) | Wand > Shield, Axe > Shield: contested |
  | Holy | Wand | Fire (Axe), Sentenced (Bow) | Axe > Wand: contested; Wand > Bow: **favours Holy** |

  - **8 of the 10 openings are contested.** The faction winner starts with the losing weapon, so no fight is decided on the pick screen. The real decision is **which second weapon to go and get**.
  - **Sentenced vs Plague** starts as a bow mirror, so the faction edge decides it.
  - **Holy vs Sentenced** favours Holy on both loops, on purpose. With Sentenced on the sword it would be the thinnest opening in the game (Holy keeps about 8% HP in the worst case, so any buff decides it). With Sentenced on the bow, Holy keeps 30%.
  - **Region weapons don't change.** The Sentenced region's mobs still carry swords, so all five weapons can be farmed somewhere.

### 10.2 The scaling formula
- **The weapon sets the shape. The faction sets the rhythm and the punch.**
- **A weapon is a % boost on the faction's base attack speed**, so the speed ratios between factions hold on every weapon.
  - Attacks per second = `faction rate × (1 + weapon boost) × attack-speed buffs`.
  - Seconds between attacks (the interval) = 1 ÷ that, never below the weapon's floor.
  - Boosts: sword +115%, bow +95%, wand +65%, shield +60%, axe +40%.
  - Floors (the shortest interval): sword 0.25 s, bow 0.25 s, wand 0.3 s, shield 0.3 s, axe 0.35 s. At base speed none of them binds. They only bind under attack-speed buffs (section 10.3).
- **Damage per hit** = `faction rate × faction hit × weapon damage multiplier × buffs × interval`. With no buffs that is `faction hit × damage multiplier ÷ (1 + boost)`. Every faction keeps its own damage per second, times the weapon's damage multiplier, on every weapon: faster weapons hit proportionally lighter. Weapons change the rhythm and shape, not the class's power.
- **Signature bonuses scale with the weapon multiplier too** (burn, backlash, disease, execute, mark). Otherwise a weapon's damage discount would hit some factions much harder than others.
- **Duel pace (k = 2).** All faction damage is doubled (and Sentenced's mark ramp quadrupled), HP unchanged, so every fight is **exactly twice as short** while the counter graph holds. For example, Frost over Holy drops from 52 s to about 26 s, and Fire over Plague takes 1.1 s.

Interval and damage per hit with no buffs, before duel pace (double the hits for in-game values):

| Faction | DPS | Sword | Axe | Bow | Wand | Shield |
|---|---|---|---|---|---|---|
| Fire | 90.0 | 0.78 s / 70 | 1.19 s / 96 | 0.85 s / 62 | 1.01 s / 77 | 1.04 s / 70 |
| Sentenced | 4.5 | 0.52 s / 2 | 0.79 s / 3 | 0.57 s / 2 | 0.67 s / 3 | 0.69 s / 2 |
| Plague | 37.0 | 0.25 s / 9 | 0.39 s / 13 | 0.28 s / 8 | 0.33 s / 10 | 0.34 s / 9 |
| Frost | 40.5 | 1.03 s / 42 | 1.59 s / 58 | 1.14 s / 37 | 1.35 s / 46 | 1.39 s / 42 |
| Holy | 61.8 | 0.49 s / 30 | 0.75 s / 42 | 0.54 s / 27 | 0.64 s / 33 | 0.66 s / 30 |

Reading the table:
- Every column has the same speed ratios: on any weapon Plague swings 4.1× as often as Frost and 3.1× as often as Fire.
- Fire with an axe swings every 1.2 s for a 96-damage hit; Plague with a bow fires 3.6 arrows a second.
- Frost with an axe is the slowest combo in the game, one swing every 1.6 s. In the 20 Hz duels the longest stretch with no swing from either fighter is also 1.6 s.
- Plague's sword (0.251 s) sits just above its 0.25 s floor, so any attack-speed buff on it turns into damage per hit at once.
- Sentenced's weapon hits are near zero on purpose; the mark is its damage.

### 10.3 Signatures in real time
The design engine assumes two fighters standing in range forever. The game has movement, walls and up to 8 players, so the signatures follow these rules:

| Rule | Why |
|---|---|
| **Engagement.** A signature applies to your **current target**: the last enemy you hit, while they are within your own weapon's range and in line of sight (plus the linger below). | Turns 1v1 math into multiplayer rules, and stops ranged DoT classes winning from range without swinging |
| **The clock starts at first contact** between two players, not at your own first hit | Keeps fights from being decided by who swung first |
| **Bonus damage lingers 1.25 s** after line of sight breaks | Stops peek-fighting (pop out, hit, hide, repeat) |
| **The mark holds through breaks.** It freezes while hidden and resets on target switch, a weapon swap by the target, death, or 10 s without contact. | Sentenced isn't cheesed by walls |
| **Frost's chill** applies to everyone engaged with Frost. It doesn't stack, and it stretches cooldowns smoothly every tick (it's never snapshotted at swing time). The **movement** slow only applies within melee reach of Frost (about 100 u). | A small radius would let ranged enemies ignore the attack slow; a ranged Frost slowing its chaser would be uncatchable |
| **Fire's backlash** hits an engaged enemy each time they swing, sized by how often their weapon swings (200 ÷ (1 + the weapon's boost)): sword 93, bow 103, wand 121, shield 125, axe 143 | Literally "damaged when swinging", and over time it matches the design engine exactly. A flat 200 per swing would have over-punished fast weapons. |
| **HP stays fractional** and cooldown remainders carry over | Avoids rounding cliffs that flip close fights |
| **Healing** (when added) only works after 3 s out of combat. Holy's lifesteal is exempt. | Mid-duel heals flip faction counters; blocking lifesteal would break Holy |
| **Attack-speed buffs** past a weapon's floor (its shortest interval) turn into extra damage per hit. Plague's sword (0.251 s) is just above its 0.25 s floor, so any attack-speed buff on it converts at once. | Otherwise Plague on a sword would gain next to nothing from attack speed |
| **Animation timings scale with the interval.** Axe root = min(0.5 s, 50% of the interval) and windup = min(0.25 s, 25%). Bow full draw = min(0.6 s, 70%), with the minimum draw kept at the same share of it (0.15 s of 0.6 s). Wand cast = min(0.2 s, 40%) and self-slow = min(0.4 s, 45%). | Plague's axe swings every 0.39 s, shorter than a fixed 0.5 s root. Without this, fast cadences would be rooted or slowed for good. |
| **Stagger immunity.** After a stagger, the target can't be staggered again for 0.5 s. | Plague's sword swings every 0.25 s and could otherwise stagger-lock a target |

A 20-tick-per-second simulation of the damage rules above reproduces the full faction cycle with the same weapon on both sides (all five weapons) and in every signature-weapon opening. It does not model movement, line of sight, stagger or the animation timings.

---

## 11. Mobs and regions

- **Neutral by default.** Mobs idle near their camp and only fight once attacked.
- **They fight like their region.** Each mob uses its region's faction rules (scaled down) and that region's weapon. Frost mobs slow you; Plague mobs execute you below half HP.
- **Aggro and leash.** Once hit, a mob chases and fights with spacing that suits its weapon. If you run far enough it gives up, walks home and regenerates.
- **Drops.** On death a mob gives:
  - a little **GV**;
  - a **stat buff** (max HP, attack speed, or move speed);
  - **its weapon**, unless the killer already holds that weapon type.
- **Strength.** A mob is its region's faction with hp and every damage number scaled by **0.45**, and an elite by **0.6**. With the starting kit a player beats every normal mob in a straight duel (77% hp left on average, 36% in the worst case, Sentenced against a Fire mob); an elite beats most but not the faction that counters the player (2 of the 25 pairings lose: Fire against a Demon Blood elite, Frost against a Sentenced elite), so it is a choice. Each region has **one elite**: the first mob of its elite camp. The other mobs of that camp are normal.
- **Drop numbers.** GV is 2 (elite 10) and a buff is 1 stack (elite 2), both times the mob reward curve of section 12.3. The stat of the drop is the region's own 60% of the time (Fire and Demon Blood: attack speed; Plague and Frost: max HP; Sentenced: move speed) and one of the other two otherwise, so the map is also a shopping list for a combo. The weapon lies where the mob fell and anyone can take it.
- **Leash numbers.** Any hit from a player wakes the mob, wherever the player stands. It gives up when it is 7 tiles from its camp, or 6 s after it last **dealt** damage (damage it takes does not extend the fight), or with nobody left to fight. It then walks home **ignoring everyone and taking no damage**, heals while it goes, is back at full health when it arrives, and is neutral again. So a shooter out of its reach gains nothing by kiting it: every round ends with a whole mob, and a ranged weapon has to burst a melee mob down inside one round. Camp mates do not help each other: only the mob that was hit wakes. Mobs never hurt each other, and their shots fly past each other. Dead mobs do not respawn. When the patience timer teleports everyone into the coliseum, every living mob is put back on its camp spot at full health.
- **Same input path as players.** Mobs use the same input rules and combat code as players, so a sword mob and a sword player behave identically.
- **Later.** Raid-boss mobs and quest NPCs (section 2.2).

---

## 12. Snowballing and anti-snowballing

Getting fed should feel like a fed League carry or a Slay the Spire run where the combos "just hit". Getting ahead is meant to feel powerful. The limits are soft: **rewards fall off and bounties rise**, rather than hard caps.

### 12.1 Feed score
`feed = player kills + 0.25 × mob kills` for the current run.

### 12.2 Buffs: uncapped, S-shaped
Each buff stack you collect adds to that stat along an S-curve: small at first, a spike around the 3rd to 5th stack, then a plateau.

| Stacks of one stat | Max HP | Attack speed | Move speed |
|---|---|---|---|
| 1 | +5% | +4% | +2% |
| 2 | +16% | +11% | +7% |
| **3** | **+32%** | **+23%** | **+14%** |
| **4** | **+48%** | **+34%** | **+21%** |
| 5 | +58% | +42% | +25% |
| 6 | +63% | +45% | +27% |
| 8+ | about +66% | about +47% | about +28% |

**Combo thresholds.** Reaching 3 and then 5 stacks of one stat unlocks a set bonus that fires on **every kill** (a player's or a mob's). Stacks are real numbers (a drop is scaled by the reward curve below), and a higher tier replaces the lower tier of the same stat. These are the run-defining moments; the numbers below are the Phase 11 picks and get tuned in playtests.

| Stat | 3 stacks | 5 stacks |
|---|---|---|
| Attack speed | **Dash on kill**: 2.5× move speed for 0.4 s | **Cascade**: the dash, and a kill resets your attack cooldown |
| Max HP | **Shield on kill**: absorbs 15% of max HP for 5 s | **Bulwark**: 30% of max HP for 8 s |
| Move speed | **Bloodrush**: 1.5× move speed for 3 s | **Frenzy run**: 1.8× for 5 s |

A shield absorbs before HP in the one place all damage goes through, so it also soaks sudden death. A max-HP stack raises HP by the same amount, so you never end up lower on the bar than before.

### 12.3 Mob rewards fall as you get fed
Mob GV and buff value are multiplied by a curve that's near full while you're hungry, drops sharply around a feed of 5, and never goes below 30%:

| Feed | 0 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 10 |
|---|---|---|---|---|---|---|---|---|---|
| Mob reward | ×0.98 | ×0.92 | ×0.85 | ×0.76 | ×0.65 | ×0.54 | ×0.45 | ×0.38 | ×0.32 |

Players more than 2 feed behind the lobby median get **×1.25** from mobs (catch-up).

### 12.4 Bounties (shutdowns)
`bounty = 10 × max(0, feed − 2)^1.5` GV.

| Feed | ≤ 2 | 3 | 4 | 5 | 6 | 7 | 8 | 10 |
|---|---|---|---|---|---|---|---|---|
| Bounty (GV) | 0 | 10 | 28 | 52 | 80 | 112 | 147 | 226 |

- **Announcement.** When a player's bounty first appears and when it grows, the host announces "*name* is on a rampage — bounty N GV", at most once per player per 10 s. A rise inside that window is held back and announced with its value when the window ends.
- **Crown.** Bountied players wear a crown, and their position flashes on everyone's minimap for 2 s every 10 s.
- **Shutdown.** Killing a bountied player pays the bounty and **half their buff stacks** to the killer, so comebacks are real.
- **Trade-off, intended.** A fed player can beat their counters, as in League. Bounties and falling rewards are the release valves.
- A big bounty can be worth more than winning (52 GV at feed 5 against a 50 GV win bonus). That makes hunting the fed player a goal in its own right.

---

## 13. GV economy and meta progression

| Source | GV |
|---|---|
| Win (last one standing) | +50, only if the run had at least 3 players and the winner damaged at least 2 different opponents (guards against farming with a second profile). The win still counts either way. |
| Player kill | +10 |
| Bounty claimed | Per section 12.4 |
| Mob kill | +2 (elites +10) × the mob reward curve, at most 30 per run from mobs |

- **Spending.** GV buys **cosmetics only**: colours, trails, titles, golden weapon variants. Nothing that changes combat.
- **Achievements and titles.** For example, 5 wins holding the same weapon unlocks its golden variant; per-faction milestones unlock titles.
- **Monthly leaderboard.** Ranks total GV earned this month. Totals are stored per month, so no reset job is needed.
- **Death doesn't erase GV.** You keep what you earned in a run even if you die; the win bonus is the prize for surviving.

---

## 14. Controls

| Input | Action |
|---|---|
| Right-click (hold to keep steering) | Walk there; the server pathfinds around walls |
| Left-click | Attack toward the cursor (sword, axe, wand, shield bash) |
| Left-click hold → release | Draw and fire the bow |
| Mouse position | Aim; the shield always faces the cursor |
| Swap key | Switch weapon slot |
| F | Pick up a weapon or open a chest |
| S | Stop |

---

## 15. Feedback and readability
Hard counters are only fair if you can see them coming.

| Feedback | What you see |
|---|---|
| Faction and weapon at a glance | Every player wears their faction colour and shows a weapon silhouette, readable at a distance |
| Damage flash | A red vignette when you take a real hit, scaled by damage. Small ticks don't flash. |
| Counter hue | Near an enemy (in sight, within about 450 u) the screen takes a soft tint: **green** if you counter them, **red** if they counter you. The score adds the faction edge and the weapon edge (±1 each) and fades with distance. |
| Sentenced | A visibly growing brand on the marked target |
| Holy | Heal numbers when lifesteal lands |
| Plague | A "below half" execute cue on its target |
| Fire | A burst of flame on any enemy who swings while engaged with Fire |
| Frost | Frost on chilled enemies |
| Fed players | Crown, rampage announcements, minimap pings |
| Patience timer | Always on the HUD; a 30-second warning and a host voice line before the teleport |
| Counter wheel | In the hub, both pentagrams with your pick highlighted |

---

## 16. How it's built (short)
- **Authoritative server.** Colyseus 0.18 runs the game at a fixed 20 ticks per second. Clients only send inputs (move, aim, attack, release, swap, pickup); the server decides every hit, death and reward.
- **Client.** Phaser 4 draws the world in a fake-3D angled view. Everything is drawn 100 ms in the past and smoothed, so motion looks fluid.
- **Hits feel fair under lag.**
  - Melee checks against where things were when you clicked ("what I saw is what I hit").
  - Arrows and balls fly in real server time; each one is sent once and its straight flight is computed on every screen.
- **The map is seeded.** Only the seed and the gate state are sent.
- **Persistence.** Profiles (GV, stats, cosmetics) live in a crash-safe JSON file behind a store interface, so a database can replace it later.
- **Bots.** Headless bots play full runs and power the end-to-end tests.

---

## 17. Balance and verification
- **The design oracle** is `python3 testing/test_rpsls.py`:
  - the 10-edge graph at four timesteps;
  - each faction beats exactly two;
  - power-scale invariance;
  - name-shuffle invariance;
  - ±5/±10% jitter robustness;
  - a purity audit (no faction names in the rules);
  - the identity tests.
- **Parity.** The game's TypeScript copy of the faction rules must reproduce the Python results for all 20 matchups.
- **Harnesses** (they report, never block the build):
  - the weapon loop, scripted duels per weapon pair;
  - the faction cycle per weapon (5 weapons × 10 edges);
  - kiting tolerance.

  `python3 testing/realtime_report.py` (needs numpy, about a minute) runs the last two as 20 Hz weapon duels, with signature openings, buff thresholds and the longest stretch with no swing.
  Results go to the designer before any tuning.
- **Budgets.** Server tick time with 8 players and 60 mobs, and bytes per second per player.
- **End-to-end.** Bots play full arena runs to a winner, with GV and bounties balancing exactly.

---

## 18. Open questions and known risks

| Topic | Note |
|---|---|
| Long fights and third-partying | In an 8-player arena, long duels invite a third player to clean up. Duel pace ×2 helps; it gets watched in playtests. |
| Readable counters | Losing to a counter you didn't see coming feels random. Faction colours, weapon silhouettes and the counter hue are the mitigation. |
| Kiting | Equal move speed lets ranged weapons kite melee. Mitigated by cover (which caps 32 u-wide sight corridors at the bow's range), the bow-draw and wand-cast slows, and lower ranged damage. |
| Frost frustration | Its movement slow makes it the hardest class to escape. That's its identity, but it gets watched. |
| Sentenced feel | Its weapon hits are nearly zero by design; the brand visual has to carry the class. |
| Fire's burn | Nearly cosmetic in the current numbers. |
| Frost over Fire | Thinner since v3: Frost keeps 49% HP in the engine (was 59%) and 34% in the worst 20 Hz signature opening at k = 1 (was 47%), because Fire's backlash reads Frost's faster rate. It never flips: the smallest HP buff on Fire that flips it is ×1.59 (was ×1.97). Raising Fire's own rate is free at equal damage per second (no engine result moves, at most 3 points in the 20 Hz duels); it is Frost's rate that feeds the backlash. |
| Snowballing | Uncapped S-curves plus bounties need playtesting: are fed players fun to fight, and is hunting them worth it? |
| The faction cycle matters most late | Early fights are mostly weapons, positioning and third parties. The cycle decides the 1v1s, often in the coliseum. |
| Bounties within a tick | If several players hit a fed player in the same tick, who gets the payout has to be decided by a fair rule. |
| Buffs past the counters | In the 20 Hz check (same weapon on both sides, plus the signature openings) the softest edge, Holy over Sentenced, flips at ×1.31 HP on the losing side, and the softest attack-speed edge, Frost over Holy, at ×1.63 attack speed. Stacked, HP ×1.2 with attack speed ×1.3 holds every edge at 60% or better. HP ×1.3 with attack speed ×1.2 does not: Holy then wins only 45% of duels with both sides on bows and 52% with both on shields. Move speed isn't modelled there. The S-curve deliberately goes past these numbers (fed players can beat their counters); bounties are the release valve. |

---

## 19. Glossary

| Term | Meaning |
|---|---|
| **GV (Glorious Victory)** | The currency, and the title of winning a run |
| **Run** | One arena match, from spawn to death or victory |
| **Patience timer** | The host's countdown; when it hits zero, everyone goes to the coliseum |
| **Coliseum** | The walled arena at the map centre with lockable gates |
| **Faction** | Your class for the run (Fire, Sentenced, Plague, Frost, Holy / Demon Blood) |
| **Signature** | A faction's unique mechanic |
| **Signature weapon** | The weapon each faction starts with |
| **Engaged** | Fighting a specific enemy: you hit them recently or they hit you |
| **Feed** | Your run's kill score; drives buffs, mob rewards and bounty |
| **Bounty / shutdown** | GV and buffs paid for killing a fed player |
| **Edge** | One "A beats B" relationship in a counter loop |
| **Margin** | Winner's remaining HP fraction minus the loser's, in points |
