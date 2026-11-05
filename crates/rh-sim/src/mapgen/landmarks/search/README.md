# Exact landmark search leaf

`LandmarkSearch` exclusively borrows one runtime and owns its fixed planning policy and private
fit-table cache. `new` uses the original hard/open policy; `with_planning` takes an immutable hard
overlay and an `FnMut` open callback which observes the runtime. Scores and optional bounds also
observe the runtime immutably and may retain their own counters or memo tables. No callback can
spend guard budget through the provided runtime reference. All attempted writes use
`templates::place_landmark` and the original runtime guard.

`best` takes signed integral tries (nonpositive keeps no candidates but still scores every fit).
`best_default` reads `SearchDefinition.default_tries`. The same definition supplies origin stride;
`visit_content` visits both actual driving words without allocating. Default values are 12 and 2.
Gap uses the existing registered `LANDMARK_GAP`. Eight orientations, SAT borders, sentinels and
heap representation are structural details. Caller recipe weights, margins and explicit try counts
are captured inputs, not additional search rules.

Tables use bbox-relative row-major floor eligibility, ask planning open only for eligible floor,
and enumerate all eight orientations at each bbox-relative stride origin. Bounds use an exact
max heap with enumeration-index ties; scores use descending numeric order then global origin and
orientation. Signed zeros tie, NaN bound becomes positive infinity, and NaN score becomes negative
infinity. Pruning is strictly less-than. The complete shortlist is scored before attempts; failed
whole transactions retain guard/scratch/refusal effects and consume their candidate try.

Before each cached call, zone feature count and the tile sum of the entire bbox are checked.
Search success zeros only occupied stamp cells and rebuilds SAT rows from its first row down.
External `place_whole`/`place_stamp` writes receive no search patch and trigger normal validation.
`reserve` resets immediately. `reset` is also required after externally mutable planning policy
changes. Equal-sum tile edits and reservation/hard/open changes are deliberately not detected by
the source checksum. There is no mutable runtime getter, replaceable context, foreign cache API,
pointer identity or global counter. Compile-fail examples exercise those ownership boundaries.

## Oracle and limits

`tools/map-fixtures/landmark-search.ts` copies eleven actual source modules, checks each tap is
unique, hashes every copy and rewrites imports only. Real calls capture ordered open, bound and
score calls; exact stamps/boxes; IEEE-754 results; candidates; shortlist; attempts; cache decisions;
and complete runtime snapshots. It never probes open to construct a view, reevaluates a score or
copies a faction score recipe. Stateful runtime observations reject speculative guard calls outside
transactions. Each real case requires complete final output (including null) and map hash equality
with the unmodified actual generator before its trace is saved.

Actual cases are seeds 1, -1 and 4294967297 with attempts 0, 0 and 4294967296, plus seeds 176 and 54
at attempt 0. A bounded deterministic scan found genuine Rime whole-zone fallback at seed 176;
seed 54 exercises an additional Scorch planning view/margin search. Gallows first success, sparse
table patch, second-call reuse and bound pruning are recorded. Surrounding Sanctum/Warren/Rime
explicit placements are replayed through the existing runtime/helpers, preserving prior budgets.
Sanctum and Warren do not call search. Their recipes and Rime's local scanner remain unported.

Thirty separately labelled direct-source helper streams cover odd bbox origins; full/sparse boxes;
mask/hard/owner rejection; strict gap edges; all orientations and score ties; default and explicit
tries -1/0/1/6/12/48; n equal/below keep; empty sets; NaN/infinities/signed zeros; equal bounds and
strict pruning; failed transactions followed by success/exhaustion; sparse success patch; cache
reuse, feature-count/sum rebuild, outside-bbox edits, same-sum invisibility, explicit reset,
reservation, memoized planning open and source foreign-context fallback. Private tests transfer
tables across successive read views only for tile/hard edit fixtures whose preceding calls have
zero tries. Production sessions cannot transfer a cache or change their runtime. The source-only
foreign-context overload has no Rust product equivalent; the ownership boundary is intentional.

The Rust replay consumes captured callback arguments/results exactly once, compares every complete
callback state (using a typed clone after one source/JSON match), and compares candidates, table
arrays/SAT, shortlist, attempt order/results/states and final state. A public-API test separately
checks mutable memo lifetime, reset, definition-driven defaults and stride.

Canonical capture/check requires Linux x64 Node 22.23.4 and asserts that running process identity.
Use `node --import tsx tools/map-fixtures/landmark-search.ts [--check]`; `RH_FIXTURE_OUT` selects a
writable output location when the repository is mounted read-only. `RH_SEARCH_SCAN=1` performs the
bounded seed audit; `RH_SEARCH_SCAN_START`/`RH_SEARCH_SCAN_END` select its range (default 2..513).
`RH_SEARCH_SEEDS` is available for independent bounded investigations, not the checked-in default.

This leaf makes no finished-generator, canonical-pin, faction recipe, Unity or cloud parity claim.
