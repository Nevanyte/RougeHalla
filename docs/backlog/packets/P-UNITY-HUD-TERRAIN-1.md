# P-UNITY-HUD-TERRAIN-1: terrain chips say what the ground under you is doing

- **Serves:** ORDER_OF_OPERATIONS phase 3, item 16 (P-UI-5 HUD); owner direction 2026-11-10 (MIGRATION checkpoint,
  decision 7: the HUD presents the same information as legacy); plan lane B, packet 6 ("terrain chips")
- **Implementer tier:** implementer-sonnet
- **Reviewer:** reviewer
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1 loose proof (owner direction 2026-11-10) · D2 n/a · D5/D6/D9 none

## 1. ID and outcome
Legacy shows a chip while the local player stands on ground that acts on them: "BURNING" (embers), "SLOWED" (bog),
"ICE", "RESTING" / "RESTING xN", and a "Home ground: ..." note for a faction on its own terrain, each with a one-line
explanation carrying the number. Unity shows nothing. When this lands a pure function turns the terrain code under the
local player, the player's faction and the delivered rest state into the legacy chips, and the HUD draws them where
legacy does.

## 2. Dependencies
- P-UNITY-HUD-BUILD-1 merged (same HUD files: strictly serial)

## 3. Relevant legacy paths
- `packages/client/src/ui/terrainChips.ts:24-30`, `packages/client/src/render/zoneArt/terrainFeedback.ts` (survey:
  `:82` BURNING, `:86` SLOWED, `:88` ICE, `:92` RESTING, `:104-106` Home ground)
- the constants those texts quote (burn share per second, slow factor) in `packages/shared/src/constants.ts`
(the oracle author verifies the lines, pins texts and numbers, and finds whether the live terrain mode exempts home
factions: the owner said on 2026-11-11 that live faction terrain exemptions stay as they are)

## 4. New paths
- `client-unity/RoguehallaNet/Net/Ui/TerrainChips.cs` (pure) and its test file

## 5. Exclusive write scope
- the new library file, its synced copy and `.meta`
- `client-unity/UnityProject/Assets/Scripts/UI/MatchHud.Features.cs` (the chip row) and, if a new partial is cleaner,
  one new `MatchHud.Terrain.cs`
- a new EditMode test file

## 6. Contracts and references
- No game rule in Unity: the chip reports the tile's terrain code from the delivered map and the numbers from content
  the client already holds (or constants mirrored with a test against the Rust value); it never changes movement or
  health. If a number is not available to the client, the chip shows the legacy text without the number and the brief
  lists it.
- Terrain plane: the map blob (`client-unity/RoguehallaNet/Protocol/MapBlob.cs`); local position: the predicted
  position the HUD already uses.

## 7. Behaviour to preserve
- The rest of the HUD; no allocation per frame (chips rebuilt only when the tile's terrain or the rest state changes).

## 8. Acceptance checks
- `scripts/gate.sh --quick --oracle packet/P-UNITY-HUD-TERRAIN-1` passes; Unity EditMode passes.
- Unit tests on the pure function: each terrain code gives its legacy chip and explanation; plain floor gives none; the
  home-ground rule as the live mode applies it; resting with and without a multiplier.
- One EditMode case: the HUD draws the model's chip.

## Oracle files (read-only for implementers)
- listed by the oracle author on `packet/P-UNITY-HUD-TERRAIN-1`

## 9. Validation commands
- `dotnet test client-unity/RoguehallaNet.Tests`, `bash client-unity/sync-net.sh --check`,
  `client-unity/UnityProject/Tools/editmode.sh`

## 10. Risk and suggested model tier
Sonnet. Small.

## 11. Known traps
- Terrain codes differ between the tile plane and the terrain plane: use the terrain plane's codes as Rust names them.
- "RESTING" needs a delivered fact; if none exists, leave it out and list it under "Not on the wire".

## Notes from previous attempts
