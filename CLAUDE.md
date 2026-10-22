# CLAUDE.md — raid-br

Top-down 2.5D extraction battle royale skeleton. Phaser 4 client, Colyseus 0.18 authoritative server, npm workspaces monorepo. Colored shapes only.

## Commands
```
npm install            # once, at the root
npm run dev            # server :2567 + client :5173 (concurrently)
npm test               # vitest in every workspace (server includes the e2e bot raid)
npm run typecheck      # tsc --noEmit in every workspace
npm run bots -- 3      # 3 headless bots join the running dev server
```
Server env overrides (see `packages/server/src/config.ts`): `RAID_PORT`, `STASH_FILE`, `MIN_PLAYERS`, `LOBBY_SECONDS`, `FILL_SECONDS`, `RAID_SECONDS`, `EXTRACT_SECONDS`, `COLYSEUS_LATENCY` (simulated ms).

## Layout
- `packages/shared` — TS source consumed directly (no build). Contracts + pure logic used by both sides:
  `constants.ts`, `schema.ts` (Colyseus state; import via `@raid/shared/schema`), `messages.ts`, `items.ts`,
  `map.ts` (map types/helpers), `mapgen.ts`, `rng.ts`, `pathfind.ts`, `geometry.ts`, `interp.ts`, `zone.ts`.
- `packages/server` — `src/index.ts` (`defineServer`), `rooms/RaidRoom.ts` (thin adapter), `sim/` (pure game logic),
  `persistence/StashStore.ts`, `bots/` (headless clients). Tests in `test/`.
- `packages/client` — `net/` (connection, clock sync, interpolation), `scenes/RaidScene.ts`, `render/` (2.5D projection), `ui/` (DOM overlay: menu, HUD, loot, results).

## Architecture rules (do not break)
- **Authoritative server.** Clients send inputs only (`move`, `stop`, `attack`, `take`, `drop`, `use`, `extract`). Never accept positions, damage, or outcomes from a client.
- **Fixed 20 Hz tick.** Message handlers validate and enqueue; they never mutate game state. The sim consumes input queues at the start of each fixed 50 ms step.
- **Sim is pure.** `server/src/sim/*` must not import `@colyseus/core` or touch clients/sockets. It mutates the schema state + a non-synced runtime struct and returns events. The Room converts events into messages and persistence. Test the sim headless.
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
- Lag compensation trusts the client's `t` anywhere inside `[now − MAX_REWIND_MS, last published tick]`. A cheating client can pick the most favourable `t` in that 300 ms window. Mitigation: bound `t` per client by measured RTT, or require it to be monotonic.
- `MAX_REWIND_MS = 300` fully covers clients up to ~150 ms RTT (render delay 100 ms + RTT + one tick). Beyond that, shots at moving targets start to miss.
