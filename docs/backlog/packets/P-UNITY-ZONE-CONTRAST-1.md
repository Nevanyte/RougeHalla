# P-UNITY-ZONE-CONTRAST-1: in the Plague and Sentenced zones the subjects stand apart from the ground and from each other

- **Serves:** owner direction 2026-11-13 (chat, on the first real renders of the landmarks): "my core issue is that there
  is very little visual contrast between subjects in both the plague and sentenced region. Very mono coloured."; owner
  decision 4 (one landmark per zone) and lane A's P-UNITY-SENTENCED-READ-1 (walls readable in Sentenced)
- **Implementer tier:** implementer-sonnet (Unity presentation)
- **Reviewer:** reviewer; then a visual review of renders before anything is shown to the owner
- **Integration base:** feature/unity-rework after the five landmark arts and the sprite-colour shader fix
- **D-rules touched:** D1: legacy's palette is the reference where it has one (`packages/client/src/render/palette.ts`);
  a difference from it is a presentation deviation row · no wire change · no game rule in Unity

## 1. ID and outcome
Seen in the renders of 2026-11-13 (session scratchpad, `landmark-shots/church-*.png`, `bog-*.png`): the Sentenced zone
is near-black violet-grey everywhere and the Plague zone is dark green everywhere. Ground, walls, fences, props, the
landmark art and an actor differ by a few percent of brightness and not at all by hue. Two causes, both the game's own
(the capture runs `ArenaView`'s real light set-up):
1. **The zone light.** `View/Atmosphere/RegionAtmosphereTable.cs` gives Sentenced a sun strength of 0.24 with ambient
   light cut to 0.45x, and Plague 0.55 with ambient at 0.42x and a green-filtered light (Holy, which reads well, is the
   brightest). A strongly tinted, dim light multiplies every colour toward one hue.
2. **The palettes.** Each zone's ground, wall, prop and landmark colours sit in one hue family (`RegionThemes.cs`,
   `RegionPropArt.cs`, `Landmarks/ChurchLandmark.cs`, `Landmarks/BogTreeLandmark.cs`).

