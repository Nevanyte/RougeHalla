# P-UNITY-TRAINING-HUD-1: the HUD does not vanish after the drawer and the Tab map are toggled; the training console shows all its rows

- **Serves:** owner decision 7 (2026-11-10: the HUD presents the same information as legacy); screenshot round 8
  (2026-11-12, training room at `86806e01`), defects 1 and 2
- **Implementer tier:** implementer-sonnet (Unity UI)
- **Reviewer:** reviewer
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1 n/a (presentation) · no wire change

## 1. ID and outcome
Seen in the running Web client's training room (shots under the session scratchpad, `shots8/`):
1. **The whole HUD disappears** after the Field Ledger drawer is opened and closed (B, twice), the Tab map is held
   and released, and the Wish is cast (R): the champion panel, hotbar, minimap and potion bar are all gone (shots
   09, 10) and do not come back. The exact trigger was not isolated. When this lands, no sequence of the drawer key,
   the Tab-map key and a Wish cast, in any order, in the arena or in practice, leaves a HUD panel hidden that was
   shown before the sequence: panel visibility is derived each frame from the current state (match phase, drawer
   open, Tab map held, result shown), not toggled by key events that can get out of step.
**Cause of 1 (found by reading, reproduced by the oracle).** It is practice only and needs only the Tab key; the drawer, the Wish and
the order do not matter (the arena passes all 325 orderings today).
1. In a confirmed practice room with the console closed, `MatchHud.FocusRoot` returns the console's root
   (`MatchHud.Features.cs:74`).
2. `ReadUiInput` walks focus on every plain Tab press (`MatchHud.Features.cs:304-306`, `UiFocusNavigation.Cycle`) and selects the
   console's CONSOLE button. The Tab map is not taken in practice (`TacticalMapController.cs:374` `MapAllowed` needs `!Training`;
   `UiInputGate.cs` `CanShowMap`), so nothing else consumes the key.
3. A selected object inside the console makes `TrainingConsoleView.ContainsFocus` true (`TrainingConsoleView.cs:36-43`), so
   `TrainingOwnsKeyboard` is true (`MatchHud.Training.cs:22`), so `BlocksKeyboardInput` and `WorldHudVisible` are false
   (`MatchHud.Features.cs:38,44`).
4. `RefreshWorldHudVisibility` (`MatchHud.Features.cs:379-395`) then hides the plate, champion panel and hotbar/potion bar through
   `RefreshHudElementVisibility` (`MatchHud.Legacy.cs:587-593`) and suppresses the minimap (`SetMinimapSuppressed`,
   `TacticalMapController.cs:350-363`). Nothing clears the selection (a click elsewhere or B does: `ToggleBuild` unbinds the console and
   `ReleaseFocus` drops the selection), so the HUD stays off. Keyboard focus is state that outlives the key event: the panels are
   "derived", but from a predicate that includes it.
Not isolated by a log: that the selected object is the CONSOLE button (the test shows the whole HUD off after Tab alone in practice,
and only there).
**Rule the fix must keep (existing test, unchanged):** `TrainingConsoleIntegrationEditModeTests.ClosedTrainingTabEntersConsoleFocusAndFocusedTextOwnsWorldKeys`
(lines 468-500) asserts that Tab still enters the console's focus and that focused console controls own W/Q/E/1; so
`BlocksKeyboardInput`/`TrainingOwnsKeyboard` stay as they are. Only the visibility of the HUD panels stops reading console focus (a
separate predicate from match phase, drawer open, Tab map open, result shown). No existing test needs to change.

2. **The training console clips its last row** (shot 06): "SET CARD" and what follows are cut off at the panel's
   bottom edge. The console's height follows its rows, or the rows scroll, at 1280x720, 1920x1080 and 1024x768.
3. In practice the Tab map shows nothing. **Legacy takes no Tab map in practice**: `packages/client/src/ui/mapHold.ts:38-39`
   (`mapHoldAllowed` is `phase === "active" && training !== true && !resultsVisible`) and the hold is only started when allowed
   (`mapHold.ts:60-69`). The oracle pins that: Tab opens no map in practice, and holding and releasing it never changes the HUD. The
   brief's other option ("No map in practice" line) is not legacy and is not pinned. Today's Unity already opens no map in practice;
   the vanishing in 1 is what shot 09 showed.

Defect 2 cause: the console (`TrainingConsoleView.cs:70-111`) is a fixed fraction of the canvas; its scroll view holds 770 units of rows
(855 at text scale 1.5, 899 at 1024x768) in a viewport of 482 (557 at 1024x768), with no scrollbar. Rows `CardRow`..`AuthorityNote`
(`CardDescription`.. at 1024x768) lie below the viewport, so "SET CARD" is cut off (shot 06).

