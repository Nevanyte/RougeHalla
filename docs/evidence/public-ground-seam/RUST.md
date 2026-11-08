# Rust protocol 14 verification

Scope: `rh-protocol` protocol-14 ground-map codec, Welcome cache encoder, Rust samples, and `protocol/fixtures/v14.json`.
Toolchain: Rust 1.97.0. Cargo target: `/Users/nevinmckinnon/.codex/targets/rougehalla-public-ground-seam`.

## Commands and results

The focused Rust suite passed with **95 passed, 0 failed, 0 ignored**:

```sh
RUSTUP_HOME=/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/rustup \
CARGO_HOME=/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/cargo \
CARGO_TARGET_DIR=/Users/nevinmckinnon/.codex/targets/rougehalla-public-ground-seam \
CARGO_BUILD_JOBS=1 \
/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/cargo/bin/rustup run 1.97.0 cargo test -p rh-protocol
```

Suite breakdown: library 8; delta 18; encode 11; envelope 8; size 2; snapshot build 6; state 5; v11 union 4; v4 8; v5 3; v6 PvE 4; v7 hunt 3; vectors 11; Wish/barrier 4. The fixture binary and doc tests contain 0 tests. The added maximum-map test decodes collision, terrain, and region planes at the exact 3,145,728-byte aggregate bound.

Strict protocol Clippy passed:

```sh
RUSTUP_HOME=/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/rustup \
CARGO_HOME=/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/cargo \
CARGO_TARGET_DIR=/Users/nevinmckinnon/.codex/targets/rougehalla-public-ground-seam \
CARGO_BUILD_JOBS=1 \
/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/cargo/bin/rustup run 1.97.0 cargo clippy -p rh-protocol --all-targets -- -D warnings
```

Rust formatting check passed with the pinned toolchain's `rustfmt --edition 2024 --config skip_children=true --check` over the edited Rust files: `src/map.rs`, `src/ground.rs`, `src/codec.rs`, `src/encode.rs`, `src/lib.rs`, `src/samples.rs`, `tests/encode.rs`, `tests/vectors.rs`, and `tests/envelope.rs`.

## Golden fixture

Generated using the real fixture binary:

```sh
RUSTUP_HOME=/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/rustup \
CARGO_HOME=/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/cargo \
CARGO_TARGET_DIR=/Users/nevinmckinnon/.codex/targets/rougehalla-public-ground-seam \
CARGO_BUILD_JOBS=1 \
/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/cargo/bin/rustup run 1.97.0 cargo run -p rh-protocol --bin protocol-fixtures
```

`protocol/fixtures/v14.json` SHA-256: `e22c8eca2ba7f13a21983a14c4ce8b4d00998cff091b1b52561bab1fb53665b4`.

The Welcome vectors cover absent/absent, terrain-only, region-only, both planes, present all-zero planes, and modes 0/1/2. Malformed vectors cover extension shape/version/flags, run and plane bounds/domains, terrain/collision incompatibility, both hashes, mode, extension trailing bytes, and bytes trailing the complete Welcome. Historical fixtures were not regenerated.
