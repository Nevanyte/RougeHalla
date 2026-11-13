# P-UNITY-LANDMARK-1: the client draws a zone's landmark as a landmark (the framework, and the Frost cave first)

- **Serves:** owner decision 4 (MIGRATION, 2026-11-10: one landmark per zone) and the owner's standing direction
  (2026-11-12: show each zone's landmark, close and wide, once drawn and approved by a visual review); owner
  direction 2026-11-13 (the coordinator makes the Unity front end ready while the map generator session finishes
  generation)
- **Implementer tier:** implementer-sonnet (Unity view code)
- **Reviewer:** reviewer; then a visual review of screenshots before anything is shown to the owner
- **Integration base:** feature/unity-rework after P-WIRE17-MAP-3 (`MapBlob.Anchors`) and P-MAPGEN-SIG-SCALE-1 (the
  cave is the approved 29 x 29 drawing)
- **D-rules touched:** D1 n/a (no legacy counterpart: DEV-020) · no wire change · no game rule in Unity (a landmark's
  walls, ice, lava, bog and fence are the server's tiles; the art changes nothing a fighter can do)

## 1. ID and outcome
The client receives a landmark's tiles and draws them as ordinary zone tiles: the cave is a rock ring with ice in it,
indistinguishable from any wall cluster. P-WIRE17-MAP-3 tells the client where each landmark is
(`MapBlob.Anchors`: zone, kind, centre, footprint, front, entrance). When this lands:
1. **Framework.** One presenter builds landmark art once per map from an anchor and the delivered tiles INSIDE its
   footprint (which tiles are wall, floor, low, and their terrain), never from a copy of the blueprint grid: the
   generator places a blueprint in one of eight orientations and the anchor does not say which, so art that is
   derived from the tiles is right in all eight. It offers each landmark kind: the footprint, the entrance and the
   front direction in world space; the sets of wall tiles, interior floor tiles (floor enclosed by the landmark's
   walls, reached from the entrance) and special-terrain tiles; a roof layer that fades out while the local player
   stands on an interior tile and fades back when they leave (as tall props fade: P-UNITY-PROP-FADE-1); draw order
   against actors by y, as walls. A kind with no art registered draws nothing extra (today's tiles) and logs once.
   A map without anchors draws exactly as today.
2. **The Frost cave.** Rock-mass walls (a darker, rounded treatment of the cave's wall tiles so the ring reads as one
   body, not tile blocks), a cave-mouth arch on the entrance tiles facing the front, a rock roof over the interior
   that fades when the player is inside (so from outside it is a hill with a mouth; inside you see the ice, the rock
   pillars and the camp), a cold glow at the mouth. The ice floor stays the tile art it is. Mob and player names,
   bars and marks draw above the roof layer when their actor is visible.

## 2. Dependencies
- P-WIRE17-MAP-3 merged. P-MAPGEN-SIG-SCALE-1 merged (so a landmark-mode map has the real cave). The approved
  drawing for reference only: `docs/landmarks/blueprints/cave.txt`.
- The other four landmarks are P-UNITY-LANDMARK-2 (volcano), -3 (church with its churchyard), -4 (bog tree), -5
  (Holy hall): one packet each on this framework; each can start as soon as this lands, against a test map built
  from its approved drawing, before its generator packet has landed.

## 3. Established facts (oracle author, 2026-11-13; sources at the base of `packet/P-UNITY-LANDMARK-1`)

No legacy counterpart (DEV-020); `packages/` not consulted.

### F1. How the client holds the tiles, and what the special tiles look like
- The Welcome's `MapBlob` (`client-unity/RoguehallaNet/Protocol/MapBlob.cs`) is the one source: `Tiles` row-major `W x H`
  collision classes (`MapBlob.Floor` 0, `Wall` 1, `Low` 2), `Terrain` (optional plane, one code per tile), `Regions`
  (zone per tile), `Anchors` (P-WIRE17-MAP-3). `ArenaView.Build(map)` (`ArenaView.cs:188`) calls `BuildRegionMap` (`:230`) when
  `map.Regions` is present: `RegionGround.Create`, `RegionWalls.Build` (`:237`), `RegionProps.Build` (`:238`), all under
  `_mapRoot`; the new call goes beside them.
- Walls: `RegionWalls.Create` (`Regions/RegionWalls.cs`) walks `map.Tiles`; a tile is drawn as a wall when `Tiles[i] != Floor`
  and its terrain is not Lava or Crevasse (the ground shader draws those hazards); `Low` + terrain Fence is the fence (timber
  style, darker ground under it). Every wall row is one mesh per 32-tile chunk at sorting order `2000 + row * 16`.
- Terrain codes (client enum `TerrainKind`, `Regions/RegionThemes.cs:11`): None 0, Lava 1, **Fence 2**, Crevasse 3, Ember 4,
  Bog 5, **Ice 6**, Light 7 (Rust: `mapgen/records/rules.rs:17` `terrain_ice: 6`).
- **The cave's ice floor is a FLOOR tile (`Tiles` 0) with terrain Ice (6)**; the cave's rock ring and the rock masses inside
  it (`#` and `R` of `cave.txt`) are `Wall` tiles; the mouth is plain floor. **The church's fence is a `Low` tile (2) with
  terrain Fence (2)**; the building, pillars and headstones are `Wall`. So the framework classifies the footprint's tiles
  from `Tiles` and `Terrain` alone: walls = `Tiles == Wall`, special = floor with a given terrain code, fence = `Low`.
- Nothing needs to change on the wire. The test map in `LandmarkViewEditModeTests` stamps the cave drawing into `Tiles` and
  `Terrain` exactly like this (in all eight orientations) and gives the anchor the entrance tiles and the front a generator
  would record.

### F2. The local player's tile, and the fade mechanism (what the packet reuses)
- `ArenaView.Present` (`ArenaView.cs:267`) already calls `_regionProps.NoteActor(WorldPoint(x, y))` once per drawn actor:
  `:297` (remote actors in the membership), `:315` (the local player at its drawn position), `:483` (the NPC loop); then
  `_regionProps.Tick(Time.unscaledDeltaTime)` at `:325`. Only actors the client may see reach those loops (`_membership`,
  C-OBS). `NoteActor(Vector3 feet)` takes a world-space point: no allocation.
- `RegionProps` fades with a per-prop `MarkFrame` against `Time.frameCount` and `Mathf.MoveTowards` at `PropFade.FadeRate`
  (`Regions/RegionProps.cs:~130-165`; `Net/Ui/PropFade.cs`). **Chosen for the roof: the same call pattern, not the frame stamp.**
  `LandmarkView.NoteActor(Vector3 feet)` records "an actor is inside" for the frame; `LandmarkView.Tick(dt)` moves each roof's
  alpha toward `RoofFadedAlpha` (.1) when it was noted since the last `Tick`, else toward `RoofOpaqueAlpha` (1), at
  `PropFade.FadeRate`, then forgets the notes. Reason for not using `Time.frameCount`: an EditMode test cannot advance it, and
  the note-then-tick order is already how `ArenaView` drives props. The implementer adds `_landmarks.NoteActor(...)` beside
  each of the three `_regionProps.NoteActor` calls and `_landmarks.Tick(...)` beside `:325`, and disposes it in `OnDestroy`
  (`ArenaView.cs:854-861`); that file is in the write scope for those lines only.
- "Inside" is decided by the engine-free interior set (`LandmarkInterior`), looked up by tile (`floor(x)`,
  `floor(-y / GroundSquash)`), allocation-free.

### F3. Draw order today, where the roof sits, and the visibility decision
Everything is one sorting layer; the order integer is the rule (`RegionWalls`: `2000 + row * 16`; actors
`SpriteActorPresenter.cs:437`: `2000 + round(worldY * .5)`, i.e. also 16 per tile, so walls and actors interleave by y):

| Layer | Order |
|---|---|
| ground quad | -100 |
| wall rows | `2000 + row * 16` |
| props | `2000 + round(worldY * .5) + bias` |
| actor body, weapon, hp / barrier bars, status icons, overhead numbers and cues | actor order `+ 2 .. + 14` |
| **overhead names** | actor order `+ NameOrderLift` (**18000**, `Presentation/OverheadIndicators.cs:51`) |
| world marks | 29000 (`WorldMarks.cs:21`) |
| confirmed impact / damage plates | 30000 |
| **vision fog** (one quad over the map; alpha = amount dimmed) | **31000** (`VisionFog.cs:15`) |

- **The roof's order is `2000 + 16 * (footprint.y + footprint.h)`** (the south edge of the footprint, on the walls' rule), at
  most 15 above it. (a) An actor inside the footprint has a smaller y, so its body and bars draw under the roof; an actor
  standing south of the building draws over it, as with any wall. (c) The fog (31000) is above the roof, so the roof can never
  reveal what the server did not deliver: dimmed tiles stay dimmed, and a hidden actor is not drawn at all.
- **Decision for the brief's section 7 (b): the roof FADES while any visible actor stands inside; it does not draw bars above
  the roof.** Names already draw above the roof (18000 lift); bars, status icons and marks (`+ 4 .. + 14`) draw under it, and
  moving them above would need a second sorting scheme for every actor near a landmark. Fading is the prop rule applied to a
  building, needs no per-actor change, and still uses only actors the client was told about. The cost (a visible mob inside the
  cave, seen from outside through the mouth, thins the roof for as long as it is visible) is the intended reading: the player
  can see it, so the interior it stands in is shown. Pinned by `AnyActorTheViewerMaySeeInsideFadesTheRoofSoItsNameAndBarsShow`.

### F4. What "interior" means (pinned engine-free on the cave and the church)
A landmark's interior is the floor enclosed by its walls, where doorways count as closed. `LandmarkInterior.Find(tiles, w, h,
footprint, entrance)`:
1. Only wall tiles inside the footprint count. Take each 8-connected group of them and its bounding box.
2. **Close the openings**: along the box's four border lines, a run of at most `MaxOpening` (5) non-wall tiles lying between two
   wall tiles is a doorway (the cave's 3-tile mouth, the church's 3-tile door, a 1-tile side door); and every entrance tile
   inside the box is closed whatever the run's width (so an entrance wider than 5 still works).
3. Flood from the box's border through non-wall tiles (floor and low) that are not closed. Whatever it reaches is outside.
4. Interior = the floor inside the box that the flood did not reach, minus the closed doorway tiles themselves.

Low tiles do not enclose (shots cross a fence). Runs are tested only on the box BORDER, so narrow gaps between rocks inside a
chamber, or between a building and its headstones, are never mistaken for doors (a first version that closed every short run
in the footprint wrongly enclosed an alley of the churchyard: the reason for the border rule). Every step is symmetric under
rotation and mirroring, so one rule serves all eight orientations. Known edge: a doorway more than one tile thick (a wall two
tiles deep) closes only its outer tiles on the border; neither blueprint has one.
- **Cave** (`cave.txt`, 627 floor tiles = 397 `.` + 226 `=` + 3 `D` + 1 `E`; every one reachable from the mouth): the ring is one
  wall group whose box is the whole 29 x 29; the mouth is a 3-run in the bottom border; interior = **624** (627 less the mouth) in
  all eight orientations, and tile for tile the floor characters `.`, `=`, `E`. The brief's "627 enclosed" is 624 interior plus the
  3 mouth tiles, on which the arch stands.
- **Church** (`church.txt`): the building (23 x 14, one wall group with its 48 pillar tiles) is one box whose bottom border has the
  3-tile door; interior = **204** (the 21 x 12 floor less 48 pillars, `E` included). The graveyard, the lanes and the yard
  are not interior: the fence is `Low` (open), the headstones are separate 2 x 2 wall groups with no border gaps, and the
  main gate (the anchor's entrance, row 28) lies outside every wall box, so passing it changes nothing. The roofed interior is
  the walled building even though the anchor's entrance is 12 rows from its door.
- A throwaway reference implementation of this rule (Python, not committed) reproduced 624 and 204 on all eight orientations
  and every hand-made case below before the tests were committed; the C# stub finds nothing, so the tests are red on counts.

### F5. What the oracle could not prove
- The look (rounded rock, arch, glow): only structure is tested (counts, covered tiles, alpha, order, arch position).
- The roof's drawn extent is only bounded below (it must reach every interior tile); how far it overhangs is the art's.
- The EditMode tests that need the landmark built stop at their first assertion today; their later assertions (alpha, order,
  arch) were reasoned, not run, until an implementation exists.

## 4. Registration point for the four follow-ups
The framework registers a kind's art in ONE place: `LandmarkArts.TryGet(byte kind, out LandmarkArtBuilder builder)` in
`View/Regions/Landmarks/LandmarkArts.cs` (a `switch` on `MapBlob.AnchorKind*`). `LandmarkArtBuilder` is `void (Landmark)`: it
receives the classified landmark (`Anchor`, `Root`, wall / ice / interior counts, `RoofCovers`, `FrontVector`, the entrance
tiles) and adds its renderers under `landmark.Root`; roof pieces are exposed as `Landmark.RoofRenderers` so the fade, the order
and the disposal stay the framework's. This packet adds `case MapBlob.AnchorKindCave`; each follow-up adds one line:
P-UNITY-LANDMARK-2 `AnchorKindVolcano`, -3 `AnchorKindChurch`, -4 `AnchorKindBogTree`, -5 `AnchorKindHall`. A kind with no
case logs `LandmarkView: no art for kind N` once per build; a code outside 1..5 logs `LandmarkView: unknown kind N` once
(`Debug.LogWarning`). Classification (walls, special terrain by code, interior, roof) is shared; the follow-ups only draw.

## 5. Exclusive write scope
- `client-unity/UnityProject/Assets/Scripts/View/Regions/Landmarks/{LandmarkView,Landmark,LandmarkArts}.cs` (stubbed by the
  oracle author with their `.meta` files; the implementer fills them) and new files beside them for the cave art (e.g.
  `CaveLandmark.cs`, painted textures if the other region art is)
- `client-unity/UnityProject/Assets/Scripts/View/ArenaView.cs`: only the build call in `BuildRegionMap` (beside `:238`), the
  three `NoteActor` lines (`:297`, `:315`, `:483`), the `Tick` (`:325`) and the `OnDestroy` disposal
- `client-unity/RoguehallaNet/Net/Ui/LandmarkInterior.cs` (stubbed; the implementer fills `Find`) and its synced copy
  `client-unity/UnityProject/Assets/RoguehallaNet/Net/Ui/LandmarkInterior.cs` via `bash client-unity/sync-net.sh`
- not `Protocol/**`, not `crates/**`, not `TacticalMapController.cs` (the stub commit carries a one-line alias, see Notes)

## 7. Behaviour to preserve
- A map without anchors, and every zone without a registered landmark art, look exactly as today; no per-frame
  garbage; the vision/fog rules: the roof never shows or hides anything the server did not deliver (a fighter inside
  the cave whom the viewer cannot see is not drawn; one the viewer can see is drawn above the roof or the roof fades:
  **decided: the roof fades while any visible actor is inside**; names already draw above it, the fog above both; reason in
  fact F3).

## 8. Acceptance checks
- Engine-free: the interior of a hand-made walled box with one opening is exactly its enclosed floor; a box with two
  openings; a box open to the map edge has no interior; all eight orientations of the approved cave grid give the
  same interior tile count.
- EditMode: a map with a Cave anchor builds one landmark object with a roof covering every interior tile and no tile
  outside the footprint; the roof's alpha goes to its faded value when the local player's tile is interior and back
  when it is not; a map without anchors builds none; an unknown kind builds none and logs once; a frame where nothing
  changed allocates nothing.
- Screenshots (the coordinator's round, after merge): the cave close and wide, from outside and inside, on a real
  landmark-mode map; a visual review signs them before the owner sees them.
- `scripts/gate.sh --quick --oracle packet/P-UNITY-LANDMARK-1` passes.

## Oracle files (read-only for implementers)
- `client-unity/RoguehallaNet.Tests/LandmarkInteriorTests.cs` (new; reads `docs/landmarks/blueprints/cave.txt`, `church.txt`)
- `client-unity/UnityProject/Assets/Tests/Editor/LandmarkViewEditModeTests.cs` and its `.meta` (new; reads `cave.txt`)
- `docs/landmarks/blueprints/cave.txt`, `church.txt` (approved drawings, owner decision 2026-11-13; never edited here)
- Stub commit, replaced by the implementer: `RoguehallaNet/Net/Ui/LandmarkInterior.cs` + synced copy,
  `Scripts/View/Regions/Landmarks/{LandmarkView,Landmark,LandmarkArts}.cs` with `.meta` files.

Test map (each red today on an assertion unless marked guard):
- `LandmarkInteriorTests`: `AWalledBoxWithOneOpeningHasItsEnclosedFloorAsInterior`, `TheOpeningNeedNotBeListedWhenItIsNarrow`,
  `ABoxWithTwoOpeningsIsStillInterior`, `ABoxWithAWideGapHasNoInteriorUnlessTheGapIsTheEntrance`,
  `ABoxOpenToTheMapEdgeHasNoInterior`, `AFenceDoesNotEncloseAndFloorOutsideTheWallsIsNotInterior`,
  `TheCaveInteriorIsItsEnclosedFloorInEveryOrientation` x8 (624, per tile),
  `TheChurchInteriorIsTheWalledBuildingAndNotTheYardInEveryOrientation` x8 (204, per tile). Guards (green today):
  `TheConstantIsThePinnedOpeningWidth`, `TheCaveDrawingHas627FloorTilesAndTheMouthIsThreeOfThem`,
  `TheChurchDrawingBuildingIs204FloorTilesAndTheMainGateIsFiveOnTheFrontRow`.
- `LandmarkViewEditModeTests`: `ACaveAnchorBuildsOneLandmarkClassifiedFromTheTilesInEveryOrientation` x8,
  `TheRoofCoversEveryInteriorTileAndNoTileOutsideTheFootprint`, `TheRoofIsOpaqueWhileNoActorIsInsideAndFadesWhileOneIs`,
  `StandingInTheMouthOrJustOutsideTheFootprintDoesNotFadeTheRoof`, `AnyActorTheViewerMaySeeInsideFadesTheRoofSoItsNameAndBarsShow`,
  `TheRoofSortsAtTheFootprintsSouthEdgeAndUnderTheFog`, `TheMouthArchStandsOnTheEntranceTilesOnTheSideTheFrontPointsTo` x4,
  `AnUnknownKindBuildsNothingAndLogsOnce`, `AKnownKindWithNoArtRegisteredBuildsNothingAndLogsOnce`,
  `TheCaveIsTheOnlyKindWithArtAndTheRegistrationPointIsLandmarkArts`, `AFrameWhereNothingChangedCreatesAndAllocatesNothing`,
  `BuildReadsTheAnchorsFromTheMapBlob` (also needs P-WIRE17-MAP-3's implementation: its stub `WithPublic` drops the anchors).
  Guards (green today): `AMapWithoutAnchorsBuildsNoLandmarkObject`, `AMapWithoutAnchorsRendersTheSameWallGroundAndPropObjectsAsToday`.
- Not new, must stay green: `DressedMapEditModeTests`, `DecorationKindsTests`, `RegionThemeEditModeTests`.

## 10. Risk and suggested model tier
Sonnet. The look is a judgement no test makes: the packet is done when the tests pass, and shown to the owner only
after the screenshot round and its visual review.

## 11. Known traps
- The anchor's footprint is the blueprint box; a landmark's tiles can be fewer (the cave's corners are chamfered) and
  another feature never stands inside it, but plain floor inside the footprint and outside the walls (the ring round
  a building) is NOT interior.
- The decoration packet already draws server props and ground tints inside landmark bands: the landmark's own
  footprint gets no props from the rules, but check nothing is drawn twice.
- An EditMode run modifies `Assets/Resources/Showcase/NunitoRegular.asset`: `git checkout --` it, never commit it.

## Notes from previous attempts
- Oracle author, 2026-11-13: **the P-WIRE17-MAP-3 stub breaks the Unity compile.** It adds `Roguehalla.Net.Protocol.MapRect`, and
  `Net.Ui` already has `MapRect` (the map screen's), so `Assets/Scripts/UI/TacticalMapController.cs` (which uses both
  namespaces) fails with CS0104. `agent/opus/P-WIRE17-MAP-3` keeps both types, so it has the same break. The `stub:` commit of
  this packet adds one line to that file (`using MapRect = Roguehalla.Net.Ui.MapRect;`). The coordinator should fold the same
  line into P-WIRE17-MAP-3 (an identical edit merges cleanly) or rename one type. Inside `Net/Ui` a bare `MapRect` is the Ui
  type, so `LandmarkInterior.Find` writes `Protocol.MapRect`.
- The stub `LandmarkInterior.Find` returns an all-false array of the footprint's size, so the engine-free tests fail on counts.
- Existing tests whose expectations must change: none. No existing test or capture was edited.
- EditMode was run with `-testFilter Roguehalla.Client.Tests.LandmarkViewEditModeTests` (24 tests: 22 red on assertions, the 2
  guards green); `dotnet test` filtered to `LandmarkInterior`.
