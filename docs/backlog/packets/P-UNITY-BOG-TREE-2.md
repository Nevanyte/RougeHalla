# P-UNITY-BOG-TREE-2: the bog tree reads as a tree (a visible trunk under a lifted, sunlit crown)

- **Serves:** owner decision 4 (2026-11-10: "a giant bog tree near the outer edge" of Plague); owner preference
  2026-11-13 (chat): "Bog can even be a light and more cheery bog, thinking a sunny bog in Florida or New Orleans area"
- **Implementer tier:** implementer-sonnet (Unity presentation)
- **Reviewer:** reviewer
- **Integration base:** feature/unity-rework (the five landmark arts, the seams packet and the look tools merged)
- **D-rules touched:** D1 n/a (presentation; DEV-020) · D2 n/a · D5/D6/D9 none · no wire change · no game rule in Unity

## 1. ID and outcome
Seen in the running Web client and the corrected renders (2026-11-13): the bog tree's crown is a mid-dark green mass
lying on the ground in the ground's own hue, and it covers 92.7% of the trunk's top third, so the landmark reads as
mossy boulders. Two changes, the first structural and reusable, the second art:

1. **A landmark's fade set may be wider than its cover.** Today one set (`Landmark.SetCover`, `Landmark.cs:71`) is
   both "the tiles under the roof" and "the tiles on which an actor fades the roof" (`Fades`, `:79`). A crown lifted
   off the ground overlaps, on screen, tiles north of its cover, and an actor standing there would be hidden without
   the crown fading. When this lands an art may hand over a second set, the fade set (`Landmark.SetFadeTiles` or the
   name the oracle author picks); `Fades` reads it when present and the cover otherwise, so the cave, church, hall
   and volcano are unchanged. `RoofCovers` keeps meaning the cover.
2. **The bog tree is a bald cypress.** A buttressed grey-brown trunk standing clearly taller than the wall blocks,
   visible from the south below the crown for at least 40% of its height; a feathery light-green crown lifted above
   the trunk (drawn higher on screen, not on the ground), with gaps the sky-lit ground shows through and grey-green
   Spanish moss hanging at its rim; the stumps are cypress knees. The crown's fade set is every tile it overlaps on
   screen. Brightness and hue separate the parts: against Plague grass (L 0.183, hue 92 in the Web client) the trunk
   differs by hue (grey-brown, not green) and the crown's lit masses are at least 2.5:1 brighter.

## Established facts (verified at the base, 2026-11-14)
- Fade today: `Landmark.SetCover` (`Landmark.cs:71`) stores the mask `_roofMask` and sets `_coverSet`; `Fades` (`:79`) reads the cover when
  `_coverSet`, else the interior (`_interior`, never the wall tiles). `RoofCovers` (`:61`) reads the mask. So on the cave (no `SetCover`) Fades is the
  interior while RoofCovers also covers the wall tiles: "Fades equals the cover" holds on floor tiles only (the guard tests floor tiles). `Fades` is
  `internal`; tests go through `LandmarkView.NoteActor/NoteOtherActor/Tick` (`LandmarkView.cs:62,71,81`).
