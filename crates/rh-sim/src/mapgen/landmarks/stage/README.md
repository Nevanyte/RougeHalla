# Ordered landmark stage

`StageContext` reuses corresponding fixed, zone, camp, spawn/protection, runtime and common helper definitions.
Construct it and an immutable parsed `recipes::Recipes` once off tick. `apply(&AttemptFrame, &Recipes)` runs all five
actual callbacks in the attempt's shuffled, one-based zone order, recomputing geometry from current collision for each
zone. One `Stage4State` keeps shared scratch, ownership, features and wrote arrays; each runtime starts fresh counters
and reservations. Empty painted zones produce a zero result without invoking a callback.

The input frame is immutable. Its advanced main RNG cannot be consumed by this API. Recipe inputs use the frame's
validated safe-integer seed/attempt and the matching fixed definition. `apply_with` exposes the same orchestration for
custom callbacks and focused transaction tests; default dispatch does not use fixture-driven placements.

After callbacks, the source changed-cell breach gate requires each changed tile to have been unprotected zone floor,
now wall and owned by a landmark of that zone's faction. Unchanged cells are deliberately outside this admission gate;
it is not the independent finished-map certifier. Invalid changed-cell owner/zone references refuse. The stage then
collects landmark bounding boxes in feature order and derives exact box/near1 masks with the existing protection rules.
Invalid metadata returns the established typed error; a breach returns `Ok(None)`.

Tests distinguish orchestration-only captured transaction replay from actual recipe execution. The latter recomputes
M3a and runs all five live callbacks across eight real attempts, comparing every zone's full before/after runtime state,
geometry bits, streams and main continuation against the direct-recipe oracle. A separate observational generator oracle,
`tools/map-fixtures/landmark-stage.ts`, checks original protection and admitted collision/ownership/features, ordered
buildings and both masks byte for byte. It requires complete final GameMap/null and mapHash equality before saving,
pins Linux x64 Node22.23.4 and records all shared TypeScript source hashes. `--check` requires exact recapture.

These checks prove the landmark stage. Spawn integration, later style/repair/tail stages, finished generator,
independent certification and canonical pins remain separate work. No finished Rust mapHash or pin is implied by
the oracle's source noninterference check.
