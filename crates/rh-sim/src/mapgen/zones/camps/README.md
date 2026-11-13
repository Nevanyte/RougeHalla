# P-MAP-1 M2b: camp sites and initial territories

This child module ports the actual `placeCamps` / `territoryReach2` path in `packages/shared/src/zones.ts`, including
coverage seeding, halo-source path-cost Voronoi, territory hulls, sequential Lloyd/pole moves and two-slot elite selection.
It stops before post-styler repair and full-map records. Camp `spots` are deliberately empty until the real stage-8 port;
zone labels, camp array order and 1-based territory IDs remain the attempt's internal order. No faction canonicalization
or finished-map generation is claimed.

APIs:

- `CampContext::new(&ZoneContext)` / `from_definition(&ZoneContext, &CampDefinition)` build immutable halo geometry.
- `place_camps(&context, &mut rng_callback, &ZonePartition)` returns `Option<CampLayout>` with all internal CampSite fields
  and the complete territory grid. It continues the caller's stream through retries without reseeding.
- `territory_reach2(&ZoneContext, &camps, &territory_grid, optional_tiles)` returns squared-tile reach by 1-based ID.
  Missing typed-array entries follow the real legacy helper's false/zero behavior; LOW and WALL both block when masked.

The sole `CampDefinition` has 13 content words emitted allocation-free by `visit_content`. Camp clearing radius remains
owned by the existing parent `ZoneDefinition`; its already-built clearing offsets are reused, not assigned another rule
value. Halo geometry also reads the supplied fixed ring geometry, avoiding a duplicate coliseum ring-road rule. Custom
contexts rebuild their halo tables before generation. Definitions are trusted bounded rule data, not an external input
format: valid dimensions, finite nonnegative distances, nonaliasing clearing offsets, encodable camp counts and at most
two elite slots are checked. Geometry tests compare literal source halo/border loops at shared radii 0, 2.5 and 4.5.
Linear-offset reads/writes use checked access where TypeScript typed arrays can be read outside their backing storage.

The Voronoi queue uses `BinaryHeap<Reverse<i32>>` over the source's same packed cost/tile key. Equal keys identify the
same tile, so they have no distinct label payload whose order could change an outcome. Strict cost relaxation and the
original N/E/S/W order are retained. The final accepted pole moves do not trigger another territory partition.

`tools/map-fixtures/zones-camps.ts` imports the real functions and records the actual pillar draw, real faction shuffle,
real zone partition, then real camp placement on one Mulberry stream. Linux x64 Node 22.23.4 generation and `--check`
compare the complete fixture. The bounded scan covers 128 real streams: 116 successes, 12 terminal camp failures and
zero successes rescued by the second camp try. Here failure means this two-try `placeCamps` call; the full generator’s
outer layout-retry loop is not ported. Failures do execute both retries; no invented successful-retry seed is
claimed. Selected full captures include multiple real failures and signed/large seed or attempt metadata. Tests compare
all partition input cells, every CampSite field, all territory cells, all consumed RNG words and eight continuation words.
Reach is compared with no collision mask, a WALL/LOW mask and direct empty typed-array helper inputs.

`place_camps_reserving(&context, &mut rng_callback, &ZonePartition, &[Reserve])` (P-MAPGEN-SIG-RESERVE-1, the
generator's signature option only; ADR 0028) is `place_camps` round reserved landmark sites: every candidate and every
Lloyd pole whose halo meets a site is refused (`PoleSearch::halo_ok`, which `place_camps` sets to `CampContext::halo_ok`,
so its draws are unchanged); a site's own camp (the church's and the cave's) is placed first in its zone as label 1,
counts in the spacing of every later camp, seeds its territory label in every Lloyd step, never moves and is the zone's
first elite, the second elite following the legacy rule against it. With the option off the Prefix calls `place_camps`
and nothing here runs.

No I/O, clock, entropy, global mutable scratch, new dependency, legacy pin change or modification to parent foundations
is introduced. Post-styler territory repair, spots, faction renumbering, stylers, full generator/certifier and map-pin
parity remain later work. The coordinator owns the parent module hook and content-identity fold.
