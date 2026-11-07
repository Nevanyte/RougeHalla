# P-ARENA-1 remainder: the source planning/lifecycle transport (protocol 8)

Phase: the stage-2 tail of the backlog packet [P-ARENA-1](../../backlog/packets/P-ARENA-1.md). Branch
`deepseek/p-arena-1`, **stacked on `deepseek/p-faction-1` (head `91d2dc52`)**, which is stacked on
`deepseek/p-cards-1` (`92dcb662`) on `deepseek/p-content-1` over `856618eb` `optimization_port`. Implementation
commit `26575d44`; evidence/record commit follows. Pull request:
[#39](https://github.com/Nevanyte/RougeHalla/pull/39), base `deepseek/p-faction-1`. The branch is not merged and never
merges: it is one link of the stack.

## Assessment before writing (code and git, not memory)

The P-ARENA-1 kernel is already integrated in this line: commit `433392d6` ("integrate authoritative arena lifecycle
kernel") added `systems/arena_rules.rs`, `systems/coliseum.rs`, `systems/planning/**`, `systems/arena_validation.rs` and
the pinned-container capture corpus `parity/arena/source.json`; the evidence is
[stage2-arena-native](../stage2-arena-native/README.md). At the base head `91d2dc52` **no `Pending("P-ARENA-1")` row
remains in `crates/rh-sim/src/schedule.rs`** (the only arena-named pending row is `settle:training`, owned by
P-ARENA-2/P-MOBS-1). The packet's remainder is named by the capture inventory test
`arena_capture_inventory_runs_genuine_wish_prerequisite_and_keeps_full_hooks_pending`:

1. **`cardHooks.resetAll`** — still a `partial_link` (status/field reset only; the canonical lazy Wish spend memory is
   P-ABIL-1's remainder). Not in this slice; the card/Wish domain is another stack (`deepseek/p-abil-1`).
2. **Training short-clock lifecycle** — `mobs.spawnTraining`, `settle:training` and `mobs.resetDummies` are owned by
   P-ARENA-2/P-MOBS-1 and stay `Pending` here, untouched.
3. **The faction teleport consumer** — delivered by P-FACTION-1 (`814a2224`, `factions.<arrow>` TELEPORTED link); not
   redone. `arena_rules::validate_config` still refuses combining the source-arena lifecycle with a faction mode as the
   explicit partial-foundation decision (the P-FACTION-1 record documents it); **that admission was not opened here**.
4. **Source wire/client transport** — *this slice*. The base refused it at four layers with no transport at all:
   `wire::profile_supported` refused `ArenaMode::Source`; `checked_phase` refused `Phase::Planning`;
   `observation_supported` refused `obs.arena`/`obs.plan` and the `Plan`/`Teleported` events; `to_wire` refused
   both events; `Room::new` and `Director::new` panicked `"Source arena lifecycle requires protocol 7 ..."` before
   simulation. Protocol 7 had no phase code 3, no plan command, no plan state and no teleport fx.
5. **Durable shutdown/Abandon/Leave/MIA ordering** — the *simulation* semantics are native and tested
   (`source_lobby_joins_disconnect_reconnect_and_shutdown_void_replay_exactly`,
   `source_absent_admin_actions_keep_removal_hooks_and_shutdown_void_semantics`); the room/persistence ordering and public
   activation are **not** claimed by this slice (they need a source room driven to shutdown with the `postgres` spool).
6. **Complete `teleport-live-windup-status-refund` (case27) projection** — blocked on the full Wish casting pipeline
   (P-ABIL-1): `profile_supported` still refuses `abilities::Mode::Full` before frames or offers.

The legacy source of truth for the transport: `packages/shared/src/messages.ts` (`PlanMessage`, the client
`plan {spawn?: 0|1, boon?: 0|1, ready?}` message, "latest replaces earlier", private to the recipient),
`packages/server/src/sim/planning.ts` (`planFor` returns `null` outside the planning phase; `sendPlan` on every
change) and `packages/server/src/rooms/RaidRoom.ts` (the room sends the owner's plan at planning start, on change and on
reconnect). The capture corpus already records the emitted messages (`plans`) and each owner's current message
(`ownerPlans`) per frame: no new legacy capture is needed, and none was generated.

## Delivered: protocol 8 (incompatible additions)

`PROTOCOL_VERSION` 7 → 8; golden vectors `protocol/fixtures/v8.json` generated **by the documented Rust bin**
(`cargo run -p rh-protocol --bin protocol-fixtures`), never a legacy corpus. `protocol/fixtures/v7.json` is retained
byte-identically (sha256 `7c8198de…`) for the historical stack.

| Wire fact | Layout |
| --- | --- |
| Snapshot phase code 3 | Planning (0 lobby, 1 active, 2 ended); phase is a 2-bit code, so the C#/JS decoders already allowed 3 |
| Client command 12 (`Plan`) | flags u8 (bit 0 spawn, bit 1 boon, bit 2 ready), then the present fields in order: spawn u8 0/1, boon u8 0/1, ready u8 0/1 |
| Fx kind 5 (`Teleported`) | no body |
| State key 8 (owner plan) | optional record: endsAt f64, spawns (two optional non-negative pool indexes), taken (two flags), pick (0 absent / 1 = option 0 / 2 = option 1), boons (≤ 4 length-prefixed strings), boon (same code), ready, then the two resolved option facts: pool index varint, quantized x/y u16 (1/8 u), zone code 1..=5, optional walk-seconds f32 |
| State key 9 (arena view) | optional record: lobby/plan/raid f64 times, optional patience deadline f64, in-coliseum flag, gates-locked flag, sudden-death f64, starter count varint |

Server wiring (all production paths, no test-only branches):

- `wire::command` maps command 12 to `PublicCommand::Plan`, so a plan goes through `validate` + `Sim::submit` and the
  tick's existing action order like every other command (C-INPUT). The sim keeps dropping non-plan commands while the
  phase is Planning, as before.
- `wire::profile_supported` admits the source lifecycle (Full Wish still refused before simulation). `Room::new` and
  `Director::new` therefore construct source rooms; a direct-construction unit test covers admission, and the room e2e
  test covers the behaviour.
- `wire::checked_phase` returns the wire code 3 for Planning; `observation_supported` no longer refuses the arena view,
  the owner plan or those events.
- `to_wire`: the owner's `Plan` event is **omitted** (a one-shot event would be lost on a reconnect and would duplicate
  the complete-replacement key 8); `Teleported` becomes the source's room-wide `Teleport` fx.
- `wire_state::CollectionPublisher` projects keys 8 and 9 from the **already-filtered observation** only: key 8 is built
  from the viewer's own `PlanningView` (every option fact is server-resolved — a client chooses an index and never
  computes a deal or a path), key 9 from the public arena view. Both are complete replacements sent after a Welcome (join
  *and* reconnect) and on every change, exactly like the other seven keys.

## Captured-corpus parity (pinned container was not re-run)

`crates/rh-server/src/wire_state.rs` test
`captured_plan_messages_project_field_for_field_into_state_key_8` reads the committed pinned-container capture
`parity/arena/source.json` (sha256 `6ff324e134127d9c84a4f4383965f11e08a108fbe306424b1547795265adf6f5`) and, for every
`ownerPlans` entry of the ordinary planning cases (30 projected messages), compares the wire projection **field for
field** with the actual legacy `PlanMessage` the source sent: `endsAt`, `spawns` (including a `-1` no-deal sentinel
becoming a typed absent index), `taken`, `pick`, `boons`, `boon`. The resolved option facts are cross-checked against
the capture's own seed-1 `spawnPool` (quantized x/y and zone code 1..=5) and the captured `maths.spawnWalks` helper
vectors (walk seconds = captured distance / `PLAYER_SPEED`). Post-planning frames in the capture carry `plan: null`;
the test asserts the wire projection is then a typed absent key (cleared). A mutation guard (a changed pick, a shifted
spawn) proves the comparison is not vacuous. Nothing in the test computes an expected value from Rust output.

## Tests and gates (native, this Mac)

- `cargo test --workspace --all-features --locked` against the throwaway pinned PostgreSQL (`tools/pgtest/start.sh`):
  **1,424 passed, 0 failed, 3 ignored, 151 test binaries, exit 0** (the base head alone is 1,422; this slice adds the room
  e2e and the capture parity test).
- `cargo clippy --workspace --all-targets --all-features --locked -- -D warnings`: **clean, exit 0**.
- `cargo fmt --all -- --check`: clean.
- Rust protocol vectors: `committed_vectors_match_the_encoder` and the round-trip/rejection suites pass on `v8.json`
  (protocol crate, included in the workspace run).
- `node tools/protocol-js/check-vectors.mjs`: **27 server vectors, 89 malformed, 10 chains, 15,601 checks pass** against
  `v8.json` (the JS probe decoder was extended for command 12, Fx 5 and keys 8/9; the probe now speaks protocol 8).
- `node tools/protocol-js/check-first-playable.mjs`: 57 / 61 focused transport checks pass.
- `dotnet test client-unity/RoguehallaNet.Tests`: **273 passed, 0 failed** (C# `Wire.ProtocolVersion = 8`, the plan
  command, the teleport fx and both state records; `client-unity/sync-net.sh` copied the library into the Unity project
  and `sync-net.sh --check` is clean).
- `node tools/browser-proof/proof.mjs` (real headless Chromium over WSS against the built `rh-server`): **PASS**, 15/15
  checks, 418 snapshots, server protocol 8 (join/resume full state now carries the expected nine keys).
- Room e2e: lobby → planning on the admitted source profile; each owner receives its own private deal (the two deals are
  disjoint); admission closes at planning (C-NET); a `Plan` input command is validated, submitted, applied and echoed
  back in the owner's next key; both seats ready → Active; the key clears when planning ends.
- No edits to `crates/rh-sim` at all: no schedule row, tick order (C-TICK), content hash, checkpoint/replay format or
  observation version changed; `rh_server` 107 lib + 24/19/… integration tests, all green (counts in the gate log).
- No edits to docs/MIGRATION.md, docs/CONTRACTS.md status table or Cargo.lock; no legacy corpus replaced or regenerated
  from Rust output.

### Card-corpus pin cascade (canonical recapture, not a Rust regeneration)

`parity/card-catalog/source.json` pins the harness tools it ran beside (`protectedSha256`). Two of them are
`tools/browser-proof/proof.mjs` and `tools/protocol-js/check-vectors.mjs`, both necessarily updated for protocol 8, and a third
pinned tool file (`tools/protocol-js/check-first-playable.mjs`) stayed byte-identical. The established refresh procedure
(the same one used by the earlier P-CONS-1a/P-MOBS-2 refresh commits) was executed in the required order with the actual
generators, all inside the pinned `node:22.23.4-bookworm-slim@sha256:aaa4b5ba…` container (legacy source mounted read-only,
unchanged lockfile; no expected value recomputed from Rust output):

1. **card-catalog** — 409 cases, only the two protected-tool hashes moved (2-line diff; corpus sha256
   `ec7559927a25b4af93b6479f5344da2f9381da88fc4fa0c7a50d9860fb2894e0`).
2. **card-runtime** — the catalog digest is an immutable reference, so its hardcoded pin in
   `tools/card-runtime-fixtures/capture.mts` was advanced and the corpus recaptured: 65 cases / 6,236 ordinary steps / 3,179
   private records, only provenance moved (source corpus sha256 `43d25f5e2535…`).
3. **card-runtime-witness** — `FROZEN_PINS.json` advanced to the new card-runtime source/INPUT/capture.mts hashes and the
   corpus recaptured: 2 cases / 6 ordinary steps / 1.08 source ratio, only provenance moved.

Seven files changed in total (two large corpora changed by 1–2 lines each: pins/provenance only). All three
`capture.sh --check` paths pass locally after the refresh. This is pin maintenance forced by the protocol-8 tool changes, not
a behavioural recapture: 409 catalog cases, 65 runtime cases and the witness pair are byte-identical apart from the pinned
hashes.

CI note: this line's `rust` workflow job has a pre-existing 40-minute job timeout (`timeout-minutes: 40`); base PRs #35, #36
and #37 all fail that job at the timeout on this Mac-hosted evidence line. The only step this branch had broken was the
card-catalog / card-runtime / witness pin checks above, and all three now pass in the pinned image.

## What remains (the packet stays INCOMPLETE)

- `cardHooks.resetAll` (canonical lazy Wish spend memory) — P-CARDS-1 record + P-ABIL-1 remainder; the source-arena
  profile still refuses `abilities::Mode::Full` before simulation.
- Training rows `mobs.spawnTraining` / `settle:training` / `mobs.resetDummies` — P-ARENA-2/P-MOBS-1; left pending.
- Durable shutdown/abandon/leave/MIA **persistence** ordering (void run, MIA banking) and public Unity UI/client
  activation: the transport now exists, the durability and UI gates do not.
- Full `teleport-live-windup-status-refund` projection (case27) — blocked on full Wish casting.
- Faction mode + source arena remains refused by design; do not enable it to pass a test.
- Protocol 8 collides numerically with the separate `deepseek/rust-completion` line (P-FACTION-3/P-CONS-1a used version 8
  there): the coordinator renumbers one line when the stacks merge; this stack's decoders/vectors are internally
  consistent at 7 → 8.
