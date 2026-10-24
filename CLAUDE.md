# CLAUDE.md — raid-br

Top-down 2.5D roguelike battle arena skeleton: last one standing wins Glorious Victory (GV, cosmetics-only). Phaser 4 client, Colyseus 0.18 authoritative server, npm workspaces monorepo. Colored shapes only.

## Commands
```
npm install            # once, at the root
npm run dev            # server :2567 + client :5173 (concurrently)
npm test               # vitest in every workspace (server includes the e2e bot run)
npm run typecheck      # tsc --noEmit in every workspace
npm run bots -- 3      # 3 headless bots join the running dev server
npm run bots -- -- 3 --url http://host:2567   # flags (--url, --prefix, --loop to keep queuing, --verbose) need the second `--`: the root script nests npm, which eats them
npm run harness -w @raid/server               # weapon duel harness (report only, never fails; ~1 min); add `-- --quick` for a few seconds
```
Server env overrides (see `packages/server/src/config.ts`): `RAID_PORT`, `STASH_FILE` (the profile file; the name predates profiles v2), `MIN_PLAYERS`, `LOBBY_SECONDS`, `FILL_SECONDS`, `PATIENCE_SECONDS` (at 8 alive), `PATIENCE_MIN_SECONDS` (at ≤3 alive), `SUDDEN_DEATH_SECONDS`, `COLYSEUS_LATENCY` (simulated ms), `DUMMIES=1` (training dummies and a weapon rack next to every spawn).

## Layout
- `packages/shared` — TS source consumed directly (no build). Contracts + pure logic used by both sides:
  `constants.ts`, `schema.ts` (Colyseus state; import via `@raid/shared/schema`), `messages.ts`, `factions.ts` (faction sheet + damage law),
  `weapons.ts` (catalog, faction × weapon formula, timings), `interactions.ts` (shield/stagger/ball-vs-arrow rules), `policies.ts` (how to play each weapon: bots, harness, later mobs),
  `map.ts` (map types/helpers), `mapgen.ts`, `rng.ts`, `pathfind.ts`, `geometry.ts`, `interp.ts`.
- `packages/server` — `src/index.ts` (`defineServer`, HTTP API), `rooms/RaidRoom.ts` (thin adapter), `sim/` (pure game logic;
  `arena.ts` owns the run lifecycle, `step.ts` the tick order), combat: `combatant.ts` (players and mobs as one thing), `weapons.ts` (state machines),
  `projectiles.ts`, `melee.ts`, `ledger.ts` (per-tick damage ledger), `mobs.ts` (training dummies; Phase 11 mobs go here), `loot.ts` (weapon pickups);
  `persistence/ProfileStore.ts` (profiles v2: GV, stats, cosmetics; migrates v1 stash files),
  `bots/` (`BotClient`: a headless player that sends inputs only; `runBots` is its CLI), `harness/` (headless weapon duels: `runHarness` CLI, matrix, report, parity with the Python model).
  Tests in `test/`; `e2e.test.ts` plays a whole run with four bots.
- `packages/client` — `net/` (connection, clock sync, interpolation), `scenes/RaidScene.ts`, `render/` (2.5D projection; player, mob, projectile, fx and container views),
  `ui/` (DOM overlay: menu, HUD, weapon bar, results).

