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
- listed by the oracle author on `packet/P-UNITY-HUD-VISUAL-FIX-1`

## 9. Validation commands
- `client-unity/UnityProject/Tools/editmode.sh`, `scripts/gate.sh --quick`

## 10. Risk and suggested model tier
Sonnet. Small fixes in several presenters; the risk is fixing a symptom in a screenshot without its cause.

## 11. Known traps
- The Web build draws world labels and HUD on different canvases: check sorting orders and render modes, not only
  sibling order.

## Notes from previous attempts
