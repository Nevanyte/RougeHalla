# P-MAPGEN-SIG-HOLY-1: Holy's temple hall is placed, and recorded as the zone's anchor, in the Landmarks phase

- **Serves:** owner direction 2026-11-12 (core rules G1 to G3: one landmark per zone placed before any obstacle; the
  landmark is the zone's anchor and steps 3 and 4 read it); owner decision 4 (2026-11-10: "Holy keeps its temple")
- **Implementer tier:** implementer-opus (rh-sim mapgen: a Landmarks-phase step, the Holy styler in signature mode)
- **Reviewer:** reviewer-opus
- **Integration base:** feature/unity-rework, after P-MAPGEN-SIG-SENTENCED-1 and P-MAPGEN-SIG-FROST-2 (shared
  `landmarks/signature/mod.rs`)
- **D-rules touched:** D1: option off byte-identical (G8) · D2 n/a · no sim tick, wire or content-hash change
- **Status:** brief only (split from P-MAPGEN-SIG-SENTENCED-1 by its oracle author, 2026-11-12). **Owner decision
  needed first** (see section 1): the Holy zone's option-on tiles cannot stay byte-identical if the anchor is to come
  from the Landmarks phase.

## Amendment 2026-11-13 (owner decisions; supersedes everything below where they differ)

- **Way A is chosen** (owner, 2026-11-12 evening: "please move it to landmark phase and standardize the interior").
  The "owner decision needed first" in the header is settled; way B is not built.
- **The hall is one blueprint** (owner decision "Yes, apply them", requirements L1 and L6 in
  `docs/coordination/LAND_GENERATION_REQUIREMENTS.md`; ADR 0028 rule G9): it **stays an open colonnade, walkable from
  every side** (piers, not a walled building with doors), one size, one symmetric interior: a lit central nave, the
  shrine at the back, the front toward the coliseum. Placed in one of eight orientations; nothing about it varies
  between maps but its place within its site rule, its rotation and its mirror.
- **It needs a site.** P-MAPGEN-SIG-RESERVE-1 reserves sites for Fire, Sentenced, Plague and Frost only ("Holy keeps
  today's hall rule until P-MAPGEN-SIG-HOLY-1"). This packet adds the Holy site to the Prefix by the same mechanism
  (the hall's side plus the apron each side; today's halls are 38-39 a side). So the write scope also takes
  `mapgen/attempt/mod.rs` and `mapgen/zones/camps/mod.rs`, after RESERVE-1 and the SCALE packets.
- **To measure before the oracle is written (the oracle author reports, the owner decides):** today's hall stands
  over Holy camps, its piers skipped where they would block one. A fixed blueprint cannot skip piers per map. Either
  the Holy site holds no camp (as the other four: a site of about 42 a side takes 1,764 of the zone's about 4,900
  tiles from the ten camps), or the blueprint has fixed camp spots inside the colonnade. Measure both on seeds 1-64
  with RESERVE-1's report columns (camp spacing, failed Prefix rounds, attempts).
- **Guarantees are hard, numbers are targets:** a site that cannot hold the hall discards the attempt; a size that
  breaks the attempt bounds goes back to the owner with the measurement.
- **The blueprint is drawn first** by the coordinator as a tile grid and approved by the owner before the oracle is
  written; the oracle pins equality with it under one of the eight orientations on seeds 1-32.
- `style_sanctum/` in signature mode builds round the placed hall and places none of its own; the land-generation
  task leaves Holy until this packet lands.

## Measurement 2026-11-13 (throwaway probe after P-MAPGEN-SIG-RESERVE-1; seeds 1-64, option on, release; 1-128 in brackets)

Baseline today: 101 attempts [225], worst attempt index 5; Holy camp nearest-neighbour mean 20.2, spread 31.7.
Today's hall: 38-39 a side on 60 of 64 maps; 1 to 4 Holy camps under it (mean 2.3); 32 piers planned, 4 to 14
skipped per map (24.3 built on average). The drafted fixed grid has 38 piers.

| Option | Site (hall) | Attempts | Worst index | Holy nearest-neighbour mean | Holy spread (min) | Notes |
|---|---|---|---|---|---|---|
| A: no camp inside | 43 (39) | 144 [294] | 8 | 16.2 | 33.8 (30.4) | breaks RESERVE-1's bounds on seeds 1-32 (76 attempts, worst 8, mean 16.4 under the 17.0 floor) |
| A | 41 (37) | 134 [270] | 6 | 17.0 | 34.1 (29.9) | |
| A | 39 (35) | 120 [249] | 5 | 17.2 | 33.5 (28.9) | |
| B: 1 camp on the nave axis | 43 (39) | 152 [308] | 7 | 18.1 | 33.6 (29.3) | `Repair(RadiusPost)` 37 (today 8): a pinned camp's territory stretches |
| B: 2 camps on the nave axis | 43 (39) | 123 [269] | 5 | 18.0 | 31.9 (27.8) | all 38 piers kept |
| B: 2 camps | 41 (37) | 103 [239] | 3 | 18.3 | 31.7 (25.1) | about today's cost; camp spots scaled (no 37 grid drawn) |
| B: 2 camps | 39 (35) | 105 [244] | 4 | 18.3 | 31.2 (26.8) | |
| B: 4 camps (2 x 2) | 43 (39) | 112 [227] | 5 | 16.7 | 28.7 (24.6) | does not fit the grid: 8 piers removed; crowds Holy |

Every run gave a map on all 64 seeds and certified with zero failures. The certifier's camp halo reaches 3 tiles (a
7x7 block without its corners), so only the 9-wide nave holds a camp: on the axis, rows 11-35 from the back, at most
three by the 9-tile camp gap. With legacy's elite rule kept, the hall camps are almost never the zone's elites (0 of
64 seeds at k = 1 and 2); making one the elite is a DEV-028-style rule change that moves no camp. Stamping the real
38 piers in the Landmarks phase cost about the same as open ground (126 attempts at k = 2) and every pier survived.
Run-to-run noise is about 10% of attempts at 64 seeds. Not measured: the shrine walls, the eight orientations, the
certifier with a hall camp as elite, decoration. Full report: the session scratchpad, `holy-site/REPORT.txt`; the
probe branch `probe/holy-site` is local and discarded.

**Probe's recommendation, for the owner:** two camps inside on the nave axis. At 37 a side it costs about what
today's generator costs; at the drafted 39 about 20% more attempts.

## 1. ID and outcome
Today Holy's anchor is written after records by `SignatureContext::finish` (`landmarks/signature/mod.rs:366`): the
largest Holy `Hall` feature (`:380-395`), which the Holy styler placed in step 3 (`style_sanctum/mod.rs:298-317`). Every
other zone's anchor comes from the Landmarks phase (`SignatureContext::apply`, `mod.rs:261`, called at
`pipeline/mod.rs:306-317`).

