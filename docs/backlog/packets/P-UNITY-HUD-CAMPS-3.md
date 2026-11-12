# P-UNITY-HUD-CAMPS-3: reward chests show their remaining seconds on the maps and in the world

- **Serves:** ORDER_OF_OPERATIONS phase 3, item 16 (P-UI-5 minimap, P-UI-6 Tab map); owner direction 2026-11-10
  (MIGRATION checkpoint, decision 3: camp timers on the minimap and Tab map); `docs/unity/PROTOCOL_GAPS.md` rows W2, W3
- **Implementer tier:** implementer-sonnet
- **Reviewer:** reviewer
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1 loose proof (owner direction 2026-11-10) · D2 n/a · D5/D6/D9 none

## 1. ID and outcome
When a camp is cleared its reward chest stands for a limited time. Legacy shows the chest's remaining seconds on the
minimap blip (it replaces the camp's respawn clock while the chest is up: one badge per camp) and a ring with the
seconds in the world. Unity plots chests as plain plus glyphs with no time. The chest rows with their expiry are
already in client state (`Collections.RewardChests`, `RewardChestView.ExpiresAt`). When this lands a pure function
gives each chest's badge text and which camp badge it replaces, and the minimap, Tab map and world draw it.

## 2. Dependencies
- P-UNITY-HUD-CAMPS-2 merged (same map layer files: strictly serial)

## 3. Relevant legacy paths
- `packages/client/src/ui/minimapMarkers.ts:46-71` (badge box, `String(ceil(left))`, the one-badge rule)
- the world chest ring and its seconds (find it under `packages/client/src/render/`; the oracle author names it)

## 4. New paths
- chosen by the oracle author (a `ChestBadges` model beside `CampMarks` / `CampBadges`)

## 5. Exclusive write scope
- the model file, its synced copy and `.meta`
- `client-unity/UnityProject/Assets/Scripts/UI/TacticalMapMarks.cs`, `TacticalMapController.cs` (chest layer)
- the world chest presenter under `client-unity/UnityProject/Assets/Scripts/Presentation/` (name it)
- EditMode tests for the chest layer

## 6. Contracts and references
- C-OBS: only chests in the viewer's delivered rows. No game rule in Unity: seconds are expiry minus server time.

## 7. Behaviour to preserve
- Camp markers, respawn clocks, reward badges and ward beacons (CAMPS-1, CAMPS-2) except where the one-badge rule
  replaces a clock while a chest is up.
- No allocation per frame.

## 8. Acceptance checks
- `scripts/gate.sh --quick --oracle packet/P-UNITY-HUD-CAMPS-3` passes; Unity EditMode passes.
- Unit tests: a chest with 12.3 s left reads "13"; an expired chest gives no badge; a chest near a cleared camp
  suppresses that camp's respawn clock and the clock returns when the chest is gone; a picked chest (pin legacy).
- One EditMode case: the minimap draws the seconds on a chest.

## Oracle files (read-only for implementers)
- listed by the oracle author on `packet/P-UNITY-HUD-CAMPS-3`

## 9. Validation commands
- `dotnet test client-unity/RoguehallaNet.Tests`, `bash client-unity/sync-net.sh --check`,
  `client-unity/UnityProject/Tools/editmode.sh`

## 10. Risk and suggested model tier
Sonnet. Small.

## 11. Known traps
- Which camp a chest belongs to: chest rows carry a position, not a camp index; pin how legacy pairs them (nearest
  camp within a distance) and copy it.

## Notes from previous attempts
