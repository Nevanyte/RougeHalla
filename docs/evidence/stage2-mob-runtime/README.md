# P-MOBS-1 remainder: the chainable mob life hooks and the 180 s respawn witness

Slice scope, assessed from the code and git history before writing: the regional mob runtime was integrated by the
first-playable core (`484cef25`); its schedule rows are already ported at their legacy positions
(`inputs:mobs(insertionOrder)`, `mobLife.reapMobs`, `mobLife.respawnCamps`, `mobAI.thinkMobs`,
`mobLife.resetAllMobs`, `mobLife.mobRoleMove`, `mobLife.spawnRegionalMobs`) and the full packet stays **INCOMPLETE**
for the reasons below. What was genuinely missing for the reward/lifecycle stage was the two **chainable hook producer
call sites** and the packet's required 180 s boundary / return-immunity / per-camp-drop proofs. This branch adds them,
with a pinned-container source witness and mutant controls, and leaves every other owner's row Pending.

## What changed

- **`mobKilled` producer** (`systems/mob_life.rs::pay`, legacy `mobLife.ts payMobKill` order: credit → stat stacks →
  settled weapon awards → chests link → hook): fired through the one hook dispatcher with the credited killer, mob type,
  zone, 0-based camp, elite flag and death position. The source chests (P-CARDS-2) and quests (P-QUEST-1) links remain
  `Pending` in the schedule's recorded chain; the producer call site and typed arguments are ported.
- **`campCleared` producer** (`systems/ledger.rs` `PayLater::CampCleared`, legacy `camps.ts payLater`: emit the fx
  event, then the hook): the source chest/heal/quest/bruiser consumers (P-CARDS-2, P-MOBS-2, P-QUEST-1, P-FACTION-5)
  remain Pending.
- The trusted probe records both producers (`status_runtime/probe.rs` `HookRecord::MobKilled/CampCleared`) so the
  parity test compares the source calls' order and arguments. Firing a hook whose links are all Pending mutates no game
  state: every existing state hash, fixture and replay is unchanged.
