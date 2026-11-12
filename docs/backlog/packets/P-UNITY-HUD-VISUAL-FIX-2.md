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
- listed by the oracle author on `packet/P-UNITY-HUD-VISUAL-FIX-2`

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
