# Farming-route proof: is walking to a build's camps worth it, rather than farming the nearest one?

`python3 testing/farm_route_proof.py` (standard library, about 30 s; `--sweep` about 5 min) answers it from numbers alone: it reads
`testing/farm_route_data.json`, which `npx tsx packages/server/bench/farmRouteData.ts --maps 24` exports from the game's own code
(real camp layouts and walk distances of 24 generated maps; the faction, weapon, mob, reward and build tables; the constants), and
does arithmetic on them. No game is played for the proof. A real-sim check of its central claim (section 5) uses
`packages/server/bench/farmKitDuel.ts`. Its last full output is `testing/farm_route_report.md`. Measured on main `48ccb65`
plus this change (160 x 160 maps, 10 camps a zone, `MOB_HP_MULT` 2, `MOB_DMG_MULT` 0.5, `MOB_KILL_STACKS` 3, respawn 180 s).

## Verdict

**Yes, for all ten faction builds, at the shipped time-to-kill and camp damage.** In 8-player lobbies (every game fills to 8):

- each time the nearest camp you could farm is off-build, a build camp further away pays more of the build's value per second in
  **68-96%** of those decisions (owner's bar: 67-95% "seems reasonable");
- routing for the build banks more of it than farming the nearest camp in **82-97%** of games;
- routing by what the kills actually add in a fight ends stronger than the nearest-camp farmer in **93-97%** of games, and that
  kit wins **73-100%** of mirror duels against the nearest farmer's (model), **70-83%** in the real sim.

One change shipped with it: **Defense pays 1.25 a stack (was 1) and Soul Defense 1.5 (was 1)** (`DEFENSE_PER_STACK`,
`SOUL_DEFENSE_PER_STACK`, `shared/mobStats.ts`), so they work as counters without being farmed at random (section 6). Time to kill,
camp damage and every other reward are unchanged: the sweep (section 7) shows the shipped time to kill is already where every
build holds.

Then camp damage by reach (owner ruling, the same day: "melee mobs can receive a larger damage buff, mobs that kite with wand and
arrow a lesser one"): a normal mob with a melee weapon deals `MOB_MELEE_DMG_MULT` 1.6x and a bow or wand mob `MOB_RANGED_DMG_MULT`
1.2x on top of `MOB_DMG_MULT` 0.5; elites unchanged (section 6b). Every build still holds. Per the owner's ruling, the generalist
builds (Sentenced, Holy: "don't have specific scaling") are held to the fights and the decisions, not to the per-game build-value bar.

The bots' build weights (`BUILD_GOALS`) pointed most builds at the wrong camps: a kit farmed by them lost the mirror to a
nearest-camp farmer for 8 of 10 builds (29-59% in the real sim). **They are now derived from fight value** (section 8), and a bot's
routed kit beats a nearest-camp farmer's for all ten builds (65-75% in the real sim).

## 1. The model

**Map.** Walk distances are the 5-7-11 walk field over the move mask (about 2% over a string-pulled path) at 170 u/s plus farmed
move speed, and the five travel cannons (75 s reload) where they are faster. Rosters are rolled per map by `shared/rosters.ts`'s
bag rule. Elite camps are left out: they pay augments, not stats. Per map there are 40 normal camps. The walk to the nearest camp
is 1.9 s from a spawn and 3.9 s from a camp; to the nearest camp of one given type 12.4 s; to a random camp 14.3 s.

**Time to kill.** A camp is n normals of one type, all awake at the first hit (camp-wide aggro), killed one at a time while a melee
arc (or a wand's splash) cleaves onto the other melee mobs. Player damage comes from the paced sheet, the build weapon and its
scaling (the sword's dominant AD/AP pick), and the signatures and their build hooks. Every living mob hits back with its weapon
and signature. The hp cost counts lifesteal, regen, the camp potion (one per clear) and the 15% hp a player keeps in hand before
a pull; a camp costing over 85% of max hp is not farmable yet.

Calibration against the real sim (`bench/campDuel.ts --pulls camp --weapon sig`, 25 faction x zone cells): clear times are 1.06x
by geometric mean (0.55-2.1x per cell). The hp cost ran low (median real/model 1.26), so camp damage is scaled by `HIT_CAL` 1.25.
A fresh player clears a 4-mob camp in 4-42 s for 6-65% of its hp.

**Lobbies.** The focal player shares the map with seven fill bots, each farming its own drawn build by value per second (the bots'
rule). A camp anyone clears is gone for everyone for 180 s. 24 maps x 4 rosters x 10 builds, random starts. Each lobby is replayed
for every focal strategy, so comparisons are paired.

**Value of a kit, two lenses.**

- *Build value*: the build's own stat weights (`bots/brain/buildRoute.ts` `BUILD_GOALS`; an unwanted stat is worth `STAT_FLOOR`
  0.25 a stack).
- *Fight value*: duel power, the mean log(time the field needs to kill you / time you need to kill the field). The field is ten
  opponents (five factions x their two build weapons) holding the average kit of every player in the lobbies. The duel uses the
  same sheet plus the PvP factor; Holy's hp-dependent lifesteal is integrated over the fight. Move speed counts only as faster
  farming.

## 2. The analytic core

From a camp, a farther camp b beats the nearest camp n iff v_b / (w_b + c_b) > v_n / (w_n + c_n), where w is walk, c is clear and
v is the value of its kills. With equal clears: **extra walk < (r - 1) x (w_n + c)**, r = v_b / v_n. A build can afford to walk
(value ratio - 1) times the whole cycle at the nearest camp. A reward that scales both camps alike cancels; time to kill moves the
line (longer kills buy longer detours).

From every camp whose nearest neighbour is off-build (a fresh player, every camp up, build value):

| build | r | nearest cycle | affordable extra walk | actual extra walk to the nearest build camp | detour pays |
|---|---|---|---|---|---|
| fire:A | 3.13 | 12.6 s | 26.9 s | 2.4 s | 97% |
| fire:B | 3.34 | 10.9 s | 25.6 s | 1.0 s | 98% |
| sentenced:A | 2.58 | 25.4 s | 40.2 s | 1.4 s | 98% |
| sentenced:B | 3.37 | 25.8 s | 61.0 s | 2.4 s | 91% |
| plague:A | 4.03 | 17.8 s | 53.7 s | 3.8 s | 99% |
| plague:B | 3.53 | 16.3 s | 41.3 s | 3.9 s | 98% |
| frost:A | 3.78 | 25.3 s | 70.3 s | 1.9 s | 98% |
| frost:B | 2.86 | 34.3 s | 63.9 s | 2.4 s | 98% |
| holy:A | 3.09 | 20.3 s | 42.4 s | 2.4 s | 97% |
| holy:B | 3.33 | 25.1 s | 58.3 s | 3.2 s | 99% |

On an empty map the walk is nearly free: builds can afford 10-25 times the extra walk they need. In a game the picture is less
generous (next section): camps are taken, respawns have to be waited for, and the player's hp decides what it can pull.

## 3. In the games (8-player lobbies)

| build | decisions worth it | games won (build value) | build value gain | games won (fights) | duel power gain | mirror vs nearest farmer |
|---|---|---|---|---|---|---|
| fire:A | 73% | 97% | +57% | 93% | +0.34 | 73% |
| fire:B | 86% | 86% | +20% | 94% | +0.44 | 76% |
| sentenced:A | 84% | 86% | +16% | 94% | +0.43 | 73% |
| sentenced:B | 80% | 96% | +39% | 95% | +0.45 | 73% |
| plague:A | 68% | 89% | +48% | 94% | +0.66 | 84% |
| plague:B | 69% | 88% | +25% | 95% | +0.65 | 84% |
| frost:A | 96% | 95% | +29% | 94% | +0.45 | 76% |
| frost:B | 92% | 97% | +54% | 97% | +0.49 | 76% |
| holy:A | 79% | 82% | +19% | 96% | +1.45 | 100% |
| holy:B | 83% | 96% | +46% | 96% | +1.26 | 100% |

What each column measures:

- **Decisions worth it:** of the nearest farmer's decisions where the nearest farmable camp was off-build, the share in which a build
  camp paid more of the build's value per second, with that moment's walks, respawn waits, rests and kit.
- **Games won (build value):** routing by the build's weights against the nearest farmer.
- **Games won (fights)** and the mirror: routing by duel value. A +0.10 duel power gain is about +4.5 win points against the field.

A player who routes passes the nearest camp in 47-69% of its decisions and walks 13-22 s further each time. Because the nearest
farmer also ends up walking once the camps around it are taken, both kill about as many mobs (93-106%) and walk about as much per
kill.

The narrow builds score lowest on decisions: Plague A wants 4 of the 20 mob types and Plague B 3, so their camps are often taken or
far. Fire A, whose top stats are paid by 3 types, is next. Frost A wants 9 types and almost always has one nearby.

## 4. Which mobs lead to which build

What one kill adds to each build's duel power, relative to its best stat (combat lens, at the field's kit; from section 3b of the
script's report, measured before the Defense/Soul Defense change):

| build (weapon) | Offense | Soul Off. | Defense | Soul Def. | max hp | attack speed | move speed | lifesteal | damage |
|---|---|---|---|---|---|---|---|---|---|
| fire:A (sword) | 13 | 46 | 62 | 39 | 72 | 26 | 0 | 32 | 100 |
| fire:B (shield) | 13 | 24 | 74 | 51 | 72 | 27 | 0 | 33 | 100 |
| sentenced:A (sword) | 15 | 66 | 50 | 35 | 71 | 100 | 0 | 29 | 100 |
| sentenced:B (bow) | 67 | 16 | 51 | 36 | 71 | 100 | 0 | 29 | 100 |
| plague:A (wand) | 10 | 100 | 27 | 16 | 54 | 29 | 0 | 21 | 73 |
| plague:B (wand) | 13 | 100 | 29 | 16 | 62 | 29 | 0 | 23 | 73 |
| frost:A (shield) | 0 | 25 | 66 | 52 | 74 | 100 | 0 | 42 | 100 |
| frost:B (bow) | 92 | 0 | 32 | 18 | 73 | 100 | 0 | 38 | 100 |
| holy:A (axe) | 80 | 0 | 40 | 18 | 63 | 100 | 0 | 16 | 100 |
| holy:B (wand) | 22 | 72 | 40 | 18 | 44 | 100 | 0 | 19 | 100 |

The choice is build-specific on the Offense/Soul Offence axis. A Pardoner kill is worth 92 to Frost's bow and 0 to its shield; a
Flame Caller or Miasma Witch kill is worth 100 to Plague's wand. It is shared on the multipliers: +3% damage (Ember Imp,
Inquisitor) is the best kill or ties it for 9 of 10 builds, +3% attack speed for 6, and max health is a strong second for everyone.
Sentenced and Holy have no stat-specific scaling of their own (the mark grows with every stat; Holy's sustain is its faction's), so
the shared stats are their build.

## 5. Real-sim check

`npx tsx packages/server/bench/farmKitDuel.ts --kits FILE --faction F --weapon W [--corpses 1]` puts two farmed kits (mob stacks, no
cards) into a mirror duel in the real sim: signatures on, both seats, 18 setups x 4 draws, the benches' noise model. The kits are
the model's mean 600 s kits for each route. Final reward values:

| build | kit routed by fight value vs nearest farmer's kit | kit routed by the bots' weights vs nearest farmer's kit |
|---|---|---|
| fire:A (sword) | 74% | 35% |
| fire:B (shield) | 79% | 40% |
| sentenced:A (sword) | 71% | 34% |
| sentenced:B (bow) | 74% | 51% |
| plague:A (wand) | 82% | 59% |
| plague:B (wand, one body) | 82% | 30% |
| frost:A (shield) | 70% | 43% |
| frost:B (bow) | 70% | 45% |
| holy:A (axe) | 83% | 29% |
| holy:B (wand) | 81% | 37% |

The real sim confirms the model's central claim: walking to the right camps beats farming the nearest camp in fights for every
build. It also confirms the misalignment of section 8.

**Plague** (the owner's question "does Plague benefit from a random build?"):

- Farmed by fight value, both Plague builds beat random farming (82%).
- Plague A's own weights (attack speed and Soul Offence) do too (59%).
- Plague B as the bots define it (stack max health for the zombie) does not: 30%, zombie up. The real-sim mirror is insensitive to
  the zombie's damage scaling: `PLAGUE_ZOMBIE_HIT_PER_BONUS` from 0.025 up to 0.12 (cap raised alike) moved it only from 31% to 33%.
  What wins Plague's fights is its Soul Offence disease rider, which a random route picks up from its incidental Soul Offence kills.
- So the fix is Plague B's weights (section 8), not a zombie buff. Nothing about the zombie was changed.

## 6. Defense and Soul Defense as counters

The owner's bar: "effective enough to counter a specific O/SO build but not so strong that they can be farmed at random". The
script's section 3c, for a player holding its nearest-farmer kit, compares one kill of Defense (or Soul Defense) with one kill of
max health and with the best other kill. It does so against the builds whose damage is at least 70% physical (Offense builds:
Frost A and B, Holy A and, with its farmed kit, Fire), against those at most 40% physical (Soul Offence builds: Plague A and B,
Sentenced), and against the whole field.

- **At +1 a stack** a Defense kill was worth 0.58-1.34x a max-health kill even against an all-physical opponent (median 0.82):
  Defense and Soul Defense countered nothing but for Fire, whose base Defense and Soul Defense are 20 against 77-116 elsewhere.
- **At +1.5 / +2** they countered most builds, but a random route picks up Defense or Soul Defense from 6 of the 20 mob types (30%
  of its kills). Fire's random farmer gained so much from them that routing for Fire's builds won only 83-88% of fights: farmed at
  random, the failure the owner ruled out.
- **At +1.25 / +1.5 (shipped)** every build holds:

| you | Defense vs Offense builds (/ max hp kill, / best other kill) | Soul Def. vs Soul Offence builds | Defense vs the field | Soul Def. vs the field |
|---|---|---|---|---|
| fire:A | 1.42 / 1.02 | 1.21 / 0.97 | 1.08 / 0.72 | 0.85 / 0.56 |
| fire:B | 1.63 / 1.15 | 1.41 / 1.13 | 1.30 / 0.86 | 1.10 / 0.72 |
| sentenced:A | 0.99 / 0.75 | 0.93 / 0.76 | 0.81 / 0.56 | 0.70 / 0.48 |
| sentenced:B | 0.98 / 0.76 | 0.93 / 0.77 | 0.81 / 0.56 | 0.70 / 0.49 |
| plague:A | 0.83 / 0.46 | 0.70 / 0.42 | 0.60 / 0.31 | 0.42 / 0.21 |
| plague:B | 0.72 / 0.48 | 0.65 / 0.43 | 0.54 / 0.31 | 0.37 / 0.22 |
| frost:A | 1.18 / 0.92 | 1.11 / 0.92 | 1.04 / 0.74 | 0.98 / 0.69 |
| frost:B | 0.69 / 0.54 | 0.55 / 0.46 | 0.51 / 0.36 | 0.33 / 0.24 |
| holy:A | 0.80 / 0.46 | 0.71 / 0.55 | 0.84 / 0.36 | 0.62 / 0.26 |
| holy:B | 1.16 / 0.47 | 0.93 / 0.56 | 1.44 / 0.36 | 1.04 / 0.26 |

(Holy B's max-health gain is near zero against the field, so its "/ max hp" column there is inflated.)

- Against the field neither stat is ever better than the best generic kill (at most 0.86 of it), so neither is the kill to take
  at random.
- Against the damage type it answers, each beats a max-health kill for the Fire builds, Frost A and Holy B, ties it for Sentenced,
  and stays below it for the offence-scaled builds (Plague, Frost's bow, Holy's axe). Those builds gain more from adding damage
  than from defending.
- Soul Defense is set higher than Defense because no faction's damage is mostly magic (Fire's backlash and Holy's hits are
  physical), so it always answers a diluted share.
- In the real sim, ten extra Defense kills on a Plague wand facing Holy A's axe win about as often as ten extra max-health kills
  (81% against 79% at +1.5/+2; 77% against 76% at +1). Ten kills are a small share of a 60-100-kill kit.
- The "+damage" camps needed no buff: they are already the best kill for 9 of 10 builds, and a buff would only make random
  farming stronger.

## 6b. Camp damage by reach

Real sim (`bench/campDuel.ts --types --seeds 5`, fresh players on fists, 4-mob camps):

- Before the change, every normal camp was cleared 25/25 with 46-93% hp left.
- At melee 1.6x / ranged 1.2x, every normal camp is still cleared 25/25. The tightest case is a fists Fire (base Defense 20)
  against a melee brute camp: Chain Warden leaves 15% hp, Magma Brute 16%. Ranged camps leave 35-77%.
- The elite gate still passes: every elite camp is cleared by at least one faction holding the minute-5 kit.
- `test/mobStrength.test.ts` still passes (a fists starter beats a lone normal mob of every zone).

In the model, a fresh player's mean camp hp cost rises from 13-51% to 23-74%. Routing still pays (8-player lobbies, final values):

| build | decisions worth it | games won (build value) | games won (fights) | mirror vs nearest farmer |
|---|---|---|---|---|
| fire:A | 73% | 96% | 96% | 75% |
| fire:B | 88% | 93% | 94% | 78% |
| sentenced:A (generalist) | 86% | 72% | 96% | 73% |
| sentenced:B | 81% | 93% | 97% | 75% |
| plague:A | 70% | 90% | 99% | 84% |
| plague:B | 69% | 89% | 100% | 86% |
| frost:A | 95% | 93% | 98% | 78% |
| frost:B | 92% | 96% | 96% | 79% |
| holy:A (generalist) | 79% | 79% | 99% | 100% |
| holy:B | 83% | 97% | 93% | 100% |

1.4x / 1.15x was also tried. It changes no verdict: Sentenced A and Holy A sit at 79% either way, and Frost A's fights fall to 90%.

## 7. Time to kill, reward and camp damage

The sweep (script section 6; reward scaled with the time to kill so a minute of farming pays the same, then time to kill alone):

| mob hp x | stacks per kill x | builds holding | worst mirror vs nearest farmer |
|---|---|---|---|
| 0.25 | 0.25 | 5/10 | 56% |
| 0.5 | 0.5 | 9/10 | 62% |
| 0.75 | 0.75 | 7/10 | 68% |
| **1 (shipped)** | **1** | **10/10** | **73%** |
| 1.5 | 1.5 | 8/10 | 87% |
| 2 | 2 | 8/10 | 96% |
| 1.5 | 1 | 10/10 | 77% |
| 2 | 1 | 10/10 | 75% |

The shipped time to kill sits where every build holds. Longer kills make routing pay more in fights (the mirror climbs) but move
some builds' build-value decisions, so no change is warranted. Explored and rejected:

- 2.5x mob hp with matching stacks got every build to at least 92% of games won by build value, but only because camps then cost
  2.5x the hp. The gain came from walking doubling as healing time, so camp damage cut to keep the cost flat lost it again.
- Fresh players could no longer clear most camps.
- More camp damage on its own made things worse.

## 8. The bots' build weights

The hand-set `BUILD_GOALS` beat the nearest camp on their own weights in 82-97% of games, but the kit they built lost the mirror to
a nearest farmer for 8 of 10 builds: model 0-59%, real sim 29-59%. They valued move speed, which wins no duel (Fire A 0.4,
Frost B 0.7), put lifesteal first for Holy A (a lifesteal kill is worth about a sixth of a damage kill), left out the +damage and
+attack-speed kills every build gains most from, and gave Plague B max health alone.

**Now (owner request, 2026-11-03):** each build's weight for a stat is what one kill of it adds to that build's duel power, averaged
at a quarter, half and three quarters of its fight-value kit against the lobby's field, squared (so the route leans on the best
stats) and scaled so the best is 1. Stats under 0.3 are dropped (`STAT_FLOOR` covers them). Each build's old top stats stay at 0.75
or more so it still farms toward its name: Offense for Fire A, Soul Offence for Fire B, Defense, Soul Defense and Offense for
Sentenced A, attack speed for Plague A, max health for Plague B, Defense for Frost A, lifesteal for Holy A, Soul Offence for Holy B.
Frost B is set by hand from its fight-value kit (`attackSpeed` 1, Offense and damage 0.8, max health 0.6, Soul Defense 0.4): the
averaged weights leaned on Soul Defense for the chill bonus, which caps early at 0.2, and that kit lost (42%).

| build | old weights | new weights | bot route vs nearest farmer: fights won (model) | mirror (model) | mirror (real sim) |
|---|---|---|---|---|---|
| fire:A | AD 1, damage 1, attack speed 0.6, move speed 0.4 | damage 1, max hp 0.95, Defense 0.76, AD 0.75, SD 0.53, lifesteal 0.46 | 92% (27%) | 72% (37%) | 72% (35%) |
| fire:B | AP 1, Defense 0.8, SD 0.8, max hp 0.6 | Defense 1, damage 1, max hp 0.94, AP 0.75, SD 0.73, lifesteal 0.55 | 85% (30%) | 76% (42%) | 75% (40%) |
| sentenced:A | Defense 0.8, SD 0.8, AD 0.8, AP 0.6, max hp 0.5 | attack speed 1, Defense, SD, AD 0.75, damage 0.74, max hp 0.72, AP 0.51 | 91% (12%) | 67% (39%) | 68% (34%) |
| sentenced:B | attack speed 1, max hp 0.8, damage 0.5 | attack speed 1, damage 0.78, max hp 0.73, AD 0.51, Defense 0.42 | 88% (59%) | 62% (51%) | 65% (51%) |
| plague:A | attack speed 1, AP 1, damage 0.4 | AP 1, attack speed 0.75, damage 0.49, max hp 0.46 | 73% (56%) | 65% (59%) | 65% (59%) |
| plague:B | max hp 1, Defense 0.4, SD 0.4 | AP 1, max hp 0.75, damage 0.52 | 82% (30%) | 71% (44%) | 69% (30%) |
| frost:A | Defense 1, SD 1, max hp 0.8 | attack speed 1, SD 0.81, Defense 0.75, max hp 0.58, damage 0.56 | 88% (46%) | 71% (50%) | 66% (43%) |
| frost:B | attack speed 1, move speed 0.7, damage 0.6, SD 0.5 | attack speed 1, AD 0.8, damage 0.8, max hp 0.6, SD 0.4 | 93% (59%) | 70% (50%) | 69% (45%) |
| holy:A | lifesteal 1, max hp 0.7, AD 0.5, attack speed 0.4 | attack speed 1, lifesteal 0.75, damage 0.64, AD 0.57, max hp 0.31 | 80% (11%) | 100% (0%) | 65% (29%) |
| holy:B | AP 1, lifesteal 0.7, max hp 0.4 | attack speed 1, AP 0.75, damage 0.75, Defense 0.31 | 82% (16%) | 100% (1%) | 69% (37%) |

(In brackets: the old weights. Model: 8-player lobbies, 24 maps x 4 rosters, all seven fill bots on the new weights; real sim:
`bench/farmKitDuel.ts`, 144-288 mirror duels a build. The model's Holy mirrors run high: its stall dynamics overrate Holy's
lifesteal, see section 5.)

The cost: the in-game decisions where walking to a build camp pays fell for the builds that now want fewer types (Plague A 57%,
Plague B 67%, Holy B 69%; they were 69-83%), since fewer camps count as theirs. The builds share more of their top stats (attack
speed and damage lead six of them), because those are what wins fights; the named identities survive as the 0.75 floors.

## 9. What the model leaves out

- No fighting while farming.
- No quests, elites, chests, Trophies, wind emblems or trades.
- The bots' contest logic is simplified to "a camp a player commits to is taken".
- Duels have no positioning, kiting, Wishes or body-blocking: the zombie is a damage source only, and move speed is worth nothing
  in a duel.
- Cleave shares are estimates (axe 0.45, sword 0.25, shield and fists 0.3, wand splash 0.18, bow 0), backed by the clear-time
  calibration.

Lobbies with fewer players (deaths) are kinder to nearest-camp farming. At the old rewards every build held with 4 players on the
map; with 2 players Fire B's build-value margin fell to +7%, and with one player alone on the map some builds failed. That never
happens live: every game fills to 8, and the coliseum opens at 10:00.

## 10. Reproduce

```bash
npx tsx packages/server/bench/farmRouteData.ts --maps 24
```

```bash
python3 testing/farm_route_proof.py --sweep
```

```bash
python3 testing/farm_route_proof.py --others nearest
```

Other variants: `--no-cannons`, `--lobby 4`, `--others solo`, `--horizon 300`. What-ifs: `--hp-mult`, `--stacks`, `--dmg-mult`,
`--reward armor=1.2,shield=0.8` (multipliers on the shipped per-stack values) and `--const NAME=value` (a faction hook).
