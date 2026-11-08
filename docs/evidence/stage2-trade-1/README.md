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
- Corpus: `parity/trade/runtime.json`, 64,709 bytes, SHA256 `a03bfd021997c99e60a1cf1307c34dabef1bd1dd6c1c75d78ecd0818ad0805e1`
  (6 cases); `bash tools/trade-fixtures/capture.sh --check`: PASS (pinned container, byte-identical).
- `cargo test -p rh-sim --lib --all-features -- traders::`: 5 passed (the pinned replay over all six cases, the lockSecondSlot
  refusal/positive-control test, the barter cycle, the rolled-offer rules and the trade-door round trip).
- Content 21/21 with the new golden hash; checkpoint 6/6; hash coverage 6/6 with the new `world.traders` optional-leaf
  reason; ability hash tape reproduces the re-recorded base; schedule conformance and the planning owned-hook cases keep
  their source order (traders ride the recorded `NotTraining` gate and are inert in the non-live corpora).
- Workspace gate: **1,456 passed, 0 failed, 3 ignored, 151 test binaries, exit 0** (with PostgreSQL; the previous 1,452
  plus the four trade tests).
- `cargo clippy --workspace --all-targets --all-features -- -D warnings` and `cargo fmt --all -- --check`: clean.
- Mutants (`bash tools/trade-fixtures/run-mutants.sh`): **6/6 killed, unchanged control passes** — the cost share, the
  walker speed, the used flag, the barter cooldown, the trade-stat fold and the lockSecondSlot refusal. The five pre-existing
  patches were regenerated byte-for-byte against the formatted source (their hunks had gone stale when the P-TRADE-1 slice was
  formatted after the mutant run); every mutation is the same one, only the context lines were refreshed.

## Remaining (exact)

1. **Client transport (coordinator-owned)**: the `trade` wire message is not in protocol 7. The native action is reachable
   through C-INPUT only; the one documented projection site is `rh-server/src/wire.rs` (the same comment as the quest
   accept). `room.rs` keeps the live-content switch off.
2. **Presentation toasts**: the source emits `toast` lines for refusals and trade text; they are presentation transport,
   not sim state, and are not captured.
3. **Trader actor bodies/wire refs**: the two traders are native sim actors with positions/kinds/names, but the
   observer/wire NPC representation for them (actor refs, appearance for the client) is part of the same coordinator-owned
   transport packet (quest giver bodies are in the same boat).
4. ~~Committed card interaction~~ — **ported in the remainder round** (see below): the barter empty-slot search consults the
   player's folded `lockSecondSlot` set through the existing owned-card accessor, which equals the folded FlagSet (the only
   producer is the ungated Committed catalog row).
5. **Source toast wording assertions** are excluded for the same transport reason.

## Remainder round: the Committed `lockSecondSlot` barter refusal

Sources `packages/server/src/sim/traders.ts:87` and `packages/shared/src/cards.ts:289`; isolated branch
`deepseek/p-trade-lock` from `f0d7ae70` (the P-TRADE-1 head). Assessment result: the refusal is obtainable **without any new
serialized field, checkpoint change or fold recompute**. The source's `hasFlag(p, "lockSecondSlot")` is the folded
`FlagSet`; in the port every flag row originates from a `CardRow::Fold(EffectKind::Flag)` in `cards/catalog_data.rs`
(no signature/farm/kill/trade row can produce a flag), and the existing accessor `Build::has_flag` scans exactly those owned
rows — the only `LockSecondSlot` producer is the ungated Committed row. So for every player `Build::has_flag` equals the
folded set, and the trade check uses it.

- `crates/rh-sim/src/traders/runtime.rs` pick 2: the second empty slot is a target only when the flag is off
  (`p.weapon.weapon1.is_none() && !p.build.has_flag(EffectFlag::LockSecondSlot)`), at the source position and check order:
  an `empty == None` refusal happens before the potion is spent or the cooldown set.
- Pinned-container capture (`tools/trade-fixtures/capture.mts`, linux/amd64 Node 22.23.4, unmodified source): the additive
  case `barter-locked-second-slot` grants Committed to p0 through the real `grantCard` producer, gives it a sword and a small
  potion, and picks 2 at the villager → `locked-refused` frame (weapon1 empty, potion kept, no barter cooldown); p1 without
  the card makes the same trade → `unlocked-traded` frame (wand into slot 1, potion spent, cooldown set). The corpus is now
  64,709 bytes / SHA256 `a03bfd02…`, 6 cases; the five pre-existing case records are byte-identical.
- Native replay: the declared `grantCard` action uses the port's real grant producer (`cards::grant`, the same fold/max-hp
  sync) and `potion` sets the declared state field; the replay compares every captured surface.
- `crates/rh-sim/src/traders/tests.rs` focused test `the_committed_flag_refuses_the_second_weapon_barter`: the locked sim
  refuses (slot empty, potion kept, no cooldown) and the unlocked control trades into slot 1 — it fails against the old
  behaviour (negative control), and mutant `06-lock-second-slot-ignored` (the new branch removed) is killed by it/the corpus.
- `cargo test -p rh-sim --lib --all-features -- traders::` 5 passed; `bash tools/trade-fixtures/run-mutants.sh` 6/6 killed with
  the unchanged control; `cargo fmt --all -- --check` and `cargo clippy --workspace --all-targets --all-features --
  -D warnings` clean; `capture.sh --check` byte-identical (both the extended corpus and the data corpus).
- No schema/observation/protocol/Sim-rules/`Cargo.lock`/shared-status change; no fixture weakening; no wire change.
