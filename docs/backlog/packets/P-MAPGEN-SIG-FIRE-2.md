# P-MAPGEN-SIG-FIRE-2: Fire's craters are arranged by band from the volcano by construction; streams stay two tiles wide

- **Serves:** owner direction 2026-11-12 (core rule G4: distance bands from the landmark choose the obstacle family
  and size); reviewer-opus notes on P-MAPGEN-SIG-FIRE-1 (2026-11-12: one REAL, one MINOR)
- **Implementer tier:** implementer-opus (rh-sim mapgen: the Fire styler in signature mode)
- **Reviewer:** reviewer-opus
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1: option off byte-identical (G8) · D2 n/a · no sim tick, wire or content-hash change

## 1. ID and outcome
P-MAPGEN-SIG-FIRE-1 placed the volcano and removed the lava river in signature mode, but the Fire styler only shrinks
or drops a crater that would touch the volcano's core band (`style_scorch/craters.rs:148-178`). The band test passes
by measurement on the pinned seeds (near-band mean 132 tiles against 117 mid/far; seed 16 keeps 8 craters, exactly
the test's floor), not by design: any later change to masks or attempts can break it, and the zone does not yet read
as "arranged around the volcano". When this lands, in signature mode the styler chooses each crater's size from its
band: the largest of its radius options in the near band, middle in mid, smallest in far, and the far band's pens
are thinned by a fixed rule (never below the camp-count floor the certifier needs), so G4 and the crater-count floor
hold by construction. Also (MINOR, same files): a stream that bends across a diagonal keeps two tiles of width (the
side cell is recomputed from each path tile's heading, `landmarks/signature/volcano.rs:256`).

## 2. Dependencies
- P-MAPGEN-SIG-FIRE-1 merged. May run beside P-MAPGEN-SIG-FROST-1 (disjoint files: `style_scorch/`, `volcano.rs`).

## 5. Exclusive write scope
- `crates/rh-sim/src/mapgen/style_scorch/craters.rs`, `style_scorch/mod.rs`,
  `crates/rh-sim/src/mapgen/landmarks/signature/volcano.rs`; `docs/adr/0028-signature-landmarks.md`

## 7. Behaviour to preserve
- Option off: the crater path draws and decides exactly as today (pinned styler tests, the option-off identity case).
- Option on: every seed 1-16 still has its volcano, 2 or 3 streams ending in pools, lava within budget, the bog tree
  and the church; every map certifies with zero failures.

## 8. Acceptance checks
- Oracle, seeds 1-32 (a wider range than FIRE-1), the band rule below: every Fire crater's radius is its camp's
  band's option (near the largest, mid the second, far the smallest; core any option); on every map no near-band
  crater has a smaller radius than a far-band crater of the same option set; pooled, the near-band mean crater size
  exceeds the far-band mean by at least 15 percent; no crater tile in the core band; the crater count is at least the
  option-off count minus two on every seed (the distribution is printed and recorded below).
- Oracle: every stream's lava is at least two tiles wide along its whole path, bends included (the grid definition
  below), on the finished maps of seeds 1-32 and at the Landmarks phase over seeds 1-100, attempts 0 and 1.
- The FIRE-1 oracle (`mapgen_signature_fire.rs`) passes untouched.
- Report attempts per seed over seeds 1-32 and the worst attempt index.
- `scripts/gate.sh --quick --oracle packet/P-MAPGEN-SIG-FIRE-2` passes (the coordinator runs the full gate).

## Oracle files (read-only for implementers)
- `crates/rh-sim/tests/mapgen_signature_fire_bands.rs` (new target; 32 maps option on and 32 off generated once per
  binary; the definitions it measures are at the top of the file): `craters_take_their_bands_radius_option`,
  `near_band_craters_are_larger_than_far_band_ones`, `no_crater_in_the_core_and_the_crater_count_holds` (a guard:
  passes today, must keep passing), `streams_are_two_tiles_wide_on_the_maps`,
  `streams_are_two_tiles_wide_at_the_landmarks_phase`, and their helpers.
- This brief.
- No `stub:` commit: every fact the oracle needs is on the map or public. A crater's radius is already its feature's
  `p[1]` (`style_scorch/craters.rs:355`); its camp's options are recomputed from the public definitions
  (`search_family::scorch::default_definition`, `style_scorch::default_definition().crater.radius_shrink4`); the
  Landmarks-phase case uses the public `attempt`, `stage` and `SignatureContext` entry points (as FIRE-1's note-1 case
  does).

Against today's code (`cargo test -p rh-sim --test mapgen_signature_fire_bands`, 2026-11-12, macOS arm64, debug):
- `craters_take_their_bands_radius_option` fails: `181 craters off their band's radius option`, first
  `seed 1 camp (10, 10) dc 32 Far options [30, 26, 22] target Some(22) used 30` (every seed has some: legacy's
  freer-share choice picks 26 for most far camps, 135 of 204 far craters; 19 of 41 near craters use 22).
- `near_band_craters_are_larger_than_far_band_ones` fails: `74 near/far pairs out of order`, first
  `seed 3: near camp (86, 39) radius 22 < far camp (73, 56) radius 26 (options [26, 22])`; the means are near 117.8
  tiles (59 craters) against far 117.9 (204): ratio 1.00, the floor is 1.15.
- `streams_are_two_tiles_wide_on_the_maps` fails: `seed 15 stream 0: thin at [(122, 130)]` (a one-tile spike where
  the stream turns off the cone: column (122, 130..132) is lava, its row neighbours are not).
- `streams_are_two_tiles_wide_at_the_landmarks_phase` fails: `15 thin streams` over 173 volcanoes and 359 streams;
  the bends that thin to one tile for several tiles are seed 47 attempt 1 (5 tiles from (72, 135)), seed 69 attempt
  1 (4 tiles from (106, 47)) and seed 87 attempt 0 (6 tiles from (128, 82)); single-tile necks or spikes on seeds
  13/0, 15/0, 31/1, 35/1, 42/1, 70/0, 72/1, 81/0, 82/0 (two streams), 94/0, 97/1.
- `no_crater_in_the_core_and_the_crater_count_holds` passes (a guard, not a defect pin): seed 16 sits exactly on the
  floor today (8 craters against 10).

## The band rule (oracle author's decision, 2026-11-12)

**A crater's band belongs to its camp, fixed before any pen is drawn.** A pen is centred on its camp and cannot move,
and the FIRE-1 reading ("the nearest band of any of its tiles") makes the band depend on the size being chosen: the
same camp is "near" with a 26 pen and "mid" with a 22 one, so no rule stated on it is by construction. The oracle
instead reads, for each Fire camp (definitions at the top of the test file):
- options: R, R-4, R-8 (`CraterRules::radius_shrink4`) that are >= `radius_min4`, largest first, where R is
  `scorch::radius4` over the zone's camps: exactly the list `place_craters` builds (`craters.rs:111-117`);
- dc: Chebyshev distance from the camp tile to the Fire anchor's footprint (the metric of `signature::band`);
- band: the band of dc - ceil(R / 4), the distance the camp's largest pen nominally reaches toward the volcano
  (core <= 2, near <= 6, mid <= 14, far beyond, `signature::DEFAULT_DEFINITION.bands`).

**Rule.** A camp's crater, when it has one, uses its band's option: near the largest, mid the second (the smallest
when the camp has a single option), far the smallest. A core-band camp (its largest pen would reach the core) may use
any option: the largest that keeps every tile out of the core. A camp may have no crater when the route-stretch or
rim checks refuse its band's option (legacy drops pens the same way, 9 craters on seeds 6, 10, 21, 27 option off);
the count floor (option-off count minus two) bounds how many. Every quantity is computable from the finished map, so
the rule is checked crater by crater on every seed, not as a statistic.

Why this is honest for pens that cannot move: the levers are only size and presence, and both are now a function of
the camp's place relative to the volcano. G4's "size falls with distance" holds per crater (far pens are the
smallest option, near pens the largest); the pooled mean check (near at least 1.15 x far in tiles) and the per-map
pair check (no near crater smaller in radius than a far one of the same option set) restate it in the units a player
sees. "Density falls with distance" is **not pinned**: with 10 camps per zone and a floor of off - 2, a thinning rule
would have to drop far pens on purpose and would put several seeds exactly on the floor (seed 16 is already there
today). The brief's "far-band pens thinned by a fixed rule" is left to the owner (see Doubts).

Not used: a fallback from the band's option to a smaller one for near, mid or far camps. A sketch that tries only
the band's option and drops the pen when the checks or the core refuse it (core camps: largest option only) kept
every seed within the floor (on - off between -1 and +1 on seeds 1-32, never -2), with near-band craters 140 tiles
and far 90 on average, and passed every FIRE-1 case; it was discarded (the oracle author writes no implementation).

**Stream width on the grid.** Over a stream's own lava tiles: (a) no tile is a neck, i.e. no tile whose run of stream
lava along one axis is 1 while its run along the other axis is 3 or more (a one-tile line, straight or with jogs);
(b) every tile lies in a 2x2 window holding at least 3 stream lava tiles (no single-tile diagonal chain). Both hold
for a straight stream two tiles across, for a 45-degree staircase of pairs (today's diagonal streams, seeds 18 and
25) and for both ends of a stream. Only the stream's own lava counts, so two streams touching at the cone (allowed
inside `start_d2`) or a stream ending against its pool do not mask or create a neck. A sketch that recomputes the side
cell from each path tile's heading still left necks at the heading changes and at the cone (seeds 5, 13, 27, 47, 87
of the Landmarks-phase sweep); adding a closing pass (fill the missing perpendicular neighbour of any neck when
`lava_ok`) cleared all 368 streams of seeds 1-100. Per-heading sides alone are therefore not enough.

