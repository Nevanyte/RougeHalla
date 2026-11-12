# P-UNITY-HUD-CAMPS-2: camp reward badges and ward beacons on the maps and in the world

- **Serves:** ORDER_OF_OPERATIONS phase 3, item 16 (P-UI-5 minimap, P-UI-6 Tab map); owner direction 2026-11-10
  (MIGRATION checkpoint, decision 3: "Camp logos (stat buff) and timers dont show on minimap and tab map"; "this includes
  camp timers vision wards etc."); follow-up named by P-UNITY-HUD-CAMPS-1
- **Implementer tier:** implementer-sonnet
- **Reviewer:** reviewer
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1 loose proof (owner direction 2026-11-10) · D2 n/a · D5/D6/D9 none

## 1. ID and outcome
P-UNITY-HUD-CAMPS-1 draws a marker and a respawn clock per camp. Two legacy facts are still missing on screen: which
stat a camp's mobs give (the "camp logo": a stat icon with the amount, over the living camp in the world and on the
maps), and the vision wards (a beacon at a warded camp with its remaining time, yours distinguished from another
player's, and the ward's sight shown on the minimap). The camp row now carries both facts (P-WIRE17-HUD-1:
`CampView.Reward`, `CampView.Ward`, `CampView.WardExpiresAt`). When this lands every camp marker row carries its reward
badge and its ward state, the minimap, Tab map and world draw them, and a pure function with tests decides the text,
the icon key and when each shows.

## 2. Dependencies
- P-UNITY-HUD-CAMPS-1 and P-WIRE17-HUD-1 merged (both are)

## 3. Relevant legacy paths
- `packages/client/src/render/CampBuffs.ts` (world badge: one per living, visible camp group; stat icon + amount; elite
  augment drop shown beside it)
- `packages/client/src/render/CampWards.ts` (ward beacon and its timer text; the same file holds "RESPAWN Ns")
- `packages/client/src/ui/minimapMarkers.ts`, `minimap.ts`, `mapPainter.ts`, `planning.ts` (reward glyph and ward mark on
  the maps; ward-fed vision on the minimap)
- `packages/shared/src/mobStats.ts` (`mobStatReward`: stat key and amount text), `packages/client/src/ui/combatIcons.ts`
  (`STAT_ICON_COLORS`)
(the oracle author verifies the lines and pins texts, number formatting, colours and the show/hide conditions)

## 4. New paths
- none required: extend `client-unity/RoguehallaNet/Net/Ui/CampMarks.cs` (rows gain reward and ward members) or add
  `CampBadges.cs` beside it; the oracle author chooses and fixes the signatures in a stub

## 5. Exclusive write scope
- `client-unity/RoguehallaNet/Net/Ui/CampMarks.cs` (and a new sibling file if the oracle adds one), their synced copies
  and `.meta` files
- `client-unity/UnityProject/Assets/Scripts/UI/TacticalMapMarks.cs`, `TacticalMapController.cs` (camp layer)
- `client-unity/UnityProject/Assets/Scripts/Presentation/CampRespawnLabels.cs` (world badge and beacon beside the
  respawn label) and its hook in `client-unity/UnityProject/Assets/Scripts/View/ArenaView.cs`
- EditMode tests under `client-unity/UnityProject/Assets/Tests/Editor/` for the camp layer

## 6. Contracts and references
- C-OBS: the ward is a verdict for this viewer (none, yours, other) plus its expiry; the owner's identity is never on
  the wire and is never guessed. The reward is the row's stat code and amount, drawn as sent.
- No game rule in Unity: the remaining ward time is expiry minus server time, drawn only. Unity does not widen the
  player's sight from a ward; it draws the ward's sight circle on the minimap only when legacy does, from the public
  ward radius (name the source constant in the brief; if the radius is not on the wire or in content, say so in the
  hand-off and draw the beacon without the circle).
- Camp rows: `client-unity/RoguehallaNet/Net/Collections.cs` (`CampView`, `WardVerdict`), `WireCampReward`
  (`Protocol/State.cs`; `Value` = amount x `Hud.Quantum`).

## 7. Behaviour to preserve
- Everything P-UNITY-HUD-CAMPS-1 draws (markers, states, clocks, world respawn label) and the existing map marks and
  their draw order.
- `CampMarks.Markers` and `WorldLabels` keep their signatures and results for rows with no reward and no ward.
- No allocation per frame in the map mark pass.

## 8. Acceptance checks
- `scripts/gate.sh --quick --oracle packet/P-UNITY-HUD-CAMPS-2` passes; the Unity EditMode suite passes.
- Unit tests on the pure model: a living camp with a reward gives a badge with the legacy icon key and amount text; a
  cleared camp gives none (pin what legacy does); an elite camp's badge (pin what legacy shows beside it, or record that
  the fact is not on the wire); ward verdict none gives no beacon; yours and other give the two legacy looks; the ward
  timer text and its rounding; an expired ward (expiry at or before now) gives no beacon; training or inactive match
  hides what legacy hides.
- One EditMode case: the tactical map draws a reward badge and a ward beacon for a row that has them.

## Oracle files (read-only for implementers)
- listed by the oracle author on `packet/P-UNITY-HUD-CAMPS-2` (test file; the stub commit fixes the signatures)

## 9. Validation commands
- `dotnet test client-unity/RoguehallaNet.Tests`, `bash client-unity/sync-net.sh --check`
- `client-unity/UnityProject/Tools/editmode.sh`

## 10. Risk and suggested model tier
Sonnet. Medium: two facts over three surfaces, one pure model.

## 11. Known traps
- The stat code on the wire is a byte: map it through the same stat order the build summary uses (name the table in the
  brief), not through a new list.
- Legacy shows the world badge only for a camp group the viewer can see; the maps show map knowledge. Pin each.
- A camp can have a reward chest up, a respawn clock and a ward at once: follow legacy's one-badge rule for the minimap
  and say where the ward mark goes.
- Zone-themed camp buffs are a later packet: the badge must read the row's reward, never a per-mob-type table in Unity.

## Notes from previous attempts
