# Hand-off: P-MAPGEN-SIG-SCALE-2 (2026-11-13, implementer-opus)

```
PACKET:          P-MAPGEN-SIG-SCALE-2 — serves owner direction 2026-11-12 late (landmarks "a lot larger") and owner decision 2026-11-13 (ADR 0028 G9; LAND_GENERATION_REQUIREMENTS L1, L2; church.txt approved with the churchyard)
BRANCH:          agent/opus/P-MAPGEN-SIG-SCALE-2 @ ee4458104 (re-pin commit; this hand-off is the one commit after it)
GATE:            FAIL (full, `scripts/gate.sh --base agent/fable/P-MAPGEN-SIG-SCALE-3-fix --oracle packet/P-MAPGEN-SIG-SCALE-2`, attempt 1/2) at "rh-sim suite", on the one known red test `mapgen_land_sentenced` `lane_fence_share_stays_near_option_off` (median 0.532 < 0.6; the owner's open decision, not this packet's). Passed before it: path and oracle checks, rustfmt, clippy workspace (all and default features), workspace tests except rh-sim (Postgres tests skipped: no DATABASE_URL), rh-sim content registry. The gate never reached: Postgres suites, parity report, JS vectors, reload-proof tests, C# net library tests and the sync check, Unity EditMode, Unity tool tests, headless smoke. Run by hand outside the gate, all exit 0: the parity report, the five JS vector checks, the headless smoke. Not run at all: reload-proof, C#, Unity (this packet changes no wire, C# or Unity file).
CHANGED:         crates/rh-sim/src/mapgen/landmarks/signature/church.rs (Blueprint, blueprint placement, unit test), crates/rh-sim/src/mapgen/landmarks/signature/cave.rs (grid reader and land rule made shared free functions; the cave's behaviour unchanged), crates/rh-sim/src/mapgen/landmarks/signature/mod.rs (church_grid = include_str!, the `church` context field, relabelled_zones, finish, intact, docs), crates/rh-sim/src/mapgen/certify/rules.rs (the Graveyard row only), docs/adr/0028-signature-landmarks.md (G9, decision 5, decision 12, header), crates/rh-mapdress/tests/anchor.rs and marsh.rs (re-pin commit, constants only: NO_ANCHOR_GOLDEN, SIG_GOLDEN; OFF_GOLDEN unchanged), this file
D-RULES:         D1: option off byte- and draw-identical (no site, so the rule-drawn church on a fresh stream, unchanged; `option_off_is_todays_generator` here and the other G8 guards green); no legacy counterpart (DEV-020). D2 n/a. No sim tick, wire, content-hash or state-hash change. One draw on the Sentenced stream (the mirror), as the brief says.
DEVIATIONS:      none (DEV-020 covers signature landmarks)
SHARED RECORDS:  proposed edits: docs/MIGRATION.md checkpoint: P-MAPGEN-SIG-SCALE-2 result and cost (50 / 3 on seeds 1-32, 104 / 3 on 1-64) and the open lane-fence floor; docs/backlog/packets/P-MAPGEN-SIG-SCALE-2.md status line (oracle file, not edited here)
LEGACY DOUBTS:   none (no legacy counterpart)
NOT ESTABLISHED: seeds beyond 64; the mirror (the drawing is symmetric, so it cannot be seen in the tiles); time per map; the Unity art's reading on the delivered maps (not re-probed here: the tiles equal the drawing on seeds 1-32, which the oracle proves, and the brief's probe of the same tiles found the 91-tile building group and the 3-tile door); Postgres suites (no DATABASE_URL); the gate steps after the rh-sim suite (see GATE).
RISKS:           the owner's open lane-fence floor (`lane_fence_share_stays_near_option_off`, 0.532 against 0.6) keeps the full gate red until ruled on; every option-on map moves (expected).
```

## What was built
- `church::Blueprint`: reads `Definition::church_grid` (now `include_str!("church.txt")`, byte-equal to the docs
  drawing): a square grid of `#PG+.DE*`, one `E`, the main gate the open run of the front row through `E`'s column
  (columns 12-16 of row 28). Parsed once per context into `SignatureContext::church`.
