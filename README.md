# RougeHalla

A top-down 2.5D roguelike battle arena. Up to 8 players pick one of five factions and drop into a generated map with empty hands: every run starts on fists. They loot chests and farm neutral mobs for weapons, farm each normal mob type for a fixed stat bonus (up to ten stacks), challenge elites for interactive augments and fight until one is left standing. Two counter loops decide every fight: faction against faction, and weapon against weapon. A player who has farmed cards hits other players far harder than a fresh one (the PvP factor), so early fights are slow and late fights are short. If nobody dies for a while, everyone still standing is teleported into the coliseum at the centre and locked in until somebody does. The last one standing wins **Glorious Victory** (GV), a currency that only buys cosmetics. Weapons and cards never outlive a run. GV, stats, cosmetics, titles and achievements persist per callsign.

The first playable in [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md) is built: a walkable hub, the faction pick, fists and five weapons, five faction signatures, a generated 136 x 136 map of five zones, each with its own designed shape, a planning step before each run, ten competitive quest offers with five shown during planning, regional mobs of 30 types in mono-type camps (one hit wakes the whole camp), fixed stat rewards for twenty normal mob types, shared interactive augment chests from elite deaths, and camp clears that heal everyone who fought them, bounties, the patience timer and coliseum, GV, a shop, achievements, a monthly leaderboard and a training room. That document has the rules, the numbers and the reasons for them. This one covers running, playing and testing the code. Engineering rules and open issues are in [CLAUDE.md](CLAUDE.md).

