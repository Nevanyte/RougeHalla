# P-UNITY-HUD-VISUAL-FIX-2: what the second screenshot round still shows wrong

- **Serves:** ORDER_OF_OPERATIONS phase 3, item 16 (P-UI-5, P-UI-6); owner direction 2026-11-10/12 (bug fixes; less
  clutter; the stats-gained text labels stay); second running-client evidence, 2026-11-12
- **Implementer tier:** implementer-sonnet
- **Reviewer:** reviewer
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1 loose proof · D2 n/a · D5/D6/D9 none

## Evidence
Screenshots of the Web build at `feature/unity-rework` @ cc48c6fb, 1920x1080 and 1280x800, in
`/private/tmp/claude-501/-Users-nevinmckinnon-Documents-Projects-RogueHalla/a63755ad-8542-4ca6-a1cf-6f60fb5d1eb5/scratchpad/shots2/`:
`hud-1920x1080-dpr1-match.png`, `hud-1280x800-dpr1-match.png`, `hud-1920x1080-dpr1-map.png`,
`hud-1280x800-dpr1-map.png`, `ind-f1-1920x1080-007.png`, `ind-f3-1920x1080-006.png`, `demo-f2-1920x1080-002.png`.
Read them. Fixed since round one and to be preserved: the timer (plain gold text in a pill that fits), one buff icon
per camp with a gold diamond for elites, no role marks on mobs, dim idle mob names, the map key's two new rows.

## 1. ID and outcome
1. **"Damage gain…" is still clipped** in the stats-gained strip in the real build, at both sizes, although the
   EditMode test of P-UNITY-HUD-VISUAL-FIX-1 says the label fits (name font 8 in a 58-unit box): the Web build's font
   metrics are wider than the editor's measurement. The owner wants the text labels kept. The label must fit by
   construction, not by a measured margin of one unit: let the name label auto-size (ellipsis off) and/or give the
   strip the few units it needs.
2. **The champion panel's passive value is cut off**: "32% AS · 30% MS sl…" (Frost: "32% AS · 30% MS slow"). The value
   column is too narrow for the longest legacy passive values. Each row's value must show in full at both sizes
   (wrap to a second line or auto-size; legacy wraps).
3. **The Tab map's vision overlay hides a zone label** ("SENT…ED" under the pale fan around the player): zone labels
   and zone icons draw above the vision overlay.
4. **Mob names pile up** when mobs of a camp stand together ("Miasma WitchMiasma Witch", names over the player's
   name): names of the same text whose anchors are closer than the text is wide are drawn once (the topmost), so a
   pack reads as one name. Elite names are never merged away. This follows the owner's direction to reduce clutter on
   mobs; legacy draws every name.
When this lands each of the four is fixed, with tests that would have caught 1 and 2 without a real browser (fit
checks with a safety margin, and against the longest text the formatters can produce).

## 2. Dependencies
none (P-UNITY-HUD-VISUAL-FIX-1, P-UNITY-HUD-BUILD-2 and P-UNITY-DECLUTTER-1 are merged)

## 3. Relevant legacy paths
- `packages/client/src/ui/championCombatHud.ts` and its CSS (how long values wrap), `packages/client/src/render/MobView.ts`
  (name labels), `packages/client/src/ui/planning.ts` / `mapPainter.ts` (zone labels over the fog)

## 5. Exclusive write scope
- `client-unity/UnityProject/Assets/Scripts/UI/MatchHud.Legacy.cs` (GAINED cells; champion panel rows),
  `MatchHud.IconPresentation.cs` (champion rows), `TacticalMapMarks.cs` / `TacticalMapController.cs` (draw order of
  zone labels and the vision overlay), `Presentation/OverheadIndicators.cs` (name merging)
- a pure helper in `client-unity/RoguehallaNet/Net/Ui/` for the name-merging decision, with tests
- EditMode tests

