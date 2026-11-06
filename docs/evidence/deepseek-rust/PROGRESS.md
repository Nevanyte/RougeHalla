# DeepSeek Rust completion — progress ledger

Branch: `deepseek/rust-completion`
Base: `856618eb948555adefc6ff0bf4628d879d556250` (`origin/optimization_port`, 2026-11-06)

| Packet | Status | Commit range / PR | Evidence |
|---|---|---|---|
| P-FACTION-4 Sentenced hunt | `DONE-VERIFIED` — native gameplay, capture, per-tick parity, restore, six mutant controls, protocol v7, C#/JS mirrors, full workspace gate and browser WSS proof pass | `bb4ca9ce`..`2150bbce`; [PR #30](https://github.com/Nevanyte/RougeHalla/pull/30) | [`stage2-sentenced-hunt`](../stage2-sentenced-hunt/README.md) |

## Commands actually run

- `cargo test -p rh-sim systems::sentenced_hunt --lib` — 6 passed.
- `cargo test -p rh-sim checkpoint::tests::a_hunt_selection --lib` — 1 passed.
- `cargo test -p rh-parity --test parity every_slice_fixture_matches_legacy -- --nocapture` — all slice fixtures OK; the six new hunt fixtures compare at every tick (534 ticks).
- `cargo test -p rh-parity --test hunt` — 2 passed (every-tick restore + diagnostics required/exercised).
- `cargo test -p rh-sim --test no_alloc -- --nocapture` — zero allocations per warmed step.
- `cargo test -p rh-sim --test hash_coverage` — all six tests pass; every serialized leaf perturbs the state hash.
- `cargo test --workspace --all-features --locked` (with the throwaway PostgreSQL cluster) — 1,391 passed, 0 failed, 2 ignored.
- `cargo clippy --workspace --all-targets --all-features -- -D warnings` and the default-feature mode — both clean.
- `cargo run -p rh-parity --bin parity-report` — 103 slice scenarios + 13 capture-only, 300 pathfinding queries: all MATCH.
- `tools/hunt-fixtures/run-mutants.sh` — 6/6 mutants killed by semantic test failures, tree restored after each.
- `cargo test -p rh-protocol` — all protocol tests pass, including `tests/v7_hunt.rs` (3 tests).
- `node tools/protocol-js/check-vectors.mjs` — 24 server vectors, 89 malformed, 10 chains, 15,448 checks.
- `dotnet test client-unity/RoguehallaNet.Tests` — 269 passed, 0 failed (local .NET 8 SDK installed for the gate).
- `node tools/browser-proof/proof.mjs` — 15 checks PASS, protocol 7, 3 Full + 415 delta snapshots, no page errors.
- Captures: pinned Linux x64 Node `v22.23.4` (`node:22.23.4-bookworm-slim`), `npm ci --ignore-scripts` inside the container, `node --import tsx parity/legacy-capture/capture.ts --out parity/fixtures --only <scenario>`.

## Open owner questions / coordinator notes

- None for the hunt mechanic itself. The source intentionally lets the hunter see the selected actor through fog/bush but the server keeps hidden/untargetable attack rules; that asymmetry is pinned by tests and implemented as source.
- Shared status records are now stale by design (only the coordinator edits them): `docs/MIGRATION.md` and
  `docs/CONTRACTS.md` still say protocol 6 / observation 15 / content `e95d55ba96b2feca`. The new identity is protocol 7,
  observation 16, content `63036d344ce05ea0`. The coordinator must update those records and the P-FACTION-4 backlog row.

## Next action

P-FACTION-4 is complete and PR #30 is open. The remaining `Pending("P-...")` rows are P-QUEST-1, P-TRADE-1,
P-FACTION-3 and P-ARENA-2 (plus the cross-cutting P-NET-3 exposure, P-BOTS-1..7, P-PARITY-2, P-HEAD-1 and the final gate).
The next packet starts from a fresh rebase of `deepseek/rust-completion` onto `origin/optimization_port`.