## Measurements (oracle author, 2026-11-12; today's code, `decor: false`, seeds 1-32, debug build, macOS arm64)
- Option sets on seeds 1-32: [26, 22] (non-elite), [30, 26, 22] (elite); rarely [25, 21] (2 camps) and [21] (1).
  Every option-on crater's radius is one of its options (the FIRE-1 quarter-tile shrink never fired).
- Camps and craters by camp band (core, near, mid, far): camps 21, 43, 50, 206; craters 18, 41, 47, 204; mean tiles
  106.0, 123.0, 117.3, 117.9. Radius used against the band's option: near 22 at target, 19 below; mid 20 at, 25
  above, 2 below; far 69 at, 135 above. By the FIRE-1 reading (nearest tile): near 47 craters, mean 120.5; mid 47,
  120.8; far 216, 116.5 (near over far +3 percent).
- Radius used per band and option set (count): core [26,22] 22: 7, 26: 5; core [30,26,22] 22: 4, 30: 2; near
  [26,22] 22: 14, 26: 10; near [30,26,22] 22: 3, 26: 2, 30: 12; mid [26,22] 22: 18, 26: 16; mid [30,26,22] 22: 2, 26:
  2, 30: 9; far [26,22] 22: 58, 26: 118; far [30,26,22] 22: 8, 26: 7, 30: 10; far [25,21] 21: 2; far [21] 21: 1.
