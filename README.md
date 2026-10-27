# RougeHalla

A top-down 2.5D roguelike battle arena. Up to 8 players pick one of five factions and drop into a generated map with only their faction's signature weapon. They loot chests, farm neutral mobs for buffs, clear camps for a shared chest of passive skills and fight until one is left standing. Two counter loops decide every fight: faction against faction, and weapon against weapon. If nobody dies for a while, everyone still standing is teleported into the coliseum at the centre and locked in until somebody does. The last one standing wins **Glorious Victory** (GV), a currency that only buys cosmetics. Weapons and buffs never outlive a run. GV, stats, cosmetics, titles and achievements persist per callsign.

The first playable in [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md) is built: a walkable hub, the faction pick, five weapons, five faction signatures, a generated 96 x 96 map of five zones, a planning step before each run, regional mobs in mono-type camps (one hit wakes the whole camp), per-mob-type buffs, a shared skill chest for every cleared camp with nine passives to pick from, bounties, the patience timer and coliseum, GV, a shop, achievements, a monthly leaderboard and a training room. That document has the rules, the numbers and the reasons for them. This one covers running, playing and testing the code. Engineering rules and open issues are in [CLAUDE.md](CLAUDE.md).

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

### Callsigns and two tabs

Open two tabs and give each a callsign:

```
http://localhost:5173/?profile=alice
http://localhost:5173/?profile=bob
```

A callsign (2 to 16 letters, digits, `_` or `-`) is a profile. The first load of an unused name claims it. The server hands back a token. The client keeps it in `localStorage` as `raid.token.<callsign>` and proves ownership with it on every later load. Without `?profile=` a tab starts with a random `op-xxxx` name. Edit it and press Load to claim one. Once a callsign has loaded, the tab remembers it for reloads in `sessionStorage`.

Tabs in the same browser share `localStorage`, so two tabs can load the same callsign. But a profile can be in only one run at a time ("profile already in a raid"). A second browser, a private window, or cleared site data does not have the token, and the menu will say the callsign is taken. There is no in-game recovery for that.

### Playing alone

Bots are headless players. They use the same HTTP API and play with the same controls as the browser: they walk (`move`), click their foe (`target`) and let the server chase, attack and aim, and they swap and pick up weapons. They cast their faction's Wish (`cast`) when it is ready and the moment suits it (in trouble, or an enemy in range). They never send `aim`, `attack` or `release`. They farm mobs while no player is close and hunt the nearest player otherwise, and they join the same lobby as everyone else. Press Start Run in your tab first, then start some:

```bash
npm run bots -- 3
```

