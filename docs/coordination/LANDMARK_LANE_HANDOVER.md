# Landmark generator lane: hand-over to the map generator session

Written 2026-11-13 by the coordinator. **Owner decision (coordinator's chat, 2026-11-13 evening):** asked who builds
the four remaining landmark generator packets, the owner answered "Map generator session". From here the map
generator (land-generation) session owns the generator code that places each approved landmark drawing; the
coordinator stops after the cave, reviews and merges what comes back, and makes the Unity front end ready.

Read with: [LANDMARK_GENERATION_SPEC.md](LANDMARK_GENERATION_SPEC.md) (its updates), [ADR 0028](../adr/0028-signature-landmarks.md)
(G1-G10; decisions 11 and 12 as rewritten by the cave packet), [../landmarks/blueprints/README.md](../landmarks/blueprints/README.md),
[prompts/WORKER_RULES.md](prompts/WORKER_RULES.md).

## 1. What is yours now

| Packet | What | State you inherit |
|---|---|---|
| P-MAPGEN-STYLE-REFUSE-1 | A styler that cannot build round its landmark refuses the attempt instead of failing generation (`pipeline/mod.rs:422`, `style_runtime/`, the lanes' door case) | Brief on the integration branch; no oracle. Lands before the church. |
| P-MAPGEN-SIG-SCALE-2 | The church with its graveyard and churchyard as the approved 29 x 29 drawing | Brief (amended twice; arrives on the integration branch with the cave merge); no oracle. Its guards are in section 3. |
| P-MAPGEN-SIG-SCALE-3 | The bog tree as the approved 29 x 29 drawing | Brief; no oracle |
| P-MAPGEN-SIG-SCALE-4 | The volcano as the approved 30 x 30 drawing, exactly three streams | Brief; no oracle. `style_scorch/` is in its scope. |
| P-MAPGEN-SIG-HOLY-1 | The Holy hall as the approved 37 x 37 drawing, placed in the Landmarks phase, with a 41-tile Holy site and two camps on the nave | Brief with the owner decision and the site measurement; no oracle |
| Follow-up of the cave (reviewer note 1) | Delete the old rule-drawn cave chamber: move `mapgen_signature_fire.rs:736-790` and `mapgen_signature_fire_bands.rs:450-462` onto `begin_attempt_signature(.., true)`, then remove `cave.rs:57-86` | Not briefed |

Files that go with the lane: `crates/rh-sim/src/mapgen/landmarks/signature/**`, `mapgen/attempt/`,
`mapgen/zones/camps/`, `mapgen/landmarks/stage/`, `mapgen/pipeline/mod.rs`, `mapgen/certify/`, `mapgen/style_runtime/`,
ADR 0028, `docs/landmarks/blueprints/` (read-only: a grid changes only by owner decision), and the tests
`crates/rh-sim/tests/mapgen_signature_*.rs`. One packet at a time on `signature/mod.rs`.

What stays with the coordinator: review (reviewer-opus, independently of yours) and merge of every branch; the
`rh-mapdress` digest re-pin at each merge; `Cargo.lock`, MIGRATION, DEVIATIONS numbering (the next free row is
DEV-033); the wire (P-WIRE17-MAP-3 sends each anchor to the client: zone, kind, centre, footprint, front, entrance)
and all Unity work.

## 2. The cave is the worked example (P-MAPGEN-SIG-SCALE-1, merging now)

- **Grid as data:** a byte-equal copy of the approved drawing beside the code
  (`landmarks/signature/cave.txt`), read with `include_str!` into a `Definition` field and parsed once in
  `SignatureContext::from_definition`; an oracle test pins the copy against `docs/landmarks/blueprints/cave.txt`.
  Reading `docs/` at build time breaks the server image (the Dockerfile copies only `crates/`).
- **Placement:** rotation from the front's dominant axis, the mirror from one draw of the zone's signature stream
  (after the reservation's draw), the grid's `E` on the site's inside camp tile. Walls written as wall, special
  floor as its terrain, plain floor and openings left unwritten. The anchor's footprint is the blueprint box.
- **Oracle shape:** on every seed of 1-32 the landmark's tiles equal the drawing under exactly one of the eight
  orientations; the anchor is the box inside the site's inner rect facing the coliseum; both mirror states and every
  front that occurs are seen; guards: option off byte-identical, the other landmarks' digests unchanged, every map
  certifies clean, attempts on seeds 1-32 at most 70 and worst index at most 7.
- **The territory relabel:** every tile of a site that has an inside camp gets that camp's territory label on
  repair's copy of the territory grid (`signature::relabel_sites`, called in `pipeline/mod.rs`). Without it the
  fixed cave cost 396 attempts on seeds 1-64 and lost 7 seeds (247 `Repair(RadiusPost)`: neighbours' territories cut
  by the walls); with it 132 attempts, worst index 9, none lost. `relabelled_zones()` lists only Frost: **SCALE-2
  adds Sentenced**.
- **A gate quirk:** `scripts/gate.sh --oracle` counts a merge commit inside the packet branch as an oracle commit.
  Do not merge the integration branch into a packet branch; branch the packet from the integration head instead.

## 3. Facts and decisions each packet needs

**Sites (P-MAPGEN-SIG-RESERVE-1, merged; ADR decision 12).** A 34-tile square per styled zone, inner rect 30. The
Sentenced and Frost inside camp is 9 tiles from the site's far edge (7 inside the inner rect) and one tile off the
centre line across (34 is even), so a mirror-symmetric drawing is at most 29 wide and is placed by the camp tile.
Plague's site is beyond the outer-third line on 20 of 64 seeds and the deepest free square on 44. Fire's site is on
the back edge on 64 of 64. No camp halo touches a site. Holy has no site yet.

**Church (SCALE-2).** Drawing: `docs/landmarks/blueprints/church.txt` (approved 2026-11-13 with the churchyard).
Building columns 3-25, rows 3-16; door row 16, columns 13-15; graveyard rows 17-27; fence on rows 0 and 28 and
columns 0 and 28 with the 5-wide main gate at columns 12-16 of row 28 and eleven 3-wide gates; door line to main
gate line 12 rows. Guards agreed between the two sessions, to hold on every seed: (i) the `Church` feature's box is
the building only; (ii) its door-side edge has exactly three open tiles in one run and no other gap; (iii) the plots
and the churchyard fence are `Graveyard` features (fence tiles LOW) and the union of the `Church` and `Graveyard`
boxes equals the anchor's 29 x 29 footprint; (iv) the anchor's entrance is the main gate's five tiles. The
certifier's `Graveyard` row and `SignatureContext::intact` accept only wall there today: both must accept LOW. The
lane-fence share test (`lane_fence_share_stays_near_option_off`, median at least 0.6; 0.71 with the cave merged)
may fall when the box and its apron take about 33 x 33 tiles from the lanes: that number is the owner's.

**Bog tree (SCALE-3).** Drawing: `bog.txt`: trunk 11 across, three root walls, marsh closed all round but for three
causeways. The tree's own bog is `BogTree` tiles; plain floor and causeways unwritten. No inside camp, so no
relabel: measure `Repair(RadiusPost)` with the fixed tree first. Your P-LAND-PLAGUE-1 re-measures at this packet.

**Volcano (SCALE-4).** Drawing: `volcano.txt`: a solid cone with a crater lake and three lava channels to three
2-wide outlets on the front row (columns 7-8, 14-15, 21-22); 160 lava tiles inside the box. Exactly three streams
(L4): the middle one about 14-18 path tiles, the sides about 10-14, each ending in a pool; a site that cannot hold
three discards the attempt. The lava budget (`Definition.lava_budget`, 80-150 today) must be re-measured: the box
alone holds 160. Owner rule for Fire: every Fire camp keeps its crater; craters keep clear of all three streams;
size falls with distance and none is dropped (`style_scorch/`).

**Holy hall (HOLY-1).** Drawing: `hall.txt`, 37 x 37: an open colonnade of 32 three-tile piers, a 7-wide nave, a
walled shrine at the back, two camps on the nave's centre line at rows 15 and 27 from the back (12 apart; each
halo exactly fills the nave's width). Owner decisions: 37 a side, two camps inside, legacy's elite rule kept (the
hall camps need not be elites). Measured (seeds 1-64, the brief's table): two camps at 37 costs about what today's
generator costs (103 attempts against 101); an empty Holy site or one camp costs far more. The probe used camp
positions scaled from a 39 draft: re-measure on the real grid. `Definition.site_side` is one global value and
`Reserve.camp` holds one pinned camp: both need widening for a 41-tile site with two camps. The hall moves out of
`style_sanctum` into the Landmarks phase; the styler then builds round it.

**Cost so far.** Seeds 1-32: 59 attempts, worst index 4, with the cave and the lanes merged (today's bounds: 70 and
7). Seeds 1-64: 132 attempts, worst 9, of which 26 are lake discards until the lake is built at the cave's mouth.
The owner's rule: guarantees are hard (an attempt that cannot deliver is refused, never served downgraded); numbers
are targets (a cost past the bounds goes back to the owner with the measurement).

## 4. What the Unity side depends on from you

- **Anchors must be exact:** `footprint` the blueprint box, `front` toward the coliseum, `entrance` the opening
  tiles named above, `centre` strictly inside the footprint (the wire decoder refuses otherwise).
- **Tiles must be the drawing:** the client derives each landmark's art from the delivered tiles inside the
  footprint (interior = floor enclosed by the landmark's walls), not from a copy of the grid, so it is right in all
  eight orientations. A drawing changed in the generator without the owner changes what the art covers.
- The art packets (P-UNITY-LANDMARK-1 to -5) are built against the approved drawings and do not wait for your
  generator packets; the screenshots of real maps do.

## 5. Not established

- Nothing about SCALE-2, -3, -4 or HOLY-1 has been prototyped on the merged tree: the cave's cost and the relabel
  are the only measurements with a fixed landmark.
- Whether three streams of the stated lengths fit the Fire site on every seed, and what the lava budget becomes.
- How the church's walls and fence interact with the relabel and the lanes on real maps.
