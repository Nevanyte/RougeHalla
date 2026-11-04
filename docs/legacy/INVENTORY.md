# Legacy Roguehalla inventory (scout, verified against code at HEAD 75c5b83)

Evidence = path:line from code. Where docs differ from code, section 9 lists it. Code wins. Not exhaustive; excerpt-verified only (no tests run).

## 1. Player flows
| Flow | Behavior (owner) |
|---|---|
| Hub | Client-only walkable scene, no room (`client/src/scenes/HubScene.ts`, `hub/`); data from REST profile. |
| Profile claim/token | `GET /api/profile/:name` claims a free name, returns random token (`randomUUID`, `server/src/persistence/ProfileStore.ts:652`); token kept in browser localStorage per origin. Sign-in link `/?profile=n#key=token` (`client/src/net/signin.ts`). Other routes: `POST /api/profile/:name/purchase|equip`, `GET /api/leaderboard`, `/api/health`, `/readyz` (`server/src/index.ts:366-516`). `PROFILE_RE` name validation in shared. |
| Matchmaking | Arena = `joinOrCreate("raid")`, training = `create("training")` (`shared/constants.ts` ROOM_NAME/TRAINING_ROOM_NAME); mode forced by server handler options. `JoinOptions {profile, token, faction?, mode?, passcode?, build?}` (`shared/messages.ts:387`). Static `RaidRoom.onAuth`: passcode, wire-build check (426), token. `ActiveProfiles` (`RaidRoom.ts`, created `index.ts:336`) blocks same profile in two rooms. |
| Lobby | `LOBBY_SECONDS` 30, `LOBBY_FILL_SECONDS` 5 (cut when >= `MIN_PLAYERS_TO_START` 2 humans), `MAX_PLAYERS` 8 (`constants.ts:129-134`). Bots never open/close lobby; top-up at last moment (`sim/step.ts updateLobby`, `bots/BotManager.ts`). `BOTS_FILL_TO` default 8 (`config.ts:159`). |
| Planning | `PLAN_SECONDS` 45 (`constants.ts:152`; env override). Room locked, no movement; private `plan` deal of 2 spawns; ready early-ends (`sim/planning.ts`). Leaving = MIA (counts as run + death, 0 GV). |
| Active run | 20 Hz. `WISH_LOCK_SECONDS` 45 (Wish locked after start). Win = last standing; same-tick tie -> higher hp fraction at tick start, exact tie = draw. `GV_WIN` 50 (withheld unless >=3 human starters and damage on >=2 humans, `WIN_BONUS_MIN_PLAYERS` 3). |
| Coliseum teleport | CODE: schedule `COLISEUM_FIRST_SECONDS` 600, `SECOND` 900, `REPEAT` 120, `MIN_GAP` 30 (`constants.ts:164-168`). Old patience timer (`PATIENCE_SECONDS` 300, `PATIENCE_MIN_SECONDS` 120, `FIRST_PATIENCE_SECONDS` 300, full at 8 alive / min at <=3) only when dev sets it or `COLISEUM_SCHEDULE=0` (README.md:215). 1.5 s teleport immunity; gates lock; projectiles cleared; mobs reset. |
| Sudden death | `SUDDEN_DEATH_SECONDS` 60 in coliseum; true-damage burn ledger entry (`constants.ts:181-185`, `sim/arena.ts`). |
| Death/results | `downPlayer` -> `resolved` result -> `client.send("result")` (`RaidRoom.ts:487`); `ENDED_LINGER_SECONDS` 5; results survive a drop for reconnect. |
| GV banking | Sim accumulates; Room banks at resolve via `recordRun`/`bankGv` (`persistence/ProfileStore.ts`). Bots never touch persistence. Shutdown: `bankVoided` pays earned GV, no result. |
| Disconnect | `allowReconnection(client, RECONNECT_SECONDS=10)` (`RaidRoom.ts:479`, `constants.ts:135`); heartbeat `beat` message, drop after `LIVENESS_TIMEOUT_MS` 4500 (sweep 1000 ms, close code 4010). Run: body stays, hittable. Lobby: no seat held. Training: freed at once. |
| Termination | last standing; all leave; shutdown voids (nothing recorded, `abandonPlayer`); training idle `TRAINING_IDLE_SECONDS` 300. |

