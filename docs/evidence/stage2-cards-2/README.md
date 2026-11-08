# P-CARDS-2: camp/stat chests and the chest-drop consumer chain (slice DONE-VERIFIED)

Stacked PR: [P-CARDS-2]() -> `deepseek/p-mobs-1` @ `039ceb47` (line A: cards -> faction -> abil -> terrain -> mobs).
Commits `bd5ba81a`..`COMMITS_TBD`.

Phase: the cards/rewards slice of [ORDER_OF_OPERATIONS](../../ORDER_OF_OPERATIONS.md) phase 1 serving the backlog row
[P-CARDS-2](../../backlog/README.md) ("Camp chests, `choose`, augments, stat chests/crates, chest boosts, skip heal/GV").

**Coordinator-owned gap: there is no `docs/backlog/packets/P-CARDS-2.md`.** The row is the only packet record, so this
slice's scope was derived from the row text, the P-CARDS-1 evidence's open items, and the actual legacy
`packages/server/src/sim/chests.ts`, `shared/rewards.ts`, `shared/chestBoosts.ts` and `camps.ts` before writing.

## What the base already had (verified by P-CARDS-1, consumed here, not redone)

The pure reward machinery was landed by P-CARDS-1 on this base and is re-verified by the full gate: the interactive pool
and exact tiered draw protocol (`reward_chests::pools`, 30 pool + 181 roll cases), the `choose` transaction with the
source refusal order and toast tape, the skip's heal/GV split, the owner-private trophy refusal, the stat-crate first-open
producer (`items.rs` -> `drop_stat`), and the eight chest-boost gains through the accepted stat fold (the captured
`fold-*` stages). What was missing was the **production wiring of the source drop chain** and an actual-source witness of
it end to end.

## What this slice adds

1. **The `mobKilled` chests link at its recorded chain position** (`crates/rh-sim/src/schedule.rs` `MOB_KILLED`, flipped
   from Pending P-CARDS-2 to `reward_chests::on_mob_killed`; C-TICK, no reorder): a credited elite's death drops the camp's
   shared augment chest through the existing exact draw protocol with the source's eligible pickers (the camp contributor
   snapshot filtered to the standing players inside the camp territory or within `CAMP_HEAL_RANGE`), at the camp's chest
   tile or its centre when that tile is solid (source `chestSpot`), camp-tagged, with the source expiry and birth hold.
   A campless elite (a training/dummy death) drops at its body with no eligible pickers, as the source does. The P-MOBS-1
   inline stand-in in `mob_life::pay` is removed: the drop now runs inside the chainable hook, before the quests link, at
   the source producer's position.
2. **The contributor snapshot crosses the hook boundary**: `HookArgs::MobKilled` carries the elite's camp contributor set
   (the source `snapshotElitePickers` taken in `hurtMob` before a clear forgets them), because the payout-time chest link
   runs after the ledger pass. The trusted probe witness ignores the new transient argument; no serialized state, hash,
   checkpoint, protocol or observation change is involved.
3. **The stat-crate first-open chain is certified from the source**: the pinned corpus opens the source-picked stat crate
   through the real pickup action, watches the actual `dropStatChest` producer drop its three distinct boosts with three
   reward draws, and picks one through the real `choose` seam (the boost count, folded mirrors/sums and max HP compared).
4. **A pinned-container actual-source corpus and native consumer**: `parity/chests/runtime.json` (5 cases: card pick,
   card pick with a held-pool exclusion, skip's GV path, skip's heal path after the lockout, stat-crate boost pick) from
   `tools/chest-fixtures/capture.mts` in the pinned linux/amd64 Node 22.23.4 container, with passive hook observers and
   declared placements/picks only. The native comparison replays each case through ordinary fixed steps and checks the
   chest rows (id/entity counter, position, camp, expiry, options, taken, pickers), the camp rows, the chest holder's
   build/boosts/mirrors/sums/max-hp, the reward-stream draw count and continuation, and the chest-domain events
   (chest taken, refusals, heals, GV) — including another player's "Already taken" refusal and the held-by-all pool
   exclusion that makes the eligible-picker wiring observable.
