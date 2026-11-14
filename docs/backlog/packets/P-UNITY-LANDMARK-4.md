# P-UNITY-LANDMARK-4: the Plague bog tree is drawn as a giant tree

- **Serves:** owner decision 4 (2026-11-10: one landmark per zone, real terrain) and the owner's direction of 2026-11-13
  (the coordinator makes the Unity front end ready while the map generator session finishes generation)
- **Implementer tier:** implementer-sonnet (Unity view code)
- **Reviewer:** reviewer; then a visual review of screenshots before anything is shown to the owner
- **Integration base:** feature/unity-rework after P-UNITY-LANDMARK-1 (the framework) and P-WIRE17-MAP-3 (anchors)
- **D-rules touched:** D1 n/a (no legacy counterpart: DEV-020) · no wire change · no game rule in Unity (every wall,
  hazard and fence is the server's tile; the art changes nothing a fighter can do)

## 1. ID and outcome
The bog tree arrives as a 29 x 29 box: a trunk about 11 tiles across (wall), three root walls growing from it, three
free root stumps, about 3 tiles of dry ground round the trunk, then a ring of bog (floor, terrain Bog) crossed only by
three 2-wide dry causeways. Drawn as tiles it is a wall blob in a swamp. When this lands:
1. **The trunk and roots.** One bark mass over the trunk's wall group with the roots reading as roots (tapering, lower
   than the trunk); the free stumps as stumps.
2. **The canopy.** A crown of foliage above the trunk and the dry ground round it, drawn over actors, which fades while
   a visible actor stands under it, as the cave's roof does. The tree has no enclosed floor, so the cover is not the
   interior set: it is the floor within a fixed distance of the trunk's wall group (the oracle pins the distance and the
   count on the drawing, in all eight orientations). The framework gains one seam for this: an art may hand the
   landmark its own cover mask; without one the interior set is used, as today.
3. **The marsh.** The bog stays the ground art it is; the causeways are plain ground. Nothing is drawn over the bog that
   could be mistaken for dry ground.

## 2. Dependencies
P-UNITY-LANDMARK-1 (merged): read its brief first; its facts F1 (how tiles reach the client), F2 (the fade), F3 (draw
order: the roof under the fog, names above it) and F4 (the interior rule) hold here unchanged, and its section 4 names
the one registration point. The generator packet for this landmark (P-MAPGEN-SIG-SCALE-3) is the map generator session's and has not
landed: this packet is built and tested against a test map stamped from the approved drawing
`docs/landmarks/blueprints/bog.txt` in all eight orientations, exactly as `LandmarkViewEditModeTests` stamps the cave.

## 3. Relevant legacy paths
none (DEV-020)

## 5. Exclusive write scope
- new `client-unity/UnityProject/Assets/Scripts/View/Regions/Landmarks/BogTreeLandmark.cs` (+ `.meta`)
- `Landmarks/LandmarkArts.cs`: one `case MapBlob.AnchorKindBogTree` line
- the cover seam (an art hands the landmark its own cover set) comes from P-UNITY-LANDMARK-SEAMS-1, which lands first: no
  framework file is in this packet's scope
