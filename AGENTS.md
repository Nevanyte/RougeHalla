# AGENTS.md

Roguehalla is being migrated from a TypeScript/Colyseus/Phaser game (`packages/`, still runnable) to a Rust authoritative
server (`crates/`) and a Unity browser client (`client-unity/`). Stage 1 (foundation) is done; the bulk port is next.

Read in this order: [docs/MIGRATION.md](docs/MIGRATION.md) (state, checkpoint, commands, results), [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md),
[docs/CONTRACTS.md](docs/CONTRACTS.md), [docs/backlog/README.md](docs/backlog/README.md) and its ready packets,
[docs/adr/](docs/adr/README.md). Legacy architecture (long, partly stale; code wins): [docs/legacy/CLAUDE_LEGACY.md](docs/legacy/CLAUDE_LEGACY.md)
and the verified [docs/legacy/INVENTORY.md](docs/legacy/INVENTORY.md).

Non-negotiables:
- `rh-sim` is pure (no I/O, clock, entropy); fixed 20 Hz step; the legacy tick order is never reordered (C-TICK).
- Every actor (human, bot, future policy) acts only through `validate` + `Sim::submit` (C-INPUT); observations never
  leak hidden state (C-OBS); secrets never leave the server (C-RNG).
- Every ported mechanic comes with captured legacy fixtures and a parity test (`parity/`, C-PARITY).
- Wire changes: bump `PROTOCOL_VERSION` when incompatible; regenerate `protocol/fixtures/v1.json`; the C# mirror passes.
- No ML training, models, datasets, Python bindings or inference services ([docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) R-ML).
- Only the coordinator edits shared status records (MIGRATION checkpoint, CONTRACTS status table) and `Cargo.lock`.

Commands: `cargo test --workspace` (Postgres tests: `eval "$(tools/pgtest/start.sh)"`), `cargo run -p rh-parity --bin parity-report`,
`dotnet test client-unity/RoguehallaNet.Tests`, `node tools/browser-proof/proof.mjs`; legacy: `npm ci && npm test`.
