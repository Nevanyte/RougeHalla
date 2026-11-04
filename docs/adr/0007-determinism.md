# ADR 0007: Determinism scope, numeric policy and random streams

**Status:** Accepted. **Decision.**
- **Scope:** a match is reproducible from its replay (starting conditions, secrets, every input with its tick) on the
  declared targets: x86_64 and aarch64 Linux, Rust 1.97, any optimisation level. Bitwise identity with the legacy V8
  server is NOT required (parity uses tolerances: [../../parity/README.md](../../parity/README.md)).
- **Numbers:** f64 everywhere in the core; legacy evaluation order; no FMA; transcendental functions from the pure-Rust
  `libm` crate (`rh_sim::math`); `sqrt` is IEEE. JSON checkpoints/replays use serde_json with `float_roundtrip`.
- **Ordering:** per-tick input order is the secret shuffle of join order (legacy `actionOrder`); systems run in the fixed
  legacy order; collections iterate in join order or sorted by id, never hash-map order.
- **Randomness:** the core reads no entropy. `Secrets { order_salt, spawn_seed }` is injected: OS CSPRNG in the live room,
  derived from a run seed in tests/headless. Each stream has one purpose. Policies have their own seeds. The public map
  seed never reproduces gameplay randomness.
- **Secrets:** never in snapshots, observations or public exports. Replays contain them and are therefore private.
- **Content identity:** `content_hash()` covers every content number of the slice; replays and Hello carry it.

**Evidence.** `crates/rh-headless/tests/env.rs` (same seed → same hash, replay through JSON, checkpoint continuation,
independent resets); `crates/rh-server/tests/equivalence.rs`; CI runs the suite on x86_64 (aarch64 is declared but not yet
run in CI: backlog P-CI-2).
