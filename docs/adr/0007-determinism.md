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

## Addendum (core optimization sweep, P8): state identity by construction

**Decision.**
- **The state hash is derived, not listed.** `Sim::state_hash` serializes the `World` through serde into a word-wise
  hasher (`rh-sim/src/hash.rs`): one 64-bit word per value, field names ignored, enum variants by index, sequences, maps and
  strings length-prefixed, `Option` by tag, one multiply-rotate per word and a splitmix64 finalizer. It is seeded with the
  digest of the statics (configuration, map layer, spawns) computed once at construction and on decoding. What a checkpoint
  restores and what the hash sees are the same set: a new component is hashed the moment it is a serde field of the world.
  The hand list and its 66 invisible leaves are gone (`tests/hash_coverage.rs`: 0 unhashed of 12,696 leaves perturbed).
- **Secrets stay out of the digest.** They are constant per match and a replay stores them; a hash that mixed them would
  be an offline oracle against the 32-bit secrets the day a hash is logged or exported (C-RNG). The state hash is a
  server-side determinism check, not a security hash.
- **The world has a layout rule, enforced.** No non-finite float (JSON writes it as `null`, so a checkpoint could not restore
  it; a "never" sentinel is an `Option`), no `skip_serializing_if` and no `flatten` (a missing or map-shaped field would be
  ambiguous to the hasher), no sequence of unknown length. `Sim::check_layout` (a validating run of the same serializer) is
  tested over real matches. `#[serde(skip)]` is the only way to leave a field out of both the checkpoint and the hash; every
  one is pinned in `tests/hash_coverage.rs` with its reason (derived tables, the digest, tick-boundary-empty scratch).
- **Replays are `rh-replay/2`.** The per-step hashes changed definition once, so `run_replay` refuses any other tag with
  `ReplayError::Format { found }` before running a step (an `rh-replay/1` file cannot verify on any build).
- **A decoded value is complete.** `TileMap` decodes through `TileMap::new` (shape checked, derived tables built), `MatchStatic`
  computes its digest while decoding, and `Sim` deserialization builds the scratch empty. `TileMap::rebuild` and
  `Sim::after_restore` are removed: a malformed or truncated checkpoint or replay is an `Err`, never a panic. A checkpoint's
  `format` tag is refused before its payload is interpreted whatever the key order.
- **The numeric and ordering rules are a lint.** `crates/rh-sim/clippy.toml` disallows `HashMap`/`HashSet`, the platform-libm
  `f64` transcendentals (`sin`, `cos`, `atan2`, `hypot`, `exp`, `ln`, `powf`, ...), `mul_add` and the wall clock
  (`Instant`, `SystemTime`) in `rh-sim`; CI's `clippy -D warnings` enforces it. A sanctioned use carries
  `#[allow(clippy::disallowed_methods)]` with its reason beside it (today: one test input generator).

**Evidence.** `crates/rh-sim/tests/hash_coverage.rs`, `crates/rh-sim/tests/replay.rs`, `crates/rh-sim/tests/checkpoint.rs`,
`crates/rh-sim/src/hash.rs` unit tests, `crates/rh-sim/clippy.toml`.
