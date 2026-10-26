# RougeHalla

A top-down 2.5D roguelike battle arena. Up to 8 players pick one of five factions and drop into a generated map with only their faction's signature weapon. They loot chests, farm neutral mobs for buffs and fight until one is left standing. Two counter loops decide every fight: faction against faction, and weapon against weapon. If nobody dies for a while, everyone still standing is teleported into the coliseum at the centre and locked in until somebody does. The last one standing wins **Glorious Victory** (GV), a currency that only buys cosmetics. Weapons and buffs never outlive a run. GV, stats, cosmetics, titles and achievements persist per callsign.

The first playable in [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md) is built: a walkable hub, the faction pick, five weapons, five faction signatures, regional mobs, buffs, bounties, the patience timer and coliseum, GV, a shop, achievements, a monthly leaderboard and a training room. That document has the rules, the numbers and the reasons for them. This one covers running, playing and testing the code. Engineering rules and open issues are in [CLAUDE.md](CLAUDE.md).

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

Bots are headless players. They use the same HTTP API and play with the same controls as the browser: they walk (`move`), click their foe (`target`) and let the server chase, attack and aim, and they swap and pick up weapons. They never send `aim`, `attack` or `release`. They farm mobs while no player is close and hunt the nearest player otherwise, and they join the same lobby as everyone else. Press Start Run in your tab first, then start some:

```bash
npm run bots -- 3
```