## 2. Systems (one line, owner)
- Movement/pathfinding/masks: `shared/pathfind.ts`, `map.ts` (MASK_SIGHT/MOVE/MELEE), `sim/movement.ts`, `shared/walk.ts` (ice). Prediction client-only `client/src/net/localMotion.ts`.
- Target lock (wand only in client): `sim/targeting.ts`, `TARGET_RANGE` 640 (`constants.ts:406`).
- Weapons (sword, bow, wand, shield, axe, fists): `shared/weapons.ts:94-128`; state machines `sim/weapons.ts`. Reach/range: sword arc 112 (pi/2 total), bow arrow range 520 speed 900, wand ball range 640 speed 380, shield arc 96, axe arc 112 (pi), fists arc 72 (pi*2/3 total). Windups: `BOW_WINDUP` 0.5 (share .55), `WAND_WINDUP` 0.45 (.5), NPC variants 0.6/0.4; `FISTS_WINDUP` 0 (player melee zero windup per CLAUDE.md "live playtest"; NPC fists 0.1) (`weapons.ts:235-251`).
- Factions (fire, sentenced, plague, frost, holy) + signatures: `shared/factions.ts`, `signatures.ts`, `sim/factions.ts`.
- Ledger/damage law/PvP factor/guards G1-G13: `sim/ledger.ts`, `shared/rules.ts`, `constants.ts`.
- Statuses/Wishes: `shared/status.ts`, `abilities.ts`, `sim/status.ts`, `sim/abilities.ts`, `fields.ts`, `displace.ts`.
- Mobs/camps/elites/rosters/respawn: `shared/mobs.ts`, `rosters.ts`, `sim/mobLife.ts`, `camps.ts`, `mobAI.ts`; `CAMP_RESPAWN_MS` 180000.
- Mob stat progression: `shared/mobStats.ts` (`MOB_KILL_STACKS` 3), `PlayerState.mobStats`.
- Chests/augments: `sim/chests.ts`, `shared/cards.ts`, `rewards.ts`; elite chests interactive augments; `CHEST_SECONDS` 15, `CHEST_RANGE` 96.
- Consumables/potions/cannons: `sim/consumables.ts`, `shared/consumables.ts`. Traders: `sim/traders.ts`.
- Quests: `shared/quests.ts`, `sim/quests.ts`. Plague corpses/zombies: `shared/plagueCorpses.ts`. Sentenced hunt: `docs/SENTENCED_HUNT.md`. Fire roam: `docs/FIRE_ROAM.md`. Bruiser passives: `docs/BRUISER_PASSIVES.md`. (Locate sim files via rg; not individually verified.)
- Vision/bushes: `shared/vision.ts`, `sim/vision.ts`, `shared/bushes.ts`; `VISION_RADIUS` 900.
- Terrain hazards: `shared/terrain.ts`, `sim/terrainEffects.ts`. Loot/crates: `sim/loot.ts`, `lootTables.ts`.
- Map generator: `shared/mapgen.ts`, `zones.ts`, `zoneStyle/*`; pool `server/src/mapPool.ts` + `mapWorker.ts`.
- Telemetry: `sim/telemetry.ts`, `server/src/telemetry/`, `shared/telemetry.ts`, `deployment/cloudflare/src/telemetry/`.
- Bots: `server/src/bots/` (brain, BotManager, BotClient, tournament); personas farmer/hunter/opportunist/cautious, tiers easy/normal/hard.
- Training console: `sim/training.ts`, `shared/training.ts` (`train` cmds card/stat/camp/chest/clear).
- Cosmetics/shop/achievements/leaderboard: `shared/cosmetics.ts`, `achievements.ts`, `ProfileStore.ts`.

## 3. Current numbers (code)
| Item | Value | Source |
|---|---|---|
| Tick | 20 Hz (50 ms) | `constants.ts:11` |
| Map | 160x160 tiles, TILE 32 u, world 5120 u | `constants.ts:45-54` |
| Camps/zone, elites/zone | 10, 2 (5 zones: 50 camps, 10 elites) | `shared/zones.ts:37,39` |
| Mobs/map | ~184-217 (CLAUDE.md; not recounted) | |
| Roster bag copies | 3 | `rosters.ts:18` |
| Mob hp/dmg mult | x2 / x0.5; elite x2.0 / x1.5 more | `constants.ts:495-514` |
| GV | mob 6, elite 30, win 50 | `constants.ts:194-208` |
| Player speed / radius | 170 u/s / 12 | `constants.ts:67,62` |
| Vision radius | 900 u | `constants.ts:69` |
| MAX_REWIND_MS | 300 | `constants.ts:40` |
| Max players | 8; min to start 2 | `constants.ts:129-130` |
| Lobby/fill/plan | 30 / 5 / 45 s | |
| Coliseum | 600, 900, then every 120 s; min gap 30 | |
| Sudden death | 60 s | |
| Reconnect grace | 10 s | |
| Camp respawn | 180 s | |

