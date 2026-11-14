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

## 4. New paths
- `client-unity/RoguehallaNet/Net/Ui/SentencedTiles.cs` (stub committed by the oracle author, the implementer fills it)
  and its synced copy `client-unity/UnityProject/Assets/RoguehallaNet/Net/Ui/SentencedTiles.cs` (+ `.meta`), by `bash client-unity/sync-net.sh`
- a `docs/DEVIATIONS.md` row proposed in the hand-off (presentation: legacy has two greys only)

## 5. Exclusive write scope
- `client-unity/RoguehallaNet/Net/Ui/SentencedTiles.cs` (+ synced copy): the family function and the family colours (data)
- `client-unity/UnityProject/Assets/Scripts/View/Regions/RegionGround.cs`: `BakeVariants` (bake the family tint on every
  region-2 tile, with or without a server variant plane) and the `_VariantOn` switch in `Create`
- `client-unity/UnityProject/Assets/Resources/Regions/RegionGround.shader` (the Sentenced ground branch only, and only if
  the existing `_VariantTex` blend needs a tweak for Sentenced, e.g. no ragged warp; no new texture, sampler or hash)
- `client-unity/UnityProject/Assets/Scripts/View/Regions/RegionThemes.cs` (the Sentenced entry only, if needed)
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

## Established facts (oracle author, 2026-11-13)

**Screenshots looked at.** Web shots 50 and 52: the floor is a tile grid, one stone per map tile with bevelled edges; away
from lamps it is a flat dark grey-violet, under lamps it blows out to cream (warm lamp light times a very low albedo, so
tile differences wash out). The editor render `church-wide.png` (too dark, known): shows the grid away from lamps, with some
tiles already a little lighter, purple or brown. Those come from the large-scale `macro` drift and the key-colour lerp, not
from a per-tile choice, and they are smooth blotches rather than tiles.

**1. How the floor is drawn today.**
- `RegionGround.shader` has no "Sentenced branch": every region goes through `ShadeRegion(id, layer, t, ...)` (shader:150-176).
  The stone pattern is baked, not computed: `RegionGroundTextures.Sentenced` (`RegionGroundTextures.cs:112-134`) bakes 4 x 4 square
  slabs per 4-tile period (`N = 4`; `uv1 = t * 0.25`, so one slab per map tile, the slab edges on the integer tile boundaries), grout,
  chamfer, height, and a per-slab hash `cellId = Hash01(col, row, 211)` with `col, row` taken modulo 4. The shader reads it as `lum = 1 + (g.r - 0.5) * par.x * 2` and
  `c = baseC * lum`, then `macro` (low-frequency `Fbm(t * .06)`, `par2.x = .22`), a drift to the key colour, moss patches (`g.g`), nothing else.
- Sentenced `GroundParams = (.55, .6, 0, 0)`, `GroundParams2 = (.22, 0, .15, 0)` (`RegionThemes.cs:104`); palette base (31, 30, 37), secondary (69, 56, 41),
  accent (147, 114, 200), key (231, 196, 153) (`RegionPaletteGenerated.cs:101-108`).
- **There is already a per-tile CPU-baked plane the ground shader samples:** `_VariantTex`, `RGBA32`, one point-sampled texel per map tile
  (rgb tint, a strength), `col = lerp(col, vt.rgb, vt.a)` after the regions are blended (shader:561-567, raw bytes like the palette), baked by
  `RegionGround.BakeVariants` (`RegionGround.cs:106-125`) from the server's `GroundVariants` plane through `GroundVariantLook.TryGet`
  (`RoguehalloNet/Net/Ui/GroundVariantLook.cs`), and `_VariantOn` is 0 unless some tile carries a tint. A map with no server variant bakes nothing.
  The sampling uv is `floor(t + warp * 0.35)`: the tint's tile edges wobble by up to about +-0.28 tile (the same warp as the region borders),
  so a family tint can cut through a slab's bevel: an implementer may want that off for Sentenced (shader Sentenced-only change, still no new sampler).

**2. Today's per-tile variation, measured.** The only per-tile variable is the slab hash, and it **repeats every 4 tiles in both axes**:
16 distinct slab tones (`tone = .52 + cellId * .26`), brightness only, hue untouched (all are multiples of the one base colour). The `lum` factors, sorted, are
1.028 1.032 1.033 1.036 1.046 1.061 1.064 1.074 1.086 1.087 1.117 1.126 1.207 1.245 1.250 1.298 (mean 1.11; reproduced from `RegionNoise.Hash`, before grout and wear).
One slab in the 4 x 4 period is cracked (0,0), four are missing/pitted (3,1) (0,2) (3,2) (3,3), one mossy (0,3). So: **one hue, 16 brightnesses, a 4-tile
period**, which reads as a faint repeating pattern. Measured real average of the shaded floor (`NameLegibleFloors`): 0x272223 (darkest decile 0x0E0D12, brightest 0x433937).
Albedo reference used by the oracle: the palette base (31, 30, 37) = CIE L* 11.64, relative luminance .01353.

**3. Legacy.** `zoneArt/palette.ts:32-35` (sentenced): floor 0x3a3b42 (58,59,66; L* 25.0), floorAlt 0x44454d (68,69,77; L* 29.5), floorMark 0x2c2d33.
`zoneStyle.ts:28-32`: `bits(hash, 0, 2) === 0 ? floorAlt : floor` (hash = `hashTile`, `artBase.ts:58-66`): one tile in four takes the slightly lighter grey.
No brown, no purple: the owner's families are **new** (a DEVIATIONS row). Legacy's lighter tile is the ceiling used for "lighter stone, not white": L* 30.

