# Elite bush leaf

Exact `packages/shared/src/bushes.ts` placement over real stage-11b inputs. This leaf does not create preceding stages,
finalize records, validate a full generated map or claim plain-map pin parity. Plain reference maps retain real landmarks.

`place_elite_bushes(definition, input, features, feature_owner)` appends draft features and changes ownership only.
`BushInput` borrows immutable layers, optional crate/ground-spot avoidance, original protection/pool5 masks, faction order
and internal `CampSite` order. There is no attempt RNG parameter. TS `FeatureDraft = MapFeature` is reused as the public
`FeatureDraft` alias: bush counts/boxes stay provisional zero and `p[0]` is the internal camp index until records finalizes
and renumbers them. These drafts are not admitted `MapLayers`.

The source `placeCamps` loops zone labels 1 through ZONES and stores those labels directly. The oracle checks every real
stage-11b camp centre against its zone and territory `ci+1`, then captures the exact stream seed computed using
`camp.zone-1` and stream `4+ci*8`. No faction-code/canonical camp-index substitution occurs. Safe signed seed and safe
nonnegative attempt metadata are coerced modulo 2^32 only for `hash_seed`, exactly as JS bit operations.

The eleven `BushDefinition` fields drive runtime and allocation-free `visit_content`, in declaration order:
stream, camp_stream_stride, patches_min, patches_max, tiles_min, tiles_max, near_min_d2, near_max_d2,
centre_sep_d2, scan_radius, tries_per_patch. The coordinator adds the parent module hook and content fold.

The oracle copies the actual mapgen and bush modules into a temporary directory, resolves their imports to real source,
and inserts observation-only taps. It requires full final-map/null equality and actual legacy hash equality against the
unmodified invocation before saving inputs/outputs. Six complete real snapshots cover plain/styled seeds 0 and 1,
negative seed -1, and seed 4294967297 with attempt 4294967296. Each retains real landmarks and repaired territories,
actual avoidance and original masks. Per-camp stream seeds, all draw words and eight continuation words are captured;
the complete main draw transcript and before/after positions prove zero attempt-stream consumption. All other input
fields are compared before/after the actual call. Four separately labelled direct helper cases cover clipped corner
scans/no optional avoid, fully protected input/no draws, an undersized rejected patch and thin terrain with avoid/pool masks.
They are helper inputs, never described as generated map seeds.

Tests compare every draft feature field and complete ownership arrays, exact streams/continuations, unchanged feature
prefixes and ordinary/observed Rust entrypoints. Additional checks cover per-tile ownership invariants, patch separation,
all rule visitor fields, live rule changes and invalid owner references before writes. No tolerances, source package edits,
new dependencies, caches, clock or I/O are used by the runtime.

Pinned capture/check: Linux x64 Node v22.23.4, `node --import tsx tools/map-fixtures/bushes.ts [--check]`.
The external `bushes-tool` harness includes the existing DTO model directly; only its two orphaned parent-admission helper
methods receive a harness-only dead-code allowance. The managed runtime/tests have no warning suppressions.
