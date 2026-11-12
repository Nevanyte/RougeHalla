# P-UNITY-HUD-TEXTSCALE-1: the text-size setting scales every HUD label and each label still fits its box

- **Serves:** ORDER_OF_OPERATIONS phase 3, item 16 (P-UI-5 HUD; settings); reviewer note on P-UNITY-HUD-VISUAL-FIX-2
  (2026-11-12, REAL)
- **Implementer tier:** implementer-sonnet
- **Reviewer:** reviewer
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1 n/a (legacy has no text-size setting) · D2 n/a · D5/D6/D9 none

## 1. ID and outcome
The HUD has a text-size setting (`ShowcaseSettings`, 0.85 to 1.5). `MatchHud.ApplyTextScale` re-applies it to every
label through `MythicTextScale.Apply`, which sets each label's size to its base size times the scale, with no regard
for the label's box. Two consequences: at the default scale the stats-gained labels and the champion panel values
clipped in the real client (P-UNITY-HUD-VISUAL-FIX-2 stopped that by taking those labels out of the setting, so they
no longer grow when a player raises the text size); and at larger scales other fixed-box labels clip the same way
(`MatchHud.Legacy.cs`: the heal text in a 76-wide box around :400, slot names :326, the weapon label :264, "Heal"
:399, "Wind" :407, the wish summary :367, the scaling lines). When this lands `MythicTextScale` honours a per-label
fit: it multiplies the base size by the scale, then caps the result at what the label's box can hold for its current
text (auto-size with a floor of 6, ellipsis off), so every label follows the setting as far as its box allows and
none clips at any scale from 0.85 to 1.5. The opt-out (`KeepFit`) is removed.

## 2. Dependencies
- P-UNITY-HUD-VISUAL-FIX-2 merged

## 5. Exclusive write scope
- `client-unity/UnityProject/Assets/Scripts/UI/MythicTextScale.cs`, `MatchHud.cs` (`ApplyTextScale`),
  `MatchHud.Legacy.cs` (remove `KeepFit`; boxes that need a few units), `HudUi.cs` only if the label helper needs a
  fit flag
- EditMode tests

## 7. Behaviour to preserve
- The default-scale look pinned by `HudVisualFix2EditModeTests` and `HudVisualFixEditModeTests`; no allocation per
  frame (the fit is recomputed when the text or the scale changes, not every frame).

## 8. Acceptance checks
- EditMode, at scales 0.85, 1.0, 1.25 and 1.5 and at 1280x800 and 1920x1080: every HUD label built with a fixed box
  shows its longest realistic text without truncation (list the labels and their longest texts in the oracle); labels
  with room grow with the scale (a label whose box allows it is larger at 1.5 than at 1.0).
- `scripts/gate.sh --quick --oracle packet/P-UNITY-HUD-TEXTSCALE-1` passes; screenshots at scale 1.5 (the coordinator).

## Oracle files (read-only for implementers)
- listed by the oracle author on `packet/P-UNITY-HUD-TEXTSCALE-1`

## 10. Risk and suggested model tier
Sonnet. One mechanism, many labels.

## 11. Known traps
- A fit measured in the editor with no margin does not hold in the Web build: keep the 12 percent margin of
  P-UNITY-HUD-VISUAL-FIX-2's oracle.

## Notes from previous attempts
