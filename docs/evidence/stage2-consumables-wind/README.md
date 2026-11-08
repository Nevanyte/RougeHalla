# P-CONS-1b: wind emblems and the speed boost (P-CONS-1 remainder, part 1)

## 0. Revisions

- Base: `38697071` (`deepseek/p-cons-1a`, protocol 9). Stacked because this packet adds protocol 10.
- Toolchain: `cargo 1.97.0`, capture container `node:22.23.4-bookworm-slim@sha256:aaa4b5ba…`, linux/amd64.

## 1. Outcome

Port `updateWindEmblems` from `packages/server/src/sim/consumables.ts`: a private, order-salt-derived stream that spawns
walk-over "wind emblem" props on floor tiles away from the existing ones (8-15 s apart, at most 12 up), the nearest
standing player within 30 u and line of sight consuming one (ties by `tieRank`), and the +50% movement for 5 s it
grants through the stat-mirror source, with the source's toast. Emblems never spawn in training, never on their birth
tick, and the boost ends on time or on death. Cannons remain P-CONS-1c.

## 2. Legacy paths verified with `rg`

- `packages/server/src/sim/consumables.ts`: `updateWindEmblems`, `WIND_SPAWN_MIN_MS 8000`, `WIND_SPAWN_MAX_MS 15000`,
  `WIND_EMBLEM_LIMIT 12`, `WIND_PICKUP_RADIUS 30`, `windRandom = mulberry32(world.orderSalt ^ 0x6a2c581f)`, the
  install-time and `raidStarted` timer draws, `bornThisTick`/LoS/tieRank selection, `WIND_EMBLEM_DEF`, the `fighterOut`
  cleanup, and the toast text.
- `packages/shared/src/constants.ts`: `SPEED_BOOST_MS 5000`, `SPEED_BOOST_MULT 1.5`.
- `packages/server/src/sim/world.ts`: `orderSalt` — drawn during initial-world setup, so the stream must be seeded from
  the FINAL value (see the traps).

## 3. Write scope

`crates/rh-sim/src/{state,constants,checkpoint,events,hooks,schedule,item_view,statics}.rs`,
`src/systems/{consumables,wind,initial_loot,potions,mod}.rs`, `src/systems/{wind_tests,consumables_source_tests}.rs`,
`crates/rh-sim/tests/no_alloc.rs`, protocol 10: `crates/rh-protocol/**`, `client-unity/**`,
`crates/rh-server/src/{wire,wire_state}.rs`, `crates/rh-server/web/probe.html`, `tools/protocol-js/**`,
`tools/browser-proof/**`, `protocol/fixtures/v10.json`, `tools/consumable-fixtures/**`, `parity/consumables/source.json`,
this README and the ledger.

## 4. Contracts

- **C-RNG:** one new private stream, `World.wind_rng = Mulberry32(order_salt ^ 0x6a2c581f)`. It is seeded at install
  **after** the order salt is derived by initial-world setup, and the seed derivation is pinned by a unit test. Its state
  is hashed and checkpointed; the legacy probe pins the draw order (install draw, `raidStarted` draw, one timer draw per
  spawn, up to 40 two-draw tile attempts).
- **C-TICK:** the wind update keeps `consumables.updateConsumables`'s slot, before the potion Hot loop, as source.
- **C-OBS:** an emblem is a visible public prop (`PropKind::WindEmblem` / `WirePropKind::WindEmblem`); the pickup toast is
  private to its consumer; the boost reaches clients only as movement.
- **C-DET:** `speed_boost_until`, `wind_next_at` and the RNG state are world leaves, validated and checkpointed.
- **C-NET:** protocol 10 (a new prop kind and the owner-only event) with regenerated vectors and both decoder mirrors.
- **Module gate:** `SimConfig.consumables` (default and serde default true) models the capture worlds' module list; slice
  captures without `state:consumable` install no wind timer, the production capture and the live server do.

## 5. Behaviour to preserve

- No spawn outside the active phase; no pickup of an emblem born this tick.
- The timer is re-armed by one draw whenever it is due, before the 12-emblem cap check; a capped map still consumes it.
- The pickup winner is the nearest eligible player (distance, then `tieRank`); only a standing player inside 30 u with
  line of sight qualifies.
- `speed_boost_until = now + 5000`; the source is `1.5x` while it is in the future and the fighter is alive; it is
  cleared on fighter-out and at expiry, re-folding the mirrors.
- The toast is the source's "Wind emblem · +50% movement for 5s".

## 6. Acceptance checks

