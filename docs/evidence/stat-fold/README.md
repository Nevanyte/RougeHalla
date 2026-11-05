# Stat-fold kernel evidence

## Scope and provenance

- Implementation base: `8e9e9e54a98145f80baa4cd15613f1afd6554b96`.
- Unchanged TypeScript reference: `de6f1c196f9b6a42e50dfdf19327d72bd3683fc8`.
- Canonical capture: Linux x64, Node `22.23.4`, locked npm tools; `parity/stat-fold/canonical.json` SHA-256 `1ae8161f60a004a41262ede8abda39280a5df837934be2eab75eb82bc4b22328`.
- Differential CI/soak diagnostics: macOS arm64, Node `25.8.1`, Rust `1.97.0`; these host runs do not replace canonical capture.
- The kernel is pure and unwired. It does not implement cards/status runtime, condition evaluation, reward RNG, world events, or gameplay scheduling.

## Actual results

- Canonical: 463 cases and 207 coverage entries, including 164 actual-card cases covering all 82 default/faction row sets through both fold entry points. Canonical generation and read-only byte-exact `--check` passed. The reference commit is pinned deliberately; implementation `HEAD` does not alter canonical bytes.
- CI: exactly 4096 semantically distinct cases, 32 batches of at most 128, one worker; 571 ms in the final diagnostic run.
- Soak: exactly 10000 semantically distinct cases, 79 batches of at most 128, two workers; 754 ms in the final diagnostic run. The owner explicitly reduced the packet's original 100000-case requirement to 10000.
- Rust fixture target: 11 tests passed, covering every canonical output, external batches, failure evidence, strict schemas, and integrity negatives.
- Rust kernel unit tests: 18 passed; all 33 numeric content-visitor words have mutation coverage.
- Node runner tests: 6 passed, including real external-batch execution and build-stage versus case-failure evidence.
- Existing parity: 97 compared scenarios and 300 pathfinding queries MATCH; 13 scenarios remain explicitly capture-only.
- Formatting and strict `rh-sim` all-target/all-feature Clippy passed.
- Full `cargo test --workspace --all-features --locked` passed using the throwaway local PostgreSQL 16 cluster. On macOS the existing helper requires `PGBIN=/opt/homebrew/opt/postgresql@16/bin`; no PostgreSQL test was skipped.

The unchanged controls pass. Runtime semantic mutations were caught for additive product stats, chained conversion outputs, cap-after-`asPost`, farm rows inside card ceilings, self-compounding boost gains, missing requirements, reversed row-specific while decisions, ties-to-even encoding, and narrow-integer mirrors. Empty, missing, duplicate, reordered, extra, malformed, unknown-key/variant, and required-nullable-omission controls fail.

NaNs compare by classification, not payload/sign bit; signed zero, infinities, cap/branch decisions, flags, requirements, and all encoded/decoded mirror outcomes remain exact. Diagnostic continuous tolerance never applies to those discrete outcomes.

## Commands

```sh
node --import tsx tools/stat-fold/capture.ts --preset canonical --check
node --import tsx --test tools/stat-fold/run.test.ts
node --import tsx tools/stat-fold/run.ts ci
node --import tsx tools/stat-fold/run.ts soak
cargo test --locked -p rh-sim --test stat_fold -- --test-threads=1
cargo clippy --locked -p rh-sim --all-targets --all-features -- -D warnings
cargo run --locked -p rh-parity --bin parity-report
cargo fmt --all --check
```

Canonical capture/check requires the documented Linux x64 Node `22.23.4` runtime. Other hosts require an explicit diagnostic output and never replace the canonical fixture. Generated CI/soak corpora are ephemeral; only compact results and first-failure evidence are retained.

## Proposed coordinator content registration

Do not apply this hunk in the packet; the coordinator owns `content.rs` and the resulting golden update:

```rust
h.str("stat-fold/1");
crate::stat_fold::visit_content(
    &crate::stat_fold::default_definition(),
    |word| h.u64(word),
);
```

The final implementation head and full workspace/CI results are reported with the pull request. No full-card-system, full-game parity, performance, or release claim follows from this kernel evidence.