## Architecture rules (do not break)
- **Authoritative server.** Clients send inputs only (`move`, `stop`, `aim`, `attack`, `release`, `swap`, `pickup`). Never accept positions, damage, or outcomes from a client. Apart from a walk target, the numbers it supplies are aim angles and a render time `t` (clamped to `MAX_REWIND_MS`).
- **Fixed 20 Hz tick.** Message handlers validate and enqueue; they never mutate game state. The sim consumes input queues at the start of each fixed 50 ms step.
- **Sim is pure.** `server/src/sim/*` must not import `@colyseus/core` or touch clients/sockets. It mutates the schema state + a non-synced runtime struct and returns events. The Room converts events into messages and persistence. Test the sim headless.
- **The ledger, one way down, one place to settle.** Every hit (projectile sweep, melee) is recorded in the per-tick damage ledger (`sim/ledger.ts`, `recordHit`) and applied all at once after melee: mitigated per victim, then `applyHits`/`applyDamage` for a player (`sim/arena.ts`) or `damageMob` for a mob. Sudden death calls `applyDamage` itself. Every exit from the fight (death, leave) goes through `downPlayer`. In-tick results come only from `settle()` at the end of the tick, so the shuffled input order never decides a winner: a fighter killed this tick still lands what it started, simultaneous hits on one victim land together and the kill goes to the largest rival hit, and simultaneous last deaths go to the higher hp fraction at tick start (an exact tie draws).
- **Tick order is fixed** (`sim/step.ts`; do not reorder): inputs (players shuffled, then mobs) → weapon state machines → movement → history → projectile sweep (present time, 10 ms substeps) → spawns → melee (rewound) → ledger → systems → sudden death → settle.
- **Combat netcode.** Projectiles are synced once at spawn and never updated: clients fly them from `(x, y, vx, vy, t)` and a `projEnd` fx says where and why they stopped. Melee samples the attacker and every target at the attacker's render time (`rewindT`). A projectile leaves from the shooter's rewound (drawn) position, and aim angles are measured from where the client draws its own player. Keep those three consistent.
- **Players and mobs fight through `Combatant`** (`sim/combatant.ts`): weapons, melee, projectiles and the ledger take either; only how they go down differs.
- **GV banks at resolve.** The sim only accumulates run GV and reports it in `resolved` results; the Room banks it (`recordRun`, or `bankGv` for a run voided by shutdown). Run gear never persists.
- **The map is never synced.** Only `seed` is in state; both sides call `generateMap(seed)` (must stay deterministic: use `rng.ts`, never `Math.random`, in shared). Loot contents are rolled server-side with a non-public RNG.
- **Clients render in the past.** Remote and local entities render at `serverNow − INTERP_DELAY_MS` via `SnapshotBuffer` (shared/interp.ts). No client-side prediction yet.
- **Rendering is separate from logic.** Phaser scenes only read interpolated state and send inputs. Projection lives in `client/src/render/projection.ts` (screenY = worldY · Y_SCALE, height drawn upward, depth = worldY).

## Conventions
- Colyseus 0.18 APIs (not 0.15/0.16 tutorials): `defineServer/defineRoom` from `@colyseus/core`, `Room<{ state: X }>`, `messages = { ... }` or `this.onMessage`, `setSimulationInterval`, `client.sessionId` (no `client.id`), client `@colyseus/sdk` + `Callbacks.get(room)`.
- Schema uses the decorator-free `schema({ ... }, "Name")` + `t.*` builders. Give primitives `.default(...)`. No decorators anywhere.
- Only the server imports `@raid/shared/schema` at runtime; the client uses `import type` from it (it decodes by reflection).
- All tunables live in `shared/src/constants.ts`, `weapons.ts` or `factions.ts`. Units: world units (1 tile = `TILE` = 32), seconds for durations unless a name ends in `Ms`, server time in ms.
- Weapon numbers live in `shared/src/weapons.ts`: the v3 faction × weapon formula (a weapon is a % boost on the faction's rate; `attackInterval`, `damagePerHit`, `backlashPerSwing`). It must keep matching `testing/realtime.py`: `python3 testing/weapon_reference.py` prints the reference tables, pasted into `shared/test/weapons.test.ts` and `server/src/harness/parity.ts` when the design numbers change. `DUEL_PACE` (2) multiplies every faction damage number (not hp; Sentenced's mark ramp by k²) through `pacedFaction`; sim combat reads the paced sheet through `factionOf` (`sim/combatant.ts`), never the raw one.
- Design rules the sheet left open are recorded in `docs/GAME_DESIGN.md` 9.4. Change them there and in the tests together.
- No `Math.random` in shared code. No enums or decorators (keeps tsx/Vite/TS7 happy).
- Keep comments sparse; explain *why*, not *what*.

