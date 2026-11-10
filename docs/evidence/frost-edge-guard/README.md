# Frost edge eligibility: skip irrelevant structural lookups

The first M5 CPU diagnostic found `structural_source` among active leaf samples. `after_damage` evaluated it for every standing actor/victim pair even when the actor was not engaged with that victim. The predicate only reads faction, NPC return mode/type/zombie status and the static catalog. It has no state, RNG or hooks.

The forward-edge condition now tests engagement, target equality and non-self identity before the structural predicate. For every qualifying edge the same predicate runs and the same source is added at the same position in the existing actor traversal. Reverse edges, ordered deduplication, chill/resistance, exposure/ranged expiry and weapon timer updates are unchanged. No cache, allocation, actor state, content constant or wire format was added.

Root and two focused source reviews agree on purity and unchanged insertion order. Existing captured Frost tests cover ordinary/NPC sources, return/lifecycle, exact ordered chillers/timers, clone/restore/continue, resistance and departure boundaries. No new test duplicates the moved conjunction.

Validation at this exact code change:

- `cargo fmt --check -p rh-sim`: exit0.
- `cargo test --locked --offline -p rh-sim frost`: exit0; 30 unit tests and2 restore/scratch integration tests pass. Two preexisting allocation-profiler unit cases remain ignored.
- `cargo test --locked --offline -p rh-sim --test content`: all21 pass, including the unchanged content hash golden.
- `cargo clippy --locked --offline -p rh-sim --all-features --all-targets -- -D warnings`: exit0 in25.56s; exact retained log/result alongside this file.

The first [paired measurement](../m5-backend-first-pair/README.md) predates this change. The first pair remains unchanged. The post-change measurement below demonstrates no CPU improvement. Current public/local demo artifacts are not replaced by this source-only optimization.

## One post-change release measurement

The exact clean `9657cd565396a7a5a7190fe66fec3efe885f47f3` Mac release with PostgreSQL support built successfully. Compiler/Cargo identity, release debug level and features match the original demo; build parallelism differs (4 vs1 jobs). The only production Rust source difference from the original demo is this guard reorder; a separate lease-test timestamp repair is test-only. The first candidate build omitted PostgreSQL, was caught before execution and remains explicitly UNRUN; it was not used for measurement.

The corrected binary SHA is `4d44bf51354d4f1b5fcd392c2bf904e65f83873acfbc1caff22991705101cae0`. An otherwise unchanged controller, using exact frozen helper/codec bytes from the isolated optimization_port checkout, completed one30-second unprofiled run:

| Metric | Original frozen demo | After guard change |
|---|---:|---:|
| Observed steps | 600 | 600 |
| Measured wall interval | 30.001s | 30.002s |
| CPU, percent of one core over inner sample span | 6.69% | 6.76% |
| Sampled RSS | 18.38–18.48MiB | 18.78–18.88MiB |

The CPU point estimate is1.03% higher, not an improvement and not an established regression. Room lifetimes and ambient event totals differ; no quantile change is attributed to this code. No favorable retake followed. All90 measured commands and prior acknowledgements/positions pass, all3 seats remain alive, and normal Leave persists3 results with0failed/refused. Root independently confirms PID30250 gone and17937 listener absent. The report retains the fixed input recipe, raw process samples and complete limits. No public or existing local demo artifact was replaced.

Normal [CI42748359516](https://github.com/Nevanyte/RougeHalla/actions/runs/42748359516) at exact9657cd565396a7a5a7190fe66fec3efe885f47f3 completed SUCCESS at03:48:27UTC. All five jobs independently report success, including complete simulation, PostgreSQL lease/recovery, parity, source witnesses, full-map headless and actual Chromium/WSS checks. Terminal API-derived receipt is retained alongside this file. Later documentation commits do not change runtime source.
