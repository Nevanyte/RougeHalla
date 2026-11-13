# Land generation requirements, addendum 1: the churchyard moves into the church's blueprint

Written 2026-11-13 by the land-generation session. It adds to
[LAND_GENERATION_REQUIREMENTS.md](LAND_GENERATION_REQUIREMENTS.md) (recorded in `3c7a18fa8`) and does not edit it.
**Uncommitted on purpose**, as that file was: the owner points the coordinator at this file; the coordinator decides
where it is recorded.

## 1. What was measured

Section 3 of the requirements put all Sentenced fence in two enclosures, 5 and 12 tiles out from the church and its
graveyard. Section 5 said no measurement stood behind that. It was measured before any implementation: seeds 1 to
32, option on, at `566841f4`. The figures and the tests are on `packet/P-LAND-SENTENCED-1` @ `2ac5380b6` (local
branch, worktree `RH-landgen`): `docs/backlog/packets/P-LAND-SENTENCED-1.md` section 12 and
`crates/rh-sim/tests/mapgen_land_sentenced.rs`.

| Seeds 1 to 32 | min | median | max |
|---|---|---|---|
| Fence tiles today, option on | 229 | 306 | 359 |
| Fence tiles today, option off | 277 | 329 | 418 |
| Most fence the two enclosures can hold (every clear line tile off the gates) | 13 | 69 | 120 |
| That, as a share of option-off fence | 4% | 20% | 34% |

- The guaranteed main gate (5 wide on the door axis, fence on both flanks, on both enclosures) has room on 25 of 115
  accepted attempts (22%). The inner gate fails mostly because a flank lies in another camp's halo (44 attempts); the
  outer because it falls off the Sentenced zone (26).
- A styler cannot refuse an attempt: an error from `shape` becomes a generator error (`pipeline/mod.rs:406`). A
  refusal would have to live in `SignatureContext::intact` (`signature/mod.rs:411`), which is yours.
- Closed corners collide with the certifier's detour rule (`certify/features.rs:383-435`, `fence_detour` 10): a
  corner's arms can be 5 tiles each at most.
- All of this is today's geometry: before RESERVE-1 and before the 30-tile church.

## 2. The owner's decision (chat, 2026-11-13)

The figures were put to the owner with three options: (1) churchyard plus lanes, (2) concentric rings to the zone's
edge, (3) only the two enclosures with a fifth of today's fence. The owner answered **"Option 1"**. What option 1
said, as the owner read it:

- The churchyard fence and its 5-wide main gate become part of the church's blueprint, inside the reserved site.
- The rest of the zone keeps today's amount of fence as straight lanes square to the church: parallel to the door
  axis, symmetric about it, with no jogs.
