# P-CONS-1c: the travel cannons

## 0. Revisions, stack and packet gap

- Base: `e0e69981` (`deepseek/p-vision-1`, protocol 8; PR #42 targets `deepseek/p-arena-1`). This packet was prepared
  on the arena protocol-8 snapshot and is rebased onto the pushed vision head before the PR.
- Branch/PR: `deepseek/p-cons-1c`, mechanics/evidence commits `e0e69981..f374a9d5` (docs record after), [PR #43](https://github.com/Nevanyte/RougeHalla/pull/43) (base `deepseek/p-vision-1`).
- Stack: **A)** faction -> abil (#38) -> terrain (#40) -> mobs (#41), protocol 7. **B)** faction -> arena (#39,
  protocol 8) -> vision (#42, stays 8) -> this packet (protocol 9). The union's wire version is 9: this is the only wire
  move on either line after arena. Branch A's commits are not in this branch by design.
- Toolchain: `cargo 1.97.0` (`rust-toolchain.toml`), capture container
  `node:22.23.4-bookworm-slim@sha256:aaa4b5ba…`, linux/amd64, Node v22.23.4.
- **Packet gap (open item, coordinator-owned):** no `P-CONS-1`, `-1a`, `-1b` or `-1c` file exists under
  `docs/backlog/packets/` on any branch. The backlog row (`docs/backlog/README.md`, "P-CONS-1") and the parallel line's
  `docs/evidence/stage2-consumables-wind/README.md` ("Cannons remain P-CONS-1c") are the only records. This packet treats
  the legacy `packages/server/src/sim/consumables.ts` `spawnTravel` + `useCannon` body as the scope and does not invent
  requirements beyond what that source and its pinned capture show.
- **P-CONS-1a/1b dependency (documented, not faked):** the large potion + camp-clear reward (1a, protocol 9) and wind
  emblems (1b, protocol 10) live only on the parallel `deepseek/rust-completion` line (PRs #33/#34:
  `origin/deepseek/p-cons-1a`, `origin/deepseek/p-cons-1b`). None of their code is in this stack. The cannons do not need
  them: the source's `useCannon` touches only containers, the pickup action, `cannotMove`, `displace`,
  `gatesLocked` and `weaponChanged`, all of which this line has. This packet therefore implements the independent cannon
  slice; the wind emblem and large-potion/other-potion producers remain those PRs' responsibility.

## 1. Outcome

Port the source's travel cannons ("F enters and blasts to the linked destination; each cannon reloads for 75 s"):

- the actual constructor producer: `spawnTravel` runs after the loot prefix inside the consumables installer, one cannon
  per region pole at the nearest clear non-occupied tile within ±4 tiles, each aimed at the site half-way round the ring;
- the container state: `ContainerKind::Cannon`, private `target` and public `ready_at` (legacy
  `ContainerState.readyAt/targetX/targetY`), serde-default additive so an old payload still decodes;
- the pickup action's cannon branch, at its source position after the ordinary reach/line-of-sight admission and before
  the chest/consumable/weapon branches: the gates seal, the rounded-up whole-second reload notice, `cannotMove`, the
  landing-disc validation, the 75 s stamp, the path clear, the displacement (with its `displaceSeq` discontinuity and
  rewind-history reset), the queued-input drain, the target/attack-move/held clears, `weaponChanged` and the blast
  toast — in that order, with no new schedule row;
- the public observation: prop kind `Cannon { ready_at }` (the legacy client's "Cannon · reloading Ns" countdown) and
  the owner-only `CannonNotice` event (sealed / cannot enter / blast / reloading seconds);
- the wire: protocol 8 -> 9, prop kind 4 and Events 8, golden vectors `protocol/fixtures/v9.json`, the Rust, C# and JS
  decoder mirrors, the Unity copy and the browser probe.

Sibling capture profiles that list no `consumables` installer (the P-ARENA-1 constructor/planning source captures)
model `SimConfig.consumables: false`; this is the same module gate the parallel P-CONS-1b packet uses.

## 2. Legacy paths verified with `rg`

- `packages/server/src/sim/consumables.ts`: `spawnTravel` (region pole candidates, stable distance sort, tile
  occupancy, half-way-round link, `addContainer("cannon", …)`, `targetX/targetY`), `useCannon` (`gatesLocked`,
  `readyAt > now` and the `Math.ceil((readyAt-now)/1000)` notice, `cannotMove`, the silent `circleClear` decline,
  `readyAt = now + CANNON_COOLDOWN_MS`, `path = []`, `displace`, `inputs.drain()`, lock/attackMoveGoal/held clears,
  `attackTarget = ""`, `weaponChanged`, toasts), `install` (the travel producer runs at install).
- `packages/server/src/sim/loot.ts`: `handlePickup`'s source order and the `if (box.kind === "cannon") { useCannon(...); return; }`
  branch position; `addContainer`.
- `packages/server/src/sim/status.ts`: `cannotMove = isStunned || isRooted || isCasting`; `actionBlocked = isStunned || isCasting`
  (a stun is refused by the pickup admission before the cannon branch; the cannot-move branch is reachable through a root).
- `packages/server/src/sim/displace.ts`, `weapons.ts weaponChanged`, `movement.ts recordHistory` (the source keeps the
  displacement reset plus the movement phase's same-tick sample; readers clamp).
- `packages/shared/src/constants.ts`: `CANNON_COOLDOWN_MS = 75_000`, `INTERACT_RANGE = 56`, `PLAYER_RADIUS = 12`.
- `packages/client/src/render/ContainerView.ts`: the `kind === "cannon"` label and its `readyAt > serverNow` countdown.

## 3. Write scope

`crates/rh-sim/src/{constants,state,events,observe,item_view,statics,checkpoint,actor_refs}.rs`,
`src/systems/{cannons,items,initial_loot,mod}.rs`, `src/systems/cannons_source_tests.rs` (test module),
`crates/rh-parity/src/{combat,canon}.rs`, protocol 9: `crates/rh-protocol/**`,
`client-unity/RoguehallaNet/Protocol/{State,Messages,Codec}.cs` + the Unity copy + tests,
`client-unity/README.md`, `crates/rh-server/src/{wire,wire_state,main}.rs`, `crates/rh-server/bin`,
`crates/rh-server/web/probe.html`, `crates/rh-server/tests/ending_metadata.rs`, `crates/rh-headless/src/**`,
`crates/rh-sim/tests/{content,hash_coverage}.rs`, `tools/browser-proof/proof.mjs`, `tools/protocol-js/check-vectors.mjs`,
`protocol/fixtures/v9.json`, `tools/cannon-fixtures/**`, `parity/cannons/source.json`, `parity/abilities/hash-tape.json`,
this README and the ledger.

## 4. Contracts

- **C-TICK:** no schedule row is added or reordered. `spawnTravel` runs inside the constructor after the loot prefix (the
  consumables installer's position); `useCannon` runs inside the pickup action handler, exactly where
  `loot.handlePickup` dispatches it, in the recorded order above.
- **C-OBS:** the cannon is a public prop; the notices are owner-only (`Visibility::Owner`, `Class::Important`); no new
  hidden fact reaches an observer (the destination stays server-private and is not published).
- **C-RNG:** no new stream; travel placement is deterministic (no draws).
- **C-DET:** `Container.target/ready_at` are hashed and checkpointed world leaves; the content registry grows
  `CANNON_COOLDOWN_MS` and `SimConfig.consumables` is part of the rules identity; OBSERVATION_VERSION 15 -> 16.
  CHECKPOINT_FORMAT stays `rh-checkpoint/20` (the two container fields are serde-default additive; older checkpoints are
  refused by the moved content identity instead).
- **C-NET:** protocol 8 -> 9 (a new public prop kind and a new owner-only event), with the regenerated golden vectors, the
  Rust/C#/JS decoders, the Unity copy and the browser probe.
- **C-PARITY:** the constructor and every driven case are actual-source probes from the pinned container, compared frame
  by frame by `crates/rh-sim/src/systems/cannons_source_tests.rs`; 15 committed mutant controls kill each rule.

## 5. Behaviour to preserve

- Travel: one cannon per region pole at the nearest clear tile within ±4 tiles (stable dy/dx distance ties) that shares a
  tile with no spawn, spawn-pool point, camp, camp chest/spot, crate/ground spot or earlier cannon; linked to the site
  `sites[(i + max(1, floor(sites.len()/2))) % sites.len()]`; only with at least two sites; never in training.
- Reload: `readyAt = now + 75000` at the blast; the refusal words are the source's rounded-up whole seconds
  (`ceil((readyAt-now)/1000)`); a clock at or before `now` is ready.
- Order: gates seal, then reload, then cannot-move, then the landing disc (a blocked landing silently declines with no
  stamp and no toast); then the stamp and the clears; `weaponChanged` after the clears; the blast toast last.
- The blast clears the walk path (the source clears it before the displacement, so the displacement does not re-plan), the
  queued inputs, the weapon target lock, the attack-move goal, the held trigger and the `attackTarget` mirror; it resets
  the rewind history to the landing and increments `displaceSeq`.
- Cannons are always interactable (no item required) and are not weapon offers; ordinary chest/consumable pickups are
  unchanged.

## 6. Acceptance checks

- [x] Actual-source probe `parity/cannons/source.json` (pinned container, `tools/cannon-fixtures/capture.sh`):
      **11 cases / 23 compared steps** — the constructor's 45 containers and five cannons with their half-way-round
      destinations, and the blast, reload refusals/boundaries, seal ordering, root cannot-move, blocked landing, clears
      and chest control; `--check` matches **byte for byte** (sha256 `78de24ff6d4495c0172c8a3d7e8780ae5de6280768fa5e86bacbff81edd7233e`).
- [x] `cargo test -p rh-sim systems::cannons --lib` — 2 passed: the source replay compares every frame exactly,
      restores a checkpoint mid-blast and continues, and the observer resolves the itemless cannon's focused pickup.
- [x] Negative controls: **15/15 mutants killed** by semantic test failures (`tools/cannon-fixtures/run-mutants.sh`),
      unchanged control passes.
- [x] Protocol 9: `cargo test -p rh-protocol` all suites; `node tools/protocol-js/check-vectors.mjs` — 28 server
      vectors, 94 malformed, 10 chains, 15,633 checks against `v9.json`; `dotnet test client-unity/RoguehallaNet.Tests`
      — 279 passed; `node tools/protocol-js/check-first-playable.mjs` — 61 checks.
- [x] Identity: content hash moves to `a93f0a500ea89235` (one new registry row, `CANNON_COOLDOWN_MS`); the
      `SimConfig.consumables` module leaf and the two container leaves are hashed/checkpointed; OBSERVATION_VERSION
      15 -> 16; wire 8 -> 9; checkpoint `rh-checkpoint/20`, replay `rh-replay/17` and policy contract 12 unchanged but
      the CONTRACTS identity line must be advanced by the coordinator.
- [x] The ability hash tape was **re-recorded through its declared recorder** (`--ignored record_ability_hash_tape`;
      53 folds moved) because the rules identity grows the module flag and the registry row — the tape's base cases are
      not hand-edited.
- [x] `cargo test --workspace --all-features --locked` (throwaway PostgreSQL) — **1,428 passed, 0 failed, 3 ignored, 155 test binaries, exit 0**.
- [x] `cargo clippy --workspace --all-targets --all-features -- -D warnings` and the default-feature mode — clean; `cargo fmt --all --check` — clean.
- [x] `node tools/browser-proof/proof.mjs` — **15/15 checks PASS**, protocol **9**, content hash `a93f0a500ea89235`, 4 Full + 415 delta snapshots, no page errors.

## 7. Commands

```sh
mkdir -p node_modules && bash tools/cannon-fixtures/capture.sh --check
cargo test -p rh-sim systems::cannons --lib
tools/cannon-fixtures/run-mutants.sh
cargo test -p rh-protocol
node tools/protocol-js/check-vectors.mjs
node tools/protocol-js/check-first-playable.mjs
dotnet test client-unity/RoguehallaNet.Tests
cargo test --workspace --all-features --locked     # with PostgreSQL from tools/pgtest/start.sh
node tools/browser-proof/proof.mjs
cargo fmt --all --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo clippy --workspace --all-targets -- -D warnings
```

## 8. Shared-file hunks

- `constants.rs`: one appended content-registry row (`CANNON_COOLDOWN_MS`).
- `state.rs`: `ContainerKind::Cannon` and the two serde-default container leaves.
- `statics.rs`: `SimConfig.consumables` (serde default true) — the same name/semantics as the parallel P-CONS-1b line.
- `initial_world/mod.rs`: unchanged (its travel producer was already ported by the initial-world packet); only the live
  sink/simulation wiring and its profile gate are new.
- `events/observe/item_view/actor_refs`: one notice event, one prop kind, one observation version bump.
- `checkpoint.rs`: the cannon leaves' validation and the generalized first-pair same-tick history allowance (the source
  displacement shape; the previous shape is the Blaze-only exception, which stays).
- `crates/rh-parity/{combat,canon}.rs`: container projection and event omission for the dedicated cannon source test.
- Protocol 9 and its clients/tools as in the write scope.

## 9. Traps

- The source keeps `rt.history = [now, landing]` from `displace` and then the movement phase appends another sample at
  the same `now`; the Rust checkpoint rule (samples at least one tick apart) refused the checkpoint taken in the blast
  tick. The rule now allows the first pair to share its timestamp (the source's displacement shape); the ability
  source tapes still match (the Blaze exception is preserved) and the ability hash tape was re-recorded through
  `--ignored record_ability_hash_tape` because the rules identity moved (see 6).
- A stun is refused by the pickup admission (`actionBlocked`) before the cannon branch; only a root reaches
  "Can't enter a cannon now". The capture uses a real root for that case.
- The legacy frame's player `readyAt` is the **state** field `c.readyAt`, not `rt.weapon.readyAt`; the first capture
  recorded the wrong one and was re-captured.
- The capture's frame recorder must not consume the world's RNG streams: it records the next four values by replaying the
  streams from their seeds and skipping the observed draw counts.
- The planning/arena source captures list no `consumables` installer, so their Rust profile must not spawn travel
  (`SimConfig.consumables: false`); the same map seed-1 generated map otherwise gains five cannons and every recorded
  container count breaks.
- A cannon's destination is immutable after the constructor; a checkpoint taken after a trusted rewrite of it is
  deliberately not restored (that probe state is not reachable source state).
- `protocol/fixtures/v9.json` has 28 server vectors; the C# event-kind test's "undefined kind" sample moved from 8 to 9
  and the state round-trip expectation gained the cannon prop row.

## 10. Owner/coordinator questions

1. The backlog has no `P-CONS-1c` packet file; this evidence README is the packet record until the coordinator writes one.
2. The shared identity line in `docs/CONTRACTS.md` needs the new values: content `a93f0a500ea89235`, wire **9**,
   observation **16**, policy contract 12, checkpoint `rh-checkpoint/20` (unchanged), replay `rh-replay/17` (unchanged).
3. Merge order: line A (protocol 7) and line B (this branch: protocol 8 -> 9) must be merged in the stated DAG order; this
   packet carries the union's only post-arena wire move.
4. The parallel `deepseek/rust-completion` line's P-CONS-1a/1b (large potion, wind emblems) remains unmerged here; the
   coordinator must decide how those packets join the union.