## Known TODOs (keep this list honest)
- Interest management: everyone receives every player's weapons, every container's contents, every mob and every projectile, wherever they are. Plan: `StateView` + `.view()` fields, per-client add/remove by distance each tick.
- Facing is synced for everyone at up to 20 Hz per player (every `aim` input patches `facing`, and `maxMessagesPerSecond` is 100 to allow it). Part of the same interest-management work; a per-client view would cut it.
- No client-side prediction for the local player (0.18 has `Predict`/`room.input()` if needed).
- Single process only: the "profile already in a raid" guard and the stash file are process-local.
- No rate limit on matchmaking (it does verify the profile token before creating a room or reserving a seat, via the static `RaidRoom.onAuth`).
- HP/status/containers/timers render at the latest patch while positions/fx are 100 ms behind (deaths are held back to match).
- Lag compensation (melee rewind and the shooter's drawn position) trusts the client's `t` anywhere inside `[now − MAX_REWIND_MS, last published tick]`. A cheating client can pick the most favourable `t` in that 300 ms window (a wand ball can come from up to ~500 ms back: its origin is taken when the cast starts and it leaves 0.2 s later). Mitigation: bound `t` per client by measured RTT, or require it to be monotonic.
- `MAX_REWIND_MS = 300` fully covers clients up to ~150 ms RTT (render delay 100 ms + RTT + one tick). Beyond that, swings at moving targets start to miss (projectiles fly in present time and are not rewound).
- GV banks when a player's run resolves. A graceful shutdown (SIGTERM/SIGINT, uncaught exception) pays the GV earned so far; a hard kill (SIGKILL, power loss, OOM) mid-run loses it.
- Gates: the server's `collisionMap(world)` returns `withGates(world.map)` while `state.gatesLocked`, so movement, line of fire and loot line of sight are sealed. `coliseumSpots` hands out mapgen's coliseum inner spawns. Sudden death still hits everyone standing while locked.
- Room creation blocks the event loop: `RaidRoom.onCreate` calls `generateMap` synchronously. A map costs about 17 ms on average (worst case reaches about 96 ms on seeds that need 4-5 attempts, e.g. 732, 2547, 3129), roughly 9x the old generator, and the first map on a process takes about 70 ms because it also builds the lane tables (about 17 MB, kept for the process), on the client too. Mitigation: generate off the event loop (worker) or pre-generate the next seed.
- Spawn walking distance is uneven: spawns within `MAX_SIGHT_CORRIDOR` of each other are screened against the sim's ranged hit cone (every aim ray passing within `RANGED_HIT_REACH` of the other's centre meets a wall first), but walking distance from spawns to the coliseum centre varies a lot (max/min per map is 1.54 mean, 3.07 worst). The owner's target is 1.2. Meeting it needs spawn selection reworked around walking-distance targets.
- Sight corridors narrower than one tile are not capped. Mapgen guarantees the 480 u limit for 32 u strips only; 24 u strips measured up to 473 u and 16 u strips up to about 580 u. A 24 u gap holds a player (`PLAYER_RADIUS` 12). The owner deferred guaranteeing these.
- GV can be farmed with free callsigns: the win bonus needs 3+ starters and damage on 2+ different opponents (WIN_BONUS_MIN_*), but two throwaway callsigns that get killed still pay kills and the bonus. Bounties are uncapped and mob kills feed them (0.25 each): once Phase 11 mobs exist, a colluding partner could cash a mob-farmed bounty far above GV_WIN. Both are owner decisions.
- GV earned after a player's result went out is dropped (`awardGv`). A projectile outlives its owner and its hit still lands; a kill by a shooter who left or whose result is out is credited by name only (`killedBy`), with no GV and no bounty.
- Sentenced deals about 4 per hit (bow 4.1 at duel pace, up to about 6 with the axe) until the Phase 10 mark exists, so its duels run for minutes.
- Faction is a round-robin default by join order (`defaultFaction`) until the Phase 10 picker; a failed join or a lobby leave still uses up a slot.
- The weapon harness (`npm run harness -w @raid/server`) found things for the owner; nothing was retuned. Bow > Sword is inverted at 8% (the designed winner wins 8%; the sword staggers the bow about 70 times a duel). Wand > Bow holds (100%) only against a standing bow; against a strafing or kiting bow the wand wins 0%. Shields shut out sword and bow at 100% hp (Shield > Sword and Shield > Bow end with the shield untouched).
- The plan's "HP scale 550–2000" was not applied: the faction sheet's 500–1750 is used.
- Profile creation has no rate limit or cap: any client can `GET /api/profile/<new name>` as often as it likes, and `/api` answers every origin (`Access-Control-Allow-Origin: *`) so any web page can do it. Each claim adds a profile and a file rewrite.
