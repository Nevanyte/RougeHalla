# P-MAPGEN-SIG-SENTENCED-1: Sentenced's yards and guard houses are arranged by band from the church; Holy's hall is placed in the Landmarks phase

- **Serves:** owner direction 2026-11-12 (core rules G1 to G4: the landmark is placed first, obstacles are chosen by
  distance band from it); owner decision 4 (2026-11-10: enterable old church with the elite camp inside, fenced
  graveyard plots beside it aligned to the fence rows, gallows square stays; Holy keeps its temple)
- **Implementer tier:** implementer-opus (rh-sim mapgen: the Sentenced styler in signature mode, the Holy hall's phase)
- **Reviewer:** reviewer-opus
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1: option off byte-identical (G8) · D2 n/a · no sim tick or wire change

## 1. ID and outcome
P-MAPGEN-SIGNATURE-CORE-1 places the church around the far elite camp with a graveyard
(`landmarks/signature/church.rs:29`, graveyard `:205`), but the Sentenced styler (`style_gallows/`: `shape.rs:133`,
`rules.rs:142`, `mod.rs:225`) still lays fence rows and guard houses without reading the landmark. Holy's hall is
recorded in `signature::finish` (`landmarks/signature/mod.rs:337`, hall `:355-360`), after the styler, not in the
Landmarks phase. When this lands, in signature mode: (a) Sentenced obeys G4 by construction: no guard house or fence
row in the church's core band; fence rows near the church run parallel to the graveyard's long side; the near band
holds grave plots and low fences, the mid band the gallows square and guard houses, the far band the sparse outer
rows; (b) Holy's hall is found and recorded as the zone's anchor in the Landmarks phase (G1, G2), so later steps
(decoration rings, P-DRESS-ANCHOR-1) read every zone's anchor the same way; `finish` no longer adds it.

## 2. Dependencies
- P-MAPGEN-SIG-FROST-1 merged (shared `landmarks/signature/mod.rs`). May run beside P-MAPGEN-SIG-PLAGUE-1 (disjoint
  styler directories; the only shared file is `signature/mod.rs`, which this packet owns).

## 5. Exclusive write scope
- `crates/rh-sim/src/mapgen/style_gallows/**`, `crates/rh-sim/src/mapgen/landmarks/signature/{mod.rs,church.rs}`
- `crates/rh-sim/src/mapgen/style_sanctum/**` and `pipeline/mod.rs` only as far as recording the hall's anchor earlier
  needs (the temple's tiles do not move)
- `docs/adr/0028-signature-landmarks.md`

## 7. Behaviour to preserve
- Option off: both stylers draw and decide exactly as today (pinned styler tests, the option-off identity case).
- Option on: the Holy zone's tiles are byte-identical to today's option-on output (only the phase of the anchor
  record moves); every seed still has its volcano, tree, church and (after FROST-1) cave; zero certifier failures;
  the gallows square exists on every seed.

## 8. Acceptance checks
- Oracle, seeds 1-32, option on: no Sentenced obstacle tile in the church's core band; every fence row with a tile
  in the near band is parallel to the graveyard's long side; guard houses are in the mid or far band only; the
  guard-house count is at least the option-off count minus one on every seed (report the distribution).
- Oracle: after the Landmarks phase every styled zone has exactly one anchor on the generator's map (`anchors`), the
  Holy one on the hall; `finish` adds none.
- Report attempts per seed and the worst attempt index.
- `scripts/gate.sh --quick --oracle packet/P-MAPGEN-SIG-SENTENCED-1` passes (the coordinator runs the full gate).

## Oracle files (read-only for implementers)
- listed by the oracle author on `packet/P-MAPGEN-SIG-SENTENCED-1`

## 10. Risk and suggested model tier
Opus. The church replaced one guard house in CORE-1: a band rule that removes more can leave the far elite camp
without its legacy cover, and the route guard may then discard the map.

## 11. Known traps
- Anchors live on the generator's map only, never on `LayerData` (`Sim::check_layout` forbids skip-when-empty fields
  in checkpointed state: CORE-1 attempt 1 failed on exactly this).
- The oracle author checks the facts above against the code first (the brief's line numbers come from a quick lookup)
  and narrows the packet if the Holy part does not fit in about 300 changed lines: the Holy anchor may be split off.

## Notes from previous attempts
