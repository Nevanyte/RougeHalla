# P-UNITY-GROUND-BANDS-1: decoration bands on the ground have soft, ragged edges; per-tile scatter stays crisp

- **Serves:** owner decision 3 (2026-11-10: world order, influence rings round each landmark); the owner's core art
  complaint (subjects read at a glance; no flat boxes); Web round 11 (2026-11-14): a bog pool sits on a lighter halo
  whose outline is tile-aligned square steps
- **Implementer tier:** implementer-sonnet (Unity presentation: shader and its inputs)
- **Reviewer:** reviewer
- **Integration base:** `docs/agent/INTEGRATION_BRANCH` after P-UNITY-GROUND-TINT-1 and P-UNITY-GROUND-SAMPLERS-1 (both merged)
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
centre (`RegionGround.cs:75-82`, `RegionGround.shader:564-570`), so a band is drawn as whole-tile squares with a hard
stepped outline, while the terrain beside it (bog, lava, ice) has a soft organic edge (`_TerA`/`_TerB`, 4 texels per
tile, bilinear, `smoothstep` on coverage plus edge noise, `shader:593-606`). In the Web client the marsh band reads as
a flat tinted box round each pool. The shader's own comment (`shader:564`) says the variant edge is "ragged, from the
same warp"; the code does not: P-UNITY-GROUND-TINT-1 replaced the warped coordinate by `floor(t)` (unwarped, hard, tile aligned) and left
the comment stale. The implementer corrects the comment.

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
- `client-unity/UnityProject/Assets/Scripts/View/Regions/RegionGround.cs` (`BakeVariantInputs`, `GroundVariantInputs` at the end of
  the file, the texture upload in `Build`)
- `client-unity/RoguehallaNet/Net/Ui/GroundVariantLook.cs` and `GroundTint.cs` (they are in the engine-free library, NOT under
  `View/Regions`: the first draft of this brief had the wrong directory) and their synced copies under
  `UnityProject/Assets/RoguehallaNet/Net/Ui/` (`bash client-unity/sync-net.sh`)