## 6. Contracts and references
- No game rule in Unity. Name merging is presentation: it never hides an elite's name, the local player's name or
  another player's name.
- Labels built from player names stay `richText = false`.

## 7. Behaviour to preserve
- Everything listed under Evidence as fixed; the GAINED text labels and their wording; the champion panel's row texts
  (their oracle pins them); no allocation per frame.

## 8. Acceptance checks
- EditMode: every GAINED name label and value label fits with a margin of at least 12 percent of its box at 1280x800
  and 1920x1080 for the widest texts ("Damage gained", "Soul Defense", "+125.5%", "+1234.5"), with no ellipsis; every
  champion panel value fits or wraps without truncation for the longest value of each faction (name them from
  `ChampionPanelText`'s cases); zone labels render above the vision overlay.
- Unit tests on the name-merging helper: two same-text names closer than the text width give one; different texts
  both show; an elite's name always shows; player names always show; a far pair both show.
- `scripts/gate.sh --quick --oracle packet/P-UNITY-HUD-VISUAL-FIX-2` passes; a third screenshot round (the coordinator).

## Oracle files (read-only for implementers)
- `client-unity/RoguehallaNet.Tests/NameMergeTests.cs` (13 unit tests of the helper)
- `client-unity/UnityProject/Assets/Tests/Editor/HudVisualFix2EditModeTests.cs` and its `.meta`
- Stub commit (the implementer replaces/edits): `client-unity/RoguehallaNet/Net/Ui/NameMerge.cs` (empty `Decide`) and its synced copy
  `client-unity/UnityProject/Assets/RoguehallaNet/Net/Ui/NameMerge.cs` plus `.meta`; test-visible `OverheadIndicators.NameActive`
  and `SpriteActorPresenter.NameShown(id)` (both already real, read-only accessors).

## Findings (oracle author), by defect

### 1. GAINED labels: why the editor test passed and the build clipped
Cause: `MatchHud.ApplyTextScale` (MatchHud.cs:121-132) runs on every `ShowcaseSettings.Changed` (MatchHud.cs:76) and calls
`MythicUi.ApplyTextScale(_root, scale)` (MythicUi.cs:99-102), which re-applies `MythicTextScale` to every label under the HUD root
(`fontSize = fontSizeMax = BaseSize * scale; fontSizeMin = fontSize * .85`, MythicTextScale.cs:9-12). `HudUi.Label` stamped `BaseSize = 10`
(SizeTiny) on the GAINED name label (HudUi.cs:148) and on the value label, so the construction-time overrides in `CreateBuildHud`
(MatchHud.Legacy.cs:186-192: name 8..8, value 6..10) are thrown away at run time: the name becomes 10 shrinking to 8.5, the value 10
shrinking to 8.5. `HudVisualFixEditModeTests` measured the label right after construction (size 8), the state the running HUD never stays in.
Same font asset (Nunito) in both; no font difference. Measured after the re-apply, at 1280x800 and 1920x1080 (identical, the stage scales the
whole HUD): "Damage gained" needs 60.06 of 58 at 8.5 (clipped), "Health gained" 53.75 of 58, "+125.5%" needs 35.64 of 28 at 8.5. Every GAINED
label also ends in `TextOverflowModes.Ellipsis` (HudUi.cs:131, never overridden for the names; the value label sets Overflow).
The champion value labels have the same mechanism (BaseSize 12; `HudUi.Label` leaves auto-size off so they stay at a fixed 12).
Fix shape for the implementer: stop the re-apply from reaching these labels (remove their `MythicTextScale` component, or set `BaseSize`
to what you want and keep the min below it) and make the boxes fit: e.g. widen the name box (58) by narrowing the value box, set
`overflowMode = Overflow` on the names, size so the widest text uses at most 88 percent of its box at the smallest size autosizing reaches
(name floor at least 7, value floor at least 6). Cell width is 109; the name box must end where the value box begins; the value box stays
inside the cell. The oracle measures after calling `ApplyTextScale` at scale 1.
Arithmetic (Nunito, widths scale linearly with size): "Damage gained" is 7.07 units per point of size, "+125.5%" 4.19. With the 12 percent
margin the name box must be at least 7.07 x floor / .88 and the value box 4.19 x floor / .88: at floors 7 and 6 that is 56.3 and 28.6, total
84.9 plus the 23 for rule and icon = 107.9 of the 109 cell, with no slack for gaps. So also widen the cell (`BuildCellWidth`, `BuildColumnStep`,
the plate's 240 width `PlateInner`) by a few units, as the brief allows, rather than trying to squeeze 109.

### 2. Champion panel values
Value label: `MatchHud.Legacy.cs:253` (`At(row, "Value", 108, 1, 124, 15)`, size 12 bold, ellipsis, no auto-size); name label box 100 wide at x=6
(:252) though its words are at most "Dragonslayer" / "Sword hit". Measured at 12: "32% AS . 30% MS slow" needs 131.8 of 124,
"2.16% target HP / hit" 118.6 of 124 (no margin). Fire "64.38 magic/s", Plague "62.4 magic/s", Holy "7% life steal" and the auto row
"49.19 / hit . 1.98/s" fit today and are guarded.
Legacy layout (championCombatHud.css:35,44): a two-column grid `minmax(0,1fr) minmax(0,1.15fr)` with a 6 px gap in a 250-wide panel (about
108 px name, 124 px value) and the value `white-space: nowrap; overflow: hidden; text-overflow: ellipsis` in 11 px system-ui, so legacy
also truncates; it does not wrap (the brief's "legacy wraps" was wrong). Unity's Nunito is wider than system-ui, hence the clipping. Fix: give
the value more room (shrink the name box to about 70, move the value to x about 80, width about 150) and/or auto-size it down to 10. Oracle:
at the smallest size the label can reach (auto-size floor, else its fixed size) the text uses at most 92 percent of the box and that size
is at least 9, at both sizes, after `ApplyTextScale`. The name and value boxes must not overlap and must stay in the 234-wide row.
No wrap: the row is 30 high with a scaling line at y=17.

### 3. Tab map zone label under the player ring
Draw order today: Surface rect = terrain RawImage; child 0 `Vision fog` RawImage; child 1 marks mesh (`TacticalMapMarks`); the zone labels are TMP
children of the marks (TacticalMapMarks.cs:191). The pale fan is the fog texture, below everything, so it is not what covers the text. The thing
on top of "SENTENCED" in the screenshot is the player's own ring and disc (TacticalMapMarks.cs:488-492, drawn with the cream `TextPrimary` ring
at 26 px and the info-blue disc) standing on the zone's label spot; the 1280 shot shows the same with the rival "ENEMY" chip. From hierarchy
alone the label should draw after the mesh, yet the crop shows the middle letters gone behind the opaque disc, and `-nographics` EditMode cannot
render, so the cause could not be proven. The oracle therefore pins two hedges that hold whichever it is: (a) the six labels move out of the mesh
into a container that is a later sibling of the marks mesh (and of the fog) under the surface; (b) each label has a dark outline (OUTLINE_ON,
width at least .1, colour `OutlineDark`; `OverheadIndicators.OutlinedMaterial` at OverheadIndicators.cs:92 is the pattern: one shared material
per font, no per-label instance). Constraint from an existing test (`MapScreenEditModeTests.MarksDrawZoneIconsOnly...`): a `TacticalMapMarks`
with no parent must still own its labels as children (6 of them), and the minimap (not `Large`) draws none. So: container under `transform.parent`
when there is one, else under the marks. Do NOT use a nested Canvas with override sorting (it would outrank modals). If the third screenshot round
still shows the ring over the text, the next step is to draw the self marker and ping in their own Graphic placed before the container.

### 4. Mob names
Each actor owns its name label (`OverheadIndicators._name`, OverheadIndicators.cs:149-154, set active in `Update`), updated per actor from
`SpriteActorPresenter.PresentIndicators` (:499-507) between `Begin()` and `End()` (ArenaView.cs:268-315). The merge needs every mob of the
frame, so it runs in `SpriteActorPresenter.End()` (:159): collect each live, non-dead creature's name (`Facts.Name`, `Facts.Mob`, `Facts.Elite`),
world anchor (the name transform's position), width (`_name.preferredWidth` times its lossy scale), call `NameMerge.Decide`, and deactivate the
`_name` object of the hidden ones (add e.g. `OverheadIndicators.SetNameHidden(bool)`; `Update` re-enables it the next frame, `End` re-hides it before
render). Players (`Kind == Player`) and the training dummy are never put in the buffer. No per-frame allocation: reuse a `NameMergeItem[]` and a
`bool[]` kept on the presenter (grow when needed). Legacy draws every name (MobView.ts:108-110); this is the owner's declutter direction, so a
DEVIATIONS row is proposed in the hand-off.

#### Helper (already stubbed, signature fixed)
```csharp
// client-unity/RoguehallaNet/Net/Ui/NameMerge.cs
public struct NameMergeItem { public uint Id; public string Text; public float X, Y; public float Width; public bool Elite; }
public static class NameMerge { public static int Decide(NameMergeItem[] items, int count, bool[] shown); }
```
Semantics (the doc comment on `Decide` is normative): ids ascending regardless of input order; a non-elite is hidden iff a shown non-elite of the
same non-empty Text with a lower Id has its anchor strictly closer (Euclidean) than the narrower Width; an elite is always shown and never hides
another; a hidden mob cannot hide a third (a chain keeps its far end); returns the number shown; writes only `shown[0..count)`; allocation-free
(O(n squared) is fine for tens of mobs).

## Exact edits for the implementer
- `client-unity/RoguehallaNet/Net/Ui/NameMerge.cs` (fill `Decide`), then `bash client-unity/sync-net.sh`.
- `client-unity/UnityProject/Assets/Scripts/UI/MatchHud.Legacy.cs` :186-192 (GAINED name and value labels: scale re-apply, overflow, box widths)
  and :250-253 (champion name/value boxes, size or auto-size).
- `client-unity/UnityProject/Assets/Scripts/UI/TacticalMapMarks.cs` :181-203 (`RefreshZoneLabels`: container sibling, outlined material).
- `client-unity/UnityProject/Assets/Scripts/Presentation/OverheadIndicators.cs` (a way to hide the name after `Update`) and
  `SpriteActorPresenter.cs` `End()` (the merge pass).
- Not changed: `MythicTextScale.cs`, `HudUi.cs` (shared by every screen) unless the change is a new optional parameter that leaves them as is.

## Existing tests that stay as they are
`HudVisualFixEditModeTests.EveryGainedCellLabelIsShownWholeAtBothWindowSizes` and `BuildHudCellsEditModeTests.TheWidestFormattedGainsFit...`
keep passing (they measure at construction, which is why they missed the defect): the fix must keep the construction-time state valid too
(name font at least 8 at construction and its text within the 58 box or its replacement; value text within the value box at the construction floor).
If widening the name box makes the first one fail, tell the owner rather than editing it.

## 9. Validation commands
- `dotnet test client-unity/RoguehallaNet.Tests`, `bash client-unity/sync-net.sh --check`,
  `client-unity/UnityProject/Tools/editmode.sh`

## 10. Risk and suggested model tier
Sonnet. The lesson of item 1: an editor-measured fit with no margin is not proof for the Web build.

## 11. Known traps
- TMP's preferred width in EditMode can be narrower than the Web build's rendering: test with a margin and prefer
  auto-sizing over exact fits.
- Merging names must be stable frame to frame (pick the survivor by a stable key, e.g. lowest actor id), or the label
  will flicker between mobs.

## Notes from previous attempts
