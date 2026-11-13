# P-MAPGEN-SIG-SCALE-2: the church is a lot larger, with pillar rows and a graveyard of fenced plots

- **Serves:** owner direction 2026-11-12 late (MIGRATION): the faction landmarks "a lot larger, maybe just a little
  smaller than the temple". Second of four (P-MAPGEN-SIG-SCALE-1 is the plan and the measurements).
- **Implementer tier:** implementer-opus (rh-sim mapgen: the Landmarks phase)
- **Reviewer:** reviewer-opus
- **Integration base:** feature/unity-rework after P-MAPGEN-SIG-RESERVE-1 and P-MAPGEN-SIG-SCALE-1
- **D-rules touched:** D1: option off byte-identical (G8); no legacy counterpart (DEV-020) · D2 n/a · no sim tick or
  wire change
- **Status:** brief only; the oracle is written when SCALE-1 has landed (oracle-author, Opus).

## Amendment 2026-11-13 (owner decision "Yes, apply them": requirements L1 and L2; supersedes everything below where they differ)

Source: `docs/coordination/LAND_GENERATION_REQUIREMENTS.md` on the integration branch; MIGRATION, "Owner decision
2026-11-12 (chat, midnight)"; ADR 0028 rule G9.

- **Church and graveyard are one blueprint** (L1, L2): the graveyard stands in front of the door, inside the reserved
  site; together they fill the site's inner rect (30 x 30 target) and together they are the landmark. The anchor's
  footprint is their common box (the land-generation task measures its fence enclosures from it). The question "must
  the graveyard fit inside the site" is closed: yes.
- Fixed in the drawing: the wall ring, the 3-tile door on the centre line, the pillar rows, the elite camp's spot (9
  tiles from the site's far edge), the fenced plots mirrored about the door axis with a path on that axis from the
  door to the front edge (the land-generation task's spine continues it: inner gate, outer gate, gallows square).
  "Target 30, floor 28" is withdrawn: one size.
- `style_gallows/` is not this packet's (agreed with the land-generation session): where the styler assumes the old
  church, pass that session the failing test (`P-LAND-SENTENCED-*`).
- **Guarantees are hard, numbers are targets** (same owner decision): an attempt that cannot deliver the blueprint is
  refused (`Refusal::Signature`) and the next is tried; nothing is served smaller or with a part missing. If the fixed
  size pushes seeds 1-64 past the attempt bounds, the measurement goes to the owner; the size is not changed quietly.
- **The blueprint is drawn first.** The coordinator drafts it as a tile grid and the owner approves it before the
  oracle is written or amended. It is data (a grid in `signature::Definition` or a table beside it, no new `const`),
  placed in one of eight orientations (four rotations by the front's dominant axis, mirrored or not: the mirror is one
  draw of the zone's signature stream).
- **The oracle** then pins equality: on every seed of 1-32 the landmark's tiles equal the blueprint under one of the
  eight orientations, inside the site's inner rect, front toward the coliseum; plus the attempt bounds, measured once.

## 1. ID and outcome
Amended 2026-11-12 (coordinator decision): the church is built in its site reserved by P-MAPGEN-SIG-RESERVE-1 (34
tiles, the church's elite camp inside it 9 tiles from the far edge). It takes the size rule SCALE-1 puts in
`signature/mod.rs`: **target 30, floor 28** a side (the footprint, the church's wall ring; the site less its apron),
never under the floor, one 3-tile door facing the coliseum, the elite camp near the far end. The graveyard stands
beyond the door as today and may leave the site (its stones keep the halo and apron rules); whether it must fit inside
the site (then the church is shorter than 30 along the door axis) is the oracle author's to measure. Inside, rows
of pillars (cover) that never cut the room in two (every interior floor tile reachable from the door with all pillars
standing; a 3-wide way from the door to the camp). Beside it, a graveyard scaled to match: fenced plots (LOW fence or
wall pieces of at least `R.piece_min`) in rows mirrored about the door axis, not four headstones.

## 2. Dependencies
- P-MAPGEN-SIG-RESERVE-1 merged (sites reserved before camps; the church's camp inside its site).
- P-MAPGEN-SIG-SCALE-1 merged (the size rule, and the territory rule if SCALE-1 needed it, in `mod.rs`).
- Other camps stay out of the church (coordinator decision 2026-11-12).

## 3. Relevant paths
- `crates/rh-sim/src/mapgen/landmarks/signature/church.rs:29-216` (`place`: wall lines `church_side` 4-7 from the camp,
  border lean, door on the dominant axis of the front, the graveyard layouts and `grave_gap`, the redraw rules).
- `crates/rh-sim/src/mapgen/landmarks/signature/mod.rs:52-63` (`church_side`, `border_max`, `border_gap`,
  `graveyards`, `grave_gap`, `door_shift`).
- Measured room: RESERVE-1 reserves a 34-tile Sentenced site on the back edge on 64 of 64 seeds (its brief, table A);
  the history (SCALE-1, table 1: 28 round today's far camp on 6 of 64 seeds) is why. Measure the graveyard's room
  beyond the door with the church at 30.

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