**Finding (oracle author of SENTENCED-1, 2026-11-12): the hall's position is not known in the Landmarks phase.** It
exists only after the Holy styler runs, because its inputs are produced after the Landmarks phase:
- the centre: `sanctum::scan_centre` (`style_sanctum/mod.rs:184-203`) scores windows with `c.open(i)`, which reads the
  styler's `no_block` (`style_runtime/mod.rs:562-569`); `no_block` is `protect` (`pipeline/mod.rs:358-363`,
  `spawns/mod.rs:120-134`), which includes the spawn pool's halo; the pool is drawn from the attempt's main stream in
  `spawns::prepare_and_pick` (`pipeline/mod.rs:343-352`), after the Landmarks phase;
- the footprint (the anchor's box): the piers kept after the route guard drops those on the worst spawn corridor
  (`style_sanctum/mod.rs:218-259`; members are the spawn pool), and after `place_feature` refuses blocked piers
  (`:321-331`);
- whether there is a hall at all: the styler returns no hall at `:204-206`, `:260-262` and `:318-320` (then `finish`
  writes no Holy anchor).

So "recorded in the Landmarks phase" requires **placing** the hall there (as the volcano, church, tree and cave are): a
Landmarks-phase step chooses the hall's centre, axis, radius and piers without the spawn halo and route guard (the step
then keeps the spawn pool off it through the apron, as the other landmarks do), writes it as a signature feature, and
the Holy styler, in signature mode, builds round the existing hall instead of placing one. The Holy zone's option-on
tiles then change on most seeds (a different centre, different piers). Two ways forward for the owner:
- **A (this brief):** move the hall into the Landmarks phase; the Holy option-on layout changes (option off untouched).
- **B:** keep the hall in step 3 and accept G3's reading "the anchor is on the finished map before step 4": nothing in
  step 3 reads Holy's anchor (no other styler arranges round it), and step 4 (`rh-mapdress`, P-DRESS-ANCHOR-1) reads the
  finished map's anchors, where Holy's already is. Then this packet is not needed; ADR 0028's note
  (`docs/adr/0028-signature-landmarks.md:145-147`) already records the gap.

