# P-UNITY-SENTENCED-TILES-1: the Sentenced floor's tiles vary: browns, lighter greys and purples scattered among the dark stone

- **Serves:** owner direction 2026-11-13 (chat, after seeing the real Sentenced zone): "Sentenced lighting does in fact
  look much better, and isn't too mono coloured however some more tile random variance could help, with dark lighting it
  could still work, perhaps some brown tiles, lighter greys some purples all randomly dispersed (should still be
  relatively dark)"
- **Implementer tier:** implementer-sonnet (Unity presentation)
- **Reviewer:** reviewer; then the owner sees a before and after from the running Web client
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1: legacy's Sentenced floor is the reference (`packages/client/src/render/zoneArt/`, `palette.ts`);
  a difference from it is by owner direction and gets a presentation DEVIATIONS row · no wire change · no game rule

## 1. ID and outcome
The Sentenced zone's floor is a grid of stone tiles that are nearly all one dark grey-violet. The owner wants more
variety from tile to tile. When this lands:
- Each floor tile of the Sentenced zone takes one of several tints, chosen per tile: the base dark stone, a lighter
  grey, a brown, and a purple (the oracle author may add a second shade of each). Roughly half to two thirds of the
  tiles stay the base stone; each other family is clearly present (each at least about one tile in ten).
- **Randomly dispersed:** the choice comes from a hash of the tile's map coordinates, so it is the same on every
  client and every visit, has no visible stripes, checkerboard or repeat, and neighbouring tiles are no more alike
  than chance.
- **Still relatively dark:** the floor's average brightness stays within about 10 percent of today's; the lighter
  greys are lighter stone, not white; under the zone's dim light away from lamps the variety is still visible (the
  owner: "with dark lighting it could still work").
- Walls, fences, headstones and props stay readable on every tile tint: the wall-top rule of P-UNITY-SENTENCED-READ-1
  (wall top at least twice the floor's luminance) holds against the average floor, and against the lightest tile tint
  the wall top is still clearly lighter (the oracle author pins a ratio from today's numbers).
- The church's yard and the graveyard keep the same floor rule (they are Sentenced floor); nothing changes in the other
  zones or on the Tab map and minimap (their zone tints stay).

## 2. Dependencies
none

## 3. Relevant legacy paths
- `packages/client/src/render/zoneArt/` (the Sentenced ground), `packages/client/src/render/palette.ts`: how legacy
  varies its Sentenced tiles, if it does. Where legacy already has these tints, use its colours.

## 5. Exclusive write scope
- `client-unity/UnityProject/Assets/Resources/Regions/RegionGround.shader` (the Sentenced ground branch only)
- `client-unity/UnityProject/Assets/Scripts/View/Regions/RegionThemes.cs` (the Sentenced entry only),
  `RegionGroundTextures.cs` / `RegionGround.cs` only if the tints are baked into a texture there
- an engine-free helper for the tile choice under `client-unity/RoguehallaNet/Net/Ui/` (+ synced copy) if the oracle
  pins the hash there
- not the other zones' ground, not `RhLocalLights.hlsl` (P-UNITY-GROUND-SAMPLERS-1 is working in the same shader's
  samplers: this packet adds NO texture or sampler to the ground shader), not any existing test

## 7. Behaviour to preserve
- `RegionThemeEditModeTests` (the Sentenced contrast test), `Tools/contrast-gate.cjs`, name legibility on this floor
  (P-UNITY-NAME-LEGIBLE-1: names follow the surface under them: with lighter tiles a name may flip between its dark and
  light form from tile to tile: check it and pin that it does not flicker while standing still).
- The ground shader's sampler count does not grow (see P-UNITY-GROUND-SAMPLERS-1).

## 8. Acceptance checks
- Engine-free or EditMode: over a large block of Sentenced floor tiles the tint families occur in the pinned
  proportions; the choice is a pure function of the tile coordinates; the lag-1 correlation between neighbouring
  tiles' families (horizontally and vertically) is near zero and no period up to 16 tiles repeats; the mean luminance
  is within 10 percent of today's; the wall-top ratios above. Red today (one tint family).
- Screenshots from the running Web client (the coordinator), before and after, the same place under lamps and away
  from them; the owner sees them.
- `scripts/gate.sh --quick --oracle packet/P-UNITY-SENTENCED-TILES-1` passes.

## 9. Validation commands
- `export PATH="$HOME/.dotnet:$PATH"; dotnet test client-unity/RoguehallaNet.Tests`
- `bash client-unity/UnityProject/Tools/editmode.sh`; then `git checkout --` any modified font asset under
  `client-unity/UnityProject/Assets/Resources/Showcase/`.

## 10. Risk and suggested model tier
Sonnet. A look change judged by the owner; the numbers keep it honest (dispersed, still dark, walls readable).

## 11. Known traps
- A hash computed in the shader must match the engine-free one the tests pin, or the test proves nothing about the
  pixels: either compute the choice on the CPU into data the shader already reads, or pin the shader's formula by
  reading it and say how the two are kept the same.
- Lamp light is warm and strong: a brown tile under a lamp and a grey tile under a lamp must still differ.
- The capture tool's Sentenced scene is darker than the Web client: judge on Web screenshots.

## Notes from previous attempts

**Attempt 1 (2026-11-13): built, reviewed LAND WITH NOTES, then reverted by the coordinator before any push.** The
packet's oracle modelled tile colours as albedo against the palette base (31, 30, 37). The real ground is a shaded
texture far from that base under a strong zone light, and the tint reached the screen as `lerp(col, tint, 0.6)` on the
ground's per-tile variant plane: a flat fill that removes the slab's bevel and speckle, sampled at a warped
coordinate so its edges cut across the slabs. In the running client (round 10, `shots10/120`) the tiles are vivid
violet, ochre and silver, not "relatively dark". The flat patches the owner approved did not predict it. On a
landmark-mode map the scatter is not visible at all: the server's decoration band covers every open Sentenced tile
and overrides it. Rebuilt under P-UNITY-GROUND-TINT-1 with an oracle on rendered pixels.
