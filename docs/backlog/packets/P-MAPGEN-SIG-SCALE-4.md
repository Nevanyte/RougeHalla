# P-MAPGEN-SIG-SCALE-4: the volcano is a lot larger, a stepped cone round a crater lake

- **Serves:** owner direction 2026-11-12 late (MIGRATION): the faction landmarks "a lot larger, maybe just a little
  smaller than the temple". Last of four (P-MAPGEN-SIG-SCALE-1 is the plan and the measurements).
- **Implementer tier:** implementer-opus (rh-sim mapgen: the Landmarks phase and the Fire styler)
- **Reviewer:** reviewer-opus
- **Integration base:** feature/unity-rework after P-MAPGEN-SIG-RESERVE-1 and P-MAPGEN-SIG-SCALE-3
- **D-rules touched:** D1: option off byte-identical (G8); no legacy counterpart (DEV-020) · D2 n/a · no sim tick or
  wire change
- **Status:** brief only; the oracle is written when SCALE-3 has landed (oracle-author, Opus).

## From P-MAPGEN-SIG-SCALE-1's oracle (2026-11-13)

- The drawing is read through SCALE-1's placement rule (`signature/mod.rs`). Its copy: `include_str!` of `docs/`
  breaks the server image (`hosting/Dockerfile` copies only `crates/`; `.dockerignore` excludes `docs`), so the crate
  carries `signature/volcano.txt`, byte-equal to `docs/landmarks/blueprints/volcano.txt`, in a `Definition` field; the
  oracle checks the equality. A volcano site has no inside camp: if the cone cuts neighbouring territories, measure
  `Repair(RadiusPost)` before assuming SCALE-1's relabel covers it.

## Amendment 2026-11-13 (owner decision "Yes, apply them": requirements L1 and L4; supersedes everything below where they differ)

Source: `docs/coordination/LAND_GENERATION_REQUIREMENTS.md` on the integration branch; MIGRATION, "Owner decision
2026-11-12 (chat, midnight)"; ADR 0028 rule G9.

- **The cone is one blueprint** (L1): a solid stepped cone with its crater lake, one size (the site's inner rect, 30 x
  30 target). "Target 30, floor 28" is withdrawn.
- **Exactly three streams on every map, never two** (L4). They leave the rim in a fan toward the coliseum: one down
  the middle, one each side. The middle stream is the longest, about 14-18 path tiles; the side streams about 10-14.
  Natural bends (the streams' paths are the random part); two lava tiles wide; each ends in a pool; no fords (lava is
  LOW: walkers go round the pool). A site that cannot hold three discards the attempt. In `Definition`: `streams`
  becomes exactly three, with one heading set and the two length ranges.
- **Lava budget:** re-measured by the oracle author for the crater lake plus three streams and three pools (the
  streams alone are 68-92 lava tiles at these lengths); today's 80-150 ceiling does not hold.
- `style_scorch/` stays in this packet's scope (agreed: the land-generation session rebases after it). Its own rule
  for Fire, decided by the owner: every Fire camp keeps its crater, craters keep clear of all three streams, size
  falls with distance and none is dropped.
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
Amended 2026-11-12 (coordinator decision): the cone is built in its site reserved by P-MAPGEN-SIG-RESERVE-1 (34
tiles on the back edge, no camp halo inside), **target 30, floor 28** a side for the cone's footprint (the site less its
apron); the streams and pools leave the site as today. The Fire volcano: a cone about 28-30 across, an impassable rock mass with stepped flanks and a crater lake of lava in
the middle (not enterable); its 2-3 streams leave from the rim and still end in pools; total lava inside a budget the
oracle author re-measures (the crater lake now holds part of it).

## 2. Dependencies
- P-MAPGEN-SIG-RESERVE-1 merged (among today's camps a solid back-edge square was 12-23 tiles; RESERVE-1 reserves a
  34-tile Fire site on the back edge on 64 of 64 seeds). The `camp_room` tiers (cone 6-12 tiles from every Fire camp)
  are re-measured: the site already keeps every halo out.
- P-MAPGEN-SIG-SCALE-3 merged.

## 3. Relevant paths
- `crates/rh-sim/src/mapgen/landmarks/signature/volcano.rs` (cone `cone_d2`, crater `crater_d2`, back-edge sites in
  `camp_room` tiers, streams, pools, the lava budget).
- `crates/rh-sim/src/mapgen/landmarks/signature/mod.rs:64-94` (volcano fields; `lava_budget` 80-150).
- `crates/rh-sim/src/mapgen/style_scorch/` (craters by the camp's band from the volcano's footprint, P-MAPGEN-SIG-FIRE-2).

## 5. Exclusive write scope
- `crates/rh-sim/src/mapgen/landmarks/signature/{volcano.rs,mod.rs}`
- `crates/rh-sim/src/mapgen/style_scorch/` (crater bands and the lava budget)
- `docs/adr/0028-signature-landmarks.md` (decisions 10 and 8)

## 7. Behaviour to preserve
- Option off byte-identical; every zone keeps its landmark; certifier clean; attempt bounds re-measured; Fire camps
  reachable from a spawn without crossing lava; streams two tiles wide; craters by band.

## 8. Acceptance checks (for the oracle author to make exact)
- Cone footprint sides between a floor and min(target, hall side - 2); solid (no floor inside but the crater lake,
  which is LOW lava, unreachable); streams start at the rim and end in pools; lava total within the re-measured
  budget (estimate: a crater lake of squared radius 20 is 69 tiles, streams at today's lengths 60-90, pools about 26:
  155-185 against today's 80-150 ceiling, so shorter streams or a new budget).
- Re-pinned in the oracle commit: `mapgen_signature_fire.rs` (`no_lava_river_and_lava_within_the_rivers_budget`,
  `volcano_has_two_or_three_streams_each_ending_in_a_pool`, `craters_are_arranged_by_band_round_the_volcano`) and
  `mapgen_signature_fire_bands.rs` (the near/far crater statistics, the crater count floor), each re-measured once.

## Oracle files (read-only for implementers)
- written on `packet/P-MAPGEN-SIG-SCALE-4` by the oracle author.

## 10. Risk and suggested model tier
Opus: a big cone moves every Fire band, the crater sizes and counts, and the lava budget; the territory rule of SCALE-1
applies to the cone.

## 11. Known traps
- The volcano is placed first; a change in its draws or footprint moves every later landmark's site (their aprons and
  floor), so seeds land on different attempts: re-measure the attempt bounds of SCALE-1's oracle.
- A crater (a camp's pen) cannot move; its band follows `dc - ceil(R / 4)` from the cone's footprint.
