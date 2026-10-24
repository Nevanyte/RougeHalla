# CLAUDE.md — raid-br

Top-down 2.5D roguelike battle arena skeleton: last one standing wins Glorious Victory (GV, cosmetics-only). Phaser 4 client, Colyseus 0.18 authoritative server, npm workspaces monorepo. Colored shapes only.

## Commands
```
npm install            # once, at the root
npm run dev            # server :2567 + client :5173 (concurrently)
npm test               # vitest in every workspace (server includes the e2e bot run)
npm run typecheck      # tsc --noEmit in every workspace
npm run bots -- 3      # 3 headless bots join the running dev server (also: --url, --prefix, --loop to keep queuing, --verbose)
```
Server env overrides (see `packages/server/src/config.ts`): `RAID_PORT`, `STASH_FILE` (the profile file; the name predates profiles v2), `MIN_PLAYERS`, `LOBBY_SECONDS`, `FILL_SECONDS`, `PATIENCE_SECONDS` (at 8 alive), `PATIENCE_MIN_SECONDS` (at ≤3 alive), `SUDDEN_DEATH_SECONDS`, `COLYSEUS_LATENCY` (simulated ms).

## Layout
- `packages/shared` — TS source consumed directly (no build). Contracts + pure logic used by both sides:
  `constants.ts`, `schema.ts` (Colyseus state; import via `@raid/shared/schema`), `messages.ts`, `items.ts`,
  `map.ts` (map types/helpers), `mapgen.ts`, `rng.ts`, `pathfind.ts`, `geometry.ts`, `interp.ts`,
  `cosmetics.ts` (the cosmetics catalog, slots and the packed `look` word), `achievements.ts` (achievement goals, pure).
- `packages/server` — `src/index.ts` (`defineServer`, HTTP API), `rooms/RaidRoom.ts` (thin adapter), `sim/` (pure game logic;
  `arena.ts` owns the run lifecycle), `persistence/ProfileStore.ts` (profiles v2: GV, stats, cosmetics; migrates v1 stash files),
  `bots/` (`BotClient`: a headless player that sends inputs only; `runBots` is its CLI). Tests in `test/`; `e2e.test.ts` plays a whole run with four bots.
- `packages/client` — `net/` (connection, clock sync, interpolation), `scenes/RaidScene.ts`, `render/` (2.5D projection), `ui/` (DOM overlay: menu, HUD, loot, results).

## Architecture rules (do not break)
- **Authoritative server.** Clients send inputs only (`move`, `stop`, `attack`, `take`, `drop`, `use`). Never accept positions, damage, or outcomes from a client.
- **Fixed 20 Hz tick.** Message handlers validate and enqueue; they never mutate game state. The sim consumes input queues at the start of each fixed 50 ms step.
- **Sim is pure.** `server/src/sim/*` must not import `@colyseus/core` or touch clients/sockets. It mutates the schema state + a non-synced runtime struct and returns events. The Room converts events into messages and persistence. Test the sim headless.
- **One way down, one place to settle.** All damage goes through `applyDamage` and every exit from the fight (death, leave) through `downPlayer` (`sim/arena.ts`). In-tick results come only from `settle()` at the end of the tick, after combat/DoT, so the shuffled action order never decides a winner (simultaneous last deaths: higher hp fraction at tick start wins, an exact tie draws).
- **The shop is server-only.** Purchases and equips are `POST /api/profile/:name/purchase|equip` with the profile token; the client sends only a cosmetic id (and a slot). `ProfileStore.purchase/equip` check the token, the catalog price, ownership and the balance in one synchronous step (no `await` between check and change), so a double spend is impossible. Spending lowers `gv` only, never `gvLifetime` or `gvByMonth` (the leaderboard ranks GV earned). Achievements are evaluated inside `recordRun`; an id lands in `achievements` once and its reward cosmetics are granted in the same step. Win achievements and the per-faction/weapon counters count only `winQualified` wins (the win-bonus gate: `!winBonusWithheld`), so a walkover against a throwaway callsign earns nothing; kill and bounty achievements are not gated (their rewards are unpriced; an owner decision). The leaderboard ranking is cached per month (dropped when GV is credited in it), and `you` on `GET /api/leaderboard` is sent only with that profile's own token. Equipped cosmetics reach other players as one synced `PlayerState.look` word, fixed at join.
- **GV banks at resolve.** The sim only accumulates run GV and reports it in `resolved` results; the Room banks it (`recordRun`, or `bankGv` for a run voided by shutdown). Run gear never persists.
- **The map is never synced.** Only `seed` is in state; both sides call `generateMap(seed)` (must stay deterministic: use `rng.ts`, never `Math.random`, in shared). Loot contents are rolled server-side with a non-public RNG.
- **Clients render in the past.** Remote and local entities render at `serverNow − INTERP_DELAY_MS` via `SnapshotBuffer` (shared/interp.ts). No client-side prediction yet.
- **Rendering is separate from logic.** Phaser scenes only read interpolated state and send inputs. Projection lives in `client/src/render/projection.ts` (screenY = worldY · Y_SCALE, height drawn upward, depth = worldY).

