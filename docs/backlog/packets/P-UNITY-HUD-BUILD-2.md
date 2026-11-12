# P-UNITY-HUD-BUILD-2: the bottom-left champion panel shows the legacy rows from the server's panel values

- **Serves:** ORDER_OF_OPERATIONS phase 3, item 16 (P-UI-5 HUD); owner direction 2026-11-10 ("the damage and
  calculations on the hud in bottom left corner are not presented the same. Please make UI more closely match the
  legacy version in terms of the information presented")
- **Implementer tier:** implementer-sonnet
- **Reviewer:** reviewer
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1 loose proof (owner direction 2026-11-10) · D2 n/a · D5/D6/D9 none

## 1. ID and outcome
Legacy's bottom-left champion panel has three rows: the **auto attack** (damage per hit split into physical, magic and
true, and attacks per second), the **faction passive** with its live numbers (Fire burn per second and roam charge,
Sentenced mark pulse and kill-stack share, Plague disease per second with corpse stacks and the zombie's health, Frost
slows and Frozen Justice, Holy life steal with camp clears), and the **Wish**. Unity shows attack-speed and move-speed
multipliers instead. With P-WIRE17-HUD-2 the owner receives the panel values (`Collections.Summary.Panel`: codes 0-22
with values in `Hud.Quantum` units). When this lands a pure formatter turns the panel values into the auto row and
the passive row with legacy's labels, order and 2-decimal formatting, and the HUD draws them in the bottom-left
panel. The Wish row's numbers arrive with P-WIRE17-HUD-2b: until then the Wish row keeps today's text and is listed
as not delivered. Unity formats; it computes nothing except the displayed total of the three damage parts (as the
wire packet's brief records).

## 2. Dependencies
- P-WIRE17-HUD-2 merged (the panel values)

## 3. Relevant legacy paths
- `packages/client/src/ui/championCombatModel.ts:91-216` (rows and what each prints), `championCombatHud.ts:72,95-111`
  (labels, visibility: only while alive and the run is active or training, 2-decimal rounding)
- the code table in `docs/backlog/packets/P-WIRE17-HUD-2.md` (code, meaning, legacy line)
(the oracle author verifies the lines and pins each faction's row text for a sample panel)

## 4. New paths
- `client-unity/RoguehallaNet/Net/Ui/ChampionPanelText.cs` (pure: panel values and faction in, the rows out) and its
  test file

## 5. Exclusive write scope
- the new library file, its synced copy and `.meta`
- `client-unity/UnityProject/Assets/Scripts/UI/MatchHud.Legacy.cs` (the champion panel, around `:243-272`, `:466-474`),
  `MatchHud.IconPresentation.cs` (`:28-55`: the multipliers it replaces)
- EditMode tests that pin the old panel text; one new EditMode case

## 6. Contracts and references
- R-AUTH: every number is a delivered panel value. C-OBS: the panel is the local player's own.
- A code that is absent is not shown (never a zero that looks real); an unknown code is skipped.

## 7. Behaviour to preserve
- The GAINED strip, mob-bonus row, terrain chips, slot texts and the rest of the HUD; tooltips.
- No allocation per frame: rows are rebuilt only when the summary object changes (as `BuildHudText` does).

## 8. Acceptance checks
- `scripts/gate.sh --quick --oracle packet/P-UNITY-HUD-BUILD-2` passes; Unity EditMode passes.
- Unit tests on the formatter: the auto row for a sample panel (three parts, total, attacks per second, legacy
  formatting); each faction's passive row from a sample of its codes; conditional parts (zombie health only with a
  living zombie; "armed" versus "N/M charged"; Frozen Justice active); a null summary or empty panel gives the legacy
  empty state; legacy's visibility rule (alive, active or training).
- One EditMode case: the HUD draws the formatter's rows.

## Oracle files (read-only for implementers)
- listed by the oracle author on `packet/P-UNITY-HUD-BUILD-2`

## 9. Validation commands
- `dotnet test client-unity/RoguehallaNet.Tests`, `bash client-unity/sync-net.sh --check`,
  `client-unity/UnityProject/Tools/editmode.sh`

## 10. Risk and suggested model tier
Sonnet. Medium: five faction rows over one formatter.

## 11. Known traps
- Percent values arrive as fractions in quantum units: format as legacy prints them (percent sign, decimals).
- The panel is re-sent often (roam charge every tick while ramping): the rebuild-on-change guard must compare the
  shown strings or values, not allocate every time a summary arrives.

## Notes from previous attempts
