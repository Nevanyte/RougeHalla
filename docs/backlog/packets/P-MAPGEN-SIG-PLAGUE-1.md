# P-MAPGEN-SIG-PLAGUE-1: Plague's marsh pools are rings (mud, water, bog) arranged by band from the bog tree

- **Serves:** owner decision 4 (2026-11-10: marsh rings grass > mud > water > bog, giant bog tree near the outer
  edge) and owner direction 2026-11-12 (core rules G1 to G8: zones, landmark, obstacles by band, decoration)
- **Implementer tier:** implementer-opus (rh-sim mapgen: the Plague styler in signature mode)
- **Reviewer:** reviewer-opus
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1: option off byte-identical (G8) · D2 n/a · no sim tick or wire change

## 1. ID and outcome
P-MAPGEN-SIGNATURE-CORE-1 places the bog tree in the Landmarks phase (`landmarks/signature/bog_tree.rs`), but the
Plague styler (`style_warren/`: `shape.rs:103`, `planning.rs:75` `bog_at`, `mod.rs:213` `surface`) still lays its bog
crescents as legacy does, without reading the landmark. When this lands, in signature mode: every bog pool is a ring
(bog in the middle, then water, then mud, then the zone's floor), pools keep off spawn corridors and leave dry paths
between them, and rule G4 holds by construction: pool size comes from the band the pool sits in (`signature::band`,
`landmarks/signature/mod.rs:154`: largest near the tree, smallest far), the tree itself stands on dry ground or mud,
never in water or bog. Total slow ground stays close to today's bog area (the oracle author measures the option-off
bog tile count per seed and fixes a window).

## 2. Dependencies
- P-TERRAIN-MARSH-1 merged (codes 8 mud, 9 water). P-MAPGEN-SIG-FROST-1 merged (shared `landmarks/signature/mod.rs`).

## 5. Exclusive write scope
- `crates/rh-sim/src/mapgen/style_warren/**`, `crates/rh-sim/src/mapgen/landmarks/signature/bog_tree.rs`
- `crates/rh-sim/src/mapgen/certify/**` only for the hazard-walk rule counting mud and water (named in the hand-off)
- `docs/adr/0028-signature-landmarks.md`, `docs/DEVIATIONS.md` (proposed row or an amendment of DEV-020)

## 7. Behaviour to preserve
- Option off: the Plague styler draws and decides exactly as today (pinned styler tests, the option-off identity
  case); no mud or water on any option-off map.
- Option on: every seed still has its tree, church, volcano and (after FROST-1) cave; every map certifies with zero
  failures; spawn-walk ratio and route stretch stay inside the certifier's limits.

## 8. Acceptance checks
- Oracle, seeds 1-32, option on: every bog tile's 4-neighbours are bog or water; every water tile's are water, bog or
  mud; no mud or water tile outside the Plague zone; no ring tile inside a camp's keep-clear, on a spawn corridor or in
  the tree's core band; slow-ground total inside the measured window; near-band pools at least as large as far-band
  pools (mean, by 15 percent).
- One hazard-walk check: the shortest route from each Plague-zone spawn to the coliseum gate crosses no more slow
  ground than the certifier's existing limit allows for bog.
- Report attempts per seed and the worst attempt index.
- `scripts/gate.sh --quick --oracle packet/P-MAPGEN-SIG-PLAGUE-1` passes (the coordinator runs the full gate).

## Oracle files (read-only for implementers)
- listed by the oracle author on `packet/P-MAPGEN-SIG-PLAGUE-1`

## 10. Risk and suggested model tier
Opus. Rings widen every pool by two tiles each side: on narrow ground pools merge or close a path, and the certifier
discards the map (G5). Size the bog core down so the ring fits the legacy crescent's footprint.

## 11. Known traps
- Draw order is behaviour: the signature stream is `hash_seed(seed, attempt, zone slot, 5)`; option-off draws stay
  untouched.
- Legacy feature-tied props around barrows come from the generator's decor stream: leave them.

## Notes from previous attempts
