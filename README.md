# RougeHalla

A top-down 2.5D roguelike battle arena skeleton. Up to 8 players drop into a procedurally generated map with a
small kit, loot crates and fight. The last one standing wins **Glorious Victory** (GV), a currency that only
buys cosmetics. If nobody dies for a while, everyone is teleported into the coliseum at the centre and locked
in until somebody does. Run gear never outlives the run; GV, stats and (later) cosmetics persist per callsign.

It is a skeleton. It has an authoritative server, a thin renderer-only client, shared contracts, persistent
profiles, and a test suite. It does not have accounts, matchmaking, sound, balance, or art: everything is colored
shapes, there are ten items, and the numbers are placeholders. Factions, the five weapons, regional mobs and the
coliseum map are later phases of the plan. See [Known limitations](#known-limitations).

Stack: Phaser 4, Colyseus 0.18, Express 5, Vite 8, TypeScript 7, Vitest 5, npm workspaces.

## Requirements and setup

- Node.js 22.12 or newer, preferably an LTS release (22 or 24). Vite 8 accepts `^20.19 || >=22.12`, but Vitest 5,
  Colyseus and `concurrently` need Node 22+, and Vitest declares `^22.12 || ^24 || >=26`, so Node 23 and 25 may
  print engine warnings (it was developed on 25.8 and runs there).
- npm 7 or newer (the npm bundled with Node 22 is fine) and a desktop browser with a mouse and keyboard.

```bash
npm install      # once, at the repo root (installs all three workspaces)
npm run dev      # game server on :2567 and Vite client on :5173
```

Open http://localhost:5173. Vite runs with `strictPort`, so it fails instead of picking another port if 5173 is
busy.

## Playing with two tabs

Open two tabs and give each a callsign:

```
http://localhost:5173/?profile=alice
http://localhost:5173/?profile=bob
```

A callsign (2 to 16 letters, digits, `_` or `-`) is a profile. The first load of an unused name claims it. The
server hands back a token that the client keeps in
`localStorage` as `raid.token.<callsign>`, and every later load proves ownership with it. Without `?profile=`
a tab starts with a random `op-xxxx` name; edit it and press Load to claim one. A tab remembers its callsign
in `sessionStorage`, so a reload keeps it.

Tabs in the same browser share `localStorage`, so two tabs can load the same callsign, but a profile can be in
only one run at a time ("profile already in a raid"). A second browser, a private window, or cleared site data
does not have the token, and the menu will say the callsign is taken. There is no in-game recovery for that.

## The run loop

1. **Hub.** Load a callsign to see its GV balance (spendable, lifetime, this month), its stats and the monthly
   leaderboard, then press Start Run. Nothing is brought in: every run starts with a fresh Knife and Bandage.
2. **Lobby.** You stand on a spawn point while the HUD counts down. The timer starts when the first player
   joins and lasts `LOBBY_SECONDS` (30). Once `MIN_PLAYERS` (2) are in, the remaining wait is cut to at most
   `FILL_SECONDS` (5). Eight players start it at once. If the timer runs out with fewer than `MIN_PLAYERS`
   the run still starts with whoever is there, so a solo run is possible.
3. **Run.** The room locks and everyone is moved to a distinct random spawn. Loot crates, floor items and
   bodies, and fight.
4. **Patience timer.** If nobody dies for a while, everyone still standing is teleported to a ring of spots at
   the map centre and the coliseum gates lock. The wait is 5:00 with 8 players standing and shrinks linearly to
   2:00 at 3 or fewer (`PATIENCE_SECONDS` and `PATIENCE_MIN_SECONDS`) (for now the gates are a flag: the coliseum map
   arrives with map v2). Every death, a leave included, restarts the timer and unlocks the gates. You are immune
   to damage for 1.5 s after a teleport.
5. **Sudden death.** Locked in for `SUDDEN_DEATH_SECONDS` (60) with no death, everyone standing loses 2% of max
   hp per second, 2% more for every further second, until somebody dies (which unlocks the gates) or nobody is left.
6. **Outcome.** The last one standing wins. If the last players go down in the same tick, the one with the
   higher hp fraction at the start of that tick wins; an exact tie is a draw. Leaving mid-run counts as a death
   (missing in action); a dropped connection keeps you in the fight (and hittable) for 10 s first. A run that
   started with one player has no winner: it ends when that player goes down.
7. **GV.** A kill pays 10 GV and winning pays 50 more (solo runs never pay the win bonus). GV earned is kept when
   you die, and banks the moment your run resolves. Mobs (later) pay 2, or 10 for an elite, capped at 30 per run.
8. **Bounties.** Your feed score is your kills plus a quarter of your mob kills. Past 2 it puts a bounty on you:
   `10 × (feed − 2)^1.5` GV (10 at three kills, 28 at four, 52 at five). Everyone is told "<name> is on a rampage"
   whenever it rises, a crown marks you, and whoever kills you is paid the bounty on top of the kill. Leaving
   (or dropping and not coming back) within 5 s of being hit counts as a kill for whoever hit you, so quitting
   doesn't dodge a bounty.
9. **Results.** The results screen shows the outcome, your place, kills, who killed you and the GV banked. A dead
   player sees "YOU DIED" for 1.5 s first while the run continues for everyone else. Back to hub reloads the profile.

Leaving or dropping in the lobby removes you at once and costs nothing.

## Controls

| Input | Action |
| --- | --- |
| Right-click (hold) | Walk to that point. The server pathfinds; holding re-sends the target every 100 ms. Unreachable points are ignored. |
| Left-click (hold) or `Q` | Attack toward the cursor with the best weapon you carry. Holding repeats; the server enforces the cooldown. `Q` fires at the last cursor position. |
| `F` | Open or close the loot panel for the highlighted container (crate, floor item or body) within 56 units and line of sight. Click Take per item. |
| `1`-`6` or click a slot | Use the item in that inventory slot. Only healing items do anything. |
| `Shift+1`-`6` or Shift+click a slot | Drop that item on the ground. |
| `S` | Stop walking. |
| `Esc` | Close the loot panel. |

Shortcuts are ignored while a text field has focus. There is no equip step: the highest-damage weapon and highest-reduction armor you carry are used
automatically, and the HUD shows which. With no weapon you fight with fists.

Items: Knife (22 dmg, melee), Pistol (16 dmg, range 260), Rifle (28 dmg, range 400); Vest and Plate (absorb
25% and 45%); Bandage and Medkit (heal 25 and 60, consumed); Watch, Gold Bar and GPU (value 50, 200, 400, no
other use yet). Crates hold 1 to 3 items. Floor items never include the rifle, plate or GPU. The extraction
circles still drawn on the map are left over from map v1 and do nothing.

## Commands

All from the repo root.

| Command | What it does |
| --- | --- |
| `npm run dev` | Server (`tsx watch`, :2567) and client (Vite, :5173) together. Ctrl+C stops both. |
| `npm test` | Vitest in the workspaces that have tests (server, shared). The server suite includes end-to-end tests over real sockets. |
| `npm run typecheck` | `tsc --noEmit` in every workspace. |
| `npm run build` | Production build of the client into `packages/client/dist`. Vite does not type-check, so run `typecheck` too. |
| `npm run bots -- 3` | Start 3 headless bot clients against the running dev server. |
| `npm run start -w @raid/server` | Run the server once without file watching. |
| `npm run preview -w @raid/client` | Serve the output of `npm run build` locally. |

The end-to-end tests start their own server on a free port with a temporary profile file, so they are safe to run
while `npm run dev` is up and never touch your real profiles. `tsx watch` restarts the server when server or shared
source changes. A restart is a graceful shutdown: the run is void (not recorded), but players still in it are
paid the GV they had earned.

**Bots.** The bots (`packages/server/src/bots/`) are headless clients that use the same profile API and input
messages as the browser and play a simple "hunt" loop: heal when hurt, otherwise walk to the nearest player
and fight. They join the same lobby as everyone else, so the normal start rules apply. Press Start Run in your
tab first, then run `npm run bots -- 3`: the bots arrive in your lobby and the run starts after the fill window.
If the bots go first, two or more of them reach `MIN_PLAYERS` and start a run `FILL_SECONDS` later without
waiting for you. Raise `FILL_SECONDS` or `LOBBY_SECONDS` for more time to join. Flags: `--loop` (queue again after each run),
`--url`, `--prefix`, `--verbose`.

### Server environment variables

Set them on the command line, for example `MIN_PLAYERS=1 FILL_SECONDS=1 PATIENCE_SECONDS=20 npm run dev` for fast
solo testing. A missing or non-numeric value falls back to the default. Defined in
`packages/server/src/config.ts` and `packages/shared/src/constants.ts`.

| Variable | Default | Meaning |
| --- | --- | --- |
| `RAID_PORT` | `2567` | Port the server listens on. |
| `STASH_FILE` | `packages/server/data/stash.json` | Where profiles are saved (git-ignored). The name predates profiles v2; a v1 stash file there is migrated in place. |
| `MIN_PLAYERS` | `2` | Players needed before the lobby wait is cut to `FILL_SECONDS`. |
| `LOBBY_SECONDS` | `30` | Lobby wait, counted from the first join. |
| `FILL_SECONDS` | `5` | Longest wait left once `MIN_PLAYERS` have joined. |
| `PATIENCE_SECONDS` | `300` | With 8 players standing and no death for this long, everyone standing is teleported into the coliseum. |
| `PATIENCE_MIN_SECONDS` | 40% of `PATIENCE_SECONDS` | The same wait with 3 or fewer standing; linear in between. |
| `SUDDEN_DEATH_SECONDS` | `60` | Locked in the coliseum this long with no death, sudden death starts. |
| `COLYSEUS_LATENCY` | `0` | Artificial latency in milliseconds, for netcode testing. |

### Client environment variable

`VITE_SERVER_URL` points the client at a server. Unset, the client opens a WebSocket to `<page hostname>:2567`
and calls `/api` on its own origin, which Vite proxies to `localhost:2567`. Set, the WebSocket and the REST
base both derive from it (`ws` becomes `http`, `wss` becomes `https`) and `/api` is a cross-origin request.
The proxy target and the default port are fixed at 2567, so changing `RAID_PORT` also needs this, for example
`RAID_PORT=3000 VITE_SERVER_URL=http://localhost:3000 npm run dev`. Vite inlines it at build time, so set it
when running `npm run build` too.

## Architecture

```
 browser tab                                          Node process
+--------------------------------------+            +----------------------------------------+
| menu --- GET /api/profile/:name -----+--- HTTP --->| Express: claim name / check token      |
| RaidScene: mouse + keys -> inputs ---+--- WS ----->| RaidRoom (thin adapter)                |
|   (Phaser 4 + DOM overlay)           |            |   handlers: validate, enqueue only     |
| SnapshotBuffer: draw at serverNow    |<-- 20 Hz --|   sim/step() every 50 ms (pure)        |
|   minus 100 ms                       |   patches  |   events -> fx / toast / result msgs   |
| generateMap(seed), same as server    |            |   ProfileStore -> stash.json           |
+--------------------------------------+            +----------------------------------------+
```

- **`packages/shared`**: TypeScript source used directly by both sides (no build step). Constants, wire
  messages, the item catalog, the Colyseus schema, and the pure logic both ends must agree on (`generateMap`,
  A* pathfinding, ray casts, snapshot interpolation).
- **`packages/server`**: `RaidRoom` (the Colyseus adapter), `sim/` (the game rules; `arena.ts` owns the run
  lifecycle), `persistence/` (the profile store) and `bots/`.
- **`packages/client`**: `net/` (connection, clock sync, interpolation), `scenes/RaidScene.ts`, `render/` (2.5D
  projection and views) and `ui/` (DOM overlay: menu, HUD, loot, results).

How it fits together:

- **Authoritative server.** Clients send inputs only (`move`, `stop`, `attack`, `take`, `drop`, `use`).
  Positions, damage and outcomes are never accepted from a client.
- **Fixed 20 Hz tick and input queues.** Message handlers validate (finite numbers clamped to the world, short
  ids) and enqueue into a per-player queue: the latest move wins, at most 4 actions per tick, and a client
  sending more than 60 messages a second is disconnected. The sim drains the queues at the start of each 50 ms
  step in a per-tick shuffled order, so same-tick races for an item are fair. A patch goes out after every step.
- **Pure sim.** `sim/` never imports Colyseus or touches sockets. Gameplay modules (loot, combat) register
  actions and systems into a world. `step()` returns events and the room turns them into messages and profile
  changes, so most of the game is tested headless.
- **Arena tick order.** Each tick runs inputs and actions (shuffled), movement, history, the combat/DoT systems,
  sudden death, and last the arena's `settle()`. Every death or leave goes through one function and waits for
  `settle()`, which emits the results, ends the run and runs the patience timer, so the order players happen to
  be processed in never decides who wins.
- **Schema sync.** State uses decorator-free `schema()` builders. Only the server imports the schema at
  runtime; the client imports types and decodes by reflection.
- **The map is never synced.** State carries only the `seed`. Both sides call `generateMap(seed)`, which is
  deterministic (seeded `mulberry32`, no `Math.random` in shared code). Loot is rolled server-side from a
  private RNG, so the seed reveals the layout but not the contents.
- **Render in the past.** Every entity, including the local player, is drawn at `serverNow - 100 ms`
  (`INTERP_DELAY_MS`) by interpolating buffered snapshots against an estimated server clock. There is no
  client prediction.
- **Lag-compensated hitscan.** An attack carries the server time the client was rendering. The server keeps
  about 300 ms of position history per player (`MAX_REWIND_MS`), rewinds targets to that time clamped into the
  window, and tests a ray against them. Walls are static and tested from the shooter's current position.
- **Persistence.** Profiles (GV balance, lifetime GV, GV per UTC month, stats, cosmetics) live in memory and are
  saved to one JSON file (version 2). A version 1 file from the extraction build is migrated on start: stashes
  are dropped, stats and tokens kept, and the original is saved first as `stash.json.bak-v1`. Mutations are
  synchronous; writes are coalesced and atomic (temp file, fsync, rename, directory fsync), retried with
  backoff on failure, and flushed on graceful shutdown. A malformed profile entry is dropped and the original
  kept as `stash.json.bak-<time>`. A file that cannot be parsed at all stops the server from starting and is
  moved to `stash.json.corrupt-<time>` instead of being overwritten. To reset, stop the server and delete it.

When GV banks:

| Event | Effect |
| --- | --- |
| Your run resolves (won, draw, died, left) | Its GV (kills, mobs, win bonus) and stats are saved at once. |
| Leave or disconnect in the lobby | Nothing to save. |
| Graceful server shutdown mid-run | The run is void and not recorded; GV earned so far is paid. |
| Hard kill of the server mid-run | GV earned in that run is lost (see below). |

HTTP: `GET /api/health`; `GET /api/profile/:name`, which claims a free name or returns the profile when the
`x-profile-token` header matches; and `GET /api/leaderboard?month=YYYY-MM&limit=N` (public: names and GV banked
that UTC month).

## Known limitations

Netcode and scale:

- **No interest management.** Every client receives every player's position and inventory and every
  container's contents. A modified client can see all of it, and there is no fog of war. The plan is Colyseus
  `StateView` with per-client add/remove by distance.
- **Mixed timelines on screen.** Positions and effects are drawn 100 ms in the past, but health bars, status,
  containers and the timers show the latest patch, so they can lead what you see by a tick or two. Deaths are
  the exception: a victim stays drawn until their death is due.
- **No client-side prediction.** Your own character is also interpolated, so motion starts at least 100 ms
  after input plus the network round trip.
- **Single process only.** The "profile already in a raid" guard and the profile file are process-local.
- **Lag compensation trusts the client's timestamp** anywhere inside the 300 ms rewind window, so a cheating
  client can pick the most favourable moment. Mitigation: bound it by measured RTT or require it to be
  monotonic. The window only covers clients up to about 150 ms RTT; beyond that, shots at moving targets miss.

Identity and persistence:

- **Profiles are weakly authenticated.** The only credential is a random token in the browser's
  `localStorage`. There are no passwords, recovery, expiry or rotation. Tokens are stored in plain text in the
  profile file and travel unencrypted unless you put TLS in front. Clearing site data forfeits the profile, and
  anyone who copies the token owns its GV.
- **No rate limits.** Matchmaking checks the profile token before it creates a room or reserves a seat, but
  nothing limits how often an authenticated client asks.
- **No rate limit or cap on profile creation.** Any client can call `GET /api/profile/<new name>` as often as
  it likes, and `/api` answers every origin (`Access-Control-Allow-Origin: *`), so any web page can do it.
  Each claim adds a profile and a file rewrite.
- **A hard kill loses the GV of runs in progress.** GV banks when a run resolves, and a graceful shutdown pays
  what was earned so far. SIGKILL, power loss or OOM mid-run loses it.
- The whole JSON file is rewritten on every change, and there is no TLS, logging or metrics. This is a dev
  setup, not a deployment.

Gameplay and content:

- **Placeholder art and balance.** Colored shapes, no audio, ten items, untuned numbers. Weapon choice is
  automatic by highest damage, so a Knife (22) is used in preference to a Pistol (16). There is no ammo,
  weapon switching, equip slots or item stacking.
- **No shop yet.** GV accumulates but there is nothing to spend it on; cosmetics are an empty placeholder.
- **GV can be farmed with a second callsign.** A run counts as contested (win bonus) with two starters, and
  callsigns are free, so a player can feed themselves wins and kills from a second tab. It needs a rule (or
  real accounts) before the leaderboard means anything.
- **The coliseum is a ring of spots, and the gates are a flag.** Until map v2 there is no coliseum geometry: a
  teleport moves everyone to spots around the map centre, nothing stops them walking away, and sudden death
  hits everyone standing while the gates are "locked".
- **No teams, parties or queues.** Every join lands in the first open lobby. Reloading the page mid-run drops
  the connection and cannot resume it (the client reconnects only within the same page session), so the seat
  times out after 10 s and the player is MIA. Loot does not respawn; bodies and empty crates stay.

Client and tooling:

- **Desktop only.** Mouse and keyboard, no touch or gamepad, no rebinding.
- The client has no automated tests.
- The server's private RNG is `Math.random`, which is not cryptographically secure.
