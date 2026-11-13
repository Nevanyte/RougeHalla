# Landmark generation: the coordinator's plan, for the land-generation task

Written 2026-11-12 by the coordinator session at `feature/unity-rework` `fdfa487e`, for a separate agent that will own
**land generation around the landmarks** (how each zone's ground, obstacles and decoration are arranged round its
landmark). This file says what exists, what the coordinator is still changing about the landmarks themselves, where
the line between the two tasks runs, and what must hold on both sides. It is a plan: section 2 is not merged yet.

Read first: [prompts/WORKER_RULES.md](prompts/WORKER_RULES.md) (branches, scope, gate, hand-off),
[ADR 0028](../adr/0028-signature-landmarks.md) (the rules G1-G8 and every landmark's exact shape; this file does not
repeat them), `crates/rh-sim/AGENTS.md`, and the top of [MIGRATION](../MIGRATION.md).

## Update 2026-11-12, midnight: requirements L1 to L6 are accepted

The owner confirmed to the coordinator the six landmark requirements in
[LAND_GENERATION_REQUIREMENTS.md](LAND_GENERATION_REQUIREMENTS.md). Where this file's section 2 says "the largest from
30 down to 28", read **one fixed blueprint per landmark** (L1); the church's graveyard is inside its site as part of
the blueprint (L2); the volcano always has three streams (L4); the Holy hall stays an open colonnade of one size (L6).
Section 6's third and fourth open points are closed (graveyard inside the site; every Fire camp keeps its crater).
The blueprints themselves are not drawn yet: the coordinator drafts them as tile grids for the owner first, so each
landmark's exact footprint is known only after that. Your requests in section 4 of your file are agreed: you own the
`style_gallows/`, `style_warren/` and `style_rime/` edits (the coordinator passes the failing test), `style_scorch/`
stays with SCALE-4, the yard box and the superseded packets are as you wrote them.

## 1. What is merged today

**Order (G1, owner rule):** zones and camps (the Prefix) → one landmark per zone (the Landmarks phase) → thematic
obstacles (the zone styler) → decoration (`rh-mapdress`). No step moves what an earlier step placed. Everything below
runs only with `pipeline::Options::signature` on (server: `--map-pool --signature-landmarks`); with it off every map
is byte-identical to legacy (G8) and nothing in this file applies.

| Zone | Landmark today (seeds 1-64) | Code | Styler reads the anchor? |
|---|---|---|---|
| Fire | Volcano: 5x5 cone, lava crater, 2-3 two-tile streams ending in pools, lava 80-150 tiles | `landmarks/signature/volcano.rs` | Yes: `style_scorch` drops the lava river and sizes craters by band |
| Sentenced | Church about 10x12 round the far elite camp, door to the front, four headstone blocks | `signature/church.rs` | No: `style_gallows` still aims fence rows and the gallows square at the zone centroid |
| Plague | Bog tree: 13-tile trunk, dry ring, two bog bands, footprint about 13x15 | `signature/bog_tree.rs` | No: `style_warren` lays bog crescents as legacy |
| Frost | Cave 9-15 a side round the far elite camp, 3-tile mouth, ice floor | `signature/cave.rs` | Yes: `style_rime` grows the first lake at the mouth |
| Holy | Temple hall, 38-39 a side, placed by `style_sanctum` in step 3 | `style_sanctum/` | It is the styler's own |

(all under `crates/rh-sim/src/mapgen/`.)

**What later steps are given** (the interface; use these, add no new styler input):
- `GameMapData.anchors`: one `ZoneAnchor { zone, kind, centre, footprint, front, entrance }` per zone, zone-code
  order (`mapdata/model.rs:246`). `front` is the DIR16 heading toward the coliseum. A styler finds its own anchor from
  the landmark feature in its zone (`style_scorch/mod.rs:373`, `style_rime/mod.rs:319` `signature_anchor`).
- `signature::band(anchor, x, y)` (`signature/mod.rs:186`): Chebyshev distance from the footprint; core ≤ 2, near
  ≤ 6, mid ≤ 14, far beyond (`Definition.bands`). The core band is the **apron**.
