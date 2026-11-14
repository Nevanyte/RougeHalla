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

## Notes from previous attempts
