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

## Established facts (oracle author, 2026-11-13; base `coord/int-25`)

### E1. How the volcano's tiles reach the client (checked in code)
- Cone (`#`, `X`, `H`): `Tiles == Wall`, no terrain: 656 tiles (362 + 214 + 80). Lava (`~`, `O`): `Tiles == Low` with terrain `Lava` (1):
  160 tiles (154 + 6). Corner floor (`.`): `Floor`, 84 tiles. Nothing else is in the box.
- `RegionWalls` skips a tile whose terrain is Lava or Crevasse (`RegionWalls.cs:66`, `:91`: "the ground shader draws the hazard"), so
  lava is the ground shader's and is never a wall mesh; the cone's `Wall` tiles are the wall meshes the art is drawn over (see trap
  on the soft edge in section 11).
- Rust: the certifier's `SIGNATURE_KINDS` row for `Volcano` is `wall: true, low: true, terrain: 1`
  (`crates/rh-sim/src/mapgen/certify/rules.rs:204`): wall (cone) and LOW tiles whose terrain code is 1 = lava, as above. Terrain codes:
  `rules.rs:17` `terrain_ice: 6`; client enum `TerrainKind` (Lava 1). Fire is zone 1 (`mapdata/model.rs:37`).
- The generator for the new 30 x 30 volcano has NOT landed: `landmarks/signature/volcano.rs` still builds the older shape and records
  `entrance: Vec::new()` (`volcano.rs:202`). The map generator session must record, for this drawing, the same anchor the test map
  uses: kind 1, zone 1, `footprint` the 30 x 30 box, `front` the side of the three outlets (DIR16), and **`entrance` = the six outlet
  tiles** (the `O` tiles, two per outlet, three outlets on the front row), centre = a lava tile at the lake's middle. `MapBlob.MaxAnchorEntrance`
  is 16, so six passes the wire check.
- Framework seams checked: `Landmark.Create` takes any entrance length (averages it for `ArchCentre`, which this art ignores);
  `LandmarkInterior.Find` closes the entrance tiles and finds **0** interior in all eight orientations with or without the entrance
  (guarded engine-free). No seam is missing. The one limitation: `Landmark` has no slot for a kind's own data, so the oracle reads the art
  through a static table kept by `VolcanoLandmark` (below). No framework edit is needed.

### E2. The tier rule (one rule; the implementer follows it exactly)
For each wall tile of the footprint, **depth** = Euclidean distance (tile centres) to the nearest tile that is neither Wall nor Low
(a floor tile inside the footprint, or ANY tile outside the footprint: the nearest outside tile is `min(x+1, W-x, y+1, H-y)` away in
footprint-local coordinates). **D** = the largest depth over the footprint's wall tiles (11 for the drawing). Tier **Foot** if
`depth <= 0.4 D`, **Slope** if `depth <= 0.8 D`, else **Rim**. No depth lies on a threshold (depth squared is an integer; `(0.4 D)^2` and
`(0.8 D)^2` are not), so rounding cannot matter. The rule is symmetric under the eight placements.
- Measured on the drawing: counts Foot 346, Slope 230, Rim 80 (drawn: 362, 214, 80); **16 of 656 tiles differ from the drawn rings**
  (all on the foot/slope edge). Alternatives measured and rejected: distance to the nearest lava tile (194 or more wrong of 656: the channels
  pull foot tiles beside them next to the lava); ratio rules (110+ wrong); thresholds .4/.75 (20 wrong); the rule above was best and
  has round constants. The rule is pinned, not the drawn rings. The engine-free test fails if it stops reproducing the rings within 16.
- "Nearer the lake": the lake core = lava tiles whose eight neighbours are all lava (58 tiles; the channels are 2 wide, so none of
  them is core). Every Rim tile is within 4.24 tiles of the core, every Foot tile at least 7.81: `rim max < foot min` holds in all eight
  orientations. (The lake as ALL lava does not work: foot tiles beside a channel outlet are 1 tile from lava. This is why the core.)

### E3. What the stub exposes (names the implementer keeps)
In `Landmarks/VolcanoLandmark.cs` (stub, `.meta` included, no `case` registered in `LandmarkArts.cs`):
- `public static class VolcanoLandmark { public static void Build(Landmark lm); public static VolcanoArt ArtOf(Landmark lm); }`: `Build` is the
  `LandmarkArtBuilder`; it must record the art it makes so `ArtOf(lm)` returns it (the stub keeps a `ConditionalWeakTable`; use `Arts.Add(lm, art)`).