- Masks: the footprint is in `masks.boxes`, the apron in `masks.near1`; the stylers' `protect`/`no_block` already
  covers the apron's unowned tiles, and `feature_owner` refuses owned ones.
- Randomness: stylers draw from their own streams (`hash_seed` ids 0-2); the landmark step from id 5; the attempt's
  main stream is touched by neither.
- End-of-attempt discard (`SignatureContext::intact`, `signature/mod.rs:411`): a finished map is thrown away
  (`Refusal::SignatureDiscarded`) if any landmark tile changed, an entrance is blocked, a styler feature owns an apron
  tile, one landmark stands in another's apron, the Frost zone's largest lake is not within 10 walked steps of the
  cave mouth, or the strict certifier finds a failure.

**Decoration (step 4):** `rh_mapdress::dress(map, map_hash, rules) -> Dressing { props, ground_variants }`
(`crates/rh-mapdress/src/lib.rs:686`), rules in `crates/rh-mapdress/rules/zones.json`: per-zone `signature.landmark`
rings by band (ground variants 3-6), `terrainRings` (Plague water ring, reach 1, variant 7; mud ring, reach 3,
variant 8), clusters, edges, filler, keep-clear. Looks only: outside the state hash and the content hash. Not yet
shipped to clients (P-DRESS-BAKE-1, then P-UNITY-DRESS-1).

**Cost today** (option on, debug test build, macOS arm64): about 0.67 s per certified map including refused
attempts (option off 0.26-0.37 s). Seeds 1-64 use 104 attempts for 64 maps, worst attempt index 7 of a limit of 16;
of the 40 refused attempts 18 are `Repair(RadiusPost)`, 12 no landmark site, 10 end-of-attempt discards.

## 2. What the coordinator is still changing (the landmarks themselves)

Owner direction 2026-11-12: the volcano, church, bog tree and cave are to be "a lot larger, maybe just a little
smaller than the temple". Measured: that size does not fit among today's camps, so sites are reserved first.

