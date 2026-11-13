# Landmark blueprints (approved)

The fixed layout of each zone's landmark, one character per tile, the front (the side facing the coliseum) at the
bottom. Each file's first lines are its legend. The owner approved these on 2026-11-13 (MIGRATION, "Owner decision
2026-11-13: the five blueprints"); they are the source the landmark packets pin against (ADR 0028 rule G9: a landmark
is a fixed blueprint, placed in one of eight orientations inside its reserved site).

| Landmark | File | Box | Packet that builds it |
|---|---|---|---|
| Frost cave | `cave.txt` | 29 x 29 | P-MAPGEN-SIG-SCALE-1 |
| Sentenced church with its graveyard | `church.txt` (**superseded 2026-11-13**: the owner added a churchyard fence with a 5-wide main gate; being redrawn, not yet approved) | 29 x 29 | P-MAPGEN-SIG-SCALE-2 |
| Plague bog tree | `bog.txt` | 29 x 29 | P-MAPGEN-SIG-SCALE-3 |
| Fire volcano | `volcano.txt` | 30 x 30 | P-MAPGEN-SIG-SCALE-4 |
| Holy hall | `hall.txt` (two Holy camps on the nave at rows 15 and 27 from the back; 32 piers; a 7-wide nave) | 37 x 37 | P-MAPGEN-SIG-HOLY-1 |

Placement: a reserved site is 34 tiles a side with a 2-tile apron, so its inner rect is 30. The Sentenced and Frost
elite camp stands 7 tiles inside the inner rect's far side and one tile off its centre line across (34 is even), so
the 29-wide boxes are placed relative to the camp's tile (`E` in the grid), not centred on the site. The volcano's
three stream outlets are the marked tiles on its front row; the streams themselves lie outside the box and are drawn
per map.

What the drawings need from the code (found while they were checked; each is in its packet's brief): graveyard fences
are LOW tiles, which the certifier's graveyard row and the landmark intact check must accept; the church's anchor
footprint is the blueprint box, not the bounding box of its written tiles; plain floor, doors, mouths and causeways
stay unwritten tiles.

The hall was redrawn at 37 from the approved 39 draft on the owner's size decision: the pier rhythm of the 39 draft
does not divide 37, so the nave is 7 wide (it was 9) and there are 32 piers (38); the owner was shown the redrawn
grid the same day. Changing a grid is an owner decision. The checker that proved each grid against the generator's rules (enclosure,
openings, camp halo, reachability, wall pieces, ice rule, symmetry) and the owner-facing write-up were produced in
the coordinator's session and are not checked in; each packet's oracle re-proves the rules on generated maps.
