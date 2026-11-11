# rh-headless: local rules

Headless match runner over `rh-sim` and `rh-policy`, without networking: `cargo run --release -p rh-headless -- --matches N
--players 8 --map parity/maps/seed1.map.json`. Binaries: `determinism_sweep` (CI on x86-64 and arm64), `tournament`,
`scalebench`.

- Same seed and inputs give the same final state hash on every platform; `determinism_sweep` checks it.
- Soak tests (`tests/source_arena_soak.rs`, `examples/source_soak.rs`) are `#[ignore]`d and slow: run them for packets
  that change match flow, not while iterating.
- Headless and policy runs never use client prediction.
