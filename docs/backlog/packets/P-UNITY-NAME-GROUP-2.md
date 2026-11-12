# P-UNITY-NAME-GROUP-2: a pack's one name is readable and sits on the pack; in-world camp labels read on any ground

- **Serves:** owner direction 2026-11-12 (less clutter on mobs while keeping the information); screenshot round 4
  (2026-11-12, `1aff1d31`), defects 1, 2, 3, 5 and 9
- **Implementer tier:** implementer-sonnet (Unity presentation; pure rule in `RoguehallaNet`)
- **Reviewer:** reviewer
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1 n/a (presentation; DEV-024 amended in the hand-off) · no wire change

## 1. ID and outcome
P-UNITY-NAME-GROUP-1 merged same-name mobs into one name per pack (`NameMerge.DecidePacks`,
`SpriteActorPresenter.MergeMobNames`, `Always = engaged || locked || hovered`). In the running client:
1. the pack's one name is drawn at half alpha with no outline over whichever member won, often to the side of the
   pack: on pale ground (Holy paving, Frost snow) it is almost invisible (round 4 shots 01, 06, 16, 18);
2. as soon as the pack is engaged every member shows its own name again and four names overlap each other and the
   camp badge (shots 03, 09);
3. a hovered mob's own name appears far from the mob or not at all (shots 07, 19);
4. "RESPAWN 167s" and "YOUR WARD 107s" are white and cyan text with no backing: unreadable on snow, and the ward
   label overlaps the player's name (shots 12, 14);
5. two fighters standing together have their names drawn on top of each other (shots 03, 20).

When this lands: a pack shows exactly one name, always: centred over the pack (above its highest member's bar) when
no member is singled out, and over the hovered or locked member when one is (hover wins over lock). Being engaged
no longer splits a pack. The name is drawn with the outlined label style the fighter names use, at an alpha that
passes the contrast check on every zone's floor. In-world camp and ward labels get the same outline or a dark plate
and never overlap a fighter's name (they shift up one line). Fighter names that would overlap are stacked
vertically, nearest fighter lowest, never merged.

## 2. Dependencies
none (P-UNITY-NAME-GROUP-1 merged)

## 5. Exclusive write scope
- `client-unity/RoguehallaNet/Net/Ui/NameMerge.cs` (+ a small pure stacking rule beside it) and the synced copy
- `client-unity/UnityProject/Assets/Scripts/Presentation/{SpriteActorPresenter*.cs,OverheadIndicators.cs,OverheadExtras.cs}`
- the script that draws "RESPAWN Ns" and the ward beacon label (the oracle author names it)
- `docs/DEVIATIONS.md` DEV-024 (one sentence: engaged packs keep one name)

## 7. Behaviour to preserve
- One buff badge per camp, elite marker, no role badge or per-type emblem (P-UNITY-DECLUTTER-1's oracle stays green).
- Elite mobs and quest givers keep their own names; mobs of different names never merge; the chain distance
  (`PackDistancePx = 128`) and the rule that a member leaving at an end of the chain splits nothing.
- A fighter's own name, bar and build row are untouched except for the vertical stacking.

## 8. Acceptance checks
- Unit (RoguehallaNet.Tests): `DecidePacks` returns one shown name per pack with engaged members; with a hovered
  member the shown one is that member; hovered and locked both present: hovered; the anchor of an unsingled pack is
  the pack's horizontal centre and its highest member's top.
- Unit: the stacking rule: N labels with overlapping rectangles come out non-overlapping, order by distance, stable.
- EditMode: the pack name label uses the outlined style and alpha at least 0.85; contrast of name colour and outline
  against each of the five zone floor colours at least 3:1 (reuse the contrast helper from
  `RegionThemeEditModeTests`); the respawn and ward labels have an outline or plate and do not intersect the local
  fighter's name rectangle in a scene where they share a position.
- `scripts/gate.sh --quick --oracle packet/P-UNITY-NAME-GROUP-2` passes.

## Oracle files (read-only for implementers)
- listed by the oracle author on `packet/P-UNITY-NAME-GROUP-2`

## 10. Risk and suggested model tier
Sonnet. The earlier oracle pinned `Always` for engaged members: those cases are replaced, and the oracle author says
which (file and test name) in the brief.

## 11. Known traps
- Run-time text scale re-applies sizes after build (`MatchHud.ApplyTextScale`): measure after it, as
  P-UNITY-HUD-VISUAL-FIX-2 learned.
- An EditMode run modifies `Assets/Resources/Showcase/NunitoRegular.asset`: `git checkout --` it, never commit it.
- Hand-off includes `git diff --stat packet/P-UNITY-NAME-GROUP-2`.

## Notes from previous attempts
