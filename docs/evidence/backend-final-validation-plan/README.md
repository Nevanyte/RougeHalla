# Combined backend validation command sheet

## Scope and inspected environment

Read-only plan checked against integration HEAD `d91f649d1fcb09c1d1b5e75b7c895fdeba46e454` (the only later change from the reviewed `704966d8` cut is the separate Unity merge-readiness document). The authoritative CI recipe is `.github/workflows/rust.yml`; local PostgreSQL setup is `tools/pgtest/start.sh` and `tools/pgtest/stop.sh`. No suite was run and no database was started or stopped.

Observed local tool paths/versions:

- Rust: `/Users/nevinmckinnon/.cargo/bin/cargo` 1.97.0 and `rustc` 1.97.0; use the repository `rust-toolchain.toml` as CI does.
- PostgreSQL: Homebrew 16.15 at `/opt/homebrew/opt/postgresql@16/bin`. The helper's Linux default `/usr/lib/postgresql/*/bin` does not resolve on this macOS host; set `PGBIN` explicitly for both start and stop.
- .NET: `dotnet` is not on `PATH`, but `/Users/nevinmckinnon/.dotnet/dotnet` exists and reports SDK 8.0.427. Invoke it directly or add `/Users/nevinmckinnon/.dotnet` to `PATH` for the later C# check.
- Node/npm currently resolve to Node 25.8.1/npm 11.11.0; there is no Node 22 binary on the observed `PATH`. CI pins Node 22.23.4 for direct JS/provenance checks. The source capture wrappers below run their own pinned Node 22.23.4 Docker image. For plain Node tools, use the explicit `node22` wrapper below or first discover an installed Node 22.23.4 binary; do not treat ambient Node 25 as CI-equivalent.

## Isolated local run root

Use one disposable target and PostgreSQL state namespace for the final validation. The command block is a plan; it has not been executed.

```sh
set -euo pipefail
export RH_FINAL_RUN_ROOT="$(mktemp -d /tmp/rh-backend-final.XXXXXX)"
export CARGO_TARGET_DIR="$RH_FINAL_RUN_ROOT/target"
mkdir -p "$CARGO_TARGET_DIR"
export PATH="/Users/nevinmckinnon/.cargo/bin:/Users/nevinmckinnon/.dotnet:$PATH"
export CARGO_PROFILE_DEV_DEBUG=0
export CARGO_PROFILE_TEST_DEBUG=0
export CARGO_INCREMENTAL=0
export CARGO_BUILD_JOBS=1
export PGBIN=/opt/homebrew/opt/postgresql@16/bin
export RH_PGTEST_STATE="$RH_FINAL_RUN_ROOT/pg-state"
export RH_FINAL_LOG="$RH_FINAL_RUN_ROOT/validation.log"
exec > >(tee -a "$RH_FINAL_LOG") 2>&1
export RH_NODE22_IMAGE=node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292
RH_REPO_ROOT="$(git rev-parse --show-toplevel)"
RH_PGTEST_STARTED=0
node22() {
  docker run --rm --platform linux/amd64 \
    --mount "type=bind,src=$RH_REPO_ROOT,dst=/repo,readonly" \
    -w /repo "$RH_NODE22_IMAGE" node "$@"
}
cleanup_owned_pgtest() {
  if [ "$RH_PGTEST_STARTED" = 1 ]; then
    tools/pgtest/stop.sh
  fi
}
trap cleanup_owned_pgtest EXIT
```

`start.sh` creates a throwaway cluster under a separate `/tmp/rh-pgtest.*` data directory and prints the `DATABASE_URL` export. `stop.sh` uses the same `PGBIN` and `RH_PGTEST_STATE` and stops/removes only that owned cluster. The exit trap preserves the validation log and Cargo target for Root's review and reuse; remove the run root only in a separate, explicit cleanup after evidence review. Keep start and stop in this same shell so their state path and environment agree. The helper uses local trust auth and turns off fsync/synchronous commit/full-page writes; it is a disposable test database, not a persistence/durability measurement.

