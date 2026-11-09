# Rust protocol gate

Rust protocol v14 adds typed Trade input/state (`Trade` command 18 and State key 11) and five quest presentation strings per row. Quest strings remain opaque UTF-8 protocol values; this codec does not claim native text formatting. The complete Quest value is bounded at 24,576 bytes including availability, and the complete Trade value at 2,213 bytes including availability.

The generated fixture is [v14.json](../../../protocol/fixtures/v14.json), SHA-256 `9012167a320419d04d62aa340276d7fbc5181a60ea818554f278a62d26b1b336`. It includes valid available/unavailable/empty Trade views, duplicate applied stat rows, malformed Trade controls, Quest metadata, exact 24,576/24,577 Quest boundaries, and `state_all_max_budget`: an 11-key valid State frame of exactly 247,696 bytes. Historical fixtures remain unchanged.

## Commands and results

Toolchain: `cargo +1.97.0`; `CARGO_HOME=/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/cargo`; `RUSTUP_HOME=/Users/nevinmckinnon/.rustup`; isolated target `/Users/nevinmckinnon/.codex/targets/rougehalla-trade-quest14`; `CARGO_BUILD_JOBS=1`; `CARGO_INCREMENTAL=0`; `CARGO_PROFILE_DEV_DEBUG=0`; `CARGO_PROFILE_TEST_DEBUG=0`.

- `cargo +1.97.0 run --locked -p rh-protocol --bin protocol-fixtures` — passed; generated v14 fixture. Output: [codec-rust-fixtures.txt](logs/codec-rust-fixtures.txt).
- `cargo +1.97.0 test --locked -p rh-protocol` — passed, 113 tests; 0 failed, 0 ignored. Output: [codec-rust-package-tests.txt](logs/codec-rust-package-tests.txt).
- `cargo +1.97.0 clippy --locked -p rh-protocol --all-targets -- -D warnings` — passed. Output: [codec-rust-clippy.txt](logs/codec-rust-clippy.txt).
- `cargo +1.97.0 fmt -p rh-protocol -- --check` — passed. Output: [codec-rust-fmt-check.txt](logs/codec-rust-fmt-check.txt).
- `git diff --check` — passed.

The Rust tests establish codec behavior, byte budgets and vector agreement. Native-generated Trade projection is tested in separate server/native integration gates; this receipt does not claim gameplay-source parity.
