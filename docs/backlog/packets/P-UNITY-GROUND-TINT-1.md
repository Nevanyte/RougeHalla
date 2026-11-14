# P-UNITY-GROUND-TINT-1: ground tints modulate the ground art instead of replacing it (decoration bands in every zone; the Sentenced floor's scattered tiles)

- **Serves:** owner decision 3 (2026-11-10: decoration has order: influence rings round each zone's landmark); owner
  direction 2026-11-13 on the Sentenced floor ("some more tile random variance could help, with dark lighting it could
  still work, perhaps some brown tiles, lighter greys some purples all randomly dispersed (should still be relatively
  dark)"); screenshot rounds 9 and 10 (2026-11-13)
- **Implementer tier:** implementer-sonnet (Unity presentation, shader)
- **Reviewer:** reviewer; then the owner sees before and after screenshots from the running Web client
- **Integration base:** feature/unity-rework after P-UNITY-GROUND-SAMPLERS-1 (the ground shader's samplers)
- **D-rules touched:** D1: legacy has no decoration bands and two greys on the Sentenced floor: presentation deviations
  (DEV-021 covers the bands; the Sentenced scatter needs its row again) · no wire change · no game rule in Unity

## 1. ID and outcome
The ground shader applies the per-tile variant plane as `col = lerp(col, vt.rgb, vt.a)` (`RegionGround.shader`, the
variant path): a flat colour laid over the ground at the plane's alpha, point-sampled per tile at a warped coordinate.
Seen in the running Web client (session scratchpad):
- **Decoration bands** (`shots9/33`, `shots10/73`, `shots10/90`): on a landmark-mode map the server's ground variants
  (the rings round each zone's landmark, `GroundVariantLook` codes 3 to 6, and water 7 and mud 8) are large flat
  pastel regions with hard, wobbling edges: a pink rectangle nested in a grey-pink one round the Fire landmark; lilac,
  peach, pale teal and beige stripes across the Sentenced church yard. The ground's own texture (slabs, cracks,
  speckle) is mostly gone under them.
- **The Sentenced scatter** (`shots10/120`, built by P-UNITY-SENTENCED-TILES-1 and reverted): the same mechanism turned
  the asked-for dark brown, grey and purple tiles into vivid violet, ochre and silver fills whose edges cut across the
  slabs.

When this lands:
1. **A tint modulates, it does not replace.** A variant changes the ground's hue and brightness while the ground's own
   texture, bevels, cracks and lighting stay visible through it: the tinted pixel is the ground's shaded colour moved a
   bounded step toward the tint's hue and lightness (for example a multiply or a hue-preserving blend in a perceptual
   space), never a flat fill. On rendered pixels, the local contrast of the ground's texture inside a tinted tile
   (standard deviation of luminance over the tile) is at least 80 percent of the same tile untinted.
2. **Bands are quiet.** A decoration band differs from the untinted ground beside it by a small, even step: mean
   colour difference between a band and its untinted neighbour between about 4 and 10 CIE76 units on screen (visible
   as a change of ground, not as a coloured carpet), saturation raised by no more than a pinned amount; water (7) and
   mud (8) keep reading as water and mud (they may differ more: pin them from today's look).
3. **Band edges do not wobble across tiles' art.** Either the plane is sampled unwarped so an edge follows tile
   boundaries exactly, or the edge is softened over about half a tile so there is no hard line; the oracle author
   measures both on renders and the brief says which (the Sentenced slabs are one per tile: there the edge must follow
   the slab).
4. **The Sentenced floor's scattered tiles**, as the owner asked: per map tile, from a hash of the tile's coordinates
   (the engine-free `SentencedTiles.Family` of the reverted packet may be reused: its dispersal tests were sound), the
   slab stays the slab and takes one of: base stone, a lighter grey, a brown, a purple; on screen, under the zone's
   light away from lamps, each family's mean lightness is within a pinned band of the base slab's ("still relatively
   dark": no family more than about 25 percent lighter than the base slab on screen) and each differs from the base by
   hue or lightness by at least a pinned visible step; under a lamp the families still differ from each other.
5. **Sentenced on a landmark-mode map shows the scatter too:** the band and the scatter combine (both modulate), so
   the floor is not a set of pastel stripes; the oracle pins that a banded Sentenced tile still carries its family.
No zone's untinted ground changes. The Tab map and minimap tints are not this packet's.

## 2. Dependencies
P-UNITY-GROUND-SAMPLERS-1 (merged): this packet adds no texture and no sampler to the ground shader.

## 3. Relevant legacy paths
- `packages/client/src/render/zoneArt/zoneStyle.ts:28-32`, `palette.ts:32-35` (Sentenced floor and floorAlt); legacy
  has no bands.

## 5. Exclusive write scope
- `client-unity/UnityProject/Assets/Resources/Regions/RegionGround.shader` (the variant path only)
- `client-unity/UnityProject/Assets/Scripts/View/Regions/RegionGround.cs` (`BakeVariants` and what it writes into the
  plane), `client-unity/RoguehallaNet/Net/Ui/GroundVariantLook.cs` (the variants' looks) and
  `Net/Ui/SentencedTiles.cs` (new; + synced copies)
- not the plane's texture or sampler declarations, not `RhLocalLights.hlsl`/`RhSun.hlsl`, not the wire, not
  `rh-mapdress` (which tiles get which variant is the server's and stays)

## 7. Behaviour to preserve
- Untinted ground in every zone pixel-identical (the capture tool's ground-only comparison of
  P-UNITY-GROUND-SAMPLERS-1: at most one brightness step in a few hundred pixels).
- `DressedMapEditModeTests`, `DressedMap2EditModeTests` (a variant 7 or 8 tile still bakes its look), the Sentenced
  wall-top rule, the ground shader's Web compile test (at most 16 samplers).

## 8. Acceptance checks
- **Rendered pixels are the oracle.** The coordinator's capture tool renders the ground only, deterministically (see
  the hand-over in the dispatch: fixed shader time, `-lmGroundOnly`), and writes sRGB PNGs; the oracle author builds
  the measurements above on such renders (a test that runs the capture needs graphics and cannot run in the gate, so:
  an EditMode test that renders a small ground patch to a RenderTexture if the editor allows it under the gate's
  flags; if not, an engine-free mirror of the shader's variant formula pinned against the shader source, plus a
  committed measurement script the coordinator runs with the capture, and the brief says which is which).
- Red today: texture contrast inside a tinted tile, the band's colour step, the Sentenced families.
- Before and after screenshots from the Web client: the Fire landmark's rings, the Sentenced church yard on a
  landmark-mode map, the Sentenced floor without landmarks under lamps and away from them. The owner sees them.
- `scripts/gate.sh --quick --oracle packet/P-UNITY-GROUND-TINT-1` passes.

## 9. Validation commands
- `export PATH="$HOME/.dotnet:$PATH"; dotnet test client-unity/RoguehallaNet.Tests`
- `bash client-unity/UnityProject/Tools/editmode.sh`; then `git checkout --` any modified font asset under
  `client-unity/UnityProject/Assets/Resources/Showcase/`.

## 10. Risk and suggested model tier
Sonnet. The first attempt at the Sentenced floor passed every test and looked wrong: the tests measured a colour model,
not the screen. This packet's numbers must come from rendered pixels, and nothing is called done before the Web client
has been looked at.

## 11. Known traps
- The capture tool's Plague and Sentenced scenes are darker than the Web client (cause not found): use it for
  before/after differences and texture contrast, not for absolute brightness; absolute judgements come from Web
  screenshots.
- The zone light is strong and warm in Sentenced (lamps): a tint chosen on albedo is multiplied by it. Choose on
  screen colours.
- A server variant and a scatter family on the same tile must combine in a fixed order, the same on every client.

## Established facts (oracle author, 2026-11-13)

**Variant path today** (`RegionGround.shader`, Frag): it runs after the region blend and BEFORE the temple, terrain, lava light, sun, 2D lights, local lights and fog
grade. `vuv = (floor(t + warp * 0.35) + 0.5) / _Map.xy` (the same `warp` as the region borders, up to +-0.8 tile, so up to +-0.28 tile), point sample of
`_VariantTex` (sampler_TempleTex), then `col = lerp(col, vt.rgb, vt.a)`: a replacement of the ground's shaded colour by raw tint bytes, which the light then multiplies.
`BakeVariants` writes `(R, G, B, round(Strength * 255))` of `GroundVariantLook.TryGet(region, variant)` per tile, 0 for variant 0 and for an unknown variant (warns once).
`GroundVariantLook` today (sRGB bytes, strength): 1 = zone colour x 0.45 (a .30), 2 = zone colour mixed 40% to white (a .28), 3..6 = hue (205,75,45) a.45, (125,85,165) a.40,
(85,170,160) a.42, (215,170,70) a.38, each mixed 25% toward the zone colour (fire 150,70,40; sentenced 110,105,120; plague 70,110,60; frost 150,185,215; holy 205,180,110),
7 = water (45,105,175) a.62, 8 = mud (115,80,50) a.62 (same in every zone).

**Measured before** (`ground-tint-measure.py` on capture frames of today's tree). dE = CIE76 between mean Lab of the central 2x2 tiles banded vs the same tiles base; dC = change
of Lab chroma; dS = change of HSV saturation; dL = change of L*; contrast = std of L* inside a tile, banded / base; edge = 2nd to 98th percentile spread of the band edge
position over the patch rows, in tiles, from a strong-tint frame (nan = not measurable). HSV saturation FALLS under today's pastel fills (dS -0.1 to -0.6), so "saturation
raised" is checked as dC. The table is `scratchpad/gt/before2.txt`; the rows:

| zone | code | dE | dC | contrast | edge L/R | | zone | code | dE | dC | contrast | edge L/R |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| fire | 1 | 13.2 | +8.6 | .57 | - | | plague | 1 | 6.0 | -2.8 | .62 | - |
| fire | 2 | 29.7 | +1.6 | .33 | - | | plague | 2 | 20.4 | -6.3 | .53 | - |
| fire | 3 | 36.4 | +21.5 | .26 | .20/.33 | | plague | 3 | 20.6 | -9.5 | .80 | .19/.07 |
| fire | 4 | 27.3 | +0.5 | .30 | .35/.12 | | plague | 4 | 25.0 | -19.3 | .55 | .34/.02 |
| fire | 5 | 37.2 | -11.5 | .24 | .10/nan | | plague | 5 | 26.2 | -5.5 | .66 | .02/.02 |
| fire | 6 | 39.9 | +12.1 | .26 | nan | | plague | 6 | 24.7 | -0.8 | .56 | .07/.03 |
| fire | 7 | 45.5 | -15.5 | .22 | nan/.10 | | plague | 7 (water) | 35.8 | -13.6 | .37 | .03/.13 |
| fire | 8 | 30.6 | +4.6 | .20 | .07/.10 | | plague | 8 (mud) | 20.0 | -11.8 | .73 | .03/.07 |
| sentenced | 1 | 15.7 | +0.4 | .40 | - | | frost | 1 | 5.9 | -1.2 | .81 | - |
| sentenced | 2 | 36.6 | +0.2 | .26 | - | | frost | 2 | 3.2 | -2.8 | .71 | - |
| sentenced | 3 | 35.8 | +12.9 | .21 | .15/.11 | | frost | 3 | 12.7 | -8.8 | .64 | .19/.07 |
| sentenced | 4 | 34.3 | +13.2 | .22 | .22/.07 | | frost | 4 | 8.3 | +0.4 | .68 | .34/.02 |
| sentenced | 5 | 40.1 | +2.3 | .18 | 0/.07 | | frost | 5 | 4.8 | -1.8 | .59 | .02/.02 |
| sentenced | 6 | 40.8 | +7.5 | .16 | 0/.05 | | frost | 6 | 10.3 | -9.0 | .63 | .07/.03 |
| sentenced | 7 | 44.1 | +17.9 | .09 | .10/.03 | | holy | 1 | 9.7 | -9.2 | .67 | - |
| sentenced | 8 | 36.0 | +7.6 | .11 | .03/.08 | | holy | 2 | 23.0 | -15.4 | .46 | - |
| holy | 3 | 10.6 | -7.5 | .37 | .19/.07 | | holy | 4 | 27.9 | -25.5 | .50 | .34/.02 |
| holy | 5 | 31.5 | -20.1 | .36 | .02/.02 | | holy | 6 | 15.6 | -5.7 | .37 | .07/.03 |

(Codes 7 and 8 of Frost and Holy are in `before2.txt`; water and mud are real only in Plague.) Today's step is 3 to 50, texture contrast 0.09 to 0.81, edge
spread up to 0.48 tile (the warp). `--check` on this baseline: FAIL, 119 checks.
Web-client ground colours used by the gated tests (screenshots, mean of a plain patch): fire (181,116,63), sentenced slab (39,34,39), lit yard (120,116,123), beside a lamp (192,185,192),
plague grass (102,129,76), frost (154,200,221), holy (243,209,136). The capture's Fire (65,20,12) and Plague (32,68,27) are much darker than the Web's; Sentenced, Frost and Holy agree.

**The formula (ONE, pinned by the tests).** In the shader, replacing the `lerp(col, ...)` line and the warp in `vuv`:
```
float2 vuv = (floor(t) + 0.5) / _Map.xy;
col *= lerp(1.0, vt.rgb * (255.0 / 128.0), vt.a);
```
Per channel the gain is `1 + a * (R/128 - 1)`: texel byte 128 is neutral, 255 gives x1.99, 64 gives x0.5, `a` = 0 is no tint. Bounds: every channel gain in [0.40, 1.99]; a hue band (3..6)
keeps its Rec.709 luminance gain in [0.75, 1.30]. The gain acts on the framebuffer's linear colour, so screen' = encode(decode(screen) * gain). Checked on renders with a prototype shader:
the model matched within about 1 CIE76 unit in Sentenced (grey 2.8 model / 2.8 measured, brown 6.9/5.9, purple 9.0/8.5); in Plague the real step is about 60-80% of the model's
(post-processing colour crosstalk on green grounds). A throwaway reference implementation (per-zone strengths about .06 to .86; Sentenced family gains grey 1.35, brown (1.45,1,.65),
purple (1.05,.8,1.5); water (.6,1,1.8); mud (1.45,.85,.55); `Compose` = product of gains; `Bake` = band composed with the Sentenced family) passed ALL gated tests (dotnet 2030, EditMode 1282 with the
Web compile test and the DressedMap guards) and the script's `--check`. Its diff is `scratchpad/gt/reference-solution.patch`: a feasibility proof, not a design. It shows each zone needs its own
band strength (Sentenced about 3x Frost's) and that Sentenced ring 1 (darker) must be a hue-and-darkness tint (gain about (.85,.6,.75)), because a pure darkening large enough for a 4-unit step loses texture contrast.
Edges: with `floor(t)` the edge sits on the tile boundary (spread 0.000 on every zone and code in the reference run), on the slab grout lines. Decided: unwarped, hard, tile aligned; no softening.

**Thresholds adjusted from the brief.** (1) "Saturation" is checked as CIELAB chroma raised by at most 8, not HSV (above). (2) Band step 4 to 10 on the Web colours; on the capture colours the lower bound
is 1.5 (gated tests: 2) because its Fire and Plague are darker. (3) Texture contrast 0.80 on rendered tiles (script); the gated proxy (lightness gap between a tile's dark and light pixels, through the
mirror) is 0.75 because L* is steep near black. (4) Water and mud (Plague only): step 8 to 25 (Web), 5 to 25 (gated capture colours), 2.5 to 25 (script), direction kept (water B/R x1.5 and R/G falls;
mud R/G x1.25 and B/R x0.85): a multiply cannot make grass as blue as today's fill, so the water is the teal of round 9's Web screenshot. (5) Sentenced families, on the Web slab and the capture slab: grey L* x1.10 to 1.30
and step >= 2.5 (at the "no more than ~25% lighter" ceiling the step is only about 3); brown CIELAB hue 20 to 80 degrees, purple 270 to 340, step >= 5, L* x0.85 to 1.25; every pair >= 2.5 on the dark slab
and >= 5 on the lit yard and beside a lamp; the mix no more than 1.10 x the bare slab's L*. (6) Edge spread <= 0.04 tile (script).

**Rendering in the gate: impossible.** Under `-batchmode -nographics` `SystemInfo.graphicsDeviceType` is `Null`; `Graphics.Blit` then `ReadPixels` returns one constant colour (RGBA 0.804 everywhere; a plain
blit and the ground material both probed). So the gated oracle is engine-free and the real-pixel checks are the coordinator's.

**Gated (`gate.sh --quick`):** the mirror `GroundTint.Apply` as a per-channel gain, bounds, screen-colour steps per zone and code, contrast proxy, water and mud, `Compose`, `Bake` (other zones = the server
look only; Sentenced = family, band x family, an unknown variant keeps the family, pure function of coordinates), the Sentenced families on screen colours plus the dispersal tests of the reverted attempt
(they pass on the stub: they test `Family`), the shader source (contains `col *= lerp(1.0, vt.rgb * (255.0 / 128.0), vt.a);`, no `lerp(col, vt.rgb`, no `warp` in the variant block, still the
`SAMPLE_TEXTURE2D_LOD(_VariantTex, sampler_TempleTex` sample), and EditMode: `BakeVariants` equals `GroundTint.Bake` per tile, the scatter bakes on a Sentenced map without a server plane and turns
`_VariantOn` on, other zones untouched, a texel does not depend on the map size.
**The coordinator's (not gated):** `client-unity/UnityProject/Tools/ground-tint-measure.py <dir> --check` on capture frames of the implementation (step, chroma, contrast and edge on real pixels), then before and
after Web screenshots (Fire rings, Sentenced church yard in landmark mode, Sentenced floor under lamps and away). The capture tool is the uncommitted `LandmarkPreviewCapture.cs`; the flags this packet needs
(`-lmVariants`, `-lmPatches`, `-lmLabel`, `-lmZones`) are in the author's copy `scratchpad/gt/LandmarkPreviewCapture-groundtint.cs`; the run also needs the fixed-time patch (`RhSun.hlsl` reading `_RhFixedTime`,
`scratchpad/gt/fixedtime-rhsun.patch`, never committed) or frames drift. One process must render all three frames of a zone. The script's docstring has the command.

**Existing tests that pin the old look:** none needs amending. `DressedMapEditModeTests` and `DressedMap2EditModeTests` take their expected texels from `GroundVariantLook.TryGet` (rgb and
`round(strength * 255)`), so they stay green as long as `Bake` returns `TryGet`'s look unchanged outside Sentenced and `BakeVariants` writes it as today (confirmed by the reference run).

**Not pinned:** lamp-lit pixels on real renders (the capture has no lamps; lamp cases use Web-measured colours through the model); the Tab map and minimap; the `DEVIATIONS.md` row for the scatter (the
implementer proposes it); edges under lava heat shimmer (the measure runs on open floor); water and mud outside Plague; absolute Web brightness of the capture's Plague and Fire.

## Oracle files (read-only for implementers)
- `client-unity/RoguehallaNet.Tests/GroundTintScreen.cs`, `GroundTintFormulaTests.cs`, `SentencedFamiliesTests.cs`
- `client-unity/UnityProject/Assets/Tests/Editor/GroundTintBakeEditModeTests.cs` (+ `.meta`)
- `client-unity/UnityProject/Tools/ground-tint-measure.py` (the thresholds are in it)
- this packet. Stub commit (the implementer edits these): `Net/Ui/GroundTint.cs`, `Net/Ui/SentencedTiles.cs` (+ synced copies and metas), the `BakeVariants` wiring in `RegionGround.cs`.
- Routing: serves owner decision 3 and the 2026-11-13 Sentenced direction; tier implementer-sonnet; reviewer; D-rules D1 (presentation; DEV-021 covers bands, the scatter needs a row), no wire change.
- Red today: 14 dotnet tests and 1 EditMode test (the scatter). Green on the stub by design: dispersal and share tests, purity and non-Sentenced `Bake`, the bounds test, three EditMode guards.

## Notes from previous attempts
