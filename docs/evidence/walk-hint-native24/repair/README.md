# native24 TEST-CONSUMER repair receipt (Root-authorized 3-point bundle)

This additive receipt corrects only the test consumer of the reviewed 24-case boundary corpus on the same
`deepseek/walkhint-native24` branch. The prior head `2fbc86dfc42e4cd50270630ea660a5b0649dd7e3` and all of its evidence/logs
remain immutable and preserved as the superseded finite proof (`docs/evidence/walk-hint-native24/`). No production/game-rule/
API/schema/content/hash/lock/shared-status/main/source/corpus change was made; existing 69 helper recipes/assertions and the
prior file prefix are unchanged.

## Corrections

1. **hide-to-acquire first chooser call:** the shared pre-branch now performs the actual `targeting::update` before reading
   `selectedBefore` (source order `walkHintOf -> updateTargets -> selectedBefore -> removeStatuses -> walkHintOf ->
   updateTargets -> selectedAfter`). First and second actual update events are asserted empty; no synthetic target/helper
   boolean is installed. The real `operations::remove_into(Selector::Kind(Hidden))` row projection, the second readonly hint,
   the second actual update, `selectedAfter`, and exact ordered-candidate comparisons are retained.
2. **orderedCandidates future untargetability clock:** all amove candidateFacts now query `rt::untargetable` at
   `world.serverTime + TICK_MS` (`2050` for the declared 2000 setup), matching the pinned source; current `lockable_now`,
   positions and physical LoS semantics are unchanged and no expected output/case was added.
3. **LOS priming history:** the exact pinned source recipe now runs first: p0 at `target.x - 24, y200` (target at its declared
   position) and **two ordinary steps with no Move**, then the captured final context is put back. Actual native gameplay
   visibility and `lockable_now` are required true and physical `has_line_of_sight` false through the actual queries; no
   trail/reveal/visibility/target installation or geometry tuning is used.

## Actual corrected results (raw logs pinned beside this receipt)

- Focused `cargo test -p rh-sim --lib boundary24`: **1 passed, 0 failed, exit 0**.
- Existing WalkHint regression filter (existing14/69 scopes + native24): **16 passed, 0 failed, 2 existing ignored, exit 0**.
- `cargo fmt -p rh-sim -- --check`: **exit 0**; scoped `cargo clippy -p rh-sim --all-targets -- -D warnings`: **exit 0**.
- All 24 cases still consume the immutable corpus (150406 B, SHA-256
  `1702ce0a44940709d229161211cbd6ceaf8b0f4ef55c147d3321b3e3ab78e774`, FNV `0x577641fc5c7698cc`); no semantic/native
  prerequisite mismatch occurred under the corrected exact recipe, so no first-failure scope request is outstanding.

## Retained limits

These remain declared source-method parity contexts, not earned World/full Frame/physics/restore/live/public/full-brain or
complete boundary admission; the Cartesian direct-transition observation stays separate from collapsed path/hint
observations; the `full_method_gates` readonly installer is pre-existing/Root-approved and was never stepped or restored;
the native 86400 s setup deadline narrowing versus the source 1e6 s is non-reached and explicit. Root owns composition/
admission/merge/hash/content. The leased cache was used exclusively at jobs1/debug0/incremental0 `--locked` and released
without deletion; `final-target` was untouched; no new cache, source execution/recapture/mutants/subagents or unrelated
cleanup occurred.