- **`parity/mobs/runtime-lifecycle.json`** (new, 708,910 bytes, SHA256 `98e52aec72801b2b68659c1d0ee0a378c49c10995e13422d881df440a0490dc1`):
  actual-source capture from the pinned `node:22.23.4-bookworm-slim@sha256:aaa4b5…` linux/amd64 container by the new
  `tools/mob-runtime-fixtures/` tool (passive `world.hooks` observers only; nothing feeds expected values back).
  It witnesses, in one declared fixed-step scenario: `mobKilled` at ticks 53, 79 (normal `flameCaller`) and 345 (elite
  `wyrmling`), `campCleared` at tick 345 **before** that pass's elite kill, the camp state transition at 345, the
  killer's GV/feed and `flameCaller` ×3 stacks, the single camp-clear ground `axe` drop, and `respawnAt = clearedAt +
  180000` with the full three-mob roster returning at tick 3945 through ordinary 20 Hz steps.
- **`systems/mob_life/mob_lifecycle_tests.rs`**: the native comparison — 504 captured frames (dense through the clear
  plus the respawn boundary at ticks 3943–3947), all 3,946 per-tick trace entries, and the four producer calls' order
  and arguments; checkpoints restored immediately before (tick 3943) and at (3944) the boundary continue to the same
  state hash. The same file guards the packet's two remaining traps: damage to a returning mob adds threat and keeps it
  returning (while the same hit on an idle mate wakes the camp), and a camp's weapon drops only for the clear, for the
  earliest dying mob of the pass, never per kill. The clear also aligns `dropper`'s empty-settlement case with the
  source's `!record || record.first === mobId` (unreachable in production, pinned by the new unit test).
- **`tools/mob-runtime-fixtures/`**: capture wrapper/recorder/declared map input, frozen corpus and six committed
  mutants with `run-mutants.sh` (per-kill loose drop, repath-phase drift, return-immunity broken, tie-rank drift,
  and each producer call dropped). `capture.sh --check` compares the checked-in bytes.

## Measurements (this branch, base `44299eec`)

- `cargo test -p rh-sim --lib --features trusted-status-probes mob_lifecycle`: **3 passed, 0 failed**.
- `bash tools/mob-runtime-fixtures/run-mutants.sh`: **6/6 mutants killed; unchanged control passes** (the per-kill-drop
  and phase-drift mutants fail the captured frame/container comparison, the return mutant fails the returning-mob test,
  the tie-rank mutant fails the source `tieRank` values test, and each dropped producer fails the captured hook order).
- `cargo test -p rh-parity --test schedule`: **14 passed** (no phase or hook-chain reorder; the pending consumers still
  name their real packets).
- `bash tools/mob-runtime-fixtures/capture.sh --check`: **PASS** — 504 frames, 3,946 ticks, 4 producer calls, 708,910
  bytes, byte-identical in the pinned linux/amd64 Node `v22.23.4` container.
- Gate numbers are in the PR body / commits (`cargo test --workspace --all-features --locked` with the PostgreSQL
  helper, both strict Clippy modes, `cargo fmt --all --check`).

## Still missing (P-MOBS-1 remains INCOMPLETE)

- **`mobs.resetDummies` stays Pending P-MOBS-1** — exact evidence: the port has no dummy actor kind or constructor.
  `Mob::born` only constructs a regional catalog type from typed `ActorOrigin::Mob` provenance, and the only source
  constructor of a dummy is `mobs.spawnTraining` (`SimConfig.dummies`), which is P-ARENA-2. A reset system that can
  never see a dummy would be faked wiring, so the row keeps its packet.
- **Training lifecycle** `mobs.spawnTraining` and `settle:training` — P-ARENA-2 (explicitly not approximated here).
- **Full five-faction source-born NPC signatures** — `systems/mobs.rs::admit_factions` still admits only the basic
  Fire/Plague/Holy PvE plan; the fifth-faction NPC signature cases are P-FACTION-2..5. This slice adds no signature data.
- **P-MOBS-2 consumers** — camp-clear heal/wards, elite chests, passive regen (`campHeal.payCampHeal`,
  `regen.regenPass`, `chests.<arrow>` on `mobKilled`) stay Pending; their producers here are the only new call sites.
  The parallel `deepseek/p-mobs-2` branch owns those mechanics.
- **Packets check 6 (scale)**: no genuine 8-seat/~200-mob workload with measured mean/p99 and allocation boundaries yet —
  the existing `scalebench` is synthetic seated scale only, and this slice does not claim it.
- **Packet check 4/5 remainder**: the payout-multiplier-timing and "blanket allied collision filtering" mutants, the full
  seed1 50-camp/204-spot regional corpus, the real mob-enabled headless replay continuation and the far/occluded
  observation privacy cases are not covered here. Active-combat frames and the camp lifecycle are; the cases are named
  so the owner sees exactly what an acceptance run still needs.
- **Coordinator-owned**: CI wiring of the new `capture.sh --check` wrapper and the backlog/status records. This branch
  edits neither `docs/MIGRATION.md` nor the `docs/CONTRACTS.md` status table, `Cargo.lock`, nor any legacy corpus.

## Commands

```sh
cargo test -p rh-sim --lib --features trusted-status-probes mob_lifecycle
cargo test -p rh-parity --test schedule
CARGO=$HOME/.codex/tools/rougehalla-stage2/cargo/bin/cargo bash tools/mob-runtime-fixtures/run-mutants.sh
bash tools/mob-runtime-fixtures/capture.sh --check
cargo fmt --all --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
export PGBIN=/opt/homebrew/opt/postgresql@16/bin
eval "$(bash tools/pgtest/start.sh)" && cargo test --workspace --all-features --locked
```
