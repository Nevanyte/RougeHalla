# P-MAPGEN-SIG-SCALE-1: the volcano, church, bog tree and cave are a lot larger, a little smaller than the Holy hall

- **Serves:** owner direction 2026-11-12 late (MIGRATION): "All of the faction landmarks look good. I want most of
  them (except holy temple) to be a lot larger, maybe just a little smaller than the temple."
- **Implementer tier:** implementer-opus (rh-sim mapgen: the Landmarks phase)
- **Reviewer:** reviewer-opus
- **Integration base:** feature/unity-rework (P-MAPGEN-SIG-FROST-2 merged)
- **D-rules touched:** D1: option off byte-identical (G8); no legacy counterpart (DEV-020) · D2 n/a · no sim tick or
  wire change

## 1. ID and outcome
Today's footprints (seeds 1 to 3, the owner's previews): Holy hall 38-39 x 38-39; volcano cone 5x5 (plus streams and
pools); church about 10x12 with four small headstone blocks as its graveyard; bog tree a 13-tile trunk inside a
13x15 footprint of bog rings; cave about 12x11. The owner approved the shapes and wants the four non-Holy landmarks a
lot larger: a little smaller than the hall. Target: a footprint about 28 to 32 tiles across (the hall's 38-39 is
the ceiling; "a little smaller" is the instruction), with a floor below which an attempt is refused (proposed 24;
the oracle author fixes both numbers after measuring what fits).

When this lands, in signature mode:
- **Volcano:** a cone about 28-32 across: an impassable rock mass with stepped flanks and a crater lake of lava in
  the middle (not enterable); its 2-3 streams leave from the rim and still end in pools; total lava stays inside a
  budget the oracle author re-measures (the crater lake now holds part of it).
- **Church:** an enterable hall about 28 wide by 32 long with one door, the far elite camp inside near the far end,
  rows of pillars (cover that does not cut the room in two), and a graveyard beside it scaled to match (fenced
  plots, not four headstones).
- **Bog tree:** a trunk about 9-11 across with root walls reaching out, inside bog rings that bring the footprint
  to about 28-30; the outer ring closed all the way round (today it is broken on some seeds) except for dry
  causeways in, so the tree can be reached.
- **Cave:** an enterable chamber about 28x26 with one mouth, the far elite camp inside, an ice floor (not thin
  stripes along the walls) that keeps the camp's halo and the mouth's first rows dry, and the lake rule of
  P-MAPGEN-SIG-FROST-2 unchanged (the lake within 10 steps of the mouth).
- The Holy hall is not changed here (P-MAPGEN-SIG-HOLY-1 moves it into the Landmarks phase with a standard interior).
- Everything else holds: one landmark per zone placed in the Landmarks phase before obstacles (G1, G2); bands are
  measured from the new footprint (G4), so stylers and decoration follow without change; keep-clear outranks theme
  and failing attempts are discarded (G5); aprons apart (FROST-2); option off byte-identical (G8).

## 2. Dependencies
- P-MAPGEN-SIG-FROST-2 merged. P-MAPGEN-SIG-SENTENCED-1 (oracle written at today's sizes) and P-MAPGEN-SIG-PLAGUE-1
  wait for this packet and are re-measured after it.

## 5. Exclusive write scope
- `crates/rh-sim/src/mapgen/landmarks/signature/{mod.rs,volcano.rs,church.rs,bog_tree.rs,cave.rs}`
- the stylers only where a landmark's size is assumed (`style_scorch/` crater bands and the lava budget,
  `style_rime/` lake seeding by the mouth, `style_gallows/`, `style_warren/`): named by the oracle author
- `docs/adr/0028-signature-landmarks.md`

## 7. Behaviour to preserve
- Option off: byte-identical.
- Option on: every zone still gets its landmark on every certified map; the far elite camp is still inside the
  church and the cave; every map certifies with zero failures; spawn-walk ratio and route stretch stay inside the
  certifier's limits; the attempt limit (16) is not approached (report the worst index over seeds 1-64).
- The existing generator oracles keep their meaning; where they pin sizes, counts or map hashes that this packet
  must change (the lake packet's pinned option-on hashes; the Fire band statistics; the apron pairs), the oracle
  author re-measures and amends them in this packet's oracle commit and says exactly which.

## 8. Acceptance checks
- Oracle, seeds 1-32, option on: each of the four landmarks' footprint has both sides at least the floor and at most
  the hall's side minus two; mean side at least the target minus two; the church and cave are enclosed with exactly
  one opening and the elite camp inside, every interior floor tile reachable from the door; the tree's outer ring is
  closed except its causeways and the trunk is reachable; the volcano's streams start at the rim and end in pools.
- Fairness: the church's and cave's interior gives a fighter at the door a floor path of at least a stated width to
  the camp; no spawn's shortest route to the coliseum is lengthened beyond the certifier's limit by a landmark.
- Report: sizes per seed, attempts per seed (1-64), time per certified map, lava totals, how often the target size
  did not fit and what was built instead.
- `scripts/gate.sh --quick --oracle packet/P-MAPGEN-SIG-SCALE-1` passes (the coordinator runs the full gate).

## Oracle files (read-only for implementers)
- listed by the oracle author on `packet/P-MAPGEN-SIG-SCALE-1`

## 10. Risk and suggested model tier
Opus. A 30-tile landmark is a fifth of a zone's width: the church and cave are built round the far elite camp, which
on some seeds sits in a strip 12 to 14 tiles wide. Either the landmark adapts its size to the site between the
floor and the target, or the site rule changes (the landmark chooses its site and the elite camp is drawn inside
it), or more attempts are discarded: the oracle author measures all three on seeds 1-64 before pinning a rule, and
cuts the packet per landmark if one implementer cannot carry all four.

## 11. Known traps
- Camps are placed before the Landmarks phase; moving the elite camp is a change to the Prefix under the option and
  must not shift any draw when the option is off.
- Draw order is behaviour: the signature stream is `hash_seed(seed, attempt, zone slot, 5)`.
- A bigger cone moves every Fire band: the crater-band rule and its statistics are re-measured, not assumed.
- Anchors live on the generator's map and on `GameMapData.anchors`, never on `LayerData`.

## Notes from previous attempts