## 2. Dependencies
none

## 3. Relevant legacy paths
- `packages/client/src/ui/mapHold.ts:38-39,60-69`: no Tab map in training; Tab is left to the browser there.
- `packages/client/src/ui/hud.ts:185-197`: the training HUD (no run plate, no death line); not changed here.

## 4. New paths
- none (tests only)

## 5. Exclusive write scope
- `client-unity/UnityProject/Assets/Scripts/UI/MatchHud.Features.cs` (`WorldHudVisible` line 38, `RefreshWorldHudVisibility` 379-395)
- `client-unity/UnityProject/Assets/Scripts/UI/MatchHud.Training.cs` (only if the console-focus predicate moves)
- `client-unity/UnityProject/Assets/Scripts/UI/MatchHud.Legacy.cs` (`RefreshHudElementVisibility` 587-593)
- `client-unity/UnityProject/Assets/Scripts/UI/TacticalMapController.cs` (only `SetMinimapSuppressed`/`RefreshMinimapVisibility` if needed)
- `client-unity/UnityProject/Assets/Scripts/UI/TrainingConsoleView.cs` (layout, lines 70-111: height follows rows, or a visible scrollbar)
- not `BuildDrawer.cs` (the drawer is not at fault), not `Presentation/**`, not any existing test

## 7. Behaviour to preserve
- World names hidden while the Tab map is open and shown again on release (P-UNITY-HUD-VISUAL-FIX-4); the practice
  HUD's "PRACTICE" panel in place of the GAINED plate; every existing EditMode test.

## 8. Acceptance checks
- EditMode (`TrainingHudVisibilityEditModeTests`): the 325 orderings (distinct events, lengths 1 to 5) of {drawer open, drawer close,
  Tab hold, Tab release, Wish cast}; an event that does not apply to the state (close with the drawer shut) does nothing; after
  each sequence the drawer is closed and Tab let go, and the active set of {plate, champion panel, hotbar and potion bar, minimap}
  equals the set before. Arena: green today. Practice: red today (186 of 325 sequences; first failing `TabHold`). The named
  reproduction is `InPracticeAHeldAndReleasedTabLeavesEveryHudPanelShown`.
- EditMode (`TrainingConsoleLayoutEditModeTests`): at 1280x720, 1920x1080 and 1024x768, text scales 1 and 1.5, every console row is
  inside the scroll viewport, or the view scrolls and shows a vertical scrollbar and brings the first and last rows inside at the ends
  of its travel (my reading of "reachable": a hidden scroll is the defect); the console and its status line lie inside the window and panel.
- EditMode: `InPracticeTabOpensNoMapLikeLegacyAndNothingHidesTheHud` (map closed, HUD unchanged while Tab is down and after); green
  for the map half today, red for the HUD half.
- `scripts/gate.sh --quick --oracle packet/P-UNITY-TRAINING-HUD-1` passes.

## Oracle files (read-only for implementers)
- `client-unity/UnityProject/Assets/Tests/Editor/TrainingHudRig.cs` (+ `.meta`): real MatchClient/MatchHud on a fake transport, real keyboard
- `client-unity/UnityProject/Assets/Tests/Editor/TrainingHudVisibilityEditModeTests.cs` (+ `.meta`)
- `client-unity/UnityProject/Assets/Tests/Editor/TrainingConsoleLayoutEditModeTests.cs` (+ `.meta`)
- no `stub:` content is needed (the tests use existing members through reflection and public API); the stub commit is empty.

## 9. Validation commands
- `bash client-unity/UnityProject/Tools/editmode.sh` (about 2 minutes); then `git checkout -- client-unity/UnityProject/Assets/Resources/Showcase/NunitoRegular.asset` if the script left it modified.
- Baseline at `packet/P-UNITY-TRAINING-HUD-1`: 887 tests, 878 pass, the 9 failures are exactly this packet's (6 console layout, 3 practice HUD).

## 10. Risk and suggested model tier
Sonnet. The cause is not known: the oracle author reproduces it in EditMode first; if it cannot be reproduced
without the real input system, it says so and pins the derived-visibility rule instead.

## 11. Known traps
- Do not stop Tab entering the console's focus: the existing test above pins it. Fix the HUD's visibility, not the key.
- `WorldHudVisible` also feeds notices, the chest panel, the Hunt card and `RememberWorldHudFocus`; split the predicate for panels
  rather than redefining it, and keep the existing tests green.
- `WorldLabelVisibility.Hidden` is a static set by the Tab map: a second static like it for HUD panels is the kind of
  toggle that gets out of step.
- An EditMode run modifies `Assets/Resources/Showcase/NunitoRegular.asset`: `git checkout --` it, never commit it.

## Notes from previous attempts
