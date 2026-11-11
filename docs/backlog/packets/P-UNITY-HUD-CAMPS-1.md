# P-UNITY-HUD-CAMPS-1: camps and their respawn timers on the minimap, Tab map and in the world

- **Serves:** ORDER_OF_OPERATIONS phase 3, item 16 (P-UI-5 minimap, P-UI-6 Tab map); owner direction 2026-11-10
  (MIGRATION checkpoint, decision 3: "Camp logos (stat buff) and timers dont show on minimap and tab map")
- **Implementer tier:** implementer-sonnet
- **Reviewer:** reviewer
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1 loose proof (owner direction 2026-11-10) · D2 n/a · D5/D6/D9 none

## 1. ID and outcome
Legacy shows every camp on the minimap and the Tab map (a marker per camp with its zone shape, an elite glyph, a cleared
cross) with a blue respawn countdown, and "RESPAWN Ns" in the world at a cleared camp. Unity draws none of it, although
the camp state (mob type, elite, alive, state, respawn time) is already in client state and unused. With protocol 17
the map blob also carries each camp's position, radius and zone. When this lands the Unity minimap and Tab map draw a
marker for every camp at its position with the legacy states, show the respawn countdown for cleared camps, and the
world shows the "RESPAWN Ns" label; the real concealment bushes from the map blob are drawn. Reward badges and ward
beacons are the follow-up P-UNITY-HUD-CAMPS-2 (they need P-WIRE17-HUD-1).

## 2. Dependencies
- P-WIRE17-MAP-1 merged (camp positions and the bush plane in the map blob)

## 3. Relevant legacy paths
- `packages/client/src/ui/minimap.ts` (camp markers and respawn clocks; survey: `:257-269`, `:294-309`)
- `packages/client/src/ui/minimapMarkers.ts` (marker shapes and states; survey: `:60-71`, `:85-92`, `:111-112`)
- `packages/client/src/ui/mapPainter.ts`, `packages/client/src/ui/planning.ts` (Tab map camp layer)
- `packages/client/src/render/CampWards.ts:13-20` ("RESPAWN Ns" label)
(the oracle author verifies the lines and pins the texts, colours and the countdown rounding)

## 4. New paths
- `client-unity/RoguehallaNet/Net/Ui/CampMarks.cs` (pure model: from the map's camp list and the camp state rows to
  marker rows with kind, state and countdown text) and its test file

## 5. Exclusive write scope
- the new library file and its synced copy
- `client-unity/UnityProject/Assets/Scripts/UI/TacticalMapMarks.cs`, `TacticalMapController.cs` (camp layer)
- a small world-label presenter under `client-unity/UnityProject/Assets/Scripts/Presentation/` and its hook in
  `client-unity/UnityProject/Assets/Scripts/View/ArenaView.cs`
- the bush drawing in `client-unity/UnityProject/Assets/Scripts/View/Regions/` (from the map blob's bush plane)

## 6. Contracts and references
- C-OBS: a camp's position is public map data (legacy clients generated the map); its state comes from the camp rows
  the server already sends to this viewer. Nothing is inferred beyond those rows.
- No game rule in Unity; the countdown is server time minus the row's respawn time, drawn only.
- Camp rows: `client-unity/RoguehallaNet/Net/Collections.cs` (around `:407-411`: `MobType`, `Elite`, `Alive`, `State`,
  `RespawnAt`); map camps: `client-unity/RoguehallaNet/Protocol/MapBlob.cs` (protocol 17), index-aligned with the rows.

## 7. Behaviour to preserve
- Existing map marks (contacts, route, quests, traders, chests, zone icons) and their draw order.
- Decorative bushes keep being drawn only where they do not sit on a real concealment cell.
- No allocation per frame in the map mark pass.

## 8. Acceptance checks
- `scripts/gate.sh --quick --oracle packet/P-UNITY-HUD-CAMPS-1-oracle` passes; Unity EditMode suite passes.
- Unit tests on the pure model: one marker per camp at the map position; alive, cleared and elite states; the countdown
  text for a cleared camp with a respawn time (legacy rounding); no countdown when the camp is alive or has no time;
  a camp-row count that differs from the map's camp count gives no markers and no exception.
- One EditMode case: the tactical map draws the model's markers.

## Oracle files (read-only for implementers)
- listed by the oracle author on `packet/P-UNITY-HUD-CAMPS-1`

## 9. Validation commands
- `dotnet test client-unity/RoguehallaNet.Tests`, `bash client-unity/sync-net.sh --check`
- Unity EditMode batch (in the worktree, through a copy-on-write clone of the main checkout's `Library`)

## 10. Risk and suggested model tier
Sonnet. Medium: three surfaces (minimap, Tab map, world) over one pure model.

## 11. Known traps
- World units to map pixels: use the existing map projection (`RoguehallaNet/Net/Ui/MapProjection.cs`), do not rescale
  by hand.
- Fog of war: legacy shows every camp marker regardless of sight (map knowledge), but a camp's alive/cleared state only
  as last delivered. Pin what legacy does and copy it.
- The minimap is small: clocks must not overlap contact dots; follow legacy's placement.

## Notes from previous attempts
