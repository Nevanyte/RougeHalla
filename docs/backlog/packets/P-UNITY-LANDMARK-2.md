# P-UNITY-LANDMARK-2: the Fire volcano is drawn as a volcano

- **Serves:** owner decision 4 (2026-11-10: one landmark per zone, real terrain) and the owner's direction of 2026-11-13
  (the coordinator makes the Unity front end ready while the map generator session finishes generation)
- **Implementer tier:** implementer-sonnet (Unity view code)
- **Reviewer:** reviewer; then a visual review of screenshots before anything is shown to the owner
- **Integration base:** feature/unity-rework after P-UNITY-LANDMARK-1 (the framework) and P-WIRE17-MAP-3 (anchors)
- **D-rules touched:** D1 n/a (no legacy counterpart: DEV-020) · no wire change · no game rule in Unity (every wall,
  hazard and fence is the server's tile; the art changes nothing a fighter can do)

## 1. ID and outcome
The volcano arrives as a 30 x 30 box: a solid cone of wall tiles with the four corners cut, a crater lake and three lava
channels (Low tiles with terrain Lava) running to three 2-wide outlets on the front row. Drawn as tiles it is a block of
basalt wall with lava slots. When this lands it reads as a mountain:
1. **The cone.** One rock mass over the cone's wall tiles, in three height tiers the drawing calls foot, slope and rim.
   The tiers are not on the wire: derive them from the tiles (distance from the cone's outer edge, or to the lake), so a
   rotated or mirrored volcano is still right. Darker at the foot, lit toward the rim, the rim highest.
2. **The crater and channels.** The lava itself stays the ground shader's (it already draws Lava tiles). The art adds the
   crater's inner wall, a glow over the lake, banks along the three channels and a glow where each leaves the box. The
   streams beyond the box are ordinary lava tiles and are not this packet's.
3. **No roof and no fade.** Nothing is enclosed (`LandmarkInterior` finds no interior: the lake is lava, not floor); the
   oracle pins that count as 0 in all eight orientations and that no roof renderer exists.
4. Draw order by row, as walls, so an actor north of the cone is hidden by it and one south stands in front.

## 2. Dependencies
P-UNITY-LANDMARK-1 (merged): read its brief first; its facts F1 (how tiles reach the client), F2 (the fade), F3 (draw
order: the roof under the fog, names above it) and F4 (the interior rule) hold here unchanged, and its section 4 names
the one registration point. The generator packet for this landmark (P-MAPGEN-SIG-SCALE-4) is the map generator session's and has not
landed: this packet is built and tested against a test map stamped from the approved drawing
`docs/landmarks/blueprints/volcano.txt` in all eight orientations, exactly as `LandmarkViewEditModeTests` stamps the cave.

## 3. Relevant legacy paths
none (DEV-020)

## 5. Exclusive write scope
- new `client-unity/UnityProject/Assets/Scripts/View/Regions/Landmarks/VolcanoLandmark.cs` (+ `.meta`)
- `Landmarks/LandmarkArts.cs`: one `case MapBlob.AnchorKindVolcano` line
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
- Engine-free: the volcano drawing has no interior in any orientation; its lava tile count inside the box is 160 and its
  outlets are three 2-tile runs on the front row (guards on the drawing).
- EditMode: a map with a Volcano anchor builds one landmark with no roof renderers; the cone art covers every wall tile
  of the footprint and no tile outside it; three tiers exist and every rim tile is nearer the lake than every foot tile;
  a glow stands on each outlet on the side the front points to, in the four front directions; nothing allocates in a
  frame where nothing changed.
- Screenshots (the coordinator's round, after merge): close and wide, in play; a visual review signs them before the
  owner sees them.
- `scripts/gate.sh --quick --oracle packet/P-UNITY-LANDMARK-2` passes.

## 9. Validation commands
- `export PATH="$HOME/.dotnet:$PATH"; dotnet test client-unity/RoguehallaNet.Tests`
- `bash client-unity/UnityProject/Tools/editmode.sh`; then
  `git checkout -- client-unity/UnityProject/Assets/Resources/Showcase/NunitoRegular.asset` if the run left it modified.
- `scripts/gate.sh --quick --oracle packet/P-UNITY-LANDMARK-2`

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
