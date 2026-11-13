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
2. **The training console clips its last row** (shot 06): "SET CARD" and what follows are cut off at the panel's
   bottom edge. The console's height follows its rows, or the rows scroll, at 1280x720, 1920x1080 and 1024x768.
3. In practice the Tab map shows nothing (shot 09: the room has no zones): it shows the practice room's map or a
   one-line "No map in practice" (say which legacy does: `packages/client/src/ui` Tab map in training) and never
   hides the rest of the HUD on release.

## 2. Dependencies
none

## 5. Exclusive write scope
- `client-unity/UnityProject/Assets/Scripts/UI/{MatchHud.cs,MatchHud.Training.cs,TacticalMapController.cs,TrainingConsoleView.cs}`
  and the drawer's script (the oracle author names the real files and the cause)
- not `Presentation/**`

## 7. Behaviour to preserve
- World names hidden while the Tab map is open and shown again on release (P-UNITY-HUD-VISUAL-FIX-4); the practice
  HUD's "PRACTICE" panel in place of the GAINED plate; every existing EditMode test.

## 8. Acceptance checks
- EditMode: for every ordering of {drawer open, drawer close, Tab map hold, Tab map release, Wish cast} of length up
  to five, starting from the in-match HUD in the arena and in practice, the set of active HUD panels after the
  sequence equals the set before it (drawer closed, map released); the test that reproduces today's vanishing case
  is named and is red today.
- EditMode: every row of the training console lies inside the console's rectangle (or its scroll view's content is
  reachable) at the three window sizes, at text scales 1 and 1.5.
- EditMode: holding the Tab map in practice shows the stated content and releasing it restores the HUD.
- `scripts/gate.sh --quick --oracle packet/P-UNITY-TRAINING-HUD-1` passes.

## Oracle files (read-only for implementers)
- listed by the oracle author on `packet/P-UNITY-TRAINING-HUD-1`

## 10. Risk and suggested model tier
Sonnet. The cause is not known: the oracle author reproduces it in EditMode first; if it cannot be reproduced
without the real input system, it says so and pins the derived-visibility rule instead.

## 11. Known traps
- `WorldLabelVisibility.Hidden` is a static set by the Tab map: a second static like it for HUD panels is the kind of
  toggle that gets out of step.
- An EditMode run modifies `Assets/Resources/Showcase/NunitoRegular.asset`: `git checkout --` it, never commit it.

## Notes from previous attempts
