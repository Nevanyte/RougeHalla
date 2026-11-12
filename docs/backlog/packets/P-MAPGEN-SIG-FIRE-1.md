# P-MAPGEN-SIG-FIRE-1: the Fire volcano in the generator, with lava streams ending in pools and the zone's obstacles arranged around it

- **Serves:** owner direction 2026-11-12 (generation order and core rules G1-G8, in
  `docs/backlog/packets/P-MAPGEN-SIGNATURE-CORE-1.md`); owner decision 4 (MIGRATION, 2026-11-10: "Fire get a volcano
  with generated streams of lava coming from it oozing out across the fire region"; answer: "Streams end in lava pools")
- **Implementer tier:** implementer-opus (rh-sim mapgen: the Landmarks phase and the Fire styler; rh-server post-pass)
- **Reviewer:** reviewer-opus
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1: option off byte-identical (G8); no legacy counterpart for the volcano (DEV-020) · D2 n/a ·
  no sim tick, wire or content-hash change

## 1. ID and outcome
P-MAPGEN-SIGNATURE-CORE-1 gave the generator a signature step in its Landmarks phase and placed the Plague bog tree
and the Sentenced church there. Fire's volcano is still added after generation by `crates/rh-server/src/signature.rs`
(mostly one short stream, usually in front of the zone's centre, on 13 of 16 maps). When this lands, with the
signature option on:
- **Landmark (G2):** the generator places a volcano on the Fire zone's back edge (its centre farther from the map
  centre than the zone's centroid): a cone of wall with a crater, and **two or three lava streams** that run from it
  toward the front (the coliseum), each **ending in a lava pool**, edged with ember. A site that cannot fit two
  streams is not used. It is placed before spawns and stylers, in the masks the core step uses, from its own stream.
- **Obstacles around it (G3, G4):** in signature mode the Fire styler (`style_scorch`) no longer places its lava
  river (the streams replace it: total lava stays within the legacy river's budget of about 70 to 160 tiles) and
  arranges its craters by band from the volcano: none in the core, the larger ones in the near band, smaller and
  sparser in mid and far. Every route through the zone keeps a ford (G5).
- **Anchor:** Fire's `ZoneAnchor` (centre, footprint, front) is on the finished map.
- **rh-server:** the post-pass no longer places a volcano.
Two reviewer notes on the core packet are closed here (same files, same tier): the bog tree's site test also keeps
out of other landmarks' aprons (`near1 == 0` for tree tiles, `landmarks/signature/mod.rs` `Site::ground`), and the
end-of-attempt discard gets its own appended `Refusal` variant (or `Refusal::Signature`'s doc names both causes).

## 2. Dependencies
- P-MAPGEN-SIGNATURE-CORE-1 merged (the step, masks, anchors, band helper). Strictly serial with P-MAPGEN-SIG-FROST-1
  and P-MAPGEN-SIG-STYLE-1 (`landmarks/signature/mod.rs`, `pipeline/mod.rs`).

## 3. Relevant legacy paths
- none for the volcano. The Fire styler as ported: `crates/rh-sim/src/mapgen/style_scorch/` (`mod.rs:152-189`,
  `craters.rs`, `river.rs`), `docs/ZONE_SHAPES_AS_BUILT.md` (Fire). The post-pass's shape to port:
  `crates/rh-server/src/signature.rs` (`volcano`). The shape checks already written for it:
  `git show packet/P-SIGNATURE-2:crates/rh-server/src/signature/tests.rs`
  (`volcanoes_have_two_or_three_streams_ending_in_pools_on_the_back_edge`).

## 4. New paths
- `crates/rh-sim/src/mapgen/landmarks/signature/volcano.rs`

## 5. Exclusive write scope
- `crates/rh-sim/src/mapgen/landmarks/signature/` (the volcano; the two carried notes), `pipeline/mod.rs` (only what
  the step and the styler's inputs need), `crates/rh-sim/src/mapgen/style_scorch/` (signature-mode arrangement),
  `mapdata/model.rs` (appended kinds `Volcano`, `LavaStream`, `LavaPool`), `certify/rules.rs` (`SIGNATURE_KINDS`
  rows), `map_hash/` and `certify/diagnostics.rs` for the names
- `crates/rh-server/src/signature.rs` and the post-pass volcano cases in `signature/tests.rs` (replaced by the oracle)
- `docs/adr/0028-signature-landmarks.md`

## 6. Contracts and references
- G1-G8. G8 binds the styler too: with the option off `style_scorch` draws and places exactly what it does today
  (the pinned styler tests and fixtures pass untouched); the signature-mode branch may draw differently.
- Lava is impassable and ember burns: the certifier's connectivity and hazard rules judge the result; a map with any
  failure is discarded (G5).

## 7. Behaviour to preserve
- Option off: every pinned map, the Fire styler's fixtures, the map hash tests.
- Option on: the bog tree and the church from the core packet still place on every seed; the Fire camps keep their
  clearings and routes.

## 8. Acceptance checks
- Oracle, seeds 1-16, option on: every map has one volcano; it has 2 or 3 streams; each stream's last cell touches
  a pool; its centre is farther from the map centre than the Fire zone's centroid; no `LavaRiver` feature exists;
  total lava tiles are within 70 to 160; every Fire camp is reachable from a spawn without crossing lava.
- Oracle (bands): no crater in the core band; the mean crater size in the near band is at least the mean in mid and
  far; craters still exist (at least the legacy count minus two per map).
- Oracle (G8): option-off maps for seeds 1-8 are byte-identical; the pinned styler tests pass untouched.
- Oracle: every option-on map of seeds 1-16 certifies with zero failures; the anchor list now carries Fire.
- Oracle (rh-server): the post-pass places no volcano.
- `scripts/gate.sh --quick --oracle packet/P-MAPGEN-SIG-FIRE-1` passes (the coordinator runs the full gate).

## Oracle files (read-only for implementers)
- listed by the oracle author on `packet/P-MAPGEN-SIG-FIRE-1`

## 9. Validation commands
- `cargo test -p rh-sim --test mapgen_signature_core`, the new Fire test target, `cargo test -p rh-sim --lib mapgen::`,
  `cargo test -p rh-server --lib signature`, `scripts/gate.sh --quick`

## 10. Risk and suggested model tier
Opus. The streams are the risk: they must reach the front without sealing a camp or a route, on every seed.

## 11. Known traps
- The lava river is built from the camp-node tree in `style_scorch` (`mod.rs:157-189`): removing it in signature mode
  changes which tiles the craters may take; keep the route guard.
- A stream that meets a camp clearing or a route bends around it or stops in a pool early; it never crosses a
  keep-clear tile (G5).
- Report attempts per seed and time per map with the option on, as the core packet did.

## Notes from previous attempts
