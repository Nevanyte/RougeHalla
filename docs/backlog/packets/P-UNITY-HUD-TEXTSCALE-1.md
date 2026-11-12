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

## 3. Relevant legacy paths
Legacy has no text-size setting (D1 n/a). The behaviour under test is the Unity client's own:
- `client-unity/UnityProject/Assets/Scripts/UI/MythicTextScale.cs:9-14`: size and max = BaseSize x clamp(scale, .85, 1.5), min = 0.85 of that.
- `MatchHud.cs:76` subscribes `ApplyTextScale` to `ShowcaseSettings.Changed`; `MatchHud.cs:121-132` applies it to the `_scaledText` list and,
  through `MythicUi.ApplyTextScale(_root, scale)` (`MythicUi.cs:99-102`), to every `MythicTextScale` under the canvas root.
- `HudUi.cs:121-152` `Label`: every label gets a `MythicTextScale` (BaseSize = the size it was built at), `Ellipsis` overflow, and a rect grown
  vertically by `ceil(size * .45)` at build time (so the box height is fixed at the unscaled size).
- `MatchHud.Legacy.cs:189-208, 275-277` `KeepFit`: the opt-out this packet removes (destroys the component on 9 gained names, 9 gained values,
  3 champion row names, 3 champion row values).

### Findings the oracle author made (read these before implementing)
1. **Text arrives by `.text =` as well as `Set`.** The gained values (`MatchHud.Features.cs:414`), the phase strip, the terrain chips and the
   inspector card write `.text` directly, so a re-fit hooked on `MatchHud.Set` would miss them. The fit must follow the label's text itself
   (for example `TMPro_EventManager.TEXT_CHANGED_EVENT`, or a cheap text-length/hash check in `LateUpdate`; no allocation per frame).
2. **The inspector card is on its own canvas** (`ArenaView.CreateInspector`, `ArenaView.cs:165-173`), outside `MatchHud._root`, so
   `MatchHud.ApplyTextScale` never reaches it: it takes the scale only at construction. Its box height is `lines * 20 + 20`
   (`InspectorCardView.Layout`, `:84-93`), fixed at 14 px text. It must follow `ShowcaseSettings.Changed` itself and re-lay-out.
3. **The home-ground note's rect height** is measured once at `ShowTerrain` (`MatchHud.Terrain.cs:117-122`); a scale change after that leaves
   the rect at the old height, so a wrapped second line clips.
4. **Heights clip as well as widths**: at 1.5 the inspector card needs 143 of its 94 (four lines at 21 px in 20 px lines), the mob-bonus row needs
   45 of 28 and the home-ground note 45 of 28 (a second wrapped line). The fit measures the box height too.
5. **Some labels clip at the default scale already** (1.0): see the table. They clip because the legacy-sized boxes are narrower than the
   longest text at the theme's base size.
6. The pickup hint button is built with `theme.SizeTiny` then set to `SizeSmall` by hand (`MatchHud.Legacy.cs:420`), so its `BaseSize` is 10
   and any `Apply` shrinks it from 11 to 10. Not in this packet's scope to change the default look; the oracle accepts either.

## 4. New paths
- `client-unity/UnityProject/Assets/Tests/Editor/HudTextScaleEditModeTests.cs` and `.meta` (the oracle)