## 4. Random sources
Public vs secret.
| Source | Where | Visibility |
|---|---|---|
| Map seed `randomInt(0,2^31)` | `server/src/mapPool.ts:128` | PUBLIC (synced `seed`, `attempt`, `mapHash`); generator streams `mulberry32(hashSeed(...))` in `shared/rng.ts`, `mapgen.ts`, `styler.ts`, `zoneStyle/*`, `bushes.ts` deterministic from seed |
| `world.random` = `Math.random` | `RaidRoom.ts:357` (passed to `createWorld`; one draw -> `orderSalt`, `world.ts:901`; loot rolls use it) | SECRET-ish (unseeded) |
| `orderSalt` (actionOrder, `tieRank`) | `sim/world.ts:901,1083` | SECRET; leakable via staged ties (CLAUDE.md Known TODO) |
| `rewardRandom` (rosters, plan deals, chest options) | salt = `randomBytes(16)` `RaidRoom.ts:359`; `world.ts:920` | SECRET stream, but roster outputs are published |
| `hashSalt` (Gambler, `saltedUnit`) | `world.ts:921` mixed from rewardSalt | SECRET |
| `questRandom` | salt `randomBytes(16)` `RaidRoom.ts:362`; `world.ts:922` | SECRET |
| Bot seed | `randomInt(0,2^32)` `RaidRoom.ts:371` (or `BOTS_SEED`) | server-only |
| `newItemUid` | `randomUUID` `world.ts:913` | ids public |
| Profile token | `randomUUID` `ProfileStore.ts:652` | secret |
| Telemetry run/batch ids | `randomUUID` `telemetry/runtime.ts:92`, `sink.ts:166` | server |
| `Math.random` elsewhere | only `bots/runBots.ts:194` (CLI tooling), `client/src/net/lobby.ts:25` (tab id fallback). Shared code has none (`rng.ts` comment). | |
A port must keep: separate streams for reward/quest/hash, crypto-seeded, and never derive from the public map seed.

## 5. Public vs private state
- Synced to ALL clients (Colyseus schema, `shared/schema.ts`; 11 schema classes: ItemState, PlayerExtraState (7 fields), PlayerState (~69 `t.` fields incl. extras overflow past Colyseus 63-field limit), MobState, CampState, FieldState, ContainerState, QuestState, PlagueCorpseState, TraderState, RaidState). All positions, hp, containers (incl. chest options), mobs, camps, public quests, roster. No interest management (Known TODO).
- Private messages: `plan` (own spawn deal), `questReveal` (finder only), `vision` (reconnect trail), `result`, `toast`.
- Server-only: hidden quest offers/givers/items, reward/quest/hash salts, statuses/casts (bits synced via `effects`), fill-bot internals, walk caches, telemetry. Map tiles are never synced (rebuilt from seed+attempt, checked by `mapHash`).
- Per-client vision gating of actors is client-side culling plus server cast gating (`sim/vision.ts`), not network filtering.

## 6. Messages
Client->server `CLIENT_MESSAGE_TYPES` (`shared/messages.ts:136`): `move{x,y,seq?}`, `stop{seq?}`, `target{id}`, `aim{a}`, `attack{a,t?}`, `release{a,t?}`, `swap{slot?}`, `pickup{containerId}`, `plan{spawn?,boon?,ready?}`, `cast{slot,x,y,id?,t?,seq?}`, `choose{chest,pick,replace?}`, `train{cmd,...}` (training only), `questAccept{quest}`, `attackMove`, `consumeCorpse{corpseId}`, `huntTarget{id}`, `useConsumable{kind:"heal"}`, `trade{trader,pick}`, `beat{n?}`. (`move/stop/target/attackMove` field detail: read messages.ts:50-60.)
Rate limits: order bucket `ORDER_BURST` 30 / `ORDER_PER_SECOND` 15 (everything but `aim`/`beat`); `MAX_MESSAGES_PER_SECOND` 200.
Server->client `ServerMessages` (`messages.ts:369`): `fxs` (compact tuple batch, `fxCodec.ts`, roster-indexed), `toast`, `result`, `plan`, `questReveal`, `vision`. `chestTaken` is an fx kind 19, not a message. fx code tables append-only.
Join: 426 if wire-build differs (SHA-256 of `packages/shared/src`).