## Backend union gates after Card, Brain and Quest admission

Run once on the final integrated backend tree. These are the present required CI checks in `rust.yml`; the CI jobs use separate 60-minute simulation and Rust timeouts. The fresh target avoids cross-project artifacts but incurs a cold compile and disk use; retain it through all commands to share the build and preserve it for review. `--offline --locked --jobs 1` uses cached lockfile dependencies and bounds build parallelism; if a required locked crate is not cached, record that exact obstacle and have Root decide whether to populate the cache before retrying.

```sh
node22 tools/provenance/check-card-chain.mjs
cargo fmt --all --check
cargo clippy --locked --offline --jobs 1 --workspace --all-targets --all-features -- -D warnings
cargo clippy --locked --offline --jobs 1 --workspace --all-targets -- -D warnings
cargo fmt --manifest-path tools/map-bench/Cargo.toml -- --check
cargo check --locked --offline --jobs 1 --manifest-path tools/map-bench/Cargo.toml --target-dir "$RH_FINAL_RUN_ROOT/map-bench-target"
cargo test --locked --offline --jobs 1 -p rh-sim --features trusted-status-probes
cargo test --locked --offline --jobs 1 --workspace --exclude rh-sim
cargo run --locked --offline --jobs 1 -p rh-parity --bin parity-report
cargo run --locked --offline --jobs 1 --release -p rh-headless -- --matches 4 --players 8 --map parity/maps/seed1.map.json --max-ticks 4000
cargo run --locked --offline --jobs 1 --release -p rh-headless -- --matches 1 --players 8 --map crates/rh-sim/src/mapdata/fixtures/seed1.map.json --max-ticks 4000
```

Then run the PostgreSQL-backed checks with the local isolated cluster:

```sh
eval "$(tools/pgtest/start.sh)"
RH_PGTEST_STARTED=1
cargo test --locked --offline --jobs 1 -p rh-server --features postgres
cargo test --locked --offline --jobs 1 -p rh-placement --features postgres,fault-injection
```

The simulation suite is the union gate for `rh-sim`, including source-derived Card report/projector, restore, reset, privacy and room-step tests; the workspace-excluding-sim suite includes `rh-policy` Brain and the server quest-room delivery integration tests. The dedicated Postgres commands cover the server's persistent store and placement recovery tests that ordinary workspace defaults do not run with their required features. Do not replace them with a default-only `cargo test --workspace`.

This is the focused native/backend portion, not a substitute for the entire `rust` CI job. Before calling the union fully CI-validated, run the remaining steps in [the workflow](../../../.github/workflows/rust.yml): the private durable-state guard and staging Python suites, JS protocol/browser contract checks, existing grouped source-corpus capture checks, status/Plague/Fire/Frost/Sentenced/map witnesses, and the workflow's final Chromium WSS proof. Those steps are intentionally left in their existing maintained workflow so this sheet does not fork or silently prune its long source-check list.

If the final Card seal retains the ignored global-dhat regression(s), also run its bounded allocator command serially (per the separate Card CI review):

```sh
cargo test --locked --offline --jobs 1 -p rh-sim --features trusted-status-probes --lib card_bleed_alloc -- --ignored --test-threads=1
```

The ordinary `rh-sim` suite skips ignored tests. The `card_bleed_alloc` filter selects the two final ignored regressions, `card_bleed_alloc` and `card_bleed_alloc_public_output`, serially; do not enable all ignored tests together because unrelated tests use the same process-global allocator.

## Missing source-corpus freshness checks in current CI

The native union commands above already execute the Rust source comparators: Brain/Memory/Hand, private Modules and Tactics run under `rh-policy` in the workspace-excluding-sim suite; Card and the quest-room source projection run under `rh-sim`; server quest bridge tests run in the workspace and PostgreSQL suites. These compile/replay the stored corpora, but they do not prove that unchanged legacy TS producers and their capture tools still reproduce those bytes. Current `rust.yml` has no source-witness command for the newly admitted private Brain, Modules, Tactics, Card-bleed or Quest room-feedback harnesses.

