# Contributing

Roguehalla is mid-migration: the legacy TypeScript game (`packages/`) still runs; its replacement is a Rust server
(`crates/`) and a Unity browser client (`client-unity/`). Start with [docs/MIGRATION.md](docs/MIGRATION.md) (state and
checkpoint), [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md), [docs/CONTRACTS.md](docs/CONTRACTS.md) and
[docs/backlog/README.md](docs/backlog/README.md).

## Setup
- Rust: the toolchain is pinned in `rust-toolchain.toml` (rustup installs it on first use).
- .NET 8 SDK for the C# net library tests (no Unity needed for them).
- Node 22+ and `npm ci` for the legacy game and capture tools; exact committed fixture generation uses Linux x64 and Node 22.23.4 (`parity/README.md`).
- PostgreSQL 16 binaries for the persistence tests (`tools/pgtest/start.sh` starts a throwaway cluster). On macOS set `PGBIN=/opt/homebrew/opt/postgresql@16/bin` (or your installation path). `PGBIN=... bash tools/pgtest/smoke.sh` verifies start/reuse/stop without touching the test cluster already in use.
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
npx tsx parity/legacy-capture/capture.ts            # exact fixture generation requires Linux x64 + Node 22.23.4 (parity/README.md)
```

## Performance gate
Pull requests that touch `crates/`, `parity/`, `Cargo.*`, `rust-toolchain.toml` or `tools/perfproof/` run `.github/workflows/perfproof.yml`: a deterministic
valgrind (callgrind and DHAT) A/B of the PR head against its merge-base on fixed workloads, with the table in the job
summary. It fails when instructions per unit of work rise by more than 3% (`--max-ir-ratio 1.03`; measured noise for a revision
against itself is a few tenths of a percent at most), when allocations per unit rise at all (`--max-alloc-increase 0`), or when any behaviour
fingerprint (outcome digest, state hashes, replay verification against base-recorded replays) differs.

A PR that changes behaviour on purpose declares it with one line in its description, naming workloads, fingerprint keys
or `workload.key` (the syntax of `--allow-fingerprint-change`):
```
Perf-Allow-Fingerprint: sim_crowded_8, paths_300.outcomeDigest
```
The description is read when the job runs and the workflow also reacts to description edits (`edited`), so a newly added
line is picked up by the next run: edit the description (which starts a run) or re-run the failed job.

Run it locally (needs valgrind on Linux; builds both sides into `target/perfproof`, then `rm -rf target/perfproof`):
```
python3 tools/perfproof/perfproof.py --baseline $(git merge-base origin/main HEAD) --max-ir-ratio 1.03 --max-alloc-increase 0
python3 tools/perfproof/perfproof.py --help         # workloads, --only, the gate flags
```

## Rules
- The simulation is pure: no I/O, clock or entropy in `rh-sim`; the tick order is fixed ([docs/CONTRACTS.md](docs/CONTRACTS.md) C-TICK).
- Wire changes: bump `PROTOCOL_VERSION` when incompatible; regenerate the golden vectors
  `protocol/fixtures/v<PROTOCOL_VERSION>.json` (`cargo run -p rh-protocol --bin protocol-fixtures`); the Rust, C# and JS
  decoders must all pass them.
- Every ported mechanic arrives with captured legacy fixtures and a parity test.
- Shared files (`Cargo.lock`, `docs/MIGRATION.md`, the CONTRACTS status table) are edited by one coordinator at a time.
- Project-authored code uses the MIT license (`LICENSE`, owner choice 2026-11-05). Dependencies and third-party assets
  retain their own terms; record provenance/license before adding or redistributing them. Unity remains separately licensed.