- Craters on / off per seed (every seed has 10 Fire camps): 1 10/10, 2 10/10, 3 10/10, 4 10/10, 5 10/10, 6 10/9,
  7 9/10, 8 10/10, 9 10/10, 10 9/9, 11 10/10, 12 10/10, 13 10/10, 14 10/10, 15 9/10, 16 8/10, 17 10/10, 18 9/10,
  19 10/10, 20 10/10, 21 9/9, 22 9/10, 23 10/10, 24 9/10, 25 10/10, 26 10/10, 27 9/9, 28 10/10, 29 10/10, 30 10/10,
  31 10/10, 32 10/10 (on - off: +1 once, 0 on 25 seeds, -1 on 5, -2 on seed 16).
- Streams, finished maps 1-32: 2 or 3 per map; every stream two tiles wide by the definition above except seed 15
  stream 0 (one spike tile). By the narrower reading "row run and column run both >= 2 at every tile", most streams
  measure 1 at their two ends (a staircase's first and last tile), which is why the oracle uses the neck and window
  rules instead.
- Streams, Landmarks phase, seeds 1-100 attempts 0-1: 173 volcanoes, 359 streams, 15 thin (listed above).
- Time: 32 option-on plus 32 option-off maps and the Landmarks sweep run in about 30 s in a debug test build.

## 10. Risk and suggested model tier
Opus. The crater shrink loop re-runs the route-stretch check at each size: choosing the size from the band first
should make it cheaper, not dearer.

## 11. Known traps
- Craters are pens centred on camps: they cannot move. Size and presence are the only levers.
- A larger near-band pen takes floor from streams' aprons: the pen still claims no floor near a stream or pool.
- The band is the camp's (dc - ceil(R / 4)), not the pen's: compute it before drawing, from R = `radius4` (the first
  candidate, before legacy's freer-share choice), not from the radius the freer-share loop picked.
- Option off, `place_craters` must run its freer-share choice and draws exactly as today (G8; `g8_option_off_maps_are_todays`).
- Stream width: fixing only `side` per heading leaves necks where the heading changes; widen at the turn as well.
  Extra lava moves the zone's lava total (FIRE-1 budget 70-160) and the stream's ember edge; keep both in range.

## Doubts and misfits (oracle author)
- Density: the brief's "far band's pens are thinned by a fixed rule" is not pinned (see the band rule). A thinning
  rule that is checkable per seed would have to drop pens on purpose against a floor of off - 2 with 10 camps; the
  owner should say whether density should fall by dropping far pens (and lower the floor) or stay as is.
- Band reading: the FIRE-1 case `craters_are_arranged_by_band_round_the_volcano` keeps the nearest-tile reading; the
  new cases use the camp reading. Both must pass; a sketch of the new rule passed both on seeds 1-16.
- `ceil(R / 4)` is a nominal reach: the rim is jittered by up to `jitter_strength` (1.1 tiles) and rounded
  (`style_scorch/raster.rs:91-150`), so a near camp's largest pen may still touch the core; such a camp loses its
  pen under the rule (the sketch lost 1 of 43 near and 5 of 21 core camps' pens on seeds 1-32).
- Legacy (option off) is untouched; no `packages/` code is involved (DEV-020: no legacy counterpart).

## Notes from previous attempts
