# AGENTS.md

Roguehalla is being migrated from a TypeScript/Colyseus/Phaser game (`packages/`, still runnable) to a Rust authoritative
server (`crates/`) and a Unity browser client (`client-unity/`). Stage 1 (foundation) is done; the bulk port is next.

**In progress: the core optimization sweep** ([docs/sweep/README.md](docs/sweep/README.md): P8, P9, the CI perf gate, the P10b
measurement and H-server are merged at `3ad072b`; H-sim (restore hardening) and P10c (protocol v3 delta, ADR 0010) are still in
progress, specs in [docs/sweep/PACKAGES.md](docs/sweep/PACKAGES.md)). The wire is v2 until P10c merges. Finish the sweep before backlog packets
that edit `crates/rh-sim`.

Read in this order: [docs/MIGRATION.md](docs/MIGRATION.md) (state, checkpoint, commands, results), [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md),
[docs/CONTRACTS.md](docs/CONTRACTS.md), [docs/backlog/README.md](docs/backlog/README.md) and its ready packets,
[docs/adr/](docs/adr/README.md). Legacy architecture (long, partly stale; code wins): [docs/legacy/CLAUDE_LEGACY.md](docs/legacy/CLAUDE_LEGACY.md)
and the verified [docs/legacy/INVENTORY.md](docs/legacy/INVENTORY.md).

Non-negotiables:
- `rh-sim` is pure (no I/O, clock, entropy); fixed 20 Hz step; the legacy tick order is never reordered (C-TICK).
- Every actor (human, bot, future policy) acts only through `validate` + `Sim::submit` (C-INPUT); observations never
  leak hidden state (C-OBS); secrets never leave the server (C-RNG).
- Every ported mechanic comes with captured legacy fixtures and a parity test (`parity/`, C-PARITY).
- Wire changes: bump `PROTOCOL_VERSION` when incompatible; regenerate the golden vectors `protocol/fixtures/v<PROTOCOL_VERSION>.json` (`cargo run -p rh-protocol --bin protocol-fixtures`); the Rust, C# and JS decoders must all pass them.
- No ML training, models, datasets, Python bindings or inference services ([docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) R-ML).
- Only the coordinator edits shared status records (MIGRATION checkpoint, CONTRACTS status table) and `Cargo.lock`.

Commands: `cargo test --workspace` (Postgres tests: `eval "$(tools/pgtest/start.sh)"`), `cargo run -p rh-parity --bin parity-report`,
`dotnet test client-unity/RoguehallaNet.Tests`, `node tools/browser-proof/proof.mjs`; legacy: `npm ci && npm test`.