- `public sealed class VolcanoArt { const int Foot = 0, Slope = 1, Rim = 2; int Tier(int x, int y); SpriteRenderer[] ConeRenderers; SpriteRenderer[] GlowRenderers; }`:
  `Tier` is the E2 tier for a wall tile of the footprint and -1 for any other tile (the whole map may be asked); `ConeRenderers` are every
  renderer that draws the cone; `GlowRenderers` every glow (one per outlet and one over the lake).
- The registration line is the implementer's: `case MapBlob.AnchorKindVolcano: builder = VolcanoLandmark.Build; return true;`.

### E4. What the Unity tests pin (all eight orientations unless stated)
One landmark, one object under the parent; `WallCount` 656, `IceCount` 0, `InteriorCount` 0, no roof renderer; every renderer under the
root sorts below the fog (31000). Cone: `Tier >= 0` exactly on the wall tiles of the footprint; the union of the cone renderers' bounds
contains every wall tile's centre and stays within one tile beside, one below and two above the footprint; each cone renderer sorts in
the footprint's row range (`2000 + 16 * FootY .. 2000 + 16 * (FootY + 30) + 15`) and is under the root. Tiers equal E2 for every tile
(346 / 230 / 80) and rim is nearer the lake core than foot. Glows: at least three; for each outlet a distinct glow whose bounds centre
lies from 0 to 1.5 tiles beyond the outlet's centre in the front direction and within 1.5 tiles across (fronts 0, 4, 8, 12 are all produced
by the eight orientations: guarded); one glow's centre is inside the crater (orientation 0). The volcano is registered. 200 unchanged
frames allocate 0 bytes and create no object; the art's textures and sprites are gone after the view is disposed (`Landmark.Own`).
Not pinned: colours, shapes, how the cone meets the lava, the crater wall and channel banks (no structural handle; the screenshot round judges them).

### E5. Legacy and doubts
No legacy counterpart (DEV-020). Lava is `Low`, not wall, in the drawing and the certifier; the tile count of 160 is the brief's. The brief
says the 16 foot/slope differences are tolerated; if the owner wants the drawn rings exactly, the tiers would have to come over the wire.

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

## Oracle files (read-only for implementers)
- `client-unity/RoguehallaNet.Tests/VolcanoLandmarkDrawingTests.cs` (new; reads `docs/landmarks/blueprints/volcano.txt`)
- `client-unity/UnityProject/Assets/Tests/Editor/VolcanoLandmarkEditModeTests.cs` and its `.meta` (new; reads `volcano.txt`)
- `docs/landmarks/blueprints/volcano.txt` (approved drawing; never edited here)
- Stub commit (`stub:`), filled by the implementer: `Scripts/View/Regions/Landmarks/VolcanoLandmark.cs` + `.meta`.
- Mechanical edit to an existing test (coordinator-approved, in the stub commit): `LandmarkViewEditModeTests.cs`: the volcano comes off the
  no-art list of `TheCaveIsTheOnlyKindWithArtAndTheRegistrationPointIsLandmarkArts`, and `AKnownKindWithNoArtRegisteredBuildsNothingAndLogsOnce`
  uses the Hall (kind 5, "no art for kind 5") as its example instead. Nothing else there changed.

Baseline (base `coord/int-25` + stub + oracle): `dotnet test client-unity/RoguehallaNet.Tests`: the 25 new drawing tests are green guards (they pin the
drawing and the tier rule: counts, outlets, no interior, 16-tile rule fidelity, rim-nearer-than-foot); the rest of the suite is as before.
EditMode: total 1009, passed 973, **36 failed, all new, all on assertions** (35 at "Expected 1, but was 0": the Volcano anchor builds no landmark
because no art is registered; 1 at `TheVolcanoIsRegisteredAtTheOnePlace`). Red: `AVolcanoAnchorBuildsOneLandmark...` x8, `TheConeArtCovers...` x8,
`TheConeHasThreeTiers...` x8, `AGlowStandsOnEachOutlet...` x8, `AGlowStandsOverTheLake`, `AFrameWhereNothingChanged...`,
`EverythingTheArtCreatesIsDisposed...`, `TheVolcanoIsRegisteredAtTheOnePlace`. Green guard: `TheFourFrontDirectionsAreAllCoveredByTheEightOrientations`.
Every existing test stays green (including the two edited framework tests). Because each red test stops at its first assertion, the later
assertions (bounds, tiers, glow offsets, allocation, disposal) were reasoned, not run, until an implementation exists; the tier and core numbers
were measured in a throwaway script and the same rule runs, green, in the engine-free test.

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