When this lands, in both zones, at play zoom and under the zone's own light:
- **Each subject class separates from the ground by brightness.** Measured on the colour that reaches the screen (the
  theme or art colour after the zone's light), the luminance contrast ratio against the zone's base ground is at least:
  wall tops 2.0, low obstacles (fences) 2.0, tall props 1.8, flat props 1.5, landmark art (its dominant colours) 2.0,
  hazard terrain (bog, crevasse) 1.6. Actors already carry their own outline and are not this packet's.
- **The zone is not one hue.** Among the ground, the walls, the props and the landmark, the screen colours span at
  least three hue families at least 40 degrees apart, each used by at least one subject class a player meets often
  (not a single rare prop). Plague keeps its identity (sickly greens) and gains others: for example bark and roots in
  dark red-brown, fungus and lanterns in pale yellow or orange, stone in cool grey, water in teal. Sentenced keeps its
  identity (cold stone at dusk) and gains others: warm lantern and window light, rust and dried blood, bone-pale
  headstones, dead grass in ochre.
- **The zone is not dark.** The base ground's screen luminance is at least 0.08 (relative luminance, 0 to 1) in both
  zones; today's values are measured and written down by the oracle author. A zone may be moody; it may not be a black
  screen with dots.
- **The landmarks read in their zones.** The bog tree's trunk and roots are a different hue and clearly lighter than
  the marsh; its canopy's leaf masses differ from the ground by the ratio above and show the trunk's top through a gap
  or at its edge, so it reads as a tree and not a mound. The church's roof slopes differ from each other and from the
  walls by at least 1.3; its lower slope is not near-black.
The other three zones are unchanged, and no gameplay information changes colour meaning (hazard colours, the map tints,
team and rarity colours stay).

## 2. Dependencies
The five landmark arts (P-UNITY-LANDMARK-1 to -5) and the `RegionSpriteLit` colour fix merged.

## 3. Relevant legacy paths
- `packages/client/src/render/palette.ts` (zone palettes), `packages/client/src/render/zoneArt/` (per-zone ground and
  prop colours). Legacy is flat-lit: it has no zone light. Where legacy's own palette for these zones has the hue
  variety asked for, use its colours; where it does not, the new colours are a deviation (DEV row, presentation).

## 5. Exclusive write scope
- `client-unity/UnityProject/Assets/Scripts/View/Atmosphere/RegionAtmosphereTable.cs` (the Sentenced and Plague rows only)
- `client-unity/UnityProject/Assets/Scripts/View/Regions/RegionThemes.cs` (those two zones' entries only),
  `RegionPropArt.cs` (those zones' prop colours only), `RegionPaletteGenerated.cs` only through its generator if it has one
- `Landmarks/ChurchLandmark.cs`, `Landmarks/BogTreeLandmark.cs` (colours and, for the bog tree, the canopy's gap; no
  change to what the structure tests pin)
- an engine-free helper for the measurements if needed under `client-unity/RoguehallaNet/Net/Ui/` (+ synced copy)
- not the other three zones, not shaders, not `ArenaView.cs`, not the wire, not any existing test

## 7. Behaviour to preserve
- Every existing test, including `RegionThemeEditModeTests` (Sentenced wall top at least twice the floor's luminance,
  P-UNITY-SENTENCED-READ-1), the landmark structure tests, and `Tools/contrast-gate.cjs`.
- Names stay legible on these grounds (P-UNITY-NAME-LEGIBLE-1: a name's face and outline follow the surface under it).
- Hazard terrain keeps its meaning and stays distinguishable from safe ground (bog from grass, fence from floor).

## 8. Acceptance checks
- EditMode or engine-free: the ratios, the hue spread and the ground luminance floor above, computed from the theme,
  prop and landmark colours after the zone's light as the shaders apply it (the oracle author establishes that formula
  from `RegionSpriteLit.shader`, `RegionGround.shader`, `RhSun.hlsl` and the atmosphere table, and says how close the
  computed colour is to a rendered pixel). Red today for both zones; guards for the three zones that must not change.
- Renders (the coordinator's capture tool, before and after, same camera): `church-wide`, `church-close`, `bog-wide`,
  `bog-close`, plus one ordinary scene per zone with walls, a fence, props and an actor. A visual review compares them
  before the owner sees them.
- `scripts/gate.sh --quick --oracle packet/P-UNITY-ZONE-CONTRAST-1` passes.

## 9. Validation commands
- `export PATH="$HOME/.dotnet:$PATH"; dotnet test client-unity/RoguehallaNet.Tests`
- `bash client-unity/UnityProject/Tools/editmode.sh`; then `git checkout --` any modified font asset under
  `client-unity/UnityProject/Assets/Resources/Showcase/`.
- The capture: copy `LandmarkPreviewCapture.cs` from the coordinator's capture worktree (path in the dispatch) into
  `Assets/Scripts/View/Regions/` untracked, run it with graphics, look at the PNGs, never commit it.

## 10. Risk and suggested model tier
Sonnet. The numbers are a floor, not the goal: a palette can meet every ratio and still look wrong, which is why the
renders and the visual review are part of acceptance.

## 11. Known traps
- Raising a zone's light changes every sprite in it, including actors and loot: check an actor and a ground item in the
  renders; do not wash the zone out (Holy's brightness is not the target; the zones keep their mood).
- The Plague ground is partly a shader (`RegionGround.shader` with `GroundParams`) and partly painted (`PlagueGround`):
  both must move together or the seams show.
- `RegionPaletteGenerated.cs` may be generated: find its generator before editing it by hand.
- The oracle's formula is an approximation of the shader: state its error, and do not tune colours to the formula's
  decimals.

## Notes from previous attempts
