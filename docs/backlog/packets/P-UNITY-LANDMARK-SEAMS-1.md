# P-UNITY-LANDMARK-SEAMS-1: the landmark framework survives a faulty art, and an art can read special terrain and set its own cover

- **Serves:** owner decision 4 (2026-11-10: one landmark per zone) and the owner's direction of 2026-11-13 (the Unity
  front end is ready while generation finishes); reviewer notes on P-UNITY-LANDMARK-1, -2 and -3 (2026-11-13)
- **Implementer tier:** implementer-sonnet (Unity view code)
- **Reviewer:** reviewer
- **Integration base:** feature/unity-rework after P-UNITY-LANDMARK-2 and -3
- **D-rules touched:** D1 n/a (presentation; DEV-020) · no wire change · no game rule in Unity

## 1. ID and outcome
Three gaps in the framework of P-UNITY-LANDMARK-1, found while the volcano and the church were built on it:
1. **A faulty art breaks the match view.** `LandmarkView.Build` calls the kind's builder with nothing round it
   (`View/Regions/Landmarks/LandmarkView.cs:44-46`); an exception leaves `ArenaView.BuildRegionMap` (`ArenaView.cs:243`)
   before the map is marked built and leaks that landmark's objects. The generator packets for four of the five
   landmarks have not landed, so an art will meet tiles it was not drawn for. When this lands, a builder that throws is
   caught: the landmark's objects are disposed, one warning is logged per build (`LandmarkView: art for kind N failed`),
   that landmark draws nothing extra (today's tiles), the other landmarks and the match view are unaffected.
2. **An art cannot read special terrain.** `Landmark` exposes `IsWall` and `IsInterior` only. The volcano finds its lava
   by a flood fill from the anchor's centre and entrance (`VolcanoLandmark.cs:84-96`), which misses lava not joined to
   them and takes floor beside lava for lava. When this lands, `Landmark` answers per footprint tile: the collision
   class (floor, wall, low) and the terrain code, from the delivered `MapBlob.Tiles` and `Terrain`; the volcano uses
   "low with terrain Lava" in place of the flood fill, with the same result on the approved drawing in all eight
   orientations.
3. **An art cannot set what its cover is.** The roof mask is "interior plus every wall tile in the footprint"
   (`Landmark.RoofCovers`), so the church's mask includes its headstones, and a solid tree, which has no interior,
   cannot have a canopy that fades (P-UNITY-LANDMARK-4 needs this). When this lands, an art may hand the landmark its
   own cover set (the tiles under its roof or canopy): `RoofCovers` and the fade ("an actor on a cover tile fades the
   roof") read it; without one the interior set and today's mask are used, so the cave is unchanged. The church
   passes its building's interior, walls and pillars.

## 2. Dependencies
P-UNITY-LANDMARK-1, -2 and -3 merged. P-UNITY-LANDMARK-4 (bog tree) waits for this packet's third part and loses the
framework lines from its own write scope.

## 3. Relevant legacy paths
none (DEV-020)

## 5. Exclusive write scope
- `client-unity/UnityProject/Assets/Scripts/View/Regions/Landmarks/Landmark.cs`, `LandmarkView.cs`
- `Landmarks/VolcanoLandmark.cs` (only the lava discovery), `Landmarks/ChurchLandmark.cs` (only the cover hand-over)
- not `ArenaView.cs`, not `CaveLandmark.cs`, not `LandmarkArts.cs`, not `Protocol/**`, not any existing test

## 7. Behaviour to preserve
- The cave, the volcano and the church look and test exactly as before on their approved drawings: every existing
  landmark test stays green unchanged.
- Nothing per frame: the cover lookup stays an array read; no allocation in `NoteActor` or `Tick`.
- The fade is still driven only by actors the client draws (C-OBS).

## 8. Acceptance checks
- EditMode: a kind whose builder throws builds no art, logs exactly one warning, leaves no object of that landmark
  under the map root, and a second landmark on the same map is built normally. Red today (the exception escapes).
- EditMode: on the volcano drawing in all eight orientations `Landmark` reports exactly the 160 lava tiles as low with
  terrain Lava; on a volcano with one lava tile cut off from the lake by a wall, that tile is still lava for the art
  (red today: the flood fill misses it) and a floor tile beside a channel is not.
- EditMode: with a cover set handed over, `RoofCovers` is exactly that set and an actor on a cover tile outside the
  interior fades the roof; the church's `RoofCovers` no longer reports a headstone tile (red today); the cave's
  `RoofCovers` is unchanged (guard).
- `scripts/gate.sh --quick --oracle packet/P-UNITY-LANDMARK-SEAMS-1` passes.

## 9. Validation commands
- `export PATH="$HOME/.dotnet:$PATH"; dotnet test client-unity/RoguehallaNet.Tests`
- `bash client-unity/UnityProject/Tools/editmode.sh`; then
  `git checkout -- client-unity/UnityProject/Assets/Resources/Showcase/NunitoRegular.asset` if the run left it modified.

## 10. Risk and suggested model tier
Sonnet. Small, but it edits the framework three arts stand on: the existing landmark tests are the guard.

## 11. Known traps
- Catching the exception must not hide it: the warning names the kind and carries the exception's message.
- The volcano's oracle test that compares global texture and sprite counts before and after disposal must stay green
  when a failed art's objects are disposed.
- The packet branch is cut from the integration head; never merge the integration branch into it.
- An EditMode run modifies `NunitoRegular.asset`: never commit it.

## Notes from previous attempts