It is still a prototype: colored shapes, no sound, no accounts (a callsign is a token kept in your browser), one server process, and numbers that are first picks. See [Known limitations](#known-limitations).

Stack: Phaser 4, Colyseus 0.18, Express 5, Vite 8, TypeScript 7, Vitest 5, npm workspaces. The design tools in `testing/` are Python.

## Requirements and setup

- Node.js 22.12 or newer, preferably an LTS release (22 or 24). Vitest 5 declares `^22.12 || ^24 || >=26`, so Node 23 and 25 may print engine warnings. It was developed on 25.8 and runs there.
- npm 7 or newer (workspaces) and a desktop browser with a mouse and keyboard.
- Python 3 with numpy, only for the design tools in `testing/` (see [Testing](#testing)). It was run on 3.9.

```bash
npm install      # once, at the repo root (installs all three workspaces)
npm run dev      # game server on :2567 and Vite client on :5173
```

Open http://localhost:5173. Vite runs with `strictPort`, so it fails instead of picking another port if 5173 is busy.

## Playing

### Vision and camp routes

Your player reveals a wall-blocked circle of 900 ground units, independent of screen width. Seen tiles keep providing live vision for two minutes after you leave. Visible opponents light the screen edge in their direction: green far away, through yellow, to red nearby. Clearing a whole camp grants its clearing player a personal ward for three minutes; the entire camp returns at full health when the ward ends. The Camps & wards dock lists every camp's surviving mobs, ward owner/countdown and respawn countdown for everyone, including beyond vision.

### Callsigns and two tabs

Open two tabs and give each a callsign:

```
http://localhost:5173/?profile=alice
http://localhost:5173/?profile=bob
```

A callsign (2 to 16 letters, digits, `_` or `-`) is a profile. The first load of an unused name claims it. The server hands back a token. The client keeps it in `localStorage` as `raid.token.<callsign>` and proves ownership with it on every later load. Without `?profile=` a tab starts with a random `op-xxxx` name. Edit it and press Load to claim one. Once a callsign has loaded, the tab remembers it for reloads in `sessionStorage`.

Tabs in the same browser share `localStorage`, so two tabs can load the same callsign. But a profile can be in only one run at a time ("profile already in a raid"). A second browser, a private window, or cleared site data does not have the token, and the menu will say the callsign is taken. There is no in-game recovery for that.

### Playing alone

Bots are headless players with a human-like brain (design: `docs/BOTS.md`). They use the same HTTP API and play with the same controls as the browser: they walk (`move`), click their foe (`target`) and let the server chase, attack and aim, and they swap and pick up weapons, they cast their faction's Wish (`cast`) when it is ready and the moment suits it, they pick a start on the planning screen (`plan`), and they walk to an elite's augment chest and take a card (`choose`). They never send `aim`, `attack` or `release`. They see only what a player's screen shows, react in a few hundred milliseconds, miss clicks, and come in three tiers (`easy`, `normal`, `hard`) and four personalities (`farmer`, `hunter`, `opportunist`, `cautious`). They farm mobs while no player is close and hunt players otherwise, and they join the same lobby as everyone else. Press Start Run in your tab first, then start some:

```bash
npm run bots -- 3
```

They arrive in your lobby and the run starts after the fill window. If the bots go first, two of them reach `MIN_PLAYERS` and start a run `FILL_SECONDS` later without you. Raise `LOBBY_SECONDS` or `FILL_SECONDS` for more time to join. For a quiet sandbox, start the server with `MIN_PLAYERS=1 FILL_SECONDS=1 npm run dev` (add `PLAN_SECONDS=0` to skip the 12-second planning screen). You get a solo run (it has no winner) with mobs, so you can test fighting and cards. The [training room](#training) is better for trying weapons.

The server also fills its own lobbies with bots that live inside the room (no profile, no connection): up to `BOTS_FILL_TO` players (default 6), arriving in the last seconds before the countdown ends. They are tagged `[BOT]`. The headless bots above are separate clients on top of that, so for a lobby of only the bots you launch, or only you, start the server with `BOTS_FILL_TO=0 npm run dev`.

### The hub

You start in a small walkable room. It is drawn on the client only: there is no server room while you are in it. Walk with right-click or `WASD` / arrow keys. Stand at a station and press `E` (or click it) to use it.

| Station | Where | What it does |
| --- | --- | --- |
| The Arena (stairs) | North wall | Join a run (matchmade lobby). |
| Training Grounds (door) | East wall | Start a private practice room. |
| Five pedestals | South | Pick a faction. |
| Shop, Wardrobe, Achievements, Leaderboard (kiosks) | West wall | Open that panel. |
| Counter wheel | Centre of the floor | Both counter loops, with your pick highlighted. |

Your avatar wears your equipped cosmetics and your faction's colour, and stands on bare fists (a run starts unarmed). The menu docked on the left offers the same things: callsign, GV and stats, a card per faction, Start Run, Training, and the panels (shop, wardrobe, titles, achievements, leaderboard, counters).

**Pick a faction before each run.** The pick is remembered on this device. A player who has never picked gets a round-robin default from the server, and that run counts for no faction title.

### Factions and weapons

Each faction beats exactly two others and loses to exactly two. Each weapon does too. In the code the last faction's id is `holy`; players see Demon Blood. Hit points, damage and the signature numbers are in [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md) section 8: the balance pass compressed them so that a favourite wins a fair fight with a margin that two equal players' play can overturn.

| Faction | Hp | Rate × hit | Armor / shield | Signature | Beats |
| --- | --- | --- | --- | --- | --- |
| Fire | 835 | 0.60/s × 100 | 0 / 45 | Dragonslayer: 18 burn a second (magic, over time), and a hit back on every swing the target makes (physical, 58 to 104 a swing by the target's weapon). | Sentenced, Plague |
| Sentenced | 880 | 0.95/s × 34.840203 | 135 / 120 | Marked: landed hits pulse true damage and climb four tiers, taxing attack speed, suppressing damage and blocking lethal execute bonuses. Enemy weapon swaps promote the mark. Hitting a camp member marks its whole group. | Plague, Frost |
| Plague | 1375 | 1.85/s × 20 | 190 / 0 | Rat King: 43 disease a second (magic) and an execute that adds up to 207 a second once the target is under half hp. Its hits are 80% physical. | Frost, Demon Blood |
| Frost | 1200 | 0.45/s × 170 | 20 / 190 | Living Wall of Ice: everyone engaged with it attacks at 48% speed, and moves at 70% within 100 u. Its hits are 90% physical. | Demon Blood, Fire |
| Demon Blood | 1400 | 0.95/s × 96 | 0 / 250 | Radiant: heals a share of damage dealt equal to 11% plus 85% of its missing-health fraction, at most 75%. | Fire, Sentenced |

Armor cuts physical damage and the shield (magic resist) cuts magic damage, each by 1 / (1 + stat / 100); true damage ignores both. Game pace doubles every faction's damage numbers and leaves hp alone. The balance target is for a favourite to finish with 10-35% of its hp left; the current Sentenced measurements are in [testing/TUNING_SENTENCED.md](testing/TUNING_SENTENCED.md).

| Weapon | Shape | Numbers | Beats |
| --- | --- | --- | --- |
| Fists | What an empty hand fights with, and how every run starts: the shortest reach (40), the fastest swing, a weak hit. Pierces shields and never staggers. Not an item (it cannot be dropped, picked up or looted) and not in the loop. | Speed +150%, damage ×0.60, scales with 0.6 AD + 0.6 AP | Nothing |
| Sword | 90 degree swing, reach 64. A hit that is not blocked staggers (a target can't be staggered again for 1.1 s). | Speed +115%, damage ×0.75, 1.0 AD | Axe, Wand |
| Bow | Arrow, 900 u/s, range 240. A fixed full draw (rooted), then it looses at full damage: there are no partial draws. | Speed +95%, damage ×0.8, 1.0 AD | Sword, Axe |
| Wand | Ball, 380 u/s, range 220. A short cast (rooted) before the ball leaves. Pierces shields and deletes enemy arrows (a ball that does keeps 60% of its damage). Its impact splashes 30% of its damage onto other enemies within 48 u of the target. | Speed +65%, damage ×0.8, 1.0 AP + 0.3 AD | Bow, Shield |
| Shield | Raised toward the cursor, or toward your locked target (60 degrees either side); bashes its target, reach 44. A frontal sword or bash hit is blocked only in part (7%: the rest still lands, and never staggers; half of the blocked part is riposted), and an arrow is reflected carrying 15% of its damage. | Speed +60%, damage ×0.75, 0.4 per bonus armor or magic resist + 0.3 AP | Sword, Bow |
| Axe | 180 degree swing, reach 60. Pierces shields and destroys balls. Every hit shreds 3 armor for 3 s, up to 6. Roots you for longer than its swing takes. | Speed +40%, damage ×0.77, 1.0 AD + 0.02 per bonus max hp | Wand, Shield |

"Speed" is the boost on the faction's attack rate, "damage" the weapon's multiplier on its dps, and "scales with" what a point of a card's stat adds per second (AD and AP come from cards; see step 5 of [A run](#a-run) below).

Units are world units: a tile is 32. Every attack roots you for its windup, then lets you move while its cooldown continues. Sword, bash and fists use up to 0.1 s; axe uses up to 0.25 s or 25% of its interval, with no recovery root; bow and wand use up to 0.3 s or 30% of their interval. Attack speed shortens the interval and windup together. Move before a locked attack launches to cancel it; move after launch to kite. See [combat rules](docs/GAME_DESIGN.md#95-as-built-mouse-orders-and-basic-attacks-october-28-combat-port). You start with empty hands and carry up to two weapons, and swapping shares one attack cooldown. A weapon comes from a chest, the ground, a body or a mob: a mob that dies to you while your hand is empty puts its weapon straight into it. Weapons and cards add to a hit through your stats: Attack Damage (AD) and Ability Power (AP) are scaled by each weapon differently (the weapon bar shows how). The faction pick alone rarely decides a fight: the weapon you hold against the one your enemy holds, and the cards you have farmed, do. Full rules, timings and the reasons are in [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md) sections 8 to 10.

#### Wishes

Each faction has one **Wish**, an ability on `D` for the moment the weapons do not cover. It is locked for the first 45 s of a run and then has a 300 s cooldown that nothing shortens, so a run sees it once, maybe twice. The server refuses a cast it cannot take (cooling down, stunned or silenced, no valid target) at no cost. Once a cast begins its cooldown is spent, even if it then fizzles or is interrupted (only a stun or a silence interrupts one). Every fighter's name carries a small icon of its Wish, grey while it is locked or cooling down, and your own slot sits at the right end of the weapon bar. In the training room a Wish is ready at once and cools down in 5 s.

| Faction | Wish | What it does | What beats it |
| --- | --- | --- | --- |
| Frost | Freeze | After a 0.25 s cast, stuns the enemy nearest your cursor for 1.25 s (range 450 u, line of sight). A stun cancels a windup, the bow's draw included. | Break line of sight or leave range during the cast. It is not a projectile, so nothing else dodges it. |
| Plague | Swarm | After a 0.25 s cast you cannot be targeted for 8 s: nobody can lock you or aim an ability at you, and mobs lose you. Attacking or casting shows you from its start until half a second after it lands. A cloud on the ground marks where you are. | Arrows, balls and swings already on the way still hit. A hiding Plague that attacks is revealed, so it escapes rather than fights. |
| Sentenced | Trial | After a 0.35 s cast, puts a ring of radius 300 u on an enemy within 400 u for 5 s. Inside it the enemy deals 20% less and takes 20% more from you. A target already at mark tier 3 or 4 gets a tighter 200 u ring. Walking out stuns it for 1 s. | Break line of sight or leave range during the cast, then stay and fight inside the ring, or accept the stun. |
| Fire | Blaze Step | Blink up to 300 u toward your cursor, through walls, with no cast time. It leaves a burning trail for 2.5 s: 30 true damage a second to anyone else on it, lingering 2 s. | Don't stand on the trail. It cannot cross the locked coliseum gates or land in a sealed pocket. It has no warning before the cast. |
| Demon Blood | Last Stand | For 5 s you cannot fall below 1 hp and you walk 30% faster. At the end, 30% of the damage you took is healed back. It has no warning before the cast. | It is a loan, not a refill: a Holy that lives through it comes out with 30% of the damage back, so don't spend burst on it, wait for it to end. |

Freeze and Trial pick the enemy nearest the cursor, within 64 u like a left-click. Blaze Step goes toward the cursor. Swarm and Last Stand need no aim. The full rules, the numbers and what is a best guess are in [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md) sections 8.8 and 8.9.

### Controls

Right-click ground to move, right-click an enemy to attack it, or press A then left-click to attack-move. Left-click an enemy also locks it. There is no attack button to hold: the server plays the fight once you have picked an enemy.

| Input | In a run |
| --- | --- |
| Right-click (hold on ground) | Attack an enemy under the cursor, otherwise walk to that point. The server pathfinds around walls. Holding re-sends the target every 100 ms. An unreachable point gives no walk, but the order still drops your attack target. |
| Left-click on or near an enemy | Lock the nearest enemy (a player or a mob) within 64 units of the cursor. The server walks you into range and attacks it whenever the cooldown allows, until you give another order, it dies, it leaves 640 units, or it stays out of line of sight for 1.5 s once you have seen it. An enemy behind a wall can be locked: you walk around to it, and nothing is attacked without a clear line. A click on empty ground does nothing. The locked enemy gets a red ring, and the one a click would lock gets a thin light ring. |
| Mouse position | Aim for the shield: it faces the cursor while nothing is locked, and the locked enemy otherwise. |
| `Q` | Swap to the other weapon slot. |
| `1` / `2` | Switch to that slot. |
| `F` | Take the highlighted weapon (chest, weapon on the ground or body) within 56 units and in line of sight. With both slots full, the weapon in hand drops. Also takes a quest token or parcel of an offer you accepted; a camp's card chest is not taken with `F`. Next to a quest giver (64 units, in line of sight) it opens the giver's offer instead when the giver is the nearer of the two; `F` again, or `Esc`, closes it. See [Quests](#quests). |
| `C` | Focus the camp chest panel while one is open (see [Camp chests](#camp-chests-and-cards)). Then `1` / `2` / `3` take a card, `0` skips, and `C` or `Esc` give the keys back to the game. |
| `D` | Cast your faction's Wish (300 s cooldown, locked for the first 45 s of a run). Freeze and Trial snap to the enemy nearest the cursor, Blaze Step goes toward it. See [Wishes](#wishes). |
| `J` | Toggle the quest log: objectives, your progress, timers, rewards and offer status. See [Quests](#quests). |
| `S` | Stop walking and drop the attack target. |
| Hold `Tab` | Show the whole map and your planned route until you let go (not while a text field, the settings or the help card has focus). |
| `Esc` | Leave a training room. (With the chest panel or the training console focused, the first `Esc` only hands the keyboard back.) |

During the planning step before a run (see below) nobody moves, and the screen has its own controls: `1` / `2` or a click pick the first or second dealt spawn, a click on the map adds a route stop (a click on a stop takes it out, up to 12), the arrow keys move between the map's markers, `Enter` on a camp adds a stop, `Delete` on a stop removes it, and the Ready button locks your pick. Settings add "Show route" and a map text size (100%, 125%, 150%).

Orders replace each other, in the order they arrive: a right-click on ground or `S` drops the lock, and a left-click on an enemy replaces any earlier order. A walk, a stop or a click on another enemy while your locked attack is winding up cancels that attack, as in League of Legends: no swing, ball or arrow, the cooldown is refunded, and the walk starts at once (a swing that has landed is not undone). A windup that is not your own click, a mob's, stays committed: a walk ordered during it starts when it ends. Swapping weapons or picking one up keeps the lock (an attack still winding up is cancelled, and the lock starts the next one with the new weapon). A locked attack is aimed at its target again when it lands or leaves, and its arrow or ball then homes for up to five seconds; directional and reflected shots remain ballistic. An attack made without a lock (a mob's) goes where it was aimed: a swing or a ball at the start, an arrow when its draw ends.

In the hub: right-click or `WASD` / arrows to walk, `E` or a click at a station. Shortcuts are ignored while a text field has focus. Clicks that begin on a menu or panel never reach the world.

### A run

1. **Lobby.** The timer starts when the first player joins and lasts `LOBBY_SECONDS` (30). Once `MIN_PLAYERS` (2) are in, the remaining wait is cut to at most `FILL_SECONDS` (5). Eight human players start it at once (fill bots never do, and a human joining a lobby that holds bots takes the newest bot's seat). If the timer runs out with fewer than `MIN_PLAYERS`, the run starts with whoever is there. A solo run has no winner and no win bonus. Nobody can act in the lobby, but it shows the map small and read-only: the zones, every camp's mob type and the factions in the room.
2. **Planning.** For `PLAN_SECONDS` (12) the room is locked and nobody moves, fights or is hurt. You are dealt two spawns about the same walk from the coliseum and in different zones, and pick one: the first to pick a spawn holds it, and a spawn someone else took shows as taken at once. The screen shows each camp's mob type (its role and the weapon it drops), your faction's matchup against it, and five known quest offers with their givers, timers and rewards (plus a count of five rumoured offers), and you can draw a route (kept in this tab, never sent, shown faintly on the minimap during the run). These are planning rows only: quest giver NPCs and items appear when the raid starts. Ready locks your pick, and the run starts early once everyone connected is ready. With no pick you get your first free spawn. A server started with `PLAN_SECONDS=0` skips this step.
3. **Early run.** Everyone starts at the spawn they picked, on fists and with nothing else. The starts of a map all lie about the same walk from the coliseum, spread over the zones. A map has 20 to 30 chests (4 to 6 a zone, one weapon each, every type equally likely) and 30 to 45 weapons loose on the ground. The walk from a start to the coliseum is about 12 seconds (11 to 13 for most starts). Take what you need, farm mobs, and pick fights you can win.
4. **Mobs.** The map is 136 x 136 tiles with five zones of equal area around the coliseum, one per faction, tinted in its colour; their shapes and places change with every seed, and they meet with no walls between them (a dashed line in each zone's colour marks a border). Each zone has its own designed shape and way of moving through it: the Scorch's camps sit in basalt craters with breaches and a lava river with fords, the Gallows' long fence rows have staggered gates, the Warren forks every road round a rock barrow (dry side, bog side or tunnel), the Rime has two ice lakes with headlands, and the Sanctum's heart is a hall of square pillars with lit bays. A few small buildings (a forge, a guard house, a burrow, a watchtower, a shrine) stand in the zones. A mob fights as its zone's faction at a fraction of full strength (more for an elite), shaped by its type's role (swarm, brute, skirmisher, caster, or a plain grunt) and carrying its type's own weapon: casters shoot, and every zone drops two or three kinds of weapon, so each weapon can be farmed in at least two zones. Each zone has two elite camps, one for each of its two elite types, with the elite at 65%. So the map is a shopping list for counters.
   - A zone has eight camps, 40 on a map, each with 3 to 5 mobs, two of them elite camps. Camps are mono-type: every normal mob of a camp is one of its zone's four normal types (each type stands in two of the zone's eight camps), and each of the two elite camps holds one of the zone's two elites, a different one in each. Normal kills pay GV, the mob's weapon, and one fixed stat stack of that type, capped at ten per player and run. Elites drop an augment chest instead of a stat stack (below).
   - Mobs are neutral until hit, and a hit on one wakes its whole camp onto you; a mob that is already walking home stays out of it. A woken mob chases and fights with spacing that suits its weapon. It gives up when it leaves its camp's territory (the part of the zone nearer to that camp than to the zone's other camps), or gets 12 tiles from its camp spot, or 6 s after it last dealt damage. Then it walks home untouchable and heals.
   - The zones, what their mobs carry, and the types (every normal camp is one normal type, every zone has two elites):

     | Zone | Mobs carry | Normal types | Elite types |
     | --- | --- | --- | --- |
     | Fire (the Scorch) | axe, wand | Ember Imp, Cinder Hound, Magma Brute, Flame Caller | Wyrmling, Ash Drake |
     | Sentenced (the Gallows) | sword, bow, shield | Bailiff, Chain Warden, Inquisitor, Pardoner | Executioner, Gaoler |
     | Plague (the Warren) | bow, wand, axe | Plague Rat, Bloatfly, Rot Monk, Miasma Witch | Rat Ogre, Pox Behemoth |
     | Frost (the Rime) | shield, bow, axe | Frost Wisp, Ice Golem, Rime Stalker, Frostbow Sentry | Glacial Warden, Avalanche Troll |
     | Demon Blood (the Sanctum) | wand, sword | Acolyte, Seraph Shard, Penitent, Zealot | Blood Saint, Archon |

     A normal mob is its zone's faction at 22% of the hp and damage (an elite 65%), then shaped by its role: a grunt is plain, a swarm mob has 70% of the hp, 90% of the damage and walks 10% faster, a brute 140% of the hp, 80% of the damage and walks 10% slower, a skirmisher 85% of the hp, 110% of the damage and walks 15% faster, a caster 75% of the hp and 120% of the damage and shoots. A plague mob's execute is scaled down twice, so it does not out-kill the other zones. A fist clears a camp of four normal mobs in 24 of 25 faction-and-zone pairings; an elite camp (the elite and three normal mobs) is for armed, carded players (4 of 25).
   - A map has about 160 mobs, and they never hurt each other. A full camp clear pays its heal and grants a personal vision ward. Elite deaths drop augment chests even while escorts survive; normal clears drop no chest. Three minutes after its last mob dies, the complete original roster respawns at full health and the ward ends. Individual deaths do not start a respawn timer. Camp counts and timers are public in the Camps & wards dock.
   - A kill pays GV (2, an elite 10, scaled by the reward curve below, at most 30 a run from mobs) and feeds that curve. Its fixed stat reward is independent of the curve. The mob's weapon goes straight into your hand if it is empty ("Armed: Bow"); otherwise it lands on the ground, unless you already hold that type. The kill goes to whoever did it the most damage.
5. **Stats, augments and the feed.** Every normal type gives one predictable small stat increase per credited kill, up to ten stacks of that type per player and run. All camps of the same type share your cap, which survives camp respawns and coliseum rounds. The HUD's Normal mob progress catalog shows each reward, ten segments, your total, and MAX. Elite deaths drop a shared chest with up to three distinct interactive augments; each option can be claimed once, and each player picks or skips once. Quests award normal-type stat stacks under the same cap, plus GV. Raw stat cards and simple conditional stat bonuses are excluded from reward pools. Augment tiers still feed the existing PvP factor, shown on the build strip, and combat guards bound combined effects. Feed and catch-up affect mob GV only; stat gains stay fixed. The full reward table and zone themes are in [docs/MOB_PROGRESSION.md](docs/MOB_PROGRESSION.md).
6. **Bounty.** Past 2 player kills, a bounty sits on you: `10 x (kills - 2)^1.5` GV (10 at three kills, 28 at four, 52 at five). Mob kills never raise it. Everyone is told "<name> is on a rampage" when it rises, and a crown marks you. Whoever kills you is paid the bounty on top of the kill (GV only: nothing you hold moves to them, and your body keeps your weapons for whoever takes them). Leaving within 5 s of being hit counts as a kill for whoever hit you, so quitting does not dodge a bounty. A mob that finishes a player a rival hit within 5 s credits the rival.
7. **Patience timer.** If no player dies for a while, everyone still standing is teleported into the coliseum and its four gates close. The first wait of a run is a flat 5:00 whatever the player count, counted from the end of planning (`FIRST_PATIENCE_SECONDS`). Every wait after a death is 5:00 with 8 standing and shrinks linearly to 2:00 at 3 or fewer (`PATIENCE_SECONDS`, `PATIENCE_MIN_SECONDS`). Every death, a leave included, restarts the timer and opens the gates. Mobs do not count. You are immune for 1.5 s after the teleport, arrows and balls in flight are removed, and every living mob goes back to its camp at full health.
8. **Sudden death.** Locked in for `SUDDEN_DEATH_SECONDS` (60) with no death, everyone standing loses 2% of max hp per second, and 2% more for every further second, until somebody dies. A death opens the gates.
9. **Outcome.** The last one standing wins. If the last players go down in the same tick, the one with the higher hp fraction at the start of that tick wins. An exact tie is a draw. Leaving mid-run counts as a death (missing in action), and so does leaving during the planning step: planning is part of the run, so a leave there is a loss in your stats with no GV (a server restart during planning voids the run instead). A dropped connection keeps your seat for 10 s first (in the run you stay in the fight, and hittable). In the lobby, leaving costs nothing.
10. **Results.** A kill pays 10 GV. Winning pays 50 more, but only if the run started with 3 or more players and you damaged at least 2 different opponents. Otherwise you still win, without the bonus. GV earned is kept when you die. It banks the moment your run resolves. The results screen shows the outcome, your place, time, kills, who killed you, the GV rows and any achievements unlocked. A dead player sees "YOU DIED" for 1.5 s first, while the run goes on for everyone else. Back to hub reloads the profile.

The HUD shows players standing, your run GV and bounty, the arena timer (coliseum, locked gates, sudden death), a minimap (zones, camps with the cleared ones crossed out, camp chests with a countdown, closed gates, living mobs, your planned route, known quest givers, your active objective and parcel carriers), the cards row and the build strip under your hp, a weapon bar with the shared cooldown, a red flash when you take a real hit, and a green or red screen tint when the nearest enemy in sight is countered by you or counters you.

#### Quests

Each arena run has **ten standing quest offers**: five known during planning and five rumoured. They ask you to kill mobs or a player, collect tokens, or carry a parcel back from a far zone. Walk to an offer's giver and press `F`: a card opens with the offer, and **Accept** (`Enter` or `1`, or a click) starts it for you. Nothing counts until you have accepted it (kills, tokens, the parcel and the turn-in are ignored before, and nothing you already did counts afterwards); a token or parcel you try to take first is refused and stays where it lies. Then finish the objective and stand by the giver to turn it in automatically; the first player to do so closes it for everyone. Givers are neutral and immune to attacks and Wishes, so they are turn-in points, not enemies. Every offer has its own fixed expiry. A kill offer closes early when clearing camps leaves no standing player able to finish it: nobody has the whole objective yet and the live mobs it counts no longer cover what each lacks.

Quest rosters, ids and placement use a separate private random stream, seeded from its own secret (not the public seed, and independent of the reward stream), never the reward or world streams, so enabling quests does not change later reward rolls. The hidden givers are placed in their own private pass and the ids come out of a private shuffle; the public map seed and known giver positions do not determine the hidden positions. Every giver, token and parcel stands on ground a player can walk to from the coliseum and off hazard floor; givers also keep clear of camps, and no token or parcel lies on a camp chest or a mob's rest spot.

The planning screen shows the known givers, timers and rewards (and says to accept at the giver in the run) so you can choose a spawn and route. **J** opens the quest log during planning and the run, grouped by open/completed/expired status, each open row marked Accepted or Not accepted (talk to its giver); completed and expired rows do not keep counting down. In training, J opens a panel explaining that practice has no quests. The log is placed live just below the HUD plate (wherever the cards row and the build strip end), clear of the coliseum countdown and the weapon bar; the world shows only open givers plus items and parcel carriers, and the minimap shows known givers, your active objective and carriers. Walking near a rumoured giver reveals it: if several standing players discover it on one tick, the secret `tieRank` chooses the finder. That player gets the quest privately **four seconds** before everyone else sees it. Until then, other clients get only the remaining rumour count, not its identity or position. A rumoured offer can also close unseen, only at its own deadline, the coliseum teleport or the run's end (a camp clear never closes one or moves the count); the count then drops without saying where.

Use `F` for quest tokens and ground parcels of an offer you accepted; it never offers a quest item the server would refuse (the offer is not accepted yet, the quest is over, you already carry a parcel, someone else carries it, you have enough tokens), so a usable weapon pickup is not shadowed. Tokens count on pickup. You can carry one parcel at a time, everyone sees its carrier, and dying drops it for someone else to steal. Swarm and Blaze Step keep the parcel, and a Swarm-hidden carrier's parcel and marker remain visible at their position. Ordinary farming still pays while carrying.

A completion grants one card (a stat card whose tier follows how long the quest takes, one tier lower for a player whose feed is high: the feed brake mob rewards have) and pays the offer's GV from a separate **24 GV per-run quest cap**, and removes the giver and items. Results list quest GV separately. Completed and expired rows disappear after a 20-second grace period. Offers that expire together show as one toast, and you get one completion toast, so the GV line stays visible. The coliseum teleport and run end close every open quest without a reward, remove givers, tokens and parcels (including a carried parcel), and prevent further hidden reveals. Full rules and the assumption-based balance worksheet are in [docs/quests.md](docs/quests.md).

#### Camp chests and cards

When the last mob of a camp dies, one **card chest** appears on the camp's chest tile for **15 seconds**, whoever got the kill, and everyone who fought the camp and stands near it is healed: a scratched player gets a little back, one who was ganked low nearly all of it. The chest offers three cards, the same three to everyone: a stat card, a conditional card or a second stat card, and an augment (an elite camp's chest offers higher tiers). A conditional card needs a stat card of its kind in your build; conditional cards and augments are one per player, stat cards stack. Each player picks **once** (a skip counts as the pick), and each option goes to the first player who takes it, so what you get depends on who is standing there. A panel opens on the right edge when you are within 88 units of a live chest with a clear line (and stays open out to 92); it shows a countdown, the three cards (title, tier, what it does, and why it is on offer for you: "Deepens your Attack Damage", "You have Leech", "New") and who took what, and it never takes a click meant for the world. Press `C` to focus it, then `1` / `2` / `3` to take a card or `0` to skip, or click. The server checks everything from your position: a pick fails with a short message ("Too far away", "Already taken", "Needs Leech", "Already yours", "Can't do that now" while stunned or casting, ...).

A skip heals 15% of your max hp (not within 3 s of a fight, and not at full hp) and otherwise pays 3 GV. Every card in the catalog is built and can be rolled. The ones you hold show as a row under your hp. The full rules and numbers are in [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md) section 12.

### Training

The Training Grounds door starts a private room of one, created fresh each time, with your picked faction. Next to your spawn are a plain dummy, a shield dummy (reflects arrows, ripostes swords) and a rack with one of each weapon. Nothing is recorded: no GV, no stats, no achievements, no timer, no results, no mobs of its own. If you go down you are stood back up. Leave with the button or `Esc`. A room whose player sends no input the server accepts for 5 minutes is closed. A message the server rejects does not count as input.

**The practice console.** A **Console** button in the training bar opens a small panel (training rooms only; an arena room refuses every `train` message). It sets how many copies of any card you hold (1, 2, 3 or 9 of a stat card, one of a conditional card or an augment; a conditional card needs a stat card of its kind first, and a card that is not built is set but does nothing, and the toast says so) or takes it off, spawns a practice camp (three mobs of a type, one for an elite type, asleep near you, so hitting one wakes the rest), drops a card chest two tiles away with three cards of your choice (or a rolled one), and clears all of it (cards, practice mobs, chests; the dummies and the rack stay). Practice mobs pay nothing and drop no chest, but clearing a practice camp heals you as a real one does. Caps: 12 practice mobs at once, 6 chests, a short pause between camps and between chests. The console takes no game key; `Esc` inside it hands the keyboard back, and the next `Esc` leaves training.

### GV, the shop and progress

GV comes from the run and is kept when you die (it banks the moment your run resolves):

| Source | GV |
| --- | --- |
| Win (last one standing) | 50, only if the run started with 3 or more players and you damaged at least 2 different opponents |
| Player kill | 10 |
| Bounty claimed | 10 × (your victim's player kills − 2)^1.5: 10, 28, 52, 80 at 3, 4, 5, 6 kills |
| Mob kill | 2 (an elite 10) × the mob reward curve (×0.98 at no feed, ×0.65 at a feed of 5, never under ×0.3; ×1.25 more if you are far behind), at most 30 a run from mobs and chest skips together |
| Chest skip, with nothing to heal | 3, inside the same 30 |
| Quest | 5 to 13, from a pot of at most 24 a run, and a card |

GV buys cosmetics only: body colours, outlines, trails, titles, and golden looks for each faction and weapon. Nothing changes combat. Spending lowers your balance but never your lifetime total or your monthly total. The monthly total is what the leaderboard ranks (UTC months, any past month, your own place even outside the top 20). Achievements (kills, wins, a win with each faction, golden-look goals) are computed on the server from banked runs. They unlock once and grant titles and cosmetics. Win goals count only wins that earn the win bonus. Equipped cosmetics are read when you join a run, so a change in the wardrobe applies from the next run. See [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md) section 13.

## Commands

All from the repo root.

| Command | What it does |
| --- | --- |
| `npm run dev` | Server (`tsx watch`, :2567) and client (Vite, :5173) together. Ctrl+C stops both. |
| `npm test` | Vitest in the client, server and shared workspaces. The server suite includes end-to-end runs over real sockets. |
| `npm run typecheck` | `tsc --noEmit` in every workspace. |
| `npm run build` | Production build of the client into `packages/client/dist`. Vite does not type-check, so run `typecheck` too. |
| `npm run playtest -- --no-tunnel` | Host a playtest: builds the client, runs the production server and (without `--no-tunnel`) a Cloudflare quick tunnel. See [Hosting a playtest](#hosting-a-playtest). The flags need npm's `--` in front. |
| `npm run playtest:signin -- <callsign>` | Print a sign-in link for a returning playtest player (`--all` for everyone, `--url <address>` to override the address). See [Hosting a playtest](#hosting-a-playtest). |
| `npm run bots -- 3` | Start 3 headless bots against the running dev server. Flags need a second `--` (below). |
| `npm run harness -w @raid/server` | Weapon duel harness (see [Testing](#testing)). The root has no `harness` script. |
| `npm run harness:factions -- --python` | Faction cycle harness (see [Testing](#testing)). |
| `npm run harness:zones -w @raid/server` | Zone duel harness: duels on fenced and real terrain (see [Testing](#testing)). |
| `npm run start -w @raid/server` | Run the server once without file watching. |
| `npm run preview -w @raid/client` | Serve the output of `npm run build` locally. |

The end-to-end tests start their own server on a free port with a temporary profile file. They are safe to run while `npm run dev` is up and never touch your real profiles. `tsx watch` restarts the server when server or shared source changes. A restart is a graceful shutdown: the run is void (not recorded), but players still in it are paid the GV they had earned.

**Bot flags.** The root `bots` script nests npm, which swallows flags unless you add a second `--`:

```bash
npm run bots -- -- 3 --url http://host:2567 --faction random --loop
npm run bots -w @raid/server -- 3 --verbose        # the same, without the nesting
```

`--url` (default `http://localhost:2567`), `--prefix` (profile names are `<prefix>1..N`, default `bot`), `--faction <id|rotate|random>` (default `rotate`: five bots make a lobby with one of each; ids are `fire`, `sentenced`, `plague`, `frost`, `holy`), `--tier <easy|normal|hard|mix>` (default `hard`; `mix` rolls a tier per bot and run, 30% easy, 45% normal, 25% hard, like the server's own fill bots), `--persona <farmer|hunter|opportunist|cautious|random>` (default `random`: each bot rolls one per run), `--seed <n>` (the same seed against the same lobby plays the same; default random), `--stats <file>` (a learning file the bots read and add to; default none, so no learning), `--loop` (queue again after each run), `--verbose`. The count is 1 to 64. Bot tokens are kept in `packages/server/data/bot-tokens.json` so the same names can be reused.

### Server environment variables

Set them on the command line, for example `MIN_PLAYERS=1 FILL_SECONDS=1 PATIENCE_SECONDS=20 npm run dev` for fast solo testing. A missing or non-numeric value falls back to the default. They are read in `packages/server/src/config.ts`, with defaults from `packages/shared/src/constants.ts`.

| Variable | Default | Meaning |
| --- | --- | --- |
| `RAID_PORT` | `2567` | Port the server listens on. |
| `STASH_FILE` | `packages/server/data/stash.json` | Where profiles are saved (git-ignored). The name predates profiles v2. A v1 stash file there is migrated in place. |
| `MIN_PLAYERS` | `2` | Players needed before the lobby wait is cut to `FILL_SECONDS`. |
| `LOBBY_SECONDS` | `30` | Lobby wait, counted from the first join. |
| `FILL_SECONDS` | `5` | Longest wait left once `MIN_PLAYERS` have joined. |
| `PLAN_SECONDS` | `12` | The planning step after the lobby (spawn pick, camps, route). It ends early once everyone connected is ready. `0` skips it: the run starts straight from the lobby. Training rooms never plan. |
| `PATIENCE_SECONDS` | `300` | With 8 players standing and no death for this long, everyone standing is teleported into the coliseum. |
| `PATIENCE_MIN_SECONDS` | 40% of `PATIENCE_SECONDS` | The same wait with 3 or fewer standing, linear in between. Kept between 0 and `PATIENCE_SECONDS`. |
| `FIRST_PATIENCE_SECONDS` | `300`, or `PATIENCE_SECONDS` when that is set | The first patience wait of a run, flat whatever the player count, armed when planning ends. Setting only `PATIENCE_SECONDS` (to shorten a run) makes that the flat first wait too, as in the example above; set this one as well to keep them apart. `0` makes it scale with the players standing like every later wait. |
| `SUDDEN_DEATH_SECONDS` | `60` | Locked in the coliseum this long with no death, sudden death starts. |
| `WISH_LOCK_SECONDS` | `45` | Every Wish stays locked this long after a run starts. A training room has no lock. The end-to-end tests use 5. |
| `TRAINING_IDLE_SECONDS` | `300` | A training room whose player sends no accepted input for this long is closed. |
| `DUMMIES` | off | `1` or `true`: training dummies and a weapon rack next to every spawn in arena runs too. |
| `MOBS` | on | `0` or `false`: no regional mobs. |
| `QUESTS` | on | `0` or `false`: no quest offers in arena runs. Training rooms never have quests. |
| `MAP_POOL` | `8` | Certified maps the server keeps ready, made by a worker thread (about 130 MB more memory for the worker, its tables and tsx). `0` runs no worker: every room generates its own map on the main thread, about 33 ms (64 at p99, 80 at worst) and logged. An empty pool does the same for one room. |
| `COLYSEUS_LATENCY` | `0` | Netcode testing: the simulated minimum round trip in ms (half each way) of every connection. A TCP-faithful model (`packages/server/src/net/netSim.ts`): per connection and direction a FIFO, so messages never reorder. |
| `NET_JITTER_MS` | `0` | Mean of the extra per-message delay (exponential, so right-skewed), each way, on top of `COLYSEUS_LATENCY`. |
| `NET_LOSS_PCT` | `0` | Percent of messages that need a retransmission: they wait an extra timeout (at least 200 ms) and everything behind them waits too (head-of-line blocking). |
| `NET_SEED` | random | Seeds the jitter and loss draws, for repeatable runs. |
| `ALLOW_NETSIM_WHEN_HOSTING` | off | `1`: let a server that is hosting (`NODE_ENV=production` or `CLIENT_DIR`) install the network simulator anyway. Without it the simulator is refused there with one warning, since it would slow every player; `npm run playtest` drops the three variables above. |
| `CLIENT_DIR` | unset | A built client (`packages/client/dist`) to serve from the same port as the API and the websocket. Setting it, or `NODE_ENV=production`, is "hosting": see [Hosting a playtest](#hosting-a-playtest). |
| `PLAYTEST_PASSCODE` | unset | When set, a passcode is needed to claim a new callsign and to join a room. |
| `PASSCODE_FAILS_PER_MINUTE`, `PASSCODE_FAILS_PER_MINUTE_ALL` | `6`, `40` | With a passcode set: wrong guesses a minute per client address and in all, before the server answers 429 (on the profile route and on joining). |
| `PLAYTEST_TUNNEL`, `PLAYTEST_HOSTNAME` | unset | Launcher only (`npm run playtest`): the named tunnel and its address, as `--named` and `--hostname` ([A stable link](#a-stable-link)). |
| `CORS_ORIGINS` | unset | Hosting only: comma-separated origins that may read `/api` and matchmaking from another site. Nobody else may. |
| `MAX_ARENA_ROOMS`, `MAX_TRAINING_ROOMS` | `4`, `8` hosting; no limit in dev | Rooms alive at once. A room beyond that is refused with "server is full"; joining an open lobby still works. |
| `MAX_NEW_PROFILES_PER_HOUR`, `MAX_NEW_PROFILES_PER_IP_PER_HOUR` | `30`, `10` hosting; no limit in dev | New callsigns an hour, in all and per address (behind a tunnel the address is `CF-Connecting-IP`, trusted only when the connection comes from this machine; otherwise the socket's address). Answers 429. |
| `SHOP_BURST`, `SHOP_PER_SECOND` | `6`, `3` hosting; no limit in dev | One profile's shop and wardrobe request budget. Answers 429. |
| `ORDER_BURST`, `ORDER_PER_SECOND` | `30`, `15` | One player's budget of in-match orders (`move`, `stop`, `target`, `swap`, `pickup`, `cast`, `plan`, `choose`, `train`, `attack`, `release`; not `aim`). Excess orders are dropped silently. The browser sends about 10 a second while the right button is held. |

A `0` for any limit above turns it off.

### Client environment variable

`VITE_SERVER_URL` points the client at a server. Unset, a dev build opens a WebSocket to `<page hostname>:2567` and calls `/api` on its own origin, which Vite proxies to `localhost:2567`; a production build (what the server serves when hosting) talks to its own origin for both, so `https` pages get `wss`. Set, the WebSocket and the REST base both derive from it (`ws` becomes `http`, `wss` becomes `https`) and `/api` is a cross-origin request. The proxy target and the default port are fixed at 2567, so changing `RAID_PORT` also needs this, for example `RAID_PORT=3000 VITE_SERVER_URL=http://localhost:3000 npm run dev`. Vite inlines it at build time, so set it when running `npm run build` too.

## Hosting a playtest

Up to 8 friends can play on your Mac with one command, from anywhere, over a Cloudflare quick tunnel (free, no account).

```bash
brew install cloudflared          # once
npm run playtest                  # builds the client, starts the server and the tunnel
```

It prints a banner with a `https://something.trycloudflare.com` link. Send that link to your friends. They open it, type a callsign and press Start Run. It was tested in Chrome on a Mac only: Edge (Chromium) is expected to work, and Firefox and Safari are untested (Safari also caps at 60 fps unless "Prefer Page Rendering Updates near 60fps" is turned off in its feature flags). Each start has a new link, so a friend who played before needs their own sign-in link (`npm run playtest:signin -- <callsign>`, below), unless you set up [a stable link](#a-stable-link); a new friend just picks a callsign.

What the command does: builds the client (`VITE_SERVER_URL` unset), starts the production server as one process (`NODE_ENV=production`, no file watching) that serves the page, the API and the websocket on one port, waits for it to answer, opens the tunnel and prints the link and the Wi-Fi address. On a Mac it also runs `caffeinate -is` so the machine does not idle-sleep while it hosts.

Flags need npm's `--` in front of them:

```bash
npm run playtest -- --no-tunnel               # this Mac and the same Wi-Fi only
npm run playtest -- --port 2600               # another port (default 2567, or RAID_PORT)
npm run playtest -- --no-build                # reuse the build in packages/client/dist
PLAYTEST_PASSCODE=pick-something npm run playtest   # ask players for a passcode
npm run playtest -- --named roguehalla --hostname play.roguehalla.com   # your own named tunnel: the same address every time (A stable link, below)
```

- **Stopping.** Press Ctrl+C once. The server saves the profiles first (a few seconds); pressing it again only prints a note. If the launcher itself dies (kill -9, a crash), the server notices its pipe close and shuts down the same way (profiles saved, lock freed), and the tunnel goes too: cloudflared runs under `scripts/tunnelGuard.mjs`, which ends it within a few seconds of the launcher's death, so the old public address cannot keep pointing at the port for whatever you run there next. Only if the guard is killed as well can a cloudflared stay up; the launcher records its pid next to the profile file and the next `npm run playtest` stops it. If the tunnel dies by itself the banner says so, and `playtest:signin` says the address is dead instead of printing links to it.
- **Returning players need a sign-in link.** A browser keeps a callsign's token per address, and a quick tunnel has a new address every start, so a friend who comes back and types their callsign is told it is taken (its token is not on this device). Print their link and send it to them alone: `npm run playtest:signin -- <callsign>` (`--all` prints one per callsign; `--url <address>` overrides the address, which the running playtest records next to the profile file, in `<profile file>.link.json`). It reads the profile file and never writes it. The link is `<address>/?profile=<callsign>#key=<token>` (plus `&code=` when there is a passcode): the token is in the part after `#`, which a browser never sends to any server, so the tunnel cannot see it, and the page takes it out of the address bar at once and keeps it apart as an unproven claim: it tries it on its next request to the server and keeps it as the callsign's token only once the server accepts it. **The link is that callsign's password**: anyone who opens it plays as that callsign, so send each one privately. A link whose key is wrong (a copy cut short) is dropped when the server refuses it and does not block the right link; a link never replaces a callsign the browser already proved. New players do not need one, they just pick a callsign. A stable address makes this unnecessary (see [A stable link](#a-stable-link)).
- **Profiles** are in `~/.rougehalla/playtest-profiles.json` (override with `STASH_FILE`), separate from the dev file and kept across branches and worktrees. Back it up by copying it while the server is stopped (or any time: writes are atomic).
- **Keeping the Mac awake.** The script does it. By hand: `caffeinate -dis`. With the lid closed it only stays up on power with an external display.
- **Passcode.** Off by default (the banner says how to turn it on). Without one, anyone who gets the link can claim new callsigns, up to 30 an hour in all. With `PLAYTEST_PASSCODE` set, a new callsign and every join need it. The printed link carries it (`?code=...`), the browser remembers it, and a friend who opens the plain link sees "This playtest needs a passcode: open the link your host sent." Sign-in links carry it too. Use visible ASCII only. Wrong passcodes are throttled: 6 a minute per address and 40 in all (`PASSCODE_FAILS_PER_MINUTE`, `PASSCODE_FAILS_PER_MINUTE_ALL`), on the profile route and on joining alike; past that the server answers 429 ("Too many wrong passcodes from your connection. Wait a minute...") without looking at the guess. A guesser who keeps changing address can still use up the 40 and make everyone wait out the minute. Pick something longer than a common word.
- **A stable address.** Optional, with a domain of your own: [A stable link](#a-stable-link) below. The quick tunnel stays the default.
- **Guards** for a public link, all on while hosting and tunable (see the environment table): only the served page may read the API (no `Access-Control-Allow-Origin: *`; `CORS_ORIGINS` allows more), caps on rooms (4 runs, 8 practice rooms), on new callsigns (30 an hour, 10 per address) and on shop requests, and a budget of in-match orders per player. They are best guesses for 8 friends. The network simulator (`COLYSEUS_LATENCY`, `NET_JITTER_MS`, `NET_LOSS_PCT`) is never live on a public link: the launcher drops those variables (with a note, in case one was left exported in your shell), and a server that is hosting refuses to install it unless `ALLOW_NETSIM_WHEN_HOSTING=1`, with one warning. To test with lag, run `npm run dev` or the server yourself.
- **Troubleshooting.** A quick tunnel's address changes every start, so a new run needs a new link (and returning players their sign-in links, above). The tunnel has no uptime guarantee: if the banner says it stopped, restart. A player who loses connection keeps their seat for 10 seconds and is reconnected if they come back in time, then counts as gone. The Mac itself may not open its own new link for a minute or two (its resolver cached "no such name" while the tunnel came up); use `http://localhost:2567` there. If the server says the port is busy, stop the other server (or `npm run dev`) or pick `--port`.
- **Other ways.** Tailscale (everyone installs it and joins your tailnet, then use `--no-tunnel` and the Mac's tailnet address) keeps it private. Router port forwarding exposes your home IP address and needs TLS in front for `wss`; not recommended. A VPS: the `Dockerfile` builds the client and runs the same server in one container, with the profile file in a `/data` volume (`docker build -t rougehalla .`, then `docker run -d -p 2567:2567 -v rougehalla-data:/data -e PLAYTEST_PASSCODE=pick-something rougehalla`); put TLS (Caddy, nginx) in front of it. It was checked here by running its steps by hand, since no Docker daemon was running.

### A stable link

A quick tunnel has a new address at every start, which is why returning friends need sign-in links. A **named tunnel** on a domain you own has one address for good: friends' browsers keep their callsigns between sessions, so nobody needs a link (only a callsign on a new browser or device, or after clearing site data, does: `npm run playtest:signin -- <callsign>` still works and prints your stable address). It is opt-in and the quick tunnel stays the default. It costs nothing beyond the domain: a Cloudflare account is free.

Setup, once. Nothing here is automated, because every step is your login or your domain. The tunnel name and the address are yours to choose; the examples use `roguehalla` and `play.roguehalla.com`.

1. Create a free account at cloudflare.com and add your domain to it ("Add a site"). Cloudflare shows two nameservers: set them at the registrar where you bought the domain, and wait until Cloudflare says the site is active (minutes to a day).
2. `cloudflared tunnel login`. It opens a browser: log in, pick the domain, authorize. It saves `~/.cloudflared/cert.pem`.
3. `cloudflared tunnel create roguehalla`. It makes the tunnel and saves its credentials file, `~/.cloudflared/<tunnel id>.json`.
4. `cloudflared tunnel route dns roguehalla play.roguehalla.com`. It makes `play.roguehalla.com` point at the tunnel.

Then, for every playtest:

```bash
npm run playtest -- --named roguehalla --hostname play.roguehalla.com
```

or put `PLAYTEST_TUNNEL=roguehalla` and `PLAYTEST_HOSTNAME=play.roguehalla.com` in your shell profile and run plain `npm run playtest` (`--quick` makes one run use a quick tunnel instead). The banner prints `https://play.roguehalla.com/` to share. Everything else is as above: the same guards, the passcode, the profile file, the stop and clean-up behaviour (the tunnel ends with the launcher, however it ends).

- **Keep `~/.cloudflared/` private.** `cert.pem` can manage your DNS and the `<id>.json` file lets anyone run your tunnel. Never commit, share or paste them. This project's launcher never reads or prints their contents.
- **If something is missing**, the launcher says so in plain words, shows cloudflared's own error line (nothing secret-looking) and tells you what to run; it keeps serving on this Mac and the local network meanwhile.
- **One machine at a time.** Run a given named tunnel from one place only; two connectors split the traffic between them.
- It was tested here only against a stand-in `cloudflared` that prints what a named tunnel prints, never against a real account, so the first real run is the real test.

## Testing

```bash
npm test                    # client, server and shared; about a minute, about 4,000 tests
npm run typecheck
npm test -w @raid/server    # one workspace
```

What the suites cover:

- **Shared** (`packages/shared/test`): the pure rules. The faction law and the weapon formula are checked against numbers printed by the Python model, so the two cannot drift apart. The map generator is certified here too (below).
- **Server** (`packages/server/test`): the sim headless (ledger, the PvP factor and its guards, weapons, fists, signatures, mobs, cards and their hooks, the camp heal, feed, arena, training), the room and HTTP API, shutdown, the profile store and shop, the fx wire format, the fill bots (`test/bots/`, `botSeat`, `botRoom`, `botLobby`) and `e2e.test.ts`. `questBench.test.ts` runs the report-only quest harness end to end at its smallest size and fails if it goes blind (no quest runtime, no offers, no rows). In `e2e.test.ts` four bots (Hard tier, hunter, farmer, hunter and opportunist personas, with the server's own bot fill off) play whole runs against a real server, and the GV ledger, stats and file must balance. It replays a run once if the bots showed no kill, signature hit, mob kill or landed Wish (or, when a camp was cleared, a chest card taken), and fails if the replay lacks it too.
- **Gates**: `perf.test.ts` (with 8 players and the map's ~160 mobs, `step()` averages under 5 ms with a p99 under 15 ms, also in the pathfinder's worst case with every live card held on all 8 players and with the quests on, and the same tick with 8 in-process fill bots, whose share stays under 1.5 ms on average), `bandwidth.test.ts` (under 20 KB/s per client, also with 7 fill bots and with quests on, where it must stay within 1.5 KB/s of the same runs without) and `packages/shared/test/mapgen.perf.test.ts` (a certified map costs 93 ms or less with the zone stylers and 48 ms without, scaled by a yardstick measured on one machine; a map takes about 33 ms on average, 80 at worst, on the machine it was measured on). The generator has its own certification: 200 seeds in 8 parallel shards, checked by an independent certifier (hard checks plus per-zone measures, with every wall owned by a named feature) and pinned byte for byte; `mapSweep.ts` runs the same certifier over thousands of seeds.
- **Client** (`packages/client/test`): the views and the DOM overlay against fakes for Phaser and the DOM. There are no browser tests, so look at the real thing after a rendering change.

**Soak.** For a long run, start the server and leave `npm run bots -- -- 6 --loop` going. The Phase 13 soak ran 6 looping bots for 43 hours: about 15,600 run results, no server errors, every run over within 190 s, and the server's RSS flat at about 330 MB after a 30-minute warm-up.

### Harnesses and benchmarks

These report. They never fail the build, and they are what to run before touching a weapon or faction number.

| Command | What it does |
| --- | --- |
| `npm run harness -w @raid/server` | Weapon duels in the real sim between two policy-driven clients: the weapon matrix, a style grid for every edge with a ranged weapon, an edge verdict (holds, or fails and why), the same edges when both fighters click each other (the target lock), and kiting (a shooter that stands, strafes, kites, orb-walks or locks its chaser). About 55 s. `-- --core` skips the sensitivity passes (about 40 s), `-- --quick` takes a few seconds, `-- --help` lists the filters. `-- --kiting-only` runs only the kiting sections and the faction edges against a kiting shooter; `--shooter-cards haste2,fleet2` gives the shooters of those duels cards (the chaser has none) and `--shooter-as 1.2` an attack-speed multiplier on top. |
| `npm run harness:factions -- --python` | Every faction edge with the same weapon on both sides, and the signature openings, in the real sim. Checked pair by pair against `testing/realtime.py` (about 5 s). `-- --mode policy` plays them as moving fighters (about 20 s), `-- --mode full` with real arcs and flight (about 7 s). |
| `npm run harness:zones -w @raid/server` | Duels where the terrain is: the Rows condition (Fire's axe against Sentenced's bow at a fence row, 96 setups against the open-floor control; it holds, 96 of 96), `-- --variants` for the gate variants and `-- --source map --seeds N` for every designed edge inside the real zones of generated maps against open floor (about 5 s for the Rows alone). |
| `npx tsx packages/server/bench/pullWindow.ts [--maps 40] [--pairs 2000]` | How much longer than the unbounded string pull the shipped `findPath` is (share of paths over 1% longer, longest ratio) and what it costs per path: the generator's spawn gate depends on `findPath`, so `PULL_WINDOW` changes re-pin every map. |
| `npx tsx packages/server/bench/stepBench.ts [--cards] [--stress] [--quests]` | Cost of one `step()` with 8 players and the map's ~160 mobs. `--cards` gives all 8 players every live card once. `--quests` gives the run the quest roster (its givers stand among the mobs); the output counts the quest offers. `--stress` wakes every camp every second and has the players re-lock constantly (the pathfinder's worst case). Then the same map with a hazard on every fourth floor tile, against it with the effects off. `--bots 8` plays the same tick with 8 in-process fill bots instead and reports the whole tick and the bots' share apart (`--clock cpu` for steadier numbers). |
| `npx tsx packages/server/bench/bandwidth.ts [seed=N quests=1]` | Bytes per second one client receives, headless with the real encoder: typical, heavy, idle, typical with 5 camp chests up, and a `bots` scenario (7 fill bots in a headless room and one client at a camp). `quests=1` gives the run the quest roster. |
| `npm run questbench -w @raid/server` | Quest balance in the real sim: scripted quest-takers against a farm-only baseline (3 seeds, 5 seats per policy, one per faction, 300 s; about 27 s). Per quest: completions over attempts, the quest's own seconds against the farm seconds for the same power gain (below 1 = faster than farming, target 1.0-1.35), live power, deaths and fights. `-- --quick`, `--seeds N`, `--players N`. Definitions and a first result are in [docs/quests.md](docs/quests.md). |
| `npm run tournament -- --games 400 --lineup E,E,N,N,H,H` | Headless bot-against-bot games with no Room: per-tier wins, placements, reaction and click statistics (`docs/BOTS.md` 9.3, the tuning log in `docs/BOTS_TUNING.md`). `--patience 300 --sudden 60 --max-minutes 15` plays the real timers; `-- --help` lists the flags. |
| `npx tsx packages/server/bench/mobDuel.ts` | Real-sim duels of a starting player (on fists unless `--weapon` says otherwise) against every zone's mob type and elite. `--style stand` has the player stand and fight; `--types` prints one row per mob type. `--sweep` tries other scales (`--ks`, `--eks`). |
| `npx tsx packages/server/bench/campDuel.ts` | The same against a whole mono-type camp (`--size N` mobs, 4 by default, the generator's median: that many normals, or the elite and N - 1), with a territory like a generated camp's. The `camp` pull is the real rule: the mobs are placed with their camp and the first hit wakes them all. `single` (one at a time) and `group` (all awake at the start, harsher) are the older pulls (`--pulls camp,single,group`; they keep the 9-tile circle). `--weapon sig|<id>` and `--weapons` try other starters (fists by default), `--types` prints one row per mob type and checks the gates (every normal type's camp cleared by most fists starters, every elite type's by at least one faction on its zone's weapon), `--seeds N`, `--cap SECONDS`, `--no-territory` (the 9-tile circle instead), `--json FILE`, `--k X` / `--elite-k X` another scale, and `--sweep` (with `--ks`, `--eks`, `--sizes`) prints the pairings cleared (of 25) per scale and camp size. `--map` plays the camp pull at one of the zone's real camps on the game's themed map. |
| `npx tsx packages/server/bench/ttkCurve.ts [--minutes 0,1,2,3,4,5]` | The balance pass's time-to-kill curve: how long an even duel lasts (first hit to the end) at minute 0 on fists and with the cards one camp a minute adds, over every faction pair. Report only; `test/ttkCurve.test.ts` is its reduced gate. |
| `npx tsx packages/server/bench/matchups.ts --layer faction\|weapon\|fed` | The ten faction edges (hp the favourite keeps, its win % under the play-noise model, the damage multiplier the underdog would need) each weapon edge pooled over all 25 faction pairs (`--cross`), or a farmed player against a fresh one on fists (`fed`). Report only. |
| `npx tsx packages/server/bench/farmVsFight.ts` | A player who killed one mob on fists against a fresh player on fists: does farming pay? Report only. |
| `npx tsx packages/server/bench/augments.ts [--card id]` | The strongest builds of augments against the minute-5 kit with the guards on: win %, and the fastest and median kill time. Report only. |
| `npx tsx packages/server/bench/pickValue.ts <card\|all\|base\|conditional\|augment>` | What one card is worth in a mirror duel, holder against non-holder. Report only. |
| `npx tsx packages/server/bench/mobExecute.ts` | How fast one mob of each zone kills a motionless player at 25% hp (the Plague mob's execute is scaled to match the others). Report only. |
| `npx tsx packages/server/bench/botPicks.ts [seeds...]` | What eight bots (two per persona) take from the camps' chests. Report only. |
| `npx tsx packages/shared/scripts/printMap.ts <seed> [attempt]` | An ASCII dump of a map: zones, territory edges, camps, chests, crates, landmarks, features, the spawn pool. Without an attempt it prints the first that certifies. |
| `npx tsx packages/shared/scripts/printZone.ts <seed> [zone] [--plain] [--props] [--features]` | An ASCII dump of one zone of a map; `--features` draws every tile a named feature owns as its kind's letter. |
| `npx tsx packages/shared/scripts/mapBench.ts [seeds] [from=] [styler=default\|none\|zone]` | What the generator costs per seed (mean, p50, p90, p99, max), how many attempts seeds need, how many are discarded, failures by reason, time per stage against the targets (zones, landmarks, spawns, styler, nets, crates, post, terrain, records, spawn gate, gates), and the stylers' time per zone. |
| `npx tsx packages/shared/scripts/mapSweep.ts <count> [from=] [styler=default\|none\|zone\|demo] [strict=auto\|0\|1]` | The independent certifier on every seed (themed maps by default): the hard checks (connectivity, zones and territories, the spawn pool with its 10-tile rule and its findPath walk ratio, hazards on the spawn walks, validateTerrain, and with `strict` that every wall belongs to a named feature and no wall piece is under 6 tiles) and the per-zone measures (how far a player sees, how often a wall stands between two fighters, camp-to-camp detours and loops, feature counts) judged against their windows. Prints one JSON line on stdout and a table on stderr; ranges run in parallel and `merge=a.json,b.json` joins them. |
| `npx tsx packages/shared/scripts/pinMaps.ts [final] > packages/shared/test/mapPins.ts` | Re-pins the maps of seeds 0 to 199 (and the stylers' output on a synthetic open fixture) after a deliberate change to the generator. Run it in its own process; while a zone styler's `version` differs from the pinned one the pin tests skip. |

The map scripts are for the generator: run `mapSweep.ts` before and after touching it (a non-empty `failed` list in its JSON line is a broken guarantee, though the script still exits 0).

### The design tools in `testing/`

Python, no install beyond numpy (only `test_rpsls.py` needs nothing). They are the design source of truth for the faction numbers. [testing/CLASS_SHEET.md](testing/CLASS_SHEET.md) is the sheet and [testing/COUNTER_REVIEW.md](testing/COUNTER_REVIEW.md) the review of every matchup.

| Command | What it does |
| --- | --- |
| `python3 testing/test_rpsls.py` | The design oracle: the 10-edge faction graph, each faction beats exactly two, power-scale and name-shuffle invariance, jitter robustness (relaxed for the compressed edges), a purity audit, and the identity tests. Standard library only, about 9 s. Exits non-zero on a failure. |
| `python3 testing/matchup_band.py [--reference]` | How close the ten designed edges are: the hp the favourite keeps and the mirrors' fight lengths, from the sheet in `classes.py` (no geometry), against the owner's 10-35% band. Standard library only, about 3 s. `--reference` prints the table to paste into `packages/shared/test/factions.test.ts`. |
| `python3 testing/test_kite.py` | The kiting guarantee at duel pace: a perfect orb-walking archer or mage (roots for its windup at each shot, walks away at full speed between shots; a Frost shooter's move chill included) must win at most 65% of its duels against the melee faction that beats it, under the play-noise model. One PASS, EXCEPT (the one named exception) or FAIL per cell. Needs numpy, about 10 s. Exits non-zero on a FAIL. `--shooter-as X` and `--shooter-dmg X` judge the same 20 cells with every shooter buffed (attack speed, outgoing damage; the chaser never is). |
| `python3 testing/kite_windup_sweep.py` | Sweeps the bow's and the wand's windup cap and share against the kiting guarantee's older, stricter measure (a stress test now, not the gate) and prints the smallest ones that hold every cell, and the shortest Frost windup that lets a chaser arrive. Needs numpy, about 10 s. |
| `python3 testing/kite_buff_sweep.py [--jobs N]` | How much a buff on the shooter can add before the kiting guarantee's older, stricter measure breaks (a stress test, not the gate): the largest attack-speed multiplier for which all 20 cells hold, the same for a damage row, and the retired Plague Rat buff's rows. Needs numpy, about 30 s on 8 cores. Report only; the numbers are in [testing/TUNING_ROGUE.md](testing/TUNING_ROGUE.md). |
| `python3 testing/realtime_report.py [what-if.json] [sections]` | The 20 Hz model (`realtime.py`): cadence tables, duels with signature openings, kiting, buff thresholds, the longest stretch with no swing. Needs numpy, about 40 s. |
| `python3 testing/weapon_reference.py` | Prints the weapon tables to paste into `packages/shared/test/weapons.test.ts` and `packages/server/src/harness/parity.ts` when a weapon number changes. Needs numpy. |

`realtime_paced.py` is the same model at duel pace as JSON. `harness:factions --python` runs it for you. The tuning logs are [testing/TUNING_9_1.md](testing/TUNING_9_1.md) (weapons), [testing/TUNING_10.md](testing/TUNING_10.md) (signatures) [testing/TUNING_CONTROLS.md](testing/TUNING_CONTROLS.md) (the controls rework: the windups, the kite check against an orb-walker, the real-sim before and after) and [testing/TUNING_ROGUE.md](testing/TUNING_ROGUE.md) (the roguelike buffs, now cards: attack speed against the kiting guarantee, the cap, the power of a build; on the old sheet) and [testing/TUNING_BALANCE.md](testing/TUNING_BALANCE.md) (the balance pass: the TTK curve, the compressed sheet, the cards' measurements and how to re-run them).

## Architecture

```
 browser tab                                          Node process
+--------------------------------------+            +----------------------------------------+
| hub scene (client only)              |            |                                        |
| menu --- /api/profile, /leaderboard -+--- HTTP --->| Express: profiles, shop, leaderboard   |
| RaidScene: mouse + keys -> inputs ---+--- WS ----->| RaidRoom (thin adapter, two modes)     |
|   (Phaser 4 + DOM overlay)           |            |   handlers: validate, enqueue only     |
| SnapshotBuffer: draw at serverNow    |<-- 20 Hz --|   sim/step() every 50 ms (pure)        |
|   minus 100 ms; fx played in time    |   patches  |   events -> one fxs batch / toast /    |
| generateMap(seed, attempt) [worker]  |   + fxs    |     result messages                    |
+--------------------------------------+            |   ProfileStore -> stash.json           |
                                                    +----------------------------------------+
```

- **`packages/shared`**: TypeScript source used directly by both sides (no build step). Constants, wire messages, the Colyseus schema, and the pure logic both ends must agree on: the faction and weapon catalogs, the rules between weapons, the card catalog and its guards, signature numbers, the mob types, the Wish and status catalogs and the blink rule, `generateMap` (the zone map generator), A* pathfinding, ray casts, snapshot interpolation and the compact `fxs` codec.
- **`packages/server`**: `RaidRoom` (the Colyseus adapter), `sim/` (the game rules; `arena.ts` owns the run lifecycle, `step.ts` the tick order), `mapPool.ts` and `mapWorker.ts` (the map pool and its worker thread), `persistence/` (the profile store), `bots/`, `harness/` and `bench/`.
- **`packages/client`**: `net/` (connection, REST, clock sync, interpolation, the map worker), `scenes/` (the hub and the run), `hub/` (the hub's layout and art), `render/` (2.5D projection and views) and `ui/` (DOM overlay: menu, HUD, panels, results). [CLAUDE.md](CLAUDE.md) has the file-by-file layout.

How it fits together:

- **Authoritative server.** Clients send inputs only (`move`, `stop`, `target`, `aim`, `attack`, `release`, `swap`, `pickup`, `cast`, `choose` at a camp's chest, and `plan` during the planning step; a training room also takes `train`). The browser sends `target` for every fight and `cast` for a Wish, and never touches the trigger; `attack` and `release` are the low-level trigger that mobs and the weapon harness use. The bots click like the browser does. Positions, damage and outcomes are never accepted from a client.
- **Fixed 20 Hz tick and input queues.** Message handlers validate (finite numbers clamped to the world, short ids) and enqueue into a per-player queue. The latest move and aim win, orders replace each other in arrival order (a `move` or `stop` drops a lock, a `target` replaces what came before it), at most 6 actions are kept per tick, and a client sending more than 100 messages a second is disconnected. The sim drains the queues at the start of each 50 ms step in a per-tick shuffled order, so same-tick races are fair. A patch goes out after every step.
- **Pure sim.** `sim/` never imports Colyseus or touches sockets. Gameplay modules register actions and systems into a world. `step()` returns events and the room turns them into messages and profile changes, so most of the game is tested headless.
- **One damage ledger per tick.** Swings, arrows, balls and signature damage are recorded as hits and applied all at once. Results are settled once at the end of the tick. So the order players happen to be processed in never decides who wins.
- **The target lock is server-side.** `sim/targeting.ts` plays a locked player's weapon as mob AI plays a mob's: it paths into range, holds the trigger and aims each attack at the target, every tick after the inputs and before the weapons. The browser only says whom to lock. It is synced as `PlayerState.attackTarget` so every client can draw the ring.
- **Mobs are players who send inputs.** They go through the same combat code and input handlers as a player.
- **Schema sync.** State uses decorator-free `schema()` builders. Only the server imports the schema at runtime. The client imports types and decodes by reflection. Projectiles are not in the state. All the visual events of a step, and every arrow and ball that left during it, go out as one compact `fxs` message.
- **Planning deals are private.** The two spawns each player is dealt, their picks and which are taken travel only in that player's own `plan` message, never in the synced state. The deal and the camp rosters draw from a private server stream; rosters are then published in the state (the planning screen shows them), and a player's route stays in the browser.
- **The map is never synced.** State carries only how to build it: the `seed`, the `attempt` of the generator that certified, and a `mapHash`. The server, the bots and every client call `generateMap(seed, attempt)`, which is deterministic (seeded `mulberry32`, and integer-only maths in the generator and in `findPath`: `+ - * /`, `sqrt`, floor, ceil, round, abs, min, max, sign, imul and bit operations, with none of the 23 `Math` functions engines may round differently (`random`, trig, `exp`, `log`, `pow`, `hypot` and the like), which a test spies on through a generation, `mapHash` and `findPath`; other shared code, such as the weapon policies, quests and the planning display, still uses them where nothing has to agree across machines), and a client whose map hashes differently is told to reload and leaves. The generator certifies every map as it makes it (connectivity, equal zones, camp spacing, spawn starts at least 10 tiles apart unless a wall is between them with fair walks to the coliseum, every wall owned by a named feature of its zone) and never relaxes a check. There is no sight cap: how far you see is each zone's shape ([docs/ZONE_SHAPES_AS_BUILT.md](docs/ZONE_SHAPES_AS_BUILT.md)). Loot is rolled server-side from a private RNG, so the seed reveals the layout but not the contents.
- **Maps are made ahead.** A worker thread on the server keeps `MAP_POOL` (8) certified maps ready and an arena room takes one when its first player joins (a training room copies a recent one, so practice never drains the pool); an empty pool makes one on the spot. The client builds the map in a Web Worker while the loading screen shows, and warms it up in the hub.
- **Render in the past, except you.** Every other entity is drawn at `serverNow - 100 ms` (`INTERP_DELAY_MS`) by interpolating buffered snapshots against an estimated server clock. The local player is predicted (`net/localMotion.ts`): an order walks a model at once along the path the server will walk, and each patch pulls it back in line. Nothing it computes is ever sent.
- **Lag compensation.** An attack made with the low-level trigger carries the server time the client was rendering. The server keeps about 300 ms of position history (`MAX_REWIND_MS`) and samples swing attackers and targets at that time. A locked attack (everything the browser does) has no timestamp: it is timed in the present, one tick back, and aimed at its target as it lands. Arrows and balls fly in present server time.
- **Training is a mode of the same room.** The server registers `raid` (arena) and `training` (a private room of one) and forces the mode, so a client cannot pick it. The practice console's `train` message is dropped at the door unless the room is a training room.
- **Camp chests are the server's.** A cleared camp's chest, its options (rolled from the private reward stream) and every pick live in the sim; the panel only sends `choose { chest, pick }`. Picks resolve in the tick's secret order, so a same-tick race is fair. The options are in the synced state (the chest is contested), which makes them readable from anywhere by a modified client.
- **Persistence.** Profiles (GV balance, lifetime GV, GV per UTC month, stats, cosmetics, achievements) live in memory and are saved to one JSON file (version 2). A version 1 file from the extraction build is migrated on start: stashes are dropped, stats and tokens kept, and the original is saved first as `stash.json.bak-v1`. Mutations are synchronous. Writes are coalesced and atomic (temp file, fsync, rename, directory fsync), retried with backoff on failure, and flushed on graceful shutdown. A malformed profile entry is dropped and the original kept as `stash.json.bak-<time>`. A file that cannot be parsed at all stops the server from starting and is moved to `stash.json.corrupt-<time>` instead of being overwritten. To reset, stop the server and delete it.

When GV banks:

| Event | Effect |
| --- | --- |
| Your run resolves (won, draw, died, left) | Its GV (kills, mobs, bounty, quests, win bonus) and stats are saved at once. |
| Leave or disconnect in the lobby | Nothing to save. |
| Training | Nothing is ever recorded. |
| Graceful server shutdown mid-run | The run is void and not recorded. GV earned so far is paid. |
| Hard kill of the server mid-run | GV earned in that run is lost (see below). |

HTTP, all under `/api`. `x-profile-token` carries a profile's token.

| Request | What it does |
| --- | --- |
| `GET /api/health` | `{ ok: true }`. |
| `GET /api/profile/:name` | Claims a free name (no token header) or returns the profile when the token matches. While hosting, a free name needs the `x-playtest-passcode` header when a passcode is set (401 without it) and answers 429 past the new-profile caps. |
| `POST /api/profile/:name/purchase` | Body `{ id }`: buys a cosmetic at its catalog price. Needs the token. |
| `POST /api/profile/:name/equip` | Body `{ slot, id }`: equips an owned cosmetic (`id: null` empties the slot). Needs the token. |
| `GET /api/leaderboard?month=YYYY-MM&limit=N&name=callsign` | Public: names, equipped titles and GV banked that UTC month (`limit` defaults to 20, at most 100). `you` (the named profile's place) comes only with that profile's token. |

## Known limitations

Netcode and scale:

- **No interest management.** Every client receives every player's position and weapons, every public container's contents (a camp chest's cards and who took them included), every public mob and every projectile. A modified client can see all of it, and there is no fog of war. Unrevealed quests are the deliberate exception: their defs, givers and items stay server-side until private reveal and then publication.
- **Swarm hides a fighter only from an honest client.** The browser does not draw a swarmed fighter and cannot click it, and the server refuses every lock and ability aimed at it. But every client still receives every position, and the server still accepts the low-level `attack` input, so a modified client can find a swarmed player and attack its true position. The fix is interest management plus refusing `attack` from game clients.
- **Mixed timelines on screen.** Other fighters' positions and effects are drawn 100 ms in the past (yours is predicted). Health bars, status, containers and the timers show the latest patch, so they can lead what you see by a tick or two. Deaths are the exception: a victim stays drawn until their death is due.
- **Prediction is partial.** Your own character is predicted for its walk, its Blaze Step, and the roots and haste it is told of; anything else the server does to it arrives as a correction (a smooth slide, or a snap past 96 units). Other fighters are still drawn 100 ms in the past, so a swing at a moving target can look to miss by about a delay's walk.
- **Single process only.** The "profile already in a raid" guard and the profile file are process-local.
- **Maps cost memory, and a burst can outrun the pool.** The server's map worker adds about 130 MB (measured when the generator still carried 44 MB of lane tables per process; they are gone and it has not been re-measured), and a map is about 110 KB by structured clone. More than 8 rooms starting inside a third of a second empty the pool, and the next room generates its own map on the main thread (about 33 ms, 64 at p99, 80 at worst; logged). The client was measured in Chrome at normal speed only, not with a throttled CPU.
- **Lag compensation trusts the client's timestamp** anywhere inside the 300 ms rewind window, so a cheating client can pick the most favourable moment. It only matters for the low-level `attack` and `release` messages: the browser's locked attacks carry no timestamp. The window only covers clients up to about 150 ms RTT. Beyond that, swings at moving targets miss.

Identity and persistence:

- **Profiles are weakly authenticated.** The only credential is a random token in the browser's `localStorage`. There are no passwords, recovery, expiry or rotation. Tokens are stored in plain text in the profile file and travel unencrypted unless you put TLS in front. Clearing site data forfeits the profile, and anyone who copies the token owns its GV.
- **Few rate limits.** In dev (`npm run dev`) matchmaking, the shop endpoints, room creation and new profiles have no limit beyond one active run per profile, and `/api` answers every origin. Hosting turns on the guards in [Hosting a playtest](#hosting-a-playtest) (room and new-profile caps, a shop limit, same-origin only). In-match orders have a per-player budget everywhere. Move spam still costs a path search per order, up to that budget.
- **A hard kill loses the GV of runs in progress.** SIGKILL, power loss or OOM mid-run loses it. The whole JSON file is rewritten on every change, and there is no TLS, structured logging or metrics. This is a dev setup, not a deployment.
- **GV can still be farmed with spare callsigns.** The win bonus needs 3+ players and damage on 2+ opponents, which stops the cheapest trick. But throwaway callsigns that get killed still pay out kills and the bonus.

Gameplay and content:

- **Placeholder art and balance.** Colored shapes, no audio, numbers that are first picks. The weapon and faction numbers are tuned in `testing/` and the harnesses. The mob, card and PvP-factor numbers are tuned only against scripted players, and the win rates in the balance benches assume a play-noise model of two equal players, not people.
- **The Wishes are first picks too.** Every Wish number, the trail's burn, the 5 s training cooldown and the caps on the status kinds are best guesses, and none of them was run through the weapon harness or the kiting check, which never cast (see [testing/WISHES.md](testing/WISHES.md)). Blaze Step and Last Stand have no warning before the cast, which is an owner question ([docs/GAME_DESIGN.md](docs/GAME_DESIGN.md) section 18).
- **Wand > Shield fails in the weapon harness's policy matrix (in under a quarter of its duels).** The harness wand backs away from a charging shield, and with no ranged slows that no longer works. It holds at 100% when both fighters click each other, which is how the controls are played; nothing was changed for it. Numbers and reasons in [testing/TUNING_CONTROLS.md](testing/TUNING_CONTROLS.md).
- **The controls are a first pick too.** Click snap 64 units, an empty normal click does nothing (A then left-click issues attack-move), a windup your lock started is cancelled by your next order (a mob's stays committed), a lock lasts out to 640 units and 1.5 s without line of sight once the target was seen (a target locked behind a wall is chased until it is). The list of these guesses is in [CLAUDE.md](CLAUDE.md).
- **Cards and the camp chests are first picks.** The card numbers (provisional beyond the tier-I stat sizes, and for the augments) and the PvP factor are the balance pass's, measured in the real sim against scripted players under a noise model, never against people (`testing/TUNING_BALANCE.md`). The Fleet cards are off while you shoot and for 2.5 s after, and Quickdraw shortens melee windups only, so neither touches the ranged windups that make kiting a trade (`testing/TUNING_ROGUE.md` section 7, measured on the old faction sheet). Second Skin's barrier is wired (unit-tested, not measured in a duel), and the kiting check has one named exception (Holy against Fire's wand). The chest panel's grey-out uses the prediction's delay, not a measured ping. Mob strength was measured with one scripted player per fight on fists, never with humans. Details in [CLAUDE.md](CLAUDE.md) and [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md) sections 11 and 18.
- **Quest balance is provisional.** The worksheet in [docs/quests.md](docs/quests.md) uses stated travel and fight-time assumptions. questBench is a small-sample, report-only real-sim harness (its first R2 run has effectively 1-3 completions per quest; use `--seeds 6` or more), not final balance evidence. Quest rewards are cards now (a tier by the quest's time) and were not measured against play; the owner tunes them. [docs/quests.md](docs/quests.md) has the measured placement cost, the quests-on and quests-off step and bandwidth numbers, and a browser-check placeholder that is still pending. Current bots farm and fight but do not choose quests.
- **Not built:** the rest of the roguelike plan (the zones' terrain is on and the maps are themed; active skills on Q and E, relics and curses, "?" camps, start boons, the generator's 8-camp zones; see [docs/ROGUELIKE_PLAN.md](docs/ROGUELIKE_PLAN.md)), raid bosses, secrets, friends, private matches, chat, the 30-second warning and host voice line before the teleport, and the minimap pings for bountied players (the crown is built). They are in [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md) sections 2.2, 6, 12.4 and 15.
- **No teams, parties or queues.** Every join lands in the first open lobby. Reloading the page mid-run drops the connection and cannot resume it (the client reconnects only within the same page session), so the seat times out after 10 s and the player is MIA. Static weapon crates and loose weapons do not respawn; each cleared camp can drop another reward chest after its next respawn cycle.

Client and tooling:

- **Desktop only.** Mouse and keyboard, no touch or gamepad, no rebinding.
- The client has unit tests but no browser tests.
- The server's private RNG (loot, spawn assignment) is `Math.random`, which is not cryptographically secure.

Combat port source: [verified live version and branch](docs/COMBAT_UPGRADE_BASE.md).