When this lands (A), in signature mode the Holy hall is placed in the Landmarks phase and its anchor is in
`Placed::anchors` with the other four; `finish` only re-reads boxes after records and adds no anchor.

## 2. Dependencies
- P-MAPGEN-SIG-SENTENCED-1 and P-MAPGEN-SIG-FROST-2 merged (both edit `landmarks/signature/mod.rs`).
- The owner chooses A.

## 3. Relevant legacy paths
None (DEV-020). Option off is legacy: the Holy styler ports `packages/server/src/mapgen/zoneStyle/sanctum.ts` (pinned by
`style_sanctum/tests.rs`); the scan is the legacy recipe's (`landmarks/recipes/direct_family/sanctum.rs`).

## 4. New paths
- `crates/rh-sim/src/mapgen/landmarks/signature/hall.rs` (the Landmarks-phase hall), if the implementer keeps one file
  per landmark as the others.

## 5. Exclusive write scope
- `crates/rh-sim/src/mapgen/landmarks/signature/{mod.rs,hall.rs}`, `crates/rh-sim/src/mapgen/style_sanctum/**` (signature
  mode only), `docs/adr/0028-signature-landmarks.md`

## 6. Contracts and references
- G1-G8; the anchor record (`mapdata::ZoneAnchor`, generator map only, never `LayerData`); `signature::band`.
- The pattern: `style_scorch::signature_anchor` (`style_scorch/mod.rs:373`) and `style_rime::signature_anchor`
  (`style_rime/mod.rs:319`): the styler reads its zone's landmark feature from `zone_features()`.

## 7. Behaviour to preserve
- Option off: byte-identical (the G8 cases in every `mapgen_signature_*` target).
- Option on: every seed 1-32 has all five landmarks and anchors and certifies with zero failures; the other four zones'
  landmarks are unchanged where the attempt is unchanged.

## 8. Acceptance checks (for its oracle author to pin)
- After the Landmarks phase (the public `attempt`, `stage` and `SignatureContext` entry points, as FIRE-2's
  Landmarks-phase case uses them), seeds 1-32, attempt 0: `Placed::anchors` holds exactly one anchor per styled zone
  (Fire, Sentenced, Plague, Frost, Holy), Holy's of kind `Hall`.
- On the finished maps, Holy's anchor box equals its `Hall` feature's box and `finish` adds no anchor (the anchors from
  `apply` and on the map are the same zones in the same order).
- The hall keeps the legacy hall's shape rules (`sanctum::Definition`: radius range, at least `min_piers` piers) and the
  spawn pool keeps out of its apron.
- Report attempts per seed and the worst attempt index.

## 9. Validation commands
- `cargo test -p rh-sim --features trusted-status-probes --test mapgen_signature_core --test mapgen_signature_fire
  --test mapgen_signature_fire_bands --test mapgen_signature_frost --test mapgen_signature_sentenced`
- `cargo test -p rh-sim mapgen::style_sanctum`, `scripts/gate.sh --quick`

## 10. Risk and suggested model tier
Opus. Without the route guard the step must keep piers off the routes by its own rule, or more attempts are discarded;
the Holy layout changes for every option-on seed.

## 11. Known traps
- Do not place the hall from inside the Holy styler's stream: the Landmarks step draws from its own per-zone stream
  (`hash_seed(seed, attempt, zone slot, Definition::stream)`), never the attempt's main stream.
- `finish` still re-reads every anchor's box after records renumber features.