They arrive in your lobby and the run starts after the fill window. If the bots go first, two of them reach `MIN_PLAYERS` and start a run `FILL_SECONDS` later without you. Raise `LOBBY_SECONDS` or `FILL_SECONDS` for more time to join. For a quiet sandbox, start the server with `MIN_PLAYERS=1 FILL_SECONDS=1 npm run dev` (add `PLAN_SECONDS=0` to skip the 12-second planning screen). You get a solo run (it has no winner) with mobs, so you can test fighting and buffs. The [training room](#training) is better for trying weapons.

### The hub

You start in a small walkable room. It is drawn on the client only: there is no server room while you are in it. Walk with right-click or `WASD` / arrow keys. Stand at a station and press `E` (or click it) to use it.

| Station | Where | What it does |
| --- | --- | --- |
| The Arena (stairs) | North wall | Join a run (matchmade lobby). |
| Training Grounds (door) | East wall | Start a private practice room. |
| Five pedestals | South | Pick a faction. |
| Shop, Wardrobe, Achievements, Leaderboard (kiosks) | West wall | Open that panel. |
| Counter wheel | Centre of the floor | Both counter loops, with your pick highlighted. |

Your avatar wears your equipped cosmetics, your faction's colour and its signature weapon. The menu docked on the left offers the same things: callsign, GV and stats, a card per faction, Start Run, Training, and the panels (shop, wardrobe, titles, achievements, leaderboard, counters).

**Pick a faction before each run.** The pick is remembered on this device. A player who has never picked gets a round-robin default from the server, and that run counts for no faction title.

### Factions and weapons

Each faction beats exactly two others and loses to exactly two. Each weapon does too. In the code the last faction's id is `holy`; players see Demon Blood.

| Faction | HP | Starts with | Signature | Beats |
| --- | --- | --- | --- | --- |
| Fire | 500 | Axe | Dragonslayer: burns its target and hits back on every swing the target makes. | Sentenced, Plague |
| Sentenced | 700 | Bow | Marked: bonus damage that ramps up over a fight. A weapon swap by the target resets it. | Plague, Frost |
| Plague | 1000 | Bow | Rat King: steady disease damage, and an execute once the target is under half hp. | Frost, Demon Blood |
| Frost | 1750 | Shield | Living Wall of Ice: everyone engaged with it attacks slower, and moves slower up close. | Demon Blood, Fire |
| Demon Blood | 1450 | Wand | Radiant: heals from the damage it deals, more the lower its own hp. | Fire, Sentenced |

| Weapon | Shape | Beats |
| --- | --- | --- |
| Sword | 90 degree swing, reach 64. A hit that is not blocked staggers. | Axe, Wand |
| Bow | Arrow, 900 u/s, range 240. A fixed full draw (rooted), then it looses at full damage: there are no partial draws. | Sword, Axe |
| Wand | Ball, 380 u/s, range 220. A short cast (rooted) before the ball leaves. Pierces shields and deletes enemy arrows. | Bow, Shield |
| Shield | Raised toward the cursor, or toward your locked target (60 degrees either side); bashes its target, reach 44. Blocks and reflects arrows, negates sword hits. | Sword, Bow |
| Axe | 180 degree swing, reach 60. Pierces shields and destroys balls. Roots you for longer than its swing takes. | Wand, Shield |

Units are world units: a tile is 32. Every attack is a windup: it roots you from its start until the swing lands or the arrow or ball leaves, and then you walk freely until the next one. The windup is its design time or a share of the weapon's interval, whichever is shorter, so faster attackers wind up faster: sword and bash 0.1 s, axe 0.25 s (at most 25% of the interval; it stays rooted for 0.5 s from its start, at most 50%), wand up to 0.4 s (at most 80% of the interval), bow up to 0.6 s (at most 92%). A shooter can walk between its shots but never during one, and that, rather than a move slow, is what limits kiting (see [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md) 9.5). You carry two weapons, and swapping shares one attack cooldown. In 8 of the 10 faction matchups the winner's starting weapon loses the weapon edge, so the pick alone rarely decides a fight. The second weapon you go and get does. Full rules, timings and the reasons are in [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md) sections 8 to 10.

#### Wishes

Each faction has one **Wish**, an ability on `D` for the moment the weapons do not cover. It is locked for the first 45 s of a run and then has a 300 s cooldown that nothing shortens, so a run sees it once, maybe twice. The server refuses a cast it cannot take (cooling down, stunned or silenced, no valid target) at no cost. Once a cast begins its cooldown is spent, even if it then fizzles or is interrupted (only a stun or a silence interrupts one). Every fighter's name carries a small icon of its Wish, grey while it is locked or cooling down, and your own slot sits at the right end of the weapon bar. In the training room a Wish is ready at once and cools down in 5 s.

| Faction | Wish | What it does | What beats it |
| --- | --- | --- | --- |
| Frost | Freeze | After a 0.25 s cast, stuns the enemy nearest your cursor for 1.25 s (range 450 u, line of sight). A stun cancels a windup, the bow's draw included. | Break line of sight or leave range during the cast. It is not a projectile, so nothing else dodges it. |
| Plague | Swarm | After a 0.25 s cast you cannot be targeted for 8 s: nobody can lock you or aim an ability at you, and mobs lose you. Attacking or casting shows you from its start until half a second after it lands. A cloud on the ground marks where you are. | Arrows, balls and swings already on the way still hit. A hiding Plague that attacks is revealed, so it escapes rather than fights. |
| Sentenced | Trial | After a 0.35 s cast, puts a ring of radius 300 u on an enemy within 400 u for 5 s. Inside it the enemy deals 20% less and takes 20% more from you. Walking out of the ring stuns it for 1 s. | Break line of sight or leave range during the cast, then stay and fight inside the ring, or accept the stun. |
| Fire | Blaze Step | Blink up to 300 u toward your cursor, through walls, with no cast time. It leaves a burning trail for 2.5 s: 30 true damage a second to anyone else on it, lingering 2 s. | Don't stand on the trail. It cannot cross the locked coliseum gates or land in a sealed pocket. It has no warning before the cast. |
| Demon Blood | Last Stand | For 5 s you cannot fall below 1 hp and you walk 30% faster. At the end, 30% of the damage you took is healed back. It has no warning before the cast. | It is a loan, not a refill: a Holy that lives through it comes out with 30% of the damage back, so don't spend burst on it, wait for it to end. |

Freeze and Trial pick the enemy nearest the cursor, within 64 u like a left-click. Blaze Step goes toward the cursor. Swarm and Last Stand need no aim. The full rules, the numbers and what is a best guess are in [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md) sections 8.8 and 8.9.

### Controls

Right-click to move, left-click an enemy to fight it. There is no attack button to hold: the server plays the fight once you have picked an enemy.

| Input | In a run |
| --- | --- |
| Right-click (hold) | Walk to that point. The server pathfinds around walls. Holding re-sends the target every 100 ms. An unreachable point gives no walk, but the order still drops your attack target. |
| Left-click on or near an enemy | Lock the nearest enemy (a player or a mob) within 64 units of the cursor. The server walks you into range and attacks it whenever the cooldown allows, until you give another order, it dies, it leaves 640 units, or it stays out of line of sight for 1.5 s once you have seen it. An enemy behind a wall can be locked: you walk around to it, and nothing is attacked without a clear line. A click on empty ground does nothing. The locked enemy gets a red ring, and the one a click would lock gets a thin light ring. |
| Mouse position | Aim for the shield: it faces the cursor while nothing is locked, and the locked enemy otherwise. |
| `Q` | Swap to the other weapon slot. |
| `1` / `2` | Switch to that slot. |
| `F` | Take the highlighted weapon (chest, weapon on the ground or body) within 56 units and in line of sight. With both slots full, the weapon in hand drops. A camp's skill chest is not taken with `F`. |
| `C` | Focus the camp chest panel while one is open (see [Camp chests](#camp-chests-and-passives)). Then `1` / `2` / `3` take a card, `0` skips, and `C` or `Esc` give the keys back to the game. |
| `D` | Cast your faction's Wish (300 s cooldown, locked for the first 45 s of a run). Freeze and Trial snap to the enemy nearest the cursor, Blaze Step goes toward it. See [Wishes](#wishes). |
| `S` | Stop walking and drop the attack target. |
| Hold `Tab` | Show the whole map and your planned route until you let go (not while a text field, the settings or the help card has focus). |
| `Esc` | Leave a training room. (With the chest panel or the training console focused, the first `Esc` only hands the keyboard back.) |

During the planning step before a run (see below) nobody moves, and the screen has its own controls: `1` / `2` or a click pick the first or second dealt spawn, a click on the map adds a route stop (a click on a stop takes it out, up to 12), the arrow keys move between the map's markers, `Enter` on a camp adds a stop, `Delete` on a stop removes it, and the Ready button locks your pick. Settings add "Show route" and a map text size (100%, 125%, 150%).

Orders replace each other, in the order they arrive: a right-click or `S` drops the lock, and a left-click on an enemy replaces any earlier order. A walk, a stop or a click on another enemy while your locked attack is winding up cancels that attack, as in League of Legends: no swing, ball or arrow, the cooldown is refunded, and the walk starts at once (a swing that has landed is not undone). A windup that is not your own click, a mob's, stays committed: a walk ordered during it starts when it ends. Swapping weapons or picking one up keeps the lock (an attack still winding up is cancelled, and the lock starts the next one with the new weapon). A locked attack is aimed at its target again when it lands or leaves, but arrows and balls then fly straight and can be dodged. An attack made without a lock (a mob's) goes where it was aimed: a swing or a ball at the start, an arrow when its draw ends.

In the hub: right-click or `WASD` / arrows to walk, `E` or a click at a station. Shortcuts are ignored while a text field has focus. Clicks that begin on a menu or panel never reach the world.

### A run

1. **Lobby.** The timer starts when the first player joins and lasts `LOBBY_SECONDS` (30). Once `MIN_PLAYERS` (2) are in, the remaining wait is cut to at most `FILL_SECONDS` (5). Eight players start it at once. If the timer runs out with fewer than `MIN_PLAYERS`, the run starts with whoever is there. A solo run has no winner and no win bonus. Nobody can act in the lobby, but it shows the map small and read-only: the zones, every camp's mob type and the factions in the room.
2. **Planning.** For `PLAN_SECONDS` (12) the room is locked and nobody moves, fights or is hurt. You are dealt two spawns about the same walk from the coliseum and in different zones, and pick one: the first to pick a spawn holds it, and a spawn someone else took shows as taken at once. The screen shows each camp's mob type, the buff it gives, your faction's matchup against it and the buffs that counter the factions present, and you can draw a route (kept in this tab, never sent, shown faintly on the minimap during the run). Ready locks your pick, and the run starts early once everyone connected is ready. With no pick you get your first free spawn. A server started with `PLAN_SECONDS=0` skips this step.
3. **Early run.** Everyone starts at the spawn they picked, with their signature weapon and nothing else. The starts of a map all lie about the same walk from the coliseum, spread over the zones. A map has about 17 chests (one weapon each, every type equally likely) and some weapons loose on the ground. Take what you need, farm mobs, and pick fights you can win.
4. **Mobs.** The map is 96 x 96 tiles with five zones of equal area around the coliseum, one per faction, tinted in its colour; their shapes and places change with every seed, and they meet with no walls between them (a dashed line in each zone's colour marks a border). A mob carries its zone's weapon (Fire: axe, Sentenced: sword, Plague: bow, Frost: shield, Demon Blood: wand) and fights as its zone's faction at 22% strength. Each zone has one elite, at 65%. So the map is a shopping list for counters.
   - A zone has four camps, 20 on a map, each with 3 to 5 mobs. Camps are mono-type: every normal mob of a camp is one of its zone's three types (one type repeats in the fourth camp), and the zone's elite stands in its elite camp. Each type gives its own buff when it dies (next item).
   - Mobs are neutral until hit, and a hit on one wakes its whole camp onto you; a mob that is already walking home stays out of it. A woken mob chases and fights with spacing that suits its weapon. It gives up when it leaves its camp's territory (the part of the zone nearer to that camp than to the zone's other camps), or gets 12 tiles from its camp spot, or 6 s after it last dealt damage. Then it walks home untouchable and heals.
   - A map has about 80 mobs. They do not respawn, and they never hurt each other. A camp whose mobs are all dead is cleared for good, crossed out on the minimap and the Tab map, and drops a shared chest (below).
   - A kill pays GV (2, an elite 10, scaled by the reward curve below, at most 30 a run from mobs) and stacks of the mob type's buff. The mob's weapon lands on the ground, unless you already hold that type. The kill goes to whoever did it the most damage.
5. **Buffs and the feed.** Your feed is your player kills plus a quarter of your mob kills. Each of the 20 mob types gives its own buff (Ember Imp: damage, Ice Golem: max hp, Rime Stalker: armor, Acolyte: lifesteal, and so on: the table is in [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md) section 12.2). A kill adds 1.1 stacks (an elite 3.1) of that type's buff, times the mob reward curve. The numbers quoted for a buff are its value at 3 stacks, and its bonus follows an S-curve from there: small at first, a spike from the 3rd to the 5th stack, then a plateau at about twice the quoted value, so a buff's quoted value is mostly between +4% and +30% (Ember Imp: +10% damage). Mob rewards fall as your feed rises, and a player far behind the lobby median gets a catch-up bonus. Buffs and the feed reset every run. The HUD shows a build strip under your hp (a chip per buff, with its stacks and what they give, and a tooltip) and a feed line. The effects of four mob types (Chain Warden, Bloatfly, Rot Monk, Frost Wisp) and two more (Inquisitor, Glacial Warden) put statuses on the fighters they hit, and that part is not built yet (R4b; the status system itself came with the Wishes): their chips are marked "(coming)".
6. **Bounty.** Past 2 player kills, a bounty sits on you: `10 x (kills - 2)^1.5` GV (10 at three kills, 28 at four, 52 at five). Mob kills never raise it. Everyone is told "<name> is on a rampage" when it rises, and a crown marks you. Whoever kills you is paid the bounty on top of the kill, plus half the stacks of each of your buffs. Leaving within 5 s of being hit counts as a kill for whoever hit you, so quitting does not dodge a bounty. A mob that finishes a player a rival hit within 5 s credits the rival.
7. **Patience timer.** If no player dies for a while, everyone still standing is teleported into the coliseum and its four gates close. The first wait of a run is a flat 5:00 whatever the player count, counted from the end of planning (`FIRST_PATIENCE_SECONDS`). Every wait after a death is 5:00 with 8 standing and shrinks linearly to 2:00 at 3 or fewer (`PATIENCE_SECONDS`, `PATIENCE_MIN_SECONDS`). Every death, a leave included, restarts the timer and opens the gates. Mobs do not count. You are immune for 1.5 s after the teleport, arrows and balls in flight are removed, and every living mob goes back to its camp at full health.
8. **Sudden death.** Locked in for `SUDDEN_DEATH_SECONDS` (60) with no death, everyone standing loses 2% of max hp per second, and 2% more for every further second, until somebody dies. A death opens the gates.
9. **Outcome.** The last one standing wins. If the last players go down in the same tick, the one with the higher hp fraction at the start of that tick wins. An exact tie is a draw. Leaving mid-run counts as a death (missing in action), and so does leaving during the planning step: planning is part of the run, so a leave there is a loss in your stats with no GV (a server restart during planning voids the run instead). A dropped connection keeps your seat for 10 s first (in the run you stay in the fight, and hittable). In the lobby, leaving costs nothing.
10. **Results.** A kill pays 10 GV. Winning pays 50 more, but only if the run started with 3 or more players and you damaged at least 2 different opponents. Otherwise you still win, without the bonus. GV earned is kept when you die. It banks the moment your run resolves. The results screen shows the outcome, your place, time, kills, who killed you, the GV rows and any achievements unlocked. A dead player sees "YOU DIED" for 1.5 s first, while the run goes on for everyone else. Back to hub reloads the profile.

The HUD shows players standing, your run GV and bounty, the arena timer (coliseum, locked gates, sudden death), a minimap (zones, camps with the cleared ones crossed out, camp chests with a countdown, closed gates, living mobs, your planned route), the build strip, your passives and the feed line under your hp, a weapon bar with the shared cooldown, a red flash when you take a real hit, and a green or red screen tint when the nearest enemy in sight is countered by you or counters you.

#### Camp chests and passives

When the last mob of a camp dies, one **skill chest** appears on the camp's chest tile for **15 seconds**, whoever got the kill. It offers three passives, the same three to everyone. Each player picks **once** (a skip counts as the pick), and each option goes to the first player who takes it, so what you get depends on who is standing there. A panel opens on the right edge when you are within 88 units of a live chest with a clear line (and stays open out to 92); it shows a countdown, the three cards (the skill, the rank the pick gives you, what it does) and who took what, and it never takes a click meant for the world. Press `C` to focus it, then `1` / `2` / `3` to take a card or `0` to skip, or click. The server checks everything from your position: a pick fails with a short message ("Too far away", "Already taken", "Can't do that now" while stunned or casting, ...). Picking a passive you hold at rank 1 makes it rank 2.

A skip heals 15% of your max hp (not within 3 s of a fight, and not at full hp) and otherwise pays 3 GV. Nine passives are built (Whetstone, Swift Boots, Quickdraw, Thick Hide, Bounty Hunter, Second Wind, and one each for Sentenced, Plague and Demon Blood: Witness, Pestilence, Last Rites); the other twelve are catalog text for later phases. The ones you hold show as a row under the buff strip. The full rules and numbers are in [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md) section 12.5.

### Training

The Training Grounds door starts a private room of one, created fresh each time, with your picked faction. Next to your spawn are a plain dummy, a shield dummy (reflects arrows, ripostes swords) and a rack with one of each weapon. Nothing is recorded: no GV, no stats, no achievements, no timer, no results, no mobs of its own. If you go down you are stood back up. Leave with the button or `Esc`. A room whose player sends no input the server accepts for 5 minutes is closed. A message the server rejects does not count as input.

**The practice console.** A **Console** button in the training bar opens a small panel (training rooms only; an arena room refuses every `train` message). It sets any mob type's buff to 1, 3, 6 or 12 stacks or takes it off, sets any passive to rank 1 or 2 or takes it off (a passive that is not built yet is set but does nothing, and the toast says so), spawns a practice camp (three mobs of a type, one for an elite type, asleep near you, so hitting one wakes the rest), drops a skill chest two tiles away with three skills of your choice (or three random ones for your faction), and clears all of it (buffs, passives, practice mobs, chests; the dummies and the rack stay). Practice mobs pay nothing and drop no chest. Caps: 12 practice mobs at once, 6 chests, a short pause between camps and between chests. The console takes no game key; `Esc` inside it hands the keyboard back, and the next `Esc` leaves training.

### GV, the shop and progress

GV buys cosmetics only: body colours, outlines, trails, titles, and golden looks for each faction and weapon. Nothing changes combat. Spending lowers your balance but never your lifetime total or your monthly total. The monthly total is what the leaderboard ranks (UTC months, any past month, your own place even outside the top 20). Achievements (kills, wins, a win with each faction, golden-look goals) are computed on the server from banked runs. They unlock once and grant titles and cosmetics. Win goals count only wins that earn the win bonus. Equipped cosmetics are read when you join a run, so a change in the wardrobe applies from the next run. See [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md) section 13.

## Commands

All from the repo root.

| Command | What it does |
| --- | --- |
| `npm run dev` | Server (`tsx watch`, :2567) and client (Vite, :5173) together. Ctrl+C stops both. |
| `npm test` | Vitest in the client, server and shared workspaces. The server suite includes end-to-end runs over real sockets. |
| `npm run typecheck` | `tsc --noEmit` in every workspace. |
| `npm run build` | Production build of the client into `packages/client/dist`. Vite does not type-check, so run `typecheck` too. |
| `npm run bots -- 3` | Start 3 headless bots against the running dev server. Flags need a second `--` (below). |
| `npm run harness -w @raid/server` | Weapon duel harness (see [Testing](#testing)). The root has no `harness` script. |
| `npm run harness:factions -- --python` | Faction cycle harness (see [Testing](#testing)). |
| `npm run start -w @raid/server` | Run the server once without file watching. |
| `npm run preview -w @raid/client` | Serve the output of `npm run build` locally. |

The end-to-end tests start their own server on a free port with a temporary profile file. They are safe to run while `npm run dev` is up and never touch your real profiles. `tsx watch` restarts the server when server or shared source changes. A restart is a graceful shutdown: the run is void (not recorded), but players still in it are paid the GV they had earned.

**Bot flags.** The root `bots` script nests npm, which swallows flags unless you add a second `--`:

```bash
npm run bots -- -- 3 --url http://host:2567 --faction random --loop
npm run bots -w @raid/server -- 3 --verbose        # the same, without the nesting
```

`--url` (default `http://localhost:2567`), `--prefix` (profile names are `<prefix>1..N`, default `bot`), `--faction <id|rotate|random>` (default `rotate`: five bots make a lobby with one of each; ids are `fire`, `sentenced`, `plague`, `frost`, `holy`), `--loop` (queue again after each run), `--verbose`. The count is 1 to 64. Bot tokens are kept in `packages/server/data/bot-tokens.json` so the same names can be reused.

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
| `MAP_POOL` | `8` | Certified maps the server keeps ready, made by a worker thread (about 130 MB more memory for the worker, its tables and tsx). `0` runs no worker: every room generates its own map on the main thread, about 35 ms and logged. An empty pool does the same for one room. |
| `COLYSEUS_LATENCY` | `0` | Artificial latency in milliseconds, for netcode testing. |

### Client environment variable

`VITE_SERVER_URL` points the client at a server. Unset, the client opens a WebSocket to `<page hostname>:2567` and calls `/api` on its own origin, which Vite proxies to `localhost:2567`. Set, the WebSocket and the REST base both derive from it (`ws` becomes `http`, `wss` becomes `https`) and `/api` is a cross-origin request. The proxy target and the default port are fixed at 2567, so changing `RAID_PORT` also needs this, for example `RAID_PORT=3000 VITE_SERVER_URL=http://localhost:3000 npm run dev`. Vite inlines it at build time, so set it when running `npm run build` too.

## Testing

```bash
npm test                    # client, server and shared; about a minute, about 4,000 tests
npm run typecheck
npm test -w @raid/server    # one workspace
```

What the suites cover:

- **Shared** (`packages/shared/test`): the pure rules. The faction law and the weapon formula are checked against numbers printed by the Python model, so the two cannot drift apart. The map generator is certified here too (below).
- **Server** (`packages/server/test`): the sim headless (ledger, weapons, signatures, mobs, buffs, feed, arena, training), the room and HTTP API, shutdown, the profile store and shop, the fx wire format, and `e2e.test.ts`. In `e2e.test.ts` four bots play whole runs against a real server, and the GV ledger, stats and file must balance. It replays a run once if the bots showed no kill, signature hit, mob kill or landed Wish, and fails if the replay lacks it too.
- **Gates**: `perf.test.ts` (with 8 players and the map's ~80 mobs, `step()` averages under 5 ms with a p99 under 15 ms, also in the pathfinder's worst case and with every buff at 4 stacks on all 8 players), `bandwidth.test.ts` (under 20 KB/s per client) and `packages/shared/test/mapgen.perf.test.ts` (a certified map costs 45 ms or less, scaled by a yardstick measured on one machine). The generator has its own certification: 200 seeds in 8 parallel shards, checked by an independent certifier and pinned byte for byte.
- **Client** (`packages/client/test`): the views and the DOM overlay against fakes for Phaser and the DOM. There are no browser tests, so look at the real thing after a rendering change.

**Soak.** For a long run, start the server and leave `npm run bots -- -- 6 --loop` going. The Phase 13 soak ran 6 looping bots for 43 hours: about 15,600 run results, no server errors, every run over within 190 s, and the server's RSS flat at about 330 MB after a 30-minute warm-up.

### Harnesses and benchmarks

These report. They never fail the build, and they are what to run before touching a weapon or faction number.

| Command | What it does |
| --- | --- |
| `npm run harness -w @raid/server` | Weapon duels in the real sim between two policy-driven clients: the weapon matrix, a style grid for every edge with a ranged weapon, an edge verdict (holds, or fails and why), the same edges when both fighters click each other (the target lock), and kiting (a shooter that stands, strafes, kites, orb-walks or locks its chaser). About 55 s. `-- --core` skips the sensitivity passes (about 40 s), `-- --quick` takes a few seconds, `-- --help` lists the filters. `-- --kiting-only` runs only the kiting sections and the faction edges against a kiting shooter; `--shooter-buff plagueRat:3,emberImp:3` gives the shooters of those duels buffs (`id:stacks`, the chaser has none) and `--shooter-as 1.2` an attack-speed multiplier on top. |
| `npm run harness:factions -- --python` | Every faction edge with the same weapon on both sides, and the signature openings, in the real sim. Checked pair by pair against `testing/realtime.py` (about 5 s). `-- --mode policy` plays them as moving fighters (about 20 s), `-- --mode full` with real arcs and flight (about 7 s). |
| `npx tsx packages/server/bench/stepBench.ts [--buffs] [--stress]` | Cost of one `step()` with 8 players and the map's ~80 mobs. `--buffs` gives all 8 players 4 stacks of every buff. `--stress` wakes every camp every second and has the players re-lock constantly (the pathfinder's worst case). Then the same map with a hazard on every fourth floor tile, against it with the effects off. |
| `npx tsx packages/server/bench/bandwidth.ts [seed=N]` | Bytes per second one client receives, headless with the real encoder: typical, heavy, idle, and typical with 5 camp chests up. |
| `npx tsx packages/server/bench/mobDuel.ts` | Real-sim duels of a starting player against every zone's mob and elite. `--style stand` has the player stand and fight. `--sweep` tries other scales (`--ks`, `--eks`). |
| `npx tsx packages/server/bench/campDuel.ts` | The same against a whole mono-type camp (`--size N` mobs, 4 by default, the generator's median: that many normals, or the elite and N - 1), with a territory like a generated camp's. The `camp` pull is the real rule: the mobs are placed with their camp and the first hit wakes them all. `single` (one at a time) and `group` (all awake at the start, harsher) are the older pulls (`--pulls camp,single,group`; they keep the 9-tile circle). `--weapons` tries every weapon, `--seeds N`, `--cap SECONDS`, `--no-territory` (the 9-tile circle instead), `--json FILE`, `--k X` / `--elite-k X` another scale, and `--sweep` (with `--ks`, `--eks`, `--sizes`) prints the pairings cleared (of 25) per scale and camp size. At the shipped scales a starter on its signature weapon clears a camp of 4 in 21 of 25 pairings (measured before the territory). `--map` plays the camp pull at one of the zone's real camps on the game's themed map. |
| `npx tsx packages/shared/scripts/printMap.ts <seed> [attempt]` | An ASCII dump of a map: zones, territory edges, camps, chests, crates, the spawn pool. Without an attempt it prints the first that certifies. |
| `npx tsx packages/shared/scripts/mapBench.ts [seeds] [from=] [styler=default\|none\|zone]` | What the generator costs per seed (mean, p50, p90, p99, max), how many attempts seeds need, how many are discarded, failures by reason, and time per stage. |
| `npx tsx packages/shared/scripts/mapSweep.ts <count> [from=] [styler=default\|none\|zone\|demo]` | The independent certifier on every seed (themed maps by default: validateTerrain, zone and territory floors, hazard-free rings), plus exact sight strips, the walking-distance ratio of the spawn pool, hazard exposure and the themes' presence. Prints one JSON line. |
| `npx tsx packages/shared/scripts/pinMaps.ts > packages/shared/test/mapPins.ts` | Re-pins the maps of seeds 0 to 199 after a deliberate change to the generator. |

The four map scripts are for the generator: run `mapSweep.ts` before and after touching it (a non-empty `failed` list in its JSON line is a broken guarantee, though the script still exits 0).

### The design tools in `testing/`

Python, no install beyond numpy (only `test_rpsls.py` needs nothing). They are the design source of truth for the faction numbers. [testing/CLASS_SHEET.md](testing/CLASS_SHEET.md) is the sheet and [testing/COUNTER_REVIEW.md](testing/COUNTER_REVIEW.md) the review of every matchup.

| Command | What it does |
| --- | --- |
| `python3 testing/test_rpsls.py` | The design oracle: the 10-edge faction graph, each faction beats exactly two, power-scale and name-shuffle invariance, jitter robustness, a purity audit, and the identity tests. Standard library only, about 9 s. Exits non-zero on a failure. |
| `python3 testing/test_kite.py` | The kiting guarantee at duel pace: a melee faction winner survives one approach to an archer or mage that orb-walks (roots for its windup at each shot, walks away at full speed between shots; a Frost shooter's move chill included). One PASS or FAIL per cell, with the margin. Needs numpy, about 5 s. Exits non-zero on a FAIL. `--shooter-as X` and `--shooter-dmg X` judge the same 20 cells with every shooter buffed (attack speed, outgoing damage; the chaser never is). |
| `python3 testing/kite_windup_sweep.py` | Sweeps the bow's and the wand's windup cap and share against the kiting guarantee and prints the smallest ones that hold every cell, and the shortest Frost windup that lets a chaser arrive. Needs numpy, about 10 s. |
| `python3 testing/kite_buff_sweep.py [--jobs N]` | How much a buff on the shooter can add before the kiting guarantee breaks: the largest attack-speed multiplier for which all 20 cells hold, Plague Rat's row at 3 stacks, after one camp and at the plateau, and the same for a damage row (Ember Imp). Needs numpy, about 30 s on 8 cores. Report only; the numbers are in [testing/TUNING_ROGUE.md](testing/TUNING_ROGUE.md). |
| `python3 testing/realtime_report.py [what-if.json] [sections]` | The 20 Hz model (`realtime.py`): cadence tables, duels with signature openings, kiting, buff thresholds, the longest stretch with no swing. Needs numpy, about 40 s. |
| `python3 testing/weapon_reference.py` | Prints the weapon tables to paste into `packages/shared/test/weapons.test.ts` and `packages/server/src/harness/parity.ts` when a weapon number changes. Needs numpy. |

`realtime_paced.py` is the same model at duel pace as JSON. `harness:factions --python` runs it for you. The tuning logs are [testing/TUNING_9_1.md](testing/TUNING_9_1.md) (weapons), [testing/TUNING_10.md](testing/TUNING_10.md) (signatures) [testing/TUNING_CONTROLS.md](testing/TUNING_CONTROLS.md) (the controls rework: the windups, the kite check against an orb-walker, the real-sim before and after) and [testing/TUNING_ROGUE.md](testing/TUNING_ROGUE.md) (the roguelike buffs: attack speed against the kiting guarantee, the cap, the power of a build).

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

- **`packages/shared`**: TypeScript source used directly by both sides (no build step). Constants, wire messages, the Colyseus schema, and the pure logic both ends must agree on: the faction and weapon catalogs, the rules between weapons, buffs, signature numbers, the Wish and status catalogs and the blink rule, `generateMap` (the zone map generator), A* pathfinding, ray casts, snapshot interpolation and the compact `fxs` codec.
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
- **The map is never synced.** State carries only how to build it: the `seed`, the `attempt` of the generator that certified, and a `mapHash`. The server, the bots and every client call `generateMap(seed, attempt)`, which is deterministic (seeded `mulberry32`, no `Math.random` and none of the Math functions engines may round differently, in shared code), and a client whose map hashes differently is told to reload and leaves. The generator certifies every map as it makes it (connectivity, the 480-unit sight cap, spawn screening, equal zones, camp spacing) and never relaxes a check. Loot is rolled server-side from a private RNG, so the seed reveals the layout but not the contents.
- **Maps are made ahead.** A worker thread on the server keeps `MAP_POOL` (8) certified maps ready and a room takes one when its first player joins; an empty pool makes one on the spot. The client builds the map in a Web Worker while the loading screen shows, and warms it up in the hub.
- **Render in the past, except you.** Every other entity is drawn at `serverNow - 100 ms` (`INTERP_DELAY_MS`) by interpolating buffered snapshots against an estimated server clock. The local player is predicted (`net/localMotion.ts`): an order walks a model at once along the path the server will walk, and each patch pulls it back in line. Nothing it computes is ever sent.
- **Lag compensation.** An attack made with the low-level trigger carries the server time the client was rendering. The server keeps about 300 ms of position history (`MAX_REWIND_MS`) and samples swing attackers and targets at that time. A locked attack (everything the browser does) has no timestamp: it is timed in the present, one tick back, and aimed at its target as it lands. Arrows and balls fly in present server time.
- **Training is a mode of the same room.** The server registers `raid` (arena) and `training` (a private room of one) and forces the mode, so a client cannot pick it. The practice console's `train` message is dropped at the door unless the room is a training room.
- **Camp chests are the server's.** A cleared camp's chest, its options (rolled from the private reward stream) and every pick live in the sim; the panel only sends `choose { chest, pick }`. Picks resolve in the tick's secret order, so a same-tick race is fair. The options are in the synced state (the chest is contested), which makes them readable from anywhere by a modified client.
- **Persistence.** Profiles (GV balance, lifetime GV, GV per UTC month, stats, cosmetics, achievements) live in memory and are saved to one JSON file (version 2). A version 1 file from the extraction build is migrated on start: stashes are dropped, stats and tokens kept, and the original is saved first as `stash.json.bak-v1`. Mutations are synchronous. Writes are coalesced and atomic (temp file, fsync, rename, directory fsync), retried with backoff on failure, and flushed on graceful shutdown. A malformed profile entry is dropped and the original kept as `stash.json.bak-<time>`. A file that cannot be parsed at all stops the server from starting and is moved to `stash.json.corrupt-<time>` instead of being overwritten. To reset, stop the server and delete it.

When GV banks:

| Event | Effect |
| --- | --- |
| Your run resolves (won, draw, died, left) | Its GV (kills, mobs, bounty, win bonus) and stats are saved at once. |
| Leave or disconnect in the lobby | Nothing to save. |
| Training | Nothing is ever recorded. |
| Graceful server shutdown mid-run | The run is void and not recorded. GV earned so far is paid. |
| Hard kill of the server mid-run | GV earned in that run is lost (see below). |

HTTP, all under `/api`. `x-profile-token` carries a profile's token.

| Request | What it does |
| --- | --- |
| `GET /api/health` | `{ ok: true }`. |
| `GET /api/profile/:name` | Claims a free name (no token header) or returns the profile when the token matches. |
| `POST /api/profile/:name/purchase` | Body `{ id }`: buys a cosmetic at its catalog price. Needs the token. |
| `POST /api/profile/:name/equip` | Body `{ slot, id }`: equips an owned cosmetic (`id: null` empties the slot). Needs the token. |
| `GET /api/leaderboard?month=YYYY-MM&limit=N&name=callsign` | Public: names, equipped titles and GV banked that UTC month (`limit` defaults to 20, at most 100). `you` (the named profile's place) comes only with that profile's token. |

## Known limitations

Netcode and scale:

- **No interest management.** Every client receives every player's position and weapons, every container's contents (a camp chest's skills and who took them included), every mob and every projectile. A modified client can see all of it, and there is no fog of war.
- **Swarm hides a fighter only from an honest client.** The browser does not draw a swarmed fighter and cannot click it, and the server refuses every lock and ability aimed at it. But every client still receives every position, and the server still accepts the low-level `attack` input, so a modified client can find a swarmed player and attack its true position. The fix is interest management plus refusing `attack` from game clients.
- **Mixed timelines on screen.** Other fighters' positions and effects are drawn 100 ms in the past (yours is predicted). Health bars, status, containers and the timers show the latest patch, so they can lead what you see by a tick or two. Deaths are the exception: a victim stays drawn until their death is due.
- **Prediction is partial.** Your own character is predicted for its walk, its Blaze Step, and the roots and haste it is told of; anything else the server does to it arrives as a correction (a smooth slide, or a snap past 96 units). Other fighters are still drawn 100 ms in the past, so a swing at a moving target can look to miss by about a delay's walk.
- **Single process only.** The "profile already in a raid" guard and the profile file are process-local.
- **Maps cost memory, and a burst can outrun the pool.** The map generator's lane tables take 44 MB per process (the server's main thread and its worker, each browser tab's map worker), and the worker adds about 130 MB to the server. More than 8 rooms starting inside a third of a second empty the pool, and the next room generates its own map on the main thread (about 35 ms, logged). The client was measured in Chrome at normal speed only, not with a throttled CPU.
- **Lag compensation trusts the client's timestamp** anywhere inside the 300 ms rewind window, so a cheating client can pick the most favourable moment. It only matters for the low-level `attack` and `release` messages: the browser's locked attacks carry no timestamp. The window only covers clients up to about 150 ms RTT. Beyond that, swings at moving targets miss.

Identity and persistence:

- **Profiles are weakly authenticated.** The only credential is a random token in the browser's `localStorage`. There are no passwords, recovery, expiry or rotation. Tokens are stored in plain text in the profile file and travel unencrypted unless you put TLS in front. Clearing site data forfeits the profile, and anyone who copies the token owns its GV.
- **No rate limits.** Matchmaking, the shop endpoints and training-room creation have no limit beyond one active run per profile. Any client can create profiles as fast as it likes (`/api` answers every origin).
- **A hard kill loses the GV of runs in progress.** SIGKILL, power loss or OOM mid-run loses it. The whole JSON file is rewritten on every change, and there is no TLS, structured logging or metrics. This is a dev setup, not a deployment.
- **GV can still be farmed with spare callsigns.** The win bonus needs 3+ players and damage on 2+ opponents, which stops the cheapest trick. But throwaway callsigns that get killed still pay out kills and the bonus.

Gameplay and content:

- **Placeholder art and balance.** Colored shapes, no audio, numbers that are first picks. The weapon and faction numbers are tuned in `testing/` and the harnesses. The mob and buff numbers are tuned only against scripted players.
- **The Wishes are first picks too.** Every Wish number, the trail's burn, the 5 s training cooldown and the caps on the status kinds are best guesses, and none of them was run through the weapon harness or the kiting check, which never cast (see [testing/WISHES.md](testing/WISHES.md)). Blaze Step and Last Stand have no warning before the cast, which is an owner question ([docs/GAME_DESIGN.md](docs/GAME_DESIGN.md) section 18).
- **Wand > Shield fails in the weapon harness's policy matrix (23%).** The harness wand backs away from a charging shield, and with no ranged slows that no longer works. It holds at 100% when both fighters click each other, which is how the controls are played; nothing was changed for it. Numbers and reasons in [testing/TUNING_CONTROLS.md](testing/TUNING_CONTROLS.md).
- **The controls are a first pick too.** Click snap 64 units, an empty click does nothing (there is no attack-move), a windup your lock started is cancelled by your next order (a mob's stays committed), a lock lasts out to 640 units and 1.5 s without line of sight once the target was seen (a target locked behind a wall is chased until it is). The list of these guesses is in [CLAUDE.md](CLAUDE.md).
- **Camp chests and passives are first picks.** The passive numbers are the plan's and untested against the weapon harness (Quickdraw was run through the kiting check in the final review and eats some of its margin: `testing/TUNING_ROGUE.md` section 7, the owner's call); the chest panel's grey-out uses the prediction's delay, not a measured ping. Mob strength (`MOB_K` 0.22, `ELITE_K` 0.65) was measured with one scripted player per fight, never with humans: a Holy wand cannot beat a Sentenced sword camp, a Sentenced bow clears no Fire camp, and a Frost shield cannot finish a Frost shield mob. Details in [CLAUDE.md](CLAUDE.md) and [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md) sections 11 and 18.
- **Not built:** the rest of the roguelike plan (the zones' terrain is on and the maps are themed; active skills on Q and E, 12 of the 21 passives, relics and curses, "?" camps, start boons, the status effects of six buffs; see [docs/ROGUELIKE_PLAN.md](docs/ROGUELIKE_PLAN.md)), quest NPCs, raid bosses, secrets, friends, private matches, chat, the 30-second warning and host voice line before the teleport, and the minimap pings for bountied players (the crown is built). They are in [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md) sections 2.2, 6, 12.4 and 15.
- **No teams, parties or queues.** Every join lands in the first open lobby. Reloading the page mid-run drops the connection and cannot resume it (the client reconnects only within the same page session), so the seat times out after 10 s and the player is MIA. Chests and weapons on the ground do not respawn.

Client and tooling:

- **Desktop only.** Mouse and keyboard, no touch or gamepad, no rebinding.
- The client has unit tests but no browser tests.
- The server's private RNG (loot, spawn assignment) is `Math.random`, which is not cryptographically secure.
