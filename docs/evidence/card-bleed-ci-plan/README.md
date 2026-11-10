# Card allocation CI coverage review

> **Historical note:** The original inspection and recommendation below describe the workflow and dirty Card WIP at
> its recorded cuts. The post-admission update at the end records the current ignored test names and the CI wiring
> added after source admission; do not read the old “still moving” statements as the current disposition.

## Inspected cuts

- CI workflow: integration `a56429761b002ca44044188d78ad1c4d03d18c3a`, `.github/workflows/rust.yml`.
- Card implementation/test WIP: `backend-card-bleed-feedback` at `03ec330be74d695ee6034def69c1cb5df72e7b34`. That worktree was dirty with the in-progress Card implementation and other Rust WIP; this review binds only the observed test annotations and CI command, not an admitted or frozen candidate. The public-output allocation addition is still moving and needs rechecking at its final seal.

No tests were run and no workflow or WIP source was edited.

## What CI currently executes

The simulation job executes the full non-ignored `rh-sim` unit and integration test suite with:

```sh
cargo test --locked -p rh-sim --features trusted-status-probes
```

The required feature includes `schedule-trace` (`crates/rh-sim/Cargo.toml:22-27`); the job uses the normal test profile with `CARGO_PROFILE_DEV_DEBUG=0` and `CARGO_PROFILE_TEST_DEBUG=0` (`rust.yml:35-49`). The unit tests are not filtered by module or name. Thus the plain `#[test]` `prepared_public_output_beyond_the_legacy_output_constant_uses_the_actual_projector` at the inspected WIP cut (`systems/card_bleed_feedback/tests.rs:1971-2035`) will run in this job. It submits a synthetic sealed report to a real `FxProjector` and checks all entitled outputs, the >legacy event count, and unchanged buffer capacities. It does **not** measure allocator block counts.

The actual dhat allocation witness is separately marked `#[ignore]` as `card_bleed_alloc` (`tests.rs:1275-1282`) because the allocator profiler is process-global. The CI default suite skips ignored tests. The all-target Clippy calls compile ignored tests, but do not execute the profiler. The existing allocator witness already measures real producer steps and `FxProjector::feed` in its setup (`tests.rs:1341-1345,1391-1405,1439-1455,1553-1564`); it does not exercise the synthetic >legacy-output row volume during a dhat measurement.

## Minimal execution gap and command

If the pending public-output regression is an ignored dhat test, the normal simulation job will not execute it. Add one focused command to that job after the default simulation suite, once the candidate is sealed and the test name is frozen:

```sh
cargo test --locked -p rh-sim --features trusted-status-probes --lib card_bleed -- --ignored --test-threads=1
```

Keep the new ignored test name under the `card_bleed` prefix. This runs the existing `card_bleed_alloc` plus any narrowly named Card dhat witness serially, using the same stable CI profile and feature set. If the author instead folds the >legacy-output allocator measurement into the existing ignored `card_bleed_alloc` function, the same command suffices. Do not pass `--include-ignored` to the broad suite: that would also start unrelated process-global allocator witnesses (for example terrain, abilities, Frost, Wish and NPC tests) in a parallel general run.

The current public-output capacity test is already covered by the default simulation command; adding a second ordinary test command for it would duplicate execution. What is not covered is an allocator-count assertion specifically around projecting more Card outputs than `FX_OUTPUT_EVENTS_MAX`. Bind the exact final test name and assert the actual prepared public output flush allocates zero blocks after setup, rather than treating a capacity equality assertion as allocator evidence. The test's own documentation should retain that its report rows are synthetic component input, not a gameplay-reach witness.

**Disposition:** existing CI runs the unignored public-output projector/capacity test but skips the existing ignored Card allocator witness. Once the in-progress public-output allocator test is sealed, the single focused command above is the minimum additional CI execution needed for that ignored regression. This review makes no admission claim for the moving WIP test and recommends no workspace-wide test expansion.

## Post-admission CI update (2026-11-10)

The historical review above remains intact. At integration HEAD `1ef46de8`, the final Card test module contains both
ignored functions: `card_bleed_alloc` and `card_bleed_alloc_public_output` in
`crates/rh-sim/src/systems/card_bleed_feedback/tests.rs:1317-1318,2116-2117`. The regular simulation suite still
skips both. The workflow now runs exactly one extra serial command after that suite:

```sh
cargo test --locked -p rh-sim --features trusted-status-probes --lib card_bleed_alloc -- --ignored --test-threads=1
```

Cargo's substring filter selects those two final names. The first is the existing real Card producer allocation
witness; the second isolates the measured public-output projector allocation witness. They share a process-global
dhat allocator, so this is deliberately one filtered invocation with one test thread. It does not enable unrelated
ignored allocators, and the already-unignored `prepared_public_output_beyond_the_legacy_output_constant_uses_the_actual_projector`
continues to run in the default simulation suite.

The Rust source-witness job now also runs one grouped freshness step for the five newly admitted source profiles. It
uses the existing capture wrappers' own pinned Docker runtime, Node `22.23.4-bookworm-slim` digest
`aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292`; each command passes `--check`, mounts its
canonical source output read-only, and does not write or refresh a fixture:

```sh
bash tools/card-bleed-fixtures/capture.sh --check
bash tools/bot-private-brain-fixtures/capture.sh --check
bash tools/bot-private-modules-fixtures/capture.sh --check
bash tools/bot-private-tactics-fixtures/capture.sh --check
bash tools/quest-room-feedback-fixtures/capture.sh --check
```

The checked source corpus and wrapper identities at this update are:

| Profile | Corpus SHA-256 | `capture.sh` SHA-256 |
| --- | --- | --- |
| Card bleed | `6b36256739bd473bc70ebd160a8632a26470ab8e4190f873026bd714e53d36ed` | `95fad9b8f8421a2bdd9d582b650056044468aecf7be229a07710441b81ae0726` |
| Private Brain source | `ed054bfd2663f4aa64d08f517295d07459c4543b92cae99c0356fb0d14ae3943` | `c8d66f27802422a7c44d756a28eefe8301d046c735a24ec9bc73fe57ecea088e` |
| Private Modules | `645e85f16adbea001f8d0e06a70b6e5d311864ed9691622c06b789c95578b012` | `3b7eb1355e036f9aa4695fd5c8275a6fe00bf9f726e236f86a52839d759d9d4e` |
| Private Tactics | `5d27d1b4522d386d4ede5f3064a28660dedff43e32a24ade264f4512e30fcfa8` | `076ba45f97b0d3ad5c898b93d613ab9c4fb55afed7785a28018a4f199977b0f6` |
| Quest Room feedback | `977450a6e0e1a1fcc3bd135edf7ebe6291f10d4da7aef98a44fc76b5886bd978` | `07b76ba4dc29d34bc754cf5b6b32439a053a546fac92a7b2f0d8b760af33b50e` |

The Quest Room witness embeds the unchanged `parity/quest-giver/source.json` input identity
`039d4e058fa914f42080f1c55d8640cc508c5b4745504930ca3db49579adc8b4`; its own `--check` compares the derived
Room witness to that pinned input. No separate quest-giver recapture command is duplicated here. The admitted Brain,
Modules and Tactics corpora continue to have native comparison tests in the Rust suites; the new step verifies that
their legacy TypeScript producers and capture tools still reproduce the pinned source bytes. In particular, private
Brain source freshness does **not** claim that full native Brain composition is complete or admitted.

This update only binds the minimal missing CI execution. No capture, native test, Rust suite, or workflow run was
performed while writing it; source files and their identities above were read and hashed only.
