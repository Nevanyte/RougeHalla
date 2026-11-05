# Independent hard map certificate

`certify(&GameMapData, &Options) -> Result<Certificate, Refusal>` reads only the finished map. It does not call the generator, its validators, placement bookkeeping, repair, records, terrain gate or generation contexts. It independently recomputes connected components, arena sealing, zone geometry, camps, territory measurements, views, feature ownership/grammar, protected terrain and fence routes. Existing `TileMap`, `Pathfinder` and `raycast` are reused solely as the source-defined movement/sight semantics. The exact ECMAScript number-string leaf is reused for diagnostic formatting.

`Options` preserves source `styled`, `zone`, and `strict`: Auto follows the captured enabled SHAPE_GATES only in zone mode, None disables strict checks, All selects all factions, and Zones preserves the supplied order and duplicates. Zone implies styled. Strict scope applies only to the source strict checks. Always-on feature tables/ownership records/landmarks still run when strict is disabled.

`Certificate.failures` is ordered and retains each source check's multiplicity, subject, optional camp/tile index and complete source-compatible message. Messages are compared byte-for-byte, including numeric diagnostics; no normalization, count-only comparison, unordered matching or unknown-diagnostic fallback is used. Fence output preserves the source's first four findings per selected zone, including iteration order and the bounded 40-extra-step search's diagnostic distinction. This cap is source behavior, not a relaxed acceptance rule.

## Hard inventory

The source inventory is 64 diagnostic labels: 46 main checks, 16 feature/piece checks, and two fence checks. The layer-shape label is implemented as typed admission refusal before indexing. Every other label must occur in the controlled source corpus. Tests additionally require T2–T11 diagnostic coverage; T1 is the typed layer refusal.

- Grid shape/classes/border/region assignment; open and closed connectivity.
- Gate count/order/width/coordinates/exclusivity/lanes; centred symmetric coliseum wall ring, floor centre, sealed inner-spawn clearance and pillars.
- Painted zone connectivity, area spread, floor ratio, ring contact/connectivity and slivers.
- Camp/elite counts and order, spacing, centre/chest/clearing/halo/spots, elite spot/pair selection, territory partition/connectivity/radius and exact area/radius records.
- Spawn count/diversity, placement, pair/camp spacing, wall-separated close pairs, actual findPath route ratio and sampled hazard budget.
- Region order and all derived views, outdoor poles, crate/ground constraints, building margins and reachability.
- Feature tables, variants/jobs/anchors/boxes/counts/zones/order, landmark design/margin/halo clearance/doors/interior and building association; strict ownership, hazard ownership, physical class, overlap, sizes, jobs, whole gallows/piers, every kind's parameter grammar, small wall pieces and fence detour/run rules.
- Independent terrain T1–T11, unstyled emptiness, additional protected-place checks, ICE neighbors and zone-specific terrain/floor checks.

Report-only ray profiles, engagement pairs, camp graphs, windows, footprints and sweep percentiles are intentionally not exposed by this hard-only API and never become failures. This is not a report-statistics port.

## Evidence

The five byte-grid layers use canonical `{rle: [[byte, count], ...]}` storage, with no record deduplication or diagnostic normalization. The bounded loader rejects recursive duplicate object keys, unknown fields, non-byte values, empty/zero/oversized runs, adjacent equal runs and incorrect expanded lengths. Optional source metadata rejects explicit null rather than silently treating it as absence. Storage fell from 97,980,343 to 25,724,216 bytes (73.7%). Expanding all 307 case records reproduces their precompression JSON bytes exactly (SHA-256 `cdcc0d48a716793bc02718b5450a00077191569ac7039e9635b8aaadc259e43f`). The complete expanded fixture also matches byte-for-byte except for the explicitly updated capture-tool SHA-256 reflecting the codec change. All 40 source hashes, 64 rule labels and 488 diagnostic strings are unchanged.

`tools/map-fixtures/certify.ts` calls actual `certifiedMap` and actual `certifyMap` on pinned Linux x64 Node 22.23.4. It checks no input mutation, captures source dependency SHA-256 provenance and its own SHA-256, labels every controlled mutation, and requires an exact nonempty case inventory. `--check` regenerates and compares the entire output byte-for-byte. `CERTIFY_COUNT` supports bounded exploratory captures (1–200), but the checked-in Rust gate refuses anything other than the complete 200-seed inventory.

The final inventory has 307 cases: 200 genuine strict seeds 0..199, eight genuine map option controls, and 99 controlled map/option faults. It includes all 13 feature parameter kinds, independent terrain controls, selected/unselected/automatic strict scope, duplicate/reordered strict selections, duplicate camp IDs with distinct errors and multiple same-rule numeric errors. Native tests reject removed/reordered/repeated cases, missing rule inventories, null diagnostics, omitted/reordered/duplicated/distinct-same-rule diagnostic records, repeated genuine seeds and unknown map fields.

No seed pin, generation cutover or re-pin claim follows from these imported-map certificates. Full generated native maps must separately pass this API and the generation/pin requirements.

## Refusal domain and source limits

Certification requires 160×160 and five complete layers before indexing. Collections, total camp metadata (512), total feature parameters (25,600), and strict selections (256) are bounded. Camp and derived mob-camp clearing radii must be finite, nonnegative and at most eight tiles before expansion; the valid source contract requires 2.5 tiles. Non-finite or off-map gameplay points, unsafe rectangles/gate coordinates and oversized records return typed `Dimensions`, `Layers`, `Budget`, `Coordinates` or `Rectangle` refusals. These malformed domains are deliberately refused instead of reproducing source exceptions. Props remain independently checked by T9. Unknown JSON fields/enum values remain rejected by the unchanged DTO.

The source certifier crashes on a missing gate tile array entry and some edge-loot/unknown-terrain mutations. Native robustness tests cover those safely; exact diagnostic parity is claimed only where the actual source completes. `map.ts` also describes distinct/spread inner spawns, but `certifyMap` does not enforce distinctness or a spread threshold. This implementation preserves the actual hard checks; adding that contract-strengthening rule is a separate decision.

`rules::visit_content(callback)` is allocation-free and visits the same independent numeric definition and terrain/prop/faction/weapon/design/feature-job tables read by the hard checks. The coordinator folds these exact words through `visit_definition(&R, callback)` into aggregate content identity; all 69 numeric thresholds have aggregate mutation coverage. No new dependencies, I/O, entropy, clock access or global mutable state are introduced.

Ten permanent review fault controls additionally cover partial-strict corrupt cross-zone ownership (diagnostic scans use the same selected tile regions as the hard checks), ECMAScript toFixed ties via the existing pinned ryu-js formatter, duplicate strict findings, empty pools, sixth-region area diagnostics, and widening from the fourth gate tile even when additional tile records exist. Independent review also checked fresh real seeds 200/201, 11,156 numeric-format vectors, the original 107 fault/mode controls, and 15 targeted semantic mutants. The canonical packed capture passed full exact-byte regeneration with `--check`.
