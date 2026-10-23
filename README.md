# Raid BR

A top-down 2.5D extraction battle royale skeleton. Up to 8 players drop into a procedurally generated map,
loot crates, shoot each other, and try to reach an extraction zone before a shrinking circle and the raid
timer get them. What you carry out goes into a persistent stash. What you die with stays on your body for
someone else to take.

It is a skeleton. It has an authoritative server, a thin renderer-only client, shared contracts, a persistent
stash, and a test suite. It does not have accounts, matchmaking, sound, balance, or art: everything is colored
shapes, there are ten items, and the numbers are placeholders. See [Known limitations](#known-limitations).

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

A callsign (2 to 16 letters, digits, `_` or `-`) is a profile. The first load of an unused name claims it and
puts a starter kit (Knife, Bandage, Watch) in its stash. The server hands back a token that the client keeps in
`localStorage` as `raid.token.<callsign>`, and every later load proves ownership with it. Without `?profile=`
a tab starts with a random `op-xxxx` name; edit it and press Load to claim one. A tab remembers its callsign
in `sessionStorage`, so a reload keeps it.

Tabs in the same browser share `localStorage`, so two tabs can load the same callsign, but a profile can be in
only one raid at a time ("profile already in a raid"). A second browser, a private window, or cleared site data
does not have the token, and the menu will say the callsign is taken. There is no in-game recovery for that.

## The raid loop

1. **Menu.** Load a callsign to see its stash and stats. Click stash items to add them to your loadout (up to 6;
   the menu shows the value at risk), then press Start Raid. Items leave the stash the moment you join.
2. **Lobby.** You stand on a spawn point while the HUD counts down. The timer starts when the first player
   joins and lasts `LOBBY_SECONDS` (30). Once `MIN_PLAYERS` (2) are in, the remaining wait is cut to at most
   `FILL_SECONDS` (5). Eight players start it at once. If the timer runs out with fewer than `MIN_PLAYERS`
   the raid still starts with whoever is there, so a solo raid is possible.
3. **Raid.** The room locks and everyone is moved to a distinct random spawn. The raid lasts `RAID_SECONDS`
   (360). Loot crates and floor items, fight, and head for one of the three extraction zones.
4. **The zone.** A circle that starts covering the whole map shrinks in five stages (each holds, then closes)
   onto one randomly chosen extraction zone. Standing outside it costs 6 hp/s times the stage number. The
   stages use the first 85% of the raid, and the final circle (radius 96) holds for the rest.
5. **Outcome.** Extract (press `X` inside a zone and stay put for 5 s), die (shot, or killed by the zone), or be
   alive when the timer ends, which counts as missing in action. Dying or going MIA loses everything you
   carried: it drops in a lootable body. Extracting banks everything you carry, including loot you picked up.
6. **Results.** The results screen lists what you brought in, what came home, and what was lost, with the net
   stash value. Back to menu reloads the stash. A dead player sees "YOU DIED" for 1.5 s and then the results
   while the raid continues for everyone else.

Leaving or dropping in the lobby removes you at once and refunds the loadout. A dropped connection mid-raid
keeps your seat for 10 s (the client retries for about 8 s); after that you are MIA.

## Controls

| Input | Action |
| --- | --- |
| Right-click (hold) | Walk to that point. The server pathfinds; holding re-sends the target every 100 ms. Unreachable points are ignored. |
| Left-click (hold) or `Q` | Attack toward the cursor with the best weapon you carry. Holding repeats; the server enforces the cooldown. `Q` fires at the last cursor position. |
| `F` | Open or close the loot panel for the highlighted container (crate, floor item or body) within 56 units and line of sight. Click Take per item. |
| `1`-`6` or click a slot | Use the item in that inventory slot. Only healing items do anything. |
| `Shift+1`-`6` or Shift+click a slot | Drop that item on the ground. |
| `X` | Start extracting. You must be inside an extraction zone. |
| `S` | Stop walking. Also cancels extraction. |
| `Esc` | Close the loot panel. |

Moving, stopping or attacking cancels an extraction in progress. Shortcuts are ignored while a text field has
focus. There is no equip step: the highest-damage weapon and highest-reduction armor you carry are used
automatically, and the HUD shows which. With no weapon you fight with fists.

Items: Knife (22 dmg, melee), Pistol (16 dmg, range 260), Rifle (28 dmg, range 400); Vest and Plate (absorb
25% and 45%); Bandage and Medkit (heal 25 and 60, consumed); Watch, Gold Bar and GPU (value 50, 200, 400, no
other use). Crates hold 1 to 3 items. Floor items never include the rifle, plate or GPU.

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

The end-to-end tests start their own server on a free port with a temporary stash file, so they are safe to run
while `npm run dev` is up and never touch your real stash. `tsx watch` restarts the server when server or shared
source changes. A restart is a graceful shutdown: raiders still alive get their brought-in items back and the
raid is not recorded.

**Bots.** The bots (`packages/server/src/bots/`) are headless clients that use the same profile API and input
messages as the browser and play a simple loop: heal, fight, loot, walk to an extract. They join the same lobby
as everyone else, so the normal start rules apply. Press Start Raid in your tab first, then run
`npm run bots -- 3`: the bots arrive in your lobby and the raid starts after the fill window. If the bots go
first, two or more of them reach `MIN_PLAYERS` and start a raid `FILL_SECONDS` later without waiting for you.
Raise `FILL_SECONDS` or `LOBBY_SECONDS` for more time to join. Flags: `--loop` (queue again after each raid),
`--url`, `--prefix`, `--verbose`.

### Server environment variables

Set them on the command line, for example `MIN_PLAYERS=1 FILL_SECONDS=1 RAID_SECONDS=90 npm run dev` for fast
solo testing. A missing or non-numeric value falls back to the default. Defined in
`packages/server/src/config.ts` and `packages/shared/src/constants.ts`.

| Variable | Default | Meaning |
| --- | --- | --- |
| `RAID_PORT` | `2567` | Port the server listens on. |
| `STASH_FILE` | `packages/server/data/stash.json` | Where profiles and stashes are saved (git-ignored). |
| `MIN_PLAYERS` | `2` | Players needed before the lobby wait is cut to `FILL_SECONDS`. |
| `LOBBY_SECONDS` | `30` | Lobby wait, counted from the first join. |
| `FILL_SECONDS` | `5` | Longest wait left once `MIN_PLAYERS` have joined. |
| `RAID_SECONDS` | `360` | Raid length. The zone timeline scales with it. |
| `EXTRACT_SECONDS` | `5` | Time to stand in a zone. The HUD countdown assumes the default 5. |
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
| generateMap(seed), same as server    |            |   StashStore -> stash.json             |
+--------------------------------------+            +----------------------------------------+
```

- **`packages/shared`**: TypeScript source used directly by both sides (no build step). Constants, wire
  messages, the item catalog, the Colyseus schema, and the pure logic both ends must agree on (`generateMap`,
  A* pathfinding, ray casts, zone planning, snapshot interpolation).
- **`packages/server`**: `RaidRoom` (the Colyseus adapter), `sim/` (the game rules), `persistence/` (the stash
  store) and `bots/`.
- **`packages/client`**: `net/` (connection, clock sync, interpolation), `scenes/RaidScene.ts`, `render/` (2.5D
  projection and views) and `ui/` (DOM overlay: menu, HUD, loot, results).

How it fits together:

- **Authoritative server.** Clients send inputs only (`move`, `stop`, `attack`, `take`, `drop`, `use`,
  `extract`). Positions, damage and outcomes are never accepted from a client.
- **Fixed 20 Hz tick and input queues.** Message handlers validate (finite numbers clamped to the world, short
  ids) and enqueue into a per-player queue: the latest move wins, at most 4 actions per tick, and a client
  sending more than 60 messages a second is disconnected. The sim drains the queues at the start of each 50 ms
  step in a per-tick shuffled order, so same-tick races for an item are fair. A patch goes out after every step.
- **Pure sim.** `sim/` never imports Colyseus or touches sockets. Gameplay modules (loot, combat, extraction,
  zone) register actions and systems into a world. `step()` returns events and the room turns them into
  messages and stash changes, so most of the game is tested headless.
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
- **Persistence.** Profiles and stashes live in memory and are saved to one JSON file. Mutations are
  synchronous; writes are coalesced and atomic (temp file, fsync, rename, directory fsync), retried with
  backoff on failure, and flushed on graceful shutdown. A malformed profile entry is dropped and the original
  kept as `stash.json.bak-<time>`. A file that cannot be parsed at all stops the server from starting and is
  moved to `stash.json.corrupt-<time>` instead of being overwritten. To reset, stop the server and delete it.

Where items cross the stash boundary:

| Event | Effect |
| --- | --- |
| Join | The loadout leaves the stash immediately. |
| Leave or disconnect in the lobby | The loadout is refunded. |
| Extract | Everything carried, loot included, goes to the stash. |
| Die, or alive when the timer ends | Everything carried drops in a body. Nothing returns. |
| Graceful server shutdown mid-raid | Brought-in items still carried are refunded; looted ones are gone. |
| Hard kill of the server mid-raid | Brought-in items are lost (see below). |

HTTP: `GET /api/health`, and `GET /api/profile/:name`, which claims a free name or returns the profile when the
`x-profile-token` header matches.

## Known limitations

Netcode and scale:

- **No interest management.** Every client receives every player's position and inventory and every
  container's contents. A modified client can see all of it, and there is no fog of war. The plan is Colyseus
  `StateView` with per-client add/remove by distance.
- **Mixed timelines on screen.** Positions and effects are drawn 100 ms in the past, but health bars, status
  (extracted/MIA), containers and the zone show the latest patch, so they can lead what you see by a tick or
  two. Deaths are the exception: a victim stays drawn until their death is due.
- **No client-side prediction.** Your own character is also interpolated, so motion starts at least 100 ms
  after input plus the network round trip.
- **Single process only.** The "profile already in a raid" guard and the stash file are process-local.
- **Lag compensation trusts the client's timestamp** anywhere inside the 300 ms rewind window, so a cheating
  client can pick the most favourable moment. Mitigation: bound it by measured RTT or require it to be
  monotonic. The window only covers clients up to about 150 ms RTT; beyond that, shots at moving targets miss.

Identity and persistence:

- **Profiles are weakly authenticated.** The only credential is a random token in the browser's
  `localStorage`. There are no passwords, recovery, expiry or rotation. Tokens are stored in plain text in the
  stash file and travel unencrypted unless you put TLS in front. Clearing site data forfeits the profile, and
  anyone who copies the token owns the stash.
- **No rate limits.** Matchmaking checks the profile token before it creates a room or reserves a seat, but
  nothing limits how often an authenticated client asks.
- **No rate limit or cap on profile creation.** Any client can call `GET /api/profile/<new name>` as often as
  it likes, and `/api` answers every origin (`Access-Control-Allow-Origin: *`), so any web page can do it.
  Each claim adds a profile, a starter kit and a stash-file rewrite.
- **A hard kill loses loadouts.** Only a graceful shutdown (SIGTERM, SIGINT, uncaught exception) hands a
  raider's items back. SIGKILL, power loss or OOM mid-raid loses them: the items left the stash on disk at join
  and nothing records that they are out.
- The whole JSON file is rewritten on every change, and there is no TLS, logging or metrics. This is a dev
  setup, not a deployment.

Gameplay and content:

- **Placeholder art and balance.** Colored shapes, no audio, ten items, untuned numbers. Weapon choice is
  automatic by highest damage, so a Knife (22) is used in preference to a Pistol (16). There is no ammo,
  weapon switching, equip slots or item stacking.
- **No economy or progression.** Item value is only a score. The starter kit is granted once, when the
  callsign is claimed, so a player who loses everything fights with fists.
- **No teams, parties or queues.** Every join lands in the first open lobby. Reloading the page mid-raid drops
  the connection and cannot resume it (the client reconnects only within the same page session), so the seat
  times out after 10 s and the player is MIA. Loot does not respawn; bodies and empty crates stay.

Client and tooling:

- **Desktop only.** Mouse and keyboard, no touch or gamepad, no rebinding.
- The client has no automated tests, and its HUD extraction countdown assumes the default `EXTRACT_SECONDS`.
- The server's private RNG is `Math.random`, which is not cryptographically secure.
