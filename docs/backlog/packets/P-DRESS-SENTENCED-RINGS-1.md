# P-DRESS-SENTENCED-RINGS-1: the Sentenced decoration rings are measured from the church building, not the churchyard

- **Serves:** a reviewer's finding on P-MAPGEN-SIG-SCALE-2 (cosmetic, visible), settled by the coordinator's art
  decision, which follows the owner-approved plan "church: flagstone yard, graves, dead grass, dead trees". Decoration
  rules: DEV-021 (baked by `rh-mapdress`); P-DRESS-ANCHOR-1 (rings by the generator's bands). Not in ORDER_OF_OPERATIONS
  as an item of its own: owner or coordinator confirms the lane.
- **Implementer tier:** implementer-sonnet (one crate: a small rules reader, one rules file, one remap of the band plane)
- **Reviewer:** reviewer (Sonnet): no `rh-sim`, wire, save or hash touched
- **Integration base:** `feature/unity-rework` @ `42ce9a72f`; stacked on `packet/P-MAPGEN-SIG-SCALE-2-fix` @ `ae2dc4cdb`
  (the church packet, not merged yet). Gate with `--base packet/P-MAPGEN-SIG-SCALE-2-fix`.
- **D-rules touched:** D1 n/a (no legacy counterpart: DEV-021, DEV-020) · D2 n/a · D5/D6/D9 none. Outside `content_hash`.

## 1. ID and outcome
With the church built as the 29 x 29 blueprint (churchyard fence, graveyard, building), the Sentenced landmark's anchor
footprint is the whole yard, and `rules/zones.json` lays the rings by `signature::band` from that footprint. Measured
today on seeds 1-8 (signature on, the shipped rules): **every** Sentenced floor tile inside the fence (558 of 558) is
flagstone ground (variant 3) and the yard carries 49-82 `sent.flag` props; **no** `sent.grave` or `sent.fence` prop stands
inside the yard, and 23-43 graves plus 5-17 fence props per map stand 3 to 6 tiles OUTSIDE the fence (the near band of
the footprint). This packet makes the yard read as the plan says. After it, on the blueprint church:

1. The rings are measured from the church BUILDING (the `Church` feature's box; the `Graveyard` feature owns the
   headstones and fence), not the anchor footprint.
2. Flagstone (ground variant 3, `sent.flag`) only in the building's apron: Chebyshev distance 0-2 from the building's box
   (the generator's core band, `DEFAULT_DEFINITION.bands[0]`), which includes the building's floor inside.
3. `sent.grave` and `sent.fence` props only strictly inside the churchyard (the footprint inset by one tile: the fence
   line and its gates are not inside), on floor tiles only (never on a headstone, fence tile, building wall or the door).
4. The dead-grass ring (`sent-mid-deadgrass`, ground 5, `sent.lamp`) and the dead-tree ring (`sent-far-deadtrees`, ground
   6, `sent.stump`) begin at the fence line and run outward; none strictly inside the yard. No tall prop of any stage
   stands inside the yard. The graves ring's ground (variant 4) lies only inside the yard.
5. The mechanism is general: any zone's landmark block may name a ring `origin`; default is the anchor's footprint, so
   every other zone, and any rules file without the field, dresses exactly as today.

### Design (the choice the oracle pins)
```json
"landmark": {
  "feature": "church",
  "origin": { "feature": "church", "inside": "near", "outside": "mid" },
  "rings": [ ...four rings as today, same names, bands, grounds and kinds... ]
}
```
`rules.rs`: `LandmarkRules.origin: Option<RingOrigin>`; `RingOrigin { feature: FeatureKind, inside: Option<Band>,
outside: Option<Band> }` (the stub commit has the types and parses the field without validating or using it).

How a tile's band is decided (the oracle restates it in `effective_band`):
- **Origin box:** the bounding box of the zone's largest map feature of kind `origin.feature` (most `tiles`, first on a
  tie: the same choice `anchor()` makes for `signature_feature`). The church feature is the building (23 x 14, columns
  3-25, rows 3-16 of `church.txt`); a generic reader needs no church knowledge.
- `b = signature::band(anchor with footprint := origin box, x, y)`. The generator's function and bands stay the only
  definition (4 bands: 2, 6, 14 tiles).
- **Inside** = strictly inside the anchor's footprint (inset by one tile; for a footprint of 2 or fewer tiles on a side
  nothing is inside). A tile inside takes `b` if `b` is core or `inside` is absent, else `inside`.
