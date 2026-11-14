# P-UNITY-GROUND-BANDS-1: decoration bands on the ground have soft, ragged edges; per-tile scatter stays crisp

- **Serves:** owner decision 3 (2026-11-10: world order, influence rings round each landmark); the owner's core art
  complaint (subjects read at a glance; no flat boxes); Web round 11 (2026-11-14): a bog pool sits on a lighter halo
  whose outline is tile-aligned square steps
- **Implementer tier:** implementer-sonnet (Unity presentation: shader and its inputs)
- **Reviewer:** reviewer
- **Integration base:** feature/unity-rework after P-UNITY-GROUND-TINT-1 and P-UNITY-GROUND-SAMPLERS-1
- **D-rules touched:** D1 n/a (presentation; DEV-020) · no wire change · no game rule in Unity · the server's dressing
  (`rh-mapdress`) is not changed: which tile has which variant stays the server's decision

## 1. ID and outcome
The server dresses each zone with ground variants: per tile, a small code that the client turns into a gain on the
ground art (`GroundVariantLook.cs`; P-UNITY-GROUND-TINT-1). Two different things use the one plane:
- **Bands**: regions laid by distance from a landmark or terrain (`crates/rh-mapdress/rules/zones.json`: the ring
  bands, and for Plague `plague-marsh-water` variant 7 with reach 1 and `plague-marsh-mud` variant 8 with reach 3
  round bog, `zones.json:133-134`). The distance is Chebyshev (`rh-mapdress/src/lib.rs:458-466`), so a band is a
  square ring of tiles.
- **Scatter**: single tiles picked at random (the Sentenced floor's browns, lighter greys and purples), which are
  meant to follow the slab grid.
The client draws both the same way: the variant plane is one texel per tile, point filtered, sampled at the tile
centre (`RegionGround.cs:76-79`, `RegionGround.shader:564-570`), so a band is drawn as whole-tile squares with a hard
stepped outline, while the terrain beside it (bog, lava, ice) has a soft organic edge (`_TerA`/`_TerB`, 4 texels per
tile, bilinear, `smoothstep` on coverage plus edge noise, `shader:593-606`). In the Web client the marsh band reads as
a flat tinted box round each pool. The shader's own comment (`shader:564`) says the variant edge is "ragged, from the
same warp"; the code does not do that.

When this lands:
1. **A variant's look says how its edge is drawn**: `GroundVariantLook` gives each variant code an edge kind, `Tile`
   (crisp, per tile: today's drawing) or `Soft` (the gain fades in across the band's boundary and the boundary is
   ragged, by the same kind of warp or noise the terrain edge uses, so no straight run of the outline is longer than
   about one tile and corners are rounded). Band variants are `Soft`; scatter variants are `Tile`. A new variant code
   is one row in that table.
2. **A soft band meets terrain cleanly**: where a band surrounds bog, lava or ice, no hard seam or gap shows between
   the band's inner edge and the terrain's own soft edge.
3. **Nothing else moves**: a tile deep inside a band has the same gain as today (the tint the owner has seen); a map
   with no variants renders exactly as today; the Sentenced scatter is pixel-for-pixel today's.

## 2. Dependencies
P-UNITY-GROUND-TINT-1, P-UNITY-GROUND-SAMPLERS-1, P-UNITY-LOOK-TOOLS-1 merged.

## 3. Relevant legacy paths
none (DEV-020; legacy has no dressing bands)

## 5. Exclusive write scope
- `client-unity/UnityProject/Assets/Resources/Regions/RegionGround.shader` (the variant block only)
- `Assets/Scripts/View/Regions/RegionGround.cs` (how the variant inputs are built), `GroundVariantLook.cs`,
  `GroundTint.cs`
- `docs/unity/DIALS.md` (the soft edge's width and raggedness as dials, with ranges)
- not `crates/**`, not `Protocol/**`, not any existing test

## 7. Behaviour to preserve
- The Web build's shader compiles on gles3 inside the texture and sampler budget
  (`RegionShaderWebCompileEditModeTests`): a second plane, if one is needed, shares an existing sampler.
- `GroundTintBakeEditModeTests`, `DressedMapEditModeTests` and the Sentenced scatter tests stay green unchanged.
- No per-frame cost on the CPU; the planes are built once per map.

## 8. Acceptance checks
- EditMode (the gate runs without graphics: test what the CPU builds): the table marks every band variant in
  `zones.json` as `Soft` and every Sentenced scatter variant as `Tile` (read the rules file, so a new band in the
  rules without a row fails); the inputs the shader reads for a `Soft` variant are not tile-constant across a band's
  boundary (state exactly what is asserted for the representation chosen); for `Tile` variants the plane is
  byte-identical to today's. Red today.
- A render check, run with graphics through the look tools (`docs/unity/LOOK_CHECK.md`; not in the gate): on
  `plague-scene-dressed` (or a new scene with a pool and its marsh band), along a band's outline the longest
  axis-aligned straight run is under 1.5 tiles (today: several tiles) and a tile 2 tiles inside the band differs from
  today's render by no more than render noise. The oracle author writes this as a script or a test the implementer
  runs, with today's numbers.
- A Web round (`docs/unity/WEB_ROUND.md`) shot of a bog pool, before the owner sees it.
- `scripts/gate.sh --quick --oracle packet/P-UNITY-GROUND-BANDS-1` passes.

## 9. Validation commands
- `bash client-unity/UnityProject/Tools/editmode.sh`
- `client-unity/UnityProject/Tools/look-capture.sh plague-scene-dressed --out <dir>` and `look-compare.py`

## 10. Risk and suggested model tier
Sonnet. The risk is the Web shader budget and a seam where a soft band meets soft terrain.

## 11. Known traps
- P-UNITY-SENTENCED-TILES-1 passed every test and was garish in the client because its oracle measured a colour
  model, not the screen. Here the render check and the Web shot are part of acceptance, not an afterthought.
- Bilinear filtering a plane of variant CODES blends code numbers, which is meaningless: blend gains (or coverage per
  soft variant), not codes.
- The marsh band's reach is 1 to 3 tiles: a soft edge wider than the band erases it.

## Notes from previous attempts
