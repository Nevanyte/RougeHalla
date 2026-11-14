# P-UNITY-LANDMARK-5: the Holy hall is drawn as a colonnade with its shrine

- **Serves:** owner decision 4 (2026-11-10: one landmark per zone, real terrain) and the owner's direction of 2026-11-13
  (the coordinator makes the Unity front end ready while the map generator session finishes generation)
- **Implementer tier:** implementer-sonnet (Unity view code)
- **Reviewer:** reviewer; then a visual review of screenshots before anything is shown to the owner
- **Integration base:** feature/unity-rework after P-UNITY-LANDMARK-1 (the framework) and P-WIRE17-MAP-3 (anchors)
- **D-rules touched:** D1 n/a (no legacy counterpart: DEV-020) · no wire change · no game rule in Unity (every wall,
  hazard and fence is the server's tile; the art changes nothing a fighter can do)

## 1. ID and outcome
The Holy hall arrives as a 37 x 37 box with no outer wall: 32 piers (3 x 3 wall blocks, six to a row, a 7-wide nave
between the middle pairs), a walled shrine at the back with a 3-tile door and its own 3 x 3 healing light (floor, terrain
Light), and two Holy camps on the nave. Drawn as tiles it is a grid of square blocks. When this lands:
1. **The piers.** Each 3 x 3 wall group is drawn as one column: a base, a shaft taller than a wall, a capital. Sorted by
   row as walls, so an actor behind a column is hidden by it and the nave stays open to the sky. No roof over the
   colonnade: the two camps on the nave must stay in plain view.
2. **The shrine.** The one enclosed part (the framework's interior rule finds only the shrine's floor): a roof over it
   that fades while a visible actor is inside, a door surround on its door, a glow over its healing light.
3. **The entrance.** The anchor's entrance tiles are on the front row at the nave's end: a pair of taller columns or a
   threshold there, on the side the front points to. The nave light marks of the drawing are not tiles and are not
   delivered: not drawn here.

## 2. Dependencies
P-UNITY-LANDMARK-1 (merged): read its brief first; its facts F1 (how tiles reach the client), F2 (the fade), F3 (draw
order: the roof under the fog, names above it) and F4 (the interior rule) hold here unchanged, and its section 4 names
the one registration point. The generator packet for this landmark (P-MAPGEN-SIG-HOLY-1) is the map generator session's and has not
landed: this packet is built and tested against a test map stamped from the approved drawing
`docs/landmarks/blueprints/hall.txt` in all eight orientations, exactly as `LandmarkViewEditModeTests` stamps the cave.

## 3. Relevant legacy paths
none (DEV-020)

## 5. Exclusive write scope
- new `client-unity/UnityProject/Assets/Scripts/View/Regions/Landmarks/HallLandmark.cs` (+ `.meta`)
- `Landmarks/LandmarkArts.cs`: one `case MapBlob.AnchorKindHall` line
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
- Engine-free: the hall drawing has exactly 32 pier groups of 9 wall tiles and one shrine group; its interior is the
  shrine's floor only, the same count in all eight orientations (guards and one red count on the drawing).
- EditMode: a map with a Hall anchor builds one landmark with 32 column objects, one on each pier group; its roof
  covers the shrine's interior and walls and no nave or aisle tile; the roof fades for an actor in the shrine and not
  for one on the nave or between piers; nothing allocates in a frame where nothing changed.
- Screenshots (the coordinator's round, after merge): close and wide, in play; a visual review signs them before the
  owner sees them.
- `scripts/gate.sh --quick --oracle packet/P-UNITY-LANDMARK-5` passes.

## 9. Validation commands
- `export PATH="$HOME/.dotnet:$PATH"; dotnet test client-unity/RoguehallaNet.Tests`
- `bash client-unity/UnityProject/Tools/editmode.sh`; then
  `git checkout -- client-unity/UnityProject/Assets/Resources/Showcase/NunitoRegular.asset` if the run left it modified.
- `scripts/gate.sh --quick --oracle packet/P-UNITY-LANDMARK-5`

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
