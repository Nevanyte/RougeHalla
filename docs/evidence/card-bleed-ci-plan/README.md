# Card allocation CI coverage review

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