- `church::place` with a reserved camp calls `blueprint`: one mirror draw (`pick(rng, 2)`) on the Sentenced stream
  first, the front `axis(front(camp))`; `#`, `P`, `G`, `+` must be `Site::wall`, the rest `Site::floor`; the two tiles
  beyond each main-gate tile `Site::open`; walls (not the LOW fence) at least `R.piece_min` per 8-connected piece; the
  walls and fence must not split the zone's floor; else `None` (`Refusal::Signature`). Pieces: `Church` (`#`, `P`, wall,
  terrain 0, anchor point the camp tile) and one `Graveyard` (`G` wall terrain 0, `+` LOW `R.fence_kind`, anchor point
  the main gate's middle tile). Anchor: centre the camp, footprint the 29 x 29 box, entrance the main gate, front the
  DIR16 index. Without a reservation the rule-drawn church is unchanged (same code path, same draws).
- `finish` keeps the church anchor's footprint as placed (the other landmarks are still re-read from their features).
  For the rule-drawn church this is the same value as before (its footprint was its `Church` feature's box).
- `intact` and the certifier's `Graveyard` row accept LOW with the fence terrain; `relabelled_zones()` is
  `[Sentenced, Frost]`.
- Shared with the cave: `cave::grid` (the drawing reader: non-`;`, non-empty lines, square) and `cave::land` (the
  E-anchored orientation rule), now free functions that `cave::Blueprint` and `church::Blueprint` both use. Not shared:
  `bog_tree::Drawing` keeps its own reader and centre-anchored `land` (`bog_tree.rs` is outside this write scope); the
  follow-up packet that unifies the readers can move `grid` and `land` into `signature/mod.rs` and give the tree a
  centre-tile `e`.

## Results
- `mapgen_signature_church`: 14 of 14 green (the seven red ones and the seven guards); `report_seeds_1_to_64` below.
- `cargo test -p rh-sim --features trusted-status-probes --no-fail-fast` (78 targets): 1406 passed, 26 ignored, 1
  failed: `lane_fence_share_stays_near_option_off`, the only one, as expected. In it: every other `mapgen_signature_*`
  target (aprons 2, bog_tree 10, core 8, fire 11, fire_bands 5, frost 7, frost_lake 5, reserve 11, scale 11),
  `mapgen_style_refusal` 5, `mapgen_land_decor_attempts` 1, `mapgen_land_sentenced` 9 of 10, `content`, the lib's
  `mapgen::` tests (the new `church::tests::the_default_blueprint_parses_and_malformed_grids_do_not` and the
  unchanged `stray_camp_finds_a_second_camp_in_the_site` included).
- `cargo test --workspace --exclude rh-sim --no-fail-fast`: failures only in `rh-persist` (39 tests, every one
  "DATABASE_URL is not set") and the two `rh-mapdress` goldens before the re-pin; `rh-mapdress` is green after it
  (all 8 targets), and the gate's own workspace step (which sets RH_SKIP_PG_TESTS) passed. `rh-server`
  `map_anchor_seeds` 1 and `map_anchors` 5 green.

## The report (`report_seeds_1_to_64`, full output in `target/scale2_report.txt`, not committed)
- Attempts 50 on seeds 1-32 (bound 57), worst index 3 (seed 12; bound 5); 104 on seeds 1-64, worst 3 (seed 12). No
  seed without a map.
- Refusals on seeds 1-64: `SignatureDiscarded` 21, `Prefix` 8, `SpawnRatio` 7, `Repair(RadiusPost)` 4, `Signature` 0.
  `mapgen_style_refusal`: 18 refusals, 0 `StyleLandmark`, decor off and on.
- Box offset from the site's corner: (2, 3) front +x, (3, 3) front -x, (3, 2) front +y, (3, 3) front -y; all four fronts
  occur. Identical to the oracle author's prototype figures on the bog tree's base.
- Lane fence share (`mapgen_land_sentenced`): median on/off ratio 0.532 (per seed 0.35-0.72), against the floor 0.6.

## Goldens (re-pin commit, values from the failing assertions)
- `NO_ANCHOR_GOLDEN` was 0796bc2a20f74619, 5d1c4f2db7e9cc30, fac86967db0a4749, b58ed01bc8199d17; now
  c5cc6d901a2ec573, 845338a3e90b943a, 6639320364f4f23c, 17f7ac510c5fed7b.
- `SIG_GOLDEN` (seed by row; Fire, Sentenced, Frost, Holy) was 40fe7f46d14ae639 06836f1b33ea09a4 d1e43fa54369b2fa
  ca2c469dac4c833f / 4be4022169892c2a 0984dd44d9da2686 57904a658131762f 8efc14bcb4e2c163 / 0d25c89570865eeb
  bdec3327d5362a1d 83bbc9a78e4337b4 8ab128b83b58c4ae / 3a9ecf02aac579f7 dda4654465a22303 58834e22fcc87815
  16f5d83bd7ea0a2b; now f64dbe95a1f02c0b 1f5ef22494590d7b 11fa1d8d5766e023 4020837a181b7780 / c8273ead30efa335
  e409292349d69a78 da9f81f5eddf40c2 d5082729e638ef2c / 907f010fd06c1287 55f7da1d30f18669 da9d84df089936c8
  85746ab26f5c3409 / a7053dd5e17f360d b4d9c39d3ef25b8a 57001f4f646736a6 8fb4032e4e12f472.
- `OFF_GOLDEN` (both files) unchanged. The values were read with a temporary print (reverted before the commit); the
  first value of each list equals the failing assertion's `left`.

## Brief notes
- The brief's write scope puts `crates/rh-mapdress/**` with the coordinator at merge; the dispatch asked this branch to
  re-pin it in the last code commit, which it does (constants only).
- The brief matched the code. One reading choice: the brief does not name the `Graveyard` feature's anchor point; it is
  the main gate's middle tile (inside the feature's box; nothing reads it today).

## `git diff --stat packet/P-MAPGEN-SIG-SCALE-2` (at ee4458104, before this file)
```
 crates/rh-mapdress/tests/anchor.rs                 |   8 +-
 crates/rh-mapdress/tests/marsh.rs                  |  32 ++--
 crates/rh-sim/src/mapgen/certify/rules.rs          |   4 +-
 .../rh-sim/src/mapgen/landmarks/signature/cave.rs  |  46 +++--
 .../src/mapgen/landmarks/signature/church.rs       | 207 +++++++++++++++++++--
 .../rh-sim/src/mapgen/landmarks/signature/mod.rs   |  38 ++--
 docs/adr/0028-signature-landmarks.md               |  31 ++-
 7 files changed, 296 insertions(+), 70 deletions(-)
```
The rh-sim code is 252 insertions and 43 deletions (about 30 of the insertions are the parser unit test).

## Gate failure block (last lines of the red step)
```
seed 31: on 104/4004 off 312/4190 ratio 0.35
seed 32: on 171/4060 off 336/4269 ratio 0.54

failures:
    lane_fence_share_stays_near_option_off

test result: FAILED. 9 passed; 1 failed; 2 ignored; 0 measured; 0 filtered out; finished in 37.00s

error: test failed, to rerun pass `-p rh-sim --test mapgen_land_sentenced`

GATE FAIL: rh-sim suite (trusted-status-probes, as CI)
```
The assertion: `median on/off lane fence share ratio 0.532 is outside [0.6, 1.2]`. Logs:
`.agent-runs/gate/20261113T224833-agent-opus-P-MAPGEN-SIG-SCALE-2-quick.log` and
`.agent-runs/gate/20261113T230611-agent-opus-P-MAPGEN-SIG-SCALE-2-full.log`.

## Update by the land-generation session, 2026-11-14: the gate is now GREEN, with the owner's fence floors

**This supersedes the GATE line above.** The implementer's gate stopped at one test whose floor was the owner's open
decision. The owner has decided, the lanes oracle is amended (`packet/P-MAPGEN-SIG-SCALE-2-fix` @ `ae2dc4cdb`, brief
`docs/backlog/packets/P-MAPGEN-SIG-SCALE-2-fix.md`), and the whole stack was rebased onto `feature/unity-rework` @
`42ce9a72f`:

```
BRANCH:  agent/fable/P-MAPGEN-SIG-SCALE-2-fix (this hand-off update on top of ae2dc4cdb, the gated commit), 12
         commits on 42ce9a72f. Code commits after the rebase: 9df47c85d, cd9bfc2f3, b3a956776; rh-mapdress re-pin
         8da17b3d8 (the text above names it ee4458104, its sha before the rebase); hand-off c0ff93019.
GATE:    PASS (full, --oracle packet/P-MAPGEN-SIG-SCALE-2-fix) on ae2dc4cdb [skipped: Postgres suites, no DATABASE_URL]:
         263 test binaries ok, none failed; EditMode 1257 of 1257. Every step ran, including the ones the first gate
         never reached (C#, Unity, reload-proof, headless smoke).
```

**The owner's decision** (land-generation session's chat, 2026-11-13 night; quote it if you confirm it): to "Judge
the zone on lanes plus churchyard fence together, with a floor of 75% for the two combined and 45% for the lanes
alone" the owner answered **"Yes to both"** (the other question was the Plague amounts). Measured on the built church,
seeds 1-32: lanes alone 0.532 of option off's share (per seed 0.31 to 0.72; floor 0.45, per-seed floor 0.3 unchanged);
lanes plus the drawing's own 106 fence tiles 0.820 of option off's lane fence in tiles (per seed 0.60 to 1.05; floor
0.75, a new test). All 11 tests of `mapgen_land_sentenced.rs` pass.