## Conventions
- Colyseus 0.18 APIs (not 0.15/0.16 tutorials): `defineServer/defineRoom` from `@colyseus/core`, `Room<{ state: X }>`, `messages = { ... }` or `this.onMessage`, `setSimulationInterval`, `client.sessionId` (no `client.id`), client `@colyseus/sdk` + `Callbacks.get(room)`.
- Schema uses the decorator-free `schema({ ... }, "Name")` + `t.*` builders. Give primitives `.default(...)`. No decorators anywhere.
- Only the server imports `@raid/shared/schema` at runtime; the client uses `import type` from it (it decodes by reflection).
- All tunables live in `shared/src/constants.ts` or the item catalog. Units: world units (1 tile = `TILE` = 32), seconds for durations unless a name ends in `Ms`, server time in ms.
- No `Math.random` in shared code. No enums or decorators (keeps tsx/Vite/TS7 happy).
- Keep comments sparse; explain *why*, not *what*.

## Known TODOs (keep this list honest)
- Interest management: everyone receives every player's inventory and every container's contents. Plan: `StateView` + `.view()` fields, per-client add/remove by distance each tick.
- No client-side prediction for the local player (0.18 has `Predict`/`room.input()` if needed).
- Single process only: the "profile already in a raid" guard and the stash file are process-local.
- No rate limit on matchmaking (it does verify the profile token before creating a room or reserving a seat, via the static `RaidRoom.onAuth`).
- HP/status/containers/timers render at the latest patch while positions/fx are 100 ms behind (deaths are held back to match).
- Lag compensation trusts the client's `t` anywhere inside `[now − MAX_REWIND_MS, last published tick]`. A cheating client can pick the most favourable `t` in that 300 ms window. Mitigation: bound `t` per client by measured RTT, or require it to be monotonic.
- `MAX_REWIND_MS = 300` fully covers clients up to ~150 ms RTT (render delay 100 ms + RTT + one tick). Beyond that, shots at moving targets start to miss.
- GV banks when a player's run resolves. A graceful shutdown (SIGTERM/SIGINT, uncaught exception) pays the GV earned so far; a hard kill (SIGKILL, power loss, OOM) mid-run loses it.
- Gates: the server's `collisionMap(world)` returns `withGates(world.map)` while `state.gatesLocked`, so movement, line of fire and loot line of sight are sealed. `coliseumSpots` hands out mapgen's coliseum inner spawns. Sudden death still hits everyone standing while locked.
- Room creation blocks the event loop: `RaidRoom.onCreate` calls `generateMap` synchronously. A map costs about 17 ms on average (worst case reaches about 96 ms on seeds that need 4-5 attempts, e.g. 732, 2547, 3129), roughly 9x the old generator, and the first map on a process takes about 70 ms because it also builds the lane tables (about 17 MB, kept for the process), on the client too. Mitigation: generate off the event loop (worker) or pre-generate the next seed.
- Spawn walking distance is uneven: spawns within `MAX_SIGHT_CORRIDOR` of each other are screened against the sim's ranged hit cone (every aim ray passing within `RANGED_HIT_REACH` of the other's centre meets a wall first), but walking distance from spawns to the coliseum centre varies a lot (max/min per map is 1.54 mean, 3.07 worst). The owner's target is 1.2. Meeting it needs spawn selection reworked around walking-distance targets.
- Sight corridors narrower than one tile are not capped. Mapgen guarantees the 480 u limit for 32 u strips only; 24 u strips measured up to 473 u and 16 u strips up to about 580 u. A 24 u gap holds a player (`PLAYER_RADIUS` 12). The owner deferred guaranteeing these.
- GV can be farmed with free callsigns: the win bonus needs 3+ starters and damage on 2+ different opponents (WIN_BONUS_MIN_*), but two throwaway callsigns that get killed still pay kills and the bonus. Bounties are uncapped and mob kills feed them (0.25 each): once Phase 11 mobs exist, a colluding partner could cash a mob-farmed bounty far above GV_WIN. Both are owner decisions.
- GV earned after a player's result went out is dropped (`awardGv`). Harmless with hitscan; Phase 9 projectiles that kill after their owner died need a rule. They must also be cleared in `hooks.teleported`.
- Meta layer (Phase 12 stage A): golden variants and the per-faction / per-weapon win achievements need the run's faction and weapon. Until the sim reports them, `RaidRoom.settle` passes neither to `recordRun` (so those counters stay 0) and nothing calls `PlayerView.setUsing` (so no gold is drawn in a run). Wire both when factions and weapons are in the state.
- Meta layer: the shop and equip endpoints have no rate limit (like profile creation), and a purchase is answered once it is in memory, before the file write lands: a hard kill in that window undoes the purchase together with its GV debit (the file is a consistent snapshot), never one without the other.
- Meta layer: "bounty claimed" counts runs that paid bounty GV (`progress.bountyRuns`), not individual claims. There is no end-of-month trophy job: the leaderboard keeps each month, and nothing is awarded when a month closes.
- Profile creation has no rate limit or cap: any client can `GET /api/profile/<new name>` as often as it likes, and `/api` answers every origin (`Access-Control-Allow-Origin: *`) so any web page can do it. Each claim adds a profile and a file rewrite.