- Gates sit on one shared 12-tile grid, so they line up into cross lanes (today's rows stagger them).
- The outer enclosure is dropped.

The owner was also told that this depends on you fitting the churchyard inside the site, and that it makes the
church building itself smaller than 30 tiles.

## 3. Requirement for the landmark lane

**L2a (extends L2).** The church's blueprint holds the church, the graveyard in front of its door, and a churchyard
fence round both, with a main gate 5 tiles wide on the door axis in the front side. Church, graveyard and churchyard
together are the landmark; the churchyard is the same on every map (L1) and costs no attempt, because it is built
with the landmark and not laid by the styler afterwards.

What the owner accepted for the fence enclosures in the earlier rounds, when the styler was to build them, now
describes the churchyard. It is the owner's picture, not a measured rule, and the blueprint is your design:

- gates 5 wide on the door axis and 3 wide elsewhere; at least two ways out of the yard;
- no straight fence run longer than 9 tiles;
- corners closed (see the detour rule in section 1 if the certifier's fence rules apply to landmark fence);
- a lantern post at each gate (decoration).

## 4. What changes in the requirements file

- Section 2, the fixed and random line: "the counts (three streams, one lake at the cave mouth, two fence
  enclosures)" becomes "(three streams, one lake at the cave mouth, one churchyard)". If ADR 0028 G9 or G10 quotes
  the two enclosures, the same change applies there.
- Section 3, Sentenced, is replaced by this (mine, `style_gallows/` in signature mode, packet `P-LAND-SENTENCED-1`
  rewritten on the same branch):
  - Every fence row is a straight line parallel to the door axis. Rows stand on fixed lines 8 tiles apart, the same
    lines on both sides of the spine: 4, 12, 20, ... tiles to either side of it. The spine itself is an open lane 7
    wide, from the main gate outward.
  - Gates are 3 wide, one every 12 tiles, at the same positions in every row, counted along the door axis from the
    anchor's `entrance`. They line up into straight cross lanes. With a 12-tile period and 3-tile gates a run is 9
    tiles: the certifier's existing `fence-run` limit.
  - A row breaks where a camp clearing, a spawn route, a wall or another feature is in its way. It never jogs.
  - No styler fence in the landmark's apron (today: within 2 tiles of the box round the church and its graveyard).
  - Amount: about today's share of the zone's free ground, within about a fifth, measured against option off.
  - Today's planner already runs its rows toward the coliseum (`style_gallows/shape.rs:142`, the axis of the zone's
    centroid from the map's centre), picks row lines by `viterbi_rows` with gaps of 7 to 9, lets rows jog
    (`rows.rs:150`), and staggers gate phases `[2, 8]` counted from the zone's bounding box. The lanes rule keeps
    that planner and fixes its axis, lines and phase to the church.

## 5. What I ask of the landmark lane

1. **The anchor.** The lanes are measured from the church anchor's `entrance` and its facing. Keep both after
   SCALE-2. Either the church door or the churchyard's main gate works as `entrance`, as long as it lies on the door
   axis; the main gate (the tile where the spine leaves the footprint) reads best, because the first cross lane then
   runs along the churchyard's front.
2. **The main gate** centred on the door axis. A 5-wide gate then opens into the 7-wide spine lane.
3. **The churchyard fence inside the footprint**, not in the apron. The existing rule that no styler feature owns an
   apron tile then keeps every row end at least 3 tiles from it.
4. **Option-on pins.** Changing the Sentenced fence changes every option-on map, so pinned option-on outputs move.
   In your lane: `crates/rh-sim/tests/mapgen_signature_frost_lake.rs`
   (`seeds_with_the_lake_at_the_mouth_keep_their_maps`,
   `seeds_17_and_18_land_on_the_next_attempt_with_the_lake_at_the_mouth`,
   `the_worst_attempt_stays_within_the_measured_margin`). In mine: `crates/rh-mapdress/tests/anchor.rs` and
   `tests/marsh.rs` goldens. Tell me which you want for yours: (a) my branch re-pins them in one separate, labelled
   commit that you can drop and redo at merge, or (b) I leave them untouched and list the new values in the
   hand-off, and you re-pin as a merge carry. **Until you answer, the implementer does not touch them**, so my gate
   cannot be fully green on that branch; I will say exactly which tests are red and why.
5. **One row in `crates/rh-sim/tests/content.rs`.** The lanes numbers (8, 4, 12, 3) cannot be fields of
   `style_gallows::Definition` or `Dials`: both fold into the content hash (`rules.rs:176`, `content.rs:1488`) and
   option off must stay byte-identical. They become a separate `pub const` with a `NON_GAMEPLAY` row, as
   `signature::DEFAULT_DEFINITION` has at `tests/content.rs:46`. I take that row as in scope unless you object.
6. **Interim.** Between my packet and SCALE-2, an option-on Sentenced map has lanes and no churchyard fence. The
   option is off by default; I flag it so nobody reviews that picture as finished.

## 6. Not established

- The lanes rule has not been measured yet. The oracle author measures its ceiling (clear tiles on the lines, off
  the gate bands) before writing a test; if it cannot carry about today's fence, the figure goes back to the owner.
- Nothing here has been measured on a reserved site or a 30-tile church.
- The owner has not seen a churchyard blueprint, or any tile picture of either design.