- The bog tree art is `BogTreeLandmark.Build` (`BogTreeLandmark.cs:33`): cover = trunk group plus dry floor within distance 3 (275 tiles in every
  orientation) via `SetCover`; one parent object `TrunkName` with one strip sprite per tile row (`PaintBark`, strips on the walls' order rule);
  stumps `StumpName`; the crown is ONE sprite from `PaintCanopy` (`:348`), 8 px per unit (`CanopyPpt`), the roof renderer.
- Crown geometry today: `lift = 0f` (`:354`); `Thick .4`, `North .45`, `Side .33`; the sprite spans the cover's bounding box in u and from the cover's
  south row (`sB = -(maxY+1)*Sq`) up to `-minY*Sq + lift + Thick + .5`, so it hangs over the whole cover, 3 tiles south of the trunk. The gaps are
  painted as a dark OPAQUE colour (`gap`, alpha 255); only the rim and corners are transparent. Moss hangs under the south rim inside the cover.
- Trunk constants: `RootH .72` (clears the wall face .67), `BoleH 1.75` (`:27`, private). The trunk group is 11 tiles tall in the drawing, so the
  trunk's sprite bounds (all strips) are about 8.4 units high, dominated by the ground spread of the roots, not by the bole.
- Measured on today's tree (EditMode; orientations 0 / 1 / 4): trunk bounds midpoint y -15.34 / -14.96 / -17.71, crown bottom y -24.18 / -24.18 /
  -26.52 (world y = -tile y * `GroundSquash` .78; the footprint's top is y -5.46): the crown bottom is 8.8 units BELOW the midpoint. Enclosed
  transparent share of the crown's opaque box 1.3% (orientation 0), 1.2% (5). The crown's brightest-quartile mean has relative luminance 0.189
  against 0.200 for the Web grass (104, 132, 77), a ratio of 0.95. The trunk's mean hue is brown, already outside the green band.
- The brief's "grass L 0.183" does not reproduce: Rec. 709 luminance of the Web grass colour (104, 132, 77) in linear light is 0.200. The oracle
  uses the colour (`docs/unity/LOOK_CHECK.md:91`), not the 0.183.

## Stub surface (commit `stub:`; the implementer replaces it)
- `Landmark.SetFadeTiles(IEnumerable<MapTile>)`: compiles, stores nothing. Real behaviour: it stores a second mask; `Fades` reads it when set (tiles
  outside the footprint ignored), else the cover or interior as before; `RoofCovers` unchanged.
- `BogTreeLandmark.CrownName` = "Bog tree canopy" (public const): the crown's sprite object, which the tests find by name (exactly one, also a roof
  renderer). Rename the object only by changing this constant. Any extra roof piece (a ground shadow, see below) uses another name.

## Corrections and conflicts found in the brief (read before starting)
1. **An existing test conflicts with a lifted crown.** `BogTreeLandmarkEditModeTests.TheCanopyIsDrawnOverEveryCoverTileAndNoTileOutside...`
   (lines 241-258) requires the roof layer's union bounds to reach every one of the 275 cover tiles (give or take half a tile), including the ring 3
   tiles SOUTH of the trunk; `TheCanopysCoverIsExactlyTheTrunkGroup...` pins the cover at 275 tiles. A crown whose bottom edge is above the trunk's
   midpoint (new test) cannot reach them. Two ways out; the implementer may not edit tests: (a) add a second roof renderer (a soft ground shadow of
   the crown on the cover ring, a name other than `CrownName`, the roof's alpha, under actors) so the roof layer's UNION still reaches the cover; no
   test edit; or (b) the owner approves relaxing that one assertion. The oracle author did not touch the test. Default to (a) and say so in the
   hand-off; if (a) reads badly in the renders, the packet goes back to the coordinator for (b).
2. The same test forbids the roof layer reaching any tile outside the footprint (top y -5.46): the crown is lifted INSIDE the footprint, so its height is
   bounded. In orientation 1 its bottom must be at or above y -14.71 (midpoint plus margin) and its top at or below -5.46: at most about 9 units (11
   tile rows), against about 15 rows today.
3. `NothingButTheCanopyPaintsOpaquelyOnTheMarshOrTheGroundFarFromTheTreesWood` (lines 364-379): every NON-roof sprite (trunk strips, stumps) must be
   transparent on floor tiles outside the cover with no wall within 2 tiles (Chebyshev). A taller trunk may rise over the cover; it must not rise over
   open bog beyond that. Roof pieces are exempt.
4. The existing fade test (`TheCanopyFadesForAnActorOnTheDryGround...`, lines 262-297) names five tiles per orientation that must NOT fade the roof
   (`Bog.First()`, `Bog.Last()`, `CausewayBeyond` first and last, `DryOutside[0]`): the fade set must not contain them. They lie at the footprint's far
   rim; a crown inside the top 11 rows should be clear of them, but check all eight orientations.
5. "Every tile the crown's screen rectangle overlaps": the oracle uses every tile under the crown's OPAQUE pixels (alpha >= 128), not the sprite
   rectangle. The rectangle's transparent corners hide no actor, and a rectangle fade set would reach the tiles of item 4. It also requires the crown
   to paint nothing outside the footprint (a fade set cannot reach beyond it).
6. "Fades equals the cover on the cave": true on floor tiles only (see the facts); the guard reads floor tiles.
7. Section 7 claims checked: the trunk group, stumps, names, disposal and the roof rule are pinned by `BogTreeLandmarkEditModeTests`,
   `LandmarkViewEditModeTests` and `LandmarkRoofPeekEditModeTests` as stated. "No art outside the footprint" is pinned for the roof layer only
   (item 2); item 3 is the trunk's nearest test. "Nothing per frame" is pinned by `AFrameWhereNothingChangedCreatesAndAllocatesNothing` (line 385).
8. "Red today" for the trunk hue check does not hold: today's bark is already brown. It is a guard (green today).

## What the oracle pins (and how)
Tests: `BogTreeCrownEditModeTests` (new). Crown = the sprite named `BogTreeLandmark.CrownName`; trunk = every sprite under the object `TrunkName`.
- Fade set (church-kind override with a hand-made cover and fade set; red today): the local player on a fade-only tile fades the roof to
  `RoofFadedAlpha`, another visible actor makes it peek, tiles in neither set stay opaque, `RoofCovers` is false on the fade-only tiles and true on the
  cover. Guards (green today): no fade set on the church override; on the cave every non-wall footprint tile fades iff `RoofCovers`.
- Lift (8 orientations; red today): crown bounds bottom >= trunk bounds vertical midpoint + 0.25 (a quarter of the bole above the roots,
  `BoleH - RootH` = 1.03 today), and (crown bottom - trunk bottom) / trunk height >= 0.40, the trunk's visible share below the crown. Both from
  `Renderer.bounds` (the trunk bounds is the union of all strips). The second is implied by the first; it stays as the brief's own number.
- Fade tiles (8 orientations; red today): every tile under an opaque crown pixel (tile x = floor(world x), tile y = floor(-world y / `GroundSquash`),
  from the sprite texture) fades the roof for an actor there; the crown paints nothing outside the footprint.
- Gaps (orientations 0 and 5; red today): the share of the crown's opaque bounding box that is transparent and enclosed (opaque pixels left, right,
  above and below in its row and column) is >= 5%, and the crown still paints >= 25% of that box opaquely.
- Colour (orientations 0 and 5), on ALBEDO: the textures' pixels before the sprite shader's light, fog and exposure, not the screen colour, while the
  grass reference is a lit Web-client screen colour; they compare only roughly. A floor on albedo is still useful: light on a sprite does not turn
  a dark albedo into a bright sunlit mass, so a dark painted crown cannot pass by lighting, and it stops a return to a green mass.
  (a) The trunk's mean opaque colour (alpha >= 128, all strips) has HSV hue outside 70..170 degrees (the green band): GREEN TODAY, a guard.
  (b) The crown's lit colour (mean sRGB of the brightest quartile by luminance of its opaque pixels) has Rec. 709 relative luminance (linear
  light) >= 2.5 x that of (104, 132, 77), i.e. >= 0.4995. Red today at 0.189.
