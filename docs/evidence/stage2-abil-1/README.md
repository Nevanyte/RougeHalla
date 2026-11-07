# P-ABIL-1 remainder: the coupled Wish source cases, the stagger chain and the complete abilities phase (INCOMPLETE)

Phase: the stage-2 tail of the backlog packet [P-ABIL-1](../../backlog/packets/P-ABIL-1.md). Branch
`deepseek/p-abil-1`, **stacked on `deepseek/p-faction-1` at `91d2dc52`**, which is itself stacked on
`deepseek/p-cards-1` at `92dcb662`, `deepseek/p-content-1` and `856618eb` (`optimization_port`). Pull
request: [#38](https://github.com/Nevanyte/RougeHalla/pull/38), commit range `91d2dc52`..`6c420229`; it targets
`deepseek/p-faction-1` and never merges. Evidence for the earlier slices:
[P-CONTENT-1](../stage2-content-1/README.md), [P-CARDS-1](../stage2-cards-1/README.md),
[P-FACTION-1 remainder](../stage2-faction-remainder/README.md), and the integrated five-Wish kernel record
[stage2-abilities/native](../stage2-abilities/native/README.md). Ledger row:
[`docs/evidence/deepseek-rust/PROGRESS.md`](../deepseek-rust/PROGRESS.md).

## Assessment before writing (code and git, not memory)

The authoritative five-Wish kernel was already integrated at `856618eb`: validated Cast intake, one authoritative
cast owner, atomic rank-ordered landing, stock/charge clocks, teleport refunds, all five effect tuples and the frozen
63-case / 6,318-step source corpus ([`parity/abilities`](../../../parity/abilities/README.md)). Re-reading the code and
the schedule at the cards/faction head found the P-ABIL-1 remainder to be exactly:

1. `crates/rh-sim/src/schedule.rs` phase `abilities`: `Run::Partial`, completed "status lifecycle, fields and reveal",
   pending `P-ABIL-1`.
2. `schedule.rs` hook `raidStarted` link `abilities.armWishes`: `Run::Partial`, completed "status and field reset",
   pending `P-ABIL-1`.
3. `schedule.rs` hook `staggered` link `abilities.<arrow>`: `Run::Pending`, `P-ABIL-1`.
4. The source driver's exact ten named coupled cases that were never attempted
   (`crates/rh-sim/src/abilities/source_tests/mod.rs`): two cards cases, two signatures/own-Mark cases, the training
   case and the five full five-faction source-born NPC-signature cases.

Clarified from the source install: a *helper* status snapshot or a seeded poststate does not satisfy the packet, so the
ten cases must run from the actual `grantCard`, actual weapon-hit Mark and actual source-born producers. The code/gate
review also found that `systems/arena_rules.rs::validate_config` still refused any faction world under the source
lifecycle with "source arena faction teleport producers are not yet admitted" — the stated missing producer (the
coliseum reset) landed in P-FACTION-1, so the refusal was stale.

## What this slice establishes

### 1. Four of the ten coupled source cases now run from real producers

- **`trial-gallows-card-exit` and `arcane-overload-wishful-stock-trim`** (the two cards cases). The source driver gained
  a `cards` profile: after the birth step and before the first compared frame (the source rig's order) every declared
  card is granted through the real `cards::grant` producer — the source's `chests.grantCard` path: build count,
  `recomputeMods`, `syncMaxHp` — never a snapshot seed. The cases then exercise the live P-CARDS-1 consumers: Gallows'
  Patience lengthens the Trial ring and its exit stun; Arcane Overload's x2 Wish cooldown and Wishful Thinking's
  per-hit trims move the real stock clocks and the `cards.wishCast` spend record.
- **`trial-own-convicted-mark-from-real-weapon-hits` and `trial-other-owner-convicted-is-not-own-mark`** (the two
  signatures cases). A tier-3 Mark is earned by bounded **ordinary sword hits** through the real Sentenced
  `before_damage` mark pass — the driver's `untilOwnMark` action asserts the stopping step against the source's
  `executed` count — and Trial then reads the caster's own Mark only. The first case lands the tight convicted ring; the
  second proves another owner's tier-3 Mark does not tighten this caster's ring (both asserted in a native focused
  test). The P-FACTION-1 coliseum reset (`814a2224`) is in the base.
- **Source arena faction gate**: `systems/arena_rules.rs::validate_config` no longer refuses a faction world under
  `ArenaMode::Source` (the refusal's stated precondition is met by the P-FACTION-1 teleport reset); remaining faction
  producers stay row-gated and Pending under their own packets. No synthetic config widening: the gate's other checks
  (durations, mob/loot prefix, spawns) are unchanged.

### 2. Trusted checkpoint domains for the two new producers

The source driver restores a checkpoint after every compared frame (`Sim::restore`), so the new producer states must be
coherent, and malformed states must still be rejected:

- **Gallows Trial tuple** (`abilities/effect_checkpoint.rs`): the zone field, the `zoned` status and the exit `stun`
  admit the patient tuple (`TRIAL_MS + GALLOWS_PATIENCE_EXTRA_MS`, `GALLOWS_PATIENCE_STUN_MS`) **only when the owner's
  build really holds Gallows' Patience** (the source `hasFlag`); the plain tuple is unchanged.
- **Wishful Thinking trims** (`abilities/checkpoint.rs`): the source keeps only the last spend record plus a bounded
  in-window trim trace (`cards.trims`, source window 60 s / budget 30 s), so the clocks it cut cannot be replayed from
  the last spend alone. A player who owns the card and has a structurally coherent trace (tick lattice, in-window
  budget, times inside the raid) may hold the bounded trimmed clocks; the untrimmed domain keeps every previous exact
  equation. A focused test proves a valid card state restores, a Gallows ring without the card is rejected, a tampered
  ring lifetime is rejected and an out-of-budget trim is rejected.

### 3. The `staggered` hook row is ported (C-TICK: in place, not reordered)

- `crate::hooks::HookArgs::Staggered` fires in the ledger where the source `weapons.stagger` calls
  `world.hooks.staggered`: **after** the immunity clock is set, **before** the action cancel. The trusted probe records
  it, and the frozen source hook tape now compares the 14 real `staggered` records in the corpus (the five admitted
  `laststand-*` cases execute them) — tick and time must match.
- The abilities chain is the source `cancelIf(world, c, "stagger")`: a pending cast is interrupted only when its
  definition lists stagger. A Wish lists stun and silence alone, so a sword stagger never wastes a Wish; a focused test
  pins both sides (a real accepted Trial cast survives; a cast whose `cancelledBy` lists stagger is interrupted).
- `schedule.rs` `STAGGERED` is `Pending -> Ported` at its recorded position; `crates/rh-parity/tests/schedule.rs`
  requires the ported link and the execution trace test counts it. The arena lifecycle corpus
  (`systems/planning/source_tests.rs`) used to count every real `staggered` hook as a pending card link; with the
  link ported its owned-hook-order comparison now requires the abilities-installed record and pins it.

### 4. The `abilities` phase row is fully ported

All four legacy `updateAbilities` steps run through ported leaves in the recorded order: bush exposures; expire statuses
and fields (DeathFloor pays, Hidden ends its cloud, Zoned removes its field, then expired fields); the atomic due-cast
landing; and the zone-exit/stun plus weapon-action reveal and bits refresh. `Run::Partial -> Run::Ported` in place.

### 5. `abilities.armWishes` stays Partial under P-ABIL-1 (lead decision)

Its callback is richer than the old completed text: besides status/field/dot-bucket reset it clears pending casts and
arms the Wish charge/cooldown clocks (the kernel's work). The only source branch it still does not implement is the
**training world branch** (`config.training ? readyAt 0 : raidStartedAt + lock` and the 5 s training cooldown), which is
unreachable from `SimConfig` because the training lifecycle itself is owned by P-ARENA-2 (`settle:training`,
`mobs.spawnTraining`) and its dummies by P-MOBS-1. The row keeps its `P-ABIL-1` ownership as instructed; this is the
exact reason.

### 6. Hash tape and content

`parity/abilities/hash-tape.json` gains the four newly admitted cases (recorded with the ignored
`record_ability_hash_tape` driver **on the restacked base**). All **53 base records reproduce byte-identically**; only
the four appended records are new. No content-hash change (no definition row moved), no protocol/checkpoint-layout change
and no new serialized state: every added leaf already existed and is hash-covered.

### 7. Negative controls

`tools/content-fixtures/run-mutants.sh` now covers **12 mutants**: the eight P-CONTENT-1 controls plus four P-ABIL-1
controls — a real **cooldown** rule (Wish cooldown multiplier ignored), a real **landing** rule (landing order reversed
against the tick's action rank), a real **refund** rule (teleport refund clock off by one tick) and the Wishful Thinking
producer capped away. Each must fail a semantic test (never a compile/setup failure) and the unchanged control must
pass. The script's backup key is the repo-relative path now that several touched files share the `mod.rs` basename.

## Still missing (P-ABIL-1 remains INCOMPLETE)

- `abilities.armWishes` training branch — P-ARENA-2 training lifecycle / P-MOBS-1 dummies (see 5 above).
- `training-swarm-real-five-second-recast-replacement` — the source timeline compares the training dummy roster on
  **every** frame and the 5 s training recharge; `SimConfig` has no training world yet (`mobs.spawnTraining` and
  `settle:training` are Pending P-ARENA-2, `mobs.resetDummies` Pending P-MOBS-1). Not approximated.
- The five `full-signature-source-born-*-wish-recipients` cases — blocked at
  `crates/rh-sim/src/systems/mobs.rs::admit_factions` ("unsupported PvE faction mode": the basic PvE faction plan admits
  only Fire/Plague/Holy source-born signatures). Full five-faction source-born NPC signatures are P-FACTION-2..5. All
  five were probed: they fail at that config gate, never at ability code.
- **Source public transport/activation** — the packet assigns server/protocol/C#/JS vectors, public activation and
  policy compatibility to the coordinator; this branch adds no wire fact and no public activation.
- The integrated [stage2-abilities](../stage2-abilities/README.md) record still prints the ten historical pending names;
  this README is the current remainder ledger. The backlog row and `docs/MIGRATION.md`/`CONTRACTS` status stay with the
  coordinator.

## Measurements (this branch, restacked base `91d2dc52`)

- `cargo test -p rh-sim --lib abilities`: **25 passed, 1 ignored** (the tape record driver); the four newly admitted
  cases run in `frozen_full_source_all_63_cases`, and the pinned outstanding inventory is exactly the six names above.
- `cargo test -p rh-sim --lib --features trusted-status-probes abilities::source_tests::frozen_full_source_all_63_cases`:
  passes with the staggered hook tape compared.
- `cargo test -p rh-parity --test schedule`: **14/14**.
- `tools/content-fixtures/run-mutants.sh`: **12/12 mutants killed; unchanged control passes**.
- `cargo fmt --all --check`: passes.
- `cargo clippy --workspace --all-targets --all-features -- -D warnings` and
  `cargo clippy --workspace --all-targets -- -D warnings`: both pass.
- `cargo test --workspace --all-features --locked` with a throwaway PostgreSQL: **1,425 passed, 0 failed, 3 ignored,
  151 test-result groups, exit 0** (the faction base had 1,422; this branch adds the three focused tests, and the
  `rh-sim` lib runs 497 tests of which 1 is the ignored tape recorder).
- `cargo run -p rh-parity --bin parity-report`: **97 slice scenarios + 13 capture-only, 300 pathfinding queries: all
  MATCH** (unchanged scope).
- `bash tools/ability-fixtures/capture.sh --check` (pinned `node:22.23.4-bookworm-slim` linux/amd64 container):
  **PASS** — 63 cases, 6,318 ordinary steps, corpus SHA256 `8629c08fa42ac9fb15b21c52416658997c7d8969a6962cf59b71cebedd571330`
  (the frozen bytes; nothing was regenerated).

## Commands

```sh
cargo test -p rh-sim --lib abilities
cargo test -p rh-sim --lib --features trusted-status-probes
cargo test -p rh-parity --test schedule
tools/content-fixtures/run-mutants.sh
cargo fmt --all --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo clippy --workspace --all-targets -- -D warnings
export PGBIN=/opt/homebrew/opt/postgresql@16/bin
eval "$(bash tools/pgtest/start.sh)" && cargo test --workspace --all-features --locked
bash tools/ability-fixtures/capture.sh --check
```

## Traps

- The cards profile must grant after the bootstrap step and before the initial snapshot: the source rig does exactly
  that, and the parity comparison starts from the declared-player bootstrap.
- A helper status snapshot is not a producer: the signatures cases assert the `untilOwnMark` stopping step and the
  native tests assert the build ownership / the Mark tier and the ring radius.
- The Gallows tuple and the trimmed clocks are admitted only with their card owner; do not widen the tuple without the
  ownership check.
- A Wish does not list stagger in `cancelledBy`; only stun/silence interrupt it. The hook still fires for every real
  stagger (it can drop a weapon windup).
- The hash tape is never hand-edited: the four records were produced by the ignored recorder on the restacked base and
  the 53 base records were verified unchanged afterwards.
- The faction stack matters: this branch is based on `91d2dc52` (restacked on `92dcb662`), not on the pre-restack
  faction tip; the PR targets `deepseek/p-faction-1` and states the stack.
