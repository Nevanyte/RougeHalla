# Unity presentation dials

Named looks-only values a Sonnet agent may change through the [tuning lane](../agent/TUNING_LANE.md). One row per
dial. "Range" is what the pinning test allows; "Scene" is what to render in the [look check](LOOK_CHECK.md).
A value that is not in this table is not a dial yet: adding one is a packet.

| Dial | What the owner sees | File and symbol | Value | Range | Pinned by | Scene |
|---|---|---|---|---|---|---|
| `roof-faded` | How solid a landmark's roof or canopy stays while your own character is under it | `Assets/Scripts/View/Regions/Landmarks/LandmarkView.cs` `RoofFadedAlpha` | 0.2 | above 0, at most 0.3 | `LandmarkRoofPeekEditModeTests` (the constants test) | `cave-inside` |
| `roof-peek` | How solid the roof is while you are outside and someone you can see is under it | same file, `RoofPeekAlpha` | 0.5 | 0.4 to 0.6 | same test | `cave-inside` with the actor outside |
| `roof-fade-rate` | How fast roofs and tall props fade in and out | `RoguehallaNet/Net/Ui/PropFade.cs` `FadeRate` | 9 (alpha units per second) | as `PropFadeTests` pins | `PropFadeTests` | `cave-inside` |
| `bog-tree-bole-height` | How tall the bog tree's trunk stands above the ground (the crown's lift follows the trunk's drawn height) | `Assets/Scripts/View/Regions/Landmarks/BogTreeLandmark.cs` `BoleH` | 2.7 (world units) | 2.0 to 2.7 (above 2.7 the trunk's drawn box reaches a free stump's tile: `OneTrunkObjectSpansEveryTileOfTheTrunkGroupAndNotTheFreeStumps`) | `BogTreeLandmarkEditModeTests`, `BogTreeCrownEditModeTests` | `bog-wide`, `bog-close` |
| `bog-tree-crown-lift` | How far the crown's lowest edge (moss included) sits above the middle of the trunk's drawn height | `Assets/Scripts/View/Regions/Landmarks/BogTreeLandmark.cs` `CrownLiftMargin` | 0.35 (units) | 0.25 to 0.8 | `BogTreeCrownEditModeTests` (lifted above the midpoint, trunk visible share) | `bog-wide`, `bog-close` |
| `bog-tree-crown-top` | How far under the footprint's top edge the crown ends | `Assets/Scripts/View/Regions/Landmarks/BogTreeLandmark.cs` `CrownTopGap` | 1.0 (units) | 0.85 to 1.6 (less and the crown fades for the bog tile at the footprint's top rim) | `BogTreeLandmarkEditModeTests` fade test | `bog-wide`, `bog-close` |
| `bog-tree-crown-moss` | How long the longest hanging moss strand is | `Assets/Scripts/View/Regions/Landmarks/BogTreeLandmark.cs` `CrownMossLength` | 1.1 (units) | 0.3 to 1.6 | `BogTreeCrownEditModeTests` | `bog-wide`, `bog-close` |
| `bog-tree-crown-shape` | How boxy the crown's outline is (2 is an ellipse) | `Assets/Scripts/View/Regions/Landmarks/BogTreeLandmark.cs` `CrownShape` | 2.25 | 2.0 to 3.0 | `BogTreeCrownEditModeTests` (fade tiles stay inside the footprint) | `bog-wide`, `bog-close` |
| `bog-tree-crown-gaps` | How much sky shows through the crown (the noise level above which there is a gap; lower is more sky) | `Assets/Scripts/View/Regions/Landmarks/BogTreeLandmark.cs` `CrownGapAmount` | 0.58 | 0.5 to 0.68 | `BogTreeCrownEditModeTests` (enclosed gap share at least 5%, crown at least 25% opaque) | `bog-wide`, `bog-close` |
| `bog-tree-shadow` | How dark the crown's shadow on the ground is at its darkest | `Assets/Scripts/View/Regions/Landmarks/BogTreeLandmark.cs` `ShadowAlpha` | 0.36 | 0.2 to 0.5 | none (looks only; keep the shadow's alpha under 0.5) | `bog-wide`, `bog-close` |
| `bog-tree-knee-height` | How far a cypress knee stands above the root height | `Assets/Scripts/View/Regions/Landmarks/BogTreeLandmark.cs` `KneeRise` | 0.75 (units) | 0.4 to 1.0 | `BogTreeLandmarkEditModeTests` marsh test | `bog-wide`, `bog-close` |
| `band-edge-warp` | How far a decoration band's outline wanders (tiles; times the noise's own small amplitude) | `Assets/Resources/Regions/RegionGround.shader` `RH_BAND_WARP` | 1.5 | 0.8 to 2.0 (below 0.8 the outline reads as a blurred rectangle: `band-outline-check.sh` longest straight run above 1.5 tiles) | `band-outline-check.sh --max 1.5` (render; not in the gate) | `plague-scene-dressed` |
| `band-edge-noise-scale` | Wobbles of that outline per tile | same file, `RH_BAND_NOISE_SCALE` | 2.2 | 1.7 (the terrain edge's own scale) to 3 | same check | `plague-scene-dressed` |
| `band-edge-width` | How much of the tile-to-tile gain fade a band keeps at its rim (1 = a full tile of fade, smaller = a narrower rim) | same file, `RH_BAND_WIDTH` | 0.55 | 0.4 to 1.0 (the soft rim must stay wider than 0; a band 1 tile wide must still show its colour) | same check | `plague-scene-dressed` |

The `band-edge-*` dials live only in the shader: the CPU mirror (`GroundVariantInputs.SoftGainAt`) models neither the warp nor `RH_BAND_WIDTH` (it is plain bilinear, which the EditMode tests pin); their look is judged on renders.

The `bog-tree-*` ranges are reasoned from the tests' constraints and checked only at the shipped value (EditMode and two renders); the ends of a range were not swept.

Paths are under `client-unity/UnityProject/` unless they start with `RoguehallaNet/` (then under `client-unity/`,
with a synced copy made by `bash client-unity/sync-net.sh`).

Not yet dials (each needs the packet that names it and gives it a range test): the ground variants' strengths and
colours (`GroundVariantLook`), zone light strengths (`RegionAtmosphereTable`), landmark art colours, HUD sizes and
label sizes (`CampPatienceOutlines.LabelSize`), name plate sizes.
