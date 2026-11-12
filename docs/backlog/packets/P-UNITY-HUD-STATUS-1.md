# P-UNITY-HUD-STATUS-1: the top line, consumable timers and cooldown text read as legacy

- **Serves:** ORDER_OF_OPERATIONS phase 3, item 16 (P-UI-5 HUD); owner direction 2026-11-10 (MIGRATION checkpoint,
  decision 7); plan lane B, packet 6 ("lobby/planning countdown text")
- **Implementer tier:** implementer-sonnet
- **Reviewer:** reviewer
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1 loose proof (owner direction 2026-11-10) · D2 n/a · D5/D6/D9 none

## 1. ID and outcome
Three HUD texts differ from legacy. (1) The top line: legacy reads "Waiting for players n/min — run starts in Ns",
"Planning Ns", "Alive a/b · Run GV n" during the run (with the coliseum line), and "Run over — X is victorious";
Unity drops "/min" (it passes 0), has no "Alive a/b · Run GV n" and no run-over line. (2) Consumables: legacy shows
"Healing xN Ns" while a healing potion runs, "+50% speed" / "Active Ns" for the wind emblem; Unity shows counts only.
(3) Ability slots: legacy shows "Ready in m:ss" and a seconds badge on a cooling ability; Unity shows a timer for the
Wish only. When this lands pure functions produce each legacy text from delivered state and the HUD draws them. A text
whose fact is not delivered (the room's minimum players until the wire carries it) keeps today's form and is listed.

## 2. Dependencies
- P-UNITY-HUD-TERRAIN-1 merged or not running (same HUD files: strictly serial)

## 3. Relevant legacy paths
- `packages/client/src/ui/hud.ts:41-56` (top line), `:258-285` (coliseum / sudden death)
- `packages/client/src/ui/weaponBar.ts:48,93,145-148` (potion and emblem texts)
- `packages/client/src/ui/abilitySlot.ts:131,149,276-297` (cooldown format, "Ready in", badges)
(the oracle author verifies the lines and pins texts, rounding and the m:ss format)

## 4. New paths
- none required: extend `client-unity/RoguehallaNet/Net/Ui/Indicators.cs` (`PhaseLine`) and add
  `client-unity/RoguehallaNet/Net/Ui/SlotText.cs` (consumable and cooldown texts) with tests

## 5. Exclusive write scope
- `Indicators.cs` (`PhaseLine` / `ArenaLine` only), the new `SlotText.cs`, synced copies and `.meta`
- `client-unity/UnityProject/Assets/Scripts/UI/MatchHud.cs` (the ability and potion text call sites, around `:317`,
  `:357`, `:377`), `MatchHud.Features.cs` (the top line call, around `:171`), `MatchHud.IconPresentation.cs` (`:77-80`)
- EditMode tests that pin the old texts

## 6. Contracts and references
- Every number is delivered state minus server time, formatted only. Alive counts come from the roster rows the
  client holds (`StateKey.Roster`), GV from the player's own row.
- `Indicators.PhaseLine` is pinned by `IndicatorFactsTests`: tests that pin text this packet changes are replaced by
  the oracle, not edited by the implementer.

## 7. Behaviour to preserve
- "Coliseum m:ss" counting down to the gate lock and to sudden death (P-UNITY-TIMER-1).
- No allocation per frame: texts rebuilt when the shown second changes.

## 8. Acceptance checks
- `scripts/gate.sh --quick --oracle packet/P-UNITY-HUD-STATUS-1` passes; Unity EditMode passes.
- Unit tests: each phase's top line with legacy text; "n/min" when the minimum is known and today's text when it is
  not; healing and emblem timer texts and when they hide; cooldown "m:ss" at 0, 9, 59, 60 and 125 seconds.
- One EditMode case: a cooling ability slot shows the model's text.

## Oracle files (read-only for implementers)
- listed by the oracle author on `packet/P-UNITY-HUD-STATUS-1`

## 9. Validation commands
- `dotnet test client-unity/RoguehallaNet.Tests`, `bash client-unity/sync-net.sh --check`,
  `client-unity/UnityProject/Tools/editmode.sh`

## 10. Risk and suggested model tier
Sonnet. Small to medium: three texts, one HUD class.

## 11. Known traps
- The winner's name in "Run over" must come from delivered results, not from the last living row the client saw.
- Healing and emblem timers need delivered end times: if only counts are delivered, list the gap; do not estimate.

## Notes from previous attempts