- Any other tile (the footprint's edge ring, i.e. the fence line and the gates in it, and everything outside) takes the
  farther of `b` and `outside` (just `b` when `outside` is absent). Bands order core < near < mid < far (`Band: Ord`).
- **No feature of that kind in the zone on this map** (option off has no anchor at all and takes the fallback rings;
  with the option on, a map without the named feature): the whole origin is ignored and the zone is dressed from the
  anchor's footprint exactly as without the field. A zone with no `landmark` block cannot carry an origin (the field
  lives inside the block).
- `build` refusals (new): an `inside` or `outside` that is not core, near, mid or far is refused naming the ZONE and the
  value (`zone "sentenced": origin inside "inner" ...`). An unknown or missing feature name, or a stray key, is already
  refused by serde (`deny_unknown_fields`); keep that.

Why these numbers: inside the yard the building's bands from the box run near (3-6) and mid (7-14) because the fence is 3
tiles from the building on three sides and 12 on the front; the rules allow one ring per band, so `inside: near` folds the
whole yard beyond the apron into the graves ring, and `outside: mid` makes the first outside ring the dead grass (from the
fence line outward), with dead trees beyond 14 tiles from the building (far). The four rings keep their names, kinds,
densities and ground variants (distinct per band, as `tests/landmark_rules.rs` requires); only the plane they read changes.

### What today's maps show (seeds 1-8, signature on; measured with the shipped rules, before the change)
| Seed | grave outside / inside | fence outside / inside | `sent.flag` inside | yard floor tiles that are flagstone |
|---|---|---|---|---|
| 1 | 38 / 0 | 10 / 0 | 82 | 558 / 558 |
| 2 | 23 / 0 | 11 / 0 | 77 | 558 / 558 |
| 3 | 30 / 0 | 5 / 0 | 51 | 558 / 558 |
| 4 | 24 / 0 | 12 / 0 | 76 | 558 / 558 |
| 5 | 25 / 0 | 5 / 0 | 68 | 558 / 558 |
| 6 | 43 / 0 | 17 / 0 | 62 | 558 / 558 |
| 7 | 24 / 0 | 8 / 0 | 62 | 558 / 558 |
| 8 | 37 / 0 | 14 / 0 | 49 | 558 / 558 |

("Inside" = strictly inside the footprint inset by one tile; the apron of the building holds 371 floor tiles on every
seed, the rest of the yard 187.) Also inside the yard today and NOT moved by this packet's rings: `sent.deadgrass` filler
(2-8 per map), `sent.lantern` edge props (14-22), `sent.slab` cluster members (0-11); see Open points.

## 2. Dependencies
`packet/P-MAPGEN-SIG-SCALE-2-fix` (the church blueprint and its `Church` / `Graveyard` features). Nothing else.

## 3. Relevant legacy paths
None: signature maps and landmark decoration have no legacy counterpart (DEV-020, DEV-021). Generator facts used:
- `crates/rh-sim/src/mapgen/landmarks/signature/mod.rs:299-328`: `Band` (`Ord`), `band(anchor, x, y)` (Chebyshev from the
  anchor's footprint; bands `[2, 6, 14]`).
- `crates/rh-sim/src/mapgen/landmarks/signature/church.rs` (module doc, header) and `church.txt`: the `Church` feature
  is the building only (`#`, `P`); one `Graveyard` feature owns `G` (headstone walls) and `+` (LOW fence); the anchor
  (`ZoneAnchor`, kind `Church`) has the whole 29 x 29 box as `footprint`, and `entrance` is the door.
- `crates/rh-sim/src/mapdata/model.rs:221-258`: `MapFeature { kind, zone, bbox, tiles }`, `ZoneAnchor`.
- Today's rings: `crates/rh-mapdress/rules/zones.json:94-101` (the Sentenced landmark block);
  `crates/rh-mapdress/src/lib.rs`: `band_plane` (writes `Grid::bands`), `landmark_rings` (ground and ring props by band),
  `Grid::is_core`/`open` (tall props of EVERY stage keep out of the core band), `anchor()` (feature choice).

## 4. New paths
- `crates/rh-mapdress/tests/sentenced_rings.rs` (oracle)
- this brief

## 5. Exclusive write scope
- `crates/rh-mapdress/src/rules.rs` (validation of `inside`/`outside`; the stub already carries the types)
- `crates/rh-mapdress/src/lib.rs` (`band_plane` and what reads `Grid::bands`; the origin box)
- `crates/rh-mapdress/rules/zones.json` (the Sentenced `origin`; nothing else in the file)
- `crates/rh-mapdress/tests/marsh.rs`: constants only, in ONE separate commit `P-DRESS-SENTENCED-RINGS-1 re-pin:` (see 7).
  **This edits an existing oracle file: the coordinator must get the owner's approval first** (as for the church packet's
  re-pin `8da17b3d8`). Nothing else in an existing test changes.
