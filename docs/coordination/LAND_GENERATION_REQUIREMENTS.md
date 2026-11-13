# Land generation: owner requirements, for the coordinator's landmark lane

Written 2026-11-12 by the land-generation session at `feature/unity-rework` `566841f4`, in answer to
[LANDMARK_GENERATION_SPEC.md](LANDMARK_GENERATION_SPEC.md). **Uncommitted on purpose:** the owner points the
coordinator at this file; the coordinator decides where it is recorded.

Source: a requirements session with the owner in chat (2026-11-12). The owner asked for order in map generation "using
the same methodology as Minecraft": fences placed realistically round the church with organised gaps; bogs that look
natural, with size variance and overlap; lava always in three streams; the Holy temple and the Frost cave with a set
size and architecture; an environment that feels natural and predictable while still random. Two rounds of questions
were each answered "Yes to all", and the summary was answered "Confirmed, start". Every item below was put to the
owner as a recommendation and accepted in those words; none was volunteered by the owner in more detail than this.

## 1. Requirements for the landmark lane (yours)

| # | Requirement | Touches |
|---|---|---|
| L1 | **One size, one blueprint per landmark, all five.** Not "the largest from 30 down to 28 that fits its site". The only variation between maps is where the landmark stands within its site rule, its rotation and its mirror. A site that cannot hold the blueprint discards the attempt. The stated reason: predictability, and landmark art drawn once to an exact footprint. | SCALE-1 to -4, HOLY-1 |
| L2 | **Church:** the graveyard is part of the church's blueprint, in front of the door, inside the reserved site. Church plus graveyard together are the landmark. This answers your open question (section 6, third item). | SCALE-2 |
| L3 | **Bog tree:** its own bog is an irregular marsh, not perfect rings; closed all the way round but for two or three dry causeways to the trunk. | SCALE-3 |
| L4 | **Volcano:** exactly three streams on every map, never two. They leave the rim in a fan toward the coliseum: one down the middle, one each side. The middle stream is the longest, about 14 to 18 tiles; the side streams about 10 to 14. Natural bends; each ends in a pool; no fords (lava is LOW: walkers go round the pool). A site that cannot hold three discards the attempt. | SCALE-4, `volcano.rs` (`streams: (2, 3)`, `stream_len`) |
| L5 | **Cave:** one blueprint: an enclosed chamber, one mouth toward the coliseum, the elite camp at a fixed spot inside, a fixed ice floor. | SCALE-1 |
| L6 | **Holy hall:** stays an open colonnade, walkable from every side (not a walled building with doors). One size, one symmetric interior: a lit central nave, the shrine at the back, the front toward the coliseum. | HOLY-1 |

Two rules the owner accepted for every requirement here and in section 3:
- **Guarantees are hard.** An attempt that cannot deliver one is discarded and the next is tried; a map is never served
  downgraded (two streams, a smaller temple).
- **The numbers are targets.** Where a size or length pushes the generator past its attempt budget, the measurement
  goes back to the owner; the number is not changed quietly.

## 2. Proposed additions to the core rules (ADR 0028 is shared: yours to apply)

- **G9. A landmark is a fixed blueprint** (L1).
- **G10. Every thematic obstacle is placed by a rule that reads the landmark** (the anchor, its bands, its front). No
  styler lays its obstacles as if the landmark were not there.
- The owner's line between fixed and random. **Fixed on every map:** each landmark's size and architecture; its front
  toward the coliseum; the counts (three streams, one lake at the cave mouth, two fence enclosures); how obstacles are
  arranged by distance from the landmark. **Random per map:** zone shapes; camp positions; where the landmark sits
  within its site rule; rotation and mirror; the outline of bogs, lakes and lava paths; decoration.

## 3. What the land-generation lane will build (mine; for your information)

Packets are named `P-LAND-<ZONE>-<n>`. Order: Sentenced, Plague, Frost; Fire after SCALE-4; Holy after HOLY-1.

- **Sentenced** (`style_gallows/`, signature mode). All fence belongs to two rectangular enclosures round the church
  and its graveyard, 5 and 12 tiles out (about 40 and 54 across at a 30-tile landmark). One spine on the door axis:
  door, graveyard path, inner gate, outer gate, gallows square. Gates: 5 wide on the spine, 3 wide elsewhere, one every
  12 tiles from the middle of each side at the same offsets on both enclosures; no fence run longer than 9 tiles;
  corners closed; every yard has two ways out; a lantern post at each gate. Guard houses stay outside the inner
  enclosure. Lines break where a camp clearing or a spawn route crosses them.
- **Plague** (`style_warren/`). Free bog pools are two to four overlapping rough-edged discs in three sizes (about 5,
  8 and 12 tiles across), large near the tree and small far, merged or at least 8 tiles apart, off spawn routes and
  camp clearings. Barrows unchanged.
- **Frost** (`style_rime/`). The lake is built in front of the mouth first, not grown and checked afterwards: about
  400 tiles (give or take 15%), on the line from the coliseum to the mouth, 3 dry tiles between mouth and shore, and
  always one dry way round it to the mouth at least 3 wide. One smaller second lake elsewhere. This aims at the
  `SignatureDiscarded` attempts you measured.
- **Fire** (`style_scorch/`). Craters keep clear of all three streams. **Every Fire camp keeps its crater**; size falls
  with distance and none is dropped. This answers your open question (section 6, fourth item).
- **Every zone.** About today's share of the zone's free ground as fence, bog and ice, within about a fifth, measured
  after the site is taken out. Barrows, guard houses, spires, headlands and craters keep today's rules and move only
  where they would collide with the new arrangement.
- **Review.** The owner approves an 8-seed sheet of tile pictures per zone before I ask for a merge; the rules are
  tests over seeds 1 to 32, written as properties measured from the anchor so they survive your six merges.

## 4. What I ask of the landmark lane

1. **Styler edits.** I ask to own the edits in `style_gallows/`, `style_warren/` and `style_rime/` that SCALE-2 and
   SCALE-3 might need (your offer in section 3 of the spec): pass me the failing test. `style_scorch/` stays with
   SCALE-4; I rebase after it.
2. **The yard box.** Until L2 lands, the Sentenced enclosures are measured from the bounding box of the `Church`
   footprint together with the `Graveyard` features in front of it. After L2 that box is the landmark's footprint and
   nothing in my rules changes.
3. **The band table.** I will measure `[2, 6, 14]` against 30-tile footprints and propose numbers in a hand-off.
4. **Superseded.** `P-LAND-SENTENCED-1` replaces the styler half of `P-MAPGEN-SIG-SENTENCED-1`; that branch and its
   oracle are left untouched. Its Holy-anchor half is HOLY-1's. `P-LAND-PLAGUE-1` will replace
   `P-MAPGEN-SIG-PLAGUE-1`.
5. **Where I work.** Worktree `/Users/nevinmckinnon/Documents/Projects/RH-landgen`; branches `packet/P-LAND-*` and
   `agent/opus/P-LAND-*` only. Nothing is committed in the integration checkout.

## 5. Not established

- No measurement stands behind the numbers in sections 1 and 3: no sheet has been drawn and no seed run. In
  particular it is not known whether two enclosures hold about today's amount of fence, how much of an enclosure
  survives the camps and spawn routes that cross it, or what three streams of these lengths cost in attempts.
- The owner has not seen a blueprint for any landmark; L1, L5 and L6 fix that there is one, not what it is.
