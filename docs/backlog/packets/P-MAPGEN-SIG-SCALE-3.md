# P-MAPGEN-SIG-SCALE-3: the bog tree is a lot larger, its outer ring closed but for dry causeways

- **Serves:** owner direction 2026-11-12 late (MIGRATION): the faction landmarks "a lot larger, maybe just a little
  smaller than the temple". Third of four (P-MAPGEN-SIG-SCALE-1 is the plan and the measurements).
- **Implementer tier:** implementer-opus (rh-sim mapgen: the Landmarks phase)
- **Reviewer:** reviewer-opus
- **Integration base:** feature/unity-rework after P-MAPGEN-SIG-RESERVE-1 and P-MAPGEN-SIG-SCALE-2
- **D-rules touched:** D1: option off byte-identical (G8); no legacy counterpart (DEV-020) · D2 n/a · no sim tick or
  wire change
- **Status:** brief only; the oracle is written when SCALE-2 has landed (oracle-author, Opus).

## Amendment 2026-11-13 (owner decision "Yes, apply them": requirements L1 and L3; supersedes everything below where they differ)

Source: `docs/coordination/LAND_GENERATION_REQUIREMENTS.md` on the integration branch; MIGRATION, "Owner decision
2026-11-12 (chat, midnight)"; ADR 0028 rule G9.

- **The bog tree is one blueprint** (L1, L3): the trunk with its root walls, and its own bog as an **irregular marsh**
  (not concentric rings), closed all the way round but for **two or three dry causeways** to the trunk (the drawing
  fixes which). One size: the site's inner rect (30 x 30 target). "Target 30, floor 28" is withdrawn.
- `style_warren/` is not this packet's (agreed with the land-generation session): the free bog pools round the tree
  are `P-LAND-PLAGUE-*`; where the styler assumes the old tree, pass that session the failing test.
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
Amended 2026-11-12 (coordinator decision): the tree is built in its site reserved by P-MAPGEN-SIG-RESERVE-1 (34
tiles, no camp halo inside), **target 30, floor 28** a side for its footprint (the site less its apron). The Plague
bog tree: a trunk about 9-11 across (wall) with root walls reaching out, inside bog rings that bring the footprint to
28-30; the outer ring closed all the way round (today it is broken on some seeds) except for dry
causeways in, so the trunk can be reached; still in the outer third of the zone.

## 2. Dependencies
- P-MAPGEN-SIG-RESERVE-1 merged (the reason this packet can reach the target: among today's camps the clear room in
  the Plague outer third was 8-21 tiles). Its Plague site lies beyond the outer-third line on 24 of 64 seeds and is the
  zone's deepest free square elsewhere (RESERVE-1's owner decision 2): the tree keeps no outer-third test of its own.
- P-MAPGEN-SIG-SCALE-2 merged.

## 3. Relevant paths
- `crates/rh-sim/src/mapgen/landmarks/signature/bog_tree.rs:10-105` (`place`: trunk, dry ring, two bog bands by
  squared distance, `bog_min`, quadrants, outer-third line, uniform draw over legal centres).
- `crates/rh-sim/src/mapgen/landmarks/signature/mod.rs:41-51` (`trunk_d2`, `dry_d2`, `bog_d2`, `bog_min`,
  `outer_slack`).

## 5. Exclusive write scope
- `crates/rh-sim/src/mapgen/landmarks/signature/{bog_tree.rs,mod.rs}`
- `crates/rh-sim/src/mapgen/style_warren/` only where it assumes the tree's size (the oracle author names it)
- `docs/adr/0028-signature-landmarks.md` (decision 4)

## 7. Behaviour to preserve
- Option off byte-identical; every zone keeps its landmark; certifier clean; attempt bounds re-measured; the bog tree
  keeps out of the aprons marked before it (`Site::ground`), and the end-of-attempt apron rule holds (seeds 34 and 49
  were bog tree against cave at FROST-2: re-measure with SCALE-1's larger cave).

## 8. Acceptance checks (for the oracle author to make exact)
- Footprint sides between a floor and min(target, hall side - 2); trunk one solid piece of the stated size; the outer
  ring closed except at k causeways (each at least 2 tiles of dry floor wide), the trunk's foot reachable from outside
  over floor; bog in all four quadrants; no bog in any camp halo or clearing.
- Re-pinned in the oracle commit: `mapgen_signature_core.rs` `shape_bog_tree_stands_in_the_outer_third_ringed_by_bog`
  (trunk at least 9 walls, bog at least 12 tiles); the bog-tree notes of `mapgen_signature_fire.rs`
  (`note1_*`) if their numbers move; P-MAPGEN-SIG-PLAGUE-1's oracle.

## Oracle files (read-only for implementers)
- written on `packet/P-MAPGEN-SIG-SCALE-3` by the oracle author.

## 10. Risk and suggested model tier
Opus: a closed ring 28 across in the outer third conflicts with camps unless sites are reserved; the territory rule of
SCALE-1 applies to the trunk and root walls.

## 11. Known traps
- The tree is placed before the cave and after the church; its draws come from the Plague slot's signature stream.
- Bog is floor with terrain: the styler contract keeps terrain off camp clearings and halos.
