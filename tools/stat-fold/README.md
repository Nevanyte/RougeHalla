# Stat-fold differential runner

This directory captures the actual TypeScript stat-fold functions and compares their complete outputs with the pure Rust `rh-sim` kernel. It does not activate cards or wire the kernel into gameplay.

## Canonical capture and byte check

The checked-in corpus is `parity/stat-fold/canonical.json` in the closed `rh-stat-fold/1` format. Canonical generation and independent byte checking require Linux x64 Node 22.23.4:

```sh
node --import tsx tools/stat-fold/capture.ts --preset canonical
node --import tsx tools/stat-fold/capture.ts --preset canonical --check
```

`--check` never rewrites the fixture. On another host, an explicitly diagnostic capture requires both `--diagnostic` and a noncanonical `--output`; it cannot replace the canonical fixture. Ordinary Rust canonical tests run without runner environment variables:

```sh
cargo test -p rh-sim --test stat_fold
```

## Full differential presets

Run from the repository root:

```sh
node --import tsx tools/stat-fold/run.ts ci
node --import tsx tools/stat-fold/run.ts soak
```

`ci` always executes the complete, ordered **4,096-case** inventory. `soak` always executes the complete, ordered **100,000-case** inventory. Both inventories are semantically unique and include the canonical cases before deterministic generated cases.

The accepted options and defaults are:

| Command | `--count` | `--batch-size` | `--workers` | `--timeout-ms` |
| --- | ---: | ---: | ---: | ---: |
| `ci` | exactly `4096` | `128`, range `1..256` | exactly `1` | `120000` |
| `soak` | exactly `100000` | `128`, range `1..256` | `1` or `2`, default `2` | `300000` |

A supplied count must equal the full preset count: these options do not turn CI or soak into sampled or truncated runs. The timeout is one total deadline for build and all batches. Zero, partial or out-of-range work, unknown variants, duplicate flags, missing values, and extra arguments fail before execution.

The runner validates the entire freshly generated inventory before building or batching: exact count and ordered IDs, strict closed inputs, unique IDs and semantic identities, and required coverage. Each bounded batch is an exact `rh-stat-fold/1` corpus with batch-local coverage and expected outputs obtained by calling `captureCase` on each case specification. Expected answers are never passed to a TypeScript or Rust kernel input function.

The runner builds the integration test executable once with locked dependencies and at most two Cargo jobs:

```sh
cargo test -p rh-sim --test stat_fold --no-run --jobs 2 --message-format=json --locked
```

It parses Cargo's JSON compiler artifact rather than guessing a target path. Builds use the isolated `target/stat-fold-differential` directory by default; `RH_STAT_FOLD_TARGET_DIR` selects a different isolated target. Each batch invokes that executable as:

```sh
<executable> --exact external_batch --nocapture
```

with `RH_STAT_FOLD_BATCH` and `RH_STAT_FOLD_FAILURE` set to temporary paths. CI uses one Rust child; soak uses at most two. A semantic mismatch, malformed corpus, nonzero test exit, failure artifact, or expired total deadline fails the run. Successful batch/corpus files are deleted, and a successful run prints one compact JSON summary with its verified case count. On failure, only compact failure JSON is retained in the temporary run directory; the error output prints its path. Inventory, build, and provenance failures record their explicit `stage`, null case-specific fields, and no replay command. Actual batch failures retain the case input, seed, function/field, expected/actual evidence, and replay command. Generated CI and soak corpora are not checked in.

## Single-case replay

A failure's `replay` field is a minimal command of this form:

```sh
node --import tsx tools/stat-fold/run.ts case --preset ci --id ci-00000
node --import tsx tools/stat-fold/run.ts case --preset soak --id soak-99999
```

Replay freshly generates and validates the full selected inventory, selects exactly one existing ordered ID, recaptures its expected output from the actual TypeScript source, and runs one real Rust external batch. It does not read answers from an old batch. Case mode accepts only `--preset` and `--id`.

## Provenance and comparison limits

Every batch records its reproducible runner command, current commit, packet base `de6f1c196f9b6a42e50dfdf19327d72bd3683fc8`, exact Node/platform/architecture, and SHA-256 hashes for the five actual legacy sources and the capture/runner tools. Linux x64 Node 22.23.4 batches are labelled `canonical` and use exact comparison; other hosts are explicitly `diagnostic`. Binary64 values remain exact 16-digit big-endian bit strings, including NaN payloads, infinities, and signed zero.

Canonical continuous calculations are expected to match exactly on the Linux x64 oracle. Any host-only continuous diagnostic tolerance is limited by the packet to `<= 2e-6`; NaN/infinity/signed-zero classification, identities, requirements, cap decisions, flags, integer and encoded/decoded mirror outcomes remain exact. A different quantized, cap, or flag result is never tolerated.

Focused runner tests, including one actual external-batch replay, use Node's built-in test runner:

```sh
node --import tsx --test tools/stat-fold/run.test.ts
```

This harness proves only the bounded pure stat-fold functions represented by the inventory. It does not evaluate gameplay conditions, activate cards/statuses, exercise combat or networking, or establish full-game parity or release readiness.

For direct external-file use, native failure JSON contains a structured `replay` object with `argv` and an `env.RH_STAT_FOLD_BATCH` path. Execute the argument array without a shell, preserving that environment value. The generated runner instead retains a fresh preset/ID replay command after verifying the reported ID and seed belong to its actual batch; its temporary corpus can then be removed safely.
