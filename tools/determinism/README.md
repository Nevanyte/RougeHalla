# Determinism sweep

`determinism_sweep` runs bounded, synthetic Rust matches and checks two fresh environments, replay round-trips, and sampled checkpoint continuations. The versioned `inventory-v1.json` is the single scenario source for the Rust executable and this comparator. CI is explicitly enumerated; soak starts with the same CI scenarios and then adds its expanded deterministic families.

All output directories must be new or empty. A successful run writes canonical compact `manifest.json` and `provenance.json`, plus one nonempty synthetic `replay.json`. A failure is nonzero and should leave `failure.json` with the first scenario, seed, tick, component, and a reproduction command. Replays contain private simulation secrets: retain only the synthetic artifacts produced by this harness.

## Run

From the repository root, use the release profile and locked dependencies:

```sh
cargo run --release --locked -p rh-headless --bin determinism_sweep -- ci --out /tmp/rh-determinism-ci
cargo run --release --locked -p rh-headless --bin determinism_sweep -- soak --out /tmp/rh-determinism-soak
cargo run --release --locked -p rh-headless --bin determinism_sweep -- \
  case --scenario practice-truncated-off --seed 5 --out /tmp/rh-determinism-case
```

The equivalent direct binary forms are:

```sh
determinism_sweep ci --out DIR
determinism_sweep soak --out DIR
determinism_sweep case --scenario ID --seed U64 --out DIR
```

Use the scenario ID and seed from `failure.json` when reproducing another case. Unknown, duplicate, malformed, missing, or extra arguments and zero-work requests are errors. Soak is an explicit bounded local/stress preset, not an unbounded fuzz loop or a routine CI replacement.

## Compare native architecture results

Run the same commit, clean checkout, release profile, locked dependency set, and preset on native Linux x86_64 and aarch64. Then compare the two complete directories:

```sh
python3 tools/determinism/compare.py LEFT_DIR RIGHT_DIR \
  --preset ci \
  --left-target x86_64-unknown-linux-gnu \
  --right-target aarch64-unknown-linux-gnu
```

For soak, use `--preset soak` with the same target arguments. The targets may be given in the opposite left/right order, but they must be distinct and match each directory's provenance.

The comparator independently validates both directories against `inventory-v1.json`; two identically incomplete or invalid manifests do not pass. `manifest.inventory.scenarios` must be a nonempty array of complete ScenarioSpec objects, each validated and exactly equal in order to the selected external inventory. The comparator mirrors the producer's enum, arena, CI-coverage, seed/player-count, and soak-prefix admission rules for every ordered scenario. Engine replay/checkpoint/observation/policy versions are parsed at comparison time from the authoritative Rust constants. It also checks admitted-map SHA-256 digests, counters and totals, checkpoint coverage, artifact integrity, and replay-derived final/state/continuation folds. Manifest results and replay bytes must match exactly.

Compact JSON is checked lexically rather than by serializing with Python: whitespace outside strings and missing/excess trailing newlines fail, while valid Rust number spellings such as `1e-7` remain accepted. Duplicate keys and nonfinite numbers always fail.

Replay tick bounds are derived from the start form: `Active` begins at simulation tick 1 and `Lobby` at tick 0. For initial tick `I`, recorded inputs may target `I + 1` through `I + steps`; zero-based completed step `s` checkpoints at `I + s + 1`. Thus the sweep's active matches checkpoint step `s` at tick `s + 2` and accept their final input at tick `steps + 1`, while stale or unconsumed records remain errors. Active placements must exactly match the scenario's ordered profile/faction/bot roster and deterministic spawn positions. Replay arenas are bound to the complete public practice definition or admitted map source, including map layers.

Zero-length continuation state/event folds must be the known empty fold. When a scenario reports zero events, its scenario and checkpoint event folds are recomputed from the per-tick digests of every covered tick. Other event payloads are not present in replay artifacts and remain the Rust harness's responsibility.

Provenance must have the same full commit, clean state, Cargo version, Rust toolchain (apart from the `rustc -vV` host line), native-Linux status, and release profile. `execution_arch` must exactly match the target architecture. The recorded command may be either `determinism_sweep PRESET --out DIR` or the literal `cargo run --release --locked -p rh-headless --bin determinism_sweep -- PRESET --out DIR`. Shell-escaped argv elements, including output paths with spaces, are parsed with `shlex`. Only elapsed time, the Rust host line, and the argument immediately following `--out` may differ; the command form, binary, preset, and every other argument must match. On a mismatch, the command prints the first JSON path and exits nonzero.

The comparator verifies artifact integrity and internal consistency; it does not rerun the simulation. The Rust executable remains responsible for per-tick ordered-event comparison, replay event comparison, checkpoint restoration, and continuation with recorded inputs.

## Verify foreign replays

Comparison is additional to executing each architecture's recording on the other native architecture. After both native runs succeed, copy or download each synthetic `replay.json` and run both directions at the same commit and content identity:

```sh
# On native aarch64: verify the x86_64 recording.
cargo run --release --locked -p rh-headless -- \
  --verify-replay /path/to/x86_64/replay.json

# On native x86_64: verify the aarch64 recording.
cargo run --release --locked -p rh-headless -- \
  --verify-replay /path/to/aarch64/replay.json
```

Do not use `--ignore-content-hash` for this gate. Both directions must report `"verified":true`; manifest comparison alone is not foreign-replay proof. Native Linux production, native comparison, and both foreign-replay directions remain pending until an actual native CI run passes all of them.

## Comparator tests

```sh
python3 -m unittest -v tools/determinism/test_compare.py
```

The tests generate small synthetic evidence and mutation controls for valid pairs, invalid inventories and non-artifact scenarios, ordering, authoritative versions, roster/arena substitution, empty and event-free folds, canonical JSON, malformed/truncated replays, provenance/command failures, and strict CLI parsing.

## Scope and limitations

- This gate covers only mechanics and arenas implemented by the current Rust engine and explicitly present in the inventory. Practice coverage and the admitted `seed1.map.json` input are not proof of a complete map generator or full-game parity.
- Checkpoint continuation proves the recorded simulation suffix. It does **not** claim restoration of policy, observer, transport, or session memory.
- State hashes and replays are private synthetic diagnostics, not client-safe exports.
- The comparator cannot reconstruct nonempty authoritative event folds from a replay because replays store inputs and state hashes, not events. It exactly recomputes event-free folds and otherwise validates event-fold shape and exact cross-architecture equality.
- Native runner labels or cross-compilation alone are not native execution evidence. Native status, actual execution, both foreign-replay directions, and successful comparison are all required.
- No full-game, release, performance, or real-player privacy claim follows from this implemented-domain determinism check.