## 7. Hosting
- Production: Cloudflare Worker (`deployment/cloudflare/src/index.ts`, name `rougehalla`, route `play.roguehalla.com`) serves client from ASSETS (`packages/client/dist`, `run_worker_first`), proxies `/matchmake` + websockets to a **Container** (`PublicGameContainer`, Durable Object class with sqlite, image built from root `Dockerfile`) running the Node Colyseus server (`wrangler.jsonc`). Single container instance = single process.
- Durable Objects: `GameContainer`/`PublicGameContainer` (container lifecycle, `containerLifecycle.ts`), `TelemetryStore` (SQLite, telemetry). R2 bucket `PROFILES` (`rougehalla-profiles`) holds `profiles/current.json` snapshot (`profileSnapshots.ts`, version 2, max 8 MB, bearer `PROFILE_SNAPSHOT_TOKEN` >=32 chars). Worker endpoints `/_internal/profiles` and `/_internal/bot-learning`; container gets `PROFILE_SNAPSHOT_URL`, `BOT_STATS_SNAPSHOT_URL`. Rate limit `MATCHMAKE_LIMITER` 30/10 s per IP. `PROFILE_EPOCH` var guards migrations. Telemetry: ingest to R2 + DO, dashboard behind `DASHBOARD_TOKEN`.
- Persistence shape: in-container `ProfileStore` JSON file (`STASH_FILE`, default `server/data/stash.json`), single-writer `.lock`, atomic writes, coalesced 1/s; mirrored remotely as one JSON snapshot object `{version:2, profiles:{name:{name, token, gv, stats, cosmetics, achievements,...}}}` to R2 (initializeRemoteSnapshot, `server/src/index.ts:565-607`). Whole-file snapshot, last-writer-wins: single-instance assumption.
- Single-process assumptions: `ActiveProfiles`, profile file, rooms/limits counters, map pool worker, lobby snapshot, bot-stats file.
- Scripts (`package.json`): `deploy` = `cf:deploy` (build + `scripts/cf-deploy.mjs`), `deploy:status` = wrangler deployments status, `deploy:check`; the macOS launchd flow is `deploy:local*`. `deploy:auto:status/stop` still exist pointing at deploy-watch. Others: `playtest`, `build` (client+server+cloud-meta), `cf:typecheck`, `cf:test`.
- Also `docs/CLOUDFLARE_PUBLIC.md` (not read).

## 8. Licensing / assets
- No LICENSE file at repo root (`ls LICENSE*` fails). All 4 package.json files (`/`, shared, server, client) have `"private": true` and no `license` field. Treat as all-rights-reserved/unlicensed; ask owner.
- Client assets: no fonts, images or audio files in `packages/client` (only index.html, src ts/css, test/dev html). Font stack is system fonts (`index.html:17`); art is procedural Graphics/baked textures ("colored shapes only"). No third-party fonts found (no @font-face/@fontsource hits). Third-party code deps: Phaser 4, Colyseus 0.18, wrangler, vitest etc. (licenses not audited). `Unfinished code/` top-level dir exists (contents not inspected).

## 9. Stale-doc discrepancies
| Doc says | Code says |
|---|---|
| CLAUDE.md: PLAN_SECONDS 12 | `constants.ts:152` = 45; README says 45 |
| CLAUDE.md: patience timer drives teleport (300 s, min 40%) | Coliseum schedule 600/900/+120 s is default (`constants.ts:164`, README:215); patience min is 120 s absolute, not 40% |
| CLAUDE.md: map 136x136 in many sections; "8 camps a zone"; roster bag "twice" | 160x160, 10 camps, 3 copies (header paragraph is right, deeper sections stale) |
| CLAUDE.md: quests = 10 offers (5 known) | code: `QUEST_COUNT` 20, `QUEST_KNOWN_COUNT` 10 (`constants.ts:621-623`); README correct |
| CLAUDE.md: quest GV cap 40 in one place, 50 in another | README: 50 |
| CLAUDE.md: CLIENT_MESSAGE_TYPES list omits | code adds `attackMove`, `consumeCorpse`, `huntTarget`, `useConsumable`, `trade`, `beat` |
| CLAUDE.md: `train` cmds card/camp/chest/clear | code also `stat` |
| CLAUDE.md: sword/fists windup 0.1 s; BOW 0.6, WAND 0.4 | player `FISTS_WINDUP` 0, BOW 0.5, WAND 0.45; 0.6/0.4 are NPC (`weapons.ts:235-251`) |
| CLAUDE.md Commands: `npm run deploy` = local launchd release, `deploy:auto` | `deploy` = Cloudflare `cf:deploy`; local flow renamed `deploy:local*` |
| CLAUDE.md: Colyseus-only/quick-tunnel hosting is primary | production is Cloudflare Container + R2 snapshots |
| CLAUDE.md: PlayerState "63-field limit" | PlayerState has extras; ~69 `t.` lines counted in `schema.ts:39-166` (includes nested/array fields) |
| CLAUDE.md: `PLAYER_SPEED` 170 matches; heartbeat/liveness not mentioned | `beat`, `LIVENESS_TIMEOUT_MS` 4500 exist |
