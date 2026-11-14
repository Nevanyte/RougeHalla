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
- `Landmarks/Landmark.cs` and `LandmarkView.cs`: only to let an art supply its own cover mask for the fade (today the
  fade reads the interior set, and a solid tree has no interior); the cave's behaviour and tests must not change
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