The minimal missing CI freshness set, once these candidates are admitted, is one grouped source-witness step with read-only checks for the new profiles:

```sh
bash tools/card-bleed-fixtures/capture.sh --check
bash tools/bot-private-brain-fixtures/capture.sh --check
bash tools/bot-private-modules-fixtures/capture.sh --check
bash tools/bot-private-tactics-fixtures/capture.sh --check
bash tools/quest-room-feedback-fixtures/capture.sh --check
```

The Brain corpus includes its `handSupplement` and actual Memory traces, so no separate Hand capture command is needed. The standalone older `bot-memory-subset` harness is not the admitted full Memory witness and should not be added just because Memory is consumed; the direct Memory cases in these admitted profiles are replayed by the native suite.

Quest room feedback is derived from `parity/quest-giver/source.json` case 7. The room-feedback capture check pins that original corpus as input and verifies the projected witness. If the quest-giver producer, input corpus or its binding changes, also run `bash tools/quest-giver-fixtures/capture.sh --check`; it is not necessary to replay that separate source capture for an unchanged bound input. Existing `quest-public-fixtures` and `quest-notice-fixtures` checks are already in the workflow and need no duplicate commands.

These source commands are conditional on their bound source/tool/corpus identities changing since the author/reviewer receipts. With unchanged bindings, compare the integrated file hashes to the sealed receipts/manifests and keep the existing native test results; do not regenerate, recapture, or replay all controls just for the final union. If a binding changes, run the corresponding pinned `--check` and the candidate's already documented controls before admitting that changed witness. Do not use capture write modes to refresh canonical data during final verification.

For any plain Node command such as the fast provenance auditor or `manifest.mjs --check`, use the declared pinned runtime through `node22`, not the ambient Node 25 binary:

```sh
node22 tools/provenance/check-card-chain.mjs
node22 tools/bot-private-brain-fixtures/verify.mjs parity/policy/bot-private-brain/source.json
node22 tools/bot-private-brain-fixtures/manifest.mjs --check
node22 tools/bot-private-modules-fixtures/verify.mjs
node22 tools/bot-private-modules-fixtures/manifest.mjs --check
node22 tools/bot-private-tactics-fixtures/verify.mjs
node22 tools/bot-private-tactics-fixtures/manifest.mjs --check
```

## Later merged Unity/network/browser gates

After Claude's Unity/network changes are integrated and the final protocol/content identities are frozen, validate the merged tree separately:

```sh
/Users/nevinmckinnon/.dotnet/dotnet test client-unity/RoguehallaNet.Tests
bash client-unity/sync-net.sh --check
node22 tools/protocol-js/check-vectors.mjs
node22 tools/protocol-js/check-first-playable.mjs
node22 --test tools/browser-proof/protocol14-ui/contract.test.cjs
node22 --test tools/unity-browser-reload-proof/check.test.mjs tools/unity-browser-reload-proof/local-router.test.mjs
```

Run the Node commands under the workflow's Node 22.23.4 runtime (the `node22` wrapper above is suitable for the pure protocol tests). Then perform the actual WSS Chromium proof from the workflow against the merged server/client build:

```sh
cargo build --locked --offline --jobs 1 -p rh-server
npm i --no-save playwright@1.63.0
npx playwright install --with-deps chromium
node tools/browser-proof/proof.mjs
```

The browser block needs Node 22.23.4 plus a Chromium download/system dependencies; it is a separate, networked browser validation, not implied by Rust, headless or C# success. Keep any final test-site deployment and its browser evidence separate from this local validation sheet.

After Root has reviewed and copied the preserved raw log and any failure evidence, cleanup is a separate explicit action:

```sh
rm -rf "$RH_FINAL_RUN_ROOT"
```
