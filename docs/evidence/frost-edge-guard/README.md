# Frost edge eligibility: skip irrelevant structural lookups

The first M5 CPU diagnostic found `structural_source` among active leaf samples. `after_damage` evaluated it for every standing actor/victim pair even when the actor was not engaged with that victim. The predicate only reads faction, NPC return mode/type/zombie status and the static catalog. It has no state, RNG or hooks.

The forward-edge condition now tests engagement, target equality and non-self identity before the structural predicate. For every qualifying edge the same predicate runs and the same source is added at the same position in the existing actor traversal. Reverse edges, ordered deduplication, chill/resistance, exposure/ranged expiry and weapon timer updates are unchanged. No cache, allocation, actor state, content constant or wire format was added.

Root and two focused source reviews agree on purity and unchanged insertion order. Existing captured Frost tests cover ordinary/NPC sources, return/lifecycle, exact ordered chillers/timers, clone/restore/continue, resistance and departure boundaries. No new test duplicates the moved conjunction.

Validation at this exact code change:

- `cargo fmt --check -p rh-sim`: exit0.
- `cargo test --locked --offline -p rh-sim frost`: exit0; 30 unit tests and2 restore/scratch integration tests pass. Two preexisting allocation-profiler unit cases remain ignored.
- `cargo test --locked --offline -p rh-sim --test content`: all21 pass, including the unchanged content hash golden.
- `cargo clippy --locked --offline -p rh-sim --all-features --all-targets -- -D warnings`: exit0 in25.56s; exact retained log/result alongside this file.

The first [paired measurement](../m5-backend-first-pair/README.md) predates this change. No speedup is claimed until a newly identified release binary is measured. Current public/local demo artifacts are not replaced by this source-only optimization.