5. **Five committed mutants with a runner** (`tools/chest-fixtures/mutants/`, `run-mutants.sh`): option index offset,
   skip-heal share drift, boost-pick stat drift, eligible pickers ignoring the contributor snapshot, and a chest that
   loses its camp tag. Each fails the captured comparison semantically; the unchanged control passes.

## Source finding recorded for the coordinator

The elite **chest** drop is the source `mobKilled` hook link, not `campCleared`: `chests.ts install` chains
`chainHook(world, "mobKilled", ...)`, and `world.ts` says "Elite chests use mobKilled". `camps.ts`'s header comment that
says the chest drops in the `campCleared` hook is stale; the actual `campCleared` chain is `campHeal.payCampHeal`
(P-MOBS-2), quests (P-QUEST-1) and bruiser passives (P-FACTION-5). This slice therefore chained onto the P-MOBS-1
`mobKilled` producer on this base; the `campCleared` producer remains available to its real consumers.

## Measurements

- `cargo test --workspace --all-features --locked` (throwaway PostgreSQL): **1,431 passed, 0 failed, 3 ignored, 151 test
  binaries, exit 0** (the base `039ceb47` gate plus the new captured-chest consumer).
- `cargo test -p rh-sim --lib --all-features chest_runtime`: **1 passed** (the 5-case captured corpus consumer).
- `bash tools/chest-fixtures/capture.sh --check`: **PASS** — 5 cases, byte-identical replay in the pinned container.
- `bash tools/chest-fixtures/run-mutants.sh`: **5/5 mutants killed; unchanged control passes**.
- `cargo test -p rh-parity --test schedule`: **14 passed** (no phase or hook-chain reorder; the remaining consumers keep
  their packets).
- `cargo fmt --all -- --check` and `cargo clippy --workspace --all-targets --all-features -- -D warnings`: clean.
- No wire/protocol, content-hash, checkpoint or observation change: `HookArgs` is transient, the corpus and tools are
  new files, and no serialized field was added, so the ability hash tape and content hash stay unchanged.

## Still missing / follow-ups

- **The packet file itself** (`docs/backlog/packets/P-CARDS-2.md`) is coordinator-owned and absent; the row above is the
  whole textual acceptance record for this slice.
- **`buffs.expireBoosts` is still Pending and tagged P-CARDS-2** in the schedule: it is the G6 barrier (Second Skin's
  heal-barrier grant, lifetime and decay) consumer, not a chest mechanic. It shares no code with this slice and needs a
  packet home (the row text does not name it). Its heal-granted barrier path also depends on the faction heal funnel's
  unported `healBarrier` slice.
- The source's **`rewardOffered`/`rewardChosen` telemetry taps** are not ported: they are server-observation hooks (the
  source's telemetry module chains them), not gameplay. The chest state and the public events this slice produces carry
  the gameplay facts; a telemetry packet can chain the same facts later.
- The **campless-elite branch is ported but not exercised** by the corpus: only the training console creates a campless
  elite (P-ARENA-2), and the pinned capture profile has no training room. The branch mirrors the source line for line.
- Coordinator/CI: wiring `tools/chest-fixtures/capture.sh --check` into the capture CI set, the backlog/status records and
  the PR body/stack records.

## Commands

```sh
cargo test -p rh-sim --lib --all-features chest_runtime
cargo test -p rh-sim --lib --all-features reward_chests
CARGO=$HOME/.codex/tools/rougehalla-stage2/cargo/bin/cargo bash tools/chest-fixtures/run-mutants.sh
bash tools/chest-fixtures/capture.sh --check
cargo test -p rh-parity --test schedule
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
export PGBIN=/opt/homebrew/opt/postgresql@16/bin
eval "$(bash tools/pgtest/start.sh)" && cargo test --workspace --all-features --locked
```

No `DEVIATIONS.md` row; `docs/MIGRATION.md`, the `docs/CONTRACTS.md` status table and `Cargo.lock` are untouched.
