# Contributing

Roguehalla is mid-migration: the legacy TypeScript game (`packages/`) still runs; its replacement is a Rust server
(`crates/`) and a Unity browser client (`client-unity/`). Start with [docs/MIGRATION.md](docs/MIGRATION.md) (state and
checkpoint), [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md), [docs/CONTRACTS.md](docs/CONTRACTS.md) and
[docs/backlog/README.md](docs/backlog/README.md).

## Setup
- Rust: the toolchain is pinned in `rust-toolchain.toml` (rustup installs it on first use).
- .NET 8 SDK for the C# net library tests (no Unity needed for them).
- Node 22+ and `npm ci` for the legacy game and the parity capture tool.
- PostgreSQL 16 binaries for the persistence tests (`tools/pgtest/start.sh` starts a throwaway cluster).
- Unity 6 LTS only for the Unity project itself (see `client-unity/README.md`).

## Everyday commands (no Unity, no AWS)
```
cargo build --workspace
cargo test --workspace                              # rh-persist's tests need DATABASE_URL (eval "$(tools/pgtest/start.sh)")
                                                    # or RH_SKIP_PG_TESTS=1 to skip them explicitly
cargo run -p rh-parity --bin parity-report          # Rust vs captured legacy scenarios
cargo run --release -p rh-headless -- --matches 20 --players 8 --map parity/maps/seed1.map.json
cargo run -p rh-server -- --self-signed --fill-bots 4 --min-players 1 --fill-seconds 2
                                                    # then open https://localhost:7777/probe (accept the self-signed cert)
npm i --no-save playwright@1.63.0 && npx playwright install chromium   # once, for the browser proof
node tools/browser-proof/proof.mjs                  # Chromium over WSS end to end (after cargo build -p rh-server)
dotnet test client-unity/RoguehallaNet.Tests        # any .NET 8 SDK on PATH
npx tsx parity/legacy-capture/capture.ts            # re-capture legacy fixtures after a legacy change
```

## Rules
- The simulation is pure: no I/O, clock or entropy in `rh-sim`; the tick order is fixed ([docs/CONTRACTS.md](docs/CONTRACTS.md) C-TICK).
- A wire change bumps `PROTOCOL_VERSION` when incompatible and regenerates `protocol/fixtures/v1.json`
  (`cargo run -p rh-protocol --bin protocol-fixtures`); the C# mirror must pass the same vectors.
- Every ported mechanic arrives with captured legacy fixtures and a parity test.
- Shared files (`Cargo.lock`, `docs/MIGRATION.md`, the CONTRACTS status table) are edited by one coordinator at a time.
- No license is declared yet: do not add third-party assets without recording their license.
