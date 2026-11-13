# P-MAPGEN-SIG-SCALE-1: the Frost cave is a lot larger (the size rule for the enclosed landmarks), first of four

- **Serves:** owner direction 2026-11-12 late (MIGRATION): "All of the faction landmarks look good. I want most of
  them (except holy temple) to be a lot larger, maybe just a little smaller than the temple."
- **Implementer tier:** implementer-opus (rh-sim mapgen: the Landmarks phase)
- **Reviewer:** reviewer-opus
- **Integration base:** feature/unity-rework **after P-MAPGEN-SIG-RESERVE-1** (rebase this branch onto it first)
- **D-rules touched:** D1: option off byte-identical (G8); no legacy counterpart (DEV-020) · D2 n/a · no sim tick or
  wire change

## Amendment 2026-11-12 (coordinator decision; supersedes the rule and numbers below where they differ)

- **Depends on P-MAPGEN-SIG-RESERVE-1** (`packet/P-MAPGEN-SIG-RESERVE-1`): each landmark's 34-tile site is reserved in
  the Prefix before the camps; the cave's elite camp stands inside its site, 9 tiles from the far edge; no other camp's
  halo touches the site. The adaptive 20-28 cave below is **not** built as an interim.
- **Numbers (from RESERVE-1's measurements): target 30, floor 28** (each footprint side; the site less its apron).
  The cave takes the largest square chamber from 30 down to 28 that fits its site with today's rules (mouth, doorway,
  forecourt, wall lines off every halo, unsplit zone floor, wall pieces of at least 6). It never leans on the border
  (sites keep off it). A cave that cannot reach 28 refuses the attempt; RESERVE-1's sites make that rare.
- **The territory rule** (below, "The rule") is no longer assumed: RESERVE-1 brings `Repair(RadiusPost)` to 7 on seeds
  1-64 at today's sizes (today 18). Measure first with the full-size cave; add the rule only if `RadiusPost` returns
  (it then stays in `signature/mod.rs` for SCALE-2).
- **The oracle**, amended in the same commit: `floor_side()` 28, `target_side()` 30 (footprint, no border tolerance),
  the cave's camp is the elite at the Frost anchor's centre; `mean_side_min()`, `ice_share_min()`,
  `worst_attempt_allowed()` and `attempts_allowed()` are marked **RE-MEASURE AFTER RESERVE-1**: they keep provisional
  values (28.0, 45, 8, 80) and the next oracle amendment, on the real RESERVE-1 implementation, measures them before
  the implementer starts. The size and ice tests are red today (caves 9-15 a side, ice 10-40 %).
- The "Read this first", "Measurements" and "Three ways" sections below are the history that led to RESERVE-1.

The owner's request covers four landmarks. Measured (below), it is cut into ordered packets that share
`signature/mod.rs` serially: **SCALE-1 (this packet): the size rule and the territory rule in `mod.rs`, and the
cave**; SCALE-2 the church and graveyard; SCALE-3 the bog tree; SCALE-4 the volcano. The later briefs are
`P-MAPGEN-SIG-SCALE-2.md`, `-3.md`, `-4.md`.

**Read this first (the owner should decide).** "A little smaller than the temple" (28-32 tiles a side) cannot be met on
most seeds by any of the three ways the coordinator named. The binding constraint is not the far elite camp's
position but the zone's other camps: each zone holds 10 camps in about 4,900 tiles, Lloyd-spaced about 20 tiles apart,
and no landmark wall may stand on a camp's halo. With today's camps a 28-tile cave fits round the far elite camp on
10 of 64 seeds at attempt 0 (the church 6 of 64), a solid 20-tile volcano cone on the back edge on 9 of 64, a 20-tile
square of clear ground in the Plague outer third on 1 of 64. Moving only the far elite camp into a chosen site (way b)
does not change this (the site-first room is within 1-2 tiles of the room round the camp). What does: **reserving
each landmark's site before the camps are placed** (a Prefix change under the option; with no camps in the way a
28-tile square fits on 59-64 of 64 seeds in Fire, Sentenced and Frost, 32 of 64 in the Plague outer third), or **letting
the room enclose other camps** (as the Holy hall does: a 28-tile cave on 40 of 64 seeds at attempt 0, the church on
39). This packet does neither: it takes the largest size that fits between a floor of 20 and the target of 28 (way a)
plus a territory rule that keeps the extra attempts low, giving caves of 19-28 tiles a side, mean 23.4 on seeds 1-64
(today 11.4): about twice today's side, four times its area, still short of the hall. Its oracle is written so that a
later site-reservation packet only raises `mean_side_min()`. Recommendation in "Owner decisions" below.

## 1. ID and outcome
Today's footprints (seeds 1 to 3, the owner's previews): Holy hall 38-39 x 38-39; volcano cone 5x5 (plus streams and
pools); church about 10x12 with four small headstone blocks as its graveyard; bog tree a 13-tile trunk inside a
13x15 footprint of bog rings; cave 9-15 a side (seeds 1-64, mean smaller side 11.4). The owner approved the shapes
and wants the four non-Holy landmarks a lot larger: a little smaller than the hall.

