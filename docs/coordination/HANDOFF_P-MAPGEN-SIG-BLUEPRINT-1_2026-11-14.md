# Hand-off: P-MAPGEN-SIG-BLUEPRINT-1 (2026-11-14, implementer-opus)

```
PACKET:          P-MAPGEN-SIG-BLUEPRINT-1 — serves the land-generation lane's architecture review of 2026-11-13
                 (finding 2, the test half of finding 5), order (A) before P-MAPGEN-SIG-SCALE-4 and P-MAPGEN-SIG-HOLY-1
BRANCH:          agent/opus/P-MAPGEN-SIG-BLUEPRINT-1 @ 33180cdaa (implementation; this hand-off is the next commit)
GATE:            PASS (full, `scripts/gate.sh --oracle packet/P-MAPGEN-SIG-BLUEPRINT-1`, attempt 1/2) [skipped:
                 Postgres suites (no DATABASE_URL); CI/owner-hardware-only steps the gate lists] — quick gate also PASS;
                 logs .agent-runs/gate/20261114T023522-…-quick.log, 20261114T030413-…-full.log; no C# flake seen
CHANGED:         crates/rh-sim/src/mapgen/landmarks/signature/{blueprint.rs, spec.rs, mod.rs, cave.rs, church.rs,
                 bog_tree.rs}; this file
D-RULES:         D1: no legacy counterpart (DEV-020); option off untouched, option on byte- and draw-identical (G8),
                 shown by the oracle's two digest guards (seeds 1-32 maps, seeds 1-16 x attempts 0-1 Landmarks phase)
                 and every existing pin; D2 n/a; nothing touches D5/D6/D9 (no sim tick, wire, save, state or content hash)
DEVIATIONS:      none
SHARED RECORDS:  none
LEGACY DOUBTS:   none (no legacy counterpart)
NOT ESTABLISHED: equality on seeds beyond the pinned ones (1-32 maps, 1-16 x 0-1 phases, the existing oracles' seeds);
                 the stamp's refusal paths on generated maps (no pinned seed refuses at the signature step); a reserved
                 Sentenced or Frost site without a camp tile (unreachable: `reserve` gives those zones a site only with
                 its camp) now refuses in the stamp where the old `place` fell back to the rule-drawn landmark
RISKS:           stale doc comments outside this scope (below); `Blueprint::glyphs` is a new public method
```

## What changed
- `blueprint.rs`: the bodies. `Blueprint::parse` (Empty, Ragged, Unknown; first fault in reading order), `size`,
  `char_at`, `tiles_of`, `marks` (legend marks ascending, tiles row-major), `entrance` (`Mark`, `FrontRun` counting
  only open glyphs, `Edge`, `None`), `land` (the turned box from the four turned corners; `Pin` needs a camp and a
  one-tile mark; `Centre` refuses a box larger than the inner rect and puts an odd spare tile before the box),
  `Orientation::turn`, `Landing::tile`. One public addition: `Blueprint::glyphs()`, every grid tile with its glyph,
  row-major (what the stamp iterates).
- `spec.rs`: `specs(&Definition)`, Fire (no drawing), Sentenced, Plague, Frost, each legend today's reading.
- `mod.rs`: the context holds the table with each drawing parsed once (`landmarks`); `apply` routes a zone with a
  drawing in the table and a reserved site through `stamp` and records `Placed.landed`; the volcano and a zone without a
  reserved site keep their own code. `stamp`: the mirror draw first, refusal on an unparsed drawing after it, the
  centre (camp or inner centre tile), `axis(front(t))`, the landing, per-tile legality by glyph class, the doorway check
  where the table says, the wall-piece minimum (walls), the floor split (walls + LOW), features in table order with
  cells sorted by index, the anchor (footprint the landing's box, entrance in the drawing's grid order) and the landed
  marks row-major.
- `cave.rs`, `church.rs`, `bog_tree.rs`: the readers (`cave::Blueprint`, `grid`, `land`, `blueprint`;
  `church::Blueprint`, `blueprint`; `bog_tree::Drawing`, `blueprint`) and their three parse unit tests deleted; each
  `place` is the rule-drawn path only (its reservation argument removed). `smallest_piece`, `lake_at_mouth` and its
  tests, and the rule-drawn paths stay.