| Order | Packet | Change | State |
|---|---|---|---|
| 1 | P-MAPGEN-SIG-RESERVE-1 | The Prefix reserves a **34-tile square site** per styled zone before camps are placed (landmark target 30 + apron 2 each side). Fire, Sentenced, Frost: on the back edge. Plague: beyond the outer-third line where a site fits (24 of 64 seeds), else the zone's deepest free square. No camp halo touches a site, except that the Sentenced and Frost first elite camp is placed inside its site, 9 tiles from the far edge, and is the zone's first elite (changes legacy's elite rule under the option: proposed DEV-028, unsigned). Landmarks are built inside their sites at today's sizes. | Implementer running (`agent/opus/P-MAPGEN-SIG-RESERVE-1`) |
| 2 | P-MAPGEN-SIG-SCALE-1 | Cave: the largest square chamber from **30 down to 28** a side that fits its site; the size rule goes into `signature/mod.rs`. | Oracle on `packet/P-MAPGEN-SIG-SCALE-1`; bounds re-measured after 1 |
| 3 | P-MAPGEN-SIG-SCALE-2 | Church 28-30 a side with pillar rows inside; graveyard of fenced plots mirrored about the door axis. | Brief |
| 4 | P-MAPGEN-SIG-SCALE-3 | Bog tree: trunk 9-11 across with root walls, bog rings to a 28-30 footprint, outer ring closed but for dry causeways. | Brief |
| 5 | P-MAPGEN-SIG-SCALE-4 | Volcano: a solid stepped cone 28-30 across round a crater lake of lava; streams leave from the rim; lava budget re-measured (estimate 155-185 against today's 80-150 ceiling). | Brief |
| 6 | P-MAPGEN-SIG-HOLY-1 | The Holy hall moves from the styler into the Landmarks phase with one standard interior (owner decision 2026-11-12); `style_sanctum` then builds round it. | Brief |

Write scope of 1-6: `mapgen/landmarks/signature/**`, `mapgen/attempt/`, `mapgen/zones/camps/`,
`mapgen/landmarks/stage/`, `mapgen/pipeline/mod.rs`, `mapgen/certify/mod.rs` (the elite rule), ADR 0028, and the tests
`crates/rh-sim/tests/mapgen_signature_{reserve,core,fire,fire_bands,frost,frost_lake,aprons}.rs`.

**What each merge does to your work:**
- **Every option-on map changes at each of the six merges** (camps move at 1; a footprint grows at 2-5; Holy moves at
  6). Anything pinned to an option-on map hash, attempt number or tile position before then is re-pinned.
- **The bands move outward.** `band` is measured from the footprint. A zone is about 4,900 tiles; from a 30-tile
  footprint the apron box is 34x34, near reaches 42x42 and mid 58x58 (up to 3,364 tiles before the zone edge clips
  it), against 9x9, 17x17 and 33x33 from today's 5x5 cone. After the SCALE packets most of a zone is core, near or
  mid and "far" nearly disappears. The band table `[2, 6, 14]` was chosen for small landmarks; whether it still gives
  four readable rings is the first thing to measure. It is one field (`Definition.bands`); propose numbers in a
  hand-off and the coordinator applies them.
- **Less free ground.** A site takes 1,156 tiles of the zone and the other nine camps are placed round it (mean
  nearest-camp distance drops 1-2 tiles). Obstacle counts that legacy sized for the whole zone (craters, guard houses,
  bog area, lakes, spires) need a rule for the smaller remainder.
- **The church and cave hold only their own elite camp**; other camps stay outside the site.

## 3. Where the line runs

| | Coordinator (landmark lane) | Land-generation task |
|---|---|---|
| Decides | Where each landmark stands, its size and shape, its anchor, the reservation, the camp and elite rules, the end-of-attempt discard | How the rest of the zone is arranged round the anchor: obstacle families and sizes by band, lakes, bog pools, fences, craters, clusters, edges, ground variants |
| Files | The write scope listed in section 2 | `mapgen/style_scorch/`, `style_gallows/`, `style_warren/`, `style_rime/`, `style_sanctum/` (signature-mode paths), `crates/rh-mapdress/**` and its `rules/zones.json`, new test files of its own |
| Shared, one writer at a time | `mapgen/style_runtime/`, `mapgen/style_zones/`, `mapgen/certify/`, ADR 0028, `docs/DEVIATIONS.md` | ask in a hand-off before editing |

The coordinator had three arrangement packets queued. **It will not start them; they belong to the land-generation
task**, which may take them as written, rewrite them or replace them:
- **P-MAPGEN-SIG-SENTENCED-1** (oracle on `packet/P-MAPGEN-SIG-SENTENCED-1`, `89a18a81`, written at today's church
  size): the graveyard's long side runs along the zone's fence-row axis; the gallows square is aimed at the church and
  stands in the mid band; guard houses stay in mid or far. Finding behind it: on 14 of 32 seeds the graveyard lies
  across the fence rows, and the gallows square is centred on the zone centroid, not the anchor.
- **P-MAPGEN-SIG-PLAGUE-1** (brief, `docs/backlog/packets/`; read its dated note, which narrows it): each bog pool's
  size comes from its band (largest near the tree), pools keep off spawn corridors with dry paths between, total bog
  stays in a measured window, and each pool leaves two tiles of free floor round it for the decoration rings.
- **P-MAPGEN-SIG-STYLE-1** (named in ADR 0028, never written): the stylers that do not yet read `band`.

Two overlaps to work round:
- SCALE-2, -3 and -4 may each make a small edit in one styler directory, only where the styler assumes the old
  landmark size (SCALE-4: the crater bands and the lava budget in `style_scorch/`). Each is merged alone and recorded
  in the MIGRATION checkpoint; rebase after it. To own those edits instead, say so in your first hand-off and the
  coordinator will pass you the failing test in place of making the edit.
- HOLY-1 touches `style_sanctum/` in signature mode. Leave Holy until it lands, or agree the hall's interior first.

## 4. What must hold (both lanes)

- **Option off is byte-identical**, draw for draw (the `option_off` / `g8` guards in the `mapgen_signature_*` tests).
  A styler's signature-mode path is a branch beside the legacy path, never a change to it.
- **Draws are behaviour.** Stylers keep to their own streams; adding, removing or reordering a draw on a legacy path
  changes parity. Iteration that decides anything is ordered. No wall clock, no hash-ordered collections
  (`clippy.toml` enforces it).
- **Keep-clear outranks theme (G5):** camps and their halos, spawns and their walks, routes, gate lanes, crate and
  ground spots stay free. A map that fails is discarded, never repaired by removing or shrinking the landmark.
- **Aprons:** no styler feature owns an apron tile, and no landmark tile changes after the Landmarks phase.
- **Every accepted map certifies with zero failures** under the strict certifier; 10 camps a zone, 2 elites a zone.
- **Attempts stay bounded.** The oracles hold the worst attempt index on seeds 1-32 to 7 or 8 and total attempts to
  70-80 (today 43, with reservation 54). A styler rule that discards more maps spends that budget.
- **No new terrain codes.** Owner ruling 2026-11-12: bog slows 30%, water and mud are looks only (decoration ground
  variants), so they never enter the sim.
- **Tunables are data:** a new number goes in the styler's `rules.rs` definition or `signature::Definition`, not a
  new `const` (`crates/rh-sim/tests/content.rs` rejects unregistered consts, including in test files: use functions).
- **Anchors stay on `GameMapData.anchors`**, never on `LayerData` (that would move every checkpoint and state hash).
- **Decoration kind codes and ground-variant ids become wire values** once P-DRESS-BAKE-1 lands (blocks 1-10 Fire …
  41-50 Holy, second blocks 51-100; variants 3-8 in use). Add within the blocks; renumbering needs the coordinator.

## 5. Where optimisation would pay (measured, not yet acted on)

- **End-of-attempt discards are the largest avoidable cost with reservation on:** 27 of 49 refused attempts on seeds
  1-64 are `SignatureDiscarded` (the lake-at-the-mouth rule and styler features in aprons). Both are styler outcomes
  judged after the whole map is built. A styler that meets them by construction saves the full attempt.
- `Repair(RadiusPost)` falls from 18 to 7 with reservation; failed Prefix rounds rise from 0 to 14 (a zone whose nine
  other camps do not fit round the site). The second is the coordinator's to look at.
- Known gaps in arrangement, recorded in ADR 0028 "Consequences": Fire's far craters are not thinned (density does
  not fall with distance); Frost's spires and headlands do not flank the approach to the mouth; repair's infill walls
  may stand in an apron outside the footprint.

## 6. Open with the owner in this area

- The elite-rule change under the option (DEV-028) and the other unsigned rows DEV-020 to DEV-027.
- Plague's site: outer third on 24 of 64 seeds, deepest free square on the rest; or a smaller tree.
- Whether the graveyard must fit inside the church's site (then the church is shorter than 30 along the door axis).
- Whether far Fire craters may be dropped on purpose (today a count floor of option-off minus two forbids it).
- The band table for 30-tile landmarks (section 2).

## 7. Measuring and looking

- `cargo test -p rh-sim --features trusted-status-probes --test mapgen_signature_core --test mapgen_signature_fire --test mapgen_signature_fire_bands --test mapgen_signature_frost --test mapgen_signature_frost_lake --test mapgen_signature_aprons`
- After RESERVE-1 merges: `--test mapgen_signature_reserve -- --ignored --nocapture report_seeds_1_to_64` prints
  attempts, refusals by reason, camp spacing and time per seed. Use the same columns to report your own changes.
- Decoration: `cargo test -p rh-mapdress`.
- Write oracles as properties or statistics over seeds 1-32 measured from the anchor (band of each obstacle, counts,
  areas, reachability), not as pinned maps: they then survive the six merges of section 2.
- `scripts/gate.sh --quick` while iterating; the coordinator runs the full gate at merge.

Not established by anything above: how the larger landmarks look in the Unity client (no landmark art is drawn yet),
bot pathing on option-on maps, and any seed beyond 64.
