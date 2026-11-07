# DeepSeek Rust completion — progress ledger

Branch: `deepseek/rust-completion` (this packet is the standalone snapshot branch `deepseek/p-mobs-2`)
Base: `856618eb948555adefc6ff0bf4628d879d556250` (`origin/optimization_port`, 2026-11-06)

| Packet | Status | Commit range / PR | Evidence |
|---|---|---|---|
| P-FACTION-4 Sentenced hunt | `DONE-VERIFIED` (per the packet branch): native gameplay, capture, per-tick parity, restore, six mutant controls, protocol v7, C#/JS mirrors, full workspace gate and browser WSS proof pass | `bb4ca9ce`..`7d48bb15`; PR #30 | [stage2-sentenced-hunt](../stage2-sentenced-hunt/README.md) |
| P-FACTION-3 Plague corpses + zombie | `DONE-VERIFIED`: core, protocol v8, slice captures, source manifest, mutants and the perf gate all pass; PR CI green (Rust, recapture, C#, perf, native determinism) | `4707187f`..`33ee92c7`; PR #31 | [stage2-plague-corpses](../stage2-plague-corpses/README.md) |
| P-MOBS-2 (regen slice) | `DONE-VERIFIED` for the regeneration system: capture + per-tick parity (200 ticks), every-tick restore, seeded headless replay, 8/8 mutants, content golden, hash coverage, warmed zero-allocation step, both strict Clippy modes, browser WSS proof and the full workspace gate (1,389 passed). The packet's camp-clear potion reward, its `campCleared` link and any elite-chest/ward gaps remain open (they need P-CONS-1's large potion) | `d94da7bf` on `deepseek/p-mobs-2`; [PR #32](https://github.com/Nevanyte/RougeHalla/pull/32) | [stage2-player-regen](../stage2-player-regen/README.md) |

## Commands actually run (P-MOBS-2 regen slice)

- `tools/regen-fixtures/capture.sh --check` — byte-for-byte match of `parity/fixtures/regen_clock.json` in the pinned
  `node:22.23.4-bookworm-slim@sha256:aaa4b5ba…` linux/amd64 container.
- `cargo test -p rh-sim systems::regen --lib` — 7 passed.
- `cargo test -p rh-sim checkpoint::tests::a_future_dated_regeneration_clock_is_refused --lib` — 1 passed.
- `cargo test -p rh-parity --test parity every_slice_fixture_matches_legacy -- --nocapture` — `regen_clock 200 ticks
  events 3 results 0 max hp err 4.47e-7 OK`; every other slice fixture OK.
- `cargo test -p rh-parity --test regen` — 1 passed (both shares asserted; a checkpoint restored at all 200 ticks).
- `cargo test -p rh-parity --test schedule` — 14 passed.
- `cargo test -p rh-sim --test no_alloc -- --nocapture` — 1 passed; `regen_clock: 160 measured steps, 0 allocations`.
- `cargo test -p rh-sim --test hash_coverage` — 6 passed.
- `cargo test -p rh-sim --test content` — 21 passed (golden `898f82bbb6215c5b`).
- `cargo test -p rh-protocol` — every suite passed.
- `cargo run -p rh-parity --bin parity-report` — 98 slice scenarios + 13 capture-only, 300 pathfinding queries: all MATCH.
- `node tools/browser-proof/proof.mjs` — 15/15 checks PASS, 4 Full + 415 delta snapshots, content hash
  `898f82bbb6215c5b`; protocol unchanged.
- `tools/regen-fixtures/run-mutants.sh` — 8/8 mutants killed by semantic test failures; unchanged control passes.
- `cargo fmt --all --check`, `cargo clippy --workspace --all-targets --all-features -- -D warnings` and
  `cargo clippy --workspace --all-targets -- -D warnings` — clean.
- `export PGBIN=/opt/homebrew/opt/postgresql@16/bin; eval "$(bash tools/pgtest/start.sh)" && cargo test --workspace --all-features --locked`
  — 1,389 passed, 0 failed, 2 ignored, 151 test binaries, exit 0. (An earlier run failed `result_recovery`'s restart test
  because `PGBIN` was not exported to its own `start.sh`; that was environmental and passes once exported.)
- `cargo test -p rh-headless --test regen` — 1 passed (seeded six-bot match: every-seventh-tick restores, quiet share
  observed, full replay reproduces the final hash).

## Open owner questions / coordinator notes

- The Rust live profile keeps `regen: false` (like `hazards`, `abilities` and `lifecycle` there); legacy's live default is
  on. Turning it on is a staged-profile product decision.
- Shared status records are coordinator-owned. Current identity: protocol 8, observation 16 (unchanged by this packet),
  content `898f82bbb6215c5b` (was `e95d55ba96b2feca`). Adding `SimConfig.regen` and `Player.regen_at` moves every state
  hash, so the perf gate must be told `Perf-Allow-Fingerprint: stateHashFold`.
- `packages/**` is unchanged in this branch.

## Next action

PR #32 (P-MOBS-2 regen slice) is open; collect its CI (the perf gate must honour the declared
`Perf-Allow-Fingerprint: stateHashFold`) before starting the next packet. Remaining Pending rows at this base:
`factions.healOverTime`, `factions.markTaxSource`, `mobs.resetDummies`, `buffs.expireBoosts`, `quests.questSystem`,
`traders.updateTraders`, `cardHooks.afterDamage`, `bruiserPassives.update` (×2), `fireRoam.update` (×2 + hook/mod rows),
`campHeal.payCampHeal`, `walkHint.updateWalkHints`, `consumables.<anonymous>` and the remaining P-ARENA-2 rows.

Suggested next packet (dependency order, unreserved): **P-MOBS-2's camp-clear reward** is blocked on the large potion
(P-CONS-1), so take **P-FACTION-1's `factions.healOverTime` + the `hurt` trigger rows** (Second Wind / Blood Saint's
`trigger` rows: `heal` with `ms` and `ignoreLockout`, `barrier`, plus `PlayerRuntime.fired`), which is self-contained and
unblocks the faction-passive wave. `factions.markTaxSource` needs the card attack-speed rows of P-CARDS-1 and should wait.
Start it from a fresh `origin/optimization_port` base the same way (standalone branch, its own evidence README).
