# P-DRESS-ANCHOR-1: decoration rings are anchored on each zone's landmark, in the generator's bands

- **Serves:** owner direction 2026-11-12 (generation order: zones, landmark, obstacles, then decoration around the
  landmark; core rules G3, G4, G7); plan lane D rule 3 (influence rings)
- **Implementer tier:** implementer-sonnet (single crate: `rh-mapdress`)
- **Reviewer:** reviewer
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1 n/a (decoration is not in legacy as rules: DEV-021 covers it) · no sim, wire or content-hash
  change (the rules file is outside `content_hash`)

## 1. ID and outcome
`rh_mapdress::dress` (`crates/rh-mapdress/src/lib.rs:512`) lays each zone's rings around the feature named in
`rules/zones.json` `zones.<zone>.signature.feature`. Today those are legacy features (`crater`, `gallows`, ...) with
ring radii of the starter rules (0-6, 6-14) measured from the feature's centre. When this lands the rings follow the
generator's landmark: Fire `volcano`, Sentenced `church`, Plague `bogTree`, Frost `cave`, Holy `hall`; distance is
measured from the landmark's footprint (its recorded feature rectangle), not its centre; and the ring edges are the
generator's bands (core up to 2 tiles, near up to 6, mid up to 14, far beyond: `signature::band`,
`crates/rh-sim/src/mapgen/landmarks/signature/mod.rs:154`, read through a public function, not copied numbers). Each
band names a ground variant and a prop family, so a zone reads from its landmark outward (volcano: ember, scorched
basalt, ash; church: flagstone yard, graves, dead grass, dead trees; tree: roots, reeds, fungus; cave: ice shelf, frost
rock, snow; hall: paving, banners, lawn). A map without the landmark (option off) falls back to the legacy feature
named as `fallbackFeature`, exactly as today.

## 2. Dependencies
- P-MAPGEN-SIG-FROST-1 merged (the cave's `FeatureKind`). P-MAPGEN-SIG-SENTENCED-1 is not required (the Holy hall is
  already a recorded feature; only the phase of its anchor moves there).

## 5. Exclusive write scope
- `crates/rh-mapdress/src/**`, `crates/rh-mapdress/rules/zones.json`, `crates/rh-mapdress/tests/**` (non-oracle)
- `crates/rh-sim/src/mapgen/landmarks/signature/mod.rs` only to make the band lookup public if it is not (one line;
  named in the hand-off: that makes the packet cross-crate for review, and `reviewer-opus` reviews it)

## 7. Behaviour to preserve
- Keep-clear outranks theme (G5): no prop in `keep_clear`, no tall prop in `tall_corridor`; byte-identical reruns for
  the same map, hash and rules; the prop cap; the existing property tests stay green.
- For a map with the option off, output is byte-identical to today's (same rules file semantics through
  `fallbackFeature`).

## 8. Acceptance checks
- Oracle, signature maps for seeds 1-8 (generated in the test through the generator with `signature` on): every ring
  prop's band, computed from the landmark's footprint, equals the band its ring declares; no ring prop of zone A lies
  in zone B; each zone has props in at least its near and mid bands; the core band holds no tall prop.
- Oracle: the same eight maps with the option off produce today's dressing byte for byte (hash of the `Dressing`).
- `rules_file.rs`: the shipped `zones.json` parses, names the five landmark kinds and a fallback for each.
- `scripts/gate.sh --quick --oracle packet/P-DRESS-ANCHOR-1` passes (the coordinator runs the full gate).

## Oracle files (read-only for implementers)
- listed by the oracle author on `packet/P-DRESS-ANCHOR-1`

## 10. Risk and suggested model tier
Sonnet. Footprint distance on a non-rectangular landmark (the volcano's cone, the cave's chamber): use the tiles the
feature owns if the map records them, else the rectangle; say which in the hand-off.

## 11. Known traps
- The kinds in the rules file are names only until the art packets map them to sprites: do not add sprite paths here.
- Legacy feature-tied props (anvil, gate lanterns, crater lips) come from the generator's decor stream and are not
  this crate's to place.

## Notes from previous attempts
