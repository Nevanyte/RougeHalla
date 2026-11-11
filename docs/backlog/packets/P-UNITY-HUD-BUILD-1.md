# P-UNITY-HUD-BUILD-1: the GAINED strip and the bottom-left champion panel show the legacy numbers

- **Serves:** ORDER_OF_OPERATIONS phase 3, item 16 (P-UI-5 HUD build strip); owner direction 2026-11-10 (MIGRATION
  checkpoint, decision 3: "When a stat is farmed it does not represent in the stats gained bar in top left"; "the damage
  and calculations on the hud in bottom left corner are not presented the same")
- **Implementer tier:** implementer-sonnet
- **Reviewer:** reviewer
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1 loose proof (owner direction 2026-11-10) · D2 n/a · D5/D6/D9 none

## 1. ID and outcome
The Unity GAINED cells show chest-boost pick counts as "xN", the damage cell is always "—" and the mob-bonus row is
hidden, so farming a stat changes nothing on screen. The bottom-left panel shows attack-speed and move-speed
multipliers where legacy shows the weapon's damage per hit and attacks per second, the faction passive's numbers and the
Wish's numbers. With protocol 17 the owning player receives a build summary from the server. When this lands the GAINED
strip shows the nine legacy values with the legacy labels, order and number formatting, the mob-bonus row lists the
farmed stats, and the champion panel's three rows show the legacy text built from the summary. Unity formats; it
computes nothing.

## 2. Dependencies
- P-WIRE17-HUD-1 merged (the owner-only build summary, weapon scaling)

## 3. Relevant legacy paths
- `packages/client/src/ui/buildModel.ts:154-181` (`buildGains`), `buildHud.ts` (labels, order, formatting)
- `packages/client/src/ui/mobStatsHud.ts`, `packages/shared/src/mobStats.ts:116,130` (mob-bonus rows and their text)
- `packages/client/src/ui/championCombatModel.ts:91-216`, `championCombatHud.ts:72,95-111` (panel rows; numbers rounded
  to 2 decimal places)
(the oracle author verifies the lines and pins labels, order, sign handling and rounding)

## 4. New paths
- `client-unity/RoguehallaNet/Net/Ui/BuildHudText.cs` (pure: summary in, the strip cells and panel rows as text out) and
  its test file

## 5. Exclusive write scope
- the new library file and its synced copy (and its Unity `.meta`)
- `client-unity/UnityProject/Assets/Scripts/UI/MatchHud.Features.cs` (GAINED cells, around `:339-351`)
- `client-unity/UnityProject/Assets/Scripts/UI/MatchHud.Legacy.cs` (mob-bonus row around `:220-221`; champion panel
  around `:243-272`, `:466-474`), `MatchHud.IconPresentation.cs` (`:28-55`)
- EditMode tests that pin the old cell or panel text

## 6. Contracts and references
- R-AUTH: every number comes from the server's summary. Unity does not recompute damage, lifesteal or scaling.
- C-OBS: the summary is the local player's own; nothing is shown for other players from it.
- The summary's fields and quantization are fixed by P-WIRE17-HUD-1.

## 7. Behaviour to preserve
- The cards row, chest panel, weapon slots and the rest of the HUD.
- Tooltips keep working; a missing summary (before the first one arrives) shows the legacy empty state, not zeros that
  look like real values.

## 8. Acceptance checks
- `scripts/gate.sh --quick --oracle packet/P-UNITY-HUD-BUILD-1-oracle` passes; the Unity EditMode suite passes.
- Unit tests on the pure formatter: a sample summary gives the nine cells in legacy order with legacy labels and
  formatting (signs, percent, 2-decimal rounding); mob-bonus rows list each farmed stat; the three champion rows read as
  legacy for a sample of each faction's passive; an absent summary gives the empty state.
- One EditMode case: the HUD draws the formatter's cells.

## Oracle files (read-only for implementers)
- listed by the oracle author on `packet/P-UNITY-HUD-BUILD-1`

## 9. Validation commands
- `dotnet test client-unity/RoguehallaNet.Tests`, `bash client-unity/sync-net.sh --check`
- Unity EditMode batch in the worktree (copy-on-write clone of the main checkout's `Library`)

## 10. Risk and suggested model tier
Sonnet. Medium: text and layout over a pure formatter; no rule.

## 11. Known traps
- A value of exactly zero: legacy hides or greys some cells; pin which.
- Negative Defense and Soul Defense show with their sign.
- The summary arrives quantized: format what arrives, do not "repair" it.

## Notes from previous attempts