## 5. Exclusive write scope
- `client-unity/UnityProject/Assets/Scripts/UI/MythicTextScale.cs` (the mechanism)
- `client-unity/UnityProject/Assets/Scripts/UI/MatchHud.cs` (`ApplyTextScale`)
- `client-unity/UnityProject/Assets/Scripts/UI/MatchHud.Legacy.cs` (remove `KeepFit`; boxes that need a few units)
- `client-unity/UnityProject/Assets/Scripts/UI/MatchHud.Terrain.cs` (the note's height follows the scale), only if needed
- `client-unity/UnityProject/Assets/Scripts/UI/InspectorCardView.cs` (follow `ShowcaseSettings.Changed`, scale its line height)
- `client-unity/UnityProject/Assets/Scripts/UI/HudUi.cs` only if the label helper needs a fit flag or a scale-aware box
- Not the oracle file, and no existing test: `HudVisualFixEditModeTests.cs` and `HudVisualFix2EditModeTests.cs` stay as they are.

## 6. Contracts and references
- AGENTS.md "Non-negotiables": Unity holds no game rules; this is presentation only.
- `docs/DEVIATIONS.md`: none (the setting is a Unity addition, D1 n/a).

## 7. Behaviour to preserve
- The default-scale look pinned by `HudVisualFix2EditModeTests` and `HudVisualFixEditModeTests`. Those tests measure each label at its smallest
  size (`fontSizeMin` when `enableAutoSizing`, else `fontSize`) after `ApplyTextScale`, and need: gained names floor >= 7, gained values >= 6,
  champion row values >= 9 (they are 10 today), and the 12 percent (names, values) / 8 percent (champion values) margins. Keep those floors when
  the labels go back under `MythicTextScale` (a per-label floor, not one global 6).
- No allocation per frame: the fit is recomputed when the text or the scale changes, not every frame.

## 8. Acceptance checks
- The oracle: `HudTextScaleEditModeTests` (17 red tests today: every other EditMode test passes; total 706).
- `scripts/gate.sh --quick --oracle packet/P-UNITY-HUD-TEXTSCALE-1` passes; screenshots at scale 1.5 (the coordinator).

### Label inventory (63 labels in the oracle; sizes in HUD units; widths are the label box, heights before the build-time grow)
`Fit` = what is true today. Longest text is the one the oracle sets (from the pure formatters named in the last column). "clips at" lists
the scales (0.85 / 1.0 / 1.25 / 1.5) at which the label's longest text overflows its box by the oracle's rule today; the result is the
same at 1280x800 and 1920x1080 because the boxes are in HUD units.

| Label (count) | Box w x h | Base | Wraps | Auto-size today | Longest realistic text (source) | Clips at |
|---|---|---|---|---|---|---|
| PerformanceReadout (1) | 108 x 24 | 11 | no | no | `240 fps · 1234 ms` (TickMetrics) | 1.25, 1.5 |
| ConnectionBanner (1) | 356 x 28 | 13 bold | no | no | `Connection interrupted · resuming seat (attempt 10)` (HudLateUpdate) | 1.0, 1.25, 1.5 |
| PhaseTimer (1) | 220 x 26 | 13 bold | no | no | `Waiting for players 12 — run starts in 1:30`, `Run over — [BOT] Wanderer1234 is victorious` (Indicators.PhaseLine) | all four |
| Notice (1) | 452 x 30 | 13 | no | no | `Resume is unavailable while another launch or session is active.` (MatchHud.Resume.cs:165) | 1.25, 1.5 |
| QuestLauncher button label (1) | 84 x 22 | 11 | no | no | `Quests · J` | fits |
| PlateStatus (1) | 224 x 15 | 11 bold | no | no | the banner texts (HudLateUpdate) | all four |
| PlateVitals (1) | 224 x 15 | 11 | no | no | `Sentenced · HP 1234.5 / 1234.5 · Barrier 123.4` (MatchHud.cs:318) | 1.0, 1.25, 1.5 |
| PlateCombatStats (1) | 224 x 15 | 10 | no | no | `Kills 123 · GV 12345 · Alive` | fits |
| HpLabel (1) | 16 x 15 | 10 bold | no | no | `HP` | 1.0, 1.25, 1.5 |
| HpValue (1) | 122 x 15 | 11 bold, rich | no | no | `1234/1234 +123 · Bounty 12` with the colour tag (Legacy.cs:474-479) | all four |
| GainedHeading (1) | 224 x 12 | 10, spacing 3 | no | no | `GAINED` | fits |
| GainedName (9) | 58 x 14 | 10 (floor 7) | no | KeepFit 7..8 | `Offense`, `SO`, `Damage gained`, `Attack speed`, `Life steal`, `Health gained`, `Defense`, `Soul Defense`, `Move speed` (CellNames) | opted out of the setting |
| GainedValue (9) | 30 x 14 | 10 bold (floor 6) | no | KeepFit 6..10 | `+125.5%`, `+1234.5` (HudVisualFix2 tests) | opted out of the setting |
| ExtrasToggle (1) | 224 x 14 | 10 | no | no | `Cards & mob bonuses · 3` | fits |
| CardsRow (1) | 224 x 40 | 11 | yes | no | `Cards: Offense I ×12 · Offense II ×12 · Offense III ×12` (RefreshCardsRow) | all four except 1.0 |
| MobBonusRow (1) | 224 x 18 | 11 | yes | no | `Wolf ×12 +12.5% attack speed · Boar ×8 +1.5 armor` (BuildHudText.MobLines) | all four |
| ChampionName (1) | 130 x 16 | 12 bold | no | no | `Sentenced` | fits |
| ChampionWeapon (1) | 92 x 14 | 10 | no | no | `Shield` | fits |
| ChampionRowName (3) | 72 x 14 | 10 bold (floor 8) | no | KeepFit 8..10 | `Shield hit`, `Dragonslayer`, `Wish` (ChampionPanelText) | opted out of the setting |
| ChampionRowValue (3) | 152 x 15 | 12 bold (floor 10) | no | KeepFit 10..12 | `49.19 / hit · 1.98/s`, `32% AS · 30% MS slow`, `2.16% target HP / hit`, `64.38 magic/s`, `LastStand · 3/3` | opted out of the setting |
| ChampionScaling, passive row (1) | 224 x 11 | 9 | no | no | `SO adds 12.5, Offense 18.75 magic DPS/point · DoT ×2.5` and the other three faction lines | 1.0, 1.25, 1.5 |
| SlotKey (2) | 20 x 12 | 10 | no | no | `1`, `2` | fits |
| SlotName (2) | 96 x 14 | 11 | no | no | `Shield`, `Empty` | fits |
| SwapKey (1) | 28 x 14 | 11 bold | no | no | `Q` | fits |
| SwapCaption (1) | 28 x 11 | 7 | no | no | `SWAP` | 1.25, 1.5 |
| ControlsLine (1) | 240 x 13 | 10 | no | no | `WASD move · Click attack · R Wish` | 1.5 |
| PickupHint (1) | 194 x 22 | 10 (set to 11) | no | no | `F  swap Shield for Fists` | fits |
| WishKey (1) | 14 x 12 | 10 | no | no | `R` | fits |
| WishSeconds (1) | 64 x 24 | 15 bold | no | no | `125` | fits |
| WishSummary (1) | 60 x 12 | 10 | no | no | `3/3 · 1:25` (WishIconText) | 1.25, 1.5 |
| WishCharges (1) | 20 x 14 | 11 bold | no | no | `3` | fits |
| HealKey (1) | 12 x 12 | 10 | no | no | `E` | fits |
| HealName (1) | 28 x 14 | 11 bold | no | no | `Heal` | 1.25, 1.5 |
| HealCounts (1) | 76 x 14 | 11 | no | 8..11 | `99 large · 99 small` (SlotText.PotionCounts) | all four |
| HealStatus (1) | 48 x 14 | 11 | no | 8..11 | `Healing x5` (SlotText.HealingStatus) | all four |
| WindName (1) | 30 x 14 | 11 bold | no | no | `Wind` | 1.0, 1.25, 1.5 |
| WindText (1) | 100 x 14 | 11 | no | no | `Walk over emblems`, `+50% speed` (SlotText.SpeedLabel) | 1.0, 1.25, 1.5 |
| DeathLine (1) | 380 x 64 | 44 display, spacing 6 | no | no | `YOU DIED` | 1.25, 1.5 |
| TerrainChip (1) | 256 x 18 | 11 bold | no | no | `▼ SLOWED`, `▲ BURNING` (TerrainChips) | fits |
| TerrainHomeNote (1) | 256 x 18 (grows on show) | 11 | yes | no | `Home ground: embers can't burn you` (TerrainChips.HomeNote) | 1.25, 1.5 |
| InspectorCard (1) | 310 x (lines x 20) | 14 | yes | no | four lines from `InspectorCard.Build`: `Sentenced · Shield · Patient executioner`, `Health 100%`, `Offense`, `Soul Offence` | 1.25, 1.5 |

Number of labels that clip today by the oracle's rule (widest-text overflow of width at 88 percent or of height; the same at both window sizes):
**7 at 0.85, 12 at 1.0, 21 at 1.25, 22 at 1.5.** 24 more labels (the gained names and values, the champion row names and values) are not under the
setting at all. Every label also has `Ellipsis` overflow today, which the oracle forbids.

Not in the inventory, on purpose: the slot "Scaling" label under each weapon slot (never given text), the tooltip text (`HudIconHint`: sized to its
text, no fixed box), the hidden `WishCard` detail text (a `MatchHud.Text` label scaled through `_scaledText`), and the modal panels (launch, settings,
help, hub, chest, results: other packets).

### Mechanism contract
Decided by the oracle author; the implementer may choose the internals.
1. `MythicTextScale.Apply(scale)` sets the size to `BaseSize x clamp(scale, .85, 1.5)` **capped** at the largest size at which the label's *current text*
   fits its rect: the widest line needs at most 88 percent of the width, and the (wrapped, for a wrapping label) text needs at most the rect height. The
   floor is 6 for every label, higher where the existing tests need it (see section 7). If even the floor does not fit, the box is too small: change the box
   (a few units) in `MatchHud.Legacy.cs` rather than lower the floor. Ellipsis (and Truncate) are off on every label.
2. The size is visible on the label: `enableAutoSizing ? fontSizeMax : fontSize` is the largest size the label can render at, and `fontSizeMin` (or
   `fontSize`) the smallest. The oracle measures at those; the capped maximum must itself satisfy the 88 percent rule (TMP's own auto-size would settle at
   100 percent of the box, which has no margin).
3. `MythicTextScale.Refit()` (stubbed on this branch, public) recomputes the fit for the current text at the last applied scale. It must also run by
   itself when the label's text changes (finding 1), without allocating per frame.
4. `HudUi.Label` labels get the fit by default; `KeepFit` and its call sites go. The inspector card follows `ShowcaseSettings.Changed` itself
   (finding 2) and re-lays-out its box for the scaled line height; `TerrainHomeNote` re-measures its rect on a scale change (finding 3).
5. Growth: a label whose box has room for `BaseSize x scale` is exactly that size; one that has not is held at the fit. The size never falls as the
   scale rises.

## Oracle files (read-only for implementers)
- `client-unity/UnityProject/Assets/Tests/Editor/HudTextScaleEditModeTests.cs`
- `client-unity/UnityProject/Assets/Tests/Editor/HudTextScaleEditModeTests.cs.meta`

Tests (20): `EveryLabelShowsItsLongestTextWithoutTruncationAfterTheScaleIsApplied` and
`ATextThatArrivesAfterTheScaleWasAppliedStillFitsOnceTheLabelRefits` (each 4 scales x 2 windows, red); `NoLabelOfTheMatchHudIsOptedOutOfTheSetting`
(red); `LabelsFollowTheSettingUpwardsAndTheOnesWithRoomAreLargerAtOnePointFiveThanAtOne` (2 windows) and `TheInventoryCoversTheWholeMatchHud`
(green today: they guard the fix against a size pinned low and against labels dropping out of the checks).

### Replaced assertions
None. No existing test asserts the opt-out (a label without `MythicTextScale`); `HudVisualFix2EditModeTests` and `HudVisualFixEditModeTests` are
unchanged. They will begin to measure the gained and champion labels through `MythicTextScale` again, which is why section 7 lists the floors.

## 9. Validation commands
- `client-unity/UnityProject/Tools/editmode.sh` (EditMode, 706 tests on this branch)
- `scripts/gate.sh --quick --oracle packet/P-UNITY-HUD-TEXTSCALE-1`

## 10. Risk and suggested model tier
Sonnet. One mechanism, many labels.

## 11. Known traps
- A fit measured in the editor with no margin does not hold in the Web build: keep the 12 percent margin of
  P-UNITY-HUD-VISUAL-FIX-2's oracle.
- TMP's `GetPreferredValues` is measured at the label's current size and wrapping mode; set the text before measuring, and restore the size.
- Do not re-fit from a per-frame loop over 63 labels: compare the text (length or hash) and only measure on a change.
- The automatic re-fit on a text change (contract item 3) is **not** pinned by the oracle (the tests call `Refit()` after writing text, since
  EditMode does not run `LateUpdate` or the render loop); the reviewer checks it by reading.

## Notes from previous attempts
