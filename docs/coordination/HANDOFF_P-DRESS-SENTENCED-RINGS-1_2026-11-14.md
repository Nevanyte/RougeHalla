# Hand-off: P-DRESS-SENTENCED-RINGS-1 (the Sentenced decoration rings follow the church building)

Written by the land-generation session. Stacked on the church (P-MAPGEN-SIG-SCALE-2): merge it after the church.

```
PACKET:          P-DRESS-SENTENCED-RINGS-1 — not in ORDER_OF_OPERATIONS: serves REAL finding 1 of the reviewer-opus pass
                 on P-MAPGEN-SIG-SCALE-2 and the coordinator's art decision of 2026-11-14 (from the owner-approved
                 plan "church: flagstone yard, graves, dead grass, dead trees"); DEV-021 (decoration baked by rh-mapdress)
BRANCH:          agent/sonnet/P-DRESS-SENTENCED-RINGS-1 @ e359c93e3 (the gated commit), this hand-off on top; 5 commits
                 on packet/P-MAPGEN-SIG-SCALE-2-fix @ ae2dc4cdb (the church stack, itself on 42ce9a72f).
                 Worktree /Users/nevinmckinnon/Documents/Projects/RH-landmark.
GATE:            PASS (full, --base packet/P-MAPGEN-SIG-SCALE-2-fix --oracle eab690940) on e359c93e3 [skipped: Postgres
                 suites, no DATABASE_URL]: 264 test binaries ok, none failed; EditMode 1257 of 1257.
CHANGED:         crates/rh-mapdress/src/{rules.rs, lib.rs}; crates/rh-mapdress/rules/zones.json (the Sentenced origin);
                 crates/rh-mapdress/tests/{sentenced_rings.rs (new), anchor.rs (four tests amended), marsh.rs (four
                 Sentenced constants, one re-pin commit)}; the brief
D-RULES:         none of D1-D10: decoration only (no tile, no outcome, no wire or kind change). Option off dressing
                 byte-identical (OFF_GOLDEN unmoved); every zone without an origin dressed as before.
DEVIATIONS:      none new (inside DEV-021)
SHARED RECORDS:  proposed edits: docs/backlog/README.md (a row); docs/MIGRATION.md checkpoint
LEGACY DOUBTS:   none
NOT ESTABLISHED: how the new layout reads in the Unity client (no kind was added; nobody has looked); counts of props
                 inside and outside the yard after the change were not measured (the tests pin the rule: none outside,
                 at least 40 grave and fence props over seeds 1-8); seeds beyond 8; Postgres suites.
RISKS:           the building leaves exactly 2 tiles to the fence on three sides, the width of the flagstone apron: a
                 building placed one tile off would put apron tiles on the fence line (the flagstone test would catch
                 it on seeds 1-8).
```

## What it does
`rules/zones.json` gains an optional, general field in a zone's `landmark` block:
`"origin": { "feature": "church", "inside": "near", "outside": "mid" }`. Without it the anchor footprint is the origin
and everything is dressed as before. With it, the bands are the generator's `signature::band` measured from the box of
the zone's largest feature of that kind; inside the yard (the anchor footprint inset by one tile) a tile beyond the
building's 2-tile apron takes the `inside` band; everywhere else takes the farther of the measured band and `outside`.
A map without the named feature ignores the origin. An unknown band name is refused naming the zone and the value.
Tall props are barred from the yard.

Result for Sentenced, as your art decision asks: flagstone only in the building's apron; loose graves and fence props
across the rest of the yard and none outside the churchyard fence; dead grass from the fence line outward; dead trees
beyond 14 tiles from the building.

Before, on seeds 1-8 with the blueprint church (the oracle author's measurement): all 558 yard floor tiles flagstone;
no grave or fence prop inside the yard; 23-43 graves and 5-17 fence props outside its fence on each map.

## Existing tests amended (approved by this lane; the reviewer judged them sound)
`tests/anchor.rs`: `the_ground_plane_follows_the_band_of_each_floor_tile`,
`every_ring_prop_stands_in_the_band_its_ring_declares_inside_its_own_zone`,
`no_tall_prop_of_any_stage_stands_in_the_core_band` (now also: not strictly inside the churchyard) and
`each_zone_has_ring_props_in_its_near_and_mid_bands_on_every_seed` restate the band through one helper that follows
the zone's ring origin. For Fire, Frost, Holy and Plague they assert what they asserted before.

## Goldens (commit e359c93e3; yours to drop and redo at merge)
Only the four Sentenced values of `SIG_GOLDEN` in `tests/marsh.rs` moved; Fire, Frost, Holy, `NO_ANCHOR_GOLDEN` and
every `OFF_GOLDEN` value are unchanged.
```
seed 1 Sentenced 0x1f5ef22494590d7b -> 0xe926b8d1238ed9cc
seed 2 Sentenced 0xe409292349d69a78 -> 0x165c10bcc7ce9249
seed 3 Sentenced 0x55f7da1d30f18669 -> 0xff82deacae0882be
seed 4 Sentenced 0xb4d9c39d3ef25b8a -> 0xd8f408a6682b2815
```

## Review (reviewer, Sonnet, by reading): LAND, no blocking or real finding
One branch point (`lib.rs`, the band plane): no origin, or a feature the zone lacks, falls back to the old expression.
No new entropy, ordered iteration, a stable tie-break for the largest feature. The yard predicate is shared by the band
remap and the tall-prop bar. Minor, left on purpose: the guard does not check that the building's apron lies inside
the footprint (the risk above); serde's error for an unknown origin feature names the value, not the zone; a loose doc
comment on `landmark_anchor`.

## Art points left open (for the art side or the tuning lane; not decided here)
- `sent.deadgrass` filler (2-8 per map), `sent.lantern` edge props (14-22) and `sent.slab` cluster members (0-11)
  still stand inside the yard: this packet moves the rings only.
- The ring named "deadgrass" places `sent.lamp` and "deadtrees" places `sent.stump`.
- The fence line counts as outside the yard, so a `sent.lamp` or a tall prop can stand in a gate.
- Grave density is unchanged (7 and 3 per cent over about 187 yard floor tiles: roughly 10-20 props per map).
- The other landmarks can now name an origin too (the tree's trunk, the volcano's cone, the hall's shrine).