## Evidence (macOS arm64, debug test build)
- `mapgen_signature_blueprint`: 10 passed (the 8 red-on-stub tests and both digest guards), 1 ignored (`print_signature_pins`).
- `cargo test -p rh-sim --features trusted-status-probes --no-fail-fast`: every target green, every
  `mapgen_signature_*`, `mapgen_land_sentenced`, `mapgen_land_plague`, `mapgen_land_decor_attempts`,
  `mapgen_style_refusal` included.
- `cargo test -p rh-mapdress`: green (goldens unmoved). `cargo test -p rh-server --test map_anchor_seeds --test
  map_anchors`: green.
- No pin, digest or golden was changed or re-taken; no oracle file is in the diff.

## Out of scope, left stale (proposed for Part 2)
- `signature/mod.rs` `Definition::cave_grid`, `bog_grid`, `church_grid` doc comments still name the deleted
  `cave::Blueprint`, `bog_tree::Drawing`, `church::Blueprint` (the brief keeps `Definition` out of this scope).
- The rule-drawn tree's `s.inner.is_none()` test in `bog_tree::place` is now always true (it is only reached without a
  reservation); Part 2 deletes the path.

## What the stamp does not yet cover (for SCALE-4 and HOLY-1)
- **Work after the stamp (the volcano).** The stamp writes the drawing and stops. The volcano's streams and pools start
  at the landed `O` outlets with turned headings and keep drawing on the same stream; there is no hook from `Landed`
  (marks, orientation) to a per-landmark continuation, and no helper that turns a grid heading into a DIR16 index.
  Moving the volcano onto the stamp also replaces its site draws, so SCALE-4 moves maps and re-pins.
- **The anchor's centre and feature anchor points.** The centre is the camp tile (`Pin`) or the inner rect's centre
  tile (`Centre`). The volcano's box is even (30), so that tile is not a crater-lake tile under every orientation, and
  the Unity art wants a crater-lava centre. A centre or `FeatureAnchor` taken from a mark (`FeatureAnchor::Mark(ch)`)
  is missing; streams and pools (`by_tile` kinds) have no anchor rule in the table.
- **Confinement for the volcano.** `apply` gives Fire a `Site` without `inner` (its streams leave the site). Under
  `Centre` the landing box lies in the inner rect anyway, so the drawing stays confined, but the Fire legend's legality
  classes (`WallGround` like the tree, or `Wall`) are a decision SCALE-4 has to make and pin.
- **The hall's site and camps.** Holy is not in `reserved_zones`: it has no reserved site, stream or relabel, and
  `site_side` is one value (34) while the hall needs 37 plus two apron tiles each side (review finding 3). Its two `E`
  marks are camp centres. Camps are placed in the Prefix, before the Landmarks phase lands the drawing, so the
  orientation (`front(t)` and the mirror draw) would have to be known when the camps go down, or the camps follow the
  landing. `inside_camp` gives one camp per site.
- **Other end-of-attempt checks are still per kind.** `finish` re-reads footprints from feature boxes (church
  excepted) and builds the hall's anchor itself, with an empty entrance. `intact`'s owned-tile test, `is_signature`,
  `aprons_apart` and `by_tile` do not read the table yet (Part 2 and the frame packet).
- **The doorway check looks only along the front.** Entrances on other edges (the tree's side causeways) are never
  checked; that is today's behaviour, and the table only switches the check on or off.
- **Three legality classes.** If hall piers must stand within the certifier camp halo round its own `E` camps,
  `Site::wall` refuses them. That depends on the halo radius against the drawing's 7 x 7 clear squares and is not
  checked here.

## `git diff --stat packet/P-MAPGEN-SIG-BLUEPRINT-1`
```
 .../src/mapgen/landmarks/signature/blueprint.rs    | 189 +++++++++++++++---
 .../src/mapgen/landmarks/signature/bog_tree.rs     | 174 ++--------------
 .../rh-sim/src/mapgen/landmarks/signature/cave.rs  | 214 +-------------------
 .../src/mapgen/landmarks/signature/church.rs       | 201 ++-----------------
 .../rh-sim/src/mapgen/landmarks/signature/mod.rs   | 222 +++++++++++++++++----
 .../rh-sim/src/mapgen/landmarks/signature/spec.rs  | 130 +++++++++++-
 6 files changed, 506 insertions(+), 624 deletions(-)
(before this hand-off file; net -118 lines; cave.rs, church.rs, bog_tree.rs each a net reduction)
```