- [x] Actual-source probe `parity/consumables/source.json` (pinned container, `tools/consumable-fixtures/capture.sh`):
      **1,600 ticks compared exactly** — every tick's emblem positions and boost clocks (two parked players) plus the
      toast pickups; the Rust `wind_emblems_match_the_source_tick_by_tick` test replays the recorded `orderSalt` and
      compares all 1,600. `--check` matches **byte for byte**.
- [x] `cargo test -p rh-sim systems::consumables_source_tests --lib` — 4 passed (potion, camp, grant refusal, wind).
- [x] `cargo test -p rh-sim systems::wind --lib` — 3 passed: the seed derivation, a due-timer spawn + walk-over pickup +
      system expiry, and the source's 1.5x window.
- [x] `cargo test -p rh-parity --test parity` — 29 passed; the production-module `emblem_during_melee` capture now
      **reproduces its tick-238 emblem** instead of diverging (the old "unported emblem detected" control became a
      positive).
- [x] `cargo test -p rh-sim --all-features --test no_alloc -- --nocapture` — potion Hot 100 steps / 0, camp Hot 67 / 0,
      **wind emblem 120 measured steps, 0 allocations**; the other scenarios opt out of the module they do not model.
- [x] Negative controls: **16/16 mutants killed** (8 potion/camp + 8 wind: seed, raid draw, timer draw count, spacing,
      clearance, boost set, expiry, pickup radius), unchanged control passes.
- [x] Replay determinism: the new world stream is seeded **after** initial-world setup derives the final order salt, so
      the recorded run and its replay draw the same sequence; `cargo test -p rh-headless --test abilities` — 2 passed
      (previously diverged at replay step 0).
- [x] Protocol 10: `cargo test -p rh-protocol` all suites; `node tools/protocol-js/check-vectors.mjs` — 26 server
      vectors, 89 malformed, 10 chains, 15,498 checks against `v10.json`; `dotnet test client-unity/RoguehallaNet.Tests`
      — 272 passed.
- [x] `cargo fmt --all --check`; both strict Clippy workspace modes.
- [x] Content identity: the new wind constants move the content hash to `0x12c3d617f6c33463` (was `0xb9ea06c370690603`);
      the golden and the packet's replay/wire declarations carry it, so older replays are refused as designed.
- [x] `cargo test --workspace --all-features --locked` (throwaway PostgreSQL) — **1,406 passed, 0 failed, 2 ignored,
      151 test binaries, exit 0**.
- [x] `node tools/browser-proof/proof.mjs` — **15/15 checks PASS**, protocol **10**, content hash `12c3d617f6c33463`,
      no page errors.
- [x] The packet's tool changes (`tools/consumable-fixtures/potions.ts`, `run-mutants.sh`, the protocol-10 JS/proof
      mirrors) are protected card-corpus inputs: the catalog → runtime → witness chain is recaptured and all three
      `capture.sh --check` paths pass (expected values unchanged).

## 7. Commands

```sh
tools/consumable-fixtures/capture.sh --check
cargo test -p rh-sim systems::consumables_source_tests --lib
cargo test -p rh-sim systems::wind --lib
cargo test -p rh-sim --all-features --test no_alloc -- --nocapture
cargo test -p rh-parity --test parity
cargo test -p rh-headless --test abilities
tools/consumable-fixtures/run-mutants.sh
cargo test -p rh-protocol
node tools/protocol-js/check-vectors.mjs
node tools/protocol-js/check-first-playable.mjs
dotnet test client-unity/RoguehallaNet.Tests
cargo fmt --all --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo clippy --workspace --all-targets -- -D warnings
eval "$(PGBIN=/opt/homebrew/opt/postgresql@16/bin bash tools/pgtest/start.sh)" && cargo test --workspace --all-features --locked
node tools/browser-proof/proof.mjs
```

## 8. Traps

- The install draw and the `raidStarted` draw both happen before the first spawn; a port that only seeds at raid start
  shifts every later position.
- The order salt is itself drawn by initial-world setup, **after** `World::new`; seeding the wind stream in the world
  constructor (from the provisional salt) makes every replay diverge. The stream is re-seeded from the final salt at
  install, which is also what the replay's start does.
- The cap check happens after the timer draw, so the RNG advances even when no emblem is placed.
- `circle_clear` uses the move mask and `PLAYER_RADIUS`; the three-tile spacing is between emblems only.
- The capture worlds' module lists differ: the slice fixtures install no consumables, so the wind system must be gated by
  `SimConfig.consumables` or it spawns emblems the legacy capture never had.
