# DeepSeek Rust completion — progress ledger

Branch: `deepseek/rust-completion`
Base: `856618eb948555adefc6ff0bf4628d879d556250` (`origin/optimization_port`, 2026-11-06)

| Packet | Status | Commit range / PR | Evidence |
|---|---|---|---|
| P-FACTION-4 Sentenced hunt | `INCOMPLETE` — native gameplay, capture, per-tick parity, restore and six mutant controls pass; protocol exposure and the workspace gate remain | working tree (not yet committed) | [`stage2-sentenced-hunt`](../stage2-sentenced-hunt/README.md) |

## Commands actually run

- `cargo test -p rh-sim systems::sentenced_hunt --lib` — 6 passed.
- `cargo test -p rh-sim checkpoint::tests::a_hunt_selection --lib` — 1 passed.
- `cargo test -p rh-parity --test parity every_slice_fixture_matches_legacy -- --nocapture` — all slice fixtures OK; the six new hunt fixtures compare at every tick (534 ticks).
- `cargo test -p rh-parity --test hunt` — 2 passed (every-tick restore + diagnostics required/exercised).
- `cargo test -p rh-sim --test no_alloc -- --nocapture` — zero allocations per warmed step.
- `cargo test -p rh-sim --test hash_coverage` — all six tests pass; every serialized leaf perturbs the state hash.
- `tools/hunt-fixtures/run-mutants.sh` — 6/6 mutants killed by semantic test failures, tree restored after each.
- Captures: pinned Linux x64 Node `v22.23.4` (`node:22.23.4-bookworm-slim`), `npm ci --ignore-scripts` inside the container, `node --import tsx parity/legacy-capture/capture.ts --out parity/fixtures --only <scenario>`.

## Open owner questions

- None for the hunt mechanic itself. The source intentionally lets the hunter see the selected actor through fog/bush but the server keeps hidden/untargetable attack rules; that asymmetry is pinned by tests and implemented as source.

## Next action

1. Add the P-FACTION-4 protocol exposure (HuntTarget command and self hunt fields), regenerate protocol vectors and update the C#/JS mirrors.
2. Add six committed mutants and the runner under `tools/hunt-fixtures/mutants/`.
3. Run the workspace gate on the rebased head, then open one PR for the packet.