**Review (reviewer-opus, by sha, code `f765a54ab..b3a956776`): LAND WITH NOTES, nothing blocking.** Verified by
reading: option off and draws cannot move; one mirror draw on the Sentenced zone's own stream copy; the writer, the
anchor and guards (i) to (iv) hold in every orientation; the relabel covers the whole site; `intact` and the
certifier's `Graveyard` row accept exactly wall or LOW fence; `cave::grid` and `cave::land` are the old method bodies
character for character; the amended older tests are honest (the door check is stricter than before); the lanes frame
a 7-wide corridor out of the 5-wide main gate.
- REAL 1 (cosmetic, visible): `crates/rh-mapdress/rules/zones.json` laid the Sentenced rings from the anchor
  footprint, now the whole churchyard: flagstone over the entire yard, grave and fence props outside the fence. Being
  fixed as its own packet, P-DRESS-SENTENCED-RINGS-1 (stacked on this branch; your art decision; arriving next).
- REAL 2: the anchor's `entrance` lists the five gate tiles in an order that depends on the mirror draw (the drawing
  is symmetric, so the tiles do not show it; the cave has the same). Deterministic; the oracle sorts before comparing
  and `map_hash` skips anchors. To be made canonical in the blueprint unification packet (architecture review,
  finding 2). If the wire or the Unity art reads `entrance[0]` as "left", say so and I do it sooner.

**Minor points, left on purpose (owner: no fix packets for small notes); fold in at merge if you like:**
`Blueprint::parse` treats any non-`+` character on the front row as gate (unreachable with the pinned drawing); the
`Graveyard` anchor point is documented as the main gate's middle tile and is `E`'s column on the front row (equal for
this drawing); stale comments at `crates/rh-sim/src/mapdata/model.rs:256` (the entrance "is the church door": now the
main gate) and `crates/rh-sim/src/mapgen/map_hash/tests.rs:400`; two unwrapped doc lines in `church.rs`.

**Proposed shared-record edits:** MIGRATION checkpoint (SCALE-2 result: 50 attempts and worst index 3 on seeds 1-32,
104 on 1-64; the fence floors); `docs/backlog/README.md` rows; no DEVIATIONS row (inside DEV-020; the lanes' row
DEV-032 could gain "with the blueprint church the lanes and the churchyard's own fence are judged together").