- Loose by design: the numbers are floors; the renders decide whether it reads as a tree.

## Baseline (packet/P-UNITY-BOG-TREE-2 at the oracle commit)
`bash client-unity/UnityProject/Tools/editmode.sh`: 1459 tests, 1438 pass, 21 fail, all in `BogTreeCrownEditModeTests`, on assertions:
- `AFadeSetWiderThanTheCover...` (1): expected alpha 0.2, was 1.0 (the stub stores nothing).
- `EveryTileTheCrownPaintsOverFades...` (8): e.g. tile (9, 26); expected 0.2, was 1.0.
- `TheCrownIsLiftedAboveTheTrunksMidpoint...` (8): e.g. crown bottom -24.18 against a floor of -15.09 (orientation 0).
- `TheCrownTextureHasTransparentGaps...` (2): 0.013 and 0.012 against 0.05.
- `TheCrownsLitColour...` (2): 0.189 against 0.4995.
Green: the two "without a fade set" guards and `TheTrunksMeanColourIsNotGreen` (both orientations).

## 2. Dependencies
P-UNITY-LANDMARK-4, P-UNITY-LANDMARK-SEAMS-1, P-UNITY-LANDMARK-ROOF-RETURN-1, P-UNITY-LOOK-TOOLS-1 merged.