When this packet lands, in signature mode the **cave** is an enclosed chamber whose outer size is the largest square
between `floor` 20 and `target` 28 tiles a side that fits its site (today's site rules, the territory rule below),
with one 3-tile mouth, the far elite camp inside, an ice floor over most of the interior that keeps every camp's
halo and the first rows inside the mouth dry, and the lake rule and apron rule of P-MAPGEN-SIG-FROST-2 unchanged.
The volcano, church and bog tree are unchanged here. The rule (both numbers, the shape search, the territory rule) is
written in `mod.rs` so SCALE-2 reuses it for the church.

## 2. Dependencies
- P-MAPGEN-SIG-FROST-2 merged (it is). P-MAPGEN-SIG-SENTENCED-1 (oracle written at today's sizes) and
  P-MAPGEN-SIG-PLAGUE-1 wait for SCALE-2 and SCALE-3 respectively and are re-measured after them.

## 3. Relevant legacy paths
- None: no legacy counterpart (DEV-020). The generator code this packet changes:
  `crates/rh-sim/src/mapgen/landmarks/signature/cave.rs:38-68` (`place`: far elite camp, mouth axes, forecourt then
  not), `:155-333` (`side`: wall lines `cave_side` 4-7 from the camp tile or leaning on the border, mouth, doorway,
  forecourt, ice = interior tiles with eight interior neighbours off every halo and the open corners, the
  redraw on a split zone floor or a wall piece under 6); `signature/mod.rs:95-104` (`Definition` cave fields),
  `:585-631` (`Site`: `floor`, `open`, `wall`, `ground`), `:697-713` (`mark_halo`).
- Camps and territories (read-only, for the territory rule): `crates/rh-sim/src/mapgen/zones/camps/mod.rs:263-467`
  (`place_camps`: 10 camps a zone, Lloyd poles, the two elites farthest from the centre), `:468-486`
  (`territory_reach2`); `crates/rh-sim/src/mapgen/repair/mod.rs:355-485` (a territory piece cut off from its camp is
  walled when small and far, else reassigned to the touching camp that fits within `territory_radius_max` 30),
  `:851-858` (`Refusal::RadiusPost` when any camp's territory reaches beyond 30 tiles).

## 4. New paths
- none (the oracle file below is new on the packet branch).

## 5. Exclusive write scope
- `crates/rh-sim/src/mapgen/landmarks/signature/mod.rs`
- `crates/rh-sim/src/mapgen/landmarks/signature/cave.rs`
- `docs/adr/0028-signature-landmarks.md` (decision 11 and the Measurements section)

No styler change is needed: the prototype passed every existing Frost, Fire, core and apron oracle with `style_rime`
untouched (the mouth's forecourt still holds the lake; the styler reads the mouth from the feature's box).

## 6. Contracts and references
- ADR 0028 rules G1-G8, decisions 1, 2, 6, 7, 11; C-PARITY (option off byte-identical, G8); `rh-sim` determinism
  rules (`clippy.toml`: no hash-ordered collections, no wall clock; the signature stream only).

## 7. Behaviour to preserve
- Option off: byte-identical (the `g8_option_off_maps_are_todays` tests in `mapgen_signature_fire.rs`,
  `mapgen_signature_frost.rs`, `mapgen_signature_core.rs`, and `option_off_maps_are_todays` in
  `mapgen_signature_frost_lake.rs`).
- Option on: every zone still gets its landmark on every certified map; the far elite camp is still inside the cave;
  every map certifies with zero failures (spawn-walk ratio and route checks included); the attempt limit (16) is not
  approached. Draws: the cave draws only from the Frost slot's signature stream `hash_seed(seed, attempt, slot, 5)`,
  and the other zones' landmarks draw exactly what they draw today (they are placed before the cave or in other
  streams).
- Every existing generator oracle keeps passing (the prototype passed them all, see "What breaks").

## 8. Acceptance checks
- `cargo test -p rh-sim --features trusted-status-probes --test mapgen_signature_scale` green (red today on the two
  tests named below), and every other `mapgen_signature_*` target green.
- `scripts/gate.sh --quick --oracle packet/P-MAPGEN-SIG-SCALE-1` passes (the coordinator runs the full gate).
- Report (the ignored `report_seeds_1_to_64` in the oracle file): cave size and ice per seed 1-64, attempts per seed,
  worst index, time for the run.

## Oracle files (read-only for implementers)
- `crates/rh-sim/tests/mapgen_signature_scale.rs` (new)
- `crates/rh-sim/tests/mapgen_signature_frost_lake.rs` (amended, see "Existing oracles changed")
- `docs/backlog/packets/P-MAPGEN-SIG-SCALE-1.md`, `-2.md`, `-3.md`, `-4.md`

## The rule (what to build)

**Size.** Two new `Definition` fields (no new `const`; `tests/content.rs` rejects unregistered consts):
`cave_size: (i32, i32) = (20, 28)` (floor, target), outer size counted wall line to wall line, a side leaning on the
map border counted to the border wall (so its footprint is one tile shorter: 19). `cave_side.0` (4) stays the least
distance from the camp tile to a wall line (the halo inside); `cave_side.1` (7) no longer caps the size.

**Search.** For each outer size S from the target down to the floor (square: depth S across the mouth's axis and width
S along it; the prototype tried rectangles with the short side first and gained nothing, 23.2 vs 23.2), then the mouth
axis nearest the camp (as today: shifts 0, -1, +1, ... up to `door_shift`), every placement of that S x S square that
holds the camp tile at least `cave_side.0` from each wall line is tested with today's rules: every non-border wall
tile `Site::wall`, every interior tile `Site::floor` and no other camp's tile, a side leaning on the border only when
its line is the border (`border_max` no longer limits the lean; a wall line must leave `border_gap` to the border or be
the border), the mouth nearer the coliseum than the camp with `doorway` free floor beyond, the forecourt first, then
without (today's order: forecourt pass over both axes, then the plain pass). The first (S, axis) with any legal
placement gives the list; one uniform draw (`pick`) among them, redrawn while the choice splits the zone's floor, leaves
a wall piece under `R.piece_min`, **or breaks the territory rule**; an exhausted list falls to the next (S, axis). No
legal placement at S = floor refuses the attempt (`Refusal::Signature`), as today. Use prefix sums or another O(1)
rectangle test: the naive ring walk over all sizes and placements is about 600 M tile reads an attempt.

**Territory rule (new, `mod.rs`, for SCALE-2 to reuse).** With the candidate's walls added, every piece of a camp's
territory (`frame.state.layout.territory_grid`, floor tiles, 4-connected, same owner) that is no longer connected to
its own camp's tile must touch (4-neighbour, same zone) a tile reached by another camp's own territory whose camp
tile is within `territory_radius_max` (the camps rule, 30 tiles, squared Euclidean on tile indices as
`repair` measures it) of every tile of the piece. Otherwise the candidate is redrawn. This mirrors repair's
reassignment (`repair/mod.rs:381-481`), so the cave never hands repair a piece it can only refuse with
`Repair(RadiusPost)`. Without it, a large cave costs 69 `RadiusPost` refusals on seeds 1-64 (today 18) and the worst
attempt index rises to 12 of 16; with it, none, and the worst index is 7 (today's). It reads only the prefix and the
stage, draws nothing.

**Ice floor.** The cave owns its walls and its ice: every interior tile with interior floor on all eight sides, off
every camp's certifier halo and the open map corners (as today), and not within 4 rows of the mouth's wall line (the
first rows a fighter walks in, wall-adjacent row included); at least `cave_ice_min`. A new `Definition` field for the
dry rows (the prototype used 3 beyond the wall-adjacent row). Measured share of the interior: 50-72 %, mean 64 %.

**Other camps.** Kept outside the cave, as today (no other camp tile inside; every wall off every halo). Allowing them
inside is an owner decision (below).

## Measurements (seeds 1-64, option on, attempt 0 unless stated; macOS arm64; throwaway probes, not committed)

### 1. Room

Zones: every zone holds 4,876-4,914 tiles; bounding boxes 66-158 tiles by 71-158 (the partition's shapes vary; a zone
is never narrower than about 66 tiles across its short side). The largest square (outer side, tiles) each landmark's
site admits, under four site definitions:

- **room**: today's site rule at today's camps. Church and cave: a square holding the far elite camp tile at least 4
  from each wall line, every tile zone floor (`Site::floor`: unowned, off the coliseum, road and lanes) or the map
  border, its non-border wall tiles off every camp halo, no other camp's halo inside, off the other zones' landmark
  aprons. Volcano: a square of `Site::ground` (off the legacy protection and aprons) at least 6 tiles (Chebyshev) from
  every Fire camp, its centre beyond the Fire centroid's distance + 2. Bog tree: a square of `Site::ground` whose
  centre is beyond the outer-third line + 2 (a solid square: the measure of a large trunk, the rings may skirt camps).
- **site-first (way b)**: church and cave: the square may sit anywhere with its centre beyond the zone centroid's
  distance (the back edge), no camp's halo inside except the far elite's (which would move into it).
- **enclose**: church and cave: as room, other camps' halos allowed inside (never on a wall).
- **reserved**: any square of zone floor (off the legacy buildings' aprons) on the back edge / outer third, ignoring
  camps: the room if the site were reserved before the camps were placed.

How many of 64 seeds admit each size:

| landmark | site | 32 | 30 | 28 | 26 | 24 | 20 |
|---|---|---|---|---|---|---|---|
| volcano (Fire) | room | 0 | 0 | 0 | 0 | 0 | 9 |
| volcano (Fire) | reserved | 54 | 57 | 59 | 63 | 64 | 64 |
| church (Sentenced) | room | 0 | 1 | 6 | 14 | 32 | 50 |
| church (Sentenced) | site-first | 0 | 1 | 3 | 17 | 33 | 60 |
| church (Sentenced) | enclose | 31 | 33 | 39 | 44 | 48 | 55 |
| church (Sentenced) | reserved | 52 | 60 | 62 | 64 | 64 | 64 |
| bog tree (Plague) | room | 0 | 0 | 0 | 0 | 0 | 1 |
| bog tree (Plague) | reserved | 19 | 28 | 32 | 41 | 54 | 64 |
| cave (Frost) | room | 0 | 4 | 10 | 21 | 27 | 49 |
| cave (Frost) | site-first | 0 | 4 | 9 | 19 | 35 | 58 |
| cave (Frost) | enclose | 30 | 36 | 40 | 47 | 47 | 53 |
| cave (Frost) | reserved | 58 | 61 | 64 | 64 | 64 | 64 |

Way (c) read off the room alone (attempts 0-15, the Landmarks phase only, before any later refusal): the first attempt
whose room fits a size. Cave: 28 fits at attempt 0 on 10 seeds, never within 16 attempts on 4, worst first index 15;
24: 27 at attempt 0, worst 5; 20: 49 at attempt 0, worst 2. Church: 28: 6 at attempt 0, never on 8, worst 15; 24: 32,
worst 10; 20: 50, worst 4. Volcano: 24 never on 59 of 64; 20 never on 8. Bog tree (solid square): 20 never on 39.

Per seed (attempt 0): zone box (zone tiles) / room / [enclose] / reserved; the Holy zone's box for reference.

| seed | Fire box (tiles) / room / reserved | Sentenced box (tiles) / room / enclose / reserved | Plague box (tiles) / room / reserved | Frost box (tiles) / room / enclose / reserved | Holy box (tiles) |
|---|---|---|---|---|---|
| 1 | 74x115 (4876) / 17 / 33 | 73x132 (4892) / 17 / 26 / 35 | 73x78 (4880) / 12 / 25 | 87x71 (4892) / 18 / 27 / 35 | 99x73 (4882) |
| 2 | 86x73 (4876) / 17 / 41 | 71x116 (4892) / 25 / 38 / 39 | 98x81 (4880) / 15 / 30 | 79x105 (4892) / 18 / 18 / 31 | 121x74 (4882) |
| 3 | 85x72 (4876) / 15 / 43 | 72x94 (4892) / 25 / 37 / 36 | 72x103 (4880) / 16 / 38 | 87x73 (4914) / 26 / 28 / 42 | 80x73 (4882) |
| 4 | 73x91 (4876) / 17 / 43 | 126x74 (4892) / 16 / 16 / 31 | 79x81 (4880) / 14 / 31 | 95x71 (4892) / 31 / 35 / 35 | 78x103 (4882) |
| 5 | 74x80 (4876) / 18 / 39 | 77x83 (4892) / 21 / 39 / 42 | 72x136 (4880) / 15 / 24 | 117x72 (4892) / 18 / 18 / 34 | 118x72 (4882) |
| 6 | 71x83 (4876) / 18 / 40 | 108x77 (4892) / 27 / 42 / 41 | 119x73 (4880) / 12 / 31 | 80x79 (4892) / 22 / 30 / 38 | 74x104 (4882) |
| 7 | 74x91 (4876) / 21 / 37 | 72x124 (4892) / 21 / 21 / 39 | 108x72 (4880) / 13 / 30 | 77x79 (4892) / 27 / 44 / 44 | 108x73 (4882) |
| 8 | 84x74 (4876) / 15 / 37 | 73x126 (4892) / 13 / 13 / 32 | 121x71 (4880) / 15 / 33 | 114x74 (4914) / 22 / 40 / 44 | 73x90 (4882) |
| 9 | 87x73 (4876) / 20 / 37 | 74x147 (4892) / 11 / 11 / 34 | 96x78 (4880) / 15 / 27 | 108x74 (4914) / 21 / 21 / 39 | 71x91 (4882) |
| 10 | 71x134 (4876) / 14 / 39 | 100x73 (4892) / 25 / 25 / 34 | 74x93 (4880) / 21 / 38 | 89x73 (4892) / 26 / 26 / 39 | 74x118 (4882) |
| 11 | 82x73 (4876) / 17 / 44 | 77x72 (4892) / 24 / 37 / 42 | 90x78 (4880) / 18 / 34 | 72x94 (4914) / 22 / 44 / 44 | 74x127 (4882) |
| 12 | 75x80 (4876) / 17 / 33 | 147x71 (4892) / 22 / 22 / 28 | 82x75 (4880) / 15 / 25 | 83x74 (4892) / 28 / 44 / 44 | 73x113 (4882) |
| 13 | 80x88 (4876) / 20 / 44 | 111x76 (4892) / 12 / 12 / 30 | 108x72 (4880) / 14 / 23 | 85x84 (4892) / 26 / 32 / 31 | 72x116 (4882) |
| 14 | 76x74 (4876) / 13 / 29 | 107x74 (4892) / 23 / 34 / 33 | 108x73 (4880) / 12 / 23 | 73x85 (4892) / 26 / 26 / 32 | 71x122 (4882) |
| 15 | 84x73 (4876) / 15 / 41 | 72x99 (4892) / 24 / 24 / 34 | 134x72 (4880) / 11 / 22 | 75x75 (4914) / 23 / 44 / 44 | 72x119 (4882) |
| 16 | 72x127 (4876) / 18 / 37 | 79x96 (4892) / 11 / 11 / 33 | 105x72 (4880) / 14 / 32 | 149x74 (4914) / 18 / 18 / 41 | 73x83 (4882) |
| 17 | 72x84 (4876) / 14 / 27 | 102x72 (4892) / 30 / 41 / 44 | 82x90 (4880) / 14 / 26 | 73x122 (4892) / 13 / 13 / 41 | 109x74 (4882) |
| 18 | 77x77 (4876) / 15 / 44 | 74x87 (4892) / 24 / 30 / 40 | 68x79 (4880) / 14 / 38 | 72x158 (4892) / 15 / 15 / 39 | 133x72 (4882) |
| 19 | 83x75 (4876) / 17 / 38 | 71x112 (4892) / 25 / 36 / 36 | 78x117 (4880) / 15 / 27 | 90x78 (4892) / 28 / 41 / 41 | 123x73 (4882) |
| 20 | 80x75 (4876) / 16 / 38 | 132x72 (4892) / 18 / 18 / 28 | 73x142 (4880) / 12 / 21 | 81x74 (4892) / 29 / 29 / 29 | 72x93 (4882) |
| 21 | 74x125 (4876) / 16 / 41 | 77x83 (4892) / 27 / 27 / 44 | 73x84 (4880) / 16 / 34 | 101x74 (4892) / 22 / 34 / 34 | 106x71 (4882) |
| 22 | 80x82 (4876) / 13 / 37 | 137x74 (4892) / 13 / 13 / 33 | 94x72 (4880) / 16 / 35 | 72x83 (4892) / 26 / 38 / 38 | 73x119 (4882) |
| 23 | 72x83 (4876) / 14 / 43 | 76x79 (4892) / 24 / 44 / 44 | 106x72 (4880) / 14 / 29 | 94x76 (4892) / 31 / 36 / 38 | 73x129 (4882) |
| 24 | 72x129 (4876) / 16 / 25 | 101x73 (4892) / 22 / 30 / 36 | 75x79 (4880) / 15 / 41 | 105x72 (4892) / 21 / 27 / 36 | 74x83 (4882) |
| 25 | 118x79 (4876) / 13 / 37 | 83x93 (4892) / 20 / 20 / 30 | 98x74 (4880) / 10 / 26 | 74x143 (4892) / 19 / 29 / 29 | 70x84 (4882) |
| 26 | 74x134 (4876) / 16 / 42 | 117x74 (4892) / 28 / 28 / 37 | 105x72 (4880) / 10 / 24 | 72x92 (4892) / 24 / 41 / 43 | 81x84 (4882) |
| 27 | 72x121 (4876) / 23 / 40 | 73x86 (4892) / 23 / 26 / 35 | 95x72 (4880) / 14 / 26 | 78x121 (4892) / 23 / 30 / 29 | 148x73 (4882) |
| 28 | 72x88 (4876) / 12 / 44 | 95x72 (4892) / 25 / 35 / 40 | 139x75 (4880) / 12 / 26 | 74x124 (4914) / 21 / 21 / 44 | 81x98 (4882) |
| 29 | 75x80 (4876) / 16 / 39 | 77x87 (4892) / 22 / 22 / 31 | 71x116 (4880) / 12 / 22 | 97x74 (4892) / 25 / 41 / 42 | 136x73 (4882) |
| 30 | 75x79 (4876) / 15 / 44 | 84x71 (4892) / 20 / 44 / 44 | 78x99 (4880) / 10 / 23 | 128x76 (4892) / 12 / 12 / 40 | 73x105 (4882) |
| 31 | 158x72 (4876) / 20 / 28 | 81x75 (4892) / 24 / 40 / 43 | 72x99 (4880) / 13 / 36 | 73x97 (4914) / 23 / 31 / 40 | 86x74 (4882) |
| 32 | 72x113 (4876) / 13 / 37 | 78x97 (4892) / 18 / 29 / 35 | 74x80 (4880) / 17 / 35 | 130x75 (4892) / 22 / 22 / 38 | 91x72 (4882) |
| 33 | 75x88 (4876) / 20 / 39 | 81x80 (4892) / 19 / 36 / 39 | 99x72 (4880) / 12 / 38 | 72x82 (4892) / 25 / 31 / 34 | 107x76 (4882) |
| 34 | 75x79 (4876) / 13 / 37 | 73x89 (4892) / 26 / 43 / 44 | 74x147 (4880) / 11 / 26 | 81x71 (4914) / 20 / 36 / 43 | 98x74 (4882) |
| 35 | 89x74 (4876) / 18 / 37 | 77x86 (4892) / 25 / 44 / 44 | 72x80 (4880) / 14 / 24 | 73x155 (4892) / 17 / 27 / 33 | 91x74 (4882) |
| 36 | 80x85 (4876) / 13 / 37 | 110x78 (4892) / 24 / 24 / 39 | 106x71 (4880) / 16 / 24 | 78x82 (4892) / 26 / 44 / 44 | 74x154 (4882) |
| 37 | 73x83 (4876) / 15 / 35 | 78x77 (4892) / 23 / 29 / 34 | 108x71 (4880) / 15 / 35 | 74x115 (4914) / 20 / 20 / 37 | 79x80 (4882) |
| 38 | 90x72 (4876) / 16 / 43 | 89x74 (4892) / 18 / 36 / 42 | 72x104 (4880) / 10 / 25 | 78x109 (4914) / 28 / 44 / 44 | 81x79 (4882) |
| 39 | 75x114 (4876) / 16 / 37 | 115x73 (4892) / 28 / 28 / 27 | 84x79 (4880) / 16 / 30 | 81x74 (4892) / 27 / 27 / 35 | 72x119 (4882) |
| 40 | 98x80 (4876) / 20 / 36 | 158x73 (4892) / 20 / 20 / 27 | 84x72 (4880) / 18 / 26 | 73x77 (4892) / 22 / 42 / 42 | 76x107 (4882) |
| 41 | 73x146 (4876) / 16 / 27 | 72x82 (4892) / 25 / 33 / 34 | 101x77 (4880) / 9 / 24 | 84x74 (4914) / 18 / 34 / 35 | 80x83 (4882) |
| 42 | 76x74 (4876) / 17 / 37 | 72x86 (4892) / 23 / 26 / 36 | 127x72 (4880) / 16 / 29 | 73x110 (4892) / 15 / 15 / 32 | 113x74 (4882) |
| 43 | 76x79 (4876) / 18 / 44 | 71x106 (4892) / 24 / 35 / 34 | 85x73 (4880) / 14 / 30 | 77x92 (4892) / 21 / 35 / 44 | 158x73 (4882) |
| 44 | 76x76 (4876) / 16 / 37 | 115x73 (4892) / 18 / 18 / 32 | 71x123 (4880) / 18 / 30 | 74x87 (4892) / 23 / 43 / 44 | 93x76 (4882) |
| 45 | 73x132 (4876) / 16 / 43 | 158x77 (4892) / 19 / 27 / 31 | 99x71 (4880) / 9 / 24 | 80x66 (4914) / 27 / 44 / 44 | 73x83 (4882) |
| 46 | 99x78 (4876) / 17 / 26 | 72x88 (4892) / 29 / 40 / 44 | 82x73 (4880) / 14 / 44 | 74x125 (4914) / 0 / 0 / 36 | 107x75 (4882) |
| 47 | 103x73 (4876) / 20 / 36 | 75x79 (4892) / 25 / 40 / 39 | 109x73 (4880) / 10 / 22 | 75x116 (4892) / 23 / 41 / 44 | 71x113 (4882) |
| 48 | 84x83 (4876) / 16 / 41 | 86x71 (4892) / 25 / 25 / 31 | 73x93 (4880) / 14 / 26 | 104x74 (4892) / 21 / 21 / 36 | 80x116 (4882) |
| 49 | 72x89 (4876) / 19 / 34 | 82x73 (4892) / 22 / 37 / 37 | 120x79 (4880) / 9 / 34 | 74x135 (4914) / 18 / 18 / 37 | 125x73 (4882) |
| 50 | 87x73 (4876) / 15 / 31 | 77x78 (4892) / 26 / 44 / 44 | 138x72 (4880) / 10 / 25 | 72x122 (4914) / 22 / 22 / 44 | 74x90 (4882) |
| 51 | 86x76 (4876) / 12 / 41 | 79x73 (4892) / 20 / 38 / 39 | 121x73 (4880) / 14 / 34 | 75x107 (4892) / 0 / 0 / 38 | 71x92 (4882) |
| 52 | 75x112 (4876) / 18 / 26 | 127x73 (4892) / 25 / 32 / 31 | 74x131 (4880) / 17 / 30 | 76x77 (4892) / 26 / 26 / 35 | 107x74 (4882) |
| 53 | 73x114 (4876) / 18 / 38 | 79x76 (4892) / 28 / 38 / 37 | 124x71 (4880) / 16 / 22 | 74x123 (4892) / 22 / 34 / 33 | 92x74 (4882) |
| 54 | 72x100 (4906) / 17 / 44 | 83x79 (4892) / 27 / 42 / 42 | 129x73 (4880) / 13 / 21 | 75x117 (4892) / 20 / 30 / 33 | 84x72 (4882) |
| 55 | 77x104 (4876) / 14 / 34 | 104x75 (4892) / 22 / 22 / 38 | 72x72 (4880) / 14 / 36 | 72x83 (4892) / 25 / 39 / 38 | 73x158 (4882) |
| 56 | 158x72 (4876) / 20 / 35 | 86x73 (4892) / 24 / 34 / 34 | 90x79 (4880) / 14 / 33 | 72x94 (4914) / 29 / 29 / 41 | 75x104 (4882) |
| 57 | 74x98 (4876) / 16 / 36 | 158x72 (4892) / 13 / 13 / 31 | 72x111 (4880) / 16 / 25 | 82x73 (4892) / 24 / 36 / 35 | 77x78 (4882) |
| 58 | 91x73 (4876) / 17 / 31 | 87x81 (4892) / 28 / 28 / 32 | 71x99 (4880) / 18 / 25 | 138x73 (4892) / 0 / 0 / 33 | 78x99 (4882) |
| 59 | 72x123 (4876) / 15 / 35 | 88x77 (4892) / 21 / 32 / 32 | 117x72 (4880) / 8 / 24 | 82x73 (4892) / 31 / 32 / 30 | 73x91 (4882) |
| 60 | 78x109 (4876) / 18 / 33 | 72x131 (4892) / 21 / 33 / 32 | 92x72 (4880) / 14 / 28 | 85x85 (4892) / 28 / 37 / 36 | 127x74 (4882) |
| 61 | 72x96 (4876) / 16 / 38 | 84x73 (4892) / 27 / 39 / 40 | 131x72 (4880) / 10 / 23 | 82x82 (4892) / 23 / 41 / 44 | 74x117 (4882) |
| 62 | 111x76 (4876) / 13 / 31 | 109x72 (4892) / 26 / 29 / 35 | 79x102 (4880) / 12 / 40 | 72x85 (4892) / 24 / 44 / 44 | 73x124 (4882) |
| 63 | 84x74 (4876) / 15 / 44 | 99x84 (4892) / 23 / 23 / 36 | 112x73 (4880) / 17 / 30 | 72x103 (4892) / 26 / 34 / 41 | 77x136 (4882) |
| 64 | 150x74 (4876) / 15 / 40 | 76x93 (4892) / 27 / 32 / 35 | 82x73 (4880) / 17 / 29 | 73x85 (4914) / 30 / 30 / 34 | 72x158 (4882) |

### 2. What breaks at size (the cave prototype, seeds 1-64, every attempt up to the one that lands)

The prototype (throwaway): today's `cave.rs` with the size search above, square chambers, no territory rule unless
stated. Today: 104 attempts for 64 seeds; refusals 18 `Repair(RadiusPost)`, 12 `Signature`, 10 `SignatureDiscarded`.

- **Camp territories (the real cost).** A 20-28 cave cuts the neighbouring camps' territories (the far elite's own
  territory outside the walls, others' that ran under the new chamber): `Repair(RadiusPost)` rises from 18 to 69 and the
  worst attempt index from 7 to 12. The territory rule removes them all (0 on seeds 1-64).
- **Spawn-walk ratio and route stretch.** No accepted map of any variant had a certifier failure (strict, every zone),
  and no attempt was discarded by the certifier: of the 24 `SignatureDiscarded` at 20-28, 12 were the lake rule, 11 a
  styler feature in an apron, 1 two landmarks' aprons overlapping. The cave sits on the back edge, behind the routes.
- **Apron conflicts between zones (FROST-2's rule).** 1 discard in 239 attempts (the cave against a neighbour's
  landmark); the symmetric end-of-attempt rule handles it as designed.
- **The lake rule with a 28-wide cave.** 12 discards (today a handful); every accepted map meets it (the forecourt rule
  still reserves a 9x9 square of Frost beyond the mouth). `the_mouth_opens_onto_the_largest_lake` (nearest lake tile in
  the near band) holds on every seed.
- **The lava budget with a crater lake** (volcano, SCALE-4; not prototyped): the budget is 80-150 lava tiles; a crater
  lake of squared radius 20 alone is 69 tiles, two streams at today's 15-22 path tiles about 60-90, two pools about 26:
  about 155-185, over the ceiling. SCALE-4 must re-measure the budget (or shorten the streams) with the cone.
- **The other landmarks' room** (table 1): a solid volcano cone or bog trunk anywhere near 28 does not fit among
  today's camps on any seed; see SCALE-3 and SCALE-4.

### 3. The three ways to make room (the cave, full pipeline, seeds 1-64)

| variant | seeds without a map (of 64) | attempts (1-64) | worst index (1-32 / 1-64) | mean smaller side (1-32 / 1-64) | sides >=27 / >=24 / >=20 (1-64) | RadiusPost / no-site / discarded refusals | s per seed (release probe) |
|---|---|---|---|---|---|---|---|
| today (no change) | 0 | 104 | 3 / 7 | 11.3 / 11.4 | 0 / 0 / 0 | 18 / 12 / 10 | 0.05 |
| (a) adaptive 20-28 | 0 | 239 | 11 / 12 | 23.1 / 23.2 | 11 / 30 / 59 | 69 / 82 / 24 | 0.11 |
| (a) adaptive 18-28 | 0 | 212 | 11 / 11 | 22.6 / 22.5 | 11 / 25 / 52 | 70 / 58 / 20 | 0.11 |
| (a) adaptive 20-28, rectangles | 0 | 223 | 12 / 12 | 23.3 / 23.2 | 11 / 30 / 59 | 65 / 70 / 24 | 0.11 |
| **(a) adaptive 20-28 + territory rule (chosen)** | 0 | 142 | 5 / 7 | 23.7 / 23.4 | 16 / 31 / 59 | 0 / 60 / 18 | 0.37 |
| (a) adaptive 18-28 + territory rule | 0 | 129 | 5 / 7 | 22.9 / 22.9 | 15 / 28 / 53 | 0 / 48 / 17 | 0.50 |
| (a)+(c) adaptive 24-28 | 3 | 392 | 12 / 14 | 25.3 / 25.0 | 17 / 48 / 61 | 81 / 229 / 21 | 0.14 |
| (a)+(c) 24-28 + territory rule (pieces over 120 only) | 2 | 354 | 13 / 13 | 25.5 / 25.0 | 19 / 47 / 62 | 63 / 209 / 20 | 1.27 |
| (c) fixed 28 (discard what cannot fit) | 39 | 784 | 13 / 15 | 27.0 / 27.0 | 25 / 25 / 25 | 52 / 698 / 9 | 0.20 |
| (c) fixed 28 + territory rule (pieces over 120 only) | 36 | 763 | 13 / 15 | 27.0 / 27.0 | 28 / 28 / 28 | 45 / 681 / 9 | 1.11 |
| (a) 20-28, other camps enclosed | 3 | 348 | 11 / 15 | 24.4 / 24.1 | 18 / 39 / 54 | 166 / 107 / 14 | 0.15 |
| (a) 20-28 + territory rule, other camps enclosed | 0 | 132 | 5 / 7 | 24.8 / 24.2 | 22 / 40 / 59 | 0 / 50 / 18 | 0.41 |

Sides are footprints: a side leaning on the border is one tile shorter than the chamber (hence 19 and 27 under a 20 or
28 rule). Times are the release-built probe's whole pipeline per seed with its refused attempts (the territory
rule's prototype re-reads an environment variable per candidate and floods the whole map: an implementation should
cost a fraction of that). Debug test build, today: this oracle and `mapgen_signature_frost_lake.rs` together run in about 70 s.

- **(a) adaptive** meets the floor everywhere and doubles the side; with the territory rule it costs 38 more attempts
  over 64 seeds than today (2.2 per seed against 1.6) and leaves the worst index at today's 7.
- **(b) site first, as named** (choose the site, then draw the far elite camp inside it) was not prototyped: its room
  (table 1, "site-first") is within 1-2 tiles of (a)'s, because the other nine camps, not the elite's position, bound
  the site. Where camps are placed: `attempt::assemble` (`attempt/mod.rs:132-199`, the Prefix) draws the pillar
  variant, the faction order, then per round `zones::partition_zones` and `zones::camps::place_camps`
  (`zones/camps/mod.rs:263-467`: per zone, `first_candidate` draws from the main stream, Lloyd steps, `PoleSearch`,
  the elites the two farthest from the centre) and builds `territory_grid`, `clearing` and `style_camps` from the
  camps. Moving the far elite camp after that (in the signature step, from the signature stream) draws nothing from
  the main stream, so with the option off nothing moves; but the territory grid, clearing and style camps are prefix
  products that would have to be rebuilt for the moved camp, the camp-gap and elite-separation rules re-checked, and
  the territory pieces it leaves re-homed: a change to `attempt/` and `zones/camps/` under the option, for 1-2 tiles.
  Not recommended.
- **(b+) reserve the site before the camps** (not named by the coordinator; measured as "reserved" in table 1):
  choose each landmark's square from the partition alone (deterministic, or from a new signature stream id, never the
  main stream), pass it to `place_camps` as tiles no camp site or halo may use (except the far elite, placed inside
  for the church and cave), and keep 10 camps a zone. Option off: the reserved mask is empty, `sites` filters nothing,
  and every draw is as today (the guard is `g8_option_off_maps_are_todays`). Room for 28 on 59-64 of 64 seeds
  (Plague's outer third 32 of 64). Cost: a Prefix change under the option (`attempt/`, `zones/camps/`), all option-on
  camps move (every option-on statistic is re-measured once), and the camps crowd into the rest of the zone. Not
  prototyped end to end.
- **(c) discard** at a fixed 28: 39 of 64 seeds find no map in 16 attempts. At 24-28: 2-3 seeds fail. Not viable.

**Choice: (a) with the territory rule, floor 20, target 28.** It is the only way that meets the floor on every seed
within today's worst attempt index and inside this packet's write scope. It does not meet "a little smaller than the
temple" (mean 23.4 against 28-32; the target is met on 16 of 64 seeds). Floor 18 instead of 20 saves 13 attempts and
loses 0.5 of mean side; 24 loses seeds. The oracle pins the floor, the ceiling (the target, and the hall's side minus
2), and the mean the measurement supports (22, measured 23.7 on seeds 1-32), not the target mean: raise
`mean_side_min()` to 26 in the packet that reserves sites, if the owner chooses it.

## Owner decisions (the coordinator should put these to the owner)

1. **Reach the target on most seeds?** Only by changing camp placement under the option (b+: reserve each landmark's
   site before the camps are placed) or by letting rooms hold other camps. Recommendation: (b+) as its own packet
   (`P-MAPGEN-SIG-SITE-1`, not written: not in the plan, needs approval) before SCALE-3 and SCALE-4, because the bog
   trunk and the volcano cone cannot grow at all without it (their solid room is 8-23 tiles at today's camps); SCALE-1
   and SCALE-2 do not wait for it.
2. **Other camps inside the cave or church?** The Holy hall already holds three camps among its pillars. With the
   territory rule it gives +0.8 mean side (24.2) at the same attempt cost; the cave stays "the elite camp's cave" only
   if the answer is no. This packet keeps them out (as today).

## The cut (ordered; each shares `signature/mod.rs` serially)

1. **SCALE-1 (this packet): the size rule, the territory rule (both in `mod.rs`) and the cave.** First, because the
   cave has the tightest site (round the camp, on the back edge, with the lake's forecourt) and the lake rule, and its
   rule is the one the church reuses. Write scope above.
2. **SCALE-2: the church and graveyard** (`church.rs`, `mod.rs`): the same search round the far elite Sentenced camp
   (28 wide by up to 32 long), pillar rows that do not cut the room in two, a graveyard of fenced plots beside it.
   Re-pins: `mapgen_signature_core.rs` graveyard and church shape tests; P-MAPGEN-SIG-SENTENCED-1's oracle.
3. **SCALE-3: the bog tree** (`bog_tree.rs`, `mod.rs`): trunk 9-11 with root walls, rings to 28-30 with a closed outer
   ring and dry causeways. Its solid room is 8-21 among today's camps: the trunk fits, the rings must skirt halos and
   camp clearings. Re-pins: `shape_bog_tree_*` in core, the bog-tree notes in `mapgen_signature_fire.rs`,
   P-MAPGEN-SIG-PLAGUE-1's oracle.
(Amended: every piece depends on P-MAPGEN-SIG-RESERVE-1 and builds at target 30, floor 28.)

4. **SCALE-4: the volcano** (`volcano.rs`, `mod.rs`, `style_scorch/` crater bands and the lava budget): last, because
   it moves every Fire band and the Fire statistics (`mapgen_signature_fire_bands.rs`, the lava budget in
   `mapgen_signature_fire.rs`) and every earlier piece shifts which attempts land, so the Fire statistics are
   re-measured once, at the end. Its solid room is at most 23 among today's camps (20 on 9 of 64): it needs the
   owner's decision 1.

This order re-pins least: the cave and church touch no pinned statistic but the attempt bound (amended here); the bog
tree its shape tests; the volcano the Fire statistics, once.

## Existing oracles changed (in the oracle commit; the implementer may not touch them)

`crates/rh-sim/tests/mapgen_signature_frost_lake.rs` (P-MAPGEN-SIG-FROST-2's oracle), by the coordinator's decision
(the guard has done its job now that FROST-2 has landed):
- removed `unchanged()` (the option-on (attempt, map hash) of 30 seeds) and `moved()` (seeds 17 and 18);
- removed `seeds_with_the_lake_at_the_mouth_keep_their_maps` (it pinned those 30 hashes: any landmark size change
  moves every option-on map);
- replaced `seeds_17_and_18_land_on_the_next_attempt_with_the_lake_at_the_mouth` (pinned attempt and hash) by
  `certified_styled_serves_the_first_attempt_that_meets_the_rule` (seeds 17 and 18: `certified_styled` gives the map of
  the first accepted attempt, and it meets the lake rule; no hash);
- `worst_attempt_allowed()` 3 + 2 = 5 re-measured to 5 + 3 = 8 (the prototype's worst on seeds 1-32 is 5, seeds 1
  and 23);
- kept unchanged: `the_largest_lake_is_at_the_mouth_on_every_seed` (the rule on every seed), `option_off_maps_are_todays`,
  `every_seed_still_places_all_four_landmarks`, `the_worst_attempt_stays_within_the_measured_margin` (its bound
  above), the ignored report.

No other existing oracle pins a cave size, count or statistic: under the prototype every test of
`mapgen_signature_{core,fire,fire_bands,frost,aprons}.rs` passed unchanged (release build, seeds as each file has
them). The Fire statistics move only with the volcano: left for SCALE-4.

## The oracle (`crates/rh-sim/tests/mapgen_signature_scale.rs`, seeds 1-32, first accepted attempt)

Red today (fail on assertions):
- `the_cave_is_a_lot_larger_but_smaller_than_the_hall`: footprint sides in [`floor_side() - 1` = 19, min(28, hall
  side - 2)], mean smaller side >= 22. Today: 9-15 a side.
- `the_cave_has_an_ice_floor_dry_at_the_camp_and_the_mouth`: cave ice >= 45 % of the interior; no ice in any camp's
  certifier halo; none within 3 rows of the mouth's edge. Today: 10-40 %, ice 2 rows inside the mouth.

Guards (pass today, must keep passing):
- `the_cave_is_enclosed_with_one_mouth_and_the_elite_camp_inside` (a straight 3-tile mouth on the edge opening onto
  floor outside; interior inside the footprint; the far elite camp's whole halo inside);
- `every_floor_tile_inside_the_cave_is_reached_from_the_mouth` (no sealed pocket);
- `a_three_wide_way_leads_from_the_mouth_to_the_camp` (fairness: a path whose every tile has its 3x3 square of floor);
- `every_zone_keeps_its_landmark_and_every_map_certifies_clean` (all four landmarks, the Holy anchor, zero strict
  certifier failures: spawn-walk ratio and routes included);
- `the_worst_attempt_stays_within_the_bound` (<= 8; prototype 5, today 3);
- `the_attempts_used_stay_within_the_bound` (<= 80 over seeds 1-32; prototype 66, today 43, the prototype without the
  territory rule 119).
- Elsewhere and unchanged: the lake rule (`mapgen_signature_frost_lake.rs`), the apron rule on every accepted attempt
  of seeds 1-40 (`mapgen_signature_aprons.rs`), option off byte-identical (four files).

Not proved by the oracle: that the cave takes the *largest* size that fits (only the floor, ceiling and mean); seeds
beyond 32 (the report covers 1-64); that a fighter can actually fight in the room (only the 3-wide way); the time per
map (no wall clock in rh-sim tests; time the report); the lake's size or shape; the other three landmarks.

## 9. Validation commands
- `cargo test -p rh-sim --features trusted-status-probes --test mapgen_signature_scale`
- `cargo test -p rh-sim --features trusted-status-probes --test mapgen_signature_frost_lake --test mapgen_signature_frost --test mapgen_signature_aprons --test mapgen_signature_core --test mapgen_signature_fire --test mapgen_signature_fire_bands`
- `cargo test -p rh-sim --features trusted-status-probes --test mapgen_signature_scale -- --ignored --nocapture report_seeds_1_to_64`
- `scripts/gate.sh --quick --oracle packet/P-MAPGEN-SIG-SCALE-1`

## 10. Risk and suggested model tier
Opus. The search must stay cheap (prefix sums; the territory flood only on the drawn candidate), deterministic (sorted
lists, the signature stream only) and leave option off byte-identical. The draw count changes with the candidate list,
so every option-on map moves (expected; the oracles hold properties, not hashes).

## 11. Known traps
- Camps are placed before the Landmarks phase: this packet moves no camp and changes nothing in the Prefix.
- Draw order is behaviour: the cave's stream is `hash_seed(seed, attempt, Frost slot, 5)`; the volcano, church and bog
  tree are placed before it and draw exactly what they draw today.
- A side leaning on the border has no wall: the footprint (the feature's box) is one tile shorter; the styler finds the
  mouth from the box's edge (`style_rime::signature_anchor`), so a mouth must never sit on a leaning side.
- The territory rule must read the prefix's `territory_grid` and the stage's tiles, not the finished map's.
- Anchors live on the generator's map and on `GameMapData.anchors`, never on `LayerData`.

## Notes from previous attempts
