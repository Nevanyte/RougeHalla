# P-UNITY-HUD-VISUAL-FIX-1: defects seen in the first real screenshots of the Web client

- **Serves:** ORDER_OF_OPERATIONS phase 3, item 16 (P-UI-5, P-UI-7); owner direction 2026-11-10/11 (bug fixes; "bring the
  build EXACTLY up to the original spec"); first running-client evidence, 2026-11-12
- **Implementer tier:** implementer-sonnet
- **Reviewer:** reviewer
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1 loose proof (owner direction 2026-11-10) · D2 n/a · D5/D6/D9 none

## Evidence
Screenshots of the Web build at `feature/unity-rework` @ 23c04a17 against a local `source-arena` server, 1920x1080, in
`/private/tmp/claude-501/-Users-nevinmckinnon-Documents-Projects-RogueHalla/a63755ad-8542-4ca6-a1cf-6f60fb5d1eb5/scratchpad/shots/`:
`hud-1920x1080-dpr1-match.png`, `hud-1920x1080-dpr1-map.png`, `hud-1920x1080-dpr1-planning.png`,
`ind-f1-1920x1080-007.png`, `ind-f3-1920x1080-004.png` (and the other `ind-*` frames). Read them.

## 1. ID and outcome
What the screenshots show wrong:
1. **The top-centre timer prints its colour tags**: `<color=#ffcc80>Coliseum 9:49</co...` (and is clipped). Cause:
   `MatchHud.Features.cs:196` wraps the text in `<color>` tags, but `HudUi.Label` creates labels with
   `richText = false` (`HudUi.cs:131`). The same pattern is at `MatchHud.Legacy.cs:463` (the bounty text).
2. **World labels draw over the HUD**: mob names ("Flame Caller", "Wyrmling", "Bloatfly") and a quest giver's name
   cover the timer, the ability slots' text and the bottom hint line.
3. **Mob name labels are large, far from their mobs and collide** with each other and with the camp stat badge
   plaque. Legacy's mob label is small text directly over the mob's bar (`packages/client/src/render/MobView.ts`).
4. **"Damage gain…" is truncated** in the GAINED strip (legacy label "Damage gained").
5. **Unexplained marks** to identify and either justify from legacy or remove: a boxed two-dot icon above each
   fighter's name (and a second one beside the hp bar in the match shot); a circled glyph above every mob; a small
   purple rectangle at the local fighter's feet (`ind-f1-…-007.png`) where the other shot has a ring; a pale two-blob
   sprite left of the timer at the top; the quest giver drawn as a grey prism.
When this lands the timer shows coloured plain text with no tags and fits its pill; world labels never cover HUD
elements; mob labels sit as legacy's do; the GAINED labels fit; and each mark in item 5 is either the legacy mark it
is meant to be (named in the brief with the legacy file:line) or gone.

## 2. Dependencies
- P-UNITY-HUD-BUILD-2 merged or not running (it edits `MatchHud.Legacy.cs` and `MatchHud.IconPresentation.cs`)

## 3. Relevant legacy paths
- `packages/client/src/ui/hud.ts:258-285` (timer colours), `packages/client/src/render/MobView.ts`,
  `PlayerView.ts` (labels, sizes, offsets, what is drawn above an actor), `packages/client/src/ui/buildHud.ts`
  (GAINED label widths)

## 5. Exclusive write scope
- `client-unity/UnityProject/Assets/Scripts/UI/MatchHud.Features.cs` (the timer line), `MatchHud.Legacy.cs` (the
  bounty text; GAINED cell label sizing), the world-label and overhead presenters under
  `client-unity/UnityProject/Assets/Scripts/Presentation/` that draw the marks in items 2, 3 and 5 (name them),
  canvas or sorting setup for world labels
- EditMode tests for each fix

## 6. Contracts and references
- No game rule in Unity; nothing about a fighter the viewer cannot see. Labels built from player names stay
  `richText = false` (names are untrusted text): colour the timer through the label's colour, not through tags.

## 7. Behaviour to preserve
- Everything else in the screenshots that is right: the GAINED strip's nine cells, camp badges and "AUG" tags, "ENEMY"
  chips, respawn clocks on the minimap, the range arc, cooldown seconds, potion and emblem texts.
- No allocation per frame.

## 8. Acceptance checks
- EditMode: the timer label's text contains no `<` for Warn and Danger tones and its colour is the tone's; the
  bounty text likewise; world-label objects sort below the HUD canvas; a mob label's anchor is within the legacy
  offset of its mob and its font size is legacy's; every GAINED cell label fits its cell at 1280x800 and 1920x1080
  (preferred width <= cell width); each mark in item 5 is absent or produced by a named legacy rule.
- `scripts/gate.sh --quick --oracle packet/P-UNITY-HUD-VISUAL-FIX-1` passes.
- New screenshots after the fix (the coordinator re-captures).

## Oracle files (read-only for implementers)
- `client-unity/UnityProject/Assets/Tests/Editor/HudVisualFixEditModeTests.cs` (+ `.meta`)

Stub commit (the implementer replaces it): `MatchHud.Features.cs` gains `public void ApplyPhaseStrip(string, Indicators.ArenaLineTone)`, the
test seam `TickMetrics` now calls; today it still writes `<color>` tags.

Routing: serves ORDER_OF_OPERATIONS phase 3 item 16 (P-UI-5, P-UI-7) · tier implementer-sonnet · reviewer reviewer · D1 loose proof (D2, D5, D6, D9 untouched).
Write scope for the implementer (exact files): `UI/MatchHud.Features.cs` (ApplyPhaseStrip), `UI/MatchHud.Legacy.cs` (phase pill width at
`CreateTopAndToastPills`, GAINED name/value boxes at `CreateBuildHud`; do NOT touch the champion panel, P-UNITY-HUD-BUILD-2 owns it),
`Presentation/OverheadIndicators.cs` (mob name alpha and elite size), `Presentation/ShowcaseIdentityOwner.cs` (role badge). Nothing else.

## Findings (oracle author, with the evidence the tests pin)

### Causes, one per defect
1. **Timer tags.** `MatchHud.Features.cs` (`ApplyPhaseStrip`, was line 196) wraps the text in `<color>`; `HudUi.cs:131` makes the label plain. Fix: set
   `_phaseStrip.color` (legacy `--warn` #ffcc80 for Warn, `.hud-arena.sudden` #ff8a80 for Danger, theme TextPrimary otherwise; `style.css:44,320`),
   text untouched. Clipping: `MatchHud.Legacy.cs:94` builds the pill at a fixed 220 wide and the label fills it with Ellipsis; "Coliseum 9:49"
   needs 233, "Coliseum · sudden death" 298, the lobby line 279. Legacy's line is auto-width (`hud.ts` updateArena sets textContent). Fix: size the
   pill to the text (`ApplyPhaseStrip`), tested for five lines.
   Other `<` tags written into labels made by `HudUi.Label`: only `MatchHud.Legacy.cs:463` (bounty). That label turns rich text back on
   (`MatchHud.Legacy.cs:158`, text is digits only), so the bounty renders correctly: **not a defect**; one passing guard test, no change asked.
   `HelpGuideView.cs:272-290` writes tags into its own label (rich text on, text escaped): fine.
2. **World labels over the HUD: not a sorting defect.** The HUD canvas is `ScreenSpaceOverlay` (`MatchHud.cs:77`); world text is `TextMeshPro` on a
   `MeshRenderer` in the camera pass (`OverheadIndicators.cs:109-117`, `WorldMarks.cs:84-89`, `WorldIndicators.cs:234-239`, sorting orders 30 to 31001),
   which an overlay canvas always draws after. The crops show it: the pill hides the label where they meet and the label shows through the
   translucent panels (pill alpha .94 in `MatchHud.Legacy.cs:95`, slots, hint line has no backplate). Legacy is the same (DOM over the Phaser canvas).
   No sorting test is written because none can fail. What makes them look "on top" is the label's strength: see 3.
3. **Mob labels.** Offset and size already match legacy: name baseline 45.2 px above the feet (`OverheadStack.cs:90` = `MobView.ts:18-19` LABEL_Y
   -14-13.2-18), TMP size 2.5 = 0.25 world units against 11 px x .026 = 0.286. Legacy does not hide plain names; it fades them. Differences that are real:
   (i) `MobView.ts:26-27,183-186`: an idle full-hp non-elite mob's name has alpha 0.5 (`IDLE_LABEL_ALPHA`); hurt or fighting, an elite, and the
   dummy read at 1. Unity forces alpha 1 (`OverheadIndicators.cs:~172` `_nameBase.a = 1f`). "Fighting" = `Marks.Engaged`, which the presenter
   already treats as the dummy-bar case (`SpriteActorPresenter.cs:319`). (ii) `MobView.ts:247`: an elite's name is 12 px bold, others 11 px; Unity uses
   2.5 for all. Fix both in `OverheadIndicators.Update` (alpha is part of `_nameBase`, vision fade still multiplies).
4. **GAINED truncation.** `MatchHud.Legacy.cs` `CreateBuildHud`: name box 58 wide at x=23 inside a 109 cell, autosize 8.5..10; "Damage gained" needs
   70.65 at the nominal size. Value box is 26 wide at x=80 holding "0%" or "+0" (about 16). Legacy cells show icons only (`buildHud.ts:101-115`);
   the Unity text names are an addition, kept. Fix: give the name box the room (cell 109, icon ends at 23, value needs about 18), keep the text,
   nominal size >= 8. `HudLegacyLayoutEditModeTests` pins `GetComponentInChildren<TMP_Text>` order (name first), cell height 14, rule width 3: keep.

### The marks
- (a) **Boxed two-dot icon above each name and beside the bar: legacy, keep.** It is the secondary-weapon mark, `PlayerView.ts:452-468`:
  box 18 px at x -18, `heldWeapon(...) ?? FISTS`, so every fighter with an empty off-hand shows fists. Unity: `OverheadStack.cs` SecondaryWeapon,
  drawn at `OverheadIndicators.cs` (art key `weapon5` = `WeaponId.Fists`, real art). Guard test only.
- (b) **Circled glyph above every mob: wrong for grunts, brutes and elites.** `ShowcaseIdentityOwner.cs:60-61` shows a role badge (backplate + glyph) for
  every known mob. Legacy draws a role glyph only for swarm (dots), skirmisher (chevron), caster (ring), none for grunt, and a thick rim for brute
  (`mobRole.ts:20-26`, `MobView.ts:213-215`), on the disc, with no circle. Tests: badge off for Bailiff, Rot Monk, Magma Brute, Wyrmling; on for
  Ember Imp, Cinder Hound, Flame Caller. The circle and its position above the head (vs legacy on the body) and the elite emblem badge
  (`ShowcaseIdentityOwner.cs:62-63`, legacy has only the gold rings and star) are Unity design: NOT pinned, owner decision / DEVIATIONS row if kept.
  The art is procedural (`ShowcaseIdentityAssets.cs` `BuildGlyph` family 1), not a failed art key.
- (c) **Small purple rectangle at the local fighter's feet / hexagon in the other shots: the faction footprint, not legacy.** `SpriteActorPresenter.cs:299-307`
  draws `FactionIndicators.GetFootprint(faction)` (Fire triangle, Sentenced square, Plague trefoil, Frost hexagon, Holy circle) scaled to the server's
  foot box (ADR 0024); a Sentenced 10x6 box is the squat rectangle. Legacy draws a white ellipse ring under the LOCAL player only
  (`PlayerView.ts:31,51,148-152`, `LOCAL_RING_W = PLAYER_RADIUS*2.9`) and nothing under others; Unity has no such ring (grep finds none). Intended
  art (ADR 0024), not a placeholder. NOT pinned: removing it or adding the ring is an owner call. The large lavender disc round the local fighter
  in the match shot is **unidentified** (checked `OverheadIndicators` rings, `WorldIndicators`, `WeaponRangePresenter` by name only).
- (d) **Pale two-blob left of the timer: two overlapping Plague fireflies**, `LifeLights.cs` ("Mote glow", fx.fireflies, decorative, random, 0.32-0.52
  units; `LifeLights.cs:73`). Not legacy, not a placeholder, switchable; it sits under the HUD like everything else. No test.
- (e) **Quest giver as a grey prism: a placeholder by design.** `ShowcaseActorLook.cs:39,47` give quest givers no look, so
  `SpriteActorPresenter.cs:274` draws `GetFactionSilhouette(-1)` (generic grey, `ShowcaseIdentityAssets.cs:206`) and the "Unknown diamond" footprint
  (`FactionIndicators.cs:23`). Legacy (`QuestView.ts:120-146`): a diamond lozenge filled in `questKindColor(kind)`, a stem to the ground,
  name 11 px at -BODY_LIFT-42, "!" 22 px at -60. NOT pinned: whether to draw the legacy diamond is a design call (the code comment says the neutral
  silhouette was chosen on purpose).

### Not covered by a failing test
Item 2 (see above), marks (c), (d), (e), the bounty text. The passing guards are `TheBountyTagRendersWhereItIsWritten`,
`TheBoxedFistsIconIsTheLegacySecondaryWeaponMarkLeftOfCentre`, `ANormalLineTakesBackThePrimaryColourAfterAToneLine`, and the Planning case.

## 9. Validation commands
- `client-unity/UnityProject/Tools/editmode.sh`, `scripts/gate.sh --quick`

## 10. Risk and suggested model tier
Sonnet. Small fixes in several presenters; the risk is fixing a symptom in a screenshot without its cause.

## 11. Known traps
- The Web build draws world labels and HUD on different canvases: check sorting orders and render modes, not only
  sibling order.

## Notes from previous attempts
