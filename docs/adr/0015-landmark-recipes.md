# ADR 0015: actual landmark recipes and ordered stage admission

Status: Accepted. Implementation evidence is in [stage2-landmark-recipes](../evidence/stage2-landmark-recipes/README.md).

The accepted runtime/templates/search/support leaves expose the source's whole-wall transaction and planning boundary.
Stage four now runs the actual Scorch, Gallows, Warren, Rime and Sanctum callbacks. Immutable recipes parse live borrowed
template/rule definitions once off tick; callback-local caches never escape into another zone. Default registry selection
uses the runtime's faction. Content visitation uses fixed source registry order, while execution follows each attempt's
shuffled one-based zone order. Every tuning field, array and template key/row/job participates in content identity.

`StageContext` reuses existing fixed/camp/spawn protection definitions. It recomputes geometry from the current collision
for each zone, carries one shared state/scratch/features/ownership/wrote set across zones, and resets only the per-zone
runtime counters/reservations. It borrows the attempt frame immutably; neither this API nor any recipe draws the main
stream. All five callbacks also consume zero independent landmark-stream words. Stateless noise remains independent.

Scorch's copied planning overlays and persistent lazy memo do not replace the transaction's original hard mask.
Gallows retains one search session across both calls, including a second call after first-call failure. Rime retains
its actual shifted clearance/local packed scanner and distinguishes the sixth failed placement from key exhaustion;
only exhaustion reaches the fresh whole-zone fallback. Sanctum retains its static bad SAT and direction-seven behavior
after a failed first shrine. Warren retains Gabriel-road and candidate ordering. No stage-six terrain/style work is
substituted for these callbacks: shrine lights are owned floor, and Rime grows no lake here.

After callbacks, the original changed-cell gate admits only unprotected zone floor changed to wall and owned by a
landmark of the same zone faction. Unchanged cells are outside that gate, as in the source. Buildings preserve feature
order; box/near1 masks reuse the existing protection implementation. This gate is distinct from independent finished-map
certification. The stage API is available to later generator orchestration; the live server still uses imported maps.

Actual-source oracles retain complete final-map/null and mapHash observer equality, exact intermediate state and
callback decisions. Parent tests execute all five Rust callbacks on continuously shared state rather than replaying
captured placement answers. Exact inventories and adversarial fixture changes prevent missing observations from passing.
Independent review found two test evidence gaps (unknown operation admission and unchecked fallback open records);
both were repaired without changing production, source tools or fixtures and independently rechecked.

One diagnostic composition difference is explicit: the accepted Rust fresh search wrapper patches its private SAT
after success before dropping the session, whereas the source free wrapper has no retained cache and skips that patch.
Tests compare all source events exactly and separately verify the extra discarded Rust patch cell by cell. It changes
no runtime state, placement, output or future search. No production search change accompanies this decision.

Checkpoint /14, replay /12, observation 11, policy 8 and wire 5 remain unchanged; content identity changes to include
actual recipes. This establishes the landmark stage, not full Rust generation, canonical pins, full-game performance,
Unity completion or a staging/production release. Later stages, independent certification and source-compatible map
hashing remain required before generator cutover.
