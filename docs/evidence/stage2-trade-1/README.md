# P-TRADE-1 — neutral traders and per-run stat exchanges

Queue A3b. Sources `packages/shared/src/traders.ts` and `packages/server/src/sim/traders.ts`; dependency P-CARDS-3 (landed).
No packet file exists in the backlog (`docs/backlog/packets/`); the scope below is derived from the backlog row and the two
source files, and the gap is recorded here.

## Scope derived from the source

- **Two neutral villagers** (`spawnTraders`, raid-start hook, install gate `NotTraining`): the barter villager and the Soul
  Broker stat trader, placed at a shuffled slice of an installation-time destination grid (every 4th tile centre, 2 tiles
  in, where a 12-u disc is clear). Walkers move 42 u/s with 12-u segment clearance toward shuffled destinations, stop for
  eight seconds after a visit, and freeze while a player stands within 112 u with line of sight.
- **The stat exchange** (`rollStatTrades`): three fixed offers rolled on first contact from the player's current effective
  stats (cost 12 % of a stat above the 1/0.3 floor, gain 18 % of another with the 60-point flat floor, AP at its folded
  divisor floor 0.1, rounded to 0.1 flat / 0.001 percentage), one trade per player, results folded as farm rows
  (`tradeEffects`: ad/ap/armor/shield flat, maxHp/attackSpeed/moveSpeed stat) through the existing modifiers fold and
  max-hp sync.
- **The barter villager** (`barterWeapons`/`barterLabels`): a stable counter-cycle around the held weapon; three trades
  (weapon → cycle weapon, weapon → small healing potion, potion → cycle second weapon), a five-second per-player cooldown,
  and the source's refusals (no weapon, fists not accepted, no potion, already holding, full pouch, second slot).
- **The trade action** (`handleTrade`, action `trade`): validate/refuse in source order (phase + standing, trader lookup,
  action lock, range 112 + LOS, pick 0..2, used/cooldown, offer existence), then the effects above.
- **Rewards/stat wiring**: the trade stats join the existing fold as farm rows outside the card caps (the same path as
  mobStats and killStats), so the mirrors, max hp and every downstream consumer update through the ported modifiers code.

## Native slice delivered

- `crates/rh-sim/src/traders/`: typed `Kind`/`Stat`/`StatTrade` rules tables (registered as the `traders/1` content table),
  `roll_stat_trades`, `trade_effects`, `barter_weapons`/`barter_labels`, the `Traders` serialized runtime (actors, walker
  paths, barter cooldowns, destination grid, all hashed and checkpoint-validated) and the runtime (raid-start spawn,
  `traders.updateTraders` system, `trade` action handler).
- `RawCommand::Trade`/`Kind::Trade`/`ActionCmd::Trade` through the one C-INPUT door (`validate` + `Sim::submit` with the
  round trip and the source's pick/kind bounds), a player `trade_used`/`trade_offers`/`trade_stats` state, the fold
  integration, checkpoint format `rh-checkpoint/23`, and the ability hash tape re-recorded for the new state layout.
- Enable switch: the traders ride the same live-content switch as the quests (`Gates.quests`); the recorded schedule gate
  stays `NotTraining` (the source install gate), and `rh-server` keeps the switch off (`quests: false`).

## Captured fixtures and parity

- `parity/trade/runtime.json` (`rh-trade-source/1`, 5 cases) captured by `tools/trade-fixtures/capture.mts` in the pinned
  linux/amd64 `node:22.23.4-bookworm-slim@sha256:aaa4b5ba…` container from the unmodified production harness
  (`createGameWorld`, quests on so the native enable switch matches, generated map seed 1 attempt 0, floor random
  `mulberry32(12)`, reward salt `[1,2,3,4]`). Cases:
  1. `spawn` — both villagers, names/kinds/positions, the destination-grid digest and their walk clocks;
  2. `wander` — 200 ticks of pure walking with nobody near (the walker path and the f32-quantized positions);
  3. `stat-offer` — a visitor freezes the broker and rolls the three offers once; moving 400+ u away does not reroll;
  4. `stat-trade` — one pick applies the stat deltas (mirrors/max hp/fold), a second trade is refused as used;
  5. `barter` — sword → cycle weapon, immediate cooldown refusal, after five seconds weapon → potion, potion → cycle second
     weapon, and the fists refusal.
- Native replay: `crates/rh-sim/src/traders/tests.rs` regenerates the same map, replays every recorded action through the
  real C-INPUT door and compares every captured surface per frame (traders, walk clocks, destination digest, cooldowns,
  weapons/potions, mirrors, max hp, offers, stats).

## Measurements

- Content hash: `e2399d02688ed977` (the new `TRADER_*`/`TRADE_*` registry rows plus the `traders/1` table).
- Corpus: `parity/trade/runtime.json`, 56,679 bytes, SHA256 `b241a85bfc03f2d0ab2e9e89939b1485eb47cc2db71cfd334abd9981711cddea`
  (5 cases); `bash tools/trade-fixtures/capture.sh --check`: PASS (pinned container, byte-identical).
- Workspace gate: GATE_TBD.
- Mutants (`bash tools/trade-fixtures/run-mutants.sh`): **5/5 killed, unchanged control passes** — the cost share, the
  walker speed, the used flag, the barter cooldown and the trade-stat fold.

## Remaining (exact)

1. **Client transport (coordinator-owned)**: the `trade` wire message is not in protocol 7. The native action is reachable
   through C-INPUT only; the one documented projection site is `rh-server/src/wire.rs` (the same comment as the quest
   accept). `room.rs` keeps the live-content switch off.
2. **Presentation toasts**: the source emits `toast` lines for refusals and trade text; they are presentation transport,
   not sim state, and are not captured.
3. **Trader actor bodies/wire refs**: the two traders are native sim actors with positions/kinds/names, but the
   observer/wire NPC representation for them (actor refs, appearance for the client) is part of the same coordinator-owned
   transport packet (quest giver bodies are in the same boat).
4. **Committed card interaction**: the source's `lockSecondSlot` flag (the Committed card) refuses the second barter slot.
   The folded flags are not retained on the modifier runtime yet (P-CARDS-1 fold), so the barter empty-slot search does not
   consult it; every other refusal is ported.
5. **Source toast wording assertions** are excluded for the same transport reason.
