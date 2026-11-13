# P-MAPGEN-SIG-SCALE-2: the church is a lot larger, with pillar rows and a graveyard of fenced plots

- **Serves:** owner direction 2026-11-12 late (MIGRATION): the faction landmarks "a lot larger, maybe just a little
  smaller than the temple". Second of four (P-MAPGEN-SIG-SCALE-1 is the plan and the measurements).
- **Implementer tier:** implementer-opus (rh-sim mapgen: the Landmarks phase)
- **Reviewer:** reviewer-opus
- **Integration base:** feature/unity-rework after P-MAPGEN-SIG-SCALE-1
- **D-rules touched:** D1: option off byte-identical (G8); no legacy counterpart (DEV-020) · D2 n/a · no sim tick or
  wire change
- **Status:** brief only; the oracle is written when SCALE-1 has landed (oracle-author, Opus).

## 1. ID and outcome
The Sentenced church takes the size rule SCALE-1 puts in `signature/mod.rs` (the largest chamber between a floor and a
target that fits round the far elite camp, plus the territory rule): about 28 wide by up to 32 long where the site
allows, never under the floor, one 3-tile door facing the coliseum, the far elite camp near the far end. Inside, rows
of pillars (cover) that never cut the room in two (every interior floor tile reachable from the door with all pillars
standing; a 3-wide way from the door to the camp). Beside it, a graveyard scaled to match: fenced plots (LOW fence or
wall pieces of at least `R.piece_min`) in rows mirrored about the door axis, not four headstones.

## 2. Dependencies
- P-MAPGEN-SIG-SCALE-1 merged (the size and territory rules in `mod.rs`).
- Owner decisions 1 and 2 of SCALE-1 (site reservation; other camps inside) change the room: if the owner takes
  either, write this oracle after it.

## 3. Relevant paths
- `crates/rh-sim/src/mapgen/landmarks/signature/church.rs:29-216` (`place`: wall lines `church_side` 4-7 from the camp,
  border lean, door on the dominant axis of the front, the graveyard layouts and `grave_gap`, the redraw rules).
- `crates/rh-sim/src/mapgen/landmarks/signature/mod.rs:52-63` (`church_side`, `border_max`, `border_gap`,
  `graveyards`, `grave_gap`, `door_shift`).
- Measured room (SCALE-1, table 1, attempt 0, seeds 1-64): 28 round today's far Sentenced camp on 6 seeds, 24 on 32,
  20 on 50; with other camps enclosed 28 on 39; with sites reserved before camps 28 on 62. (a) at 20-28 is expected to
  behave as the cave's (mean side about 23); the graveyard needs room beyond the door and may push the church to a
  smaller size: measure it.

## 5. Exclusive write scope
- `crates/rh-sim/src/mapgen/landmarks/signature/{church.rs,mod.rs}`
- `crates/rh-sim/src/mapgen/style_gallows/` only where it assumes the church's size (the oracle author names it)
- `docs/adr/0028-signature-landmarks.md` (decision 5)

## 7. Behaviour to preserve
- Option off byte-identical; every zone keeps its landmark; certifier clean; the worst attempt index and the total
  attempts within SCALE-1's bounds (re-measured); the cave as SCALE-1 left it.

## 8. Acceptance checks (for the oracle author to make exact)
- Church footprint sides between the floor and min(target, hall side - 2); mean side over seeds 1-32 at the measured
  value; enclosed with one door, the far elite camp's halo inside, every interior floor tile reachable from the door;
  pillars: at least N pieces inside, none in any halo, the interior one 4-connected piece, a 3-wide way door to camp.
- Graveyard: plots mirrored about the door axis, each a fenced rectangle, all outside the church's apron and walkable
  round; the graveyard's footprint scales with the church (stated ratio).
- Re-pinned in the oracle commit: `mapgen_signature_core.rs` `shape_church_encloses_the_far_elite_camp_with_a_door_to_the_front`
  and `shape_graveyard_headstones_are_mirrored_about_the_door_at_one_gap` (they pin 4-7 wall distances and 2x3
  headstones); P-MAPGEN-SIG-SENTENCED-1's oracle (written at today's sizes).

## Oracle files (read-only for implementers)
- written on `packet/P-MAPGEN-SIG-SCALE-2` by the oracle author.

## 10. Risk and suggested model tier
Opus: the graveyard and pillars add constraints to a search that is already the tightest after the cave's.

## 11. Known traps
- Draw order: the church draws from the Sentenced slot's signature stream; the volcano is placed before it, the bog
  tree and the cave after it, so a change in the church's draws moves nothing else's draws but moves their sites
  (the aprons and the floor they see).
- The graveyard is `FeatureJob::Cover`; its pieces are walls today (`intact` checks them as walls); fences are LOW:
  `intact` and the certifier's `SIGNATURE_KINDS` row must allow them.
