# P-UNITY-DRESS-1: the client draws the decoration the server sends and rolls none of its own

- **Serves:** owner decision 3 (MIGRATION, 2026-11-10: rule-based decoration, identical on every client); plan lane D
  packet 9; the Unity half of P-DRESS-BAKE-1
- **Implementer tier:** implementer-sonnet (Unity view code)
- **Reviewer:** reviewer
- **Integration base:** feature/unity-rework at or after `df07deec` (P-DRESS-BAKE-1 merged)
- **D-rules touched:** D1 n/a (DEV-021: decoration has no legacy counterpart as rules) · no wire change · no game rule
  in Unity (decoration is looks only; props stay walk-through)

## 1. ID and outcome
Since P-DRESS-BAKE-1 every Welcome's map blob carries the server's decoration: a prop list (`MapBlob.Props`: kind code,
world x and y, variant 0-3, flags: tall 1, legacy 2; sorted by (y, x, kind)) and a ground-variant plane
(`MapBlob.GroundVariants`: one byte per tile, 0 = none, 1-15). The client validates both and ignores them: it still
rolls its own scatter per floor tile (`View/Regions/RegionProps.cs` `Scatter`), which is why decoration differs from
client to client and looks random. When this lands:
- a map whose blob carries props draws exactly those props, at those positions, with that variant, and rolls no
  scatter; a map whose blob carries none (the practice arena, an older server) keeps today's scatter, unchanged;
- a tile with a non-zero ground variant draws that variant's ground (the landmark bands' variants 3-6, Plague's water
  7 and mud 8) in place of the zone's base ground; variant 0 draws today's ground;
- tall props (flag 1) keep the fade of P-UNITY-PROP-FADE-1 when an actor stands behind or inside them;
- the client's table from kind code to sprite is generated from, or checked against,
  `crates/rh-mapdress/rules/zones.json` (another session edits that file: a test fails when the two disagree), and a
  kind the table does not know draws a visible placeholder and logs once, never nothing and never an exception.

## 2. Dependencies
- P-DRESS-BAKE-1 merged (it is). The land-generation task owns `crates/rh-mapdress/**`; this packet reads its rules
  file and edits nothing there.

## 3. Relevant paths
- `client-unity/RoguehallaNet/Protocol/MapBlob.cs` (`Props`, `GroundVariants`, the caps), `crates/rh-mapdress/src/rules.rs`
  (the kind-code blocks: 1-10 Fire … 41-50 Holy, second blocks 51-100; `is_tall`), `rules/zones.json` (kind names)
- `client-unity/UnityProject/Assets/Scripts/View/Regions/{RegionProps.cs,RegionPropArt.cs,RegionGround.cs,RegionGroundTextures.cs,PlagueGround.cs,RegionMap.cs}`

## 5. Exclusive write scope
- `client-unity/UnityProject/Assets/Scripts/View/Regions/**` (the oracle author names the files), one generated or
  checked-in kind table beside them, and an engine-free helper under `client-unity/RoguehallaNet/Net/` only if the
  kind table or the variant lookup is testable there
- not `Protocol/**`, not `crates/**`

## 7. Behaviour to preserve
- Maps without shipped decoration look exactly as today (the scatter's own tests stay green); the keep-clear the
  scatter respected is the server's job now and is not re-checked on the client; no per-frame garbage; the prop fade.

## 8. Acceptance checks
- EditMode: given a blob with N props, exactly N prop objects exist at the blob's positions with the blob's kinds and
  variants, and `Scatter` placed none; given a blob with none, today's scatter count for that map (pinned on a
  checked-in map fixture, not a generated one).
- EditMode: a tile with ground variant v draws variant v's texture or tint; v = 0 draws the base ground; every variant
  the shipped rules use (3-8) has an entry; an unknown variant draws the base ground and logs once.
- The kind table covers every kind in `zones.json` (a test reads the file); an unknown kind draws the placeholder.
- A tall prop fades as P-UNITY-PROP-FADE-1 pins; a prop without the flag does not.
- `scripts/gate.sh --quick --oracle packet/P-UNITY-DRESS-1` passes.

## Oracle files (read-only for implementers)
- listed by the oracle author on `packet/P-UNITY-DRESS-1`

## 10. Risk and suggested model tier
Sonnet. The art: say which rule kinds have a sprite today and which do not (the oracle author lists them); a kind
without art uses the nearest existing prop of its zone and is named in the hand-off for the art pass. Landmark art
(the volcano, church, tree, cave and hall as buildings) is not this packet.

## 11. Known traps
- Prop positions are world units (32 per tile) with a small offset inside the tile; draw order follows y.
- A landmark-mode map carries about 1,100-1,190 props and about 23,000 non-zero ground cells: build them once at
  Welcome, batched like today's scatter, not per frame.
- An EditMode run modifies `Assets/Resources/Showcase/NunitoRegular.asset`: `git checkout --` it, never commit it.

## Notes from previous attempts
