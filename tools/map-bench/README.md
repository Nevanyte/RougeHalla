# Paired Rust and TypeScript map benchmark

This tool runs from `<repo>/tools/map-bench`; it derives the repository root from its own location and reads source files there. It has a standalone Cargo workspace and path dependency `../../crates/rh-sim`. It does not change the root workspace or source files.

It reuses one Rust `Pipeline` and calls the actual exported TypeScript `certifiedMap`. It performs 5 warmups per mode, then measures both modes on seeds `0..39`, alternating which mode runs first by seed parity. Plain mode uses `styleZones:null, decor:false`; styled mode uses default styling with `decor:false`. `shapeGates` and `bushes` stay enabled. Every generated map is hashed after timing and checked against the unchanged original pin (`PINNED_PLAIN` or `PINNED_MAPS`), retaining seed, attempt and hash per sample. Output includes median, p95, min, max and every timing. No FPS inference is made.

Set `RH_MAP_BENCH_STATE` to an absolute external directory before either command. Cargo targets, the original-pin snapshot, source fingerprint, logs, intermediate JSON and final report all go there. The tool directory is read-only during prepare and run. `prepare.mjs` derives the first 40 pins from the original `mapPins.ts` without generating maps, stores its SHA256 beside the snapshot, then builds the release harness. It records a fingerprint for all Rust source and shared TS source files, relevant Cargo manifests/locks, pins, and harness code. The standalone release profile explicitly matches the repository's `debug = 1`. Preparation compares every normal dependency version in the root `rh-sim` tree with the standalone Cargo resolution; mismatches stop the build and the matched versions are recorded. `run.mjs` verifies the pin snapshot and fingerprint before measurement and checks source, pins and revision again afterward.

The measurement runner requires native Darwin arm64, Apple M5 Pro and Node `v22.23.4`; use the coordinator's quiet window. Node provisioning is left to the caller. The project-local `tsx` dependency is read-only.

## Preparation (no map generation or timings)

```sh
export RH_MAP_BENCH_STATE=/absolute/path/outside/the/repository/rougehalla-map-bench
export CARGO_HOME=/path/to/isolated/cargo-home
export RUSTUP_HOME=/path/to/isolated/rustup-home
export PATH=/path/to/isolated/cargo-home/bin:$PATH
node tools/map-bench/prepare.mjs
```

The repository already needs Node 22.23.4 and its existing `tsx` dependency for the later run. To provision Node in an isolated npm cache, use `npm_config_cache="$RH_MAP_BENCH_STATE/npm-cache" npx --yes --package=node@22.23.4 node --version`; this does not change global Node or npm settings.

## Measurement (coordinator starts this during a quiet window)

```sh
npm_config_cache="$RH_MAP_BENCH_STATE/npm-cache" npx --yes --package=node@22.23.4 node tools/map-bench/run.mjs
```

The report is written to `$RH_MAP_BENCH_STATE/result.json`; logs and separate Rust/TypeScript results stay in that same state directory.