**4. Where the choice lives: recommendation (i).** An engine-free `SentencedTiles.Family(x, y)` (stub committed) whose result `RegionGround.BakeVariants` writes into
`_VariantTex`, the plane the shader already samples. Why: the test pins the very function that produces the pixels (`SentencedTilesEditModeTests` compares the baked
texels to it tile by tile, for two map sizes, and checks `_VariantOn`); no sampler or texture is added (P-UNITY-GROUND-SAMPLERS-1 safe); no second hash to keep in step with
HLSL integer maths (HLSL `uint` multiplies are fine but a shader formula could only be pinned by parsing source constants, which proves nothing about pixels); and the dotnet test
runs in the quick gate while the shader does not. Cost: the plane is now baked for every Sentenced map even without server variants (1 byte-ish per tile, once at load).
Server variants on a Sentenced tile keep their `GroundVariantLook` look (pinned); which wins when both exist is not otherwise pinned (recommended: the server's, it marks landmark bands).

**Albedo model of the oracle.** A family's albedo is `lerp(base, tint.rgb, tint.strength)` per sRGB byte channel (what the shader does to a base-coloured slab);
lightness is CIE L*. The base family bakes strength 0 (shader stone untouched, slab detail intact); other strengths must be .2 to .7 so the bevels and joints
(attenuated by `1 - strength`) survive. Dim light is modelled as linear albedo x 0.4 and a lamp as the key colour (231,196,153) as a linear multiplier; CIE76 delta E.

**Pinned bounds (all in `SentencedTilesTests.cs` unless noted).**
- 4 to 8 families; family 1 = lighter grey (L* at least base + 4, channel spread <= 14), 2 = brown (R > G > B, R - B >= 14), 3 = purple (B >= R, B - G >= 12, R - G >= 4).
- Shares over a 256 x 256 block (two origins, one at (3000,-2000)): base 50 to 67 percent; every other family 8 to 25 percent.
- Pure function: forward, reverse and shuffled call order give identical tables; negative and `int.Min/Max` coordinates are valid and vary.
- Dispersal: horizontal and vertical "same family" probability within 1 point of chance (sum of squared shares); per-family neighbour correlation (phi) at lags (1,0) (0,1) (1,1) (1,-1) at most .03;
  for every period 1..16 in x and in y the match fraction is at most chance + 3 points (chance itself at most 50 percent); longest straight run of one family at most 40 tiles
  (random expectation about 25 at a 67 percent base).
- Dark: every family L* 8 to 30; mean L* of the mix within +-10 percent of the base's 11.64 AND above it; each non-base family at least delta E 5.5 from every other family in neutral light, 3.5 (vs base) or 5.0 (vs each other)
  in dim light, 4.5 (vs base) or 5.5 (vs each other) under a lamp.
- Walls (EditMode): Timber wall-top variants measure luminance .153 to .307 today (3.19:1 to 5.62:1 over the bare base). Pinned: at least 2.9:1 over the mean floor luminance of the mix
  and at least 2.4:1 over the lightest tint (which caps the lightest tint at luminance about .034, L* 21), and the lightest tint at least 1.4 x the base luminance.
- Pixels (EditMode): `BakeVariants` bakes `Tint(Family(x, y))` on every region-2 tile, independent of map size, region 1/3/4/5/6/0 bake nothing, a server variant keeps its look, `_VariantOn` = 1 for a Sentenced
  map with no server variants and 0 for a Plague map, `_VariantTex` stays one texel per tile.
- Guards (pass today): other zones' `GroundParams`/`GroundParams2` unchanged; Sentenced palette base (31,30,37); Sentenced default surface is Flagstone (names choose their form by surface kind, so a name standing still does not flip between tile tints).

**Feasibility.** A throw-away reference (4 families, strength .6, albedos grey (42,43,50), brown (42,31,22), purple (36,26,48), a legacy-style 32-bit tile hash with thresholds .62/.745/.87)
passed every dotnet test; its numbers: mean L* 12.55 (+7.8 percent), delta E from base 6.1 / 12.9 / 11.7, wall ratio over the lightest tint 2.78:1. Not committed. Note the 10 percent mean bound is tight
in L*: the lighter grey cannot go much beyond L* 18 unless another family is darker than the base; that is deliberate ("still relatively dark").

**Not pinned (could not, or by design).** How it looks in the running Web client (owner judges before/after screenshots); the shader's ragged tile edge; behaviour under lamps beyond the linear-multiplier model
above (the lamp model ignores the shader's tone mapping, fog and the existing bloom); whether the tint blend keeps the grout visible on screen (only the strength cap is pinned); no state hash, no wire change.

**Baseline (this branch, before the stub is replaced).** `dotnet test client-unity/RoguehallaNet.Tests --filter SentencedTilesTests`: 9 of 9 fail on assertions (shares 100 / 0 / 0 / 0 percent, run of 256, delta E 0, chance 100 percent, ...). Full EditMode before the final commit: total 1266, 1262 passed, 4 failed, all four in `SentencedTilesEditModeTests` (bake empty, `_VariantOn` 0, lightest tint equals base,
map-size test sees no tint). The guards and the wall ratios pass on today's numbers.

## Oracle files (read-only for implementers)
- `client-unity/RoguehallaNet.Tests/SentencedTilesTests.cs`
- `client-unity/UnityProject/Assets/Tests/Editor/SentencedTilesEditModeTests.cs` (+ `.meta`)
- stub (implementer's to replace, not oracle): `client-unity/RoguehallaNet/Net/Ui/SentencedTiles.cs` and its synced copy

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