## 3. Relevant legacy paths
none (DEV-020: the landmarks are new)

## 5. Exclusive write scope
- `client-unity/UnityProject/Assets/Scripts/View/Regions/Landmarks/Landmark.cs` (the fade set only)
- `Landmarks/BogTreeLandmark.cs` (the `CrownName` constant is in the stub; keep it, or change it together with the art)
- `docs/unity/DIALS.md` (rows for the tree's looks-only numbers) and `Assets/Editor/Look/scenes.txt` if a scene is added
- not `LandmarkView.cs`, not `ArenaView.cs`, not the other arts, not shaders, not any existing test

## 7. Behaviour to preserve
- What the structure tests pin (`BogTreeLandmarkEditModeTests`): the trunk group and stumps come from delivered
  tiles, the object names (`TrunkName`, `StumpName`), disposal leaves nothing behind, the roof rule (local player
  20%, another visible actor 50%, nobody opaque).
- No art outside the anchor's footprint padding the framework allows; nothing per frame.
- The crown hides only actors on its fade set, and fades for them (C-OBS is not involved: only drawn actors count).

## 8. Acceptance checks
- EditMode (red today): with a fade set handed over, an actor on a fade tile outside the cover fades the roof, and
  `RoofCovers` is still the cover; without one, behaviour is today's (guard, on the cave).
- EditMode (red today): on the approved bog tree drawing the crown sprite's bottom edge is above the trunk sprite's
  vertical midpoint by the margin the oracle author states, the crown texture has transparent gaps (a stated share
  of its bounding box), and every tile the crown's screen rectangle overlaps is in the fade set.
- Engine-free or EditMode colour check on the painted textures: the trunk's mean hue is outside the green band and
  the crown's lit colour is at least 2.5:1 against the measured grass colour.
- The look check (`docs/unity/LOOK_CHECK.md`): `bog-wide` and `bog-close` before and after, attached to the hand-off.
  The owner sees it only from a Web round (`docs/unity/WEB_ROUND.md`).
- `scripts/gate.sh --quick --oracle packet/P-UNITY-BOG-TREE-2` passes.

## Oracle files (read-only for implementers)
- `client-unity/UnityProject/Assets/Tests/Editor/BogTreeCrownEditModeTests.cs` (and its `.meta`)
- The existing structure tests stay read-only and green, see "Corrections" 1-4: `BogTreeLandmarkEditModeTests.cs`,
  `LandmarkSeamsEditModeTests.cs`, `LandmarkRoofPeekEditModeTests.cs`, `LandmarkViewEditModeTests.cs`.

## 9. Validation commands
- `bash client-unity/UnityProject/Tools/editmode.sh`
- `client-unity/UnityProject/Tools/look-capture.sh bog-wide bog-close --out <dir>`

## 10. Risk and suggested model tier
Sonnet. Numbers are a floor: the renders decide whether it reads as a tree.

## 11. Known traps
- The editor render of Plague is darker than the Web client (grass 40,75,37 against 104,132,77): compare with a Web
  screenshot before judging brightness.
- Lifting the crown without widening the fade set hides actors north of the tree: the first change exists for this.
- Sprite order: the crown sorts above actors on its fade set and below the HUD's world marks, as the roofs do.

## Notes from previous attempts
