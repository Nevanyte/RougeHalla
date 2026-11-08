# P-COMBAT-4 loot world: the authoritative loot consumers are wired, the full legacy loot world remains incomplete

Phase: the loot-world row of the backlog ([P-COMBAT-4](../../backlog/README.md): "Loot world: weapon crates, ground
spots, bodies drop weapons, loot tables, holdBirth". No packet file exists; this scope was derived from the backlog row
and the legacy `packages/server/src/sim/loot.ts`/`lootTables.ts` code (code wins). Branch `deepseek/p-combat-4`,
created from and targeting `deepseek/p-mobs-1` at `039ceb47` (line A: content/faction/abil/terrain/mobs, protocol 7).
This branch contains no other packet's changes. Ledger row: [`docs/evidence/deepseek-rust/PROGRESS.md`](../deepseek-rust/PROGRESS.md).

## Assessment before writing (code and git, not memory)

Reading the current code at `039ceb47` found most of the loot world already integrated by P-COMBAT-1 and the
initial-world first-playable integration:

1. **Constructor loot already ported and verified**: `crates/rh-sim/src/initial_world/` builds the actual
   `spawnLoot` containers (one crate per crate spot holding a small potion, the discarded chest weapon draw, the
   ground-spot 25% loose-weapon roll, the three stat-crate ranks from the salted hash) with the source random-call
   order, and `parity/initial-world/source.json` (6 captured cases incl. full seed1 salts, repeat, small map,
   training, planning) compares it. This is the loot-table + crate/ground-spot spawn contract.
2. **Container state and the runtime consumers already ported**: `crates/rh-sim/src/systems/items.rs` has the
   `pickup` action handler (reach, refuse order, stat-crate first opening, potion, ground-vanish, chest/body props),
   `swap`, `drop_weapon`, the replace-drop, the `dropBody` hook link creating `ContainerKind::Body` with the carried
   weapons and small potions, and the born-tick gate (`Container.born_tick`, legacy `bornThisTick`). The
   `parity/initial-loot/source.json` runtime corpus already covers chest pickup/open and the small-potion path.
   `holdBirth`'s effective behaviour is folded into the container birth schedule: a container made between ticks is
   blocked through the next tick, and a chest made inside a tick is held one extra tick (the legacy camp-chest
   producer's `holdBirth`); its remaining callers are reward containers (`chests.ts`, `killAugments.ts`), whose
   producer packets are separate.
3. **Real gap found**: legacy `loot.ts::handlePickup` (line 167) and `weapons.ts::handleSwap` (line 160) read
   `hasFlag(p, "lockSecondSlot")` — Committed (a live P-CARDS-1 card, `EffectFlag::LockSecondSlot`) must keep the
   second weapon slot empty and the hand's replace rule must drop into the hand instead. The port passed `false` in
   both call sites, so a Committed player could fill and swap into the locked slot.
4. **Missing witness**: no captured actual-source corpus exercised the runtime pickup/swap/replace-drop, the
   body-drop contents, the born wait or the Committed rule; the existing runtime corpus was potion-focused.

## What this slice changes

- `crates/rh-sim/src/systems/items.rs`: `swap` and `pickup`/`take` now read
  `players[..].build.has_flag(stat_fold::EffectFlag::LockSecondSlot)` and pass it to the shared slot rules — the
  legacy source lines above, at the same positions (no schedule, phase or action-order change; C-TICK untouched).
- `parity/loot-world/source.json` (`rh-loot-world-source/1`, 6 cases, 36 frames, 64,511 bytes, SHA256
  `e44463dc1c2186626131a70f2ffe3de9911d5d270d676bbd5980ee504386b9b4`): a pinned-container actual-source witness
  (Linux amd64 Node 22.23.4, image digest `aaa4b5ba…`) for the loot world runtime, captured by
  `tools/loot-world-fixtures/capture.sh` and byte-compared by `--check`. Declared input extends the existing
  `parity/initial-loot/input-map.json` map with twelve declared ground spots (floor tiles; no map regeneration).
  The cases, all through genuine `enqueueClientMessage` input and ordinary 50 ms steps, cover:
  `ground-spawn-free-hand`, `second-slot-then-replace-with-born-drop`, `committed-lock-second-slot`,
  `body-drop-and-pickup`, `hold-birth-chest-and-between-tick-ground`, `swap-basic`. Every frame records the
  run counters, item uids, player state, containers (kind/position/opened/items/stat offer), owner toasts and the
  private main/reward/quest stream tails. The capture additionally asserts the actual spawnLoot container order and
  rolls (`c1` chest potion, `c2` ground sword, `c3` ground axe, `c4` ground sword), the replace-drop birth
  refusal, the held/between-tick waits and the body contents.
- `crates/rh-sim/src/systems/loot_world_tests.rs`: the native consumer replays each case from the real constructor
  (`initial_loot` world: same map/ground spots/secrets, actual `spawnLoot` allocation), the actual `cards::grant`
  for Committed, the actual `remove_player` departure, and the same declared setup containers, comparing every frame
  bit-exactly (numbers by bit pattern), every container/item/counter and the RNG stream states. It also carries two
  in-test mutation guards: omitting the Committed grant and forcing a body's birth tick to zero must each fail the
  comparison.
- `docs/evidence/stage2-combat-4/mutants.json` records two external mutant controls on the production wiring:
  pickup ignoring the flag (M1) and swap ignoring it (M2) each fail the parity test; the restored code passes.

No serialized state, schedule row position/order, content constant, checkpoint/replay/observation layout or protocol
changed: the flag already exists in the P-CARDS-1 stat fold, `Container.born_tick`/items are pre-existing serialized
state, and no client facts were added. Wire rule of the assignment: the slice does not touch wire/protocol/decoders, so
it stays on the line-A protocol 7 base rather than restacking on `p-cons-1c` (protocol 9).

## Verification

- `tools/loot-world-fixtures/capture.sh --check` - pinned-container recapture byte-identical
  (SHA256 `e44463dc…`, 36 frames).
- `cargo test -p rh-sim --all-features --lib systems::loot_world_tests` - 2 passed / 0 failed (36 frames compared
  bit-exactly plus both in-test mutation guards).
- Related consumers: `--lib systems::items` 2 passed, `--lib initial_world` 4 passed, `--test items_melee` 9
  passed, `--test item_offer_alloc` 1 passed.
- `cargo test --workspace --all-features --locked` with the PostgreSQL test cluster (`tools/pgtest/start.sh`) -
  1,432 passed / 0 failed / 3 existing ignored across 151 test binaries; exit 0.
- `cargo clippy --workspace --all-targets --all-features -- -D warnings` - clean (exit 0, zero warnings).
- `cargo fmt --all -- --check` - clean.

## Remaining (packet-level: P-COMBAT-4 INCOMPLETE)

The loot *world* now has authoritative spawns, tables, bodies, births and the pickup/swap consumers, but the full
legacy loot domain still needs other producers' packets, kept explicit here and never faked:

- **Travel cannons and the cannon container/pickup** (`consumables.spawnTravel`/`useCannon`, kind `cannon`): owner
  **P-CONS-1** (line B). `initial_world`'s MVP profile deliberately excludes travel (`Kind::Cannon` is
  `unreachable`) and the port has no cannon container kind.
- **Large potions in body drops and stored/healing consumable pickup** (`potionLarge`, `pickConsumable` general
  path): owner **P-CONS-1**; the body-drop witness therefore declares `potionLarge` zero and the native comparison
  pins it to zero.
- **Reward-container pickup refusal/choose and the camp-chest/kill-augment `holdBirth` producers**: owners
  **P-CARDS-1/P-CARDS-2** (camp/stat chests, boosts). The ported model is separate (`reward_chests`) and is not part
  of this witness.
- **Quest-item pickup**: owner **P-QUEST-1** (`QUEST_ITEM_PREFIX` path; the ported item domain has no quest items).
- **Traders' purchase slot rule (`lockSecondSlot`)**: owner **P-TRADE-1**; the same flag read landed here is reused
  there.
- **Client-predicted locked swap/pickup**: legacy's shared `swapAllowed` is predicted by the client, but protocol 7
  carries no build flags to the browser client; exposing that fact is a wire decision for the coordinator /
  P-NET-3/P-UNITY, not a silent change in this packet.

`P-COMBAT-4 INCOMPLETE: cannon containers/pickup (P-CONS-1), large-potion consumables (P-CONS-1), reward-container
producers (P-CARDS-2), quest items (P-QUEST-1), traders' slot rule (P-TRADE-1), client lock facts.`
