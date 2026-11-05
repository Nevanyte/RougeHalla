# Safety nets and post-territory repair

Pure bounded APIs reproduce `mapgen.ts` stages 7 and 9 over caller-owned mutable state.
`safety_nets` returns the genuine pre-nets tile snapshot; `post_repair` consumes it after
camp spots and crates. The module neither implements stylers nor completes the generator.
Normal source refusal preserves all writes already performed. Malformed inputs return a
typed error before mutation. Neither API accepts or consumes an RNG.

Shared connectivity, fixed geometry, zone balancing, ring/sliver metrics and territory
reach use the established helpers. Camp radius, area/ring/sliver and protection rules
are borrowed from their existing definitions. The terrain on-class table is borrowed;
`default_definition` does not own another terrain-kind registry. Repair-owned limits and
floor share use the same `Definition` and allocation-free `visit_content`.

`post_repair_with_trace` optionally records ordered territory changes and source notes.
Ordinary calls allocate no trace snapshots. Captures expose the actual source helper in a
temporary copy using unique read-only taps, and compare every real run's complete map/null
and hash with the untouched caller. The fixture records 40 real runs, including styled
seeds 0..31, plain, decor, negative/wide metadata and retry inputs. No null arose in this
bounded corpus; labelled synthetic pre-stage mutations exercise normal refusal paths,
partial writes, rezone protection, equal-touch ties, infill, buried terrain and net restoration.
Synthetic inputs are never described as failed generator seeds. The 22 synthetic cases include
110 ordered operation/note snapshots, both wall-up paths, fits/touch selection, independent
crate/landmark protection, a zone transfer and observable boundary-wall balancing.

Canonical capture requires Linux x64 Node 22.23.4 and refuses other processes:

```
node --import tsx tools/map-fixtures/repair.ts --check
cargo test -p rh-sim mapgen::repair --lib --locked
```

The fixture compares exact arrays, owner IDs, feature order/anchors/bboxes, refusal reasons,
operation cell order, rezone/notes and reach vectors. Source entry/exit draw counts and
cloned continuation words prove the main stream remains unchanged through these phases.
This leaf does not claim full-pipeline, certifier or pin parity.