- No `rh-sim`, wire, protocol, Unity or `hosting/` change. **No new decoration kind** (a kind needs a row in
  `client-unity/RoguehallaNet/Net/Ui/DecorationKinds.cs`, another lane's file): the four rings keep their kinds.

## 6. Contracts and references
- DEV-021 (decoration baked by `rh-mapdress`, cosmetic, outside the content hash); ADR 0028 (signature landmarks, G4 bands).
- `crates/rh-mapdress` determinism: seeded from `map_hash` by hash noise, ordered iteration, no new entropy, no floats
  beyond what the crate already uses (the remap is integer geometry on tiles); clippy `-D warnings`.

## 7. Behaviour to preserve
- Every zone other than Sentenced: dressing unchanged. `tests/marsh.rs` `every_zone_other_than_plague_is_dressed_as_before`
  pins Fire, Frost and Holy (props and ground, seeds 1-4, signature on, and option off) and the Sentenced row.
  **The implementer re-pins exactly the Sentenced entries of `SIG_GOLDEN` in `tests/marsh.rs`** (index 1 of each of the four
  rows, the second value of each row, i.e. the `0x1f5e...`, `0xe409...`, `0x55f7...`, `0xb4d9...` lines) in the separate
  commit `P-DRESS-SENTENCED-RINGS-1 re-pin:`, with the new values printed by the failing assertion. Every other constant
  of `SIG_GOLDEN` and all of `OFF_GOLDEN` stay as they are; if any other changes, the implementation is wrong.
- Option off (no anchors): dressing byte-identical (`OFF_GOLDEN`; the new `option_off_maps_are_dressed_identically...`).
- A rules file without `origin` (the shipped file minus the field): byte-identical to today (`NO_ORIGIN_GOLDEN`, and
  `tests/anchor.rs` `NO_ANCHOR_GOLDEN`).
- `tests/landmark_rules.rs`: one ring per band, at most one far, distinct grounds, no tall prop in the core ring: all keep
  holding (the zones.json rings do not change).

## 8. Acceptance checks
- `cargo test -p rh-mapdress` green (the 8 red tests below pass; everything else stays green).
- `scripts/gate.sh --oracle packet/P-DRESS-SENTENCED-RINGS-1` passes (full), with the stack's base as the gate says.
- The re-pin commit changes only the four Sentenced values of `SIG_GOLDEN`.

## Oracle files (read-only for implementers)
- `crates/rh-mapdress/tests/sentenced_rings.rs`

Red on assertion on the stub (8): `the_shipped_file_measures_sentenced_from_the_church_building_and_no_other_zone_has_an_origin`
("sentenced.signature.landmark has no origin"), `a_malformed_origin_is_refused_naming_the_zone_and_the_value` ("a malformed
rule file was accepted"), `graves_and_fence_props_stand_inside_the_churchyard_fence_and_on_open_floor` (a grave outside
the yard), `flagstone_covers_the_buildings_apron_and_nothing_else` (a yard tile 14 from the building is flagstone),
`the_dead_grass_and_dead_tree_rings_begin_at_the_fence` (graves ground outside the yard),
`sentenced_ground_and_ring_props_follow_the_band_from_the_origin` (no origin in the file),
`any_zone_may_name_an_origin_and_its_rings_follow_it` (Fire's ground differs from the restated band) and
`an_origin_with_only_a_feature_measures_the_bands_from_that_features_box` (ground differs from the band from the building).
Green guards (8, on the stub and after): the premise (`the_church_feature_is_the_building_inside_the_churchyard_anchor`),
`an_origin_without_a_known_feature_or_with_a_stray_key_is_refused`, `an_origin_may_name_only_a_feature_and_the_field_is_optional`,
`no_tall_prop_of_the_zone_stands_inside_the_churchyard`, `a_file_without_origin_dresses_signature_maps_exactly_as_today`
(golden), `option_off_maps_are_dressed_identically_with_or_without_the_origin`,
`an_origin_naming_a_feature_the_zone_lacks_is_ignored`, `no_other_zones_ground_moves`.

## 9. Validation commands
```
export PATH="$HOME/.cargo/bin:$PATH"
CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 cargo test -p rh-mapdress
cargo fmt --all -- --check
scripts/gate.sh --quick --base packet/P-MAPGEN-SIG-SCALE-2-fix --oracle packet/P-DRESS-SENTENCED-RINGS-1
```
(If the gate's Unity step rewrites `client-unity/UnityProject/Assets/Resources/Showcase/NunitoRegular.asset`, restore it
with `git checkout -- <that file>`.)

## 10. Risk and suggested model tier
Sonnet is enough: one crate, the property tests state the rule. The traps are in 11. Expected size well under 450 lines
(rules parse 30, band remap 40, zones.json 1, re-pin 4 values).

## 11. Known traps
- **`Grid::bands` also drives `is_core`**: tall props of every stage (cluster `sent.deadtree`, ring `sent.stump`) are
  barred from the core band. Today the whole yard is core, so no tall prop stands in it. After the remap only the apron is
  core, and without care deadtree cluster members land in the yard. `no_tall_prop_of_the_zone_stands_inside_the_churchyard`
  guards this; keep an "inside the yard" bar for tall props (for instance a separate plane or flag), do not weaken the test.
- The band plane is built from the anchor for every zone with a landmark, in `band_plane`; the ring ground loop
  (`landmark_rings`) and props both read it. Change the plane once; do not special-case Sentenced by zone name.
- The origin box must be chosen like `anchor()` chooses (largest `tiles`, first on a tie); the premise test shows the
  `Church` feature box is 23 x 14 (or 14 x 23 if the church is rotated).
- "Inside" excludes the footprint's edge ring on purpose (the fence line with its gates stays free of graves; the outside
  rule treats it as the start of the outside). Gates in the fence may hold a dead-grass ring prop (`sent.lamp`).
- Flagstone also covers the church's floor inside the building (distance 0): intended, it is the apron's near side.
- A rules file where `inside`/`outside` are both absent changes only the origin of the bands (tested).

## Open points for the owner or the coordinator (the art decision leaves them open)
1. **`sent.deadgrass` filler stands inside the yard** (2-8 per map, zone-wide filler 1.5 per cent), and `sent.lantern`
   edge props (14-22, hugging the fence and walls, which suits a fenced yard) and `sent.slab` cluster members (0-11) too.
   Item 4 of the decision says dead grass begins at the fence; the RING named deadgrass places `sent.lamp`, but the filler
   that is actually dead grass is the zone's filler rule. This packet pins the rings only. Keeping the filler out of the
   yard needs a per-rule footprint filter on fillers, a small follow-up, if the coordinator wants it.
2. **Ring prop kinds do not match the ring names**: "deadgrass" places `sent.lamp` and "deadtrees" places `sent.stump`
   (kinds fixed by the church-era rules; a rename or swap is an art pass in `DecorationKinds.cs`, not this packet).
3. Graves are laid at 7 and 3 per cent over the yard's remaining floor (187 floor tiles, much of it plot interiors):
   roughly 10-20 props per map. Density retuning is an art call and is not pinned beyond "at least 40 over eight maps".
4. The yard's edge ring (gates) is treated as outside, so `sent.lamp` may stand in a gate. Say so if it must not.

## Notes from previous attempts
