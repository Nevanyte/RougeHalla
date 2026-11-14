# P-UNITY-LANDMARK-3: the Sentenced church, its graveyard and churchyard are drawn as a church

- **Serves:** owner decision 4 (2026-11-10: one landmark per zone, real terrain) and the owner's direction of 2026-11-13
  (the coordinator makes the Unity front end ready while the map generator session finishes generation)
- **Implementer tier:** implementer-sonnet (Unity view code)
- **Reviewer:** reviewer; then a visual review of screenshots before anything is shown to the owner
- **Integration base:** feature/unity-rework after P-UNITY-LANDMARK-1 (the framework) and P-WIRE17-MAP-3 (anchors)
- **D-rules touched:** D1 n/a (no legacy counterpart: DEV-020) · no wire change · no game rule in Unity (every wall,
  hazard and fence is the server's tile; the art changes nothing a fighter can do)

## 1. ID and outcome
The church arrives as a 29 x 29 box: a 23 x 14 walled building with 48 pillar tiles and a 3-tile door, a graveyard
of 2 x 2 headstones (walls) in fenced plots, and a churchyard fence (Low tiles, terrain Fence) with a 5-wide main gate
on the front row and eleven 3-wide gates. The anchor's footprint is the whole box and its entrance is the MAIN GATE,
twelve rows from the building's door. When this lands:
1. **The building.** Stone walls with a pitched roof over the 204 interior tiles (the walled building only: F4 of the
   framework brief pins that the yard is not interior). The roof fades while a visible actor is inside, showing the
   pillars and the elite camp. A door surround stands on the building's own door, found from the tiles (the closed
   doorway of the building's wall group), not from the anchor's entrance.
2. **The main gate.** Gate posts or a lych-gate on the anchor's five entrance tiles, on the side the front points to.
   The framework's arch position (`ArchTiles`, `ArchCentre`) is the main gate here, not the door.
3. **The graveyard.** Each 2 x 2 headstone group is drawn as gravestones, not as wall blocks. The fence stays the fence
   art it is. The lantern marks of the drawing are not tiles and are not delivered: not drawn here.

## 2. Dependencies
P-UNITY-LANDMARK-1 (merged): read its brief first; its facts F1 (how tiles reach the client), F2 (the fade), F3 (draw
order: the roof under the fog, names above it) and F4 (the interior rule) hold here unchanged, and its section 4 names
the one registration point. The generator packet for this landmark (P-MAPGEN-SIG-SCALE-2) is the map generator session's and has not
landed: this packet is built and tested against a test map stamped from the approved drawing
`docs/landmarks/blueprints/church.txt` in all eight orientations, exactly as `LandmarkViewEditModeTests` stamps the cave.

## 3. Relevant legacy paths
none (DEV-020)

## 5. Exclusive write scope
- new `client-unity/UnityProject/Assets/Scripts/View/Regions/Landmarks/ChurchLandmark.cs` (+ `.meta`)
- `Landmarks/LandmarkArts.cs`: one `case MapBlob.AnchorKindChurch` line
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
- EditMode: a map with a Church anchor builds one landmark whose roof covers exactly the building's 204 interior tiles
  plus its own walls and no graveyard or yard tile, in all eight orientations; the roof fades for an actor on an
  interior tile and not for one in the graveyard, at the main gate or in the door; the gate art stands on the five
  entrance tiles on the front side and the door surround on the three door tiles; every headstone group (count from
  the drawing) has one gravestone object; nothing allocates in a frame where nothing changed.
- Screenshots (the coordinator's round, after merge): close and wide, in play; a visual review signs them before the
  owner sees them.
- `scripts/gate.sh --quick --oracle packet/P-UNITY-LANDMARK-3` passes.

## 9. Validation commands
- `export PATH="$HOME/.dotnet:$PATH"; dotnet test client-unity/RoguehallaNet.Tests`
- `bash client-unity/UnityProject/Tools/editmode.sh`; then
  `git checkout -- client-unity/UnityProject/Assets/Resources/Showcase/NunitoRegular.asset` if the run left it modified.
- `scripts/gate.sh --quick --oracle packet/P-UNITY-LANDMARK-3`

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
