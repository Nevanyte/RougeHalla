# P-SIGNATURE-2: the landmarks match the owner's description and place on nearly every map

- **Serves:** owner beta-follow-up decision 4 (MIGRATION, 2026-11-10) and the owner's answers of 2026-11-11 recorded in
  `docs/coordination/CLOUD_HANDOFF_2026-11-11.md`; reviewer-opus observations on P-SIGNATURE-1 (differences from the
  owner's wording, placement rates)
- **Implementer tier:** implementer-sonnet (one crate, `rh-server`; map authoring behind `--signature-landmarks`)
- **Reviewer:** reviewer-opus (map authoring feeding every pooled match)
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1 n/a (no legacy counterpart; ADR 0028 and the DEVIATIONS row from P-SIGNATURE-1-fix cover it)
  · no sim, wire or content-hash change

## 1. ID and outcome
P-SIGNATURE-1 places a landmark per zone, but four things differ from what the owner asked for, and the cave places on
only half of the maps (seeds 1-8: bog tree 8, volcano 7, church 6, cave 4). When this lands:
- **Fire:** the volcano sits on the zone's back edge (the side away from the coliseum) and always has two or three lava
  streams running toward the front, each ending in a lava pool; a volcano that can fit only one stream is not placed.
  Every route through the zone keeps a ford.
- **Frost:** the landmark is a cave, not an arch: a walled chamber on the back edge with one mouth, the elite camp
  inside, the mouth facing the zone's frozen lake (the largest ice body), with a walkable path from the mouth to the
  lake shore.
- **Plague:** the giant bog tree stands in the outer third of the zone (toward the map edge), on ground that is not bog.
  The marsh stays bog bands (owner 2026-11-11: only bog slows; water is presentation and belongs to the dressing
  packets, not to terrain).
- **Sentenced:** the church keeps its form; three reviewer notes on P-SIGNATURE-1-fix (2026-11-12) are closed here:
  (1) REAL: the graveyard must exist, not merely be gap-free: before the fix only seeds 1 and 5 of 1-8 had headstones,
  the wider pitch needs a 19-tile field, and the gap test passes vacuously when a church has no stones. At least half
  of the placed churches on seeds 1-16 have a graveyard of 4 or more stones (try both sides of the door and a shorter
  row before giving up), and the stones sit the same distance from the wall on every door side and centred on the
  door axis. (2) MINOR: in `apply`, a church whose `church_site` is `None` is a skipped attempt, never a kept,
  unreported church. (3) MINOR: ADR 0028 states what the code does (stream counts, the graveyard rate as measured).
- **Rates:** on seeds 1-16 each landmark places on at least 14 maps, by trying more sites before giving up, never by
  weakening the certifier check.

## 2. Dependencies
- P-SIGNATURE-1-fix merged (same file; strictly serial)

## 3. Relevant legacy paths
- none (new terrain). Reference for zone geometry: `docs/ZONE_SHAPES_AS_BUILT.md` section 10, and the legacy
  stylers ported in `crates/rh-sim/src/mapgen/` (`style_scorch` lava river, `style_rime` lake), which are read, not edited.

## 4. New paths
- none

## 5. Exclusive write scope
- `crates/rh-server/src/signature.rs`, `crates/rh-server/src/signature/tests.rs`
- `docs/adr/0028-signature-landmarks.md` (rates and descriptions)

## 6. Contracts and references
- The certifier is the judge: a landmark is kept only on a map that certifies with zero failures before and after
  (P-SIGNATURE-1-fix).
- "Back edge" and "outer third" are measured from the map centre (the coliseum): define each as a distance band in the
  code and name the constants in the hand-off.

## 7. Behaviour to preserve
- Without `--signature-landmarks` pooled maps are byte-identical to before.
- The elite camp stays reachable and its territory radius and area are recomputed (`refresh_camps`).
- Generation stays off the director's thread (P-MAP-3-fix) and within the pool worker's time budget: report the
  generation time per map before and after.

## 8. Acceptance checks
- Oracle, seeds 1-16: every placed volcano has 2 or 3 streams, each stream's last cell touches a pool, and the volcano's
  centre is farther from the map centre than the zone's centroid.
- Oracle: every placed cave is closed except for one mouth, contains the elite camp's clearing, and a walk exists from
  the mouth to an ice cell of the zone's largest ice body.
- Oracle: every placed bog tree is in the outer third of its zone's radial extent and stands on non-bog floor.
- Oracle: placement counts over seeds 1-16 are at least 14 for each of the four landmarks.
- Oracle: on seeds 1-16 at least half of the placed churches report 4 or more headstones; stones on left/top doors
  and right/bottom doors sit the same number of tiles from the church wall.
- `scripts/gate.sh --oracle packet/P-SIGNATURE-2` passes.

## Oracle files (read-only for implementers)
- listed by the oracle author on `packet/P-SIGNATURE-2`

## 9. Validation commands
- `cargo test -p rh-server signature`, `scripts/gate.sh --quick`

## 10. Risk and suggested model tier
Sonnet, two attempts, then Opus. The rates check is the hard part: some seeds may have no legal site.

## 11. Known traps
- If 14 of 16 cannot be met for a landmark without weakening a rule, stop and report the best rate and the blocking
  rule per failing seed; the coordinator decides whether the threshold or the rule moves.
- A zone without a frozen lake: say what the cave faces (the zone centre) and count it separately.

## Notes from previous attempts
