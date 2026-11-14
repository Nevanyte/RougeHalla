# Architecture review of signature landmarks and land generation (reviewer-opus, read-only, 2026-11-13 late night)

Read at: RH-landmark detached at `ee4458104` (integration `42ce9a72f` + church packet) and RH-landgen-2 (Plague stack).
Asked by the owner ("make sure the architecture is well set up; do not worry about small details").

**Verdict: yes, with named changes.** Sound and to stay: the site reservation in the Prefix on per-zone streams;
drawings as data pinned to `docs/`; landmarks written through the stage's layers and masks; refusing an attempt rather
than serving a smaller landmark; `ZoneAnchor` kept off checkpoints and the map hash; option off as a delegation to
`begin_attempt`. Not ready for the volcano and the hall: (a) stylers reverse-engineer landmark geometry from features;
(b) one hand-written placement path per landmark; (c) the site is one global size with one pinned camp. Change (a) and
(b) before SCALE-4, (c) with HOLY-1.

## Findings, most important first

### 1. Hand stylers the landmark (a `LandmarkFrame`), do not rebuild it from features. Before SCALE-4's styler work and HOLY-1.
- Four readers rebuild the anchor and disagree on "entrance": `style_scorch/mod.rs:373`; `style_rime/mod.rs:319-349`
  (mouth guessed as floor on the box edge with floor outside); `style_warren/pools.rs:112-121`;
  `style_gallows/lanes.rs:73-125` (door = three open tiles on the `Church` box edge, `door_span` `:64-69`, while the
  anchor's entrance is the 5-tile main gate). `finish` (`signature/mod.rs:694-729`) re-reads footprints after records
  with a Church exception and a "largest Hall" rule; `aprons_apart` finds the hall by `bbox == footprint` (`:840-844`).
  `ZoneAnchor` (`mapdata/model.rs:246-258`) carries no orientation and no named point beyond one `entrance` list.
- If left: `style_scorch` must find three outlets and headings from lava tiles; `style_sanctum` the nave and two camps
  from piers; signature mode detected by "a feature of kind K is present" cannot work for Holy (`Hall` is a legacy
  styler kind): the likeliest option-off leak. A drawing edit silently becomes `Error::Landmark` on every attempt.
- Change: `apply` builds a generator-internal `LandmarkFrame` per zone (the anchor, axis and mirror bit, grid-to-map
  transform, named landed marks: camps `E`, door `D`, gate, outlets `O` with map-space headings, nave rectangle),
  carried in `Placed`, passed as `style_zones::Input.landmarks: Option<&[LandmarkFrame]>` then
  `BaseContext.landmark: Option<&LandmarkFrame>` (`style_zones/mod.rs:33-49`, `style_runtime/contexts.rs:5-23`).
  `None` with the option off is the single typed branch point for stylers. `finish` copies anchors from the frames and
  stops re-reading. `ZoneAnchor` and the wire unchanged.
- Size/risk: medium; shared files (style_zones, style_runtime, pipeline, signature): one serialized packet; no draws;
  digest-neutral if done right (unchanged option-on goldens prove it).

### 2. One blueprint type and one per-landmark spec table. Before the volcano and the hall.
- Three readers and orientation codes: `cave::Blueprint` with `grid`/`land` (`cave.rs:93-170`, reused by the church),
  `church::Blueprint` (`church.rs:245-290`), `bog_tree::Drawing` (`bog_tree.rs:26-61`). Each `blueprint()` repeats the
  same loop (`cave.rs:179-246`, `church.rs:301-381`, `bog_tree.rs:179-242`). `apply` dispatches on zone with a
  different signature per landmark and `_ => cave` (`signature/mod.rs:612-629`). Which kinds belong to which landmark
  is spread over `is_signature` (`:882`), `by_tile` (`:896`), `intact` arms (`:745-768`), `aprons_apart` (`:849-856`).
  Rule-drawn paths alive for tests only: `cave.rs:58-86` and `335-511`, `church.rs:53-238`, `bog_tree.rs:74-168`,
  keeping about 20 `Definition` fields alive.
- Shape, in `signature/blueprint.rs`: `Blueprint::parse(text, &Legend)`; the legend maps each character to what is
  written (nothing, wall, LOW + terrain key, floor + terrain key), its piece and feature kind, its legality class
  (`wall`, `wall+ground`, `floor`) and an optional mark. Eight orientations transforming cells AND directions (outlet
  headings swap under the mirror). A placement rule: pin a mark on a tile (cave, church) or align the box to the site's
  inner rect (volcano, hall, tree). Output `Built` plus the frame of finding 1. One spec table per landmark: zone,
  drawing, legend, member kinds, by-tile apron, site rule; `is_signature`, `aprons_apart`, `intact` driven from it.
  `intact` generic: every cell the landmark wrote still has its tile and terrain and is owned by a member kind.
- Volcano adds: an even side (30), no centre tile (a centre pin lands one tile off under 180 degrees; the 30 inner rect
  has zero slack) so box-in-rect placement; outlet marks with headings that flip under the mirror; an extension step
  after the stamp (streams from outlets, on the zone stream). Hall adds: two `E` marks, a larger box, no outer wall so
  the entrance comes from a named mark.
- Timing: now. Digest-neutral for the three existing landmarks (same draw order: one mirror draw first). Delete the
  rule-drawn paths in the same move (already the cave's follow-up). Make `apply` require a reservation.
- Size/risk: medium, a net code reduction, low risk (existing orientation oracles and goldens must not move).

### 3. Sites from the blueprint, not global numbers. Prerequisite of HOLY-1; the volcano can go without it.
- `site_side`/`site_depth` global (`signature/mod.rs:117-122`); `site_depth` 9 duplicates the drawing's `E` row by
  hand via `inside_camp` (`:537-557`); `Reserve.camp: Option<usize>`, a pinned camp is always the zone's first elite
  (`zones/camps/mod.rs:475-488`); `relabel_sites` gives the whole rect one camp's label from a zone list (`:227-267`);
  `reserved_zones()` excludes Holy (`:220`); `inner.filter(zone != Fire)` special case (`:612`).
- If left: the hall needs a 41 site, two pinned camps that are not elites, a relabel split between two camps: three
  more special cases.
- Change, in the spec: site side = box + 2 x apron; pinned camps = the `E` marks landed under the front axis with an
  elite flag per landmark (assert at parse time the `E` marks lie on the mirror axis, since the mirror is drawn after
  the camps); relabel gives each site tile the nearest inside camp (identical to today with one camp); Holy joins the
  reservation on its own `hash_seed` slot so other zones' draws do not move.
- Size/risk: medium; changes option-on Prefix output (expected for HOLY-1); option off untouched.

### 4. End-of-attempt guarantees as a registered list beside each styler. Before the Fire, Frost and Holy land rules.
- `Refusal::Signature` and `StyleLandmark` are right as separate phases. The end-of-attempt checks are mixed:
  `SignatureDiscarded` combines integrity, aprons, the Frost lake rule (`cave::lake_at_mouth`, judging the styler's
  lake from landmark code, `signature/mod.rs:823`) and the certifier; Plague's check is a module in `pipeline/` with
  its own variant, a `Pipeline.pool_detour` field and a test seam (landgen-2 `pipeline/mod.rs:95-96, 142, 198,
  721-726`). Fire, Frost and Holy would each add another variant, field and module.
- Change: keep `Signature` (as `Signature(Zone)`) and `StyleLandmark`. End of attempt runs generic `intact`, then
  certify, then per-zone `guarantees: &[fn(&GameMapData, &LandmarkFrame) -> Result<(), &'static str>]` registered in
  `style_zones` beside each styler, in one loop; one variant `Refusal::Guarantee { zone, rule }`. Move `lake_at_mouth`
  to `style_rime` and `plague_pools` to `style_warren`. Generalise `walk_growth` (`plague_pools.rs:19-36`) over a
  "forbidden ground" predicate: it is then Frost's dry-way-round check and likely Holy's.
- Size/risk: small to medium, low risk (pure predicates, no draws); refusal labels change in about 15 test sites.

### 5. Tests pin other packets' outputs. Before the next landmark packet, to save its re-pins.
- `pinned_others` in `tests/mapgen_signature_scale.rs:99`, `_church.rs:110`, `_bog_tree.rs:96`; `PINNED_OFF` copied in
  `_frost.rs:63`, `_fire.rs:53`, `_church.rs:93`; `others_digest` (`scale.rs:415-434`) collapses to 0 when any landmark
  refuses (apply is all-or-nothing); `rh-mapdress` goldens (`tests/anchor.rs:297-308`, `tests/marsh.rs:418-445`) taken
  on live option-on maps so every landmark change moves them.
- Change: replace `pinned_others` with one property: each landmark placed alone from the prefix equals the same
  landmark placed with all the others (only the volcano's streams cross sites; document it); each landmark file pins
  only its own landmark. One `PINNED_OFF` table in one file. `rh-mapdress` digest goldens on a checked-in fixture map
  (regenerated by a documented command); live-map dressing tests become property checks (rings follow `band`).
- Keep: tiles equal the drawing under exactly one of eight orientations; certify-clean; attempt bounds; option-off pins.
- Size/risk: small, test-only.

### 6. Tunables and identity. Two small fixes now; the identity question waits for go-live.
- Terrain codes duplicated as literals (`bog: 5`, `lava: 1`, `ember: 4`, `ice: 6`; `signature/mod.rs:47, 67-68, 106`)
  while the catalog is keyed by name (`terrain_gate/rules.rs:28-58`); Frost-styler tunables live in the landmark
  `Definition` (`:107-116`, read by `style_rime/lakes.rs:215`); `band()`, the stylers and `plague_pools` read
  `DEFAULT_DEFINITION` directly (`:318`, `plague_pools.rs:63`) while the pipeline builds its context `from_definition`:
  two sources for the same numbers.
- Now: look up terrain codes by key when the context is built; move the lake tunables beside the styler.
- Go-live trigger (owner decision): nothing today wrongly relies on the `content_hash` exclusion (pooled maps ship
  tiles plus baked dressing; anchors are not in checkpoints). When the flag becomes the default, or anything names a
  map by seed and options instead of carrying its tiles (replays, headless sweeps), fold `Definition`, `LANES`,
  `POOLS` and the drawing texts into the hash in one packet.

## Sound; leave alone
Prefix reservation and per-zone `hash_seed` streams (G6; adding Holy perturbs no other zone); `begin_attempt_signature`
as an exact delegation with the option off and the pipeline's few option-on branch points; drawings by `include_str!`
with a byte-equal pin to `docs/`; writing through `LandmarkStage` state and masks; G5 as discard, never repair;
`StyleLandmark` distinct from styler faults; `ZoneAnchor` as the exported and wire projection; `signature::band` as the
single definition of the bands; the fixed feature-kind set (the volcano and hall need no new kinds if outlets and the
nave are marks rather than features).

## Not read by the reviewer
`volcano.rs` past line 120; `style_scorch/craters.rs` and `style_sanctum/` in depth; the bodies of
`style_warren/{pools,walk,shape}.rs`; `rh-mapdress/src`, `records/`, `repair/`, `certify/mod.rs` beyond greps; test
files beyond the pin tables; the requirement docs and most briefs; Unity and the wire decoders.

## The order I intend (land-generation session)
After the Plague stack and the church are merged: (A) finding 2 with the rule-drawn paths deleted and finding 5's
`pinned_others` property, as one packet on `signature/**` and its tests; (B) finding 1 (`LandmarkFrame` to stylers;
lanes, pools, rime and scorch read it) and finding 4 (guarantee list; move `lake_at_mouth` and `plague_pools`), as the
second packet on the shared files; (C) finding 6's two small fixes inside A or B; finding 3 with HOLY-1; the identity
question to the owner at go-live. Then SCALE-4 (volcano), HOLY-1, the Frost lake, Fire and Holy land rules.