- not `ArenaView.cs`, not `CaveLandmark.cs`, not `Protocol/**`, not `crates/**`, not the blueprints
- Existing test, changed by the oracle author only (mechanical; the coordinator flags it to the owner):
  `LandmarkViewEditModeTests.TheCaveIsTheOnlyKindWithArtAndTheRegistrationPointIsLandmarkArts` and
  `AKnownKindWithNoArtRegisteredBuildsNothingAndLogsOnce` list this kind as having no art ("belongs to a follow-up
  packet"); this packet takes it off that list and nothing else in those tests changes.

## 7. Behaviour to preserve
- Art is derived from the delivered tiles inside the anchor's footprint, never from a copy of the grid, so it is right
  in all eight orientations. Built once per map; nothing allocated or painted per frame; everything it creates is
  registered with `Landmark.Own` so the framework disposes of it.
- The fog stays above everything the landmark draws; a fade is driven only by actors the client already draws (C-OBS).
- Maps without this anchor, and the other landmarks, look exactly as before.

## 8. Acceptance checks
- Engine-free: the bog drawing has no interior in any orientation (guard); the cover set (floor within the pinned
  distance of the trunk group) has the same count in all eight orientations and contains no bog tile.
- EditMode: a map with a BogTree anchor builds one landmark whose canopy covers every cover tile and the trunk and no
  tile outside the footprint; it fades for an actor on a cover tile and not for one on a causeway or in the bog; the
  cave's tests are unchanged and green; nothing allocates in a frame where nothing changed.
- Screenshots (the coordinator's round, after merge): close and wide, in play; a visual review signs them before the
  owner sees them.
- `scripts/gate.sh --quick --oracle packet/P-UNITY-LANDMARK-4` passes.

## 9. Validation commands
- `export PATH="$HOME/.dotnet:$PATH"; dotnet test client-unity/RoguehallaNet.Tests`
- `bash client-unity/UnityProject/Tools/editmode.sh`; then
  `git checkout -- client-unity/UnityProject/Assets/Resources/Showcase/NunitoRegular.asset` if the run left it modified.
- `scripts/gate.sh --quick --oracle packet/P-UNITY-LANDMARK-4`

## 10. Risk and suggested model tier
Sonnet. Only structure can be tested; the look is judged at the screenshot round and may send it back.

## 11. Known traps
- `LandmarkArts.cs` and `LandmarkViewEditModeTests.cs` are shared by the four art packets: they merge one at a time, and
  the packet branch is cut from the integration head (never merge the integration branch into a packet branch: the
  gate's `--oracle` check counts the merge as an oracle change).
- The cave's review left two look notes that apply to every landmark: a roof can cover an actor standing in an
  entrance, and art drawn over wall tiles sits on top of the wall meshes `RegionWalls` still draws (a soft edge shows the
  blocks beneath). Decide per landmark and say what was chosen.
- An EditMode run modifies `NunitoRegular.asset`: never commit it.

## Notes from previous attempts

## Established facts (oracle author, 2026-11-13; read from `docs/landmarks/blueprints/bog.txt` and the framework at `coord/int-27`)

No legacy counterpart (DEV-020); `packages/` not consulted.

- **Routing:** serves owner decision 4 and the 2026-11-13 direction; tier implementer-sonnet; reviewer `reviewer`; D1 n/a, no wire change; write scope
  as section 5 (`BogTreeLandmark.cs` + one `case` line in `LandmarkArts.cs`).
- **Terrain:** `TerrainKind.Bog` = 5 (`RegionThemes.cs:11`); the bog is `MapBlob.Floor` (0) with terrain 5, so `Landmark.IsWall`/`IsLow` are false there and
  `Landmark.Terrain(x, y)` is 5. The art needs no copy of the drawing.
- **Counts** (29 x 29): `T` 93, `r` 62, `%` 213, `:` 62, `.` 411; no `E`, door or fence. `Landmark.WallCount` = 155, `InteriorCount` = 0 (no enclosed floor; guarded
  with the entrance given, via `LandmarkInterior.Find`). 8-connected wall groups: the **trunk group = 137 tiles** (93 `T` + 44 `r`: the roots that touch the
  trunk are part of it) and **three free stumps of 6 `r` tiles** each (same in all eight orientations).
- **Anchor** (agreed with the map generator session, built by the oracle): footprint = the box, centre = drawing tile (14, 14) (a trunk tile), entrance =
  drawing tiles (12,0) (13,0) (0,11) (0,12) (13,28) (14,28), all `:` causeway tiles on the box edge (verified), turned with the box. Pinned:
  `Landmark.ArchTiles` equals those six tiles; nothing else about them (the art draws no arch or gate).
- **THE COVER RULE (the one pinned):** cover = the trunk group's own tiles + every floor tile of the footprint that is not bog and whose centre is within
  **Euclidean distance 3** (dx*dx + dy*dy <= 9) of the centre of some trunk-group tile. **275 tiles in every orientation**: 137 trunk-group + 120 dry `.` + 18
  `:` (the causeways' stretches inside the ring); the other 44 causeway tiles, all 213 bog tiles, the 18 stump tiles and the dry ground beyond the ring
  are not covered. Why Euclidean 3: Chebyshev 3 (178 floor tiles) squares the corners and takes more dry ground far from the ring; Euclidean 3 reads as a
  round crown. Known look: it covers a little dry ground round root tips that stand in the marsh, and the dry ring is up to 5 wide on one side, so not all
  of it is covered. The art hands this to `Landmark.SetCover`; `RoofCovers` equals it (probed 3 tiles beyond the box too).
- **Canopy** = the roof (`AddRoofRenderer`): its bounds reach every cover tile (half-tile tolerance) and no tile centre outside the footprint (exact);
  sorts at the footprint's south edge, under `VisionFog.SortingOrder`. Fades for an actor on a dry or causeway cover tile; not for one on bog, on a causeway
  beyond the ring, or on dry ground beyond the ring.
- **Names** (descendants of `Landmark.Root`, found by `Transform.name`, each with a renderer): exactly one `Bog tree trunk` whose bounds reach all 137 trunk-group
  tiles and none of the free stumps' tiles (half-tile tolerance), not itself part of the canopy; exactly three `Bog tree stump`, one with its centre in each
  free stump's box (+-.5 tile), reaching that stump's six tiles.
- **The marsh stays readable (pinned by pixels):** every non-canopy `SpriteRenderer` under the root has alpha < .5 at the centre of every floor tile that is not
  in the cover and has no wall tile within 2 tiles (Chebyshev): the open bog and the far causeways. Needs readable procedural `Texture2D`s (as the volcano
  and church) and plain (unflipped) sprites; a green sampler guard test checks the test's own helper (pivot, ppu, scale). Bark may stand over bog beside the
  wall (the test does not look there).
- **Not pinned:** colours, shapes, roots lower than the trunk, tapering, the canopy being above actors beyond its sort order, the soft edge over `RegionWalls`
  blocks (decide and say). **Unverified:** the EditMode tests past the first assertion have not run against an implementation (every one is red at "one
  landmark for the BogTree anchor"), so the sampler and bounds tolerances are untested on real art; an implementer who finds one wrong reports it to the
  coordinator rather than editing the oracle.
- **Existing test edit** (coordinator-approved, mechanical, in the stub commit): in `LandmarkViewEditModeTests.TheCaveIsTheOnlyKindWithArtAndTheRegistrationPointIsLandmarkArts`
  the list `{ BogTree, Hall }` becomes `{ Hall }`. `LandmarkSeamsEditModeTests.ACoverSetHandedOverIsExactlyWhatRoofCoversAndTheFadeReads` overrides the BogTree
  kind: `LandmarkArts.TryGet` consults the overrides before the production switch, so the override still wins over the new registered art (no edit needed).

## Oracle files (read-only for implementers)
- `client-unity/UnityProject/Assets/Tests/Editor/BogTreeLandmarkEditModeTests.cs` + `.meta` (new)
- `client-unity/RoguehallaNet.Tests/BogTreeLandmarkDrawingTests.cs` (new; guards, green today)
- `client-unity/UnityProject/Assets/Tests/Editor/LandmarkViewEditModeTests.cs` (the one-token edit above; in the stub commit)
- `docs/landmarks/blueprints/bog.txt` (approved drawing, never edited)
- Stub commit, replaced by the implementer: `Scripts/View/Regions/Landmarks/BogTreeLandmark.cs` + `.meta` (`public static void Build(Landmark)`, empty, unregistered);
  the implementer adds `case MapBlob.AnchorKindBogTree: builder = BogTreeLandmark.Build; return true;` to `LandmarkArts.cs`.

Test map (EditMode; x8 orientations where marked; all red on an assertion today): `ABogTreeAnchorBuildsOneLandmarkClassifiedFromTheTilesInEveryOrientation` x8,
`TheCanopysCoverIsExactlyTheTrunkGroupAndTheDryGroundWithinThreeTilesOfIt` x8, `TheCanopyIsDrawnOverEveryCoverTileAndNoTileOutsideTheFootprintAndSortsUnderTheFog` x8,
`TheCanopyFadesForAnActorOnTheDryGroundRoundTheTrunkAndNotOnACausewayBeyondItOrInTheBog` x8, `OneTrunkObjectSpansEveryTileOfTheTrunkGroupAndNotTheFreeStumps` x8,
`EveryFreeRootStumpHasExactlyOneStumpObject` x8, `NothingButTheCanopyPaintsOpaquelyOnTheMarshOrTheGroundFarFromTheTreesWood` x8,
`AFrameWhereNothingChangedCreatesAndAllocatesNothing`, `DisposingTheViewRemovesEverythingTheBogTreeDrew`. Green: `TheAlphaSamplerTheMarshTestUsesReadsTheSpritePixelUnderAWorldPoint`.
Engine-free guards (green): `TheDrawingIs29SquareWithTheTileCountsTheOracleExpects`, `TheTrunkIsTheLargestWallGroupWithItsRootsAndThreeFreeStumpsOfSixTilesStandAlone` x8,
`TheCoverIsTheTrunkGroupPlusTheDryFloorWithinThreeTilesAndHasTheSameCountInEveryOrientation` x8, `TheBogTreeHasNoInteriorInAnyOrientationSoTheCoverMustBeHandedOverByTheArt` x8.

## Baseline (at the oracle commit)
EditMode: 1179 tests, 1121 pass, **58 fail, all new bog tests** (7 x 8 + 2): 8 on "BogTree is registered in LandmarkArts", 50 on "orientation N: one landmark for the
BogTree anchor: expected 1, was 0"; no existing test is red. `dotnet test client-unity/RoguehallaNet.Tests --filter BogTreeLandmarkDrawing`: 25 of 25 pass.