They arrive in your lobby and the run starts after the fill window. If the bots go first, two of them reach `MIN_PLAYERS` and start a run `FILL_SECONDS` later without you. Raise `LOBBY_SECONDS` or `FILL_SECONDS` for more time to join. For a quiet sandbox, start the server with `MIN_PLAYERS=1 FILL_SECONDS=1 npm run dev`. You get a solo run (it has no winner) with mobs, so you can test fighting and buffs. The [training room](#training) is better for trying weapons.

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

### Controls

Right-click to move, left-click an enemy to fight it. There is no attack button to hold: the server plays the fight once you have picked an enemy.

| Input | In a run |
| --- | --- |
| Right-click (hold) | Walk to that point. The server pathfinds around walls. Holding re-sends the target every 100 ms. An unreachable point gives no walk, but the order still drops your attack target. |
| Left-click on or near an enemy | Lock the nearest enemy (a player or a mob) within 64 units of the cursor. The server walks you into range and attacks it whenever the cooldown allows, until you give another order, it dies, it leaves 640 units, or it stays out of line of sight for 1.5 s once you have seen it. An enemy behind a wall can be locked: you walk around to it, and nothing is attacked without a clear line. A click on empty ground does nothing. The locked enemy gets a red ring, and the one a click would lock gets a thin light ring. |
| Mouse position | Aim for the shield: it faces the cursor while nothing is locked, and the locked enemy otherwise. |
| `Q` | Swap to the other weapon slot. |
| `1` / `2` | Switch to that slot. |
| `F` | Take the highlighted weapon (chest, weapon on the ground or body) within 56 units and in line of sight. With both slots full, the weapon in hand drops. |
| `S` | Stop walking and drop the attack target. |
| `Esc` | Leave a training room. |

Orders replace each other, in the order they arrive: a right-click or `S` drops the lock, and a left-click on an enemy replaces any earlier order. A walk ordered while an attack is winding up is not lost: the windup is committed (it is not cancelled by moving, as it would be in League of Legends), and the walk starts when it ends. Swapping weapons or picking one up keeps the lock (an attack still winding up is cancelled, and the lock starts the next one with the new weapon). A locked attack is aimed at its target again when it lands or leaves, but arrows and balls then fly straight and can be dodged. An attack made without a lock (a mob's) goes where it was aimed: a swing or a ball at the start, an arrow when its draw ends.

In the hub: right-click or `WASD` / arrows to walk, `E` or a click at a station. Shortcuts are ignored while a text field has focus. Clicks that begin on a menu or panel never reach the world.

### A run

1. **Lobby.** The timer starts when the first player joins and lasts `LOBBY_SECONDS` (30). Once `MIN_PLAYERS` (2) are in, the remaining wait is cut to at most `FILL_SECONDS` (5). Eight players start it at once. If the timer runs out with fewer than `MIN_PLAYERS`, the run starts with whoever is there. A solo run has no winner and no win bonus. Nobody can act in the lobby.
2. **Early run.** The room locks and everyone is moved to a distinct spawn on the rim of a region. You have your signature weapon and nothing else. A map has about 17 chests (one weapon each, every type equally likely) and some weapons loose on the ground. Take what you need, farm mobs, and pick fights you can win.
3. **Mobs.** The map has five regions around the coliseum, one per faction, tinted in its colour. A mob carries its region's weapon (Fire: axe, Sentenced: sword, Plague: bow, Frost: shield, Demon Blood: wand) and fights as its region's faction at 45% strength. Each region has one elite, at 65%. So the map is a shopping list for counters.
   - Mobs are neutral until hit. A woken mob chases and fights with spacing that suits its weapon. It gives up when it is 9 tiles from its camp, or 6 s after it last dealt damage. Then it walks home untouchable and heals.
   - A map has about 40 mobs. They do not respawn, and they never hurt each other.
   - A kill pays GV (2, an elite 10, scaled by the reward curve below, at most 30 a run from mobs) and a buff drop. The mob's weapon lands on the ground, unless you already hold that type. The kill goes to whoever did it the most damage.
4. **Buffs and the feed.** Your feed is your player kills plus a quarter of your mob kills. Mob drops give stacks of max hp, attack speed or move speed (the region's own stat 60% of the time). A stat's bonus follows an S-curve: small at first, a spike from the 3rd to the 5th stack, then a plateau. Three stacks of one stat unlock a combo that fires on every kill, and five a stronger one (dash, cascade, kill shield, bulwark, bloodrush, frenzy run). Mob rewards fall as your feed rises, and a player far behind the lobby median gets a catch-up bonus. Buffs and the feed reset every run. The HUD shows three buff rows under your hp, and a feed line. The numbers are in [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md) section 12.
5. **Bounty.** Past 2 player kills, a bounty sits on you: `10 x (kills - 2)^1.5` GV (10 at three kills, 28 at four, 52 at five). Mob kills never raise it. Everyone is told "<name> is on a rampage" when it rises, and a crown marks you. Whoever kills you is paid the bounty on top of the kill, plus half your buff stacks. Leaving within 5 s of being hit counts as a kill for whoever hit you, so quitting does not dodge a bounty. A mob that finishes a player a rival hit within 5 s credits the rival.
6. **Patience timer.** If no player dies for a while, everyone still standing is teleported into the coliseum and its four gates close. The wait is 5:00 with 8 standing and shrinks linearly to 2:00 at 3 or fewer (`PATIENCE_SECONDS`, `PATIENCE_MIN_SECONDS`). Every death, a leave included, restarts the timer and opens the gates. Mobs do not count. You are immune for 1.5 s after the teleport, arrows and balls in flight are removed, and every living mob goes back to its camp at full health.
7. **Sudden death.** Locked in for `SUDDEN_DEATH_SECONDS` (60) with no death, everyone standing loses 2% of max hp per second, and 2% more for every further second, until somebody dies. A death opens the gates.
8. **Outcome.** The last one standing wins. If the last players go down in the same tick, the one with the higher hp fraction at the start of that tick wins. An exact tie is a draw. Leaving mid-run counts as a death (missing in action). A dropped connection keeps you in the fight, and hittable, for 10 s first. In the lobby, leaving costs nothing.
9. **Results.** A kill pays 10 GV. Winning pays 50 more, but only if the run started with 3 or more players and you damaged at least 2 different opponents. Otherwise you still win, without the bonus. GV earned is kept when you die. It banks the moment your run resolves. The results screen shows the outcome, your place, time, kills, who killed you, the GV rows and any achievements unlocked. A dead player sees "YOU DIED" for 1.5 s first, while the run goes on for everyone else. Back to hub reloads the profile.

The HUD shows players standing, your run GV and bounty, the arena timer (coliseum, locked gates, sudden death), a minimap (regions, closed gates, living mobs), a weapon bar with the shared cooldown, a red flash when you take a real hit, and a green or red screen tint when the nearest enemy in sight is countered by you or counters you.

### Training

The Training Grounds door starts a private room of one, created fresh each time, with your picked faction. Next to your spawn are a plain dummy, a shield dummy (reflects arrows, ripostes swords) and a rack with one of each weapon. Nothing is recorded: no GV, no stats, no achievements, no timer, no results, no mobs. If you go down you are stood back up. Leave with the button or `Esc`. A room whose player sends no input the server accepts for 5 minutes is closed. A message the server rejects does not count as input.

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
| `PATIENCE_SECONDS` | `300` | With 8 players standing and no death for this long, everyone standing is teleported into the coliseum. |
| `PATIENCE_MIN_SECONDS` | 40% of `PATIENCE_SECONDS` | The same wait with 3 or fewer standing, linear in between. Kept between 0 and `PATIENCE_SECONDS`. |
| `SUDDEN_DEATH_SECONDS` | `60` | Locked in the coliseum this long with no death, sudden death starts. |
| `TRAINING_IDLE_SECONDS` | `300` | A training room whose player sends no accepted input for this long is closed. |
| `DUMMIES` | off | `1` or `true`: training dummies and a weapon rack next to every spawn in arena runs too. |
| `MOBS` | on | `0` or `false`: no regional mobs. |
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

- **Shared** (`packages/shared/test`): the pure rules. The faction law and the weapon formula are checked against numbers printed by the Python model, so the two cannot drift apart.
- **Server** (`packages/server/test`): the sim headless (ledger, weapons, signatures, mobs, buffs, feed, arena, training), the room and HTTP API, shutdown, the profile store and shop, the fx wire format, and `e2e.test.ts`. In `e2e.test.ts` four bots play whole runs against a real server, and the GV ledger, stats and file must balance. It replays a run once if the bots showed no kill, signature hit or mob kill, and fails if the replay lacks it too.
- **Gates**: `perf.test.ts` (with 8 players and 60 mobs, `step()` averages under 5 ms with a p99 under 15 ms) and `bandwidth.test.ts` (under 20 KB/s per client).
- **Client** (`packages/client/test`): the views and the DOM overlay against fakes for Phaser and the DOM. There are no browser tests, so look at the real thing after a rendering change.

**Soak.** For a long run, start the server and leave `npm run bots -- -- 6 --loop` going. The Phase 13 soak ran 6 looping bots for 43 hours: about 15,600 run results, no server errors, every run over within 190 s, and the server's RSS flat at about 330 MB after a 30-minute warm-up.

### Harnesses and benchmarks

These report. They never fail the build, and they are what to run before touching a weapon or faction number.

| Command | What it does |
| --- | --- |
| `npm run harness -w @raid/server` | Weapon duels in the real sim between two policy-driven clients: the weapon matrix, a style grid for every edge with a ranged weapon, an edge verdict (holds, or fails and why), the same edges when both fighters click each other (the target lock), and kiting (a shooter that stands, strafes, kites, orb-walks or locks its chaser). About 55 s. `-- --core` skips the sensitivity passes (about 40 s), `-- --quick` takes a few seconds, `-- --help` lists the filters. |
| `npm run harness:factions -- --python` | Every faction edge with the same weapon on both sides, and the signature openings, in the real sim. Checked pair by pair against `testing/realtime.py` (about 5 s). `-- --mode policy` plays them as moving fighters (about 20 s), `-- --mode full` with real arcs and flight (about 7 s). |
| `npx tsx packages/server/bench/stepBench.ts` | Cost of one `step()` with 8 players and 60 mobs. |
| `npx tsx packages/server/bench/bandwidth.ts [seed=N]` | Bytes per second one client receives, headless with the real encoder: typical, heavy, idle. |
| `npx tsx packages/server/bench/mobDuel.ts` | Real-sim duels of a starting player against every region's mob and elite. `--style stand` has the player stand and fight. |

### The design tools in `testing/`

Python, no install beyond numpy (only `test_rpsls.py` needs nothing). They are the design source of truth for the faction numbers. [testing/CLASS_SHEET.md](testing/CLASS_SHEET.md) is the sheet and [testing/COUNTER_REVIEW.md](testing/COUNTER_REVIEW.md) the review of every matchup.

| Command | What it does |
| --- | --- |
| `python3 testing/test_rpsls.py` | The design oracle: the 10-edge faction graph, each faction beats exactly two, power-scale and name-shuffle invariance, jitter robustness, a purity audit, and the identity tests. Standard library only, about 9 s. Exits non-zero on a failure. |
| `python3 testing/test_kite.py` | The kiting guarantee at duel pace: a melee faction winner survives one approach to an archer or mage that orb-walks (roots for its windup at each shot, walks away at full speed between shots; a Frost shooter's move chill included). One PASS or FAIL per cell, with the margin. Needs numpy, about 5 s. Exits non-zero on a FAIL. |
| `python3 testing/kite_windup_sweep.py` | Sweeps the bow's and the wand's windup cap and share against the kiting guarantee and prints the smallest ones that hold every cell, and the shortest Frost windup that lets a chaser arrive. Needs numpy, about 10 s. |
| `python3 testing/realtime_report.py [what-if.json] [sections]` | The 20 Hz model (`realtime.py`): cadence tables, duels with signature openings, kiting, buff thresholds, the longest stretch with no swing. Needs numpy, about 40 s. |
| `python3 testing/weapon_reference.py` | Prints the weapon tables to paste into `packages/shared/test/weapons.test.ts` and `packages/server/src/harness/parity.ts` when a weapon number changes. Needs numpy. |

`realtime_paced.py` is the same model at duel pace as JSON. `harness:factions --python` runs it for you. The tuning logs are [testing/TUNING_9_1.md](testing/TUNING_9_1.md) (weapons), [testing/TUNING_10.md](testing/TUNING_10.md) (signatures) and [testing/TUNING_CONTROLS.md](testing/TUNING_CONTROLS.md) (the controls rework: the windups, the kite check against an orb-walker, the real-sim before and after).

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
| generateMap(seed), same as server    |   + fxs    |     result messages                    |
+--------------------------------------+            |   ProfileStore -> stash.json           |
                                                    +----------------------------------------+
```

- **`packages/shared`**: TypeScript source used directly by both sides (no build step). Constants, wire messages, the Colyseus schema, and the pure logic both ends must agree on: the faction and weapon catalogs, the rules between weapons, buffs, signature numbers, `generateMap`, A* pathfinding, ray casts, snapshot interpolation and the compact `fxs` codec.
- **`packages/server`**: `RaidRoom` (the Colyseus adapter), `sim/` (the game rules; `arena.ts` owns the run lifecycle, `step.ts` the tick order), `persistence/` (the profile store), `bots/`, `harness/` and `bench/`.
- **`packages/client`**: `net/` (connection, REST, clock sync, interpolation), `scenes/` (the hub and the run), `hub/` (the hub's layout and art), `render/` (2.5D projection and views) and `ui/` (DOM overlay: menu, HUD, panels, results). [CLAUDE.md](CLAUDE.md) has the file-by-file layout.

How it fits together:

- **Authoritative server.** Clients send inputs only (`move`, `stop`, `target`, `aim`, `attack`, `release`, `swap`, `pickup`). The browser sends `target` for every fight and never touches the trigger; `attack` and `release` are the low-level trigger that mobs and the weapon harness use. The bots click like the browser does. Positions, damage and outcomes are never accepted from a client.
- **Fixed 20 Hz tick and input queues.** Message handlers validate (finite numbers clamped to the world, short ids) and enqueue into a per-player queue. The latest move and aim win, orders replace each other in arrival order (a `move` or `stop` drops a lock, a `target` replaces what came before it), at most 6 actions are kept per tick, and a client sending more than 100 messages a second is disconnected. The sim drains the queues at the start of each 50 ms step in a per-tick shuffled order, so same-tick races are fair. A patch goes out after every step.
- **Pure sim.** `sim/` never imports Colyseus or touches sockets. Gameplay modules register actions and systems into a world. `step()` returns events and the room turns them into messages and profile changes, so most of the game is tested headless.
- **One damage ledger per tick.** Swings, arrows, balls and signature damage are recorded as hits and applied all at once. Results are settled once at the end of the tick. So the order players happen to be processed in never decides who wins.
- **The target lock is server-side.** `sim/targeting.ts` plays a locked player's weapon as mob AI plays a mob's: it paths into range, holds the trigger and aims each attack at the target, every tick after the inputs and before the weapons. The browser only says whom to lock. It is synced as `PlayerState.attackTarget` so every client can draw the ring.
- **Mobs are players who send inputs.** They go through the same combat code and input handlers as a player.
- **Schema sync.** State uses decorator-free `schema()` builders. Only the server imports the schema at runtime. The client imports types and decodes by reflection. Projectiles are not in the state. All the visual events of a step, and every arrow and ball that left during it, go out as one compact `fxs` message.
- **The map is never synced.** State carries only the `seed`. Both sides call `generateMap(seed)`, which is deterministic (seeded `mulberry32`, no `Math.random` in shared code). Loot is rolled server-side from a private RNG, so the seed reveals the layout but not the contents.
- **Render in the past.** Every entity, including the local player, is drawn at `serverNow - 100 ms` (`INTERP_DELAY_MS`) by interpolating buffered snapshots against an estimated server clock. There is no client prediction.
- **Lag compensation.** An attack made with the low-level trigger carries the server time the client was rendering. The server keeps about 300 ms of position history (`MAX_REWIND_MS`) and samples swing attackers and targets at that time. A locked attack (everything the browser does) has no timestamp: it is timed in the present, one tick back, and aimed at its target as it lands. Arrows and balls fly in present server time.
- **Training is a mode of the same room.** The server registers `raid` (arena) and `training` (a private room of one) and forces the mode, so a client cannot pick it.
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

- **No interest management.** Every client receives every player's position and weapons, every container's contents, every mob and every projectile. A modified client can see all of it, and there is no fog of war.
- **Mixed timelines on screen.** Positions and effects are drawn 100 ms in the past. Health bars, status, containers and the timers show the latest patch, so they can lead what you see by a tick or two. Deaths are the exception: a victim stays drawn until their death is due.
- **No client-side prediction.** Your own character is also interpolated, so motion starts at least 100 ms after input plus the network round trip.
- **Single process only.** The "profile already in a raid" guard and the profile file are process-local.
- **Lag compensation trusts the client's timestamp** anywhere inside the 300 ms rewind window, so a cheating client can pick the most favourable moment. It only matters for the low-level `attack` and `release` messages: the browser's locked attacks carry no timestamp. The window only covers clients up to about 150 ms RTT. Beyond that, swings at moving targets miss.

Identity and persistence:

- **Profiles are weakly authenticated.** The only credential is a random token in the browser's `localStorage`. There are no passwords, recovery, expiry or rotation. Tokens are stored in plain text in the profile file and travel unencrypted unless you put TLS in front. Clearing site data forfeits the profile, and anyone who copies the token owns its GV.
- **No rate limits.** Matchmaking, the shop endpoints and training-room creation have no limit beyond one active run per profile. Any client can create profiles as fast as it likes (`/api` answers every origin).
- **A hard kill loses the GV of runs in progress.** SIGKILL, power loss or OOM mid-run loses it. The whole JSON file is rewritten on every change, and there is no TLS, structured logging or metrics. This is a dev setup, not a deployment.
- **GV can still be farmed with spare callsigns.** The win bonus needs 3+ players and damage on 2+ opponents, which stops the cheapest trick. But throwaway callsigns that get killed still pay out kills and the bonus.

Gameplay and content:

- **Placeholder art and balance.** Colored shapes, no audio, numbers that are first picks. The weapon and faction numbers are tuned in `testing/` and the harnesses. The mob and buff numbers are tuned only against scripted players.
- **Wand > Shield fails in the weapon harness's policy matrix (23%).** The harness wand backs away from a charging shield, and with no ranged slows that no longer works. It holds at 100% when both fighters click each other, which is how the controls are played; nothing was changed for it. Numbers and reasons in [testing/TUNING_CONTROLS.md](testing/TUNING_CONTROLS.md).
- **The controls are a first pick too.** Click snap 64 units, an empty click does nothing (there is no attack-move), a windup cannot be cancelled by moving, a lock lasts out to 640 units and 1.5 s without line of sight once the target was seen (a target locked behind a wall is chased until it is). The list of these guesses is in [CLAUDE.md](CLAUDE.md).
- **Not built:** quest NPCs, raid bosses, secrets, friends, private matches, chat, the 30-second warning and host voice line before the teleport, and the minimap pings for bountied players (the crown is built). They are in [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md) sections 2.2, 6, 12.4 and 15.
- **No teams, parties or queues.** Every join lands in the first open lobby. Reloading the page mid-run drops the connection and cannot resume it (the client reconnects only within the same page session), so the seat times out after 10 s and the player is MIA. Chests and weapons on the ground do not respawn.

Client and tooling:

- **Desktop only.** Mouse and keyboard, no touch or gamepad, no rebinding.
- The client has unit tests but no browser tests.
- The server's private RNG (loot, spawn assignment) is `Math.random`, which is not cryptographically secure.
