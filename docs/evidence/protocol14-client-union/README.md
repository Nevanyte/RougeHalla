# Private protocol14 / Unity composition

Base3a1c8fc4 combines the sealed native Full/giver/quest transport with the independently tested Unity UI and compact
HUD. It is not public-release or browser acceptance. The first full .NET run passed641 and failed8: every failure was
Truncated while loading the retained collision-only pathfinding_v1 map through the new strict network-map decoder.
No movement/path mismatch was reached.

`MapBlob.ReadCollisionFixture` explicitly loads that historical standalone collision format using the same bounded
collision/run/hash validation. Its complete input is checked before tile allocation. Active Welcome parsing continues
to use the strict protocol14 `Read`, with its mandatory ground section; there is no truncation fallback or format
guessing. Tests prove a collision-only Welcome is still rejected, the explicit fixture decoder rejects trailing current
metadata and a bad collision hash, and the original path/prediction tests exercise their unchanged Rust vectors.
No historical fixture bytes, tile data or expected waypoint/tick values are rewritten. Rust's independent fixture test
is relabeled as the retained collision-prefix proof, rather than claiming it is the complete current map encoding.

The repaired composition passes651/651 .NET tests. A subsequent protocol14 offline-review fixture update explicitly
includes State10 unavailable quests; all three HUD/planning/map frame tests pass with full collection completeness.
It remains synthetic offline data. The quest wire documentation also now enumerates key10.

Giver wire/render and owner-combat Snapshot groups are separate in-progress leaves. Current fixture/provenance hashes,
final content/tapes, actual Editor import/build/browser and hosting acceptance remain coordinator gates.