- `docs/unity/DIALS.md` (the soft edge's width and raggedness as dials, with ranges)
- not `crates/**`, not `Protocol/**`, not any existing test, not the oracle files below

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

## Established facts (oracle author, 2026-11-14)

**Variant codes, source and today's gain** (`GroundVariantLook.TryGet`; gain per channel R,G,B as the shader applies it, texel byte / 128; the table is in `GroundVariantLook.cs`).
Every code `zones.json` can lay is a BAND; the file has no scatter. The codec refuses a plane code above 8 (`MapBlob.cs:485`), so "an unknown code" cannot reach a map.

| code | source in `zones.json` | fire | sentenced | plague | frost | holy |
|---|---|---|---|---|---|---|
| 1 | signature ring, inner (`*-ring-core/yard/court/shore/sanctum`, 0..6) | .84 .84 .84 | .85 .60 .75 | .73 .73 .73 | .87 .87 .87 | .88 .88 .88 |
| 2 | signature ring, outer (6..14) | 1.17 x3 | 1.52 x3 | 1.30 x3 | 1.15 x3 | 1.14 x3 |
| 3 | landmark band `core` | 1.10 .97 .94 | 1.30 .90 .81 | 1.27 .91 .83 | 1.13 .95 .91 | 1.08 .97 .95 |
| 4 | landmark `near` | 1.04 .86 1.20 | 1.03 .88 1.17 | 1.03 .89 1.16 | 1.01 .97 1.05 | 1.02 .95 1.07 |
| 5 | landmark `mid` | .91 1.05 1.05 | .73 1.16 1.13 | .80 1.12 1.10 | .88 1.07 1.06 | .94 1.04 1.03 |
| 6 | landmark `far` | 1.09 1.03 .88 | 1.17 1.05 .78 | 1.19 1.05 .76 | 1.05 1.02 .93 | 1.07 1.02 .91 |
| 7 | `terrainRings` `plague-marsh-water` (`zones.json:133`, reach 1) | .60 1.00 1.80 in every region | | | | |
| 8 | `terrainRings` `plague-marsh-mud` (`zones.json:134`, reach 3, so distance 2..3) | 1.45 .85 .55 in every region | | | | |

Rings 1..6 are laid on tiles of the zone with `tiles[i] == 0` (`rh-mapdress/src/lib.rs:549-573` signature rings, Euclidean from the anchor; `596-613` landmark bands); 7 and 8 on Floor tiles only
(`lib.rs:458-470`, Chebyshev distance from the bog tiles). So the terrain's own tiles carry variant 0 and a band surrounds them: that is where the soft band meets the terrain's soft edge.

**The Sentenced scatter is client-rolled and has no code.** The server never sends it: `RegionGround.BakeVariants` (`RegionGround.cs:106`) asks `GroundTint.Bake` (`GroundTint.cs:34`), which for
region 2 composes the server's band (if any) with `SentencedTiles.Family(x, y)` (a pure hash of the tile's coordinates; 4 families, about 40 percent non-base) into ONE texel (`Compose`, rounded
to 1/128). So "the scatter is Tile" is not a table row: it is "the family's texel stays in the crisp plane". What must stay byte-identical: `BakeVariants` for every map (the existing
`GroundTintBakeEditModeTests` and `DressedMap*EditModeTests` pin it and stay unamended), and the crisp plane of a Sentenced map with no band. Where a band meets a family tile those tests still want
`BakeVariants` to return band x family in one texel, so the implementation keeps `BakeVariants` as that reference and builds the upload from the new `BakeVariantInputs` (crisp plane without the
Soft band's part, plus the soft part). Deep inside a band, `GainAt` must equal today's band x family gain.

**Web shader budget.** `RegionShaderWebCompileEditModeTests` compiles the all-shape-light GLES3x fragment and fails above 16 sampler states. Its header: round 8 had exactly 16, P-UNITY-DRESS-1 made
17, P-UNITY-GROUND-SAMPLERS-1 cut the ground shader's own to 7 (`GroundTex`, `GroundNrm`, `TempleTex`, `RhRegA`, `RhRegB`, `RhShadowMask`, `RhShadowAtlas`; `RegionGround.shader:62-73`,
`RhSun.hlsl:7-9`, `RhLocalLights.hlsl:23`); the URP shape-light textures add the rest. Today's total with all four keywords is not printed by the test (it passes), so the implementer must
not assume slack and runs the test after every shader edit. Sharing: `_VariantTex` reads through `sampler_TempleTex` (point, clamp); `_RegA/_RegB/_TerA/_TerB/_PlgTex/_RhFogTex` read through
`sampler_RhRegA` (bilinear, clamp, no mips). A bilinear soft plane therefore shares `sampler_RhRegA` and adds NO sampler state, but it adds one TEXTURE (the ground shader and its includes
declare 14 today); the test does not measure texture units, which WebGL2 also limits (16 on most devices), so prefer a form with no new texture. Two forms that need none: (a) make `_VariantTex`
finer (2 or 4 texels per tile), point-sample the tile-centre texel for the crisp part and do the bilinear fetch by hand (4 point fetches) for the soft part; (b) pack the soft coverage into
the plane's spare bits. The brief's form (a second, finer coverage-and-gain plane built on the CPU from the code plane, bilinear with the terrain's warp, sharing `sampler_RhRegA`) also passes the
sampler test at the cost of one texture. Not established: the texture-unit headroom.

**Why blend gains, not codes.** Neighbouring bands (3|4|5|6, 7|8) carry different gains; bilinear filtering the CODE plane gives code 3.5, which means nothing. The tests pin the result: across a
boundary between two bands each channel moves monotonically between the two gains and never leaves their range.

**Not testable in the gate (so not pinned):** the raggedness (shader noise: the CPU's soft plane is smooth), the seam between the soft band and the terrain's edge on screen, the Web look. The render check
below covers the first two on the editor's renders; the Web round is the owner's.

**Pinned values (loose on purpose).** All on the band's most-changed channel, as a fraction of its full effect: on a block's boundary the fade is between .25 and .75; at least .9 one tile inside and at most
.1 one tile outside; it rises monotonically (tolerance .03) and varies by at least .1 within the boundary tile on each side; at a block's corner it is at most .4 and at least .1 below a side's
middle (rounded corner); a 1-tile strip keeps at least half strength at its middle and is untouched one tile away; where a band touches bog, lava or ice it is still at least .9 on the band side and 0.3
tile into the terrain tile (no gap under the terrain's own edge). One texel per tile, bilinear (texel centres at tile centres) meets all of these; a crisp edge, a fade wholly inside or wholly outside
the boundary, and a fade wider than a tile each fail one.

## The stub surface (commit `stub:`)
- `GroundVariantEdge { Tile, Soft }` and `GroundVariantLook.EdgeOf(int region, byte variant)` (engine-free library + synced copy). Stub: always `Tile`. Implementer: `Soft` for codes 1..8 where `TryGet`
  is true, kept in the same table as the look ("a new variant code is one row").
- `RegionGround.BakeVariantInputs(MapBlob)` returning `GroundVariantInputs { Width, Height, Tile (Color32[w*h], the crisp plane), SoftActive, SoftGainAt(tx, ty), GainAt(tx, ty) }` (end of
  `RegionGround.cs`). Stub: `Tile = BakeVariants(map)`, `SoftActive = false`, `SoftGainAt` neutral. Implementer: `Tile` carries the crisp plane (Tile-edge variants and the Sentenced family, NOT the
  Soft band's part), `SoftGainAt` is a CPU mirror of what the shader samples for the soft part (storage is theirs), `Build` uploads from it, `_VariantOn` stays 0 when there is no tinted tile
  and the soft path is on only when `SoftActive`. `GainAt` (Tile gain at floor(tx, ty) times `SoftGainAt`) may be edited but its meaning is what the tests rely on.
- `LookCapture.RenderMap(MapBlob, path, tx, ty, ortho, groundOnly)` (`Assets/Editor/Look/LookCapture.cs`): a public hook so the render check can render a caller-built map. The scene list (pinned at 32
  names by `LookCaptureEditModeTests`) is untouched, so the check is not a new scene.

## Oracle files (read-only for implementers)
- `client-unity/UnityProject/Assets/Tests/Editor/GroundBandsEditModeTests.cs` (+ `.meta`)
- `client-unity/UnityProject/Assets/Editor/Look/BandOutlineCapture.cs` (+ `.meta`)
- `client-unity/UnityProject/Tools/band-outline-check.sh`, `client-unity/UnityProject/Tools/band-outline-measure.py`
- this packet. Stub commit (the implementer edits these): `GroundVariantLook.cs` and its synced copy, `RegionGround.cs`, `LookCapture.cs`.
- Routing: serves owner decision 3 and the Web round 11 finding; tier implementer-sonnet; reviewer; D-rules D1 n/a (DEV-020, presentation), no wire change.
- Existing tests that must stay green unamended: `GroundTintBakeEditModeTests`, `DressedMapEditModeTests`, `DressedMap2EditModeTests`, `RegionShaderWebCompileEditModeTests`, `LookCaptureEditModeTests`.

## Baseline (on the stub; `bash client-unity/UnityProject/Tools/editmode.sh`: total 1482, passed 1464, failed 18, all 18 in `GroundBandsEditModeTests`, none elsewhere)
Red, each on an assertion (no compile error, no exception):
- `EveryBandCodeTheRulesCanLayHasALookAndIsSoft_RedToday`: "region 1 variant 1 is a band (zones.json): Soft; Expected Soft, But was Tile"
- `ASoftBandFadesAcrossItsBoundaryTilesAndIsFullOneTileInAndZeroOneTileOut_RedToday` x6 (region, code): (1,1) (1,5) (3,7) (3,8) (4,2) (5,2): "a map with a Soft band needs the soft path; Expected True, But was False".
  The profile assertions behind it are not exercised by the stub; they are written for the one-texel-per-tile bilinear form and not verified against an implementation.
- `ASoftBandsCornersAreRounded_RedToday` x6: "at the corner (15.001,15.001) the fade is a quarter, not a half; Expected <= 0.4, But was 1.0"
- `AOneTileBandIsNotErasedByItsSoftEdge_RedToday`, `NeighbouringBandsBlendTheirGainsNotTheirCodes_RedToday` and the terrain cases `lava`, `bog`, `ice`
  (`ASoftBandKeepsItsStrengthRightUpToTheTerrainItSurrounds_RedToday`): "Expected True (SoftActive), But was False".
Green on the stub by design (guards): `CodesWithoutALookAreTile_Guard`, `ADeepBandTileHasTodaysGainInEveryZoneAndCode_Guard` (catches a soft plane stacked on a tile plane that still carries the band:
gain squared), `TheSentencedScatterStaysCrispWithAndWithoutABand_Guard` (a scatter tile is constant across the tile and steps at its border, banded or not), `TileOnlyMapsBakeTodaysPlaneAndNeedNoSoftPath_Guard`
(no-variant maps in every zone and an all-zero plane: crisp plane byte-identical to `BakeVariants`, `SoftActive` false, soft gain neutral), `AMapWithBandsStillBuildsAGroundAndTurnsTheVariantPathOn_Guard`.

## The render check (not in the gate; needs graphics)
Command: `client-unity/UnityProject/Tools/band-outline-check.sh --out <dir> --max 1.5` (a few minutes; exit 0 under the bound, 1 at or over it or on a failed render, 3 no Editor or the project is open).
It renders, through `LookCapture.RenderMap`, ground only, a 60 x 60 Plague map with a 6 x 4 bog pool and the server's marsh bands round it (water at distance 1, mud at 2..3) three times: with the bands,
without (empty plane), and without again (the noise of one tree); then runs `band-outline-measure.py <dir>`. Why not `plague-scene-dressed`: rendered and read, it has noise patches of variants 7, 8, 1 and 2 and
no band round the pool (the plane skips terrain tiles), and the scene list is pinned at 32 names by an existing test, so a new scene would amend that test. The with-bands render of today's tree shows the
problem plainly: a pale-teal rectangle round the pool inside a yellow-brown rectangle, both square.
How the outline is found (the script's docstring has it in full): the signed colour difference with-minus-without is projected on the mud band's own colour-change direction (taken in the mud tile at distance 2)
and box-blurred over 13 px; the outline is the half-strength contour of that signal (0.5 x the mud tile's level); the outermost mask pixel of each column or row gives the four profiles of the ring's outer
outline; the longest straight run is the longest stretch of a profile that stays within 0.15 tile of itself, in tiles. Sensitivity of today's number (threshold fraction x tolerance in tiles):

```
          tol=0.10      tol=0.15      tol=0.25
  thr=0.35 11.87 (b)  12.03 (t)  12.07 (t)
  thr=0.50 11.40 (b)  11.90 (b)  12.00 (t)
  thr=0.65  9.81 (r)  11.40 (b)  11.93 (t)
```
**Today's number: `outline_longest_run_tiles=11.90`** (the ring's whole 12-tile side; the signal level is 11.0 and the noise p99 2.3 along the band direction, ratio 0.2, so the measure is clean; 9.8 to 12.1 across the
table). Acceptance: under 1.5 at the headline (0.5, 0.15). A ragged edge whose wobble is smaller than the tolerance still reads as straight, so the tolerance matters: if the headline passes but the table shows
runs above 3 at tol .25, the edge is mostly straight and the reviewer looks at the PNG. The measure cannot tell a ragged edge from a merely blurred one; the PNG can.
Today's tile means (sRGB, with / without; the without is the noise reference): mud tile at distance 2 (51.0, 81.8, 30.6) / (44.7, 88.8, 36.4); water tile at distance 1 (40.5, 91.7, 41.3) / (45.6, 90.0, 36.5).
"A tile 2 tiles inside the band differs from today's by no more than render noise": after the change, the script's `with` means of these two tiles stay within about 3 per channel of these (limit of the measure:
the mud band is two tiles wide here, so "inside" is 1.5 tiles from its outer edge; two renders of one tree differ by about 1 to 2 in a tile mean). The implementer reports both numbers and the PNG.

## Brief corrections found by the oracle author
- Paths: `GroundVariantLook.cs` and `GroundTint.cs` are in `client-unity/RoguehallaNet/Net/Ui/` (synced to `Assets/RoguehallaNet/Net/Ui/`), not under `Assets/Scripts/View/Regions/`. Write scope fixed above.
- The shader comment "ragged, from the same warp" is stale (TINT-1 made the sample unwarped); there is no warp in the variant block today.
- `zones.json` has no scatter; the Sentenced scatter is client-rolled and has no code, so "every Sentenced scatter code is Tile" became a crisp-plane check.
- Signature rings (codes 1, 2) are Euclidean from the anchor, not Chebyshev; only the marsh bands (7, 8) are Chebyshev squares. The soft edge applies to both.
- A `plague-scene-dressed` render has no band round a pool, and a new look scene needs an existing pinned test amended: the render check is its own tool.

## Notes from previous attempts
